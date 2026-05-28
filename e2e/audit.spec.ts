import { test, expect, Page, Request, Response, ConsoleMessage } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Site audit for https://cfms.dev/
 *
 * For each visited route we capture:
 *  - console errors / warnings
 *  - failed network requests (status >= 400 or net error)
 *  - uncaught page errors
 *  - basic accessibility / SEO signals (title, h1, lang, meta description)
 *  - response timing for the main document
 *  - whether the SPA actually mounted (#root has children)
 *
 * Results are written to e2e-artifacts/audit-report.json so the runner
 * can summarize them after the run.
 */

type RouteIssue = {
  route: string;
  finalUrl: string;
  status: number | null;
  loadMs: number;
  title: string;
  h1: string | null;
  lang: string | null;
  metaDescription: string | null;
  mountedReact: boolean;
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: { url: string; status: number | null; method: string; failure?: string }[];
  brokenLinks: { href: string; status: number | null; error?: string }[];
  notes: string[];
};

const ROUTES = [
  "/",
  "/admin-login",
  "/master-login",
  "/portal",
  "/admin",
  "/master",
  "/panel-disabled",
  "/this-route-should-not-exist-xyz",
  "/some-random-slug",
  "/some-random-slug/portal",
  "/some-random-slug/admin",
];

const ARTIFACT_DIR = path.resolve(__dirname, "..", "e2e-artifacts");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const REPORT_FILE = path.join(ARTIFACT_DIR, "audit-report.json");

// Shared collector across all tests in this file (chromium project only writes).
const allResults: RouteIssue[] = [];

test.afterAll(async () => {
  // Merge with any existing file (so mobile project adds to chromium output).
  let prior: RouteIssue[] = [];
  if (fs.existsSync(REPORT_FILE)) {
    try {
      prior = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
    } catch {
      prior = [];
    }
  }
  const tagged = allResults.map((r) => ({ ...r, project: test.info().project.name }));
  fs.writeFileSync(REPORT_FILE, JSON.stringify([...prior, ...tagged], null, 2));
});

async function auditRoute(page: Page, route: string): Promise<RouteIssue> {
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: RouteIssue["failedRequests"] = [];

  const onConsole = (msg: ConsoleMessage) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "error") consoleErrors.push(text);
    else if (type === "warning") consoleWarnings.push(text);
  };
  const onPageError = (err: Error) => pageErrors.push(`${err.name}: ${err.message}`);
  const onRequestFailed = (req: Request) => {
    failedRequests.push({
      url: req.url(),
      status: null,
      method: req.method(),
      failure: req.failure()?.errorText,
    });
  };
  const onResponse = (res: Response) => {
    const status = res.status();
    if (status >= 400) {
      failedRequests.push({ url: res.url(), status, method: res.request().method() });
    }
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);

  const start = Date.now();
  let status: number | null = null;
  let finalUrl = route;
  const notes: string[] = [];

  try {
    const resp = await page.goto(route, { waitUntil: "networkidle", timeout: 30_000 });
    status = resp?.status() ?? null;
    finalUrl = page.url();
  } catch (e) {
    notes.push(`navigation error: ${(e as Error).message}`);
  }
  const loadMs = Date.now() - start;

  // Give the SPA a beat to mount lazy chunks.
  await page.waitForTimeout(800);

  const title = await page.title().catch(() => "");
  const h1 = await page.locator("h1").first().textContent().catch(() => null);
  const lang = await page.evaluate(() => document.documentElement.lang || null).catch(() => null);
  const metaDescription = await page
    .evaluate(() => document.querySelector('meta[name="description"]')?.getAttribute("content") || null)
    .catch(() => null);
  const mountedReact = await page
    .evaluate(() => (document.getElementById("root")?.children.length ?? 0) > 0)
    .catch(() => false);

  // Collect same-origin links to sample-check (HEAD).
  const sameOriginLinks: string[] = await page
    .evaluate(() => {
      const origin = location.origin;
      const set = new Set<string>();
      document.querySelectorAll("a[href]").forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        if (!href) return;
        if (href.startsWith(origin)) set.add(href);
      });
      return [...set];
    })
    .catch(() => []);

  const brokenLinks: RouteIssue["brokenLinks"] = [];
  const linkSample = sameOriginLinks.slice(0, 15);
  for (const href of linkSample) {
    try {
      const r = await page.request.get(href, { timeout: 8_000, maxRedirects: 5 });
      if (r.status() >= 400) brokenLinks.push({ href, status: r.status() });
    } catch (e) {
      brokenLinks.push({ href, status: null, error: (e as Error).message });
    }
  }

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("requestfailed", onRequestFailed);
  page.off("response", onResponse);

  return {
    route,
    finalUrl,
    status,
    loadMs,
    title,
    h1,
    lang,
    metaDescription,
    mountedReact,
    consoleErrors,
    consoleWarnings,
    pageErrors,
    failedRequests,
    brokenLinks,
    notes,
  };
}

for (const route of ROUTES) {
  test(`audit ${route}`, async ({ page }) => {
    const result = await auditRoute(page, route);
    allResults.push(result);

    // Soft assertions — we want the run to continue so we collect everything.
    // Hard failure only on truly broken cases (so report still writes).
    expect.soft(result.pageErrors, `pageerrors on ${route}`).toEqual([]);
  });
}

test("login page renders form controls", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const inputs = await page.locator("input").count();
  const buttons = await page.locator("button").count();
  allResults.push({
    route: "/ (form check)",
    finalUrl: page.url(),
    status: 200,
    loadMs: 0,
    title: await page.title(),
    h1: await page.locator("h1").first().textContent().catch(() => null),
    lang: null,
    metaDescription: null,
    mountedReact: true,
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    brokenLinks: [],
    notes: [`inputs=${inputs}`, `buttons=${buttons}`],
  });
  expect.soft(inputs, "login should have at least 1 input").toBeGreaterThan(0);
  expect.soft(buttons, "login should have at least 1 button").toBeGreaterThan(0);
});

test("robots.txt and sitemap presence", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  const sitemap = await request.get("/sitemap.xml");
  allResults.push({
    route: "/robots.txt + /sitemap.xml",
    finalUrl: "",
    status: robots.status(),
    loadMs: 0,
    title: "",
    h1: null,
    lang: null,
    metaDescription: null,
    mountedReact: false,
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    brokenLinks: [],
    notes: [
      `robots.txt status=${robots.status()}`,
      `sitemap.xml status=${sitemap.status()}`,
    ],
  });
});

test("security headers on root document", async ({ request }) => {
  const r = await request.get("/", { maxRedirects: 5 });
  const h = r.headers();
  const interesting = [
    "content-security-policy",
    "strict-transport-security",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "cross-origin-opener-policy",
  ];
  const notes = interesting.map((k) => `${k}=${h[k] ? "present" : "MISSING"}`);
  allResults.push({
    route: "/ (security headers)",
    finalUrl: "",
    status: r.status(),
    loadMs: 0,
    title: "",
    h1: null,
    lang: null,
    metaDescription: null,
    mountedReact: false,
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    brokenLinks: [],
    notes,
  });
});

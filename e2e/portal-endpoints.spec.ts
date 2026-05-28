import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEY = "ak_2fPzdkaBURJXIdg3oI08L4Z7";

const ARTIFACT_DIR = path.resolve(__dirname, "..", "e2e-artifacts");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const REPORT_FILE = path.join(ARTIFACT_DIR, "portal-endpoints-report.json");

// Clearly fake test values — chosen to look syntactically valid but NOT match real records.
const SAMPLES: Record<string, string> = {
  "/mobile": "9999999999",
  "/aadhaar": "999999999999",
  "/email": "playwright-test@example.com",
  "/gst": "27AAPFU0939F1ZV",
  "/telegram": "playwright_test_user",
  "/ifsc": "SBIN0000001",
  "/rashan": "999999999999",
  "/upi": "playwrighttest@upi",
  "/upi2": "playwrighttest@upi",
  "/vehicle": "MH01AB1234",
  "/v2": "playwright-test-query",
  "/pan": "ABCDE1234F",
  "/gas": "1234567890",
  "/fastag": "MH01AB1234",
  // custom endpoints observed on the live portal
  "/Number": "9999999999",
  "/v4": "9999999999",
};
const DEFAULT_SAMPLE = "test123";

type EndpointResult = {
  label: string;
  endpoint: string;
  param: string;
  sample: string;
  upstreamUrl?: string;
  upstreamStatus?: number;
  upstreamMs?: number;
  upstreamOk?: boolean;
  responsePreview?: string;
  uiError?: string | null;
  uiShowedResult?: boolean;
  consoleErrors: string[];
  failedRequests: { url: string; status: number | null; failure?: string }[];
  notes: string[];
};

async function login(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.locator('input[type="password"]').fill(KEY);
  await page.getByRole("button", { name: /access portal/i }).click();
  await page.waitForURL(/\/portal$/, { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
}

test("portal: exercise every endpoint card", async ({ page }) => {
  test.setTimeout(5 * 60_000);

  await login(page);

  // Wait until at least one endpoint card with a "/path" label is rendered.
  await page.locator('button:has(p:text-matches("^/", "i"))').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500); // let custom endpoints settle

  // Collect endpoint list from the rendered DOM (button containing a <p> starting with "/").
  const endpoints = await page.evaluate(() => {
    const out: { label: string; endpoint: string }[] = [];
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const b of buttons) {
      const ps = Array.from(b.querySelectorAll("p")) as HTMLParagraphElement[];
      if (ps.length < 2) continue;
      const epP = ps.find((p) => (p.textContent || "").trim().startsWith("/"));
      const labelP = ps.find((p) => p !== epP && (p.textContent || "").trim().length > 0);
      if (!epP || !labelP) continue;
      out.push({
        label: (labelP.textContent || "").trim(),
        endpoint: (epP.textContent || "").trim(),
      });
    }
    // De-dupe by endpoint just in case.
    const seen = new Set<string>();
    return out.filter((e) => (seen.has(e.endpoint) ? false : (seen.add(e.endpoint), true)));
  });
  // eslint-disable-next-line no-console
  console.log(`[discovered ${endpoints.length} endpoints]`, endpoints.map((e) => e.endpoint).join(", "));

  // We need each endpoint's `param`. We know the built-ins from source; for unknown
  // ones we'll discover param by reading the placeholder ("Enter <param>...") after click.
  const results: EndpointResult[] = [];

  for (const ep of endpoints) {
    const consoleErrors: string[] = [];
    const failedRequests: EndpointResult["failedRequests"] = [];

    const onConsole = (m: { type(): string; text(): string }) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    };
    const onRequestFailed = (r: { url(): string; failure(): { errorText: string } | null }) => {
      failedRequests.push({ url: r.url(), status: null, failure: r.failure()?.errorText });
    };
    page.on("console", onConsole as never);
    page.on("requestfailed", onRequestFailed as never);

    // Click the card by its label.
    const card = page.locator("button", { hasText: new RegExp(`^${escapeRe(ep.label)}\\b`) }).first();
    await card.scrollIntoViewIfNeeded();
    await card.click();

    // Read the input placeholder to discover the param name.
    const input = page.locator('input[placeholder^="Enter "]').first();
    await input.waitFor({ state: "visible", timeout: 5_000 });
    const placeholder = (await input.getAttribute("placeholder")) || "";
    const param = placeholder.replace(/^Enter\s+/, "").replace(/\.\.\.$/, "").trim();

    const sample = SAMPLES[ep.endpoint] ?? DEFAULT_SAMPLE;

    // Intercept the upstream API call to capture URL, status, timing, body preview.
    let upstreamUrl: string | undefined;
    let upstreamStatus: number | undefined;
    let upstreamMs: number | undefined;
    let upstreamOk: boolean | undefined;
    let responsePreview: string | undefined;
    const upstreamPromise = page
      .waitForResponse(
        (r) => r.url().includes("anuapi.netlify.app") && r.url().includes(ep.endpoint),
        { timeout: 30_000 }
      )
      .then(async (resp) => {
        upstreamUrl = resp.url();
        upstreamStatus = resp.status();
        upstreamOk = resp.ok();
        const timing = resp.request().timing();
        upstreamMs = Math.round(timing.responseEnd - timing.startTime);
        try {
          const txt = await resp.text();
          responsePreview = txt.slice(0, 400);
        } catch {
          responsePreview = "<unreadable body>";
        }
      })
      .catch(() => {
        /* timeout — leave undefined */
      });

    await input.fill(sample);
    // The search button is the icon-only button next to the input — locate by its sibling structure.
    const searchBtn = page.locator('input[placeholder^="Enter "]').first().locator("xpath=following-sibling::button[1]");
    await searchBtn.click();

    await upstreamPromise;

    // Wait briefly for UI to render result / error.
    await page.waitForTimeout(800);

    const uiError = await page
      .locator(".text-destructive")
      .first()
      .textContent()
      .catch(() => null);
    const uiShowedResult = (await page.locator("pre").count()) > 0;

    page.off("console", onConsole as never);
    page.off("requestfailed", onRequestFailed as never);

    results.push({
      label: ep.label,
      endpoint: ep.endpoint,
      param,
      sample,
      upstreamUrl,
      upstreamStatus,
      upstreamMs,
      upstreamOk,
      responsePreview,
      uiError: uiError?.trim() || null,
      uiShowedResult,
      consoleErrors,
      failedRequests,
      notes: [],
    });
  }

  fs.writeFileSync(REPORT_FILE, JSON.stringify(results, null, 2));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "portal-final.png"), fullPage: true });

  // Print a compact summary to stdout for the runner.
  const summary = results.map((r) => ({
    label: r.label,
    endpoint: r.endpoint,
    param: r.param,
    sample: r.sample,
    upstreamStatus: r.upstreamStatus,
    upstreamMs: r.upstreamMs,
    upstreamOk: r.upstreamOk,
    uiShowedResult: r.uiShowedResult,
    uiError: r.uiError,
    consoleErrorCount: r.consoleErrors.length,
    failedRequestCount: r.failedRequests.length,
    preview: r.responsePreview?.replace(/\s+/g, " ").slice(0, 160),
  }));
  // eslint-disable-next-line no-console
  console.log("\n===PORTAL_ENDPOINTS===\n" + JSON.stringify(summary, null, 2) + "\n===END_PORTAL_ENDPOINTS===\n");

  expect(results.length).toBeGreaterThan(0);
});

// Also check Logout works.
test("portal: logout clears session and redirects to /", async ({ page }) => {
  await login(page);
  const logoutBtn = page.getByRole("button", { name: /log\s*out/i }).first();
  await logoutBtn.click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });
  const stored = await page.evaluate(() => localStorage.getItem("cfms_key"));
  expect(stored).toBeNull();
});

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

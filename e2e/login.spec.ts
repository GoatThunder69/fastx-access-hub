import { test, expect, ConsoleMessage, Request, Response } from "@playwright/test";

const KEY = "ak_2fPzdkaBURJXIdg3oI08L4Z7";

test("login with provided access key", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failed: { url: string; status: number | null; method: string; failure?: string }[] = [];
  const apiCalls: { url: string; status: number; method: string }[] = [];

  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`));
  page.on("requestfailed", (r: Request) =>
    failed.push({ url: r.url(), status: null, method: r.method(), failure: r.failure()?.errorText })
  );
  page.on("response", (r: Response) => {
    const u = r.url();
    if (u.includes("supabase.co") || u.includes("ipapi.co")) {
      apiCalls.push({ url: u, status: r.status(), method: r.request().method() });
    }
    if (r.status() >= 400) failed.push({ url: u, status: r.status(), method: r.request().method() });
  });

  await page.goto("/", { waitUntil: "networkidle" });

  const input = page.locator('input[type="password"]');
  await expect(input).toBeVisible();
  await input.fill(KEY);

  // Click the "Access Portal" button.
  const accessBtn = page.getByRole("button", { name: /access portal/i });
  await accessBtn.click();

  // Wait for either navigation away from "/" or an error message.
  const errorLocator = page.locator("text=/invalid|expired|connection error/i").first();
  const result = await Promise.race([
    page
      .waitForURL((url) => !url.pathname.endsWith("/") || url.pathname !== "/", { timeout: 15_000 })
      .then(() => "navigated" as const)
      .catch(() => "no-nav" as const),
    errorLocator
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => "error" as const)
      .catch(() => "no-error" as const),
  ]);

  // Give any post-login fetches a beat.
  await page.waitForTimeout(1500);

  const finalUrl = page.url();
  const storage = await page.evaluate(() => ({
    cfms_key: localStorage.getItem("cfms_key"),
    cfms_key_name: localStorage.getItem("cfms_key_name"),
    cfms_key_id: localStorage.getItem("cfms_key_id"),
  }));
  const visibleError = await errorLocator.textContent().catch(() => null);
  const title = await page.title();
  const h1 = await page.locator("h1").first().textContent().catch(() => null);
  const bodyText = (await page.locator("body").textContent().catch(() => "")) || "";

  // Take a screenshot for visual confirmation.
  await page.screenshot({ path: "e2e-artifacts/login-result.png", fullPage: true });

  // Print a structured summary so the runner can read it from stdout.
  // eslint-disable-next-line no-console
  console.log(
    "\n===LOGIN_RESULT===\n" +
      JSON.stringify(
        {
          outcome: result,
          finalUrl,
          title,
          h1,
          visibleError,
          storage,
          consoleErrors,
          pageErrors,
          failed,
          apiCalls,
          bodyPreview: bodyText.replace(/\s+/g, " ").slice(0, 400),
        },
        null,
        2
      ) +
      "\n===END_LOGIN_RESULT===\n"
  );

  // Soft assertions so the report always prints.
  expect.soft(pageErrors, "no uncaught page errors").toEqual([]);
});

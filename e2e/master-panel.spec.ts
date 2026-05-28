
/**
 * Master Panel audit — every part that doesn't require an active Google OAuth
 * session. We can't actually log in, so for the authenticated views we hit
 * the Supabase REST API directly with the anon JWT and prove that the RLS
 * lockdown rejects every write/read attempt.
 *
 * Coverage matrix:
 *   1. /master-login renders the login UI
 *   2. /master without a session is gated (no panel data leaks)
 *   3. Public broadcast & panel lookup RPCs work from anon
 *   4. Direct REST reads on the 5 locked tables return 401/403/permission denied
 *   5. Direct REST writes return permission denied
 *   6. Admin RPCs reject calls with the wrong password
 *   7. Sub-admin RPCs reject calls with the wrong password
 *   8. SPA route never throws a runtime / pageerror
 */

import { test, expect, request as pwRequest } from "@playwright/test";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../src/lib/supabase";

const SUPABASE_ANON = SUPABASE_ANON_KEY;

const LOCKED_TABLES = ["api_keys", "api_logs", "managed_panels", "broadcasts", "master_admins"];

test.describe("Master Panel — UI gating", () => {
  test("/master-login renders the master login page", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`));

    const resp = await page.goto("/master-login", { waitUntil: "networkidle" });
    expect(resp?.status() ?? 0).toBeLessThan(400);

    // Page should mount and offer some way to authenticate
    await expect(page.locator("#root")).not.toBeEmpty();
    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    expect(bodyText).toMatch(/master|login|sign/);

    expect(pageErrors).toEqual([]);
  });

  test("/master without auth does not leak panel data", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`));

    await page.goto("/master", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // Should not render the full master dashboard — the panel list table, broadcast
    // composer, etc. require a signed-in master admin. We can't assert "redirect"
    // because the SPA may render an inline gate; instead, confirm no master_admins
    // / panels payload was ever fetched successfully.
    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    // panel names should NOT appear here without auth
    expect(bodyText).not.toMatch(/master_license_key|panel_password/);

    expect(pageErrors, "no uncaught errors").toEqual([]);
  });
});

test.describe("Public RPCs — anon should succeed", () => {
  test("get_latest_broadcast works for anon", async () => {
    const ctx = await pwRequest.newContext({ baseURL: SUPABASE_URL });
    const res = await ctx.post("/rest/v1/rpc/get_latest_broadcast", {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
      data: { p_panel_id: null },
    });
    expect(res.status(), `unexpected status ${res.status()}`).toBeLessThan(400);
    await ctx.dispose();
  });

  test("get_panel_by_slug returns safe fields only", async () => {
    const ctx = await pwRequest.newContext({ baseURL: SUPABASE_URL });
    const res = await ctx.post("/rest/v1/rpc/get_panel_by_slug", {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
      data: { p_slug: "test" },
    });
    expect(res.status()).toBeLessThan(400);
    const body = await res.text();
    expect(body, "panel_password must not be in the response").not.toMatch(/panel_password/);
    expect(body, "master_license_key must not be in the response").not.toMatch(/master_license_key/);
    await ctx.dispose();
  });
});

test.describe("RLS lockdown — direct anon reads must fail", () => {
  for (const tbl of LOCKED_TABLES) {
    test(`SELECT ${tbl} as anon is rejected`, async () => {
      const ctx = await pwRequest.newContext({ baseURL: SUPABASE_URL });
      const res = await ctx.get(`/rest/v1/${tbl}?select=*&limit=1`, {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
      });
      // 401/403 from PostgREST, OR 200 with [] if RLS allows-but-filters-out
      // (we want EITHER a denial OR an empty result — never a populated row)
      if (res.status() === 200) {
        const json = await res.json();
        expect(Array.isArray(json) && json.length, `${tbl} leaked rows to anon`).toBe(0);
      } else {
        expect(res.status()).toBeGreaterThanOrEqual(400);
        const txt = await res.text();
        expect(txt.toLowerCase()).toMatch(/permission|denied|jwt|rls/);
      }
      await ctx.dispose();
    });
  }
});

test.describe("RLS lockdown — direct anon writes must fail", () => {
  test("INSERT api_keys as anon is rejected", async () => {
    const ctx = await pwRequest.newContext({ baseURL: SUPABASE_URL });
    const res = await ctx.post("/rest/v1/api_keys", {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      data: { name: "pwn", key_value: "pwn-key" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    await ctx.dispose();
  });

  test("INSERT broadcasts as anon is rejected", async () => {
    const ctx = await pwRequest.newContext({ baseURL: SUPABASE_URL });
    const res = await ctx.post("/rest/v1/broadcasts", {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      data: { title: "pwn", message: "pwn" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    await ctx.dispose();
  });

  test("UPDATE managed_panels as anon is rejected", async () => {
    const ctx = await pwRequest.newContext({ baseURL: SUPABASE_URL });
    const res = await ctx.patch("/rest/v1/managed_panels?id=eq.00000000-0000-0000-0000-000000000000", {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      data: { is_active: false },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    await ctx.dispose();
  });
});

test.describe("Admin RPCs — must reject wrong password", () => {
  const WRONG = "obviously-wrong-password-zzz";

  const adminCases = [
    { rpc: "admin_list_keys", body: { p_password: WRONG } },
    { rpc: "admin_list_logs", body: { p_password: WRONG, p_limit: 10 } },
    { rpc: "admin_list_broadcasts", body: { p_password: WRONG } },
    {
      rpc: "admin_create_key",
      body: {
        p_password: WRONG,
        p_name: "x",
        p_key_value: "x",
        p_expires_at: null,
        p_allowed_ips: null,
        p_panel_id: null,
      },
    },
    {
      rpc: "admin_create_broadcast",
      body: { p_password: WRONG, p_title: "x", p_message: "x" },
    },
  ];

  for (const c of adminCases) {
    test(`${c.rpc} rejects wrong password`, async () => {
      const ctx = await pwRequest.newContext({ baseURL: SUPABASE_URL });
      const res = await ctx.post(`/rest/v1/rpc/${c.rpc}`, {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        data: c.body,
      });
      // The RPC should raise an exception (PostgREST returns 4xx) — anything <400
      // would mean it accepted the wrong password.
      expect(res.status(), `${c.rpc} accepted a bad password`).toBeGreaterThanOrEqual(400);
      await ctx.dispose();
    });
  }
});

test.describe("Sub-admin RPCs — must reject wrong password", () => {
  const WRONG = "obviously-wrong-password-zzz";
  const FAKE_PANEL = "00000000-0000-0000-0000-000000000000";

  const subCases = [
    { rpc: "panel_admin_list_keys", body: { p_panel_id: FAKE_PANEL, p_password: WRONG } },
    { rpc: "panel_admin_list_logs", body: { p_panel_id: FAKE_PANEL, p_password: WRONG, p_limit: 10 } },
    {
      rpc: "panel_admin_change_password",
      body: { p_panel_id: FAKE_PANEL, p_old_password: WRONG, p_new_password: "newpass" },
    },
  ];

  for (const c of subCases) {
    test(`${c.rpc} rejects wrong panel password`, async () => {
      const ctx = await pwRequest.newContext({ baseURL: SUPABASE_URL });
      const res = await ctx.post(`/rest/v1/rpc/${c.rpc}`, {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        data: c.body,
      });
      // Either a 4xx exception OR a 200 with `false`/empty (panel_admin_change_password
      // returns boolean false on a bad password). What's NOT acceptable: a populated row.
      if (res.status() === 200) {
        const body = await res.text();
        // boolean false, null, or empty array are all acceptable
        expect(body.trim(), `${c.rpc} returned data with bad password`).toMatch(/^(false|null|\[\])$/);
      } else {
        expect(res.status()).toBeGreaterThanOrEqual(400);
      }
      await ctx.dispose();
    });
  }
});

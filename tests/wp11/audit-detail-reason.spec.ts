/**
 * PRYSM-OBSERVABILITY-01 — audit-detail page displays persisted lifecycle reasons.
 *
 * Runs the REAL production transition path (mock adapters, real orchestrator +
 * lifecycle service + worker API + Next.js server components) and asserts the
 * Lifecycle History Reason column renders the exact persisted reason as plain
 * text — React JSX escaping is the display boundary, so no markup or
 * secret-like payload may be interpreted by the browser.
 */

import { test, expect } from "@playwright/test";

const NEXT_URL = `http://localhost:${parseInt(process.env.NEXT_PORT || "19400", 10)}`;

test.describe("PRYSM-OBSERVABILITY-01 — audit detail reason display", () => {
  test.setTimeout(120_000);

  async function loginMock(page: import("@playwright/test").Page, email: string) {
    const res = await page.request.post(`${NEXT_URL}/api/auth/login`, {
      data: { email, password: "test-pass" },
    });
    expect(res.status()).toBe(200);
  }

  test("REASON-DISPLAY-01: lifecycle reasons render on the audit detail page", async ({ page }) => {
    // 1. Sign in as the seeded reviewer (mock identity → real principal).
    await loginMock(page, "draft-review@test.example.com");

    // 2. Create a real audit through the governed same-origin API.
    const createRes = await page.request.post(`${NEXT_URL}/api/audits`, {
      data: {
        targetUrl: "https://reason-display-test.com",
        businessName: "Reason Display Test Inc.",
        market: "Toronto, Ontario, Canada",
        language: "en-CA",
        primaryGoal: "conversion",
        services: ["Consulting"],
      },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    const auditId = String(created.auditId || "");
    expect(auditId).toMatch(/^[a-f0-9-]{36}$/);

    // 3. Establish the reviewer session for the report role gate.
    const sessionRes = await page.request.post(`${NEXT_URL}/api/reviewer-session`, {
      headers: { "x-vantage-secret": "test-secret" },
    });
    expect(sessionRes.status()).toBe(200);

    // 4. Open the audit detail page.
    await page.goto(`${NEXT_URL}/audits/${auditId}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Lifecycle History" })).toBeVisible({ timeout: 30_000 });

    // 5. The Reason column must display a real governed transition reason
    //    persisted by the production orchestrator (not "—" for every row).
    const reasonCell = page.getByText("governed-scoring-complete", { exact: true });
    await expect(reasonCell).toBeVisible({ timeout: 15_000 });

    // 6. Display boundary: reasons render as literal text — no elements are
    //    created from reason content (React JSX auto-escaping).
    const lifecycleTable = page.locator("table").first();
    await expect(lifecycleTable).toBeVisible();
    expect(await lifecycleTable.locator("script").count()).toBe(0);
    expect(await lifecycleTable.locator("*:has-text('governed-scoring-complete')").last().evaluate((el) => el.children.length)).toBe(0);
  });
});

import { test, expect, type Page } from "@playwright/test";

// PRYSM-NEXT-ACTIVATION — production activation boundary E2E.
// Exercises the SAME production-facing web boundary the deployed app uses:
//   A. report design v2 selection → UI payload → worker createAudit →
//      persisted request → detail display
//   B. authenticated session principal reaches the draft report link
//      (no reviewer-cookie dependency)
//   D. authenticated navigation exposes the admin console entry point

const NEXT_URL = process.env.NEXT_PUBLIC_URL || "http://127.0.0.1:19400";

async function login(page: Page, email: string) {
  await page.request.post(`${NEXT_URL}/api/auth/login`, {
    data: { email, password: "anything" },
  });
}

test("ACT-A-01: v2 report selection survives the production creation boundary", async ({ page }) => {
  await login(page, "flow@test.example.com");
  await page.goto(`${NEXT_URL}/audits/new`);

  await expect(page.locator("label[for=reportDesignVersion]")).toBeVisible();
  // v1 is the default.
  await expect(page.locator("#reportDesignVersion")).toHaveValue("1.0.0");

  await page.fill("#targetUrl", "https://activation-v2.example.com");
  await page.fill("#businessName", "Activation V2 Co");
  await page.selectOption("#reportDesignVersion", "2.0.0");
  await page.click('form button[type="submit"]');

  await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Activation V2 Co" })).toBeVisible();
  // The persisted governed request carries the design version.
  await expect(page.getByText(/Report design: 2\.0\.0/)).toBeVisible();
  console.log("  [x] ACT-A-01: v2 selection → persisted request → detail display");
});

test("ACT-A-02: default intake keeps v1 as the report design", async ({ page }) => {
  await login(page, "flow@test.example.com");
  await page.goto(`${NEXT_URL}/audits/new`);

  await page.fill("#targetUrl", "https://activation-v1.example.com");
  await page.fill("#businessName", "Activation V1 Co");
  await page.click('form button[type="submit"]');

  await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Activation V1 Co" })).toBeVisible();
  await expect(page.getByText(/Report design: 2\.0\.0/)).toHaveCount(0);
  console.log("  [x] ACT-A-02: default intake stays v1");
});

test("ACT-B-01: authenticated reviewer reaches the draft report link without a reviewer cookie", async ({ page }) => {
  // flow@test.example.com is a reviewer on playwright-tenant; the WP11
  // flow drives its audit to draft_rendered.
  await login(page, "flow@test.example.com");
  await page.goto(`${NEXT_URL}/audits/new`);
  await page.fill("#targetUrl", "https://draft-link.example.com");
  await page.fill("#businessName", "Draft Link Co");
  await page.click('form button[type="submit"]');
  await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/);

  // The mock worker drives to DRAFT_RENDERED; the detail page must expose
  // the draft report link for the authenticated principal.
  await expect(page.getByRole("link", { name: "View Draft Report" })).toBeVisible();
  console.log("  [x] ACT-B-01: authenticated principal sees the draft report link");
});

test("ACT-D-01: authenticated navigation exposes the admin entry point; denial is server-side", async ({ page }) => {
  await login(page, "flow@test.example.com");
  await page.goto(`${NEXT_URL}/`);
  const adminLink = page.locator('nav a[href="/admin"]');
  await expect(adminLink).toBeVisible();
  // Non-platform-admin still gets the governed denial state (server-side).
  await adminLink.click();
  await expect(page.getByText("Platform admin required")).toBeVisible();
  console.log("  [x] ACT-D-01: admin reachable through normal navigation; non-admin denied server-side");
});

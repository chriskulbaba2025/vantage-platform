import { test, expect, type Page } from "@playwright/test";

// PRYSM-NEXT-01 WP-H — business-context intake E2E.
// The intake form collects services + primary conversion goal + market and
// the audit is created with that context through the REAL web routes and
// REAL worker boundary (mock identity below the provider boundary).

const NEXT_URL = process.env.NEXT_PUBLIC_URL || "http://127.0.0.1:19400";

async function login(page: Page, email: string) {
  await page.request.post(`${NEXT_URL}/api/auth/login`, {
    data: { email, password: "anything" },
  });
}

test("WP-H-INTAKE-01: business-context intake creates an audit with services and goal", async ({ page }) => {
  await login(page, "flow@test.example.com");
  await page.goto(`${NEXT_URL}/audits/new`);

  await expect(page.getByText("New Website Audit")).toBeVisible();

  // Business-context fields are present and labelled.
  await expect(page.locator("label[for=services]")).toBeVisible();
  await expect(page.locator("label[for=primaryGoal]")).toBeVisible();
  await expect(page.locator("label[for=market]")).toBeVisible();

  await page.fill("#targetUrl", "https://context-intake-test.example.com");
  // Business name auto-derives; make it explicit for the assertion.
  await page.fill("#businessName", "Context Intake Co");
  await page.fill("#services", "Consulting, Executive Coaching, Workshops");
  await page.selectOption("#primaryGoal", "Book appointments or consultations");
  await page.fill("#market", "Toronto, Ontario");
  await page.click('form button[type="submit"]');

  // Redirected to the audit detail page — the heading comes from the
  // persisted governed AuditRequest (business name flowed through the
  // REAL worker collection boundary).
  await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Context Intake Co" })).toBeVisible();
  // The business context is displayed from the persisted request.
  await expect(page.getByText(/Consulting, Executive Coaching, Workshops/)).toBeVisible();
  await expect(page.getByText(/Book appointments or consultations/)).toBeVisible();
  await expect(page.getByText(/Toronto, Ontario/)).toBeVisible();
  console.log("  [x] WP-H-INTAKE-01: business-context intake → audit created with context");
});

test("WP-H-INTAKE-02: invalid intake input is rejected with an error (no audit created)", async ({ page }) => {
  await login(page, "flow@test.example.com");
  await page.goto(`${NEXT_URL}/audits/new`);

  await page.fill("#targetUrl", "not a url");
  await page.fill("#businessName", "");
  await page.fill("#services", "Too long service, ".repeat(10) + "x");
  await page.click('form button[type="submit"]');

  await expect(page.locator(".form-error").first()).toBeVisible();
  // Still on the intake page (no redirect happened).
  expect(new URL(page.url()).pathname).toBe("/audits/new");
  console.log("  [x] WP-H-INTAKE-02: invalid intake rejected");
});

test("WP-H-INTAKE-03: accessibility basics — labels and required hints on intake", async ({ page }) => {
  await login(page, "flow@test.example.com");
  await page.goto(`${NEXT_URL}/audits/new`);

  // Every input/select has an associated label OR aria-label.
  const controls = page.locator("input, select");
  const count = await controls.count();
  for (let i = 0; i < count; i++) {
    const id = await controls.nth(i).getAttribute("id");
    const aria = await controls.nth(i).getAttribute("aria-label");
    const labelled = id
      ? (await page.locator(`label[for="${id}"]`).count()) > 0
      : false;
    expect(labelled || Boolean(aria), `control #${id || "(no id)"} is labelled`).toBeTruthy();
  }
  console.log("  [x] WP-H-INTAKE-03: intake controls labelled");
});

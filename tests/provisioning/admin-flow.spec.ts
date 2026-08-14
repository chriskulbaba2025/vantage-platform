import { test, expect, type Page } from "@playwright/test";

/**
 * ACCT-PROVISION-01 E2E — the full provisioning cycle through the REAL
 * web routes + REAL worker boundary (mock identity BELOW the provider
 * boundary, mock-mode challenge):
 *
 *   non-admin denied → platform admin creates company → invites user
 *   (reviewer) → invited user signs in with the temporary password and
 *   establishes their OWN password through the challenge UI → the new
 *   user is denied admin access → admin disables the membership →
 *   membership list reflects disabled.
 */

const NEXT_URL = process.env.NEXT_PUBLIC_URL || "http://127.0.0.1:19400";

async function login(page: Page, email: string, password: string) {
  const res = await page.request.post(`${NEXT_URL}/api/auth/login`, {
    data: { email, password },
  });
  expect([200, 401]).toContain(res.status());
  return res;
}

async function loginViaUi(page: Page, email: string, password: string) {
  await page.goto(`${NEXT_URL}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
}

test("PROV-01: non-admin is denied the admin console", async ({ page }) => {
  await login(page, "flow@test.example.com", "anything");
  await page.goto(`${NEXT_URL}/admin`);
  await expect(page.getByText("Platform admin required")).toBeVisible();
  console.log("  [x] PROV-01: non-admin denied the admin console");
});

test("PROV-02: platform admin creates a company through the UI", async ({ page }) => {
  await login(page, "admin@test.example.com", "anything");
  await page.goto(`${NEXT_URL}/admin`);
  await expect(page.getByText("Platform administration")).toBeVisible();

  const companyName = `Acme E2E ${Date.now()}`;
  await page.fill("#companyName", companyName);
  await page.click('form:has(#companyName) button[type="submit"]');
  await expect(page.getByText(/Company created:/)).toBeVisible();
  console.log("  [x] PROV-02: company created through the UI");
});

test("PROV-03: admin invites a user with a role; invitee establishes their own password", async ({ page }) => {
  // Admin invites.
  await login(page, "admin@test.example.com", "anything");
  await page.goto(`${NEXT_URL}/admin`);
  const companyId = await page.evaluate(async () => {
    const res = await fetch("/api/admin/tenants");
    const data = await res.json();
    return data.find((t: { name: string }) => t.name.startsWith("Acme E2E"))?.id || "";
  });
  expect(companyId.length).toBeGreaterThan(0);

  const inviteEmail = `newuser-${Date.now()}@test.example.com`;
  await page.fill("#inviteEmail", inviteEmail);
  await page.selectOption("#inviteTenant", companyId);
  await page.selectOption("#inviteRole", "reviewer");
  await page.click('form:has(#inviteEmail) button[type="submit"]');
  await expect(page.getByText(/Invited .* as reviewer/)).toBeVisible();
  console.log("  [x] PROV-03: invite issued through the UI");

  // Invitee signs in with the temporary password → challenge UI.
  await page.goto(`${NEXT_URL}/login`);
  await page.fill("#email", inviteEmail);
  await page.fill("#password", "temp-invite-password");
  await page.click('button[type="submit"]');
  await expect(page.getByText("Set your password")).toBeVisible();
  await page.fill("#newPassword", "MyOwnPassword-42");
  await page.fill("#confirmPassword", "MyOwnPassword-42");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  console.log("  [x] PROV-03: invitee established their own password through the challenge flow");

  // Invitee is NOT an admin.
  await page.goto(`${NEXT_URL}/admin`);
  await expect(page.getByText("Platform admin required")).toBeVisible();
  console.log("  [x] PROV-03: invitee denied the admin console");
});

test("PROV-04: admin disables the membership; list reflects it", async ({ page }) => {
  await login(page, "admin@test.example.com", "anything");
  await page.goto(`${NEXT_URL}/admin`);
  const companyId = await page.evaluate(async () => {
    const res = await fetch("/api/admin/tenants");
    const data = await res.json();
    return data.find((t: { name: string }) => t.name.startsWith("Acme E2E"))?.id || "";
  });
  await page.selectOption("#membersTenant", companyId);
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const firstRowEmail = await page.locator("tbody tr").first().locator("td").first().textContent();
  expect(firstRowEmail).toBeTruthy();
  await page.locator("tbody tr").first().getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText(/Membership disabled for/)).toBeVisible();
  await expect(page.locator("tbody tr").first().locator("td").nth(2)).toContainText("disabled");
  console.log("  [x] PROV-04: membership disabled through the UI");
});

/**
 * Prysm Identity — canonical multi-tenant identity model.
 *
 *   tenants            — tenant records (id = the tenant_id used by lifecycle
 *                        and artifact keys)
 *   users              — application users keyed by stable Cognito sub
 *   tenant_memberships — role-bearing memberships (platform_admin,
 *                        tenant_admin, reviewer, viewer)
 *
 * Roles:
 *   platform_admin — explicit cross-tenant administrative access
 *   tenant_admin   — assigned tenant only
 *   reviewer       — tenant-scoped draft + approved report access
 *   viewer         — tenant-scoped approved/published report access only
 *
 * @module identity/identity-model
 */

export const ROLES = Object.freeze({
  PLATFORM_ADMIN: "platform_admin",
  TENANT_ADMIN: "tenant_admin",
  REVIEWER: "reviewer",
  VIEWER: "viewer",
});

export const ACTIVE_STATUS = "active";

/** A tenant row shape shared by both repository variants. */
export function validateTenant(row) {
  if (!row || typeof row.id !== "string" || row.id.length === 0) {
    throw new Error("tenant row invalid: missing id");
  }
  return row;
}

/** A user row shape shared by both repository variants. */
export function validateUser(row) {
  if (!row || typeof row.cognito_sub !== "string" || row.cognito_sub.length === 0) {
    throw new Error("user row invalid: missing cognito_sub");
  }
  return row;
}

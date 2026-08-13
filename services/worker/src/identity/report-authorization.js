/**
 * Report access authorization — role gates applied BEFORE artifact
 * retrieval.  No report bytes may be returned before authorization
 * succeeds.
 *
 *   viewer        → own tenant approved/published only
 *   reviewer      → own tenant draft_rendered/in_review/approved/published
 *   tenant_admin  → own tenant reports per administrative permissions
 *   platform_admin→ explicit governed cross-tenant access
 *   anonymous     → no private tenant reports
 *
 * Cross-tenant access always fails closed (non-disclosing 404).
 *
 * @module identity/report-authorization
 */

import { canAccessTenant } from "./authorization.js";
import { ROLES } from "./identity-model.js";

export const REPORT_READABLE_STATES = Object.freeze({
  public: new Set(["approved", "published"]),
  reviewer: new Set(["draft_rendered", "in_review", "approved", "published"]),
});

/**
 * Effective role of the authenticated principal within the given tenant.
 * platform_admin always applies.
 */
export function effectiveTenantRole(auth, tenantId) {
  if (!auth.authenticated) return null;
  if (auth.isPlatformAdmin) return ROLES.PLATFORM_ADMIN;
  const membership = auth.memberships.find((m) => m.tenant_id === tenantId);
  return membership?.role || null;
}

/**
 * Can the authenticated principal read a report in the given lifecycle
 * state for the given tenant?
 */
export function canAccessReportState(auth, tenantId, state) {
  if (!canAccessTenant(auth, tenantId)) return false;
  if (REPORT_READABLE_STATES.public.has(state)) return true;
  if (!REPORT_READABLE_STATES.reviewer.has(state)) return false;
  const role = effectiveTenantRole(auth, tenantId);
  return role === ROLES.REVIEWER || role === ROLES.TENANT_ADMIN || role === ROLES.PLATFORM_ADMIN;
}

/**
 * Resolve the authorization result for a report request:
 *
 *   { allowed: true, tenantId }   — authorized; use the AUDIT's tenant
 *   { allowed: false, status, code, reason }
 */
export function authorizeReportAccess({ auth, auditTenant, state }) {
  if (!auth.authenticated) {
    return { allowed: false, status: 401, code: "UNAUTHENTICATED", reason: "authentication required" };
  }
  if (!auditTenant) {
    // Non-disclosing for unknown audits — same as cross-tenant.
    return { allowed: false, status: 404, code: "NOT_FOUND", reason: "audit not found" };
  }
  if (!canAccessTenant(auth, auditTenant)) {
    return { allowed: false, status: 404, code: "NOT_FOUND", reason: "cross-tenant access denied" };
  }
  if (!canAccessReportState(auth, auditTenant, state)) {
    return { allowed: false, status: 403, code: "REPORT_NOT_APPROVED", reason: `role does not permit ${state} reports` };
  }
  return { allowed: true, tenantId: auditTenant };
}

export default { authorizeReportAccess, canAccessReportState, effectiveTenantRole };

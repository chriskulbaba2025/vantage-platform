/**
 * PRYSM Narrative v2 — governed Writer business context.
 *
 * Values are copied from the persisted AuditRequest without reconstruction,
 * renaming, or defaults. Missing optional context stays missing; it is never
 * silently replaced with an empty string, a default market, or a default
 * language.
 */

export const WRITER_BUSINESS_CONTEXT_FIELDS = Object.freeze([
  "businessName",
  "targetUrl",
  "primaryGoal",
  "market",
  "language",
  "services",
  "competitors",
]);

function cloneValue(value) {
  if (Array.isArray(value)) return value.map((item) => item);
  return value;
}

export function buildWriterBusinessContext(auditRequest) {
  if (!auditRequest || typeof auditRequest !== "object") {
    throw new Error("auditRequest is required");
  }
  if (!Object.hasOwn(auditRequest, "targetUrl") || typeof auditRequest.targetUrl !== "string" || auditRequest.targetUrl.length === 0) {
    throw new Error("auditRequest.targetUrl is required");
  }

  const context = {};
  for (const field of WRITER_BUSINESS_CONTEXT_FIELDS) {
    if (!Object.hasOwn(auditRequest, field)) continue;
    if (auditRequest[field] === undefined) continue;
    context[field] = cloneValue(auditRequest[field]);
  }

  return Object.freeze(context);
}

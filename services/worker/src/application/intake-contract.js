/**
 * Validate the business context required to create a new governed audit.
 * Recovery paths deliberately do not call this helper: persisted requests are
 * loaded verbatim and must remain recoverable even when created under an older
 * contract.
 */
export function validateNewAuditIntake(input = {}) {
  const errors = [];
  if (!String(input.market || "").trim()) {
    errors.push({ field: "market", message: "Market or location is required." });
  }
  if (!String(input.primaryGoal || "").trim()) {
    errors.push({ field: "primaryGoal", message: "Primary conversion goal is required." });
  }
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 256)) {
    errors.push({ field: "idempotencyKey", message: "Idempotency key must be 8 to 256 characters when supplied." });
  }
  const services = Array.isArray(input.services)
    ? input.services.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (services.length === 0) {
    errors.push({ field: "services", message: "At least one service or offer is required." });
  }
  if (errors.length > 0) {
    const error = new Error("Audit intake is missing required business context");
    error.statusCode = 422;
    error.code = "INTAKE_REQUIRED_CONTEXT";
    error.errors = errors;
    throw error;
  }
  return {
    ...input,
    market: String(input.market || "").trim(),
    primaryGoal: String(input.primaryGoal || "").trim(),
    services,
    idempotencyKey: idempotencyKey || undefined,
  };
}

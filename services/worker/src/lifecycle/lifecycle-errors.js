/**
 * Lifecycle Errors — Structured failure propagation.
 * @module lifecycle/lifecycle-errors
 */

export const LIFECYCLE_ERROR_CODE = Object.freeze({
  AUDIT_NOT_FOUND:        "ERR_LIFECYCLE_AUDIT_NOT_FOUND",
  DUPLICATE_AUDIT:        "ERR_LIFECYCLE_DUPLICATE_AUDIT",
  INVALID_TRANSITION:     "ERR_LIFECYCLE_INVALID_TRANSITION",
  CONCURRENCY_CONFLICT:   "ERR_LIFECYCLE_CONCURRENCY_CONFLICT",
  INVALID_INPUT:          "ERR_LIFECYCLE_INVALID_INPUT",
  REPOSITORY_FAILURE:     "ERR_LIFECYCLE_REPOSITORY_FAILURE",
  TRANSITION_IDEMPOTENCY_CONFLICT: "ERR_LIFECYCLE_TRANSITION_IDEMPOTENCY_CONFLICT",
  TENANT_ISOLATION:       "ERR_LIFECYCLE_TENANT_ISOLATION",
});

export class LifecycleError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
    this.detail = detail;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class AuditNotFoundError extends LifecycleError {
  constructor(auditId, detail = {}) {
    super(LIFECYCLE_ERROR_CODE.AUDIT_NOT_FOUND, `Audit not found: "${auditId}"`, { auditId, ...detail });
    this.name = "AuditNotFoundError";
  }
}

export class DuplicateAuditError extends LifecycleError {
  constructor(detail = {}) {
    super(LIFECYCLE_ERROR_CODE.DUPLICATE_AUDIT, "Duplicate audit creation", detail);
    this.name = "DuplicateAuditError";
  }
}

export class InvalidTransitionError extends LifecycleError {
  constructor(auditId, fromState, toState, detail = {}) {
    super(LIFECYCLE_ERROR_CODE.INVALID_TRANSITION,
      `Invalid lifecycle transition: "${fromState}" → "${toState}" for audit "${auditId}"`,
      { auditId, fromState, toState, ...detail });
    this.name = "InvalidTransitionError";
  }
}

export class ConcurrencyConflictError extends LifecycleError {
  constructor(auditId, detail = {}) {
    super(LIFECYCLE_ERROR_CODE.CONCURRENCY_CONFLICT,
      `Concurrency conflict for audit "${auditId}"`,
      { auditId, ...detail });
    this.name = "ConcurrencyConflictError";
  }
}

export class InvalidLifecycleInputError extends LifecycleError {
  constructor(message, detail = {}) {
    super(LIFECYCLE_ERROR_CODE.INVALID_INPUT, message, detail);
    this.name = "InvalidLifecycleInputError";
  }
}

export class RepositoryFailureError extends LifecycleError {
  constructor(message, detail = {}) {
    super(LIFECYCLE_ERROR_CODE.REPOSITORY_FAILURE, message, detail);
    this.name = "RepositoryFailureError";
  }
}

export class TransitionIdempotencyConflictError extends LifecycleError {
  constructor(auditId, transitionKey, detail = {}) {
    super(LIFECYCLE_ERROR_CODE.TRANSITION_IDEMPOTENCY_CONFLICT,
      `Transition idempotency conflict for audit "${auditId}" with key "${transitionKey}"`,
      { auditId, transitionIdempotencyKey: transitionKey, ...detail });
    this.name = "TransitionIdempotencyConflictError";
  }
}

export class TenantIsolationError extends LifecycleError {
  constructor(detail = {}) {
    super(LIFECYCLE_ERROR_CODE.TENANT_ISOLATION, "Tenant isolation violation", detail);
    this.name = "TenantIsolationError";
  }
}

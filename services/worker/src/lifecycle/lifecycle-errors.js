/**
 * Lifecycle Errors — Structured failure propagation for state machine operations.
 *
 * Every lifecycle error has a stable `code` for programmatic handling.
 *
 * @module lifecycle/lifecycle-errors
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const LIFECYCLE_ERROR_CODE = Object.freeze({
  AUDIT_NOT_FOUND:        "ERR_LIFECYCLE_AUDIT_NOT_FOUND",
  DUPLICATE_AUDIT:        "ERR_LIFECYCLE_DUPLICATE_AUDIT",
  INVALID_TRANSITION:     "ERR_LIFECYCLE_INVALID_TRANSITION",
  CONCURRENCY_CONFLICT:   "ERR_LIFECYCLE_CONCURRENCY_CONFLICT",
  INVALID_INPUT:          "ERR_LIFECYCLE_INVALID_INPUT",
  REPOSITORY_FAILURE:     "ERR_LIFECYCLE_REPOSITORY_FAILURE",
});

// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

export class LifecycleError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
    this.detail = detail;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class AuditNotFoundError extends LifecycleError {
  constructor(auditId, detail = {}) {
    super(LIFECYCLE_ERROR_CODE.AUDIT_NOT_FOUND, `Audit not found: "${auditId}"`, { auditId, ...detail });
    this.name = "AuditNotFoundError";
  }
}

export class DuplicateAuditError extends LifecycleError {
  constructor(auditId, idempotencyKey, detail = {}) {
    super(
      LIFECYCLE_ERROR_CODE.DUPLICATE_AUDIT,
      `Duplicate audit creation: idempotencyKey "${idempotencyKey}" already used for a different auditId`,
      { auditId, idempotencyKey, ...detail },
    );
    this.name = "DuplicateAuditError";
  }
}

export class InvalidTransitionError extends LifecycleError {
  constructor(auditId, fromState, toState, detail = {}) {
    super(
      LIFECYCLE_ERROR_CODE.INVALID_TRANSITION,
      `Invalid lifecycle transition: "${fromState}" → "${toState}" for audit "${auditId}"`,
      { auditId, fromState, toState, ...detail },
    );
    this.name = "InvalidTransitionError";
  }
}

export class ConcurrencyConflictError extends LifecycleError {
  constructor(auditId, detail = {}) {
    super(
      LIFECYCLE_ERROR_CODE.CONCURRENCY_CONFLICT,
      `Concurrency conflict for audit "${auditId}": expected state or version does not match`,
      { auditId, ...detail },
    );
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

/**
 * Artifact Store — Structured Failure Propagation
 *
 * Every store operation surfaces failures through typed error classes.
 * Callers can distinguish error categories by `code` without parsing
 * message strings.
 *
 * Zero provider calls. Zero LLM calls. Zero cloud calls.
 *
 * @module artifact-errors
 */

// ---------------------------------------------------------------------------
// Error codes (stable enum)
// ---------------------------------------------------------------------------

export const ARTIFACT_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "ERR_ARTIFACT_INVALID_INPUT",
  INVALID_SCOPE: "ERR_ARTIFACT_INVALID_SCOPE",
  PATH_TRAVERSAL: "ERR_ARTIFACT_PATH_TRAVERSAL",
  WRITE_FAILURE: "ERR_ARTIFACT_WRITE_FAILURE",
  READ_BACK_FAILURE: "ERR_ARTIFACT_READ_BACK_FAILURE",
  BYTE_MISMATCH: "ERR_ARTIFACT_BYTE_MISMATCH",
  SHA_MISMATCH: "ERR_ARTIFACT_SHA_MISMATCH",
  IMMUTABLE_CONFLICT: "ERR_ARTIFACT_IMMUTABLE_CONFLICT",
  OBJECT_NOT_FOUND: "ERR_ARTIFACT_OBJECT_NOT_FOUND",
  PROVIDER_FAILURE: "ERR_ARTIFACT_PROVIDER_FAILURE",
  SCHEMA_VALIDATION: "ERR_ARTIFACT_SCHEMA_VALIDATION",
});

// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

/**
 * Base class for all artifact-store errors.
 *
 * @extends Error
 */
export class ArtifactStoreError extends Error {
  /**
   * @param {string} code    - One of {@link ARTIFACT_ERROR_CODES}.
   * @param {string} message - Human-readable description.
   * @param {object} [detail] - Optional structured detail (never contains secrets).
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "ArtifactStoreError";
    this.code = code;
    this.detail = detail;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class InvalidInputError extends ArtifactStoreError {
  constructor(message, detail) {
    super(ARTIFACT_ERROR_CODES.INVALID_INPUT, message, detail);
    this.name = "InvalidInputError";
  }
}

export class InvalidScopeError extends ArtifactStoreError {
  constructor(message, detail) {
    super(ARTIFACT_ERROR_CODES.INVALID_SCOPE, message, detail);
    this.name = "InvalidScopeError";
  }
}

export class PathTraversalError extends ArtifactStoreError {
  constructor(message, detail) {
    super(ARTIFACT_ERROR_CODES.PATH_TRAVERSAL, message, detail);
    this.name = "PathTraversalError";
  }
}

export class WriteFailureError extends ArtifactStoreError {
  constructor(message, detail) {
    super(ARTIFACT_ERROR_CODES.WRITE_FAILURE, message, detail);
    this.name = "WriteFailureError";
  }
}

export class ReadBackFailureError extends ArtifactStoreError {
  constructor(message, detail) {
    super(ARTIFACT_ERROR_CODES.READ_BACK_FAILURE, message, detail);
    this.name = "ReadBackFailureError";
  }
}

export class ByteMismatchError extends ArtifactStoreError {
  constructor(message, detail) {
    super(ARTIFACT_ERROR_CODES.BYTE_MISMATCH, message, detail);
    this.name = "ByteMismatchError";
  }
}

export class ShaMismatchError extends ArtifactStoreError {
  constructor(message, detail) {
    super(ARTIFACT_ERROR_CODES.SHA_MISMATCH, message, detail);
    this.name = "ShaMismatchError";
  }
}

export class ImmutableConflictError extends ArtifactStoreError {
  constructor(message, detail) {
    super(ARTIFACT_ERROR_CODES.IMMUTABLE_CONFLICT, message, detail);
    this.name = "ImmutableConflictError";
  }
}

export class ObjectNotFoundError extends ArtifactStoreError {
  constructor(message, detail) {
    super(ARTIFACT_ERROR_CODES.OBJECT_NOT_FOUND, message, detail);
    this.name = "ObjectNotFoundError";
  }
}

export class ProviderFailureError extends ArtifactStoreError {
  constructor(message, detail) {
    super(ARTIFACT_ERROR_CODES.PROVIDER_FAILURE, message, detail);
    this.name = "ProviderFailureError";
  }
}

export class SchemaValidationError extends ArtifactStoreError {
  constructor(message, detail) {
    super(ARTIFACT_ERROR_CODES.SCHEMA_VALIDATION, message, detail);
    this.name = "SchemaValidationError";
  }
}

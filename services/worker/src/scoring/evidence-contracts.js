/**
 * V3 Canonical Source-Status and Evidence Contracts
 *
 * Single source of truth for all evidence status values, the source-status
 * record, and the provider-independent evidence envelope required by
 * Vantage Production PRD v3.0.
 *
 * Every evidence provider MUST use these canonical values and attach a
 * source-status record to its return shape.  Consumers MUST compare against
 * the SOURCE_STATUS enum — never raw strings.
 */

// ---------------------------------------------------------------------------
// Canonical seven-status vocabulary (PRD v3.0 §Evidence)
// ---------------------------------------------------------------------------

export const SOURCE_STATUS = Object.freeze({
  /** Full data collected; returnedRecordCount >= expectedRecordCount. */
  AVAILABLE:      "AVAILABLE",
  /** Some data collected; 0 < returnedRecordCount < expectedRecordCount. */
  PARTIAL:        "PARTIAL",
  /** Collection attempted but zero usable records returned. */
  FAILED:         "FAILED",
  /** Provider not configured (no credentials / API key / property ID). */
  NOT_CONNECTED:  "NOT_CONNECTED",
  /** Provider connected but no record exists for this resource. */
  UNAVAILABLE:    "UNAVAILABLE",
  /**
   * Target resource access is restricted by robots.txt, authentication
   * walls, consent gates, or similar access controls.  This is NOT used
   * for provider rate-limiting (HTTP 429) — those are FAILED with
   * errorCategory "rate_limit".
   */
  BLOCKED:        "BLOCKED",
  /** Not relevant to this audit (e.g. no competitors supplied). */
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

// ---------------------------------------------------------------------------
// Error categories for the source-status record
// ---------------------------------------------------------------------------

export const ERROR_CATEGORY = Object.freeze({
  NONE:               null,
  RATE_LIMIT:         "rate_limit",
  AUTH:               "auth",
  NETWORK:            "network",
  TIMEOUT:            "timeout",
  INTERNAL:           "internal",
  NOT_CONFIGURED:     "not_configured",
  NO_DATA:            "no_data",
  SCHEMA_VALIDATION:  "schema_validation",
});

// ---------------------------------------------------------------------------
// Envelope version
// ---------------------------------------------------------------------------

export const EVIDENCE_ENVELOPE_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Legacy → V3 migration map
// ---------------------------------------------------------------------------

const LEGACY_TO_V3 = Object.freeze({
  complete:        SOURCE_STATUS.AVAILABLE,
  failed:          SOURCE_STATUS.FAILED,
  not_configured:  SOURCE_STATUS.NOT_CONNECTED,
  not_supplied:    SOURCE_STATUS.NOT_APPLICABLE,
  no_data:         SOURCE_STATUS.UNAVAILABLE,
});

/**
 * Map a legacy status string to its V3 canonical equivalent.
 * Unknown values default to FAILED.
 */
export function migrateStatus(legacy) {
  return LEGACY_TO_V3[legacy] ?? SOURCE_STATUS.FAILED;
}

// ---------------------------------------------------------------------------
// Source-status record builder (PRD v3.0 §SourceStatus)
// ---------------------------------------------------------------------------

/**
 * Build a canonical source-status record.
 *
 * Every evidence provider MUST attach this at `_sourceStatus` on its
 * return shape so downstream consumers can inspect provider health
 * without knowing provider-specific internals.
 */
export function buildSourceStatus(fields) {
  return Object.freeze({
    provider:            fields.provider,
    intendedProvider:    fields.intendedProvider ?? fields.provider,
    adapterVersion:      fields.adapterVersion ?? "1.0.0",
    startedAt:           fields.startedAt,
    completedAt:         fields.completedAt,
    requestId:           fields.requestId ?? null,
    retryCount:          fields.retryCount ?? 0,
    returnedRecordCount: fields.returnedRecordCount,
    expectedRecordCount: fields.expectedRecordCount ?? null,
    errorCategory:       fields.errorCategory ?? null,
    limitation:          fields.limitation ?? null,
    rawArtifactRef:      fields.rawArtifactRef ?? null,
  });
}

// ---------------------------------------------------------------------------
// Evidence envelope builder (PRD v3.0 §EvidenceEnvelope)
// ---------------------------------------------------------------------------

/**
 * Build a canonical evidence envelope.
 *
 * Wraps provider-specific payload in a provider-independent contract
 * that every downstream consumer can rely on.
 */
export function buildEvidenceEnvelope(fields) {
  return Object.freeze({
    evidenceVersion:  EVIDENCE_ENVELOPE_VERSION,
    source:           fields.source,
    sourceStatus:     fields.sourceStatus,
    collectedAt:      fields.collectedAt,
    coverage:         Object.freeze({
      requested:  fields.coverage.requested,
      completed:  fields.coverage.completed,
      failed:     fields.coverage.failed ?? 0,
    }),
    records:          fields.records,
    limitations:      Object.freeze([...(fields.limitations ?? [])]),
    rawArtifactRef:   fields.rawArtifactRef ?? null,
    _sourceStatus:    buildSourceStatus(fields.sourceStatusFields),
  });
}

// ---------------------------------------------------------------------------
// Boundary validators
// ---------------------------------------------------------------------------

/**
 * Return true when `value` is a recognised canonical source status.
 */
export function isValidSourceStatus(value) {
  return Object.values(SOURCE_STATUS).includes(value);
}

/**
 * Lightweight envelope validation.
 *
 * Does NOT throw — callers decide whether to halt or degrade.  Returns
 * `{ valid, errors }` so the audit pipeline can log warnings and
 * continue with reduced confidence rather than crashing.
 */
export function validateEvidenceEnvelope(shape, label = "evidence") {
  const errors = [];
  if (!shape || typeof shape !== "object") {
    return { valid: false, errors: [`${label}: not an object`] };
  }
  if (typeof shape.evidenceVersion !== "string") {
    errors.push(`${label}: missing or invalid evidenceVersion`);
  }
  if (!isValidSourceStatus(shape.sourceStatus)) {
    errors.push(`${label}: invalid or missing sourceStatus "${shape.sourceStatus}"`);
  }
  if (!shape.collectedAt && !shape._sourceStatus?.completedAt) {
    errors.push(`${label}: missing collectedAt`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Downgrade an evidence shape to a canonical FAILED envelope.
 *
 * Preserves provider, timestamps, request/task ID, counts, and raw
 * artifact reference where available on the original shape.  Sets
 * sourceStatus to FAILED, errorCategory to SCHEMA_VALIDATION, and
 * appends validation errors to limitations.
 *
 * Callers MUST pass the downgraded shape to scoring — never the
 * original invalid shape.
 */
export function downgradeToFailed(shape, validationErrors, label) {
  const v = (shape && typeof shape === "object") ? shape : {};
  const now = new Date().toISOString();
  const provider = v._sourceStatus?.provider || v.source || label || "unknown";
  return {
    evidenceVersion:  EVIDENCE_ENVELOPE_VERSION,
    source:           provider,
    sourceStatus:     SOURCE_STATUS.FAILED,
    status:           SOURCE_STATUS.FAILED,
    collectedAt:      v.collectedAt || v._sourceStatus?.completedAt || now,
    coverage:         v.coverage
                        ? { ...v.coverage }
                        : { requested: 0, completed: 0, failed: 0 },
    records:          v.records ?? null,
    limitations:      [...(v.limitations || []), ...validationErrors],
    rawArtifactRef:   v.rawArtifactRef ?? null,
    _sourceStatus:    buildSourceStatus({
      provider,
      adapterVersion:   v._sourceStatus?.adapterVersion ?? "1.0.0",
      startedAt:        v._sourceStatus?.startedAt ?? null,
      completedAt:      v._sourceStatus?.completedAt ?? v.collectedAt ?? now,
      requestId:        v._sourceStatus?.requestId ?? null,
      retryCount:       v._sourceStatus?.retryCount ?? 0,
      returnedRecordCount: v._sourceStatus?.returnedRecordCount ?? 0,
      expectedRecordCount: v._sourceStatus?.expectedRecordCount ?? null,
      errorCategory:    ERROR_CATEGORY.SCHEMA_VALIDATION,
      limitation:       validationErrors.join("; "),
      rawArtifactRef:   v.rawArtifactRef ?? null,
    }),
  };
}

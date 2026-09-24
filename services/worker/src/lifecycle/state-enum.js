/**
 * Prysm Lifecycle State Enum and Transition Map
 *
 * Defines the exact normal-path and controlled-failure states per
 * Pipeline Contracts §11 plus the authoritative transition map.
 *
 * Every state transition must be recorded as an append-only lifecycle
 * event.  The transition map is the single source of truth for
 * lifecycle validation.
 *
 * @module lifecycle/state-enum
 */

// ---------------------------------------------------------------------------
// State enum (frozen object with stable string values)
// ---------------------------------------------------------------------------

export const LIFECYCLE_STATE = Object.freeze({
  // Normal path
  CREATED:            "created",
  VALIDATED:          "validated",
  COLLECTING:         "collecting",
  EVIDENCE_STORED:    "evidence_stored",
  EVIDENCE_LOCKED:    "evidence_locked",
  SCORED:             "scored",
  NARRATIVE_PENDING:  "narrative_pending",
  NARRATIVE_READY:    "narrative_ready",
  DRAFT_RENDERED:     "draft_rendered",
  IN_REVIEW:          "in_review",
  APPROVED:           "approved",
  PUBLISHED:          "published",

  // Controlled failures
  VALIDATION_FAILED:  "validation_failed",
  COLLECTION_FAILED:  "collection_failed",
  NARRATIVE_FAILED:   "narrative_failed",
  RENDER_FAILED:      "render_failed",
  APPROVAL_REJECTED:  "approval_rejected",
  PUBLISH_FAILED:     "publish_failed",
});

const T = LIFECYCLE_STATE;

// ---------------------------------------------------------------------------
// State sets
// ---------------------------------------------------------------------------

export const NORMAL_STATES = new Set([
  T.CREATED, T.VALIDATED, T.COLLECTING, T.EVIDENCE_STORED,
  T.EVIDENCE_LOCKED, T.SCORED, T.NARRATIVE_PENDING, T.NARRATIVE_READY,
  T.DRAFT_RENDERED, T.IN_REVIEW, T.APPROVED, T.PUBLISHED,
]);

export const FAILURE_STATES = new Set([
  T.VALIDATION_FAILED, T.COLLECTION_FAILED, T.NARRATIVE_FAILED,
  T.RENDER_FAILED, T.APPROVAL_REJECTED, T.PUBLISH_FAILED,
]);

/** PUBLISHED is genuinely terminal — no outgoing transitions. */
export const TERMINAL_STATES = new Set([T.PUBLISHED]);

// ---------------------------------------------------------------------------
// Authoritative transition map
//
// Every edge listed here is valid.  Any transition not listed is invalid.
// ---------------------------------------------------------------------------

export const TRANSITION_MAP = Object.freeze({
  [T.CREATED]:           new Set([T.VALIDATED, T.VALIDATION_FAILED]),
  [T.VALIDATION_FAILED]: new Set([T.CREATED]),
  [T.VALIDATED]:         new Set([T.COLLECTING]),
  [T.COLLECTING]:        new Set([T.EVIDENCE_STORED, T.COLLECTION_FAILED]),
  [T.COLLECTION_FAILED]: new Set([T.COLLECTING]),
  [T.EVIDENCE_STORED]:   new Set([T.EVIDENCE_LOCKED]),
  [T.EVIDENCE_LOCKED]:   new Set([T.SCORED]),
  [T.SCORED]:            new Set([T.NARRATIVE_PENDING]),
  [T.NARRATIVE_PENDING]: new Set([T.NARRATIVE_READY, T.NARRATIVE_FAILED]),
  [T.NARRATIVE_FAILED]:  new Set([T.NARRATIVE_PENDING]),
  [T.NARRATIVE_READY]:   new Set([T.DRAFT_RENDERED, T.RENDER_FAILED]),
  [T.RENDER_FAILED]:     new Set([T.NARRATIVE_READY]),
  [T.DRAFT_RENDERED]:    new Set([T.IN_REVIEW]),
  [T.IN_REVIEW]:         new Set([T.APPROVED, T.APPROVAL_REJECTED]),
  [T.APPROVAL_REJECTED]: new Set([T.IN_REVIEW]),
  [T.APPROVED]:          new Set([T.PUBLISHED, T.PUBLISH_FAILED]),
  [T.PUBLISH_FAILED]:    new Set([T.APPROVED]),
  [T.PUBLISHED]:         new Set(), // genuinely terminal
});

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function isValidTransition(from, to) {
  const allowed = TRANSITION_MAP[from];
  if (!allowed) return false;
  return allowed.has(to);
}

export function allowedTransitions(state) {
  return TRANSITION_MAP[state] || new Set();
}

export function isKnownState(value) {
  return Object.values(LIFECYCLE_STATE).includes(value);
}

export default {
  LIFECYCLE_STATE,
  NORMAL_STATES,
  FAILURE_STATES,
  TERMINAL_STATES,
  TRANSITION_MAP,
  isValidTransition,
  allowedTransitions,
  isKnownState,
};

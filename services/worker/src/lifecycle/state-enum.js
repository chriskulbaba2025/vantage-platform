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

/** All lifecycle states ordered by normal-path progression. */
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

// ---------------------------------------------------------------------------
// State sets
// ---------------------------------------------------------------------------

/** All normal-path states (not failure states). */
export const NORMAL_STATES = new Set([
  LIFECYCLE_STATE.CREATED,
  LIFECYCLE_STATE.VALIDATED,
  LIFECYCLE_STATE.COLLECTING,
  LIFECYCLE_STATE.EVIDENCE_STORED,
  LIFECYCLE_STATE.EVIDENCE_LOCKED,
  LIFECYCLE_STATE.SCORED,
  LIFECYCLE_STATE.NARRATIVE_PENDING,
  LIFECYCLE_STATE.NARRATIVE_READY,
  LIFECYCLE_STATE.DRAFT_RENDERED,
  LIFECYCLE_STATE.IN_REVIEW,
  LIFECYCLE_STATE.APPROVED,
  LIFECYCLE_STATE.PUBLISHED,
]);

/** Controlled failure states. */
export const FAILURE_STATES = new Set([
  LIFECYCLE_STATE.VALIDATION_FAILED,
  LIFECYCLE_STATE.COLLECTION_FAILED,
  LIFECYCLE_STATE.NARRATIVE_FAILED,
  LIFECYCLE_STATE.RENDER_FAILED,
  LIFECYCLE_STATE.APPROVAL_REJECTED,
  LIFECYCLE_STATE.PUBLISH_FAILED,
]);

/** Terminal states — no further transitions possible. */
export const TERMINAL_STATES = new Set([
  LIFECYCLE_STATE.PUBLISHED,
]);

// ---------------------------------------------------------------------------
// Authoritative transition map
//
// Format: { [fromState]: Set<toState> }
//
// Normal-path forward transitions follow the pipeline order.
// Failure transitions branch off from the normal path at defined points.
// Recovery transitions return from a failure state to the appropriate
// re-entry point.
// ---------------------------------------------------------------------------

const T = LIFECYCLE_STATE;

/**
 * The single authoritative allowed-transition map.
 *
 * Every entry is a Set of valid target states for the given source.
 * Any transition not listed here is invalid.
 */
export const TRANSITION_MAP = Object.freeze({
  // ── Normal-path forward ─────────────────────────────────────────────
  [T.CREATED]:            new Set([T.VALIDATED, T.VALIDATION_FAILED]),
  [T.VALIDATED]:          new Set([T.COLLECTING]),
  [T.COLLECTING]:         new Set([T.EVIDENCE_STORED, T.COLLECTION_FAILED]),
  [T.EVIDENCE_STORED]:    new Set([T.EVIDENCE_LOCKED]),
  [T.EVIDENCE_LOCKED]:    new Set([T.SCORED]),
  [T.SCORED]:             new Set([T.NARRATIVE_PENDING]),
  [T.NARRATIVE_PENDING]:  new Set([T.NARRATIVE_READY, T.NARRATIVE_FAILED]),
  [T.NARRATIVE_READY]:    new Set([T.DRAFT_RENDERED]),
  [T.DRAFT_RENDERED]:     new Set([T.IN_REVIEW, T.RENDER_FAILED]),
  [T.IN_REVIEW]:          new Set([T.APPROVED, T.APPROVAL_REJECTED]),
  [T.APPROVED]:           new Set([T.PUBLISHED, T.APPROVAL_REJECTED, T.PUBLISH_FAILED]),
  [T.PUBLISHED]:          new Set([T.PUBLISH_FAILED]),

  // ── Controlled failure → recovery ───────────────────────────────────
  [T.VALIDATION_FAILED]:  new Set([T.CREATED]),
  [T.COLLECTION_FAILED]:  new Set([T.COLLECTING]),
  [T.NARRATIVE_FAILED]:   new Set([T.NARRATIVE_PENDING]),
  [T.RENDER_FAILED]:      new Set([T.DRAFT_RENDERED]),
  [T.APPROVAL_REJECTED]:  new Set([T.IN_REVIEW]),
  [T.PUBLISH_FAILED]:     new Set([T.APPROVED]),
});

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a transition from `from` to `to` is allowed.
 *
 * @param {string} from - Current lifecycle state.
 * @param {string} to   - Proposed next state.
 * @returns {boolean}
 */
export function isValidTransition(from, to) {
  const allowed = TRANSITION_MAP[from];
  if (!allowed) return false;
  return allowed.has(to);
}

/**
 * Return the set of allowed next states for a given state.
 *
 * @param {string} state
 * @returns {Set<string>}
 */
export function allowedTransitions(state) {
  return TRANSITION_MAP[state] || new Set();
}

/**
 * Check whether a state value is a known lifecycle state.
 *
 * @param {string} value
 * @returns {boolean}
 */
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

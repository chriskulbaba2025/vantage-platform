/**
 * C13 — Persisted failure classification for governed recovery.
 *
 * Recovery decisions are derived from the PERSISTED source result
 * (status + errorCategory + requestId), never from an in-memory guess.
 *
 * Classifications:
 *   RESTORE                    — restore the persisted result; no provider call.
 *                                (NOT_CONNECTED, BLOCKED, UNAVAILABLE,
 *                                 terminal auth/rate-limit/no-data)
 *   REEXECUTE_FRESH            — transient failure; re-execute the source.
 *                                (network 5xx, timeouts without a provider
 *                                 task reference)
 *   REEXECUTE_RESUME_TASK      — provider task exists but polling timed out;
 *                                re-execute with the SAME task (no new paid
 *                                task).
 *
 * @module orchestration/failure-classification
 */

export const RECOVERY_ACTION = Object.freeze({
  RESTORE: "restore",
  REEXECUTE_FRESH: "reexecute_fresh",
  REEXECUTE_RESUME_TASK: "reexecute_resume_task",
});

const TERMINAL_ERROR_CATEGORIES = new Set([
  "auth",
  "rate_limit",
  "no_data",
]);

/**
 * Classify a persisted source result for recovery.
 *
 * @param {object} sourceResult — persisted normalized SourceResult
 * @param {string} [sourceResult.status]
 * @param {string} [sourceResult.errorCategory]
 * @param {string} [sourceResult.requestId]
 * @returns {{ action: string, reason: string, requestId: string|null }}
 */
export function classifyFailure({ status, errorCategory, requestId }) {
  // Legitimate non-failure states: never re-execute.
  if (status === "NOT_CONNECTED") {
    return { action: RECOVERY_ACTION.RESTORE, reason: "credentials not supplied — no provider call", requestId: null };
  }
  if (status === "BLOCKED") {
    return { action: RECOVERY_ACTION.RESTORE, reason: "access restriction — no bypass", requestId: null };
  }
  if (status === "UNAVAILABLE") {
    return { action: RECOVERY_ACTION.RESTORE, reason: "provider returned no usable data", requestId: null };
  }
  if (status === "NOT_APPLICABLE") {
    return { action: RECOVERY_ACTION.RESTORE, reason: "source not applicable to this audit", requestId: null };
  }

  // Viable results are complete — restore.
  if (status === "AVAILABLE" || status === "PARTIAL") {
    return { action: RECOVERY_ACTION.RESTORE, reason: "completed source", requestId: requestId || null };
  }

  // FAILED — decide from the persisted error category.
  if (status === "FAILED") {
    if (errorCategory === "timeout") {
      if (requestId) {
        return {
          action: RECOVERY_ACTION.REEXECUTE_RESUME_TASK,
          reason: "polling timeout with a recoverable provider task — resume the same task",
          requestId,
        };
      }
      return {
        action: RECOVERY_ACTION.REEXECUTE_FRESH,
        reason: "timeout before a provider task existed — fresh execution",
        requestId: null,
      };
    }
    if (TERMINAL_ERROR_CATEGORIES.has(errorCategory)) {
      return {
        action: RECOVERY_ACTION.RESTORE,
        reason: `terminal failure category: ${errorCategory} — no retry`,
        requestId: requestId || null,
      };
    }
    // network / internal / unknown — transient retryable
    return {
      action: RECOVERY_ACTION.REEXECUTE_FRESH,
      reason: `transient failure category: ${errorCategory || "unknown"}`,
      requestId: requestId || null,
    };
  }

  // Unknown status — fail safe: restore without a provider call.
  return { action: RECOVERY_ACTION.RESTORE, reason: `unknown status ${status} — fail safe`, requestId: null };
}

export default { classifyFailure, RECOVERY_ACTION };

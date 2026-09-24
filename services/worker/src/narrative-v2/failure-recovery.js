import { NARRATIVE_V2_STATUS } from "./orchestrator.js";

export const NARRATIVE_V2_EXECUTION_FAILURE_REASON_PREFIX =
  "narrative-v2-execution-failed:";

export const NARRATIVE_FAILURE_RECOVERY = Object.freeze({
  STANDARD_RETRY_ELIGIBLE: "STANDARD_RETRY_ELIGIBLE",
  FINAL_PASS_ONLY: "FINAL_PASS_ONLY",
  DENIED: "DENIED",
});

function isRecoverableReason(reason) {
  return reason === "narrative-v2-preparation-failed"
    || String(reason || "").startsWith(NARRATIVE_V2_EXECUTION_FAILURE_REASON_PREFIX);
}

function isValidHumanReviewArtifact(orchestration, auditRequest) {
  return Boolean(
    orchestration
      && orchestration.auditId === auditRequest?.auditId
      && orchestration.status === NARRATIVE_V2_STATUS.HUMAN_REVIEW_REQUIRED
      && orchestration.passCount === 2
      && Array.isArray(orchestration.passes)
      && orchestration.passes.length === 2
      && orchestration.finalJudgeResponse?.decision === "REVISE"
      && orchestration.finalJudgeResponse?.revisionDirective?.required === true
      && orchestration.finalJudgeResponse?.revisionDirective?.mode === "TARGETED",
  );
}

/**
 * Classify a failed Narrative v2 audit without using the lifecycle state alone.
 * Missing orchestration is expected after a Writer execution exception;
 * malformed orchestration fails closed and cannot become a retry or final pass.
 */
export function classifyNarrativeFailureRecovery({
  auditRequest,
  failureReason,
  scoredInputsAvailable,
  orchestration,
  orchestrationMalformed = false,
  finalPassArtifactPresent = false,
}) {
  if (!auditRequest) {
    return { classification: NARRATIVE_FAILURE_RECOVERY.DENIED, reason: "missing-audit-request" };
  }
  if (finalPassArtifactPresent) {
    return { classification: NARRATIVE_FAILURE_RECOVERY.DENIED, reason: "final-pass-artifact-exists" };
  }
  if (orchestrationMalformed) {
    return { classification: NARRATIVE_FAILURE_RECOVERY.DENIED, reason: "malformed-orchestration-artifact" };
  }
  if (isValidHumanReviewArtifact(orchestration, auditRequest)) {
    return { classification: NARRATIVE_FAILURE_RECOVERY.FINAL_PASS_ONLY, reason: "valid-human-review-artifact" };
  }
  if (orchestration) {
    return { classification: NARRATIVE_FAILURE_RECOVERY.DENIED, reason: "invalid-orchestration-artifact" };
  }
  if (!isRecoverableReason(failureReason)) {
    return { classification: NARRATIVE_FAILURE_RECOVERY.DENIED, reason: "non-recoverable-failure-reason" };
  }
  if (!scoredInputsAvailable) {
    return { classification: NARRATIVE_FAILURE_RECOVERY.DENIED, reason: "missing-scored-inputs" };
  }
  return { classification: NARRATIVE_FAILURE_RECOVERY.STANDARD_RETRY_ELIGIBLE, reason: "recoverable-pre-review-failure" };
}

export default { NARRATIVE_FAILURE_RECOVERY, classifyNarrativeFailureRecovery };

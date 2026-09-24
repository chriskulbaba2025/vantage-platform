import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyNarrativeFailureRecovery,
  NARRATIVE_FAILURE_RECOVERY,
} from "./failure-recovery.js";

const auditRequest = { auditId: "audit-1" };
const executionFailure = "narrative-v2-execution-failed:Writer execution failed on pass 1";

function classify(overrides = {}) {
  return classifyNarrativeFailureRecovery({
    auditRequest,
    failureReason: executionFailure,
    scoredInputsAvailable: true,
    orchestration: null,
    ...overrides,
  }).classification;
}

test("Narrative execution failure before review is standard-retry eligible", () => {
  assert.equal(classify(), NARRATIVE_FAILURE_RECOVERY.STANDARD_RETRY_ELIGIBLE);
  assert.equal(
    classify({ failureReason: "narrative-v2-preparation-failed" }),
    NARRATIVE_FAILURE_RECOVERY.STANDARD_RETRY_ELIGIBLE,
  );
});

test("valid HUMAN_REVIEW_REQUIRED Judge artifact is final-pass-only", () => {
  assert.equal(
    classify({
      orchestration: {
        auditId: "audit-1",
        status: "HUMAN_REVIEW_REQUIRED",
        passCount: 2,
        passes: [{ passNumber: 1 }, { passNumber: 2 }],
        finalJudgeResponse: {
          decision: "REVISE",
          revisionDirective: { required: true, mode: "TARGETED" },
        },
      },
    }),
    NARRATIVE_FAILURE_RECOVERY.FINAL_PASS_ONLY,
  );
});

test("malformed or incomplete orchestration fails closed", () => {
  assert.equal(
    classify({ orchestration: { status: "HUMAN_REVIEW_REQUIRED" } }),
    NARRATIVE_FAILURE_RECOVERY.DENIED,
  );
  assert.equal(
    classify({ orchestrationMalformed: true }),
    NARRATIVE_FAILURE_RECOVERY.DENIED,
  );
  assert.equal(
    classify({ finalPassArtifactPresent: true }),
    NARRATIVE_FAILURE_RECOVERY.DENIED,
  );
});

test("retry requires the persisted request, scored inputs, and governed reason", () => {
  assert.equal(
    classify({ auditRequest: null }),
    NARRATIVE_FAILURE_RECOVERY.DENIED,
  );
  assert.equal(
    classify({ scoredInputsAvailable: false }),
    NARRATIVE_FAILURE_RECOVERY.DENIED,
  );
  assert.equal(
    classify({ failureReason: "narrative-v2-final-pass-failed:terminal" }),
    NARRATIVE_FAILURE_RECOVERY.DENIED,
  );
});

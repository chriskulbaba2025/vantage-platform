import test from "node:test";
import assert from "node:assert/strict";

import { RUBRIC, validateJudgeResponse } from "./judge-contract.js";
import { normalizeJudgeModelOutput } from "./model-output-normalization.js";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";
const REF = "scoreGovernance:moduleEligibility";

function writerInput() {
  return {
    auditId: AUDIT_ID,
    referenceIndex: {
      [REF]: { kind: "score-governance", path: "scoreGovernance.moduleEligibility" },
    },
  };
}

function responseWithLowScoreAndNoDefects() {
  const rubric = Object.fromEntries(Object.entries(RUBRIC).map(([key, maxScore]) => [key, {
    score: key === "contentFunnelDepth" ? 5 : maxScore,
    maxScore,
    status: "PASS",
    rationale: `${key} rationale`,
    evidenceRefs: [REF],
    defectIds: [],
  }]));
  return {
    contractVersion: "1.0.0",
    auditId: AUDIT_ID,
    passNumber: 1,
    judgeModelId: "judge-structured",
    judgePromptVersion: "2.0.0",
    evaluatedAt: "2026-08-21T12:00:00.000Z",
    hardGate: { status: "PASS", violations: [] },
    rubric,
    totalScore: 100,
    decision: "PASS",
    defects: [],
    revisionDirective: {
      required: false,
      mode: "NONE",
      fieldsToRewrite: [],
      fieldsLocked: [],
      defectIds: [],
    },
  };
}

test("CONTRACT-CLOSURE-06: deterministic REVISE can never reach validator without a governed defect target", () => {
  const normalized = normalizeJudgeModelOutput(responseWithLowScoreAndNoDefects());
  assert.equal(normalized.decision, "REVISE");
  assert.equal(normalized.defects.length, 1);
  assert.equal(normalized.defects[0].criterion, "contentFunnelDepth");
  assert.equal(normalized.defects[0].severity, "MAJOR");
  assert.deepEqual(normalized.defects[0].allowedFields, [
    "content",
    "funnelOpportunities.awareness",
    "funnelOpportunities.consideration",
    "funnelOpportunities.decision",
  ]);
  assert.deepEqual(normalized.revisionDirective.fieldsToRewrite, normalized.defects[0].allowedFields);
  assert.deepEqual(validateJudgeResponse(normalized, { writerInput: writerInput(), expectedPassNumber: 1 }), { valid: true, errors: [] });
});

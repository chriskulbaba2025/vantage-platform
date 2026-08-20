import test from "node:test";
import assert from "node:assert/strict";

import {
  JUDGE_CONTRACT_VERSION,
  JUDGE_DECISION,
  NEXT_ACTION,
  RUBRIC,
  RUBRIC_TOTAL,
  validateJudgeResponse,
  deriveJudgeDecision,
  nextActionForJudge,
} from "./judge-contract.js";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";

function writerInput() {
  return {
    auditId: AUDIT_ID,
    referenceIndex: {
      "business:primaryGoal": { kind: "business", path: "business.primaryGoal" },
      "score:rootCause": { kind: "score", path: "score.rootCause" },
      "score:trustEeatDimension": { kind: "score", path: "score.scores.trustEeatDimension" },
      "finding:F-001": { kind: "finding", path: "findings.F-001" },
      "finding:F-002": { kind: "finding", path: "findings.F-002" },
      "capability:trust.proof": { kind: "capability", path: "capabilityContext.capabilities.trust.proof" },
      "source:backlinks": { kind: "source-status", path: "scoreGovernance.sourceDependencies.backlinks" },
      "analysis:contentIdeas": { kind: "deterministic-analysis", path: "deterministicAnalysis.contentIdeas" },
    },
  };
}

function rubricRecord(key, score = RUBRIC[key], defectIds = []) {
  return {
    score,
    maxScore: RUBRIC[key],
    status: score / RUBRIC[key] >= 0.7 ? "PASS" : "FAIL",
    rationale: `${key} rationale`,
    evidenceRefs: key === "nonRepetition" ? [] : ["finding:F-001"],
    defectIds,
  };
}

function fullRubric(overrides = {}) {
  const rubric = {};
  for (const key of Object.keys(RUBRIC)) rubric[key] = rubricRecord(key);
  for (const [key, value] of Object.entries(overrides)) rubric[key] = value;
  return rubric;
}

function baseResponse(overrides = {}) {
  const rubric = fullRubric();
  return {
    contractVersion: JUDGE_CONTRACT_VERSION,
    auditId: AUDIT_ID,
    passNumber: 1,
    judgeModelId: "judge-model",
    judgePromptVersion: "2.0.0",
    evaluatedAt: "2026-08-20T03:40:00.000Z",
    hardGate: { status: "PASS", violations: [] },
    rubric,
    totalScore: RUBRIC_TOTAL,
    decision: JUDGE_DECISION.PASS,
    defects: [],
    revisionDirective: {
      required: false,
      mode: "NONE",
      fieldsToRewrite: [],
      fieldsLocked: [],
      defectIds: [],
    },
    ...overrides,
  };
}

function reviseDefect(overrides = {}) {
  return {
    defectId: "D-001",
    criterion: "contentFunnelDepth",
    section: "content",
    severity: "MAJOR",
    problem: "The content analysis is too generic.",
    whyItMatters: "The client cannot see which content gap affects the funnel.",
    evidenceRefs: ["analysis:contentIdeas", "finding:F-002"],
    requiredCorrection: "Ground the content section in the deterministic content ideas and finding F-002.",
    allowedFields: ["content", "funnelOpportunities.awareness"],
    mustPreserve: ["executiveConclusion", "conversion"],
    ...overrides,
  };
}

test("JUDGE-V2-01: rubric is frozen to exactly 100 points", () => {
  assert.equal(RUBRIC_TOTAL, 100);
  assert.equal(RUBRIC.evidenceFidelity, 20);
  assert.equal(RUBRIC.contentFunnelDepth, 8);
  assert.equal(RUBRIC.eeatTrust, 6);
});

test("JUDGE-V2-02: perfect governed response passes and releases", () => {
  const response = baseResponse();
  const result = validateJudgeResponse(response, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.deepEqual(result, { valid: true, errors: [] });
  assert.equal(deriveJudgeDecision(response), JUDGE_DECISION.PASS);
  assert.equal(nextActionForJudge(response), NEXT_ACTION.RELEASE_CANDIDATE);
});

test("JUDGE-V2-03: evidence fidelity below 20 cannot pass even above total threshold", () => {
  const rubric = fullRubric({ evidenceFidelity: rubricRecord("evidenceFidelity", 19) });
  const totalScore = Object.values(rubric).reduce((sum, record) => sum + record.score, 0);
  const defect = reviseDefect({
    criterion: "evidenceFidelity",
    section: "executiveConclusion",
    problem: "One conclusion is not fully traceable.",
    requiredCorrection: "Remove or re-ground the unsupported conclusion.",
    allowedFields: ["executiveConclusion"],
  });
  const response = baseResponse({
    rubric,
    totalScore,
    decision: JUDGE_DECISION.REVISE,
    defects: [defect],
    revisionDirective: {
      required: true,
      mode: "TARGETED",
      fieldsToRewrite: ["executiveConclusion"],
      fieldsLocked: ["conversion"],
      defectIds: ["D-001"],
    },
  });
  response.rubric.evidenceFidelity.defectIds = ["D-001"];

  assert.ok(totalScore >= 92);
  assert.equal(deriveJudgeDecision(response), JUDGE_DECISION.REVISE);
  assert.equal(validateJudgeResponse(response, { writerInput: writerInput() }).valid, true);
});

test("JUDGE-V2-04: any hard-gate violation forces revision regardless of score", () => {
  const defect = reviseDefect({
    criterion: "evidenceFidelity",
    section: "competitors",
    problem: "A competitor ranking claim is unsupported.",
    requiredCorrection: "Remove the unsupported ranking claim.",
    allowedFields: ["competitors"],
  });
  const response = baseResponse({
    hardGate: {
      status: "FAIL",
      violations: [{
        violationId: "HG-001",
        code: "UNSUPPORTED_COMPETITOR_CLAIM",
        section: "competitors",
        explanation: "The narrative states a national ranking that is not in governed evidence.",
        evidenceRefs: ["finding:F-001"],
        automaticFail: true,
      }],
    },
    decision: JUDGE_DECISION.REVISE,
    defects: [defect],
    revisionDirective: {
      required: true,
      mode: "TARGETED",
      fieldsToRewrite: ["competitors"],
      fieldsLocked: ["conversion"],
      defectIds: ["D-001"],
    },
  });
  response.rubric.evidenceFidelity.defectIds = ["D-001"];

  assert.equal(deriveJudgeDecision(response), JUDGE_DECISION.REVISE);
  assert.equal(validateJudgeResponse(response, { writerInput: writerInput() }).valid, true);
});

test("JUDGE-V2-05: unknown Writer evidence reference fails closed", () => {
  const response = baseResponse();
  response.rubric.businessRelevance.evidenceRefs = ["finding:DOES-NOT-EXIST"];
  const result = validateJudgeResponse(response, { writerInput: writerInput() });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /unknown Writer reference/);
});

test("JUDGE-V2-06: targeted revision may rewrite only the union of defect-authorized fields", () => {
  const defect = reviseDefect();
  const rubric = fullRubric({ contentFunnelDepth: rubricRecord("contentFunnelDepth", 5, ["D-001"]) });
  const totalScore = Object.values(rubric).reduce((sum, record) => sum + record.score, 0);
  const response = baseResponse({
    rubric,
    totalScore,
    decision: JUDGE_DECISION.REVISE,
    defects: [defect],
    revisionDirective: {
      required: true,
      mode: "TARGETED",
      fieldsToRewrite: ["content", "funnelOpportunities.awareness"],
      fieldsLocked: ["executiveConclusion", "conversion"],
      defectIds: ["D-001"],
    },
  });

  const valid = validateJudgeResponse(response, { writerInput: writerInput() });
  assert.equal(valid.valid, true);
  assert.equal(nextActionForJudge(response), NEXT_ACTION.WRITE_NEXT_PASS);

  response.revisionDirective.fieldsToRewrite.push("technical");
  const invalid = validateJudgeResponse(response, { writerInput: writerInput() });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /exactly equal the union/);
});

test("JUDGE-V2-07: pass 3 failure routes to human review and forbids a fourth rewrite", () => {
  const defect = reviseDefect();
  const rubric = fullRubric({ contentFunnelDepth: rubricRecord("contentFunnelDepth", 4, ["D-001"]) });
  const totalScore = Object.values(rubric).reduce((sum, record) => sum + record.score, 0);
  const response = baseResponse({
    passNumber: 3,
    rubric,
    totalScore,
    decision: JUDGE_DECISION.HUMAN_REVIEW_REQUIRED,
    defects: [defect],
    revisionDirective: {
      required: false,
      mode: "HUMAN_REVIEW",
      fieldsToRewrite: [],
      fieldsLocked: ["executiveConclusion", "conversion"],
      defectIds: ["D-001"],
    },
  });

  const result = validateJudgeResponse(response, { writerInput: writerInput(), expectedPassNumber: 3 });
  assert.equal(result.valid, true);
  assert.equal(nextActionForJudge(response), NEXT_ACTION.HUMAN_REVIEW);
});

test("JUDGE-V2-08: Judge cannot falsify the calculated total", () => {
  const response = baseResponse({ totalScore: 99 });
  const result = validateJudgeResponse(response, { writerInput: writerInput() });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /totalScore mismatch/);
});

test("JUDGE-V2-09: unknown hard-gate code fails closed", () => {
  const defect = reviseDefect({ allowedFields: ["technical"] });
  const response = baseResponse({
    hardGate: {
      status: "FAIL",
      violations: [{
        violationId: "HG-999",
        code: "MADE_UP_GATE",
        section: "technical",
        explanation: "invalid",
        evidenceRefs: ["finding:F-001"],
        automaticFail: true,
      }],
    },
    decision: JUDGE_DECISION.REVISE,
    defects: [defect],
    revisionDirective: {
      required: true,
      mode: "TARGETED",
      fieldsToRewrite: ["technical"],
      fieldsLocked: [],
      defectIds: ["D-001"],
    },
  });
  const result = validateJudgeResponse(response, { writerInput: writerInput() });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /code is not governed/);
});

test("JUDGE-V2-10: no rubric dimension may be materially weak behind a high average", () => {
  const rubric = fullRubric({ competitiveUsefulness: rubricRecord("competitiveUsefulness", 2) });
  const totalScore = Object.values(rubric).reduce((sum, record) => sum + record.score, 0);
  const defect = reviseDefect({
    criterion: "competitiveUsefulness",
    section: "competitors",
    problem: "Competitive interpretation is materially weak.",
    requiredCorrection: "Explain the supported competitive implication.",
    allowedFields: ["competitors"],
  });
  const response = baseResponse({
    rubric,
    totalScore,
    decision: JUDGE_DECISION.REVISE,
    defects: [defect],
    revisionDirective: {
      required: true,
      mode: "TARGETED",
      fieldsToRewrite: ["competitors"],
      fieldsLocked: [],
      defectIds: ["D-001"],
    },
  });
  response.rubric.competitiveUsefulness.defectIds = ["D-001"];

  assert.ok(totalScore >= 92);
  assert.equal(deriveJudgeDecision(response), JUDGE_DECISION.REVISE);
  assert.equal(validateJudgeResponse(response, { writerInput: writerInput() }).valid, true);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  JUDGE_CONTRACT_VERSION,
  JUDGE_DECISION,
  RUBRIC,
  WRITER_SECTION_FIELDS,
} from "./judge-contract.js";
import {
  WRITER_OUTPUT_VERSION,
  WRITER_PROMPT_VERSION,
} from "./writer-output.js";
import {
  JUDGE_RUNTIME_CONTRACT,
  NARRATIVE_V2_ERROR,
  NARRATIVE_V2_STATUS,
  NarrativeV2OrchestrationError,
  runNarrativeV2Orchestration,
} from "./orchestrator.js";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";
const EVIDENCE_REF = "finding:F-001";

function writerInput() {
  return {
    contractVersion: "1.0.0",
    writerInputVersion: "1.0.0",
    auditId: AUDIT_ID,
    business: {
      businessName: "Example Business",
      primaryGoal: "generate qualified enquiries",
    },
    findings: [{ findingId: "F-001", title: "Verified finding" }],
    referenceIndex: {
      [EVIDENCE_REF]: { kind: "finding", path: "findings.F-001" },
    },
  };
}

function atom(text = "The governed evidence supports this bounded interpretation.") {
  return {
    text,
    statementClass: "INTERPRETATION",
    evidenceRefs: [EVIDENCE_REF],
  };
}

function opportunity(text = "Use the governed evidence to make this bounded improvement.") {
  return {
    text,
    statementClass: "OPPORTUNITY",
    evidenceRefs: [EVIDENCE_REF],
  };
}

function section(headline, fields) {
  return { headline, ...fields };
}

function validWriterOutput(passNumber = 1) {
  return {
    contractVersion: "1.0.0",
    writerOutputVersion: WRITER_OUTPUT_VERSION,
    auditId: AUDIT_ID,
    passNumber,
    modelId: `writer-model-${passNumber}`,
    promptVersion: WRITER_PROMPT_VERSION,
    generatedAt: `2026-08-20T04:0${passNumber}:00.000Z`,
    executiveConclusion: {
      headline: "Evidence supports a focused correction",
      narrative: atom(),
    },
    strengths: [{
      itemId: "STR-01",
      title: "A verified strength to preserve",
      narrative: atom(),
    }],
    rootCause: {
      headline: "One governed root cause",
      narrative: atom(),
      businessConsequences: [],
    },
    conversion: section("Conversion", {
      whatWorks: atom(),
      constraints: atom(),
      businessMeaning: atom(),
      priority: atom(),
    }),
    content: section("Content and topical architecture", {
      currentStrength: atom(),
      coverageAssessment: atom(),
      qualityAssessment: atom(),
      topicalArchitecture: atom(),
      importantGaps: atom(),
      businessMeaning: atom(),
    }),
    funnelOpportunities: {
      awareness: [],
      consideration: [],
      decision: [],
    },
    seoSerp: section("SEO and SERP", {
      whatWorks: atom(),
      constraints: atom(),
      searchImplication: atom(),
      priority: atom(),
    }),
    aiSearch: section("AI search readiness", {
      answerability: atom(),
      entityStrength: atom(),
      citationReadiness: atom(),
      constraints: atom(),
      opportunity: opportunity(),
    }),
    eeatTrust: section("E-E-A-T and trust", {
      experience: atom(),
      expertise: atom(),
      authority: atom(),
      trust: atom(),
      proofGaps: atom(),
      businessMeaning: atom(),
    }),
    technical: section("Technical foundations", {
      assessment: atom(),
      materialIssues: atom(),
      businessMeaning: atom(),
    }),
    performanceUx: section("Performance and UX", {
      assessment: atom(),
      userImpact: atom(),
      conversionImpact: atom(),
    }),
    competitors: section("Competitors", {
      advantages: atom(),
      disadvantages: atom(),
      marketInterpretation: atom(),
      differentiatorToProtect: atom(),
    }),
    limitations: [],
    actionPlan: [{
      actionId: "ACT-01",
      priority: 1,
      title: "Correct the verified priority",
      action: opportunity(),
      whyNow: opportunity(),
      expectedBusinessEffect: opportunity(),
      effort: "M",
      verification: opportunity(),
    }],
    executiveDecision: {
      preserve: atom(),
      change: atom(),
      doNext: opportunity(),
    },
  };
}

function targetedRevision(previousOutput, passNumber, { collateral = false } = {}) {
  const revised = JSON.parse(JSON.stringify(previousOutput));
  revised.passNumber = passNumber;
  revised.modelId = `writer-model-${passNumber}`;
  revised.generatedAt = `2026-08-20T04:0${passNumber}:00.000Z`;
  revised.content.headline = `Content correction pass ${passNumber}`;
  revised.content.coverageAssessment.text = `Pass ${passNumber} corrects only the Judge-authorized content defect using governed evidence.`;
  if (collateral) {
    revised.technical.headline = "Unauthorized collateral technical rewrite";
  }
  return revised;
}

function rubricRecord(key, score = RUBRIC[key], defectIds = []) {
  return {
    score,
    maxScore: RUBRIC[key],
    status: score / RUBRIC[key] >= 0.7 ? "PASS" : "FAIL",
    rationale: `${key} is evaluated against the governed report and evidence packet.`,
    evidenceRefs: [EVIDENCE_REF],
    defectIds,
  };
}

function fullRubric() {
  return Object.fromEntries(Object.keys(RUBRIC).map((key) => [key, rubricRecord(key)]));
}

function passingJudgeResponse(passNumber) {
  const rubric = fullRubric();
  return {
    contractVersion: JUDGE_CONTRACT_VERSION,
    auditId: AUDIT_ID,
    passNumber,
    judgeModelId: `judge-model-${passNumber}`,
    judgePromptVersion: "2.0.0",
    evaluatedAt: `2026-08-20T04:1${passNumber}:00.000Z`,
    hardGate: { status: "PASS", violations: [] },
    rubric,
    totalScore: Object.values(rubric).reduce((sum, record) => sum + record.score, 0),
    decision: JUDGE_DECISION.PASS,
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

function nonPassingJudgeResponse(passNumber) {
  const defectId = `D-${passNumber}`;
  const rubric = fullRubric();
  rubric.contentFunnelDepth = rubricRecord("contentFunnelDepth", 5, [defectId]);
  const fieldsLocked = WRITER_SECTION_FIELDS.filter((field) => field !== "content");
  const humanReview = passNumber === 3;

  return {
    contractVersion: JUDGE_CONTRACT_VERSION,
    auditId: AUDIT_ID,
    passNumber,
    judgeModelId: `judge-model-${passNumber}`,
    judgePromptVersion: "2.0.0",
    evaluatedAt: `2026-08-20T04:2${passNumber}:00.000Z`,
    hardGate: { status: "PASS", violations: [] },
    rubric,
    totalScore: Object.values(rubric).reduce((sum, record) => sum + record.score, 0),
    decision: humanReview ? JUDGE_DECISION.HUMAN_REVIEW_REQUIRED : JUDGE_DECISION.REVISE,
    defects: [{
      defectId,
      criterion: "contentFunnelDepth",
      section: "content",
      severity: "MINOR",
      problem: "The content interpretation is not specific enough.",
      whyItMatters: "The client needs a more decision-useful interpretation.",
      evidenceRefs: [EVIDENCE_REF],
      requiredCorrection: "Rewrite only the content section using the same governed evidence.",
      allowedFields: ["content"],
      mustPreserve: fieldsLocked,
    }],
    revisionDirective: humanReview
      ? {
          required: false,
          mode: "HUMAN_REVIEW",
          fieldsToRewrite: [],
          fieldsLocked,
          defectIds: [defectId],
        }
      : {
          required: true,
          mode: "TARGETED",
          fieldsToRewrite: ["content"],
          fieldsLocked,
          defectIds: [defectId],
        },
  };
}

async function expectOrchestrationError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof NarrativeV2OrchestrationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("ORCH-01/02/05: Pass 1 uses governed prompt, Judge consumes the same validated object, PASS releases", async () => {
  const input = writerInput();
  const produced = validWriterOutput(1);
  let writerCalls = 0;
  let judgeCalls = 0;

  const result = await runNarrativeV2Orchestration({
    writerInput: input,
    writerExecutor: async (request) => {
      writerCalls += 1;
      assert.equal(request.passNumber, 1);
      assert.equal(request.writerInput, input);
      assert.ok(Object.isFrozen(request.writerInput));
      assert.match(request.prompt, /governed PRYSM Executive Report Writer/);
      assert.match(request.prompt, /WRITER INPUT:/);
      assert.equal(Object.hasOwn(request, "previousOutput"), false);
      assert.equal(Object.hasOwn(request, "judgeResponse"), false);
      return produced;
    },
    judgeExecutor: async (request) => {
      judgeCalls += 1;
      assert.equal(request.passNumber, 1);
      assert.equal(request.writerOutput, produced);
      assert.ok(Object.isFrozen(request.writerOutput));
      assert.equal(request.judgeContract, JUDGE_RUNTIME_CONTRACT);
      assert.equal(request.judgeContract.narrativePassScore, 92);
      assert.equal(request.judgeContract.maxNarrativePasses, 3);
      return passingJudgeResponse(1);
    },
  });

  assert.equal(writerCalls, 1);
  assert.equal(judgeCalls, 1);
  assert.equal(result.status, NARRATIVE_V2_STATUS.RELEASE_CANDIDATE);
  assert.equal(result.passCount, 1);
  assert.equal(result.finalWriterOutput, produced);
  assert.equal(result.passes.length, 1);
  assert.ok(Object.isFrozen(result));
});

test("ORCH-03: invalid Writer output fails closed before Judge", async () => {
  let judgeCalls = 0;
  const invalid = validWriterOutput(1);
  invalid.executiveConclusion.narrative.evidenceRefs = ["finding:UNKNOWN"];

  await expectOrchestrationError(
    runNarrativeV2Orchestration({
      writerInput: writerInput(),
      writerExecutor: async () => invalid,
      judgeExecutor: async () => {
        judgeCalls += 1;
        return passingJudgeResponse(1);
      },
    }),
    NARRATIVE_V2_ERROR.WRITER_OUTPUT_INVALID,
  );

  assert.equal(judgeCalls, 0);
});

test("ORCH-04: invalid Judge response fails closed before another Writer pass", async () => {
  let writerCalls = 0;
  let judgeCalls = 0;

  await expectOrchestrationError(
    runNarrativeV2Orchestration({
      writerInput: writerInput(),
      writerExecutor: async () => {
        writerCalls += 1;
        return validWriterOutput(1);
      },
      judgeExecutor: async () => {
        judgeCalls += 1;
        const invalid = nonPassingJudgeResponse(1);
        invalid.decision = JUDGE_DECISION.PASS;
        return invalid;
      },
    }),
    NARRATIVE_V2_ERROR.JUDGE_RESPONSE_INVALID,
  );

  assert.equal(writerCalls, 1);
  assert.equal(judgeCalls, 1);
});

test("ORCH-06/07: only validated REVISE starts Pass 2 with exact prior output and Judge directive", async () => {
  const firstOutput = validWriterOutput(1);
  const firstJudge = nonPassingJudgeResponse(1);
  let writerCalls = 0;
  let judgeCalls = 0;

  const result = await runNarrativeV2Orchestration({
    writerInput: writerInput(),
    writerExecutor: async (request) => {
      writerCalls += 1;
      if (request.passNumber === 1) return firstOutput;

      assert.equal(request.passNumber, 2);
      assert.equal(request.previousOutput, firstOutput);
      assert.equal(request.judgeResponse, firstJudge);
      assert.match(request.prompt, /surgical revision, not a fresh rewrite/i);
      assert.match(request.prompt, /"content"/);
      return targetedRevision(request.previousOutput, 2);
    },
    judgeExecutor: async (request) => {
      judgeCalls += 1;
      if (request.passNumber === 1) return firstJudge;
      return passingJudgeResponse(2);
    },
  });

  assert.equal(writerCalls, 2);
  assert.equal(judgeCalls, 2);
  assert.equal(result.status, NARRATIVE_V2_STATUS.RELEASE_CANDIDATE);
  assert.equal(result.passCount, 2);
  assert.equal(result.passes.length, 2);
  assert.equal(result.passes[0].writerOutput, firstOutput);
});

test("ORCH-08: collateral Pass 2 rewrite fails before the second Judge call", async () => {
  let writerCalls = 0;
  let judgeCalls = 0;

  const promise = runNarrativeV2Orchestration({
    writerInput: writerInput(),
    writerExecutor: async (request) => {
      writerCalls += 1;
      if (request.passNumber === 1) return validWriterOutput(1);
      return targetedRevision(request.previousOutput, 2, { collateral: true });
    },
    judgeExecutor: async (request) => {
      judgeCalls += 1;
      return nonPassingJudgeResponse(request.passNumber);
    },
  });

  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof NarrativeV2OrchestrationError);
    assert.equal(error.code, NARRATIVE_V2_ERROR.WRITER_OUTPUT_INVALID);
    assert.match(error.validationErrors.join("\n"), /Unauthorized Writer change outside revision directive: technical/);
    return true;
  });

  assert.equal(writerCalls, 2);
  assert.equal(judgeCalls, 1);
});

test("ORCH-09: unsuccessful Pass 3 terminates in human review with no Pass 4", async () => {
  let writerCalls = 0;
  let judgeCalls = 0;

  const result = await runNarrativeV2Orchestration({
    writerInput: writerInput(),
    writerExecutor: async (request) => {
      writerCalls += 1;
      if (request.passNumber === 1) return validWriterOutput(1);
      return targetedRevision(request.previousOutput, request.passNumber);
    },
    judgeExecutor: async (request) => {
      judgeCalls += 1;
      return nonPassingJudgeResponse(request.passNumber);
    },
  });

  assert.equal(writerCalls, 3);
  assert.equal(judgeCalls, 3);
  assert.equal(result.status, NARRATIVE_V2_STATUS.HUMAN_REVIEW_REQUIRED);
  assert.equal(result.passCount, 3);
  assert.equal(result.passes.length, 3);
  assert.equal(result.finalJudgeResponse.decision, JUDGE_DECISION.HUMAN_REVIEW_REQUIRED);
});

test("execution failures fail closed at the owning boundary", async () => {
  let judgeCalls = 0;
  await expectOrchestrationError(
    runNarrativeV2Orchestration({
      writerInput: writerInput(),
      writerExecutor: async () => {
        throw new Error("controlled writer failure");
      },
      judgeExecutor: async () => {
        judgeCalls += 1;
        return passingJudgeResponse(1);
      },
    }),
    NARRATIVE_V2_ERROR.WRITER_EXECUTION_FAILED,
  );
  assert.equal(judgeCalls, 0);

  let writerCalls = 0;
  await expectOrchestrationError(
    runNarrativeV2Orchestration({
      writerInput: writerInput(),
      writerExecutor: async () => {
        writerCalls += 1;
        return validWriterOutput(1);
      },
      judgeExecutor: async () => {
        throw new Error("controlled judge failure");
      },
    }),
    NARRATIVE_V2_ERROR.JUDGE_EXECUTION_FAILED,
  );
  assert.equal(writerCalls, 1);
});

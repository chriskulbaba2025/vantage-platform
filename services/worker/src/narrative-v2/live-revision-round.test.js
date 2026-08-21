import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import {
  createNarrativeV2LiveBinding,
  NARRATIVE_V2_LIVE_MAX_CALLS,
  NARRATIVE_V2_LIVE_MAX_AUTOMATIC_PASSES,
} from "./live-binding.js";
import {
  JUDGE_CONTRACT_VERSION,
  JUDGE_DECISION,
  RUBRIC,
} from "./judge-contract.js";
import {
  runNarrativeV2Orchestration,
  NARRATIVE_V2_STATUS,
} from "./orchestrator.js";
import {
  WRITER_OUTPUT_VERSION,
  WRITER_PROMPT_VERSION,
} from "./writer-output.js";

const AUDIT_ID = "452f9d02-e8a0-47f1-a81b-75b3a5e2f4ef";
const REF = "finding:F-001";
const STATUS_REF = "source:offsite";
const FIXED_TS = "2026-08-21T12:42:00.000Z";
const SCOPE = {
  tenantId: "tenant-live-revision",
  clientId: "client-live-revision",
  auditId: AUDIT_ID,
  executionId: "execution-live-revision",
};

function baseEnv() {
  return {
    PRYSM_NARRATIVE_V2_ENABLED: "true",
    PRYSM_LLM_MODE: "live",
    PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL: "https://llm.example.test/v1/chat/completions",
    PRYSM_NARRATIVE_V2_API_KEY: "test-secret-never-log",
    PRYSM_NARRATIVE_V2_WRITER_MODEL: "writer-test",
    PRYSM_NARRATIVE_V2_JUDGE_MODEL: "judge-test",
    PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS: "500000",
    PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_NARRATIVE_V2_TIMEOUT_MS: "5000",
    PRYSM_LLM_SOFT_BUDGET_USD: "0.50",
    PRYSM_LLM_HARD_BUDGET_USD: "2.00",
    PRYSM_LLM_DAILY_HARD_BUDGET_USD: "10.00",
    PRYSM_LLM_DAILY_SPEND_USD: "0",
    PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON: JSON.stringify({
      "writer-test": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
      "judge-test": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
    }),
  };
}

function writerInput() {
  return {
    contractVersion: "1.0.0",
    writerInputVersion: "1.0.0",
    auditId: AUDIT_ID,
    scoreGovernance: {
      sourceDependencies: { offsite: "UNAVAILABLE" },
    },
    referenceIndex: {
      [REF]: { kind: "finding", path: "findings.F-001" },
      [STATUS_REF]: { kind: "source-status", path: "scoreGovernance.sourceDependencies.offsite" },
    },
  };
}

function atom(text, statementClass = "INTERPRETATION", refs = [REF]) {
  return { text, statementClass, evidenceRefs: refs };
}
function opportunity(text) {
  return atom(text, "OPPORTUNITY");
}
function statusAtom(text) {
  return atom(text, "INTERPRETATION", [STATUS_REF]);
}
function standard(headline, fields) {
  return { headline, ...fields };
}

function validWriterOutput(passNumber = 1) {
  const interpret = (label) => atom(`${label} is tied to the governed finding.`);
  return {
    contractVersion: "1.0.0",
    writerOutputVersion: WRITER_OUTPUT_VERSION,
    auditId: AUDIT_ID,
    passNumber,
    modelId: "writer-test",
    promptVersion: WRITER_PROMPT_VERSION,
    generatedAt: FIXED_TS,
    executiveConclusion: {
      headline: "The site has a useful base with one priority constraint",
      narrative: interpret("The executive conclusion"),
    },
    strengths: [{ itemId: "STR-01", title: "Useful foundation", narrative: interpret("The strength") }],
    rootCause: {
      headline: "The verified constraint limits the current path",
      narrative: interpret("The root cause"),
      businessConsequences: [{ area: "Conversion", narrative: interpret("The business consequence") }],
    },
    conversion: standard("Conversion", {
      whatWorks: interpret("Conversion strength"),
      constraints: interpret("Conversion constraint"),
      businessMeaning: interpret("Conversion business meaning"),
      priority: interpret("Conversion priority"),
    }),
    content: standard("Content and topical architecture", {
      currentStrength: interpret("Content strength"),
      coverageAssessment: interpret("Content coverage"),
      qualityAssessment: interpret("Content quality"),
      topicalArchitecture: interpret("Topical architecture"),
      importantGaps: interpret("Content gap"),
      businessMeaning: interpret("Content business meaning"),
    }),
    funnelOpportunities: {
      awareness: [{
        itemId: "FUN-A-01",
        concept: opportunity("Create the governed awareness concept."),
        userNeed: opportunity("Answer the governed awareness user need."),
        rationale: opportunity("Use the governed finding as the rationale."),
        businessObjective: opportunity("Support the governed business objective."),
        nextAction: opportunity("Move the reader to the governed next action."),
      }],
      consideration: [],
      decision: [],
    },
    seoSerp: standard("SEO and SERP", {
      whatWorks: interpret("SEO strength"),
      constraints: interpret("SEO constraint"),
      searchImplication: interpret("Search implication"),
      priority: interpret("SEO priority"),
    }),
    aiSearch: standard("AI search readiness", {
      answerability: interpret("AI answerability"),
      entityStrength: interpret("AI entity strength"),
      citationReadiness: interpret("AI citation readiness"),
      constraints: interpret("AI search constraint"),
      opportunity: opportunity("Use the governed finding to improve AI search readiness."),
    }),
    eeatTrust: standard("E-E-A-T and trust", {
      experience: interpret("Experience signal"),
      expertise: interpret("Expertise signal"),
      authority: interpret("Authority signal"),
      trust: interpret("Trust signal"),
      proofGaps: interpret("Proof gap"),
      businessMeaning: interpret("Trust business meaning"),
    }),
    technical: standard("Technical foundations", {
      assessment: interpret("Technical assessment"),
      materialIssues: interpret("Technical issue"),
      businessMeaning: interpret("Technical business meaning"),
    }),
    performanceUx: standard("Performance and UX", {
      assessment: interpret("Performance assessment"),
      userImpact: interpret("Performance user impact"),
      conversionImpact: interpret("Performance conversion impact"),
    }),
    competitors: standard("Competitive position", {
      advantages: interpret("Competitive advantage"),
      disadvantages: interpret("Competitive disadvantage"),
      marketInterpretation: interpret("Competitive interpretation"),
      differentiatorToProtect: interpret("Differentiator to protect"),
    }),
    limitations: [{
      itemId: "LIM-01",
      area: "Off-site evidence",
      status: "UNAVAILABLE",
      clientExplanation: statusAtom("The limitation is grounded in unavailable off-site evidence."),
      whatThisMeans: statusAtom("The limitation bounds the report interpretation."),
      whatThisDoesNotMean: statusAtom("Unavailable evidence does not establish poor performance."),
      impactOnReport: interpret("The report preserves this limitation explicitly"),
    }],
    actionPlan: [{
      actionId: "ACT-01",
      priority: 1,
      title: "Correct the verified priority",
      action: opportunity("Correct the verified priority using governed evidence."),
      whyNow: opportunity("Address it now because the evidence marks it as material."),
      expectedBusinessEffect: opportunity("Improve the path without inventing a result."),
      effort: "M",
      verification: opportunity("Re-run the governed audit against the same evidence boundary."),
    }],
    executiveDecision: {
      preserve: interpret("Preserve decision"),
      change: interpret("Change decision"),
      doNext: opportunity("Do the governed priority next."),
    },
  };
}

function revisedWriterOutput() {
  const output = structuredClone(validWriterOutput(2));
  output.content = {
    ...output.content,
    headline: "Content and topical architecture now states the specific governed gap",
    importantGaps: atom("The revised content gap is now specific to the governed finding."),
    businessMeaning: atom("The revised content section now explains the governed business consequence."),
  };
  return output;
}

function fullRubric(overrides = {}) {
  const rubric = {};
  for (const [key, maxScore] of Object.entries(RUBRIC)) {
    rubric[key] = {
      score: maxScore,
      maxScore,
      status: "PASS",
      rationale: `${key} is supported by the governed packet.`,
      evidenceRefs: key === "nonRepetition" ? [] : [REF],
      defectIds: [],
    };
  }
  return { ...rubric, ...overrides };
}

function revisingJudgeResponse(passNumber = 1) {
  const defectId = "D-MODEL";
  const rubric = fullRubric({
    contentFunnelDepth: {
      score: 5,
      maxScore: RUBRIC.contentFunnelDepth,
      status: "FAIL",
      rationale: "The content gap needs a more specific governed explanation.",
      evidenceRefs: [REF],
      defectIds: [defectId],
    },
  });
  const totalScore = Object.values(rubric).reduce((sum, record) => sum + record.score, 0);
  return {
    contractVersion: JUDGE_CONTRACT_VERSION,
    auditId: AUDIT_ID,
    passNumber,
    judgeModelId: "judge-test",
    judgePromptVersion: "2.0.0",
    evaluatedAt: FIXED_TS,
    hardGate: { status: "PASS", violations: [] },
    rubric,
    totalScore,
    decision: JUDGE_DECISION.REVISE,
    defects: [{
      defectId,
      criterion: "contentFunnelDepth",
      section: "content",
      severity: "MINOR",
      problem: "The content gap is too generic.",
      whyItMatters: "The client needs a more specific governed explanation.",
      evidenceRefs: [REF],
      requiredCorrection: "Rewrite the content section to make the governed gap specific.",
      allowedFields: ["content"],
      mustPreserve: ["executiveConclusion", "conversion"],
    }],
    revisionDirective: {
      required: true,
      mode: "TARGETED",
      fieldsToRewrite: ["content"],
      fieldsLocked: [],
      defectIds: [defectId],
    },
  };
}

function passingJudgeResponse(passNumber = 2) {
  const rubric = fullRubric();
  return {
    contractVersion: JUDGE_CONTRACT_VERSION,
    auditId: AUDIT_ID,
    passNumber,
    judgeModelId: "judge-test",
    judgePromptVersion: "2.0.0",
    evaluatedAt: FIXED_TS,
    hardGate: { status: "PASS", violations: [] },
    rubric,
    totalScore: 100,
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

function responseFor(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
  };
}

async function runScenario(finalJudge) {
  const artifactStore = createMemoryArtifactStore();
  const payloads = [
    validWriterOutput(1),
    revisingJudgeResponse(1),
    revisedWriterOutput(),
    finalJudge,
  ];
  const calls = [];
  const binding = createNarrativeV2LiveBinding({
    env: baseEnv(),
    artifactStore,
    clock: { now: () => FIXED_TS },
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      const payload = payloads[calls.length - 1];
      if (!payload) throw new Error("unexpected fifth paid call");
      return responseFor(payload);
    },
  });
  binding.registerAuditScope(SCOPE);
  const result = await runNarrativeV2Orchestration({
    writerInput: writerInput(),
    writerExecutor: binding.writerExecutor,
    judgeExecutor: binding.judgeExecutor,
  });
  return { result, calls, binding, artifactStore };
}

test("LIVE-REVISION-01: live binding permits exactly Writer1 Judge1 Writer2 Judge2", async () => {
  const { result, calls, binding, artifactStore } = await runScenario(passingJudgeResponse(2));

  assert.equal(NARRATIVE_V2_LIVE_MAX_CALLS, 4);
  assert.equal(NARRATIVE_V2_LIVE_MAX_AUTOMATIC_PASSES, 2);
  assert.equal(binding.config.maxCallsPerAudit, 4);
  assert.equal(binding.config.maxAutomaticPasses, 2);
  assert.equal(binding.writerExecutor.maxAutomaticPasses, 2);
  assert.equal(result.status, NARRATIVE_V2_STATUS.RELEASE_CANDIDATE);
  assert.equal(result.passCount, 2);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => call.model), ["writer-test", "judge-test", "writer-test", "judge-test"]);

  const prefix = `tenants/${SCOPE.tenantId}/clients/${SCOPE.clientId}/audits/${SCOPE.auditId}/report-v2/narrative-v2/live-usage`;
  for (let callNumber = 1; callNumber <= 4; callNumber += 1) {
    const n = String(callNumber).padStart(2, "0");
    assert.equal(await artifactStore.exists(`${prefix}/call-${n}-reservation.json`), true);
    assert.equal(await artifactStore.exists(`${prefix}/call-${n}-result.json`), true);
  }
});

test("LIVE-REVISION-02: Judge2 REVISE routes to human review with no Writer3 or fifth paid call", async () => {
  const { result, calls } = await runScenario(revisingJudgeResponse(2));

  assert.equal(result.status, NARRATIVE_V2_STATUS.HUMAN_REVIEW_REQUIRED);
  assert.equal(result.passCount, 2);
  assert.equal(result.finalJudgeResponse.decision, JUDGE_DECISION.REVISE);
  assert.equal(calls.length, 4, "production live policy must never attempt Writer pass 3");
});

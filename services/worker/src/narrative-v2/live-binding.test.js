import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import {
  createNarrativeV2LiveBinding,
  loadNarrativeV2LiveConfig,
  NARRATIVE_V2_LIVE_MAX_CALLS,
} from "./live-binding.js";
import {
  JUDGE_CONTRACT_VERSION,
  JUDGE_DECISION,
  RUBRIC,
} from "./judge-contract.js";
import {
  WRITER_OUTPUT_VERSION,
  WRITER_PROMPT_VERSION,
} from "./writer-output.js";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";
const REF = "finding:F-001";
const LIMITATION_STATUS_REF = "source:offsite";
const FIXED_TS = "2026-08-20T04:00:00.000Z";
const SCOPE = {
  tenantId: "tenant-live-binding",
  clientId: "client-live-binding",
  auditId: AUDIT_ID,
  executionId: "execution-live-binding",
};

function baseEnv(overrides = {}) {
  return {
    PRYSM_NARRATIVE_V2_ENABLED: "true",
    PRYSM_LLM_MODE: "live",
    PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL: "https://llm.example.test/v1/chat/completions",
    PRYSM_NARRATIVE_V2_API_KEY: "test-secret-never-log",
    PRYSM_NARRATIVE_V2_WRITER_MODEL: "writer-cheap-structured",
    PRYSM_NARRATIVE_V2_JUDGE_MODEL: "judge-cheap-structured",
    PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS: "500000",
    PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_NARRATIVE_V2_TIMEOUT_MS: "5000",
    PRYSM_LLM_SOFT_BUDGET_USD: "0.20",
    PRYSM_LLM_HARD_BUDGET_USD: "0.50",
    PRYSM_LLM_DAILY_HARD_BUDGET_USD: "5.00",
    PRYSM_LLM_DAILY_SPEND_USD: "0",
    PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON: JSON.stringify({
      "writer-cheap-structured": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
      "judge-cheap-structured": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
    }),
    ...overrides,
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
      [LIMITATION_STATUS_REF]: { kind: "source-status", path: "scoreGovernance.sourceDependencies.offsite" },
    },
  };
}

function atom(text, statementClass = "INTERPRETATION") {
  return { text, statementClass, evidenceRefs: [REF] };
}
function opportunity(text) {
  return atom(text, "OPPORTUNITY");
}
function limitationStatusAtom(text) {
  return { text, statementClass: "INTERPRETATION", evidenceRefs: [LIMITATION_STATUS_REF] };
}
function standard(headline, fields) {
  return { headline, ...fields };
}

function validWriterOutput(passNumber = 1) {
  const interpret = (label) => atom(`${label} is tied to the verified finding.`);
  return {
    contractVersion: "1.0.0",
    writerOutputVersion: WRITER_OUTPUT_VERSION,
    auditId: AUDIT_ID,
    passNumber,
    modelId: "writer-cheap-structured",
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
      opportunity: opportunity("Use the governed finding to improve AI-search readiness."),
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
      clientExplanation: limitationStatusAtom("The limitation"),
      whatThisMeans: limitationStatusAtom("What the limitation means"),
      whatThisDoesNotMean: limitationStatusAtom("What the limitation does not mean"),
      impactOnReport: interpret("The limitation impact"),
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

function passingJudgeResponse(passNumber = 1) {
  const rubric = Object.fromEntries(Object.entries(RUBRIC).map(([key, maxScore]) => [key, {
    score: maxScore,
    maxScore,
    status: "PASS",
    rationale: `${key} passes the governed rubric.`,
    evidenceRefs: key === "nonRepetition" ? [] : [REF],
    defectIds: [],
  }]));
  return {
    contractVersion: JUDGE_CONTRACT_VERSION,
    auditId: AUDIT_ID,
    passNumber,
    judgeModelId: "judge-cheap-structured",
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

function responseFor(payload, usage = { prompt_tokens: 100, completion_tokens: 50 }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage,
    }),
  };
}

const clock = { now: () => FIXED_TS };

test("LIVE-BIND-01: disabled by default and requires no live configuration", () => {
  const config = loadNarrativeV2LiveConfig({});
  assert.deepEqual(config, { enabled: false });
  const binding = createNarrativeV2LiveBinding({ env: {}, fetchImpl: () => { throw new Error("must not call"); } });
  assert.equal(binding.enabled, false);
});

test("LIVE-BIND-02: enabling is fail-closed unless PRYSM_LLM_MODE=live", () => {
  assert.throws(
    () => loadNarrativeV2LiveConfig(baseEnv({ PRYSM_LLM_MODE: "mock" })),
    /requires PRYSM_LLM_MODE=live/,
  );
});

test("LIVE-BIND-03: one Writer + one Judge call are validated, cost-ledgered, and capped at two", async () => {
  const artifactStore = createMemoryArtifactStore();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body);
    if (body.model === "writer-cheap-structured") return responseFor(validWriterOutput(1));
    if (body.model === "judge-cheap-structured") return responseFor(passingJudgeResponse(1));
    throw new Error("unexpected model");
  };
  const binding = createNarrativeV2LiveBinding({ env: baseEnv(), fetchImpl, artifactStore, clock });
  binding.registerAuditScope(SCOPE);
  const input = writerInput();

  const writer = await binding.writerExecutor({ prompt: "writer governed prompt", passNumber: 1, writerInput: input });
  assert.equal(writer.passNumber, 1);
  const judge = await binding.judgeExecutor({
    passNumber: 1,
    writerInput: input,
    writerOutput: writer,
    judgeContract: {
      contractVersion: "1.0.0",
      maxNarrativePasses: 3,
      narrativePassScore: 92,
      minimumDimensionRatio: 0.7,
      rubric: RUBRIC,
      hardGateCodes: [],
    },
  });
  assert.equal(judge.decision, "PASS");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://llm.example.test/v1/chat/completions");
  assert.equal(calls[0].options.headers.authorization, "Bearer test-secret-never-log");

  const writerRequest = JSON.parse(calls[0].options.body);
  const judgeRequest = JSON.parse(calls[1].options.body);

  assert.equal(writerRequest.reasoning_effort, "medium");
  assert.equal(writerRequest.max_completion_tokens, 10000);
  assert.equal("temperature" in writerRequest, false);
  assert.equal("max_tokens" in writerRequest, false);

  assert.equal(judgeRequest.reasoning_effort, "medium");
  assert.equal(judgeRequest.max_completion_tokens, 10000);
  assert.equal("temperature" in judgeRequest, false);
  assert.equal("max_tokens" in judgeRequest, false);


  await assert.rejects(
    () => binding.writerExecutor({ prompt: "pass two", passNumber: 2, writerInput: input, previousOutput: writer, judgeResponse: judge }),
    new RegExp(`call cap reached \\(${NARRATIVE_V2_LIVE_MAX_CALLS}\\)`),
  );
  assert.equal(calls.length, 2, "third paid request must not be made");

  const prefix = `tenants/${SCOPE.tenantId}/clients/${SCOPE.clientId}/audits/${SCOPE.auditId}/report-v2/narrative-v2/live-usage`;
  assert.equal(await artifactStore.exists(`${prefix}/call-01-reservation.json`), true);
  assert.equal(await artifactStore.exists(`${prefix}/call-01-result.json`), true);
  assert.equal(await artifactStore.exists(`${prefix}/call-02-reservation.json`), true);
  assert.equal(await artifactStore.exists(`${prefix}/call-02-result.json`), true);
});

test("LIVE-BIND-04: a reserved failed provider call is never silently retried", async () => {
  const artifactStore = createMemoryArtifactStore();
  let calls = 0;
  const binding = createNarrativeV2LiveBinding({
    env: baseEnv(),
    artifactStore,
    clock,
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });
  binding.registerAuditScope(SCOPE);
  const request = { prompt: "writer governed prompt", passNumber: 1, writerInput: writerInput() };
  await assert.rejects(() => binding.writerExecutor(request), /HTTP 503/);
  await assert.rejects(() => binding.writerExecutor(request), /already reserved/);
  assert.equal(calls, 1, "same paid attempt must not execute twice");

  const resultKey = `tenants/${SCOPE.tenantId}/clients/${SCOPE.clientId}/audits/${SCOPE.auditId}/report-v2/narrative-v2/live-usage/call-01-result.json`;
  const result = JSON.parse(Buffer.from(await artifactStore.get(resultKey)).toString("utf8"));
  assert.equal(result.errorCode, "PROVIDER_HTTP_ERROR");
  assert.equal(result.actualCost, null);
});

test("LIVE-BIND-05: token ceiling rejects before reservation and before network", async () => {
  const artifactStore = createMemoryArtifactStore();
  let calls = 0;
  const binding = createNarrativeV2LiveBinding({
    env: baseEnv({ PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS: "10" }),
    artifactStore,
    clock,
    fetchImpl: async () => { calls += 1; return responseFor(validWriterOutput(1)); },
  });
  binding.registerAuditScope(SCOPE);
  await assert.rejects(
    () => binding.writerExecutor({ prompt: "this prompt is deliberately much longer than ten estimated tokens", passNumber: 1, writerInput: writerInput() }),
    /cost preflight rejected writer/,
  );
  assert.equal(calls, 0);
});

test("LIVE-BIND-06: price table and hard budgets are mandatory when enabled", () => {
  assert.throws(
    () => loadNarrativeV2LiveConfig(baseEnv({ PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON: "{}" })),
    /Price table missing model/,
  );
  assert.throws(
    () => loadNarrativeV2LiveConfig(baseEnv({ PRYSM_LLM_HARD_BUDGET_USD: "" })),
    /PRYSM_LLM_HARD_BUDGET_USD must be a positive number/,
  );
});

test("LIVE-BIND-07: Judge cannot execute before a validated Writer result", async () => {
  const artifactStore = createMemoryArtifactStore();
  let calls = 0;
  const binding = createNarrativeV2LiveBinding({
    env: baseEnv(),
    artifactStore,
    clock,
    fetchImpl: async () => { calls += 1; return responseFor(passingJudgeResponse(1)); },
  });
  binding.registerAuditScope(SCOPE);
  await assert.rejects(
    () => binding.judgeExecutor({
      passNumber: 1,
      writerInput: writerInput(),
      writerOutput: validWriterOutput(1),
      judgeContract: { contractVersion: "1.0.0", rubric: RUBRIC },
    }),
    /requires Judge pass 1 as call 2 after Writer pass 1/,
  );
  assert.equal(calls, 0, "out-of-order Judge request must be rejected before network");
});

test("LIVE-BIND-08: missing provider token usage fails closed and is not recorded as zero actual cost", async () => {
  const artifactStore = createMemoryArtifactStore();
  let calls = 0;
  const binding = createNarrativeV2LiveBinding({
    env: baseEnv(),
    artifactStore,
    clock,
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(validWriterOutput(1)) } }],
        }),
      };
    },
  });
  binding.registerAuditScope(SCOPE);
  await assert.rejects(
    () => binding.writerExecutor({ prompt: "writer governed prompt", passNumber: 1, writerInput: writerInput() }),
    /missing governed token usage/,
  );
  assert.equal(calls, 1);

  const resultKey = `tenants/${SCOPE.tenantId}/clients/${SCOPE.clientId}/audits/${SCOPE.auditId}/report-v2/narrative-v2/live-usage/call-01-result.json`;
  const result = JSON.parse(Buffer.from(await artifactStore.get(resultKey)).toString("utf8"));
  assert.equal(result.errorCode, "PROVIDER_USAGE_INVALID");
  assert.equal(result.actualCost, null);
  assert.notEqual(result.actualCost, 0);
});

test("LIVE-BIND-09: same-runtime concurrent duplicate Writer attempts produce only one paid network call", async () => {
  const artifactStore = createMemoryArtifactStore();
  let calls = 0;
  const binding = createNarrativeV2LiveBinding({
    env: baseEnv(),
    artifactStore,
    clock,
    fetchImpl: async () => {
      calls += 1;
      return responseFor(validWriterOutput(1));
    },
  });
  binding.registerAuditScope(SCOPE);
  const request = { prompt: "writer governed prompt", passNumber: 1, writerInput: writerInput() };
  const settled = await Promise.allSettled([
    binding.writerExecutor(request),
    binding.writerExecutor(request),
  ]);

  const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
  const rejected = settled.filter((entry) => entry.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(String(rejected[0].reason?.message || rejected[0].reason), /already being reserved|already reserved/);
  assert.equal(calls, 1, "same-runtime reservation lock must permit only one paid call");
});

test("LIVE-BIND-10: returned Writer model metadata must match the configured model", async () => {
  const artifactStore = createMemoryArtifactStore();
  const wrongModelOutput = { ...validWriterOutput(1), modelId: "unexpected-model" };
  const binding = createNarrativeV2LiveBinding({
    env: baseEnv(),
    artifactStore,
    clock,
    fetchImpl: async () => responseFor(wrongModelOutput),
  });
  binding.registerAuditScope(SCOPE);
  await assert.rejects(
    () => binding.writerExecutor({ prompt: "writer governed prompt", passNumber: 1, writerInput: writerInput() }),
    /modelId must equal configured Writer model writer-cheap-structured/,
  );
});

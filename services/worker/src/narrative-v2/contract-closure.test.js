import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";

import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { buildWriterInput } from "./writer-input.js";
import {
  WRITER_OUTPUT_VERSION,
  WRITER_PROMPT_VERSION,
  validateWriterOutput,
} from "./writer-output.js";
import { buildWriterStructuredOutputSchema } from "./writer-structured-output.js";
import { buildJudgeStructuredOutputSchema } from "./judge-structured-output.js";
import {
  JUDGE_CONTRACT_VERSION,
  RUBRIC,
  validateJudgeResponse,
} from "./judge-contract.js";
import {
  normalizeWriterModelOutput,
  normalizeJudgeModelOutput,
} from "./model-output-normalization.js";
import { createNarrativeV2LiveBinding } from "./live-binding.js";

const AUDIT_ID = "b4e88569-58ed-4e48-8787-981f66b676ad";
const GOV_REF = "scoreGovernance:moduleEligibility";
const CAP_REF = "capability:performance.field";
const FIXED_TS = "2026-08-21T11:24:55.251Z";

function productionShapedWriterInput() {
  return buildWriterInput({
    auditId: AUDIT_ID,
    auditRequest: {
      businessName: "Reboot Business Coaching",
      targetUrl: "https://rebootbusinesscoaching.com/",
      primaryGoal: "generate qualified enquiries",
      market: "Toronto, Canada",
      language: "en-CA",
      services: ["Business coaching"],
      competitors: [],
    },
    scoreSet: {
      contractVersion: "1.0.0",
      scoringVersion: "4.1.0",
      scores: {
        trust: 70,
        contentDepth: 65,
        conversionPathways: 62,
        technical: 78,
        performance: 73,
        conversionReadiness: 68,
        awareness: 72,
        consideration: 66,
        decision: 58,
        aiReadiness: 61,
        conversionPathwaysDimension: 62,
        trustEeatDimension: 70,
        contentFunnelDimension: 65,
        technicalPerformanceDimension: 76,
        entitySchemaAiDimension: 61,
      },
      bands: {
        conversionReadiness: "Moderate",
        trust: "Moderate",
        evidenceConfidence: "High",
      },
      assessedWeight: 92,
      readinessStatus: "Moderate",
      readinessStatusDetail: "Core evidence is available with bounded limitations.",
      showNumericScore: true,
      evidenceConfidenceScore: 90,
      evidenceConfidenceFactors: { website: 100, performance: 80 },
      dimensionEligibility: { conversion_pathways: true, trust_eeat: true },
      moduleEligibility: { technical_hygiene: true, ai_search: true },
      suppressedModules: [],
      rootCause: "Proof and conversion pathways do not consistently match content depth.",
      findingIds: [],
      sourceDependencies: { website: "AVAILABLE", performance: "PARTIAL" },
      conversionPaths: [],
      readinessMap: [],
      contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
      competitors: { comparisons: [], opportunities: { topics: [] } },
      renderingDiagnostics: [],
    },
    findings: [],
    capabilityEvidence: {
      contractVersion: "1.0.0",
      capabilityEvidenceVersion: "2.0.0",
      auditId: AUDIT_ID,
      generatedAt: FIXED_TS,
      capabilities: {
        "performance.field": {
          capability: "performance.field",
          status: "PARTIAL",
          coverage: { requested: 2, completed: 1, failed: 1 },
          provenance: { source: "pagespeed", adapterVersion: "1.0.0", artifactRef: "evidence/performance.json" },
          limitations: ["Field data was not available for every route"],
          requiredFieldsPresent: true,
        },
        "technical.indexability": {
          capability: "technical.indexability",
          status: "AVAILABLE",
          coverage: { requested: 8, completed: 8, failed: 0 },
          provenance: { source: "dataforseo-onpage", adapterVersion: "1.0.0", artifactRef: "evidence/site.json" },
          limitations: [],
          requiredFieldsPresent: true,
        },
      },
      summary: { total: 2, available: 1, partial: 1, assessed: 2 },
    },
  });
}

function atom(text, statementClass = "INTERPRETATION", refs = [GOV_REF]) {
  return { text, statementClass, evidenceRefs: refs };
}
function opportunity(text, refs = [GOV_REF]) {
  return atom(text, "OPPORTUNITY", refs);
}
function standard(headline, fields) {
  return { headline, ...fields };
}

function rawWriterOutput() {
  const interpret = (label) => atom(`${label} is grounded in the governed packet.`);
  return {
    contractVersion: "1.0.0",
    writerOutputVersion: WRITER_OUTPUT_VERSION,
    auditId: AUDIT_ID,
    passNumber: 1,
    modelId: "writer-structured",
    promptVersion: WRITER_PROMPT_VERSION,
    generatedAt: FIXED_TS,
    executiveConclusion: {
      headline: "The site has a credible base with conversion constraints",
      narrative: interpret("The executive conclusion"),
    },
    strengths: [{ itemId: "duplicate-model-id", title: "Useful technical base", narrative: interpret("The strength") }],
    rootCause: {
      headline: "Proof and conversion pathways are inconsistent",
      narrative: interpret("The root cause"),
      businessConsequences: [{ area: "Conversion", narrative: interpret("The consequence") }],
    },
    conversion: standard("Conversion", {
      whatWorks: interpret("Conversion strength"), constraints: interpret("Conversion constraint"),
      businessMeaning: interpret("Conversion meaning"), priority: interpret("Conversion priority"),
    }),
    content: standard("Content", {
      currentStrength: interpret("Content strength"),
      coverageAssessment: atom("Coverage follows governed module eligibility.", "INTERPRETATION", [GOV_REF]),
      qualityAssessment: interpret("Content quality"), topicalArchitecture: interpret("Topical architecture"),
      importantGaps: interpret("Content gap"), businessMeaning: interpret("Content meaning"),
    }),
    funnelOpportunities: {
      awareness: [{
        itemId: "model-funnel-id",
        concept: opportunity("Create a focused awareness concept."),
        userNeed: opportunity("Answer the priority awareness question."),
        rationale: opportunity("Use governed evidence as the rationale."),
        businessObjective: opportunity("Support qualified enquiry generation."),
        nextAction: opportunity("Move the reader to the next governed step."),
      }],
      consideration: [],
      decision: [],
    },
    seoSerp: standard("SEO and SERP", {
      whatWorks: interpret("SEO strength"), constraints: interpret("SEO constraint"),
      searchImplication: interpret("Search implication"), priority: interpret("SEO priority"),
    }),
    aiSearch: standard("AI search", {
      answerability: interpret("AI answerability"),
      entityStrength: atom("Entity strength follows governed module eligibility.", "INTERPRETATION", [GOV_REF]),
      citationReadiness: interpret("Citation readiness"), constraints: interpret("AI constraint"),
      opportunity: opportunity("Strengthen the governed AI-search opportunity."),
    }),
    eeatTrust: standard("E-E-A-T and trust", {
      experience: interpret("Experience"), expertise: interpret("Expertise"), authority: interpret("Authority"),
      trust: interpret("Trust"), proofGaps: interpret("Proof gaps"), businessMeaning: interpret("Trust meaning"),
    }),
    technical: standard("Technical", {
      assessment: interpret("Technical assessment"), materialIssues: interpret("Technical issues"),
      businessMeaning: interpret("Technical meaning"),
    }),
    performanceUx: standard("Performance and UX", {
      assessment: interpret("Performance assessment"), userImpact: interpret("User impact"),
      conversionImpact: interpret("Performance conversion impact"),
    }),
    competitors: standard("Competitors", {
      advantages: interpret("Competitive advantage"), disadvantages: interpret("Competitive disadvantage"),
      marketInterpretation: interpret("Market interpretation"), differentiatorToProtect: interpret("Differentiator"),
    }),
    limitations: [{
      itemId: "model-limitation-id",
      area: "Field performance coverage",
      status: "PARTIAL",
      clientExplanation: atom("Field data is partially available.", "INTERPRETATION", [CAP_REF]),
      whatThisMeans: atom("Performance conclusions are bounded by partial field coverage.", "INTERPRETATION", [CAP_REF, CAP_REF]),
      whatThisDoesNotMean: atom("Partial coverage does not establish poor field performance.", "INTERPRETATION", [CAP_REF]),
      impactOnReport: interpret("The report keeps this limitation explicit"),
    }],
    actionPlan: [{
      actionId: "model-action-id",
      priority: 5,
      title: "Strengthen the highest-value conversion proof",
      action: opportunity("Strengthen the governed proof point."),
      whyNow: opportunity("Address the governed constraint first."),
      expectedBusinessEffect: opportunity("Improve decision confidence without inventing outcomes."),
      effort: "M",
      verification: opportunity("Re-audit the same governed boundary."),
    }],
    executiveDecision: {
      preserve: interpret("Preserve the useful base"),
      change: interpret("Change the constrained proof path"),
      doNext: opportunity("Do the highest-value governed action next"),
    },
  };
}

function rawPassingJudge() {
  const rubric = Object.fromEntries(Object.entries(RUBRIC).map(([key, maxScore]) => [key, {
    score: maxScore,
    maxScore,
    status: "FAIL",
    rationale: `${key} is supported by the governed Writer packet.`,
    evidenceRefs: key === "nonRepetition" ? [] : [GOV_REF, GOV_REF],
    defectIds: ["made-up-id"],
  }]));
  return {
    contractVersion: JUDGE_CONTRACT_VERSION,
    auditId: AUDIT_ID,
    passNumber: 1,
    judgeModelId: "judge-structured",
    judgePromptVersion: "2.0.0",
    evaluatedAt: FIXED_TS,
    hardGate: { status: "FAIL", violations: [] },
    rubric,
    totalScore: 0,
    decision: "REVISE",
    defects: [],
    revisionDirective: {
      required: true,
      mode: "TARGETED",
      fieldsToRewrite: ["content"],
      fieldsLocked: [],
      defectIds: ["made-up-id"],
    },
  };
}

function baseEnv() {
  return {
    PRYSM_NARRATIVE_V2_ENABLED: "true",
    PRYSM_LLM_MODE: "live",
    PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL: "https://llm.example.test/v1/chat/completions",
    PRYSM_NARRATIVE_V2_API_KEY: "test-secret-never-log",
    PRYSM_NARRATIVE_V2_WRITER_MODEL: "writer-structured",
    PRYSM_NARRATIVE_V2_JUDGE_MODEL: "judge-structured",
    PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS: "500000",
    PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_NARRATIVE_V2_TIMEOUT_MS: "5000",
    PRYSM_LLM_SOFT_BUDGET_USD: "0.20",
    PRYSM_LLM_HARD_BUDGET_USD: "0.50",
    PRYSM_LLM_DAILY_HARD_BUDGET_USD: "5.00",
    PRYSM_LLM_DAILY_SPEND_USD: "0",
    PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON: JSON.stringify({
      "writer-structured": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
      "judge-structured": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
    }),
  };
}

function providerResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
  };
}

test("CONTRACT-CLOSURE-01: every exposed governance/band evidence class has a canonical reference", () => {
  const input = productionShapedWriterInput();
  assert.equal(input.referenceIndex[GOV_REF].kind, "score-governance");
  assert.equal(input.referenceIndex["band:conversionReadiness"].kind, "score-band");
  assert.equal(input.referenceIndex[CAP_REF].kind, "capability");
  assert.equal(input.referenceIndex["capability:technical.indexability"].kind, "capability");
  assert.equal(input.referenceIndex["source:performance"].kind, "source-status");
});

test("CONTRACT-CLOSURE-02: Writer strict schema binds ordinary atoms to exact referenceIndex IDs", () => {
  const input = productionShapedWriterInput();
  const schema = buildWriterStructuredOutputSchema({ writerInput: input, passNumber: 1, modelId: "writer-structured" });
  assert.ok(schema.$defs.evidenceRef.enum.includes(GOV_REF));
  assert.deepEqual(schema.properties.content.properties.coverageAssessment.properties.evidenceRefs.items, { $ref: "#/$defs/evidenceRef" });
  assert.equal(schema.properties.content.properties.coverageAssessment.properties.evidenceRefs.minItems, 1);

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = rawWriterOutput();
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));
  valid.content.coverageAssessment.evidenceRefs = ["scoreGovernance:notCanonical"];
  assert.equal(validate(valid), false);
});

test("CONTRACT-CLOSURE-03: deterministic Writer normalization removes duplicate refs and canonicalizes structural IDs", () => {
  const input = productionShapedWriterInput();
  const normalized = normalizeWriterModelOutput(rawWriterOutput());
  assert.deepEqual(normalized.limitations[0].whatThisMeans.evidenceRefs, [CAP_REF]);
  assert.equal(normalized.strengths[0].itemId, "STR-01");
  assert.equal(normalized.funnelOpportunities.awareness[0].itemId, "FUN-A-01");
  assert.equal(normalized.limitations[0].itemId, "LIM-01");
  assert.equal(normalized.actionPlan[0].actionId, "ACT-01");
  assert.equal(normalized.actionPlan[0].priority, 1);
  assert.deepEqual(validateWriterOutput(normalized, { writerInput: input, expectedPassNumber: 1 }), { valid: true, errors: [] });
});

test("CONTRACT-CLOSURE-04: Judge strict schema binds evidence and normalization derives deterministic decision wiring", () => {
  const input = productionShapedWriterInput();
  const schema = buildJudgeStructuredOutputSchema({ writerInput: input, passNumber: 1, modelId: "judge-structured" });
  assert.ok(schema.$defs.evidenceRef.enum.includes(GOV_REF));
  assert.deepEqual(schema.properties.rubric.properties.evidenceFidelity.properties.evidenceRefs.items, { $ref: "#/$defs/evidenceRef" });

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateSchema = ajv.compile(schema);
  const raw = rawPassingJudge();
  assert.equal(validateSchema(raw), true, JSON.stringify(validateSchema.errors));
  raw.rubric.businessRelevance.evidenceRefs = ["finding:DOES-NOT-EXIST"];
  assert.equal(validateSchema(raw), false);

  const normalized = normalizeJudgeModelOutput(rawPassingJudge());
  assert.equal(normalized.totalScore, 100);
  assert.equal(normalized.decision, "PASS");
  assert.equal(normalized.hardGate.status, "PASS");
  assert.equal(normalized.revisionDirective.required, false);
  assert.equal(normalized.revisionDirective.mode, "NONE");
  assert.deepEqual(normalized.revisionDirective.defectIds, []);
  assert.deepEqual(normalized.rubric.businessRelevance.evidenceRefs, [GOV_REF]);
  assert.deepEqual(normalized.rubric.businessRelevance.defectIds, []);
  assert.deepEqual(validateJudgeResponse(normalized, { writerInput: input, expectedPassNumber: 1 }), { valid: true, errors: [] });
});

test("CONTRACT-CLOSURE-05: live binding sends strict schemas for Writer and Judge and preserves raw responses", async () => {
  const input = productionShapedWriterInput();
  const artifactStore = createMemoryArtifactStore();
  const calls = [];
  const binding = createNarrativeV2LiveBinding({
    env: baseEnv(),
    artifactStore,
    clock: { now: () => FIXED_TS },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return body.model === "writer-structured"
        ? providerResponse(rawWriterOutput())
        : providerResponse(rawPassingJudge());
    },
  });
  binding.registerAuditScope({ tenantId: "omnipresence", clientId: "reboot", auditId: AUDIT_ID, executionId: "closure-test" });

  const writer = await binding.writerExecutor({ prompt: "writer governed prompt", passNumber: 1, writerInput: input });
  const judge = await binding.judgeExecutor({
    passNumber: 1,
    writerInput: input,
    writerOutput: writer,
    judgeContract: { contractVersion: "1.0.0", rubric: RUBRIC },
  });

  assert.equal(writer.actionPlan[0].priority, 1);
  assert.equal(judge.decision, "PASS");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].response_format.type, "json_schema");
  assert.equal(calls[0].response_format.json_schema.strict, true);
  assert.equal(calls[1].response_format.type, "json_schema");
  assert.equal(calls[1].response_format.json_schema.strict, true);
  assert.equal(calls[1].response_format.json_schema.name, "prysm_narrative_v2_judge_response");

  const prefix = `tenants/omnipresence/clients/reboot/audits/${AUDIT_ID}/report-v2/narrative-v2/live-usage`;
  assert.equal(await artifactStore.exists(`${prefix}/call-01-response.json`), true);
  assert.equal(await artifactStore.exists(`${prefix}/call-02-response.json`), true);
  const rawWriter = JSON.parse(Buffer.from(await artifactStore.get(`${prefix}/call-01-response.json`)).toString("utf8"));
  assert.deepEqual(rawWriter.limitations[0].whatThisMeans.evidenceRefs, [CAP_REF, CAP_REF]);
});

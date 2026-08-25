import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createLocalReportStore } from "../storage/report-store.js";
import { createProductionRuntime } from "./production-runtime.js";
import { LIFECYCLE_STATE } from "../lifecycle/state-enum.js";
import {
  JUDGE_CONTRACT_VERSION,
  JUDGE_DECISION,
  RUBRIC,
} from "../narrative-v2/judge-contract.js";
import {
  WRITER_OUTPUT_VERSION,
  WRITER_PROMPT_VERSION,
} from "../narrative-v2/writer-output.js";
import {
  buildV2Model,
  createNarrativeV2ProductionPath,
} from "../narrative-v2/production-path.js";

const T = LIFECYCLE_STATE;
const tenantId = "narrative-v2-prod-tenant";
const testBaseDir = mkdtempSync(join(tmpdir(), "prysm-narrative-v2-prod-"));
const FIXED_TS = "2026-08-20T04:30:00.000Z";

function baseConfig() {
  return {
    artifactDir: join(testBaseDir, "artifacts"),
    webhookSecret: "",
    vantageTenantId: tenantId,
    databaseUrl: "",
    onpagePollTimeoutMs: 5000,
    narrativeMode: "mock",
    port: 3000,
    reportsBucket: "",
    awsRegion: "ca-central-1",
    reportsPrefix: "vantage/reports",
  };
}

function okSourceResult(source, evidence = {}) {
  return {
    contractVersion: "1.0.0",
    schemaVersion: "1.0.0",
    source,
    provider: "mock",
    adapterVersion: "1.0.0",
    status: "AVAILABLE",
    startedAt: FIXED_TS,
    completedAt: FIXED_TS,
    retryCount: 0,
    coverage: { requested: 1, completed: 1, failed: 0 },
    limitations: [],
    evidence,
  };
}

function workingAdapters() {
  const siteEvidence = {
    sourceStatus: "AVAILABLE",
    domain: "proof.example.com",
    targetUrl: "https://proof.example.com",
    pageCount: 1,
    pages: [{
      url: "https://proof.example.com",
      title: "Proof",
      headings: { h1: ["Proof"], h2: [], h3: [], h4: [] },
      description: "Governed proof page",
      content: { text: "governed evidence ".repeat(40), wordCount: 80 },
      images: [],
      links: { internal: [], external: [] },
      responseHeaders: {},
      statusCode: 200,
    }],
    services: ["Governed Evidence Service"],
    topicKeywords: ["governed evidence"],
    ctas: [{ text: "Contact", url: "https://proof.example.com/contact", kind: "link" }],
    externalCtas: [],
    forms: [{ action: "/contact" }],
    trust: { credentials: true, testimonials: true, caseStudies: false, faq: false, pricing: false, policies: true, contact: true },
    platform: "ProofCMS",
    schemaTypes: ["ProfessionalService"],
    microdataTypes: [],
    socialLinks: [],
    statusCounts: { "200": 1 },
    totalWords: 300,
    averageWords: 300,
    missingTitles: 0,
    missingDescriptions: 0,
    missingCanonicals: 0,
    h1Missing: 0,
    h1Multiple: 0,
    imageCount: 0,
    imagesMissingAlt: 0,
    internalLinkCount: 2,
    brokenInternalLinks: [],
    securityHeaders: {},
    _contentEvidenceAvailable: true,
    _responseHeadersAvailable: false,
    collectedAt: FIXED_TS,
  };

  return {
    "dataforseo-onpage": {
      adapterVersion: "1.0.0",
      execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("dataforseo-onpage", siteEvidence) }),
    },
    pagespeed: {
      adapterVersion: "1.0.0",
      execute: async () => ({
        rawBytes: null,
        contentType: null,
        sourceResult: okSourceResult("pagespeed", {
          sourceStatus: "AVAILABLE",
          fallbackUsed: false,
          testedUrls: ["https://proof.example.com"],
          mobile: { status: "AVAILABLE", source: "psi", scores: { performance: 73, accessibility: 92, bestPractices: 85, seo: 90 }, metrics: { fcpMs: 1200, lcpMs: 1800, cls: 0.05, tbtMs: 200 } },
          desktop: { status: "AVAILABLE", source: "psi", scores: { performance: 88, accessibility: 94, bestPractices: 88, seo: 92 }, metrics: { fcpMs: 600, lcpMs: 900, cls: 0.02, tbtMs: 80 } },
          collectedAt: FIXED_TS,
        }),
      }),
    },
    "dataforseo-serp": {
      adapterVersion: "1.0.0",
      execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("dataforseo-serp", { competitors: [], suppliedCompetitors: [], audienceScope: "local", providerLocation: "Toronto", keywordCount: 1, resultCount: 0 }) }),
    },
    backlinks: {
      adapterVersion: "1.0.0",
      execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("backlinks", { sourceStatus: "AVAILABLE", goodCount: 5 }) }),
    },
    ga4: {
      adapterVersion: "1.0.0",
      execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("ga4", { sourceStatus: "AVAILABLE", totals: { sessions: 1000 } }) }),
    },
    gsc: {
      adapterVersion: "1.0.0",
      execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("gsc", { sourceStatus: "AVAILABLE", totals: { clicks: 500 } }) }),
    },
  };
}

function wrapRepo(baseRepo) {
  const metaStore = new Map();
  return {
    ...baseRepo,
    updateAuditMetadata: async (auditId, t, patch) => {
      metaStore.set(auditId, { ...(metaStore.get(auditId) || {}), ...patch });
    },
    getAuditMetadata: async (auditId) => metaStore.get(auditId) || null,
  };
}

function baseInput() {
  return {
    targetUrl: "https://proof.example.com",
    businessName: "Narrative V2 Production Proof",
    market: "Toronto, Ontario",
    language: "en-CA",
    primaryGoal: "book a consultation",
    services: ["Governed Evidence Service"],
    crawl: { pathValidationEnabled: false },
  };
}

function atom(text, ref, statementClass = "INTERPRETATION") {
  return { text, statementClass, evidenceRefs: [ref] };
}

function valueAtPath(object, path) {
  return String(path || "").split(".").reduce((value, key) => value?.[key], object);
}

function governedStatusReference(writerInput) {
  for (const [ref, record] of Object.entries(writerInput.referenceIndex || {})) {
    if (record?.kind === "source-status") {
      const status = valueAtPath(writerInput, record.path);
      if (typeof status === "string" && status.length > 0) return { ref, status };
    }
    if (record?.kind === "capability") {
      const capability = valueAtPath(writerInput, record.path);
      if (typeof capability?.status === "string" && capability.status.length > 0) {
        return { ref, status: capability.status };
      }
    }
  }
  return null;
}

function buildPassingWriterOutput({ writerInput, passNumber }) {
  const ref = Object.keys(writerInput.referenceIndex)[0];
  assert.ok(ref, "WriterInput must expose at least one governed reference");
  const governedStatus = governedStatusReference(writerInput);
  const interpret = (label) => atom(`${label} is tied to the governed audit evidence.`, ref);
  const limitationInterpret = (label) => atom(`${label} is tied to the governed source status.`, governedStatus.ref);
  const opportunity = (label) => atom(`${label} is a governed opportunity.`, ref, "OPPORTUNITY");
  const standard = (headline, fields) => ({ headline, ...fields });

  return {
    contractVersion: "1.0.0",
    writerOutputVersion: WRITER_OUTPUT_VERSION,
    auditId: writerInput.auditId,
    passNumber,
    modelId: "writer-controlled-test",
    promptVersion: WRITER_PROMPT_VERSION,
    generatedAt: FIXED_TS,
    executiveConclusion: { headline: "Governed conclusion", narrative: interpret("Executive conclusion") },
    strengths: [{ itemId: "STR-01", title: "Verified strength", narrative: interpret("Verified strength") }],
    rootCause: {
      headline: "Governed root cause",
      narrative: interpret("Root cause"),
      businessConsequences: [{ area: "Conversion", narrative: interpret("Business consequence") }],
    },
    conversion: standard("Conversion", {
      whatWorks: interpret("Conversion strength"), constraints: interpret("Conversion constraint"),
      businessMeaning: interpret("Conversion meaning"), priority: interpret("Conversion priority"),
    }),
    content: standard("Content and topical architecture", {
      currentStrength: interpret("Content strength"), coverageAssessment: interpret("Content coverage"),
      qualityAssessment: interpret("Content quality"), topicalArchitecture: interpret("Topical architecture"),
      importantGaps: interpret("Content gap"), businessMeaning: interpret("Content meaning"),
    }),
    funnelOpportunities: {
      awareness: [{
        itemId: "FUN-A-01",
        concept: opportunity("Awareness concept"),
        userNeed: opportunity("Awareness user need"),
        rationale: opportunity("Awareness rationale"),
        businessObjective: opportunity("Awareness business objective"),
        nextAction: opportunity("Awareness next action"),
      }],
      consideration: [],
      decision: [],
    },
    seoSerp: standard("SEO and SERP", {
      whatWorks: interpret("SEO strength"), constraints: interpret("SEO constraint"),
      searchImplication: interpret("Search implication"), priority: interpret("SEO priority"),
    }),
    aiSearch: standard("AI search readiness", {
      answerability: interpret("AI answerability"), entityStrength: interpret("AI entity strength"),
      citationReadiness: interpret("AI citation readiness"), constraints: interpret("AI search constraint"),
      opportunity: opportunity("AI search opportunity"),
    }),
    eeatTrust: standard("E-E-A-T and trust", {
      experience: interpret("Experience"), expertise: interpret("Expertise"), authority: interpret("Authority"),
      trust: interpret("Trust"), proofGaps: interpret("Proof gap"), businessMeaning: interpret("Trust meaning"),
    }),
    technical: standard("Technical foundations", {
      assessment: interpret("Technical assessment"), materialIssues: interpret("Technical issue"), businessMeaning: interpret("Technical meaning"),
    }),
    performanceUx: standard("Performance and UX", {
      assessment: interpret("Performance assessment"), userImpact: interpret("User impact"), conversionImpact: interpret("Conversion impact"),
    }),
    competitors: standard("Competitive position", {
      advantages: interpret("Competitive advantage"), disadvantages: interpret("Competitive disadvantage"),
      marketInterpretation: interpret("Competitive interpretation"), differentiatorToProtect: interpret("Differentiator"),
    }),
    limitations: governedStatus
  ? [{
      itemId: "LIM-01",
      area: "Evidence boundary",
      status: governedStatus.status,
      clientExplanation: limitationInterpret("Limitation explanation"),
      whatThisMeans: limitationInterpret("Limitation meaning"),
      whatThisDoesNotMean: limitationInterpret("Limitation non-meaning"),
      impactOnReport: limitationInterpret("Limitation impact"),
    }]
  : [],
    actionPlan: [{
      actionId: "ACT-01",
      priority: 1,
      title: "Governed priority",
      action: opportunity("Governed action"),
      whyNow: opportunity("Governed why now"),
      expectedBusinessEffect: opportunity("Governed business effect"),
      effort: "M",
      verification: opportunity("Governed verification"),
    }],
    executiveDecision: {
      preserve: interpret("Preserve"),
      change: interpret("Change"),
      doNext: opportunity("Do next"),
    },
  };
}

function buildPassingJudgeResponse({ writerInput, passNumber }) {
  const ref = Object.keys(writerInput.referenceIndex)[0];
  const rubric = Object.fromEntries(Object.entries(RUBRIC).map(([key, maxScore]) => [key, {
    score: maxScore,
    maxScore,
    status: "PASS",
    rationale: `${key} passes the governed rubric.`,
    evidenceRefs: key === "nonRepetition" ? [] : [ref],
    defectIds: [],
  }]));
  return {
    contractVersion: JUDGE_CONTRACT_VERSION,
    auditId: writerInput.auditId,
    passNumber,
    judgeModelId: "judge-controlled-test",
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

function buildRevisingJudgeResponse({
  writerInput,
  passNumber,
}) {
  const response = structuredClone(
    buildPassingJudgeResponse({
      writerInput,
      passNumber,
    }),
  );

  const ref =
    Object.keys(writerInput.referenceIndex)[0];

  const defectId =
    `D-CONTINUATION-${passNumber}`;

  response.rubric.contentFunnelDepth = {
    score: 5,
    maxScore: RUBRIC.contentFunnelDepth,
    status: "FAIL",
    rationale:
      "The content section requires a more specific governed explanation.",
    evidenceRefs: [ref],
    defectIds: [defectId],
  };

  response.totalScore = Object.values(
    response.rubric,
  ).reduce(
    (sum, record) => sum + record.score,
    0,
  );

  response.decision = JUDGE_DECISION.REVISE;

  response.defects = [{
    defectId,
    criterion: "contentFunnelDepth",
    section: "content",
    severity: "MINOR",
    problem:
      "The content explanation remains too generic.",
    whyItMatters:
      "The client needs the governed content gap stated precisely.",
    evidenceRefs: [ref],
    requiredCorrection:
      "Rewrite only the content section to state the governed gap precisely.",
    allowedFields: ["content"],
    mustPreserve: [
      "executiveConclusion",
      "conversion",
    ],
  }];

  response.revisionDirective = {
    required: true,
    mode: "TARGETED",
    fieldsToRewrite: ["content"],
    fieldsLocked: [],
    defectIds: [defectId],
  };

  return response;
}

function buildHumanReviewJudgeResponse({
  writerInput,
  passNumber,
}) {
  const response =
    buildRevisingJudgeResponse({
      writerInput,
      passNumber,
    });

  response.decision =
    JUDGE_DECISION.HUMAN_REVIEW_REQUIRED;

  response.revisionDirective = {
    required: false,
    mode: "HUMAN_REVIEW",
    fieldsToRewrite: [],
    fieldsLocked: [],
    defectIds:
      response.defects.map(
        (defect) => defect.defectId,
      ),
  };

  return response;
}

function buildTargetedWriterRevision({
  previousOutput,
  passNumber,
}) {
  const output =
    structuredClone(previousOutput);

  output.passNumber = passNumber;

  output.content = {
    ...output.content,
    headline:
      `Content and topical architecture governed revision ${passNumber}`,
    importantGaps: {
      ...output.content.importantGaps,
      text:
        `The governed content gap is specifically corrected in pass ${passNumber}.`,
    },
    businessMeaning: {
      ...output.content.businessMeaning,
      text:
        `The governed business meaning is specifically clarified in pass ${passNumber}.`,
    },
  };

  return output;
}

async function buildContinuationFixture({
  finalJudgeOutcome,
}) {
  const auditId =
    "88888888-8888-4888-8888-888888888888";

  const auditRequest = {
    contractVersion: "1.0.0",
    auditId,
    tenantId,
    clientId: "narrative-continuation-client",
    report: {
      designVersion: "2.0.0",
      narrativeVersion: "2.0.0",
    },
  };

  const writerInput = {
    contractVersion: "1.0.0",
    writerInputVersion: "1.0.0",
    auditId,
    scoreGovernance: {
      sourceDependencies: {
        offsite: "UNAVAILABLE",
      },
    },
    referenceIndex: {
      "finding:F-001": {
        kind: "finding",
        path: "findings.F-001",
      },
      "source:offsite": {
        kind: "source-status",
        path:
          "scoreGovernance.sourceDependencies.offsite",
      },
    },
  };

  const pass1Writer =
    buildPassingWriterOutput({
      writerInput,
      passNumber: 1,
    });

  const pass1Judge =
    buildRevisingJudgeResponse({
      writerInput,
      passNumber: 1,
    });

  const pass2Writer =
    buildTargetedWriterRevision({
      previousOutput: pass1Writer,
      passNumber: 2,
    });

  const pass2Judge =
    buildRevisingJudgeResponse({
      writerInput,
      passNumber: 2,
    });

  const originalOrchestration = {
    contractVersion: "1.0.0",
    orchestrationVersion: "1.0.0",
    auditId,
    status: "HUMAN_REVIEW_REQUIRED",
    passCount: 2,
    finalWriterOutput: pass2Writer,
    finalJudgeResponse: pass2Judge,
    passes: [
      {
        passNumber: 1,
        writerOutput: pass1Writer,
        judgeResponse: pass1Judge,
      },
      {
        passNumber: 2,
        writerOutput: pass2Writer,
        judgeResponse: pass2Judge,
      },
    ],
  };

  const artifactStore =
    createMemoryArtifactStore();

  const originalOrchestrationKey =
    `tenants/${tenantId}`
    + `/clients/${auditRequest.clientId}`
    + `/audits/${auditId}`
    + `/report-v2/narrative-v2/orchestration.json`;

  const finalOrchestrationKey =
    `tenants/${tenantId}`
    + `/clients/${auditRequest.clientId}`
    + `/audits/${auditId}`
    + `/report-v2/narrative-v2/orchestration-final-pass.json`;

  await putJson(
    artifactStore,
    {
      tenantId,
      clientId: auditRequest.clientId,
      auditId,
      category: "report-v2",
      artifactName:
        "narrative-v2/writer-input.json",
    },
    writerInput,
  );

  await putJson(
    artifactStore,
    {
      tenantId,
      clientId: auditRequest.clientId,
      auditId,
      category: "report-v2",
      artifactName:
        "narrative-v2/orchestration.json",
    },
    originalOrchestration,
  );

  const lifecycleState = {
    state: T.NARRATIVE_FAILED,
  };

  const lifecycleTransitions = [];

  const lifecycleService = {
    currentState: async () =>
      lifecycleState,

    transition: async ({ toState }) => {
      lifecycleTransitions.push(toState);
      lifecycleState.state = toState;
      return {
        state: toState,
      };
    },
  };

  let baseCallCount = 0;
  let writerCallCount = 0;
  let judgeCallCount = 0;

  const authorizationRecords = [];

  const productionPath =
    createNarrativeV2ProductionPath({
      baseOrchestrator: {
        execute: async () => {
          baseCallCount += 1;
          throw new Error(
            "continuation must not invoke base collection/scoring",
          );
        },
      },

      lifecycleService,
      artifactStore,

      validateContract: () => ({
        valid: true,
        errors: [],
      }),

      enabled: true,

      authorizeFinalPass: ({
        auditId: authorizedAuditId,
        authorizationId,
      }) => {
        authorizationRecords.push({
          auditId: authorizedAuditId,
          authorizationId,
        });

        return {
          auditId: authorizedAuditId,
          authorizationId,
          authorizedAt: FIXED_TS,
        };
      },

      writerExecutor: async ({
        writerInput: executionWriterInput,
        passNumber,
        previousOutput,
        judgeResponse,
      }) => {
        writerCallCount += 1;

        assert.equal(passNumber, 3);
        assert.equal(
          executionWriterInput.auditId,
          auditId,
        );
        assert.deepEqual(
          previousOutput,
          pass2Writer,
        );
        assert.deepEqual(
          judgeResponse,
          pass2Judge,
        );

        return buildTargetedWriterRevision({
          previousOutput,
          passNumber,
        });
      },

      judgeExecutor: async ({
        writerInput: executionWriterInput,
        passNumber,
      }) => {
        judgeCallCount += 1;

        assert.equal(passNumber, 3);

        if (
          finalJudgeOutcome
          === "HUMAN_REVIEW_REQUIRED"
        ) {
          return buildHumanReviewJudgeResponse({
            writerInput:
              executionWriterInput,
            passNumber,
          });
        }

        return buildPassingJudgeResponse({
          writerInput:
            executionWriterInput,
          passNumber,
        });
      },

      clock: {
        now: () => FIXED_TS,
      },
    });

  return {
    auditRequest,
    artifactStore,
    productionPath,
    originalOrchestration,
    originalOrchestrationKey,
    finalOrchestrationKey,
    transitions: () => [
      ...lifecycleTransitions,
    ],
    authorizations: () => [
      ...authorizationRecords,
    ],
    baseCalls: () => baseCallCount,
    writerCalls: () => writerCallCount,
    judgeCalls: () => judgeCallCount,
  };
}




function buildRuntime({
  narrativeV2,
  adapters = workingAdapters(),
} = {}) {
  const artifactStore = createMemoryArtifactStore();
  const reportStore = createLocalReportStore({
    baseDir: join(
      testBaseDir,
      `reports-${randomUUID().slice(0, 8)}`,
    ),
  });

  const runtime = createProductionRuntime({
    config: baseConfig(),
    adapters,
    validateContract: () => ({
      valid: true,
      errors: [],
    }),
    artifactStore,
    lifecycleRepo: wrapRepo(
      createMemoryLifecycleRepository(),
    ),
    reportStore,
    narrativeV2,
  });

  return {
    runtime,
    artifactStore,
  };
}

async function waitForState(runtime, auditId, states, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cs = await runtime.lifecycleService.currentState(auditId, tenantId);
    if (states.includes(cs?.state)) return cs;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return runtime.lifecycleService.currentState(auditId, tenantId);
}

async function readJson(store, key) {
  const bytes = await store.get(key);
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

async function putJson(store, scope, value) {
  return store.put({
    bytes: Buffer.from(JSON.stringify(value), "utf8"),
    contentType: "application/json",
    scope,
  });
}

test("NV2-PROD-01: disabled runtime rejects an explicit Narrative v2 request instead of silently falling back", async () => {
  const { runtime } = buildRuntime();
  await assert.rejects(
    runtime.auditService.createAudit({
      ...baseInput(),
      report: { designVersion: "2.0.0", narrativeVersion: "2.0.0" },
    }, tenantId),
    (err) => err?.code === "NARRATIVE_V2_DISABLED" && err?.statusCode === 409,
  );
});

test("NV2-PROD-02: enabled explicit Narrative v2 runs one controlled Writer/Judge pass and renders the governed layer", async () => {
  let writerCalls = 0;
  let judgeCalls = 0;
  const { runtime, artifactStore } = buildRuntime({
    narrativeV2: {
      enabled: true,
      writerExecutor: async ({ writerInput, passNumber }) => {
        writerCalls += 1;
        return buildPassingWriterOutput({ writerInput, passNumber });
      },
      judgeExecutor: async ({ writerInput, passNumber }) => {
        judgeCalls += 1;
        return buildPassingJudgeResponse({ writerInput, passNumber });
      },
    },
  });

  const created = await runtime.auditService.createAudit({
    ...baseInput(),
    report: { designVersion: "2.0.0", narrativeVersion: "2.0.0" },
  }, tenantId);

  const state = await waitForState(runtime, created.auditId, [T.DRAFT_RENDERED, T.NARRATIVE_FAILED, T.RENDER_FAILED]);
  assert.equal(state?.state, T.DRAFT_RENDERED);
  assert.equal(state?.state, T.DRAFT_RENDERED);
  assert.equal(writerCalls, 1, "Writer must execute exactly once for a first-pass release candidate");
  assert.equal(judgeCalls, 1, "Judge must execute exactly once for a first-pass release candidate");

  const requestKey = `tenants/${tenantId}/clients/${created.clientId}/audits/${created.auditId}/canonical/audit-request.json`;
  const persistedRequest = await readJson(artifactStore, requestKey);
  assert.equal(persistedRequest.report?.designVersion, "2.0.0");
  assert.equal(persistedRequest.report?.narrativeVersion, "2.0.0");

  const writerInputKey = `tenants/${tenantId}/clients/${created.clientId}/audits/${created.auditId}/report-v2/narrative-v2/writer-input.json`;
  const orchestrationKey = `tenants/${tenantId}/clients/${created.clientId}/audits/${created.auditId}/report-v2/narrative-v2/orchestration.json`;
  const pageKey = `tenants/${tenantId}/clients/${created.clientId}/audits/${created.auditId}/report-v2/pages/index.html`;
  const oldNarrativeKey = `tenants/${tenantId}/clients/${created.clientId}/audits/${created.auditId}/report/narrative.json`;

  const writerInput = await readJson(artifactStore, writerInputKey);
  const orchestration = await readJson(artifactStore, orchestrationKey);
  const html = Buffer.from(await artifactStore.get(pageKey)).toString("utf8");

  assert.equal(writerInput.auditId, created.auditId);
  assert.equal(orchestration.status, "RELEASE_CANDIDATE");
  assert.equal(orchestration.passCount, 1);
  assert.match(html, /id="narrative-layer"/);
  assert.match(html, /A\. Conversion Readiness/);
  assert.match(html, /Evidence detail/);
  assert.equal(await artifactStore.exists(oldNarrativeKey), false, "Narrative v2 must not run/persist the legacy WP9 narrative artifact");
});

test("NV2-PROD-03: enabled runtime fails startup when either governed executor seam is missing", () => {
  assert.throws(
    () => buildRuntime({ narrativeV2: { enabled: true, writerExecutor: async () => ({}) } }),
    /requires writerExecutor and judgeExecutor/i,
  );
  assert.throws(
    () => buildRuntime({ narrativeV2: { enabled: true, judgeExecutor: async () => ({}) } }),
    /requires writerExecutor and judgeExecutor/i,
  );
});

test("NV2-PROD-04: default report-design v2 remains on the existing narrative/render path when narrativeVersion is not selected", async () => {
  let writerCalls = 0;
  let judgeCalls = 0;
  const { runtime, artifactStore } = buildRuntime({
    narrativeV2: {
      enabled: true,
      writerExecutor: async () => { writerCalls += 1; throw new Error("must not run"); },
      judgeExecutor: async () => { judgeCalls += 1; throw new Error("must not run"); },
    },
  });

  const created = await runtime.auditService.createAudit({
    ...baseInput(),
    report: { designVersion: "2.0.0" },
  }, tenantId);
  const state = await waitForState(runtime, created.auditId, [T.DRAFT_RENDERED, T.NARRATIVE_FAILED, T.RENDER_FAILED]);
  assert.equal(state?.state, T.DRAFT_RENDERED);
  assert.equal(writerCalls, 0);
  assert.equal(judgeCalls, 0);

  const pageKey = `tenants/${tenantId}/clients/${created.clientId}/audits/${created.auditId}/report-v2/pages/index.html`;
  const html = Buffer.from(await artifactStore.get(pageKey)).toString("utf8");
  assert.doesNotMatch(html, /id="narrative-layer"/);
});

test("NV2-PROD-05: production v2 model preserves readiness detail and rendering diagnostics from the persisted ScoreSet", () => {
  const model = buildV2Model({
    auditRequest: { businessName: "Proof", targetUrl: "https://proof.example.com" },
    scoreSet: {
      scoringVersion: "4.1.1",
      generatedAt: FIXED_TS,
      scores: {},
      bands: {},
      readinessStatus: "Directional",
      readinessStatusDetail: "SENTINEL readiness detail retained from persisted scores",
      renderingDiagnostics: [{ diagnosticCode: "SENTINEL-DIAGNOSTIC", diagnosticCategory: "SITE_RENDERING" }],
    },
    findings: [],
    capabilityEvidence: { capabilities: {}, summary: { total: 0, assessed: 0 } },
    decisionEvidence: { site: { targetUrl: "https://proof.example.com" } },
  });

  assert.equal(model.readinessStatusDetail, "SENTINEL readiness detail retained from persisted scores");
  assert.deepEqual(model.renderingDiagnostics, [{ diagnosticCode: "SENTINEL-DIAGNOSTIC", diagnosticCategory: "SITE_RENDERING" }]);
});

test("DQV-005: canonical FAILED competitor status reaches Viewer v2 and the persisted manifest", async () => {
  const adapters = workingAdapters();

  adapters["dataforseo-serp"] = {
    adapterVersion: "1.0.0",
    execute: async () => ({
      rawBytes: null,
      contentType: null,
      sourceResult: {
        contractVersion: "1.0.0",
        schemaVersion: "1.0.0",
        source: "dataforseo-serp",
        provider: "mock",
        adapterVersion: "1.0.0",
        status: "FAILED",
        startedAt: FIXED_TS,
        completedAt: FIXED_TS,
        retryCount: 0,
        expectedRecords: 1,
        returnedRecords: 0,
        errorCategory: "internal",
        coverage: {
          requested: 1,
          completed: 0,
          failed: 1,
        },
        limitations: ["Mock SERP provider failure"],
        evidence: {
          competitors: [],
          suppliedCompetitors: [],
          audienceScope: "local",
          providerLocation: "Toronto",
          keywordCount: 1,
          resultCount: 0,
        },
      },
    }),
  };

  const { runtime, artifactStore } = buildRuntime({
    adapters,
    narrativeV2: {
      enabled: true,
      writerExecutor: async ({
        writerInput,
        passNumber,
      }) =>
        buildPassingWriterOutput({
          writerInput,
          passNumber,
        }),
      judgeExecutor: async ({
        writerInput,
        passNumber,
      }) =>
        buildPassingJudgeResponse({
          writerInput,
          passNumber,
        }),
    },
  });

  const created = await runtime.auditService.createAudit(
    {
      ...baseInput(),
      report: {
        designVersion: "2.0.0",
        narrativeVersion: "2.0.0",
      },
    },
    tenantId,
  );

  const state = await waitForState(
    runtime,
    created.auditId,
    [
      T.DRAFT_RENDERED,
      T.NARRATIVE_FAILED,
      T.RENDER_FAILED,
    ],
  );

  assert.equal(
    state?.state,
    T.DRAFT_RENDERED,
  );

  const manifestKey =
    `tenants/${tenantId}/clients/${created.clientId}/audits/${created.auditId}/report-v2/manifest.json`;

  const pageKey =
    `tenants/${tenantId}/clients/${created.clientId}/audits/${created.auditId}/report-v2/pages/index.html`;

  const manifest = await readJson(
    artifactStore,
    manifestKey,
  );

  const html = Buffer.from(
    await artifactStore.get(pageKey),
  ).toString("utf8");

  assert.equal(
    manifest.sources.competitors,
    "FAILED",
    "manifest must preserve the canonical FAILED competitor source status",
  );

  const start = html.indexOf(
    "Competitive context",
  );

  assert.ok(
    start > -1,
    "Viewer v2 competitor section must render",
  );

  const competitorSection = html.slice(
    start,
    start + 3000,
  );

  assert.match(
    competitorSection,
    /attempted but failed/i,
    "Viewer v2 must receive and explain the canonical FAILED status",
  );

  assert.match(
    competitorSection,
    /chip cap-missing/,
    "FAILED competitor evidence must use the failure presentation state",
  );

  assert.doesNotMatch(
    competitorSection,
    /Competitor analysis was not applicable/i,
    "FAILED must never degrade to NOT_APPLICABLE",
  );
});

test("NV2-PROD-06: invalid persisted terminal orchestration fails closed without another Writer/Judge spend", async () => {
  let writerCalls = 0;
  let judgeCalls = 0;
  const auditRequest = {
    contractVersion: "1.0.0",
    auditId: "77777777-7777-4777-8777-777777777777",
    tenantId,
    clientId: "narrative-recovery-client",
    report: { designVersion: "2.0.0", narrativeVersion: "2.0.0" },
  };
  const artifactStore = createMemoryArtifactStore();
  const lifecycleState = { state: T.NARRATIVE_PENDING };
  const lifecycleService = {
    currentState: async () => lifecycleState,
    transition: async ({ toState }) => {
      lifecycleState.state = toState;
      return { state: toState };
    },
  };

  await putJson(artifactStore, {
    tenantId,
    clientId: auditRequest.clientId,
    auditId: auditRequest.auditId,
    category: "report-v2",
    artifactName: "narrative-v2/writer-input.json",
  }, {
    contractVersion: "1.0.0",
    writerInputVersion: "1.0.0",
    auditId: auditRequest.auditId,
    referenceIndex: {},
  });
  await putJson(artifactStore, {
    tenantId,
    clientId: auditRequest.clientId,
    auditId: auditRequest.auditId,
    category: "report-v2",
    artifactName: "narrative-v2/orchestration.json",
  }, {
    contractVersion: "1.0.0",
    auditId: auditRequest.auditId,
    status: "RELEASE_CANDIDATE",
    passCount: 1,
    finalWriterOutput: {},
    finalJudgeResponse: { decision: "REVISE" },
  });

  const orchestrator = createNarrativeV2ProductionPath({
    baseOrchestrator: { execute: async () => { throw new Error("base orchestrator must not run"); } },
    lifecycleService,
    artifactStore,
    validateContract: () => ({ valid: true, errors: [] }),
    enabled: true,
    writerExecutor: async () => { writerCalls += 1; return {}; },
    judgeExecutor: async () => { judgeCalls += 1; return {}; },
    clock: { now: () => FIXED_TS },
  });

  const result = await orchestrator.execute(auditRequest, { executionId: "recovery-proof" });
  assert.equal(result.finalState, T.NARRATIVE_FAILED);
  assert.equal(lifecycleState.state, T.NARRATIVE_FAILED);
  assert.equal(writerCalls, 0, "invalid terminal artifact must not trigger a replacement Writer call");
  assert.equal(judgeCalls, 0, "invalid terminal artifact must not trigger a replacement Judge call");
  assert.match(result.narrativeV2Error, /failed validation/i);
});
test("NV2-PROD-07: NARRATIVE_FAILED exposes exact Judge defects and an authorized final pass is additive", async () => {
  const fixture = await buildContinuationFixture({
    finalJudgeOutcome: "PASS",
  });

  const review =
    await fixture.productionPath.getNarrativeV2HumanReview(
      fixture.auditRequest,
    );

  assert.equal(review.status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(review.passCount, 2);
  assert.equal(review.judgeDecision, JUDGE_DECISION.REVISE);
  assert.equal(review.finalPassAvailable, true);
  assert.deepEqual(
    review.defects,
    fixture.originalOrchestration.finalJudgeResponse.defects,
    "human review must expose the exact persisted Judge defects",
  );
  assert.deepEqual(
    review.revisionDirective,
    fixture.originalOrchestration.finalJudgeResponse.revisionDirective,
  );

  const originalBytesBefore = Buffer.from(
    await fixture.artifactStore.get(
      fixture.originalOrchestrationKey,
    ),
  );

  const result =
    await fixture.productionPath.continueNarrativeV2FinalPass(
      fixture.auditRequest,
      {
        executionId: "final-pass-success",
        authorizationId: "human-approval-001",
      },
    );

  assert.equal(result.finalState, T.NARRATIVE_READY);
  assert.equal(result.narrativeV2Status, "RELEASE_CANDIDATE");
  assert.equal(result.narrativeV2PassCount, 3);
  assert.equal(result.finalPassExecuted, true);

  assert.equal(
    fixture.writerCalls(),
    1,
    "continuation must execute only Writer pass 3",
  );
  assert.equal(
    fixture.judgeCalls(),
    1,
    "continuation must execute only Judge pass 3",
  );
  assert.equal(
    fixture.baseCalls(),
    0,
    "continuation must not re-enter collection or scoring",
  );
  assert.equal(
    fixture.authorizations().length,
    1,
    "final pass requires exactly one explicit authorization",
  );

  assert.deepEqual(
    fixture.transitions(),
    [
      T.NARRATIVE_PENDING,
      T.NARRATIVE_READY,
    ],
  );

  const originalBytesAfter = Buffer.from(
    await fixture.artifactStore.get(
      fixture.originalOrchestrationKey,
    ),
  );

  assert.equal(
    originalBytesAfter.equals(originalBytesBefore),
    true,
    "original Pass 1/2 orchestration artifact must remain byte-for-byte immutable",
  );

  assert.equal(
    await fixture.artifactStore.exists(
      fixture.finalOrchestrationKey,
    ),
    true,
    "Pass 3 must be persisted to the additive final-pass artifact",
  );

  const finalOrchestration = await readJson(
    fixture.artifactStore,
    fixture.finalOrchestrationKey,
  );

  assert.equal(finalOrchestration.status, "RELEASE_CANDIDATE");
  assert.equal(finalOrchestration.passCount, 3);
  assert.equal(finalOrchestration.passes.length, 3);
  assert.deepEqual(
    finalOrchestration.passes.slice(0, 2),
    fixture.originalOrchestration.passes,
    "final orchestration must preserve the exact prior governed history structurally",
  );
});

test("NV2-PROD-08: failed final Judge pass stops at NARRATIVE_FAILED with no Pass 4", async () => {
  const fixture = await buildContinuationFixture({
    finalJudgeOutcome: "HUMAN_REVIEW_REQUIRED",
  });

  const originalBytesBefore = Buffer.from(
    await fixture.artifactStore.get(
      fixture.originalOrchestrationKey,
    ),
  );

  const result =
    await fixture.productionPath.continueNarrativeV2FinalPass(
      fixture.auditRequest,
      {
        executionId: "final-pass-review",
        authorizationId: "human-approval-002",
      },
    );

  assert.equal(result.finalState, T.NARRATIVE_FAILED);
  assert.equal(
    result.narrativeV2Status,
    "HUMAN_REVIEW_REQUIRED",
  );
  assert.equal(result.narrativeV2PassCount, 3);
  assert.equal(result.finalPassExecuted, true);
  assert.equal(result.humanReview.passCount, 3);
  assert.equal(result.humanReview.finalPassAvailable, false);

  assert.equal(fixture.writerCalls(), 1);
  assert.equal(fixture.judgeCalls(), 1);
  assert.equal(fixture.baseCalls(), 0);

  const finalOrchestration = await readJson(
    fixture.artifactStore,
    fixture.finalOrchestrationKey,
  );

  assert.equal(
    finalOrchestration.status,
    "HUMAN_REVIEW_REQUIRED",
  );
  assert.equal(finalOrchestration.passCount, 3);

  const originalBytesAfter = Buffer.from(
    await fixture.artifactStore.get(
      fixture.originalOrchestrationKey,
    ),
  );

  assert.equal(
    originalBytesAfter.equals(originalBytesBefore),
    true,
    "failed Pass 3 must not overwrite Pass 1/2 history",
  );

  await assert.rejects(
    () =>
      fixture.productionPath.continueNarrativeV2FinalPass(
        fixture.auditRequest,
        {
          executionId: "illegal-pass-four",
          authorizationId: "human-approval-003",
        },
      ),
    /already exists/i,
  );

  assert.equal(
    fixture.writerCalls(),
    1,
    "no Writer pass 4 may execute",
  );
  assert.equal(
    fixture.judgeCalls(),
    1,
    "no Judge pass 4 may execute",
  );
});

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
import { buildV2Model } from "../narrative-v2/production-path.js";

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

function buildPassingWriterOutput({ writerInput, passNumber }) {
  const ref = Object.keys(writerInput.referenceIndex)[0];
  assert.ok(ref, "WriterInput must expose at least one governed reference");
  const interpret = (label) => atom(`${label} is tied to the governed audit evidence.`, ref);
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
    limitations: [{
      itemId: "LIM-01",
      area: "Evidence boundary",
      status: "UNAVAILABLE",
      clientExplanation: interpret("Limitation explanation"),
      whatThisMeans: interpret("Limitation meaning"),
      whatThisDoesNotMean: interpret("Limitation non-meaning"),
      impactOnReport: interpret("Limitation impact"),
    }],
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

function buildRuntime({ narrativeV2 } = {}) {
  const artifactStore = createMemoryArtifactStore();
  const reportStore = createLocalReportStore({ baseDir: join(testBaseDir, `reports-${randomUUID().slice(0, 8)}`) });
  const runtime = createProductionRuntime({
    config: baseConfig(),
    adapters: workingAdapters(),
    validateContract: () => ({ valid: true, errors: [] }),
    artifactStore,
    lifecycleRepo: wrapRepo(createMemoryLifecycleRepository()),
    reportStore,
    narrativeV2,
  });
  return { runtime, artifactStore };
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
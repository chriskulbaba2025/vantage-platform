/**
 * C6 — Finalization gate wired into the real production render path.
 *
 * Negative proof: when the governed finalization gate rejects the scored
 * model against decision evidence, the production orchestrator must NOT
 * reach the renderer.  Assertions:
 *   - lifecycle transitions to RENDER_FAILED
 *   - renderer page artifacts written = 0
 *
 * The audit state is seeded through governed lifecycle transitions and
 * persisted artifacts (production persistence boundary), then the real
 * orchestrator execute() drives the NARRATIVE_READY → render path.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { createMemoryLifecycleRepository } from "../../src/lifecycle/memory-repository.js";
import { createLifecycleService } from "../../src/lifecycle/lifecycle-service.js";
import { createMemoryArtifactStore } from "../../src/storage/memory-artifact-store.js";
import { createGovernedArtifactStore, buildArtifactKey } from "../../src/storage/governed-artifact-store.js";
import { createAuditOrchestrator } from "../../src/orchestration/audit-orchestrator.js";
import { LIFECYCLE_STATE } from "../../src/lifecycle/state-enum.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const T = LIFECYCLE_STATE;

// --- Schema validator (real schemas) ---
const schemasDir = resolve(__dirname, "..", "..", "src", "contracts");
const _ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(_ajv);
[
  "artifact-record.schema.json",
  "audit-request.schema.json",
  "canonical-evidence.schema.json",
  "decision-evidence.schema.json",
  "finding.schema.json",
  "lifecycle-event.schema.json",
  "lifecycle-state.schema.json",
  "narrative-response.schema.json",
  "report-content.schema.json",
  "report-manifest.schema.json",
  "report-view-model.schema.json",
  "score.schema.json",
  "source-result.schema.json",
].forEach((f) => {
  _ajv.addSchema(
    JSON.parse(readFileSync(resolve(schemasDir, f), "utf-8")),
    `https://vantage-platform.io/prysm/contracts/v1/${f}`,
  );
});
function validateContract(sid, obj) {
  const v = _ajv.getSchema(sid);
  if (!v) return { valid: false, errors: [{ message: `Schema not loaded: ${sid}` }] };
  const valid = v(obj);
  return { valid, errors: v.errors || [] };
}

// --- WP10 fixtures (real production artifacts) ---
const wp10Dir = resolve(__dirname, "..", "wp10");
function loadFixture(name) {
  return JSON.parse(readFileSync(resolve(wp10Dir, name), "utf-8"));
}

function mockClock(iso = "2026-01-01T00:00:00.000Z") {
  let t = new Date(iso).getTime();
  return { now: () => new Date(t).toISOString(), sleep: async () => {}, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 100)) };
}

const clock = mockClock();

function makeDecisionEvidence(performanceScores = {}) {
  return {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: {
      sourceStatus: "AVAILABLE",
      collectedAt: clock.now(),
      domain: "proof.example.com",
      targetUrl: "https://proof.example.com",
      pageCount: 1,
      pages: [{
        url: "https://proof.example.com",
        title: "Proof Home",
        headings: { h1: ["Proof Home"], h2: ["Services"], h3: [] },
        description: "Proof site",
        content: { text: "Proof", wordCount: 300 },
        images: [],
        links: { internal: [], external: [] },
        statusCode: 200,
      }],
      services: [],
      topicKeywords: [],
      ctas: [],
      forms: [],
      externalCtas: [],
      socialLinks: [],
      trust: { credentials: true },
      platform: "ProofCMS",
      schemaTypes: ["ProfessionalService"],
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
      securityHeaders: { "strict-transport-security": true, "x-content-type-options": true },
      _contentEvidenceAvailable: true,
      _responseHeadersAvailable: false,
      limitations: [],
    },
    performance: {
      sourceStatus: "AVAILABLE",
      collectedAt: clock.now(),
      fallbackUsed: false,
      testedUrls: ["https://proof.example.com"],
      // Truly usable strategies — FCP + LCP + scores all present
      mobile: {
        status: "AVAILABLE",
        scores: { performance: performanceScores.mobile ?? 73 },
        metrics: { fcpMs: 1200, lcpMs: 2600, cls: 0.05, tbtMs: 120 },
      },
      desktop: {
        status: "AVAILABLE",
        scores: { performance: performanceScores.desktop ?? 88 },
        metrics: { fcpMs: 800, lcpMs: 1800, cls: 0.02, tbtMs: 80 },
      },
      coverage: { requested: 2, completed: 2, failed: 0 },
      limitations: [],
    },
    competitors: [],
    backlinks: { sourceStatus: "AVAILABLE", collectedAt: clock.now(), provider: "controlled", adapterVersion: "1.0.0", limitations: [] },
    ga4: { sourceStatus: "AVAILABLE", collectedAt: clock.now(), provider: "controlled", adapterVersion: "1.0.0", limitations: [] },
    gsc: { sourceStatus: "AVAILABLE", collectedAt: clock.now(), provider: "controlled", adapterVersion: "1.0.0", limitations: [] },
    competitorOpportunities: null,
  };
}

async function setupOrchestrator() {
  const store = createMemoryArtifactStore();
  const artifactStore = createGovernedArtifactStore({ store });
  const lifecycleService = createLifecycleService(createMemoryLifecycleRepository());
  const orchestrator = createAuditOrchestrator({
    lifecycleService,
    artifactStore,
    adapters: {}, // No adapters — rendering path must not call any provider
    validateContract,
    clock,
    narrativeMode: "mock",
  });
  return { artifactStore, lifecycleService, orchestrator };
}

/**
 * Seed the audit through governed lifecycle transitions to NARRATIVE_READY
 * and persist the WP8/WP9/scoring/evidence artifacts.
 */
async function seedToNarrativeReady({ artifactStore, lifecycleService }, { auditId, tenantId, clientId, scores, decisionEvidence, findings }) {
  const scope = { tenantId, clientId, auditId };
  const executionId = randomUUID();

  // Governed lifecycle transitions (production transition boundary)
  await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey: randomUUID() });
  const transitions = [
    [T.VALIDATED, "validated"],
    [T.COLLECTING, "collecting"],
    [T.EVIDENCE_STORED, "evidence-stored"],
    [T.EVIDENCE_LOCKED, "evidence-locked"],
    [T.SCORED, "scored"],
    [T.NARRATIVE_PENDING, "narrative-pending"],
    [T.NARRATIVE_READY, "narrative-ready"],
  ];
  for (const [toState, note] of transitions) {
    await lifecycleService.transition({
      auditId,
      tenantId,
      toState,
      transitionIdempotencyKey: `${auditId}:${executionId}:${note}`,
      artifactKey: null,
    });
  }

  // Persist report content package (WP8 artifact)
  const pkg = loadFixture("valid-package.json");
  await artifactStore.put({
    bytes: Buffer.from(JSON.stringify(pkg), "utf-8"),
    contentType: "application/json",
    scope: { ...scope, category: "report", artifactName: "report-content.json" },
  });

  // Persist narrative (WP9 artifact)
  const narr = loadFixture("valid-narrative.json");
  await artifactStore.put({
    bytes: Buffer.from(JSON.stringify(narr), "utf-8"),
    contentType: "application/json",
    scope: { ...scope, category: "report", artifactName: "narrative.json" },
  });

  // Persist scores (scoring artifact)
  await artifactStore.put({
    bytes: Buffer.from(JSON.stringify(scores), "utf-8"),
    contentType: "application/json",
    scope: { ...scope, category: "canonical", artifactName: "scores.json" },
  });

  // Persist findings
  await artifactStore.put({
    bytes: Buffer.from(JSON.stringify(findings), "utf-8"),
    contentType: "application/json",
    scope: { ...scope, category: "canonical", artifactName: "findings.json" },
  });

  // Persist decision evidence
  await artifactStore.put({
    bytes: Buffer.from(JSON.stringify(decisionEvidence), "utf-8"),
    contentType: "application/json",
    scope: { ...scope, category: "canonical", artifactName: "decision-evidence.json" },
  });

  return { tenantId, clientId, auditId, executionId };
}

function makeScores(overrides = {}) {
  const s = loadFixture("valid-scoring-model.json");
  return { ...s, ...overrides };
}

function makeFindings() {
  return [
    {
      contractVersion: "1.0.0",
      findingId: randomUUID(),
      ruleId: "VAN-TECH-001",
      ruleVersion: "3.0.0",
      dimension: "technical_performance",
      module: "meta_information",
      title: "Missing meta description",
      affectedUrls: ["https://proof.example.com"],
      evidence: [
        { field: "meta.description", observedValue: null, source: "dataforseo-onpage", provider: "dataforseo_onpage", sourceStatus: "AVAILABLE", artifactRef: null },
      ],
      confidence: "deterministic",
      businessImpact: "Search-result messaging is uncontrolled.",
      recommendation: "Add a page-specific description.",
      implementationEffort: "M",
      verificationMethod: "Re-crawl and confirm.",
      scoreBearing: true,
      severity: "Medium",
      finalPriority: 60,
    },
  ];
}

function pageArtifactPrefix({ tenantId, clientId, auditId }) {
  return `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/pages/`;
}

// ---------------------------------------------------------------------------
// PRYSM-CLOSE-06a — positive control: gate passes → renderer runs
// ---------------------------------------------------------------------------
test("PRYSM-CLOSE-06a: passing gate reaches renderer and writes pages", async () => {
  const { artifactStore, lifecycleService, orchestrator } = await setupOrchestrator();
  const auditId = randomUUID();
  const tenantId = "t1";
  const clientId = "c1";

  await seedToNarrativeReady(
    { artifactStore, lifecycleService },
    {
      auditId, tenantId, clientId,
      scores: makeScores({ scores: { ...makeScores().scores, performance: 73 } }),
      decisionEvidence: makeDecisionEvidence(),
      findings: makeFindings(),
    },
  );

  const auditRequest = {
    contractVersion: "1.0.0",
    auditId,
    tenantId,
    clientId,
    idempotencyKey: randomUUID(),
    targetUrl: "https://proof.example.com",
    businessName: "Proof Business",
    market: "Canada",
    language: "en",
    primaryGoal: "conversion",
    services: ["Governed Evidence Service"],
    competitors: [],
  };

  const result = await orchestrator.execute(auditRequest, { executionId: randomUUID(), startedAt: clock.now() });

  assert.equal(result.finalState, T.DRAFT_RENDERED, `Expected draft_rendered, got ${result.finalState}`);

  // Pages must exist
  const prefix = pageArtifactPrefix({ tenantId, clientId, auditId });
  const indexKey = `${prefix}index.html`;
  const exists = await artifactStore.exists(indexKey);
  assert.equal(exists, true, "index.html page must exist when gate passes");
});

// ---------------------------------------------------------------------------
// PRYSM-CLOSE-06b — negative proof: failing gate → renderer calls = 0
// ---------------------------------------------------------------------------
test("PRYSM-CLOSE-06b: failing finalization gate blocks renderer with zero page writes", async () => {
  const { artifactStore, lifecycleService, orchestrator } = await setupOrchestrator();
  const auditId = randomUUID();
  const tenantId = "t1";
  const clientId = "c1";

  // Gate-failing contradiction (T-GATE-05): performance source is AVAILABLE
  // with truly usable strategies, but the persisted score is null.
  const base = makeScores();
  const scores = makeScores({
    scores: { ...base.scores, performance: null },
  });

  await seedToNarrativeReady(
    { artifactStore, lifecycleService },
    {
      auditId, tenantId, clientId,
      scores,
      decisionEvidence: makeDecisionEvidence(),
      findings: makeFindings(),
    },
  );

  const auditRequest = {
    contractVersion: "1.0.0",
    auditId,
    tenantId,
    clientId,
    idempotencyKey: randomUUID(),
    targetUrl: "https://proof.example.com",
    businessName: "Proof Business",
    market: "Canada",
    language: "en",
    primaryGoal: "conversion",
    services: ["Governed Evidence Service"],
    competitors: [],
  };

  let thrown = null;
  try {
    await orchestrator.execute(auditRequest, { executionId: randomUUID(), startedAt: clock.now() });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, "gate failure must reject rendering");
  assert.match(thrown.message, /Finalization gate failed/, "error names the finalization gate");

  // Lifecycle must be RENDER_FAILED
  const cs = await lifecycleService.currentState(auditId, tenantId);
  assert.equal(cs.state, T.RENDER_FAILED, "lifecycle must be render_failed");

  // PRYSM-OBSERVABILITY-01: the governed failure reason must be persisted on
  // the canonical lifecycle event.  Regression: the orchestrator previously
  // passed the reason only into the transition idempotency key, so the event
  // reason column stayed empty and production diagnosis depended on logs.
  const history = await lifecycleService.history(auditId, tenantId);
  const failedEvent = (history || []).find((e) => e.nextState === T.RENDER_FAILED);
  assert.ok(failedEvent, "render_failed event must exist in lifecycle history");
  assert.match(
    failedEvent.reason || "",
    /^render-finalization-gate-failed:/,
    "render_failed event must persist the governed gate-failure reason",
  );

  // Renderer page artifacts = 0
  const prefix = pageArtifactPrefix({ tenantId, clientId, auditId });
  const indexKey = `${prefix}index.html`;
  const exists = await artifactStore.exists(indexKey);
  assert.equal(exists, false, "renderer must write zero pages when the gate fails");

  // Report store must have zero report records
  const reportKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/report-manifest.json`;
  assert.equal(await artifactStore.exists(reportKey), false, "no report manifest written");
});

// ---------------------------------------------------------------------------
// PRYSM-CLOSE-07 — renderer receives the exact validated frozen model
// ---------------------------------------------------------------------------
import { REQUIRED_APPROVED_PAGE_FILENAMES } from "../../src/storage/report-store.js";

test("PRYSM-CLOSE-07: renderer receives exactly the validated frozen model", async () => {
  const { artifactStore, lifecycleService } = await setupOrchestrator();
  const auditId = randomUUID();
  const tenantId = "t1";
  const clientId = "c1";

  const decisionEvidence = makeDecisionEvidence();

  await seedToNarrativeReady(
    { artifactStore, lifecycleService },
    {
      auditId, tenantId, clientId,
      scores: makeScores({ scores: { ...makeScores().scores, performance: 73 } }),
      decisionEvidence,
      findings: makeFindings(),
    },
  );

  // Renderer spy — records the exact model reference it receives
  let receivedModel = null;
  let rendererCalls = 0;
  const rendererSpy = (model) => {
    rendererCalls++;
    receivedModel = model;
    // Produce the required 16 pages deterministically
    const pages = new Map();
    for (const fn of REQUIRED_APPROVED_PAGE_FILENAMES) {
      pages.set(fn, `<html><body>page ${fn}</body></html>`);
    }
    return { pages, indexHtml: pages.get("index.html"), filenames: [...pages.keys()] };
  };

  const orchestrator = createAuditOrchestrator({
    lifecycleService,
    artifactStore,
    adapters: {},
    validateContract,
    clock,
    narrativeMode: "mock",
    rendererImpl: rendererSpy,
  });

  const auditRequest = {
    contractVersion: "1.0.0",
    auditId,
    tenantId,
    clientId,
    idempotencyKey: randomUUID(),
    targetUrl: "https://proof.example.com",
    businessName: "Proof Business",
    market: "Canada",
    language: "en",
    primaryGoal: "conversion",
    services: ["Governed Evidence Service"],
    competitors: [],
  };

  const result = await orchestrator.execute(auditRequest, { executionId: randomUUID(), startedAt: clock.now() });

  assert.equal(result.finalState, T.DRAFT_RENDERED, "rendering completes");
  assert.equal(rendererCalls, 1, "renderer invoked exactly once");

  // Exact-object proof: the model the renderer received IS frozen
  assert.ok(receivedModel, "renderer received a model");
  assert.equal(Object.isFrozen(receivedModel), true, "renderer input is frozen");

  // The renderer received the complete model including governed evidence —
  // no post-validation augmentation is possible on a frozen object.
  assert.deepEqual(
    receivedModel.evidence.performance.mobile.scores.performance,
    73,
    "validated model carries the exact evidence sentinel",
  );
  assert.equal(
    receivedModel.evidence.site.domain,
    "proof.example.com",
    "validated model carries the exact site sentinel",
  );

  // Re-validate the received model against the production schema to prove
  // the renderer input is schema-valid (not just internally consistent).
  const revalidated = validateContract(
    "https://vantage-platform.io/prysm/contracts/v1/report-view-model.schema.json",
    receivedModel,
  );
  assert.equal(revalidated.valid, true, `renderer input revalidates: ${JSON.stringify(revalidated.errors?.slice(0, 3))}`);
});

// =============================================================================
// DE-09 / DE-15 — Renderer precondition gate: malformed AVAILABLE/PARTIAL
// decision evidence fails closed with rendererCallCount = 0, no pages
// persisted, no later success lifecycle events.
// =============================================================================

function makeMalformedDecisionEvidence(missingSitePart) {
  const evidence = makeDecisionEvidence();
  if (missingSitePart === "site") {
    evidence.site = null;
  } else if (missingSitePart === "siteStatus") {
    delete evidence.site.sourceStatus;
  } else {
    delete evidence.site[missingSitePart];
  }
  return evidence;
}

const DE_MALFORMED_CASES = [
  ["site", "missing site"],
  ["domain", "missing site.domain"],
  ["pages", "missing site.pages"],
  ["trust", "missing site.trust"],
  ["platform", "missing site.platform"],
  ["schemaTypes", "missing site.schemaTypes"],
];

for (const [missingPart, label] of DE_MALFORMED_CASES) {
  test(`DE-09/DE-15: ${label} → RENDER_FAILED, renderer calls = 0, zero pages`, async () => {
    const { artifactStore, lifecycleService } = await setupOrchestrator();
    const auditId = randomUUID();
    const tenantId = "t1";
    const clientId = "c1";

    await seedToNarrativeReady(
      { artifactStore, lifecycleService },
      {
        auditId, tenantId, clientId,
        scores: makeScores({ scores: { ...makeScores().scores, performance: 73 } }),
        decisionEvidence: makeMalformedDecisionEvidence(missingPart),
        findings: makeFindings(),
      },
    );

    let rendererCalls = 0;
    const rendererSpy = () => {
      rendererCalls++;
      throw new Error("renderer must not be called");
    };

    const orchestrator = createAuditOrchestrator({
      lifecycleService,
      artifactStore,
      adapters: {},
      validateContract,
      clock,
      narrativeMode: "mock",
      rendererImpl: rendererSpy,
    });

    const auditRequest = {
      contractVersion: "1.0.0",
      auditId,
      tenantId,
      clientId,
      idempotencyKey: randomUUID(),
      targetUrl: "https://proof.example.com",
      businessName: "Proof Business",
      market: "Canada",
      language: "en",
      primaryGoal: "conversion",
      services: ["Governed Evidence Service"],
      competitors: [],
    };

    let thrown = null;
    try {
      await orchestrator.execute(auditRequest, { executionId: randomUUID(), startedAt: clock.now() });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, "execution must reject malformed decision evidence");

    // DE-15: persisted lifecycle state = render_failed
    const cs = await lifecycleService.currentState(auditId, tenantId);
    assert.equal(cs.state, T.RENDER_FAILED, `lifecycle must be render_failed (got ${cs.state})`);

    // DE-15: renderer call count = 0
    assert.equal(rendererCalls, 0, "rendererCallCount must remain exactly 0");

    // DE-15: no approved report pages were persisted
    const pagePrefix = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/pages/`;
    assert.equal(await artifactStore.exists(`${pagePrefix}index.html`), false, "no pages persisted");

    // DE-15: no later success lifecycle events exist
    const history = await lifecycleService.history(auditId, tenantId);
    const statesAfterRenderFailed = (history || [])
      .slice(-3)
      .map((e) => e.nextState);
    assert.equal(
      statesAfterRenderFailed.includes(T.DRAFT_RENDERED),
      false,
      "no draft_rendered success event after the failure",
    );
  });
}

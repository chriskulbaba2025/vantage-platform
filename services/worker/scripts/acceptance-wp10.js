#!/usr/bin/env node
/**
 * WP10 Acceptance — PRODUCTION SERVER HANDLER + REAL STORE PROOF
 *
 * Uses the exported createRequestHandler from server.js (the actual
 * production route logic), the real createLocalReportStore, and the
 * real orchestrator. No duplicated route logic.
 */

import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { createServer, get as httpGetNative } from "node:http";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function sha256(input) { return createHash("sha256").update(input).digest("hex"); }
function normalizeLF(s) { return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); }

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { console.log(`  [x] PASS — ${label}`); passed++; }
  else { console.error(`  [ ] FAIL — ${label}`); if (detail) console.error(`        ${detail}`); failed++; }
}

// --- Schemas ---
const schemasDir = resolve(__dirname, "..", "src", "contracts");
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
["report-view-model.schema.json","report-content.schema.json","narrative-response.schema.json","finding.schema.json","score.schema.json","report-manifest.schema.json","artifact-record.schema.json","audit-request.schema.json","source-result.schema.json","canonical-evidence.schema.json","capability-evidence.schema.json","decision-evidence.schema.json","lifecycle-event.schema.json","lifecycle-state.schema.json"].forEach(f => {
  ajv.addSchema(JSON.parse(readFileSync(resolve(schemasDir, f),"utf-8")), `https://vantage-platform.io/prysm/contracts/v1/${f}`);
});
function validate(sid, obj) { const v = ajv.getSchema(sid); return v ? { valid: v(obj), errors: v.errors || [] } : { valid: false, errors: [{ message: `Schema not found: ${sid}` }] }; }

// --- Imports ---
// Local dev storage gate — server.js requires this before its module
// evaluation (controlled acceptance never uses S3).  Mirrors the
// acceptance-tenant.js pattern.
process.env.VANTAGE_DEV_MEMORY_STORE = "true";
const { createMemoryArtifactStore } = await import("../src/storage/memory-artifact-store.js");
const { createGovernedArtifactStore, buildArtifactKey } = await import("../src/storage/governed-artifact-store.js");
const { createMemoryLifecycleRepository } = await import("../src/lifecycle/memory-repository.js");
const { createLifecycleService } = await import("../src/lifecycle/lifecycle-service.js");
const { createAuditOrchestrator } = await import("../src/orchestration/audit-orchestrator.js");
const { LIFECYCLE_STATE } = await import("../src/lifecycle/state-enum.js");
const { createLocalReportStore } = await import("../src/storage/report-store.js");
const { createRequestHandler } = await import("../src/server.js");
const T = LIFECYCLE_STATE;

// --- Fixtures ---
function loadFixture(name) { return JSON.parse(readFileSync(resolve(__dirname, "..", "test-fixtures", "wp10", name), "utf-8")); }

// --- Infra ---
const memoryStore = createMemoryArtifactStore();
const artifactStore = createGovernedArtifactStore({ store: memoryStore });
const lifecycleRepo = createMemoryLifecycleRepository();
const lifecycle = createLifecycleService(lifecycleRepo);
const mockAdapters = {
  "dataforseo-onpage": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: "application/json", sourceResult: { contractVersion: "1.0.0", source: "dataforseo-onpage", provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z", retryCount: 0, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: {} } }) },
  "pagespeed": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: "application/json", sourceResult: { contractVersion: "1.0.0", source: "pagespeed", provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: "2026-01-01T00:00:01.000Z", completedAt: "2026-01-01T00:00:02.000Z", retryCount: 0, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: {} } }) },
  "dataforseo-serp": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: "application/json", sourceResult: { contractVersion: "1.0.0", source: "dataforseo-serp", provider: "mock", adapterVersion: "1.0.0", status: "NOT_APPLICABLE", startedAt: "2026-01-01T00:00:02.000Z", completedAt: "2026-01-01T00:00:03.000Z", retryCount: 0, coverage: { requested: 0, completed: 0, failed: 0 }, limitations: [], evidence: {} } }) },
  "backlinks": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: "application/json", sourceResult: { contractVersion: "1.0.0", source: "backlinks", provider: "mock", adapterVersion: "1.0.0", status: "NOT_CONNECTED", startedAt: "2026-01-01T00:00:03.000Z", completedAt: "2026-01-01T00:00:04.000Z", retryCount: 0, coverage: { requested: 0, completed: 0, failed: 0 }, limitations: [], evidence: {} } }) },
  "ga4": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: "application/json", sourceResult: { contractVersion: "1.0.0", source: "ga4", provider: "mock", adapterVersion: "1.0.0", status: "NOT_CONNECTED", startedAt: "2026-01-01T00:00:04.000Z", completedAt: "2026-01-01T00:00:05.000Z", retryCount: 0, coverage: { requested: 0, completed: 0, failed: 0 }, limitations: [], evidence: {} } }) },
  "gsc": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: "application/json", sourceResult: { contractVersion: "1.0.0", source: "gsc", provider: "mock", adapterVersion: "1.0.0", status: "NOT_CONNECTED", startedAt: "2026-01-01T00:00:05.000Z", completedAt: "2026-01-01T00:00:06.000Z", retryCount: 0, coverage: { requested: 0, completed: 0, failed: 0 }, limitations: [], evidence: {} } }) },
};

// --- Instrumented adapters for replay proof ---
let instrumentedProviderCalls = 0;
const instrumentedAdapters = {};
for (const [name, a] of Object.entries(mockAdapters)) {
  instrumentedAdapters[name] = {
    adapterVersion: a.adapterVersion,
    execute: async (opts) => { instrumentedProviderCalls++; return a.execute(opts); },
  };
}

// --- Instrumented narrative/n8n counters for REPLAY-01 ---
let instrumentedNarrativeCalls = 0;
let instrumentedN8nCalls = 0;
const instrumentedNarrativeExecutor = async (opts) => {
  instrumentedNarrativeCalls++;
  const { executeNarrative } = await import("../src/narrative/narrative-service.js");
  return executeNarrative(opts);
};
const instrumentedN8nCounter = { count: 0 };
// Wrap the counter in a Proxy so any .count mutation is tracked
const n8nCallCounter = new Proxy(instrumentedN8nCounter, {
  set(target, prop, value) { if (prop === "count") instrumentedN8nCalls++; target[prop] = value; return true; },
  get(target, prop) { return target[prop]; },
});

const mockClock = (iso) => { let t = new Date(iso || "2026-01-01T00:00:00.000Z").getTime(); return { now: () => new Date(t).toISOString(), sleep: async () => {}, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 100)) }; };

const orchestrator = createAuditOrchestrator({
  lifecycleService: lifecycle, artifactStore, adapters: instrumentedAdapters, validateContract: validate,
  clock: mockClock("2026-08-09T12:00:00.000Z"),
  retryPolicyResolver: () => ({ timeoutMs: 30000, maxAttempts: 1, retryable: () => false, delayMs: () => 0 }),
  narrativeExecutor: instrumentedNarrativeExecutor,
  n8nCallCounter: n8nCallCounter,
});

const testBaseDir = resolve(__dirname, "..", "artifacts", `wp10-test-${Date.now()}`);
mkdirSync(testBaseDir, { recursive: true });
function cleanup() { try { rmSync(testBaseDir, { recursive: true, force: true }); } catch {} }
process.on("exit", cleanup);

// --- Setup helper ---
async function setupToNarrativeReady(auditId) {
  const tenantId = "t1", clientId = "c1", executionId = randomUUID();
  await lifecycle.create({ auditId, tenantId, clientId, idempotencyKey: randomUUID() });
  for (const state of [T.VALIDATED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED, T.SCORED, T.NARRATIVE_PENDING, T.NARRATIVE_READY]) {
    await lifecycle.transition({ auditId, tenantId, toState: state, transitionIdempotencyKey: `${auditId}:${state}:${executionId}` });
  }
  const pkg = loadFixture("valid-package.json"); pkg.auditId = auditId; pkg.business = { name: "Test Business Inc.", domain: "testbusiness.com", platform: "WordPress" };
  await artifactStore.put({ bytes: Buffer.from(JSON.stringify(pkg), "utf-8"), contentType: "application/json", scope: { tenantId, clientId, auditId, category: "report", artifactName: "report-content.json" } });
  const narr = loadFixture("valid-narrative.json"); narr.auditId = auditId;
  await artifactStore.put({ bytes: Buffer.from(JSON.stringify(narr), "utf-8"), contentType: "application/json", scope: { tenantId, clientId, auditId, category: "report", artifactName: "narrative.json" } });
  const sm = loadFixture("valid-scoring-model.json");
  const scoresJson = JSON.stringify({ contractVersion: "1.0.0", scoringVersion: sm.scoringVersion || "3.0.0", generatedAt: "2026-08-09T12:00:00.000Z", scores: sm.scores || {}, bands: sm.bands || {}, assessedWeight: 75, readinessStatus: "Provisional", showNumericScore: true, evidenceConfidenceScore: 70, rootCause: sm.rootCause || "", findingCount: (sm.findings || []).length, findingIds: (sm.findings || []).map(f => f.findingId), findingsArtifact: null, scoresArtifact: null });
  const scoresKey = buildArtifactKey({ tenantId, clientId, auditId, category: "canonical", artifactName: "scores.json" });
  await artifactStore.put({ bytes: Buffer.from(scoresJson, "utf-8"), contentType: "application/json", scope: { tenantId, clientId, auditId, category: "canonical", artifactName: "scores.json" } });
  await artifactStore.put({ bytes: Buffer.from(JSON.stringify(sm.findings || []), "utf-8"), contentType: "application/json", scope: { tenantId, clientId, auditId, category: "canonical", artifactName: "findings.json" } });

  // PRYSM-CLOSE-06/07: governed rendering requires decision evidence —
  // seed it through the real production builder.
  {
    const { buildDecisionEvidence } = await import("../src/evidence/decision-evidence.js");
    const siteSourceResult = {
      contractVersion: "1.0.0", schemaVersion: "1.0.0", source: "dataforseo-onpage",
      provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE",
      startedAt: "2026-08-09T12:00:00.000Z", completedAt: "2026-08-09T12:00:01.000Z", retryCount: 0,
      coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [],
      evidence: {
        sourceStatus: "AVAILABLE", domain: "testbusiness.com", targetUrl: "https://testbusiness.com",
        pageCount: 1, pages: [], services: [], trust: {}, platform: "WordPress",
        schemaTypes: [], statusCounts: {}, ctas: [], forms: [], externalCtas: [],
        socialLinks: [], internalLinkCount: 0, brokenInternalLinks: [],
        securityHeaders: {}, _contentEvidenceAvailable: true, _responseHeadersAvailable: false,
        collectedAt: "2026-08-09T12:00:01.000Z",
      },
    };
    const perfSourceResult = {
      contractVersion: "1.0.0", schemaVersion: "1.0.0", source: "pagespeed",
      provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE",
      startedAt: "2026-08-09T12:00:01.000Z", completedAt: "2026-08-09T12:00:02.000Z", retryCount: 0,
      coverage: { requested: 2, completed: 2, failed: 0 }, limitations: [],
      evidence: {
        sourceStatus: "AVAILABLE", fallbackUsed: false, testedUrls: ["https://testbusiness.com"],
        mobile: { status: "AVAILABLE", scores: { performance: 73 }, metrics: { fcpMs: 1200, lcpMs: 1800 } },
        desktop: { status: "AVAILABLE", scores: { performance: 88 }, metrics: { fcpMs: 600, lcpMs: 900 } },
        collectedAt: "2026-08-09T12:00:02.000Z",
      },
    };
    const decisionResult = buildDecisionEvidence({
      allSourceResults: [
        { source: "dataforseo-onpage", sourceResult: siteSourceResult },
        { source: "pagespeed", sourceResult: perfSourceResult },
      ],
      suppliedCompetitors: [],
      validateContract: validate,
    });
    await artifactStore.put({
      bytes: Buffer.from(JSON.stringify(decisionResult.evidence), "utf-8"),
      contentType: "application/json",
      scope: { tenantId, clientId, auditId, category: "canonical", artifactName: "decision-evidence.json" },
    });
  }

  return { auditRequest: { contractVersion: "1.0.0", auditId, tenantId, clientId, idempotencyKey: randomUUID(), targetUrl: "https://testbusiness.com", businessName: "Test Business Inc." }, tenantId, clientId, executionId };
}

console.log("WP10 Acceptance (PRODUCTION HANDLER PROOF)\n===========================================");

// =============================================================================
// PHASE 1: Orchestrator → Draft → Store → Server
// =============================================================================
console.log("--- Phase 1: Rendering + Store integration ---");

let pageMap1, storeSlug, storeRunId, testStore;

{
  const auditId = randomUUID();
  const { auditRequest, tenantId, clientId } = await setupToNarrativeReady(auditId);
  const cs = await lifecycle.currentState(auditId, tenantId);
  check("Start: NARRATIVE_READY", cs.state === T.NARRATIVE_READY, `Got ${cs.state}`);

  const result = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
  check("Orchestrator: DRAFT_RENDERED", result.finalState === T.DRAFT_RENDERED);
  check("16 pages", result.pageCount === 16);
  check("rendererCallCount=1", result.rendererCallCount === 1);

  pageMap1 = result.renderedPages;
  storeSlug = "test-business";
  storeRunId = auditId;
  testStore = createLocalReportStore({ baseDir: testBaseDir });

  // Initialize store draft
  const draftModel = { scores: { conversionReadiness: 59, trust: 65, contentDepth: 58, conversionPathways: 72, technical: 55, performance: 48 }, evidence: { site: { domain: "testbusiness.com", pages: [{ title: "Test Business Inc." }], services: [], sourceStatus: "AVAILABLE" }, performance: { sourceStatus: "AVAILABLE" }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, input: { businessName: "Test Business Inc." }, _gate: {} };
  const draftManifest = { sources: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, scores: { trust: 65, contentDepth: 58, conversionPathways: 72, technical: 55, performance: 48, conversionReadiness: 59 } };

  const idx = pageMap1?.get("index.html") || "";
  await testStore.writeReport({ slug: storeSlug, runId: storeRunId, model: draftModel, manifest: draftManifest, html: idx, includeIndexHtml: !!idx });

  // Write all pages to store directory
  const { writeFile, mkdir } = await import("node:fs/promises");
  const dir = resolve(testBaseDir, storeSlug, storeRunId);
  await mkdir(dir, { recursive: true });
  if (pageMap1) for (const [fn, html] of pageMap1) await writeFile(resolve(dir, fn), html, "utf-8");

  const st = await testStore.getStatus(storeSlug, storeRunId);
  check("Store status: draft", st.status === "draft", `Got ${st.status}`);

  // Verify all 16 persisted artifacts from orchestrator
  for (const art of result.pageArtifacts) {
    const stored = await artifactStore.get(art.key);
    check(`Artifact ${art.filename}: bytes=${art.bytes}`, stored && stored.length === art.bytes);
    check(`Artifact ${art.filename}: SHA match`, sha256(stored) === art.sha256);
  }
  check("Manifest schema-valid", (result.manifestRecord ? validate("https://vantage-platform.io/prysm/contracts/v1/report-manifest.schema.json", JSON.parse((await artifactStore.get(result.manifestKey)).toString())).valid : false));
}

// =============================================================================
// PHASE 2: Production server handler — draft/review/approved delivery
// =============================================================================
console.log("\n--- Phase 2: Production server handler delivery gating ---");

{
  // Create production handler with test store
  const handlerConfig = { config: { artifactDir: testBaseDir, webhookSecret: "" }, localStore: testStore, store: testStore, oauthService: { getAuthUrl: () => "", validateState: () => "ga4", exchangeCode: async () => ({}), getStatus: async () => ({}), disconnect: async () => ({}) } };
  const requestListener = createRequestHandler(handlerConfig);
  const server = createServer(requestListener);
  const port = 19876 + Math.floor(Math.random() * 1000);
  await new Promise(r => server.listen(port, "127.0.0.1", r));

  async function httpGet(path) {
    return new Promise((resolve, reject) => {
      const req = httpGetNative(`http://127.0.0.1:${port}${path}`, (res) => {
        let body = ""; res.on("data", c => body += c); res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject); req.setTimeout(3000, () => { req.destroy(); reject(new Error("timeout")); });
    });
  }

  // --- Draft: not client-visible (no final artifacts → 404 PAGE_NOT_FOUND) ---
  // PRYSM-CLOSE-14: draft/review states must never be exposed through
  // client-facing report routes.  The governed route returns 404 because
  // draft pages are not part of the approved final artifact set.
  {
    const r = await httpGet(`/reports/${storeSlug}/${storeRunId}/index.html`);
    check("Draft: HTTP 404 (not client-visible)", r.status === 404, `Got ${r.status}`);
    const p = JSON.parse(r.body);
    check("Draft: PAGE_NOT_FOUND", p.code === "PAGE_NOT_FOUND", `Got ${p.code}`);
    check(`Draft: body bytes=${r.body.length}`, r.body.length > 0);
  }

  // --- Review: not client-visible ---
  {
    const now = new Date().toISOString();
    await testStore.writeReview(storeSlug, storeRunId, {
      reviewer: "auditor@test.com", reviewedAt: now,
      checklist: ["source_failures","top_ten_findings","high_severity","competitor_selections","internal_link_recommendations","root_cause","score_eligibility","limitations","causal_language","implementation_feasibility"].map(id => ({ id, reviewed: true, reviewedAt: now })),
      findingsReviewed: true, limitationsAccepted: true,
    });
    const r = await httpGet(`/reports/${storeSlug}/${storeRunId}/index.html`);
    check("Reviewed: HTTP 404 (not client-visible)", r.status === 404, `Got ${r.status}`);
    const p = JSON.parse(r.body);
    check("Reviewed: PAGE_NOT_FOUND", p.code === "PAGE_NOT_FOUND", `Got ${p.code}`);
  }

  // --- Approve with 16 pages: 200 ---
  {
    const pagesMap = new Map();
    if (pageMap1) for (const [fn, html] of pageMap1) pagesMap.set(fn, html);
    check("Pages for approval: 16", pagesMap.size === 16);

    await testStore.writeApprovedPages(storeSlug, storeRunId, { approver: "principal@test.com", approvedAt: new Date().toISOString(), reviewRef: { reviewer: "auditor@test.com", reviewedAt: new Date().toISOString(), checklistCount: 10, overrideCount: 0 } }, pagesMap);

    const r = await httpGet(`/reports/${storeSlug}/${storeRunId}/index.html`);
    check("Approved: HTTP 200", r.status === 200, `Got ${r.status}`);
    check("Approved: body is HTML", r.body.includes("<!DOCTYPE html>") || r.body.includes("<html"));
    check(`Approved: bytes=${r.body.length}`, r.body.length > 100);

    // Also verify a specific page
    const r2 = await httpGet(`/reports/${storeSlug}/${storeRunId}/scorecard.html`);
    check("Approved scorecard: HTTP 200", r2.status === 200);
  }

  // --- Path traversal: 400 ---
  {
    const r = await httpGet(`/reports/${storeSlug}/${storeRunId}/..%2F..%2Fetc%2Fpasswd`);
    check("Path traversal: 400", r.status === 400, `Got ${r.status}`);
  }

  // --- Non-approved page: 404 ---
  {
    const r = await httpGet(`/reports/${storeSlug}/${storeRunId}/nonexistent.html`);
    check(`Non-approved page: ${r.status}`, r.status === 404, `Got ${r.status}`);
  }

  server.close();
}

// =============================================================================
// PHASE 3: RENDER-FAIL-01
// =============================================================================
console.log("\n--- Phase 3: RENDER-FAIL-01 ---");

{
  const auditId2 = randomUUID();
  const { auditRequest, tenantId } = await setupToNarrativeReady(auditId2);
  let threw = false;
  try { await orchestrator.execute(auditRequest, { executionId: randomUUID(), injectPageFailure: true }); } catch (e) { threw = true; }
  check("Injected failure: threw", threw);
  const cs = await lifecycle.currentState(auditId2, tenantId);
  check("Injected failure: RENDER_FAILED", cs.state === T.RENDER_FAILED, `Got ${cs.state}`);
  const h = await lifecycle.history(auditId2, tenantId);
  check("Zero DRAFT_RENDERED events", h.filter(e => e.nextState === T.DRAFT_RENDERED).length === 0);
  const recovery = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
  check("Recovery: NARRATIVE_READY", recovery.finalState === T.NARRATIVE_READY);
}

// =============================================================================
// PHASE 4: APPROVAL-01 — complete negative proof
// =============================================================================
console.log("\n--- Phase 4: APPROVAL-01 negative cases ---");

{
  // A. Complete review → approved (via store)
  const slug2 = "neg-test-a";
  const runId2 = randomUUID();
  const store2 = createLocalReportStore({ baseDir: testBaseDir });
  await store2.writeReport({ slug: slug2, runId: runId2, model: { scores: {}, evidence: { site: { domain: "t.com", pages: [{}], services: [], sourceStatus: "AVAILABLE" }, performance: { sourceStatus: "AVAILABLE" }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, input: {} }, manifest: { sources: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, scores: { trust: 50, contentDepth: 50, conversionPathways: 50, technical: 50, performance: 50, conversionReadiness: 50 } }, html: "<!DOCTYPE html><html></html>", includeIndexHtml: true });

  const now = new Date().toISOString();
  const fullChecklist = ["source_failures","top_ten_findings","high_severity","competitor_selections","internal_link_recommendations","root_cause","score_eligibility","limitations","causal_language","implementation_feasibility"].map(id => ({ id, reviewed: true, reviewedAt: now }));

  // A: Complete review → approved
  await store2.writeReview(slug2, runId2, { reviewer: "a@t.com", reviewedAt: now, checklist: fullChecklist, findingsReviewed: true, limitationsAccepted: true });
  const pages = new Map(); pages.set("index.html", "<!DOCTYPE html><html></html>");
  if (pageMap1) for (const [fn, html] of pageMap1) pages.set(fn, html);
  try {
    const approved = await store2.writeApprovedPages(slug2, runId2, { approver: "p@t.com", approvedAt: now, reviewRef: { reviewer: "a@t.com", reviewedAt: now, checklistCount: 10, overrideCount: 0 } }, pages);
    check("A: Complete review → approved", approved.status === "approved");
  } catch (e) { check(`A: Complete review → approved (${e.message})`, false); }

  // B: Incomplete review → must NOT approve
  const slugB = "neg-test-b"; const runIdB = randomUUID();
  const storeB = createLocalReportStore({ baseDir: testBaseDir });
  await storeB.writeReport({ slug: slugB, runId: runIdB, model: { scores: {}, evidence: { site: { domain: "t.com", pages: [{}], services: [], sourceStatus: "AVAILABLE" }, performance: { sourceStatus: "AVAILABLE" }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, input: {} }, manifest: { sources: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, scores: { trust: 50, contentDepth: 50, conversionPathways: 50, technical: 50, performance: 50, conversionReadiness: 50 } }, html: "<!DOCTYPE html><html></html>", includeIndexHtml: true });
  // Only 5/10 reviewed
  const partialChecklist = fullChecklist.map((item, i) => i < 5 ? item : { ...item, reviewed: false });
  await storeB.writeReview(slugB, runIdB, { reviewer: "a@t.com", reviewedAt: now, checklist: partialChecklist, findingsReviewed: true, limitationsAccepted: true });
  try {
    await storeB.writeApprovedPages(slugB, runIdB, { approver: "p@t.com", approvedAt: now, reviewRef: { reviewer: "a@t.com", reviewedAt: now, checklistCount: 5, overrideCount: 0 } }, pages);
    check("B: Incomplete review → rejected", false, "Should have thrown");
  } catch (e) {
    check("B: Incomplete review → rejected", e.message.includes("incomplete") || e.message.includes("review"), e.message);
  }

  // C: Partial pages (1 page) → must REJECT (WP10-APPROVAL-01)
  const slugC = "neg-test-c"; const runIdC = randomUUID();
  const storeC = createLocalReportStore({ baseDir: testBaseDir });
  await storeC.writeReport({ slug: slugC, runId: runIdC, model: { scores: {}, evidence: { site: { domain: "t.com", pages: [{}], services: [], sourceStatus: "AVAILABLE" }, performance: { sourceStatus: "AVAILABLE" }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, input: {} }, manifest: { sources: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, scores: { trust: 50, contentDepth: 50, conversionPathways: 50, technical: 50, performance: 50, conversionReadiness: 50 } }, html: "<!DOCTYPE html><html></html>", includeIndexHtml: true });
  await storeC.writeReview(slugC, runIdC, { reviewer: "a@t.com", reviewedAt: now, checklist: fullChecklist, findingsReviewed: true, limitationsAccepted: true });
  const partialPages = new Map(); partialPages.set("index.html", "<!DOCTYPE html><html></html>");
  try {
    await storeC.writeApprovedPages(slugC, runIdC, { approver: "p@t.com", approvedAt: now, reviewRef: { reviewer: "a@t.com", reviewedAt: now, checklistCount: 10, overrideCount: 0 } }, partialPages);
    check("C: 1 page → rejected", false, "Should have thrown — only 1 page submitted");
  } catch (e) {
    check("C: 1 page → rejected", e.message.includes("exactly 16") || e.message.includes("missing required page"), e.message);
  }
  const stC = await storeC.getStatus(slugC, runIdC);
  check("C: status != approved after 1-page attempt", stC.status !== "approved", `Got ${stC.status}`);

  // C2: 15 pages (missing one) → must REJECT
  const slugC2 = "neg-test-c2"; const runIdC2 = randomUUID();
  const storeC2 = createLocalReportStore({ baseDir: testBaseDir });
  await storeC2.writeReport({ slug: slugC2, runId: runIdC2, model: { scores: {}, evidence: { site: { domain: "t.com", pages: [{}], services: [], sourceStatus: "AVAILABLE" }, performance: { sourceStatus: "AVAILABLE" }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, input: {} }, manifest: { sources: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, scores: { trust: 50, contentDepth: 50, conversionPathways: 50, technical: 50, performance: 50, conversionReadiness: 50 } }, html: "<!DOCTYPE html><html></html>", includeIndexHtml: true });
  await storeC2.writeReview(slugC2, runIdC2, { reviewer: "a@t.com", reviewedAt: now, checklist: fullChecklist, findingsReviewed: true, limitationsAccepted: true });
  const pages15 = new Map(); if (pageMap1) { let i = 0; for (const [fn, html] of pageMap1) { if (i++ < 15) pages15.set(fn, html); } }
  try {
    await storeC2.writeApprovedPages(slugC2, runIdC2, { approver: "p@t.com", approvedAt: now, reviewRef: { reviewer: "a@t.com", reviewedAt: now, checklistCount: 10, overrideCount: 0 } }, pages15);
    check("C2: 15 pages → rejected", false, "Should have thrown — only 15 pages submitted");
  } catch (e) {
    check("C2: 15 pages → rejected", e.message.includes("exactly 16") || e.message.includes("missing required page"), e.message);
  }

  // C3: Wrong filename set → must REJECT
  const slugC3 = "neg-test-c3"; const runIdC3 = randomUUID();
  const storeC3 = createLocalReportStore({ baseDir: testBaseDir });
  await storeC3.writeReport({ slug: slugC3, runId: runIdC3, model: { scores: {}, evidence: { site: { domain: "t.com", pages: [{}], services: [], sourceStatus: "AVAILABLE" }, performance: { sourceStatus: "AVAILABLE" }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, input: {} }, manifest: { sources: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, scores: { trust: 50, contentDepth: 50, conversionPathways: 50, technical: 50, performance: 50, conversionReadiness: 50 } }, html: "<!DOCTYPE html><html></html>", includeIndexHtml: true });
  await storeC3.writeReview(slugC3, runIdC3, { reviewer: "a@t.com", reviewedAt: now, checklist: fullChecklist, findingsReviewed: true, limitationsAccepted: true });
  const wrongPages = new Map(); if (pageMap1) { let i = 0; for (const [fn, html] of pageMap1) { if (i === 15) wrongPages.set("wrong-name.html", html); else wrongPages.set(fn, html); i++; } }
  try {
    await storeC3.writeApprovedPages(slugC3, runIdC3, { approver: "p@t.com", approvedAt: now, reviewRef: { reviewer: "a@t.com", reviewedAt: now, checklistCount: 10, overrideCount: 0 } }, wrongPages);
    check("C3: Wrong filename → rejected", false, "Should have thrown — unknown page filename");
  } catch (e) {
    check("C3: Wrong filename → rejected", e.message.includes("unknown page filename") || e.message.includes("missing required page"), e.message);
  }

  // D: Non-reviewed approval → must NOT approve
  const slugD = "neg-test-d"; const runIdD = randomUUID();
  const storeD = createLocalReportStore({ baseDir: testBaseDir });
  await storeD.writeReport({ slug: slugD, runId: runIdD, model: { scores: {}, evidence: { site: { domain: "t.com", pages: [{}], services: [], sourceStatus: "AVAILABLE" }, performance: { sourceStatus: "AVAILABLE" }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, input: {} }, manifest: { sources: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, scores: { trust: 50, contentDepth: 50, conversionPathways: 50, technical: 50, performance: 50, conversionReadiness: 50 } }, html: "<!DOCTYPE html><html></html>", includeIndexHtml: true });
  // Skip writeReview entirely — go straight to approval
  try {
    await storeD.writeApprovedPages(slugD, runIdD, { approver: "p@t.com", approvedAt: now, reviewRef: { reviewer: "a@t.com", reviewedAt: now, checklistCount: 0, overrideCount: 0 } }, pages);
    const st2 = await storeD.getStatus(slugD, runIdD);
    check("D: No review → rejected", st2.status !== "approved", `Got ${st2.status}`);
  } catch (e) {
    check("D: No review → rejected", true, e.message);
  }
}

// =============================================================================
// PHASE 5: PUBLISH-01 — governed publication operation
// =============================================================================
console.log("\n--- Phase 5: PUBLISH-01 governed publication ---");

{
  // SUCCESS: APPROVED → PUBLISHED with all 16 artifacts
  const slugP = "publish-test";
  const runIdP = randomUUID();
  const storeP = createLocalReportStore({ baseDir: testBaseDir });
  await storeP.writeReport({ slug: slugP, runId: runIdP, model: { scores: {}, evidence: { site: { domain: "t.com", pages: [{}], services: [], sourceStatus: "AVAILABLE" }, performance: { sourceStatus: "AVAILABLE" }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, input: {} }, manifest: { sources: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, scores: { trust: 50, contentDepth: 50, conversionPathways: 50, technical: 50, performance: 50, conversionReadiness: 50 } }, html: "<!DOCTYPE html><html></html>", includeIndexHtml: true });

  const now = new Date().toISOString();
  const fullChecklist = ["source_failures","top_ten_findings","high_severity","competitor_selections","internal_link_recommendations","root_cause","score_eligibility","limitations","causal_language","implementation_feasibility"].map(id => ({ id, reviewed: true, reviewedAt: now }));
  await storeP.writeReview(slugP, runIdP, { reviewer: "a@t.com", reviewedAt: now, checklist: fullChecklist, findingsReviewed: true, limitationsAccepted: true });

  const fullPages = new Map();
  if (pageMap1) for (const [fn, html] of pageMap1) fullPages.set(fn, html);

  // Approve with all 16 pages
  const approvalLc = await storeP.writeApprovedPages(slugP, runIdP, { approver: "p@t.com", approvedAt: now, reviewRef: { reviewer: "a@t.com", reviewedAt: now, checklistCount: 10, overrideCount: 0 } }, fullPages);
  check("Publish-success: approved status", approvalLc.status === "approved");
  check("Publish-success: 16 final artifacts", (approvalLc.artifacts?.final || []).length === 16);

  // --- Actual publication operation ---
  const published = await storeP.publishReport(slugP, runIdP);
  check("Publish-success: PUBLISHED status", published.status === "published");
  check("Publish-success: publishedAt set", !!published.publishedAt);
  check("Publish-success: 16 verified artifacts", published.publication?.artifactCount === 16);
  check("Publish-success: verified artifacts exist", published.publication?.verifiedArtifacts?.length === 16);

  // Prove PUBLISHED is terminal (no outgoing transitions)
  const { TRANSITION_MAP } = await import("../src/lifecycle/state-enum.js");
  const publishedOut = TRANSITION_MAP[T.PUBLISHED] || new Set();
  check("PUBLISHED terminal (no outgoing transitions)", publishedOut.size === 0);

  // Idempotent re-publish
  const republished = await storeP.publishReport(slugP, runIdP);
  check("Publish-success: idempotent re-publish", republished.status === "published");

  // FAILURE A: Missing/corrupt artifact → PUBLISH_FAILED
  const slugFA = "publish-fail-a"; const runIdFA = randomUUID();
  const storeFA = createLocalReportStore({ baseDir: testBaseDir });
  await storeFA.writeReport({ slug: slugFA, runId: runIdFA, model: { scores: {}, evidence: { site: { domain: "t.com", pages: [{}], services: [], sourceStatus: "AVAILABLE" }, performance: { sourceStatus: "AVAILABLE" }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, input: {} }, manifest: { sources: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, scores: { trust: 50, contentDepth: 50, conversionPathways: 50, technical: 50, performance: 50, conversionReadiness: 50 } }, html: "<!DOCTYPE html><html></html>", includeIndexHtml: true });
  await storeFA.writeReview(slugFA, runIdFA, { reviewer: "a@t.com", reviewedAt: now, checklist: fullChecklist, findingsReviewed: true, limitationsAccepted: true });
  // Write all 16 pages to disk then approve with all 16
  const { writeFile, mkdir, unlink } = await import("node:fs/promises");
  const faDir = resolve(testBaseDir, slugFA, runIdFA);
  await mkdir(faDir, { recursive: true });
  const allPageNames = [];
  if (pageMap1) for (const [fn, html] of pageMap1) { await writeFile(resolve(faDir, fn), html, "utf-8"); allPageNames.push(fn); }
  // Approve with all 16 pages (so lifecycle has all 16 in final)
  const faApproval = await storeFA.writeApprovedPages(slugFA, runIdFA, { approver: "p@t.com", approvedAt: now, reviewRef: { reviewer: "a@t.com", reviewedAt: now, checklistCount: 10, overrideCount: 0 } }, pageMap1);
  check("Publish-fail-A: approved with 16 pages", faApproval.status === "approved");
  // Now delete one page from disk to simulate corruption
  await unlink(resolve(faDir, "scorecard.html"));
  try {
    await storeFA.publishReport(slugFA, runIdFA);
    check("Publish-fail-A: missing artifact → rejected", false, "Should have thrown");
  } catch (e) {
    check("Publish-fail-A: missing artifact → PUBLISH_FAILED", e.message.includes("unreadable") || e.message.includes("not found") || e.message.includes("ENOENT"), e.message);
  }
  const faStatus = await storeFA.getStatus(slugFA, runIdFA);
  check("Publish-fail-A: status = publish_failed", faStatus.status === "publish_failed", `Got ${faStatus.status}`);

  // FAILURE B: Wrong starting state (non-APPROVED) → rejected
  const slugFB = "publish-fail-b"; const runIdFB = randomUUID();
  const storeFB = createLocalReportStore({ baseDir: testBaseDir });
  await storeFB.writeReport({ slug: slugFB, runId: runIdFB, model: { scores: {}, evidence: { site: { domain: "t.com", pages: [{}], services: [], sourceStatus: "AVAILABLE" }, performance: { sourceStatus: "AVAILABLE" }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, input: {} }, manifest: { sources: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, scores: { trust: 50, contentDepth: 50, conversionPathways: 50, technical: 50, performance: 50, conversionReadiness: 50 } }, html: "<!DOCTYPE html><html></html>", includeIndexHtml: true });
  // Try to publish from draft (not reviewed, not approved)
  try {
    await storeFB.publishReport(slugFB, runIdFB);
    check("Publish-fail-B: draft → rejected", false, "Should have thrown");
  } catch (e) {
    check("Publish-fail-B: draft → rejected", e.message.includes("Cannot publish"), e.message);
  }
  const fbStatus = await storeFB.getStatus(slugFB, runIdFB);
  check("Publish-fail-B: status = publish_failed", fbStatus.status === "publish_failed", `Got ${fbStatus.status}`);

  // FAILURE C: Reviewed but not approved → rejected
  const slugFC = "publish-fail-c"; const runIdFC = randomUUID();
  const storeFC = createLocalReportStore({ baseDir: testBaseDir });
  await storeFC.writeReport({ slug: slugFC, runId: runIdFC, model: { scores: {}, evidence: { site: { domain: "t.com", pages: [{}], services: [], sourceStatus: "AVAILABLE" }, performance: { sourceStatus: "AVAILABLE" }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, input: {} }, manifest: { sources: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, scores: { trust: 50, contentDepth: 50, conversionPathways: 50, technical: 50, performance: 50, conversionReadiness: 50 } }, html: "<!DOCTYPE html><html></html>", includeIndexHtml: true });
  await storeFC.writeReview(slugFC, runIdFC, { reviewer: "a@t.com", reviewedAt: now, checklist: fullChecklist, findingsReviewed: true, limitationsAccepted: true });
  try {
    await storeFC.publishReport(slugFC, runIdFC);
    check("Publish-fail-C: reviewed → rejected", false, "Should have thrown");
  } catch (e) {
    check("Publish-fail-C: reviewed → rejected", e.message.includes("Cannot publish"), e.message);
  }
  const fcStatus = await storeFC.getStatus(slugFC, runIdFC);
  check("Publish-fail-C: status = publish_failed", fcStatus.status === "publish_failed", `Got ${fcStatus.status}`);
}

// =============================================================================
// PHASE 6: REPLAY-01 — instrumented + deterministic replay identity
// =============================================================================
console.log("\n--- Phase 6: REPLAY-01 instrumented ---");

{
  const startingProviderCalls = instrumentedProviderCalls;
  const startingNarrativeCalls = instrumentedNarrativeCalls;
  const startingN8nCalls = instrumentedN8nCalls;

  // Use the SAME auditId AND executionId for both renders to prove deterministic replay
  const replayAuditId = randomUUID();
  const replayExecId = randomUUID();

  // --- First render ---
  await setupToNarrativeReady(replayAuditId);
  const r1 = await orchestrator.execute({ contractVersion: "1.0.0", auditId: replayAuditId, tenantId: "t1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://testbusiness.com", businessName: "Test Business Inc." }, { executionId: replayExecId });
  check("Replay-1: DRAFT_RENDERED", r1.finalState === T.DRAFT_RENDERED);

  // Save page hashes from first render
  const h1 = new Map();
  for (const art of r1.pageArtifacts) { const s = await artifactStore.get(art.key); h1.set(art.filename, sha256(s)); }

  // --- Reset for replay ---
  // Clear both lifecycle and artifact stores, then re-seed with identical fixtures
  lifecycleRepo._clear();
  memoryStore._clear();
  await setupToNarrativeReady(replayAuditId);

  // --- Second render (replay) with same executionId ---
  const r2 = await orchestrator.execute({ contractVersion: "1.0.0", auditId: replayAuditId, tenantId: "t1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://testbusiness.com", businessName: "Test Business Inc." }, { executionId: replayExecId });
  check("Replay-2: DRAFT_RENDERED", r2.finalState === T.DRAFT_RENDERED);

  // Save page hashes from second render
  const h2 = new Map();
  for (const art of r2.pageArtifacts) { const s = await artifactStore.get(art.key); h2.set(art.filename, sha256(s)); }

  // --- Verify deterministic replay ---
  let matches = 0;
  for (const [fn, h] of h1) if (h2.get(fn) === h) matches++;
  check(`Replay: ${matches}/${h1.size} page hashes identical`, matches === h1.size && matches === 16);
  check("Replay: viewModelHash identity (deterministic)", r1.viewModelHash === r2.viewModelHash,
    `hash1=${String(r1.viewModelHash).slice(0,16)}... hash2=${String(r2.viewModelHash).slice(0,16)}...`);
  const { LOCKED_REPORT_DESIGN_VERSION } = await import("../src/report-view-model/build-view-model.js");
  check(`Replay: reportDesignVersion=${LOCKED_REPORT_DESIGN_VERSION}`, LOCKED_REPORT_DESIGN_VERSION === "1.0.0");

  // --- Instrumented counter verification ---
  const callsFromRenders = instrumentedProviderCalls - startingProviderCalls;
  const narrativeCallsFromRenders = instrumentedNarrativeCalls - startingNarrativeCalls;
  const n8nCallsFromRenders = instrumentedN8nCalls - startingN8nCalls;
  console.log(`  [i] Provider calls during 2 renders: ${callsFromRenders}`);
  console.log(`  [i] Narrative calls during 2 renders: ${narrativeCallsFromRenders}`);
  console.log(`  [i] n8n calls during 2 renders: ${n8nCallsFromRenders}`);

  check("Replay: rendering does not invoke provider adapters", callsFromRenders === 0, `Got ${callsFromRenders} calls`);
  check("Replay: rendering does not invoke narrative/LLM", narrativeCallsFromRenders === 0, `Got ${narrativeCallsFromRenders} calls`);
  check("Replay: rendering does not invoke n8n", n8nCallsFromRenders === 0, `Got ${n8nCallsFromRenders} calls`);
}

// =============================================================================
// PHASE 7: LOCK-01 baseline SHA proof
// =============================================================================
console.log("\n--- Phase 7: LOCK-01 baseline SHA ---");

{
  const { execSync } = await import("node:child_process");
  const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  const reportDir = resolve(repoRoot, "services", "worker", "src", "report");
  const STARTING = "d3cf84b91a40037466e9cd2d59dd5320717cca23";
  const files = ["karen-leslie-template.html","render-report.js","render-approved-report.js","html-helpers.js","sections-conversion.js","sections-trust.js","sections-seo.js","sections-performance.js","sections-internal-links.js","verify-template.js"];
  let m = 0;
  for (const f of files) {
    const curr = normalizeLF(readFileSync(resolve(reportDir, f), "utf-8"));
    const base = execSync(`git show ${STARTING}:services/worker/src/report/${f}`, { encoding: "utf-8", cwd: repoRoot, stdio: ["pipe","pipe","pipe"] });
    if (sha256(curr) === sha256(base)) m++;
    check(`Lock: ${f}`, sha256(curr) === sha256(base));
  }
  check(`Lock: ${m}/${files.length} match baseline`, m === files.length);
}

// =============================================================================
// PHASE 8: GM-01 golden-master
// =============================================================================
console.log("\n--- Phase 8: GM-01 ---");

{
  const { renderApprovedReport, APPROVED_PAGES } = await import("../src/report/render-approved-report.js");
  const siteData = { domain: "testbusiness.com", targetUrl: "https://testbusiness.com", pages: [{ title: "Test Business Inc.", headings: { h1: ["Welcome"], h2: ["Services"], h3: [], h4: [] } }], services: ["Web Design"], topicKeywords: ["website optimization"], ctas: [{ text: "Contact Us", url: "https://testbusiness.com/contact" }], forms: [], trust: { testimonials: false, credentials: false, pricing: false, policies: false }, pageCount: 42, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0, totalWords: 3000, averageWords: 300, imagesMissingAlt: 0, h1Missing: 0, h1Multiple: 0, schemaTypes: ["Organization"], internalLinkCount: 100, brokenInternalLinks: [], externalCtas: [], securityHeaders: { xFrameOptions: false, xContentTypeOptions: false, referrerPolicy: false }, socialLinks: [], sourceStatus: "AVAILABLE" };
  const model = { generatedAt: "2026-08-09T12:00:00.000Z", scoringVersion: "3.0.0", reportVersion: "3.0.0", input: { businessName: "Test Business Inc.", targetUrl: "https://testbusiness.com" }, evidence: { site: siteData, performance: { sourceStatus: "AVAILABLE", mobile: { scores: { performance: 65 }, metrics: { lcpMs: 2500, fcpMs: 1200 } }, desktop: { scores: { performance: 80 }, metrics: { lcpMs: 1200, fcpMs: 600 } } }, backlinks: { sourceStatus: "AVAILABLE" }, ga4: { sourceStatus: "NOT_CONNECTED" }, gsc: { sourceStatus: "NOT_CONNECTED" }, competitors: [], competitorOpportunities: {} }, scores: { trust: 65, contentDepth: 58, conversionPathways: 72, technical: 55, performance: 48, conversionReadiness: 59, awareness: 60, consideration: 55, decision: 50, aiReadiness: 40 }, bands: { conversionReadiness: "Moderate", trust: "Moderate", evidenceConfidence: "Moderate" }, assessedWeight: 75, readinessStatus: "Provisional", showNumericScore: true, evidenceConfidenceScore: 70, rootCause: "Missing trust credentials.", findings: [], conversionPaths: [], readinessMap: [], contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] }, competitors: { comparisons: [], opportunities: { topics: [], qualifiedCandidates: [], excludedCandidates: [], gaps: [], allGaps: [], sources: {}, limitations: [] } }, sourceStatus: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" }, limitations: [], _gate: {} };
  const result = renderApprovedReport(model);
  check(`GM: ${result.filenames.length} pages`, result.filenames.length === 16);
  for (const pd of APPROVED_PAGES) {
    const fn = `${pd.pageId}.html`; const html = result.pages.get(fn);
    check(`GM: ${fn}`, !!html);
    if (html) { check(`GM: ${fn} section`, html.includes(`id="${pd.sectionId}"`)); check(`GM: ${fn} nav`, html.includes("top-nav")); check(`GM: ${fn} print`, html.includes("window.print()")); check(`GM: ${fn} @media`, html.includes("@media print")); check(`GM: ${fn} DOCTYPE`, html.startsWith("<!DOCTYPE html>")); }
  }
  const { execSync } = await import("node:child_process");
  const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  try {
    const v = execSync("node src/report/verify-template.js", { encoding: "utf-8", cwd: resolve(repoRoot, "services", "worker") }).trim();
    const pv = JSON.parse(v);
    check("GM: verify-template PASS", pv.status === "PASS");
  } catch (e) { check("GM: verify-template executed", false, e.message); }

  // Visual comparison: check if frozen visual comparison assets exist
  const goldenMasterDir = resolve(repoRoot, "report-golden-master");
  let hasVisualAssets = false;
  try { const { readdir } = await import("node:fs/promises"); const entries = await readdir(goldenMasterDir); hasVisualAssets = entries.length > 0; } catch {}
  if (hasVisualAssets) {
    console.log(`  [i] GM: frozen golden-master assets found — visual comparison available`);
  } else {
    console.log(`  [i] GM: BLOCKED — no executable frozen visual comparison assets in report-golden-master/`);
    console.log(`  [i] GM: Available proofs: structural (15 sections), CSS/print (@media), template hash (verify-template.js), navigation, DOCTYPE`);
  }
}

cleanup();
console.log(`\n========================================`);
console.log(`WP10 Acceptance: ${passed} PASS, ${failed} FAIL`);
console.log(`========================================`);
process.exit(failed > 0 ? 1 : 0);

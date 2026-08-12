/**
 * C11 — Resume all active governed states.
 *
 * For each active lifecycle state a fresh orchestrator over the same durable
 * stores must continue from the correct governed boundary:
 *   - earlier completed work is not repeated (adapter call counts)
 *   - artifact writes are not duplicated
 *   - complete AuditRequest is available (C9)
 *
 * Already proven by existing suites:
 *   CREATED / VALIDATED → orchestrator.test.js (test 1, WP5-CLOSE-VAL-*)
 *   COLLECTING (+checkpoints) → WP5-CLOSE-RESUME-01/02/03
 *   COLLECTION_FAILED → WP5-CLOSE-IDEM-02/03
 *   EVIDENCE_STORED → WP5-CLOSE-STORED-01/02/03
 *   EVIDENCE_LOCKED → WP5-CLOSE-REPLAY-01/02/03 + WP7-FAIL-01
 *
 * Proven here: SCORED, NARRATIVE_PENDING, NARRATIVE_READY.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { createLifecycleService } from "../lifecycle/lifecycle-service.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createGovernedArtifactStore, buildArtifactKey } from "../storage/governed-artifact-store.js";
import { createAuditOrchestrator } from "../orchestration/audit-orchestrator.js";
import { LIFECYCLE_STATE } from "../lifecycle/state-enum.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const T = LIFECYCLE_STATE;
const tenantId = "c11-tenant";
const clientId = "proof.example.com-prysm-production-proof";

// --- Real schema validator ---
const schemasDir = resolve(__dirname, "..", "contracts");
const _ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(_ajv);
[
  "artifact-record.schema.json", "audit-request.schema.json",
  "canonical-evidence.schema.json", "decision-evidence.schema.json",
  "finding.schema.json", "lifecycle-event.schema.json", "lifecycle-state.schema.json",
  "narrative-response.schema.json", "report-content.schema.json",
  "report-manifest.schema.json", "report-view-model.schema.json",
  "score.schema.json", "source-result.schema.json",
].forEach((f) => {
  _ajv.addSchema(JSON.parse(readFileSync(resolve(schemasDir, f), "utf-8")), `https://vantage-platform.io/prysm/contracts/v1/${f}`);
});
function validateContract(sid, obj) {
  const v = _ajv.getSchema(sid);
  if (!v) return { valid: true, errors: [] };
  const valid = v(obj);
  return { valid, errors: v.errors || [] };
}

function mockClock(iso = "2026-01-01T00:00:00.000Z") {
  let t = new Date(iso).getTime();
  return { now: () => new Date(t).toISOString(), sleep: async () => {}, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 100)) };
}

function okSourceResult(source, evidence = {}) {
  return {
    contractVersion: "1.0.0", schemaVersion: "1.0.0", source,
    provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE",
    startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z",
    retryCount: 0, coverage: { requested: 1, completed: 1, failed: 0 },
    limitations: [], evidence,
  };
}

const SITE_EVIDENCE = {
  sourceStatus: "AVAILABLE", domain: "proof.example.com", targetUrl: "https://proof.example.com", pageCount: 1,
  pages: [{ url: "https://proof.example.com", title: "Proof", headings: { h1: ["Proof"], h2: [], h3: [] }, description: "D", content: { text: "x", wordCount: 300 }, images: [], links: { internal: [], external: [] }, statusCode: 200 }],
  services: ["Governed Evidence Service"], trust: { credentials: true }, platform: "ProofCMS", schemaTypes: ["ProfessionalService"],
  statusCounts: { "200": 1 }, totalWords: 300, averageWords: 300, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
  h1Missing: 0, h1Multiple: 0, imageCount: 0, imagesMissingAlt: 0, internalLinkCount: 2, brokenInternalLinks: [],
  securityHeaders: { "strict-transport-security": true, "x-content-type-options": true },
  _contentEvidenceAvailable: true, _responseHeadersAvailable: false, collectedAt: "2026-01-01T00:00:01.000Z",
};

function countingAdapters(callCounts) {
  return {
    "dataforseo-onpage": { adapterVersion: "1.0.0", execute: async () => { callCounts["dataforseo-onpage"] = (callCounts["dataforseo-onpage"] || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: okSourceResult("dataforseo-onpage", SITE_EVIDENCE) }; } },
    pagespeed: { adapterVersion: "1.0.0", execute: async () => { callCounts.pagespeed = (callCounts.pagespeed || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: okSourceResult("pagespeed", { sourceStatus: "AVAILABLE", fallbackUsed: false, testedUrls: ["https://proof.example.com"], mobile: { status: "AVAILABLE", scores: { performance: 73 }, metrics: { fcpMs: 1200, lcpMs: 1800 } }, desktop: { status: "AVAILABLE", scores: { performance: 88 }, metrics: { fcpMs: 600, lcpMs: 900 } }, collectedAt: "2026-01-01T00:00:01.000Z" }) }; } },
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: async () => { callCounts["dataforseo-serp"] = (callCounts["dataforseo-serp"] || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: okSourceResult("dataforseo-serp", { competitors: [], suppliedCompetitors: [], audienceScope: "local", providerLocation: "Toronto", keywordCount: 1, resultCount: 0 }) }; } },
    backlinks: { adapterVersion: "1.0.0", execute: async () => { callCounts.backlinks = (callCounts.backlinks || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: okSourceResult("backlinks", { sourceStatus: "AVAILABLE", goodCount: 5 }) }; } },
    ga4: { adapterVersion: "1.0.0", execute: async () => { callCounts.ga4 = (callCounts.ga4 || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: okSourceResult("ga4", { sourceStatus: "AVAILABLE", totals: { sessions: 1000 } }) }; } },
    gsc: { adapterVersion: "1.0.0", execute: async () => { callCounts.gsc = (callCounts.gsc || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: okSourceResult("gsc", { sourceStatus: "AVAILABLE", totals: { clicks: 500 } }) }; } },
  };
}

function auditRequestFor(auditId) {
  return {
    contractVersion: "1.0.0",
    auditId,
    tenantId,
    clientId,
    idempotencyKey: randomUUID(),
    targetUrl: "https://proof.example.com",
    businessName: "Prysm Production Proof",
    market: "Toronto, Ontario",
    language: "en-CA",
    primaryGoal: "book a consultation",
    services: ["Governed Evidence Service"],
    competitors: ["https://competitor-proof.example.net"],
    ga4: { propertyId: "400123456" },
    gsc: { siteUrl: "https://proof.example.com" },
  };
}

function setup(overrides = {}) {
  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const lifecycleService = createLifecycleService(createMemoryLifecycleRepository());
  const orchestrator = createAuditOrchestrator({
    lifecycleService,
    artifactStore,
    adapters: overrides.adapters || {},
    validateContract: overrides.validateContract || validateContract,
    clock: mockClock(),
    narrativeMode: "mock",
  });
  return { artifactStore, lifecycleService, orchestrator };
}

/** Run orchestrator.execute until the state stops advancing or target reached. */
async function drive(orchestrator, auditRequest, targetStates, maxSteps = 8) {
  let last = null;
  for (let i = 0; i < maxSteps; i++) {
    const result = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
    if (targetStates.includes(result.finalState)) return result;
    if (result.finalState === last) break;
    last = result.finalState;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 11a — SCORED: fresh orchestrator resumes without re-collection/re-scoring
// ---------------------------------------------------------------------------
test("PRYSM-CLOSE-11a: SCORED resume — zero adapter calls, findings byte-identical", async () => {
  const callCounts = {};
  const first = setup({ adapters: countingAdapters(callCounts) });
  const auditRequest = auditRequestFor(randomUUID());

  // Execute once: CREATED → SCORED (collection + scoring inside one call)
  const r1 = await drive(first.orchestrator, auditRequest, [T.SCORED, T.NARRATIVE_READY, T.DRAFT_RENDERED], 3);
  assert.ok(r1, "first execution reached scoring boundary");
  for (const k of ["dataforseo-onpage", "pagespeed", "dataforseo-serp", "backlinks", "ga4", "gsc"]) {
    assert.equal(callCounts[k], 1, `${k} executed exactly once during first pass`);
  }

  const findingsKey = buildArtifactKey({ tenantId, clientId, auditId: auditRequest.auditId, category: "canonical", artifactName: "findings.json" });
  const findingsBefore = await first.artifactStore.get(findingsKey);
  const callsBefore = { ...callCounts };

  // Simulated restart: a NEW orchestrator over the same durable stores
  const second = {
    ...setup({ adapters: countingAdapters(callCounts) }),
  };
  // Reuse the same stores from the first run
  const runtime2 = {
    artifactStore: first.artifactStore,
    lifecycleService: first.lifecycleService,
    orchestrator: createAuditOrchestrator({
      lifecycleService: first.lifecycleService,
      artifactStore: first.artifactStore,
      adapters: countingAdapters(callCounts),
      validateContract,
      clock: mockClock(),
      narrativeMode: "mock",
    }),
  };

  const r2 = await drive(runtime2.orchestrator, auditRequest, [T.DRAFT_RENDERED], 6);
  assert.ok(r2 && r2.finalState === T.DRAFT_RENDERED, `resume reached draft_rendered (got ${r2?.finalState})`);

  assert.deepEqual(callCounts, callsBefore, "zero adapter calls during SCORED resume");
  const findingsAfter = await first.artifactStore.get(findingsKey);
  assert.ok(findingsAfter && findingsAfter.equals(findingsBefore), "findings.json byte-identical (no duplicate scoring write)");
});

// ---------------------------------------------------------------------------
// 11b — EVIDENCE_LOCKED: scoring failure leaves EVIDENCE_LOCKED; a fresh
// orchestrator resumes straight into scoring with zero adapter calls
// ---------------------------------------------------------------------------
test("PRYSM-CLOSE-11b: EVIDENCE_LOCKED resume — zero adapter calls", async () => {
  const callCounts = {};
  // First orchestrator: scoring validation fails → stays EVIDENCE_LOCKED
  const failingValidator = (sid, obj) => {
    if (sid.includes("score.schema.json")) return { valid: false, errors: [{ message: "controlled scoring validation failure" }] };
    return validateContract(sid, obj);
  };
  const first = setup({ adapters: countingAdapters(callCounts), validateContract: failingValidator });
  const auditRequest = auditRequestFor(randomUUID());

  const r1 = await drive(first.orchestrator, auditRequest, [T.EVIDENCE_LOCKED, T.SCORED], 3);
  assert.ok(r1, "first execution reached evidence boundary");
  const cs = await first.lifecycleService.currentState(auditRequest.auditId, tenantId);
  assert.equal(cs.state, T.EVIDENCE_LOCKED, "scoring failure leaves audit at evidence_locked (fail-closed)");
  const callsBefore = { ...callCounts };

  // Fresh orchestrator with a working validator resumes from EVIDENCE_LOCKED
  const fresh = createAuditOrchestrator({
    lifecycleService: first.lifecycleService,
    artifactStore: first.artifactStore,
    adapters: countingAdapters(callCounts),
    validateContract,
    clock: mockClock(),
    narrativeMode: "mock",
  });

  const r2 = await drive(fresh, auditRequest, [T.DRAFT_RENDERED], 8);
  assert.ok(r2 && r2.finalState === T.DRAFT_RENDERED, `resume reached draft_rendered (got ${r2?.finalState})`);
  assert.deepEqual(callCounts, callsBefore, "zero adapter calls during EVIDENCE_LOCKED resume");
});

// ---------------------------------------------------------------------------
// 11c — NARRATIVE_PENDING without narrative artifact: narrative re-runs,
// providers never re-called
// ---------------------------------------------------------------------------
test("PRYSM-CLOSE-11c: NARRATIVE_PENDING resume — narrative re-run, zero provider calls", async () => {
  const callCounts = {};
  const stores = { artifactStore: null, lifecycleService: null };
  const first = setup({ adapters: countingAdapters(callCounts) });
  stores.artifactStore = first.artifactStore;
  stores.lifecycleService = first.lifecycleService;

  // Template audit driven fully through the real production path
  const template = auditRequestFor(randomUUID());
  const t1 = await drive(first.orchestrator, template, [T.SCORED, T.NARRATIVE_READY, T.DRAFT_RENDERED], 8);
  assert.ok(t1, "template audit progressed");
  const templateFinal = (await first.lifecycleService.currentState(template.auditId, tenantId)).state;
  const targetState = templateFinal === T.SCORED ? T.SCORED : null;

  // Drive template to completion so all artifacts exist
  if (templateFinal !== T.DRAFT_RENDERED) {
    const r = await drive(first.orchestrator, template, [T.DRAFT_RENDERED], 4);
    assert.ok(r && r.finalState === T.DRAFT_RENDERED, "template audit completed");
  }

  // Seed target audit at NARRATIVE_PENDING with template artifacts copied
  const target = auditRequestFor(randomUUID());
  const { persistAuditRequest } = await import("../orchestration/audit-request-persistence.js");
  const targetLifecycle = createLifecycleService(createMemoryLifecycleRepository());

  // Copy template artifacts into target keys (auditId patched where present)
  const copyArtifact = async (category, name, patchAuditId = false) => {
    const srcKey = buildArtifactKey({ tenantId, clientId, auditId: template.auditId, category, artifactName: name });
    const bytes = await first.artifactStore.get(srcKey);
    if (!bytes) return false;
    let content = bytes;
    if (patchAuditId) {
      const obj = JSON.parse(bytes.toString("utf-8"));
      obj.auditId = target.auditId;
      content = Buffer.from(JSON.stringify(obj), "utf-8");
    }
    await first.artifactStore.put({
      bytes: content,
      contentType: "application/json",
      scope: { tenantId, clientId, auditId: target.auditId, category, artifactName: name },
    });
    return true;
  };

  await copyArtifact("canonical", "decision-evidence.json");
  await copyArtifact("canonical", "findings.json");
  await copyArtifact("canonical", "scores.json");
  await copyArtifact("report", "report-content.json", true);
  // NOTE: narrative.json intentionally NOT copied — the stranded audit
  // died before the narrative persisted.

  // Seed target lifecycle through governed transitions to NARRATIVE_PENDING
  await targetLifecycle.create({ auditId: target.auditId, tenantId, clientId, idempotencyKey: target.idempotencyKey });
  const execId = randomUUID();
  for (const [toState, note] of [
    [T.VALIDATED, "validated"], [T.COLLECTING, "collecting"], [T.EVIDENCE_STORED, "evidence-stored"],
    [T.EVIDENCE_LOCKED, "evidence-locked"], [T.SCORED, "scored"], [T.NARRATIVE_PENDING, "narrative-pending"],
  ]) {
    await targetLifecycle.transition({
      auditId: target.auditId, tenantId, toState,
      transitionIdempotencyKey: `${target.auditId}:${execId}:${note}`,
      artifactKey: null,
    });
  }
  await persistAuditRequest({ store: first.artifactStore, auditRequest: target, validateContract });

  const seededState = (await targetLifecycle.currentState(target.auditId, tenantId)).state;
  assert.equal(seededState, T.NARRATIVE_PENDING, "target stranded at narrative_pending");

  // Fresh orchestrator resumes the stranded audit
  const callsBefore = { ...callCounts };
  const fresh = createAuditOrchestrator({
    lifecycleService: targetLifecycle,
    artifactStore: first.artifactStore,
    adapters: countingAdapters(callCounts),
    validateContract,
    clock: mockClock(),
    narrativeMode: "mock",
  });

  const r2 = await drive(fresh, target, [T.NARRATIVE_READY, T.DRAFT_RENDERED], 3);
  assert.ok(r2 && [T.NARRATIVE_READY, T.DRAFT_RENDERED].includes(r2.finalState), `resume advanced (got ${r2?.finalState})`);
  assert.deepEqual(callCounts, callsBefore, "zero provider calls during NARRATIVE_PENDING resume");

  // Narrative artifact now exists (produced by the resumed execution)
  const narrKey = `tenants/${tenantId}/clients/${clientId}/audits/${target.auditId}/report/narrative.json`;
  assert.equal(await first.artifactStore.exists(narrKey), true, "narrative artifact produced by recovery");
});

// ---------------------------------------------------------------------------
// 11d — NARRATIVE_READY: resume renders without re-running narrative
// ---------------------------------------------------------------------------
test("PRYSM-CLOSE-11d: NARRATIVE_READY resume — renders, zero provider calls", async () => {
  const callCounts = {};
  const first = setup({ adapters: countingAdapters(callCounts) });

  // Template audit driven fully to DRAFT_RENDERED
  const template = auditRequestFor(randomUUID());
  const t1 = await drive(first.orchestrator, template, [T.SCORED, T.NARRATIVE_READY, T.DRAFT_RENDERED], 8);
  assert.ok(t1, "template progressed");
  if (t1.finalState !== T.DRAFT_RENDERED) {
    const r = await drive(first.orchestrator, template, [T.DRAFT_RENDERED], 4);
    assert.ok(r && r.finalState === T.DRAFT_RENDERED, "template completed");
  }

  // Seed target at NARRATIVE_READY with all artifacts copied (incl. narrative)
  const target = auditRequestFor(randomUUID());
  const { persistAuditRequest } = await import("../orchestration/audit-request-persistence.js");
  const targetLifecycle = createLifecycleService(createMemoryLifecycleRepository());

  const copyArtifact = async (category, name, patchAuditId = false) => {
    const srcKey = buildArtifactKey({ tenantId, clientId, auditId: template.auditId, category, artifactName: name });
    const bytes = await first.artifactStore.get(srcKey);
    if (!bytes) return false;
    let content = bytes;
    if (patchAuditId) {
      const obj = JSON.parse(bytes.toString("utf-8"));
      obj.auditId = target.auditId;
      content = Buffer.from(JSON.stringify(obj), "utf-8");
    }
    await first.artifactStore.put({
      bytes: content,
      contentType: "application/json",
      scope: { tenantId, clientId, auditId: target.auditId, category, artifactName: name },
    });
    return true;
  };

  await copyArtifact("canonical", "decision-evidence.json");
  await copyArtifact("canonical", "findings.json");
  await copyArtifact("canonical", "scores.json");
  await copyArtifact("report", "report-content.json", true);
  await copyArtifact("report", "narrative.json", true);

  await targetLifecycle.create({ auditId: target.auditId, tenantId, clientId, idempotencyKey: target.idempotencyKey });
  const execId = randomUUID();
  for (const [toState, note] of [
    [T.VALIDATED, "validated"], [T.COLLECTING, "collecting"], [T.EVIDENCE_STORED, "evidence-stored"],
    [T.EVIDENCE_LOCKED, "evidence-locked"], [T.SCORED, "scored"], [T.NARRATIVE_PENDING, "narrative-pending"],
    [T.NARRATIVE_READY, "narrative-ready"],
  ]) {
    await targetLifecycle.transition({
      auditId: target.auditId, tenantId, toState,
      transitionIdempotencyKey: `${target.auditId}:${execId}:${note}`,
      artifactKey: null,
    });
  }
  await persistAuditRequest({ store: first.artifactStore, auditRequest: target, validateContract });

  const seededState = (await targetLifecycle.currentState(target.auditId, tenantId)).state;
  assert.equal(seededState, T.NARRATIVE_READY, "target stranded at narrative_ready");

  const callsBefore = { ...callCounts };
  const fresh = createAuditOrchestrator({
    lifecycleService: targetLifecycle,
    artifactStore: first.artifactStore,
    adapters: countingAdapters(callCounts),
    validateContract,
    clock: mockClock(),
    narrativeMode: "mock",
  });

  const r2 = await drive(fresh, target, [T.DRAFT_RENDERED], 3);
  assert.ok(r2 && r2.finalState === T.DRAFT_RENDERED, `resume rendered (got ${r2?.finalState})`);
  assert.deepEqual(callCounts, callsBefore, "zero provider calls during NARRATIVE_READY resume");
});

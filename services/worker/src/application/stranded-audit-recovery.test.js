/**
 * C10 — Durable audit execution proof.
 *
 * The durability boundary is the persisted work record:
 *   PostgreSQL lifecycle state + persisted complete AuditRequest (C9) +
 *   governed artifact store.
 *
 * Proves:
 *   - PRYSM-CLOSE-10a: audit accepted → durable work record exists
 *     (lifecycle CREATED + persisted AuditRequest + artifacts)
 *   - PRYSM-CLOSE-10b: a NEW runtime instance (process restart) reclaims an
 *     audit stranded mid-flight and drives it to DRAFT_RENDERED
 *   - PRYSM-CLOSE-10c: already-rendered audits are not re-executed
 *     (idempotent reclamation)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProductionRuntime } from "./production-runtime.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createGovernedArtifactStore, buildArtifactKey } from "../storage/governed-artifact-store.js";
import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { createLocalReportStore } from "../storage/report-store.js";
import { LIFECYCLE_STATE } from "../lifecycle/state-enum.js";

const T = LIFECYCLE_STATE;
const testBaseDir = mkdtempSync(join(tmpdir(), "prysm-c10-"));
const tenantId = "c10-tenant";

function baseConfig() {
  return {
    artifactDir: join(testBaseDir, "artifacts"),
    webhookSecret: "",
    vantageTenantId: tenantId,
    databaseUrl: "",
    onpagePollTimeoutMs: 600_000, // long — so a hung adapter strands the audit
    narrativeMode: "mock",
    port: 3000,
    reportsBucket: "",
    awsRegion: "ca-central-1",
    reportsPrefix: "vantage/reports",
  };
}

function okSourceResult(source, evidence = {}) {
  return {
    contractVersion: "1.0.0", schemaVersion: "1.0.0", source,
    provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE",
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    retryCount: 0, coverage: { requested: 1, completed: 1, failed: 0 },
    limitations: [], evidence,
  };
}

function workingAdapters() {
  return {
    "dataforseo-onpage": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("dataforseo-onpage", {
      sourceStatus: "AVAILABLE", domain: "proof.example.com", targetUrl: "https://proof.example.com", pageCount: 1,
      pages: [{ url: "https://proof.example.com", title: "Proof", headings: { h1: ["Proof"], h2: [], h3: [] }, description: "D", content: { text: "x", wordCount: 300 }, images: [], links: { internal: [], external: [] }, statusCode: 200 }],
      services: ["Governed Evidence Service"], trust: { credentials: true }, platform: "ProofCMS", schemaTypes: ["ProfessionalService"],
      statusCounts: { "200": 1 }, totalWords: 300, averageWords: 300, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
      h1Missing: 0, h1Multiple: 0, imageCount: 0, imagesMissingAlt: 0, internalLinkCount: 2, brokenInternalLinks: [],
      securityHeaders: { "strict-transport-security": true, "x-content-type-options": true },
      _contentEvidenceAvailable: true, _responseHeadersAvailable: false, collectedAt: new Date().toISOString(),
    }) }) },
    pagespeed: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("pagespeed", {
      sourceStatus: "AVAILABLE", fallbackUsed: false, testedUrls: ["https://proof.example.com"],
      mobile: { status: "AVAILABLE", scores: { performance: 73, accessibility: 92, bestPractices: 85, seo: 90 }, metrics: { fcpMs: 1200, lcpMs: 1800, cls: 0.05, tbtMs: 200 } },
      desktop: { status: "AVAILABLE", scores: { performance: 88, accessibility: 94, bestPractices: 88, seo: 92 }, metrics: { fcpMs: 600, lcpMs: 900, cls: 0.02, tbtMs: 80 } },
      collectedAt: new Date().toISOString(),
    }) }) },
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("dataforseo-serp", { competitors: [], suppliedCompetitors: [], audienceScope: "local", providerLocation: "Toronto", keywordCount: 1, resultCount: 0 }) }) },
    backlinks: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("backlinks", { sourceStatus: "AVAILABLE", goodCount: 5 }) }) },
    ga4: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("ga4", { sourceStatus: "AVAILABLE", totals: { sessions: 1000 } }) }) },
    gsc: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("gsc", { sourceStatus: "AVAILABLE", totals: { clicks: 500 } }) }) },
  };
}

/** Wrap the memory repository with PostgreSQL-equivalent metadata + listing. */
function wrapRepo(baseRepo) {
  const metaStore = new Map();
  return {
    ...baseRepo,
    updateAuditMetadata: async (auditId, tenantId, patch) => {
      metaStore.set(auditId, { ...(metaStore.get(auditId) || {}), ...patch });
    },
    getAuditMetadata: async (auditId, tenantId) => metaStore.get(auditId) || null,
    listByTenant: async (tenantId2, limit = 50, offset = 0) => {
      const rows = [];
      for (const [auditId, meta] of metaStore.entries()) {
        rows.push({ audit_id: auditId, client_id: meta.client_id || "", business_name: meta.business_name || "", target_url: meta.target_url || "", created_at: meta.created_at || new Date().toISOString(), latest_state: null, updated_at: new Date().toISOString() });
      }
      return rows.slice(offset, offset + limit);
    },
  };
}

function newSharedStores() {
  return {
    artifactStore: createGovernedArtifactStore({ store: createMemoryArtifactStore() }),
    reportStore: createLocalReportStore({ baseDir: join(testBaseDir, `reports-${Math.random().toString(36).slice(2)}`) }),
  };
}

// ---------------------------------------------------------------------------
// 10a — durable work record exists after acceptance
// ---------------------------------------------------------------------------
test("PRYSM-CLOSE-10a: audit acceptance creates a durable work record", async () => {
  const stores = newSharedStores();
  const repo = wrapRepo(createMemoryLifecycleRepository());
  const runtime = createProductionRuntime({
    config: baseConfig(),
    adapters: workingAdapters(),
    validateContract: () => ({ valid: true, errors: [] }),
    artifactStore: stores.artifactStore,
    lifecycleRepo: repo,
    reportStore: stores.reportStore,
  });

  const { auditId, clientId } = await runtime.auditService.createAudit(
    {
      targetUrl: "https://proof.example.com",
      businessName: "Prysm Production Proof",
      market: "Toronto, Ontario",
      language: "en-CA",
      primaryGoal: "book a consultation",
      services: ["Governed Evidence Service"],
      competitors: ["https://competitor-proof.example.net"],
    },
    tenantId,
  );

  // Durable record 1: lifecycle state exists
  const cs = await runtime.lifecycleService.currentState(auditId, tenantId);
  assert.ok(cs, "lifecycle record exists");

  // Durable record 2: complete AuditRequest persisted
  const reqKey = buildArtifactKey({ tenantId, clientId, auditId, category: "canonical", artifactName: "audit-request.json" });
  assert.equal(await stores.artifactStore.exists(reqKey), true, "persisted AuditRequest exists");

  // Let the background execution settle to a terminal state so timers drain
  for (let i = 0; i < 400; i++) {
    const cur = await runtime.lifecycleService.currentState(auditId, tenantId);
    if (cur && cur.state === "draft_rendered") break;
    await new Promise((r) => setTimeout(r, 25));
  }
});

// ---------------------------------------------------------------------------
// 10b — process restart reclamation drives a stranded audit to completion
// ---------------------------------------------------------------------------
test("PRYSM-CLOSE-10b: new runtime instance reclaims a stranded audit to DRAFT_RENDERED", async () => {
  const stores = newSharedStores();
  const repo = wrapRepo(createMemoryLifecycleRepository());

  // ── Process A: accept the audit, reach COLLECTING, then die ──
  // Simulate the exact durable state a terminated process leaves behind:
  // lifecycle events (CREATED → VALIDATED → COLLECTING) plus the persisted
  // complete AuditRequest.  No in-process promise survives.
  const { createLifecycleService } = await import("../lifecycle/lifecycle-service.js");
  const { persistAuditRequest } = await import("../orchestration/audit-request-persistence.js");
  const { randomUUID } = await import("node:crypto");

  const lifecycleServiceA = createLifecycleService(repo);
  const auditId = randomUUID();
  const clientId = "proof.example.com-prysm-production-proof";
  const idempotencyKey = randomUUID();
  const executionId = randomUUID();

  const auditRequest = {
    contractVersion: "1.0.0",
    auditId,
    tenantId,
    clientId,
    idempotencyKey,
    targetUrl: "https://proof.example.com",
    businessName: "Prysm Production Proof",
    market: "Toronto, Ontario",
    language: "en-CA",
    primaryGoal: "book a consultation",
    services: ["Governed Evidence Service"],
    competitors: ["https://competitor-proof.example.net"],
  };

  await lifecycleServiceA.create({ auditId, tenantId, clientId, idempotencyKey });
  for (const [toState, note] of [[T.VALIDATED, "validated"], [T.COLLECTING, "collecting"]]) {
    await lifecycleServiceA.transition({
      auditId, tenantId, toState,
      transitionIdempotencyKey: `${auditId}:${executionId}:${note}`,
      artifactKey: null,
    });
  }
  await persistAuditRequest({ store: stores.artifactStore, auditRequest, validateContract: () => ({ valid: true, errors: [] }) });
  await repo.updateAuditMetadata(auditId, tenantId, { business_name: "Prysm Production Proof", target_url: "https://proof.example.com", client_id: clientId });

  const strandedState = (await lifecycleServiceA.currentState(auditId, tenantId))?.state;
  assert.equal(strandedState, T.COLLECTING, "process A stranded the audit at collecting");

  // ── Process B: fresh runtime over the SAME durable stores ──
  const runtimeB = createProductionRuntime({
    config: baseConfig(),
    adapters: workingAdapters(),
    validateContract: () => ({ valid: true, errors: [] }),
    artifactStore: stores.artifactStore,
    lifecycleRepo: repo,
    reportStore: stores.reportStore,
  });

  const recovered = await runtimeB.recoverStrandedAudits(tenantId);

  assert.ok(recovered.some((r) => r.auditId === auditId), "stranded audit reclaimed");
  const final = (await runtimeB.lifecycleService.currentState(auditId, tenantId))?.state;
  assert.equal(final, T.DRAFT_RENDERED, `audit reached draft_rendered after restart (got ${final})`);

  // Governed artifacts exist (score + pages produced by the reclaim)
  const cs = await runtimeB.lifecycleService.currentState(auditId, tenantId);
  const scoresKey = buildArtifactKey({ tenantId, clientId: cs.clientId, auditId, category: "canonical", artifactName: "scores.json" });
  assert.equal(await stores.artifactStore.exists(scoresKey), true, "scores artifact written by reclamation");
});

// ---------------------------------------------------------------------------
// 10c — reclamation is idempotent: rendered audits are not re-executed
// ---------------------------------------------------------------------------
test("PRYSM-CLOSE-10c: reclamation leaves completed audits untouched", async () => {
  const stores = newSharedStores();
  const repo = wrapRepo(createMemoryLifecycleRepository());

  const runtime = createProductionRuntime({
    config: baseConfig(),
    adapters: workingAdapters(),
    validateContract: () => ({ valid: true, errors: [] }),
    artifactStore: stores.artifactStore,
    lifecycleRepo: repo,
    reportStore: stores.reportStore,
  });

  const { auditId } = await runtime.auditService.createAudit(
    {
      targetUrl: "https://proof.example.com",
      businessName: "Prysm Production Proof",
      market: "Toronto, Ontario",
      language: "en-CA",
      primaryGoal: "book a consultation",
      services: ["Governed Evidence Service"],
    },
    tenantId,
  );

  // Drive to completion via the runtime's own background execution
  for (let i = 0; i < 200; i++) {
    const cs = await runtime.lifecycleService.currentState(auditId, tenantId);
    if (cs && [T.DRAFT_RENDERED].includes(cs.state)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const before = (await runtime.lifecycleService.currentState(auditId, tenantId))?.state;
  assert.equal(before, T.DRAFT_RENDERED, "audit reached draft_rendered");

  // Fresh "restart" runtime over the same stores re-runs the sweep
  const runtimeB = createProductionRuntime({
    config: baseConfig(),
    adapters: workingAdapters(),
    validateContract: () => ({ valid: true, errors: [] }),
    artifactStore: stores.artifactStore,
    lifecycleRepo: repo,
    reportStore: stores.reportStore,
  });
  const recovered = await runtimeB.recoverStrandedAudits(tenantId);

  // DRAFT_RENDERED is not stranded — the sweep must not touch it
  assert.equal(recovered.some((r) => r.auditId === auditId), false, "completed audit not reclaimed");
  const after = (await runtimeB.lifecycleService.currentState(auditId, tenantId))?.state;
  assert.equal(after, T.DRAFT_RENDERED, "lifecycle unchanged");
});

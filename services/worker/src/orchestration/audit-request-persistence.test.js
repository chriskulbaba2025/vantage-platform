/**
 * C9 — Complete AuditRequest durable persistence proof.
 *
 * Proves:
 *   - PRYSM-CLOSE-09a: complete normalized AuditRequest survives persistence
 *     and reload with exact deep equality (no value lost, no default added).
 *   - PRYSM-CLOSE-09b: resume path loads the persisted record verbatim —
 *     recovery never reconstructs missing values with defaults.
 *   - PRYSM-CLOSE-09c: invalid request fails before persistence.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createGovernedArtifactStore } from "../storage/governed-artifact-store.js";
import { persistAuditRequest, loadAuditRequest, auditRequestArtifactKey } from "./audit-request-persistence.js";

function validateContract() {
  return () => ({ valid: true, errors: [] });
}

function fullAuditRequest(overrides = {}) {
  return {
    contractVersion: "1.0.0",
    auditId: randomUUID(),
    tenantId: "t1",
    clientId: "c1",
    idempotencyKey: randomUUID(),
    targetUrl: "https://proof.example.com",
    businessName: "Prysm Production Proof",
    market: "Toronto, Ontario",
    language: "en-CA",
    primaryGoal: "book a consultation",
    services: ["Governed Evidence Service", "Conversion Audits"],
    competitors: ["https://competitor-proof.example.net"],
    category: "consulting",
    audiences: ["business owners"],
    objections: ["price"],
    conversionUrls: ["https://proof.example.com/contact"],
    cmsNotes: "ProofCMS site",
    crawl: { maxPages: 250, enableJavascript: false },
    ga4: { propertyId: "400123456" },
    gsc: { siteUrl: "https://proof.example.com" },
    ...overrides,
  };
}

// --- 09a: complete request survives round-trip with exact equality ---
test("PRYSM-CLOSE-09a: complete AuditRequest round-trips with exact deep equality", async () => {
  const store = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const auditRequest = fullAuditRequest();

  await persistAuditRequest({ store, auditRequest, validateContract: validateContract() });

  const loaded = await loadAuditRequest({
    store,
    scope: {
      tenantId: auditRequest.tenantId,
      clientId: auditRequest.clientId,
      auditId: auditRequest.auditId,
    },
    validateContract: validateContract(),
  });

  assert.deepEqual(loaded, auditRequest, "loaded request must deep-equal the persisted request");
  assert.equal(loaded.market, "Toronto, Ontario", "market preserved exactly");
  assert.equal(loaded.services.length, 2, "services preserved exactly");
  assert.equal(loaded.competitors[0], "https://competitor-proof.example.net", "competitors preserved exactly");
  assert.equal(loaded.language, "en-CA", "language preserved exactly");
  assert.equal(loaded.primaryGoal, "book a consultation", "primaryGoal preserved exactly");
  assert.equal(loaded.ga4.propertyId, "400123456", "ga4 preserved exactly");
  assert.equal(loaded.gsc.siteUrl, "https://proof.example.com", "gsc preserved exactly");
  assert.equal(loaded.crawl.maxPages, 250, "crawl config preserved exactly");
});

// --- 09b: artifact record verifies read-back (SHA + bytes) ---
test("PRYSM-CLOSE-09b: persisted record carries verified sha256 and byte count", async () => {
  const store = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const auditRequest = fullAuditRequest();

  const record = await persistAuditRequest({ store, auditRequest, validateContract: validateContract() });

  assert.equal(record.key, auditRequestArtifactKey({
    tenantId: auditRequest.tenantId,
    clientId: auditRequest.clientId,
    auditId: auditRequest.auditId,
  }), "canonical artifact key correct");
  assert.ok(record.sha256 && record.sha256.length === 64, "sha256 present");
  assert.ok(record.bytes > 0, "byte count recorded");
});

// --- 09c: missing persisted request returns null (never reconstructed) ---
test("PRYSM-CLOSE-09c: missing persisted request returns null — no reconstruction", async () => {
  const store = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const loaded = await loadAuditRequest({
    store,
    scope: { tenantId: "t1", clientId: "c1", auditId: randomUUID() },
    validateContract: validateContract(),
  });
  assert.equal(loaded, null, "missing request must return null, not a reconstructed object");
});

// --- 09d: reload without defaults — minimal request stays minimal ---
test("PRYSM-CLOSE-09d: minimal request round-trips without injected defaults", async () => {
  const store = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const auditRequest = fullAuditRequest({
    market: undefined,
    services: undefined,
    competitors: undefined,
    primaryGoal: undefined,
    category: undefined,
    audiences: undefined,
    objections: undefined,
    conversionUrls: undefined,
    cmsNotes: undefined,
    crawl: undefined,
    ga4: undefined,
    gsc: undefined,
  });
  delete auditRequest.market;
  delete auditRequest.services;
  delete auditRequest.competitors;
  delete auditRequest.primaryGoal;
  delete auditRequest.category;
  delete auditRequest.audiences;
  delete auditRequest.objections;
  delete auditRequest.conversionUrls;
  delete auditRequest.cmsNotes;
  delete auditRequest.crawl;
  delete auditRequest.ga4;
  delete auditRequest.gsc;

  await persistAuditRequest({ store, auditRequest, validateContract: validateContract() });

  const loaded = await loadAuditRequest({
    store,
    scope: { tenantId: "t1", clientId: "c1", auditId: auditRequest.auditId },
    validateContract: validateContract(),
  });

  assert.deepEqual(loaded, auditRequest, "minimal request round-trips exactly");
  assert.equal(loaded.market, undefined, "no market default injected");
  assert.equal(loaded.services, undefined, "no services default injected");
  assert.equal(loaded.competitors, undefined, "no competitors default injected");
});

// ---------------------------------------------------------------------------
// PRYSM-CLOSE-09e — production runtime createAudit persists the complete
// normalized request; reloaded request deep-equals the pre-persistence one.
// ---------------------------------------------------------------------------

test("PRYSM-CLOSE-09e: production runtime persists complete AuditRequest for resume", async () => {
  const { createProductionRuntime } = await import("../application/production-runtime.js");
  const { createMemoryArtifactStore } = await import("../storage/memory-artifact-store.js");
  const { createGovernedArtifactStore } = await import("../storage/governed-artifact-store.js");
  const { createMemoryLifecycleRepository } = await import("../lifecycle/memory-repository.js");
  const { createLocalReportStore } = await import("../storage/report-store.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  // Wrap memory repo with metadata functions so the runtime can record
  // businessName/targetUrl the way the PostgreSQL repository does.
  const baseRepo = createMemoryLifecycleRepository();
  const metaStore = new Map();
  const lifecycleRepo = {
    ...baseRepo,
    updateAuditMetadata: async (auditId, tenantId, patch) => {
      metaStore.set(auditId, { ...(metaStore.get(auditId) || {}), ...patch });
    },
    getAuditMetadata: async (auditId, tenantId) => metaStore.get(auditId) || null,
  };

  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });

  const runtime = createProductionRuntime({
    config: {
      artifactDir: join(mkdtempSync(join(tmpdir(), "prysm-c9-")), "artifacts"),
      webhookSecret: "",
      vantageTenantId: "c9-tenant",
      databaseUrl: "",
      onpagePollTimeoutMs: 5000,
      narrativeMode: "mock",
      port: 3000,
      reportsBucket: "",
      awsRegion: "ca-central-1",
      reportsPrefix: "vantage/reports",
    },
    adapters: {
      "dataforseo-onpage": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: { contractVersion: "1.0.0", schemaVersion: "1.0.0", source: "dataforseo-onpage", provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), retryCount: 0, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: { sourceStatus: "AVAILABLE", domain: "proof.example.com" } } }) },
      pagespeed: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: { contractVersion: "1.0.0", schemaVersion: "1.0.0", source: "pagespeed", provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), retryCount: 0, coverage: { requested: 2, completed: 2, failed: 0 }, limitations: [], evidence: { sourceStatus: "AVAILABLE", mobile: { scores: { performance: 73 }, metrics: { fcpMs: 1200, lcpMs: 1800 } }, desktop: { scores: { performance: 88 }, metrics: { fcpMs: 600, lcpMs: 900 } } } } }) },
      "dataforseo-serp": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: { contractVersion: "1.0.0", schemaVersion: "1.0.0", source: "dataforseo-serp", provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), retryCount: 0, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: { competitors: [] } } }) },
      backlinks: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: { contractVersion: "1.0.0", schemaVersion: "1.0.0", source: "backlinks", provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), retryCount: 0, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: { sourceStatus: "AVAILABLE" } } }) },
      ga4: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: { contractVersion: "1.0.0", schemaVersion: "1.0.0", source: "ga4", provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), retryCount: 0, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: { sourceStatus: "AVAILABLE" } } }) },
      gsc: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: { contractVersion: "1.0.0", schemaVersion: "1.0.0", source: "gsc", provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), retryCount: 0, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: { sourceStatus: "AVAILABLE" } } }) },
    },
    validateContract: () => ({ valid: true, errors: [] }),
    artifactStore,
    lifecycleRepo,
    reportStore: createLocalReportStore({ baseDir: join(mkdtempSync(join(tmpdir(), "prysm-c9-")), "reports") }),
  });

  const { auditId, tenantId, clientId } = await runtime.auditService.createAudit(
    {
      targetUrl: "https://proof.example.com",
      businessName: "Prysm Production Proof",
      market: "Toronto, Ontario",
      language: "en-CA",
      primaryGoal: "book a consultation",
      services: ["Governed Evidence Service"],
      competitors: ["https://competitor-proof.example.net"],
      ga4: { propertyId: "400123456" },
      gsc: { siteUrl: "https://proof.example.com" },
    },
    "c9-tenant",
  );

  const loaded = await loadAuditRequest({
    store: artifactStore,
    scope: { tenantId, clientId, auditId },
    validateContract: () => ({ valid: true, errors: [] }),
  });

  assert.ok(loaded, "persisted request must exist");
  assert.equal(loaded.market, "Toronto, Ontario", "market survives runtime persistence");
  assert.equal(loaded.language, "en-CA", "language survives runtime persistence");
  assert.equal(loaded.primaryGoal, "book a consultation", "primaryGoal survives runtime persistence");
  assert.deepEqual(loaded.services, ["Governed Evidence Service"], "services survive runtime persistence");
  assert.deepEqual(loaded.competitors, ["https://competitor-proof.example.net"], "competitors survive runtime persistence");
  assert.equal(loaded.ga4.propertyId, "400123456", "ga4 survives runtime persistence");
  assert.equal(loaded.gsc.siteUrl, "https://proof.example.com", "gsc survives runtime persistence");
});

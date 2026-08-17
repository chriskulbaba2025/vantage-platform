/**
 * PRYSM-V2-PROD-01 — report-design selection must survive the PRODUCTION
 * request boundary.
 *
 * Proven production defect: createProductionRuntime().auditService.createAudit
 * rebuilds the governed AuditRequest but never copies `input.report`, so a
 * requested designVersion 2.0.0 is silently dropped and the audit renders
 * through the governed v1 default (V2 SELECTION GATE FAILED in production on
 * 2026-08-17, audit 251a1f25).
 *
 * Proof-first: test 1 FAILS against the pre-fix boundary and passes only
 * after the strict allowlist passthrough is added to the production runtime.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createGovernedArtifactStore } from "../storage/governed-artifact-store.js";
import { createLocalReportStore } from "../storage/report-store.js";
import { createProductionRuntime } from "./production-runtime.js";
import { LIFECYCLE_STATE } from "../lifecycle/state-enum.js";

const T = LIFECYCLE_STATE;
const testBaseDir = mkdtempSync(join(tmpdir(), "prysm-v2boundary-"));
const tenantId = "v2boundary-tenant";

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
    contractVersion: "1.0.0", schemaVersion: "1.0.0", source,
    provider: "mock", adapterVersion: "1.0.0", status: "AVAILABLE",
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    retryCount: 0, coverage: { requested: 1, completed: 1, failed: 0 },
    limitations: [], evidence,
  };
}

function workingAdapters() {
  const siteEvidence = {
    sourceStatus: "AVAILABLE", domain: "proof.example.com", targetUrl: "https://proof.example.com", pageCount: 1,
    pages: [{ url: "https://proof.example.com", title: "Proof", headings: { h1: ["Proof"], h2: [], h3: [] }, description: "D", content: { text: "x", wordCount: 300 }, images: [], links: { internal: [], external: [] }, statusCode: 200 }],
    services: ["Governed Evidence Service"], trust: { credentials: true }, platform: "ProofCMS", schemaTypes: ["ProfessionalService"],
    statusCounts: { "200": 1 }, totalWords: 300, averageWords: 300, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
    h1Missing: 0, h1Multiple: 0, imageCount: 0, imagesMissingAlt: 0, internalLinkCount: 2, brokenInternalLinks: [],
    securityHeaders: {}, _contentEvidenceAvailable: true, _responseHeadersAvailable: false, collectedAt: new Date().toISOString(),
  };
  return {
    "dataforseo-onpage": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: okSourceResult("dataforseo-onpage", siteEvidence) }) },
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

function wrapRepo(baseRepo) {
  const metaStore = new Map();
  return {
    ...baseRepo,
    updateAuditMetadata: async (auditId, t, patch) => {
      metaStore.set(auditId, { ...(metaStore.get(auditId) || {}), ...patch });
    },
    getAuditMetadata: async (auditId, t) => metaStore.get(auditId) || null,
  };
}

async function waitForState(runtime, auditId, states, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cs = await runtime.lifecycleService.currentState(auditId, tenantId);
    if (states.includes(cs?.state)) return cs;
    await new Promise((r) => setTimeout(r, 50));
  }
  return runtime.lifecycleService.currentState(auditId, tenantId);
}

async function buildRuntime(artifactStore) {
  const reportStore = createLocalReportStore({ baseDir: join(testBaseDir, `reports-${randomUUID().slice(0, 8)}`) });
  const runtime = createProductionRuntime({
    config: baseConfig(),
    adapters: workingAdapters(),
    validateContract: () => ({ valid: true, errors: [] }),
    artifactStore,
    lifecycleRepo: wrapRepo(createMemoryLifecycleRepository()),
    reportStore,
  });
  return runtime;
}

const baseInput = () => ({
  targetUrl: "https://proof.example.com",
  businessName: "Prysm V2 Boundary Proof",
  market: "Toronto, Ontario",
  language: "en-CA",
  primaryGoal: "book a consultation",
  services: ["Governed Evidence Service"],
});

async function readPersistedRequest(artifactStore, { auditId, clientId }) {
  const key = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/canonical/audit-request.json`;
  const bytes = await artifactStore.get(key);
  return bytes ? JSON.parse(Buffer.from(bytes).toString("utf8")) : null;
}

test("PRYSM-V2-PROD-01a: production boundary persists report.designVersion 2.0.0 in the canonical AuditRequest", async () => {
  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const runtime = await buildRuntime(artifactStore);
  const created = await runtime.auditService.createAudit(
    { ...baseInput(), report: { designVersion: "2.0.0" } },
    tenantId,
  );
  await waitForState(runtime, created.auditId, [T.DRAFT_RENDERED], 30000);
  const persisted = await readPersistedRequest(artifactStore, created);
  assert.ok(persisted, "canonical AuditRequest must be persisted");
  assert.equal(
    persisted.report?.designVersion ?? null,
    "2.0.0",
    "persisted governed request must carry the requested v2 design version",
  );
});

test("PRYSM-V2-PROD-01b: strict allowlist — invalid designVersion coerces to 1.0.0", async () => {
  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const runtime = await buildRuntime(artifactStore);
  const created = await runtime.auditService.createAudit(
    { ...baseInput(), report: { designVersion: "9.9.9" } },
    tenantId,
  );
  await waitForState(runtime, created.auditId, [T.DRAFT_RENDERED], 30000);
  const persisted = await readPersistedRequest(artifactStore, created);
  assert.ok(persisted, "canonical AuditRequest must be persisted");
  assert.equal(persisted.report?.designVersion ?? null, "1.0.0", "non-2.0.0 values must coerce to the governed v1 design");
});

test("PRYSM-V2-PROD-01c: absent report selection keeps the governed v1 default (no report field)", async () => {
  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const runtime = await buildRuntime(artifactStore);
  const created = await runtime.auditService.createAudit(baseInput(), tenantId);
  await waitForState(runtime, created.auditId, [T.DRAFT_RENDERED], 30000);
  const persisted = await readPersistedRequest(artifactStore, created);
  assert.ok(persisted, "canonical AuditRequest must be persisted");
  assert.equal(persisted.report ?? null, null, "absent selection must not fabricate a report field");
});

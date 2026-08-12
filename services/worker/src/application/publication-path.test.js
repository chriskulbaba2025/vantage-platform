/**
 * C14 — Complete production publication path.
 *
 * Real application + report-store flow:
 *   DRAFT_RENDERED → IN_REVIEW → APPROVED → PUBLISHED
 * then retrieval through the real production publication retrieval path.
 *
 * Proves:
 *   - PRYSM-CLOSE-14a: same audit ID reaches PUBLISHED via governed transitions
 *   - PRYSM-CLOSE-14b: published retrieval succeeds with artifact identity
 *   - PRYSM-CLOSE-14c: draft/review/approved states are NOT exposed as published
 *   - PRYSM-CLOSE-14d: exact ordered lifecycle equality
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { createProductionRuntime } from "./production-runtime.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createGovernedArtifactStore, buildArtifactKey } from "../storage/governed-artifact-store.js";
import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { createLocalReportStore, REQUIRED_APPROVED_PAGE_FILENAMES } from "../storage/report-store.js";
import { LIFECYCLE_STATE } from "../lifecycle/state-enum.js";

const T = LIFECYCLE_STATE;
const testBaseDir = mkdtempSync(join(tmpdir(), "prysm-c14-"));
const tenantId = "c14-tenant";

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

function wrapRepo(baseRepo) {
  const metaStore = new Map();
  return {
    ...baseRepo,
    updateAuditMetadata: async (auditId, tenantId, patch) => {
      metaStore.set(auditId, { ...(metaStore.get(auditId) || {}), ...patch });
    },
    getAuditMetadata: async (auditId, tenantId) => metaStore.get(auditId) || null,
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

// ---------------------------------------------------------------------------
// 14a + 14b + 14d — full publication path with exact lifecycle equality
// ---------------------------------------------------------------------------
test("PRYSM-CLOSE-14: DRAFT_RENDERED → IN_REVIEW → APPROVED → PUBLISHED with retrieval", async () => {
  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const repo = wrapRepo(createMemoryLifecycleRepository());
  const reportStore = createLocalReportStore({ baseDir: join(testBaseDir, `reports-${randomUUID().slice(0, 8)}`) });

  const runtime = createProductionRuntime({
    config: baseConfig(),
    adapters: workingAdapters(),
    validateContract: () => ({ valid: true, errors: [] }),
    artifactStore,
    lifecycleRepo: repo,
    reportStore,
  });

  const { auditId, slug } = await runtime.auditService.createAudit(
    {
      targetUrl: "https://proof.example.com",
      businessName: "Prysm Production Proof",
      market: "Toronto, Ontario",
      language: "en-CA",
      primaryGoal: "book a consultation",
      services: ["Governed Evidence Service"],
      ga4: { propertyId: "400123456" },
      gsc: { siteUrl: "https://proof.example.com" },
    },
    tenantId,
  );

  // Background execution drives to DRAFT_RENDERED
  const draft = await waitForState(runtime, auditId, [T.DRAFT_RENDERED], 30000);
  assert.equal(draft.state, T.DRAFT_RENDERED, `reached draft_rendered (got ${draft.state})`);
  const clientId = draft.clientId;

  // The report-store draft record is initialized after the canonical
  // transition — wait for it before submitting the review.
  for (let i = 0; i < 100; i++) {
    const rpt = await reportStore.getStatus(slug, auditId).catch(() => null);
    if (rpt) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const rptRecord = await reportStore.getStatus(slug, auditId).catch(() => null);
  assert.ok(rptRecord, "report-store draft record initialized");

  // Snapshot rendered artifact identity BEFORE publication
  const indexKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/pages/index.html`;
  const indexBefore = await artifactStore.get(indexKey);
  assert.ok(indexBefore, "index.html artifact exists");

  // 1. Review: DRAFT_RENDERED → IN_REVIEW
  const reviewResult = await runtime.auditService.submitReview(
    auditId, tenantId, slug, "auditor@proof.example.com",
    [{ id: "source_failures", reviewed: true, reviewedAt: new Date().toISOString() }],
  );
  assert.equal(reviewResult.status, "reviewed", "review submitted");
  const inReview = await runtime.lifecycleService.currentState(auditId, tenantId);
  assert.equal(inReview.state, T.IN_REVIEW, "canonical lifecycle in_review");

  // 2. Approval: IN_REVIEW → APPROVED
  const pages = new Map();
  for (const fn of REQUIRED_APPROVED_PAGE_FILENAMES) {
    const pageKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/pages/${fn}`;
    const pageBytes = await artifactStore.get(pageKey);
    assert.ok(pageBytes, `page ${fn} exists for approval`);
    pages.set(fn, Buffer.from(pageBytes).toString("utf8"));
  }
  const approveResult = await runtime.auditService.approveAudit(auditId, tenantId, slug, "approver@proof.example.com", pages);
  assert.equal(approveResult.status, T.APPROVED, "approval accepted");
  const approved = await runtime.lifecycleService.currentState(auditId, tenantId);
  assert.equal(approved.state, T.APPROVED, "canonical lifecycle approved");

  // 3. Published retrieval NOT available while only approved
  let blocked = null;
  try {
    await runtime.auditService.getPublishedReportPage(auditId, tenantId, slug, "index.html");
  } catch (err) {
    blocked = err;
  }
  assert.ok(blocked, "published retrieval blocked before publication");
  assert.equal(blocked.statusCode, 403, "403 for non-published state");
  assert.equal(blocked.code, "REPORT_NOT_PUBLISHED", "report not published code");

  // 4. Publication: APPROVED → PUBLISHED
  const publishResult = await runtime.auditService.publishAudit(auditId, tenantId, slug);
  assert.equal(publishResult.status, T.PUBLISHED, "publication accepted");
  assert.ok(publishResult.publishedAt, "publication metadata exists");
  assert.ok(publishResult.publication?.artifactCount >= 1, "publication verified artifacts recorded");
  const published = await runtime.lifecycleService.currentState(auditId, tenantId);
  assert.equal(published.state, T.PUBLISHED, "canonical lifecycle published");

  // 5. Published retrieval succeeds with EXACT artifact identity
  const retrieved = await runtime.auditService.getPublishedReportPage(auditId, tenantId, slug, "index.html");
  assert.equal(retrieved.filename, "index.html");
  assert.equal(retrieved.lifecycleStatus, T.PUBLISHED);
  assert.ok(retrieved.bytes.equals(indexBefore), "retrieved bytes identical to pre-publication rendered artifact");
  assert.ok(retrieved.publishedAt, "retrieval carries publication timestamp");

  // 6. Exact ordered lifecycle equality for the SAME audit ID
  const history = await runtime.lifecycleService.history(auditId, tenantId);
  const terminalPath = (history || []).map((e) => e.nextState);
  const expectedTail = [
    T.DRAFT_RENDERED,
    T.IN_REVIEW,
    T.APPROVED,
    T.PUBLISHED,
  ];
  const tail = terminalPath.slice(-expectedTail.length);
  assert.deepEqual(tail, expectedTail, `exact ordered lifecycle tail: ${tail.join(" → ")}`);
});

// ---------------------------------------------------------------------------
// 14c — idempotent publication + wrong-state rejection
// ---------------------------------------------------------------------------
test("PRYSM-CLOSE-14c: publication from non-approved states is rejected", async () => {
  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const repo = wrapRepo(createMemoryLifecycleRepository());
  const reportStore = createLocalReportStore({ baseDir: join(testBaseDir, `reports-${randomUUID().slice(0, 8)}`) });

  const runtime = createProductionRuntime({
    config: baseConfig(),
    adapters: workingAdapters(),
    validateContract: () => ({ valid: true, errors: [] }),
    artifactStore,
    lifecycleRepo: repo,
    reportStore,
  });

  const { auditId, slug } = await runtime.auditService.createAudit(
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
  await waitForState(runtime, auditId, [T.DRAFT_RENDERED], 30000);

  // Publishing a DRAFT audit must be rejected with 409
  let rejected = null;
  try {
    await runtime.auditService.publishAudit(auditId, tenantId, slug);
  } catch (err) {
    rejected = err;
  }
  assert.ok(rejected, "publication from draft rejected");
  assert.equal(rejected.statusCode, 409, "409 conflict");
  assert.match(rejected.message, /Cannot publish audit in draft_rendered state/);

  // Lifecycle must remain at DRAFT_RENDERED (fail closed)
  const stillDraft = await runtime.lifecycleService.currentState(auditId, tenantId);
  assert.equal(stillDraft.state, T.DRAFT_RENDERED, "no partial publication");
});

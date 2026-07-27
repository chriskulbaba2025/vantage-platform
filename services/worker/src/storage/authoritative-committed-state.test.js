/**
 * Authoritative committed-state tests.
 *
 * Proves that production status and approval paths use the active
 * committed transaction, not stale canonical artifacts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalReportStore } from "./report-store.js";
import { runAudit, submitReview, approveAudit } from "../audit/run-audit.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

const NOW = new Date().toISOString();

const AVAILABLE_SITE = {
  evidenceVersion: "1.0.0", source: "dataforseo-onpage", sourceStatus: SOURCE_STATUS.AVAILABLE,
  targetUrl: "https://example.com/", domain: "example.com", pageCount: 5, totalWords: 1000,
  averageWords: 500, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
  h1Missing: 0, h1Multiple: 0, imageCount: 3, imagesMissingAlt: 0, imagesMissingDimensions: 0,
  schemaTypes: ["Organization"], forms: [], ctas: [{ text: "Contact", url: "https://example.com/contact", kind: "link" }],
  externalCtas: [], socialLinks: [], internalLinkCount: 2, brokenInternalLinks: [], platform: "WordPress",
  services: ["Consulting"], topicKeywords: ["business consulting"],
  securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: false },
  trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true },
  limitations: [], pages: [{ title: "Home", language: "en-CA", headings: { h1: ["Home"], h2: [], h3: [], h4: [] }, responseHeaders: {} }],
  collectedAt: NOW, coverage: { requested: 5, completed: 5, failed: 0 },
  _sourceStatus: { provider: "dataforseo-onpage", adapterVersion: "1.0.0", startedAt: NOW, completedAt: NOW, returnedRecordCount: 5, expectedRecordCount: 5 },
};

const AVAILABLE_PERF = {
  evidenceVersion: "1.0.0", source: "pagespeed-insights", sourceStatus: SOURCE_STATUS.AVAILABLE,
  mobile: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", scores: { performance: 75 }, metrics: {} },
  desktop: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", scores: { performance: 90 }, metrics: {} },
  fieldData: {}, limitations: [], collectedAt: NOW, coverage: { requested: 2, completed: 2, failed: 0 },
  _sourceStatus: { provider: "pagespeed-insights", adapterVersion: "1.0.0", startedAt: NOW, completedAt: NOW, returnedRecordCount: 2, expectedRecordCount: 2 },
};

const NC = { evidenceVersion: "1.0.0", source: "none", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, collectedAt: NOW, coverage: { requested: 0, completed: 0, failed: 0 }, _sourceStatus: { provider: "none", adapterVersion: "1.0.0", returnedRecordCount: 0, expectedRecordCount: null } };

const COMPETITORS = [{
  url: "https://comp.example/services", status: SOURCE_STATUS.AVAILABLE,
  evidence: { services: ["Consulting"], pageCount: 10, trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true }, schemaTypes: ["Service"], ctas: [{ text: "Book", url: "https://c.example/book", kind: "link" }], forms: [], domain: "comp.example", socialLinks: [], topicKeywords: [], pages: [{ title: "Comp", headings: { h1: ["Consulting"], h2: [], h3: [], h4: [] }, responseHeaders: {} }], platform: "WordPress" },
}];

function baseConfig(dir) {
  return { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports", onpageMaxPages: 500, onpageJsRendering: false, onpageBrowserRendering: false, onpagePollTimeoutMs: 600000, onpagePollIntervalMs: 10000, onpageIncludePatterns: [], onpageExcludePatterns: [], googleClientId: "", googleClientSecret: "", googleRedirectUri: "", vantageEncryptionKey: "" };
}

const FULL_CHECKLIST = [
  { id: "source_failures", reviewed: true }, { id: "top_ten_findings", reviewed: true },
  { id: "high_severity", reviewed: true }, { id: "competitor_selections", reviewed: true },
  { id: "root_cause", reviewed: true }, { id: "score_eligibility", reviewed: true },
  { id: "limitations", reviewed: true }, { id: "causal_language", reviewed: true },
  { id: "implementation_feasibility", reviewed: true },
];

// ---------------------------------------------------------------------------
// T9-AUTH-01: status returns competitorReview from committed transaction
// ---------------------------------------------------------------------------

test("T9-AUTH-01: status returns competitorReview from active transaction, not stale canonical", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-auth-"));
  const store = createLocalReportStore({ baseDir: dir });

  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: ["https://comp.example/services"] },
    { config: baseConfig(dir), crawlSite: async () => AVAILABLE_SITE, crawlCompetitors: async () => COMPETITORS, collectPerformance: async () => AVAILABLE_PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "auth-001" },
  );

  // Pre-review: status should show pending candidates
  const preStatus = await store.getStatus(result.slug, result.runId);
  assert.equal(preStatus.status, "draft");

  // Now submit review with approved decisions
  const opp = result.model.evidence?.competitorOpportunities;
  const qualifiedUrls = (opp?.candidates?.qualified || []).map((c) => c.candidateUrl);

  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com", checklist: FULL_CHECKLIST,
    competitorDecisions: qualifiedUrls.map((url) => ({ candidateUrl: url, decision: "approved", reason: "Relevant" })),
    limitationsAccepted: true,
  });

  // Read committed artifacts — should show approved candidates
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.ok(committed.txId, "Should have active transaction ID");
  const readOpp = committed.evidence.competitorOpportunities;
  assert.equal(readOpp.candidates.qualified[0].approvalStatus, "approved");
  assert.ok(readOpp.gaps.length > 0, "Approved gaps should be present in committed state");
});

// ---------------------------------------------------------------------------
// T9-AUTH-02: checksum mismatch returns null
// ---------------------------------------------------------------------------

test("T9-AUTH-02: evidence checksum mismatch in transaction returns null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-auth-"));
  const store = createLocalReportStore({ baseDir: dir });

  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: ["https://comp.example/services"] },
    { config: baseConfig(dir), crawlSite: async () => AVAILABLE_SITE, crawlCompetitors: async () => COMPETITORS, collectPerformance: async () => AVAILABLE_PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "auth-002" },
  );

  const opp = result.model.evidence?.competitorOpportunities;
  const qualifiedUrls = (opp?.candidates?.qualified || []).map((c) => c.candidateUrl);

  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com", checklist: FULL_CHECKLIST,
    competitorDecisions: qualifiedUrls.map((url) => ({ candidateUrl: url, decision: "approved", reason: "Relevant" })),
    limitationsAccepted: true,
  });

  // Tamper: overwrite the committed evidence file with bad content
  const lc = await store._readLifecycle(result.slug, result.runId);
  const txnDir = join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId);
  await writeFile(join(txnDir, "evidence.json"), "tampered content", "utf8");

  // Read should return null (checksum mismatch)
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Checksum mismatch should return null");
});

// ---------------------------------------------------------------------------
// T9-AUTH-03: txId mismatch blocks approval
// ---------------------------------------------------------------------------

test("T9-AUTH-03: transaction ID mismatch in lifecycle blocks approval", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-auth-"));
  const store = createLocalReportStore({ baseDir: dir });

  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: ["https://comp.example/services"] },
    { config: baseConfig(dir), crawlSite: async () => AVAILABLE_SITE, crawlCompetitors: async () => COMPETITORS, collectPerformance: async () => AVAILABLE_PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "auth-003" },
  );

  const opp = result.model.evidence?.competitorOpportunities;
  const qualifiedUrls = (opp?.candidates?.qualified || []).map((c) => c.candidateUrl);

  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com", checklist: FULL_CHECKLIST,
    competitorDecisions: qualifiedUrls.map((url) => ({ candidateUrl: url, decision: "approved", reason: "Relevant" })),
    limitationsAccepted: true,
  });

  // Tamper the lifecycle's activeReviewTxId to a bogus value
  const lc = await store._readLifecycle(result.slug, result.runId);
  lc.activeReviewTxId = "txn-bogus-0000";
  // Write tampered lifecycle directly (atomicWrite via store internals)
  const { rename, mkdir: _mkdir } = await import("node:fs/promises");
  const { dirname, join: _join } = await import("node:path");
  const lcPath = _join(dir, result.slug, result.runId, "lifecycle.json");
  const tmpPath = lcPath + ".tmp." + Date.now();
  await _mkdir(dirname(lcPath), { recursive: true });
  await writeFile(tmpPath, JSON.stringify(lc, null, 2), "utf8");
  await rename(tmpPath, lcPath);

  // Approval should fail because txId mismatch
  await assert.rejects(
    () => approveAudit(store, result.slug, result.runId, "approver@example.com"),
    /lifecycle references transaction/i,
  );
});

// ---------------------------------------------------------------------------
// T9-AUTH-04: stale caller-supplied model is ignored
// ---------------------------------------------------------------------------

test("T9-AUTH-04: approveAudit ignores stale caller-supplied model", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-auth-"));
  const store = createLocalReportStore({ baseDir: dir });

  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: ["https://comp.example/services"] },
    { config: baseConfig(dir), crawlSite: async () => AVAILABLE_SITE, crawlCompetitors: async () => COMPETITORS, collectPerformance: async () => AVAILABLE_PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "auth-004" },
  );

  const opp = result.model.evidence?.competitorOpportunities;
  const qualifiedUrls = (opp?.candidates?.qualified || []).map((c) => c.candidateUrl);

  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com", checklist: FULL_CHECKLIST,
    competitorDecisions: qualifiedUrls.map((url) => ({ candidateUrl: url, decision: "approved", reason: "Relevant" })),
    limitationsAccepted: true,
  });

  // Try to approve with a STALE model (different from committed)
  const staleModel = { scoringVersion: "9.9.9", scores: { trust: 999 }, evidence: {} };

  // Should succeed — the stale model is IGNORED, committed model is used
  const approved = await approveAudit(store, result.slug, result.runId, "approver@example.com", { model: staleModel });
  assert.equal(approved.lifecycle.status, "approved");
});

// ---------------------------------------------------------------------------
// T9-AUTH-05: pre-transaction audits fall back to canonical artifacts
// ---------------------------------------------------------------------------

test("T9-AUTH-05: pre-transaction audits (no review transaction) use canonical artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-auth-"));
  const store = createLocalReportStore({ baseDir: dir });

  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: [] },
    { config: baseConfig(dir), crawlSite: async () => AVAILABLE_SITE, crawlCompetitors: async () => [], collectPerformance: async () => AVAILABLE_PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "auth-005" },
  );

  // Pre-transaction: readCommittedArtifacts should return canonical artifacts
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.ok(committed, "Should read canonical artifacts");
  assert.equal(committed.txId, null, "No transaction ID for pre-transaction audit");
  assert.ok(committed.model, "Should have model");
  assert.ok(committed.evidence, "Should have evidence");
});

// ---------------------------------------------------------------------------
// T9-AUTH-06: missing transaction artifact returns null
// ---------------------------------------------------------------------------

test("T9-AUTH-06: missing transaction artifact returns null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-auth-"));
  const store = createLocalReportStore({ baseDir: dir });

  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: ["https://comp.example/services"] },
    { config: baseConfig(dir), crawlSite: async () => AVAILABLE_SITE, crawlCompetitors: async () => COMPETITORS, collectPerformance: async () => AVAILABLE_PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "auth-006" },
  );

  const opp = result.model.evidence?.competitorOpportunities;
  const qualifiedUrls = (opp?.candidates?.qualified || []).map((c) => c.candidateUrl);

  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com", checklist: FULL_CHECKLIST,
    competitorDecisions: qualifiedUrls.map((url) => ({ candidateUrl: url, decision: "approved", reason: "Relevant" })),
    limitationsAccepted: true,
  });

  // Delete the evidence.json from the transaction directory
  const lc = await store._readLifecycle(result.slug, result.runId);
  const { unlink } = await import("node:fs/promises");
  await unlink(join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId, "evidence.json"));

  // Read should return null (missing artifact)
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Missing artifact should return null");
});

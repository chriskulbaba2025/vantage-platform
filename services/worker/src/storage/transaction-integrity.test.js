/**
 * Transaction integrity tests.
 *
 * Proves that active transactions require all four artifacts and that
 * approval rejects lifecycle/review disagreement and evidence/model mismatch.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalReportStore } from "./report-store.js";
import { runAudit, submitReview, approveAudit } from "../audit/run-audit.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

const NOW = new Date().toISOString();

const SITE = { evidenceVersion: "1.0.0", source: "dfs", sourceStatus: SOURCE_STATUS.AVAILABLE, targetUrl: "https://x.com/", domain: "x.com", pageCount: 5, totalWords: 1000, averageWords: 500, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0, h1Missing: 0, h1Multiple: 0, imageCount: 3, imagesMissingAlt: 0, imagesMissingDimensions: 0, schemaTypes: ["Organization"], forms: [], ctas: [{ text: "C", url: "https://x.com/c", kind: "link" }], externalCtas: [], socialLinks: [], internalLinkCount: 2, brokenInternalLinks: [], platform: "WP", services: ["Consulting"], topicKeywords: ["consulting"], securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: false }, trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true }, limitations: [], pages: [{ title: "H", language: "en", headings: { h1: ["H"], h2: [], h3: [], h4: [] }, responseHeaders: {} }], collectedAt: NOW, coverage: { requested: 5, completed: 5, failed: 0 }, _sourceStatus: { provider: "dfs", adapterVersion: "1.0.0", startedAt: NOW, completedAt: NOW, returnedRecordCount: 5, expectedRecordCount: 5 } };
const PERF = { evidenceVersion: "1.0.0", source: "psi", sourceStatus: SOURCE_STATUS.AVAILABLE, mobile: { status: SOURCE_STATUS.AVAILABLE, source: "psi", scores: { performance: 75 }, metrics: {} }, desktop: { status: SOURCE_STATUS.AVAILABLE, source: "psi", scores: { performance: 90 }, metrics: {} }, fieldData: {}, limitations: [], collectedAt: NOW, coverage: { requested: 2, completed: 2, failed: 0 }, _sourceStatus: { provider: "psi", adapterVersion: "1.0.0", startedAt: NOW, completedAt: NOW, returnedRecordCount: 2, expectedRecordCount: 2 } };
const NC = { evidenceVersion: "1.0.0", source: "none", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, collectedAt: NOW, coverage: { requested: 0, completed: 0, failed: 0 }, _sourceStatus: { provider: "none", adapterVersion: "1.0.0", returnedRecordCount: 0, expectedRecordCount: null } };
const COMPS = [{ url: "https://c.example/s", status: SOURCE_STATUS.AVAILABLE, evidence: { services: ["Consulting"], pageCount: 10, trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true }, schemaTypes: ["Service"], ctas: [{ text: "B", url: "https://c.example/b", kind: "link" }], forms: [], domain: "c.example", socialLinks: [], topicKeywords: [], pages: [{ title: "C", headings: { h1: ["Consulting"], h2: [], h3: [], h4: [] }, responseHeaders: {} }], platform: "WP" } }];
const CHECKLIST = [{ id: "source_failures", reviewed: true }, { id: "top_ten_findings", reviewed: true }, { id: "high_severity", reviewed: true }, { id: "competitor_selections", reviewed: true }, { id: "root_cause", reviewed: true }, { id: "score_eligibility", reviewed: true }, { id: "limitations", reviewed: true }, { id: "causal_language", reviewed: true }, { id: "implementation_feasibility", reviewed: true }];

function cfg(dir) { return { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports", onpageMaxPages: 500, onpageJsRendering: false, onpageBrowserRendering: false, onpagePollTimeoutMs: 600000, onpagePollIntervalMs: 10000, onpageIncludePatterns: [], onpageExcludePatterns: [], googleClientId: "", googleClientSecret: "", googleRedirectUri: "", vantageEncryptionKey: "" }; }

async function createReviewedAudit(dir, store, runId) {
  const result = await runAudit(
    { targetUrl: "https://x.com", businessName: "X", competitors: ["https://c.example/s"] },
    { config: cfg(dir), crawlSite: async () => SITE, crawlCompetitors: async () => COMPS, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId },
  );
  const opp = result.model.evidence?.competitorOpportunities;
  const urls = (opp?.candidates?.qualified || []).map((c) => c.candidateUrl);
  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com", checklist: CHECKLIST,
    competitorDecisions: urls.map((u) => ({ candidateUrl: u, decision: "approved", reason: "OK" })),
    limitationsAccepted: true,
  });
  return result;
}

// ---------------------------------------------------------------------------
// T9-INT-01: deleting review-record.json makes readCommittedArtifacts return null
// ---------------------------------------------------------------------------

test("T9-INT-01: missing local review-record.json → null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-001");
  const lc = await store._readLifecycle(result.slug, result.runId);

  await unlink(join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId, "review-record.json"));
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Missing review record should return null");
});

// ---------------------------------------------------------------------------
// T9-INT-02: missing review checksum in tx-meta → null
// ---------------------------------------------------------------------------

test("T9-INT-02: missing review checksum in tx-meta → null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-002");
  const lc = await store._readLifecycle(result.slug, result.runId);
  const metaPath = join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId, "tx-meta.json");

  const meta = JSON.parse(await (await import("node:fs/promises")).readFile(metaPath, "utf8"));
  delete meta.checksums.review;
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");

  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Missing review checksum should return null");
});

// ---------------------------------------------------------------------------
// T9-INT-03: tampered review content → null
// ---------------------------------------------------------------------------

test("T9-INT-03: tampered review content → null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-003");
  const lc = await store._readLifecycle(result.slug, result.runId);

  await writeFile(join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId, "review-record.json"), "tampered", "utf8");
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Tampered review should fail checksum → null");
});

// ---------------------------------------------------------------------------
// T9-INT-04: invalid review JSON → null
// ---------------------------------------------------------------------------

test("T9-INT-04: invalid review JSON → null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-004");
  const lc = await store._readLifecycle(result.slug, result.runId);
  const { createHash } = await import("node:crypto");

  const badJson = "{not valid json";
  const newHash = createHash("sha256").update(badJson).digest("hex");

  // Update review record and its checksum
  const metaPath = join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId, "tx-meta.json");
  const meta = JSON.parse(await (await import("node:fs/promises")).readFile(metaPath, "utf8"));
  meta.checksums.review = newHash;
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
  await writeFile(join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId, "review-record.json"), badJson, "utf8");

  // Checksum matches but JSON parse fails
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Invalid review JSON should return null");
});

// ---------------------------------------------------------------------------
// T9-INT-05: lifecycle reviewer mismatch → null
// ---------------------------------------------------------------------------

test("T9-INT-05: lifecycle reviewer mismatch → null in readCommittedArtifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-005");

  // Tamper lifecycle reviewer
  const lc = await store._readLifecycle(result.slug, result.runId);
  lc.review.reviewer = "someone-else@example.com";
  const lcPath = join(dir, result.slug, result.runId, "lifecycle.json");
  const tmp = lcPath + ".tmp." + Date.now();
  await writeFile(tmp, JSON.stringify(lc, null, 2), "utf8");
  await (await import("node:fs/promises")).rename(tmp, lcPath);

  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Reviewer mismatch should return null");
});

// ---------------------------------------------------------------------------
// T9-INT-06: lifecycle checklist mismatch → null
// ---------------------------------------------------------------------------

test("T9-INT-06: lifecycle checklist mismatch → null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-006");

  const lc = await store._readLifecycle(result.slug, result.runId);
  lc.review.checklist[0].reviewed = !lc.review.checklist[0].reviewed;
  const lcPath = join(dir, result.slug, result.runId, "lifecycle.json");
  const tmp = lcPath + ".tmp." + Date.now();
  await writeFile(tmp, JSON.stringify(lc, null, 2), "utf8");
  await (await import("node:fs/promises")).rename(tmp, lcPath);

  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Checklist mismatch should return null");
});

// ---------------------------------------------------------------------------
// T9-INT-07: lifecycle override-history mismatch (review override removed) → null
// ---------------------------------------------------------------------------

test("T9-INT-07: lifecycle override-history mismatch → null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-007");

  const lc = await store._readLifecycle(result.slug, result.runId);
  // Remove the first override (which was created by the competitor review)
  if (lc.overrides.length > 0) lc.overrides.shift();
  const lcPath = join(dir, result.slug, result.runId, "lifecycle.json");
  const tmp = lcPath + ".tmp." + Date.now();
  await writeFile(tmp, JSON.stringify(lc, null, 2), "utf8");
  await (await import("node:fs/promises")).rename(tmp, lcPath);

  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Override removed from lifecycle should cause mismatch");
});

// ---------------------------------------------------------------------------
// T9-INT-08: evidence/model competitor approval mismatch blocks approval
// ---------------------------------------------------------------------------

test("T9-INT-08: evidence/model competitor approval mismatch blocks approval", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-008");

  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  // Tamper model's competitor approval to disagree with evidence
  const tamperedModel = JSON.parse(JSON.stringify(committed.model));
  const mdQualified = tamperedModel.evidence?.competitorOpportunities?.candidates?.qualified || [];
  if (mdQualified.length > 0) {
    mdQualified[0].approvalStatus = "rejected"; // was "approved" in evidence
  }

  // Write tampered model back to transaction
  const lc = await store._readLifecycle(result.slug, result.runId);
  const { createHash } = await import("node:crypto");
  const modelBody = JSON.stringify(tamperedModel, null, 2);
  const newHash = createHash("sha256").update(modelBody).digest("hex");
  const metaPath = join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId, "tx-meta.json");
  const meta = JSON.parse(await (await import("node:fs/promises")).readFile(metaPath, "utf8"));
  meta.checksums.model = newHash;
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
  await writeFile(join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId, "audit.json"), modelBody, "utf8");

  await assert.rejects(
    () => approveAudit(store, result.slug, result.runId, "approver@example.com"),
    /competitor approval states disagree/i,
  );
});

// ---------------------------------------------------------------------------
// T9-INT-09: successful complete transaction still approves
// ---------------------------------------------------------------------------

test("T9-INT-09: complete valid transaction approves successfully", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-009");

  const approved = await approveAudit(store, result.slug, result.runId, "approver@example.com");
  assert.equal(approved.lifecycle.status, "approved");
});

// ---------------------------------------------------------------------------
// T9-INT-10: pre-transaction audit still works
// ---------------------------------------------------------------------------

test("T9-INT-10: pre-transaction audit uses canonical fallback successfully", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await runAudit(
    { targetUrl: "https://x.com", businessName: "X" },
    { config: cfg(dir), crawlSite: async () => SITE, crawlCompetitors: async () => [], collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "int-010" },
  );
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.ok(committed, "Pre-transaction audit should read canonical artifacts");
  assert.equal(committed.txId, null);
  assert.equal(committed.reviewRecord, null);
  assert.ok(committed.model);
  assert.ok(committed.evidence);
});

// ---------------------------------------------------------------------------
// T9-INT-11: missing evidence artifact → null
// ---------------------------------------------------------------------------

test("T9-INT-11: missing evidence artifact → null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-011");
  const lc = await store._readLifecycle(result.slug, result.runId);
  await unlink(join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId, "evidence.json"));
  assert.equal(await store.readCommittedArtifacts(result.slug, result.runId), null);
});

// ---------------------------------------------------------------------------
// T9-INT-12: missing model artifact → null
// ---------------------------------------------------------------------------

test("T9-INT-12: missing model artifact → null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-012");
  const lc = await store._readLifecycle(result.slug, result.runId);
  await unlink(join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId, "audit.json"));
  assert.equal(await store.readCommittedArtifacts(result.slug, result.runId), null);
});

// ---------------------------------------------------------------------------
// T9-INT-13: missing tx-meta artifact → null
// ---------------------------------------------------------------------------

test("T9-INT-13: missing tx-meta artifact → null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-int-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await createReviewedAudit(dir, store, "int-013");
  const lc = await store._readLifecycle(result.slug, result.runId);
  await unlink(join(dir, result.slug, result.runId, ".txn", lc.activeReviewTxId, "tx-meta.json"));
  assert.equal(await store.readCommittedArtifacts(result.slug, result.runId), null);
});

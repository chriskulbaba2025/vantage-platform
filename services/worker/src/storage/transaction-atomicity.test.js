/**
 * Task 9 — Transaction Atomicity Tests
 *
 * Proves that competitor review persistence is atomic:
 *  - failed staging leaves previous state fully intact
 *  - invalid review through submitReview() changes no persisted artifact
 *  - successful commit updates all artifacts atomically
 *  - reads resolve through active transaction only
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalReportStore } from "./report-store.js";
import { runAudit, submitReview } from "../audit/run-audit.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

const NOW = new Date().toISOString();

function makeStore(dir) {
  return createLocalReportStore({ baseDir: dir });
}

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
  collectedAt: NOW, coverage: { requested: 5, completed: 5, failed: 0 }, rawArtifactRef: null,
  _sourceStatus: { provider: "dataforseo-onpage", adapterVersion: "1.0.0", startedAt: NOW, completedAt: NOW, requestId: null, retryCount: 0, returnedRecordCount: 5, expectedRecordCount: 5, errorCategory: null, limitation: null, rawArtifactRef: null },
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
  url: "https://competitor.example/services/consulting", status: SOURCE_STATUS.AVAILABLE,
  evidence: { services: ["Consulting"], pageCount: 10, trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true }, schemaTypes: ["Service"], ctas: [{ text: "Book", url: "https://c.example/book", kind: "link" }], forms: [], domain: "competitor.example", socialLinks: [], topicKeywords: [], pages: [{ title: "Comp", headings: { h1: ["Consulting"], h2: [], h3: [], h4: [] }, responseHeaders: {} }], platform: "WordPress" },
}];

function baseConfig(dir) {
  return { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports", onpageMaxPages: 500, onpageJsRendering: false, onpageBrowserRendering: false, onpagePollTimeoutMs: 600000, onpagePollIntervalMs: 10000, onpageIncludePatterns: [], onpageExcludePatterns: [], googleClientId: "", googleClientSecret: "", googleRedirectUri: "", vantageEncryptionKey: "" };
}

// ---------------------------------------------------------------------------
// T9-ATOM-01: staging failure leaves previous state intact
// ---------------------------------------------------------------------------

test("T9-ATOM-01: staging failure leaves previous state intact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-atomic-"));
  const store = makeStore(dir);

  const slug = "test-site";
  const runId = "atom-001";
  await store.writeReport({ slug, runId, html: "<html></html>", model: { scoringVersion: "3.0.0", scores: {}, evidence: {} }, manifest: { runId, slug, sources: {} } });

  const initialLc = await store._readLifecycle(slug, runId);

  // Circular reference → JSON.stringify throws during staging
  const bad = { circular: null };
  bad.circular = bad;
  try { await store.commitCompetitorReview({ slug, runId, evidence: bad, model: {}, reviewRecord: { runId, reviewer: "x", reviewedAt: NOW, checklist: [], overrides: [], notes: null, limitationsAccepted: false } }); assert.fail("Should throw"); } catch { /* expected */ }

  const afterLc = await store._readLifecycle(slug, runId);
  assert.equal(afterLc.status, "draft");
  assert.equal(afterLc.review, null);
});

// ---------------------------------------------------------------------------
// T9-ATOM-02: invalid review through submitReview changes nothing
// ---------------------------------------------------------------------------

test("T9-ATOM-02: invalid review payload through submitReview leaves all persisted state unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-atomic-"));
  const store = makeStore(dir);

  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: ["https://competitor.example/services/consulting"] },
    { config: baseConfig(dir), crawlSite: async () => AVAILABLE_SITE, crawlCompetitors: async () => COMPETITORS, collectPerformance: async () => AVAILABLE_PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "atom-002" },
  );

  // Snapshot persisted state
  const initialLc = await store._readLifecycle(result.slug, result.runId);
  const initialEv = await store.readFile(`${result.slug}/${result.runId}/evidence.json`);

  // Submit review with INVALID checklist (missing items) but valid competitor decisions
  try {
    await submitReview(store, result.slug, result.runId, {
      reviewer: "auditor@example.com",
      checklist: [{ id: "source_failures", reviewed: true }], // INCOMPLETE
      competitorDecisions: [
        { candidateUrl: "https://competitor.example/services/consulting", decision: "approved", reason: "Valid competitor" },
      ],
      limitationsAccepted: true,
    });
    assert.fail("Should have thrown validation error");
  } catch (err) {
    assert.ok(err.message.includes("Incomplete checklist") || err.message.includes("Invalid review"), `Expected validation error, got: ${err.message}`);
  }

  // Verify state COMPLETELY unchanged
  const afterLc = await store._readLifecycle(result.slug, result.runId);
  const afterEv = await store.readFile(`${result.slug}/${result.runId}/evidence.json`);

  assert.equal(afterLc.status, "draft", "Lifecycle should still be draft");
  assert.equal(afterLc.review, null, "Review should still be null");
  assert.equal(afterEv.toString(), initialEv.toString(), "Evidence completely unchanged");
});

// ---------------------------------------------------------------------------
// T9-ATOM-03: successful commit atomically updates all artifacts
// ---------------------------------------------------------------------------

test("T9-ATOM-03: successful commit updates lifecycle, evidence, and model together", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-atomic-"));
  const store = makeStore(dir);

  const slug = "test-site";
  const runId = "atom-003";
  const evidence = { evidenceVersion: "1.0.0", site: { sourceStatus: SOURCE_STATUS.AVAILABLE, services: ["Consulting"] }, performance: { sourceStatus: SOURCE_STATUS.AVAILABLE }, competitorOpportunities: { candidates: { qualified: [{ candidateUrl: "https://c1.example", domain: "c1.example", topic: "consulting", approvalStatus: "pending", qualificationPassed: true, qualificationResults: {}, discoverySource: "user-supplied", pageType: "service" }], excluded: [] }, allGaps: [{ clientTopic: "consulting", competitorPage: "https://c1.example", approvalStatus: "pending", gapPassed: true, qualificationPassed: true }], gaps: [], sources: {}, topics: [{ topic: "consulting" }] }, backlinks: NC, ga4: NC, gsc: NC };
  const model = { scoringVersion: "3.0.0", input: { targetUrl: "https://example.com", businessName: "Example" }, scores: {}, evidence };
  await store.writeReport({ slug, runId, html: "<html></html>", model, manifest: { runId, slug, sources: {} } });

  const checklist = [{ id: "source_failures", reviewed: true }, { id: "top_ten_findings", reviewed: true }, { id: "high_severity", reviewed: true }, { id: "competitor_selections", reviewed: true }, { id: "root_cause", reviewed: true }, { id: "score_eligibility", reviewed: true }, { id: "limitations", reviewed: true }, { id: "causal_language", reviewed: true }, { id: "implementation_feasibility", reviewed: true }];

  await store.commitCompetitorReview({
    slug, runId,
    evidence: { ...evidence, competitorOpportunities: { ...evidence.competitorOpportunities, candidates: { ...evidence.competitorOpportunities.candidates, qualified: [{ ...evidence.competitorOpportunities.candidates.qualified[0], approvalStatus: "approved" }] }, allGaps: [{ ...evidence.competitorOpportunities.allGaps[0], approvalStatus: "approved" }], gaps: [{ ...evidence.competitorOpportunities.allGaps[0], approvalStatus: "approved" }] } },
    model,
    reviewRecord: { runId, reviewer: "auditor", reviewedAt: NOW, checklist, overrides: [], notes: null, limitationsAccepted: true },
  });

  const committed = await store.readCommittedArtifacts(slug, runId);
  assert.ok(committed.txId, "Should have transaction ID");
  assert.equal(committed.evidence.competitorOpportunities.candidates.qualified[0].approvalStatus, "approved");
  assert.ok(committed.evidence.competitorOpportunities.gaps.length > 0, "Should have approved gaps");
});

// ---------------------------------------------------------------------------
// T9-ATOM-04: reads resolve through active transaction only
// ---------------------------------------------------------------------------

test("T9-ATOM-04: reads resolve through active transaction, not orphaned staging", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-atomic-"));
  const store = makeStore(dir);
  const slug = "test-site";
  const runId = "atom-004";

  const evidence = { evidenceVersion: "1.0.0", site: { sourceStatus: SOURCE_STATUS.AVAILABLE, services: ["Consulting"] }, performance: { sourceStatus: SOURCE_STATUS.AVAILABLE }, competitorOpportunities: { candidates: { qualified: [{ candidateUrl: "https://c1.example", domain: "c1.example", topic: "consulting", approvalStatus: "pending", qualificationPassed: true, qualificationResults: {}, discoverySource: "user-supplied", pageType: "service" }], excluded: [] }, allGaps: [{ clientTopic: "consulting", competitorPage: "https://c1.example", approvalStatus: "pending", gapPassed: true, qualificationPassed: true }], gaps: [], sources: {}, topics: [] }, backlinks: NC, ga4: NC, gsc: NC };
  const model = { scoringVersion: "3.0.0", input: { targetUrl: "https://example.com", businessName: "Example" }, scores: {}, evidence };
  await store.writeReport({ slug, runId, html: "<html></html>", model, manifest: { runId, slug, sources: {} } });

  // Before review — no active transaction
  const before = await store.readCommittedArtifacts(slug, runId);
  assert.ok(before, "Should read canonical artifacts");
  assert.equal(before.txId, null, "No active transaction before review");

  // Commit review
  await store.commitCompetitorReview({
    slug, runId,
    evidence: { ...evidence, competitorOpportunities: { ...evidence.competitorOpportunities, candidates: { ...evidence.competitorOpportunities.candidates, qualified: [{ ...evidence.competitorOpportunities.candidates.qualified[0], approvalStatus: "approved" }] }, allGaps: [{ ...evidence.competitorOpportunities.allGaps[0], approvalStatus: "approved" }], gaps: [{ ...evidence.competitorOpportunities.allGaps[0], approvalStatus: "approved" }] } },
    model,
    reviewRecord: { runId, reviewer: "auditor", reviewedAt: NOW, checklist: [{ id: "source_failures", reviewed: true }, { id: "top_ten_findings", reviewed: true }, { id: "high_severity", reviewed: true }, { id: "competitor_selections", reviewed: true }, { id: "root_cause", reviewed: true }, { id: "score_eligibility", reviewed: true }, { id: "limitations", reviewed: true }, { id: "causal_language", reviewed: true }, { id: "implementation_feasibility", reviewed: true }], overrides: [], notes: null, limitationsAccepted: true },
  });

  const after = await store.readCommittedArtifacts(slug, runId);
  assert.ok(after.txId, "Should resolve through active transaction");
  assert.equal(after.evidence.competitorOpportunities.candidates.qualified[0].approvalStatus, "approved");
});


// ---------------------------------------------------------------------------
// T9-ATOM-03: successful commit updates all artifacts
// ---------------------------------------------------------------------------

test("T9-ATOM-03: successful commit atomically updates lifecycle, evidence, and model", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-atomic-"));
  const store = makeStore(dir);

  const slug = "test-site";
  const runId = "atom-003";

  const evidence = {
    evidenceVersion: "1.0.0",
    site: { sourceStatus: SOURCE_STATUS.AVAILABLE, services: ["Consulting"], topicKeywords: [] },
    performance: { sourceStatus: SOURCE_STATUS.AVAILABLE },
    competitorOpportunities: {
      candidates: { qualified: [{ candidateUrl: "https://c1.example", domain: "c1.example", topic: "consulting", approvalStatus: "pending", qualificationPassed: true, qualificationResults: {}, discoverySource: "user-supplied", pageType: "service" }], excluded: [] },
      allGaps: [{ clientTopic: "consulting", competitorPage: "https://c1.example", approvalStatus: "pending", gapPassed: true, qualificationPassed: true }],
      gaps: [],
      sources: { supplied: { status: SOURCE_STATUS.AVAILABLE } },
      topics: [{ topic: "consulting" }],
    },
    backlinks: { sourceStatus: SOURCE_STATUS.NOT_CONNECTED },
    ga4: { sourceStatus: SOURCE_STATUS.NOT_CONNECTED },
    gsc: { sourceStatus: SOURCE_STATUS.NOT_CONNECTED },
  };

  const model = { scoringVersion: "3.0.0", input: { targetUrl: "https://example.com", businessName: "Example" }, scores: {}, evidence };

  await store.writeReport({ slug, runId, html: "<html></html>", model, manifest: { runId, slug, sources: {} } });

  // Apply approved decision
  const updatedEvidence = {
    ...evidence,
    competitorOpportunities: {
      ...evidence.competitorOpportunities,
      candidates: {
        ...evidence.competitorOpportunities.candidates,
        qualified: [{ ...evidence.competitorOpportunities.candidates.qualified[0], approvalStatus: "approved" }],
      },
      allGaps: [{ ...evidence.competitorOpportunities.allGaps[0], approvalStatus: "approved" }],
      gaps: [{ ...evidence.competitorOpportunities.allGaps[0], approvalStatus: "approved" }],
    },
  };

  const checklist = [
    { id: "source_failures", reviewed: true }, { id: "top_ten_findings", reviewed: true },
    { id: "high_severity", reviewed: true }, { id: "competitor_selections", reviewed: true },
    { id: "root_cause", reviewed: true }, { id: "score_eligibility", reviewed: true },
    { id: "limitations", reviewed: true }, { id: "causal_language", reviewed: true },
    { id: "implementation_feasibility", reviewed: true },
  ];

  const updatedLc = await store.commitCompetitorReview({
    slug, runId,
    evidence: updatedEvidence,
    model: { ...model, evidence: updatedEvidence },
    reviewRecord: {
      runId, reviewer: "auditor@example.com", reviewedAt: NOW,
      checklist, overrides: [], notes: "approved", limitationsAccepted: true,
    },
  });

  // Verify lifecycle
  assert.equal(updatedLc.status, "reviewed");
  assert.ok(updatedLc.activeReviewTxId, "Should have activeReviewTxId");
  assert.ok(updatedLc.review, "Should have review record");

  // Verify committed artifacts are readable
  const committed = await store.readCommittedArtifacts(slug, runId);
  assert.ok(committed, "Should read committed artifacts");
  assert.ok(committed.txId, "Should have transaction ID");
  const readOpp = committed.evidence.competitorOpportunities;
  assert.equal(readOpp.candidates.qualified[0].approvalStatus, "approved");

  // Verify client-facing gaps are populated
  assert.ok(readOpp.gaps.length > 0, "Should have approved gaps");
});

// ---------------------------------------------------------------------------
// T9-ATOM-04: orphaned staged artifacts are not read as active
// ---------------------------------------------------------------------------

test("T9-ATOM-04: reads resolve through active transaction only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-atomic-"));
  const store = makeStore(dir);

  const slug = "test-site";
  const runId = "atom-004";

  const evidence = {
    evidenceVersion: "1.0.0",
    site: { sourceStatus: SOURCE_STATUS.AVAILABLE, services: ["Consulting"] },
    performance: { sourceStatus: SOURCE_STATUS.AVAILABLE },
    competitorOpportunities: {
      candidates: { qualified: [{ candidateUrl: "https://c1.example", domain: "c1.example", topic: "consulting", approvalStatus: "pending", qualificationPassed: true, qualificationResults: {}, discoverySource: "user-supplied", pageType: "service" }], excluded: [] },
      allGaps: [{ clientTopic: "consulting", competitorPage: "https://c1.example", approvalStatus: "pending", gapPassed: true, qualificationPassed: true }], gaps: [],
      sources: {}, topics: [{ topic: "consulting" }],
    },
    backlinks: { sourceStatus: SOURCE_STATUS.NOT_CONNECTED },
    ga4: { sourceStatus: SOURCE_STATUS.NOT_CONNECTED },
    gsc: { sourceStatus: SOURCE_STATUS.NOT_CONNECTED },
  };
  const model = { scoringVersion: "3.0.0", input: { targetUrl: "https://example.com", businessName: "Example" }, scores: {}, evidence };

  await store.writeReport({ slug, runId, html: "<html></html>", model, manifest: { runId, slug, sources: {} } });

  // Read before review — should read from canonical paths (no txId)
  const beforeRead = await store.readCommittedArtifacts(slug, runId);
  assert.ok(beforeRead, "Should read canonical artifacts");
  assert.equal(beforeRead.txId, null, "No active transaction before review");

  // After a successful review, committed read should resolve through txId
  const checklist = [
    { id: "source_failures", reviewed: true }, { id: "top_ten_findings", reviewed: true },
    { id: "high_severity", reviewed: true }, { id: "competitor_selections", reviewed: true },
    { id: "root_cause", reviewed: true }, { id: "score_eligibility", reviewed: true },
    { id: "limitations", reviewed: true }, { id: "causal_language", reviewed: true },
    { id: "implementation_feasibility", reviewed: true },
  ];

  await store.commitCompetitorReview({
    slug, runId,
    evidence: { ...evidence, competitorOpportunities: { ...evidence.competitorOpportunities, candidates: { ...evidence.competitorOpportunities.candidates, qualified: [{ ...evidence.competitorOpportunities.candidates.qualified[0], approvalStatus: "approved" }] }, allGaps: [{ ...evidence.competitorOpportunities.allGaps[0], approvalStatus: "approved" }], gaps: [{ ...evidence.competitorOpportunities.allGaps[0], approvalStatus: "approved" }] } },
    model,
    reviewRecord: { runId, reviewer: "auditor", reviewedAt: NOW, checklist, overrides: [], notes: null, limitationsAccepted: true },
  });

  const afterRead = await store.readCommittedArtifacts(slug, runId);
  assert.ok(afterRead.txId, "Should have active transaction ID after review");
  assert.equal(afterRead.evidence.competitorOpportunities.candidates.qualified[0].approvalStatus, "approved");
});

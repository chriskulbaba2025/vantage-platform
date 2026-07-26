/**
 * Task 9 — Competitor Approval Workflow Tests
 *
 * Proves the production workflow:
 *   audit creation → pending candidates → review decisions → persisted updates → client-facing gaps → approval gate
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit, submitReview, approveAudit } from "./run-audit.js";
import { createLocalReportStore } from "../storage/report-store.js";
import { SOURCE_STATUS, ERROR_CATEGORY } from "../scoring/evidence-contracts.js";
import { validateCompetitorDecisions, buildCompetitorOverrides } from "./review-gate.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date().toISOString();

const AVAILABLE_SITE = {
  evidenceVersion: "1.0.0", source: "dataforseo-onpage", sourceStatus: SOURCE_STATUS.AVAILABLE,
  targetUrl: "https://example.com/", domain: "example.com", pageCount: 12, totalWords: 2000,
  averageWords: 500, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
  h1Missing: 0, h1Multiple: 0, imageCount: 5, imagesMissingAlt: 0, imagesMissingDimensions: 0,
  schemaTypes: ["Organization", "Service"], forms: [{ action: "/contact" }],
  ctas: [{ text: "Book", url: "https://example.com/book", kind: "link" }],
  externalCtas: [], socialLinks: ["https://linkedin.com/company/example"],
  internalLinkCount: 5, brokenInternalLinks: [], platform: "WordPress",
  services: ["Consulting", "Coaching", "Web Design"],
  topicKeywords: ["business consulting", "leadership coaching"],
  securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: false },
  trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true },
  limitations: [], pages: [{ title: "Home", language: "en-CA", rendered: false, headings: { h1: ["Example"], h2: [], h3: [], h4: [] }, responseHeaders: { "x-content-type-options": "nosniff" } }],
  collectedAt: now, coverage: { requested: 12, completed: 12, failed: 0 }, rawArtifactRef: "dfs://task-001",
  _sourceStatus: { provider: "dataforseo-onpage", adapterVersion: "1.0.0", startedAt: now, completedAt: now, requestId: "task-001", retryCount: 0, returnedRecordCount: 12, expectedRecordCount: 12, errorCategory: null, limitation: null, rawArtifactRef: "dfs://task-001" },
};

const AVAILABLE_PERF = {
  evidenceVersion: "1.0.0", source: "pagespeed-insights", sourceStatus: SOURCE_STATUS.AVAILABLE,
  status: SOURCE_STATUS.AVAILABLE, intendedProvider: "pagespeed-insights", fallbackUsed: false,
  mobile: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", strategy: "mobile", dataType: "lab", isLabData: true, isFieldData: false, fallbackUsed: false, scores: { performance: 75, accessibility: 88, bestPractices: 94, seo: 82 }, metrics: { fcpMs: 1000, lcpMs: 2200, tbtMs: 80, cls: 0.04 }, opportunities: [] },
  desktop: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", strategy: "desktop", dataType: "lab", isLabData: true, isFieldData: false, fallbackUsed: false, scores: { performance: 92, accessibility: 90, bestPractices: 96, seo: 85 }, metrics: { fcpMs: 500, lcpMs: 900, tbtMs: 30, cls: 0.02 }, opportunities: [] },
  fieldData: { phone: { status: SOURCE_STATUS.NOT_CONNECTED, isLabData: false, isFieldData: true }, desktop: { status: SOURCE_STATUS.NOT_CONNECTED, isLabData: false, isFieldData: true } },
  limitations: [], collectedAt: now, coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null,
  _sourceStatus: { provider: "pagespeed-insights", intendedProvider: "pagespeed-insights", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null },
};

const NOT_CONNECTED_BACKLINKS = {
  evidenceVersion: "1.0.0", source: "dataforseo", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED,
  records: [], collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null,
  _sourceStatus: { provider: "dataforseo", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null },
};

const NOT_CONNECTED_GA4 = {
  evidenceVersion: "1.0.0", source: "google-analytics-4", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED,
  included: false, affectsScore: false, collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null,
  _sourceStatus: { provider: "google-analytics-4", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null },
};

const NOT_CONNECTED_GSC = {
  evidenceVersion: "1.0.0", source: "google-search-console", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED,
  included: false, affectsScore: false, collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null,
  _sourceStatus: { provider: "google-search-console", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null },
};

const SUPPLIED_COMPETITORS = [
  {
    url: "https://competitor-1.example/services/consulting",
    status: SOURCE_STATUS.AVAILABLE,
    evidence: {
      services: ["Consulting", "Coaching"], pageCount: 15,
      trust: { testimonials: true, credentials: true, caseStudies: true, faq: true, pricing: true, policies: true, contact: true },
      schemaTypes: ["Organization", "Service"], ctas: [{ text: "Book", url: "https://c1.example/book", kind: "link" }],
      forms: [{ action: "/contact" }], domain: "competitor-1.example",
      socialLinks: [], platform: "WordPress",
      pages: [{ title: "Competitor 1", headings: { h1: ["Consulting"], h2: [], h3: [], h4: [] }, responseHeaders: {} }],
      topicKeywords: [],
    },
  },
  {
    url: "https://competitor-2.example/web-design",
    status: SOURCE_STATUS.AVAILABLE,
    evidence: {
      services: ["Web Design"], pageCount: 8,
      trust: { testimonials: false, credentials: true, caseStudies: false, faq: false, pricing: false, policies: false, contact: false },
      schemaTypes: ["Service"], ctas: [],
      forms: [], domain: "competitor-2.example",
      socialLinks: [], platform: "Squarespace",
      pages: [{ title: "Competitor 2", headings: { h1: ["Web Design"], h2: [], h3: [], h4: [] }, responseHeaders: {} }],
      topicKeywords: [],
    },
  },
];

function baseConfig(overrides = {}) {
  return {
    maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "",
    dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "",
    googleServiceAccountJson: "", reportsBucket: "", artifactDir: "/tmp",
    publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports",
    onpageMaxPages: 500, onpageJsRendering: false, onpageBrowserRendering: false,
    onpagePollTimeoutMs: 600000, onpagePollIntervalMs: 10000,
    onpageIncludePatterns: [], onpageExcludePatterns: [],
    googleClientId: "", googleClientSecret: "", googleRedirectUri: "", vantageEncryptionKey: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T9-REVIEW-01: Production run creates pending candidates
// ---------------------------------------------------------------------------

test("T9-REVIEW-01: production audit creates qualified candidates with pending status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-comp-review-"));
  const store = createLocalReportStore({ baseDir: dir });

  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", location: "Toronto, Ontario", competitors: ["https://competitor-1.example/services/consulting"] },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => AVAILABLE_SITE,
      crawlCompetitors: async () => SUPPLIED_COMPETITORS,
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      collectGsc: async () => NOT_CONNECTED_GSC,
      store, runId: "test-review-001",
    },
  );

  const opp = result.model.evidence?.competitorOpportunities;
  assert.ok(opp, "Should have competitor opportunities");
  const qualified = opp.candidates?.qualified || [];
  assert.ok(qualified.length > 0, "Should have qualified candidates");

  // All candidates should default to pending
  for (const c of qualified) {
    assert.equal(c.approvalStatus || "pending", "pending",
      `Candidate ${c.candidateUrl} should default to pending`);
  }

  // Client-facing gaps should be empty (all pending)
  assert.equal((opp.gaps || []).length, 0, "No client-facing gaps when all pending");
});

// ---------------------------------------------------------------------------
// T9-REVIEW-02: validateCompetitorDecisions
// ---------------------------------------------------------------------------

test("T9-REVIEW-02: validateCompetitorDecisions accepts valid approved and rejected decisions", () => {
  const known = new Set(["https://comp.example/page"]);
  const decisions = [
    { candidateUrl: "https://comp.example/page", decision: "approved", reason: "Relevant service competitor" },
  ];
  const { valid, records } = validateCompetitorDecisions(decisions, known);
  assert.equal(valid, true);
  assert.equal(records.length, 1);
  assert.equal(records[0].decision, "approved");
});

test("T9-REVIEW-02b: unknown candidate decision is rejected", () => {
  const known = new Set(["https://comp.example/page"]);
  const decisions = [
    { candidateUrl: "https://unknown.example/other", decision: "approved", reason: "test" },
  ];
  const { valid, errors } = validateCompetitorDecisions(decisions, known);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("Unknown or excluded")));
});

test("T9-REVIEW-02c: missing reason is rejected", () => {
  const known = new Set(["https://comp.example/page"]);
  const decisions = [
    { candidateUrl: "https://comp.example/page", decision: "approved", reason: "" },
  ];
  const { valid, errors } = validateCompetitorDecisions(decisions, known);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("non-empty reason")));
});

test("T9-REVIEW-02d: duplicate candidate decision is rejected", () => {
  const known = new Set(["https://comp.example/page"]);
  const decisions = [
    { candidateUrl: "https://comp.example/page", decision: "approved", reason: "first" },
    { candidateUrl: "https://comp.example/page", decision: "rejected", reason: "second" },
  ];
  const { valid, errors } = validateCompetitorDecisions(decisions, known);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("Duplicate")));
});

test("T9-REVIEW-02e: invalid decision value is rejected", () => {
  const known = new Set(["https://comp.example/page"]);
  const decisions = [
    { candidateUrl: "https://comp.example/page", decision: "maybe", reason: "test" },
  ];
  const { valid, errors } = validateCompetitorDecisions(decisions, known);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("must be")));
});

// ---------------------------------------------------------------------------
// T9-REVIEW-03: override records are built correctly
// ---------------------------------------------------------------------------

test("T9-REVIEW-03: buildCompetitorOverrides produces append-only override records", () => {
  const decisions = [
    { candidateUrl: "https://c1.example", decision: "approved", reason: "Relevant" },
    { candidateUrl: "https://c2.example", decision: "rejected", reason: "Directory site" },
  ];
  const overrides = buildCompetitorOverrides(decisions, "auditor@example.com");
  assert.equal(overrides.length, 2);
  assert.equal(overrides[0].user, "auditor@example.com");
  assert.equal(overrides[0].previousValue, "pending");
  assert.equal(overrides[0].replacementValue, "approved");
  assert.equal(overrides[0].field, "competitor:https://c1.example");
  assert.ok(overrides[0].timestamp);
  assert.equal(overrides[1].replacementValue, "rejected");
});

// ---------------------------------------------------------------------------
// T9-REVIEW-04: submitReview applies competitor decisions
// ---------------------------------------------------------------------------

test("T9-REVIEW-04: submitReview applies approved competitor decisions to canonical evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-comp-review-"));
  const store = createLocalReportStore({ baseDir: dir });

  // 1. Create audit
  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", location: "Toronto, Ontario", competitors: ["https://competitor-1.example/services/consulting"] },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => AVAILABLE_SITE,
      crawlCompetitors: async () => SUPPLIED_COMPETITORS,
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      collectGsc: async () => NOT_CONNECTED_GSC,
      store, runId: "test-review-002",
    },
  );

  // Collect qualified candidate URLs
  const opp = result.model.evidence?.competitorOpportunities;
  const qualifiedUrls = (opp?.candidates?.qualified || []).map((c) => c.candidateUrl);

  // 2. Submit review with competitor approval
  const competitorDecisions = qualifiedUrls.map((url) => ({
    candidateUrl: url,
    decision: "approved",
    reason: "Direct service competitor with comparable offerings",
  }));

  const checklist = [
    { id: "source_failures", reviewed: true },
    { id: "top_ten_findings", reviewed: true },
    { id: "high_severity", reviewed: true },
    { id: "competitor_selections", reviewed: true },
    { id: "root_cause", reviewed: true },
    { id: "score_eligibility", reviewed: true },
    { id: "limitations", reviewed: true },
    { id: "causal_language", reviewed: true },
    { id: "implementation_feasibility", reviewed: true },
  ];

  const updated = await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com",
    checklist,
    competitorDecisions,
    limitationsAccepted: true,
    notes: "All competitors reviewed and approved",
  });

  assert.equal(updated.status, "reviewed");
  assert.ok(updated.review, "Should have review record");

  // 3. Verify persisted evidence was updated
  const evidenceRaw = await store.readFile(`${result.slug}/${result.runId}/evidence.json`);
  const evidence = JSON.parse(evidenceRaw.toString("utf8"));
  const updatedOpp = evidence.competitorOpportunities;

  for (const c of (updatedOpp?.candidates?.qualified || [])) {
    assert.equal(c.approvalStatus, "approved",
      `Candidate ${c.candidateUrl} should be approved after review`);
  }

  // Client-facing gaps should now exist
  assert.ok((updatedOpp?.gaps || []).length > 0, "Should have approved client-facing gaps");
});

// ---------------------------------------------------------------------------
// T9-REVIEW-05: rejected competitor never creates a client-facing gap
// ---------------------------------------------------------------------------

test("T9-REVIEW-05: rejected competitor decisions produce no client-facing gaps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-comp-review-"));
  const store = createLocalReportStore({ baseDir: dir });

  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", location: "Toronto, Ontario", competitors: ["https://competitor-1.example/services/consulting"] },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => AVAILABLE_SITE,
      crawlCompetitors: async () => SUPPLIED_COMPETITORS,
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      collectGsc: async () => NOT_CONNECTED_GSC,
      store, runId: "test-review-003",
    },
  );

  const opp = result.model.evidence?.competitorOpportunities;
  const qualifiedUrls = (opp?.candidates?.qualified || []).map((c) => c.candidateUrl);

  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com",
    checklist: [
      { id: "source_failures", reviewed: true }, { id: "top_ten_findings", reviewed: true },
      { id: "high_severity", reviewed: true }, { id: "competitor_selections", reviewed: true },
      { id: "root_cause", reviewed: true }, { id: "score_eligibility", reviewed: true },
      { id: "limitations", reviewed: true }, { id: "causal_language", reviewed: true },
      { id: "implementation_feasibility", reviewed: true },
    ],
    competitorDecisions: qualifiedUrls.map((url) => ({
      candidateUrl: url, decision: "rejected", reason: "Not a direct service competitor",
    })),
    limitationsAccepted: true,
  });

  const evidenceRaw = await store.readFile(`${result.slug}/${result.runId}/evidence.json`);
  const evidence = JSON.parse(evidenceRaw.toString("utf8"));
  const updatedOpp = evidence.competitorOpportunities;

  // Client-facing gaps should be empty
  assert.equal((updatedOpp?.gaps || []).length, 0, "Rejected candidates should produce no gaps");

  // All candidates should be rejected
  for (const c of (updatedOpp?.candidates?.qualified || [])) {
    assert.equal(c.approvalStatus, "rejected");
  }
});

// ---------------------------------------------------------------------------
// T9-REVIEW-06: competitor_selections checklist required for approval
// ---------------------------------------------------------------------------

test("T9-REVIEW-06: approval fails when competitor_selections not reviewed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-comp-review-"));
  const store = createLocalReportStore({ baseDir: dir });

  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", location: "Toronto, Ontario", competitors: ["https://competitor-1.example/services/consulting"] },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => AVAILABLE_SITE,
      crawlCompetitors: async () => SUPPLIED_COMPETITORS,
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      collectGsc: async () => NOT_CONNECTED_GSC,
      store, runId: "test-review-004",
    },
  );

  const opp = result.model.evidence?.competitorOpportunities;
  const qualifiedUrls = (opp?.candidates?.qualified || []).map((c) => c.candidateUrl);

  // Submit review with all checklist items reviewed EXCEPT competitor_selections
  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com",
    checklist: [
      { id: "source_failures", reviewed: true }, { id: "top_ten_findings", reviewed: true },
      { id: "high_severity", reviewed: true },
      { id: "competitor_selections", reviewed: false }, // NOT reviewed
      { id: "root_cause", reviewed: true }, { id: "score_eligibility", reviewed: true },
      { id: "limitations", reviewed: true }, { id: "causal_language", reviewed: true },
      { id: "implementation_feasibility", reviewed: true },
    ],
    competitorDecisions: qualifiedUrls.map((url) => ({
      candidateUrl: url, decision: "approved", reason: "Relevant competitor",
    })),
    limitationsAccepted: true,
  });

  // Approval should fail because competitor_selections is not reviewed
  // (isReviewComplete check fires before the specific competitor gate)
  await assert.rejects(
    () => approveAudit(store, result.slug, result.runId, "approver@example.com", { model: result.model }),
    /complete review/i,
  );
});

// ---------------------------------------------------------------------------
// T9-REVIEW-07: approval fails when client-facing gap references pending candidate
// ---------------------------------------------------------------------------

test("T9-REVIEW-07: approval fails when a client-facing gap references pending candidate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-comp-review-"));
  const store = createLocalReportStore({ baseDir: dir });

  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", location: "Toronto, Ontario", competitors: ["https://competitor-1.example/services/consulting"] },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => AVAILABLE_SITE,
      crawlCompetitors: async () => SUPPLIED_COMPETITORS,
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      collectGsc: async () => NOT_CONNECTED_GSC,
      store, runId: "test-review-005",
    },
  );

  // Submit review WITHOUT competitor decisions (all stay pending)
  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com",
    checklist: [
      { id: "source_failures", reviewed: true }, { id: "top_ten_findings", reviewed: true },
      { id: "high_severity", reviewed: true }, { id: "competitor_selections", reviewed: true },
      { id: "root_cause", reviewed: true }, { id: "score_eligibility", reviewed: true },
      { id: "limitations", reviewed: true }, { id: "causal_language", reviewed: true },
      { id: "implementation_feasibility", reviewed: true },
    ],
    limitationsAccepted: true,
    notes: "Review without competitor decisions — all remain pending",
  });

  // Manually inject a pending gap into the model to simulate inconsistency
  const model = { ...result.model };
  model.evidence = {
    ...model.evidence,
    competitorOpportunities: {
      ...(model.evidence.competitorOpportunities || {}),
      gaps: [
        {
          clientTopic: "Consulting",
          competitorPage: "https://competitor-1.example/services/consulting",
          competitorDomain: "competitor-1.example",
          approvalStatus: "pending", // pending!
          gapPassed: true, qualificationPassed: true,
          conversionRelevance: "High", confidence: "Moderate",
          limitationStatement: "Test gap — should be rejected",
        },
      ],
    },
  };

  await assert.rejects(
    () => approveAudit(store, result.slug, result.runId, "approver@example.com", { model }),
    /pending/i,
  );
});

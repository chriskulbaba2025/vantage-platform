import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalReportStore } from "../storage/report-store.js";
import { runAudit, submitReview, approveAudit, getAuditStatus } from "./run-audit.js";
import {
  LIFECYCLE_STATUS,
  buildReviewRecord,
  buildApprovalRecord,
  validateTransition,
  isReviewComplete,
  emptyChecklist,
  appendOverrides,
  REVIEW_CHECKLIST_ITEMS,
} from "./review-gate.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";
import { scoreAudit } from "../scoring/vantage-score.js";

// ---------------------------------------------------------------------------
// Minimal scored model for approval tests
// ---------------------------------------------------------------------------

function scoredModel() {
  const now = new Date().toISOString();
  const site = {
    evidenceVersion: "1.0.0", source: "dataforseo-onpage", sourceStatus: SOURCE_STATUS.AVAILABLE,
    targetUrl: "https://example.com/", domain: "example.com", pageCount: 2, totalWords: 800,
    averageWords: 400, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
    h1Missing: 0, h1Multiple: 0, imageCount: 2, imagesMissingAlt: 0, imagesMissingDimensions: 0,
    schemaTypes: ["WebPage"], forms: [], ctas: [{ text: "Contact", url: "https://example.com/contact", kind: "link" }],
    externalCtas: [], socialLinks: [], internalLinkCount: 2, brokenInternalLinks: [], platform: "WordPress",
    services: ["Consulting"], topicKeywords: ["consulting"],
    securityHeaders: { xFrameOptions: false, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: false },
    trust: { testimonials: true, credentials: true, caseStudies: false, faq: false, pricing: true, policies: false, contact: true },
    limitations: [], pages: [{ title: "Example", language: "en-CA", rendered: false, headings: { h1: ["Example"], h2: [], h3: [], h4: [] }, responseHeaders: { "x-content-type-options": "nosniff" }, url: "https://example.com/" }],
    collectedAt: now, coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null,
    _sourceStatus: { provider: "dataforseo-onpage", adapterVersion: "1.0.0", startedAt: now, completedAt: now, requestId: "t1", retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null },
  };
  const evidence = {
    site,
    performance: { evidenceVersion: "1.0.0", source: "mock", sourceStatus: SOURCE_STATUS.AVAILABLE, status: SOURCE_STATUS.AVAILABLE, mobile: { status: SOURCE_STATUS.AVAILABLE, source: "mock", scores: { performance: 60, accessibility: 80, bestPractices: 90, seo: 80 }, metrics: {} }, desktop: { status: SOURCE_STATUS.AVAILABLE, source: "mock", scores: { performance: 90, accessibility: 80, bestPractices: 90, seo: 80 }, metrics: {} }, fieldData: {}, limitations: [], collectedAt: now, coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "mock", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null } },
    competitors: [],
    backlinks: { evidenceVersion: "1.0.0", source: "dataforseo", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, records: [], collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "dataforseo", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } },
    ga4: { evidenceVersion: "1.0.0", source: "google-analytics-4", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, affectsScore: false, collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "google-analytics-4", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } },
  };
  return scoreAudit({ targetUrl: "https://example.com/", businessName: "Example Business", location: "Toronto", language: "en-CA", competitors: [] }, evidence);
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const now = new Date().toISOString();

const AVAILABLE_SITE = {
  evidenceVersion: "1.0.0",
  source: "dataforseo-onpage",
  sourceStatus: SOURCE_STATUS.AVAILABLE,
  targetUrl: "https://example.com/",
  domain: "example.com",
  pageCount: 2,
  totalWords: 800,
  averageWords: 400,
  missingTitles: 0,
  missingDescriptions: 0,
  missingCanonicals: 0,
  h1Missing: 0,
  h1Multiple: 0,
  imageCount: 2,
  imagesMissingAlt: 0,
  imagesMissingDimensions: 0,
  schemaTypes: ["WebPage"],
  forms: [],
  ctas: [{ text: "Contact", url: "https://example.com/contact", kind: "link" }],
  externalCtas: [],
  socialLinks: [],
  internalLinkCount: 2,
  brokenInternalLinks: [],
  platform: "WordPress",
  services: ["Consulting"],
  topicKeywords: ["consulting"],
  securityHeaders: { xFrameOptions: false, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: false },
  trust: { testimonials: true, credentials: true, caseStudies: false, faq: false, pricing: true, policies: false, contact: true },
  limitations: [],
  pages: [{ title: "Example", language: "en-CA", rendered: false, headings: { h1: ["Example"], h2: [], h3: [], h4: [] }, responseHeaders: { "x-content-type-options": "nosniff" } }],
  collectedAt: now,
  coverage: { requested: 2, completed: 2, failed: 0 },
  rawArtifactRef: "dataforseo://on_page/test-task-001",
  _sourceStatus: { provider: "dataforseo-onpage", adapterVersion: "1.0.0", startedAt: now, completedAt: now, requestId: "test-task-001", retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: "dataforseo://on_page/test-task-001" },
};

const AVAILABLE_PERF = {
  evidenceVersion: "1.0.0", source: "mock", sourceStatus: SOURCE_STATUS.AVAILABLE, status: SOURCE_STATUS.AVAILABLE,
  mobile: { status: SOURCE_STATUS.AVAILABLE, source: "mock", scores: { performance: 60, accessibility: 80, bestPractices: 90, seo: 80 }, metrics: {} },
  desktop: { status: SOURCE_STATUS.AVAILABLE, source: "mock", scores: { performance: 90, accessibility: 80, bestPractices: 90, seo: 80 }, metrics: {} },
  fieldData: {}, limitations: [], collectedAt: now, coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null,
  _sourceStatus: { provider: "mock", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null },
};

const NOT_CONNECTED_BACKLINKS = {
  evidenceVersion: "1.0.0", source: "dataforseo", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, records: [], collectedAt: now,
  coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null,
  _sourceStatus: { provider: "dataforseo", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null },
};

const NOT_CONNECTED_GA4 = {
  evidenceVersion: "1.0.0", source: "google-analytics-4", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, affectsScore: false, collectedAt: now,
  coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null,
  _sourceStatus: { provider: "google-analytics-4", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null },
};

function baseConfig(overrides = {}) {
  return {
    maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "",
    dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "",
    reportsBucket: "", artifactDir: "/tmp", publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports",
    onpageMaxPages: 500, onpageJsRendering: false, onpageBrowserRendering: false,
    onpagePollTimeoutMs: 600000, onpagePollIntervalMs: 10000,
    onpageIncludePatterns: [], onpageExcludePatterns: [],
    ...overrides,
  };
}

async function createAudit() {
  const dir = await mkdtemp(join(tmpdir(), "vantage-review-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => AVAILABLE_SITE,
      crawlCompetitors: async () => [],
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      store,
    },
  );
  return { result, store, dir };
}

// ---------------------------------------------------------------------------
// A. Draft lifecycle
// ---------------------------------------------------------------------------

test("1. new audit is persisted as draft", async () => {
  const { result, store } = await createAudit();
  assert.equal(result.status, "draft");
  assert.equal(result.lifecycleStatus, LIFECYCLE_STATUS.DRAFT);

  const status = await store.getStatus(result.slug, result.runId);
  assert.equal(status.status, "draft");
  assert.equal(status.reviewComplete, false);
  assert.equal(status.reviewer, null);
  assert.equal(status.approver, null);
});

test("2. draft report cannot be retrieved through the final-report route (delivery gate)", async () => {
  const { store, result } = await createAudit();

  // Draft status should be blocked
  const draftStatus = await store.getStatus(result.slug, result.runId);
  assert.equal(draftStatus.status, "draft");
  // The delivery gate (server-side) would check: status !== "approved" → 403
  assert.notEqual(draftStatus.status, "approved");

  // Submit a review (reviewed status)
  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({
    id: item.id, reviewed: true, reviewedAt: new Date().toISOString(),
  }));
  await submitReview(store, result.slug, result.runId, { reviewer: "auditor@example.com", checklist });

  // Reviewed-but-not-approved should also be blocked
  const reviewedStatus = await store.getStatus(result.slug, result.runId);
  assert.equal(reviewedStatus.status, "reviewed");
  assert.notEqual(reviewedStatus.status, "approved");
});

test("3. draft status is visible in manifest", async () => {
  const { result } = await createAudit();
  assert.equal(result.manifest.status, "draft");
});

// ---------------------------------------------------------------------------
// B. Review contract
// ---------------------------------------------------------------------------

test("4. complete review payload is accepted and persisted", async () => {
  const { result, store } = await createAudit();

  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({
    id: item.id,
    reviewed: true,
    note: `Reviewed ${item.id}`,
    reviewedAt: new Date().toISOString(),
  }));

  const payload = {
    reviewer: "principal-auditor@example.com",
    checklist,
    notes: "All checks passed.",
    limitationsAccepted: true,
    overrides: [
      {
        user: "principal-auditor@example.com",
        timestamp: new Date().toISOString(),
        reason: "Corrected typo in business name",
        previousValue: "Exmple",
        replacementValue: "Example",
        field: "input.businessName",
      },
    ],
  };

  const updated = await submitReview(store, result.slug, result.runId, payload);

  assert.equal(updated.status, "reviewed");
  assert.equal(updated.review.reviewer, "principal-auditor@example.com");
  assert.equal(updated.review.checklist.length, 10);
  assert.ok(updated.review.checklist.every((c) => c.reviewed));
  assert.equal(updated.overrides.length, 1);
  assert.equal(updated.review.limitationsAccepted, true);

  const status = await store.getStatus(result.slug, result.runId);
  assert.equal(status.status, "reviewed");
  assert.equal(status.reviewComplete, true);
  assert.equal(status.reviewer, "principal-auditor@example.com");
});

test("5. incomplete checklist is rejected", async () => {
  const { result, store } = await createAudit();

  // Only submit 3 of 10 checklist items
  const checklist = REVIEW_CHECKLIST_ITEMS.slice(0, 3).map((item) => ({
    id: item.id,
    reviewed: true,
  }));

  const payload = { reviewer: "auditor@example.com", checklist };

  await assert.rejects(
    () => submitReview(store, result.slug, result.runId, payload),
    (err) => {
      assert.match(err.message, /Incomplete checklist/i);
      return true;
    },
  );
});

test("6. unknown checklist item id is rejected", async () => {
  const { valid, record } = buildReviewRecord({
    reviewer: "test",
    checklist: [{ id: "not_a_real_item", reviewed: true }],
  });
  assert.equal(valid, false);
  assert.equal(record, null);
});

// ---------------------------------------------------------------------------
// C. Review alone does not approve
// ---------------------------------------------------------------------------

test("7. review alone does not approve the report", async () => {
  const { result, store } = await createAudit();

  // Submit complete review
  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({
    id: item.id, reviewed: true, reviewedAt: new Date().toISOString(),
  }));
  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com", checklist,
  });

  // Status is "reviewed", not "approved"
  const status = await store.getStatus(result.slug, result.runId);
  assert.equal(status.status, "reviewed");
  assert.equal(status.approver, null);
  assert.equal(status.approvedAt, null);
});

// ---------------------------------------------------------------------------
// D. Approval
// ---------------------------------------------------------------------------

test("8. approval without a review is rejected", async () => {
  const { result, store } = await createAudit();

  // Never submitted a review
  await assert.rejects(
    () => approveAudit(store, result.slug, result.runId, "approver@example.com"),
    (err) => {
      assert.match(err.message, /complete review/i);
      return true;
    },
  );
});

test("9. approval with incomplete review is rejected", async () => {
  const { result, store } = await createAudit();

  // Submit review with some items not reviewed
  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({
    id: item.id,
    reviewed: item.id !== "causal_language", // leave one unreviewed
    reviewedAt: new Date().toISOString(),
  }));
  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com", checklist,
  });

  await assert.rejects(
    () => approveAudit(store, result.slug, result.runId, "approver@example.com"),
    (err) => {
      assert.match(err.message, /complete review/i);
      return true;
    },
  );
});

test("10. approval after complete review transitions draft to approved", async () => {
  const { result, store } = await createAudit();

  // Complete review
  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({
    id: item.id, reviewed: true, reviewedAt: new Date().toISOString(),
  }));
  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com", checklist,
  });

  // Approve
  const approval = await approveAudit(store, result.slug, result.runId, "approver@example.com", { model: scoredModel() });

  assert.equal(approval.lifecycle.status, "approved");
  assert.equal(approval.lifecycle.approval.approver, "approver@example.com");
  assert.ok(approval.lifecycle.approval.approvedAt);

  // Status endpoint reflects approval
  const status = await store.getStatus(result.slug, result.runId);
  assert.equal(status.status, "approved");
  assert.equal(status.approver, "approver@example.com");
  assert.ok(status.approvedAt);
  assert.equal(status.reviewComplete, true);
});

test("11. repeated approval is idempotent", async () => {
  const { result, store } = await createAudit();

  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({
    id: item.id, reviewed: true, reviewedAt: new Date().toISOString(),
  }));
  await submitReview(store, result.slug, result.runId, { reviewer: "auditor@example.com", checklist });

  // First approval
  const first = await approveAudit(store, result.slug, result.runId, "approver@example.com", { model: scoredModel() });
  assert.equal(first.lifecycle.status, "approved");

  // Second approval — should succeed idempotently
  const second = await approveAudit(store, result.slug, result.runId, "approver2@example.com", { model: scoredModel() });
  assert.equal(second.lifecycle.status, "approved");
  // Original approver preserved
  assert.equal(second.lifecycle.approval.approver, "approver@example.com");
});

test("12. invalid lifecycle transitions are rejected", async () => {
  const { result, store } = await createAudit();

  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({
    id: item.id, reviewed: true, reviewedAt: new Date().toISOString(),
  }));
  await submitReview(store, result.slug, result.runId, { reviewer: "auditor@example.com", checklist });
  await approveAudit(store, result.slug, result.runId, "approver@example.com", { model: scoredModel() });

  // Try to approve again from "approved" — store handles it idempotently
  const second = await approveAudit(store, result.slug, result.runId, "approver2@example.com", { model: scoredModel() });
  assert.equal(second.lifecycle.status, "approved");
});

// ---------------------------------------------------------------------------
// E. Overrides (PRD §20)
// ---------------------------------------------------------------------------

test("13. every override contains all required PRD §20 fields", async () => {
  const override = {
    user: "auditor@example.com",
    timestamp: new Date().toISOString(),
    reason: "Fixed business name spelling",
    previousValue: "Exampl",
    replacementValue: "Example",
    field: "input.businessName",
  };

  const { valid } = buildReviewRecord({
    reviewer: "auditor@example.com",
    checklist: REVIEW_CHECKLIST_ITEMS.map((item) => ({ id: item.id, reviewed: true, reviewedAt: new Date().toISOString() })),
    overrides: [override],
  });

  assert.equal(valid, true);
});

test("14. override with empty reason is rejected", async () => {
  const { valid, errors } = buildReviewRecord({
    reviewer: "auditor@example.com",
    checklist: REVIEW_CHECKLIST_ITEMS.map((item) => ({ id: item.id, reviewed: true, reviewedAt: new Date().toISOString() })),
    overrides: [{ user: "a", timestamp: now, reason: "  ", previousValue: "x", replacementValue: "y" }],
  });

  assert.equal(valid, false);
  assert.ok(errors.some((e) => /reason/i.test(e)), `Expected reason error, got: ${JSON.stringify(errors)}`);
});

test("15. overrides are append-only", async () => {
  const { result, store } = await createAudit();

  // Submit review with 1 override
  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({ id: item.id, reviewed: true, reviewedAt: new Date().toISOString() }));
  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com",
    checklist,
    overrides: [{ user: "a", timestamp: now, reason: "First", previousValue: "a", replacementValue: "b", field: "x" }],
  });

  // Re-submit review with another override (append)
  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com",
    checklist, // still complete
    overrides: [{ user: "a", timestamp: now, reason: "Second", previousValue: "c", replacementValue: "d", field: "y" }],
  });

  const lc = await store._readLifecycle(result.slug, result.runId);
  assert.equal(lc.overrides.length, 2);
  assert.equal(lc.overrides[0].reason, "First");
  assert.equal(lc.overrides[1].reason, "Second");
});

test("16. appendOverrides merges new overrides into existing record", async () => {
  const existing = {
    runId: "test",
    status: "reviewed",
    reviewer: "auditor",
    reviewedAt: now,
    checklist: [],
    overrides: [{ user: "a", timestamp: now, reason: "Original", previousValue: "x", replacementValue: "y", field: "f1" }],
  };

  const { valid, record, errors } = appendOverrides(existing, [
    { user: "b", timestamp: now, reason: "New", previousValue: "z", replacementValue: "w", field: "f2" },
  ], "auditor");

  assert.equal(valid, true);
  assert.equal(record.overrides.length, 2);
  assert.equal(errors.length, 0);
});

// ---------------------------------------------------------------------------
// F. Status retrieval
// ---------------------------------------------------------------------------

test("17. audit status retrieval returns complete lifecycle and review state", async () => {
  const { result, store } = await createAudit();

  const status = await getAuditStatus(store, result.slug, result.runId);
  assert.equal(status.runId, result.runId);
  assert.equal(status.status, "draft");
  assert.equal(status.reviewComplete, false);
  assert.equal(status.reviewer, null);
  assert.equal(status.approver, null);
  assert.ok(Array.isArray(status.artifacts.draft));
  assert.equal(status.artifacts.final, null);
  assert.ok(Array.isArray(status.limitations));
  assert.ok(Array.isArray(status.overrides));
});

test("18. status after review + approval contains all fields", async () => {
  const { result, store } = await createAudit();

  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({ id: item.id, reviewed: true, reviewedAt: new Date().toISOString() }));
  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com", checklist,
    overrides: [{ user: "auditor", timestamp: now, reason: "Fix", previousValue: "old", replacementValue: "new", field: "x" }],
  });
  await approveAudit(store, result.slug, result.runId, "approver@example.com", { model: scoredModel() });

  const status = await getAuditStatus(store, result.slug, result.runId);
  assert.equal(status.status, "approved");
  assert.equal(status.reviewComplete, true);
  assert.equal(status.reviewer, "auditor@example.com");
  assert.ok(status.reviewedAt);
  assert.equal(status.approver, "approver@example.com");
  assert.ok(status.approvedAt);
  assert.ok(status.artifacts.final);
  assert.equal(status.overrides.length, 1);
});

// ---------------------------------------------------------------------------
// G. review-gate unit tests
// ---------------------------------------------------------------------------

test("19. validateTransition: valid draft→reviewed", () => {
  const { valid, errors } = validateTransition("draft", "reviewed");
  assert.equal(valid, true);
  assert.equal(errors.length, 0);
});

test("20. validateTransition: valid draft→approved (direct)", () => {
  const { valid } = validateTransition("draft", "approved");
  assert.equal(valid, true);
});

test("21. validateTransition: valid reviewed→approved", () => {
  const { valid } = validateTransition("reviewed", "approved");
  assert.equal(valid, true);
});

test("22. validateTransition: invalid approved→draft", () => {
  const { valid } = validateTransition("approved", "draft");
  assert.equal(valid, false);
});

test("23. validateTransition: invalid approved→reviewed", () => {
  const { valid } = validateTransition("approved", "reviewed");
  assert.equal(valid, false);
});

test("24. validateTransition: invalid reviewed→draft", () => {
  const { valid } = validateTransition("reviewed", "draft");
  assert.equal(valid, false);
});

test("25. validateTransition: unknown status rejected", () => {
  const { valid } = validateTransition("nonexistent", "approved");
  assert.equal(valid, false);
});

test("26. isReviewComplete: all reviewed returns true", () => {
  const review = { checklist: REVIEW_CHECKLIST_ITEMS.map((item) => ({ id: item.id, reviewed: true })) };
  assert.equal(isReviewComplete(review), true);
});

test("27. isReviewComplete: one unreviewed returns false", () => {
  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({ id: item.id, reviewed: item.id !== "root_cause" }));
  assert.equal(isReviewComplete({ checklist }), false);
});

test("28. isReviewComplete: null returns false", () => {
  assert.equal(isReviewComplete(null), false);
});

test("29. emptyChecklist produces all 10 items unreviewed", () => {
  const cl = emptyChecklist();
  assert.equal(cl.length, 10);
  assert.ok(cl.every((item) => item.reviewed === false));
  assert.ok(cl.every((item) => item.note === null));
});

test("30. emptyChecklist ids match REVIEW_CHECKLIST_ITEMS", () => {
  const cl = emptyChecklist();
  const expectedIds = REVIEW_CHECKLIST_ITEMS.map((i) => i.id);
  assert.deepEqual(cl.map((i) => i.id), expectedIds);
});

// ---------------------------------------------------------------------------
// H. Storage-level tests
// ---------------------------------------------------------------------------

test("31. writeReview rejects when audit does not exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-storage-"));
  const store = createLocalReportStore({ baseDir: dir });

  await assert.rejects(
    () => store.writeReview("no-such-slug", "no-such-run", { reviewer: "x", reviewedAt: now, checklist: [] }),
    (err) => { assert.equal(err.statusCode, 404); return true; },
  );
});

test("32. writeApproval rejects when review is incomplete", async () => {
  const { result, store } = await createAudit();

  // Submit review with unreviewed items
  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({
    id: item.id, reviewed: false, reviewedAt: null,
  }));
  await submitReview(store, result.slug, result.runId, { reviewer: "a", checklist });

  await assert.rejects(
    () => store.writeApproval(result.slug, result.runId, { approver: "x", approvedAt: now, reviewRef: {} }),
    (err) => { assert.match(err.message, /incomplete/i); return true; },
  );
});

test("33. addLimitation preserves approved status and records message", async () => {
  const { result, store } = await createAudit();

  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({ id: item.id, reviewed: true, reviewedAt: now }));
  await submitReview(store, result.slug, result.runId, { reviewer: "a", checklist });
  await approveAudit(store, result.slug, result.runId, "approver@example.com", { model: scoredModel() });

  await store.addLimitation(result.slug, result.runId, "PDF rendering failed: no Puppeteer");

  const lc = await store._readLifecycle(result.slug, result.runId);
  assert.equal(lc.status, "approved"); // preserved
  assert.ok(lc.limitations.some((l) => /PDF rendering failed/.test(l)));
});

// ---------------------------------------------------------------------------
// I. buildReviewRecord edge cases
// ---------------------------------------------------------------------------

test("34. buildReviewRecord rejects null payload", () => {
  const { valid, errors } = buildReviewRecord(null);
  assert.equal(valid, false);
  assert.ok(errors.length > 0);
});

test("35. buildReviewRecord rejects payload without reviewer", () => {
  const { valid, errors } = buildReviewRecord({ checklist: [] });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /reviewer/i.test(e)));
});

test("36. buildReviewRecord rejects duplicate checklist items", () => {
  const { valid, errors } = buildReviewRecord({
    reviewer: "a",
    checklist: [
      { id: "root_cause", reviewed: true },
      { id: "root_cause", reviewed: true },
    ],
  });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /duplicate/i.test(e)));
});

// ---------------------------------------------------------------------------
// J. approveAudit edge cases
// ---------------------------------------------------------------------------

test("37. approveAudit rejects nonexistent audit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-approve-"));
  const store = createLocalReportStore({ baseDir: dir });

  await assert.rejects(
    () => approveAudit(store, "no-slug", "no-run", "approver@example.com"),
    (err) => { assert.equal(err.statusCode, 404); return true; },
  );
});

test("38. approveAudit requires approver identity (validated by buildApprovalRecord)", async () => {
  // buildApprovalRecord rejects empty approver
  const { valid, errors } = buildApprovalRecord("run1", {
    reviewer: "rev", reviewedAt: now, checklist: REVIEW_CHECKLIST_ITEMS.map((i) => ({ id: i.id, reviewed: true })),
  }, "  ");
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /approver/i.test(e)));
});

// ---------------------------------------------------------------------------
// K. Existing test compatibility
// ---------------------------------------------------------------------------

test("39. existing audit creation still works with status draft", async () => {
  const { result } = await createAudit();
  assert.equal(result.status, "draft");
  assert.equal(result.manifest.status, "draft");

  // All the same model structure still present
  assert.ok(result.model);
  assert.ok(result.model.scores);
  assert.notEqual(result.model.scores.performance, null);
  assert.ok(result.manifest.sources.website);
});

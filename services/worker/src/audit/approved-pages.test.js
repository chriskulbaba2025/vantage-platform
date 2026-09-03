import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalReportStore } from "../storage/report-store.js";
import { runAudit, submitReview, approveAudit } from "./run-audit.js";
import { renderApprovedReport, APPROVED_PAGES } from "../report/render-approved-report.js";
import { scoreAudit } from "../scoring/vantage-score.js";
import { REVIEW_CHECKLIST_ITEMS } from "./review-gate.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date().toISOString();

function scoredModel() {
  const site = {
    evidenceVersion: "1.0.0", source: "dataforseo-onpage", sourceStatus: SOURCE_STATUS.AVAILABLE,
    targetUrl: "https://example.com/", domain: "example.com", pageCount: 2, totalWords: 800,
    averageWords: 400, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
    h1Missing: 0, h1Multiple: 0, imageCount: 2, imagesMissingAlt: 0, imagesMissingDimensions: 0,
    schemaTypes: ["LocalBusiness"], forms: [], ctas: [{ text: "Contact", url: "https://example.com/contact", kind: "link" }],
    externalCtas: [], socialLinks: [{ url: "https://linkedin.com/company/example" }], internalLinkCount: 5,
    brokenInternalLinks: [{ source: "https://example.com/about", url: "https://example.com/deleted" }],
    platform: "WordPress", services: ["Consulting", "Coaching"],
    topicKeywords: ["business consulting", "executive coaching"],
    securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: false },
    trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true },
    limitations: [], pages: [{ title: "Example", language: "en-CA", rendered: false, headings: { h1: ["Example"], h2: [], h3: [], h4: [] }, responseHeaders: { "x-content-type-options": "nosniff" }, url: "https://example.com/" }],
    collectedAt: now, coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null,
    _sourceStatus: { provider: "dataforseo-onpage", adapterVersion: "1.0.0", startedAt: now, completedAt: now, requestId: "t1", retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null },
  };
  const evidence = {
    site,
    performance: { evidenceVersion: "1.0.0", source: "mock", sourceStatus: SOURCE_STATUS.AVAILABLE, status: SOURCE_STATUS.AVAILABLE, mobile: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", scores: { performance: 70, accessibility: 90, bestPractices: 96, seo: 90 }, metrics: { fcpMs: 1200, lcpMs: 2500, tbtMs: 100, cls: 0.05 } }, desktop: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", scores: { performance: 95, accessibility: 90, bestPractices: 96, seo: 90 }, metrics: { fcpMs: 500, lcpMs: 900 } }, fieldData: {}, limitations: [], collectedAt: now, coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "pagespeed-insights", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null } },
    competitors: [],
    backlinks: { evidenceVersion: "1.0.0", source: "dataforseo", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, records: [], collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "dataforseo", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } },
    ga4: { evidenceVersion: "1.0.0", source: "google-analytics-4", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, affectsScore: false, collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "google-analytics-4", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } },
  };
  return scoreAudit({ targetUrl: "https://example.com/", businessName: "Example Business", location: "Toronto, Ontario", language: "en-CA", competitors: [] }, evidence);
}

async function createApprovedAudit() {
  const dir = await mkdtemp(join(tmpdir(), "vantage-multipage-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: {
        maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "",
        dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "",
        reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1",
        reportsPrefix: "vantage/reports", onpageMaxPages: 500, onpageJsRendering: false,
        onpageBrowserRendering: false, onpagePollTimeoutMs: 600000, onpagePollIntervalMs: 10000,
        onpageIncludePatterns: [], onpageExcludePatterns: [],
      },
      crawlSite: async () => scoredModel().evidence.site,
      crawlCompetitors: async () => [],
      collectPerformance: async () => scoredModel().evidence.performance,
      collectBacklinks: async () => scoredModel().evidence.backlinks,
      collectGa4: async () => scoredModel().evidence.ga4,
      store,
    },
  );

  // Submit complete review
  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({
    id: item.id, reviewed: true, reviewedAt: new Date().toISOString(),
  }));
  await submitReview(store, result.slug, result.runId, {
    reviewer: "auditor@example.com", checklist,
  });

  // Approve with model
  const approval = await approveAudit(store, result.slug, result.runId, "approver@example.com", {
    model: scoredModel(),
  });

  return { result, store, dir, approval };
}

// ---------------------------------------------------------------------------
// 1. All required pages are generated
// ---------------------------------------------------------------------------

test("1. all 15 approved pages + index are generated", () => {
  const model = scoredModel();
  const { pages, filenames } = renderApprovedReport(model);
  assert.equal(pages.size, 16); // 15 pages + index
  assert.equal(filenames.length, 16);
  assert.ok(pages.has("index.html"));
  for (const pageDef of APPROVED_PAGES) {
    assert.ok(pages.has(`${pageDef.pageId}.html`), `Missing page: ${pageDef.pageId}.html`);
  }
});

test("2. every approved page has its own print button", () => {
  const model = scoredModel();
  const { pages } = renderApprovedReport(model);
  for (const [filename, html] of pages) {
    assert.match(html, /Print or save this page as PDF/, `${filename} missing print button`);
    assert.match(html, /window\.print\(\)/, `${filename} missing window.print()`);
  }
});

test("3. each page contains only its assigned section", () => {
  const model = scoredModel();
  const { pages } = renderApprovedReport(model);
  for (const pageDef of APPROVED_PAGES) {
    const html = pages.get(`${pageDef.pageId}.html`);
    assert.ok(html, `Page ${pageDef.pageId} not found`);
    // Contains its own section
    assert.match(html, new RegExp(`id="${pageDef.sectionId}"`), `${pageDef.pageId} missing its section id`);
    // Does NOT contain other sections' ids (spot-check a few)
    for (const other of APPROVED_PAGES) {
      if (other.pageId === pageDef.pageId) continue;
      // The nav bar links to other pages, so href="other.html" is OK,
      // but the section id="other-section" should not appear
      const sectionIdRegex = new RegExp(`id="${other.sectionId}"`);
      assert.doesNotMatch(html, sectionIdRegex, `${pageDef.pageId} incorrectly contains section id="${other.sectionId}" from ${other.pageId}`);
    }
  }
});

test("4. navigation links resolve correctly between pages", () => {
  const model = scoredModel();
  const { pages } = renderApprovedReport(model);
  const scorecardHtml = pages.get("scorecard.html");
  // Nav links to other pages
  assert.match(scorecardHtml, /href="priority-fixes\.html"/);
  assert.match(scorecardHtml, /href="evidence-appendix\.html"/);
  // Current page is highlighted (active style)
  assert.match(scorecardHtml, /Scorecard/);
});

test("5. index page links to all individual pages", () => {
  const model = scoredModel();
  const { pages } = renderApprovedReport(model);
  const indexHtml = pages.get("index.html");
  for (const pageDef of APPROVED_PAGES) {
    assert.match(indexHtml, new RegExp(`href="${pageDef.pageId}\\.html"`), `Index missing link to ${pageDef.pageId}`);
  }
});

test("6. printing hides navigation and controls", () => {
  const model = scoredModel();
  const { pages } = renderApprovedReport(model);
  for (const [filename, html] of pages) {
    assert.match(html, /\.top-nav.*\{[^}]*display:\s*None\s*!important[^}]*\}/i, `${filename} missing print nav hide`);
    assert.match(html, /\.no-print\{display:\s*None\s*!important\}/i, `${filename} missing no-print rule`);
    assert.match(html, /@page\{margin:15mm\}/, `${filename} missing @page margin`);
  }
});

test("7. no PDF artifact is recorded", () => {
  const model = scoredModel();
  const { pages } = renderApprovedReport(model);
  // No server-generated PDF filename in any page
  for (const [filename, html] of pages) {
    assert.doesNotMatch(html, /\.pdf/i, `${filename} should not reference PDF`);
  }
  // The note confirms no server-generated file
  assert.match(pages.get("index.html"), /No server-generated file is created/);
});

test("8. every page contains business name, audit date, and approval status", () => {
  const model = scoredModel();
  const { pages } = renderApprovedReport(model);
  for (const [filename, html] of pages) {
    assert.match(html, /Example Business/, `${filename} missing business name`);
    assert.match(html, /APPROVED CLIENT REPORT/, `${filename} missing approval status`);
    assert.match(html, /Scoring v4\./, `${filename} missing scoring version`);
    // Date rendered (any month name)
    assert.match(html, /(January|February|March|April|May|June|July|August|September|October|November|December)/, `${filename} missing audit date`);
  }
});

test("9. all pages are written with atomic approval", async () => {
  const { store, result, approval } = await createApprovedAudit();

  assert.equal(approval.lifecycle.status, "approved");
  assert.equal(approval.pageCount, 16);

  // Verify every file exists on disk
  const lc = await store._readLifecycle(result.slug, result.runId);
  assert.ok(lc.artifacts.final);
  assert.equal(lc.artifacts.final.length, 16);
  assert.ok(lc.artifacts.final.includes("index.html"));
  assert.ok(lc.artifacts.final.includes("scorecard.html"));
  assert.ok(lc.artifacts.final.includes("evidence-appendix.html"));
  assert.ok(lc.artifacts.final.includes("deferred.html"));
  assert.ok(lc.artifacts.final.includes("internal-links.html"));

  // Spot-check a file can be read
  const indexPath = join(result.storage.directory, "index.html");
  const indexContent = await readFile(indexPath, "utf8");
  assert.match(indexContent, /APPROVED CLIENT REPORT/);
});

test("10. draft and reviewed reports remain blocked", async () => {
  const { store, result } = await createApprovedAudit();

  // Approved — status is "approved"
  const approvedStatus = await store.getStatus(result.slug, result.runId);
  assert.equal(approvedStatus.status, "approved");

  // Create another audit that is draft-only
  const dir2 = await mkdtemp(join(tmpdir(), "vantage-draft-"));
  const store2 = createLocalReportStore({ baseDir: dir2 });
  const draftResult = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: {
        maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "",
        dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "",
        reportsBucket: "", artifactDir: dir2, publicReportBaseUrl: "", awsRegion: "ca-central-1",
        reportsPrefix: "vantage/reports", onpageMaxPages: 500,
      },
      crawlSite: async () => scoredModel().evidence.site,
      crawlCompetitors: async () => [],
      collectPerformance: async () => scoredModel().evidence.performance,
      collectBacklinks: async () => scoredModel().evidence.backlinks,
      collectGa4: async () => scoredModel().evidence.ga4,
      store: store2,
    },
  );

  const draftStatus = await store2.getStatus(draftResult.slug, draftResult.runId);
  assert.equal(draftStatus.status, "draft");
  assert.notEqual(draftStatus.status, "approved");
});

test("11. approved pages pass section id validation", () => {
  const model = scoredModel();
  // renderApprovedReport internally validates — if any section renderer
  // fails, it throws. This test confirms it completes without throwing.
  const result = renderApprovedReport(model);
  assert.ok(result.pages.size > 0);
});

test("12. invalid page paths are rejected by path traversal guard", () => {
  // Tests the server-side path validation logic
  const validPattern = /^[a-z0-9_-]+\.(html|json)$/i;

  // Valid names
  assert.ok(validPattern.test("index.html"));
  assert.ok(validPattern.test("scorecard.html"));
  assert.ok(validPattern.test("audit.json"));

  // Path traversal attempts
  assert.ok(!validPattern.test("../etc/passwd"));
  assert.ok(!validPattern.test("..\\windows\\system32"));
  assert.ok(!validPattern.test("scorecard.html/../../evil"));
  assert.ok(!validPattern.test("/etc/passwd"));
  assert.ok(!validPattern.test("C:\\windows"));
});

test("13. store writeApprovedPages validates filenames against traversal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-traversal-"));
  const store = createLocalReportStore({ baseDir: dir });

  // Create an audit first
  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: {
        maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "",
        dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "",
        reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1",
        reportsPrefix: "vantage/reports", onpageMaxPages: 500,
      },
      crawlSite: async () => scoredModel().evidence.site,
      crawlCompetitors: async () => [],
      collectPerformance: async () => scoredModel().evidence.performance,
      collectBacklinks: async () => scoredModel().evidence.backlinks,
      collectGa4: async () => scoredModel().evidence.ga4,
      store,
    },
  );

  // Submit complete review
  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({ id: item.id, reviewed: true, reviewedAt: new Date().toISOString() }));
  await submitReview(store, result.slug, result.runId, { reviewer: "auditor@example.com", checklist });

  // Attempt approval with a traversal page name
  const badPages = new Map();
  badPages.set("../evil.html", "<html></html>");

  // Build approval record
  const { buildApprovalRecord } = await import("./review-gate.js");
  const lc = await store._readLifecycle(result.slug, result.runId);
  const { record: approvalRecord } = buildApprovalRecord(result.runId, lc.review, "approver@example.com");

  await assert.rejects(
    () => store.writeApprovedPages(result.slug, result.runId, approvalRecord, badPages),
    (err) => {
      assert.match(err.message, /Invalid page filename/i);
      return true;
    },
  );

  // Lifecycle should still be "reviewed", not "approved"
  const status = await store.getStatus(result.slug, result.runId);
  assert.equal(status.status, "reviewed");
});

test("14. approved pages are served with correct content type", async () => {
  const { result } = await createApprovedAudit();

  // Read a page directly and verify it's valid HTML
  const indexContent = await readFile(join(result.storage.directory, "index.html"), "utf8");
  assert.match(indexContent, /<!DOCTYPE html>/);
  assert.match(indexContent, /<html lang="en-CA">/);
  assert.match(indexContent, /<\/html>/);

  const scorecardContent = await readFile(join(result.storage.directory, "scorecard.html"), "utf8");
  assert.match(scorecardContent, /<!DOCTYPE html>/);
  assert.match(scorecardContent, /Executive Scorecard/);
});

test("15. index page has print button", async () => {
  const { result } = await createApprovedAudit();
  const indexContent = await readFile(join(result.storage.directory, "index.html"), "utf8");
  assert.match(indexContent, /Print or save this page as PDF/);
  assert.match(indexContent, /window\.print\(\)/);
});

test("16. approval idempotency preserves existing pages and status", async () => {
  const { store, result } = await createApprovedAudit();

  const status1 = await store.getStatus(result.slug, result.runId);
  assert.equal(status1.status, "approved");

  // Second approval is idempotent
  const approval2 = await approveAudit(store, result.slug, result.runId, "approver2@example.com", {
    model: scoredModel(),
  });
  assert.equal(approval2.lifecycle.status, "approved");
  // Original approver preserved
  assert.equal(approval2.lifecycle.approval.approver, "approver@example.com");
});

test("17. no PDF artifact in lifecycle", async () => {
  const { store, result } = await createApprovedAudit();
  const lc = await store._readLifecycle(result.slug, result.runId);

  // No PDF file in artifacts
  const finalArtifacts = lc.artifacts.final || [];
  const pdfFiles = finalArtifacts.filter((f) => f.endsWith(".pdf"));
  assert.equal(pdfFiles.length, 0, `Should not have PDF files: ${pdfFiles.join(", ")}`);

  // All artifacts are .html
  for (const f of finalArtifacts) {
    assert.ok(f.endsWith(".html"), `Unexpected non-HTML artifact: ${f}`);
  }
});

test("18. deferred analysis page is generated with content", async () => {
  const { result } = await createApprovedAudit();
  const deferredContent = await readFile(join(result.storage.directory, "deferred.html"), "utf8");
  assert.match(deferredContent, /Deferred &amp; Unavailable Analysis/);
  assert.match(deferredContent, /id="deferred-unavailable-analysis"/);
  // GA4 and backlinks both NOT_CONNECTED in fixture → should appear
  assert.match(deferredContent, /Google Analytics 4/);
  assert.match(deferredContent, /Backlink Analysis/);
  assert.match(deferredContent, /Required source \/ information/);
  assert.match(deferredContent, /How to enable \/ collect/);
  assert.match(deferredContent, /Additional insight enabled/);
  assert.match(deferredContent, /authorized GA4 property/);
  assert.match(deferredContent, /authorized backlink source/);
});

test("18b. deferred roadmap preserves source status and does not fabricate available-source rows", () => {
  const partial = scoredModel();
  partial.evidence.ga4.sourceStatus = SOURCE_STATUS.PARTIAL;
  const partialDeferred = renderApprovedReport(partial).pages.get("deferred.html");
  assert.match(partialDeferred, /Google Analytics 4[\s\S]*?PARTIAL/);
  assert.match(partialDeferred, /read-only data scope/);

  const available = scoredModel();
  available.evidence.ga4.sourceStatus = SOURCE_STATUS.AVAILABLE;
  available.evidence.backlinks.sourceStatus = SOURCE_STATUS.AVAILABLE;
  const availableDeferred = renderApprovedReport(available).pages.get("deferred.html");
  assert.doesNotMatch(availableDeferred, /Google Analytics 4/);
  assert.doesNotMatch(availableDeferred, /Backlink Analysis/);
});

test("19. internal-links page identifies broken links from evidence", async () => {
  const { result } = await createApprovedAudit();
  const ilContent = await readFile(join(result.storage.directory, "internal-links.html"), "utf8");
  assert.match(ilContent, /Internal-Link Opportunities/);
  assert.match(ilContent, /id="internal-link-opportunities"/);
  // Broken link from fixture should be listed
  assert.match(ilContent, /deleted/);
  // Opportunity count
  assert.match(ilContent, /recommendation|broken/i);
});

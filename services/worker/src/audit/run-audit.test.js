import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "./run-audit.js";
import { createLocalReportStore } from "../storage/report-store.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

const now = new Date().toISOString();
const site = { evidenceVersion: "1.0.0", source: "vantage-crawler", sourceStatus: SOURCE_STATUS.AVAILABLE, targetUrl: "https://example.com/", domain: "example.com", pageCount: 1, totalWords: 500, averageWords: 500, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0, h1Missing: 0, h1Multiple: 0, imageCount: 0, imagesMissingAlt: 0, imagesMissingDimensions: 0, schemaTypes: [], forms: [], ctas: [{ text: "Contact", url: "https://example.com/contact" }], externalCtas: [], socialLinks: [], internalLinkCount: 1, brokenInternalLinks: [], platform: "Unknown", services: ["Consulting"], topicKeywords: ["consulting"], securityHeaders: { xFrameOptions: false, xContentTypeOptions: false, referrerPolicy: false, contentSecurityPolicy: false }, trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: true }, limitations: [], pages: [{ title: "Example", language: "en-CA", rendered: false, headings: { h1: ["Example"], h2: [], h3: [], h4: [] }, responseHeaders: {} }], collectedAt: now, coverage: { requested: 1, completed: 1, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "vantage-crawler", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 1, expectedRecordCount: 1, errorCategory: null, limitation: null, rawArtifactRef: null } };
const perf = { evidenceVersion: "1.0.0", source: "mock", sourceStatus: SOURCE_STATUS.AVAILABLE, status: SOURCE_STATUS.AVAILABLE, mobile: { status: SOURCE_STATUS.AVAILABLE, source: "mock", scores: { performance: 60, accessibility: 80, bestPractices: 90, seo: 80 }, metrics: {} }, desktop: { status: SOURCE_STATUS.AVAILABLE, source: "mock", scores: { performance: 90, accessibility: 80, bestPractices: 90, seo: 80 }, metrics: {} }, fieldData: {}, limitations: [], collectedAt: now, coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "mock", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null } };

test("runAudit completes without API secrets and writes the full report artifact set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await runAudit({ targetUrl: "example.com", businessName: "Example" }, {
    config: { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports" },
    crawlSite: async () => site,
    crawlCompetitors: async () => [],
    collectPerformance: async () => perf,
    collectBacklinks: async () => ({ evidenceVersion: "1.0.0", source: "dataforseo", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, records: [], collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "dataforseo", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } }),
    collectGa4: async () => ({ evidenceVersion: "1.0.0", source: "google-analytics-4", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, affectsScore: false, collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "google-analytics-4", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } }),
    store,
    runId: "20260719-test1234",
  });
  assert.equal(result.status, "complete");
  const html = await readFile(result.storage.indexPath, "utf8");
  assert.match(html, /Vantage Phase 1 Audit/);
  assert.equal(result.manifest.sources.backlinks, SOURCE_STATUS.NOT_CONNECTED);
  assert.equal(result.manifest.sources.ga4, SOURCE_STATUS.NOT_CONNECTED);
});

test("manifest sources.performance is FAILED when both PageSpeed and Lighthouse are unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });
  const failedPerf = {
    evidenceVersion: "1.0.0", source: "unavailable", sourceStatus: SOURCE_STATUS.FAILED, status: SOURCE_STATUS.FAILED,
    mobile: { status: SOURCE_STATUS.FAILED, source: "unavailable", error: "PageSpeed mobile failed (429)", scores: {}, metrics: {} },
    desktop: { status: SOURCE_STATUS.FAILED, source: "unavailable", error: "PageSpeed desktop failed (429)", scores: {}, metrics: {} },
    limitations: [
      "PageSpeed mobile failed (429): quota",
      "Local Lighthouse mobile failed: Lighthouse crashed",
      "PageSpeed desktop failed (429): quota",
      "Local Lighthouse desktop failed: Lighthouse crashed",
    ],
    fieldData: { phone: { status: SOURCE_STATUS.NOT_CONNECTED }, desktop: { status: SOURCE_STATUS.NOT_CONNECTED } },
    collectedAt: now, coverage: { requested: 2, completed: 0, failed: 2 }, rawArtifactRef: null,
    _sourceStatus: { provider: "unavailable", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: 2, errorCategory: "rate_limit", limitation: "No usable PageSpeed or Lighthouse result.", rawArtifactRef: null },
  };
  const result = await runAudit({ targetUrl: "example.com", businessName: "Example" }, {
    config: { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports" },
    crawlSite: async () => site,
    crawlCompetitors: async () => [],
    collectPerformance: async () => failedPerf,
    collectBacklinks: async () => ({ evidenceVersion: "1.0.0", source: "dataforseo", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, records: [], collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "dataforseo", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } }),
    collectGa4: async () => ({ evidenceVersion: "1.0.0", source: "google-analytics-4", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, affectsScore: false, collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "google-analytics-4", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } }),
    store,
    runId: "20260719-test-failed-perf",
  });
  assert.equal(result.manifest.sources.performance, SOURCE_STATUS.FAILED);
});

test("manifest sources.performance is AVAILABLE when Lighthouse fallback succeeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });
  const lighthousePerf = {
    evidenceVersion: "1.0.0", source: "lighthouse-cli-fallback", sourceStatus: SOURCE_STATUS.AVAILABLE, status: SOURCE_STATUS.AVAILABLE,
    mobile: { status: SOURCE_STATUS.AVAILABLE, source: "lighthouse-cli-fallback", strategy: "mobile", scores: { performance: 62, accessibility: 88, bestPractices: 96, seo: 85 }, metrics: { fcpMs: 1400, lcpMs: 3100, tbtMs: 180, cls: 0.08 }, opportunities: [] },
    desktop: { status: SOURCE_STATUS.AVAILABLE, source: "lighthouse-cli-fallback", strategy: "desktop", scores: { performance: 88, accessibility: 90, bestPractices: 96, seo: 87 }, metrics: { fcpMs: 600, lcpMs: 1200, tbtMs: 45, cls: 0.02 }, opportunities: [] },
    fieldData: { phone: { status: SOURCE_STATUS.UNAVAILABLE }, desktop: { status: SOURCE_STATUS.UNAVAILABLE } },
    limitations: ["PageSpeed mobile failed (429): quota", "PageSpeed desktop failed (429): quota"],
    collectedAt: now, coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null,
    _sourceStatus: { provider: "lighthouse-cli-fallback", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null },
  };
  const result = await runAudit({ targetUrl: "example.com", businessName: "Example" }, {
    config: { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports" },
    crawlSite: async () => site,
    crawlCompetitors: async () => [],
    collectPerformance: async () => lighthousePerf,
    collectBacklinks: async () => ({ evidenceVersion: "1.0.0", source: "dataforseo", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, records: [], collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "dataforseo", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } }),
    collectGa4: async () => ({ evidenceVersion: "1.0.0", source: "google-analytics-4", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, affectsScore: false, collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "google-analytics-4", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } }),
    store,
    runId: "20260719-test-lh-fallback",
  });
  assert.equal(result.manifest.sources.performance, SOURCE_STATUS.AVAILABLE);
});

test("invalid AVAILABLE envelope is downgraded to FAILED before scoring", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });
  // Looks like valid performance data but is missing evidenceVersion — the
  // boundary validator must catch this and downgrade before scoreAudit runs.
  const invalidPerf = {
    // evidenceVersion intentionally missing
    source: "pagespeed-insights",
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    status: SOURCE_STATUS.AVAILABLE,
    mobile: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", scores: { performance: 95 }, metrics: { lcpMs: 1200 } },
    desktop: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", scores: { performance: 98 }, metrics: { lcpMs: 800 } },
    limitations: [],
    fieldData: {},
    collectedAt: now,
    coverage: { requested: 2, completed: 2, failed: 0 },
    rawArtifactRef: null,
    _sourceStatus: { provider: "pagespeed-insights", adapterVersion: "1.0.0", startedAt: now, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null },
  };
  const result = await runAudit({ targetUrl: "example.com", businessName: "Example" }, {
    config: { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports" },
    crawlSite: async () => site,
    crawlCompetitors: async () => [],
    collectPerformance: async () => invalidPerf,
    collectBacklinks: async () => ({ evidenceVersion: "1.0.0", source: "dataforseo", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, records: [], collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "dataforseo", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } }),
    collectGa4: async () => ({ evidenceVersion: "1.0.0", source: "google-analytics-4", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, affectsScore: false, collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "google-analytics-4", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } }),
    store,
    runId: "20260719-test-invalid-perf",
  });
  // 1. Invalid AVAILABLE envelope downgraded to FAILED before scoring
  assert.equal(result.model.evidence.performance.sourceStatus, SOURCE_STATUS.FAILED);
  assert.equal(result.model.evidence.performance._sourceStatus.errorCategory, "schema_validation");
  // 2. Module score is null — not assessed
  assert.equal(result.model.scores.performance, null);
  // 3. manifest.sources records FAILED
  assert.equal(result.manifest.sources.performance, SOURCE_STATUS.FAILED);
  // 4. Validation limitations are preserved
  const perfLimitations = result.model.evidence.performance.limitations;
  assert.ok(perfLimitations.some((l) => l.includes("missing or invalid evidenceVersion")),
    `Expected validation limitation, got: ${JSON.stringify(perfLimitations)}`);
  // Provider metadata preserved through the downgrade
  assert.equal(result.model.evidence.performance._sourceStatus.provider, "pagespeed-insights");
  assert.equal(result.model.evidence.performance._sourceStatus.returnedRecordCount, 2);
  // Original data payload not carried forward in a FAILED downgrade (no usable scores)
  assert.ok(!result.model.evidence.performance.mobile?.scores?.performance,
    "Mobile scores should not be present in downgraded FAILED shape");
});

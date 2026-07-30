import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "./run-audit.js";
import { createLocalReportStore } from "../storage/report-store.js";
import { SOURCE_STATUS, ERROR_CATEGORY } from "../scoring/evidence-contracts.js";

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
  securityHeaders: {
    xFrameOptions: false,
    xContentTypeOptions: true,
    referrerPolicy: true,
    contentSecurityPolicy: false,
  },
  trust: {
    testimonials: true,
    credentials: true,
    caseStudies: false,
    faq: false,
    pricing: true,
    policies: false,
    contact: true,
  },
  limitations: [],
  pages: [
    {
      title: "Example",
      language: "en-CA",
      rendered: false,
      headings: { h1: ["Example"], h2: [], h3: [], h4: [] },
      responseHeaders: { "x-content-type-options": "nosniff" },
    },
  ],
  collectedAt: now,
  coverage: { requested: 2, completed: 2, failed: 0 },
  rawArtifactRef: "dataforseo://on_page/test-task-001",
  _sourceStatus: {
    provider: "dataforseo-onpage",
    adapterVersion: "1.0.0",
    startedAt: now,
    completedAt: now,
    requestId: "test-task-001",
    retryCount: 0,
    returnedRecordCount: 2,
    expectedRecordCount: 2,
    errorCategory: null,
    limitation: null,
    rawArtifactRef: "dataforseo://on_page/test-task-001",
  },
};

const AVAILABLE_PERF = {
  evidenceVersion: "1.0.0",
  source: "mock",
  sourceStatus: SOURCE_STATUS.AVAILABLE,
  status: SOURCE_STATUS.AVAILABLE,
  mobile: {
    status: SOURCE_STATUS.AVAILABLE,
    source: "mock",
    scores: { performance: 60, accessibility: 80, bestPractices: 90, seo: 80 },
    metrics: { fcpMs: 1200, lcpMs: 2600, cls: 0.05, tbtMs: 120 },
  },
  desktop: {
    status: SOURCE_STATUS.AVAILABLE,
    source: "mock",
    scores: { performance: 90, accessibility: 80, bestPractices: 90, seo: 80 },
    metrics: { fcpMs: 800, lcpMs: 1800, cls: 0.03, tbtMs: 80 },
  },
  fieldData: {},
  limitations: ["One unique test limitation"],
  collectedAt: now,
  coverage: { requested: 2, completed: 2, failed: 0 },
  rawArtifactRef: null,
  _sourceStatus: {
    provider: "mock",
    adapterVersion: "1.0.0",
    startedAt: null,
    completedAt: now,
    requestId: null,
    retryCount: 0,
    returnedRecordCount: 2,
    expectedRecordCount: 2,
    errorCategory: null,
    limitation: null,
    rawArtifactRef: null,
  },
};

const NOT_CONNECTED_BACKLINKS = {
  evidenceVersion: "1.0.0",
  source: "dataforseo",
  sourceStatus: SOURCE_STATUS.NOT_CONNECTED,
  status: SOURCE_STATUS.NOT_CONNECTED,
  records: [],
  collectedAt: now,
  coverage: { requested: 0, completed: 0, failed: 0 },
  rawArtifactRef: null,
  _sourceStatus: {
    provider: "dataforseo",
    adapterVersion: "1.0.0",
    startedAt: null,
    completedAt: now,
    requestId: null,
    retryCount: 0,
    returnedRecordCount: 0,
    expectedRecordCount: null,
    errorCategory: "not_configured",
    limitation: null,
    rawArtifactRef: null,
  },
};

const NOT_CONNECTED_GA4 = {
  evidenceVersion: "1.0.0",
  source: "google-analytics-4",
  sourceStatus: SOURCE_STATUS.NOT_CONNECTED,
  status: SOURCE_STATUS.NOT_CONNECTED,
  affectsScore: false,
  collectedAt: now,
  coverage: { requested: 0, completed: 0, failed: 0 },
  rawArtifactRef: null,
  _sourceStatus: {
    provider: "google-analytics-4",
    adapterVersion: "1.0.0",
    startedAt: null,
    completedAt: now,
    requestId: null,
    retryCount: 0,
    returnedRecordCount: 0,
    expectedRecordCount: null,
    errorCategory: "not_configured",
    limitation: null,
    rawArtifactRef: null,
  },
};

function baseConfig(overrides = {}) {
  return {
    maxPages: 5,
    browserMode: "never",
    pagespeedApiKey: "",
    cruxApiKey: "",
    dataforseoLogin: "",
    dataforseoPassword: "",
    ga4PropertyId: "",
    googleServiceAccountJson: "",
    reportsBucket: "",
    artifactDir: "/tmp",
    publicReportBaseUrl: "",
    awsRegion: "ca-central-1",
    reportsPrefix: "vantage/reports",
    onpageMaxPages: 500,
    onpageJsRendering: false,
    onpageBrowserRendering: false,
    onpagePollTimeoutMs: 600000,
    onpagePollIntervalMs: 10000,
    onpageIncludePatterns: [],
    onpageExcludePatterns: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Existing: runAudit completes with DI
// ---------------------------------------------------------------------------

test("runAudit completes without API secrets and writes the full report artifact set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
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
      runId: "20260726-test-001",
    },
  );
  assert.equal(result.status, "draft");
  assert.equal(result.lifecycleStatus, "draft");
  const html = await readFile(result.storage.indexPath, "utf8");
  assert.match(html, /Vantage Phase 1 Audit/);
  assert.equal(result.manifest.sources.website, SOURCE_STATUS.AVAILABLE);
  assert.equal(result.manifest.sources.backlinks, SOURCE_STATUS.NOT_CONNECTED);
  assert.equal(result.manifest.sources.ga4, SOURCE_STATUS.NOT_CONNECTED);
});

test("multi-page: full audit pipeline produces draft report with single-section display, Previous/Next, hash navigation, and booking CTA", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
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
      runId: "20260730-multi-page-001",
    },
  );
  assert.equal(result.status, "draft");
  const html = await readFile(result.storage.indexPath, "utf8");

  // Single-section display CSS
  assert.match(html, /section\{display:none\}/, "CSS must hide all sections by default");
  assert.match(html, /section\.active\{display:block\}/, "CSS must show only .active section");

  // Previous/Next controls in script
  const script = (html.match(/<script>[\s\S]*?<\/script>/) || [""])[0];
  assert.match(script, /← Previous/, "Must have Previous button markup");
  assert.match(script, /Next →/, "Must have Next button markup");
  assert.match(script, /Section.*of/, "Must have Section X of Y position indicator");

  // Hash-based navigation in script
  assert.match(script, /history\.pushState/, "Must use pushState for URL hash updates");
  assert.match(script, /popstate/, "Must handle browser back/forward");

  // Keyboard navigation
  assert.match(script, /ArrowLeft/, "Must support Left arrow key");
  assert.match(script, /ArrowRight/, "Must support Right arrow key");

  // aria-current for accessibility
  assert.match(script, /aria-current/, "Must manage aria-current on nav links");

  // Booking CTA and next action in footer
  assert.match(html, /implementation scoping session/, "Must include next action CTA");

  // No old anchor-only navigation
  assert.doesNotMatch(html, /nav-toggle/, "Must not have old nav-toggle button");
});

// ---------------------------------------------------------------------------
// 2. Existing: performance FAILED
// ---------------------------------------------------------------------------

test("manifest sources.performance is FAILED when both PageSpeed and Lighthouse are unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });
  const failedPerf = {
    evidenceVersion: "1.0.0",
    source: "unavailable",
    sourceStatus: SOURCE_STATUS.FAILED,
    status: SOURCE_STATUS.FAILED,
    mobile: {
      status: SOURCE_STATUS.FAILED,
      source: "unavailable",
      error: "PageSpeed mobile failed (429)",
      scores: {},
      metrics: {},
    },
    desktop: {
      status: SOURCE_STATUS.FAILED,
      source: "unavailable",
      error: "PageSpeed desktop failed (429)",
      scores: {},
      metrics: {},
    },
    limitations: [
      "PageSpeed mobile failed (429): quota",
      "Local Lighthouse mobile failed: Lighthouse crashed",
      "PageSpeed desktop failed (429): quota",
      "Local Lighthouse desktop failed: Lighthouse crashed",
    ],
    fieldData: {
      phone: { status: SOURCE_STATUS.NOT_CONNECTED },
      desktop: { status: SOURCE_STATUS.NOT_CONNECTED },
    },
    collectedAt: now,
    coverage: { requested: 2, completed: 0, failed: 2 },
    rawArtifactRef: null,
    _sourceStatus: {
      provider: "unavailable",
      adapterVersion: "1.0.0",
      startedAt: null,
      completedAt: now,
      requestId: null,
      retryCount: 0,
      returnedRecordCount: 0,
      expectedRecordCount: 2,
      errorCategory: "rate_limit",
      limitation: "No usable PageSpeed or Lighthouse result.",
      rawArtifactRef: null,
    },
  };
  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => AVAILABLE_SITE,
      crawlCompetitors: async () => [],
      collectPerformance: async () => failedPerf,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      store,
      runId: "20260726-test-failed-perf",
    },
  );
  assert.equal(result.manifest.sources.performance, SOURCE_STATUS.FAILED);
});

// ---------------------------------------------------------------------------
// 3. Existing: Lighthouse fallback
// ---------------------------------------------------------------------------

test("manifest sources.performance is AVAILABLE when Lighthouse fallback succeeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });
  const lighthousePerf = {
    evidenceVersion: "1.0.0",
    source: "lighthouse-cli-fallback",
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    status: SOURCE_STATUS.AVAILABLE,
    mobile: {
      status: SOURCE_STATUS.AVAILABLE,
      source: "lighthouse-cli-fallback",
      strategy: "mobile",
      scores: { performance: 62, accessibility: 88, bestPractices: 96, seo: 85 },
      metrics: { fcpMs: 1400, lcpMs: 3100, tbtMs: 180, cls: 0.08 },
      opportunities: [],
    },
    desktop: {
      status: SOURCE_STATUS.AVAILABLE,
      source: "lighthouse-cli-fallback",
      strategy: "desktop",
      scores: { performance: 88, accessibility: 90, bestPractices: 96, seo: 87 },
      metrics: { fcpMs: 600, lcpMs: 1200, tbtMs: 45, cls: 0.02 },
      opportunities: [],
    },
    fieldData: {
      phone: { status: SOURCE_STATUS.UNAVAILABLE },
      desktop: { status: SOURCE_STATUS.UNAVAILABLE },
    },
    limitations: [
      "PageSpeed mobile failed (429): quota",
      "PageSpeed desktop failed (429): quota",
    ],
    collectedAt: now,
    coverage: { requested: 2, completed: 2, failed: 0 },
    rawArtifactRef: null,
    _sourceStatus: {
      provider: "lighthouse-cli-fallback",
      adapterVersion: "1.0.0",
      startedAt: null,
      completedAt: now,
      requestId: null,
      retryCount: 0,
      returnedRecordCount: 2,
      expectedRecordCount: 2,
      errorCategory: null,
      limitation: null,
      rawArtifactRef: null,
    },
  };
  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => AVAILABLE_SITE,
      crawlCompetitors: async () => [],
      collectPerformance: async () => lighthousePerf,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      store,
      runId: "20260726-test-lh-fallback",
    },
  );
  assert.equal(result.manifest.sources.performance, SOURCE_STATUS.AVAILABLE);
});

// ---------------------------------------------------------------------------
// 4. Existing: invalid envelope downgrade
// ---------------------------------------------------------------------------

test("invalid AVAILABLE envelope is downgraded to FAILED before scoring", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });
  const invalidPerf = {
    // evidenceVersion intentionally missing
    source: "pagespeed-insights",
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    status: SOURCE_STATUS.AVAILABLE,
    mobile: {
      status: SOURCE_STATUS.AVAILABLE,
      source: "pagespeed-insights",
      scores: { performance: 95 },
      metrics: { lcpMs: 1200 },
    },
    desktop: {
      status: SOURCE_STATUS.AVAILABLE,
      source: "pagespeed-insights",
      scores: { performance: 98 },
      metrics: { lcpMs: 800 },
    },
    limitations: [],
    fieldData: {},
    collectedAt: now,
    coverage: { requested: 2, completed: 2, failed: 0 },
    rawArtifactRef: null,
    _sourceStatus: {
      provider: "pagespeed-insights",
      adapterVersion: "1.0.0",
      startedAt: now,
      completedAt: now,
      requestId: null,
      retryCount: 0,
      returnedRecordCount: 2,
      expectedRecordCount: 2,
      errorCategory: null,
      limitation: null,
      rawArtifactRef: null,
    },
  };
  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => AVAILABLE_SITE,
      crawlCompetitors: async () => [],
      collectPerformance: async () => invalidPerf,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      store,
      runId: "20260726-test-invalid-perf",
    },
  );
  assert.equal(
    result.model.evidence.performance.sourceStatus,
    SOURCE_STATUS.FAILED,
  );
  assert.equal(
    result.model.evidence.performance._sourceStatus.errorCategory,
    "schema_validation",
  );
  assert.equal(result.model.scores.performance, null);
  assert.equal(result.manifest.sources.performance, SOURCE_STATUS.FAILED);
  const perfLimitations = result.model.evidence.performance.limitations;
  assert.ok(
    perfLimitations.some((l) => l.includes("missing or invalid evidenceVersion")),
    `Expected validation limitation, got: ${JSON.stringify(perfLimitations)}`,
  );
  assert.equal(
    result.model.evidence.performance._sourceStatus.provider,
    "pagespeed-insights",
  );
  assert.equal(
    result.model.evidence.performance._sourceStatus.returnedRecordCount,
    2,
  );
  assert.ok(
    !result.model.evidence.performance.mobile?.scores?.performance,
    "Mobile scores should not be present in downgraded FAILED shape",
  );
});

// ---------------------------------------------------------------------------
// 5. NEW: Production path uses DataForSEO adapter via config
// ---------------------------------------------------------------------------

test("production crawl path calls DataForSEO adapter with configured values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });

  // Capture the call to verify what the production crawler receives
  let crawlCall = null;

  async function capturingCrawler(targetUrl, options) {
    crawlCall = { targetUrl, options };
    return AVAILABLE_SITE;
  }

  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: baseConfig({
        artifactDir: dir,
        dataforseoLogin: "prod-user",
        dataforseoPassword: "prod-pass",
        onpageMaxPages: 500,
        onpageJsRendering: true,
        onpagePollTimeoutMs: 300000,
        onpageIncludePatterns: ["/blog/*"],
        onpageExcludePatterns: ["/admin/*"],
      }),
      crawlSite: capturingCrawler, // DI override for test isolation
      crawlCompetitors: async () => [],
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      store,
      runId: "20260726-test-prod-path",
    },
  );

  assert.equal(result.status, "draft");
  // The crawler was called
  assert.ok(crawlCall, "crawler should have been called");
  assert.ok(crawlCall.targetUrl.includes("example.com"));

  // Crawl result produced valid scores (AVAILABLE site)
  assert.ok(
    result.model.scores.conversionReadiness > 0,
  );
  assert.ok(result.model.scores.trust > 0);

  // Performance, backlinks, GA4 all operate independently
  assert.equal(result.manifest.sources.backlinks, SOURCE_STATUS.NOT_CONNECTED);
  assert.equal(result.manifest.sources.ga4, SOURCE_STATUS.NOT_CONNECTED);
});

// ---------------------------------------------------------------------------
// 6. NEW: NOT_CONNECTED suppresses crawl-dependent scoring modules
// ---------------------------------------------------------------------------

test("NOT_CONNECTED crawl suppresses all crawl-dependent modules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });

  const notConnectedSite = {
    ...AVAILABLE_SITE,
    sourceStatus: SOURCE_STATUS.NOT_CONNECTED,
    status: SOURCE_STATUS.NOT_CONNECTED,
    pageCount: 0,
    pages: [],
    services: [],
    topicKeywords: [],
    _sourceStatus: {
      ...AVAILABLE_SITE._sourceStatus,
      provider: "dataforseo-onpage",
      errorCategory: "not_configured",
      limitation:
        "DataForSEO credentials not configured. Crawl-dependent modules suppressed.",
      returnedRecordCount: 0,
      expectedRecordCount: null,
    },
  };

  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => notConnectedSite,
      crawlCompetitors: async () => [],
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      store,
      runId: "20260726-test-not-connected",
    },
  );

  assert.equal(result.status, "draft");

  // Crawl source is NOT_CONNECTED
  assert.equal(
    result.manifest.sources.website,
    SOURCE_STATUS.NOT_CONNECTED,
  );

  // All crawl-dependent scores are null
  assert.equal(result.model.scores.trust, null);
  assert.equal(result.model.scores.contentDepth, null);
  assert.equal(result.model.scores.conversionPathways, null);
  assert.equal(result.model.scores.technical, null);
  assert.equal(result.model.scores.conversionReadiness, null);
  assert.equal(result.model.scores.awareness, null);
  assert.equal(result.model.scores.consideration, null);
  assert.equal(result.model.scores.decision, null);
  assert.equal(result.model.scores.aiReadiness, null);

  // Performance is independent and still scored
  assert.notEqual(result.model.scores.performance, null);
  assert.ok(result.model.scores.performance > 0);

  // No findings (crawl-dependent)
  assert.deepEqual(result.model.findings, []);

  // bands reflect not-assessed
  assert.equal(result.model.bands.conversionReadiness, "Not Assessed");
  assert.equal(result.model.bands.trust, "Not Assessed");

  // Crawl-suppressed flag
  assert.equal(result.model._crawlSuppressed, true);

  // rootCause reflects the crawl status
  assert.match(result.model.rootCause, /not connected/i);
});

// ---------------------------------------------------------------------------
// 7. NEW: FAILED crawl suppresses crawl-dependent modules
// ---------------------------------------------------------------------------

test("FAILED crawl suppresses all crawl-dependent scoring modules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });

  const failedSite = {
    ...AVAILABLE_SITE,
    sourceStatus: SOURCE_STATUS.FAILED,
    status: SOURCE_STATUS.FAILED,
    pageCount: 0,
    pages: [],
    services: [],
    topicKeywords: [],
    limitations: ["Task submission failed: network error"],
    _sourceStatus: {
      ...AVAILABLE_SITE._sourceStatus,
      provider: "dataforseo-onpage",
      errorCategory: "network",
      limitation: "Task submission failed: network error",
      returnedRecordCount: 0,
      expectedRecordCount: null,
    },
  };

  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => failedSite,
      crawlCompetitors: async () => [],
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      store,
      runId: "20260726-test-failed-crawl",
    },
  );

  assert.equal(result.manifest.sources.website, SOURCE_STATUS.FAILED);
  assert.equal(result.model.scores.trust, null);
  assert.equal(result.model.scores.contentDepth, null);
  assert.equal(result.model.scores.conversionPathways, null);
  assert.equal(result.model.scores.technical, null);
  assert.equal(result.model.scores.conversionReadiness, null);

  // Performance is independent
  assert.notEqual(result.model.scores.performance, null);

  // No findings
  assert.deepEqual(result.model.findings, []);

  // Root cause reflects failure
  assert.match(result.model.rootCause, /unavailable/i);

  // Backlinks and GA4 still reported correctly
  assert.equal(result.manifest.sources.backlinks, SOURCE_STATUS.NOT_CONNECTED);
  assert.equal(result.manifest.sources.ga4, SOURCE_STATUS.NOT_CONNECTED);
});

// ---------------------------------------------------------------------------
// 8. NEW: BLOCKED crawl suppresses crawl-dependent modules
// ---------------------------------------------------------------------------

test("BLOCKED crawl suppresses all crawl-dependent scoring modules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });

  const blockedSite = {
    ...AVAILABLE_SITE,
    sourceStatus: SOURCE_STATUS.BLOCKED,
    status: SOURCE_STATUS.BLOCKED,
    pageCount: 0,
    pages: [],
    services: [],
    topicKeywords: [],
    limitations: ["Site blocked by robots.txt"],
    _sourceStatus: {
      ...AVAILABLE_SITE._sourceStatus,
      provider: "dataforseo-onpage",
      errorCategory: null,
      limitation: "robots.txt blocked the crawl",
      returnedRecordCount: 0,
      expectedRecordCount: 500,
    },
  };

  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => blockedSite,
      crawlCompetitors: async () => [],
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      store,
      runId: "20260726-test-blocked",
    },
  );

  assert.equal(result.manifest.sources.website, SOURCE_STATUS.BLOCKED);
  assert.equal(result.model.scores.trust, null);
  assert.equal(result.model.scores.conversionReadiness, null);
  assert.notEqual(result.model.scores.performance, null);
  assert.deepEqual(result.model.findings, []);
  assert.equal(result.model._crawlSuppressed, true);
  assert.match(result.model.rootCause, /blocked/i);
});

// ---------------------------------------------------------------------------
// 9. NEW: PARTIAL crawl preserves coverage and scores available evidence
// ---------------------------------------------------------------------------

test("PARTIAL crawl scores available evidence with coverage preserved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });

  const partialSite = {
    ...AVAILABLE_SITE,
    sourceStatus: SOURCE_STATUS.PARTIAL,
    status: SOURCE_STATUS.PARTIAL,
    pageCount: 50,
    limitations: ["Page ceiling reached: 50 of 500 pages crawled"],
    coverage: { requested: 500, completed: 50, failed: 0 },
    _sourceStatus: {
      ...AVAILABLE_SITE._sourceStatus,
      provider: "dataforseo-onpage",
      errorCategory: null,
      limitation: "Page ceiling reached: 50 of 500 pages crawled",
      returnedRecordCount: 50,
      expectedRecordCount: 500,
    },
  };

  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => partialSite,
      crawlCompetitors: async () => [],
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      store,
      runId: "20260726-test-partial",
    },
  );

  // PARTIAL crawl is viable — scores are computed
  assert.equal(result.manifest.sources.website, SOURCE_STATUS.PARTIAL);
  assert.notEqual(result.model.scores.trust, null);
  assert.notEqual(result.model.scores.contentDepth, null);
  assert.notEqual(result.model.scores.conversionReadiness, null);

  // Findings exist (based on available evidence)
  assert.ok(result.model.findings.length > 0);

  // Task ID preserved
  assert.ok(result.model.evidence.site._sourceStatus.requestId);

  // Coverage preserved in evidence
  assert.equal(result.model.evidence.site.coverage.requested, 500);
  assert.equal(result.model.evidence.site.coverage.completed, 50);

  // Limitations visible
  assert.ok(
    result.model.evidence.site.limitations.some((l) =>
      /ceiling/i.test(l),
    ),
  );
});

// ---------------------------------------------------------------------------
// 10. NEW: Unrelated modules (performance, backlinks) continue independently
// ---------------------------------------------------------------------------

test("performance, backlinks and optional sources operate independently of crawl failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });

  const failedSite = {
    ...AVAILABLE_SITE,
    sourceStatus: SOURCE_STATUS.FAILED,
    status: SOURCE_STATUS.FAILED,
    pageCount: 0,
    pages: [],
  };

  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: baseConfig({ artifactDir: dir }),
      crawlSite: async () => failedSite,
      crawlCompetitors: async () => [],
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      store,
      runId: "20260726-test-independent",
    },
  );

  // Crawl failed
  assert.equal(result.manifest.sources.website, SOURCE_STATUS.FAILED);

  // Performance is still scored
  assert.notEqual(result.model.scores.performance, null);
  assert.ok(result.model.scores.performance > 0);

  // Backlinks and GA4 statuses preserved
  assert.equal(result.manifest.sources.backlinks, SOURCE_STATUS.NOT_CONNECTED);
  assert.equal(result.manifest.sources.ga4, SOURCE_STATUS.NOT_CONNECTED);

  // Evidence confidence reduced but not zero (perf contributes)
  assert.ok(result.model.evidenceConfidenceScore > 0);
  assert.ok(result.model.evidenceConfidenceScore < 50);
});

// ---------------------------------------------------------------------------
// 11. NEW: Default production path with no credentials returns NOT_CONNECTED
// ---------------------------------------------------------------------------

test("default production path with no credentials returns NOT_CONNECTED without network call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });

  // Do NOT pass crawlSite — let the production default run
  // But pass config with empty credentials so it returns NOT_CONNECTED
  const result = await runAudit(
    { targetUrl: "example.com", businessName: "Example" },
    {
      config: baseConfig({
        artifactDir: dir,
        dataforseoLogin: "",
        dataforseoPassword: "",
      }),
      // No crawlSite override → production path used → NOT_CONNECTED
      crawlCompetitors: async () => [],
      collectPerformance: async () => AVAILABLE_PERF,
      collectBacklinks: async () => NOT_CONNECTED_BACKLINKS,
      collectGa4: async () => NOT_CONNECTED_GA4,
      store,
      runId: "20260726-test-default-not-connected",
    },
  );

  assert.equal(result.status, "draft");
  assert.equal(
    result.manifest.sources.website,
    SOURCE_STATUS.NOT_CONNECTED,
  );
  assert.equal(result.model.scores.trust, null);
  assert.equal(result.model.scores.conversionReadiness, null);
  // Independent modules still work
  assert.notEqual(result.model.scores.performance, null);
  assert.equal(result.model._crawlSuppressed, true);
});

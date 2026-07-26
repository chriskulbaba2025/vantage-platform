import test from "node:test";
import assert from "node:assert/strict";
import { scoreAudit } from "./vantage-score.js";
import { scorePerformance } from "./score-components.js";
import { renderReport } from "../report/render-report.js";
import { SOURCE_STATUS } from "./evidence-contracts.js";

function evidence(overrides = {}) {
  return {
    site: {
      evidenceVersion: "1.0.0",
      source: "vantage-crawler",
      sourceStatus: SOURCE_STATUS.AVAILABLE,
      targetUrl: "https://example.com/",
      domain: "example.com",
      pageCount: 2,
      totalWords: 800,
      averageWords: 400,
      missingTitles: 0,
      missingDescriptions: 1,
      missingCanonicals: 1,
      h1Missing: 0,
      h1Multiple: 0,
      imageCount: 2,
      imagesMissingAlt: 1,
      imagesMissingDimensions: 1,
      schemaTypes: [],
      forms: [],
      ctas: [
        { text: "Book", url: "https://cal.example/book", kind: "link" },
      ],
      externalCtas: [],
      socialLinks: [],
      internalLinkCount: 2,
      brokenInternalLinks: [],
      platform: "GoDaddy Website Builder",
      services: ["Coaching"],
      topicKeywords: ["stress recovery", "coaching support"],
      securityHeaders: {
        xFrameOptions: false,
        xContentTypeOptions: true,
        referrerPolicy: false,
        contentSecurityPolicy: false,
      },
      trust: {
        testimonials: false,
        credentials: false,
        caseStudies: false,
        faq: false,
        pricing: false,
        policies: false,
        contact: true,
      },
      limitations: [],
      pages: [
        {
          title: "Example",
          language: "en-CA",
          headings: { h1: ["Stress Recovery"], h2: ["Coaching"], h3: [], h4: [] },
          responseHeaders: {},
        },
      ],
      collectedAt: new Date().toISOString(),
      coverage: { requested: 2, completed: 2, failed: 0 },
      rawArtifactRef: null,
      _sourceStatus: {
        provider: "vantage-crawler",
        adapterVersion: "1.0.0",
        startedAt: null,
        completedAt: new Date().toISOString(),
        requestId: null,
        retryCount: 0,
        returnedRecordCount: 2,
        expectedRecordCount: 2,
        errorCategory: null,
        limitation: null,
        rawArtifactRef: null,
      },
    },
    performance: {
      evidenceVersion: "1.0.0",
      source: "test",
      sourceStatus: SOURCE_STATUS.AVAILABLE,
      status: SOURCE_STATUS.AVAILABLE,
      mobile: {
        status: SOURCE_STATUS.AVAILABLE,
        source: "test",
        scores: { performance: 55 },
        metrics: { lcpMs: 5600 },
      },
      desktop: {
        status: SOURCE_STATUS.AVAILABLE,
        source: "test",
        scores: { performance: 96 },
        metrics: { lcpMs: 1000 },
      },
      limitations: [],
      fieldData: {},
      collectedAt: new Date().toISOString(),
      coverage: { requested: 2, completed: 2, failed: 0 },
      rawArtifactRef: null,
      _sourceStatus: {
        provider: "test",
        adapterVersion: "1.0.0",
        startedAt: null,
        completedAt: new Date().toISOString(),
        requestId: null,
        retryCount: 0,
        returnedRecordCount: 2,
        expectedRecordCount: 2,
        errorCategory: null,
        limitation: null,
        rawArtifactRef: null,
      },
    },
    competitors: [],
    backlinks: {
      evidenceVersion: "1.0.0",
      source: "dataforseo",
      sourceStatus: SOURCE_STATUS.NOT_CONNECTED,
      status: SOURCE_STATUS.NOT_CONNECTED,
      records: [],
      collectedAt: new Date().toISOString(),
      coverage: { requested: 0, completed: 0, failed: 0 },
      rawArtifactRef: null,
      _sourceStatus: {
        provider: "dataforseo",
        adapterVersion: "1.0.0",
        startedAt: null,
        completedAt: new Date().toISOString(),
        requestId: null,
        retryCount: 0,
        returnedRecordCount: 0,
        expectedRecordCount: null,
        errorCategory: "not_configured",
        limitation: null,
        rawArtifactRef: null,
      },
    },
    ga4: {
      evidenceVersion: "1.0.0",
      source: "google-analytics-4",
      sourceStatus: SOURCE_STATUS.NOT_CONNECTED,
      status: SOURCE_STATUS.NOT_CONNECTED,
      included: false,
      affectsScore: false,
      collectedAt: new Date().toISOString(),
      coverage: { requested: 0, completed: 0, failed: 0 },
      rawArtifactRef: null,
      _sourceStatus: {
        provider: "google-analytics-4",
        adapterVersion: "1.0.0",
        startedAt: null,
        completedAt: new Date().toISOString(),
        requestId: null,
        retryCount: 0,
        returnedRecordCount: 0,
        expectedRecordCount: null,
        errorCategory: "not_configured",
        limitation: null,
        rawArtifactRef: null,
      },
    },
    ...overrides,
  };
}

function unavailablePerf() {
  return {
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
    collectedAt: new Date().toISOString(),
    coverage: { requested: 2, completed: 0, failed: 2 },
    rawArtifactRef: null,
    _sourceStatus: {
      provider: "unavailable",
      adapterVersion: "1.0.0",
      startedAt: null,
      completedAt: new Date().toISOString(),
      requestId: null,
      retryCount: 0,
      returnedRecordCount: 0,
      expectedRecordCount: 2,
      errorCategory: "rate_limit",
      limitation: "No usable PageSpeed or Lighthouse result.",
      rawArtifactRef: null,
    },
  };
}

function lighthouseFallbackPerf() {
  return {
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
    collectedAt: new Date().toISOString(),
    coverage: { requested: 2, completed: 2, failed: 0 },
    rawArtifactRef: null,
    _sourceStatus: {
      provider: "lighthouse-cli-fallback",
      adapterVersion: "1.0.0",
      startedAt: null,
      completedAt: new Date().toISOString(),
      requestId: null,
      retryCount: 0,
      returnedRecordCount: 2,
      expectedRecordCount: 2,
      errorCategory: null,
      limitation: null,
      rawArtifactRef: null,
    },
  };
}

function failedSite() {
  return {
    evidenceVersion: "1.0.0",
    source: "dataforseo-onpage",
    sourceStatus: SOURCE_STATUS.FAILED,
    status: SOURCE_STATUS.FAILED,
    targetUrl: "https://example.com/",
    domain: "example.com",
    pageCount: 0,
    pages: [],
    totalWords: 0,
    averageWords: 0,
    missingTitles: 0,
    missingDescriptions: 0,
    missingCanonicals: 0,
    h1Missing: 0,
    h1Multiple: 0,
    imageCount: 0,
    imagesMissingAlt: 0,
    imagesMissingDimensions: 0,
    schemaTypes: [],
    forms: [],
    ctas: [],
    externalCtas: [],
    socialLinks: [],
    internalLinkCount: 0,
    brokenInternalLinks: [],
    platform: "Unknown",
    services: [],
    topicKeywords: [],
    trust: {
      testimonials: false,
      credentials: false,
      caseStudies: false,
      faq: false,
      pricing: false,
      policies: false,
      contact: false,
    },
    securityHeaders: {
      xFrameOptions: false,
      xContentTypeOptions: false,
      referrerPolicy: false,
      contentSecurityPolicy: false,
    },
    limitations: ["Task submission failed: network error"],
    collectedAt: new Date().toISOString(),
    coverage: { requested: 0, completed: 0, failed: 0 },
    rawArtifactRef: null,
    _sourceStatus: {
      provider: "dataforseo-onpage",
      adapterVersion: "1.0.0",
      startedAt: null,
      completedAt: new Date().toISOString(),
      requestId: null,
      retryCount: 0,
      returnedRecordCount: 0,
      expectedRecordCount: null,
      errorCategory: "network",
      limitation: "Task submission failed: network error",
      rawArtifactRef: null,
    },
  };
}

// -----------------------------------------------------------------------
// Existing tests (unchanged behavior)
// -----------------------------------------------------------------------

test("scoreAudit produces complete deterministic Karen-style report model", () => {
  const model = scoreAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: [] },
    evidence(),
  );
  assert.ok(
    model.scores.conversionReadiness >= 0 &&
      model.scores.conversionReadiness <= 100,
  );
  assert.equal(model.findings[0].severity, "High");
  assert.ok(model.findings.some((f) => f.key === "lcp"));
  assert.ok(model.readinessMap.length > 0);
  assert.equal(model.contentIdeas.tofu.length, 3);
});

test("scorePerformance returns null when no usable data exists", () => {
  assert.equal(scorePerformance(unavailablePerf()), null);
});

test("scorePerformance clamps the numeric average to 0–100", () => {
  const perf = evidence().performance;
  const score = scorePerformance(perf);
  assert.equal(score, 76); // clamp(average(55, 96)) = clamp(75.5) = 76
});

test("scoreAudit marks performance null and reduces evidence confidence when performance is unavailable", () => {
  const model = scoreAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: [] },
    evidence({ performance: unavailablePerf() }),
  );
  assert.equal(model.scores.performance, null);
  assert.ok(
    model.scores.conversionReadiness >= 0 &&
      model.scores.conversionReadiness <= 100,
  );
  assert.ok(
    model.evidenceConfidenceScore < 80,
    `Expected evidence confidence < 80, got ${model.evidenceConfidenceScore}`,
  );
});

test("scoreAudit with valid performance preserves normal behavior", () => {
  const model = scoreAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: [] },
    evidence(),
  );
  assert.equal(model.scores.performance, 76);
  assert.ok(
    model.scores.conversionReadiness >= 0 &&
      model.scores.conversionReadiness <= 100,
  );
  assert.ok(model.evidenceConfidenceScore >= 80);
});

test("Lighthouse fallback renders PASS gate and numeric metrics in the report", async () => {
  const model = scoreAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: [] },
    evidence({ performance: lighthouseFallbackPerf() }),
  );
  assert.equal(model.evidence.performance.sourceStatus, SOURCE_STATUS.AVAILABLE);
  assert.equal(
    model.evidence.performance.mobile.source,
    "lighthouse-cli-fallback",
  );
  assert.equal(model.scores.performance, 75); // clamp(average(62, 88))

  const html = await renderReport(model);
  assert.match(html, /Performance.*PASS/);
  assert.doesNotMatch(html, /No performance result was measured/);
  assert.match(html, />62</);
  assert.match(html, />88</);
  assert.match(html, /3\.1s/);
  assert.match(html, /1\.4s/);
  assert.match(html, /0\.6s/);
  assert.match(html, />180ms</);
  assert.match(html, />45ms</);
});

// -----------------------------------------------------------------------
// NEW: Crawl gate tests (PRD v3.0 §8.6)
// -----------------------------------------------------------------------

test("FAILED crawl suppresses all crawl-dependent scores", () => {
  const model = scoreAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: [] },
    evidence({ site: failedSite() }),
  );

  // All crawl-dependent scores are null
  assert.equal(model.scores.trust, null);
  assert.equal(model.scores.contentDepth, null);
  assert.equal(model.scores.conversionPathways, null);
  assert.equal(model.scores.technical, null);
  assert.equal(model.scores.conversionReadiness, null);
  assert.equal(model.scores.awareness, null);
  assert.equal(model.scores.consideration, null);
  assert.equal(model.scores.decision, null);
  assert.equal(model.scores.aiReadiness, null);

  // Performance is independent
  assert.equal(model.scores.performance, 76);

  // No findings
  assert.deepEqual(model.findings, []);

  // Bands reflect Not Assessed
  assert.equal(model.bands.conversionReadiness, "Not Assessed");
  assert.equal(model.bands.trust, "Not Assessed");

  // Evidence confidence reduced
  assert.ok(model.evidenceConfidenceScore < 50);

  // Crawl suppression flag
  assert.equal(model._crawlSuppressed, true);
});

test("BLOCKED crawl suppresses all crawl-dependent scores", () => {
  const blocked = {
    ...failedSite(),
    sourceStatus: SOURCE_STATUS.BLOCKED,
    status: SOURCE_STATUS.BLOCKED,
    limitations: ["Site blocked by robots.txt"],
    _sourceStatus: {
      ...failedSite()._sourceStatus,
      errorCategory: null,
      limitation: "robots.txt blocked the crawl",
    },
  };

  const model = scoreAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: [] },
    evidence({ site: blocked }),
  );

  assert.equal(model.scores.trust, null);
  assert.equal(model.scores.conversionReadiness, null);
  assert.notEqual(model.scores.performance, null);
  assert.equal(model._crawlSuppressed, true);
  assert.match(model.rootCause, /blocked/i);
});

test("NOT_CONNECTED crawl suppresses all crawl-dependent scores", () => {
  const notConnected = {
    ...failedSite(),
    sourceStatus: SOURCE_STATUS.NOT_CONNECTED,
    status: SOURCE_STATUS.NOT_CONNECTED,
    limitations: ["DataForSEO credentials not configured."],
    _sourceStatus: {
      ...failedSite()._sourceStatus,
      errorCategory: "not_configured",
      limitation: "DataForSEO credentials not configured.",
    },
  };

  const model = scoreAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: [] },
    evidence({ site: notConnected }),
  );

  assert.equal(model.scores.trust, null);
  assert.equal(model.scores.conversionReadiness, null);
  assert.notEqual(model.scores.performance, null);
  assert.equal(model._crawlSuppressed, true);
  assert.match(model.rootCause, /not connected/i);
});

test("PARTIAL crawl scores available evidence normally", () => {
  const partial = {
    ...evidence().site,
    sourceStatus: SOURCE_STATUS.PARTIAL,
    status: SOURCE_STATUS.PARTIAL,
    coverage: { requested: 500, completed: 50, failed: 0 },
    limitations: ["Page ceiling reached: 50 of 500 pages crawled"],
  };

  const model = scoreAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: [] },
    evidence({ site: partial }),
  );

  // PARTIAL is still viable — all scores computed
  assert.notEqual(model.scores.trust, null);
  assert.notEqual(model.scores.contentDepth, null);
  assert.notEqual(model.scores.conversionReadiness, null);
  assert.notEqual(model.scores.performance, null);

  // Findings are present
  assert.ok(model.findings.length > 0);
  assert.equal(model.findings[0].severity, "High");

  // Not suppressed
  assert.equal(model._crawlSuppressed, undefined);
});

test("scoreAudit renders report with FAILED crawl without crashing", async () => {
  const model = scoreAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: [] },
    evidence({ site: failedSite() }),
  );

  // Verify model doesn't crash rendering
  const html = await renderReport(model);
  assert.ok(html.length > 0);
  assert.match(html, /Vantage Phase 1 Audit/);
  // Report should indicate crawl issues without crashing
  assert.ok(typeof html === "string");
});

import test from "node:test";
import assert from "node:assert/strict";
import { scoreAudit } from "./vantage-score.js";
import { scorePerformance } from "./score-components.js";
import { renderReport } from "../report/render-report.js";
import { SOURCE_STATUS } from "./evidence-contracts.js";

function evidence(overrides = {}) {
  return {
    site: {
      evidenceVersion: "1.0.0", source: "vantage-crawler", sourceStatus: SOURCE_STATUS.AVAILABLE,
      targetUrl: "https://example.com/", domain: "example.com", pageCount: 2, totalWords: 800, averageWords: 400,
      missingTitles: 0, missingDescriptions: 1, missingCanonicals: 1, h1Missing: 0, h1Multiple: 0,
      imageCount: 2, imagesMissingAlt: 1, imagesMissingDimensions: 1, schemaTypes: [], forms: [], ctas: [{ text: "Book", url: "https://cal.example/book" }], externalCtas: [], socialLinks: [], internalLinkCount: 2, brokenInternalLinks: [], platform: "GoDaddy Website Builder", services: ["Coaching"], topicKeywords: ["stress recovery", "coaching support"], securityHeaders: { xFrameOptions: false, xContentTypeOptions: true, referrerPolicy: false, contentSecurityPolicy: false }, trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: true }, limitations: [], pages: [{ title: "Example", language: "en-CA", headings: { h1: ["Stress Recovery"], h2: ["Coaching"], h3: [], h4: [] }, responseHeaders: {} }],
      collectedAt: new Date().toISOString(), coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null,
      _sourceStatus: { provider: "vantage-crawler", adapterVersion: "1.0.0", startedAt: null, completedAt: new Date().toISOString(), requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null },
    },
    performance: { evidenceVersion: "1.0.0", source: "test", sourceStatus: SOURCE_STATUS.AVAILABLE, status: SOURCE_STATUS.AVAILABLE, mobile: { status: SOURCE_STATUS.AVAILABLE, source: "test", scores: { performance: 55 }, metrics: { lcpMs: 5600 } }, desktop: { status: SOURCE_STATUS.AVAILABLE, source: "test", scores: { performance: 96 }, metrics: { lcpMs: 1000 } }, limitations: [], fieldData: {}, collectedAt: new Date().toISOString(), coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "test", adapterVersion: "1.0.0", startedAt: null, completedAt: new Date().toISOString(), requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null } },
    competitors: [], backlinks: { evidenceVersion: "1.0.0", source: "dataforseo", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, records: [], collectedAt: new Date().toISOString(), coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "dataforseo", adapterVersion: "1.0.0", startedAt: null, completedAt: new Date().toISOString(), requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } },
    ga4: { evidenceVersion: "1.0.0", source: "google-analytics-4", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, included: false, affectsScore: false, collectedAt: new Date().toISOString(), coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "google-analytics-4", adapterVersion: "1.0.0", startedAt: null, completedAt: new Date().toISOString(), requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } },
    ...overrides,
  };
}

function unavailablePerf() {
  return {
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
    collectedAt: new Date().toISOString(), coverage: { requested: 2, completed: 0, failed: 2 }, rawArtifactRef: null,
    _sourceStatus: { provider: "unavailable", adapterVersion: "1.0.0", startedAt: null, completedAt: new Date().toISOString(), requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: 2, errorCategory: "rate_limit", limitation: "No usable PageSpeed or Lighthouse result.", rawArtifactRef: null },
  };
}

function lighthouseFallbackPerf() {
  return {
    evidenceVersion: "1.0.0", source: "lighthouse-cli-fallback", sourceStatus: SOURCE_STATUS.AVAILABLE, status: SOURCE_STATUS.AVAILABLE,
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
    fieldData: { phone: { status: SOURCE_STATUS.UNAVAILABLE }, desktop: { status: SOURCE_STATUS.UNAVAILABLE } },
    limitations: [
      "PageSpeed mobile failed (429): quota",
      "PageSpeed desktop failed (429): quota",
    ],
    collectedAt: new Date().toISOString(), coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null,
    _sourceStatus: { provider: "lighthouse-cli-fallback", adapterVersion: "1.0.0", startedAt: null, completedAt: new Date().toISOString(), requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null },
  };
}

test("scoreAudit produces complete deterministic Karen-style report model", () => {
  const model = scoreAudit({ targetUrl: "https://example.com", businessName: "Example", competitors: [] }, evidence());
  assert.ok(model.scores.conversionReadiness >= 0 && model.scores.conversionReadiness <= 100);
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
  const model = scoreAudit({ targetUrl: "https://example.com", businessName: "Example", competitors: [] }, evidence({ performance: unavailablePerf() }));
  assert.equal(model.scores.performance, null);
  assert.ok(model.scores.conversionReadiness >= 0 && model.scores.conversionReadiness <= 100);
  assert.ok(model.evidenceConfidenceScore < 80, `Expected evidence confidence < 80, got ${model.evidenceConfidenceScore}`);
});

test("scoreAudit with valid performance preserves normal behavior", () => {
  const model = scoreAudit({ targetUrl: "https://example.com", businessName: "Example", competitors: [] }, evidence());
  assert.equal(model.scores.performance, 76); // clamp(average(55, 96))
  assert.ok(model.scores.conversionReadiness >= 0 && model.scores.conversionReadiness <= 100);
  assert.ok(model.evidenceConfidenceScore >= 80);
});

test("Lighthouse fallback renders PASS gate and numeric metrics in the report", async () => {
  const model = scoreAudit(
    { targetUrl: "https://example.com", businessName: "Example", competitors: [] },
    evidence({ performance: lighthouseFallbackPerf() }),
  );
  assert.equal(model.evidence.performance.sourceStatus, SOURCE_STATUS.AVAILABLE);
  assert.equal(model.evidence.performance.mobile.source, "lighthouse-cli-fallback");
  assert.equal(model.scores.performance, 75); // clamp(average(62, 88)) = 75

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

import test from "node:test";
import assert from "node:assert/strict";
import { scoreAudit } from "./vantage-score.js";
import { scorePerformance } from "./score-components.js";
import { renderReport } from "../report/render-report.js";

function evidence(overrides = {}) {
  return {
    site: {
      targetUrl: "https://example.com/", domain: "example.com", pageCount: 2, totalWords: 800, averageWords: 400,
      missingTitles: 0, missingDescriptions: 1, missingCanonicals: 1, h1Missing: 0, h1Multiple: 0,
      imageCount: 2, imagesMissingAlt: 1, imagesMissingDimensions: 1, schemaTypes: [], forms: [], ctas: [{ text: "Book", url: "https://cal.example/book" }], externalCtas: [], socialLinks: [], internalLinkCount: 2, brokenInternalLinks: [], platform: "GoDaddy Website Builder", services: ["Coaching"], topicKeywords: ["stress recovery", "coaching support"], securityHeaders: { xFrameOptions: false, xContentTypeOptions: true, referrerPolicy: false, contentSecurityPolicy: false }, trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: true }, limitations: [], pages: [{ title: "Example", language: "en-CA", headings: { h1: ["Stress Recovery"], h2: ["Coaching"], h3: [], h4: [] }, responseHeaders: {} }],
    },
    performance: { status: "complete", mobile: { source: "test", scores: { performance: 55 }, metrics: { lcpMs: 5600 } }, desktop: { source: "test", scores: { performance: 96 }, metrics: { lcpMs: 1000 } }, limitations: [], fieldData: {} },
    competitors: [], backlinks: { status: "not_configured" }, ga4: { status: "not_configured" },
    ...overrides,
  };
}

function unavailablePerf() {
  return {
    status: "failed",
    mobile: { status: "failed", source: "unavailable", error: "PageSpeed mobile failed (429)", scores: {}, metrics: {} },
    desktop: { status: "failed", source: "unavailable", error: "PageSpeed desktop failed (429)", scores: {}, metrics: {} },
    limitations: [
      "PageSpeed mobile failed (429): quota",
      "Local Lighthouse mobile failed: Lighthouse crashed",
      "PageSpeed desktop failed (429): quota",
      "Local Lighthouse desktop failed: Lighthouse crashed",
    ],
    fieldData: { phone: { status: "not_configured" }, desktop: { status: "not_configured" } },
  };
}

function lighthouseFallbackPerf() {
  return {
    status: "complete",
    mobile: {
      status: "complete",
      source: "lighthouse-cli-fallback",
      strategy: "mobile",
      scores: { performance: 62, accessibility: 88, bestPractices: 96, seo: 85 },
      metrics: { fcpMs: 1400, lcpMs: 3100, tbtMs: 180, cls: 0.08 },
      opportunities: [],
    },
    desktop: {
      status: "complete",
      source: "lighthouse-cli-fallback",
      strategy: "desktop",
      scores: { performance: 88, accessibility: 90, bestPractices: 96, seo: 87 },
      metrics: { fcpMs: 600, lcpMs: 1200, tbtMs: 45, cls: 0.02 },
      opportunities: [],
    },
    fieldData: { phone: { status: "no_data" }, desktop: { status: "no_data" } },
    limitations: [
      "PageSpeed mobile failed (429): quota",
      "PageSpeed desktop failed (429): quota",
    ],
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
  // Evidence confidence loses all 25 performance points → max 75
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
  // Model assertions
  assert.equal(model.evidence.performance.status, "complete");
  assert.equal(model.evidence.performance.mobile.source, "lighthouse-cli-fallback");
  assert.equal(model.scores.performance, 75); // clamp(average(62, 88)) = 75

  // Render the full report and assert gate + metrics are present
  const html = await renderReport(model);
  // Performance gate row in the evidence appendix must contain PASS
  assert.match(html, /Performance.*PASS/);
  // Must NOT contain the unavailable-performance warning
  assert.doesNotMatch(html, /No performance result was measured/);
  // Numeric Lighthouse performance scores rendered in score cards
  assert.match(html, />62</);  // mobile performance score
  assert.match(html, />88</);  // desktop performance score
  // Numeric Lighthouse metrics rendered (fmtSec converts ms → s)
  assert.match(html, /3\.1s/);  // mobile LCP 3100 ms
  assert.match(html, /1\.4s/);  // mobile FCP 1400 ms
  assert.match(html, /0\.6s/);  // desktop FCP 600 ms
  assert.match(html, />180ms</); // mobile TBT (rendered as raw ms)
  assert.match(html, />45ms</);  // desktop TBT (rendered as raw ms)
});

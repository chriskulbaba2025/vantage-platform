import test from "node:test";
import assert from "node:assert/strict";
import { scoreAudit } from "./vantage-score.js";

function evidence() {
  return {
    site: {
      targetUrl: "https://example.com/", domain: "example.com", pageCount: 2, totalWords: 800, averageWords: 400,
      missingTitles: 0, missingDescriptions: 1, missingCanonicals: 1, h1Missing: 0, h1Multiple: 0,
      imageCount: 2, imagesMissingAlt: 1, imagesMissingDimensions: 1, schemaTypes: [], forms: [], ctas: [{ text: "Book", url: "https://cal.example/book" }], externalCtas: [], socialLinks: [], internalLinkCount: 2, brokenInternalLinks: [], platform: "GoDaddy Website Builder", services: ["Coaching"], topicKeywords: ["stress recovery", "coaching support"], securityHeaders: { xFrameOptions: false, xContentTypeOptions: true, referrerPolicy: false, contentSecurityPolicy: false }, trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: true }, limitations: [], pages: [{ title: "Example", language: "en-CA", headings: { h1: ["Stress Recovery"], h2: ["Coaching"], h3: [], h4: [] }, responseHeaders: {} }],
    },
    performance: { status: "complete", mobile: { source: "test", scores: { performance: 55 }, metrics: { lcpMs: 5600 } }, desktop: { source: "test", scores: { performance: 96 }, metrics: { lcpMs: 1000 } }, limitations: [], fieldData: {} },
    competitors: [], backlinks: { status: "not_configured" }, ga4: { status: "not_configured" },
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

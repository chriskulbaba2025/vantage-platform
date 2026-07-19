import test from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "./render-report.js";
import { scoreAudit } from "../scoring/vantage-score.js";
import { stableHash } from "../utils.js";

const EXPECTED_CSS_HASH = "04f85950237982d04619cd03a9170a19920cbc9b712c4f191711cba3144cdc7d";
const style = (html) => html.match(/<style>[\s\S]*?<\/style>/)?.[0] || "";

function model() {
  const site = { targetUrl: "https://example.com/", domain: "example.com", pageCount: 1, totalWords: 700, averageWords: 700, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0, h1Missing: 0, h1Multiple: 0, imageCount: 1, imagesMissingAlt: 0, imagesMissingDimensions: 0, schemaTypes: ["LocalBusiness"], forms: [{ fields: 2 }], ctas: [{ text: "Book a call", url: "https://example.com/book" }], externalCtas: [], socialLinks: [{ url: "https://linkedin.com/company/example" }], internalLinkCount: 5, brokenInternalLinks: [], platform: "WordPress", services: ["Coaching"], topicKeywords: ["stress", "recovery"], securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: false }, trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true }, limitations: [], pages: [{ title: "Example", language: "en-CA", rendered: false, headings: { h1: ["Stress Recovery"], h2: ["Coaching"], h3: [], h4: [] }, responseHeaders: {} }] };
  const evidence = { site, performance: { status: "complete", mobile: { source: "pagespeed-insights", scores: { performance: 70, accessibility: 90, bestPractices: 96, seo: 90 }, metrics: { fcpMs: 1200, lcpMs: 2500, tbtMs: 100, cls: 0.05 } }, desktop: { source: "pagespeed-insights", scores: { performance: 95, accessibility: 90, bestPractices: 96, seo: 90 }, metrics: { fcpMs: 500, lcpMs: 900, tbtMs: 0, cls: 0.01 } }, fieldData: { phone: { status: "no_data" }, desktop: { status: "no_data" } }, limitations: [] }, competitors: [], backlinks: { status: "not_configured" }, ga4: { status: "not_configured" } };
  return scoreAudit({ targetUrl: site.targetUrl, businessName: "Example Business", location: "London, Ontario, Canada", language: "en-CA", competitors: [] }, evidence);
}

test("renderReport preserves locked style and all thirteen section IDs", async () => {
  const html = await renderReport(model());
  assert.equal(stableHash(style(html)), EXPECTED_CSS_HASH);
  assert.equal((html.match(/<section id=/g) || []).length, 13);
  assert.match(html, /Example Business/);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
});

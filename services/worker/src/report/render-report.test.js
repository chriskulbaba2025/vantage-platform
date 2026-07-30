import test from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "./render-report.js";
import { scoreAudit } from "../scoring/vantage-score.js";
import { stableHash } from "../utils.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

const EXPECTED_CSS_HASH = "3d1a86d9e20900b6b76de3e703311af5cdb7b8b1bef67f66ed869b101a0a9c92";
const norm = (s) => s.replace(/\r\n/g, "\n");
const style = (html) => norm(html.match(/<style>[\s\S]*?<\/style>/)?.[0] || "");

function model() {
  const now = new Date().toISOString();
  const site = { evidenceVersion: "1.0.0", source: "vantage-crawler", sourceStatus: SOURCE_STATUS.AVAILABLE, targetUrl: "https://example.com/", domain: "example.com", pageCount: 1, totalWords: 700, averageWords: 700, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0, h1Missing: 0, h1Multiple: 0, imageCount: 1, imagesMissingAlt: 0, imagesMissingDimensions: 0, schemaTypes: ["LocalBusiness"], forms: [{ fields: 2 }], ctas: [{ text: "Book a call", url: "https://example.com/book" }], externalCtas: [], socialLinks: [{ url: "https://linkedin.com/company/example" }], internalLinkCount: 5, brokenInternalLinks: [], platform: "WordPress", services: ["Coaching"], topicKeywords: ["stress", "recovery"], securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: false }, trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true }, limitations: [], pages: [{ title: "Example", language: "en-CA", rendered: false, headings: { h1: ["Stress Recovery"], h2: ["Coaching"], h3: [], h4: [] }, responseHeaders: {} }], collectedAt: now, coverage: { requested: 1, completed: 1, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "vantage-crawler", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 1, expectedRecordCount: 1, errorCategory: null, limitation: null, rawArtifactRef: null } };
  const evidence = { site, performance: { evidenceVersion: "1.0.0", source: "pagespeed-insights", sourceStatus: SOURCE_STATUS.AVAILABLE, status: SOURCE_STATUS.AVAILABLE, mobile: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", scores: { performance: 70, accessibility: 90, bestPractices: 96, seo: 90 }, metrics: { fcpMs: 1200, lcpMs: 2500, tbtMs: 100, cls: 0.05 } }, desktop: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", scores: { performance: 95, accessibility: 90, bestPractices: 96, seo: 90 }, metrics: { fcpMs: 500, lcpMs: 900, tbtMs: 0, cls: 0.01 } }, fieldData: { phone: { status: SOURCE_STATUS.UNAVAILABLE }, desktop: { status: SOURCE_STATUS.UNAVAILABLE } }, limitations: [], collectedAt: now, coverage: { requested: 2, completed: 2, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "pagespeed-insights", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null } }, competitors: [], backlinks: { evidenceVersion: "1.0.0", source: "dataforseo", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, records: [], collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "dataforseo", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } }, ga4: { evidenceVersion: "1.0.0", source: "google-analytics-4", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, included: false, affectsScore: false, collectedAt: now, coverage: { requested: 0, completed: 0, failed: 0 }, rawArtifactRef: null, _sourceStatus: { provider: "google-analytics-4", adapterVersion: "1.0.0", startedAt: null, completedAt: now, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } } };
  return scoreAudit({ targetUrl: site.targetUrl, businessName: "Example Business", location: "London, Ontario, Canada", language: "en-CA", competitors: [] }, evidence);
}

test("renderReport preserves locked style and all thirteen section IDs", async () => {
  const html = await renderReport(model());
  assert.equal(stableHash(style(html)), EXPECTED_CSS_HASH);
  assert.equal((html.match(/<section id=/g) || []).length, 13);
  assert.match(html, /Example Business/);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
});

// ── Print-to-PDF button tests ──────────────────────────────────────────

test("print button does NOT appear on draft report (isApproved false)", async () => {
  const html = await renderReport(model(), { isApproved: false });
  assert.doesNotMatch(html, /Print or save this page as PDF/);
  assert.doesNotMatch(html, /print-page-btn/);
});

test("print button DOES appear on approved report (isApproved true)", async () => {
  const html = await renderReport(model(), { isApproved: true });
  assert.match(html, /Print or save this page as PDF/);
  assert.match(html, /print-page-btn/);
  assert.match(html, /window\.print\(\)/);
});

test("print button has no-print class so it hides during printing", async () => {
  const html = await renderReport(model(), { isApproved: true });
  assert.match(html, /class="print-page-btn no-print"/);
  assert.match(html, /class="print-button-container/);
});

test("print CSS hides navigation and controls", async () => {
  const html = await renderReport(model());
  // @media print rules hide nav, section-nav, and print controls
  assert.match(html, /\.top-nav,\.section-nav,\.print-button-container,footer button,\.no-print\{display:none!important\}/);
});

test("print CSS preserves content with sensible page breaks", async () => {
  const html = await renderReport(model());
  assert.match(html, /section\{[^}]*break-inside:avoid[^}]*\}/);
  assert.match(html, /tr\{[^}]*page-break-inside:avoid[^}]*\}/);
  assert.match(html, /h2,h3,h4\{[^}]*page-break-after:avoid[^}]*\}/);
});

test("print CSS includes @page margin", async () => {
  const html = await renderReport(model());
  assert.match(html, /@page\{margin:15mm\}/);
});

test("approved report HTML resolves all template tokens", async () => {
  const html = await renderReport(model(), { isApproved: true });
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
});

test("draft report HTML resolves all template tokens", async () => {
  const html = await renderReport(model(), { isApproved: false });
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
});

// ---------------------------------------------------------------------------
// Multi-page navigation integration tests
// ---------------------------------------------------------------------------

test("multi-page: single-section display logic is present in rendered HTML", async () => {
  const html = await renderReport(model());
  // CSS must hide all sections by default, show only .active
  assert.match(html, /section\{display:none\}/);
  assert.match(html, /section\.active\{display:block\}/);
});

test("multi-page: navigation JavaScript sets active section and aria-current", async () => {
  const html = await renderReport(model());
  // JS must include aria-current management
  assert.match(html, /aria-current/);
  // JS must include classList.add('active')
  assert.match(html, /classList\.add\('active'\)/);
  // JS must include history.pushState for hash updates
  assert.match(html, /history\.pushState/);
  // JS must handle popstate for back/forward
  assert.match(html, /popstate/);
});

test("multi-page: Previous/Next controls are present", async () => {
  const html = await renderReport(model());
  // The script tag injects Previous/Next buttons and position text at runtime
  const script = (html.match(/<script>[\s\S]*?<\/script>/) || [""])[0];
  assert.match(script, /section-nav/);
  assert.match(script, /← Previous/);
  assert.match(script, /Next →/);
  assert.match(script, /Section.*of/);
});

test("multi-page: Section X of Y indicator is present", async () => {
  const html = await renderReport(model());
  const script = (html.match(/<script>[\s\S]*?<\/script>/) || [""])[0];
  // Position text like "Section " + (i+1) + " of " + total
  assert.match(script, /Section.*\+.*\+.*of/);
});

test("multi-page: print CSS shows all sections with page breaks", async () => {
  const html = await renderReport(model());
  // Print mode shows all sections
  assert.match(html, /section\{display:block!important/);
  // Page break before each section after the first
  assert.match(html, /section:not\(:first-of-type\)\{page-break-before:always\}/);
  // Print hides nav and section-nav
  assert.match(html, /\.top-nav,\.section-nav,\.print-button-container,footer button,\.no-print\{display:none!important\}/);
});

test("multi-page: no old anchor-only navigation remains", async () => {
  const html = await renderReport(model());
  const script = (html.match(/<script>[\s\S]*?<\/script>/) || [""])[0];
  // Old nav toggle button must not exist in HTML
  assert.doesNotMatch(html, /nav-toggle/);
  // Must use history.pushState (modern), not anchor-only scroll
  assert.match(script, /history\.pushState/);
  // Must use popstate for back/forward
  assert.match(script, /popstate/);
});

test("multi-page: booking CTA and next action appear in footer", async () => {
  const modelWithGate = model();
  modelWithGate._gate = {
    passed: true,
    bookingCta: { text: "Book an implementation scoping session for Test Business", action: "schedule", visible: true, placement: "report-footer" },
    nextAction: "Book an implementation scoping session to determine whether targeted remediation or a full redesign is the better investment.",
    commercialRecommendation: "Targeted technical and content remediation is recommended.",
  };
  const html = await renderReport(modelWithGate);
  assert.match(html, /implementation scoping session/);
  assert.match(html, /targeted remediation or a full redesign/);
  assert.match(html, /Book an implementation scoping session for Test Business/);
});

test("multi-page: keyboard navigation supports Left/Right arrows", async () => {
  const html = await renderReport(model());
  // JS must include ArrowLeft/ArrowRight keyboard handlers
  assert.match(html, /ArrowLeft/);
  assert.match(html, /ArrowRight/);
});

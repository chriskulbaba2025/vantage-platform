import test from "node:test";
import assert from "node:assert/strict";
import { scoreAudit } from "../scoring/vantage-score.js";
import { renderReportV2, computePillars } from "./render-report-v2.js";
import { REPORT_DESIGN_V1, REPORT_DESIGN_V2, DEFAULT_REPORT_DESIGN } from "./report-design.js";
import { renderReport } from "./render-report.js";

// PRYSM-NEXT-01 WP-G — report design v2 golden tests.

const FIXED_TS = "2026-01-15T12:00:00.000Z";
const INPUT = {
  targetUrl: "https://x.com",
  businessName: "Example Business",
  competitors: [],
  services: ["Coaching"],
  primaryGoal: "Book consultations",
};

function evidence() {
  return {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: {
      sourceStatus: "AVAILABLE",
      targetUrl: "https://x.com/",
      domain: "x.com",
      pageCount: 2,
      pages: [{ title: "Home", headings: { h1: ["Home"], h2: [], h3: [], h4: [] }, responseHeaders: {} }],
      services: ["Coaching"],
      topicKeywords: ["coaching support"],
      ctas: [{ text: "Book", url: "https://x.com/book", kind: "link" }],
      externalCtas: [],
      forms: [{ action: "/submit" }],
      schemaTypes: ["Organization"],
      microdataTypes: [],
      socialLinks: [],
      trust: { testimonials: false, credentials: true, caseStudies: false, faq: false, pricing: false, policies: true, contact: true },
      securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: true },
      totalWords: 800, averageWords: 400,
      missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
      h1Missing: 0, h1Multiple: 0,
      imageCount: 2, imagesMissingAlt: 1,
      internalLinkCount: 2, brokenInternalLinks: [],
      statusCounts: {},
      limitations: [],
      collectedAt: FIXED_TS,
      coverage: { requested: 2, completed: 2, failed: 0 },
      _contentEvidenceAvailable: true,
      _responseHeadersAvailable: true,
    },
    performance: {
      sourceStatus: "AVAILABLE",
      provider: "pagespeed-insights",
      mobile: { status: "AVAILABLE", source: "psi", scores: { performance: 60 }, metrics: {} },
      desktop: { status: "AVAILABLE", source: "psi", scores: { performance: 90 }, metrics: {} },
      fieldData: {},
      limitations: [],
      collectedAt: FIXED_TS,
      coverage: { requested: 2, completed: 2, failed: 0 },
    },
    competitors: null, backlinks: null, ga4: null, gsc: null,
  };
}

function model() {
  return scoreAudit(INPUT, evidence());
}

// ---------------------------------------------------------------------------
// WP-G-01 — design registry
// ---------------------------------------------------------------------------

test("WP-G-01: design registry has v1 + v2 and defaults to v1", () => {
  assert.equal(REPORT_DESIGN_V1, "1.0.0");
  assert.equal(REPORT_DESIGN_V2, "2.0.0");
  assert.equal(DEFAULT_REPORT_DESIGN, "1.0.0");
});

// ---------------------------------------------------------------------------
// WP-G-02 — pillar computation
// ---------------------------------------------------------------------------

test("WP-G-02: five pillars with weighted means and capability statuses", () => {
  const m = model();
  const pillars = computePillars(m);
  assert.equal(pillars.length, 5);
  const ids = pillars.map((p) => p.id);
  assert.deepEqual(ids, ["offer_content", "trust_proof", "conversion_path", "technical_health", "performance_experience"]);

  const technical = pillars.find((p) => p.id === "technical_health");
  assert.equal(typeof technical.score, "number", "technical hygiene eligible → score");
  assert.ok(technical.modules.some((mod) => mod.moduleId === "technical_hygiene" && mod.score !== null));
  assert.ok(technical.capabilities.some((c) => c.key === "technical.headers" && c.status === "AVAILABLE"));

  const perf = pillars.find((p) => p.id === "performance_experience");
  assert.equal(perf.score, 75, "performance pillar = round((60+90)/2) = 75");
});

test("WP-G-02: suppressed modules yield null pillar scores, never imputed", () => {
  const ev = evidence();
  ev.site._contentEvidenceAvailable = false;
  ev.site._responseHeadersAvailable = false;
  const m = scoreAudit(INPUT, ev);
  const pillars = computePillars(m);
  const trust = pillars.find((p) => p.id === "trust_proof");
  assert.equal(trust.score, null, "no eligible modules → null, not zero");
  assert.equal(trust.assessedWeight, 0);
});

// ---------------------------------------------------------------------------
// WP-G-03 — executive report structure and content
// ---------------------------------------------------------------------------

test("WP-G-03: v2 report answers A–E with required sections", () => {
  const html = renderReportV2(model());
  // A/B/C — executive scorecard
  assert.match(html, /A\. Conversion Readiness/);
  assert.match(html, /B\. Evidence Confidence/);
  assert.match(html, /C\. Evidence Coverage/);
  // D — pillars
  assert.match(html, /D\. Where are the problems\?/);
  for (const label of ["Offer &amp; Content", "Trust &amp; Proof", "Conversion Path", "Technical Health", "Performance &amp; Experience"]) {
    assert.ok(html.includes(label), `pillar ${label} present`);
  }
  // E — blockers
  assert.match(html, /E\. What should be fixed first\?/);
  // Deep evidence layer
  assert.match(html, /Evidence detail/);
  assert.match(html, /Findings/);
  assert.match(html, /Source statuses/);
  assert.match(html, /Evidence capabilities/);
  // Versions
  assert.ok(html.includes(`Report design v${REPORT_DESIGN_V2}`));
  assert.ok(html.includes("Scoring version 4.1.0"));
});

test("WP-G-03: blocker rows carry priority/problem/consequence/evidence/action/impact/effort/confidence", () => {
  const html = renderReportV2(model());
  const rows = html.match(/<tbody>([\s\S]*?)<\/tbody>/g) || [];
  const blockerRows = rows.find((r) => r.includes("VAN-"));
  assert.ok(blockerRows, "blocker table exists");
  const firstFinding = model().findings.find((f) => f.scoreBearing === true);
  assert.ok(firstFinding, "fixture has score-bearing findings");
  // Every blocker column family appears: priority number, ruleId evidence,
  // recommendation text, effort label, confidence value.
  assert.ok(html.includes(String(firstFinding.finalPriority)));
  assert.ok(html.includes(firstFinding.ruleId));
  assert.ok(html.includes(firstFinding.title));
  assert.ok(html.includes(firstFinding.businessImpact));
  assert.ok(html.includes(firstFinding.recommendation));
  assert.ok(html.includes(firstFinding.confidence));
});

test("WP-G-03: no invented evidence — every displayed ruleId exists in the model", () => {
  const m = model();
  const html = renderReportV2(m);
  const known = new Set(m.findings.map((f) => f.ruleId));
  const displayed = [...html.matchAll(/VAN-[A-Z]+-\d{3}/g)].map((x) => x[0]);
  assert.ok(displayed.length > 0);
  for (const ruleId of displayed) {
    assert.ok(known.has(ruleId), `displayed ruleId ${ruleId} exists in the model`);
  }
});

test("WP-G-03: deterministic — two renders are byte-identical", () => {
  const m = model();
  assert.equal(renderReportV2(m), renderReportV2(m));
});

test("WP-G-03: print rules hide navigation; responsive viewport meta present", () => {
  const html = renderReportV2(model());
  assert.match(html, /@media print/);
  assert.match(html, /\.nav-jump, \.no-print \{\s*display:none !important/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /@media \(max-width: 720px\)/);
});

test("WP-G-03: insufficient-evidence model renders without scores invented", () => {
  const ev = evidence();
  ev.site = { sourceStatus: "FAILED", limitations: ["crawl failed"] };
  ev.performance = null;
  const m = scoreAudit(INPUT, ev);
  const html = renderReportV2(m);
  assert.match(html, /Insufficient Evidence/);
  assert.doesNotMatch(html, /readiness">\d+/, "no numeric readiness when suppressed");
});

// ---------------------------------------------------------------------------
// WP-G-05 — v1 untouched (same model renders through the locked v1 renderer)
// ---------------------------------------------------------------------------

test("WP-G-05: v1 renderer still renders the same model (locked path unchanged)", async () => {
  const m = model();
  const v1 = await renderReport(m);
  assert.ok(v1.length > 0);
  assert.match(v1, /Prysm Phase 1 Audit/);
  // v1 must NOT contain the v2 design markers.
  assert.doesNotMatch(v1, /D\. Where are the problems\?/);
});

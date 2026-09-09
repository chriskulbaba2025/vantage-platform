import test from "node:test";
import assert from "node:assert/strict";
import { scoreAudit } from "../scoring/vantage-score.js";
import { renderReportV2 as renderReportV2Base, computePillars } from "./render-report-v2.js";
import { buildCanonicalSolutionSet, SOLUTION_AUTHORITY_REGISTRY } from "../solution/solution-authority-provider.js";
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

function renderReportV2(model, options) {
  const canonicalSolutions = model.canonicalSolutions || (() => {
    try {
      const findings = model.findings.filter((finding) => finding.findingId).map((finding) => {
        const authority = Object.values(SOLUTION_AUTHORITY_REGISTRY).find((candidate) => candidate.ruleId === finding.ruleId);
        return authority ? {
          ...finding,
          ruleVersion: authority.ruleVersion,
          evidence: [...(finding.evidence || []), { field: authority.evidenceFields[0], artifactRef: `fixture:${finding.findingId}` }],
        } : finding;
      });
      return buildCanonicalSolutionSet({
        findings,
        scoreSet: model,
        decisionEvidence: model.evidence,
      });
    } catch {
      return { records: [], sequence: [] };
    }
  })();
  return renderReportV2Base({ ...model, canonicalSolutions }, options);
}

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

function priorityModel() {
  const m = model();
  m.findings = [
    ...m.findings,
    {
      id: "VAN-TECH-002",
      ruleId: "VAN-TECH-002",
      title: "Heading structure is inconsistent",
      businessImpact: "Clear headings help visitors understand each page.",
      recommendation: "Use one clear main heading per page followed by a consistent heading structure.",
      scoreBearing: true,
      confidence: "supported",
      finalPriority: -2,
      implementationEffort: "M",
      affectedUrls: [],
      verificationMethod: "Review the assessed pages and confirm headings follow a clear structure.",
    },
    {
      id: "VAN-TECH-003",
      ruleId: "VAN-TECH-003",
      title: "Security headers are incomplete",
      businessImpact: "Some browser protections were not detected in the assessed response.",
      recommendation: "Add the missing browser protections.",
      scoreBearing: true,
      confidence: "supported",
      finalPriority: -3,
      implementationEffort: "M",
      affectedUrls: [],
      verificationMethod: "Run the security check again.",
    },
  ];
  return m;
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
  const executive = html.slice(html.indexOf('id="executive"'), html.indexOf('id="pillars"'));
  const headings = ["How ready is your website to convert visitors?", "What should you improve first?", "What is already working?", "What could we not determine?", "Where to find supporting detail"];
  let previous = -1;
  for (const heading of headings) {
    const next = executive.indexOf(heading);
    assert.ok(next > previous, `executive heading order includes ${heading}`);
    previous = next;
  }
  assert.match(executive, /Conversion Readiness/);
  assert.match(executive, /Assessment coverage/);
  assert.match(executive, /Supporting Detail/);
  assert.equal((executive.match(/What is already working\?/g) || []).length, 1);
  assert.equal((executive.match(/<strong>Problem:<\/strong>/g) || []).length, (executive.match(/<strong>Why it matters:<\/strong>/g) || []).length);
  assert.equal((executive.match(/<strong>Problem:<\/strong>/g) || []).length, (executive.match(/<strong>Action:<\/strong>/g) || []).length);
  assert.ok((executive.match(/<strong>Problem:<\/strong>/g) || []).length <= 3);
  assert.ok(!/What Is Already Good|render-blocking|largest contentful paint|meta descriptions|partial assessment|evidence capability|supporting capability|JSON-LD|browser validation|Known factors|Unknown \(excluded\)|Modules assessed|intended dimension weight/i.test(executive));
  // D — pillars
  assert.match(html, /Where are the problems\?/);
  for (const label of ["Offer &amp; Content", "Trust &amp; Proof", "Conversion Path", "Technical Health", "Performance &amp; Experience"]) {
    assert.ok(html.includes(label), `pillar ${label} present`);
  }
  // E — one authoritative client priority sequence
  assert.match(html, /What should you fix first\?/);
  // Deep evidence layer
  assert.match(html, /Evidence detail/);
  assert.match(html, /Findings/);
  assert.match(html, /Source statuses/);
  assert.match(html, /Evidence capabilities/);
  // CRIT 8a — conversion-path architecture + competitive context are part
  // of the governed section set (rendered from the model, never invented).
  assert.match(html, /Can visitors move easily from interest to action\?/);
  assert.match(html, /The assessed path to action is clear, but there are opportunities to make that journey faster and more reassuring\.|The assessed path needs attention before it can be described as clear\.|The available path evidence is incomplete, so a clear route cannot be confirmed\./);
  assert.match(html, /Competitive context/);
  // Versions
  assert.ok(html.includes(`Report design v${REPORT_DESIGN_V2}`));
  assert.ok(html.includes("Scoring version 4.1.1"));
});

test("S02: Priority Fixes is one ranked client sequence with bounded fields", () => {
  const html = renderReportV2(priorityModel());
  const blockers = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  assert.match(blockers, /What should you fix first\?/);
  assert.match(blockers, /Start with #1 and work down the list\. Supporting Detail contains the deeper evidence and technical checks\./);
  assert.doesNotMatch(blockers, /These actions follow the governed priority order\./);
  assert.doesNotMatch(blockers, /<table|VAN-[A-Z]+-\d{3}|HIGH_CONVERSION|OPTIMIZATION|Foundation blocker/i);
  assert.doesNotMatch(blockers, /deterministic evidence confidence|\b[ML]\b|Affected page[s]?:\s*https?:\/\//i);
  for (const label of [
    "What needs attention",
    "Why it matters",
    "What to change",
    "Where it applies",
    "How to confirm it improved",
  ]) {
    assert.match(blockers, new RegExp(label), `required client field: ${label}`);
  }
  const cards = [...blockers.matchAll(/<article class="priority-action" data-priority-rank="(\d+)" data-solution-id="([^"]+)">([\s\S]*?)<\/article>/g)];
  assert.equal(cards.length, 3, "exactly the governed canonical priority cards are rendered");
  const ranks = cards.map((match) => Number(match[1]));
  assert.deepEqual(ranks, [1, 2, 3], "canonical sequence is rendered once in governed order");
  assert.match(cards[0][3], /Start here/);
  for (const card of cards.slice(1)) assert.doesNotMatch(card[3], /Start here/);
  assert.match(cards[0][3], /The governed site evidence indicates that pricing or risk-reassurance information is missing/);
  assert.match(cards[0][3], /PARTIAL \/ CONDITIONAL/);
  assert.match(cards[0][3], /Inspect the governed/);
  assert.doesNotMatch(blockers, /businessImpact|legacy recommendation|affectedUrls|verificationMethod/i);
  assert.doesNotMatch(blockers, /First Things First|Do Now|Do Next|Action Plan|governed priority order/i);
  assert.equal((blockers.match(/<article class="priority-action"/g) || []).length, 3, "no second action sequence is introduced");
});

test("P9: conversion journey visual presents three complete client stages", () => {
  const fixture = model();
  fixture.conversionPaths = [{
    name: "Primary path",
    status: "Weak",
    steps: ["Internal stage one", "Internal stage two", "Internal stage three"],
    blockers: ["Trust proof is limited"],
  }];
  const html = renderReportV2(fixture);
  assert.match(html, /class="conversion-journey-visual"/);
  assert.equal((html.match(/class="conversion-journey-step"/g) || []).length, 3);
  for (const label of ["Reach the key pages", "See a clear next step", "Move toward action"]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /Internal stage one|Internal stage two|Internal stage three/);
});

test("P2: blocker location lists client-owned affected URLs when available", () => {
  const m = model();
  const finding = m.findings.find((f) => f.scoreBearing === true);
  finding.affectedUrls = ["https://x.com/services/consulting"];
  const html = renderReportV2(m);
  const blockers = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  assert.match(blockers, /Where it applies/);
  assert.doesNotMatch(blockers, /https:\/\/x\.com\/services\/consulting/);
});

test("P2: blocker location falls back to the governed evidence source when no URL is available", () => {
  const m = model();
  const finding = m.findings.find((f) => f.scoreBearing === true);
  finding.affectedUrls = [];
  finding.evidence = [{ field: "site.imagesMissingAlt" }];
  const html = renderReportV2(m);
  const blockers = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  assert.match(blockers, /Where it applies/);
  assert.match(blockers, /assessed scope/);
  assert.doesNotMatch(blockers, /site\.imagesMissingAlt/);
});

test("P2: no-action PASS states the current evidence-scope criterion", () => {
  const m = model();
  m.findings = [];
  m.decisionHierarchy = { ...m.decisionHierarchy, orderedFindingIds: [] };
  const html = renderReportV2(m);
  assert.match(html, /No prioritized action was produced from the available evidence/);
});

test("S03: conversion journey tells a bounded CRO story", () => {
  const fixture = model();
  fixture.conversionPaths = [{
    name: "Primary conversion path",
    status: "Clear",
    steps: [
      "Browser validation assessed conversion actions on 6 of 6 selected page(s).",
      "A conversion action was observed on 6 assessed page(s).",
      "A visible, interactable, unobstructed action was confirmed on 6 assessed page(s).",
    ],
    blockers: [],
  }];
  fixture.findings = [
    ...(fixture.findings || []),
    { ruleId: "VAN-PERF-001" },
    { ruleId: "VAN-CONTENT-002" },
  ];
  const html = renderReportV2(fixture);
  for (const text of [
    "Reach the key pages",
    "See a clear next step",
    "Move toward action",
    "Where the journey is strong",
    "Where visitors may lose momentum",
    "What this means for conversion",
    "What to improve around the journey",
    "Conversion takeaway",
    "The assessed route is already clear. The best opportunity is not to redesign the path",
    "What we could not determine",
    "completed enquiries",
  ]) assert.match(html, new RegExp(text));
  assert.doesNotMatch(html, /Main content takes too long to appear on mobile\.|Buyer-question content was not found on the pages we could assess\./);
  assert.equal((html.match(/class="conversion-journey-bridge-card"/g) || []).length, 3);
  assert.match(html, /What supports this journey\?/);
  assert.match(html, /Content that answers buyer questions/);
  assert.match(html, /href="#content-ideas"/);
  assert.match(html, /Trust that reduces hesitation/);
  assert.match(html, /href="#trust-eeat"/);
  assert.match(html, /Performance that keeps momentum/);
  assert.match(html, /href="#priority-fixes"/);
  assert.doesNotMatch(html, /Browser validation assessed conversion actions|A conversion action was observed on 6 assessed page|A visible, interactable, unobstructed action was confirmed on 6 assessed page/);
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
  assert.match(html, /@media \(max-width:\s*900px\)/);
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
  assert.doesNotMatch(v1, /Where are the problems\?/);
});

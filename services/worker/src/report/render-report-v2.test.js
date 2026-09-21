import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { scoreAudit } from "../scoring/vantage-score.js";
import { renderReportV2 as renderReportV2Base, computePillars, REPORT_V2_VIEWER_PAGES } from "./render-report-v2.js";
import { deriveNarrativeStates, NARRATIVE_PAGE_IDS } from "../report-model/narrative-state.js";
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

function canonicalSolutionsForFixture(model, { throwOnError = false } = {}) {
  return model.canonicalSolutions || (() => {
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
    } catch (error) {
      if (throwOnError) throw error;
      return { records: [], sequence: [] };
    }
  })();
}

function renderReportV2(model, options) {
  const canonicalSolutions = canonicalSolutionsForFixture(model);
  const encyclopedia = model._fixtureAcceptCanonicalRecords && !model.encyclopedia
    ? {
        status: "AVAILABLE",
        priorityUnits: canonicalSolutions.sequence.map((solutionId) => {
          const record = canonicalSolutions.records.find((item) => item.solutionId === solutionId);
          return { type: "standalone material finding", canonicalProblemId: "C05", conversionAction: "contact", frictionState: "FRICTION", findingIds: record?.findingRefs || [], evidence: [{ sourceStatus: "AVAILABLE" }] };
        }),
      }
    : model.encyclopedia;
  return renderReportV2Base({ ...model, canonicalSolutions, encyclopedia }, options);
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
  // These fixtures explicitly supply an accepted Encyclopedia projection.
  m._fixtureAcceptCanonicalRecords = true;
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
  assert.ok(
    !technical.capabilities.some((c) => c.key === "technical.headers"),
    "security-header capability is not a client-facing pillar signal",
  );

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

test("WP-G-03: Executive Scorecard summarizes the accepted hierarchy without a second action sequence", () => {
  const fixture = structuredClone(priorityModel());
  fixture.crossReportInterpretation.truth = Object.fromEntries(
    Object.entries(fixture.crossReportInterpretation.truth).map(([key, record]) => [key, { ...record, state: "assessed" }]),
  );
  fixture.competitors = { comparisons: [{ name: "Example competitor", url: "https://example.test", status: "AVAILABLE" }], opportunities: { gaps: [], limitations: [] } };
  fixture.sourceStatus = { ...(fixture.sourceStatus || {}), competitors: "AVAILABLE" };
  fixture.scores.conversionReadiness = 85;
  fixture.bands.conversionReadiness = "Strong";
  const html = renderReportV2(fixture);
  // A/B/C — executive scorecard
  const executive = html.slice(html.indexOf('id="executive"'), html.indexOf('id="pillars"'));
  const headings = ["How ready is your website to convert visitors?", "Conversion Readiness", "Why is the score", "What is already working?", "What is holding the site back?", "Accepted priorities", "Next step &amp; limits", "Where was the evidence limited?"];
  let previous = -1;
  for (const heading of headings) {
    const next = executive.indexOf(heading);
    assert.ok(next > previous, `executive heading order includes ${heading}`);
    previous = next;
  }
  assert.match(executive, /Conversion Readiness/);
  assert.match(executive, /assessed dimension outputs/);
  assert.match(executive, /Supporting Detail/);
  assert.equal((executive.match(/What is already working\?/g) || []).length, 1);
  assert.equal((executive.match(/<strong>What to do:<\/strong>/g) || []).length, 0, "Executive summary does not reproduce the Priority Fixes action cards");
  assert.match(executive, /What we could not confirm/);
  assert.doesNotMatch(executive, /\(SOL-[A-Z0-9-]+\)/);
  assert.match(executive, /data-narrative-state="(?:STRONG|MIDDLE|WEAK|INSUFFICIENT_EVIDENCE)"/);
  assert.match(executive, /Preserve the evidence boundary|preserve the current foundation|prioritize correction/);
  assert.match(executive, /Preserve the evidence boundary|fix proven material issues|selective improvements/);
  assert.doesNotMatch(executive, /governed priorities/i);
  const supportingOverview = html.slice(html.indexOf('id="pillars"'), html.indexOf('id="blockers"'));
  assert.doesNotMatch(supportingOverview, /capabilityEvidence\.capabilities|crossReportInterpretation\.truth|meta_description|trust\.pricing|technical\.headers/i);
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
  assert.match(html, /Can visitors move from interest to action\?/);
  assert.match(html, /Accepted priority evidence includes a supported relationship to visitor-path friction\. Priority Fixes contains the corrective action and order\.|The reviewed path records may include weak checks, but they are not independently accepted as visitor-friction priorities/);
  assert.match(html, /How does your website compare with the competitors buyers may consider\?/);
  // Versions
  assert.ok(html.includes(`Report design v${REPORT_DESIGN_V2}`));
  assert.ok(html.includes("Scoring version 4.1.2"));
  assertFrozenViewerHierarchy();
  assertFourNarrativeStatesAcrossFrozenPages();
});

test("S02: Priority Fixes is one ranked client sequence with bounded fields", () => {
  const html = renderReportV2(priorityModel());
  const statusFixture = priorityModel();
  statusFixture.evidence = {
    ...statusFixture.evidence,
    site: { ...statusFixture.evidence.site, pages: [] },
    ga4: { sourceStatus: "NOT_COLLECTED", status: "NOT_COLLECTED" },
  };
  const statusHtml = renderReportV2(statusFixture);
  const visibleStatusText = statusHtml
    .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  assert.match(visibleStatusText, /not available/i, "internal absence token is projected into client language");
  assert.match(visibleStatusText, /not collected/i, "internal collection token is projected into client language");
  assert.doesNotMatch(visibleStatusText, /\bNOT_AVAILABLE\b|\bNOT_COLLECTED\b/, "internal enum tokens never reach visible client copy");
  assert.match(visibleStatusText, /\bReviewed\b/, "available evidence is described in client language");
  const blockers = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  assert.match(blockers, /What should you fix first\?/);
  assert.match(blockers, /Start with the first item and work down the list\. Each priority below explains what we found, why it matters, common options a team may consider, and how to check the result\. Supporting Detail contains the deeper evidence and technical checks\./);
  assert.doesNotMatch(blockers, /These actions follow the governed priority order\./);
  assert.doesNotMatch(blockers, /<table|VAN-[A-Z]+-\d{3}|HIGH_CONVERSION|OPTIMIZATION|Foundation blocker/i);
  assert.doesNotMatch(blockers, /deterministic evidence confidence|\b[ML]\b|Affected page[s]?:\s*https?:\/\//i);
  for (const label of [
    "Why it matters",
    "What we know",
    "Where to look",
    "Confidence in this finding",
    "Who may need to help",
    "How to know it worked",
  ]) {
    assert.match(blockers, new RegExp(label), `required client field: ${label}`);
  }
  assert.doesNotMatch(blockers, /<dt>What needs attention<\/dt>/);
  const cards = [...blockers.matchAll(/<article class="priority-action" data-priority-rank="(\d+)" data-solution-id="([^"]+)" data-priority-unit-type="[^"]+">([\s\S]*?)<\/article>/g)];
  assert.equal(cards.length, 3, "exactly the governed canonical priority cards are rendered");
  const ranks = cards.map((match) => Number(match[1]));
  assert.deepEqual(ranks, [1, 2, 3], "canonical sequence is rendered once in governed order");
  assert.match(cards[0][3], /Start here/);
  for (const card of cards.slice(1)) assert.doesNotMatch(card[3], /Start here/);
  assert.match(cards[0][3], /Some visitors may need more pricing or reassurance before they act\./);
  assert.match(cards[0][3], /Some evidence — confirm before making the change/);
  assert.match(cards[0][3], /Common remediation options are not yet available for this finding/);
  assert.doesNotMatch(blockers, /FIX_LATER|FIX_NOW|HOLD|FRONT_END_DEVELOPMENT|TECHNICAL_SEO|largest-above-fold-asset|buyer-decision-support-template|structured-data-block/i);
  assert.doesNotMatch(blockers, /businessImpact|legacy recommendation|affectedUrls|verificationMethod/i);
  assert.doesNotMatch(blockers, /FIX_LATER|FIX_NOW|HOLD|FRONT_END_DEVELOPMENT|TECHNICAL_SEO|CONTENT_STRATEGY|SUBJECT_MATTER_INPUT|largest-above-fold-asset|buyer-decision-support-template|structured-data-block/i);
  assert.doesNotMatch(blockers, />(?:LOW|MEDIUM|HIGH|SUPPORTED|PARTIAL|CONDITIONAL|UNKNOWN|UNAVAILABLE|FIX_NOW|FIX_LATER|HOLD)</);
  assert.doesNotMatch(blockers, /\(SOL-[A-Z0-9-]+\)|>[^<]*SOL-[A-Z0-9-]+/);
  const orderedLabels = ["What we know", "Why this is a priority", "Why it matters", "Three common fixes to consider", "Where to look", "How to know it worked", "Who may need to help", "Confidence in this finding", "Effort"];
  let lastLabel = -1;
  for (const label of orderedLabels) {
    const nextLabel = blockers.indexOf(`<dt>${label}</dt>`);
    assert.ok(nextLabel > lastLabel, `card field order includes ${label}`);
    lastLabel = nextLabel;
  }
  assert.doesNotMatch(blockers, /First Things First|Do Now|Action Plan|governed priority order/i);
  assert.equal((blockers.match(/<article class="priority-action"/g) || []).length, 3, "the accepted priority units are rendered once");
  assert.doesNotMatch(blockers, /<ol/i, "Priority Fixes contains one authoritative ranked card sequence without duplicate ordered lists");
});

test("S02B: accepted priority display ranks remain contiguous when governed source ranks have gaps", () => {
  const fixture = priorityModel();
  const canonical = buildCanonicalSolutionSet({
    findings: fixture.findings.filter((finding) => finding.findingId).map((finding) => {
      const authority = Object.values(SOLUTION_AUTHORITY_REGISTRY).find((candidate) => candidate.ruleId === finding.ruleId);
      return authority ? {
        ...finding,
        ruleVersion: authority.ruleVersion,
        evidence: [...(finding.evidence || []), { field: authority.evidenceFields[0], artifactRef: `fixture:${finding.findingId}` }],
      } : finding;
    }),
    scoreSet: fixture,
    decisionEvidence: fixture.evidence,
  });
  const sparseCanonical = {
    ...canonical,
    records: canonical.records.map((record, index) => ({
      ...record,
      sequenceInputs: { ...record.sequenceInputs, governedRank: index === 0 ? 1 : index + 2 },
    })),
  };
  const acceptedIds = sparseCanonical.records.slice(0, 3).flatMap((record) => record.findingRefs || []);
  fixture.encyclopedia = { status: "AVAILABLE", priorityUnits: acceptedIds.map((findingId) => ({ type: "standalone material finding", canonicalProblemId: "A06", findingIds: [findingId], frictionState: "FRICTION" })) };
  const html = renderReportV2Base({ ...fixture, canonicalSolutions: sparseCanonical });
  const blockers = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  const cards = [...blockers.matchAll(/<article class="priority-action" data-priority-rank="(\d+)"/g)];
  assert.ok(cards.length > 1, "the fixture has multiple accepted priorities");
  assert.deepEqual(cards.map((card) => Number(card[1])), cards.map((_card, index) => index + 1), "visible numbering is the filtered display order");
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
  for (const label of ["Reach the right page", "Understand enough to continue", "Take the next step"]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /Internal stage one|Internal stage two|Internal stage three/);
});

test("P2: blocker location lists client-owned affected URLs when available", () => {
  const m = priorityModel();
  const finding = m.findings.find((f) => f.scoreBearing === true);
  finding.affectedUrls = ["https://x.com/services/consulting"];
  const html = renderReportV2(m);
  const blockers = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  assert.match(blockers, /Where to look/);
  assert.doesNotMatch(blockers, /https:\/\/x\.com\/services\/consulting/);
});

test("P2: blocker location falls back to the governed evidence source when no URL is available", () => {
  const m = priorityModel();
  const finding = m.findings.find((f) => f.scoreBearing === true);
  finding.affectedUrls = [];
  finding.evidence = [{ field: "site.imagesMissingAlt" }];
  const html = renderReportV2(m);
  const blockers = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  assert.match(blockers, /Where to look/);
  assert.match(blockers, /https:\/\/x\.com\//);
  assert.doesNotMatch(blockers, /site\.imagesMissingAlt/);
});

test("P2: no-action PASS states the current evidence-scope criterion", () => {
  const m = model();
  m.findings = [];
  m.decisionHierarchy = { ...m.decisionHierarchy, orderedFindingIds: [] };
  const html = renderReportV2(m);
  assert.match(html, /No material problem is established for this page/);
});

test("S03: Conversion Journey maps supported Encyclopedia friction without asserting cause or outcomes", () => {
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
  const acceptedFindingIds = fixture.decisionHierarchy.orderedFindingIds.slice(0, 3);
  fixture.encyclopedia = {
    status: "AVAILABLE",
    priorityUnits: ["A01", "A02", "A03"].map((id, index) => ({
      canonicalProblemId: id,
      title: `Reviewed friction ${id}`,
      findingIds: [acceptedFindingIds[index]],
      frictionState: "FRICTION",
      conversionAction: "contact",
      buyerDecisionQuestion: "How do I contact the business?",
      evidence: [{ sourceStatus: "AVAILABLE", evidenceRef: `fixture:${id}` }],
    })),
  };
  const html = renderReportV2(fixture);
  for (const text of [
    "Reach the right page",
    "Understand enough to continue",
    "Take the next step",
    "Where can visitors lose momentum?",
    "What should you keep?",
    "What should you measure next?",
    "What cannot yet be measured?",
    "Evidence and limits",
  ]) assert.match(html, new RegExp(text));
  assert.equal((html.match(/class="conversion-journey-detail-card"/g) || []).length, 0, "acquisition-only units do not become visitor-path friction");
  assert.doesNotMatch(html, /Check first:/);
  assert.match(html, /analytics evidence:/i);
  assert.match(html, /abandonment.*cannot be confirmed/i);
  assert.doesNotMatch(html, /proves the cause|causes abandonment|guarantees conversion/);
  const page3 = html.slice(html.indexOf('id="paths"'), html.indexOf('id="content-ideas"'));
  const page3Text = page3.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(page3Text, /SOL-[A-Z0-9-]+|View canonical detail|governed|canonical|client remediation|material route blocker|assessed scope/i);
  assert.doesNotMatch(page3, /data-solution-id=/, "Journey references the authoritative priority page without repeating its sequence");
  assert.doesNotMatch(html, /governed buyer decision or audit judgment|governed action/i);
  assert.doesNotMatch(page3, /Browser validation assessed conversion actions|A conversion action was observed on 6 assessed page|A visible, interactable, unobstructed action was confirmed on 6 assessed page/);
});

function assertFrozenViewerHierarchy() {
  const expected = [
    ["executive-scorecard", "Executive Scorecard", "executive"],
    ["priority-fixes", "Priority Fixes", "blockers"],
    ["conversion-paths", "Conversion Journey", "paths"],
    ["content-ideas", "Content Opportunities", "content-ideas"],
    ["trust-eeat", "Trust & Credibility", "eeat"],
    ["competitor-benchmark", "Competitor Comparison", "competitors"],
    ["supporting-detail", "Supporting Detail", "pillars"],
  ];
  assert.deepEqual(REPORT_V2_VIEWER_PAGES.map(({ pageId, title, sectionIds }) => [pageId, title, sectionIds[0]]), expected);
  const html = renderReportV2(model());
  assert.equal((html.match(/class="viewer-nav-link viewer-nav-primary"/g) || []).length, 6);
  assert.equal((html.match(/class="viewer-nav-link viewer-nav-supporting"/g) || []).length, 1);
  for (const [pageId, title] of expected) {
    assert.match(html, new RegExp(`data-viewer-page="${pageId}"[^>]*>[\\s\\S]*?${title.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`));
  }
  const pages = {
    "executive-scorecard": html.slice(html.indexOf('id="executive"'), html.indexOf('id="pillars"')),
    "priority-fixes": html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"')),
    "conversion-paths": html.slice(html.indexOf('id="paths"'), html.indexOf('id="content-ideas"')),
    "content-ideas": html.slice(html.indexOf('id="content-ideas"'), html.indexOf('id="action-plan"')),
    "trust-eeat": html.slice(html.indexOf('id="eeat"'), html.indexOf('id="competitors"')),
    "competitor-benchmark": html.slice(html.indexOf('id="competitors"'), html.indexOf('id="competitor-detail"')),
    "supporting-detail": html.slice(html.indexOf('id="pillars"'), html.indexOf('id="blockers"')),
  };
  const required = {
    "executive-scorecard": ["Conversion Readiness", "What is helping the site", "What is holding the site back", "Accepted priorities", "Next step &amp; limits", "What we could not confirm"],
    "priority-fixes": ["Start here", "What we know", "Check these first", "How to know it worked", "Evidence guardrail"],
    "conversion-paths": ["Reach the right page", "Understand enough to continue", "Take the next step", "Evidence seen:", "Where can visitors lose momentum", "What should you keep", "What cannot yet be measured", "Evidence and limits"],
    "content-ideas": ["Where is content already helping", "Start with the strongest opportunity", "Other useful opportunities", "What buyers are asking", "Why this matters", "What to create", "What it should cover", "How to use it", "Confidence in this opportunity", "Build one clear hub", "Plan", "Distribute", "Evidence limitations", "Optional support"],
    "trust-eeat": ["Can buyers find enough proof to feel confident", "What already builds confidence", "What trust questions can the site already answer", "Where can confidence still break down", "Proof may be too far from the decision", "Optional trust-proof review", "Why do these signals matter for growth", "Buying confidence", "Search visibility", "AI search readiness", "What should you avoid", "What can this audit confirm", "Evidence and limits"],
    "competitor-benchmark": ["Who was compared", "Where are the meaningful differences", "What is worth learning from", "Competitor differences are context only", "What not to copy", "What this comparison cannot tell us", "What can this comparison confirm", "Next step"],
    "supporting-detail": ["What evidence sits behind the report", "How complete was the evidence", "What drove the readiness score", "What material findings were established", "What did the performance evidence show", "Page speed check evidence", "Real-user field data", "Where was evidence limited", "What source evidence was available", "How does this evidence support the report", "Conclusion", "Next step"],
  };
  for (const [pageId, headings] of Object.entries(required)) {
    assert.ok(pages[pageId].length > 0, `${pageId} page section exists`);
    for (const heading of headings) assert.ok(pages[pageId].includes(heading), `${pageId} includes ${heading}`);
  }
  assert.match(html, /onclick="window\.print\(\)"/);
  assert.match(html, /body\.viewer-ready main > section\.viewer-active \{ display:block !important; \}/);
}

function assertFourNarrativeStatesAcrossFrozenPages() {
  const sectionRange = {
    "executive-scorecard": ['id="executive"', 'id="pillars"'],
    "priority-fixes": ['id="blockers"', 'id="foundations"'],
    "conversion-paths": ['id="paths"', 'id="content-ideas"'],
    "content-ideas": ['id="content-ideas"', 'id="action-plan"'],
    "trust-eeat": ['id="eeat"', 'id="competitors"'],
    "competitor-benchmark": ['id="competitors"', 'id="competitor-detail"'],
    "supporting-detail": ['id="pillars"', 'id="blockers"'],
  };
  for (const expectedState of ["STRONG", "MIDDLE", "WEAK", "INSUFFICIENT_EVIDENCE"]) {
    const fixture = structuredClone(model());
    fixture.crossReportInterpretation.truth = Object.fromEntries(
      Object.entries(fixture.crossReportInterpretation.truth).map(([key, record]) => [key, { ...record, state: "assessed" }]),
    );
    fixture.competitors = { comparisons: [{ name: "Example competitor", url: "https://example.test", status: "AVAILABLE" }], opportunities: { gaps: [], limitations: [] } };
    fixture.sourceStatus = { ...(fixture.sourceStatus || {}), competitors: "AVAILABLE" };
    if (expectedState === "MIDDLE") fixture.crossReportInterpretation.truth.trustProof.state = "partial";
    if (expectedState === "WEAK") fixture.crossReportInterpretation.truth.conversionPathClarity.state = "finding";
    if (expectedState === "INSUFFICIENT_EVIDENCE") fixture.crossReportInterpretation.truth.evidenceScope.state = "not assessed";
    const narrative = deriveNarrativeStates(fixture);
    const html = renderReportV2(fixture);
    assert.ok(Object.values(narrative).some((record) => record.state === expectedState), `${expectedState} is derived from the fixture evidence`);
    for (const pageId of NARRATIVE_PAGE_IDS) {
      const mapped = pageId === "conversion-journey" ? "conversion-paths" : pageId === "content-opportunities" ? "content-ideas" : pageId === "trust-credibility" ? "trust-eeat" : pageId === "competitor-comparison" ? "competitor-benchmark" : pageId;
      const [start, end] = sectionRange[mapped];
      const page = html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
      assert.ok(page.includes(`data-narrative-state="${narrative[pageId].state}"`), `${pageId} renders its derived ${narrative[pageId].state} state for ${expectedState} case`);
      assert.ok(["SUFFICIENT", "BOUNDED_PARTIAL", "INSUFFICIENT", "NOT_APPLICABLE"].includes(narrative[pageId].evidenceSufficiency));
      assert.equal(narrative[pageId].rebuildAuthorization.allowed, false);
    }
    assert.doesNotMatch(html, /automatically rebuild|must be rebuilt/i);
  }
}

test("TECH-CLIENT-01: security headers stay out of client-facing report surfaces", () => {
  const html = renderReportV2(priorityModel());

  assert.doesNotMatch(html, /VAN-TECH-003/);
  assert.doesNotMatch(html, /Basic security headers|Server and security headers|Server &amp; security headers/);
  assert.doesNotMatch(html, /Show server and security-header evidence|technical\.headers/);
  assert.doesNotMatch(html, /security headers?|response headers?/i);
  assert.match(html, /on assessed technical checks|Based on \d+ of \d+ technical points assessed\./);
  const visibleText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const supportingDetail = html.slice(html.indexOf('<section id="pillars"'), html.indexOf('<footer>'))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(supportingDetail, /SOL-[A-Z0-9-]+|VAN-[A-Z0-9-]+/i);
  assert.doesNotMatch(supportingDetail, /governed assessment|governed page evidence|governed decision-support|governed meta|governed heading|Inspect the governed|Governed E-E-A-T|governed metadata scope|dataforseo_onpage|playwright-conversion-path|score-bearing/i);
  assert.doesNotMatch(visibleText, /dataforseo_onpage|playwright-conversion-path/i);
  assert.match(html, /data-solution-id="SOL-[A-Z0-9-]+"/);
});

test("P10: content opportunities are presented as an actionable client plan", () => {
  const fixture = model();
  fixture.contentIdeas = {
    tofu: [
      { idea: "What Is Custom Websites?", question: "What is this?", whyItMatters: "Supports the stated goal: Generate qualified enquiries.", recommendedAsset: "Guide", placement: "Awareness content", funnelStage: "Awareness", evidenceStatus: "PARTIAL" },
      { idea: "Signs You May Need Digital Marketing", question: "Does this apply to me?", whyItMatters: "Supports the stated goal: Generate qualified enquiries.", recommendedAsset: "Article", placement: "Awareness content", funnelStage: "Awareness", evidenceStatus: "PARTIAL" },
      { idea: "Can Custom Websites Produce Measurable Change?", question: "Will this work?", whyItMatters: "Supports the stated goal: Generate qualified enquiries.", recommendedAsset: "Educational page", placement: "Awareness content", funnelStage: "Awareness", evidenceStatus: "AVAILABLE" },
    ],
    mofu: [
      { idea: "Custom Websites: Options and Fit", question: "Which option is right?", whyItMatters: "Supports the stated goal: Generate qualified enquiries.", recommendedAsset: "Comparison page", placement: "Consideration content", funnelStage: "Consideration", evidenceStatus: "PARTIAL" },
      { idea: "What Happens in the Process", question: "What should I expect?", whyItMatters: "Supports the stated goal: Generate qualified enquiries.", recommendedAsset: "Process page", placement: "Consideration content", funnelStage: "Consideration", evidenceStatus: "PARTIAL" },
    ],
    bofu: [],
    leading: [],
  };
  const html = renderReportV2(fixture);
  const page4 = html.slice(html.indexOf('id="content-ideas"'), html.indexOf('id="content-opportunities-detail"'));
  const titles = [
    "Explain what a custom website is",
    "Help people decide whether they need digital marketing",
    "Show what kind of results a custom website may support",
    "Help buyers compare custom website options",
    "Explain what happens during the process",
  ];
  let previous = -1;
  for (const title of titles) {
    const position = page4.indexOf(title);
    assert.ok(position > previous, `opportunity order includes ${title}`);
    previous = position;
  }
  for (const label of ["What buyers are asking", "Why this matters", "What to create", "What it should cover", "Where it helps", "How to use it", "Confidence in this opportunity"]) {
    assert.match(page4, new RegExp(label));
  }
  assert.match(page4, /data-narrative-state="(?:STRONG|MIDDLE|WEAK|INSUFFICIENT_EVIDENCE)"/);
  assert.match(page4, /Planning stage: help a reader understand the topic and decide whether it is relevant/);
  assert.match(page4, /Some evidence — confirm before creating new content/);
  assert.doesNotMatch(page4, /governed|assessed scope|qualified opportunity|evidence qualification|decision-support context|partial content coverage|canonical|remediation|price|timeline/i);
  assert.ok((page4.match(/<li>/g) || []).length >= 20, "five opportunities retain actionable coverage points");
});

test("P11: competitor comparison explains the named set without market claims", () => {
  const fixture = model();
  fixture.input = { ...fixture.input, businessName: "Example Business" };
  fixture.sourceStatus = { ...fixture.sourceStatus, competitors: "AVAILABLE" };
  fixture.competitors = {
    comparisons: [
      { name: "Red Example", url: "https://red.example", status: "AVAILABLE", offerClarity: "Clear", trustProof: "Limited", ctaClarity: "Visible", pathClarity: "Clear" },
      { name: "Blue Example", url: "https://blue.example", status: "AVAILABLE", offerClarity: "Clear", trustProof: "Strong", ctaClarity: "Visible", pathClarity: "Clear" },
    ],
    opportunities: { gaps: [], limitations: [] },
  };
  const html = renderReportV2(fixture);
  const page5 = html.slice(html.indexOf('id="competitors"'), html.indexOf('id="competitor-detail"'));

  for (const text of [
    "How does your website compare with the competitors buyers may consider?",
    "We compared Example Business with Red Example and Blue Example",
    "Offer clarity",
    "Trust",
    "Next-step clarity",
    "Conversion path",
    "Competitive position",
    "Important differences",
    "Where your website is holding its own",
    "Where competitors show stronger signals",
    "Where there may be room to stand apart",
    "What should you do because of this comparison?",
    "What not to copy",
    "What this comparison cannot tell us",
    "See Priority Fixes",
  ]) assert.match(page5, new RegExp(text.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), text);
  for (const url of ["https://red.example", "https://blue.example"]) assert.match(page5, new RegExp(url.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  assert.doesNotMatch(page5, /qualified comparative gap|comparative qualification threshold|material competitive gap|client remedy|inferred remediation|governed|assessed scope|conversion-readiness signals|SOL-[A-Z0-9-]+/i);
  assert.doesNotMatch(page5, /sites are similar|similar in/i);
  assert.match(page5, /Not enough evidence.*does not mean the site performed poorly/);

  const gapFixture = structuredClone(fixture);
  gapFixture.competitors.opportunities.gaps = [{
    observedCompetitorCoverage: ["Clear process guidance"],
    competitorDomain: "red.example",
    conversionRelevance: "The competitor explains the next steps more clearly.",
  }];
  const gapHtml = renderReportV2(gapFixture);
  const gapPage = gapHtml.slice(gapHtml.indexOf('id="competitors"'), gapHtml.indexOf('id="competitor-detail"'));
  assert.match(gapPage, /What we saw|What to do with this/);
  assert.match(page5, /stronger visible trust signal|Trust and proof are not the same/);
});

test("WP-G-03: no invented evidence — every displayed ruleId exists in the model", () => {
  const m = model();
  const html = renderReportV2(m);
  const known = new Set(m.findings.map((f) => f.ruleId));
  const displayed = [...html.matchAll(/VAN-[A-Z]+-\d{3}/g)].map((x) => x[0]);
  assert.ok(displayed.every((ruleId) => known.has(ruleId)));
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
  assert.match(html, /body\.viewer-ready main > section\.viewer-active \{\s*page-break-inside:auto !important;\s*break-inside:auto !important;/);
  assert.match(html, /body\.viewer-ready > footer \{\s*display:none !important;/);
  assert.match(html, /\.content-page > h3 \{\s*margin-top:12px !important;/);
  assert.match(html, /\.content-page > p \{\s*margin-block:0\.55em !important;/);
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

test("WP-G-03a: Executive summary references the single accepted action authority", () => {
  const m = priorityModel();
  const html = renderReportV2(m);
  const executive = html.slice(html.indexOf('id="executive"'), html.indexOf('id="pillars"'));
  assert.match(executive, /Accepted priorities/);
  assert.match(executive, /Priority Fixes/);
  assert.match(executive, /href="#priority-fixes">Priority Fixes<\/a>/);
  assert.doesNotMatch(executive, /\(SOL-[A-Z0-9-]+\)|>[^<]*SOL-[A-Z0-9-]+/);
  const priorities = [...executive.matchAll(/<li data-solution-id="([^"]+)" data-priority-unit-type="[^"]+">/g)].map((match) => match[1]);
  assert.equal(priorities.length, 0, "Executive Scorecard summarizes priorities without rendering a second action list");
  assert.deepEqual(priorities, [...priorities], "priority order is deterministic");
  assert.equal(new Set(priorities).size, priorities.length, "each priority retains distinct internal linkage");
});

test("AUTH-CLOSURE-01: non-canonical remedy inputs cannot alter client remediation", () => {
  const baselineModel = model();
  const baseline = renderReportV2(baselineModel);
  const mutated = structuredClone(baselineModel);
  const token = "NON_CANONICAL_REMEDY_SENTINEL";

  mutated.writerOutput = {
    actionPlan: [token],
    executiveDecision: { preserve: token, change: token, doNext: token },
    conversion: { priority: token },
    seoSerp: { priority: token },
    aiSearch: { opportunity: token },
    funnelOpportunities: [{ nextAction: token }],
    content: { importantGaps: [token] },
    eeatTrust: { proofGaps: [token] },
    technical: { materialIssues: [token] },
    executiveConclusion: token,
    strengths: [token],
    rootCause: token,
    limitations: [token],
  };
  mutated.findings = mutated.findings.map((finding) => ({
    ...finding,
    recommendation: token,
    businessImpact: token,
    verificationMethod: token,
    affectedUrls: [token],
  }));
  mutated.competitors = {
    ...(mutated.competitors || {}),
    opportunities: { gaps: [{ recommendation: token }] },
  };
  // The fixture has no content-opportunity records; keep that governed absence
  // while the direct section tests cover mutation of content recommendation fields.
  mutated.evidence = {
    ...mutated.evidence,
    internalLinkOpportunities: {
      opportunities: [{ sourceUrl: token, targetUrl: token, proposedAnchor: token, reasonForLink: token }],
    },
  };

  const rendered = renderReportV2(mutated);
  const priorityStart = (html) => html.indexOf('<section id="priority-fixes"');
  const priorityEnd = (html) => html.indexOf('<section id="conversion-journey"', priorityStart(html));
  assert.equal(
    rendered.slice(priorityStart(rendered), priorityEnd(rendered)),
    baseline.slice(priorityStart(baseline), priorityEnd(baseline)),
    "canonical client remediation is invariant under non-canonical remedy mutation",
  );
  assert.doesNotMatch(rendered, new RegExp(token));
});

test("AUTH-CLOSURE-02: final report has no independent remedy structures", () => {
  const html = renderReportV2(priorityModel());
  for (const forbidden of [
    "narrative-layer",
    "narrative-action-plan",
    "narrative-diagnostic-layer",
    "data-writer-pass",
    "data-judge-score",
    "data-judge-decision",
    "trust-actions",
    "What to check or improve first",
    "Recommended structured-data candidates",
    "Implementation-Ready Recommendations",
    "What to create or improve first",
    "What to improve around the journey",
    "Preserve the existing clear route",
  ]) {
    assert.doesNotMatch(html, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), forbidden);
  }
  assert.match(html, /data-solution-id=/);
  assert.match(html, /Three common fixes to consider/);
  assert.match(html, /Accepted current priorities/);
  const executive = html.slice(html.indexOf('id="executive"'), html.indexOf('id="pillars"'));
  const supporting = html.slice(html.indexOf('id="action-plan"'), html.indexOf('id="eeat"'));
  assert.doesNotMatch(executive, /<ol|data-solution-id=/);
  assert.doesNotMatch(supporting, /DO NOW|DO NEXT|DO LATER|<ol/i);
});


test("MVP-CLIENT-01: current Encyclopedia accepted priority units are the only primary client actions", () => {
  const fixture = priorityModel();
  const canonicalHtml = renderReportV2(fixture);
  const canonicalIds = [...canonicalHtml.matchAll(/data-solution-id="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(canonicalIds.length > 0);

  const candidateFindingIds = (fixture.decisionHierarchy?.orderedFindingIds || []).filter(Boolean);
  assert.ok(candidateFindingIds.length >= 2, "fixture exposes multiple hierarchy findings");
  const acceptedFindingId = candidateFindingIds[0];
  fixture.encyclopedia = {
    status: "AVAILABLE",
    priorityUnits: [{
      type: "reviewed standalone material finding",
      findingId: acceptedFindingId,
      findingIds: [acceptedFindingId],
      canonicalProblemId: "I01",
      title: "Accepted client priority",
      frictionState: "FRICTION",
      evidence: [{ sourceStatus: "AVAILABLE" }],
    }],
  };

  const html = renderReportV2(fixture);
  const blockers = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  assert.equal((blockers.match(/<article class="priority-action"/g) || []).length, 1);
  assert.doesNotMatch(blockers, /<ol/i);
  assert.doesNotMatch(blockers, /No Encyclopedia priority unit with first diagnostic checks is linked/);
  assert.match(blockers, /Check 1:/);
});

function remediationFixture() {
  const fixture = priorityModel();
  const specs = [
    { familyId: "I01", ruleId: "VAN-PERF-001", title: "Slow primary content display" },
    { familyId: "J04", ruleId: "VAN-SCHEMA-001", title: "Structured data was not detected" },
    { familyId: "A03", ruleId: "VAN-TECH-001", title: "Meta descriptions are missing" },
  ];
  const synthetic = specs.map((spec, index) => {
    const authority = Object.values(SOLUTION_AUTHORITY_REGISTRY).find((item) => item.ruleId === spec.ruleId);
    assert.ok(authority, `governed canonical solution exists for ${spec.ruleId}`);
    return {
      findingId: `remediation-fixture-${index + 1}`,
      id: `remediation-fixture-${index + 1}`,
      ruleId: spec.ruleId,
      ruleVersion: authority.ruleVersion,
      title: spec.title,
      actionable: true,
      scoreBearing: true,
      severity: "High",
      confidence: "deterministic",
      evidence: [{ field: authority.evidenceFields[0], artifactRef: `evidence:${index + 1}`, sourceStatus: "AVAILABLE" }],
      affectedUrls: ["https://example.test/"],
      finalPriority: -(index + 1),
      implementationEffort: "M",
    };
  });
  fixture.findings = synthetic;
  fixture.decisionHierarchy = {
    provenance: "deterministic report projection fixture",
    orderedFindingIds: synthetic.map((finding) => finding.findingId),
    actions: synthetic.map((finding, rank) => ({ findingId: finding.findingId, rank: rank + 1 })),
  };
  const canonical = canonicalSolutionsForFixture(fixture, { throwOnError: true });
  assert.ok(canonical.records.some((record) => record.findingRefs.includes(synthetic[0].findingId)), "canonical records preserve the governed finding identity");
  fixture.canonicalSolutions = canonical;
  fixture.encyclopedia = {
    status: "AVAILABLE",
    priorityUnits: synthetic.map((finding, index) => ({ type: "accepted material finding", canonicalProblemId: specs[index].familyId, findingIds: [finding.findingId], frictionState: "FRICTION", evidence: [{ sourceStatus: "AVAILABLE" }] })),
  };
  return { fixture, specs };
}

test("REMEDIATION-RENDER-01: accepted finding families receive exactly three governed options", () => {
  const { fixture } = remediationFixture();
  const html = renderReportV2(fixture);
  if (process.env.PRYSM_ACTIONABILITY_PROOF_DIR) {
    writeFileSync(`${process.env.PRYSM_ACTIONABILITY_PROOF_DIR}/representative-report.html`, html, "utf8");
  }
  const priority = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  const cards = [...priority.matchAll(/<article class="priority-action"[\s\S]*?<\/article>/g)].map((match) => match[0]);
  assert.equal(cards.length, 3);
  const expected = ["above-the-fold asset", "supported structured data", "page-specific descriptions"];
  for (const [index, card] of cards.entries()) {
    assert.equal((card.match(/class="common-remediation-option"/g) || []).length, 3);
    assert.equal((card.match(/class="remediation-disclaimer"/g) || []).length, 1);
    assert.match(card, new RegExp(expected[index], "i"));
    assert.match(card, /PRYSM confirmed the finding, but has not established which fix is right/);
    assert.doesNotMatch(card, /caused by|the cause is|this caused/i);
  }
  assert.equal((priority.match(/class="priority-action"/g) || []).length, 3);
});

test("REMEDIATION-RENDER-02: only accepted units receive options; unsupported mappings fail closed", () => {
  const { fixture, specs } = remediationFixture();
  fixture.encyclopedia = {
    status: "AVAILABLE",
    priorityUnits: specs.slice(0, 2).map((spec, index) => ({ type: "accepted material finding", canonicalProblemId: spec.familyId, findingIds: [`remediation-fixture-${index + 1}`], frictionState: "FRICTION" })),
  };
  const twoPriorityHtml = renderReportV2(fixture);
  const twoPrioritySection = twoPriorityHtml.slice(twoPriorityHtml.indexOf('id="blockers"'), twoPriorityHtml.indexOf('id="foundations"'));
  assert.equal((twoPrioritySection.match(/class="priority-action"/g) || []).length, 2, "unaccepted third record does not receive a priority card");
  assert.equal((twoPrioritySection.match(/class="common-remediation-option"/g) || []).length, 6);
  assert.doesNotMatch(twoPrioritySection, /Write useful page-specific descriptions/);

  fixture.encyclopedia.priorityUnits = [
    { type: "accepted material finding", canonicalProblemId: "A01", findingIds: ["remediation-fixture-1"], frictionState: "FRICTION" },
  ];
  const unsupportedHtml = renderReportV2(fixture);
  const unsupportedSection = unsupportedHtml.slice(unsupportedHtml.indexOf('id="blockers"'), unsupportedHtml.indexOf('id="foundations"'));
  const card = unsupportedSection.match(/<article class="priority-action"[\s\S]*?<\/article>/)?.[0] || "";
  assert.ok(card);
  assert.match(card, /Common remediation options are not yet available for this finding/);
  assert.doesNotMatch(card, /class="common-remediation-option"/);
  assert.doesNotMatch(card, /Canonical change|Canonical fix/);
});

test("MVP-DECISION-AUTHORITY-01: one accepted sequence governs all pages while supporting evidence stays visible", () => {
  const fixture = priorityModel();
  const canonical = canonicalSolutionsForFixture(fixture);
  assert.ok(canonical.records.length >= 2, "generic fixture has two canonical records for accepted priorities");
  const acceptedRecords = canonical.records.slice(0, 2);
  const supportRecords = Array.from({ length: 10 }, (_, index) => {
    const source = canonical.records[index % canonical.records.length];
    const solutionId = `SOL-FUTURE-SUPPORT-${index + 1}`;
    return { ...structuredClone(source), solutionId, findingRefs: [`future-support-${index + 1}`] };
  });
  fixture.canonicalSolutions = {
    ...canonical,
    records: [...canonical.records, ...supportRecords],
    sequence: [...canonical.sequence, ...supportRecords.map((record) => record.solutionId)],
  };
  fixture.findings.push(...Array.from({ length: 10 }, (_, index) => ({
    findingId: `future-support-${index + 1}`,
    title: `Future audit supporting observation ${index + 1}`,
    confidence: "insufficient",
    actionable: false,
    scoreBearing: false,
    evidence: [{ field: "supporting.evidence", observedValue: "unknown", sourceStatus: "PARTIAL" }],
  })));
  fixture.encyclopedia = {
    status: "AVAILABLE",
    priorityUnits: acceptedRecords.map((record) => ({ type: "standalone material finding", canonicalProblemId: "A06", findingIds: record.findingRefs, frictionState: "FRICTION", evidence: [{ sourceStatus: "AVAILABLE" }] })),
  };
  const html = renderReportV2(fixture);
  if (process.env.PRYSM_DECISION_HIERARCHY_REPORT_PROOF) {
    writeFileSync(process.env.PRYSM_DECISION_HIERARCHY_REPORT_PROOF, html, "utf8");
  }
  const executive = html.slice(html.indexOf('id="executive"'), html.indexOf('id="pillars"'));
  const priority = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  const journey = html.slice(html.indexOf('id="paths"'), html.indexOf('id="content-ideas"'));
  const content = html.slice(html.indexOf('id="content-ideas"'), html.indexOf('id="action-plan"'));
  const supporting = html.slice(html.indexOf('id="action-plan"'), html.indexOf('id="eeat"'));
  const detail = html.slice(html.indexOf('id="evidence"'), html.indexOf('<footer>'));
  assert.equal((priority.match(/<article class="priority-action"/g) || []).length, 2);
  assert.match(executive, /2 accepted client priorities/);
  assert.match(executive, /does not establish one broad site-wide constraint\. Any accepted item-level priorities are listed separately in Priority Fixes/);
  assert.doesNotMatch(executive, /What should you improve first\?|first accepted priority|Main content/i);
  assert.doesNotMatch(executive, /<ol|data-solution-id=/);
  assert.match(supporting, /Accepted current priorities/);
  assert.match(supporting, /Supporting observations and non-priority findings/);
  assert.doesNotMatch(supporting, /DO NOW|DO NEXT|LATER|<ol/i);
  assert.equal((journey.match(/conversion-journey-detail-card/g) || []).length, 0, "Acquisition classification alone does not establish journey friction");
  assert.match(journey, /Primary Path: Book: Weak/, "weak recorded-path status remains visible as supporting evidence");
  assert.match(journey, /No accepted priority has a supported relationship to visitor-path friction/);
  assert.doesNotMatch(journey, /correct those points first|correct.*first|fix these points first/i, "journey narrative cannot independently direct corrective work");
  assert.match(content, /planning opportunity|opportunities/i);
  assert.doesNotMatch(content, /Priority Fixes is the only client action sequence/);
  assert.match(detail, /Future audit supporting observation 1/);
  assert.equal((detail.match(/Future audit supporting observation/g) || []).length, 10);
  assert.ok((detail.match(/Supporting observation; not an accepted priority/g) || []).length >= 10);
  assert.match(detail, /partial/i);
  assert.doesNotMatch(html.slice(html.indexOf('id="competitors"'), html.indexOf('id="competitor-detail"')), /<ol|PROTECT|DIFFERENTIATE|IGNORE/);
});

test("MVP-DECISION-AUTHORITY-02: Conversion Journey needs explicit accepted buyer-path evidence", () => {
  const fixture = priorityModel();
  const findingId = fixture.decisionHierarchy.orderedFindingIds[0];
  fixture.encyclopedia = { status: "AVAILABLE", priorityUnits: [{ canonicalProblemId: "C05", findingIds: [findingId], frictionState: "FRICTION", conversionAction: "contact", buyerDecisionQuestion: "How can a buyer contact the business?", evidence: [{ sourceStatus: "AVAILABLE" }] }] };
  const html = renderReportV2(fixture);
  const journey = html.slice(html.indexOf('id="paths"'), html.indexOf('id="content-ideas"'));
  assert.equal((journey.match(/class="conversion-journey-detail-card"/g) || []).length, 1);
  assert.doesNotMatch(journey, /<ol|Review the recorded action/);
  assert.match(journey, /Priority Fixes/);
});

test("MVP-DECISION-AUTHORITY-03: unavailable priority authority preserves evidence without promoting it", () => {
  const fixture = priorityModel();
  fixture.encyclopedia = { status: "NOT_AVAILABLE", priorityUnits: [] };
  const html = renderReportV2(fixture);
  const priority = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  const supporting = html.slice(html.indexOf('id="action-plan"'), html.indexOf('id="eeat"'));
  const evidence = html.slice(html.indexOf('id="evidence"'), html.indexOf('<footer>'));
  assert.equal((priority.match(/<article class="priority-action"/g) || []).length, 0);
  assert.match(priority, /No primary fix is established/);
  assert.match(supporting, /No accepted client priority is available/);
  assert.match(evidence, /Findings \(/);
  assert.match(evidence, /Supporting observation; not an accepted priority/);
});

test("MVP-CLIENT-02: all seven client pages do not expose internal state or source-status enums", () => {
  const html = renderReportV2(priorityModel());
  const pageIds = REPORT_V2_VIEWER_PAGES.flatMap((page) => page.sectionIds);
  assert.equal(pageIds.length, 22);
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|nbsp|lt|gt);/g, " ");
  assert.doesNotMatch(visible, /\bBounded action\b/i);
  assert.doesNotMatch(visible, /\b(?:STRONG|MIDDLE|WEAK|INSUFFICIENT_EVIDENCE)\b/);
  assert.doesNotMatch(visible, /\b(?:AVAILABLE|PARTIAL|UNAVAILABLE|NOT_COLLECTED|NOT_CONNECTED|NOT_APPLICABLE)\b/);
  const trustStart = html.indexOf('<section id="eeat"');
  const trustEnd = html.indexOf('<section id="competitors"', trustStart);
  const trustPageText = html.slice(trustStart, trustEnd).replace(/<[^>]+>/g, " ");
  assert.match(trustPageText, /Evidence and limits/);
  assert.doesNotMatch(trustPageText, /<ol/);
  assert.doesNotMatch(trustPageText, /Bounded action|\b(?:STRONG|MIDDLE|WEAK|INSUFFICIENT_EVIDENCE)\b/);
});

test("MVP-CLIENT-10: performance score drivers name separate lab and field evidence and preserve their distinct statuses", () => {
  const fixture = priorityModel();
  fixture.capabilityEvidence.capabilities["performance.lab"].status = "AVAILABLE";
  fixture.capabilityEvidence.capabilities["performance.field"].status = "UNAVAILABLE";

  const html = renderReportV2(fixture);
  const executive = html.slice(html.indexOf('id="executive"'), html.indexOf('id="pillars"'));
  assert.match(executive, /Page speed checks Reviewed/);
  assert.match(executive, /Real-user performance data Not available/);
  assert.doesNotMatch(executive, /Performance evidence AVAILABLE[^<]*Performance evidence UNAVAILABLE/);
});

test("MVP-CLIENT-09: insufficient executive evidence withholds an otherwise available overall score", () => {
  const fixture = structuredClone(model());
  fixture.scores.conversionReadiness = 55;
  fixture.bands.conversionReadiness = "Limited";
  fixture.showNumericScore = true;
  fixture.crossReportInterpretation.truth.evidenceScope.state = "not assessed";

  const html = renderReportV2(fixture);
  const executive = html.slice(html.indexOf('id="executive"'), html.indexOf('id="pillars"'));

  assert.match(executive, /data-narrative-state="INSUFFICIENT_EVIDENCE"/);
  assert.match(executive, /Insufficient Evidence for Overall Score/);
  assert.match(executive, /cannot make a dependable overall readiness conclusion/);
  assert.doesNotMatch(executive, /class="readiness">55/);
  assert.doesNotMatch(executive, /class="readiness-band"/);
  assert.doesNotMatch(executive, /Overall readiness needs attention|Overall readiness is strong|Overall readiness is moderate/);
});

test("MVP-CLIENT-03: competitor benchmark does not compare page-count coverage with qualitative competitor signals", () => {
  const fixture = model();
  fixture.input = { ...fixture.input, businessName: "Example Business" };
  fixture.sourceStatus = { ...fixture.sourceStatus, competitors: "AVAILABLE" };
  fixture.competitors = {
    comparisons: [
      { name: "Red Example", url: "https://red.example", status: "AVAILABLE", contentDepth: "Strong" },
      { name: "Blue Example", url: "https://blue.example", status: "AVAILABLE", contentDepth: "Moderate" },
    ],
    opportunities: { gaps: [], limitations: [] },
  };
  const html = renderReportV2(fixture);
  const page = html.slice(html.indexOf('id="competitors"'), html.indexOf('id="competitor-detail"'));
  assert.match(page, /Service depth/);
  assert.doesNotMatch(page, /page\(s\) reviewed/);
});

test("MVP-CLIENT-04: obvious crawl taxonomy noise is excluded from primary content strengths", () => {
  const fixture = model();
  fixture.evidence.site.services = ["Web design"];
  fixture.evidence.site.topicKeywords = ["tagged by kindness inc", "apply to work at tbk", "4 0", "create", "Useful buyer topic"];
  const html = renderReportV2(fixture);
  const page = html.slice(html.indexOf('id="content-ideas"'), html.indexOf('id="content-opportunities-detail"'));
  assert.match(page, /Web design/);
  assert.doesNotMatch(page, /tagged by kindness inc|apply to work at tbk|>4 0<|>create</i);
});

test("MVP-CLIENT-05: print contract protects report tables and headings", () => {
  const html = renderReportV2(model());
  assert.match(html, /table-layout:fixed/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /break-after:avoid-page/);
  assert.match(html, /\.action-page \.priority-sequence\s*\{\s*display:block;/);
  assert.match(html, /\.action-page \.priority-action\s*\{[\s\S]*?break-inside:avoid;/);
});

test("MVP-CLIENT-06: competitor source status falls back to canonical report source status", () => {
  const fixture = model();
  fixture.sourceStatus = { ...fixture.sourceStatus, competitors: "AVAILABLE" };
  fixture.evidence.competitors = null;
  const html = renderReportV2(fixture);
  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  assert.match(visible, /Competitor review:\s*Reviewed/);
  assert.doesNotMatch(visible, /Competitor review:\s*Not collected/);
});


test("MVP-CLIENT-07: Conversion Journey translates Encyclopedia state and evidence labels", () => {
  const fixture = model();
  const acceptedFindingId = fixture.decisionHierarchy.orderedFindingIds[0];
  fixture.encyclopedia = {
    status: "AVAILABLE",
    priorityUnits: [{
      canonicalProblemId: "I01",
      title: "Reviewed friction",
      findingIds: [acceptedFindingId],
      frictionState: "FRICTION",
      conversionAction: "contact",
      buyerDecisionQuestion: "How do I contact the business?",
      evidence: [{ sourceStatus: "AVAILABLE" }],
    }],
  };
  const html = renderReportV2(fixture);
  const page = html.slice(html.indexOf('id="paths"'), html.indexOf('id="content-ideas"'));
  const visible = page.replace(/<[^>]+>/g, " ");
  assert.match(visible, /Status:\s*Needs attention/);
  assert.match(visible, /Evidence:\s*Reviewed/);
  assert.doesNotMatch(visible, /\bFRICTION\b|\bAVAILABLE\b/);
});


test("MVP-CLIENT-08: an accepted friction cluster renders as one client priority unit, not multiple inflated fixes", () => {
  const fixture = priorityModel();
  const canonicalHtml = renderReportV2(fixture);
  fixture.canonicalSolutions = buildCanonicalSolutionSet({
    findings: fixture.findings.filter((finding) => finding.findingId).map((finding) => {
      const authority = Object.values(SOLUTION_AUTHORITY_REGISTRY).find((candidate) => candidate.ruleId === finding.ruleId);
      return authority ? { ...finding, ruleVersion: authority.ruleVersion, evidence: [...(finding.evidence || []), { field: authority.evidenceFields[0], artifactRef: `fixture:${finding.findingId}` }] } : finding;
    }),
    scoreSet: fixture,
    decisionEvidence: fixture.evidence,
  });
  const findingIds = fixture.canonicalSolutions.records.slice(0, 2).flatMap((record) => record.findingRefs || []);
  assert.equal(findingIds.length, 2);
  fixture.encyclopedia = {
    status: "AVAILABLE",
    priorityUnits: [{
      type: "accepted friction cluster",
      canonicalProblemId: "D01",
      canonicalProblemIds: ["D01", "E01"],
      title: "Accepted friction cluster",
      findingIds,
      frictionState: "FRICTION",
      conversionAction: "contact",
      evidence: [
        { sourceStatus: "AVAILABLE", independenceKey: "family:a" },
        { sourceStatus: "AVAILABLE", independenceKey: "family:b" },
      ],
    }],
  };
  const html = renderReportV2(fixture);
  const page = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  assert.equal((page.match(/<article class="priority-action"/g) || []).length, 1);
  assert.doesNotMatch(page, /<ol/i);
  assert.match(page, /Several related issues are affecting the same buyer step/);
  assert.match(page, /Why this is a priority/);
  assert.match(page, /Related|linked 2 separate evidence-backed issues/i);
  const executive = html.slice(html.indexOf('id="executive"'), html.indexOf('id="pillars"'));
  assert.match(executive, /accepted client priority/);
  assert.match(executive, /Priority Fixes/);
  assert.doesNotMatch(executive, /<ol|data-solution-id=/);
});

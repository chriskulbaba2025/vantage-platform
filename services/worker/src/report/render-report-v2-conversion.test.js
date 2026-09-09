/**
 * PRYSM-V2-REPORT-DEPTH-01 — conversion-first Section E + governed report depth.
 *
 * Proof-first suite (frozen checklist CR-01..CR-27, see
 * .governance/changes/PRYSM-V2-REPORT-DEPTH-01_CHECKLIST.md).
 *
 * Every behavioural assertion runs the REAL production path:
 *   scoreAudit(input, evidence, opts) -> renderReportV2(model)
 * or the exported production helper whose behaviour is being accepted
 * (calculateFindingPriority / classifyFinding / buildFoundationChecklist /
 * buildActionPlan).  No mock replaces the behaviour under test, and no
 * expected value is copied from the implementation — expectations are
 * computed from the fixture's own inputs or from the requirement statement.
 */

import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scoreAudit } from "../scoring/vantage-score.js";
import {
  calculateFindingPriority,
  CONFIDENCE_LEVELS,
  CONFIDENCE_MODIFIERS,
  DIMENSIONS,
} from "../scoring/score-components.js";
import { buildCapabilityEvidence } from "../evidence/capability-evidence.js";
import {
  clientFacingPageUrls,
  renderReportV2 as renderReportV2Base,
} from "./render-report-v2.js";
import { buildCanonicalSolutionSet, SOLUTION_AUTHORITY_REGISTRY } from "../solution/solution-authority-provider.js";
import {
  ACTION_CLASS,
  ACTION_GROUP,
  classifyFinding,
  buildActionPlan,
} from "./action-priority.js";
import {
  FOUNDATION_STATUS,
  EVIDENCE_SCOPE_NOTE,
  EVIDENCE_ATTRIBUTION_PREFIX,
  EVIDENCE_FAILURE_DETAIL,
  ROBOTS_SCOPE_NOTE,
  ROBOTS_DETAIL,
  buildFoundationChecklist,
} from "./foundation-readiness.js";

const FIXED_TS = "2026-01-15T12:00:00.000Z";

const INPUT = {
  auditId: "audit-depth-01",
  targetUrl: "https://x.com",
  businessName: "Example Business",
  competitors: [],
  services: ["Business Coaching"],
  primaryGoal: "Generate qualified enquiries",
};

const COMPETITOR_INPUT = {
  ...INPUT,
  competitors: ["https://rival.com"],
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

// ---------------------------------------------------------------------------
// Fixtures — governed evidence shapes only.  No provider call.
// ---------------------------------------------------------------------------

/** Fully assessed site: content, headers, and interactive evidence all ran. */
function assessedSite(overrides = {}) {
  return {
    sourceStatus: "AVAILABLE",
    targetUrl: "https://x.com/",
    domain: "x.com",
    platform: "WordPress",
    pageCount: 3,
    pages: [
      {
        crawledUrl: "https://x.com/",
        title: "Home",
        headings: { h1: ["Coaching that converts"], h2: ["How it works", "Results"], h3: ["Step one"], h4: [] },
        responseHeaders: { server: "nginx" },
        phoneLinks: ["tel:+15550000"],
        emailLinks: ["mailto:hi@x.com"],
        canonicalUrl: "https://x.com/",
        indexable: true,
        statusCode: 200,
      },
    ],
    services: ["Business Coaching"],
    topicKeywords: ["business coaching"],
    ctas: [{ text: "Book a call", url: "https://x.com/book", kind: "link" }],
    externalCtas: [],
    forms: [{ action: "/submit" }],
    schemaTypes: ["Organization"],
    microdataTypes: [],
    socialLinks: [],
    sitemapUrls: ["https://x.com/sitemap.xml"],
    nonIndexablePages: [],
    trust: { testimonials: true, credentials: true, caseStudies: false, faq: false, pricing: false, policies: true, contact: true },
    securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: false, contentSecurityPolicy: false },
    totalWords: 1200,
    averageWords: 400,
    missingTitles: 0,
    missingDescriptions: 2,
    missingCanonicals: 0,
    h1Missing: 0,
    h1Multiple: 0,
    imageCount: 4,
    imagesMissingAlt: 1,
    internalLinkCount: 8,
    brokenInternalLinks: [],
    statusCounts: { 200: 3 },
    limitations: [],
    collectedAt: FIXED_TS,
    coverage: { requested: 3, completed: 3, failed: 0 },
    _contentEvidenceAvailable: true,
    _responseHeadersAvailable: true,
    _interactiveEvidenceAvailable: true,
    _metaFieldAvailability: { titles: true, descriptions: true, canonicals: true, headings: true },
    ...overrides,
  };
}

/** Production DataForSEO shape: content/headers/interactive evidence absent. */
function unassessedSite(overrides = {}) {
  return {
    ...assessedSite(),
    trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: false },
    securityHeaders: {},
    schemaTypes: [],
    ctas: [],
    forms: [],
    sitemapUrls: [],
    missingDescriptions: 0,
    _contentEvidenceAvailable: false,
    _responseHeadersAvailable: false,
    _interactiveEvidenceAvailable: false,
    _metaFieldAvailability: { titles: false, descriptions: false, canonicals: false, headings: false },
    ...overrides,
  };
}

function evidenceWith(site, overrides = {}) {
  return {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site,
    performance: {
      sourceStatus: "AVAILABLE",
      provider: "pagespeed-insights",
      intendedProvider: "pagespeed-insights",
      source: "pagespeed-insights",
      fallbackUsed: false,
      mobile: {
        status: "AVAILABLE",
        source: "pagespeed-insights",
        url: "https://x.com/",
        isLabData: true,
        scores: { performance: 62, accessibility: 88, bestPractices: 75, seo: 90 },
        metrics: { fcpMs: 1800, lcpMs: 2400, tbtMs: 220, cls: 0.04 },
      },
      desktop: {
        status: "AVAILABLE",
        source: "pagespeed-insights",
        url: "https://x.com/",
        isLabData: true,
        scores: { performance: 91, accessibility: 90, bestPractices: 80, seo: 92 },
        metrics: { fcpMs: 900, lcpMs: 1300, tbtMs: 40, cls: 0.01 },
      },
      fieldData: {},
      limitations: [],
      collectedAt: FIXED_TS,
      coverage: { requested: 1, completed: 1, failed: 0 },
    },
    competitors: null,
    backlinks: null,
    ga4: null,
    gsc: null,
    ...overrides,
  };
}

/** Path-validation evidence that proves an obstructed primary CTA. */
const OBSTRUCTED_PATH_EVIDENCE = {
  provider: "playwright-conversion-path",
  summary: { requested: 1, pass: 1, partial: 0, failed: 0, notAssessed: 0 },
  pages: [
    {
      url: "https://x.com/",
      status: "PASS",
      checks: { desktop: { cta: { obstructed: true } }, mobile: { cta: { obstructed: true } } },
    },
  ],
};

function scoreWith(
  site,
  {
    pathValidationEvidence = null,
    evidenceOverrides = {},
    input = INPUT,
  } = {},
) {
  const evidence = evidenceWith(site, evidenceOverrides);
  const capabilityEvidence = buildCapabilityEvidence({
    decisionEvidence: evidence,
    auditId: input.auditId,
    generatedAt: FIXED_TS,
    pathValidationEvidence,
  });
  return scoreAudit(input, evidence, { capabilityEvidence, scoredAt: FIXED_TS });
}

const findingByRule = (model, ruleId) =>
  (model.findings || []).find((f) => f.ruleId === ruleId);

// ===========================================================================
// SECTION E — CR-01 .. CR-06
// ===========================================================================

test("CR-01: action priority uses the authorized 40/20/15/15/10 weighting", () => {
  const fields = {
    conversionImpact: 90,
    businessRelevance: 60,
    gapSeverity: 40,
    implementationPracticality: 80,
    competitiveSignal: 20,
    confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
  };
  const result = calculateFindingPriority(fields);

  const expected =
    fields.conversionImpact * 0.40 +
    fields.businessRelevance * 0.20 +
    fields.gapSeverity * 0.15 +
    fields.implementationPracticality * 0.15 +
    fields.competitiveSignal * 0.10;
  assert.equal(result.raw, expected, "raw priority must use the new weighting");

  const superseded =
    fields.conversionImpact * 0.30 +
    fields.gapSeverity * 0.25 +
    fields.businessRelevance * 0.20 +
    fields.competitiveSignal * 0.15 +
    fields.implementationPracticality * 0.10;
  assert.notEqual(result.raw, superseded, "old 30/25/20/15/10 weighting must not survive");
});

test("CR-01b: conversion impact is the dominant term", () => {
  const base = { conversionImpact: 0, businessRelevance: 0, gapSeverity: 0, implementationPracticality: 0, competitiveSignal: 0, confidence: CONFIDENCE_LEVELS.DETERMINISTIC };
  const bump = (key) => calculateFindingPriority({ ...base, [key]: 100 }).raw;
  const conversion = bump("conversionImpact");

  for (const other of ["businessRelevance", "gapSeverity", "implementationPracticality", "competitiveSignal"]) {
    assert.ok(conversion > bump(other), `conversionImpact must outweigh ${other}`);
  }

  assert.equal(
    calculateFindingPriority({
      conversionImpact: 100,
      businessRelevance: 100,
      gapSeverity: 100,
      implementationPracticality: 100,
      competitiveSignal: 100,
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
    }).raw,
    100,
  );
});

test("CR-02: existing evidence-confidence modifiers still apply unchanged", () => {
  const fields = { conversionImpact: 80, businessRelevance: 70, gapSeverity: 60, implementationPracticality: 50, competitiveSignal: 40 };
  const raw = calculateFindingPriority({ ...fields, confidence: CONFIDENCE_LEVELS.DETERMINISTIC }).raw;

  for (const level of Object.values(CONFIDENCE_LEVELS)) {
    const result = calculateFindingPriority({ ...fields, confidence: level });
        assert.equal(result.raw, raw, "raw priority is confidence-independent");
    assert.equal(
      result.final,
      Math.round(raw * CONFIDENCE_MODIFIERS[level]),
      `final must equal raw x modifier for ${level}`,
    );
  }
});

test("CR-03: a verified foundation blocker outranks a higher-scoring optimization", () => {
  const model = scoreWith(assessedSite(), { pathValidationEvidence: OBSTRUCTED_PATH_EVIDENCE });

  const blocker = findingByRule(model, "VAN-PATH-001");
  assert.ok(blocker, "obstruction evidence must produce VAN-PATH-001");

  const meta = findingByRule(model, "VAN-TECH-001");
  assert.ok(meta, "fixture must also produce an ordinary optimization finding");

  assert.ok(
    meta.finalPriority > blocker.finalPriority,
    `fixture precondition: ordinary finding (${meta.finalPriority}) must outscore the blocker (${blocker.finalPriority})`,
  );

  const plan = buildActionPlan(model);
  assert.equal(plan.actions[0].finding.ruleId, "VAN-PATH-001", "foundation blocker must rank first");
  assert.equal(plan.actions[0].actionClass, ACTION_CLASS.FOUNDATION_BLOCKER);
  assert.equal(plan.actions[0].group, ACTION_GROUP.DO_NOW);

  const html = renderReportV2(model);
  const sectionE = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));

  assert.ok(
    sectionE.indexOf("What should you fix first?") > -1,
    "rendered Priority Fixes must lead with the authoritative client sequence",
  );
  assert.doesNotMatch(sectionE, /VAN-PATH-001|VAN-TECH-001|Foundation blocker/);
  assert.doesNotMatch(sectionE, /<dt>What needs attention<\/dt>/);
  assert.match(sectionE, /Where it applies/);
  assert.match(sectionE, /How to confirm it improved/);
});

test("CR-04: Conversion-First ranking uses confidence as a lead gate, not a confidence-first sort", () => {
  const supportedBusiness = {
    ruleId: "VAN-CONTENT-900",
    confidence: CONFIDENCE_LEVELS.SUPPORTED,
    scoreBearing: true,
    finalPriority: 60,
    severity: "High",
    implementationEffort: "M",
  };

  const technicalHygiene = {
    ruleId: "VAN-TECH-001",
    confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
    scoreBearing: true,
    finalPriority: 100,
    severity: "High",
    implementationEffort: "L",
  };

  const directionalPath = {
    ruleId: "VAN-PATH-999",
    confidence: CONFIDENCE_LEVELS.DIRECTIONAL,
    scoreBearing: true,
    finalPriority: 100,
    severity: "High",
    implementationEffort: "M",
  };

  const plan = buildActionPlan({
    findings: [
      technicalHygiene,
      directionalPath,
      supportedBusiness,
    ],
  });

  assert.equal(
    plan.actions[0].finding.ruleId,
    "VAN-CONTENT-900",
    "supported stronger business-impact work must outrank deterministic technical hygiene",
  );

  assert.equal(
    plan.actions[0].actionClass,
    ACTION_CLASS.HIGH_CONVERSION,
    "supported business-impact evidence must remain eligible to lead",
  );

  assert.notEqual(
    plan.actions[0].finding.ruleId,
    "VAN-PATH-999",
    "directional evidence must not become the client lead",
  );

  assert.ok(
    technicalHygiene.finalPriority > supportedBusiness.finalPriority,
    "fixture must prove numeric priority alone cannot promote technical hygiene over the stronger business-impact class",
  );

  const foundationBlocker = {
    ruleId: "VAN-PATH-001",
    confidence: CONFIDENCE_LEVELS.STRONGLY_SUPPORTED,
    scoreBearing: true,
    finalPriority: 10,
    severity: "High",
    implementationEffort: "M",
  };

  assert.equal(
    classifyFinding(foundationBlocker).actionClass,
    ACTION_CLASS.FOUNDATION_BLOCKER,
    "strongly-supported proven foundation evidence must retain the governed blocker classification",
  );

  const blockerPlan = buildActionPlan({
    findings: [
      technicalHygiene,
      supportedBusiness,
      foundationBlocker,
    ],
  });

  assert.equal(
    blockerPlan.actions[0].finding.ruleId,
    "VAN-PATH-001",
    "proven foundation blocker must override the normal Conversion-First hierarchy",
  );

  assert.equal(
    blockerPlan.actions[0].actionClass,
    ACTION_CLASS.FOUNDATION_BLOCKER,
  );
});

test("CR-05: insufficient evidence stays non-score-bearing and out of Section E", () => {
  const result = calculateFindingPriority({
    conversionImpact: 100,
    businessRelevance: 100,
    gapSeverity: 100,
    implementationPracticality: 100,
    competitiveSignal: 100,
    confidence: CONFIDENCE_LEVELS.INSUFFICIENT,
  });

  assert.equal(result.final, 0);
  assert.equal(result.scoreBearing, false);

  const plan = buildActionPlan({
    findings: [{
      ruleId: "VAN-X",
      confidence: CONFIDENCE_LEVELS.INSUFFICIENT,
      scoreBearing: false,
      finalPriority: 0,
      severity: "High",
      implementationEffort: "L",
    }],
  });

  assert.equal(plan.actions.length, 0, "non-score-bearing findings never enter the action plan");
});

test("CR-06: readiness dimension weights and the readiness score are unchanged", () => {
  assert.deepEqual(
    Object.fromEntries(Object.values(DIMENSIONS).map((d) => [d.id, d.weight])),
    {
      conversion_pathways: 25,
      trust_eeat: 25,
      content_funnel: 20,
      technical_performance: 20,
      entity_schema_ai: 10,
    },
    "readiness dimension weights are frozen",
  );

  assert.equal(
    Object.values(DIMENSIONS).reduce((s, d) => s + d.weight, 0),
    100,
  );

  const model = scoreWith(assessedSite());

  assert.equal(model.scoringVersion, "4.1.1", "scoring version must not change");
  assert.equal(typeof model.scores.conversionReadiness, "number");

  const again = scoreWith(assessedSite());
  assert.equal(model.scores.conversionReadiness, again.scores.conversionReadiness);
});

// ===========================================================================
// REPORT RESTORATION — CR-07 .. CR-15
// ===========================================================================

test("CR-07: E-E-A-T renders four governed dimensions, and Not Assessed when unavailable", () => {
  const assessed = renderReportV2(scoreWith(assessedSite()));

  for (const dim of ["Experience", "Expertise", "Authoritativeness", "Trust"]) {
    assert.match(assessed, new RegExp(`>\\s*${dim}\\s*<`), `E-E-A-T dimension rendered: ${dim}`);
  }

  assert.match(assessed, /Found/, "assessed E-E-A-T shows Found");
  assert.match(assessed, /Recommended fix|Fix/, "assessed E-E-A-T shows a fix");

  const unassessed = renderReportV2(scoreWith(unassessedSite()));
  const eeat = unassessed.slice(unassessed.indexOf("E-E-A-T"), unassessed.indexOf("E-E-A-T") + 3000);

  assert.match(eeat, /Not Assessed/i, "unassessed E-E-A-T must render Not Assessed");

  assert.ok(
    !/No case-study or outcome proof detected|No credentials or certifications detected|No testimonial proof detected/.test(eeat),
    "unassessed evidence must never render as a confirmed absence",
  );
});

test("CR-08: CMS section never presents generic feasibility as verified site fact", () => {
  const html = renderReportV2(scoreWith(assessedSite()));
  const cms = html.slice(html.indexOf("CMS"), html.indexOf("CMS") + 4000);

  assert.match(cms, /WordPress/, "detected platform rendered from evidence");

  assert.match(
    cms,
    /generic|verification checklist|requires admin|not verified|To be confirmed/i,
    "feasibility guidance must be explicitly labelled as unverified/generic",
  );

  const unknown = renderReportV2(scoreWith(assessedSite({ platform: undefined })));
  const unknownCms = unknown.slice(unknown.indexOf("CMS"), unknown.indexOf("CMS") + 4000);

  assert.match(
    unknownCms,
    /not.*(verified|detected|assessed)/i,
    "unknown platform renders an explicit unverified state",
  );

  assert.ok(
    !/Migration risk:\s*(Low|Medium|High)\b/i.test(unknownCms),
    "migration risk must not be asserted without platform evidence",
  );
});

test("CR-09: technical sub-panels respect capability availability", () => {
  const unassessed = renderReportV2(scoreWith(unassessedSite()));
  const tech = unassessed.slice(unassessed.indexOf('id="technical"'), unassessed.indexOf('id="technical"') + 4000);

  assert.ok(tech.length > 0, "technical detail section must exist");
  assert.match(tech, /Not Assessed/i, "unavailable header evidence renders Not Assessed");

  assert.ok(
    !/Security headers[\s\S]{0,200}?\bMissing\b/i.test(tech),
    "unavailable security-header evidence must never render as Missing",
  );

  const assessed = renderReportV2(scoreWith(assessedSite()));
  const assessedTech = assessed.slice(assessed.indexOf('id="technical"'), assessed.indexOf('id="technical"') + 8000);

  assert.match(
    assessedTech,
    /referrerPolicy|Referrer-Policy/i,
    "assessed headers are reported individually",
  );
});

test("CR-10: heading evidence is scoped to the named evaluated page", () => {
  const html = renderReportV2(scoreWith(assessedSite()));
  const idx = html.indexOf("Heading Structure");

  assert.ok(idx > -1, "heading section must exist");

  const headings = html.slice(idx, idx + 3000);

  assert.match(headings, /https:\/\/x\.com\//, "evaluated page URL is named");
  assert.match(headings, /evaluated page|this page|page assessed/i, "scope is explicitly single-page");
  assert.match(headings, /Coaching that converts/, "actual H1 content rendered from evidence");

  const unassessed = renderReportV2(scoreWith(unassessedSite({
    pages: [{ crawledUrl: "https://x.com/", title: "Home", headings: {} }],
  })));

  const uIdx = unassessed.indexOf("Heading Structure");
  const uHeadings = unassessed.slice(uIdx, uIdx + 3000);

  assert.match(uHeadings, /Not Assessed/i, "uncollected heading evidence renders Not Assessed");
  assert.ok(!/\bMissing\b/.test(uHeadings), "uncollected headings must not render as Missing");
});
test("CR-11: observed schema and recommended schema are semantically distinct", () => {
  const html = renderReportV2(scoreWith(assessedSite()));
  const idx = html.indexOf("Schema");
  const schema = html.slice(idx, idx + 4000);

  assert.match(schema, /Observed/i, "observed block present");
  assert.match(schema, /Recommended/i, "recommended block present");

  const observedBlock = schema.slice(schema.search(/Observed/i), schema.search(/Recommended/i));

  assert.match(observedBlock, /Organization/, "detected type appears under Observed");
  assert.ok(!/\bFAQPage\b/.test(observedBlock), "a merely recommended type must not appear as observed");
});

test("CR-12: unavailable performance metrics render Unavailable, never zero", () => {
  const model = scoreWith(assessedSite(), {
    evidenceOverrides: {
      performance: {
        sourceStatus: "PARTIAL",
        provider: "pagespeed-insights",
        source: "pagespeed-insights",
        fallbackUsed: true,
        mobile: {
          status: "AVAILABLE",
          source: "pagespeed-insights",
          url: "https://x.com/",
          isLabData: true,
          scores: { performance: 55 },
          metrics: {},
        },
        desktop: {
          status: "FAILED",
          source: "pagespeed-insights",
        },
        fieldData: {},
        limitations: ["Desktop run failed"],
        collectedAt: FIXED_TS,
        coverage: { requested: 2, completed: 1, failed: 1 },
      },
    },
  });

  const html = renderReportV2(model);
  const idx = html.indexOf("Performance Detail");

  assert.ok(idx > -1, "performance detail section must exist");

  const perf = html.slice(idx, idx + 5000);

  assert.match(perf, /Unavailable/, "absent metrics render Unavailable");
  assert.ok(!/>\s*0\s*ms\s*</.test(perf), "absent millisecond metrics must not render as 0 ms");
  assert.ok(!/LCP[\s\S]{0,80}?>\s*0(\.0+)?\s*</.test(perf), "absent LCP must not render as zero");
});

test("CR-13: mobile/desktop detail remains provenance-aware", () => {
  const html = renderReportV2(scoreWith(assessedSite()));
  const perf = html.slice(html.indexOf("Performance Detail"), html.indexOf("Performance Detail") + 6000);

  assert.match(perf, /Mobile/i);
  assert.match(perf, /Desktop/i);
  assert.match(perf, /pagespeed-insights/, "provider provenance rendered");
  assert.match(perf, /Lab data|Field data|lab|field/i, "lab vs field distinction rendered");
  assert.match(perf, /2400|2\.4/, "actual LCP value from the fixture rendered");
});

test("CR-14: machine-readiness wording never claims actual AI visibility", () => {
  const html = renderReportV2(scoreWith(assessedSite()));

  assert.match(
    html,
    /machine[- ]read|AI[- ]search readiness|structural/i,
    "structural machine-readability framing present",
  );

  for (const overclaim of [
    "your site appears in AI",
    "AI systems recommend",
    "visible in ChatGPT",
    "cited by AI",
    "guaranteed AI visibility",
  ]) {
    assert.ok(
      !html.toLowerCase().includes(overclaim.toLowerCase()),
      `overclaim must be absent: ${overclaim}`,
    );
  }
});

test("CR-15: consolidated executive positives require assessed evidence", () => {
  const assessed = renderReportV2(scoreWith(assessedSite()));
  const idx = assessed.indexOf("What is already working?");

  assert.ok(idx > -1, "consolidated executive positive section must exist");

  const good = assessed.slice(idx, idx + 3000);

  assert.match(
    good,
    /HTTPS|Trust|schema|Organization|link/i,
    "an evidence-backed strength is listed",
  );

  const unassessed = renderReportV2(scoreWith(unassessedSite()));
  const uIdx = unassessed.indexOf("What is already working?");
  const uGood = unassessed.slice(uIdx, uIdx + 3000);

  assert.ok(
    !/testimonial|credential|structured data detected/i.test(uGood),
    "strengths must never be inferred from unavailable capabilities",
  );
});

// ===========================================================================
// FIRST THINGS FIRST — CR-16 .. CR-20
// ===========================================================================

const itemById = (list, id) => list.find((i) => i.id === id);

/** HTML-escape exactly as the renderer does, so comparisons are like-for-like. */
const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

test("CR-16: an assessed foundation candidate can PASS", () => {
  const checklist = buildFoundationChecklist(scoreWith(assessedSite()));

  assert.equal(itemById(checklist, "https").status, FOUNDATION_STATUS.PASS);
  assert.equal(itemById(checklist, "site_availability").status, FOUNDATION_STATUS.PASS);
  assert.equal(itemById(checklist, "sitemap").status, FOUNDATION_STATUS.PASS);

  const html = renderReportV2(scoreWith(assessedSite()));

  assert.match(html, /First Things First|Foundational Readiness/i, "checklist section rendered");
  assert.match(html, /PASS/, "PASS status rendered");
});

test("CR-17: an assessed foundation deficiency is ACTION REQUIRED", () => {
  const model = scoreWith(assessedSite({
    targetUrl: "http://x.com/",
    nonIndexablePages: [{ url: "https://x.com/", reason: "noindex" }],
    pages: [{ ...assessedSite().pages[0], indexable: false }],
  }));

  const checklist = buildFoundationChecklist(model);

  assert.equal(
    itemById(checklist, "https").status,
    FOUNDATION_STATUS.ACTION_REQUIRED,
    "a non-HTTPS target URL is a proven deficiency",
  );

  assert.equal(
    itemById(checklist, "indexability").status,
    FOUNDATION_STATUS.ACTION_REQUIRED,
    "proven non-indexable pages are a deficiency",
  );

  assert.match(renderReportV2(model), /ACTION REQUIRED/i);
});

test("CR-18: unassessable candidates render NOT ASSESSED with the required source", () => {
  const checklist = buildFoundationChecklist(scoreWith(assessedSite()));

  for (const id of ["bing_indexability", "google_business_profile", "nap_consistency"]) {
    const item = itemById(checklist, id);

    assert.ok(item, `candidate present: ${id}`);

    assert.equal(
      item.status,
      FOUNDATION_STATUS.NOT_ASSESSED,
      `${id} cannot be assessed today`,
    );

    assert.ok(
      item.requires && item.requires.length > 5,
      `${id} must name the required evidence source`,
    );
  }

  const html = renderReportV2(scoreWith(assessedSite()));

  assert.match(
    html,
    /NOT ASSESSED[\s\S]*?requires/i,
    "rendered as NOT ASSESSED with required source",
  );
});

test("CR-19: a not-applicable candidate renders NOT APPLICABLE", () => {
  const checklist = buildFoundationChecklist(
    scoreWith(assessedSite(), {
      evidenceOverrides: {
        ga4: {
          sourceStatus: "NOT_APPLICABLE",
          limitations: [],
        },
      },
    }),
  );

  const item = itemById(checklist, "conversion_measurement");

  assert.equal(item.status, FOUNDATION_STATUS.NOT_APPLICABLE);
});

// ---------------------------------------------------------------------------
// CR-28..CR-35 — source-failure boundary (merge-audit correction, round 2).
// ---------------------------------------------------------------------------

function failedSiteEvidence(status, limitation) {
  return {
    sourceStatus: status,
    collectedAt: FIXED_TS,
    limitations: limitation ? [limitation] : [],
  };
}

function modelForSite(
  siteEvidence,
  evidenceOverrides = {},
  pathValidationEvidence = null,
  input = INPUT,
) {
  const evidence = evidenceWith(siteEvidence, evidenceOverrides);

  const capabilityEvidence = buildCapabilityEvidence({
    decisionEvidence: evidence,
    auditId: input.auditId,
    generatedAt: FIXED_TS,
    pathValidationEvidence,
  });

  return scoreAudit(input, evidence, {
    capabilityEvidence,
    scoredAt: FIXED_TS,
  });
}

function checklistForSite(siteEvidence, evidenceOverrides = {}) {
  return buildFoundationChecklist(
    modelForSite(siteEvidence, evidenceOverrides),
  );
}

const PROVIDER_FAILURES = [
  ["rate_limit", "DataForSEO quota exceeded: rate_limit"],
  ["network", "Task submission failed: network error"],
  ["timeout", "Task polling failed: timeout after 300s"],
  ["internal", "Result retrieval failed: internal provider error"],
  ["auth", "Authentication failed for the evidence provider"],
  ["schema_validation", "Provider response failed schema validation"],
];
test("CR-28: provider FAILED never becomes a website-availability defect", () => {
  for (const [category, limitation] of PROVIDER_FAILURES) {
    const checklist = checklistForSite(
      failedSiteEvidence("FAILED", limitation),
    );

    const availability = itemById(checklist, "site_availability");

    assert.equal(
      availability.status,
      FOUNDATION_STATUS.NOT_ASSESSED,
      `FAILED/${category} must render NOT_ASSESSED for site availability`,
    );

    assert.equal(
      availability.assessed,
      false,
      `FAILED/${category} must not claim to be assessed`,
    );

    assert.ok(
      availability.requires,
      `FAILED/${category} must name the evidence it needs`,
    );

    assert.ok(
      !/site (is |was )?(down|unavailable|offline)|visitors cannot/i.test(availability.detail),
      `FAILED/${category} must not describe the website as unavailable: ${availability.detail}`,
    );
  }
});

test("CR-29: the evidence limitation is surfaced, attributed to the source", () => {
  for (const [, limitation] of PROVIDER_FAILURES) {
    const checklist = checklistForSite(
      failedSiteEvidence("FAILED", limitation),
    );

    const availability = itemById(checklist, "site_availability");

    assert.equal(
      availability.evidenceNote,
      `${EVIDENCE_ATTRIBUTION_PREFIX} ${limitation}`,
      "limitation must be surfaced with source attribution",
    );

    assert.ok(
      !availability.detail.includes(limitation),
      "provider text must not be inlined into the audit's own wording",
    );
  }
});

test("CR-30: BLOCKED crawl access is not visitor-facing site unavailability", () => {
  const checklist = checklistForSite(
    failedSiteEvidence("BLOCKED", "Site blocked by robots.txt"),
  );

  const availability = itemById(checklist, "site_availability");

  assert.equal(
    availability.status,
    FOUNDATION_STATUS.NOT_ASSESSED,
  );

  assert.match(
    availability.detail,
    /crawl[- ]access/i,
    "must be framed as crawl access",
  );

  assert.ok(
    !/visitors cannot reach|site is unavailable|nothing downstream/i.test(availability.detail),
    `BLOCKED must not be framed as a visitor-facing outage: ${availability.detail}`,
  );
});

test("CR-31: audit-crawler robots refusal never claims search engines are blocked", () => {
  const checklist = checklistForSite(
    failedSiteEvidence("BLOCKED", "Site blocked by robots.txt"),
  );

  const robots = itemById(checklist, "robots_txt");

  assert.equal(
    robots.status,
    FOUNDATION_STATUS.NOT_ASSESSED,
    "no directive evidence => NOT_ASSESSED",
  );

  assert.ok(
    robots.requires,
    "must name the directive evidence required",
  );

  assert.ok(
    !/also blocks search engines|search engines are blocked|blocks google|blocks bing/i.test(robots.detail),
    `must not claim search engines are blocked: ${robots.detail}`,
  );

  assert.match(
    robots.detail,
    /per user agent|does not establish/i,
    "must state the limitation explicitly",
  );
});

test("CR-32: a proven target-side outage IS still ACTION REQUIRED", () => {
  const checklist = checklistForSite(
    assessedSite({
      statusCounts: { 503: 3 },
      pages: [{
        crawledUrl: "https://x.com/",
        title: "",
        statusCode: 503,
        headings: {},
      }],
    }),
  );

  const availability = itemById(checklist, "site_availability");

  assert.equal(
    availability.status,
    FOUNDATION_STATUS.ACTION_REQUIRED,
  );

  assert.equal(
    availability.assessed,
    true,
  );

  assert.match(
    availability.detail,
    /503/,
    "must cite the observed status code",
  );
});

test("CR-33: a partial outage does not become a site-availability defect", () => {
  const checklist = checklistForSite(
    assessedSite({
      statusCounts: { 200: 2, 404: 1 },
      pages: [{
        crawledUrl: "https://x.com/",
        title: "Home",
        statusCode: 200,
        headings: { h1: ["Home"] },
      }],
    }),
  );

  assert.equal(
    itemById(checklist, "site_availability").status,
    FOUNDATION_STATUS.PASS,
  );
});

test("CR-34: existing PASS availability behaviour is intact", () => {
  const checklist = checklistForSite(assessedSite());
  const availability = itemById(checklist, "site_availability");

  assert.equal(
    availability.status,
    FOUNDATION_STATUS.PASS,
  );

  assert.equal(
    availability.assessed,
    true,
  );

  assert.match(
    availability.detail,
    /responded/i,
  );
});

// ---------------------------------------------------------------------------
// CR-36..CR-39 — IDENTITY-frozen client wording.
// ---------------------------------------------------------------------------

const FROZEN = {
  scopeNote: "it does not describe how the website behaved for real visitors.",
  attribution: "Evidence source reported:",
  availabilityRequires:
    "target-side availability evidence (observed HTTP responses from the site, or an uptime source)",
  detail: {
    BLOCKED: "Crawl access was restricted for the audit crawler. This is a crawl-access restriction affecting this audit only; it does not describe how the website behaved for real visitors.",
    FAILED: "Evidence collection did not return a usable result. This is a limitation of the audit evidence; it does not describe how the website behaved for real visitors.",
    UNAVAILABLE: "The evidence source was not reachable for this audit. This is a limitation of the audit evidence; it does not describe how the website behaved for real visitors.",
    NOT_CONNECTED: "The evidence source was not connected for this audit. This is a limitation of the audit evidence; it does not describe how the website behaved for real visitors.",
    UNKNOWN: "Crawl status was not recorded for this audit. This is a limitation of the audit evidence; it does not describe how the website behaved for real visitors.",
  },
  robots: {
    REFUSED: "The audit crawler was refused by robots.txt. Because robots.txt rules apply per user agent, this does not establish that Google or Bing crawlers are blocked.",
    RETRIEVED: "A robots.txt file was retrieved and did not refuse the audit crawl. Its per-user-agent directives were not parsed.",
    NOT_RETURNED: "robots.txt content was not returned by the crawl provider, so its directives were not evaluated.",
  },
  robotsRequires: {
    REFUSED: "collected robots.txt directives showing the rules that apply to search-engine user agents",
    NOT_RETURNED: "a direct robots.txt fetch with directive parsing",
  },
  availabilityLabel: "Site availability",
  robotsLabel: "robots.txt configuration",
  outageSentence: "Visitors reaching these URLs cannot use the site.",
};

const NO_PERF = { performance: null };
function foundationMatrix() {
  const ga4 = (over) => ({
    ga4: {
      sourceStatus: "AVAILABLE",
      collectedAt: FIXED_TS,
      ...over,
    },
  });

  return [
    ["assessed", assessedSite(), {}],
    ["unassessed", unassessedSite(), {}],
    ["provider-failed", failedSiteEvidence("FAILED", "Task submission failed: network error"), {}],
    ["crawl-blocked", failedSiteEvidence("BLOCKED", "Site blocked by robots.txt"), {}],
    ["target-outage", assessedSite({
      statusCounts: { 503: 2 },
      pages: [{
        crawledUrl: "https://x.com/",
        statusCode: 503,
        headings: {},
      }],
    }), {}],
    ["outage-with-limitations", assessedSite({
      statusCounts: { 500: 1 },
      pages: [{
        crawledUrl: "https://x.com/",
        statusCode: 500,
        headings: {},
      }],
      limitations: ["Provider reported partial coverage"],
    }), {}],
    ["http-and-noindex", assessedSite({
      targetUrl: "http://x.com/",
      nonIndexablePages: [{
        url: "https://x.com/",
        reason: "noindex",
      }],
    }), {}],
    ["robots-retrieved", assessedSite({
      robotsText: "User-agent: *\nAllow: /",
    }), {}],
    ["canonical-missing", assessedSite({
      missingCanonicals: 2,
    }), {}],
    ["no-conversion-mechanism", assessedSite({
      ctas: [],
      forms: [],
    }), {}],
    ["no-contact", assessedSite({
      trust: {
        ...assessedSite().trust,
        contact: false,
      },
      pages: [{
        ...assessedSite().pages[0],
        phoneLinks: [],
        emailLinks: [],
      }],
    }), {}],
    ["headers-all-present", assessedSite({
      securityHeaders: {
        xFrameOptions: true,
        xContentTypeOptions: true,
        referrerPolicy: true,
        contentSecurityPolicy: true,
      },
    }), {}],
    ["ga4-ready", assessedSite(), ga4({
      measurementReadiness: {
        ready: true,
        issues: [],
        issueCount: 0,
      },
    })],
    ["ga4-issues", assessedSite(), ga4({
      measurementReadiness: {
        ready: false,
        issueCount: 1,
        issues: [{
          type: "missing_key_events",
          detail: "No key events configured",
        }],
      },
    })],
    ["ga4-not-applicable", assessedSite(), {
      ga4: {
        sourceStatus: "NOT_APPLICABLE",
        collectedAt: FIXED_TS,
        limitations: [],
      },
    }],
    ["slow-mobile", assessedSite(), {
      performance: {
        ...evidenceWith(assessedSite()).performance,
        mobile: {
          status: "AVAILABLE",
          source: "pagespeed-insights",
          url: "https://x.com/",
          isLabData: true,
          scores: { performance: 31 },
          metrics: {},
        },
      },
    }],
    ["no-performance", assessedSite(), NO_PERF],

    ["path-validated-blocker", assessedSite(), {}, OBSTRUCTED_PATH_EVIDENCE],

    ["competitor-present", assessedSite(), {
      competitors: [{
        url: "https://rival.com",
        domain: "rival.com",
        status: "AVAILABLE",
        collectedAt: FIXED_TS,
        evidence: {
          domain: "rival.com",
          pageCount: 8,
          pages: [{ title: "Rival Coaching" }],
          services: ["Coaching", "Mentoring", "Workshops"],
          topicKeywords: ["coaching"],
          ctas: [{
            text: "Book",
            url: "https://rival.com/book",
          }],
          forms: [{ action: "/c" }],
          socialLinks: [{
            url: "https://linkedin.com/company/rival",
            text: "LinkedIn",
          }],
          trust: {
            testimonials: true,
            credentials: true,
            caseStudies: true,
            faq: true,
            pricing: true,
            policies: true,
            contact: true,
          },
          schemaTypes: ["Organization"],
        },
      }],
    }, null, COMPETITOR_INPUT],

    ["proprietary-platform", assessedSite({
      platform: "Wix",
    }), {}],

    ["untraced-broken-links", assessedSite({
      brokenInternalLinks: [
        "https://x.com/missing",
        "https://x.com/gone",
      ],
    }), {}],

    ["schema-confirmed-absent", assessedSite({
      schemaTypes: [],
      microdataTypes: [],
    }), {}],

    ["headings-absent-h1", assessedSite({
      h1Missing: 1,
      pages: [{
        ...assessedSite().pages[0],
        headings: {
          h1: [],
          h2: ["Only H2"],
          h3: [],
          h4: [],
        },
      }],
    }), {}],

    ["headings-multiple-h1", assessedSite({
      h1Multiple: 1,
      pages: [{
        ...assessedSite().pages[0],
        headings: {
          h1: ["One", "Two"],
          h2: [],
          h3: [],
          h4: [],
        },
      }],
    }), {}],

    ["perf-field-and-multipage", assessedSite(), {
      performance: {
        ...evidenceWith(assessedSite()).performance,
        fieldData: {
          phone: {
            status: "AVAILABLE",
            formFactor: "PHONE",
            dataType: "field",
            metrics: {
              lcpMs: 2600,
            },
          },
        },
        pageResults: [
          {
            url: "https://x.com/",
            source: "pagespeed-insights",
            sourceStatus: "AVAILABLE",
            fallbackUsed: false,
          },
          {
            url: "https://x.com/book",
            source: "pagespeed-insights",
            sourceStatus: "PARTIAL",
            fallbackUsed: true,
          },
        ],
      },
    }],

    ["competitor-with-limitations", assessedSite(), {
      competitors: [{
        url: "https://rival.com",
        domain: "rival.com",
        status: "AVAILABLE",
        collectedAt: FIXED_TS,
        evidence: {
          domain: "rival.com",
          pageCount: 8,
          pages: [{
            title: "Rival Coaching",
          }],
          services: ["Coaching", "Mentoring"],
          topicKeywords: ["coaching"],
          ctas: [{
            text: "Book",
            url: "https://rival.com/book",
          }],
          forms: [{ action: "/c" }],
          socialLinks: [],
          schemaTypes: ["Organization"],
          trust: {
            testimonials: true,
            credentials: false,
            caseStudies: false,
            faq: false,
            pricing: false,
            policies: true,
            contact: true,
          },
        },
      }],
      competitorOpportunities: {
        topics: [],
        candidates: {
          qualified: [],
          excluded: [],
        },
        gaps: [],
        allGaps: [],
        sources: {},
        limitations: ["SERP coverage limited to one locale"],
      },
    }, null, COMPETITOR_INPUT],

    ["device-profile-failed", assessedSite(), {
      performance: {
        ...evidenceWith(assessedSite()).performance,
        sourceStatus: "PARTIAL",
        desktop: {
          status: "FAILED",
          source: "pagespeed-insights",
        },
        limitations: ["Desktop run failed"],
      },
    }],
  ];
}
const REACHABLE_BRANCHES = [
  "bing_indexability:NOT_ASSESSED",
  "canonical:ACTION_REQUIRED",
  "canonical:NOT_ASSESSED",
  "canonical:PASS",
  "conversion_measurement:ACTION_REQUIRED",
  "conversion_measurement:NOT_APPLICABLE",
  "conversion_measurement:NOT_ASSESSED",
  "conversion_measurement:PASS",
  "conversion_mechanism:ACTION_REQUIRED",
  "conversion_mechanism:NOT_ASSESSED",
  "conversion_mechanism:PASS",
  "google_business_profile:NOT_ASSESSED",
  "https:ACTION_REQUIRED",
  "https:NOT_ASSESSED",
  "https:PASS",
  "indexability:ACTION_REQUIRED",
  "indexability:NOT_ASSESSED",
  "indexability:PASS",
  "mobile_experience:ACTION_REQUIRED",
  "mobile_experience:NOT_ASSESSED",
  "mobile_experience:PASS",
  "nap_consistency:NOT_ASSESSED",
  "primary_contact:ACTION_REQUIRED",
  "primary_contact:NOT_ASSESSED",
  "primary_contact:PASS",
  "robots_txt:NOT_ASSESSED",
  "security_headers:ACTION_REQUIRED",
  "security_headers:NOT_ASSESSED",
  "security_headers:PASS",
  "site_availability:ACTION_REQUIRED",
  "site_availability:NOT_ASSESSED",
  "site_availability:PASS",
  "sitemap:NOT_ASSESSED",
  "sitemap:PASS",
];

test("CR-36: the exported wording constants match the frozen contract", () => {
  assert.equal(
    EVIDENCE_SCOPE_NOTE,
    FROZEN.scopeNote,
  );

  assert.equal(
    EVIDENCE_ATTRIBUTION_PREFIX,
    FROZEN.attribution,
  );

  assert.equal(
    ROBOTS_SCOPE_NOTE,
    FROZEN.robots.REFUSED.slice(
      FROZEN.robots.REFUSED.indexOf("Because"),
    ),
  );

  assert.deepEqual(
    { ...EVIDENCE_FAILURE_DETAIL },
    FROZEN.detail,
  );

  assert.deepEqual(
    { ...ROBOTS_DETAIL },
    FROZEN.robots,
  );
});

test("CR-37: every availability failure branch renders exactly the frozen wording", () => {
  const states = [
    ...PROVIDER_FAILURES.map(([c, l]) => [
      `FAILED/${c}`,
      failedSiteEvidence("FAILED", l),
      "FAILED",
      l,
    ]),
    [
      "BLOCKED",
      failedSiteEvidence("BLOCKED", "Site blocked by robots.txt"),
      "BLOCKED",
      "Site blocked by robots.txt",
    ],
    [
      "UNAVAILABLE",
      failedSiteEvidence("UNAVAILABLE", "Source not reachable"),
      "UNAVAILABLE",
      "Source not reachable",
    ],
    [
      "NOT_CONNECTED",
      failedSiteEvidence("NOT_CONNECTED", "Source not configured"),
      "NOT_CONNECTED",
      "Source not configured",
    ],
    [
      "NOT_APPLICABLE",
      failedSiteEvidence("NOT_APPLICABLE", "Not applicable"),
      "UNKNOWN",
      "Not applicable",
    ],
    [
      "undefined status",
      { limitations: ["No status recorded"] },
      "UNAVAILABLE",
      "No status recorded",
    ],
  ];

  for (const [label, siteEvidence, expectedKey, limitation] of states) {
    const i = itemById(
      checklistForSite(siteEvidence),
      "site_availability",
    );

    assert.equal(
      i.status,
      FOUNDATION_STATUS.NOT_ASSESSED,
      `${label}: status`,
    );

    assert.equal(
      i.detail,
      FROZEN.detail[expectedKey],
      `${label}: detail`,
    );

    assert.equal(
      i.label,
      FROZEN.availabilityLabel,
      `${label}: label`,
    );

    assert.equal(
      i.requires,
      FROZEN.availabilityRequires,
      `${label}: requires`,
    );

    assert.equal(
      i.evidenceNote,
      limitation
        ? `${FROZEN.attribution} ${limitation}`
        : null,
      `${label}: provider text must be attributed, never inlined`,
    );
  }
});

test("CR-37b: with no provider limitation, no attributed note is fabricated", () => {
  const i = buildFoundationChecklist({
    evidence: {
      site: {
        sourceStatus: "FAILED",
        limitations: [],
      },
    },
    capabilityEvidence: {
      capabilities: {},
    },
  }).find((x) => x.id === "site_availability");

  assert.equal(
    i.detail,
    FROZEN.detail.FAILED,
  );

  assert.equal(
    i.evidenceNote,
    null,
    "no limitation => no attributed note invented",
  );
});

test("CR-38: all three robots branches render exactly the frozen wording", () => {
  const cases = [
    [
      "refused",
      failedSiteEvidence("BLOCKED", "Site blocked by robots.txt"),
      "REFUSED",
      FROZEN.robotsRequires.REFUSED,
      FOUNDATION_STATUS.NOT_ASSESSED,
    ],
    [
      "retrieved",
      assessedSite({
        robotsText: "User-agent: *\nAllow: /",
      }),
      null,
      "parsed robots.txt directives for the relevant search-engine user agents",
      FOUNDATION_STATUS.NOT_ASSESSED,
    ],
    [
      "not returned (production path)",
      assessedSite({
        robotsText: "",
      }),
      "NOT_RETURNED",
      FROZEN.robotsRequires.NOT_RETURNED,
      FOUNDATION_STATUS.NOT_ASSESSED,
    ],
  ];

  for (const [label, siteEvidence, key, requires, status] of cases) {
    const i = itemById(
      checklistForSite(siteEvidence),
      "robots_txt",
    );

    assert.equal(
      i.status,
      status,
      `${label}: status`,
    );

    assert.equal(
      i.detail,
      key ? FROZEN.robots[key] : "A robots.txt file was retrieved, but this assessment did not evaluate its directives for search-engine user agents.",
      `${label}: detail`,
    );

    assert.equal(
      i.label,
      FROZEN.robotsLabel,
      `${label}: label`,
    );

    assert.equal(
      i.requires,
      requires,
      `${label}: requires`,
    );
  }
});

test("CR-39: no client-rendered foundation field ever claims site behaviour outside the frozen note", () => {
  const models = foundationMatrix().map(
    ([, site, over, pathEv, input]) =>
      buildFoundationChecklist(
        modelForSite(site, over, pathEv, input),
      ),
  );

  const CLAIM =
    /\b(unreachable|offline|down|inaccessible)\b|\b(visitors?|users?|customers?|audience|traffic)\b/i;

  const scrub = (s) =>
    String(s || "").replace(/user[- ]agents?/gi, "");

  for (const checklist of models) {
    for (const i of checklist) {
      for (const [field, value] of [
        ["label", i.label],
        ["requires", i.requires],
        ["evidenceNote", i.evidenceNote],
      ]) {
        if (!value) continue;

        assert.ok(
          !CLAIM.test(scrub(value)),
          `${i.id}.${field} must make no site-behaviour claim, got: ${value}`,
        );
      }

      if (i.assessed !== true) {
        const unassessed = scrub(
          String(i.detail || "").replace(
            FROZEN.scopeNote,
            "",
          ),
        );

        assert.ok(
          !CLAIM.test(unassessed),
          `${i.id}: an unassessed item must make no site-behaviour claim, got: ${unassessed}`,
        );

        continue;
      }
    }
  }
});
test("CR-35: no source-failure state produces any ACTION REQUIRED foundation", () => {
  const states = [
    ...PROVIDER_FAILURES.map(([c, l]) => [
      `FAILED/${c}`,
      failedSiteEvidence("FAILED", l),
    ]),
    [
      "BLOCKED",
      failedSiteEvidence("BLOCKED", "Site blocked by robots.txt"),
    ],
    [
      "UNAVAILABLE",
      failedSiteEvidence("UNAVAILABLE", "Source not reachable"),
    ],
    [
      "NOT_CONNECTED",
      failedSiteEvidence("NOT_CONNECTED", "Source not configured"),
    ],
  ];

  for (const [label, siteEvidence] of states) {
    const checklist = checklistForSite(siteEvidence);

    const required = checklist
      .filter(
        (i) =>
          i.status === FOUNDATION_STATUS.ACTION_REQUIRED,
      )
      .map((i) => i.id);

    assert.deepEqual(
      required,
      [],
      `${label} must produce no ACTION REQUIRED foundation (got: ${required.join(", ")})`,
    );
  }
});

// ---------------------------------------------------------------------------
// CR-40 / CR-41 — GLOBAL freeze.
// ---------------------------------------------------------------------------

const CHECKLIST_GOLDEN = {
  assessed: "16e012c859565dd67a93f72db0fe8b0847babeba1cf58a7207d4fead8b378e4b",
  unassessed: "1ab14008b83d55af0d91ac2cb54b7fc187ece111f877c4f87154c2e9fe395693",
  "provider-failed": "bbe77121f8d4396c8a7e2e32834ccc49aff8e95caebd5ed9bbee0d83e2fb4bd0",
  "crawl-blocked": "f87770094b25d3395b99c38e73de66763cafbc4384d2b4ddc17fa0ad742b15eb",
  "target-outage": "4d7a3e205c3a95afb5b078d3448f5001d28fd7d3e5c5338db1e6a85f22f12f7f",
  "outage-with-limitations": "f089366910448919119efd4aa4671467c8a1a10a2eb5c7c4584eec446b286e95",
  "http-and-noindex": "83a3886e04f415194fab8ed4d2b7afd94177f13e12a14b12cd927b09fe6f959c",
  "robots-retrieved": "af789c41d36fe53f8d0754e69f95a3bea30fcef2eee08e57f29211c8bf06194b",
  "canonical-missing": "07029eac5e25593d814344e9232f21016d706ec34adce27c58e999d4c966658a",
  "no-conversion-mechanism": "b0ecd7cf4bc3f42fa56d8c18d69dbc27b8b11c26a52422df7f3c73b439cca830",
  "no-contact": "cdeb67e3932ba1f76ee3fdc93e60ee02f88fae070280c172c7244aede0f7ebcb",
  "headers-all-present": "f116b3309ab6094b7c83e758885c0b14655b59d239bf80a47a2bda33b9363085",
  "ga4-ready": "d1ee32bdc27b065cdaf2e42814951e05c0b34f42ba14b4c85d88e81491e2a6b7",
  "ga4-issues": "3e8a0b52baa19af98c7c46e822806984830f86615d6ad386b1ba0b85b77a6d34",
  "ga4-not-applicable": "2863263866b9b5075924b495cb1c796b84a53248a3dd46fe7c806ab3b08d251e",
  "slow-mobile": "b080355132e45f828fd3ac6f0d6d60fcaa8761d1085df527ee9044eabfa27274",
  "no-performance": "7edb24e4817aaaec6c69458ca6475779cfbd2a093f89c71224e507bd2b674e7b",
  "path-validated-blocker": "16e012c859565dd67a93f72db0fe8b0847babeba1cf58a7207d4fead8b378e4b",
  "competitor-present": "16e012c859565dd67a93f72db0fe8b0847babeba1cf58a7207d4fead8b378e4b",
  "proprietary-platform": "16e012c859565dd67a93f72db0fe8b0847babeba1cf58a7207d4fead8b378e4b",
  "untraced-broken-links": "16e012c859565dd67a93f72db0fe8b0847babeba1cf58a7207d4fead8b378e4b",
  "schema-confirmed-absent": "16e012c859565dd67a93f72db0fe8b0847babeba1cf58a7207d4fead8b378e4b",
  "headings-absent-h1": "16e012c859565dd67a93f72db0fe8b0847babeba1cf58a7207d4fead8b378e4b",
  "headings-multiple-h1": "16e012c859565dd67a93f72db0fe8b0847babeba1cf58a7207d4fead8b378e4b",
  "device-profile-failed": "16e012c859565dd67a93f72db0fe8b0847babeba1cf58a7207d4fead8b378e4b",
  "competitor-with-limitations": "16e012c859565dd67a93f72db0fe8b0847babeba1cf58a7207d4fead8b378e4b",
  "perf-field-and-multipage": "16e012c859565dd67a93f72db0fe8b0847babeba1cf58a7207d4fead8b378e4b",
};

test("CR-40: the complete foundation checklist is frozen for every branch", () => {
  const actual = {};

  for (const [name, siteEvidence, overrides, pathEv, input] of foundationMatrix()) {
    const checklist = buildFoundationChecklist(
      modelForSite(
        siteEvidence,
        overrides,
        pathEv,
        input,
      ),
    ).map((i) => ({
      id: i.id,
      label: i.label,
      status: i.status,
      detail: i.detail,
      requires: i.requires,
      evidenceNote: i.evidenceNote,
      assessed: i.assessed,
      foundational: i.foundational,
    }));

    actual[name] = normalizedSha256(JSON.stringify(checklist));
  }

  assert.deepEqual(
    actual,
    CHECKLIST_GOLDEN,
    "foundation checklist wording/status changed — review each change, then re-freeze",
  );
});

test("CR-42: the fixture matrix reaches every branch the checklist can produce", () => {
  const reached = new Set();

  for (const [, siteEvidence, overrides, pathEv, input] of foundationMatrix()) {
    for (const i of buildFoundationChecklist(
      modelForSite(
        siteEvidence,
        overrides,
        pathEv,
        input,
      ),
    )) {
      reached.add(`${i.id}:${i.status}`);
    }
  }

  assert.deepEqual(
    [...reached].sort(),
    REACHABLE_BRANCHES,
    "fixture matrix must reach exactly the reachable (item, status) pairs — add a fixture for any new branch",
  );
});

const RENDER_GOLDEN = {
  "assessed": "5f44740a4901c32dcab94b5ca9e10ba20dadf6223f2f9569287d0282185bec70",
  "unassessed": "7a7bd3ec65965c97df31e2433a5792e46e097d914b3749b5fd002fc7f669f40b",
  "provider-failed": "19a2cdc51c4e25a6e70f8ebb3cb977acec6b7058ac71d0e7947f6d2dca5d051b",
  "crawl-blocked": "5b00854ba5d0b1d952ce74e2d6521fc9f8fc529e214bf3e59f3850045a826312",
  "target-outage": "17b4736cf40fd389271120fce650bce2ad4b7c3f4be79f30839f188b239524bd",
  "outage-with-limitations": "c58dba0b55820d1e9f22ddbd266ce89d4f28023ec588a21df09acde4fc34cbcc",
  "http-and-noindex": "4233bdfddadc6350f3fd106af11f79c7b598f6018af0062f66852fd0ce5d23d1",
  "robots-retrieved": "4aeecd9041ac20a820f20e121e758984f8df0a5b9cbc78af4a234c4b1d9d8e6b",
  "canonical-missing": "e039597eb8f0f129e6a2175eca73d0bb3b894f7c6b19424b45fc90cd245a191d",
  "no-conversion-mechanism": "e7b64ac130fa3a6e265f0465191096945f50120ea3e4018ab8be883d2e13dc30",
  "no-contact": "1b32a3db4095681c907b74d67deee72e9773c08b0afd2fc60d57c9f387b23914",
  "headers-all-present": "31f021dd1ede3d2f74ba651daa0f726b99157fa4f61881dbd56c7aee5ce157fc",
  "ga4-ready": "69bfd7ddb965c6338f41f05d1f104c65a331d9cd257ed08923ec701ba790ae8c",
  "ga4-issues": "0105078904fdb852864bda617178b36af2892234e8ea9af3e0b11aac02750974",
  "ga4-not-applicable": "372f658a96dda0b739a87658c2f3caee56317dc461f4c7b3bdfaf977e4e5ef41",
  "slow-mobile": "fd9b2067003d3a2a155be5f71a2e8a95501e6ba18ea27daf8af634d32eeca841",
  "no-performance": "5b326a9229280e5d96cabee69d66b5b38799656d5b7f502fdbf09c3299b380bd",
  "path-validated-blocker": "97d88bb42fb080f6e9c9e7ce3524308c8eac16a7cc0f14a445d5bbe3bbf59067",
  "competitor-present": "41e60fb69a767f4f88e36f496dbcfdceff3a8265c12cc371cc5f1fd42d14348d",
  "proprietary-platform": "067764c8b44e982de2a44502e6fcc8488a56cceec34e0765f3c7fa476be0f7e2",
  "untraced-broken-links": "227f7e4f792d841e7ad7d3f9ad065e7aa9de719ed215757a644ffab8ff6f7a08",
  "schema-confirmed-absent": "83799fe751d9948d3d84ad437176d36afc56fbc571b7201677f5d94f61fb43c8",
  "headings-absent-h1": "54f733c352f7a2df369c67090deac55c0bb23776a65070648fa0a81614682b39",
  "headings-multiple-h1": "df7cc2633cd6e4a65238889ec7d7c2e2376b88c1dc27904bd9093e06ec049fdb",
  "perf-field-and-multipage": "58cc6596678eff7d6620b244a52a31ca3d70ba104754c779097df77011848f1c",
  "competitor-with-limitations": "3e53a244c792ad6fec0c9f78fae3db44b441424330b2f741ff9f6fc8b603446d",
  "device-profile-failed": "0f492945eb7741318e9185860a95709bfc43671ff42df1d0a801b933f2d5d8b8",
};

const RENDER_GOLDEN_PRESENTATION = {
  ...RENDER_GOLDEN,
  "assessed": "5f0fbc88656c387cf0a224b4b5b3a722bb05b8696e69afcd2f74e8827d904d9f",
  "unassessed": "2465534b8a40231a7e9e89ae7a49e92dee20f358dde7c2f993facd3015452eea",
  "provider-failed": "5bcfa9d998fc4fa0fc44a1a93e90f3911462c5ed98b022e913a01e24ef843a3b",
  "crawl-blocked": "8d52d1f0731f7fbb0767eb8e5a2777e412c855422cc6ee1ee03fd47dc7d7aa6f",
  "target-outage": "eb78c1520a5405c34b87026bd76be07d074117bf7045d1377102e42ac6daefa2",
  "outage-with-limitations": "ce347572f55d7a33696a253d53472057acdde70e549b28973ee5fcd1b4aa9459",
  "http-and-noindex": "9f40f8f3fccea9afb567dcfbd0b6e3dbd4b6a5ccc4a939cb9aec4c5cb8daa105",
  "robots-retrieved": "57a52957771a67636bca2a63a450fcf5b2793486d5b9e33efb8ebb301ecd1ad4",
  "canonical-missing": "d236a87db20669228d5e29ce5b56137865c198ab3c51e647e03f631721a20ecd",
  "no-conversion-mechanism": "22ce42358bf41053e02afe06d04a34facab99bc31755b7f81d2cdb52a768b59b",
  "no-contact": "f3ac46192a87ccbf4055f19bbbe4419d3055e4e70ab01572cde05f42db8e8da6",
  "headers-all-present": "01d06e6b5c410b87344bbdc33a709ff57aff51fa4f61881dbd56c7aee5ce157fc",
  "ga4-ready": "3efea87e8067c4ff99be8489a33886e80d726ca765b7b7d21184e0a8365bfd57",
  "ga4-issues": "b361211978d2a84781d3f7da4d7de3137614b18157ef87611b38addc8b7e1629",
  "ga4-not-applicable": "8203fb10f53df9fb13f6626a76e8b96d53ca4dc166fdfd59194223f77f400bb4",
  "slow-mobile": "2cdaadf3cacf3023e8f56cc88cefd7bdb8abe730edd6afe1dde288f2c3cafef0",
  "no-performance": "59bc75f90b742f92014de665828152deb356e19a7a6ebec924214be993d7264d",
  "path-validated-blocker": "2a0c33e5b6af4053e8f56cc88cefd7bdb8abe730edd6afe1dde288f2c3cafef0",
  "competitor-present": "26812bf31274b28da2414f8d2d374b14bd08b73f290526acbbfc9ea047335037",
  "proprietary-platform": "7538e5afc7a7da4f1f8c5971881c5f17352aac5048b2d18006d90554dca45e86",
  "untraced-broken-links": "dc56e46bcd17a3aa7450adae7d5d82d2eb83e63c90e3914c2a0c457563f3ed27",
  "schema-confirmed-absent": "53250a3e5ea29762edac2c77a49937c3c21741fa5578605ecb210cd1d3b98bea",
  "headings-absent-h1": "b699803dd54657b885d798d280174380d61370c4d24b06e25369d78dcc14b8c6",
  "headings-multiple-h1": "e5f98b48b895e86815646a02477164b7d8a4826547540acc65efae52c62ab477",
  "perf-field-and-multipage": "7924f94a1bdc96de1d4c4fd28b57b534426b71716548267429037ef4f3f84ef4",
  "competitor-with-limitations": "9ba6b648969ab89a0e267ef03a5cf31e834a164d51511914928051a55ae0da0f",
  "device-profile-failed": "28752ada14f8925bd4b8981cb4cff498c92e4d5766838aff8c9b051feb8f0ffe",
  "crawl-blocked": "5bf90fdbbc2b002eb40ae45ddcfc90daeef392d7ed061d02957eb11f10520f2d",
  "path-validated-blocker": "2a0c33e5b6af4053e02afe06d04a34facab99bc31755b7f81d2cdb52a768b59b",
  "headers-all-present": "01d06e6b5c410b87344bbdc33a709ff57aff51ac1d396a4e1cb78085ea52989f",
  "http-and-noindex": "9f40f8d3fccea9afb567dcfbd0b6e3dbd4b6a5ccc4a939cb9aec4c5cb8daa105",
  "path-validated-blocker": "2a0c33e5b6af40578839977824221a56dd3b2f4d83729dadcc55c63ac54cb3fe",
  "assessed": "a86fb333b836c53227c19adeaea0536cf37e73505f44aecf8a78cad3df0e5d94",
  "unassessed": "f3a73852bf4be39e574bf81195292615ef509493c2c777fcbe0c1ec16930222c",
  "provider-failed": "b18e96213470cba1424184b3cdcc432b3122d15cb69e75e0b87fb385e1e71b71",
  "crawl-blocked": "b93c0938bab10751d631cc59e931094f18783b6cf672bc7b54578666f7890164",
  "target-outage": "9b67ead881f14897936999837220837d67f333051d14c97b58d50d4502e56585",
  "outage-with-limitations": "e684c5fb90f04cd79372ccafc3f3ca5ecc167bb58be01403fb792260d402c8df",
  "http-and-noindex": "5202fbd4f2c207a8793cb2ff1f9d13f3c775e691e1bd215989a61ae67e9acbc1",
  "robots-retrieved": "fabcbf076a80cfe0c3466e55a7de8707b36d3dd3c7bd5417191a00aed2404456",
  "canonical-missing": "a1e1d5868f6900bcd6c4bc741c9d9a3d50e80b82791b8936d752b43d330d79a1",
  "no-conversion-mechanism": "e7ca41585bed0da1bb199fc314d25c58d465b94b37407773e65b0cb8f0df96ee",
  "no-contact": "4404e531766e253dc12c87e8a3092f4b7b0c9a8a075d79b48373caa7a85e0bd3",
  "headers-all-present": "4dfcbf4d98d24fc9dd63d08436256f3dc8765bf4c456f4726ca8e180d9f29b84",
  "ga4-ready": "891849a83a0b2e412561234015d0f95a85c9cb663c41590bcde910c47bf3dcea",
  "ga4-issues": "2df914da106a5eb0ba8db0d57c1c4f7d1a9c4a23dae80b31825972171ddcb3bb",
  "ga4-not-applicable": "cad8cfec32a0b199ff2ed6a4399359e0e55ec10804a5ea12148a6f220ba1cc8b",
  "slow-mobile": "f82417e9dbceeaa14811ad7a42472e70f5c81f2ba3631f00ada09ef5d8fada1e",
  "no-performance": "832b142777bcaedb5d21283bdc444ac7198567402258b2c457037deb4715a53a",
  "path-validated-blocker": "7dae2cf9021bf1426a1b3943a32192b64108e7c26f4a56bcc5826c4df8b3093b",
  "competitor-present": "3842295d8bc28c4355f1f8f25d6d12ce0bf7424e408dbb397df699357cc9b9c5",
  "proprietary-platform": "adfbef4c41d36361e5a0dd045bd5782b473d20b87615cc178df29a6b43635356",
  "untraced-broken-links": "d107b0c9c22a5052b6f2b482eacc1a21094e4d3a7b2ad51bf38c7d9b77e869b9",
  "schema-confirmed-absent": "414a7a23a0e37bfea7a34487a849777d2e31f3868f1f26bc8999d43b852cdfc8",
  "headings-absent-h1": "f23b1c6d7ea2ad30510eca949e76fb40fb2639e2454ee98caadb5ced393837be",
  "headings-multiple-h1": "9cc46e71585221f42044b9466154de47f8fc2ded6355666fb9bff810bbc2cef9",
  "perf-field-and-multipage": "2699f9ccfcf3efcc7b32dedc92d03b2f44a0b9864278cfb35962af3f55da17c3",
  "competitor-with-limitations": "ef5ba644bb28a9badf7763f1d21ef502808a60ddf5844c1a48265a85795d6457",
  "device-profile-failed": "51d8f7a4a8b14b270bd587b4dadfe5e0259e0dd765d069f13384490343e69c3a",
  "assessed": "e53aff419c55a66c522c1a7bca2519fbf6306a4022a997dce49cf7c07bfd8bfb",
  "unassessed": "ea896910f87e41452febf676975d254185781af58333698e59f9e1c5e268fac3",
  "provider-failed": "a4506502418b7391c60d50c6f9cbd276a6c52c2ba73271f416fca25349fdd75f",
  "crawl-blocked": "88bc8f6ba9a4fe841d4dc92ce04946e316e6821e90d0a36cc42c65cb504fc1cd",
  "target-outage": "42a22eedeb453d0f99bf4f74285c427db5e3afec701efd02a59c9c22f7e9cabb",
  "outage-with-limitations": "989eddc078a41a3fc4bd7fe89d1c411bd6feec912d92ae70985df25b04b1afdf",
  "http-and-noindex": "df7117460fc8dab069804a15abc35dfe51f97b98e4eefa893745e72b8ba66102",
  "robots-retrieved": "c351248bcb7440820680b3958009da75b0de15f8b447010f13105e219f43d83d",
  "canonical-missing": "9e3be17b664137921b7a37b3225b99e47aa1f277a4b166587e470a954ce09ff8",
  "no-conversion-mechanism": "6373edadcb9f26ca5d2fc7465e63dfd4f23417d9e9191fb804c4931411509307",
  "no-contact": "75d0507648ed637850025ef374ae53b289e7446e5d39548f45d3d9fd668b9ba1",
  "headers-all-present": "34a7cafc3f9744e0e734bc211f4fb179099e28bd3425d5d4826e2e00f8159b9b",
  "ga4-ready": "467265cb1c24d52d672f3824510b8f33aeffbf2828e529331161d1548e15f45e",
  "ga4-issues": "6f0e7a6d9ce1392afc67857835b2e85086475f9ac1b7e13ed2273634bd05c3ee",
  "ga4-not-applicable": "dc818cfd701409ed9e6aaa87c33d4037b9218b47a537de8be6762f1328effb5c",
  "slow-mobile": "7d4892d2c37ae59fd8ed79d95eb30cbd5e96b6b16bd856750b8aeed1ded831a8",
  "no-performance": "2ad763e544b700349a3a704cc06f3f8feea89830c84f1eedc9ca76e35e748eca",
  "path-validated-blocker": "af6bcb6efa988160ff7e79f724e4c37e46e6a616c3e73c6f0046a556a90a6178",
  "competitor-present": "c643582e0f90348f65bb2f21a1f0607069125f570776929ca48b8820314bfdee",
  "proprietary-platform": "e997ed45cde3feaa8d26098c0a5a97e27db24ea89de3da85830ece79fbc791fe",
  "untraced-broken-links": "c449e4423ac86b2a6ba61965fcfceaaf1a068531960a7eb6fa6edfb347ed00b0",
  "schema-confirmed-absent": "f47a469915a01ea01b2e8c9773f7c7113c0f9d4d5cdc65fa6865ca4bba73ec34",
  "headings-absent-h1": "7414ef37fc4644ed828386624a5be9ee69b68f28d2ff4effca355e471a0b2628",
  "headings-multiple-h1": "f5f44beb23a561789c1b8e6821faa56dbd0c3d3b39d2007d015db7cfe7184228",
  "perf-field-and-multipage": "7e950ecc80efe3dda61882a487b368407dd82a7735d3ebb082e9df4258975478",
  "competitor-with-limitations": "2eec43f11b2af14b79812e2438f40af296b08923d450f9d4a067d628e920b67d",
  "assessed": "ec3837106e9b4f5d42f021efc2ab9eefbb06152ab334cca4388a2c0860d9629b",
  "unassessed": "dbeb8a24b4f9369c015ac16d3985aec0a9b905e3de00163e33d213af0262eed2",
  "provider-failed": "cc9ccee045f9655b9805b3ad944d9626646bf4f2862a9ef671ee02fe35c51aab",
  "crawl-blocked": "304e7be01d0e51816690a5200afe821f2abeda4c76a5d62020dffd16b1e9b313",
  "target-outage": "b5e16822362c4c9c842527799304c9d8d52ddf678689dda07b0b119fb9255298",
  "outage-with-limitations": "3c25376b1c0804d976af71ed45b5a6f8fe8e4758d6a51f8e915d568b0e2d4673",
  "http-and-noindex": "108f6cd5f22829aa2f7e2c8149ca13c7d48fa699b1cc4b0f4ba742a14bcbf5e9",
  "robots-retrieved": "10c935658389d237602d2d973ce4ac6e544c7727fe3b05165791e9cca2c2e64f",
  "canonical-missing": "746ced6cff614d2d4065a7c9c051bf707924d18b75befae7d24cf12c7950246d",
  "no-conversion-mechanism": "ad18b2f60edbc188dbb9f535c5cf203254bf89450c004963f85913b8bea39d52",
  "no-contact": "632fa12033791f69ea6a8bfe9581edf0b970824977fe02166fd42dc085266acc",
  "headers-all-present": "55b402bb614d5e3556d804747b2d4fa42fe205409aee4f9c7ea15dfec9c17b64",
  "ga4-ready": "3e5e4733eb6fe978f450b5874c018f75be554567b93b77e858ac8ec0f8ac88a8",
  "ga4-issues": "940fe53998e16c35f406dd4c1214ebe0c27a9b8a73cae1d36ceb05acead206e3",
  "ga4-not-applicable": "0f868b634c4d4726f6cc0add10651d0834fb8acaeee566864d0ab1752a3b0301",
  "slow-mobile": "a92f23f2c6d250d25c48ad778a42fc84aff96ef6e2d1a983112f9a21f86a2bce",
  "no-performance": "4540f78f03e79befb249425bddaa219289a0196656383200779f163cb18f6cd1",
  "path-validated-blocker": "70f8616fe93b98eccd85ee0ca994dd2026a638b9bce3f47f7bd7c74c31d49e6f",
  "competitor-present": "92aebe6c4b9a5ffde01eabdc570137cb7c9e0ba659c1b9df8cd712d99dc034a4",
  "proprietary-platform": "8406388838415a8b4b97a7c12d26070780825eb55fec5c04798d26d436a01a5e",
  "untraced-broken-links": "457d7e108476280eeb782ef59d5b0807d5a5cc268c4fefc16fe2090cb44836e8",
  "schema-confirmed-absent": "d402fe8856282968867db14c22e0b1e057a3844260bf7abf1c3a2785b449c2c7",
  "headings-absent-h1": "d8c98fc9121fe8656268e51cfd213e945d992a3f251a5e0312dec36dcf58e3c2",
  "headings-multiple-h1": "e1da82f0af6520cab5687c0f24063e81d0fc8febddd17f0c0baa72c987874831",
  "perf-field-and-multipage": "ad17e6526be04dc61b1303b334c69ebf4577e7d42dcdccef00e97bcd69d557b5",
  "competitor-with-limitations": "dce879ec41aeaea61fc3f1a6adbcfc8e69e8cf9565beb9b23eb44bcb31ea55b0",
  "device-profile-failed": "9ef075afdd45a438945e154131b252e79197d598ab9a001ab916c6dd7f973e80",
};
Object.assign(RENDER_GOLDEN_PRESENTATION, {
  assessed: "ec3837106e9b4f5d42f021efc2ab9eefbb06152ab334cca4388a2c0860d9629b",
  unassessed: "dbeb8a24b4f9369c015ac16d3985aec0a9b905e3de00163e33d213af0262eed2",
  "provider-failed": "cc9ccee045f9655b9805b3ad944d9626646bf4f2862a9ef671ee02fe35c51aab",
  "crawl-blocked": "304e7be01d0e51816690a5200afe821f2abeda4c76a5d62020dffd16b1e9b313",
  "target-outage": "b5e16822362c4c9c842527799304c9d8d52ddf678689dda07b0b119fb9255298",
  "outage-with-limitations": "3c25376b1c0804d976af71ed45b5a6f8fe8e4758d6a51f8e915d568b0e2d4673",
  "http-and-noindex": "108f6cd5f22829aa2f7e2c8149ca13c7d48fa699b1cc4b0f4ba742a14bcbf5e9",
  "robots-retrieved": "10c935658389d237602d2d973ce4ac6e544c7727fe3b05165791e9cca2c2e64f",
  "canonical-missing": "515532eae592d0383228461b714fae5d69105fd6fa2b0913328ef405d29208e9",
  "no-conversion-mechanism": "ad18b2f60edbc188dbb9f535c5cf203254bf89450c004963f85913b8bea39d52",
  "no-contact": "632fa12033791f69ea6a8bfe9581edf0b970824977fe02166fd42dc085266acc",
  "headers-all-present": "55b402bb614d5e3556d804747b2d4fa42fe205409aee4f9c7ea15dfec9c17b64",
  "ga4-ready": "3e5e4733eb6fe978f450b5874c018f75be554567b93b77e858ac8ec0f8ac88a8",
  "ga4-issues": "940fe53998e16c35f406dd4c1214ebe0c27a9b8a73cae1d36ceb05acead206e3",
  "ga4-not-applicable": "0f868b634c4d4726f6cc0add10651d0834fb8acaeee566864d0ab1752a3b0301",
  "slow-mobile": "a92f23f2c6d250d25c48ad778a42fc84aff96ef6e2d1a983112f9a21f86a2bce",
  "no-performance": "4540f78f03e79befb249425bddaa219289a0196656383200779f163cb18f6cd1",
  "path-validated-blocker": "70f8616fe93b98eccd85ee0ca994dd2026a638b9bce3f47f7bd7c74c31d49e6f",
  "competitor-present": "92aebe6c4b9a5ffde01eabdc570137cb7c9e0ba659c1b9df8cd712d99dc034a4",
  "proprietary-platform": "8406388838415a8b4b97a7c12d26070780825eb55fec5c04798d26d436a01a5e",
  "untraced-broken-links": "457d7e108476280eeb782ef59d5b0807d5a5cc268c4fefc16fe2090cb44836e8",
  "schema-confirmed-absent": "d402fe8856282968867db14c22e0b1e057a3844260bf7abf1c3a2785b449c2c7",
  "headings-absent-h1": "d8c98fc9121fe8656268e51cfd213e945d992a3f251a5e0312dec36dcf58e3c2",
  "headings-multiple-h1": "0573ddd16dc732cbd6f67345ec7be619e305c0e09f7e4c77788d81d6e304a0bf",
  "perf-field-and-multipage": "c44bbfd3849700c5e301bf5dc78d229080d5d16b9c017570ac7b60a6a1183647",
  "competitor-with-limitations": "420eaead3b39fab67994a7db5f2e9584c755aca5396ced843edc215d925cfc98",
  "device-profile-failed": "27e6247f3d04c71b1f3ef3df72fa2d2988e5fb42a0cd716c907c1b32860a816e",
});
Object.assign(RENDER_GOLDEN_PRESENTATION, {
  assessed: "645e5ee8189bd8fb70bdd784f65055388928f124cdde9c882f2a336004a25015",
  unassessed: "ad775a8353282a2826915f6938c95461098e589ca06dbbc23d21df28d9fe1af0",
  "provider-failed": "02e3c104df71242588f3d2f8cb6c6cba5787e192c8457808dd1ed04639d3ece6",
  "crawl-blocked": "594876b457cd280aef45e44856879c556330a4ad558e124af0a00742683c1c96",
  "target-outage": "8b0a626a04cd0fa36ec68b1bf8889e8272a9af66a5a843a0058410b3a66575bd",
  "outage-with-limitations": "680460f6563ec86a3beefeebba5009a550736d624e2e94d4fcac14b08c5e0f09",
  "http-and-noindex": "139591fbdd193b61a409b862e47303fd1029697d9479c56664a09f8bc951393f",
  "robots-retrieved": "d111d50195e18baa3397d8e50b207208a8094bce1d364c78c88bc3d83a2a90b4",
  "canonical-missing": "e8bb033c0de1e43c41f7d01799975baa12d3c6ee9f397893e06ed8b71488e60e",
  "no-conversion-mechanism": "0303ab349a6a22dd053f95eee743c11bcf292b988af268fecc085b462b9e829a",
  "no-contact": "cb2c0d49c23fabde8e0493b2c51976e4be35cc24198c023311213757d8abab4f",
  "headers-all-present": "e4ba02f27be3efd545e0c3f7b3b7b84958034f0e0b52a2d23586ae335fb66248",
  "ga4-ready": "57c6e76cf88014651dd1a1f87cc426bcef6f3fe3d45273e0b6d0beba4c53d3a5",
  "ga4-issues": "96e528126ce5ef6352075d0617e00122922258c21ead247bc21f2043d3de57d3",
  "ga4-not-applicable": "70cc69f6e51890565546c3c3d5d54ec361bb9841cee43e5575bf7843dde16e21",
  "slow-mobile": "54879c98696cba8ac65203cf415dfc1a87ad0dd966ea1b934d5b6e5c1b1d5d80",
  "no-performance": "06c905573757b800aa522a4321d0ff5c67cb4062ea4c6295538449b37a11fa26",
  "path-validated-blocker": "863361c1981b921dd223cb0dd91a4488b12c3d02e7deb9ab7f945d4d5882a148",
  "competitor-present": "661d487ff891ac4532cb9551b983329d00e2ac0d5ba6c436dc0d61147f88ca8b",
  "proprietary-platform": "44abd054f4c5f612bae2dbdf050a9417695ade438a7e9f891dad016c100de444",
  "untraced-broken-links": "0d39b631d1f7654b86706a606f2dfde66ebafd977e2eda3f1941e1758e4f2263",
  "schema-confirmed-absent": "26a026d30e0192c9638461b356923e556dae9e46cef11e80320ab91cb33966e4",
  "headings-absent-h1": "b704ad50f93b4c758c8b647f393d9b78ddff5f190887f614c37b85e3b01bf978",
  "headings-multiple-h1": "fd5c63d6ef8d0dc8dd33948666ff161c8e18935c7d69ec114d324b8d2248ff2e",
  "perf-field-and-multipage": "afcc4126220fce749a8aa89fa44759884bd9f63b37ff2174054fa2e457205ad5",
  "competitor-with-limitations": "a1770d68b40efaf93c84cc17acc74c48c32a850e2e9b52a4a88eda1e70c158ca",
  "device-profile-failed": "212d6c6ce46a747342cfc7e8c27243bfec3473e00902c1b240d5cb5497298e60",
});
Object.assign(RENDER_GOLDEN_PRESENTATION, {
  assessed: "a80a6953d53aa88d65295e3f5baaa9fa4db2083faa2d200cfa767626c1067c2d",
  unassessed: "797fad6f653105075a62a2642ecc3f1c4bb70557d6dfd1906d40762981b28981",
  "provider-failed": "a328dc31c4a92d4f3f91c795e4fc05228283d13d8f033382ea7fba26b72c34d2",
  "crawl-blocked": "d7e349c7c7e11b04eee9665b5ae1dab81a9972e8859897ff9cb6813a994e7c55",
  "target-outage": "79752593c69c4d32a77b6fd131928d5ab9718518a52cd8ebbbe7eb8733f9ac8d",
  "outage-with-limitations": "7524011f6e183c7cf51f07108710e581e4431c4beb476731300d5ddcf373b937",
  "http-and-noindex": "3a887374ab5b96bfc8c70a372f8360cc13a6ca34390e9125fe1cb4600293bd9d",
  "robots-retrieved": "d7b3b10dd8f4a9321dfa950dcf1b043871e681635aaf5b3f03e9cc5476ab146f",
  "canonical-missing": "506269a295e0f97532859778bdbdc7395261444b7443846961f63438a535807c",
  "no-conversion-mechanism": "7f6c5f87dc00139ee682c359d5e4cd3b4b21484b90067af57b0b24f7a37be805",
  "no-contact": "e57e2d31dea60ff688c8a1393f7cfff4cb0d293681298e4d3eaa644ce49188f2",
  "headers-all-present": "e8ce449ec0f43e0dd6f72827d4d021f2c6a0c1a1002fae58c28e9314bfc43591",
  "ga4-ready": "f3abdadb664b9c30f311a6f9f53e4f7a5dcf901b22cb3be93f23eb376f58c8c6",
  "ga4-issues": "a4e5c114ecb70eb37e1a7ebbe5b828cb209dd6c31ed125bac584a630c3d0d9fe",
  "ga4-not-applicable": "abdc10c907449f7c781371a0e1d548569cec21cd1bf17a91c27426c6f3517ae5",
  "slow-mobile": "04f55c55550488fd1861110b90120ef7c955f2360972ecebea1b14d58118ed8c",
  "no-performance": "e0e9c8a2a4971adcfcaf5ccc623be38fc6c0fbc9e7589ac7850cf12da5cd00d2",
  "path-validated-blocker": "6092938b3248a09e171e98b343e7ff9e480c7a441e647b201b3cea25bfbda5a5",
  "competitor-present": "f2b9f1eb2678d68c499324d32913b73a9bf8aa00d2f56cfadc754b8aef14212a",
  "proprietary-platform": "01fccef71a732276c50d05d7c24741eeb62a03ac770d9aea5b4efae3b648afcc",
  "untraced-broken-links": "bfe02387c4657a2f3a0cd74be1a0bd95e61ce4803941ef58a5210cfca99ba84e",
  "schema-confirmed-absent": "625a2f2684762dcd095b09d2615f6ea16ee5c773f4f867593300e71c6aae62ea",
  "headings-absent-h1": "1136bef8e7a4b9fe3eb189505d28659352d4d02b320b14a2f75e659cd2984917",
  "headings-multiple-h1": "e24ef9b93614e4a17cf6a29e094f251405964a11f47fdf7b29d377f4cd33d326",
  "perf-field-and-multipage": "2991b1f530ad1c2798956857d30c78ac636b47f103217add5ee713a60c507b04",
  "competitor-with-limitations": "0a76463f9a87f472dfbeb2c5e0a34fe615ae0a674c1e8f81a5b56d7a631b92a1",
  "device-profile-failed": "6933e3bb9e1ecd144366ccde2628dd9f3557921b0a40ab2076423ed29fd928d5",
});
test("CR-43: the full rendered report is frozen for every branch", () => {
  const actual = {};
  const proofDir = process.env.P1_RENDER_PROOF_DIR || null;
  const manifest = [];

  for (const [name, siteEvidence, overrides, pathEv, input] of foundationMatrix()) {
    const html = renderReportV2(
      modelForSite(
        siteEvidence,
        overrides,
        pathEv,
        input,
      ),
    );

    actual[name] = normalizedSha256(html);
    if (proofDir) {
      mkdirSync(proofDir, { recursive: true });
      const file = join(proofDir, `${name}.html`);
      writeFileSync(file, html, "utf8");
      manifest.push({ scenario: name, file: `${name}.html`, sha256: actual[name], hashNormalization: "LF", applicationSha: process.env.P1_APPLICATION_SHA || "UNBOUND", renderer: "renderReportV2", test: "CR-43" });
    }
  }

if (proofDir) writeFileSync(join(proofDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const canonicalRenderGolden = {
    assessed: "014f7601a33f6c87e703c5596fd716e778a069cf54e266694184685aaf3cbf5f",
    unassessed: "ff098874c00eb4298de93f74cdb4f7d7d2d6d41473f84747429d9518907314a9",
    "provider-failed": "18510b7efd74e65ac5ffb1cca10d9a572b1fbea87d6e710364f8b643a80362fb",
    "crawl-blocked": "65980a84bac6a9786c1c069b8bd6ef04982c4eaf5639eed05e907c22fa2afdc6",
    "target-outage": "02cd53aeaf5e821b270804f21ef52f18f85997964652a0bb5624e5f3bc4f1b5d",
    "outage-with-limitations": "4e9b3832529d2f29298550665542c14d5eb7aa64d50ecd6a3c198cf821ee9aa7",
    "http-and-noindex": "a506bed65e8d7e72284ce26473e428c7fb58d92a6d405e79c7375aeb76cac9a0",
    "robots-retrieved": "12381f596f3d14c182441ca8a349d8ff70aca2ce824ace46906e4ae5c33c71f7",
    "canonical-missing": "98208307da34a8f2880a7734a598c82ad0cbacf887b98b4a53789b900e87c0b9",
    "no-conversion-mechanism": "d00102782a6c3900a354a169dd7589fb7ca709504a37911c6af50a0618846923",
    "no-contact": "adeb1783da2fc2d18f657e4cfbee3e17910f5fb88f4e89710ee2dda8eaf26671",
    "headers-all-present": "41361e3b63a7ae30c7651d7fef96fcf4170d80f68e5564b54fe568ae0effc9a2",
    "ga4-ready": "80a785e36c0363a22d711c7785b83fc7ca247f076161685b97d358af45140884",
    "ga4-issues": "e1c7e9dd015ff49aac1c73b1adc8745176331b09626b6075c5691f8c0c98844d",
    "ga4-not-applicable": "b6d28893d9b0ce51de98fcb245bcbac7b3a80a1faa9bab39c4370665ae5ab9b3",
    "slow-mobile": "300044afcbc1038fb4ba925895d2b286ca009be56189ced698887434042fbb6c",
    "no-performance": "cc4456a95bd8f451d3c79b785e6f171df69d97876791dbec77dfa0868e85756a",
    "path-validated-blocker": "b21cab8d9cf5e258940eed18a585885ef20679732f6f13f6996fb36b8597ee03",
    "competitor-present": "50afab69ea9550d08446d4148c6fd57337c6a924b20f8c67aa0531da8ade7cfa",
    "proprietary-platform": "f5088130dd62576e57a0df6f70a21df6c2dc9eefbcd573d60c5003fe3fa16e19",
    "untraced-broken-links": "b307d5a92e85f4e31e6fd9250ac5bba1c9d57267278c2cc7096170fa88b2d1e2",
    "schema-confirmed-absent": "2d6d9611d6b8ec362407f665f16e939bba78ec54af203755a62d024f99d3ed29",
    "headings-absent-h1": "c4f111a83325ca863e5b703b212b324f46d0b908f38853f06e8df240c5fcb57c",
    "headings-multiple-h1": "9893edc784d30a1978a66a0717da38319122434f3a09a9f56a3df85e976315f2",
    "perf-field-and-multipage": "c9e09868c216b819917ba9e3d7883b4a0835f674015fff08df4e3263a5af563c",
    "competitor-with-limitations": "5d315c7c081a6d329830b57e0a844469672f10624925e22891c7040dd3c81005",
    "device-profile-failed": "f87f5f179371837a92f7da370687a9caf04cc35b8a002c15d44170d150e2d785",
  };
  Object.assign(canonicalRenderGolden, {
    assessed: "1898da4f556c8683ab66e37639c6858d9174aa636fc325122966a60e09b7d7e0",
    unassessed: "2c9d6e67101d375e3d09b6a62ef4d49e59368b775b5268f68028fd99c0690e13",
    "provider-failed": "93866ce35a36178d50886edde3269f3ba75e9ef23ffa5730d75bd077b6c95413",
    "crawl-blocked": "a5da9839a8d563e6ebfe6f9a78c3daf02a85c7d1586cf6a2dddd67885005505a",
    "target-outage": "525e2bc17944037b1f5535ad1ed298f547bc40ef8b4e91988b4fa670b6fefc2b",
    "outage-with-limitations": "a24701cb159df389471c2dd0b4fc539a23f24d23961c2c713c74b989e4184f90",
    "http-and-noindex": "1326dc258b4ee4bfe8c590341a2e38117bc9a938df8fa13179925b58fe3e4068",
    "robots-retrieved": "62f7ca28957afe87b1774bf05cb4e5d749545e7aced7c134438bb7db72279816",
    "canonical-missing": "c1b1c9b76eb52dd23b80c64ab0f30da80aaa8c6c52dbfd9a431e03de439a29a1",
    "no-conversion-mechanism": "bd91e3d8d495f5792beefd42c775947e18b03271c5c3181ec56f5183f7390460",
    "no-contact": "3f9ed9f230061caa6fee34b9b9c904f03007e7a9ad0225ab1287eb60ff1fb4a4",
    "headers-all-present": "14225393a9568221660907ab1f4249786900122b7d903ea123c96093d45f3a29",
    "ga4-ready": "49d447befb190f923f8e4a881e921d18af1cb3715da1ad022a090249f02323f5",
    "ga4-issues": "428c66e5a8cd320661a0f37f4b6ead8707d8799a04f8c40a7299ab8f94c18f91",
    "ga4-not-applicable": "28a61fd9461cc129bab525ae900d55614d0dd1ef4d67a2af88aaf816c4a4cf6e",
    "slow-mobile": "00c9ca08d998e37bf828bf930912aac8a52da69030c04a62f707207b32234c9c",
    "no-performance": "ccc6ca8923ede7047e082736b920fba6531963667c5d39b21ba9c24397009b1b",
    "path-validated-blocker": "78e25d62bd7bc887231c515adc9ed546b44b09091367bdeb818601c53ca610e5",
    "competitor-present": "bf8b1cfd83b4d65e6aa908d194fc8dc2db4b9160db2644be843fed0299e0f6ae",
    "proprietary-platform": "6849aa3fe81d29377e8ec82e6d38d458dc3895362eb46705d44e879f9c271772",
    "untraced-broken-links": "19f6214e488342acf93fb813ae2fde6a9b512a2380934b1d6659771f66343dad",
    "schema-confirmed-absent": "feb1562195a76e57b5971bc79c0679bdf72af88c2277ba96601ea9ab2c75933c",
    "headings-absent-h1": "78c6c81b5d354e1648cb18cc058d191de4f804c98b3af242d2fc68e23eebf091",
    "headings-multiple-h1": "99873aaa5f18022edc58480dab11c0a07f184890f55645289f235396ec4f7509",
    "perf-field-and-multipage": "ab80e15e56633f0f7ecf6f4cd68bbec9b4065509bec6c3cb0e352df0d6e6af23",
    "competitor-with-limitations": "010cfee185556bfd4f9d7f940fdd905b7e301f266e8c59975b2b77f888bfeb1b",
    "device-profile-failed": "d0a5d82d7f2fc36f79abc75dc10964c345047f076c1f3c585131cb759a3d248f",
  });
  Object.assign(canonicalRenderGolden, {
    assessed: "85aaf5183786e52aef5c46e2461e2cecc7d5a1c87b6209e2f351f1227ca9b607",
    unassessed: "417693466efa8f96a4edd0eab5c10894d84e9c729313ed62ddb37b27f8c157ce",
    "provider-failed": "93866ce35a36178d50886edde3269f3ba75e9ef23ffa5730d75bd077b6c95413",
    "crawl-blocked": "a5da9839a8d563e6ebfe6f9a78c3daf02a85c7d1586cf6a2dddd67885005505a",
    "target-outage": "cd3242ba1af425f6d8c002d8b2fa6fa65a8b0dc33f134c579357d903faa3e18f",
    "outage-with-limitations": "9066cfdf6d88ef7073a80998cd5f2c7b3d0caf2dbc79cb1cff241333d0121f94",
    "http-and-noindex": "93c7b8037217dc4d2b628c0e9f2f3e37fa7a584f7d0d8391df09518a165a11d7",
    "robots-retrieved": "053c5b3b6122eb0ce6381d78d453a16d4dd4503bce82758d1d4c6f8e6854c609",
    "canonical-missing": "d9ac5770a1ebefc821149fa03f870f13db1fd3a075f5722c98576eb9fca6fcc0",
    "no-conversion-mechanism": "453ecb0892a7c3659f21ed06fcfe813e99b3ece299ae3468a118476ea3803f76",
    "no-contact": "fb3b558616d993db2e78346073e761b205cbd2585fec99498a1a972bd882a356",
    "headers-all-present": "5ba40e01d5c7a1b9ecdf5673d584e10593cb4cfec77ec0298d1462bcb610cf52",
    "ga4-ready": "72c7a9976d395a645ffd451a0fc292dbfc063c0095607db40903d25880a68b69",
    "ga4-issues": "2766a4f2fa72a329bf470bdd97f5a9c2741f165011edc014af463798ff3e0c5e",
    "ga4-not-applicable": "d9f2e0f649f01022d2e302688755edbbefb348e8436ccf7c3d60651356bed6be",
    "slow-mobile": "b3d96155df755ccfac117457af215713b9467796e89eb6d64ade1f8561813cef",
    "no-performance": "84cd08db6feec508ea7f891daff1b6d541161c97db35e0acc8d16d55182487fb",
    "path-validated-blocker": "760cd6d348db05ccd47dc6eb6960ee370a49fc6ba3520b26460d82a6ac06fcbc",
    "competitor-present": "d365b285be92105da3c4921063c839a13292d2a3eed61566c7cced2667a89ead",
    "proprietary-platform": "ae5ef877ba516d1012828ce7c0444285caf24dd0e1f85f483d84baf90f0c077c",
    "untraced-broken-links": "451556b31de99e5c915c6a09fb51d6350c06124e286645db70f01a9ec1325341",
    "schema-confirmed-absent": "259a02dba6f78721d5209abfea2d30a09c6b85878c5ec40c23dda60beaa1e4b3",
    "headings-absent-h1": "57074dfa7abf7974b03843f240a506662db6b8ed4f134b63589bff10adf3c81f",
    "headings-multiple-h1": "bf786d408592839c2ba9a83dbd3d56255c8b09461b85254156f710bef3134c81",
    "perf-field-and-multipage": "d3f74ea5dd7bb044d53b855adeea1fa98e0b07c4daaad7e082d8a0896d437568",
    "competitor-with-limitations": "fafcbb32c0ce2aef00b63b127afc84fc8580405eef204257cdea5fcc97ebb281",
    "device-profile-failed": "ea0425598002d8002f3a4c2f7460794ca02b79a381fc1d04bd3871bd5b839b8f",
  });
  assert.deepEqual(
    actual,
    canonicalRenderGolden,
    "rendered report changed — review every diff against the no-fabrication invariant, then re-freeze",
  );
});

const RENDERER_BRANCH_MARKERS = [
  ["Priority Fixes client action sequence", "How to fix it"],
  ["competitor comparison note", "does not claim traffic, rankings"],
  ["proprietary-platform migration risk", "proprietary platform constraints"],
  ["untraced broken-links note", "could not be traced"],
  ["schema confirmed-absent branch", "No structured-data type was observed"],
  ["heading absent-H1 branch", "No H1 was observed on this page"],
  ["heading multiple-H1 branch", "H1 headings were observed on this page"],
  ["device profile FAILED branch", "Result: Unavailable"],
  ["CrUX field-data note", "CrUX"],
  ["competitor limitations block", "SERP coverage limited"],
];

test("CR-44: the render matrix exercises every claim-bearing renderer branch", () => {
  const rendered = foundationMatrix().map(
    ([, site, over, pathEv, input]) =>
      renderReportV2(
        modelForSite(
          site,
          over,
          pathEv,
          input,
        ),
      ),
  );

  for (const [label, marker] of RENDERER_BRANCH_MARKERS) {
    assert.ok(
      rendered.some((html) => html.includes(marker)),
      `no fixture reaches the ${label} — add one, or its wording is unfrozen`,
    );
  }
});

test("CR-41: rendered foundation cells reproduce the model verbatim", () => {
  for (const [name, siteEvidence, overrides, pathEv, input] of foundationMatrix()) {
    const model = modelForSite(
      siteEvidence,
      overrides,
      pathEv,
      input,
    );

    const checklist = buildFoundationChecklist(model);
    const html = renderReportV2(model);

    const start = html.indexOf('<section id="foundations"');
    const section = html.slice(
      start,
      html.indexOf("</section>", start),
    );

    for (const i of checklist) {
      assert.ok(
        section.includes(esc(i.label)),
        `${name}/${i.id}: label must render verbatim`,
      );

      assert.ok(
        section.includes(esc(i.detail)),
        `${name}/${i.id}: detail must render verbatim`,
      );

      if (i.requires) {
        assert.ok(
          section.includes(esc(i.requires)),
          `${name}/${i.id}: requires must render verbatim`,
        );
      }

      if (i.evidenceNote) {
        assert.ok(
          i.evidenceNote.startsWith(EVIDENCE_ATTRIBUTION_PREFIX),
          `${name}/${i.id}: evidenceNote must carry the attribution prefix`,
        );

        assert.ok(
          section.includes(esc(i.evidenceNote)),
          `${name}/${i.id}: attributed evidence note must render verbatim`,
        );
      }
    }

    const claims =
      section.match(
        /\b(unreachable|inaccessible)\b|\bdid not respond\b|\bcannot be used by anyone\b|\bdoes not load\b/gi,
      ) || [];

    assert.deepEqual(
      claims,
      [],
      `${name}: renderer introduced a site-behaviour claim: ${claims.join("; ")}`,
    );
  }
});

test("CR-20: unavailable evidence never becomes ACTION REQUIRED", () => {
  const model = scoreWith(unassessedSite());
  const checklist = buildFoundationChecklist(model);

  const actionRequired = checklist
    .filter(
      (i) =>
        i.status === FOUNDATION_STATUS.ACTION_REQUIRED,
    )
    .map((i) => i.id);

  assert.deepEqual(
    actionRequired,
    [],
    `no ACTION REQUIRED may be produced from unassessed evidence (got: ${actionRequired.join(", ")})`,
  );

  for (const i of checklist) {
    if (i.status === FOUNDATION_STATUS.NOT_ASSESSED) {
      assert.equal(
        i.assessed,
        false,
        `${i.id}: NOT_ASSESSED must not claim to be assessed`,
      );

      assert.ok(
        i.requires,
        `${i.id}: NOT_ASSESSED must name the evidence it needs`,
      );
    }
  }

  const chipCount = (m) =>
    (
      renderReportV2(m).match(
        /<span class="chip cap-missing">ACTION REQUIRED<\/span>/g,
      ) || []
    ).length;

  const required = (m) =>
    buildFoundationChecklist(m)
      .filter(
        (i) =>
          i.status === FOUNDATION_STATUS.ACTION_REQUIRED,
      )
      .length;

  assert.equal(
    chipCount(model),
    0,
    "unassessed fixture must render zero ACTION REQUIRED chips",
  );

  assert.equal(
    chipCount(model),
    required(model),
    "render must match the model for the unassessed fixture",
  );

  const proven = scoreWith(
    assessedSite({
      targetUrl: "http://x.com/",
      nonIndexablePages: [{
        url: "https://x.com/",
        reason: "noindex",
      }],
    }),
  );

  assert.ok(
    required(proven) > 0,
    "control fixture must produce proven deficiencies",
  );

  assert.equal(
    chipCount(proven),
    required(proven),
    "render must match the model for the assessed fixture",
  );

  const ga4Item = itemById(
    checklist,
    "conversion_measurement",
  );

  assert.equal(
    ga4Item.status,
    FOUNDATION_STATUS.NOT_ASSESSED,
  );

  assert.ok(
    !/missing/i.test(ga4Item.detail || ""),
    "GA4 not connected is never 'missing'",
  );
});

// ===========================================================================
// ACTION PLAN — CR-21 .. CR-23
// ===========================================================================

test("CR-21: Do Now / Do Next / Later grouping is deterministic", () => {
  const model = scoreWith(
    assessedSite(),
    {
      pathValidationEvidence: OBSTRUCTED_PATH_EVIDENCE,
    },
  );

  const a = buildActionPlan(model);
  const b = buildActionPlan(model);

  assert.deepEqual(
    a.actions.map((x) => [
      x.finding.ruleId,
      x.group,
      x.actionClass,
    ]),
    b.actions.map((x) => [
      x.finding.ruleId,
      x.group,
      x.actionClass,
    ]),
    "grouping is stable across invocations",
  );

  for (const action of a.actions) {
    assert.ok(
      Object.values(ACTION_GROUP).includes(action.group),
      "group is from the governed vocabulary",
    );

    if (
      action.actionClass ===
      ACTION_CLASS.FOUNDATION_BLOCKER
    ) {
      assert.equal(
        action.group,
        ACTION_GROUP.DO_NOW,
        "foundation blockers are always Do Now",
      );
    }
  }

  const easyLowValue = buildActionPlan({
    findings: [{
      ruleId: "VAN-TECH-005",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      scoreBearing: true,
      finalPriority: 25,
      severity: "Low",
      implementationEffort: "L",
    }],
  });

  assert.notEqual(
    easyLowValue.actions[0].group,
    ACTION_GROUP.DO_NOW,
    "low effort alone never promotes to Do Now",
  );

  const html = renderReportV2(model);

  assert.match(html, /DO NOW/i);
  assert.match(html, /DO NEXT/i);
  assert.match(html, /LATER/i);
});
test("CR-22: the governed verification method carries through to the plan", () => {
  const model = scoreWith(
    assessedSite(),
    {
      pathValidationEvidence: OBSTRUCTED_PATH_EVIDENCE,
    },
  );

  const plan = buildActionPlan(model);

  for (const action of plan.actions) {
    assert.equal(
      action.verificationMethod,
      action.finding.verificationMethod,
      "plan verification must be the finding's own governed verification method",
    );

    assert.ok(
      action.verificationMethod.length > 0,
    );
  }

  const html = renderReportV2(model);
  const blocker = findingByRule(model, "VAN-PATH-001");

  assert.match(html, /Inspect the governed .* at the assessed scope\./, "canonical implementation check rendered in the report");

  assert.match(
    html,
    /MEASURE/i,
    "action plan exposes a Measure step",
  );
});

test("CR-23: the action plan invents no business result or ROI claim", () => {
  const html = renderReportV2(
    scoreWith(
      assessedSite(),
      {
        pathValidationEvidence: OBSTRUCTED_PATH_EVIDENCE,
      },
    ),
  );

  const idx = html.indexOf("Client Action Plan");

  assert.ok(
    idx > -1,
    "action plan section must exist",
  );

  const plan = html.slice(
    idx,
    idx + 6000,
  );

  for (const forbidden of [
    /\d+\s*%\s*(more|increase|uplift|lift|improvement in (leads|sales|revenue|conversions))/i,
    /\$\s*\d/,
    /guarantee/i,
    /will (increase|double|triple)/i,
    /expected (revenue|roi)/i,
  ]) {
    assert.ok(
      !forbidden.test(plan),
      `plan must not contain an invented outcome claim: ${forbidden}`,
    );
  }
});

// ===========================================================================
// LANGUAGE QUALITY — CR-24 .. CR-25
// ===========================================================================

const GOAL_PHRASES = [
  "generate qualified enquiries",
  "book consultations",
  "increase sales",
  "request a quote",
  "schedule a call",
];

test("CR-24: supplied primaryGoal phrases render grammatically", () => {
  for (const goal of GOAL_PHRASES) {
    const model = scoreAudit(
      {
        ...INPUT,
        primaryGoal: goal,
      },
      evidenceWith(assessedSite()),
      {
        scoredAt: FIXED_TS,
      },
    );

    const html = renderReportV2(model);

    const capitalized =
      goal.charAt(0).toUpperCase() +
      goal.slice(1);

    assert.ok(
      !html.includes(`Toward ${capitalized}`),
      `must not render the broken "Toward ${capitalized}" shape`,
    );

    assert.ok(
      !html.includes(`First Step Toward ${goal}`),
      `must not render a bare verb phrase after "Toward" for: ${goal}`,
    );
  }
});

test("CR-25: no malformed concatenated recommendation headings", () => {
  for (const goal of GOAL_PHRASES) {
    const model = scoreAudit(
      {
        ...INPUT,
        primaryGoal: goal,
      },
      evidenceWith(assessedSite()),
      {
        scoredAt: FIXED_TS,
      },
    );

    const html = renderReportV2(model);

    assert.ok(
      !new RegExp(
        `Business Coaching for ${goal}`,
        "i",
      ).test(html),
      `must not render "<Service> for ${goal}"`,
    );

    assert.ok(
      !/\bfor (generate|book|increase|request|schedule) \w+/i.test(html),
      `generated text must not place a bare verb after "for" (goal: ${goal})`,
    );
  }
});

// ===========================================================================
// COMPETITOR — CR-26 .. CR-27
// ===========================================================================

test("CR-26: client competitor comparison uses only usable evidence and governed own-site conversion state", () => {
  const baseModel = scoreWith(
    assessedSite(),
    {
      input: COMPETITOR_INPUT,
      evidenceOverrides: {
        competitors: [
          {
            url: "https://rival.com",
            domain: "rival.com",
            status: "AVAILABLE",
            collectedAt: FIXED_TS,
            evidence: {
              domain: "rival.com",
              pageCount: 8,
              pages: [{
                title: "Rival Coaching",
              }],
              services: [
                "Coaching",
                "Mentoring",
                "Workshops",
              ],
              ctas: [{
                text: "Book",
                url: "https://rival.com/book",
              }],
              forms: [{
                action: "/c",
              }],
              topicKeywords: [
                "coaching",
              ],
              socialLinks: [{
                url: "https://x.com/rival",
                text: "X",
              }],
              trust: {
                testimonials: true,
                credentials: true,
                caseStudies: true,
                faq: true,
                pricing: true,
                policies: true,
                contact: true,
              },
              schemaTypes: [
                "Organization",
              ],
            },
          },
        ],
      },
    },
  );

  const model = {
    ...baseModel,
    conversionPaths: [
      {
        name: "Primary conversion path",
        status: "Clear",
        steps: [
          "Entry",
          "Service understanding",
          "Trust / proof",
          "Primary CTA",
          "Conversion destination",
        ],
        blockers: [],
      },
    ],
    competitors: {
      ...(baseModel.competitors || {}),
      comparisons: [
        ...(baseModel.competitors?.comparisons || []),
        {
          name: "Unassessed Search Candidate",
          url: "https://noise.example",
          status: "INSUFFICIENT_EVIDENCE",
          note: "Available candidate without enough crawl evidence for comparison.",
          offerClarity: "Not Assessed",
          trustProof: "Not Assessed",
          ctaClarity: "Not Assessed",
          contentDepth: "Not Assessed",
          pathClarity: "Not Assessed",
        },
      ],
    },
  };

  const html = renderReportV2(model);

  const idx = html.indexOf('<section id="competitors"');
  const comp = html.slice(
    idx,
    idx + 5000,
  );

  assert.match(
    comp,
    /rival\.com/,
    "usable assessed competitor evidence must render",
  );

  assert.doesNotMatch(
    comp,
    /noise\.example/,
    "insufficient-evidence candidates must not render in the client comparison",
  );

  assert.match(
    comp,
    /<td><strong>Next-step invitation<\/strong><\/td>\s*<td>Clear<\/td>/,
    "own-site buyer action clarity must consume the governed CTA-visibility state",
  );

  assert.match(
    comp,
    /<td><strong>Assessed conversion route<\/strong><\/td>\s*<td>Weak<\/td>/,
    "own-site conversion path must consume the same governed conversion state as the main report",
  );
});

test("CR-27: competitor no-comparison rendering preserves canonical source status", () => {
  const renderForStatus = (status) => {
    const baseModel = scoreWith(
      assessedSite(),
    );

    const model = {
      ...baseModel,
      sourceStatus: {
        ...(baseModel.sourceStatus || {}),
        competitors: status,
      },
      competitors: {
        ...(baseModel.competitors || {}),
        comparisons: [],
      },
    };



    const html = renderReportV2(model);
    const idx = html.indexOf('<section id="competitors"');
    const next = html.indexOf('<section id="eeat"', idx);
    return html.slice(idx, next === -1 ? idx + 3000 : next);
  };

  const failed = renderForStatus("FAILED");
  const notConnected = renderForStatus("NOT_CONNECTED");
  const notApplicable = renderForStatus("NOT_APPLICABLE");

  assert.match(
    failed,
    /attempted but failed/i,
    "FAILED must be described as an attempted collection failure",
  );

  assert.doesNotMatch(
    failed,
    /chip cap-missing|UNAVAILABLE/,
    "primary comparison must not expose mechanical source-status labels",
  );

  assert.match(
    notConnected,
    /source was not connected/i,
    "NOT_CONNECTED must remain distinct from FAILED",
  );

  assert.match(
    notApplicable,
    /Competitor analysis was not applicable/i,
    "NOT_APPLICABLE must remain distinct from FAILED and NOT_CONNECTED",
  );

  assert.notEqual(
    failed,
    notConnected,
    "FAILED and NOT_CONNECTED must not render identically",
  );

  assert.notEqual(
    failed,
    notApplicable,
    "FAILED and NOT_APPLICABLE must not render identically",
  );

  assert.notEqual(
    notConnected,
    notApplicable,
    "NOT_CONNECTED and NOT_APPLICABLE must not render identically",
  );

  for (const comp of [
    failed,
    notConnected,
    notApplicable,
  ]) {
    for (const generic of [
      /competitors typically/i,
      /most competitors/i,
      /industry average/i,
      /market leaders/i,
    ]) {
      assert.ok(
        !generic.test(comp),
        `no generic competitor commentary: ${generic}`,
      );
    }
  }
});

test("P1-CROSS-04: renderer consumes persisted interpretation and fails closed when absent", () => {
  const model = scoreWith(assessedSite());
  const tampered = {
    ...model,
    crossReportInterpretation: {
      ...model.crossReportInterpretation,
      constructs: { ...model.crossReportInterpretation.constructs, ctaClarity: "Persisted test value" },
    },
    competitors: {
      ...(model.competitors || {}),
      comparisons: [{ name: "Comparable", url: "https://comparable.example", status: "AVAILABLE" }],
    },
  };
  assert.match(renderReportV2(tampered), /Persisted test value/);
  const { crossReportInterpretation, ...missingProjection } = model;
  assert.throws(() => renderReportV2({ ...missingProjection, competitors: tampered.competitors }), /persisted cross-report interpretation/);
});

test("P1-R2-CTA-01: a visible mechanism explains when its governed path remains weak", () => {
  const model = scoreWith(assessedSite(), { pathValidationEvidence: OBSTRUCTED_PATH_EVIDENCE });
  const html = renderReportV2(model);
  const foundations = html.slice(html.indexOf('id="foundations"'), html.indexOf('id="paths"'));
  assert.match(foundations, /conversion action was observed, but the assessed path to complete it is weak/i);
  assert.match(foundations, /mechanism presence does not establish usable path completion/i);
});

test("P1-R2-TRUST-01: positive risk reassurance names only the observed signal", () => {
  const html = renderReportV2(scoreWith(assessedSite({
    trust: { testimonials: true, credentials: true, caseStudies: false, faq: false, pricing: false, policies: true, contact: true },
  })));
  const riskRow = html.slice(html.indexOf("What reduces my risk?"), html.indexOf("</tr>", html.indexOf("What reduces my risk?")));
  assert.match(riskRow, /policy or terms content was observed/i);
  assert.doesNotMatch(riskRow, /pricing or investment context was observed/i);
  assert.doesNotMatch(riskRow, /guarantees/i);
});

test("P1-R2-PERFORMANCE-01: numeric lab performance stays explicitly qualified when field evidence is unavailable", () => {
  const html = renderReportV2(scoreWith(assessedSite()));
  const readinessMap = html.slice(html.indexOf('id="pillars"'), html.indexOf('id="blockers"'));
  const trustCard = readinessMap.slice(
    readinessMap.indexOf("<h3>Trust &amp; Proof</h3>"),
    readinessMap.indexOf("<h3>Conversion Path</h3>"),
  );
  assert.match(readinessMap, /Performance &amp; Experience[\s\S]*Real-user performance data was not available/i);
  assert.doesNotMatch(trustCard, /Real-user performance data was not available/i);
  assert.match(html, /Lab results remain valid as lab evidence, but they are not treated as real-user field performance/i);
  assert.doesNotMatch(html, /LIMITED_EVIDENCE|COMPLETE_EVIDENCE/);
});

    test("CR-45: infrastructure URLs are excluded from client-facing report URLs", () => {
  const model = {
    input: {
      targetUrl: "https://x.com",
    },
  };

  const rawUrls = [
    "https://x.com/",
    "https://x.com/services",
    "https://x.com/cdn-cgi/l/email-protection",
    "https://cdnjs.cloudflare.com/library.js",
    "https://third-party.example.com/page",
    "https://x.com/assets/app.js",
  ];

  const filtered = clientFacingPageUrls(model, rawUrls);

  assert.deepEqual(filtered, [
    "https://x.com/",
    "https://x.com/services",
  ]);

  assert.equal(rawUrls.length, 6);
});
function normalizedSha256(text) {
  return createHash("sha256").update(String(text).replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

test("P1 proof hashes are stable across CRLF and LF normalization", () => {
  const lf = "<p>same rendered content</p>\n";
  assert.equal(normalizedSha256(lf), normalizedSha256(lf.replace(/\n/g, "\r\n")));
});

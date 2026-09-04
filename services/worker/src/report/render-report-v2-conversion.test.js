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
  renderReportV2,
} from "./render-report-v2.js";
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
  const sectionE = html.slice(html.indexOf("E. What should be fixed first?"));

  assert.ok(
    sectionE.indexOf("VAN-PATH-001") < sectionE.indexOf("VAN-TECH-001"),
    "rendered Section E must lead with the foundation blocker",
  );
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
  const tech = unassessed.slice(unassessed.indexOf("Technical Detail"), unassessed.indexOf("Technical Detail") + 4000);

  assert.ok(tech.length > 0, "technical detail section must exist");
  assert.match(tech, /Not Assessed/i, "unavailable header evidence renders Not Assessed");

  assert.ok(
    !/Security headers[\s\S]{0,200}?\bMissing\b/i.test(tech),
    "unavailable security-header evidence must never render as Missing",
  );

  const assessed = renderReportV2(scoreWith(assessedSite()));
  const assessedTech = assessed.slice(assessed.indexOf("Technical Detail"), assessed.indexOf("Technical Detail") + 8000);

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

test("CR-15: strengths require assessed evidence", () => {
  const assessed = renderReportV2(scoreWith(assessedSite()));
  const idx = assessed.indexOf("What Is Already Good");

  assert.ok(idx > -1, "strengths section must exist");

  const good = assessed.slice(idx, idx + 3000);

  assert.match(
    good,
    /HTTPS|Trust|schema|Organization|link/i,
    "an evidence-backed strength is listed",
  );

  const unassessed = renderReportV2(scoreWith(unassessedSite()));
  const uIdx = unassessed.indexOf("What Is Already Good");
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
  "robots_txt:PASS",
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
      "RETRIEVED",
      null,
      FOUNDATION_STATUS.PASS,
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
      FROZEN.robots[key],
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
  assessed: "be900ea0fea303049d978020c21f483f1d2839523f7d17df1cc694ba340e79ef",
  unassessed: "1ab14008b83d55af0d91ac2cb54b7fc187ece111f877c4f87154c2e9fe395693",
  "provider-failed": "bbe77121f8d4396c8a7e2e32834ccc49aff8e95caebd5ed9bbee0d83e2fb4bd0",
  "crawl-blocked": "f87770094b25d3395b99c38e73de66763cafbc4384d2b4ddc17fa0ad742b15eb",
  "target-outage": "b249c5d0b671094d224ea4ac751292abea10af854b5e12bab199b79d90213698",
  "outage-with-limitations": "61a260947f7d335d9b1fe6ba0342c579e18257530a987b14f4dace938f9cc317",
  "http-and-noindex": "76514e6aa9b39b65708e0be60db0f4547ecb1d6489bbc597d6b205749be20496",
  "robots-retrieved": "46c0e4738f6eddae9f3c31b491ec3fe1a831fcab561776e2d8b84eb0e425174d",
  "canonical-missing": "dc364988408a8465f436dd46d0d733a1a503484a5b59954288e7f97bcc71197d",
  "no-conversion-mechanism": "b0ecd7cf4bc3f42fa56d8c18d69dbc27b8b11c26a52422df7f3c73b439cca830",
  "no-contact": "71ffdb1e959c0a991535b23488ca8db7f9afbd6afa0893fd668d4df35c3f580f",
  "headers-all-present": "689110ddd7776ede14ee9cd733228f8ae52fd529620928cc7e97bba15cf55190",
  "ga4-ready": "c7bd6bd5a8c0bc0c0d68f8c2200038d66e9d8cbc7fcde6072fca4e6219b7cf31",
  "ga4-issues": "1cbecf377ea5dd15895ac9564da53f7df1cba6e6e817961ce57b7263456aa45f",
  "ga4-not-applicable": "0da4905e864c5efaf77e9c6a93508dad458e9841d0967577c321467f3ceb10c9",
  "slow-mobile": "0c821d9be502fbeead3496dbe1e42fa7388d8b25cad88a77301f978184b06b0b",
  "no-performance": "7e9ea2ca973838201bb61fd27c71084f228ec5e1cb56c1cecdd61f9c3cb7a31e",
  "path-validated-blocker": "be900ea0fea303049d978020c21f483f1d2839523f7d17df1cc694ba340e79ef",
  "competitor-present": "be900ea0fea303049d978020c21f483f1d2839523f7d17df1cc694ba340e79ef",
  "proprietary-platform": "be900ea0fea303049d978020c21f483f1d2839523f7d17df1cc694ba340e79ef",
  "untraced-broken-links": "be900ea0fea303049d978020c21f483f1d2839523f7d17df1cc694ba340e79ef",
  "schema-confirmed-absent": "be900ea0fea303049d978020c21f483f1d2839523f7d17df1cc694ba340e79ef",
  "headings-absent-h1": "be900ea0fea303049d978020c21f483f1d2839523f7d17df1cc694ba340e79ef",
  "headings-multiple-h1": "be900ea0fea303049d978020c21f483f1d2839523f7d17df1cc694ba340e79ef",
  "device-profile-failed": "be900ea0fea303049d978020c21f483f1d2839523f7d17df1cc694ba340e79ef",
  "competitor-with-limitations": "be900ea0fea303049d978020c21f483f1d2839523f7d17df1cc694ba340e79ef",
  "perf-field-and-multipage": "be900ea0fea303049d978020c21f483f1d2839523f7d17df1cc694ba340e79ef",
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

    actual[name] = createHash("sha256")
      .update(JSON.stringify(checklist))
      .digest("hex");
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
  assessed: "579a6a6559fd23f51bda48d44fa21dfbbbcff890abadb806c5b44e24411c95da",
  unassessed: "7e1562b6788989206792b6e3692c1e0fdc407bdcd36c1480e6442f157b8da955",
  "provider-failed": "8963470db568dd83c5bfbd1996e53bfdd7c049f6300874f79b80266807d0201d",
  "crawl-blocked": "e208e8e077aba9fa9c753ef0fc837c7b94b6fd495b5a99573b8de3602bfe6820",
  "target-outage": "9d10b5255daa9f61a6f71268718acbcb8e06aeb568c0927606f953d840f88d23",
  "outage-with-limitations": "76f52274b9cdfcf2b680c5c45cec4d9d145978299224624a25892ffbcf95f389",
  "http-and-noindex": "c12d1eec0a5a4700c8cb919ee01321204d8a62a612dd7699337fae5cd2289a12",
  "robots-retrieved": "687c55a60606dfca9b238ca761cd2c268705b8ec9e11f760bdf19c8c11c7d182",
  "canonical-missing": "089c27fc4c31391e1b117b05b458fd0ec82eafb98a59d06dfd054c9a40c7a27a",
  "no-conversion-mechanism": "885296485a0a1b9804797f60ac936bc353f73dce7876cfa9516002b0ecd9476c",
  "no-contact": "8562a63e6d70682ebddc5a7d078584f96ca19f122d617d98844166ba7102b2b5",
  "headers-all-present": "c378515ce7b06015dbe7ad98b655ab1a4eaec1b45a7adcdfcaf644b185f55804",
  "ga4-ready": "07fed4684b10cddcc59b628dbd5e2e03da6568d66ddfda7208b7a9207127aa24",
  "ga4-issues": "0e6f9c585cc77e0e286ce84701f7b0c6a3d083ca044c48250ac30a056cef6a36",
  "ga4-not-applicable": "448f52a07e5a704e22f3ca87cec9955d8ea8faf2d3888c8df54d04611f21537e",
  "slow-mobile": "af8ba1808201c16df4c22f9e416911619235b879990b65ac2ae2478c466ccb79",
  "no-performance": "2792de500eb0ee01ddb07bf0c5a296fbf62fc204993e8ddc04db41b6d3e7308c",
  "path-validated-blocker": "70c120868f677b0764997bc1ac04212f65c2b882bab0451bef00fc9c5d22d5d8",
  "competitor-present": "c08404392b4909ebb9f50162c4f9d5e6ddcae88ddc52b3686a83ff89e87565b8",
  "proprietary-platform": "21d507c5ef0c20e0469c35fab7b6c750141969b87b209090e12c21c7ef8178e4",
  "untraced-broken-links": "fdbd23d6e891a9554d23f2733174793f6d220bbf5997213267851189d384ce1f",
  "schema-confirmed-absent": "1131d799e25926aa82be40627c65bd7cfb1a3d669d35f3e68a3ff04b8437ffa7",
  "headings-absent-h1": "f6b48e7d13ff51ed16fbc7e6408bead490c3e16a343eb52b09c58f1933e2313a",
  "headings-multiple-h1": "f9c723bd4840e256cb640720a464cc5ea03676316b031dc7ee066ea96421b1fc",
  "perf-field-and-multipage": "cb5498e14a15c9ffc48674850900731f31336d4bd801a7d5be0877d94c03d5fc",
  "competitor-with-limitations": "c1ae9b18515c9b9ee2ce04b3910db9f0733b8b536d107e2f6d789c7497463d95",
  "device-profile-failed": "c0cc3b569c68fc5ff77b00dab54ef71fca8b1be787a2c00561377572ac31b28e",
};
test("CR-43: the full rendered report is frozen for every branch", () => {
  const actual = {};

  for (const [name, siteEvidence, overrides, pathEv, input] of foundationMatrix()) {
    const html = renderReportV2(
      modelForSite(
        siteEvidence,
        overrides,
        pathEv,
        input,
      ),
    );

    actual[name] = createHash("sha256")
      .update(html)
      .digest("hex");
  }

  assert.deepEqual(
    actual,
    RENDER_GOLDEN,
    "rendered report changed — review every diff against the no-fabrication invariant, then re-freeze",
  );
});

const RENDERER_BRANCH_MARKERS = [
  ["Section E foundation-blocker row", "Foundation blocker"],
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

  assert.ok(
    html.includes(blocker.verificationMethod),
    "verification method rendered in the report",
  );

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

  const idx = html.indexOf("Competitive context");
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
    /<td><strong>Buyer action clarity<\/strong><\/td>\s*<td>Clear<\/td>/,
    "own-site buyer action clarity must consume the governed CTA-visibility state",
  );

  assert.match(
    comp,
    /<td><strong>Conversion path<\/strong><\/td>\s*<td>Weak<\/td>/,
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
    const idx = html.indexOf("Competitive context");

    return html.slice(
      idx,
      idx + 3000,
    );
  };

  const failed = renderForStatus("FAILED");
  const notConnected = renderForStatus("NOT_CONNECTED");
  const notApplicable = renderForStatus("NOT_APPLICABLE");

  assert.match(
    failed,
    /attempted but failed/i,
    "FAILED must be described as an attempted collection failure",
  );

  assert.match(
    failed,
    /chip cap-missing/,
    "FAILED must use the failure presentation state",
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

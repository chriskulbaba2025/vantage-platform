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
import { scoreAudit } from "../scoring/vantage-score.js";
import {
  calculateFindingPriority,
  CONFIDENCE_LEVELS,
  CONFIDENCE_MODIFIERS,
  DIMENSIONS,
} from "../scoring/score-components.js";
import { buildCapabilityEvidence } from "../evidence/capability-evidence.js";
import { renderReportV2 } from "./render-report-v2.js";
import {
  ACTION_CLASS,
  ACTION_GROUP,
  classifyFinding,
  buildActionPlan,
} from "./action-priority.js";
import {
  FOUNDATION_STATUS,
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

function scoreWith(site, { pathValidationEvidence = null, evidenceOverrides = {} } = {}) {
  const evidence = evidenceWith(site, evidenceOverrides);
  const capabilityEvidence = buildCapabilityEvidence({
    decisionEvidence: evidence,
    auditId: INPUT.auditId,
    generatedAt: FIXED_TS,
    pathValidationEvidence,
  });
  return scoreAudit(INPUT, evidence, { capabilityEvidence, scoredAt: FIXED_TS });
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

  // Expectation computed from the requirement statement, not the source.
  const expected =
    fields.conversionImpact * 0.40 +
    fields.businessRelevance * 0.20 +
    fields.gapSeverity * 0.15 +
    fields.implementationPracticality * 0.15 +
    fields.competitiveSignal * 0.10;
  assert.equal(result.raw, expected, "raw priority must use the new weighting");

  // The superseded weighting must be rejected outright.
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
  // Weights must still sum to a full 100-point scale.
  assert.equal(
    calculateFindingPriority({ conversionImpact: 100, businessRelevance: 100, gapSeverity: 100, implementationPracticality: 100, competitiveSignal: 100, confidence: CONFIDENCE_LEVELS.DETERMINISTIC }).raw,
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

  // The fixture is deliberately adversarial: the ordinary finding scores HIGHER.
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

test("CR-04: a low-confidence foundation-domain finding is not promoted by classification", () => {
  const strongOrdinary = {
    ruleId: "VAN-TECH-001", confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
    scoreBearing: true, finalPriority: 76, severity: "High", implementationEffort: "L",
  };
  for (const weak of [CONFIDENCE_LEVELS.SUPPORTED, CONFIDENCE_LEVELS.DIRECTIONAL]) {
    const weakBlocker = {
      ruleId: "VAN-PATH-001", confidence: weak,
      scoreBearing: true, finalPriority: 40, severity: "High", implementationEffort: "M",
    };
    assert.notEqual(
      classifyFinding(weakBlocker).actionClass,
      ACTION_CLASS.FOUNDATION_BLOCKER,
      `${weak} confidence must not qualify as a foundation blocker`,
    );
    const plan = buildActionPlan({ findings: [weakBlocker, strongOrdinary] });
    assert.equal(
      plan.actions[0].finding.ruleId, "VAN-TECH-001",
      "the strong deterministic finding must still lead",
    );
  }
  // Control: the same rule at strongly_supported DOES qualify.
  assert.equal(
    classifyFinding({ ...strongOrdinary, ruleId: "VAN-PATH-001", confidence: CONFIDENCE_LEVELS.STRONGLY_SUPPORTED }).actionClass,
    ACTION_CLASS.FOUNDATION_BLOCKER,
  );
});

test("CR-05: insufficient evidence stays non-score-bearing and out of Section E", () => {
  const result = calculateFindingPriority({
    conversionImpact: 100, businessRelevance: 100, gapSeverity: 100,
    implementationPracticality: 100, competitiveSignal: 100,
    confidence: CONFIDENCE_LEVELS.INSUFFICIENT,
  });
  assert.equal(result.final, 0);
  assert.equal(result.scoreBearing, false);

  const plan = buildActionPlan({
    findings: [{ ruleId: "VAN-X", confidence: CONFIDENCE_LEVELS.INSUFFICIENT, scoreBearing: false, finalPriority: 0, severity: "High", implementationEffort: "L" }],
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
    Object.values(DIMENSIONS).reduce((s, d) => s + d.weight, 0), 100,
  );

  // Readiness must be produced by module scorers, not by action priority:
  // the score is stable and independent of the priority weighting change.
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
  assert.match(unknownCms, /not.*(verified|detected|assessed)/i, "unknown platform renders an explicit unverified state");
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
  const assessedTech = assessed.slice(assessed.indexOf("Technical Detail"), assessed.indexOf("Technical Detail") + 4000);
  assert.match(assessedTech, /referrerPolicy|Referrer-Policy/i, "assessed headers are reported individually");
});

test("CR-10: heading evidence is scoped to the named evaluated page", () => {
  const html = renderReportV2(scoreWith(assessedSite()));
  const idx = html.indexOf("Heading Structure");
  assert.ok(idx > -1, "heading section must exist");
  const headings = html.slice(idx, idx + 3000);
  assert.match(headings, /https:\/\/x\.com\//, "evaluated page URL is named");
  assert.match(headings, /evaluated page|this page|page assessed/i, "scope is explicitly single-page");
  assert.match(headings, /Coaching that converts/, "actual H1 content rendered from evidence");

  const unassessed = renderReportV2(scoreWith(unassessedSite({ pages: [{ crawledUrl: "https://x.com/", title: "Home", headings: {} }] })));
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
        mobile: { status: "AVAILABLE", source: "pagespeed-insights", url: "https://x.com/", isLabData: true, scores: { performance: 55 }, metrics: {} },
        desktop: { status: "FAILED", source: "pagespeed-insights" },
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
  assert.match(html, /machine[- ]read|AI[- ]search readiness|structural/i, "structural machine-readability framing present");
  for (const overclaim of [
    "your site appears in AI",
    "AI systems recommend",
    "visible in ChatGPT",
    "cited by AI",
    "guaranteed AI visibility",
  ]) {
    assert.ok(!html.toLowerCase().includes(overclaim.toLowerCase()), `overclaim must be absent: ${overclaim}`);
  }
});

test("CR-15: strengths require assessed evidence", () => {
  const assessed = renderReportV2(scoreWith(assessedSite()));
  const idx = assessed.indexOf("What Is Already Good");
  assert.ok(idx > -1, "strengths section must exist");
  const good = assessed.slice(idx, idx + 3000);
  assert.match(good, /HTTPS|Trust|schema|Organization|link/i, "an evidence-backed strength is listed");

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
  assert.equal(itemById(checklist, "https").status, FOUNDATION_STATUS.ACTION_REQUIRED,
    "a non-HTTPS target URL is a proven deficiency");
  assert.equal(itemById(checklist, "indexability").status, FOUNDATION_STATUS.ACTION_REQUIRED,
    "proven non-indexable pages are a deficiency");
  assert.match(renderReportV2(model), /ACTION REQUIRED/i);
});

test("CR-18: unassessable candidates render NOT ASSESSED with the required source", () => {
  const checklist = buildFoundationChecklist(scoreWith(assessedSite()));
  for (const id of ["bing_indexability", "google_business_profile", "nap_consistency"]) {
    const item = itemById(checklist, id);
    assert.ok(item, `candidate present: ${id}`);
    assert.equal(item.status, FOUNDATION_STATUS.NOT_ASSESSED, `${id} cannot be assessed today`);
    assert.ok(item.requires && item.requires.length > 5, `${id} must name the required evidence source`);
  }
  const html = renderReportV2(scoreWith(assessedSite()));
  assert.match(html, /NOT ASSESSED\s*(—|-)\s*requires/i, "rendered as NOT ASSESSED — requires <source>");
});

test("CR-19: a not-applicable candidate renders NOT APPLICABLE", () => {
  // GA4 measurement is not applicable when the audit did not request it AND
  // no analytics evidence exists — proven via the governed source status.
  const checklist = buildFoundationChecklist(
    scoreWith(assessedSite(), { evidenceOverrides: { ga4: { sourceStatus: "NOT_APPLICABLE", limitations: [] } } }),
  );
  const item = itemById(checklist, "conversion_measurement");
  assert.equal(item.status, FOUNDATION_STATUS.NOT_APPLICABLE);
});

test("CR-20: unavailable evidence never becomes ACTION REQUIRED", () => {
  const model = scoreWith(unassessedSite());
  const checklist = buildFoundationChecklist(model);
  const wrongly = checklist.filter(
    (i) => i.status === FOUNDATION_STATUS.ACTION_REQUIRED && i.assessed !== true,
  );
  assert.deepEqual(wrongly.map((i) => i.id), [], "no unassessed item may be ACTION REQUIRED");

  // GA4 not connected must never read as "missing".
  const ga4Item = itemById(checklist, "conversion_measurement");
  assert.equal(ga4Item.status, FOUNDATION_STATUS.NOT_ASSESSED);
  assert.ok(!/missing/i.test(ga4Item.detail || ""), "GA4 not connected is never 'missing'");
});

// ===========================================================================
// ACTION PLAN — CR-21 .. CR-23
// ===========================================================================

test("CR-21: Do Now / Do Next / Later grouping is deterministic", () => {
  const model = scoreWith(assessedSite(), { pathValidationEvidence: OBSTRUCTED_PATH_EVIDENCE });
  const a = buildActionPlan(model);
  const b = buildActionPlan(model);
  assert.deepEqual(
    a.actions.map((x) => [x.finding.ruleId, x.group, x.actionClass]),
    b.actions.map((x) => [x.finding.ruleId, x.group, x.actionClass]),
    "grouping is stable across invocations",
  );
  for (const action of a.actions) {
    assert.ok(Object.values(ACTION_GROUP).includes(action.group), "group is from the governed vocabulary");
    if (action.actionClass === ACTION_CLASS.FOUNDATION_BLOCKER) {
      assert.equal(action.group, ACTION_GROUP.DO_NOW, "foundation blockers are always Do Now");
    }
  }
  // Easy-but-low-value work must not be promoted to Do Now on effort alone.
  const easyLowValue = buildActionPlan({
    findings: [{ ruleId: "VAN-TECH-005", confidence: CONFIDENCE_LEVELS.DETERMINISTIC, scoreBearing: true, finalPriority: 25, severity: "Low", implementationEffort: "L" }],
  });
  assert.notEqual(easyLowValue.actions[0].group, ACTION_GROUP.DO_NOW, "low effort alone never promotes to Do Now");

  const html = renderReportV2(model);
  assert.match(html, /DO NOW/i);
  assert.match(html, /DO NEXT/i);
  assert.match(html, /LATER/i);
});

test("CR-22: the governed verification method carries through to the plan", () => {
  const model = scoreWith(assessedSite(), { pathValidationEvidence: OBSTRUCTED_PATH_EVIDENCE });
  const plan = buildActionPlan(model);
  for (const action of plan.actions) {
    assert.equal(
      action.verificationMethod,
      action.finding.verificationMethod,
      "plan verification must be the finding's own governed verification method",
    );
    assert.ok(action.verificationMethod.length > 0);
  }
  const html = renderReportV2(model);
  const blocker = findingByRule(model, "VAN-PATH-001");
  assert.ok(html.includes(blocker.verificationMethod), "verification method rendered in the report");
  assert.match(html, /MEASURE/i, "action plan exposes a Measure step");
});

test("CR-23: the action plan invents no business result or ROI claim", () => {
  const html = renderReportV2(scoreWith(assessedSite(), { pathValidationEvidence: OBSTRUCTED_PATH_EVIDENCE }));
  const idx = html.indexOf("Client Action Plan");
  assert.ok(idx > -1, "action plan section must exist");
  const plan = html.slice(idx, idx + 6000);
  for (const forbidden of [
    /\d+\s*%\s*(more|increase|uplift|lift|improvement in (leads|sales|revenue|conversions))/i,
    /\$\s*\d/,
    /guarantee/i,
    /will (increase|double|triple)/i,
    /expected (revenue|roi)/i,
  ]) {
    assert.ok(!forbidden.test(plan), `plan must not contain an invented outcome claim: ${forbidden}`);
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
      { ...INPUT, primaryGoal: goal },
      evidenceWith(assessedSite()),
      { scoredAt: FIXED_TS },
    );
    const html = renderReportV2(model);
    const capitalized = goal.charAt(0).toUpperCase() + goal.slice(1);
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
      { ...INPUT, primaryGoal: goal },
      evidenceWith(assessedSite()),
      { scoredAt: FIXED_TS },
    );
    const html = renderReportV2(model);
    assert.ok(
      !new RegExp(`Business Coaching for ${goal}`, "i").test(html),
      `must not render "<Service> for ${goal}"`,
    );
    // A verb phrase must never directly follow "for" in generated query text.
    assert.ok(
      !/\bfor (generate|book|increase|request|schedule) \w+/i.test(html),
      `generated text must not place a bare verb after "for" (goal: ${goal})`,
    );
  }
});

// ===========================================================================
// COMPETITOR — CR-26 .. CR-27
// ===========================================================================

test("CR-26: available competitor evidence renders signal comparisons", () => {
  const model = scoreWith(assessedSite(), {
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
            pages: [{ title: "Rival Coaching" }],
            services: ["Coaching", "Mentoring", "Workshops"],
            ctas: [{ text: "Book", url: "https://rival.com/book" }],
            forms: [{ action: "/c" }],
            topicKeywords: ["coaching"],
            socialLinks: [{ url: "https://x.com/rival", text: "X" }],
            trust: { testimonials: true, credentials: true, caseStudies: true, faq: true, pricing: true, policies: true, contact: true },
            schemaTypes: ["Organization"],
          },
        },
      ],
    },
  });
  const html = renderReportV2(model);
  const idx = html.indexOf("Competitive context");
  const comp = html.slice(idx, idx + 5000);
  assert.match(comp, /rival\.com/, "competitor rendered from evidence");
  assert.match(comp, /Offer|Trust|CTA|Conversion path|Content/i, "per-signal comparison rendered");
  assert.match(comp, /This site|Your site/i, "own-site side of the comparison is shown");
});

test("CR-27: unavailable competitor evidence renders an exact limitation only", () => {
  const html = renderReportV2(scoreWith(assessedSite()));
  const idx = html.indexOf("Competitive context");
  const comp = html.slice(idx, idx + 3000);
  assert.match(comp, /No competitor evidence|not supplied|unavailable/i, "explicit limitation rendered");
  for (const generic of [
    /competitors typically/i,
    /most competitors/i,
    /industry average/i,
    /market leaders/i,
  ]) {
    assert.ok(!generic.test(comp), `no generic competitor commentary: ${generic}`);
  }
});

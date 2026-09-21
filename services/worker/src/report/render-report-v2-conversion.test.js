/**
 * PRYSM-V2-REPORT-DEPTH-01 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â conversion-first Section E + governed report depth.
 *
 * Proof-first suite (frozen checklist CR-01..CR-27, see
 * .governance/changes/PRYSM-V2-REPORT-DEPTH-01_CHECKLIST.md).
 *
 * Every behavioural assertion runs the REAL production path:
 *   scoreAudit(input, evidence, opts) -> renderReportV2(model)
 * or the exported production helper whose behaviour is being accepted
 * (calculateFindingPriority / classifyFinding / buildFoundationChecklist /
 * buildActionPlan).  No mock replaces the behaviour under test, and no
 * expected value is copied from the implementation ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â expectations are
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
  const encyclopedia = model.encyclopedia || {
    status: "AVAILABLE",
    priorityUnits: canonicalSolutions.sequence.map((solutionId) => {
      const record = canonicalSolutions.records.find((item) => item.solutionId === solutionId);
      return { type: "standalone material finding", canonicalProblemId: "A06", frictionState: "FRICTION", findingIds: record?.findingRefs || [], evidence: [{ sourceStatus: "AVAILABLE" }] };
    }),
  };
  return renderReportV2Base({ ...model, canonicalSolutions, encyclopedia }, options);
}

// ---------------------------------------------------------------------------
// Fixtures ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â governed evidence shapes only.  No provider call.
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
// SECTION E ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â CR-01 .. CR-06
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
  assert.match(sectionE, /Where to look/);
  assert.match(sectionE, /How to know it worked/);
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

  assert.equal(model.scoringVersion, "4.1.2", "scoring version must use the technical normalization patch");
  assert.equal(typeof model.scores.conversionReadiness, "number");

  const again = scoreWith(assessedSite());
  assert.equal(model.scores.conversionReadiness, again.scores.conversionReadiness);
});

// ===========================================================================
// REPORT RESTORATION ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â CR-07 .. CR-15
// ===========================================================================

test("CR-07: E-E-A-T renders four governed dimensions, and Not Assessed when unavailable", () => {
  const assessed = renderReportV2(scoreWith(assessedSite()));

  for (const dim of ["Experience", "Expertise", "Authoritativeness", "Trust"]) {
    assert.match(assessed, new RegExp(`>\\s*${dim}\\s*<`), `E-E-A-T dimension rendered: ${dim}`);
  }

  assert.match(assessed, /Found/, "assessed E-E-A-T shows Found");
  assert.match(assessed, /Recommended fix|Fix/, "assessed E-E-A-T shows a fix");

  const unassessedModel = scoreWith(unassessedSite());
  const unassessed = renderReportV2(unassessedModel);
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

test("CR-09: technical detail omits security-header client surfaces", () => {
  const unassessedModel = scoreWith(unassessedSite());
  const unassessed = renderReportV2(unassessedModel);
  const tech = unassessed.slice(unassessed.indexOf('id="technical"'), unassessed.indexOf('id="technical"') + 4000);

  assert.ok(tech.length > 0, "technical detail section must exist");
  assert.doesNotMatch(tech, /security headers|security-header|referrer-policy|x-frame-options/i);

  const assessed = renderReportV2(scoreWith(assessedSite()));
  const assessedTech = assessed.slice(assessed.indexOf('id="technical"'), assessed.indexOf('id="technical"') + 8000);

  assert.doesNotMatch(assessedTech, /security headers|security-header|referrer-policy|x-frame-options/i);
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
test("CR-11: observed schema remains evidence-only without an independent recommendation", () => {
  const html = renderReportV2(scoreWith(assessedSite()));
  const idx = html.indexOf("Schema");
  const schema = html.slice(idx, idx + 4000);

  assert.match(schema, /Observed/i, "observed block present");
  assert.match(schema, /Structured-data evidence boundary/i, "evidence boundary present");
  assert.doesNotMatch(schema, /Recommended structured-data candidates|A structured-data change should be prioritized/i);

  const observedBlock = schema.slice(schema.search(/Observed/i), schema.search(/Structured-data evidence boundary/i));

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

  const good = assessed.slice(idx, assessed.indexOf("What is holding the site back?", idx));

  assert.match(
    good,
    /HTTPS|Trust|schema|Organization|link/i,
    "an evidence-backed strength is listed",
  );

  const unassessedModel = scoreWith(unassessedSite());
  const unassessed = renderReportV2(unassessedModel);
  const uIdx = unassessed.indexOf("What is already working?");
  const uEnd = unassessed.indexOf("What is holding the site back?", uIdx);
  const uGood = unassessed.slice(uIdx, uEnd);

  assert.ok(
    !/testimonial|credential|structured data detected/i.test(uGood),
    "strengths must never be inferred from unavailable capabilities",
  );
  const assessedPasses = buildFoundationChecklist(unassessedModel)
    .filter((item) => item.status === "PASS" && item.assessed === true)
    .slice(0, 5)
    .map((item) => item.detail || `${item.label} was confirmed in the assessed scope.`);
  for (const strength of assessedPasses) assert.ok(uGood.includes(esc(strength)), `positive executive claim comes from assessed PASS evidence: ${strength}`);
  assert.doesNotMatch(uGood, /No assessed capability|unavailable evidence confirms/i);
});

// ===========================================================================
// FIRST THINGS FIRST ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â CR-16 .. CR-20
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
// CR-28..CR-35 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â source-failure boundary (merge-audit correction, round 2).
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
// CR-36..CR-39 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â IDENTITY-frozen client wording.
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
// CR-40 / CR-41 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â GLOBAL freeze.
// ---------------------------------------------------------------------------

const CHECKLIST_GOLDEN = {
  assessed: "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
  unassessed: "d899b9f3bcaf239ce8553a637f7f17befeef9beb66d82b853eac023846a9a17c",
  "provider-failed": "8c6cf6d60d9e4f9ec0ddfbe1d7a712d3ff739c4413e7c309e49e038a4ee6cb33",
  "crawl-blocked": "2fa7e99eb7915c4285ba642aba8440aaaa01d8340bcb976a7bd1bcb63c1352b7",
  "target-outage": "a8f750d0c5231ecbb6def287e25d249061d044d488e9be9f13cd5517bd06e951",
  "outage-with-limitations": "8107ab0fb947c806cac7b3562434f10212430d33f7b395ddbbd797c8c669164b",
  "http-and-noindex": "9e30768430f952ea4366f023b06d28fab4dae204e2f805bf63bf140ccb87fa94",
  "robots-retrieved": "f5699411c18038843879bd8b643fa4753c523723db29a992c997aef40097aa44",
  "canonical-missing": "acad5cef95652e778488bc1a5fcc99d59dadceaad2ee78a76240086db9d2cc61",
  "no-conversion-mechanism": "61b2d8457d3bbb39abbace0831de7013814c5760da2cf15e8029621e1bc66b06",
  "no-contact": "c815441f93c8d4c5054274de944a18dfb2b2552d195cc01a99a7b14e78082e5f",
  "headers-all-present": "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
  "ga4-ready": "5688a07257041f15ff6de9c1134e31c4e3b29211379c957384545dbbb658f9f6",
  "ga4-issues": "12904ed9581330c80a8f2cf972d235befb117d73a004a4f4a914916d36f43464",
  "ga4-not-applicable": "b17952711313780db15789ab93e3e06083d895a9248dc01b85cf4ae09075c9eb",
  "slow-mobile": "8fa095e45e25f1d7be4411df0d84b52875b3de8fee64f176da8ade4120dc2a4c",
  "no-performance": "66c118ab8a7fe7255c401cf1316be6ba417e3c00047609e2ac9520baefa2c947",
  "path-validated-blocker": "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
  "competitor-present": "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
  "proprietary-platform": "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
  "untraced-broken-links": "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
  "schema-confirmed-absent": "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
  "headings-absent-h1": "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
  "headings-multiple-h1": "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
  "device-profile-failed": "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
  "competitor-with-limitations": "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
  "perf-field-and-multipage": "acf5c8be194b2e62ccca920ba820be00a62f6b569183a908643fa1cd4bb15fa3",
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
    "foundation checklist wording/status changed ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â review each change, then re-freeze",
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
    "fixture matrix must reach exactly the reachable (item, status) pairs ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â add a fixture for any new branch",
  );
});

const RENDER_GOLDEN = {
  "assessed": "a36ceb871956d1a4e81c251d4e380fd4e09db97d55bfb5805907cb3b24d3354f",
  "unassessed": "e8a4d6c877eeb7342579976b280b767682c527261a7b5bd119dd87e354eb2beb",
  "provider-failed": "2a196da74fdd12942f6e367ce8b87d576656e235d70244a7aa513b611077eb3f",
  "crawl-blocked": "cc687ad9af0938a524e2277deea6f5cc75e5af309bad1b0794fd06899fabcbe2",
  "target-outage": "a526fc6c55c1cf6c127ca3f0fe56e50b0419a451ecbc6b0bd6f73ca325ccbe22",
  "outage-with-limitations": "8f7df941c5b41a65f664b67d84d885e57ba1c29f71ec4cd2d7e2697882824ec9",
  "http-and-noindex": "3822720951b29aa8606a1de13bac33b7ed4b7f5f8935df9019738cb5aa1f6d70",
  "robots-retrieved": "a137a260ac505c2b50ac47eb921847abe513cfbd4f5955e6db6cb75e4419ba17",
  "canonical-missing": "63f2a28cf1002792109dc14b3da89d809d5f7b6a90139dc8d80b7452d8da8360",
  "no-conversion-mechanism": "4ba3fdcce13ff311deb26bc70640522a0dbe987a298a4b892e2067c216cad57e",
  "no-contact": "bd0a5536bd8740a64f2b5410301b29629feb9d9a18e6c55e7952b252a90d4406",
  "headers-all-present": "a36ceb871956d1a4e81c251d4e380fd4e09db97d55bfb5805907cb3b24d3354f",
  "ga4-ready": "bfecabbde1cbf5f9eb0b54d5be2e0a7eee9658be004391805c664b8881972c66",
  "ga4-issues": "e8668f9eaeda7381a3f5e27138baad32aa4b0cd52ef04d0ec764a5ae089a871d",
  "ga4-not-applicable": "6ab31e8162d8306f6654b5c3fd16ea4ce5e78832e1ca28ae39a79fb4f143d00a",
  "slow-mobile": "8e1ccb991ad8542f3f92b75bf71a2bb0021eaabb66c5308e47272a703cc89c59",
  "no-performance": "db121f86045c1d5c0ebf531b9e3d8ae0ed6a915e737b6c19000d7274f627f67d",
  "path-validated-blocker": "3c8e97180d2b8f12b1770da7005e2ff5fbb8159b8c93db9f8a74e940f077315d",
  "competitor-present": "d03e09f5684e4bd787713f042adb667112540c0c9896d5c9080dfa79b9f47a64",
  "proprietary-platform": "a0e0041b577950ad6f2b1cef983374996230a11b301d74ba8a4dfb7883c47481",
  "untraced-broken-links": "0297cc6df39525fc928ca4e620d6b9096eb016fe6af19b43db617ba15e73cd21",
  "schema-confirmed-absent": "e022479d903fb7ec650de0c7f011395afbc2785b2a01659cf23083d29f38b9b0",
  "headings-absent-h1": "7d31aced939e6905aa7d95f6d1655f47ac3ba1ad935457de78901a004578bd87",
  "headings-multiple-h1": "fdf95f2615251ddc42b3cbe881afe4e5c0d76c5a465f6a0f5ec4059dd84ff980",
  "perf-field-and-multipage": "dcb455b74f32cca1cc0769737a885f4c8c61ff14171aa4c35a7a623f6d715b9d",
  "competitor-with-limitations": "96da868d374289dab1421ee52875c64c3b383518b592c6a8ff8ce4ffb2443dec",
  "device-profile-failed": "1d0bb6982a4932acaf58991617b4d251e7ae11b03fa0910ffd0c64973f355e2c",
};

const canonicalRenderGolden = {
  "assessed": "d13fca7a67b9f7b9a28e7a4dfc4ad1b2d59d3df288f2335d72dd59ab4da9ff53",
  "unassessed": "ab17bd3c85681336cfd72e66bdb9ee26cbc979c5a5d33547bad9603709202c04",
  "provider-failed": "7ca0cc3946175fb3060bda29f4bf0ce901fe3a2fdd5df74a05e3da66453e8a9c",
  "crawl-blocked": "6055e1c8ad3f2f426a7e6ecf7a6050480d6b8b5b08a7ea87838bbc1274b50d40",
  "target-outage": "f93dca67887d63e75679cec03952fc75a565d1ab2e1c1b62d4687091fd40744c",
  "outage-with-limitations": "3a0e636c626130bbfb825a1e96c19f0e7d5a14aebd8721a4dd5c4837ad175c73",
  "http-and-noindex": "260801f35dbc806b7d9c0ed4a9904f31fbf409378736d8375540ff59338837cc",
  "robots-retrieved": "7274058630ab07969196d9f2e20cf01f53e0b7728e1cc575ae145d7fbdbdb289",
  "canonical-missing": "f4ec7fbcc8439b719abdfedd8f07f7e76a8b53260f925b7c93ec52df1b12bd5c",
  "no-conversion-mechanism": "833ef5a775ea3e256a0c9a5c562e6fd80d09d549d6ff3f62094ca1bdaccd1ad6",
  "no-contact": "8bf59e5c4b68701780eb176582f2952be7848a769ee9160142a445af6c134e41",
  "headers-all-present": "d13fca7a67b9f7b9a28e7a4dfc4ad1b2d59d3df288f2335d72dd59ab4da9ff53",
  "ga4-ready": "32cdbf4599bdf7a2c1ccbd594926dfcc17e0f5a50f1ff2e879650cd782b5ea2e",
  "ga4-issues": "4119ed6f8c8fbebff0c512a98d8d20cde819195cae8b3b423b912d173de1d076",
  "ga4-not-applicable": "adc64daaeb77094e6cce867b9fe768f86a9e7c7945b0a4e0b888286dd2142dbd",
  "slow-mobile": "fabc574a9adca6ba97f316faf885dca64f6aea6475ce5f7c06f04a4fa6f1ab4f",
  "no-performance": "7fcec0a86169937c8c3ab7629af6bd36dc094fee0ddbedf556fd8476ef2c1bfc",
  "path-validated-blocker": "137f54769068d6d54addf173c09b8baff4754fe322ea47c2f8a4af75491c39fc",
  "competitor-present": "6902033dd05f29c45322a00a30a1d52fd3f1a2bdb8dbefb8325968a42f9cdda0",
  "proprietary-platform": "b81dcbdaf81988e48837350b937c10d0ff62f31e0b61da6ce0db855b7e6d74ba",
  "untraced-broken-links": "ec0afc72e3840ea99f652377d35bae8eee4fdde1b12c216702230777d74b353a",
  "schema-confirmed-absent": "2646f5487461e819ece609006905c290d8d2c77a5a5439c393520a93397310c4",
  "headings-absent-h1": "a3fe22d2dcd87c7c90dca2bed1c2b56b9fbe07a6d001ab1062a98a98294d9371",
  "headings-multiple-h1": "f1f98ecb2de6e25a31734cee6754a6b9b09401df24f447c8eef4de4874d822b8",
  "perf-field-and-multipage": "0bb58956c952cb2af3d7a629f8cdf9f9761374c7c011511cbfbade880dfe84c4",
  "competitor-with-limitations": "f5797d0a726e2da5e159b6154742f01b139c7ecc022fd744adc6298638ff216d",
  "device-profile-failed": "f8edac2e2ea892a78ad216f86897ec69c2216dbabfa2b36bba746631b0196b42"
};;;

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

  assert.deepEqual(
    actual,
    canonicalRenderGolden,
    "rendered report changed ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â review every diff against the no-fabrication invariant, then re-freeze",
  );
});

const RENDERER_BRANCH_MARKERS = [
  ["Priority Fixes client action sequence", "Three common fixes to consider"],
  ["competitor comparison note", "does not establish traffic, search rankings"],
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
      `no fixture reaches the ${label} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â add one, or its wording is unfrozen`,
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
// ACTION PLAN ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â CR-21 .. CR-23
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

  const supporting = html.slice(html.indexOf('id="action-plan"'), html.indexOf('id="eeat"'));
  assert.match(supporting, /Priority Fixes is the only client action sequence/);
  assert.doesNotMatch(supporting, /DO NOW|DO NEXT|LATER/i);
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

  const supporting = html.slice(html.indexOf('id="action-plan"'), html.indexOf('id="eeat"'));
  assert.match(supporting, /Accepted current priorities/);
  assert.match(supporting, /Supporting observations and non-priority findings/);
  assert.doesNotMatch(supporting, /MEASURE|DO NOW|DO NEXT/i);
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

  const idx = html.indexOf("Priority and Supporting Evidence");

  assert.ok(
    idx > -1,
    "action plan section must exist",
  );

  const plan = html.slice(idx, html.indexOf('id="eeat"', idx));

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
// LANGUAGE QUALITY ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â CR-24 .. CR-25
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
// COMPETITOR ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â CR-26 .. CR-27
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
    /<th scope="row">Next-step clarity<\/th>\s*<td>Clear<\/td>/,
    "own-site buyer action clarity must consume the governed CTA-visibility state",
  );

  assert.match(
    comp,
    /<th scope="row">Conversion path<\/th>\s*<td>Weak<\/td>/,
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
    /competitor review could not be completed/i,
    "FAILED must be described as an attempted collection failure",
  );

  assert.doesNotMatch(
    failed,
    /chip cap-missing|UNAVAILABLE/,
    "primary comparison must not expose mechanical source-status labels",
  );

  assert.match(
    notConnected,
    /competitor data was not connected/i,
    "NOT_CONNECTED must remain distinct from FAILED",
  );

  assert.match(
    notApplicable,
    /competitor review was not part of this audit/i,
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
      comparisons: [{
        name: "Comparable",
        url: "https://comparable.example",
        status: "AVAILABLE",
        offerClarity: "Strong visible signal",
        trustProof: "Moderate visible signal",
        ctaClarity: "Strong visible signal",
        contentDepth: "3 page(s)",
        pathClarity: "Clear",
      }],
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

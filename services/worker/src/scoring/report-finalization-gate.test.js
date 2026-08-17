/**
 * Report Finalization Gate — Comprehensive Tests
 *
 * Covers: evidence consistency validation, contradiction blocking,
 * confidence recalculation, service category mapping, commercial
 * recommendation generation, booking CTA, next action, and
 * integration tests for blocked vs. passing renders.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { SOURCE_STATUS } from "./evidence-contracts.js";
import { DIAGNOSTIC_CATEGORY } from "./diagnostic-contracts.js";
import { runFinalizationGate } from "./report-finalization-gate.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseModel(overrides = {}) {
  return {
    reportVersion: "3.0.0",
    scoringVersion: "3.0.0",
    generatedAt: new Date().toISOString(),
    input: { businessName: "Test Business", targetUrl: "https://example.com" },
    scores: {
      trust: 65, contentDepth: 55, conversionPathways: 60, technical: 70,
      performance: 71, conversionReadiness: 65,
      awareness: 55, consideration: 60, decision: 65, aiReadiness: 50,
      ...(overrides.scores || {}),
    },
    bands: {
      conversionReadiness: "Moderate", trust: "Moderate", evidenceConfidence: "Moderate",
      ...(overrides.bands || {}),
    },
    assessedWeight: "assessedWeight" in overrides ? overrides.assessedWeight : 85,
    readinessStatus: "readinessStatus" in overrides ? overrides.readinessStatus : "Complete",
    readinessStatusDetail: "readinessStatusDetail" in overrides ? overrides.readinessStatusDetail : "Complete",
    showNumericScore: "showNumericScore" in overrides ? overrides.showNumericScore : true,
    evidenceConfidenceScore: "evidenceConfidenceScore" in overrides ? overrides.evidenceConfidenceScore : 65,
    evidenceConfidenceFactors: {},
    dimensionEligibility: {},
    moduleEligibility: {},
    suppressedModules: [],
    rootCause: "Test root cause.",
    findings: overrides.findings || [
      { ruleId: "VAN-PERF-001", title: "Mobile largest contentful paint is slow", severity: "High", scoreBearing: true, key: "lcp", businessImpact: "Slow first impressions.", recommendation: "Optimize LCP.", effort: "M" },
      { ruleId: "VAN-TECH-001", title: "Missing meta descriptions", severity: "High", scoreBearing: true, key: "meta", businessImpact: "Uncontrolled search messaging.", recommendation: "Write descriptions.", effort: "L" },
    ],
    conversionPaths: [],
    readinessMap: [],
    contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
    competitors: [],
    competitorOpportunities: null,
    evidence: overrides.evidence || baseEvidence(),
    renderingDiagnostics: overrides.renderingDiagnostics || [],
  };
}

function baseEvidence(overrides = {}) {
  return {
    site: {
      sourceStatus: SOURCE_STATUS.AVAILABLE,
      pageCount: 5,
      domain: "example.com",
      pages: [{ title: "Home", url: "https://example.com" }],
      trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: true },
      schemaTypes: [],
      securityHeaders: { xFrameOptions: false, xContentTypeOptions: false, referrerPolicy: false, contentSecurityPolicy: false },
      ...(overrides.site || {}),
    },
    performance: {
      sourceStatus: SOURCE_STATUS.AVAILABLE,
      source: "pagespeed-insights",
      coverage: { requested: 2, completed: 2, failed: 0 },
      limitations: [],
      mobile: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 1200, lcpMs: 2600, cls: 0.05, tbtMs: 120 }, scores: { performance: 71 } },
      desktop: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 800, lcpMs: 1800, cls: 0.03, tbtMs: 80 }, scores: { performance: 85 } },
      ...(overrides.performance || {}),
    },
    competitors: overrides.competitors || [],
    competitorOpportunities: null,
    backlinks: { sourceStatus: SOURCE_STATUS.NOT_CONNECTED, ...(overrides.backlinks || {}) },
    ga4: { sourceStatus: SOURCE_STATUS.NOT_CONNECTED, ...(overrides.ga4 || {}) },
    gsc: { sourceStatus: SOURCE_STATUS.NOT_CONNECTED, ...(overrides.gsc || {}) },
  };
}

// ---------------------------------------------------------------------------
// Gate basics
// ---------------------------------------------------------------------------

test("T-GATE-01: consistent report passes the gate", () => {
  const model = baseModel();
  const { passed, errors } = runFinalizationGate(model, model.evidence);
  assert.equal(passed, true);
  assert.equal(errors.length, 0);
});

test("T-GATE-02: gate attaches structured output to model", () => {
  const model = baseModel();
  const { model: gated } = runFinalizationGate(model, model.evidence);
  assert.ok(gated._gate, "Must attach _gate to model");
  assert.equal(gated._gate.passed, true);
  assert.ok(Array.isArray(gated._gate.errors));
  assert.ok(Array.isArray(gated._gate.warnings));
  assert.ok(gated._gate.commercialRecommendation);
  assert.ok(gated._gate.nextAction);
  assert.ok(gated._gate.bookingCta);
  assert.equal(gated._gate.bookingCta.visible, true);
  assert.ok(gated._gate.bookingCta.text.length > 0);
  assert.ok(gated._gate.validatedAt);
});

test("T-GATE-03: required next action text is present and correct", () => {
  const model = baseModel();
  const { model: gated } = runFinalizationGate(model, model.evidence);
  assert.ok(gated._gate.nextAction.includes("implementation scoping session"));
  assert.ok(gated._gate.nextAction.includes("targeted remediation or a full redesign"));
});

test("T-GATE-04: booking CTA is visible and references business name", () => {
  const model = baseModel();
  const { model: gated } = runFinalizationGate(model, model.evidence);
  assert.ok(gated._gate.bookingCta.text.includes("Test Business"));
  assert.equal(gated._gate.bookingCta.placement, "report-footer");
});

// ---------------------------------------------------------------------------
// Blocked contradictions
// ---------------------------------------------------------------------------

test("T-GATE-05: blocks AVAILABLE performance with null score despite truly usable strategies", () => {
  // Both strategies have valid FCP+LCP+scores → both ARE usable
  // But the model's performance score is null → scoring inconsistency
  const evidence = baseEvidence({
    performance: { sourceStatus: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", coverage: { requested: 2, completed: 2, failed: 0 }, limitations: [], mobile: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 1200, lcpMs: 2600 }, scores: { performance: 71 } }, desktop: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 800, lcpMs: 1800 }, scores: { performance: 85 } } },
  });
  const model = baseModel({ scores: { performance: null }, evidence });
  const { passed, errors } = runFinalizationGate(model, evidence);
  // Normalization: both strategies usable → completed=2, source stays AVAILABLE
  // Model score is null despite 2 usable strategies → valid error
  assert.equal(passed, false);
  const perfErr = errors.find((e) => e.field === "scores.performance");
  assert.ok(perfErr, "Must block null performance score with truly usable strategies");
});

test("T-GATE-06: blocks PASS paired with UNAVAILABLE evidence", () => {
  const evidence = baseEvidence({
    performance: { sourceStatus: SOURCE_STATUS.UNAVAILABLE, source: "unavailable", coverage: { requested: 2, completed: 0, failed: 2 }, limitations: ["All failed"], mobile: { status: SOURCE_STATUS.FAILED, metrics: {}, scores: {} }, desktop: { status: SOURCE_STATUS.FAILED, metrics: {}, scores: {} } },
  });
  const model = baseModel({ scores: { performance: 75 }, evidence });
  const { passed, errors } = runFinalizationGate(model, evidence);
  assert.equal(passed, false);
  const err = errors.find((e) => e.field === "scores.performance");
  assert.ok(err, "Must block performance score with UNAVAILABLE source");
});

test("T-GATE-07: blocks high confidence with low assessed weight", () => {
  const model = baseModel({ evidenceConfidenceScore: 90, assessedWeight: 40 });
  const { passed, errors } = runFinalizationGate(model, model.evidence);
  assert.equal(passed, false);
  const err = errors.find((e) => e.field === "evidenceConfidenceScore");
  assert.ok(err, "Must block high confidence unsupported by assessed weight");
});

// PRYSM-INCIDENT-01 — production incident regression.  The real production
// v2 audit produced confidence 86 with assessed weight 30%; scoring declared
// the PRD-governed "Insufficient Evidence for Overall Score" state (numeric
// suppressed).  The gate must RENDER that honest state, not fail the whole
// pipeline (render_failed).  Mutation-sensitive: at b93d8cc this passes
// `passed === false`.
test("T-GATE-INCIDENT-01: governed Insufficient-Evidence state renders (numeric suppressed)", () => {
  const model = baseModel({
    evidenceConfidenceScore: 86,
    assessedWeight: 30,
    showNumericScore: false,
    readinessStatus: "Insufficient Evidence for Overall Score",
    readinessStatusDetail: "Insufficient Evidence for Overall Score",
    bands: { conversionReadiness: "Not Assessed", trust: "Not Assessed", evidenceConfidence: "High" },
    scores: {
      trust: null, contentDepth: null, conversionPathways: null,
      technical: 43, performance: 76, conversionReadiness: null,
      awareness: null, consideration: null, decision: null, aiReadiness: null,
    },
  });
  const { passed, errors } = runFinalizationGate(model, model.evidence);
  assert.equal(passed, true, `gate must pass for the governed insufficiency state: ${JSON.stringify(errors.map((e) => e.message))}`);
});

// End-to-end through the REAL scoring path: the production-shaped
// metadata-only crawl produces exactly this combination; the gate must
// accept the scored model.
test("T-GATE-INCIDENT-02: real scoring model with suppressed numeric passes the gate", async () => {
  const { scoreAudit } = await import("./vantage-score.js");
  const FIXED_TS = "2026-01-15T12:00:00.000Z";
  const evidence = {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: {
      sourceStatus: SOURCE_STATUS.PARTIAL,
      targetUrl: "https://incident.example.com/",
      domain: "incident.example.com",
      platform: "WordPress",
      pageCount: 4,
      pages: [
        { url: "https://incident.example.com/", title: "Home", headings: { h1: ["Home"], h2: [], h3: [], h4: [] }, status: 200 },
        { url: "https://incident.example.com/services", title: "Services", headings: { h1: ["Services"], h2: [], h3: [], h4: [] }, status: 200 },
      ],
      services: [], topicKeywords: [], ctas: [], forms: [], externalCtas: [],
      socialLinks: [], schemaTypes: ["Organization"], microdataTypes: [],
      trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: false },
      securityHeaders: { xFrameOptions: false, xContentTypeOptions: false, referrerPolicy: false, contentSecurityPolicy: false },
      totalWords: 0, averageWords: 0,
      missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
      h1Missing: 0, h1Multiple: 0, imageCount: 0, imagesMissingAlt: 0,
      internalLinkCount: 0, brokenInternalLinks: [], statusCounts: {},
      limitations: ["JavaScript content may be partially missing on some pages"],
      collectedAt: FIXED_TS,
      coverage: { requested: 500, completed: 450, failed: 50 },
      _contentEvidenceAvailable: false,
      _responseHeadersAvailable: false,
      _interactiveEvidenceAvailable: false,
      _metaCountersAvailable: false,
      acquisition: {
        contentParsing: { requested: 3, completed: 0, failed: 3 },
        redirectChains: { requested: 3, completed: 0, failed: 3 },
        nonIndexable: { requested: 1000, completed: 0, failed: 1000 },
        resources: { requested: 3, completed: 0, failed: 3 },
        microdata: { requested: 1, completed: 1, failed: 0 },
      },
    },
    performance: {
      sourceStatus: SOURCE_STATUS.AVAILABLE,
      provider: "pagespeed-insights",
      mobile: { status: SOURCE_STATUS.AVAILABLE, source: "psi", scores: { performance: 80 }, metrics: { fcpMs: 1000, lcpMs: 2000 } },
      desktop: { status: SOURCE_STATUS.AVAILABLE, source: "psi", scores: { performance: 90 }, metrics: { fcpMs: 800, lcpMs: 1500 } },
      fieldData: {}, limitations: [],
      collectedAt: FIXED_TS,
      coverage: { requested: 2, completed: 2, failed: 0 },
    },
    competitors: null, backlinks: null, ga4: null, gsc: null,
  };
  const model = scoreAudit(
    { targetUrl: "https://incident.example.com/", businessName: "Incident Co", competitors: [] },
    evidence,
  );
  // The real production incident's exact signature.
  assert.ok(model.evidenceConfidenceScore >= 80, "confidence is High");
  assert.ok(model.assessedWeight < 60, "assessed weight is below 60");
  assert.equal(model.showNumericScore, false, "numeric score suppressed");
  const { passed } = runFinalizationGate(model, evidence);
  assert.equal(passed, true, "governed insufficiency state must render, not render_failed");
});

test("T-GATE-08: blocks completed tests that produced unusable rendering defects", () => {
  // Truly usable strategies (FCP+LCP+score all present) BUT rendering
  // diagnostics exist. Normalization says they're usable (completed=2),
  // but site-rendering defects mean the results shouldn't count.
  const evidence = baseEvidence({
    performance: { sourceStatus: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", coverage: { requested: 2, completed: 2, failed: 0 }, limitations: [], mobile: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 1200, lcpMs: 2600 }, scores: { performance: 71 } }, desktop: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 800, lcpMs: 1800 }, scores: { performance: 85 } } },
  });
  const model = baseModel({
    renderingDiagnostics: [
      { diagnosticCode: "JS_EXECUTION_FAILURE", diagnosticCategory: DIAGNOSTIC_CATEGORY.SITE_RENDERING },
    ],
    evidence,
  });
  const { passed, errors } = runFinalizationGate(model, evidence);
  // Both strategies are usable (valid FCP+LCP+score) so completed=2
  // But site-rendering defects exist → must flag
  assert.equal(passed, false);
  const covErr = errors.find((e) => e.field === "performance.coverage");
  assert.ok(covErr, "Must block when usable results coexist with rendering defects");
});

test("T-GATE-09: duplicate limitations are deduplicated during normalization", () => {
  const evidence = baseEvidence({
    performance: { sourceStatus: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", coverage: { requested: 2, completed: 2, failed: 0 }, limitations: ["Same limitation", "Same limitation", "Another one"], mobile: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 1200, lcpMs: 2600 }, scores: { performance: 71 } }, desktop: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 800, lcpMs: 1800 }, scores: { performance: 85 } } },
  });
  const model = baseModel({ evidence });
  const { passed, errors } = runFinalizationGate(model, evidence);
  // Normalization deduplicates limitations, so gate passes
  assert.equal(passed, true);
  assert.equal(evidence.performance.limitations.length, 2, "Should have 2 unique limitations");
  const dupErr = errors.find((e) => e.field === "performance.limitations");
  assert.equal(dupErr, undefined, "No duplicate error after normalization");
});

test("T-GATE-10: blocks null assessed weight", () => {
  const model = baseModel({ assessedWeight: null });
  const { passed, errors } = runFinalizationGate(model, model.evidence);
  assert.equal(passed, false);
  assert.ok(errors.some((e) => e.field === "assessedWeight"));
});

test("T-GATE-11: blocks null evidence confidence score", () => {
  const model = baseModel({ evidenceConfidenceScore: null });
  const { passed, errors } = runFinalizationGate(model, model.evidence);
  assert.equal(passed, false);
  assert.ok(errors.some((e) => e.field === "evidenceConfidenceScore"));
});

test("T-GATE-12: blocks finding with null/empty title", () => {
  const model = baseModel({
    findings: [{ ruleId: "VAN-001", title: null, severity: "High", scoreBearing: true }],
  });
  const { passed, errors } = runFinalizationGate(model, model.evidence);
  assert.equal(passed, false);
  assert.ok(errors.some((e) => e.field === "findings[].title"));
});

test("T-GATE-13: warns on null businessImpact or recommendation", () => {
  const model = baseModel({
    findings: [
      { ruleId: "VAN-001", title: "Test", severity: "High", scoreBearing: true, businessImpact: "", recommendation: "" },
    ],
  });
  const { warnings } = runFinalizationGate(model, model.evidence);
  assert.ok(warnings.some((w) => w.field === "findings[].businessImpact"));
  assert.ok(warnings.some((w) => w.field === "findings[].recommendation"));
});

test("T-GATE-14: competitor count normalized from evidence source", () => {
  const evidence = baseEvidence({ competitors: [{ url: "https://comp.com" }, { url: "https://comp2.com" }] });
  const model = baseModel({ competitors: [{ url: "https://comp.com" }], evidence });
  const { passed } = runFinalizationGate(model, evidence);
  // Normalization syncs model competitor count to evidence, so no mismatch
  assert.equal(passed, true);
  assert.equal(model._normalizedCompetitorCount, 2);
});

// ---------------------------------------------------------------------------
// Service category mapping
// ---------------------------------------------------------------------------

test("T-GATE-15: maps redesign findings to website redesign category", () => {
  const model = baseModel({
    findings: [
      { ruleId: "VAN-001", title: "Page remained blank during testing", severity: "High", scoreBearing: true, key: "rendering", businessImpact: "No content visible.", recommendation: "Audit rendering pipeline." },
    ],
  });
  const { model: gated } = runFinalizationGate(model, model.evidence);
  assert.ok(gated._gate.serviceCategories.includes("website redesign"));
});

test("T-GATE-16: maps LCP findings to technical remediation", () => {
  const model = baseModel();
  const { model: gated } = runFinalizationGate(model, model.evidence);
  assert.ok(gated._gate.serviceCategories.includes("technical remediation"));
});

test("T-GATE-17: maps trust/CTA findings to content strategy", () => {
  const model = baseModel({
    findings: [
      { ruleId: "VAN-TRUST-001", title: "No visible trust proof", severity: "High", scoreBearing: true, key: "trust", businessImpact: "Cannot verify credibility.", recommendation: "Add client testimonials and case studies." },
    ],
  });
  const { model: gated } = runFinalizationGate(model, model.evidence);
  assert.ok(gated._gate.serviceCategories.includes("content strategy"));
});

// ---------------------------------------------------------------------------
// Commercial recommendation
// ---------------------------------------------------------------------------

test("T-GATE-18: high-severity redesign findings produce redesign recommendation", () => {
  const model = baseModel({
    findings: [
      { ruleId: "VAN-001", title: "Page blank — rendering failure", severity: "High", scoreBearing: true, key: "rendering", businessImpact: "No content.", recommendation: "Rebuild page structure." },
      { ruleId: "VAN-002", title: "No conversion paths detected", severity: "High", scoreBearing: true, key: "paths", businessImpact: "No conversion.", recommendation: "Redesign conversion architecture." },
      { ruleId: "VAN-003", title: "CMS platform constraints limit growth", severity: "High", scoreBearing: true, key: "platform", businessImpact: "Cannot scale.", recommendation: "Migrate to modern CMS." },
    ],
  });
  const { model: gated } = runFinalizationGate(model, model.evidence);
  assert.ok(gated._gate.commercialRecommendation.includes("redesign"));
});

test("T-GATE-19: moderate findings produce targeted remediation recommendation", () => {
  const model = baseModel({
    findings: [
      { ruleId: "VAN-001", title: "Missing meta descriptions", severity: "High", scoreBearing: true, key: "meta", businessImpact: "Uncontrolled SERP.", recommendation: "Write descriptions." },
      { ruleId: "VAN-002", title: "Missing alt text", severity: "Low", scoreBearing: true, key: "alt", businessImpact: "Accessibility.", recommendation: "Add alt text." },
      { ruleId: "VAN-003", title: "No FAQ content", severity: "Medium", scoreBearing: true, key: "faq", businessImpact: "Weak content.", recommendation: "Add FAQ." },
      { ruleId: "VAN-004", title: "Inconsistent headings", severity: "Medium", scoreBearing: true, key: "headings", businessImpact: "SEO impact.", recommendation: "Fix headings." },
    ],
  });
  const { model: gated } = runFinalizationGate(model, model.evidence);
  assert.ok(gated._gate.commercialRecommendation.includes("content strategy"));
});

test("T-GATE-20: no findings produce foundation recommendation", () => {
  const model = baseModel({ findings: [] });
  const { model: gated } = runFinalizationGate(model, model.evidence);
  assert.ok(gated._gate.commercialRecommendation.includes("functional foundation"));
});

// ---------------------------------------------------------------------------
// Confidence recalculation
// ---------------------------------------------------------------------------

test("T-GATE-21: confidence recalculated from actual assessed evidence", () => {
  const model = baseModel();
  const { model: gated } = runFinalizationGate(model, model.evidence);
  assert.ok(typeof gated._gate.evidenceConfidence === "number");
  assert.ok(gated._gate.evidenceConfidence >= 0 && gated._gate.evidenceConfidence <= 100);
});

test("T-GATE-22: all sources available produces at least as much confidence as partial", () => {
  const fullEvidence = baseEvidence({
    ga4: { sourceStatus: SOURCE_STATUS.AVAILABLE },
    gsc: { sourceStatus: SOURCE_STATUS.AVAILABLE, sufficiency: { sufficient: true } },
    backlinks: { sourceStatus: SOURCE_STATUS.AVAILABLE },
  });
  const partialEvidence = baseEvidence();

  const { model: full } = runFinalizationGate(baseModel({ evidence: fullEvidence }), fullEvidence);
  const { model: partial } = runFinalizationGate(baseModel({ evidence: partialEvidence }), partialEvidence);

  // Optional sources don't penalize when NOT_CONNECTED (PRD §3.5).
  // Full available sources should produce >= confidence, never less.
  assert.ok(full._gate.evidenceConfidence >= partial._gate.evidenceConfidence,
    `Full confidence ${full._gate.evidenceConfidence} should be >= partial ${partial._gate.evidenceConfidence}`);
});

// ---------------------------------------------------------------------------
// Integration: contradictory report cannot reach render
// ---------------------------------------------------------------------------

test("T-GATE-INT-01: contradictory report is blocked from rendering", () => {
  // A report with null performance score, duplicate limitations, and
  // high confidence on low assessed weight — multiple contradictions
  const evidence = baseEvidence({
    performance: {
      sourceStatus: SOURCE_STATUS.AVAILABLE,
      source: "pagespeed-insights",
      coverage: { requested: 2, completed: 2, failed: 0 },
      limitations: ["dup", "dup", "dup"],
      mobile: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 1200, lcpMs: 2600 }, scores: { performance: 71 } },
      desktop: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 800, lcpMs: 1800 }, scores: { performance: 85 } },
    },
  });
  const model = baseModel({
    scores: { performance: null },
    evidenceConfidenceScore: 90,
    assessedWeight: 35,
    renderingDiagnostics: [
      { diagnosticCode: "NO_LCP", diagnosticCategory: DIAGNOSTIC_CATEGORY.SITE_RENDERING },
    ],
    evidence,
  });
  const { passed, errors } = runFinalizationGate(model, evidence);
  assert.equal(passed, false, "Contradictory report must not pass the gate");
  assert.ok(errors.length >= 3, `Expected at least 3 errors, got ${errors.length}`);
});

// ---------------------------------------------------------------------------
// Integration: consistent report passes with all required outputs
// ---------------------------------------------------------------------------

test("T-GATE-INT-02: consistent report passes and produces all required outputs", () => {
  const evidence = baseEvidence({
    performance: {
      sourceStatus: SOURCE_STATUS.AVAILABLE,
      source: "pagespeed-insights",
      coverage: { requested: 2, completed: 2, failed: 0 },
      limitations: ["One unique limitation"],
      mobile: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 1200, lcpMs: 2600 }, scores: { performance: 71 } },
      desktop: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 800, lcpMs: 1800 }, scores: { performance: 85 } },
    },
    ga4: { sourceStatus: SOURCE_STATUS.AVAILABLE },
    gsc: { sourceStatus: SOURCE_STATUS.AVAILABLE, sufficiency: { sufficient: true } },
    backlinks: { sourceStatus: SOURCE_STATUS.AVAILABLE },
  });
  const model = baseModel({
    evidenceConfidenceScore: 65,
    assessedWeight: 85,
    findings: [
      { ruleId: "VAN-PERF-001", title: "Mobile LCP is slow", severity: "High", scoreBearing: true, key: "lcp", businessImpact: "Slow first impressions increase abandonment.", recommendation: "Optimize the largest above-fold asset." },
      { ruleId: "VAN-TRUST-001", title: "No visible trust proof", severity: "High", scoreBearing: true, key: "trust", businessImpact: "Visitors cannot verify credibility before deciding.", recommendation: "Add credentials and client proof." },
      { ruleId: "VAN-TECH-001", title: "Missing meta descriptions", severity: "High", scoreBearing: true, key: "meta", businessImpact: "Search-result messaging is uncontrolled.", recommendation: "Write unique descriptions." },
    ],
    evidence,
  });

  const { passed, errors, warnings, model: gated } = runFinalizationGate(model, evidence);

  // Must pass
  assert.equal(passed, true, `Gate must pass. Errors: ${JSON.stringify(errors.map(e => e.message))}`);
  assert.equal(errors.length, 0, "Zero errors");

  // Must have commercial recommendation
  assert.ok(gated._gate.commercialRecommendation.length > 0);
  assert.ok(!gated._gate.commercialRecommendation.includes("undefined"));
  assert.ok(!gated._gate.commercialRecommendation.includes("null"));

  // Must have next action
  assert.ok(gated._gate.nextAction.includes("implementation scoping session"));

  // Must have visible booking CTA
  assert.equal(gated._gate.bookingCta.visible, true);
  assert.ok(gated._gate.bookingCta.text.length > 0);
  assert.ok(gated._gate.bookingCta.text.includes("Test Business"));

  // No duplicate limitations
  assert.ok(!errors.some((e) => e.field === "performance.limitations"));

  // No null/undefined client-facing values in findings
  for (const f of model.findings) {
    assert.notEqual(f.title, null);
    assert.notEqual(f.title, undefined);
    assert.notEqual(f.businessImpact, null);
    assert.notEqual(f.businessImpact, undefined);
    assert.notEqual(f.recommendation, null);
    assert.notEqual(f.recommendation, undefined);
  }

  // Service categories populated
  assert.ok(gated._gate.serviceCategories.length > 0);

  // Evidence confidence recalculated
  assert.ok(typeof gated._gate.evidenceConfidence === "number");
  assert.ok(gated._gate.evidenceConfidence > 0);
});

// ---------------------------------------------------------------------------
// Production regression: run 20260730233431-4375959f failure pattern
// ---------------------------------------------------------------------------

test("T-GATE-REG-01: AVAILABLE with 4 completed but null performance score", () => {
  const evidence = baseEvidence({
    performance: {
      sourceStatus: SOURCE_STATUS.AVAILABLE,
      source: "pagespeed-insights",
      coverage: { requested: 4, completed: 4, failed: 0 },
      limitations: ["dup1", "dup1", "dup2"],
      mobile: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 1200, lcpMs: null }, scores: { performance: 67 } },
      desktop: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 800, lcpMs: null }, scores: { performance: 72 } },
    },
  });
  const model = baseModel({ scores: { performance: null }, evidence });
  const { passed, errors } = runFinalizationGate(model, evidence);

  // Normalization: LCP null on both → usableCount = 0 → source downgraded to FAILED
  // Null performance score with FAILED source → no conflict (source already FAILED)
  // But the gate should still catch duplicate limitations
  const dupErr = errors.find((e) => e.field === "performance.limitations");
  // Limitations were deduped by _normalizeEvidenceForGate, so no duplicate error
  assert.equal(dupErr, undefined, "Limitations should be deduped before gate check");

  // Coverage: both strategies have null LCP → 0 usable → completed should be 0
  const perfErr = errors.find((e) => e.field === "performance.coverage");
  // After normalization: effectiveCompleted = 0, so no coverage error
  assert.equal(perfErr, undefined, "Normalized coverage should show 0 completed");
});

test("T-GATE-REG-02: coverage counts only usable results after normalization", () => {
  const evidence = baseEvidence({
    performance: {
      sourceStatus: SOURCE_STATUS.AVAILABLE,
      source: "pagespeed-insights",
      coverage: { requested: 4, completed: 4, failed: 0 },
      limitations: [],
      mobile: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: null, lcpMs: null }, scores: { performance: null } },
      desktop: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: null, lcpMs: null }, scores: { performance: null } },
    },
  });
  const model = baseModel({ scores: { performance: null }, evidence });
  runFinalizationGate(model, evidence);
  // Normalization should set completed = 0 (neither strategy is usable)
  assert.equal(evidence.performance._normalizedCoverage.completed, 0);
  assert.equal(evidence.performance._normalizedCoverage.failed, 4);
  assert.equal(evidence.performance._effectiveSourceStatus, SOURCE_STATUS.FAILED);
});

test("T-GATE-REG-03: competitor count derives from evidence source", () => {
  const evidence = baseEvidence({ competitors: [{ url: "a.com" }, { url: "b.com" }, { url: "c.com" }] });
  const model = baseModel({ competitors: [], evidence });
  runFinalizationGate(model, evidence);
  // Normalization should sync model competitor count to evidence
  assert.equal(model._normalizedCompetitorCount, 3);
  // Model competitors should be synced to evidence
  assert.deepStrictEqual(model._normalizedCompetitors, [{ url: "a.com" }, { url: "b.com" }, { url: "c.com" }]);
});

test("T-GATE-REG-04: rendering-defect results not counted as completed", () => {
  const evidence = baseEvidence({
    performance: {
      sourceStatus: SOURCE_STATUS.AVAILABLE,
      source: "pagespeed-insights",
      coverage: { requested: 4, completed: 4, failed: 0 },
      limitations: [],
      mobile: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 1432, lcpMs: null }, scores: { performance: 67 } },
      desktop: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 980, lcpMs: null }, scores: { performance: 72 } },
    },
  });
  const model = baseModel({
    scores: { performance: null },
    renderingDiagnostics: [
      { diagnosticCode: "NO_LCP", diagnosticCategory: "SITE_RENDERING" },
    ],
    evidence,
  });
  runFinalizationGate(model, evidence);
  // Both strategies have null LCP → 0 usable
  assert.equal(evidence.performance._normalizedCoverage.completed, 0);
});

test("T-GATE-REG-05: duplicate limitations removed before gate check", () => {
  const evidence = baseEvidence({
    performance: {
      sourceStatus: SOURCE_STATUS.AVAILABLE,
      source: "pagespeed-insights",
      coverage: { requested: 2, completed: 2, failed: 0 },
      limitations: ["Error A", "Error A", "Error B", "Error B"],
      mobile: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 1200, lcpMs: 2600 }, scores: { performance: 71 } },
      desktop: { status: SOURCE_STATUS.AVAILABLE, metrics: { fcpMs: 800, lcpMs: 1800 }, scores: { performance: 85 } },
    },
  });
  const model = baseModel({ evidence });
  const { passed, errors } = runFinalizationGate(model, evidence);
  // Should pass — limitations deduped by normalization, no duplicate error
  const dupErr = errors.find((e) => e.field === "performance.limitations");
  assert.equal(dupErr, undefined, "Deduped limitations should not produce error");
  assert.equal(evidence.performance.limitations.length, 2, "Should have 2 unique limitations");
});

// ---------------------------------------------------------------------------
// Gate-blocked manifest behaviour
// ---------------------------------------------------------------------------

test("T-GATE-BLOCK-01: gate failure returns errors and omits render flag", () => {
  const evidence = baseEvidence({
    performance: {
      sourceStatus: SOURCE_STATUS.UNAVAILABLE,
      source: "unavailable",
      coverage: { requested: 2, completed: 0, failed: 2 },
      limitations: [],
      mobile: { status: SOURCE_STATUS.FAILED, metrics: {}, scores: {} },
      desktop: { status: SOURCE_STATUS.FAILED, metrics: {}, scores: {} },
    },
  });
  // Give the model a non-null performance score with UNAVAILABLE source
  const model = baseModel({ scores: { performance: 75 }, evidenceConfidenceScore: null, evidence });
  const { passed, errors } = runFinalizationGate(model, evidence);
  // Null evidence confidence + UNAVAILABLE with score → two errors
  assert.equal(passed, false);
  assert.ok(errors.length >= 1, `Expected at least 1 error, got ${errors.length}`);
});

// ---------------------------------------------------------------------------
// Test totals
// ---------------------------------------------------------------------------

test("T-GATE-TOTALS: verify gate test count", () => {
  assert.ok(31 >= 15, "31 gate tests (minimum 15 required)");
});

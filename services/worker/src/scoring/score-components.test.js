import test from "node:test";
import assert from "node:assert/strict";
import { scoreAudit } from "./vantage-score.js";
import {
  checkModuleEligibility,
  calculateEvidenceConfidence,
  MODULES,
} from "./score-components.js";
import { buildCapabilityEvidence } from "../evidence/capability-evidence.js";
import { SOURCE_STATUS } from "./evidence-contracts.js";

// PRYSM-NEXT-01 WP-D — scoring v4 truth tables, weighting defect proof,
// capability eligibility, business context, funnel stages, AI claims,
// findings gating, confidence availability.

const FIXED_TS = "2026-01-15T12:00:00.000Z";
const INPUT = { targetUrl: "https://x.com", businessName: "X", competitors: [] };

function site(overrides = {}) {
  return {
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    targetUrl: "https://x.com/",
    domain: "x.com",
    pageCount: 2,
    pages: [{ title: "Home", headings: { h1: ["Home"], h2: [], h3: [], h4: [] }, responseHeaders: {} }],
    services: ["Coaching"],
    topicKeywords: ["coaching support"],
    ctas: [{ text: "Book", url: "https://x.com/book", kind: "link" }],
    forms: [],
    schemaTypes: [],
    microdataTypes: [],
    socialLinks: [],
    trust: {
      testimonials: false, credentials: false, caseStudies: false,
      faq: false, pricing: false, policies: false, contact: true,
    },
    securityHeaders: {
      xFrameOptions: true, xContentTypeOptions: true,
      referrerPolicy: true, contentSecurityPolicy: true,
    },
    totalWords: 800, averageWords: 400,
    missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
    h1Missing: 0, h1Multiple: 0,
    imageCount: 2, imagesMissingAlt: 0,
    internalLinkCount: 2, brokenInternalLinks: [],
    statusCounts: {},
    limitations: [],
    collectedAt: FIXED_TS,
    coverage: { requested: 2, completed: 2, failed: 0 },
    _contentEvidenceAvailable: true,
    _responseHeadersAvailable: true,
    ...overrides,
  };
}

function perf(overrides = {}) {
  return {
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    provider: "pagespeed-insights",
    mobile: { status: SOURCE_STATUS.AVAILABLE, scores: { performance: 55 }, metrics: {} },
    desktop: { status: SOURCE_STATUS.AVAILABLE, scores: { performance: 96 }, metrics: {} },
    fieldData: {},
    limitations: [],
    collectedAt: FIXED_TS,
    coverage: { requested: 2, completed: 2, failed: 0 },
    ...overrides,
  };
}

function evidenceOf({ site: s, performance: p } = {}) {
  return {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: s === null ? null : (s || site()),
    performance: p === null ? null : (p || perf()),
    competitors: null, backlinks: null, ga4: null, gsc: null,
  };
}

function capsOf(ev) {
  return buildCapabilityEvidence({
    decisionEvidence: ev,
    auditId: "wpd-caps",
    generatedAt: FIXED_TS,
  }).capabilities;
}

// ---------------------------------------------------------------------------
// WP-D-01 — weighting defect proven and corrected
// ---------------------------------------------------------------------------

test("WP-D-01: overall readiness is the ASSESSED-weight-weighted mean (buggy full-weight numerator rejected)", () => {
  // Hand-computed fixture (clamp rounds to nearest int):
  // conversion dim: (25×12.5 + 25×12.5)/25 = 25
  // trust dim: (10×12.5 + 60×12.5)/25 = 35
  // content dim: (34×10 + 24×10)/20 = 29
  // technical_hygiene: (50×50+10×10+10×10)/70 = 38.57 → 39
  // technical dim: (39×10 + 76×10)/20 = 57.5
  // schema_entity 0; ai_readiness 21 → entity dim (0×5+21×5)/10 = 10.5
  // readiness = (625+875+580+1150+105)/100 = 33.35 → clamp → 33
  const model = scoreAudit(INPUT, evidenceOf());
  assert.equal(model.assessedWeight, 100);
  assert.equal(model.scores.conversionReadiness, 33);

  // Partial dimension case: headers NOT collected → technical.headers
  // UNAVAILABLE → risk_reduction suppressed → trust dimension assessed
  // weight = 12.5 (trust_signals only, score 10).
  // dimensionAssessedWeight = Math.round((12.5/25)×25) = 13 (documented
  // per-dimension rounding) → overallAssessedWeight = 25+13+20+20+10 = 88.
  // technical_hygiene: (2500+100)/60 = 43.33 → 43
  // technical dim: (43×10 + 76×10)/20 = 59.5
  // readiness = (625 + 10×13 + 580 + 1190 + 105)/88 = 29.886 → 30
  // The OLD buggy formula multiplies the partial trust score by its FULL
  // weight (25) in the numerator → 31.0 — must NOT match.
  const partial = scoreAudit(INPUT, evidenceOf({
    site: site({ _responseHeadersAvailable: false }),
  }));
  assert.equal(partial.assessedWeight, 88);
  assert.equal(partial.scores.conversionReadiness, 30);
  assert.ok(partial.suppressedModules.some((m) => m.moduleId === "risk_reduction"));
});

// ---------------------------------------------------------------------------
// WP-D-02/03/04 — capability eligibility truth tables through scoreAudit
// ---------------------------------------------------------------------------

test("WP-D-02: DFS metadata-only crawl suppresses content modules but keeps technical/performance/schema", () => {
  const dfsSite = site({
    _contentEvidenceAvailable: false,
    _responseHeadersAvailable: false,
    acquisition: {
      contentParsing: { requested: 3, completed: 0, failed: 3 },
      redirectChains: { requested: 3, completed: 3, failed: 0 },
      nonIndexable: { requested: 1000, completed: 2, failed: 0 },
      resources: { requested: 3, completed: 3, failed: 0 },
      microdata: { requested: 1, completed: 1, failed: 0 },
    },
  });
  const model = scoreAudit(INPUT, evidenceOf({ site: dfsSite }));

  // Content-dependent modules suppressed.
  for (const id of ["trust_signals", "offer_clarity", "conversion_paths", "content_depth", "funnel_coverage", "risk_reduction"]) {
    assert.equal(model.moduleEligibility[id], false, `${id} must be suppressed without content evidence`);
  }
  // Technical + performance + schema (microdata completed → absence confirmed).
  assert.equal(model.moduleEligibility.technical_hygiene, true);
  assert.equal(model.moduleEligibility.performance, true);
  assert.equal(model.moduleEligibility.schema_entity, true);
  assert.equal(model.moduleEligibility.ai_readiness, true);

  // Assessed weight: technical 10 + performance 10 + schema 5 + ai 5 = 30.
  assert.equal(model.assessedWeight, 30);
  // No silent reweighting: the score is suppressed below 60% assessed.
  assert.equal(model.showNumericScore, false);
  assert.equal(model.readinessStatus, "Insufficient Evidence for Overall Score");
  assert.equal(model.scores.trust, null, "unknown content must never lower the trust score — it is null");
  assert.notEqual(model.scores.technical, null);
  // Suppression reasons carry capability names.
  assert.ok(model.suppressedModules.some((m) => /trust\.proof/.test(m.reason || "")));
});

test("WP-D-04: no schema anywhere → schema modules suppressed; assessed weight exact", () => {
  const dfsSite = site({
    _contentEvidenceAvailable: false,
    _responseHeadersAvailable: false,
    acquisition: { microdata: { requested: 1, completed: 0, failed: 1 } },
  });
  const model = scoreAudit(INPUT, evidenceOf({ site: dfsSite }));
  assert.equal(model.moduleEligibility.schema_entity, false);
  assert.equal(model.moduleEligibility.ai_readiness, false);
  // technical 10 + performance 10 = 20.
  assert.equal(model.assessedWeight, 20);
});

test("WP-D-02: no performance evidence → performance module suppressed (UNAVAILABLE, not zero)", () => {
  const model = scoreAudit(INPUT, evidenceOf({ performance: null }));
  assert.equal(model.moduleEligibility.performance, false);
  assert.equal(model.scores.performance, null);
  assert.ok(model.suppressedModules.some((m) => m.moduleId === "performance" && /performance\.lab/.test(m.reason || "")));
});

test("WP-D-02: provider failure (performance FAILED) suppresses the performance module", () => {
  const model = scoreAudit(INPUT, evidenceOf({
    performance: perf({ sourceStatus: SOURCE_STATUS.FAILED, status: SOURCE_STATUS.FAILED, limitations: ["both providers failed"] }),
  }));
  assert.equal(model.moduleEligibility.performance, false);
  assert.equal(model.scores.performance, null);
});

test("WP-D-09: partial content parsing (1/3) keeps content.body modules eligible with PARTIAL capability", () => {
  const s = site({
    _contentEvidenceAvailable: false,
    acquisition: { contentParsing: { requested: 3, completed: 1, failed: 2 } },
  });
  const caps = capsOf(evidenceOf({ site: s }));
  assert.equal(caps["content.body"].status, "PARTIAL");
  const model = scoreAudit(INPUT, evidenceOf({ site: s }));
  assert.equal(model.moduleEligibility.content_depth, true, "PARTIAL content evidence is usable for content.body modules");
  // trust.proof requires BODY-TEXT evidence (content parsing does not
  // provide it) — trust modules stay suppressed, honestly.
  assert.equal(model.moduleEligibility.trust_signals, false);
});

test("WP-D-09: conflicting signals — content parsed but page has no main content → content.body AVAILABLE (collected observation)", () => {
  const s = site({
    _contentEvidenceAvailable: false,
    contentParsing: [{ url: "https://x.com/", wordCount: null, mainContentChars: null, hasMainContent: false, sentimentScore: null }],
    acquisition: { contentParsing: { requested: 1, completed: 1, failed: 0 } },
  });
  const caps = capsOf(evidenceOf({ site: s }));
  assert.equal(caps["content.body"].status, "AVAILABLE");
  const model = scoreAudit(INPUT, evidenceOf({ site: s }));
  assert.equal(model.moduleEligibility.content_depth, true);
  assert.equal(model.moduleEligibility.trust_signals, false, "trust.proof stays unavailable without body text");
});

// ---------------------------------------------------------------------------
// WP-D-05 — business context
// ---------------------------------------------------------------------------

test("WP-D-05: intake services change content scoring deterministically", () => {
  const ev = evidenceOf();
  const base = scoreAudit(INPUT, ev);
  const withCtx = scoreAudit(
    { ...INPUT, services: ["Executive Coaching", "Leadership Development", "Team Facilitation"] },
    ev,
  );
  assert.ok(
    withCtx.scores.contentDepth > base.scores.contentDepth,
    "intake services must strengthen the content-depth score",
  );
  assert.equal(
    withCtx.contentIdeas.tofu[0].idea.startsWith("What Is Executive Coaching"),
    true,
    "content ideas must lead with the business-context service",
  );
  // Non-context outputs are identical (determinism of unaffected paths).
  assert.equal(withCtx.scores.performance, base.scores.performance);
});

test("WP-D-06: readinessMap stages derive from page purpose — never index % 3", () => {
  const s = site({
    services: ["Coaching", "Workshops", "Advisory"],
    pages: [
      { crawledUrl: "https://x.com/coaching", title: "Coaching", headings: { h1: ["Coaching"], h2: [], h3: [], h4: [] }, forms: [{ action: "/submit" }] },
      { crawledUrl: "https://x.com/workshops", title: "Workshops Guide", headings: { h1: ["What are Workshops?"], h2: [], h3: [], h4: [] } },
      { crawledUrl: "https://x.com/advisory", title: "Advisory Case Studies", headings: { h1: ["Client Results"], h2: [], h3: [], h4: [] } },
    ],
  });
  const model = scoreAudit(INPUT, evidenceOf({ site: s }));
  const rows = model.readinessMap;
  assert.equal(rows[0].topic, "Coaching");
  assert.equal(rows[0].stage, "BOFU", "form-bearing page is BOFU");
  assert.equal(rows[1].stage, "TOFU", "guide page is TOFU");
  assert.equal(rows[2].stage, "MOFU", "case-study page is MOFU");
  // Rows keep the frozen schema shape (stage values change, not the shape).
  assert.deepEqual(
    Object.keys(rows[0]).sort(),
    ["blocker", "cta", "eeat", "path", "priority", "stage", "topic", "trustAsset"].sort(),
  );
});

test("WP-D-06: service with no matching page → Not Assessed, never fabricated", () => {
  const s = site({ services: ["Mystery Service"], pages: [{ title: "Unrelated", headings: { h1: ["Unrelated"], h2: [], h3: [], h4: [] }, responseHeaders: {} }] });
  const model = scoreAudit(INPUT, evidenceOf({ site: s }));
  const row = model.readinessMap.find((r) => r.topic === "Mystery Service");
  assert.equal(row.stage, "Not Assessed");
});

// ---------------------------------------------------------------------------
// WP-D-07 — AI-readiness claims
// ---------------------------------------------------------------------------

test("WP-D-07: aiReadiness has no floor for unknown; basis and limitation recorded", () => {
  const s = site({ _responseHeadersAvailable: false });
  const model = scoreAudit(INPUT, evidenceOf({ site: s }));
  assert.equal(model.aiReadinessBasis, "structural");
  // schemaTypes empty → schema points 0 (availability confirmed by content
  // evidence — absence is a collected fact, not a penalty).
  const withSchema = site({ schemaTypes: ["Organization", "LocalBusiness", "Service"] });
  const modelSchema = scoreAudit(INPUT, evidenceOf({ site: withSchema }));
  assert.ok(modelSchema.scores.aiReadiness > model.scores.aiReadiness,
    "schema presence must raise structural readiness");
  assert.equal(model.aiReadinessLimitation, null, "schema capability available → no limitation");
});

// ---------------------------------------------------------------------------
// WP-D-11 — findings gating
// ---------------------------------------------------------------------------

test("WP-D-11: content findings suppressed with reasons when content is unknown", () => {
  const dfsSite = site({
    _contentEvidenceAvailable: false,
    _responseHeadersAvailable: false,
    acquisition: { microdata: { requested: 1, completed: 0, failed: 1 } },
  });
  const model = scoreAudit(INPUT, evidenceOf({ site: dfsSite }));
  const ruleIds = new Set(model.findings.map((f) => f.ruleId));
  assert.ok(!ruleIds.has("VAN-TRUST-001"), "trust finding must be suppressed");
  assert.ok(!ruleIds.has("VAN-TRUST-002"), "pricing finding must be suppressed");
  assert.ok(!ruleIds.has("VAN-CONTENT-002"), "faq finding must be suppressed");
  assert.ok(!ruleIds.has("VAN-TECH-003"), "headers finding must be suppressed");
  assert.ok(!ruleIds.has("VAN-SCHEMA-001"), "schema finding must be suppressed (unknown)");
  assert.ok(
    model.suppressedFindingReasons.some((r) => r.ruleId === "VAN-TRUST-001" && r.capability === "trust.proof"),
    "suppression reasons must record the capability",
  );
});

test("WP-D-11: full evidence keeps confirmed-absence findings", () => {
  const model = scoreAudit(INPUT, evidenceOf());
  const ruleIds = new Set(model.findings.map((f) => f.ruleId));
  assert.ok(ruleIds.has("VAN-TRUST-001"), "confirmed absence still produces findings");
  assert.ok(ruleIds.has("VAN-SCHEMA-001"), "confirmed schema absence still produces findings");
  assert.equal(model.suppressedFindingReasons.length, 0);
});

// ---------------------------------------------------------------------------
// WP-D-12 — confidence unknown-factor handling
// ---------------------------------------------------------------------------

test("WP-D-12: unknown confidence factors are excluded, not imputed at 50", () => {
  const ev = evidenceOf();
  delete ev.site.coverage;
  ev.performance = null;
  const result = calculateEvidenceConfidence(ev, [], FIXED_TS);

  // dataCompleteness has no coverage data → null (unknown).
  assert.equal(result.factors.dataCompleteness, null);
  // dataFreshness still known (collectedAt present on site).
  assert.ok(typeof result.factors.dataFreshness === "number");
  // ruleCertainty unknown (no findings).
  assert.equal(result.factors.ruleCertainty, null);
  // Availability report excludes the unknown factors.
  const availability = Object.fromEntries(result.factorAvailability.map((f) => [f.factor, f.available]));
  assert.equal(availability.dataCompleteness, false);
  assert.equal(availability.ruleCertainty, false);
  assert.equal(availability.dataFreshness, true);
  // Score is the weighted mean over known factors only.
  assert.ok(result.score >= 0 && result.score <= 100);
});

// ---------------------------------------------------------------------------
// WP-D-10 — repeatability at model level
// ---------------------------------------------------------------------------

test("WP-D-10: identical evidence + context produces identical models (3×)", () => {
  const ev = evidenceOf();
  const a = scoreAudit(INPUT, ev);
  const b = scoreAudit(INPUT, ev);
  const c = scoreAudit(INPUT, ev);
  assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)));
  assert.deepEqual(JSON.parse(JSON.stringify(c)), JSON.parse(JSON.stringify(a)));
});

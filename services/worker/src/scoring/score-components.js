import { average, clamp, stableHash } from "../utils.js";
import { SOURCE_STATUS, isValidSourceStatus } from "./evidence-contracts.js";
import {
  BUSINESS_IMPACT_BASIS,
  governBusinessImpact,
} from "./business-impact-policy.js";

// ---------------------------------------------------------------------------
// Scoring version (PRD v3.0 §15.1 + PRYSM-NEXT-01 WP-D/WP-J)
//
// CHANGELOG
//   3.0.0 — PRD v3.0 launch scoring (superseded).
//   4.0.0 — capability-level module eligibility; assessed-weight-weighted
//           readiness (CRIT weighting defect corrected); business context
//           into scoring; page-purpose funnel stages; structural-only
//           AI-readiness; findings capability-gated; confidence unknown-
//           factor exclusion.
//   4.1.0 — validated conversion-path evidence (WP-E): bounded validated
//           bonus/penalty, VAN-PATH-001 obstruction finding.
//   4.1.1 — CRIT integrity fix (unknown ≠ full credit): scoreTechnicalV4
//           meta/images sub-rules are EXCLUDED when their counter inputs
//           are null/unknown instead of silently granting full points.
//           Mathematical/eligibility correctness proven by
//           score-components.test.js truth tables (sub-rule exclusion
//           changes assessed sub-weights, never the dimension weights).
// ---------------------------------------------------------------------------

export const SCORING_VERSION = "4.1.1";

// ---------------------------------------------------------------------------
// Severity / band helpers
// ---------------------------------------------------------------------------

const severityRank = { High: 3, Medium: 2, Low: 1 };

export function band(score) {
  if (score >= 80) return "Strong";
  if (score >= 60) return "Moderate";
  if (score >= 40) return "Limited";
  return "Weak";
}

export function confidenceBand(score) {
  if (score >= 85) return "High";
  if (score >= 65) return "Moderate";
  if (score >= 45) return "Limited";
  return "Directional";
}

// ---------------------------------------------------------------------------
// PRD §15.1 — Readiness dimensions and default weights
// ---------------------------------------------------------------------------

export const DIMENSIONS = Object.freeze({
  conversion_pathways: {
    id: "conversion_pathways",
    label: "Conversion Pathways and Offer Clarity",
    weight: 25, // percent of total readiness
  },
  trust_eeat: {
    id: "trust_eeat",
    label: "Trust, E-E-A-T, and Risk Reduction",
    weight: 25,
  },
  content_funnel: {
    id: "content_funnel",
    label: "Content and Funnel Coverage",
    weight: 20,
  },
  technical_performance: {
    id: "technical_performance",
    label: "Technical and Performance Readiness",
    weight: 20,
  },
  entity_schema_ai: {
    id: "entity_schema_ai",
    label: "Entity, Schema, and AI-Search Readiness",
    weight: 10,
  },
});

// ---------------------------------------------------------------------------
// PRD §15.2 — Module definitions with source dependencies
// ---------------------------------------------------------------------------

/**
 * Each module declares:
 *  - id:                    stable identifier
 *  - dimension:             parent dimension key
 *  - weight:                contribution to its dimension (out of that dimension's total)
 *  - sources:               required evidence sources for eligibility (back-compat)
 *  - requiredCapabilities:  capability keys that MUST be AVAILABLE/PARTIAL with
 *                           requiredFieldsPresent for the module to execute
 *                           (PRYSM-NEXT-01 WP-D-02; capability map per
 *                           .governance/changes/PRYSM-NEXT-01_CAPABILITY_MATRIX.md).
 *                           technical_hygiene partitions sub-rules per capability
 *                           instead (see scoreTechnicalV4).
 *  - scorer:                (site, perf, modelDeps) => 0-100 or null
 */
export const MODULES = Object.freeze({
  // ── Conversion Pathways and Offer Clarity (25%) ──────────────────────
  conversion_paths: {
    id: "conversion_paths",
    dimension: "conversion_pathways",
    weight: 12.5,
    sources: ["crawl"],
    requiredCapabilities: ["conversion.cta", "conversion.form"],
    label: "Conversion Paths",
    scorer: (_site, _perf, modelDeps) => scoreConversionV4(modelDeps),
  },
  offer_clarity: {
    id: "offer_clarity",
    dimension: "conversion_pathways",
    weight: 12.5,
    sources: ["crawl"],
    requiredCapabilities: ["offer.clarity"],
    label: "Offer Clarity",
    scorer: (_site, _perf, modelDeps) => scoreOfferClarityV4(modelDeps),
  },

  // ── Trust, E-E-A-T, and Risk Reduction (25%) ────────────────────────
  trust_signals: {
    id: "trust_signals",
    dimension: "trust_eeat",
    weight: 12.5,
    sources: ["crawl"],
    requiredCapabilities: ["trust.proof"],
    label: "Trust Signals",
    scorer: (_site, _perf, modelDeps) => scoreTrustV4(modelDeps),
  },
  risk_reduction: {
    id: "risk_reduction",
    dimension: "trust_eeat",
    weight: 12.5,
    sources: ["crawl"],
    requiredCapabilities: ["trust.proof", "technical.headers"],
    label: "Risk Reduction",
    scorer: (_site, _perf, modelDeps) => scoreRiskReductionV4(modelDeps),
  },

  // ── Content and Funnel Coverage (20%) ────────────────────────────────
  content_depth: {
    id: "content_depth",
    dimension: "content_funnel",
    weight: 10,
    sources: ["crawl"],
    requiredCapabilities: ["content.body"],
    label: "Content Depth",
    scorer: (_site, _perf, modelDeps) => scoreContentV4(modelDeps),
  },
  funnel_coverage: {
    id: "funnel_coverage",
    dimension: "content_funnel",
    weight: 10,
    sources: ["crawl"],
    requiredCapabilities: ["content.body", "trust.proof"],
    label: "Funnel Coverage",
    scorer: (_site, _perf, modelDeps) => scoreFunnelCoverageV4(modelDeps),
  },

  // ── Technical and Performance Readiness (20%) ────────────────────────
  technical_hygiene: {
    id: "technical_hygiene",
    dimension: "technical_performance",
    weight: 10,
    sources: ["crawl"],
    // Core meta rules need only crawl pages evidence; capability-scoped
    // sub-rules (indexability/redirects/resources/headers) are weighted in
    // only when their capability evidence is present (WP-D-04).
    requiredCapabilities: [],
    label: "Technical Hygiene",
    scorer: (_site, _perf, modelDeps) => scoreTechnicalV4(modelDeps),
  },
  performance: {
    id: "performance",
    dimension: "technical_performance",
    weight: 10,
    sources: ["performance"],
    requiredCapabilities: ["performance.lab"],
    label: "Performance",
    scorer: (_site, perf, _modelDeps) => scorePerformance(perf),
  },

  // ── Entity, Schema, and AI-Search Readiness (10%) ────────────────────
  schema_entity: {
    id: "schema_entity",
    dimension: "entity_schema_ai",
    weight: 5,
    sources: ["crawl"],
    requiredCapabilities: ["schema.structured_data"],
    label: "Schema & Entity",
    scorer: (_site, _perf, modelDeps) => scoreSchemaEntityV4(modelDeps),
  },
  ai_readiness: {
    id: "ai_readiness",
    dimension: "entity_schema_ai",
    weight: 5,
    sources: ["crawl"],
    requiredCapabilities: ["schema.structured_data"],
    label: "AI-Search Readiness",
    scorer: (_site, _perf, modelDeps) => scoreAiReadinessV4(modelDeps),
  },
});

// ---------------------------------------------------------------------------
// Source → module index (built once)
// ---------------------------------------------------------------------------

const _moduleList = Object.values(MODULES);
const _modulesBySource = {};
for (const src of ["crawl", "performance", "ga4", "gsc", "backlinks", "competitors"]) {
  _modulesBySource[src] = _moduleList.filter((m) => m.sources.includes(src));
}

export function modulesForSource(sourceKey) {
  return _modulesBySource[sourceKey] || [];
}

// ---------------------------------------------------------------------------
// PRD §15.4 — Confidence modifiers
// ---------------------------------------------------------------------------

export const CONFIDENCE_MODIFIERS = Object.freeze({
  deterministic:        1.00,
  strongly_supported:   0.90,
  supported:            0.75,
  directional:          0.55,
  insufficient:         0,    // not score-bearing
});

export const CONFIDENCE_LEVELS = Object.freeze({
  DETERMINISTIC:        "deterministic",
  STRONGLY_SUPPORTED:   "strongly_supported",
  SUPPORTED:            "supported",
  DIRECTIONAL:          "directional",
  INSUFFICIENT:         "insufficient",
});

// ---------------------------------------------------------------------------
// Individual module scorers (0–100)
// ---------------------------------------------------------------------------

export function scoreTrust(site) {
  return clamp(
    (site.trust.credentials ? 25 : 0) +
    (site.trust.testimonials ? 25 : 0) +
    (site.trust.caseStudies ? 20 : 0) +
    (site.trust.policies ? 10 : 0) +
    (site.trust.contact ? 10 : 0) +
    (site.socialLinks.length ? 10 : 0),
  );
}

export function scoreContent(site) {
  const pages = Math.min(30, site.pageCount * 5);
  const depth = Math.min(25, site.averageWords / 20);
  const services = Math.min(20, site.services.length * 4);
  const education = (site.trust.faq ? 15 : 0) + (site.pageCount >= 5 ? 10 : 0);
  return clamp(pages + depth + services + education);
}

export function scoreConversion(site) {
  const ctaScore = Math.min(25, site.ctas.length * 5);
  const forms = site.forms.length ? 20 : 0;
  const pricing = site.trust.pricing ? 15 : 0;
  const reassurance = (site.trust.policies ? 10 : 0) + (site.trust.testimonials ? 10 : 0);
  const contact = site.trust.contact ? 10 : 0;
  const hierarchy = site.ctas.length > 0 && site.ctas.length <= 8 ? 10 : 3;
  return clamp(ctaScore + forms + pricing + reassurance + contact + hierarchy);
}

export function scoreTechnical(site) {
  const pageCount = Math.max(1, site.pageCount);
  const title = 15 * (1 - site.missingTitles / pageCount);
  const meta = 15 * (1 - site.missingDescriptions / pageCount);
  const canonical = 10 * (1 - site.missingCanonicals / pageCount);
  const h1 = 15 * (1 - Math.min(pageCount, site.h1Missing + site.h1Multiple) / pageCount);
  const schema = site.schemaTypes.filter((x) => x !== "InvalidJSONLD").length ? 15 : 0;
  const image = site.imageCount ? 10 * (1 - site.imagesMissingAlt / site.imageCount) : 10;
  const security = 20 * (Object.values(site.securityHeaders).filter(Boolean).length / 4);
  return clamp(title + meta + canonical + h1 + schema + image + security);
}

export function scorePerformance(performance) {
  const mobile = performance?.mobile?.scores?.performance;
  const desktop = performance?.desktop?.scores?.performance;
  const avg = average([mobile, desktop]);
  return avg === null ? null : clamp(avg);
}

// ---------------------------------------------------------------------------
// PRYSM-NEXT-01 WP-D — v4 module scorers
//
// Every v4 scorer receives modelDeps = { site, performance, input,
// capabilities } and executes ONLY under capability-gated eligibility
// (checkModuleEligibility v2).  Inside an eligible module, false/empty
// values mean CONFIRMED ABSENCE — unknown evidence was filtered at the gate.
// ---------------------------------------------------------------------------

function businessServices(site, input) {
  const seen = new Set();
  const out = [];
  for (const s of [...(input?.services || []), ...(site?.services || [])]) {
    const key = String(s || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** v4 trust: same formula; eligibility gates unknown. */
function scoreTrustV4({ site }) {
  return scoreTrust(site);
}

/** v4 content: business-context services union (WP-D-05). */
function scoreContentV4({ site, input }) {
  const services = businessServices(site, input);
  const pages = Math.min(30, site.pageCount * 5);
  const depth = Math.min(25, site.averageWords / 20);
  const servicesPts = Math.min(20, services.length * 4);
  const education = (site.trust.faq ? 15 : 0) + (site.pageCount >= 5 ? 10 : 0);
  return clamp(pages + depth + servicesPts + education);
}

/**
 * v4.1 conversion: use site interactive evidence when it was actually
 * collected; otherwise use genuine browser-observed CTA/form readiness.
 * Browser-unassessed pages never contribute a negative score.
 *
 * Validated conversion.path evidence retains the existing bounded
 * bonus/obstruction adjustment.
 */
function scoreConversionV4({
  site,
  capabilities,
}) {
  const ctaCap =
    capabilities?.["conversion.cta"];

  const formCap =
    capabilities?.["conversion.form"];

  const ctaBrowser =
    ctaCap?.browserSummary;

  const formBrowser =
    formCap?.browserSummary;

  const ctaUsesSite =
    site._interactiveEvidenceAvailable !== false ||
    (
      Array.isArray(site.ctas) &&
      site.ctas.length > 0
    );

  const formUsesSite =
    site._interactiveEvidenceAvailable !== false ||
    (
      Array.isArray(site.forms) &&
      site.forms.length > 0
    );

  const ctaScore = ctaUsesSite
    ? Math.min(
        25,
        site.ctas.length * 5,
      )
    : ctaBrowser?.completed > 0
      ? 25 *
        (
          ctaBrowser.readyPages /
          ctaBrowser.completed
        )
      : 0;

  const formScore = formUsesSite
    ? (
        site.forms.length
          ? 20
          : 0
      )
    : (
        formBrowser?.completed > 0 &&
        formBrowser.readyPages > 0
          ? 20
          : 0
      );

  const pricing =
    site.trust.pricing
      ? 15
      : 0;

  const reassurance =
    (site.trust.policies ? 10 : 0) +
    (site.trust.testimonials ? 10 : 0);

  const contact =
    site.trust.contact
      ? 10
      : 0;

  // CTA-count hierarchy is score-bearing only when the site extractor
  // actually collected CTA cardinality. Browser validation confirms
  // readiness on selected pages but does not measure total CTA hierarchy.
  const hierarchy = ctaUsesSite
    ? (
        site.ctas.length > 0 &&
        site.ctas.length <= 8
          ? 10
          : 3
      )
    : 0;

  const base = clamp(
    ctaScore +
    formScore +
    pricing +
    reassurance +
    contact +
    hierarchy,
  );

  const pathCap =
    capabilities?.["conversion.path"];

  const summary =
    pathCap?.validationSummary;

  if (
    pathCap?.validated === true &&
    summary
  ) {
    const verified =
      (summary.pass ?? 0) +
      (summary.partial ?? 0);

    const bonus =
      Math.min(
        10,
        verified * 2,
      );

    const obstructionPenalty =
      (summary.obstructionCount ?? 0) > 0
        ? 10
        : 0;

    return clamp(
      base +
      bonus -
      obstructionPenalty,
    );
  }

  return base;
}

/** v4 offer clarity: business-context services union. */
function scoreOfferClarityV4({ site, input }) {
  const services = businessServices(site, input);
  const ctaClarity = Math.min(30, site.ctas.length * 6);
  const forms = site.forms.length ? 15 : 0;
  const pricing = site.trust.pricing ? 20 : 0;
  const servicesPts = Math.min(20, services.length * 4);
  // CRIT rescore #2 + evidence-audit item 2 — the descCoverage term
  // contributes only when the description counters were ACTUALLY collected
  // (adapter marker) and finite.
  const descKnown =
    site._metaCountersAvailable !== false &&
    (site._metaFieldAvailability?.descriptions ?? true) !== false &&
    typeof site.missingDescriptions === "number" &&
    Number.isFinite(site.missingDescriptions);
  const descCoverage =
    descKnown && site.pageCount
      ? 15 * (1 - site.missingDescriptions / site.pageCount)
      : 0;
  return clamp(ctaClarity + forms + pricing + servicesPts + descCoverage);
}

/** v4 risk reduction: same formula; eligibility gates unknown. */
/** v4 risk reduction: same formula; eligibility gates unknown. */
function scoreRiskReductionV4({
  site,
  capabilities,
}) {
  const policies =
    site.trust.policies
      ? 25
      : 0;

  const contact =
    site.trust.contact
      ? 20
      : 0;

  const headerCapability =
    capabilities?.[
      "technical.headers"
    ];

  const securityHeaders =
    headerCapability
      ?.observedHeaders &&
    typeof headerCapability
      .observedHeaders ===
      "object"
      ? headerCapability
          .observedHeaders
      : site.securityHeaders;

  const security =
    25 *
    (
      Object.values(
        securityHeaders || {},
      ).filter(Boolean).length /
      4
    );

  const https =
    site.targetUrl &&
    site.targetUrl.startsWith(
      "https:",
    )
      ? 15
      : 0;

  const faq =
    site.trust.faq
      ? 15
      : 0;

  return clamp(
    policies +
    contact +
    security +
    https +
    faq,
  );
}

/** v4 funnel coverage: business-context services union. */
function scoreFunnelCoverageV4({ site, input }) {
  const services = businessServices(site, input);
  const tofu = Math.min(30, site.pageCount * 4 + site.topicKeywords.length * 2);
  const mofu = (site.trust.faq ? 20 : 0) + (site.trust.caseStudies ? 15 : 0) +
    (services.length >= 3 ? 10 : 0);
  const bofu = (site.trust.pricing ? 20 : 0) + (site.trust.contact ? 10 : 0) +
    (site.forms.length ? 10 : 0) + Math.min(10, site.ctas.length * 2);
  return clamp(tofu + mofu + bofu);
}

/** v4 schema entity: same formula; eligibility gates unknown. */
function scoreSchemaEntityV4({ site }) {
  const validSchema = site.schemaTypes.filter((x) => x !== "InvalidJSONLD");
  const schemaCount = Math.min(40, validSchema.length * 10);
  const hasOrg = validSchema.some((t) => /organization|localbusiness/i.test(t)) ? 20 : 0;
  const hasFaq = validSchema.some((t) => /faq/i.test(t)) ? 15 : 0;
  const hasService = validSchema.some((t) => /service|product/i.test(t)) ? 15 : 0;
  const socialProof = site.socialLinks.length ? 10 : 0;
  return clamp(schemaCount + hasOrg + hasFaq + hasService + socialProof);
}

/**
 * v4 AI-readiness: STRUCTURAL machine-readability only (WP-D-07).
 * No floor for unknown evidence; schema points require the structured-data
 * capability to be AVAILABLE (not merely an empty array).
 */
function scoreAiReadinessV4({ site, capabilities }) {
  const schemaCap = capabilities?.["schema.structured_data"];
  const schemaAvailable = schemaCap?.status === "AVAILABLE" || schemaCap?.status === "PARTIAL";
  const schema = schemaAvailable && site.schemaTypes.length ? 25 : 0;
  const headings = site.pages?.[0]?.headings?.h1?.length ? 15 : 0;
  const faq = site.trust.faq ? 20 : 0;
  const depth = Math.min(20, site.pageCount * 3);
  const topics = site.topicKeywords.length >= 5 ? 20 : site.topicKeywords.length >= 3 ? 10 : 0;
  return clamp(schema + headings + faq + depth + topics);
}

/**
 * v4 technical hygiene: capability-partitioned sub-rules (WP-D-04).
 * Sub-rule weights are included ONLY when their capability evidence is
 * present; the module score is the weighted mean over INCLUDED sub-weights.
 * Returns { score, subWeightAssessed, subWeightTotal, subScores }.
 */
function scoreTechnicalV4({ site, capabilities }) {
  const pageCount = Math.max(1, site.pageCount);

  const subRules = [];

  // Meta rules — crawl pages evidence.  CRIT defect 4b + evidence-audit
  // item 2: unknown counters (null coerced at hydration) MUST NOT grant
  // credit — each TERM is included only from a finite collected counter,
  // and the sub-rule weight reflects exactly the known portion.
  const finiteNum = (v) => typeof v === "number" && Number.isFinite(v);
  // Per-field availability (CRIT rescore R1): each term requires ITS field
  // to have been collected.  Absent map ⇒ legacy extractor semantics.
  const fieldAvail = site._metaFieldAvailability || {};
  const fieldCollected = (field) => fieldAvail[field] !== false;
  {
    const metaTerms = [
      {
        weight: 15,
        known: fieldCollected("titles") && finiteNum(site.missingTitles),
        score: 15 * (1 - (site.missingTitles ?? 0) / pageCount),
      },
      {
        weight: 15,
        known: fieldCollected("descriptions") && finiteNum(site.missingDescriptions),
        score: 15 * (1 - (site.missingDescriptions ?? 0) / pageCount),
      },
      {
        weight: 10,
        known: fieldCollected("canonicals") && finiteNum(site.missingCanonicals),
        score: 10 * (1 - (site.missingCanonicals ?? 0) / pageCount),
      },
      {
        weight: 10,
        known:
          fieldCollected("headings") &&
          finiteNum(site.h1Missing) &&
          finiteNum(site.h1Multiple),
        score: 10 * (1 - Math.min(pageCount, (site.h1Missing ?? 0) + (site.h1Multiple ?? 0)) / pageCount),
      },
    ];
    const knownTerms = metaTerms.filter((t) => t.known);
    // Evidence-audit item 2: the frozen decision-evidence schema coerces
    // counters to integers, so the ADAPTER declares collection truth via
    // `_metaCountersAvailable`.  Legacy evidence (marker undefined) keeps
    // its historical semantics (extractor ran).
    const metaCollected = site._metaCountersAvailable !== false;
    if (metaCollected && knownTerms.length > 0) {
      // The meta sub-rule is worth 50 points on the 0-100 module scale.
      // Collected terms sum their points; the score is normalized to the
      // KNOWN portion's scale (perfect collected evidence = 50) and the
      // sub-rule weight is exactly the known portion.
      const weight = knownTerms.reduce((s, t) => s + t.weight, 0);
      const points = knownTerms.reduce((s, t) => s + t.score, 0);
      const score = clamp(points * (50 / weight));
      subRules.push({ key: "meta", weight, score });
    }
  }

  // Image rules — CRIT defect 4a: unknown image evidence (null counts)
  // MUST NOT grant 10/10; the sub-rule is excluded instead.
  const imageKnown =
    typeof site.imageCount === "number" &&
    Number.isFinite(site.imageCount) &&
    site.imageCount > 0 &&
    typeof site.imagesMissingAlt === "number" &&
    Number.isFinite(site.imagesMissingAlt);
  if (imageKnown) {
    const image = 10 * (1 - Math.min(1, site.imagesMissingAlt / site.imageCount));
    subRules.push({ key: "images", weight: 10, score: clamp(image) });
  }

  const capStatus = (key) => capabilities?.[key]?.status;

  // Indexability — technical.indexability capability.  CRIT rescore #1:
  // PARTIAL status (endpoint failures / flag-only fallback) with an empty
  // list must NOT grant full credit — the sub-rule requires collected
  // evidence (requiredFieldsPresent from the capability derivation).
  const indexabilityCap = capabilities?.["technical.indexability"];
  if (
    indexabilityCap?.status === "AVAILABLE" &&
    indexabilityCap?.requiredFieldsPresent === true
  ) {
    const count = (site.nonIndexablePages || []).length;
    const score = count === 0 ? 10 : count <= 2 ? 7 : count <= 5 ? 4 : 0;
    subRules.push({ key: "indexability", weight: 10, score });
  }

  // Redirects — technical.redirects capability.  Evidence-audit item 2:
  // PARTIAL status without collected evidence must not yield 10/10 from an
  // empty chain list — the sub-rule requires collected fields.
  const redirectsCap = capabilities?.["technical.redirects"];
  if (redirectsCap?.status === "AVAILABLE" && redirectsCap?.requiredFieldsPresent === true) {
    const chains = site.redirectChains || [];
    const maxHops = chains.reduce((m, c) => Math.max(m, c?.hops ?? 0), 0);
    const score = maxHops <= 1 ? 10 : maxHops === 2 ? 5 : 0;
    subRules.push({ key: "redirects", weight: 10, score });
  }

  // Resources — technical.resources capability.  CRIT rescore #1: null
  // total counters must NOT become full credit — the sub-rule requires at
  // least one page with a finite numeric totalResources.
  const resourcesCap = capabilities?.["technical.resources"];
  if (
    (resourcesCap?.status === "AVAILABLE" || resourcesCap?.status === "PARTIAL") &&
    (site.pageResources || []).some(
      (p) => typeof p?.totalResources === "number" && Number.isFinite(p.totalResources),
    )
  ) {
    const pages = site.pageResources || [];
    const total = pages.reduce(
      (s, p) => s + (typeof p?.totalResources === "number" ? p.totalResources : 0),
      0,
    );
    const broken = pages.reduce(
      (s, p) => s + (typeof p?.brokenResources === "number" ? p.brokenResources : 0),
      0,
    );
    const score = total > 0 ? Math.round(10 * (1 - Math.min(1, broken / total))) : 0;
    subRules.push({ key: "resources", weight: 10, score });
  }

  // Headers — technical.headers capability.
  if (
    capStatus(
      "technical.headers",
    ) === "AVAILABLE"
  ) {
    const headerCapability =
      capabilities?.[
        "technical.headers"
      ];

    const securityHeaders =
      headerCapability
        ?.observedHeaders &&
      typeof headerCapability
        .observedHeaders ===
        "object"
        ? headerCapability
            .observedHeaders
        : site.securityHeaders;

    const headersPresent =
      Object.values(
        securityHeaders || {},
      ).filter(Boolean).length;

    const score =
      Math.round(
        10 *
          (
            headersPresent /
            4
          ),
      );

    subRules.push({
      key: "headers",
      weight: 10,
      score,
    });
  }

  const totalWeight = subRules.reduce((s, r) => s + r.weight, 0);
  const weighted = subRules.reduce((s, r) => s + r.score * r.weight, 0);
  const score = totalWeight > 0 ? clamp(weighted / totalWeight) : null;

  return {
    score,
    subWeightAssessed: totalWeight,
    subWeightTotal: 100,
    subScores: subRules,
  };
}

// ---------------------------------------------------------------------------
// PRD §15.4 — Finding priority calculation
// ---------------------------------------------------------------------------

/**
 * PRYSM-V2-REPORT-DEPTH-01 — conversion-first ACTION priority.
 *
 * Raw Priority = Conversion Impact           × 0.40
 *              + Business Relevance          × 0.20
 *              + Gap Severity                × 0.15
 *              + Implementation Practicality × 0.15
 *              + Competitive Signal          × 0.10
 *
 * Final Priority = Raw Priority × Confidence Modifier   (UNCHANGED)
 *
 * This governs recommendation/action ordering only.  Conversion Readiness is
 * produced by the module scorers and DIMENSIONS weights, which are frozen and
 * untouched — no readiness score depends on this function.
 *
 * Superseded weighting (report design v1): 0.30 / 0.25 / 0.20 / 0.15 / 0.10.
 */
export function calculateFindingPriority(fields) {
  const conversionImpact = fields.conversionImpact ?? 50;
  const gapSeverity = fields.gapSeverity ?? 50;
  const businessRelevance = fields.businessRelevance ?? 50;
  const competitiveSignal = fields.competitiveSignal ?? 25;
  const implementationPracticality = fields.implementationPracticality ?? 50;

  const raw =
    conversionImpact * 0.40 +
    businessRelevance * 0.20 +
    gapSeverity * 0.15 +
    implementationPracticality * 0.15 +
    competitiveSignal * 0.10;

  const clampedRaw = clamp(raw, 0, 100);

  const confidence = fields.confidence || CONFIDENCE_LEVELS.DETERMINISTIC;
  const modifier = CONFIDENCE_MODIFIERS[confidence] ?? 0;

  const final = Math.round(clampedRaw * modifier);

  return { raw: clampedRaw, final, confidence, scoreBearing: final > 0 && confidence !== CONFIDENCE_LEVELS.INSUFFICIENT };
}

// ---------------------------------------------------------------------------
// PRD §16 — Deterministic finding ID
// ---------------------------------------------------------------------------

/**
 * Generate a stable, deterministic UUID-compatible identifier from:
 *  - ruleId
 *  - sorted affected URLs
 *  - normalized evidence array
 *
 * Identical inputs always produce identical IDs across runs.
 */
export function generateFindingId(ruleId, affectedUrls, evidenceRecords) {
  const normalized = {
    ruleId,
    urls: [...(affectedUrls || [])].sort(),
    evidence: (evidenceRecords || []).map((e) => ({
      provider: e.provider,
      sourceStatus: e.sourceStatus,
      field: e.field,
      observedValue: e.observedValue,
    })),
  };
  const hash = stableHash(JSON.stringify(normalized));
  // Format as UUID v4-style: xxxxxxxx-xxxx-4xxx-Vxxx-xxxxxxxxxxxx
  // where V is forced to [89ab] (UUID variant 10xx)
  const variantNibble = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${variantNibble}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// PRD §15.5 — Evidence confidence calculation
// ---------------------------------------------------------------------------

/**
 * Calculate evidence confidence from eight factors.
 *
 *  1. source availability   — are required sources present?
 *  2. data completeness      — did we get expected record counts?
 *  3. source validity        — did evidence pass envelope validation?
 *  4. data freshness         — is evidence recent enough?
 *  5. URL matching           — does evidence match the target?
 *  6. cross-source agreement — do independent sources corroborate?
 *  7. competitor relevance   — are competitor comparisons meaningful?
 *  8. rule certainty         — how certain are the rules applied?
 *
 * Returns 0–100.
 */
export function calculateEvidenceConfidence(evidence, findings, now = null) {
  const factors = {};

  // 1. Source availability (0–100)
  const sources = [
    { key: "site", required: true },
    { key: "performance", required: true },
    { key: "ga4", required: false },
    { key: "gsc", required: false },
    { key: "backlinks", required: false },
  ];
  let sourceScore = 0;
  let sourceCount = 0;
  for (const src of sources) {
    const ev = evidence[src.key];
    const status = ev?.sourceStatus;
    if (src.required) {
      sourceCount++;
      if (status === SOURCE_STATUS.AVAILABLE) sourceScore += 100;
      else if (status === SOURCE_STATUS.PARTIAL) sourceScore += 60;
      else sourceScore += 0;
    } else {
      // Optional sources contribute positively when available, don't penalize
      if (status === SOURCE_STATUS.AVAILABLE) {
        sourceCount++;
        sourceScore += 100;
      } else if (status === SOURCE_STATUS.PARTIAL) {
        sourceCount++;
        sourceScore += 60;
      }
      // NOT_CONNECTED / NOT_APPLICABLE = no contribution, no penalty
    }
  }
  factors.sourceAvailability = sourceCount
    ? Math.round(sourceScore / sourceCount)
    : 0;

  // 2. Data completeness (0–100; null when unknown — WP-D-12)
  const completenessScores = [];
  for (const src of sources) {
    const ev = evidence[src.key];
    if (!ev || !ev.coverage) continue;
    const cov = ev.coverage;
    if (cov.requested > 0) {
      completenessScores.push(Math.round((cov.completed / cov.requested) * 100));
    }
  }
  factors.dataCompleteness = completenessScores.length
    ? Math.round(completenessScores.reduce((a, b) => a + b, 0) / completenessScores.length)
    : null; // unknown — excluded from the weighted average

  // 3. Source validity (0–100)
  const validityScores = [];
  for (const src of sources) {
    const ev = evidence[src.key];
    if (!ev) continue;
    const status = ev.sourceStatus;
    if (status === SOURCE_STATUS.AVAILABLE) validityScores.push(100);
    else if (status === SOURCE_STATUS.PARTIAL) validityScores.push(70);
    else if (status === SOURCE_STATUS.NOT_CONNECTED || status === SOURCE_STATUS.NOT_APPLICABLE) {
      // Don't penalize — source wasn't expected to deliver
    } else {
      validityScores.push(0);
    }
  }
  // Only score sources that were expected to deliver
  if (validityScores.length === 0) {
    // All optional sources are not connected — validity is neutral
    const requiredValid = sources
      .filter((s) => s.required)
      .every((s) => {
        const st = evidence[s.key]?.sourceStatus;
        return st === SOURCE_STATUS.AVAILABLE || st === SOURCE_STATUS.PARTIAL;
      });
    factors.sourceValidity = requiredValid ? 100 : 0;
  } else {
    factors.sourceValidity = Math.round(
      validityScores.reduce((a, b) => a + b, 0) / validityScores.length,
    );
  }

  // 4. Data freshness (0–100)
  const scoringNow = now ? new Date(now).getTime() : Date.now();
  const freshnessScores = [];
  for (const src of sources) {
    const ev = evidence[src.key];
    const collectedAt = ev?.collectedAt;
    if (!collectedAt) continue;
    const ageMs = scoringNow - new Date(collectedAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    // 100% if < 1h old, 50% if 24h old, 0% if > 72h old
    if (ageHours < 1) freshnessScores.push(100);
    else if (ageHours < 24) freshnessScores.push(Math.round(100 - (ageHours - 1) * (50 / 23)));
    else if (ageHours < 72) freshnessScores.push(Math.round(50 - (ageHours - 24) * (50 / 48)));
    else freshnessScores.push(0);
  }
  factors.dataFreshness = freshnessScores.length
    ? Math.round(freshnessScores.reduce((a, b) => a + b, 0) / freshnessScores.length)
    : null; // unknown — excluded from the weighted average

  // 5. URL matching (0–100)
  // Evidence matches when crawl target equals the input URL domain
  const siteTarget = evidence.site?.targetUrl || evidence.site?.domain || "";
  factors.urlMatching = siteTarget ? 100 : null; // Present = match; missing = unknown

  // 6. Cross-source agreement (0–100)
  // When crawl and performance both available, agreement is higher
  const crawlOk = evidence.site?.sourceStatus === SOURCE_STATUS.AVAILABLE ||
    evidence.site?.sourceStatus === SOURCE_STATUS.PARTIAL;
  const perfOk = evidence.performance?.sourceStatus === SOURCE_STATUS.AVAILABLE ||
    evidence.performance?.sourceStatus === SOURCE_STATUS.PARTIAL;
  if (crawlOk && perfOk) factors.crossSourceAgreement = 100;
  else if (crawlOk || perfOk) factors.crossSourceAgreement = 60;
  else factors.crossSourceAgreement = 0;

  // 7. Competitor relevance (0–100)
  const competitors = evidence.competitors || [];
  const competitorAvailable = competitors.some(
    (c) => c.status === SOURCE_STATUS.AVAILABLE,
  );
  factors.competitorRelevance = competitorAvailable ? 100
    : competitors.length > 0 ? 40
    : 50; // neutral — user didn't supply any

  // 8. Rule certainty (0–100)
  // Based on finding confidence levels
  if (!findings || findings.length === 0) {
    factors.ruleCertainty = null; // unknown — excluded from the weighted average
  } else {
    const certaintyMap = {
      [CONFIDENCE_LEVELS.DETERMINISTIC]: 100,
      [CONFIDENCE_LEVELS.STRONGLY_SUPPORTED]: 85,
      [CONFIDENCE_LEVELS.SUPPORTED]: 65,
      [CONFIDENCE_LEVELS.DIRECTIONAL]: 40,
      [CONFIDENCE_LEVELS.INSUFFICIENT]: 0,
    };
    const certainties = findings.map(
      (f) => certaintyMap[f.confidence] ?? 50,
    );
    factors.ruleCertainty = Math.round(
      certainties.reduce((a, b) => a + b, 0) / certainties.length,
    );
  }

  // Weighted average of all factors
  const factorWeights = {
    sourceAvailability: 0.20,
    dataCompleteness: 0.15,
    sourceValidity: 0.15,
    dataFreshness: 0.10,
    urlMatching: 0.10,
    crossSourceAgreement: 0.10,
    competitorRelevance: 0.10,
    ruleCertainty: 0.10,
  };

  // WP-D-12 — no silent imputation: unknown factors (null) are excluded from
  // the weighted average and reported in factorAvailability.
  let totalWeight = 0;
  let weightedSum = 0;
  const factorAvailability = [];
  for (const [factor, weight] of Object.entries(factorWeights)) {
    const value = factors[factor];
    if (value === null || value === undefined) {
      factorAvailability.push({ factor, available: false });
      continue;
    }
    factorAvailability.push({ factor, available: true, weight });
    weightedSum += value * weight;
    totalWeight += weight;
  }

  // All factors unknown ⇒ neutral 50 with empty availability (no evidence to
  // prefer either direction).
  const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
  return { score: clamp(score), factors, factorAvailability };
}

// ---------------------------------------------------------------------------
// Module eligibility check (PRD §15.2)
// ---------------------------------------------------------------------------

/**
 * Determine if a module is eligible (PRYSM-NEXT-01 WP-D-02).
 *
 * Two-layer gate:
 *  1. source-level: every declared evidence source must be viable
 *     (AVAILABLE or PARTIAL) — unchanged semantics;
 *  2. capability-level: every `requiredCapabilities` entry must have status
 *     AVAILABLE or PARTIAL in the capability map.  Status derivation itself
 *     encodes whether required fields were collected (UNAVAILABLE ⇒ nothing
 *     usable collected; PARTIAL ⇒ some real fields exist), so unknown
 *     evidence can never make a module eligible.
 *
 * Returns { eligible, reason }.
 */
export function checkModuleEligibility(moduleDef, evidence, capabilities) {
  const reasons = [];

  for (const sourceKey of moduleDef.sources) {
    let sourceEvidence;
    switch (sourceKey) {
      case "crawl":
        sourceEvidence = evidence.site;
        break;
      case "performance":
        sourceEvidence = evidence.performance;
        break;
      case "ga4":
        sourceEvidence = evidence.ga4;
        break;
      case "backlinks":
        sourceEvidence = evidence.backlinks;
        break;
      case "competitors":
        sourceEvidence = { sourceStatus: evidence.competitors?.some((c) => c.status === SOURCE_STATUS.AVAILABLE) ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.NOT_CONNECTED };
        break;
      default:
        reasons.push(`Unknown source "${sourceKey}"`);
        continue;
    }

    if (!sourceEvidence) {
      reasons.push(`Source "${sourceKey}" is not configured`);
      continue;
    }

    const status = sourceEvidence.sourceStatus;
    if (status === SOURCE_STATUS.AVAILABLE || status === SOURCE_STATUS.PARTIAL) {
      // Gate passes
      continue;
    }

    reasons.push(
      `Source "${sourceKey}" status is ${status} — module suppressed`,
    );
  }

  for (const capKey of moduleDef.requiredCapabilities || []) {
    const cap = capabilities?.[capKey];
    if (!cap) {
      reasons.push(`Capability "${capKey}" not assessed — module suppressed`);
      continue;
    }
    const status = cap.status;
    if (status !== SOURCE_STATUS.AVAILABLE && status !== SOURCE_STATUS.PARTIAL) {
      reasons.push(
        `Capability "${capKey}" is ${status} — module suppressed`,
      );
    }
  }

  return {
    eligible: reasons.length === 0,
    reason: reasons.length ? reasons.join("; ") : null,
  };
}

// ---------------------------------------------------------------------------
// PRD §16 — Finding contract builder
// ---------------------------------------------------------------------------

// Rule ID registry
const RULE_PREFIX = "VAN";
const RULE_VERSION = SCORING_VERSION;

/**
 * Build findings compliant with PRD v3.0 §16.
 *
 * Each finding includes:
 *  - findingId (deterministic UUID)
 *  - ruleId, ruleVersion
 *  - dimension, module
 *  - title, affectedUrls
 *  - evidence array (provider, sourceStatus, field, observedValue, artifactRef)
 *  - confidence
 *  - businessImpact, recommendation, implementationEffort, verificationMethod
 *  - scoreBearing
 *  - rawPriority, finalPriority
 */
export function buildFindings(site, performance, gsc, opts = {}) {
  const findings = [];
  const capabilities = opts.capabilities || {};
  const suppressedReasons = opts.suppressedReasons || [];

  // PRYSM-NEXT-01 WP-D-11 — capability-gated findings.  When body content
  // was not collected (DataForSEO pages endpoint returns metadata only),
  // content-dependent findings MUST be suppressed because false/empty/null
  // values represent "not available" rather than "confirmed absent"
  // (PRD v3.0 §8.6).  Capability statuses come from the WP-C layer —
  // unknown is never treated as confirmed absence.
  const capOk = (key) => {
    const status = capabilities[key]?.status;
    return status === SOURCE_STATUS.AVAILABLE || status === SOURCE_STATUS.PARTIAL;
  };

  const add = (opts) => {
    // Capability gate: when the finding's evidence capability is not
    // available, record the suppression and never emit the finding.
    if (opts.requires) {
      if (!capOk(opts.requires)) {
        suppressedReasons.push({
          ruleId: opts.ruleId,
          title: opts.title,
          capability: opts.requires,
          capabilityStatus: capabilities[opts.requires]?.status ?? "NOT_ASSESSED",
        });
        return;
      }
    }

    const evidenceRecords = (opts.evidence || []).map((er) => ({
      provider: er.provider || "dataforseo_onpage",
      sourceStatus:
        (er.provider || "dataforseo_onpage") === "dataforseo_onpage"
          ? site?.sourceStatus
          : er.sourceStatus,
      field: er.field,
      observedValue: er.observedValue ?? null,
      artifactRef: er.artifactRef || site.rawArtifactRef || null,
    }));

    if (evidenceRecords.some((er) => !isValidSourceStatus(er.sourceStatus))) {
      return;
    }

    // Enforce: no finding without evidence (PRD §16)
    if (!evidenceRecords.length) return;

    const affectedUrls = (opts.affectedUrls && opts.affectedUrls.length > 0)
      ? opts.affectedUrls
      : [site.targetUrl || site.domain || "https://unknown"].filter(Boolean);

    const findingId = generateFindingId(
      opts.ruleId,
      affectedUrls,
      evidenceRecords,
    );

    const confidence = opts.confidence || CONFIDENCE_LEVELS.DETERMINISTIC;

    const priority = calculateFindingPriority({
      conversionImpact: opts.conversionImpact ?? _defaultImpact(opts.severity),
      gapSeverity: opts.gapSeverity ?? _defaultGapSeverity(opts.severity),
      businessRelevance: opts.businessRelevance ?? 50,
      competitiveSignal: opts.competitiveSignal ?? 25,
      implementationPracticality: opts.implementationPracticality ?? _defaultPracticality(opts.effort),
      confidence,
    });

    const businessImpact = governBusinessImpact(
  opts.businessImpact || opts.impact || "",
  {
    label: `Finding ${opts.ruleId} businessImpact`,
    basis: opts.businessImpactBasis || BUSINESS_IMPACT_BASIS.INFERRED,
  },
);
    findings.push({
      contractVersion: "1.0.0",
      findingId,
      ruleId: opts.ruleId,
      ruleVersion: RULE_VERSION,
      dimension: opts.dimension,
      module: opts.module,
      title: opts.title,
      affectedUrls,
      evidence: evidenceRecords,
      confidence,
      businessImpact,
      recommendation: opts.recommendation || opts.fix || "",
      implementationEffort: opts.effort || "M",
      verificationMethod: opts.verificationMethod || "Re-audit after changes are applied.",
      scoreBearing: priority.scoreBearing,
      rawPriority: priority.raw,
      finalPriority: priority.final,
      severity: opts.severity,
      // Display compatibility aliases — the renderer uses problem/impact/fix/effort
      // as display keys.  These replicate the canonical fields.
      problem: opts.title,
      impact: businessImpact,
      fix: opts.recommendation || opts.fix || "",
      effort: opts.effort || "M",
      key: opts.key || "",
      evidenceText: opts.evidenceText || "",
    });
  };

  // Helper: detect trust-proof severity
  const trustProofConfidence =
    !site.trust.testimonials && !site.trust.caseStudies && !site.trust.credentials
      ? CONFIDENCE_LEVELS.DETERMINISTIC
      : site.trust.testimonials || site.trust.credentials
        ? CONFIDENCE_LEVELS.STRONGLY_SUPPORTED
        : CONFIDENCE_LEVELS.SUPPORTED;

  // ── Crawl-dependent findings ──────────────────────────────────────

  if (!site.trust.testimonials && !site.trust.caseStudies && !site.trust.credentials) {
    add({
      ruleId: "VAN-TRUST-001",
      requires: "trust.proof",
      dimension: "trust_eeat",
      module: "trust_signals",
      title: "No visible trust proof",
      severity: "High",
      key: "trust",
      confidence: trustProofConfidence,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "trust.testimonials", observedValue: false },
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "trust.credentials", observedValue: false },
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "trust.caseStudies", observedValue: false },
      ],
      evidenceText: "No testimonials, case studies, or credentials detected",
      businessImpact: "Limited visible trust proof may make credibility harder for visitors to verify before deciding.",
      recommendation: "Add credentials, client proof, and outcome-based case studies",
      effort: "M",
      conversionImpact: 85,
      gapSeverity: 80,
      businessRelevance: 90,
      competitiveSignal: 40,
      implementationPracticality: 50,
      verificationMethod: "Re-crawl and confirm trust signals are detected on key pages.",
    });
  }

  if (site.missingDescriptions) {
    add({
      ruleId: "VAN-TECH-001",
      dimension: "technical_performance",
      module: "technical_hygiene",
      title: "Missing meta descriptions",
      severity: "High",
      key: "meta",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      affectedUrls: site.pages?.filter((p) => !p.description).map((p) => p.url).slice(0, 10) || [site.targetUrl],
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "meta_description", observedValue: null },
      ],
      evidenceText: `${site.missingDescriptions} of ${site.pageCount} crawled pages`,
      businessImpact: "Missing meta descriptions may reduce control over search-result messaging for these pages.",
      recommendation: "Write a unique 150–160 character description for each important page",
      effort: "L",
      conversionImpact: 75,
      gapSeverity: 70,
      businessRelevance: 80,
      competitiveSignal: 60,
      implementationPracticality: 90,
      verificationMethod: "Re-crawl the URLs and confirm descriptions are present.",
    });
  }

  if (!site.schemaTypes.length) {
    add({
      ruleId: "VAN-SCHEMA-001",
      requires: "schema.structured_data",
      dimension: "entity_schema_ai",
      module: "schema_entity",
      title: "No structured data detected",
      severity: "High",
      key: "schema",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "schema_types", observedValue: [] },
      ],
      evidenceText: "No JSON-LD schema types found",
      businessImpact: "Missing structured data may provide search and AI systems with less explicit entity context.",
      recommendation: "Add Organization or LocalBusiness, Person, Service, and FAQ schema where supported",
      effort: "M",
      conversionImpact: 60,
      gapSeverity: 65,
      businessRelevance: 70,
      competitiveSignal: 55,
      implementationPracticality: 60,
      verificationMethod: "Re-crawl and validate structured data with Google's Rich Results Test.",
    });
  }

  // ── Performance-dependent findings ────────────────────────────────
  const lcp = performance?.mobile?.metrics?.lcpMs;
  if (Number.isFinite(lcp) && lcp > 4000) {
    add({
      ruleId: "VAN-PERF-001",
      dimension: "technical_performance",
      module: "performance",
      title: "Mobile largest contentful paint is slow",
      severity: "High",
      key: "lcp",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        {
          provider: performance?.mobile?.source || "pagespeed-insights",
          sourceStatus: performance?.mobile?.status ?? performance?.sourceStatus,
          field: "lcp_ms",
          observedValue: lcp,
          artifactRef: null,
        },
      ],
      evidenceText: `${(lcp / 1000).toFixed(1)} seconds`,
      businessImpact: "Slow LCP may create friction for mobile visitors.",
      recommendation: "Optimize the largest above-the-fold asset and remove render-blocking work",
      effort: "M",
      conversionImpact: 80,
      gapSeverity: 75,
      businessRelevance: 85,
      competitiveSignal: 50,
      implementationPracticality: 55,
      verificationMethod: "Re-run PageSpeed Insights and confirm LCP is under 2.5 seconds.",
    });
  }

  // ── Additional crawl-dependent findings ──────────────────────────

  if (site.pageCount <= 1 || site.services.length > site.pageCount * 2) {
    add({
      ruleId: "VAN-CONTENT-001",
      dimension: "content_funnel",
      module: "content_depth",
      title: "Services lack dedicated page depth",
      severity: "Medium",
      key: "pages",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "page_count", observedValue: site.pageCount },
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "services", observedValue: site.services.length },
      ],
      evidenceText: `${site.pageCount} crawlable page(s) for ${site.services.length || "multiple"} service topics`,
      businessImpact: "Limited dedicated page depth may make it harder for individual offers to build relevance and answer buyer questions.",
      recommendation: "Create one focused page for each primary service",
      effort: "H",
      conversionImpact: 70,
      gapSeverity: 60,
      businessRelevance: 75,
      competitiveSignal: 45,
      implementationPracticality: 30,
      verificationMethod: "Re-crawl and confirm each primary service has a dedicated page.",
    });
  }

  if (site.h1Missing || site.h1Multiple) {
    add({
      ruleId: "VAN-TECH-002",
      dimension: "technical_performance",
      module: "technical_hygiene",
      title: "Heading structure is inconsistent",
      severity: "Medium",
      key: "headings",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "h1_missing", observedValue: site.h1Missing },
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "h1_multiple", observedValue: site.h1Multiple },
      ],
      evidenceText: `${site.h1Missing} pages missing H1; ${site.h1Multiple} pages with multiple H1s`,
      businessImpact: "Inconsistent heading structure may reduce semantic clarity and accessibility.",
      recommendation: "Use one descriptive H1 per page with sequential H2 and H3 sections",
      effort: "M",
      conversionImpact: 50,
      gapSeverity: 55,
      businessRelevance: 60,
      competitiveSignal: 30,
      implementationPracticality: 70,
      verificationMethod: "Re-crawl and verify heading structure on all pages.",
    });
  }

  const headerCapability =
    capabilities[
      "technical.headers"
    ];

  const securityHeaderEvidence =
    headerCapability
      ?.observedHeaders &&
    typeof headerCapability
      .observedHeaders === "object"
      ? headerCapability
          .observedHeaders
      : site.securityHeaders;

  const missingSecurity =
    Object.entries(
      securityHeaderEvidence || {},
    )
      .filter(
        ([, present]) =>
          present === false,
      )
      .map(([name]) => name);

  if (missingSecurity.length) {
    const browserHeaderEvidence =
      headerCapability
        ?.observedHeaders &&
      typeof headerCapability
        .observedHeaders ===
        "object";

    add({
      ruleId: "VAN-TECH-003",
      requires: "technical.headers",
      dimension:
        "technical_performance",
      module:
        "technical_hygiene",
      title:
        "Security headers are incomplete",
      severity: "Medium",
      key: "security",
      confidence:
        CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        {
          provider:
            browserHeaderEvidence
              ? (
                  headerCapability
                    .validatedBy ||
                  "playwright-conversion-path"
                )
              : "dataforseo_onpage",

          sourceStatus:
            browserHeaderEvidence
              ? headerCapability.status
              : SOURCE_STATUS.AVAILABLE,

          field:
            "security_headers",

          observedValue:
            missingSecurity.join(", "),
        },
      ],
      evidenceText:
        missingSecurity.join(", "),
      businessImpact:
        "Missing browser protections may weaken technical trust.",
      recommendation:
        "Configure the missing response headers at the hosting layer",
      effort: "L",
      conversionImpact: 35,
      gapSeverity: 45,
      businessRelevance: 50,
      competitiveSignal: 25,
      implementationPracticality: 75,
      verificationMethod:
        "Re-crawl and confirm security headers are present in response.",
    });
  }

  if (!site.trust.faq) {
    add({
      ruleId: "VAN-CONTENT-002",
      requires: "trust.proof",
      dimension: "content_funnel",
      module: "funnel_coverage",
      title: "No buyer-question content detected",
      severity: "Medium",
      key: "faq",
      confidence: CONFIDENCE_LEVELS.SUPPORTED,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "trust.faq", observedValue: false },
      ],
      evidenceText: "No FAQ or common-question section found",
      businessImpact: "Missing buyer-question content may leave common objections unresolved before a visitor acts.",
      recommendation: "Add an FAQ based on the questions prospects ask before booking",
      effort: "M",
      conversionImpact: 55,
      gapSeverity: 45,
      businessRelevance: 60,
      competitiveSignal: 35,
      implementationPracticality: 65,
      verificationMethod: "Re-crawl and confirm FAQ content is present with structured data where applicable.",
    });
  }

  if (!site.trust.pricing) {
    add({
      ruleId: "VAN-TRUST-002",
      requires: "trust.proof",
      dimension: "trust_eeat",
      module: "risk_reduction",
      title: "Pricing or investment context is absent",
      severity: "Medium",
      key: "pricing",
      confidence: CONFIDENCE_LEVELS.STRONGLY_SUPPORTED,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "trust.pricing", observedValue: false },
      ],
      evidenceText: "No pricing, cost, fee, or investment language detected",
      businessImpact: "Missing pricing context may leave commitment expectations unclear before contact.",
      recommendation: "State pricing, starting price, or the process used to determine cost",
      effort: "L",
      conversionImpact: 65,
      gapSeverity: 55,
      businessRelevance: 70,
      competitiveSignal: 50,
      implementationPracticality: 80,
      verificationMethod: "Re-crawl and confirm pricing information is visible on relevant pages.",
    });
  }

  // ── PRYSM-NEXT-01 WP-E — validated-path findings ────────────────────
  const pathValidation = capabilities["conversion.path"]?.validationSummary;
  if (pathValidation && (pathValidation.obstructionCount ?? 0) > 0) {
    add({
      ruleId: "VAN-PATH-001",
      dimension: "conversion_pathways",
      module: "conversion_paths",
      title: "Primary conversion action is obstructed",
      severity: "High",
      key: "path_obstruction",
      confidence: CONFIDENCE_LEVELS.STRONGLY_SUPPORTED,
      evidence: [
        {
          provider: "playwright-conversion-path",
          sourceStatus: capabilities["conversion.path"]?.status,
          field: "conversion.path.obstruction",
          observedValue: pathValidation.obstructionCount,
          artifactRef: null,
        },
      ],
      evidenceText: `${pathValidation.obstructionCount} browser-validated page(s) have an obstructed CTA`,
      businessImpact: "Browser validation found the primary action obstructed on tested pages.",
      businessImpactBasis: BUSINESS_IMPACT_BASIS.OBSERVED,
      recommendation: "Remove or reposition overlays, cookie banners, or stacked elements covering the primary CTA",
      effort: "M",
      conversionImpact: 90,
      gapSeverity: 80,
      businessRelevance: 85,
      competitiveSignal: 40,
      implementationPracticality: 60,
      verificationMethod: "Re-run conversion-path validation and confirm no obstruction is detected.",
    });
  }

  const imageAltEvidenceKnown =
    site._metaCountersAvailable !== false &&
    Number.isFinite(site.imageCount) &&
    site.imageCount > 0 &&
    Number.isFinite(site.imagesMissingAlt);

  if (imageAltEvidenceKnown && site.imagesMissingAlt > 0) {
    add({
      ruleId: "VAN-TECH-004",
      dimension: "technical_performance",
      module: "technical_hygiene",
      title: "Images are missing alternative text",
      severity: "Low",
      key: "alt",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "images_missing_alt", observedValue: site.imagesMissingAlt },
      ],
      evidenceText: `${site.imagesMissingAlt} of ${site.imageCount} images`,
      businessImpact: "Missing alternative text may reduce accessibility and image understanding.",
      recommendation: "Add concise descriptive alt text to meaningful images",
      effort: "L",
      conversionImpact: 20,
      gapSeverity: 30,
      businessRelevance: 25,
      competitiveSignal: 15,
      implementationPracticality: 85,
      verificationMethod: "Re-crawl and verify alt text on all images.",
    });
  }

  if (site.imagesMissingDimensions) {
    add({
      ruleId: "VAN-TECH-005",
      dimension: "technical_performance",
      module: "technical_hygiene",
      title: "Images lack explicit dimensions",
      severity: "Low",
      key: "dimensions",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "images_missing_dimensions", observedValue: site.imagesMissingDimensions },
      ],
      evidenceText: `${site.imagesMissingDimensions} of ${site.imageCount} images`,
      businessImpact: "Missing explicit image dimensions may increase the risk of visual instability.",
      recommendation: "Set width and height on rendered images",
      effort: "L",
      conversionImpact: 15,
      gapSeverity: 20,
      businessRelevance: 20,
      competitiveSignal: 10,
      implementationPracticality: 90,
      verificationMethod: "Re-crawl and verify image dimensions on all images.",
    });
  }

  // ── GSC-dependent findings ──────────────────────────────────────────
  if (gsc && gsc.sourceStatus === SOURCE_STATUS.AVAILABLE) {
    const gscThreshold = gsc.sufficiency?.threshold || 100;
    const sufficient = gsc.sufficiency?.sufficient !== false;

    // High-opportunity queries with low CTR may indicate title/snippet issues
    const lowCtrQueries = (gsc.rows || [])
      .filter((r) => r.impressions >= 50 && r.ctr < 0.03)
      .slice(0, 5);
    if (lowCtrQueries.length > 0) {
      add({
        ruleId: "VAN-GSC-001",
        dimension: "content_funnel",
        module: "funnel_coverage",
        title: "Search queries have low click-through rate",
        severity: "Medium",
        key: "gsc_ctr",
        confidence: sufficient ? CONFIDENCE_LEVELS.STRONGLY_SUPPORTED : CONFIDENCE_LEVELS.DIRECTIONAL,
        affectedUrls: lowCtrQueries.map((r) => r.page).filter(Boolean).slice(0, 10),
        evidence: lowCtrQueries.map((r) => ({
          provider: "google-search-console",
          sourceStatus: SOURCE_STATUS.AVAILABLE,
          field: `query:${r.query}`,
          observedValue: `CTR ${(r.ctr * 100).toFixed(1)}%, ${r.impressions} impressions`,
          artifactRef: null,
        })),
        evidenceText: `${lowCtrQueries.length} queries below 3% CTR with at least 50 impressions each`,
        businessImpact: "The measured queries have search visibility but a low observed click-through rate.",
businessImpactBasis: BUSINESS_IMPACT_BASIS.OBSERVED,
        recommendation: "Review low-CTR queries and improve titles and meta descriptions to match search intent",
        effort: "M",
        conversionImpact: 55,
        gapSeverity: 50,
        businessRelevance: 60,
        competitiveSignal: 45,
        implementationPracticality: 65,
        verificationMethod: "Compare CTR changes in GSC 28 days after title/meta updates are applied.",
      });
    }

    // High-impression queries with high average position (>10) may indicate ranking gaps
    const positionGapQueries = (gsc.rows || [])
      .filter((r) => r.impressions >= 100 && r.position > 10)
      .slice(0, 5);
    if (positionGapQueries.length > 0) {
      add({
        ruleId: "VAN-GSC-002",
        dimension: "content_funnel",
        module: "content_depth",
        title: "Search queries rank below page one",
        severity: "Medium",
        key: "gsc_position",
        confidence: sufficient ? CONFIDENCE_LEVELS.SUPPORTED : CONFIDENCE_LEVELS.DIRECTIONAL,
        affectedUrls: positionGapQueries.map((r) => r.page).filter(Boolean).slice(0, 10),
        evidence: positionGapQueries.map((r) => ({
          provider: "google-search-console",
          sourceStatus: SOURCE_STATUS.AVAILABLE,
          field: `query:${r.query}`,
          observedValue: `Position ${r.position.toFixed(1)}, ${r.impressions} impressions`,
          artifactRef: null,
        })),
        evidenceText: `${positionGapQueries.length} queries with position > 10 and >= ${gscThreshold} impressions each`,
        businessImpact: "Lower observed positions may indicate that content does not yet compete strongly enough for page-one visibility on these terms.",
        businessImpactBasis: BUSINESS_IMPACT_BASIS.OBSERVED,
        recommendation: "Expand content depth for these query topics and improve internal linking to supporting pages",
        effort: "H",
        conversionImpact: 50,
        gapSeverity: 45,
        businessRelevance: 55,
        competitiveSignal: 50,
        implementationPracticality: 30,
        verificationMethod: "Monitor position changes in GSC 28 days after content improvements are published.",
      });
    }

    // Topic demand insight (informational, not scored)
    if ((gsc.topQueries || []).length > 0 && sufficient) {
      add({
        ruleId: "VAN-GSC-003",
        dimension: "content_funnel",
        module: "content_depth",
        title: "Search demand exceeds visible content depth",
        severity: "Low",
        key: "gsc_demand",
        confidence: CONFIDENCE_LEVELS.DIRECTIONAL,
        evidence: [
          {
            provider: "google-search-console",
            sourceStatus: SOURCE_STATUS.AVAILABLE,
            field: "search_demand",
            observedValue: `${gsc.totals.impressions || 0} total impressions across ${(gsc.topQueries || []).length} queries`,
            artifactRef: null,
          },
        ],
        evidenceText: `${(gsc.topQueries || []).length} search queries generating impressions without dedicated content`,
        businessImpact: "Observed search demand may indicate opportunities for dedicated landing pages around these topics.",
        recommendation: "Create content targeted at high-impression, low-position queries",
        effort: "H",
        conversionImpact: 40,
        gapSeverity: 40,
        businessRelevance: 50,
        competitiveSignal: 35,
        implementationPracticality: 25,
        verificationMethod: "Re-run GSC collection after new content is published and indexed.",
      });
    }
  }

  // Sort by final priority descending, then by severity rank
  return findings.sort((a, b) => {
    if (b.finalPriority !== a.finalPriority) return b.finalPriority - a.finalPriority;
    return (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0);
  });
}

// ---------------------------------------------------------------------------
// Default priority inputs (fallback when not explicitly provided)
// ---------------------------------------------------------------------------

function _defaultImpact(severity) {
  if (severity === "High") return 75;
  if (severity === "Medium") return 50;
  return 25;
}

function _defaultGapSeverity(severity) {
  if (severity === "High") return 70;
  if (severity === "Medium") return 45;
  return 20;
}

function _defaultPracticality(effort) {
  if (effort === "L") return 85;
  if (effort === "M") return 55;
  return 30; // "H"
}

// ---------------------------------------------------------------------------
// Rendering-diagnostic findings builder
// ---------------------------------------------------------------------------

/**
 * Convert rendering-integrity diagnostic records into the standard finding
 * shape for inclusion in Priority Fixes.
 *
 * Only material client-visible SITE_RENDERING defects with confidence >= 0.6
 * are converted. Provider and infrastructure failures are excluded from
 * Priority Fixes but appear in the Evidence Appendix.
 *
 * All diagnostic findings are `scoreBearing: false`.
 */
export function buildRenderingDiagnosticFindings(diagnostics, site) {
  if (!diagnostics || !Array.isArray(diagnostics)) return [];

  const findings = [];
  const materialCodes = new Set([
    "NO_FCP", "NO_LCP", "PAGE_BLANK", "INCOMPLETE_ABOVE_FOLD",
    "MEDIA_FAILED", "LOADING_SCREEN_STUCK", "JS_EXECUTION_FAILURE",
    "REDIRECT_LOOP", "AUTH_WALL", "ACCESS_BLOCKED", "HTTP_ERROR_PAGE",
    "UNSUPPORTED_CONTENT", "NULL_PERF_HTTP200",
  ]);

  for (const d of diagnostics) {
    // Only material rendering defects, not provider/infrastructure failures
    if (d.diagnosticCategory !== "SITE_RENDERING") continue;
    if (!materialCodes.has(d.diagnosticCode)) continue;
    if (d.confidence < 0.60) continue;

    const severity =
      d.diagnosticCode === "PAGE_BLANK" || d.diagnosticCode === "JS_EXECUTION_FAILURE" ? "High"
      : d.diagnosticCode === "NO_LCP" || d.diagnosticCode === "NO_FCP" || d.diagnosticCode === "MEDIA_FAILED" ? "Medium"
      : "Medium";

    const ruleId = _diagnosticRuleId(d.diagnosticCode);
    const priority = calculateFindingPriority({
      conversionImpact: _diagImpact(severity),
      gapSeverity: _diagGapSeverity(severity),
      businessRelevance: 60,
      competitiveSignal: 20,
      implementationPracticality: 40,
      confidence: CONFIDENCE_LEVELS.SUPPORTED,
    });

    const affectedUrls = d.affectedUrl
      ? [d.affectedUrl]
      : ([site?.targetUrl || site?.domain || "https://unknown"].filter(Boolean));
        if (!isValidSourceStatus(d.providerStatus)) continue;

    const evidenceRecords = [
      { provider: d.provider || "pagespeed-insights", sourceStatus: d.providerStatus, field: "diagnostic", observedValue: d.diagnosticCode, artifactRef: null },
    ];

    findings.push({
      contractVersion: "1.0.0",
      findingId: generateFindingId(ruleId, affectedUrls, evidenceRecords),
      ruleId,
      ruleVersion: "1.0.0",
      dimension: "technical_performance",
      module: "performance",
      title: `Rendering issue detected: ${d.clientExplanation.slice(0, 120)}`,
      affectedUrls,
      evidence: evidenceRecords,
      confidence: CONFIDENCE_LEVELS.SUPPORTED,
      businessImpact: d.businessImpact || "Page rendering issues affect visitor experience and conversion capability.",
      recommendation: d.recommendation || "Investigate the rendering failure using the diagnostic evidence and re-test.",
      implementationEffort: "M",
      verificationMethod: d.verificationMethod || "Re-run performance testing and confirm rendering succeeds.",
      scoreBearing: false,
      rawPriority: priority.raw,
      finalPriority: priority.final,
      severity,
      problem: `Rendering issue: ${d.diagnosticCode}`,
      impact: d.businessImpact || "",
      fix: d.recommendation || "",
      effort: "M",
      key: "rendering",
      evidenceText: d.clientExplanation?.slice(0, 200) || "",
    });
  }

  return findings;
}

function _diagnosticRuleId(code) {
  const map = {
    NO_FCP: "VAN-DIAG-001",
    NO_LCP: "VAN-DIAG-002",
    PAGE_BLANK: "VAN-DIAG-003",
    INCOMPLETE_ABOVE_FOLD: "VAN-DIAG-004",
    MEDIA_FAILED: "VAN-DIAG-005",
    LOADING_SCREEN_STUCK: "VAN-DIAG-006",
    JS_EXECUTION_FAILURE: "VAN-DIAG-007",
    REDIRECT_LOOP: "VAN-DIAG-008",
    AUTH_WALL: "VAN-DIAG-009",
    ACCESS_BLOCKED: "VAN-DIAG-010",
    HTTP_ERROR_PAGE: "VAN-DIAG-011",
    UNSUPPORTED_CONTENT: "VAN-DIAG-012",
    NULL_PERF_HTTP200: "VAN-DIAG-013",
  };
  return map[code] || "VAN-DIAG-000";
}

function _diagImpact(severity) {
  if (severity === "High") return 75;
  if (severity === "Medium") return 50;
  return 25;
}

function _diagGapSeverity(severity) {
  if (severity === "High") return 70;
  if (severity === "Medium") return 40;
  return 20;
}

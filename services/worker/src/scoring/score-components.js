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

function capabilityUsable(
  capabilities,
  key,
) {
  const cap =
    capabilities?.[key];

  return (
    (
      cap?.status ===
        SOURCE_STATUS.AVAILABLE ||
      cap?.status ===
        SOURCE_STATUS.PARTIAL
    ) &&
    cap?.requiredFieldsPresent !==
      false
  );
}

/**
 * Score only terms that were actually assessed.
 *
 * Full evidence preserves the historical formula exactly. When a term is
 * governed by an unavailable capability, its maximum points are excluded
 * rather than becoming an implicit zero. subWeightAssessed/subWeightTotal
 * carries that incomplete assessment downstream for PF-01.
 */
function scoreAssessedTerms(
  terms,
) {
  const totalMax =
    terms.reduce(
      (sum, term) =>
        sum +
        term.max,
      0,
    );

  const assessed =
    terms.filter(
      (term) =>
        term.assessed !== false,
    );

  const assessedMax =
    assessed.reduce(
      (sum, term) =>
        sum +
        term.max,
      0,
    );

  if (assessedMax <= 0) {
    return {
      score: null,
      subWeightAssessed: 0,
      subWeightTotal:
        totalMax,
      subScores: [],
    };
  }

  const points =
    assessed.reduce(
      (sum, term) =>
        sum +
        clamp(
          term.points,
          0,
          term.max,
        ),
      0,
    );

  const score =
    clamp(
      points *
        (
          totalMax /
          assessedMax
        ),
    );

  return {
    score,
    subWeightAssessed:
      assessedMax,
    subWeightTotal:
      totalMax,
    subScores:
      assessed.map(
        (term) => ({
          key: term.key,
          weight: term.max,
          score: clamp(
            term.points,
            0,
            term.max,
          ),
        }),
      ),
  };
}

function interactiveAssessment(
  site,
  capabilities,
  capabilityKey,
  field,
) {
  const cap =
    capabilities?.[
      capabilityKey
    ];

  if (
    !capabilityUsable(
      capabilities,
      capabilityKey,
    )
  ) {
    return {
      assessed: false,
      usesSite: false,
      present: false,
      browserSummary: null,
    };
  }

  const values =
    Array.isArray(
      site?.[field],
    )
      ? site[field]
      : [];

  const siteAssessed =
    site
      ?._interactiveEvidenceAvailable !==
      false ||
    values.length > 0;

  if (siteAssessed) {
    return {
      assessed: true,
      usesSite: true,
      present:
        values.length > 0,
      browserSummary: null,
    };
  }

  const browserSummary =
    cap?.browserSummary;

  if (
    browserSummary &&
    browserSummary.completed > 0
  ) {
    return {
      assessed: true,
      usesSite: false,
      present:
        (
          browserSummary
            .presentPages ??
          0
        ) > 0,
      browserSummary,
    };
  }

  return {
    assessed: false,
    usesSite: false,
    present: false,
    browserSummary: null,
  };
}

/** v4 trust: trust.proof governs the score-bearing signals. */
function scoreTrustV4({
  site,
}) {
  return scoreTrust(site);
}

/** v4 content: business-context services union (WP-D-05). */
function scoreContentV4({
  site,
  input,
  capabilities,
}) {
  const services =
    businessServices(
      site,
      input,
    );

  const trustAssessed =
    capabilityUsable(
      capabilities,
      "trust.proof",
    );

  return scoreAssessedTerms([
    {
      key: "pages",
      max: 30,
      points:
        Math.min(
          30,
          site.pageCount * 5,
        ),
    },
    {
      key: "depth",
      max: 25,
      points:
        Math.min(
          25,
          site.averageWords /
            20,
        ),
    },
    {
      key: "services",
      max: 20,
      points:
        Math.min(
          20,
          services.length * 4,
        ),
    },
    {
      key: "faq",
      max: 15,
      assessed:
        trustAssessed,
      points:
        site.trust.faq
          ? 15
          : 0,
    },
    {
      key: "page_depth",
      max: 10,
      points:
        site.pageCount >= 5
          ? 10
          : 0,
    },
  ]);
}

/**
 * v4.1 conversion.
 *
 * CTA/form values are scored only from their governing capabilities.
 * Trust/pricing/reassurance values are scored only when trust.proof was
 * assessed. Unknown cross-capability fields are excluded, never zeroed.
 */
function scoreConversionV4({
  site,
  capabilities,
}) {
  const cta =
    interactiveAssessment(
      site,
      capabilities,
      "conversion.cta",
      "ctas",
    );

  const form =
    interactiveAssessment(
      site,
      capabilities,
      "conversion.form",
      "forms",
    );

  const trustAssessed =
    capabilityUsable(
      capabilities,
      "trust.proof",
    );

  const ctaPoints =
    cta.usesSite
      ? Math.min(
          25,
          site.ctas.length * 5,
        )
      : cta.browserSummary
          ?.completed > 0
        ? 25 *
          (
            (
              cta.browserSummary
                .readyPages ??
              0
            ) /
            cta.browserSummary
              .completed
          )
        : 0;

  const formPoints =
    form.usesSite
      ? (
          site.forms.length
            ? 20
            : 0
        )
      : form.browserSummary
          ?.completed > 0 &&
        (
          form.browserSummary
            .readyPages ??
          0
        ) > 0
        ? 20
        : 0;

  const hierarchyPoints =
    cta.usesSite
      ? (
          site.ctas.length >
            0 &&
          site.ctas.length <=
            8
            ? 10
            : 3
        )
      : 0;

  const baseResult =
    scoreAssessedTerms([
      {
        key: "cta",
        max: 25,
        assessed:
          cta.assessed,
        points: ctaPoints,
      },
      {
        key: "form",
        max: 20,
        assessed:
          form.assessed,
        points: formPoints,
      },
      {
        key: "pricing",
        max: 15,
        assessed:
          trustAssessed,
        points:
          site.trust.pricing
            ? 15
            : 0,
      },
      {
        key: "policies",
        max: 10,
        assessed:
          trustAssessed,
        points:
          site.trust.policies
            ? 10
            : 0,
      },
      {
        key: "testimonials",
        max: 10,
        assessed:
          trustAssessed,
        points:
          site.trust
            .testimonials
            ? 10
            : 0,
      },
      {
        key: "contact",
        max: 10,
        assessed:
          trustAssessed,
        points:
          site.trust.contact
            ? 10
            : 0,
      },
      {
        key: "cta_hierarchy",
        max: 10,
        assessed:
          cta.usesSite,
        points:
          hierarchyPoints,
      },
    ]);

  if (
    baseResult.score === null
  ) {
    return baseResult;
  }

  const pathCap =
    capabilities?.[
      "conversion.path"
    ];

  const summary =
    pathCap
      ?.validationSummary;

  if (
    pathCap?.validated ===
      true &&
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
      (
        summary
          .obstructionCount ??
        0
      ) > 0
        ? 10
        : 0;

    return {
      ...baseResult,
      score:
        clamp(
          baseResult.score +
            bonus -
            obstructionPenalty,
        ),
    };
  }

  return baseResult;
}

/** v4 offer clarity: business-context services union. */
function scoreOfferClarityV4({
  site,
  input,
  capabilities,
}) {
  const services =
    businessServices(
      site,
      input,
    );

  const cta =
    interactiveAssessment(
      site,
      capabilities,
      "conversion.cta",
      "ctas",
    );

  const form =
    interactiveAssessment(
      site,
      capabilities,
      "conversion.form",
      "forms",
    );

  const trustAssessed =
    capabilityUsable(
      capabilities,
      "trust.proof",
    );

  // Browser CTA validation proves action readiness, not CTA wording/count
  // clarity. This term therefore requires site-level interactive detail.
  const ctaClarityAssessed =
    cta.assessed &&
    cta.usesSite;

  const descKnown =
    site._metaCountersAvailable !==
      false &&
    (
      site
        ._metaFieldAvailability
        ?.descriptions ??
      true
    ) !== false &&
    typeof site
      .missingDescriptions ===
      "number" &&
    Number.isFinite(
      site.missingDescriptions,
    );

  return scoreAssessedTerms([
    {
      key: "cta_clarity",
      max: 30,
      assessed:
        ctaClarityAssessed,
      points:
        Math.min(
          30,
          site.ctas.length * 6,
        ),
    },
    {
      key: "forms",
      max: 15,
      assessed:
        form.assessed,
      points:
        form.present
          ? 15
          : 0,
    },
    {
      key: "pricing",
      max: 20,
      assessed:
        trustAssessed,
      points:
        site.trust.pricing
          ? 20
          : 0,
    },
    {
      key: "services",
      max: 20,
      points:
        Math.min(
          20,
          services.length * 4,
        ),
    },
    {
      key:
        "description_coverage",
      max: 15,
      assessed:
        descKnown,
      points:
        descKnown &&
        site.pageCount
          ? 15 *
            (
              1 -
              site
                .missingDescriptions /
                site.pageCount
            )
          : 0,
    },
  ]);
}

/** v4 risk reduction. */
function scoreRiskReductionV4({
  site,
  capabilities,
}) {
  const trustAssessed =
    capabilityUsable(
      capabilities,
      "trust.proof",
    );

  const headersAssessed =
    capabilityUsable(
      capabilities,
      "technical.headers",
    );

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

  const securityPoints =
    25 *
    (
      Object.values(
        securityHeaders || {},
      ).filter(Boolean).length /
      4
    );

  return scoreAssessedTerms([
    {
      key: "policies",
      max: 25,
      assessed:
        trustAssessed,
      points:
        site.trust.policies
          ? 25
          : 0,
    },
    {
      key: "contact",
      max: 20,
      assessed:
        trustAssessed,
      points:
        site.trust.contact
          ? 20
          : 0,
    },
    {
      key:
        "security_headers",
      max: 25,
      assessed:
        headersAssessed,
      points:
        securityPoints,
    },
    {
      key: "https",
      max: 15,
      assessed:
        Boolean(
          site.targetUrl,
        ),
      points:
        site.targetUrl &&
        site.targetUrl
          .startsWith(
            "https:",
          )
          ? 15
          : 0,
    },
    {
      key: "faq",
      max: 15,
      assessed:
        trustAssessed,
      points:
        site.trust.faq
          ? 15
          : 0,
    },
  ]);
}

/** v4 funnel coverage: business-context services union. */
function scoreFunnelCoverageV4({
  site,
  input,
  capabilities,
}) {
  const services =
    businessServices(
      site,
      input,
    );

  const contentAssessed =
    capabilityUsable(
      capabilities,
      "content.body",
    );

  const trustAssessed =
    capabilityUsable(
      capabilities,
      "trust.proof",
    );

  const cta =
    interactiveAssessment(
      site,
      capabilities,
      "conversion.cta",
      "ctas",
    );

  const form =
    interactiveAssessment(
      site,
      capabilities,
      "conversion.form",
      "forms",
    );

  return scoreAssessedTerms([
    {
      key: "tofu",
      max: 30,
      assessed:
        contentAssessed,
      points:
        Math.min(
          30,
          site.pageCount * 4 +
            site.topicKeywords
              .length *
              2,
        ),
    },
    {
      key: "faq",
      max: 20,
      assessed:
        trustAssessed,
      points:
        site.trust.faq
          ? 20
          : 0,
    },
    {
      key: "case_studies",
      max: 15,
      assessed:
        trustAssessed,
      points:
        site.trust.caseStudies
          ? 15
          : 0,
    },
    {
      key: "services",
      max: 10,
      assessed:
        contentAssessed,
      points:
        services.length >= 3
          ? 10
          : 0,
    },
    {
      key: "pricing",
      max: 20,
      assessed:
        trustAssessed,
      points:
        site.trust.pricing
          ? 20
          : 0,
    },
    {
      key: "contact",
      max: 10,
      assessed:
        trustAssessed,
      points:
        site.trust.contact
          ? 10
          : 0,
    },
    {
      key: "forms",
      max: 10,
      assessed:
        form.assessed,
      points:
        form.present
          ? 10
          : 0,
    },
    {
      key: "ctas",
      max: 10,
      assessed:
        cta.assessed,
      points:
        cta.usesSite
          ? Math.min(
              10,
              site.ctas.length *
                2,
            )
          : cta.present
            ? 10
            : 0,
    },
  ]);
}

/** v4 schema entity. */
function scoreSchemaEntityV4({
  site,
  capabilities,
}) {
  const schemaAssessed =
    capabilityUsable(
      capabilities,
      "schema.structured_data",
    );

  const contentAssessed =
    capabilityUsable(
      capabilities,
      "content.body",
    );

  const validSchema =
    site.schemaTypes.filter(
      (type) =>
        type !==
        "InvalidJSONLD",
    );

  return scoreAssessedTerms([
    {
      key: "schema_count",
      max: 40,
      assessed:
        schemaAssessed,
      points:
        Math.min(
          40,
          validSchema.length *
            10,
        ),
    },
    {
      key: "organization",
      max: 20,
      assessed:
        schemaAssessed,
      points:
        validSchema.some(
          (type) =>
            /organization|localbusiness/i.test(
              type,
            ),
        )
          ? 20
          : 0,
    },
    {
      key: "faq_schema",
      max: 15,
      assessed:
        schemaAssessed,
      points:
        validSchema.some(
          (type) =>
            /faq/i.test(
              type,
            ),
        )
          ? 15
          : 0,
    },
    {
      key: "service_schema",
      max: 15,
      assessed:
        schemaAssessed,
      points:
        validSchema.some(
          (type) =>
            /service|product/i.test(
              type,
            ),
        )
          ? 15
          : 0,
    },
    {
      key: "social_links",
      max: 10,
      assessed:
        contentAssessed,
      points:
        site.socialLinks
          .length
          ? 10
          : 0,
    },
  ]);
}

/**
 * v4 AI-readiness: STRUCTURAL machine-readability only (WP-D-07).
 */
function scoreAiReadinessV4({
  site,
  capabilities,
}) {
  const schemaAssessed =
    capabilityUsable(
      capabilities,
      "schema.structured_data",
    );

  const contentAssessed =
    capabilityUsable(
      capabilities,
      "content.body",
    );

  const trustAssessed =
    capabilityUsable(
      capabilities,
      "trust.proof",
    );

  const headingsPresent =
    Boolean(
      site.pages?.[0]
        ?.headings?.h1
        ?.length,
    );

  const headingsKnown =
    headingsPresent ||
    (
      site._metaCountersAvailable !==
        false &&
      (
        site
          ._metaFieldAvailability
          ?.headings ??
        true
      ) !== false
    );

  return scoreAssessedTerms([
    {
      key: "schema",
      max: 25,
      assessed:
        schemaAssessed,
      points:
        site.schemaTypes
          .length
          ? 25
          : 0,
    },
    {
      key: "headings",
      max: 15,
      assessed:
        headingsKnown,
      points:
        headingsPresent
          ? 15
          : 0,
    },
    {
      key: "faq",
      max: 20,
      assessed:
        trustAssessed,
      points:
        site.trust.faq
          ? 20
          : 0,
    },
    {
      key: "depth",
      max: 20,
      assessed:
        contentAssessed,
      points:
        Math.min(
          20,
          site.pageCount * 3,
        ),
    },
    {
      key: "topics",
      max: 20,
      assessed:
        contentAssessed,
      points:
        site.topicKeywords
          .length >= 5
          ? 20
          : site.topicKeywords
                .length >= 3
            ? 10
            : 0,
    },
  ]);
}

/**
 * v4 technical hygiene: capability-partitioned sub-rules (WP-D-04).
 *
 * PF-01: PARTIAL evidence may carry observed defects, but an empty/clean
 * PARTIAL result cannot establish a complete PASS. AVAILABLE evidence may
 * establish both positive and negative results.
 *
 * Returns { score, subWeightAssessed, subWeightTotal, subScores }.
 */
function scoreTechnicalV4({
  site,
  capabilities,
}) {
  const pageCount =
    Math.max(
      1,
      site.pageCount,
    );

  const subRules = [];

  const finiteNum =
    (value) =>
      typeof value ===
        "number" &&
      Number.isFinite(value);

    const fieldAvail =
    site._metaFieldAvailability ||
    {};

  const fieldCollected =
    (field) =>
      fieldAvail[field] !== false;

  {
    const metaTerms = [
      {
        weight: 15,
        known:
          fieldCollected(
            "titles",
          ) &&
          finiteNum(
            site.missingTitles,
          ),
        score:
          15 *
          (
            1 -
            (
              site.missingTitles ??
              0
            ) /
              pageCount
          ),
      },
      {
        weight: 15,
        known:
          fieldCollected(
            "descriptions",
          ) &&
          finiteNum(
            site.missingDescriptions,
          ),
        score:
          15 *
          (
            1 -
            (
              site.missingDescriptions ??
              0
            ) /
              pageCount
          ),
      },
      {
        weight: 10,
        known:
          fieldCollected(
            "canonicals",
          ) &&
          finiteNum(
            site.missingCanonicals,
          ),
        score:
          10 *
          (
            1 -
            (
              site.missingCanonicals ??
              0
            ) /
              pageCount
          ),
      },
      {
        weight: 10,
        known:
          fieldCollected(
            "headings",
          ) &&
          finiteNum(
            site.h1Missing,
          ) &&
          finiteNum(
            site.h1Multiple,
          ),
        score:
          10 *
          (
            1 -
            Math.min(
              pageCount,
              (
                site.h1Missing ??
                0
              ) +
                (
                  site.h1Multiple ??
                  0
                ),
            ) /
              pageCount
          ),
      },
    ];

    const knownTerms =
      metaTerms.filter(
        (term) =>
          term.known,
      );

    const metaCollected =
      site._metaCountersAvailable !==
      false;

    if (
      metaCollected &&
      knownTerms.length > 0
    ) {
      const weight =
        knownTerms.reduce(
          (sum, term) =>
            sum +
            term.weight,
          0,
        );

      const points =
        knownTerms.reduce(
          (sum, term) =>
            sum +
            term.score,
          0,
        );

      const score =
        clamp(
          points *
            (
              50 /
              weight
            ),
        );

      subRules.push({
        key: "meta",
        weight,
        score,
      });
    }
  }

    const sourceComplete =
    site.sourceStatus ===
    SOURCE_STATUS.AVAILABLE;
  const imageKnown =
    typeof site.imageCount ===
      "number" &&
    Number.isFinite(
      site.imageCount,
    ) &&
    site.imageCount > 0 &&
    typeof site
      .imagesMissingAlt ===
      "number" &&
    Number.isFinite(
      site.imagesMissingAlt,
    );

  const observedImageDefect =
    imageKnown &&
    site.imagesMissingAlt > 0;

  if (
    imageKnown &&
    (
      sourceComplete ||
      observedImageDefect
    )
  ) {
    const image =
      10 *
      (
        1 -
        Math.min(
          1,
          site.imagesMissingAlt /
            site.imageCount,
        )
      );

    subRules.push({
      key: "images",
      weight: 10,
      score: clamp(image),
    });
  }

  const indexabilityCap =
    capabilities?.[
      "technical.indexability"
    ];

  const nonIndexableCount =
    (
      site.nonIndexablePages ||
      []
    ).length;

  const completeIndexability =
    indexabilityCap?.status ===
      SOURCE_STATUS.AVAILABLE &&
    indexabilityCap
      ?.requiredFieldsPresent ===
      true;

  const observedPartialIndexabilityDefect =
    indexabilityCap?.status ===
      SOURCE_STATUS.PARTIAL &&
    nonIndexableCount > 0;

  if (
    completeIndexability ||
    observedPartialIndexabilityDefect
  ) {
    const score =
      nonIndexableCount === 0
        ? 10
        : nonIndexableCount <= 2
          ? 7
          : nonIndexableCount <=
              5
            ? 4
            : 0;

    subRules.push({
      key: "indexability",
      weight: 10,
      score,
    });
  }

  const redirectsCap =
    capabilities?.[
      "technical.redirects"
    ];

  const chains =
    site.redirectChains || [];

  const maxHops =
    chains.reduce(
      (maximum, chain) =>
        Math.max(
          maximum,
          chain?.hops ?? 0,
        ),
      0,
    );

  const completeRedirects =
    redirectsCap?.status ===
      SOURCE_STATUS.AVAILABLE &&
    redirectsCap
      ?.requiredFieldsPresent ===
      true;

  const observedPartialRedirectDefect =
    redirectsCap?.status ===
      SOURCE_STATUS.PARTIAL &&
    maxHops > 1;

  if (
    completeRedirects ||
    observedPartialRedirectDefect
  ) {
    const score =
      maxHops <= 1
        ? 10
        : maxHops === 2
          ? 5
          : 0;

    subRules.push({
      key: "redirects",
      weight: 10,
      score,
    });
  }

  const resourcesCap =
    capabilities?.[
      "technical.resources"
    ];

  const resourcePages =
    (
      site.pageResources ||
      []
    ).filter(
      (page) =>
        finiteNum(
          page?.totalResources,
        ) &&
        finiteNum(
          page?.brokenResources,
        ),
    );

  const totalResources =
    resourcePages.reduce(
      (sum, page) =>
        sum +
        page.totalResources,
      0,
    );

  const brokenResources =
    resourcePages.reduce(
      (sum, page) =>
        sum +
        page.brokenResources,
      0,
    );

  const completeResources =
    resourcesCap?.status ===
      SOURCE_STATUS.AVAILABLE &&
    resourcePages.length > 0;

  const observedPartialResourceDefect =
    resourcesCap?.status ===
      SOURCE_STATUS.PARTIAL &&
    resourcePages.length > 0 &&
    brokenResources > 0;

  if (
    completeResources ||
    observedPartialResourceDefect
  ) {
    const score =
      totalResources > 0
        ? Math.round(
            10 *
              (
                1 -
                Math.min(
                  1,
                  brokenResources /
                    totalResources,
                )
              ),
          )
        : 0;

    subRules.push({
      key: "resources",
      weight: 10,
      score,
    });
  }

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

  const hasHeaderEvidence =
    securityHeaders &&
    typeof securityHeaders ===
      "object" &&
    Object.keys(
      securityHeaders,
    ).length > 0;

  const headersPresent =
    hasHeaderEvidence
      ? Object.values(
          securityHeaders,
        ).filter(Boolean).length
      : 0;

  const completeHeaders =
    headerCapability?.status ===
      SOURCE_STATUS.AVAILABLE &&
    hasHeaderEvidence;

  const observedPartialHeaderDefect =
    headerCapability?.status ===
      SOURCE_STATUS.PARTIAL &&
    hasHeaderEvidence &&
    headersPresent < 4;

  if (
    completeHeaders ||
    observedPartialHeaderDefect
  ) {
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

  const totalWeight =
    subRules.reduce(
      (sum, rule) =>
        sum +
        rule.weight,
      0,
    );

  const weighted =
    subRules.reduce(
      (sum, rule) =>
        sum +
        rule.score *
          rule.weight,
      0,
    );

  const score =
    totalWeight > 0
      ? clamp(
          weighted /
            totalWeight,
        )
      : null;

  return {
    score,
    subWeightAssessed:
      totalWeight,
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

    // PRYSM-NEXT-01 WP-D-11 + PF-01/PF-03.
  //
  // A capability may remain usable when PARTIAL, but PARTIAL does not
  // establish whole-scope absence. Findings therefore distinguish:
  //   - usable evidence;
  //   - complete versus partial capability coverage;
  //   - observed defects versus absence conclusions.
  //
  // Unknown capability evidence is suppressed. PARTIAL absence findings
  // remain visible only when the rule supplies evidence-bounded wording.

  const capabilityUsableForFinding =
    (key) => {
      const cap =
        capabilities[key];

      const status =
        cap?.status;

      return (
        (
          status ===
            SOURCE_STATUS.AVAILABLE ||
          status ===
            SOURCE_STATUS.PARTIAL
        ) &&
        cap?.requiredFieldsPresent !==
          false
      );
    };

  const assessedContentUrls =
    (
      Array.isArray(
        site.contentParsing,
      )
        ? site.contentParsing
        : []
    )
      .filter((record) => {
        const hasText =
          typeof record?.text ===
            "string" &&
          record.text.trim().length >
            0;

        const hasWordCount =
          typeof record?.wordCount ===
            "number" &&
          Number.isFinite(
            record.wordCount,
          );

        const hasMainContentChars =
          typeof record
            ?.mainContentChars ===
            "number" &&
          Number.isFinite(
            record.mainContentChars,
          );

        return (
          hasText ||
          hasWordCount ||
          hasMainContentChars
        );
      })
      .map(
        (record) =>
          record?.url ||
          record?.crawledUrl,
      )
      .filter(Boolean)
      .slice(0, 10);

  const add = (opts) => {
    const requiredCapabilities =
      opts.requires === undefined ||
      opts.requires === null
        ? []
        : Array.isArray(
              opts.requires,
            )
          ? opts.requires
          : [opts.requires];

    const unavailableCapabilities =
      requiredCapabilities.filter(
        (key) =>
          !capabilityUsableForFinding(
            key,
          ),
      );

    if (
      unavailableCapabilities.length >
      0
    ) {
      for (
        const capability
        of unavailableCapabilities
      ) {
        suppressedReasons.push({
          ruleId: opts.ruleId,
          title: opts.title,
          capability,
          capabilityStatus:
            capabilities[
              capability
            ]?.status ??
            "NOT_ASSESSED",
        });
      }

      return;
    }

    const partialCapabilities =
      requiredCapabilities.filter(
        (key) =>
          capabilities[key]
            ?.status ===
          SOURCE_STATUS.PARTIAL,
      );

    const partialAbsence =
      opts.absenceFinding === true &&
      partialCapabilities.length > 0;

    if (
      partialAbsence &&
      (
        !opts.partialTitle ||
        !opts.partialEvidenceText ||
        !opts.partialBusinessImpact
      )
    ) {
      suppressedReasons.push({
        ruleId: opts.ruleId,
        title: opts.title,
        capability:
          partialCapabilities.join(
            ",",
          ),
        capabilityStatus:
          SOURCE_STATUS.PARTIAL,
        reason:
          "PARTIAL absence finding lacks evidence-bounded wording",
      });

      return;
    }

    const title =
      partialAbsence
        ? opts.partialTitle
        : opts.title;

    const evidenceText =
      partialAbsence
        ? opts.partialEvidenceText
        : (
            opts.evidenceText ||
            ""
          );

    const businessImpactText =
      partialAbsence
        ? opts.partialBusinessImpact
        : (
            opts.businessImpact ||
            opts.impact ||
            ""
          );

    const requestedAffectedUrls =
      partialAbsence &&
      Array.isArray(
        opts.partialAffectedUrls,
      ) &&
      opts.partialAffectedUrls
        .length > 0
        ? opts.partialAffectedUrls
        : opts.affectedUrls;

    const affectedUrls =
      requestedAffectedUrls &&
      requestedAffectedUrls.length >
        0
        ? requestedAffectedUrls
        : [
            site.targetUrl ||
              site.domain ||
              "https://unknown",
          ].filter(Boolean);

    const dataForSeoStatus =
      requiredCapabilities.length > 0
        ? partialCapabilities.length > 0
          ? SOURCE_STATUS.PARTIAL
          : SOURCE_STATUS.AVAILABLE
        : site?.sourceStatus;

    const evidenceRecords =
      (opts.evidence || []).map(
        (er) => {
          const provider =
            er.provider ||
            "dataforseo_onpage";

          return {
            provider,
            sourceStatus:
              provider ===
              "dataforseo_onpage"
                ? dataForSeoStatus
                : er.sourceStatus,
            field: er.field,
            observedValue:
              er.observedValue ??
              null,
            artifactRef:
              er.artifactRef ||
              site.rawArtifactRef ||
              null,
          };
        },
      );

    if (
      evidenceRecords.some(
        (er) =>
          !isValidSourceStatus(
            er.sourceStatus,
          ),
      )
    ) {
      return;
    }

    if (!evidenceRecords.length) {
      return;
    }

    const findingId =
      generateFindingId(
        opts.ruleId,
        affectedUrls,
        evidenceRecords,
      );

    const confidence =
      partialAbsence
        ? (
            opts.partialConfidence ||
            CONFIDENCE_LEVELS.SUPPORTED
          )
        : (
            opts.confidence ||
            CONFIDENCE_LEVELS.DETERMINISTIC
          );

    const priority =
      calculateFindingPriority({
        conversionImpact:
          opts.conversionImpact ??
          _defaultImpact(
            opts.severity,
          ),
        gapSeverity:
          opts.gapSeverity ??
          _defaultGapSeverity(
            opts.severity,
          ),
        businessRelevance:
          opts.businessRelevance ??
          50,
        competitiveSignal:
          opts.competitiveSignal ??
          25,
        implementationPracticality:
          opts.implementationPracticality ??
          _defaultPracticality(
            opts.effort,
          ),
        confidence,
      });

    const businessImpact =
      governBusinessImpact(
        businessImpactText,
        {
          label:
            `Finding ${opts.ruleId} businessImpact`,
          basis:
            opts.businessImpactBasis ||
            BUSINESS_IMPACT_BASIS.INFERRED,
        },
      );

    findings.push({
      contractVersion: "1.0.0",
      findingId,
      ruleId: opts.ruleId,
      ruleVersion: RULE_VERSION,
      dimension: opts.dimension,
      module: opts.module,
      title,
      affectedUrls,
      evidence: evidenceRecords,
      confidence,
      businessImpact,
      recommendation:
        opts.recommendation ||
        opts.fix ||
        "",
      implementationEffort:
        opts.effort || "M",
      verificationMethod:
        opts.verificationMethod ||
        "Re-audit after changes are applied.",
      scoreBearing:
        priority.scoreBearing,
      rawPriority: priority.raw,
      finalPriority:
        priority.final,
      severity: opts.severity,

      // Display compatibility aliases.
      problem: title,
      impact: businessImpact,
      fix:
        opts.recommendation ||
        opts.fix ||
        "",
      effort: opts.effort || "M",
      key: opts.key || "",
      evidenceText,
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

    if (
    !site.trust.testimonials &&
    !site.trust.caseStudies &&
    !site.trust.credentials
  ) {
    add({
      ruleId: "VAN-TRUST-001",
      requires: "trust.proof",
      absenceFinding: true,
      partialTitle:
        "Visible trust proof was not detected in the available partial assessment",
      partialEvidenceText:
        "Testimonials, case studies, or credentials were not detected in the available partial assessment",
      partialBusinessImpact:
        "The available partial assessment did not detect visible trust proof on the assessed pages, which may leave some credibility questions unresolved there; unassessed pages remain unknown.",
      partialConfidence:
        CONFIDENCE_LEVELS.SUPPORTED,
      partialAffectedUrls:
        assessedContentUrls,
      dimension: "trust_eeat",
      module: "trust_signals",
      title:
        "No visible trust proof",
      severity: "High",
      key: "trust",
      confidence:
        trustProofConfidence,
      evidence: [
        {
          provider:
            "dataforseo_onpage",
          sourceStatus:
            SOURCE_STATUS.AVAILABLE,
          field:
            "trust.testimonials",
          observedValue: false,
        },
        {
          provider:
            "dataforseo_onpage",
          sourceStatus:
            SOURCE_STATUS.AVAILABLE,
          field:
            "trust.credentials",
          observedValue: false,
        },
        {
          provider:
            "dataforseo_onpage",
          sourceStatus:
            SOURCE_STATUS.AVAILABLE,
          field:
            "trust.caseStudies",
          observedValue: false,
        },
      ],
      evidenceText:
        "No testimonials, case studies, or credentials detected",
      businessImpact:
        "Limited visible trust proof may make credibility harder for visitors to verify before deciding.",
      recommendation:
        "Add credentials, client proof, and outcome-based case studies",
      effort: "M",
      conversionImpact: 85,
      gapSeverity: 80,
      businessRelevance: 90,
      competitiveSignal: 40,
      implementationPracticality: 50,
      verificationMethod:
        "Re-crawl and confirm trust signals are detected on key pages.",
    });
  }

  if (site.missingDescriptions) {
    add({
      ruleId: "VAN-TECH-001",
      dimension: "technical_performance",
      module: "technical_hygiene",
      title:
        site.sourceStatus === SOURCE_STATUS.PARTIAL
          ? "Meta descriptions were not detected on some assessed pages"
          : "Missing meta descriptions",
      severity: "High",
      key: "meta",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      affectedUrls: site.pages?.filter((p) => !p.description).map((p) => p.url).slice(0, 10) || [site.targetUrl],
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "meta_description", observedValue: null },
      ],
      evidenceText:
        site.sourceStatus === SOURCE_STATUS.PARTIAL
          ? `${site.missingDescriptions} of ${site.pageCount} assessed pages did not have a detected meta description; unassessed pages remain unknown`
          : `${site.missingDescriptions} of ${site.pageCount} crawled pages`,
      businessImpact:
        site.sourceStatus === SOURCE_STATUS.PARTIAL
          ? "Meta descriptions were not detected on some assessed pages, which may reduce control over search-result messaging for those pages; unassessed pages remain unknown."
          : "Missing meta descriptions may reduce control over search-result messaging for these pages.",
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
      requires:
        "schema.structured_data",
      absenceFinding: true,
      partialTitle:
        "Structured data was not detected in the available partial assessment",
      partialEvidenceText:
        "Structured data was not detected in the available partial assessment",
      partialBusinessImpact:
        "The available partial assessment did not detect structured data on assessed pages, which may provide less explicit entity context there; unassessed pages remain unknown.",
      partialConfidence:
        CONFIDENCE_LEVELS.SUPPORTED,
      partialAffectedUrls:
        assessedContentUrls,
      dimension:
        "entity_schema_ai",
      module: "schema_entity",
      title:
        "No structured data detected",
      severity: "High",
      key: "schema",
      confidence:
        CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        {
          provider:
            "dataforseo_onpage",
          sourceStatus:
            SOURCE_STATUS.AVAILABLE,
          field: "schema_types",
          observedValue: [],
        },
      ],
      evidenceText:
        "No JSON-LD schema types found",
      businessImpact:
        "Missing structured data may provide search and AI systems with less explicit entity context.",
      recommendation:
        "Add Organization or LocalBusiness, Person, Service, and FAQ schema where supported",
      effort: "M",
      conversionImpact: 60,
      gapSeverity: 65,
      businessRelevance: 70,
      competitiveSignal: 55,
      implementationPracticality: 60,
      verificationMethod:
        "Re-crawl and validate structured data with Google's Rich Results Test.",
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
      evidenceText:
        site.sourceStatus === SOURCE_STATUS.PARTIAL
          ? `${site.h1Missing} assessed pages missing H1; ${site.h1Multiple} assessed pages with multiple H1s; unassessed pages remain unknown`
          : `${site.h1Missing} pages missing H1; ${site.h1Multiple} pages with multiple H1s`,
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
      absenceFinding: true,
      partialTitle:
        "Security headers were incomplete on the assessed browser pages",
      partialEvidenceText:
        `The available partial assessment observed these missing response headers: ${missingSecurity.join(", ")}`,
      partialBusinessImpact:
        "The partial browser assessment observed missing response protections on assessed pages, which may weaken technical trust there; unassessed pages remain unknown.",
      partialConfidence:
        CONFIDENCE_LEVELS.SUPPORTED,
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
      requires: [
        "content.body",
        "trust.proof",
      ],
      absenceFinding: true,
      partialTitle:
        "Buyer-question content was not detected in the available partial assessment",
      partialEvidenceText:
        "FAQ or common-question content was not detected in the available partial assessment",
      partialBusinessImpact:
        "The available partial assessment did not detect buyer-question content on the assessed pages, so some buyer questions may remain unsupported there; unassessed pages remain unknown.",
      partialConfidence:
        CONFIDENCE_LEVELS.SUPPORTED,
      partialAffectedUrls:
        assessedContentUrls,
      dimension: "content_funnel",
      module: "funnel_coverage",
      title:
        "No buyer-question content detected",
      severity: "Medium",
      key: "faq",
      confidence:
        CONFIDENCE_LEVELS.SUPPORTED,
      evidence: [
        {
          provider:
            "dataforseo_onpage",
          sourceStatus:
            SOURCE_STATUS.AVAILABLE,
          field: "trust.faq",
          observedValue: false,
        },
      ],
      evidenceText:
        "No FAQ or common-question section found",
      businessImpact:
        "Missing buyer-question content may leave common objections unresolved before a visitor acts.",
      recommendation:
        "Add an FAQ based on the questions prospects ask before booking",
      effort: "M",
      conversionImpact: 55,
      gapSeverity: 45,
      businessRelevance: 60,
      competitiveSignal: 35,
      implementationPracticality: 65,
      verificationMethod:
        "Re-crawl and confirm FAQ content is present with structured data where applicable.",
    });
  }

  if (!site.trust.pricing) {
    add({
      ruleId: "VAN-TRUST-002",
      requires: "trust.proof",
      absenceFinding: true,
      partialTitle:
        "Pricing or investment context was not detected in the available partial assessment",
      partialEvidenceText:
        "Pricing, cost, fee, or investment language was not detected in the available partial assessment",
      partialBusinessImpact:
        "The available partial assessment did not detect pricing or investment context on the assessed pages, so commitment expectations may remain unclear there; unassessed pages remain unknown.",
      partialConfidence:
        CONFIDENCE_LEVELS.SUPPORTED,
      partialAffectedUrls:
        assessedContentUrls,
      dimension: "trust_eeat",
      module: "risk_reduction",
      title:
        "Pricing or investment context is absent",
      severity: "Medium",
      key: "pricing",
      confidence:
        CONFIDENCE_LEVELS.STRONGLY_SUPPORTED,
      evidence: [
        {
          provider:
            "dataforseo_onpage",
          sourceStatus:
            SOURCE_STATUS.AVAILABLE,
          field: "trust.pricing",
          observedValue: false,
        },
      ],
      evidenceText:
        "No pricing, cost, fee, or investment language detected",
      businessImpact:
        "Missing pricing context may leave commitment expectations unclear before contact.",
      recommendation:
        "State pricing, starting price, or the process used to determine cost",
      effort: "L",
      conversionImpact: 65,
      gapSeverity: 55,
      businessRelevance: 70,
      competitiveSignal: 50,
      implementationPracticality: 80,
      verificationMethod:
        "Re-crawl and confirm pricing information is visible on relevant pages.",
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

import { clamp } from "../utils.js";
import { SOURCE_STATUS } from "./evidence-contracts.js";
import {
  SCORING_VERSION,
  DIMENSIONS,
  MODULES,
  band,
  confidenceBand,
  scoreTrust,
  scoreContent,
  scoreConversion,
  scoreTechnical,
  scorePerformance,
  buildFindings,
  checkModuleEligibility,
  calculateEvidenceConfidence,
  calculateFindingPriority,
  CONFIDENCE_LEVELS,
} from "./score-components.js";
import {
  buildConversionPaths,
  topicRows,
  contentIdeas,
  competitorComparison,
} from "./report-model.js";

// ---------------------------------------------------------------------------
// Source gate helpers (PRD v3.0 §8.6, §15.2)
// ---------------------------------------------------------------------------

/**
 * Return true when crawl-dependent modules may be scored.
 */
function isCrawlViable(site) {
  return (
    site.sourceStatus === SOURCE_STATUS.AVAILABLE ||
    site.sourceStatus === SOURCE_STATUS.PARTIAL
  );
}

/**
 * Return true when performance-dependent modules may be scored.
 */
function isPerformanceViable(performance) {
  return (
    performance?.sourceStatus === SOURCE_STATUS.AVAILABLE ||
    performance?.sourceStatus === SOURCE_STATUS.PARTIAL
  );
}

// ---------------------------------------------------------------------------
// Dimension and module scoring
// ---------------------------------------------------------------------------

/**
 * Score all modules, respecting source gates.
 *
 * Returns:
 *  - moduleResults: Map<moduleId, { score, eligible, reason }>
 *  - dimensionScores: Map<dimensionId, { score, assessedWeight, totalWeight, eligible }>
 *  - overallAssessedWeight: percentage of total dimension weight assessed
 *  - totalIntendedWeight: 100 (always)
 */
function scoreModules(evidence) {
  const site = evidence.site;
  const performance = evidence.performance;

  const moduleResults = new Map();
  const dimensionData = new Map();

  // Initialize dimension accumulators
  for (const dim of Object.values(DIMENSIONS)) {
    dimensionData.set(dim.id, {
      id: dim.id,
      label: dim.label,
      totalWeight: dim.weight,
      scoredWeight: 0,
      eligibleWeight: 0,
      moduleScores: [],
      eligible: false,
    });
  }

  // Score each module
  for (const mod of Object.values(MODULES)) {
    const eligibility = checkModuleEligibility(mod, evidence);

    if (!eligibility.eligible) {
      moduleResults.set(mod.id, {
        moduleId: mod.id,
        dimension: mod.dimension,
        label: mod.label,
        score: null,
        eligible: false,
        reason: eligibility.reason,
        weight: mod.weight,
      });
      continue;
    }

    // Module is eligible — compute score
    const score = mod.scorer(site, performance, { site, performance });
    const finalScore = score === null ? null : clamp(score);

    moduleResults.set(mod.id, {
      moduleId: mod.id,
      dimension: mod.dimension,
      label: mod.label,
      score: finalScore,
      eligible: true,
      reason: null,
      weight: mod.weight,
    });

    // Accumulate into dimension
    const dim = dimensionData.get(mod.dimension);
    if (dim && finalScore !== null) {
      dim.scoredWeight += mod.weight;
      dim.moduleScores.push({ moduleId: mod.id, score: finalScore, weight: mod.weight });
    }
    if (dim) {
      dim.eligibleWeight += mod.weight;
    }
  }

  // Compute dimension scores
  const dimensionScores = new Map();
  let totalAssessedWeight = 0;

  for (const [dimId, dim] of dimensionData) {
    // Dimension is eligible if any of its modules scored
    dim.eligible = dim.moduleScores.length > 0;

    if (!dim.eligible || dim.scoredWeight === 0) {
      dimensionScores.set(dimId, {
        id: dim.id,
        label: dim.label,
        score: null,
        totalWeight: dim.totalWeight,
        assessedWeight: 0,
        eligible: false,
      });
      continue;
    }

    // Weighted average of eligible module scores within the dimension
    const weightedSum = dim.moduleScores.reduce(
      (sum, m) => sum + m.score * m.weight,
      0,
    );
    const dimensionScore = clamp(weightedSum / dim.scoredWeight);

    // Assessed weight = proportion of this dimension's intended weight that was scored
    const assessedPortion = dim.scoredWeight / dim.totalWeight;
    const dimensionAssessedWeight = Math.round(assessedPortion * dim.totalWeight);

    dimensionScores.set(dimId, {
      id: dim.id,
      label: dim.label,
      score: dimensionScore,
      totalWeight: dim.totalWeight,
      assessedWeight: dimensionAssessedWeight,
      eligible: true,
    });

    // Contribution to overall assessed weight
    totalAssessedWeight += dimensionAssessedWeight;
  }

  const totalIntendedWeight = Object.values(DIMENSIONS).reduce(
    (sum, d) => sum + d.weight,
    0,
  );

  const overallAssessedWeight = Math.round(
    (totalAssessedWeight / totalIntendedWeight) * 100,
  );

  return {
    moduleResults,
    dimensionScores,
    overallAssessedWeight,
    totalIntendedWeight,
  };
}

// ---------------------------------------------------------------------------
// Funnel-stage scores (derived for report backward compatibility)
// ---------------------------------------------------------------------------

function computeFunnelScores(site, dimensionScores) {
  const trustScore = dimensionScores.get("trust_eeat")?.score ?? null;
  const contentScore = dimensionScores.get("content_funnel")?.score ?? null;
  const conversionScore = dimensionScores.get("conversion_pathways")?.score ?? null;

  const awareness = trustScore !== null
    ? clamp(
        (contentScore ?? 50) * 0.55 +
          (site.trust.faq ? 20 : 0) +
          Math.min(25, site.pageCount * 3),
      )
    : null;

  const consideration = trustScore !== null
    ? clamp(
        (trustScore ?? 0) * 0.6 +
          (contentScore ?? 0) * 0.2 +
          (site.trust.faq ? 10 : 0) +
          (site.trust.pricing ? 10 : 0),
      )
    : null;

  const decision = trustScore !== null
    ? clamp(
        (conversionScore ?? 0) * 0.65 +
          (trustScore ?? 0) * 0.25 +
          (site.trust.pricing ? 10 : 0),
      )
    : null;

  // AI readiness is always computed when crawl is viable
  const aiReadiness = trustScore !== null
    ? clamp(
        (site.schemaTypes.length ? 25 : 0) +
          (site.pages[0]?.headings?.h1?.length ? 15 : 0) +
          (site.trust.faq ? 20 : 0) +
          Math.min(20, site.pageCount * 3) +
          (site.topicKeywords.length >= 5 ? 20 : 5),
      )
    : null;

  return { awareness, consideration, decision, aiReadiness };
}

// ---------------------------------------------------------------------------
// Legacy score map (backward compat for report sections)
// ---------------------------------------------------------------------------

function buildLegacyScoreMap(dimensionScores, moduleResults, site, performance) {
  const dim = (id) => dimensionScores.get(id)?.score ?? null;

  // Map dimension scores to legacy field names
  const trust = dim("trust_eeat");
  const contentDepth = dim("content_funnel");
  const conversionPathways = dim("conversion_pathways");
  const technical = moduleResults.get("technical_hygiene")?.score ?? null;
  const perfScore = moduleResults.get("performance")?.score ?? null;

  // Overall readiness: weighted sum of dimension scores / assessed weight
  let conversionReadiness = null;
  let totalWeightedScore = 0;
  let totalScoredWeight = 0;

  for (const [, dimData] of dimensionScores) {
    if (dimData.eligible && dimData.score !== null) {
      totalWeightedScore += dimData.score * dimData.totalWeight;
      totalScoredWeight += dimData.assessedWeight;
    }
  }

  if (totalScoredWeight > 0) {
    conversionReadiness = clamp(totalWeightedScore / totalScoredWeight);
  }

  return {
    trust,
    contentDepth,
    conversionPathways,
    technical,
    performance: perfScore,
    conversionReadiness,
  };
}

// ---------------------------------------------------------------------------
// Readiness status determination (PRD §15.3)
// ---------------------------------------------------------------------------

function determineReadinessStatus(assessedWeight, conversionReadiness) {
  if (assessedWeight >= 80) {
    return {
      status: "Complete",
      label: null,
      showNumericScore: true,
    };
  }

  if (assessedWeight >= 60) {
    return {
      status: "Provisional",
      label: "Provisional",
      showNumericScore: true,
    };
  }

  // Below 60% — suppress numeric score
  return {
    status: "Insufficient Evidence for Overall Score",
    label: "Insufficient Evidence for Overall Score",
    showNumericScore: false,
  };
}

// ---------------------------------------------------------------------------
// Build Not-Assessed model (no crawl evidence)
// ---------------------------------------------------------------------------

function buildNotAssessedModel(input, evidence) {
  const perfScore = scorePerformance(evidence.performance);

  const hasPerformance = isPerformanceViable(evidence.performance);
  const perfEvidenceScore = hasPerformance ? 25 : 0;

  // Evidence confidence with crawl unavailable
  const evidenceConfidence = calculateEvidenceConfidence(evidence, []);
  const coreEvidence = [
    0, // crawl unavailable
    perfEvidenceScore,
    evidence.competitors?.length
      ? evidence.competitors.some((x) => x.status === SOURCE_STATUS.AVAILABLE)
        ? 15
        : 5
      : 10,
    evidence.backlinks?.sourceStatus === SOURCE_STATUS.AVAILABLE ? 5 : 3,
  ];
  const evidenceConfidenceScore = clamp(coreEvidence.reduce((a, b) => a + b, 0));

  const crawlStatus = evidence.site.sourceStatus;
  const rootCause =
    crawlStatus === SOURCE_STATUS.NOT_CONNECTED
      ? "The primary crawl provider is not connected. Crawl-dependent modules could not be assessed."
      : crawlStatus === SOURCE_STATUS.BLOCKED
        ? "The target website blocked the crawl. Crawl-dependent modules could not be assessed."
        : "Crawl evidence is unavailable. Crawl-dependent modules could not be assessed.";

  // Build suppressed module reasons
  const suppressedModules = [];
  for (const mod of Object.values(MODULES)) {
    if (mod.sources.includes("crawl")) {
      suppressedModules.push({
        moduleId: mod.id,
        dimension: mod.dimension,
        label: mod.label,
        reason: `Crawl source status is ${crawlStatus}`,
      });
    }
  }

  return {
    reportVersion: SCORING_VERSION,
    scoringVersion: SCORING_VERSION,
    generatedAt: new Date().toISOString(),
    input,
    scores: {
      trust: null,
      contentDepth: null,
      conversionPathways: null,
      technical: null,
      performance: perfScore,
      conversionReadiness: null,
      awareness: null,
      consideration: null,
      decision: null,
      aiReadiness: null,
    },
    bands: {
      conversionReadiness: "Not Assessed",
      trust: "Not Assessed",
      evidenceConfidence: confidenceBand(evidenceConfidenceScore),
    },
    readinessStatus: "Insufficient Evidence for Overall Score",
    readinessStatusDetail: "Insufficient Evidence for Overall Score",
    showNumericScore: false,
    assessedWeight: hasPerformance ? 10 : 0, // Only performance contributes when crawl is down
    evidenceConfidenceScore,
    evidenceConfidenceFactors: evidenceConfidence.factors,
    dimensionEligibility: Object.fromEntries(
      Object.keys(DIMENSIONS).map((k) => [k, false]),
    ),
    moduleEligibility: Object.fromEntries(
      Object.values(MODULES).map((m) => [m.id, false]),
    ),
    suppressedModules,
    rootCause,
    findings: [],
    conversionPaths: [
      {
        name: "Primary conversion path",
        cta: null,
        host: "none",
        steps: [
          "Crawl evidence unavailable — conversion path could not be mapped.",
        ],
        blockers: ["no crawl evidence"],
        status: "Not Assessed",
      },
    ],
    readinessMap: [],
    contentIdeas: {
      tofu: [],
      mofu: [],
      bofu: [],
      leading: [],
    },
    competitors: competitorComparison(evidence.competitors || []),
    evidence,
    _crawlSuppressed: true,
  };
}

// ---------------------------------------------------------------------------
// Main scoring entry point
// ---------------------------------------------------------------------------

export function scoreAudit(input, evidence) {
  const site = evidence.site;
  const performance = evidence.performance;

  // ── Crawl gate (PRD v3.0 §8.6) ────────────────────────────────────
  if (!isCrawlViable(site)) {
    return buildNotAssessedModel(input, evidence);
  }

  // ── Score modules with source gates ────────────────────────────────
  const {
    moduleResults,
    dimensionScores,
    overallAssessedWeight,
  } = scoreModules(evidence);

  // ── Build legacy score map ─────────────────────────────────────────
  const legacyScores = buildLegacyScoreMap(
    dimensionScores,
    moduleResults,
    site,
    performance,
  );

  // ── Funnel-stage scores ────────────────────────────────────────────
  const funnelScores = computeFunnelScores(site, dimensionScores);

  // ── Build findings ─────────────────────────────────────────────────
  const gsc = evidence.gsc;
  const findings = buildFindings(site, performance, gsc);

  // ── Evidence confidence ────────────────────────────────────────────
  const evidenceConfidence = calculateEvidenceConfidence(evidence, findings);

  // ── Readiness status (PRD §15.3) ───────────────────────────────────
  const readinessState = determineReadinessStatus(
    overallAssessedWeight,
    legacyScores.conversionReadiness,
  );

  // The numeric readiness score to expose
  const displayReadiness = readinessState.showNumericScore
    ? legacyScores.conversionReadiness
    : null;

  // ── Root cause ─────────────────────────────────────────────────────
  const topFindings = findings.slice(0, 3).map((f) => f.title.toLowerCase());
  const rootCause = topFindings.length
    ? `The site's main conversion constraint is ${topFindings.join(", ")}. These gaps prevent visitors from moving from initial interest to a confident next step.`
    : "The site has a functional conversion foundation. The main opportunity is to strengthen evidence depth and make each offer easier to evaluate.";

  // ── Module eligibility map ─────────────────────────────────────────
  const moduleEligibility = {};
  const suppressedModules = [];
  for (const mod of Object.values(MODULES)) {
    const result = moduleResults.get(mod.id);
    moduleEligibility[mod.id] = result?.eligible ?? false;
    if (!(result?.eligible)) {
      suppressedModules.push({
        moduleId: mod.id,
        dimension: mod.dimension,
        label: mod.label,
        reason: result?.reason || "Module not eligible",
      });
    }
  }

  // ── Dimension eligibility map ──────────────────────────────────────
  const dimensionEligibility = {};
  for (const [dimId, dimData] of dimensionScores) {
    dimensionEligibility[dimId] = dimData.eligible;
  }

  // ── Build bands ────────────────────────────────────────────────────
  const bands = {
    conversionReadiness:
      legacyScores.conversionReadiness !== null
        ? band(legacyScores.conversionReadiness)
        : "Not Assessed",
    trust:
      legacyScores.trust !== null
        ? band(legacyScores.trust)
        : "Not Assessed",
    evidenceConfidence: confidenceBand(evidenceConfidence.score),
  };

  // ── Assemble model ─────────────────────────────────────────────────
  return {
    reportVersion: SCORING_VERSION,
    scoringVersion: SCORING_VERSION,
    generatedAt: new Date().toISOString(),
    input,

    // Scores (backward-compatible legacy fields + new dimension fields)
    scores: {
      ...legacyScores,
      awareness: funnelScores.awareness,
      consideration: funnelScores.consideration,
      decision: funnelScores.decision,
      aiReadiness: funnelScores.aiReadiness,
      // Dimension-level scores
      conversionPathwaysDimension: dimensionScores.get("conversion_pathways")?.score ?? null,
      trustEeatDimension: dimensionScores.get("trust_eeat")?.score ?? null,
      contentFunnelDimension: dimensionScores.get("content_funnel")?.score ?? null,
      technicalPerformanceDimension: dimensionScores.get("technical_performance")?.score ?? null,
      entitySchemaAiDimension: dimensionScores.get("entity_schema_ai")?.score ?? null,
      // Override conversionReadiness with display-aware value
      conversionReadiness: displayReadiness,
    },

    bands,

    // PRD §15.3 — assessed weight and readiness status
    assessedWeight: overallAssessedWeight,
    readinessStatus: readinessState.label || readinessState.status,
    readinessStatusDetail: readinessState.status,
    showNumericScore: readinessState.showNumericScore,

    // PRD §15.5 — evidence confidence
    evidenceConfidenceScore: evidenceConfidence.score,
    evidenceConfidenceFactors: evidenceConfidence.factors,

    // Module and dimension eligibility
    dimensionEligibility,
    moduleEligibility,
    suppressedModules,

    // Findings, root cause, and display content
    rootCause,
    findings,
    conversionPaths: buildConversionPaths(site),
    readinessMap: topicRows(site),
    contentIdeas: contentIdeas(site),
    competitors: competitorComparison(evidence.competitors || []),
    evidence,
  };
}

// Re-export for external consumers
export { SCORING_VERSION, DIMENSIONS, MODULES };

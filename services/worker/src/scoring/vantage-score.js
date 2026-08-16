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
  buildRenderingDiagnosticFindings,
} from "./score-components.js";
import {
  buildConversionPaths,
  topicRows,
  contentIdeas,
  competitorComparison,
} from "./report-model.js";
import { classifyRenderingDiagnostics } from "./rendering-diagnostics.js";
import { buildCapabilityEvidence } from "../evidence/capability-evidence.js";

// ---------------------------------------------------------------------------
// Source gate helpers (PRD v3.0 §8.6, §15.2)
// ---------------------------------------------------------------------------

/**
 * Return true when crawl-dependent modules may be scored.
 */
function isCrawlViable(site) {
  if (!site) return false;
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
function scoreModules(evidence, capabilities, input) {
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
      moduleScores: [],
      eligible: false,
    });
  }

  // Score each module
  for (const mod of Object.values(MODULES)) {
    const eligibility = checkModuleEligibility(mod, evidence, capabilities);

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

    // Module is eligible — compute score.  modelDeps carries the business
    // context (WP-D-05) and capability map (WP-D-02/07).
    const modelDeps = { site, performance, input, capabilities };
    const rawScore = mod.scorer(site, performance, modelDeps);
    // v4 technical hygiene returns { score, subWeightAssessed, ... }.
    const score = (rawScore && typeof rawScore === "object" && "score" in rawScore)
      ? rawScore.score
      : rawScore;
    const finalScore = score === null ? null : clamp(score);

    const resultEntry = {
      moduleId: mod.id,
      dimension: mod.dimension,
      label: mod.label,
      score: finalScore,
      eligible: true,
      reason: null,
      weight: mod.weight,
    };
    if (rawScore && typeof rawScore === "object") {
      resultEntry.subWeightAssessed = rawScore.subWeightAssessed ?? null;
      resultEntry.subWeightTotal = rawScore.subWeightTotal ?? null;
      resultEntry.subScores = rawScore.subScores ?? null;
    }
    moduleResults.set(mod.id, resultEntry);

    // Accumulate into dimension
    const dim = dimensionData.get(mod.dimension);
    if (dim && finalScore !== null) {
      dim.scoredWeight += mod.weight;
      dim.moduleScores.push({ moduleId: mod.id, score: finalScore, weight: mod.weight });
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

function computeFunnelScores(site, dimensionScores, capabilities) {
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

  // WP-D-07 — structural machine-readability only; no floor for unknown
  // evidence; schema points require the structured-data capability.
  const schemaCap = capabilities?.["schema.structured_data"];
  const schemaAvailable =
    schemaCap?.status === SOURCE_STATUS.AVAILABLE ||
    schemaCap?.status === SOURCE_STATUS.PARTIAL;
  const aiReadiness = trustScore !== null
    ? clamp(
        (schemaAvailable && site.schemaTypes.length ? 25 : 0) +
          (site.pages[0]?.headings?.h1?.length ? 15 : 0) +
          (site.trust.faq ? 20 : 0) +
          Math.min(20, site.pageCount * 3) +
          (site.topicKeywords.length >= 5 ? 20 : site.topicKeywords.length >= 3 ? 10 : 0),
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

  // Overall readiness: assessed-weight-weighted mean (PRYSM-NEXT-01 WP-D-01).
  // Numerator MUST use the dimension's ASSESSED weight, never its full
  // intended weight — a partial dimension may only influence the overall
  // score in proportion to the evidence actually assessed (CRIT defect 15).
  let conversionReadiness = null;
  let totalWeightedScore = 0;
  let totalScoredWeight = 0;

  for (const [, dimData] of dimensionScores) {
    if (dimData.eligible && dimData.score !== null) {
      totalWeightedScore += dimData.score * dimData.assessedWeight;
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

function buildNotAssessedModel(input, evidence, scoredAt) {
  const perfScore = scorePerformance(evidence.performance);
  const renderingDiagnostics = classifyRenderingDiagnostics(evidence.performance, { now: scoredAt });

  const hasPerformance = isPerformanceViable(evidence.performance);
  const perfEvidenceScore = hasPerformance ? 25 : 0;

  // Evidence confidence with crawl unavailable
  const evidenceConfidence = calculateEvidenceConfidence(evidence, [], scoredAt);
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
    contractVersion: "1.0.0",
    reportVersion: SCORING_VERSION,
    scoringVersion: SCORING_VERSION,
    generatedAt: scoredAt,
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
    evidenceConfidenceFactorAvailability: evidenceConfidence.factorAvailability,
    dimensionEligibility: Object.fromEntries(
      Object.keys(DIMENSIONS).map((k) => [k, false]),
    ),
    moduleEligibility: Object.fromEntries(
      Object.values(MODULES).map((m) => [m.id, false]),
    ),
    suppressedModules,
    rootCause,
    findings: [],
    suppressedFindingReasons: [],
    // WP-D capability transparency + AI-readiness basis on the
    // Not-Assessed path too (renderers may read these unconditionally).
    capabilityEvidence: {
      capabilityEvidenceVersion: "2.0.0",
      summary: { total: 0, available: 0, partial: 0, unavailable: 0, failed: 0, notConnected: 0, notApplicable: 0, assessed: 0 },
      capabilities: {},
    },
    aiReadinessBasis: "structural",
    aiReadinessLimitation: "Crawl evidence unavailable — machine-readability readiness was not assessed.",
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
    competitors: competitorComparison(evidence.competitors || [], evidence.competitorOpportunities),
    competitorOpportunities: evidence.competitorOpportunities,
    evidence,
    renderingDiagnostics: renderingDiagnostics.diagnostics,
    _crawlSuppressed: true,
  };
}

// ---------------------------------------------------------------------------
// Main scoring entry point
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic scoring timestamp from locked canonical evidence.
 *
 * Uses the latest `collectedAt` across all evidence sources.  When an
 * explicit `scoredAt` is provided (e.g. from the orchestrator's lifecycle
 * clock), that value is used instead.
 *
 * This replaces `new Date().toISOString()` so identical evidence always
 * produces identical `generatedAt` — required by WP7 determinism.
 */
function deriveScoredAt(evidence, explicitScoredAt) {
  if (explicitScoredAt) return explicitScoredAt;

  const timestamps = [];
  const sources = ["site", "performance", "ga4", "gsc", "backlinks"];
  for (const key of sources) {
    const ev = evidence[key];
    const ts = ev?.collectedAt || ev?._sourceStatus?.completedAt;
    if (ts) timestamps.push(new Date(ts).getTime());
  }
  // Also check competitors array
  const competitors = evidence.competitors || [];
  for (const c of competitors) {
    if (c.collectedAt) timestamps.push(new Date(c.collectedAt).getTime());
  }

  if (timestamps.length === 0) {
    // Fallback: use site timestamp or a fixed epoch
    return new Date(0).toISOString();
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

export function scoreAudit(input, evidence, opts = {}) {
  const site = evidence.site;
  const performance = evidence.performance;
  const scoredAt = deriveScoredAt(evidence, opts.scoredAt);

  // PRYSM-NEXT-01 WP-D-02 — capability evidence.  When the caller supplies
  // the governed persisted artifact (scoring-service), use it.  Otherwise
  // (legacy harness path) derive deterministically from the SAME evidence —
  // derivation is pure, so both paths produce identical capability maps.
  const capabilityEvidence = opts.capabilityEvidence
    || buildCapabilityEvidence({
      decisionEvidence: evidence,
      auditId: input?.auditId || input?.id || "derived",
      generatedAt: scoredAt,
    });
  const capabilities = capabilityEvidence.capabilities || {};

  // ── Crawl gate (PRD v3.0 §8.6) ────────────────────────────────────
  // A viable status without actual crawl content (domain + pages) is
  // treated as unavailable — prevents hollow evidence from masquerading
  // as a valid crawl.  Domain is mandatory: without it the renderer and
  // scoring modules cannot function correctly.
  const hasCrawlContent = site && site.domain && Array.isArray(site.pages) && site.pages.length > 0;
  if (!isCrawlViable(site) || !hasCrawlContent) {
    if (!site || !hasCrawlContent) {
      // Build a complete fallback site so renderer sections never encounter
      // undefined fields.  Preserve any actual evidence the site already has.
      const fallbackSite = {
        sourceStatus: site?.sourceStatus || SOURCE_STATUS.UNAVAILABLE,
        pageCount: site?.pageCount || 0,
        pages: site?.pages || [],
        services: site?.services || [],
        topicKeywords: site?.topicKeywords || [],
        ctas: site?.ctas || [],
        forms: site?.forms || [],
        schemaTypes: site?.schemaTypes || [],
        socialLinks: site?.socialLinks || [],
        brokenInternalLinks: site?.brokenInternalLinks || [],
        externalCtas: site?.externalCtas || [],
        trust: site?.trust || {},
        securityHeaders: site?.securityHeaders || {},
        domain: site?.domain || undefined,
        platform: site?.platform || undefined,
        targetUrl: site?.targetUrl || undefined,
        totalWords: site?.totalWords || 0,
        averageWords: site?.averageWords || 0,
        missingTitles: site?.missingTitles || 0,
        missingDescriptions: site?.missingDescriptions || 0,
        missingCanonicals: site?.missingCanonicals || 0,
        h1Missing: site?.h1Missing || 0,
        h1Multiple: site?.h1Multiple || 0,
        imageCount: site?.imageCount || 0,
        imagesMissingAlt: site?.imagesMissingAlt || 0,
        internalLinkCount: site?.internalLinkCount || 0,
        statusCounts: site?.statusCounts || {},
        limitations: [...(site?.limitations || []), "No crawl evidence in canonical payload"],
        _contentEvidenceAvailable: site?._contentEvidenceAvailable || false,
        _responseHeadersAvailable: site?._responseHeadersAvailable || false,
      };
      return buildNotAssessedModel(input, { ...evidence, site: fallbackSite }, scoredAt);
    }
    return buildNotAssessedModel(input, evidence, scoredAt);
  }

  // ── Score modules with source + capability gates ────────────────────
  const {
    moduleResults,
    dimensionScores,
    overallAssessedWeight,
  } = scoreModules(evidence, capabilities, input);

  // ── Build legacy score map ─────────────────────────────────────────
  const legacyScores = buildLegacyScoreMap(
    dimensionScores,
    moduleResults,
    site,
    performance,
  );

  // ── Funnel-stage scores ────────────────────────────────────────────
  const funnelScores = computeFunnelScores(site, dimensionScores, capabilities);

  // ── Rendering-integrity diagnostics ─────────────────────────────────
  const renderingDiagnostics = classifyRenderingDiagnostics(performance, { now: scoredAt });

  // ── Build findings (capability-gated — WP-D-11) ─────────────────────
  const gsc = evidence.gsc;
  const suppressedFindingReasons = [];
  const findings = buildFindings(site, performance, gsc, {
    capabilities,
    suppressedReasons: suppressedFindingReasons,
  });

  // Append rendering-diagnostic findings for material site-rendering defects
  const diagnosticFindings = buildRenderingDiagnosticFindings(
    renderingDiagnostics.diagnostics,
    site,
  );
  for (const df of diagnosticFindings) {
    findings.push(df);
  }
  // Re-sort after adding diagnostic findings
  findings.sort((a, b) => b.finalPriority - a.finalPriority);

  // ── Evidence confidence ────────────────────────────────────────────
  const evidenceConfidence = calculateEvidenceConfidence(evidence, findings, scoredAt);

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
  // Select the single highest-priority score-bearing finding as the
  // primary constraint.  Avoid comma-separated defect lists — the root
  // cause must describe ONE business constraint in plain client language.
  const primaryFinding = findings.find((f) => f.scoreBearing);
  const rootCause = primaryFinding
    ? `The most impactful opportunity is ${primaryFinding.title.toLowerCase()}. ${primaryFinding.businessImpact || "Addressing this will improve visitor confidence and readiness to convert."}`
    : findings.length > 0
      ? "Several technical opportunities were identified, but evidence depth was insufficient to isolate a single primary constraint. Strengthening crawl or analytics evidence will produce more targeted recommendations."
      : "The site has a functional foundation. The main opportunity is to strengthen evidence depth and make each offer easier to evaluate.";

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
    contractVersion: "1.0.0",
    reportVersion: SCORING_VERSION,
    scoringVersion: SCORING_VERSION,
    generatedAt: scoredAt,
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
    evidenceConfidenceFactorAvailability: evidenceConfidence.factorAvailability,

    // Module and dimension eligibility
    dimensionEligibility,
    moduleEligibility,
    suppressedModules,
    // WP-G: additive per-module score map for pillar display.  Same values
    // already consumed internally — display aggregation only, no scoring
    // semantics change.
    moduleScores: Object.fromEntries(
      [...moduleResults.entries()].map(([id, r]) => [
        id,
        {
          score: r.score,
          eligible: r.eligible,
          weight: r.weight,
          reason: r.reason || null,
          ...(r.subWeightAssessed != null ? { subWeightAssessed: r.subWeightAssessed } : {}),
        },
      ]),
    ),

    // Findings, root cause, and display content
    rootCause,
    findings,
    suppressedFindingReasons,
    conversionPaths: buildConversionPaths(site),
    readinessMap: topicRows(site, input, capabilities),
    contentIdeas: contentIdeas(site, input),
    competitors: competitorComparison(evidence.competitors || [], evidence.competitorOpportunities),
    competitorOpportunities: evidence.competitorOpportunities,
    evidence,
    renderingDiagnostics: renderingDiagnostics.diagnostics,

    // ── PRYSM-NEXT-01 WP-D capability transparency ──────────────────────
    capabilityEvidence: {
      capabilityEvidenceVersion: capabilityEvidence.capabilityEvidenceVersion,
      summary: capabilityEvidence.summary,
      capabilities,
    },
    // WP-D-07 — the AI-readiness number is structural machine-readability
    // only; it is never described as actual AI visibility.
    aiReadinessBasis: "structural",
    aiReadinessLimitation:
      capabilities["schema.structured_data"]?.status === "AVAILABLE" ||
      capabilities["schema.structured_data"]?.status === "PARTIAL"
        ? null
        : "Structured-data evidence was not collected — machine-readability readiness is scored on available signals only.",
  };
}

// Re-export for external consumers
export { SCORING_VERSION, DIMENSIONS, MODULES };

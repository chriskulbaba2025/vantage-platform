/**
 * Report Finalization Gate
 *
 * Mandatory validation run after evidence normalization and scoring, but
 * before report rendering.  Prevents contradictory, incomplete, or
 * commercially weak reports from reaching client-facing output.
 *
 * When validation fails the audit stays in draft and structured errors
 * are attached to the model so the auditor can see exactly what conflicts.
 */

import { SOURCE_STATUS } from "./evidence-contracts.js";
import { DIAGNOSTIC_CATEGORY } from "./diagnostic-contracts.js";
import { buildFoundationChecklist } from "../report/foundation-readiness.js";
import { buildActionPlan } from "../report/action-priority.js";

// ---------------------------------------------------------------------------
// Gate entry point
// ---------------------------------------------------------------------------

/**
 * Run the report-finalization gate against a scored model.
 *
 * @param {object} model    - Scored audit model from scoreAudit().
 * @param {object} evidence - Normalized evidence envelope.
 * @returns {{ passed: boolean, errors: ValidationError[], warnings: ValidationError[], model: object }}
 */
export function runFinalizationGate(model, evidence) {
  const errors = [];
  const warnings = [];

  // ── 0. Normalize evidence before validation ─────────────────────────
  _normalizeEvidenceForGate(model, evidence);

  // ── 1. Evidence consistency ─────────────────────────────────────────
  _checkSectionConsistency(model, evidence, errors);

  // ── 2. Contradiction detection ──────────────────────────────────────
  _checkContradictions(model, evidence, errors, warnings);

  // ── 3. Recalculate confidence from actual assessed evidence ──────────
  const recalculatedConfidence = _recalculateConfidence(evidence, model);

  // ── 4. Map findings to service categories ───────────────────────────
  const serviceCategories = _mapServiceCategories(model.findings || []);

  // ── 5. Generate dominant commercial recommendation ──────────────────
  const commercialRecommendation = _generateCommercialRecommendation(
    model.findings || [],
    model.scores,
    model.bands,
    evidence,
  );

  // ── 6. Required next action ─────────────────────────────────────────
  const nextAction = "Book an implementation scoping session to determine whether targeted remediation or a full redesign is the better investment.";

  // ── 7. Booking CTA ──────────────────────────────────────────────────
  const bookingCta = _buildBookingCta(model);

  // ── Attach gate output to model ─────────────────────────────────────
  const gatedModel = {
    ...model,
    _gate: {
      passed: errors.length === 0,
      errors: errors.map((e) => ({ field: e.field, section: e.section, message: e.message, severity: e.severity })),
      warnings: warnings.map((w) => ({ field: w.field, section: w.section, message: w.message, severity: w.severity })),
      evidenceConfidence: recalculatedConfidence,
      serviceCategories,
      commercialRecommendation,
      nextAction,
      bookingCta,
      validatedAt: new Date().toISOString(),
    },
  };

  return { passed: errors.length === 0, errors, warnings: [...warnings], model: gatedModel };
}

// ---------------------------------------------------------------------------
// 0. Normalize evidence before gate validation
// ---------------------------------------------------------------------------

/**
 * Normalize evidence fields that the gate validates against so both sides
 * of every comparison derive from the same canonical source.
 *
 * - Deduplicate performance limitations before any check.
 * - Recalculate coverage from only usable results.
 * - Align competitor counts to a single source.
 * - Downgrade source status when no usable results exist.
 */
function _normalizeEvidenceForGate(model, evidence) {
  const perf = evidence.performance || {};

  // Deduplicate limitations in place
  if (Array.isArray(perf.limitations)) {
    perf.limitations = [...new Set(perf.limitations)];
  }

  // Recalculate usable result count
  const mobileUsable = _isPerfUsable(perf.mobile);
  const desktopUsable = _isPerfUsable(perf.desktop);
  const usableCount = (mobileUsable ? 1 : 0) + (desktopUsable ? 1 : 0);
  const totalReq = (perf.coverage?.requested) || 2;

  // Store corrected coverage so downstream checks use it
  if (!perf._normalizedCoverage) {
    perf._normalizedCoverage = {
      requested: totalReq,
      completed: usableCount,
      failed: totalReq - usableCount,
    };
  }

  // Downgrade source status when no usable results exist despite AVAILABLE claim
  if (perf.sourceStatus === SOURCE_STATUS.AVAILABLE && usableCount === 0) {
    // Source claims available but no result is actually usable
    // Don't mutate the canonical status — add a gate-level override
    if (!perf._effectiveSourceStatus) {
      perf._effectiveSourceStatus = SOURCE_STATUS.FAILED;
    }
  }

  // Align competitor counts: use evidence.competitors as canonical source
  const evidenceCompetitors = Array.isArray(evidence.competitors)
    ? evidence.competitors.filter(Boolean)
    : [];
  if (!model._normalizedCompetitorCount) {
    model._normalizedCompetitorCount = evidenceCompetitors.length;
    // Sync model.competitors to evidence if they differ
    if (!Array.isArray(model.competitors) || model.competitors.length !== evidenceCompetitors.length) {
      model._normalizedCompetitors = evidenceCompetitors;
    }
  }
}

/**
 * A performance strategy result is usable only when it has score-bearing
 * metrics.  Rendering defects, missing FCP/LCP, or null performance scores
 * mean the result is NOT usable.
 */
function _isPerfUsable(strategy) {
  if (!strategy || strategy.status !== SOURCE_STATUS.AVAILABLE) return false;
  if (strategy.scores?.performance == null) return false;
  if (strategy.metrics?.fcpMs == null) return false;
  if (strategy.metrics?.lcpMs == null) return false;
  if (strategy.runtimeError?.code) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 1. Evidence consistency validation
// ---------------------------------------------------------------------------

function _checkSectionConsistency(model, evidence, errors) {
  const perf = evidence.performance || {};
  const site = evidence.site || {};

  // Use normalized coverage when available (from _normalizeEvidenceForGate)
  const effectiveCoverage = perf._normalizedCoverage || perf.coverage || {};
  const effectiveCompleted = effectiveCoverage.completed || 0;
  const effectiveSourceStatus = perf._effectiveSourceStatus || perf.sourceStatus;

  // Performance status vs. scorecard — use normalized counts
  const perfAvailable =
    effectiveSourceStatus === SOURCE_STATUS.AVAILABLE ||
    effectiveSourceStatus === SOURCE_STATUS.PARTIAL;
  const hasPerfScore = model.scores.performance !== null;

  if (perfAvailable && !hasPerfScore && effectiveSourceStatus !== SOURCE_STATUS.FAILED) {
    if (effectiveCompleted > 0) {
      errors.push(_err("scores.performance", "experience-and-performance",
        `Performance source is ${effectiveSourceStatus} with ${effectiveCompleted} completed tests but performance score is null.`));
    }
  }

  // Source status vs. gate results — use normalized coverage
  if (effectiveSourceStatus === SOURCE_STATUS.AVAILABLE) {
    const mobile = perf.mobile || {};
    const desktop = perf.desktop || {};
    const hasUsableMetrics =
      (mobile.metrics?.fcpMs != null && mobile.metrics?.lcpMs != null) ||
      (desktop.metrics?.fcpMs != null && desktop.metrics?.lcpMs != null);
    if (!hasUsableMetrics && effectiveCompleted > 0) {
      errors.push(_err("performance.coverage", "experience-and-performance",
        `Performance source is AVAILABLE with ${effectiveCompleted} completed results but no usable FCP/LCP metrics.`));
    }
  }

    // PF-18 - client-facing competitor comparisons must remain inside the
  // authoritative supplied competitor allowlist carried by DecisionEvidence.
  const suppliedCompetitors =
    Array.isArray(evidence.suppliedCompetitors)
      ? evidence.suppliedCompetitors
      : null;

  const clientCompetitors =
    Array.isArray(model.competitors?.comparisons)
      ? model.competitors.comparisons
      : [];

  if (
    clientCompetitors.length > 0 &&
    suppliedCompetitors === null
  ) {
    errors.push(_err(
      "competitors.comparisons",
      "supplied-competitor-benchmark",
      "Client-facing competitor comparisons exist but the supplied competitor allowlist is unavailable.",
    ));
  } else if (suppliedCompetitors !== null) {
    const allowedUrls =
      new Set(
        suppliedCompetitors.filter(
          (url) =>
            typeof url === "string" &&
            url.length > 0,
        ),
      );

    for (const competitor of clientCompetitors) {
      if (
        typeof competitor?.url !== "string" ||
        !allowedUrls.has(competitor.url)
      ) {
        errors.push(_err(
          "competitors.comparisons",
          "supplied-competitor-benchmark",
          `Client-facing competitor ${competitor?.url || "<missing-url>"} is outside the supplied competitor allowlist.`,
        ));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Contradiction detection
// ---------------------------------------------------------------------------

function _checkContradictions(model, evidence, errors, warnings) {
  const perf = evidence.performance || {};
  // Use normalized coverage when available
  const effectiveCoverage = perf._normalizedCoverage || perf.coverage || {};
  const effectiveCompleted = effectiveCoverage.completed || 0;
  const effectiveSourceStatus = perf._effectiveSourceStatus || perf.sourceStatus;

  // AVAILABLE paired with N/A or unusable metrics
  for (const key of ["performance", "accessibility", "bestPractices", "seo"]) {
    const score = model.scores[key];
    if (score === null && perf.sourceStatus === SOURCE_STATUS.AVAILABLE) {
      warnings.push(_err(`scores.${key}`, "executive-conversion-scorecard",
        `Score "${key}" is null despite performance source being AVAILABLE.`));
    }
  }

  // PASS paired with UNAVAILABLE evidence
  const perfGate = model.evidence?.performance?.sourceStatus;
  if (perfGate === SOURCE_STATUS.UNAVAILABLE || perfGate === SOURCE_STATUS.FAILED) {
    const perfScores = model.scores;
    if (perfScores.performance !== null) {
      errors.push(_err("scores.performance", "evidence-appendix",
        `Performance score is ${perfScores.performance} but performance source is ${perfGate}.`));
    }
  }

  // High confidence unsupported by assessed evidence.
  // PRYSM-INCIDENT-01: readiness and confidence are SEPARATE axes
  // (PRD v3 §3.1).  When assessed weight is below 60% the scoring model
  // already declares "Insufficient Evidence for Overall Score" and
  // suppresses the numeric score (showNumericScore=false) — that is a
  // GOVERNED output state, not a contradiction.  The gate must render
  // that honest state (both report designs render it), not fail the
  // whole pipeline.  The rule only protects against a numeric score
  // being shown with high confidence from thin assessed evidence.
  const confidenceScore = model.evidenceConfidenceScore || 0;
  const assessedWeight = model.assessedWeight || 0;
  if (model.showNumericScore !== false && confidenceScore >= 85 && assessedWeight < 60) {
    errors.push(_err("evidenceConfidenceScore", "evidence-appendix",
      `Evidence confidence is ${confidenceScore} (High) but assessed weight is only ${assessedWeight}%. High confidence requires at least 60% assessed weight.`));
  }

  // Completed tests that produced unusable results — use normalized coverage
  const rawCompleted = effectiveCompleted;
  const renderingDiags = model.renderingDiagnostics || [];
  const siteDefects = renderingDiags.filter(
    (d) => d.diagnosticCategory === DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  );
  if (rawCompleted > 0 && siteDefects.length > 0) {
    errors.push(_err("performance.coverage", "experience-and-performance",
      `Coverage reports ${rawCompleted} completed tests but ${siteDefects.length} site-rendering defects were detected. Unusable results must not count as completed.`));
  }

  // Duplicate limitations — already deduped by _normalizeEvidenceForGate,
  // but check again in case normalization was skipped
  const allLimits = perf.limitations || [];
  const uniqueLimits = new Set(allLimits);
  if (uniqueLimits.size < allLimits.length) {
    errors.push(_err("performance.limitations", "evidence-appendix",
      `Performance limitations contain ${allLimits.length - uniqueLimits.size} duplicate entries.`));
  }

    // Null or undefined top-level denominators
  if (model.assessedWeight == null) {
    errors.push(_err("assessedWeight", "executive-conversion-scorecard",
      "Assessed weight is null or undefined."));
  }
  if (model.evidenceConfidenceScore == null) {
    errors.push(_err("evidenceConfidenceScore", "evidence-appendix",
      "Evidence confidence score is null or undefined."));
  }

// PF-18 — final release independently rejects impossible image
// numerator/denominator states.
//
// DecisionEvidence v1 must serialize unknown counters as integers, so an
// unavailable imageCount may appear as 0. DataForSEO can still provide
// bounded image issue counters while image-array evidence is unavailable.
// Do not convert that schema placeholder into a false zero denominator.
const site = evidence.site || {};
const imageDenominator = site.imageCount;

const imageDenominatorUnavailable =
  site._metaFieldAvailability?.images === false ||
  (
    site._metaFieldAvailability?.images == null &&
    site._contentEvidenceAvailable === false &&
    (
      imageDenominator == null ||
      imageDenominator === 0
    )
  );

if (
  imageDenominator != null &&
  (
    !Number.isFinite(imageDenominator) ||
    imageDenominator < 0
  )
) {
  errors.push(_err(
    "site.imageCount",
    "technical-health",
    `Image count must be a non-negative finite denominator, got ${String(imageDenominator)}.`,
  ));
}

for (
  const field of [
    "imagesMissingAlt",
    "imagesMissingDimensions",
  ]
) {
  const numerator = site[field];

  if (numerator == null) continue;

  if (
    !Number.isFinite(numerator) ||
    numerator < 0
  ) {
    errors.push(_err(
      `site.${field}`,
      "technical-health",
      `${field} must be a non-negative finite numerator, got ${String(numerator)}.`,
    ));
    continue;
  }

  // A numerator may legitimately exist when the corresponding image
  // denominator was unavailable and subsequently schema-coerced to 0.
  // In that state there is no valid ratio to test.
  if (imageDenominatorUnavailable) {
    continue;
  }

  if (
    !Number.isFinite(imageDenominator) ||
    imageDenominator < 0 ||
    numerator > imageDenominator
  ) {
    errors.push(_err(
      `site.${field}`,
      "technical-health",
      `${field} (${numerator}) cannot exceed or exist without a valid imageCount denominator (${String(imageDenominator)}).`,
    ));
  }
}

  // Undefined values in client-facing text
  for (const f of (model.findings || [])) {
    if (f.title == null || f.title === "") {
      errors.push(_err("findings[].title", "priority-fixes",
        `Finding ${f.ruleId || "unknown"} has null or empty title.`));
    }
    if (f.businessImpact == null || f.businessImpact === "") {
      warnings.push(_err("findings[].businessImpact", "priority-fixes",
        `Finding ${f.ruleId || "unknown"} has null or empty businessImpact.`));
    }
    if (f.recommendation == null || f.recommendation === "") {
      warnings.push(_err("findings[].recommendation", "priority-fixes",
        `Finding ${f.ruleId || "unknown"} has null or empty recommendation.`));
    }

    // PF-18 — final release backstop for the proven PARTIAL-to-absence defect.
    // When every evidence record supporting a finding is PARTIAL, an absence
    // claim must explicitly preserve the incomplete assessment boundary.
    const findingEvidence =
      Array.isArray(f.evidence)
        ? f.evidence.filter(Boolean)
        : [];

    const partialOnly =
      findingEvidence.length > 0 &&
      findingEvidence.every(
        (record) =>
          record.sourceStatus ===
          SOURCE_STATUS.PARTIAL,
      );

    if (partialOnly) {
      const claimText = [
        f.title,
        f.evidenceText,
        f.businessImpact,
      ]
        .filter(Boolean)
        .join(" ");

      const absencePattern =
        /\b(missing|absent|none|lacks?|without)\b|\bno\b|\bdoes not have\b/i;

      const boundedPartialPattern =
        /\b(partial|available assessment|available coverage|observed scope|not detected|not observed|does not establish|absence is not established)\b/i;

      if (
        absencePattern.test(claimText) &&
        !boundedPartialPattern.test(claimText)
      ) {
        errors.push(_err(
          "findings[].evidence",
          "priority-fixes",
          `Finding ${f.ruleId || "unknown"} converts PARTIAL evidence into an unqualified absence claim.`,
        ));
      }
    }
  }

  // Root cause must agree with the governed Conversion-First action hierarchy.
  const checklist = buildFoundationChecklist(model);
  const actionPlan = buildActionPlan(model, checklist);
  const legacyRootCauseFinding = (model.findings || []).find(
    (finding) => finding?.scoreBearing === true,
  );

  const rootCauseRuleId =
    model.rootCauseRuleId ||
    legacyRootCauseFinding?.ruleId ||
    null;

  const primaryActionFinding =
    actionPlan.actions[0]?.finding;

  if (
    rootCauseRuleId &&
    primaryActionFinding &&
    rootCauseRuleId !== primaryActionFinding.ruleId
  ) {
    errors.push(_err(
      "rootCause",
      "executive-conversion-scorecard",
      `Root cause is derived from ${rootCauseRuleId}, but the governed Conversion-First action hierarchy ranks ${primaryActionFinding.ruleId} first.`,
    ));
  }

  // Conflicting scores between sections
  const perfScore = model.scores.performance;
  const technicalScore = model.scores.technical;
  if (perfScore !== null && technicalScore !== null && Math.abs(perfScore - technicalScore) > 60) {
    warnings.push(_err("scores", "executive-conversion-scorecard",
      `Performance score (${perfScore}) and technical hygiene score (${technicalScore}) diverge by more than 60 points.`));
  }
}

// ---------------------------------------------------------------------------
// 3. Recalculate evidence confidence from actual assessed evidence only
// ---------------------------------------------------------------------------

function _recalculateConfidence(evidence, model) {
  const site = evidence.site || {};
  const perf = evidence.performance || {};
  const ga4 = evidence.ga4 || {};
  const gsc = evidence.gsc || {};
  const backlinks = evidence.backlinks || {};

  // Count how many evidence sources are meaningfully available
  let availableSources = 0;
  let totalSources = 4; // site, performance, ga4, gsc

  if (site.sourceStatus === SOURCE_STATUS.AVAILABLE || site.sourceStatus === SOURCE_STATUS.PARTIAL) {
    availableSources++;
  }
  if (perf.sourceStatus === SOURCE_STATUS.AVAILABLE || perf.sourceStatus === SOURCE_STATUS.PARTIAL) {
    // Only count if usable results exist
    if ((perf.coverage?.completed || 0) > 0) availableSources++;
    else totalSources--; // Don't penalize for unavailable performance
  }
  if (ga4.sourceStatus === SOURCE_STATUS.AVAILABLE) availableSources++;
  else if (ga4.sourceStatus === SOURCE_STATUS.NOT_CONNECTED) totalSources--;
  if (gsc.sourceStatus === SOURCE_STATUS.AVAILABLE && gsc.sufficiency?.sufficient !== false) availableSources++;
  else if (gsc.sourceStatus === SOURCE_STATUS.NOT_CONNECTED) totalSources--;

  // Optional backlinks
  if (backlinks.sourceStatus === SOURCE_STATUS.AVAILABLE) availableSources++;
  else totalSources--;

  const sourceCoverage = totalSources > 0 ? availableSources / totalSources : 0;

  // Data completeness factor
  const totalRequested = (perf.coverage?.requested || 0);
  const totalCompleted = (perf.coverage?.completed || 0);
  const dataCompleteness = totalRequested > 0 ? totalCompleted / totalRequested : 1;

  // Combine into a 0-100 confidence score
  const raw = (sourceCoverage * 0.6 + dataCompleteness * 0.4) * 100;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

// ---------------------------------------------------------------------------
// 4. Service category mapping
// ---------------------------------------------------------------------------

const CATEGORY_RULES = [
  { category: "website redesign", keywords: ["redesign", "rebuild", "platform", "cms", "architecture", "structure", "navigation", "blank page", "rendering"] },
  { category: "technical remediation", keywords: ["performance", "speed", "meta", "heading", "alt text", "schema", "security header", "https", "image", "dimension", "lcp", "fcp", "cls", "tbt", "mobile"] },
  { category: "content strategy", keywords: ["content", "copy", "headline", "cta", "offer", "service", "trust", "testimonial", "case study", "faq", "pricing", "keyword", "topic"] },
  { category: "ongoing content management", keywords: ["blog", "article", "seo", "link", "backlink", "internal link", "gsc", "search console", "ctr", "ranking", "query"] },
  { category: "support and maintenance", keywords: ["plugin", "update", "ssl", "certificate", "hosting", "backup", "maintenance", "patch", "monitoring"] },
];

function _mapServiceCategories(findings) {
  const matched = new Map();
  for (const f of findings) {
    const text = `${f.title || ""} ${f.recommendation || ""} ${f.key || ""}`.toLowerCase();
    for (const rule of CATEGORY_RULES) {
      for (const kw of rule.keywords) {
        if (text.includes(kw)) {
          if (!matched.has(rule.category)) matched.set(rule.category, []);
          matched.get(rule.category).push(f.ruleId);
          break;
        }
      }
    }
  }
  return [...matched.keys()];
}

// ---------------------------------------------------------------------------
// 5. Commercial recommendation
// ---------------------------------------------------------------------------

function _generateCommercialRecommendation(findings, scores, bands, evidence) {
  if (!findings || findings.length === 0) {
    return "The site has a functional foundation. The main commercial opportunity is to strengthen evidence depth through ongoing content and conversion-path optimization.";
  }

  const scoreBearing = findings.filter((f) => f.scoreBearing);
  const highSev = scoreBearing.filter((f) => f.severity === "High");
  const mediumSev = scoreBearing.filter((f) => f.severity === "Medium");

  const categories = _mapServiceCategories(scoreBearing);

  if (highSev.length >= 3 && categories.includes("website redesign")) {
    return "A strategic website redesign is recommended to address critical conversion-path, trust-signal, and technical-hygiene issues. Targeted remediation alone is unlikely to close the identified gaps efficiently.";
  }

  if (highSev.length >= 2) {
    return "Targeted technical and content remediation is recommended to strengthen conversion readiness. The site's foundation is viable but several high-impact issues require focused attention before performance marketing investment.";
  }

  if (highSev.length === 1 || mediumSev.length >= 3) {
    return "Moderate remediation focused on content strategy and technical hygiene is recommended. The site is largely functional but would benefit from evidence-based improvements to trust signals and conversion pathways.";
  }

  return "The site has a solid foundation. Ongoing optimization and content development will strengthen its competitive position. Consider incremental improvements guided by the priority fixes in this report.";
}

// ---------------------------------------------------------------------------
// 7. Booking CTA
// ---------------------------------------------------------------------------

function _buildBookingCta(model) {
  const business = model.input?.businessName || model.evidence?.site?.domain || "the business";
  return {
    text: `Book an implementation scoping session for ${business}`,
    action: "schedule",
    visible: true,
    placement: "report-footer",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _err(field, section, message, severity = "error") {
  return { field, section, message, severity };
}

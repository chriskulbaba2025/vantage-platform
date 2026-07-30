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
// 1. Evidence consistency validation
// ---------------------------------------------------------------------------

function _checkSectionConsistency(model, evidence, errors) {
  const perf = evidence.performance || {};
  const site = evidence.site || {};

  // Performance status vs. scorecard
  const perfAvailable =
    perf.sourceStatus === SOURCE_STATUS.AVAILABLE ||
    perf.sourceStatus === SOURCE_STATUS.PARTIAL;
  const hasPerfScore = model.scores.performance !== null;

  if (perfAvailable && !hasPerfScore && perf.sourceStatus !== SOURCE_STATUS.FAILED) {
    // Only flag if source claims available but score is null AND usable results exist
    if ((perf.coverage?.completed || 0) > 0) {
      errors.push(_err("scores.performance", "experience-and-performance",
        `Performance source is ${perf.sourceStatus} with ${perf.coverage?.completed || 0} completed tests but performance score is null.`));
    }
  }

  // Source status vs. gate results
  if (perf.sourceStatus === SOURCE_STATUS.AVAILABLE) {
    // Check that not all metrics are null despite AVAILABLE
    const mobile = perf.mobile || {};
    const desktop = perf.desktop || {};
    const hasUsableMetrics =
      (mobile.metrics?.fcpMs != null && mobile.metrics?.lcpMs != null) ||
      (desktop.metrics?.fcpMs != null && desktop.metrics?.lcpMs != null);
    if (!hasUsableMetrics && (perf.coverage?.completed || 0) > 0) {
      errors.push(_err("performance.coverage", "experience-and-performance",
        `Performance source is AVAILABLE with ${perf.coverage?.completed || 0} completed results but no usable FCP/LCP metrics.`));
    }
  }

  // Competitor count consistency — only when competitors were supplied
  const modelCompetitors = Array.isArray(model.competitors) ? model.competitors : [];
  const evidenceCompetitors = Array.isArray(evidence.competitors) ? evidence.competitors : [];
  if (evidenceCompetitors.filter(Boolean).length > 0 &&
      modelCompetitors.length !== evidenceCompetitors.filter(Boolean).length) {
    errors.push(_err("competitors.length", "supplied-competitor-benchmark",
      `Model competitor count (${modelCompetitors.length}) does not match evidence competitor count (${evidenceCompetitors.filter(Boolean).length}).`));
  }
}

// ---------------------------------------------------------------------------
// 2. Contradiction detection
// ---------------------------------------------------------------------------

function _checkContradictions(model, evidence, errors, warnings) {
  const perf = evidence.performance || {};

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

  // High confidence unsupported by assessed evidence
  const confidenceScore = model.evidenceConfidenceScore || 0;
  const assessedWeight = model.assessedWeight || 0;
  if (confidenceScore >= 85 && assessedWeight < 60) {
    errors.push(_err("evidenceConfidenceScore", "evidence-appendix",
      `Evidence confidence is ${confidenceScore} (High) but assessed weight is only ${assessedWeight}%. High confidence requires at least 60% assessed weight.`));
  }

  // Completed tests that produced unusable results
  const completed = perf.coverage?.completed || 0;
  const renderingDiags = model.renderingDiagnostics || [];
  const siteDefects = renderingDiags.filter(
    (d) => d.diagnosticCategory === DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  );
  if (completed > 0 && siteDefects.length > 0) {
    errors.push(_err("performance.coverage", "experience-and-performance",
      `Coverage reports ${completed} completed tests but ${siteDefects.length} site-rendering defects were detected. Unusable results must not count as completed.`));
  }

  // Duplicate limitations
  const allLimits = evidence.performance?.limitations || [];
  const uniqueLimits = new Set(allLimits);
  if (uniqueLimits.size < allLimits.length) {
    errors.push(_err("performance.limitations", "evidence-appendix",
      `Performance limitations contain ${allLimits.length - uniqueLimits.size} duplicate entries.`));
  }

  // Null or undefined denominators
  if (model.assessedWeight == null) {
    errors.push(_err("assessedWeight", "executive-conversion-scorecard",
      "Assessed weight is null or undefined."));
  }
  if (model.evidenceConfidenceScore == null) {
    errors.push(_err("evidenceConfidenceScore", "evidence-appendix",
      "Evidence confidence score is null or undefined."));
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

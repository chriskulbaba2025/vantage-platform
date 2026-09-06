/**
 * PRYSM-NEXT-01 WP-G — five client-facing pillars for report design v2.
 *
 * Display-only aggregation over the v4 scoring model: each pillar is the
 * weighted mean of its modules' ELIGIBLE scores (null when none eligible).
 * No new scoring happens here; scores and capability statuses are read
 * from the governed model only.  Unavailable capabilities are displayed
 * as their canonical status — never imputed.
 */

import { MODULES } from "../scoring/score-components.js";

export const PILLAR_DEFS = Object.freeze([
  {
    id: "offer_content",
    label: "Offer & Content",
    modules: ["offer_clarity", "content_depth", "funnel_coverage"],
    capabilities: ["offer.clarity", "content.body"],
  },
  {
    id: "trust_proof",
    label: "Trust & Proof",
    modules: ["trust_signals", "risk_reduction"],
    capabilities: ["trust.proof", "technical.headers"],
  },
  {
    id: "conversion_path",
    label: "Conversion Path",
    modules: ["conversion_paths"],
    capabilities: ["conversion.cta", "conversion.form", "conversion.path"],
  },
  {
    id: "technical_health",
    label: "Technical Health",
    modules: ["technical_hygiene"],
    capabilities: [
      "technical.indexability",
      "technical.redirects",
      "technical.resources",
      "technical.headers",
    ],
  },
  {
    id: "performance_experience",
    label: "Performance & Experience",
    modules: ["performance"],
    capabilities: ["performance.lab", "performance.field"],
  },
]);

/**
 * @param {object} model — scored audit model (scoreAudit v4 output)
 * @returns {Array<object>} pillar records
 */
export function computePillars(model) {
  const moduleScores = model?.moduleScores || {};
  const caps = model?.capabilityEvidence?.capabilities || {};
  const pillars = [];

  for (const def of PILLAR_DEFS) {
    let weighted = 0;
    let weightSum = 0;
    const modules = [];

    for (const moduleId of def.modules) {
      const weight = MODULES[moduleId]?.weight ?? 0;
      const entry = moduleScores[moduleId];
      const score =
        entry && entry.eligible === true && typeof entry.score === "number"
          ? entry.score
          : null;
      if (score !== null) {
        weighted += score * weight;
        weightSum += weight;
      }
      modules.push({ moduleId, score, weight });
    }

    const capabilities = def.capabilities.map((key) => ({
      key,
      status: caps[key]?.status ?? "NOT_ASSESSED",
    }));
    // A missing capability is ordinarily shown in the dimension's existing
    // capability list.  The one client-facing readiness qualification needed
    // here is narrower: lab data cannot stand in for absent real-user field
    // performance evidence.
    const missingFieldPerformance =
      def.id === "performance_experience" &&
      caps["performance.field"]?.status !== "AVAILABLE";

    pillars.push({
      id: def.id,
      label: def.label,
      score: weightSum > 0 ? Math.round(weighted / weightSum) : null,
      assessedWeight: weightSum,
      totalWeight: def.modules.reduce(
        (sum, m) => sum + (MODULES[m]?.weight ?? 0),
        0,
      ),
      modules,
      capabilities,
      // This is a presentation qualifier, not a client-facing status. Keep
      // the consumer contract boolean so governance vocabulary cannot leak
      // into the rendered report.
      hasIncompleteFieldEvidence: missingFieldPerformance,
    });
  }

  return pillars;
}

export default { PILLAR_DEFS, computePillars };

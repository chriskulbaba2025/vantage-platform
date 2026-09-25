import { buildEncyclopediaProjection } from "../encyclopedia/index.js";
import { buildSemanticLedger } from "../report-intelligence/semantic-ledger.js";

/**
 * Canonical current report-model hydration boundary.
 *
 * Every current renderer/replay projection must consume this semantic object
 * after the persisted current ScoreSet has been validated.
 */
export function hydrateCurrentReportModel({ scoreSet, findings, decisionEvidence, capabilityEvidence, canonicalSolutions, encyclopediaProjection }) {
  if (!scoreSet || typeof scoreSet !== "object" || Array.isArray(scoreSet)) {
    throw new Error("Current report model requires a validated ScoreSet");
  }
  const hierarchy = scoreSet.decisionHierarchy;
  if (!hierarchy || !Array.isArray(hierarchy.actions) || !Array.isArray(hierarchy.orderedFindingIds)) {
    throw new Error("Current report model requires persisted decision hierarchy");
  }
  if (hierarchy.rootCauseRuleId !== scoreSet.rootCauseRuleId) {
    throw new Error("Current report model root-cause identity must match persisted hierarchy");
  }
  if (hierarchy.orderedFindingIds.length !== hierarchy.actions.length || hierarchy.actions.some((action, index) => action?.findingId !== hierarchy.orderedFindingIds[index])) {
    throw new Error("Current report model priority actions must match the persisted decision order");
  }
  if (hierarchy.actions.length > 0 && !scoreSet.rootCauseRuleId) {
    throw new Error("Current report model requires root-cause identity when accepted priorities exist");
  }
  if (hierarchy.actions.length > 0 && hierarchy.actions[0]?.ruleId !== scoreSet.rootCauseRuleId) {
    throw new Error("Current report model root cause must bind to the first accepted priority");
  }
  if (hierarchy.actions.length === 0 && scoreSet.rootCauseRuleId !== null) {
    throw new Error("Current report model cannot claim a root cause without accepted priorities");
  }
  if (typeof scoreSet.rootCause !== "string" || scoreSet.rootCause.trim().length === 0) {
    throw new Error("Current report model requires an explicit root-cause or no-priority disposition");
  }
  if (!scoreSet.crossReportInterpretation) {
    throw new Error("Current report model requires persisted cross-report interpretation");
  }
  if (!Array.isArray(findings)) throw new Error("Current report model requires findings");

  return {
    scoringVersion: scoreSet.scoringVersion,
    generatedAt: scoreSet.generatedAt,
    scores: scoreSet.scores,
    bands: scoreSet.bands,
    assessedWeight: scoreSet.assessedWeight,
    readinessStatus: scoreSet.readinessStatus,
    readinessStatusDetail: scoreSet.readinessStatusDetail,
    showNumericScore: scoreSet.showNumericScore,
    evidenceConfidenceScore: scoreSet.evidenceConfidenceScore,
    evidenceConfidenceFactorAvailability: scoreSet.evidenceConfidenceFactorAvailability,
    rootCauseRuleId: scoreSet.rootCauseRuleId,
    rootCause: scoreSet.rootCause,
    decisionHierarchy: scoreSet.decisionHierarchy,
    findings,
    renderingDiagnostics: scoreSet.renderingDiagnostics,
    suppressedFindingReasons: scoreSet.suppressedFindingReasons,
    moduleEligibility: scoreSet.moduleEligibility,
    moduleScores: scoreSet.moduleScores,
    suppressedModules: scoreSet.suppressedModules,
    capabilityEvidence,
    evidence: decisionEvidence,
    canonicalSolutions,
    encyclopedia: encyclopediaProjection || buildEncyclopediaProjection(findings),
    conversionPaths: scoreSet.conversionPaths,
    readinessMap: scoreSet.readinessMap,
    contentIdeas: scoreSet.contentIdeas,
    competitors: scoreSet.competitors,
    crossReportInterpretation: scoreSet.crossReportInterpretation,
    semanticLedger: buildSemanticLedger({
      scoreSet,
      findings,
      decisionEvidence,
      contentIdeas: scoreSet.contentIdeas,
    }),
  };
}

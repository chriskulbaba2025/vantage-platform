/**
 * Canonical current report-model hydration boundary.
 *
 * Every current renderer/replay projection must consume this semantic object
 * after the persisted current ScoreSet has been validated.
 */
export function hydrateCurrentReportModel({ scoreSet, findings, decisionEvidence, capabilityEvidence }) {
  if (!scoreSet || typeof scoreSet !== "object" || Array.isArray(scoreSet)) {
    throw new Error("Current report model requires a validated ScoreSet");
  }
  if (!scoreSet.decisionHierarchy || !scoreSet.rootCauseRuleId) {
    throw new Error("Current report model requires persisted decision hierarchy and root-cause identity");
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
    conversionPaths: scoreSet.conversionPaths,
    readinessMap: scoreSet.readinessMap,
    contentIdeas: scoreSet.contentIdeas,
    competitors: scoreSet.competitors,
  };
}

/**
 * Canonical report decision projection.
 *
 * The persisted ScoreSet decisionHierarchy is the only ranking authority for
 * client-facing report products. This module does not sort or infer priority
 * from input order, category, wording, or severity.
 */
export const CANONICAL_DECISION_MODEL_VERSION = "1.0.0";

export function buildCanonicalDecisionModel({ findings, scoreSet } = {}) {
  if (!Array.isArray(findings)) throw new Error("Canonical decision model requires findings");
  const hierarchy = scoreSet?.decisionHierarchy;
  if (!hierarchy || !Array.isArray(hierarchy.orderedFindingIds) || !Array.isArray(hierarchy.actions)) return null;

  const byId = new Map(findings.map((finding) => [finding?.findingId, finding]));
  const actionsById = new Map(hierarchy.actions.map((action) => [action?.findingId, action]));
  if (hierarchy.orderedFindingIds.some((findingId) => !byId.has(findingId) || !actionsById.has(findingId))) return null;
  const decisions = hierarchy.orderedFindingIds.map((findingId, rank) => {
    const finding = byId.get(findingId);
    const action = actionsById.get(findingId);
    return {
      findingId,
      rank: rank + 1,
      ruleId: finding.ruleId || action.ruleId || "",
      title: finding.title || "",
      category: finding.dimension || finding.module || "",
      evidence: finding.evidence || [],
      evidenceStatus: (finding.evidence || []).map((item) => item.status || item.sourceStatus || item._evidenceStatus || "UNKNOWN"),
      confidence: finding.confidence || "UNKNOWN",
      scoreBearing: finding.scoreBearing === true,
      severity: finding.severity || "Medium",
      finalPriority: typeof finding.finalPriority === "number" ? finding.finalPriority : action.priority ?? null,
      actionClass: action.actionClass || "OPTIMIZATION",
      foundationBlocker: action.actionClass === "FOUNDATION_BLOCKER",
      businessImpact: finding.businessImpact || "",
      recommendation: finding.recommendation || "",
      affectedUrls: finding.affectedUrls || [],
      sourceProvenance: "ScoreSet.decisionHierarchy",
    };
  });

  return {
    version: CANONICAL_DECISION_MODEL_VERSION,
    source: "persisted-score-set",
    orderedFindingIds: decisions.map((decision) => decision.findingId),
    decisions,
  };
}

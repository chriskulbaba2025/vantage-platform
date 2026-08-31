/** Current persisted ScoreSet boundary for the Production Closure contract. */
export const CURRENT_SCORESET_CONTRACT_VERSION = "2.0.0";
export const CURRENT_SCORESET_SCHEMA_ID =
  "https://vantage-platform.io/prysm/contracts/v2/score-current.schema.json";

export function assertCurrentScoreSet(scoreSet, { validateContract } = {}) {
  if (!scoreSet || typeof scoreSet !== "object" || Array.isArray(scoreSet)) {
    throw new Error("Current ScoreSet must be an object");
  }
  if (scoreSet.contractVersion !== CURRENT_SCORESET_CONTRACT_VERSION) {
    throw new Error(`Current ScoreSet requires contractVersion ${CURRENT_SCORESET_CONTRACT_VERSION}`);
  }
  const hierarchy = scoreSet.decisionHierarchy;
  if (!hierarchy || typeof hierarchy !== "object" || Array.isArray(hierarchy)) {
    throw new Error("Current ScoreSet requires decisionHierarchy");
  }
  if (hierarchy.hierarchyVersion !== "1.0.0" || !Array.isArray(hierarchy.actions) || !Array.isArray(hierarchy.orderedFindingIds)) {
    throw new Error("Current ScoreSet has an invalid decisionHierarchy contract");
  }
  if (hierarchy.rootCauseRuleId !== scoreSet.rootCauseRuleId) {
    throw new Error("Current ScoreSet rootCauseRuleId must match decisionHierarchy");
  }
  const actionIds = hierarchy.actions.map((action) => action?.findingId);
  if (actionIds.length !== hierarchy.orderedFindingIds.length || actionIds.some((id, index) => id !== hierarchy.orderedFindingIds[index])) {
    throw new Error("Current ScoreSet decisionHierarchy action order is inconsistent");
  }
  if (hierarchy.actions.length > 0 && (!scoreSet.rootCauseRuleId || hierarchy.actions[0].ruleId !== scoreSet.rootCauseRuleId)) {
    throw new Error("Current ScoreSet root cause must bind to its first governed action");
  }
  if (validateContract) {
    const result = validateContract(CURRENT_SCORESET_SCHEMA_ID, scoreSet);
    if (!result?.valid) throw new Error(`Current ScoreSet validation failed: ${JSON.stringify((result?.errors || []).slice(0, 5))}`);
  }
  return scoreSet;
}

/**
 * WP9 — Cost Preflight (v1.1.0 corrected)
 *
 * Deterministic cost estimation with injected price table, input-token
 * ceiling, cumulative daily budget tracking.
 *
 * NO hardcoded vendor prices in governed logic.
 * Tests inject a fixed price table.
 */

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

function estimateInputTokens(reportPackage) {
  const jsonStr = JSON.stringify(reportPackage);
  return Math.ceil(jsonStr.length * 1.3);
}

function estimateOutputTokens(modelConfig) {
  return modelConfig?.maxOutputTokens || 2000;
}

function estimateCost(inputTokens, outputTokens, priceTable) {
  if (!priceTable) {
    throw new Error("priceTable is required for cost estimation");
  }
  return (inputTokens / 1000) * (priceTable.inputPricePer1K || 0) +
         (outputTokens / 1000) * (priceTable.outputPricePer1K || 0);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function runCostPreflight({ reportPackage, priceTable, budget, modelConfig }) {
  const errors = [];

  if (!priceTable && budget) {
    // If budget is configured, priceTable is required
    throw new Error("priceTable is required when budget is configured");
  }

  const inputTokens = estimateInputTokens(reportPackage);
  const outputTokens = estimateOutputTokens(modelConfig);
  const maxCost = priceTable
    ? Math.round(estimateCost(inputTokens, outputTokens, priceTable) * 10000) / 10000
    : 0;

  const estimate = { inputTokens, maxOutputTokens: outputTokens, maxCostUsd: maxCost };

  // Input token ceiling
  if (modelConfig?.maxInputTokens && inputTokens > modelConfig.maxInputTokens) {
    return {
      allowed: false,
      reason: `Estimated ${inputTokens} input tokens exceeds ceiling ${modelConfig.maxInputTokens}`,
      estimate,
    };
  }

  if (!budget) return { allowed: true, estimate };

  // Audit hard budget
  if (budget.hardBudgetUsd !== undefined && maxCost > budget.hardBudgetUsd) {
    return {
      allowed: false,
      reason: `Cost $${maxCost} exceeds audit hard budget $${budget.hardBudgetUsd}`,
      estimate,
    };
  }

  // Daily cumulative budget
  const dailySpend = budget.dailySpendUsd || 0;
  if (budget.dailyHardBudgetUsd !== undefined &&
      dailySpend + maxCost > budget.dailyHardBudgetUsd) {
    return {
      allowed: false,
      reason: `Cumulative daily $${dailySpend + maxCost} exceeds daily hard budget $${budget.dailyHardBudgetUsd}`,
      estimate,
    };
  }

  // Soft budget warning
  if (budget.softBudgetUsd !== undefined && maxCost > budget.softBudgetUsd) {
    return {
      allowed: true,
      reason: `Cost $${maxCost} exceeds soft budget $${budget.softBudgetUsd}`,
      estimate,
      warning: true,
    };
  }

  return { allowed: true, estimate };
}

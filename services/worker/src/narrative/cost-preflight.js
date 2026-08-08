/**
 * WP9 — Cost Preflight
 *
 * Estimates token counts and cost before any live model call.
 * Rejects execution if hard budget ceilings are exceeded.
 *
 * Tests inject a fixed price table. No external pricing API calls.
 *
 * @module narrative/cost-preflight
 */

// ---------------------------------------------------------------------------
// Default price table (injectable for tests)
// ---------------------------------------------------------------------------

const DEFAULT_PRICE_TABLE = Object.freeze({
  inputPricePer1K: 0.003,   // $0.003 per 1K input tokens
  outputPricePer1K: 0.015,  // $0.015 per 1K output tokens
});

// ---------------------------------------------------------------------------
// Token estimation (conservative — overestimate)
// ---------------------------------------------------------------------------

function estimateInputTokens(reportPackage) {
  // Rough estimate: ~1.3 tokens per character for English text
  const jsonStr = JSON.stringify(reportPackage);
  return Math.ceil(jsonStr.length * 1.3);
}

function estimateOutputTokens() {
  // Conservative: assume max output
  return 2000;
}

function estimateCost(inputTokens, outputTokens, priceTable) {
  const pt = priceTable || DEFAULT_PRICE_TABLE;
  return (inputTokens / 1000) * pt.inputPricePer1K +
         (outputTokens / 1000) * pt.outputPricePer1K;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run cost preflight before a live model call.
 *
 * @param {object} opts
 * @param {object} opts.reportPackage — WP8 ReportContentPackage
 * @param {object} [opts.priceTable] — { inputPricePer1K, outputPricePer1K }
 * @param {object} [opts.budget] — { softBudgetUsd, hardBudgetUsd, dailyHardBudgetUsd }
 * @returns {{ allowed: boolean, reason?: string, estimate: object }}
 */
export function runCostPreflight({ reportPackage, priceTable, budget }) {
  const inputTokens = estimateInputTokens(reportPackage);
  const outputTokens = estimateOutputTokens();
  const maxCost = estimateCost(inputTokens, outputTokens, priceTable);

  const estimate = {
    inputTokens,
    maxOutputTokens: outputTokens,
    maxCostUsd: Math.round(maxCost * 10000) / 10000,
  };

  // Budget checks (only if budget is configured)
  if (budget) {
    if (budget.hardBudgetUsd !== undefined && maxCost > budget.hardBudgetUsd) {
      return {
        allowed: false,
        reason: `Estimated cost $${estimate.maxCostUsd} exceeds hard budget $${budget.hardBudgetUsd}`,
        estimate,
      };
    }

    if (budget.dailyHardBudgetUsd !== undefined && maxCost > budget.dailyHardBudgetUsd) {
      return {
        allowed: false,
        reason: `Estimated cost $${estimate.maxCostUsd} exceeds daily hard budget $${budget.dailyHardBudgetUsd}`,
        estimate,
      };
    }

    if (budget.softBudgetUsd !== undefined && maxCost > budget.softBudgetUsd) {
      // Soft budget — warn but allow
      return {
        allowed: true,
        reason: `Cost $${estimate.maxCostUsd} exceeds soft budget $${budget.softBudgetUsd} — allowed but flagged`,
        estimate,
        warning: true,
      };
    }
  }

  return { allowed: true, estimate };
}

/**
 * C8 — Governed narrative configuration validation.
 *
 * Production runtime configuration must fail closed BEFORE audit execution
 * when a narrative mode's required dependencies are absent:
 *
 *   MOCK    — no external dependencies (development/CI only).
 *   REPLAY  — requires a configured cacheStore ({ get }).
 *   LIVE    — requires modelClient, budget, priceTable, and modelConfig.
 *             No live model call is made here — dependencies are validated,
 *             not executed.
 *
 * @module narrative/narrative-configuration
 */

import { NARRATIVE_MODE } from "./narrative-service.js";

/**
 * Validate narrative-mode configuration.
 *
 * @param {object} opts
 * @param {string} opts.mode — "mock" | "replay" | "live"
 * @param {object} [opts.cacheStore] — { get } for replay mode
 * @param {object} [opts.modelClient] — injected live-mode client
 * @param {object} [opts.budget] — { softBudgetUsd, hardBudgetUsd, dailyHardBudgetUsd, dailySpendUsd }
 * @param {object} [opts.priceTable] — injected price config
 * @param {object} [opts.modelConfig] — { maxInputTokens, maxOutputTokens, maxCalls, maxRetries, promptVersion, outputSchemaVersion }
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateNarrativeConfiguration({ mode, cacheStore, modelClient, budget, priceTable, modelConfig }) {
  const errors = [];

  if (!mode || !Object.values(NARRATIVE_MODE).includes(mode)) {
    return {
      valid: false,
      errors: [`Invalid narrative mode: ${mode}. Must be mock, replay, or live.`],
    };
  }

  if (mode === NARRATIVE_MODE.REPLAY) {
    if (!cacheStore || typeof cacheStore.get !== "function") {
      errors.push("Narrative REPLAY mode requires a configured cacheStore (with get()).");
    }
  }

  if (mode === NARRATIVE_MODE.LIVE) {
    if (!modelClient || typeof modelClient.primary !== "function") {
      errors.push("Narrative LIVE mode requires a configured modelClient (with primary()).");
    }
    if (!budget || typeof budget !== "object") {
      errors.push("Narrative LIVE mode requires a governed budget.");
    }
    if (!priceTable || typeof priceTable !== "object") {
      errors.push("Narrative LIVE mode requires a governed priceTable (cost configuration).");
    }
    if (!modelConfig || typeof modelConfig !== "object") {
      errors.push("Narrative LIVE mode requires a governed modelConfig.");
    }
  }

  return { valid: errors.length === 0, errors };
}

export default { validateNarrativeConfiguration };

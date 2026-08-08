/**
 * WP9 — Usage Ledger
 *
 * Records every narrative attempt with governed cost-ledger fields.
 *
 * @module narrative/usage-ledger
 */

const LEDGER_VERSION = "1.0.0";

/**
 * Create a governed usage-ledger entry.
 *
 * @param {object} fields
 * @returns {object} Frozen ledger entry
 */
export function createUsageLedgerEntry(fields) {
  return Object.freeze({
    contractVersion: "1.0.0",
    ledgerVersion: LEDGER_VERSION,
    auditId: fields.auditId || "",
    executionId: fields.executionId || "",
    workflowVersion: fields.workflowVersion || "1.0.0",
    nodeId: fields.nodeId || "narrative-primary",
    mode: fields.mode || "mock",
    modelId: fields.modelId || "mock",
    promptVersion: fields.promptVersion || "1.0.0",
    inputTokens: fields.inputTokens ?? 0,
    outputTokens: fields.outputTokens ?? 0,
    cachedInputTokens: fields.cachedInputTokens ?? 0,
    estimatedCost: fields.estimatedCost ?? 0,
    actualCost: fields.actualCost ?? 0,
    retryNumber: fields.retryNumber ?? 0,
    cacheHit: fields.cacheHit || false,
    validationResult: fields.validationResult || "PENDING",
    timestamp: fields.timestamp || new Date().toISOString(),
  });
}

export { LEDGER_VERSION };

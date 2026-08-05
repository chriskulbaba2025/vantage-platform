/**
 * Resumable Source Plans and Checkpoints
 *
 * Produces the deterministic ordered list of sources for an audit
 * and provides checkpoint records for resumable execution.
 *
 * Does NOT execute sources — that is the WP5 Audit Orchestrator's
 * responsibility.  WP4 supplies only the plan data structure and
 * checkpoint tracking.
 *
 * @module lifecycle/source-plan
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Source definitions
// ---------------------------------------------------------------------------

/** Canonical source keys in execution order. */
export const CANONICAL_SOURCES = Object.freeze([
  "dataforseo-onpage",
  "pagespeed",
  "dataforseo-serp",
  "backlinks",
  "ga4",
  "gsc",
]);

/**
 * Build the ordered source plan for an audit request.
 *
 * Sources in the plan are those that are relevant to the audit.
 * Optional sources (ga4, gsc) are included only when configured.
 * The plan is deterministic for the same input.
 *
 * @param {object} auditRequest
 * @param {string} auditRequest.auditId
 * @param {boolean} [auditRequest.hasGa4]
 * @param {boolean} [auditRequest.hasGsc]
 * @returns {Array<{ source: string, required: boolean }>}
 */
export function buildSourcePlan(auditRequest) {
  if (!auditRequest || !auditRequest.auditId) {
    throw new Error("auditRequest.auditId is required");
  }

  const plan = [];

  for (const source of CANONICAL_SOURCES) {
    if (source === "ga4" && !auditRequest.hasGa4) continue;
    if (source === "gsc" && !auditRequest.hasGsc) continue;

    plan.push({
      source,
      required: source !== "backlinks" && source !== "ga4" && source !== "gsc",
    });
  }

  return Object.freeze(plan.map(Object.freeze));
}

// ---------------------------------------------------------------------------
// Cache keys
// ---------------------------------------------------------------------------

/**
 * Build a deterministic cache key for a source execution.
 *
 * Format: {auditId}/{source}/{adapterVersion hash}
 *
 * @param {object} params
 * @param {string} params.auditId
 * @param {string} params.source
 * @param {string} [params.adapterVersion]
 * @param {string} [params.configHash]   - Hash of normalized source config.
 * @returns {string}
 */
export function sourceExecutionKey({ auditId, source, adapterVersion = "1.0.0", configHash }) {
  const configPart = configHash || adapterVersion;
  const hash = createHash("sha256")
    .update(`${auditId}|${source}|${configPart}`)
    .digest("hex")
    .slice(0, 16);
  return `${auditId}/${source}/${hash}`;
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SourceCheckpoint
 * @property {string} source     - Source key.
 * @property {boolean} completed - Whether execution finished.
 * @property {string} [startedAt]
 * @property {string} [completedAt]
 * @property {string} [artifactKey]
 */

/**
 * Build a checkpoint ledger from a source plan and completed-source list.
 *
 * @param {Array<{ source: string }>} plan            - The source plan.
 * @param {Array<SourceCheckpoint>} [completed=[]]    - Already-completed checkpoints.
 * @returns {{ checkpoints: SourceCheckpoint[], remaining: SourceCheckpoint[], done: boolean }}
 */
export function buildCheckpointLedger(plan, completed = []) {
  const doneMap = new Map(completed.map((c) => [c.source, c]));

  const checkpoints = [];
  const remaining = [];

  for (const item of plan) {
    const done = doneMap.get(item.source);
    const cp = {
      source: item.source,
      completed: !!done,
      startedAt: done?.startedAt || null,
      completedAt: done?.completedAt || null,
      artifactKey: done?.artifactKey || null,
    };
    checkpoints.push(Object.freeze(cp));
    if (!cp.completed) {
      remaining.push(Object.freeze({ ...cp, required: item.required }));
    }
  }

  return Object.freeze({
    checkpoints: Object.freeze(checkpoints),
    remaining: Object.freeze(remaining),
    done: remaining.length === 0,
  });
}

export default {
  CANONICAL_SOURCES,
  buildSourcePlan,
  sourceExecutionKey,
  buildCheckpointLedger,
};

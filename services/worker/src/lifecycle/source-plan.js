/**
 * Resumable Source Plans and Checkpoints
 *
 * Produces the deterministic ordered list of sources for an audit
 * and provides checkpoint records for resumable execution.
 *
 * @module lifecycle/source-plan
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Source definitions
// ---------------------------------------------------------------------------

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
 * Optional sources omitted unless configured.
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
// Cache keys — full SHA-256
// ---------------------------------------------------------------------------

/**
 * Build a deterministic source execution key.
 *
 * Uses the FULL SHA-256 of {auditId}|{source}|{adapterVersion}|{configHash}.
 *
 * @param {object} params
 * @param {string} params.auditId
 * @param {string} params.source
 * @param {string} params.adapterVersion
 * @param {string} [params.configHash] - SHA-256 of normalized source config.
 * @returns {string}
 */
export function sourceExecutionKey({ auditId, source, adapterVersion, configHash }) {
  if (!adapterVersion) throw new Error("adapterVersion is required for source execution key");
  const input = `${auditId}|${source}|${adapterVersion}|${configHash || ""}`;
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SourceCheckpoint
 * @property {string} source
 * @property {boolean} completed
 * @property {string} [startedAt]
 * @property {string} [completedAt]
 * @property {string} [artifactKey]
 */

/**
 * Build a checkpoint ledger from a source plan and completed-checkpoint list.
 *
 * Rules:
 *   - A supplied checkpoint is complete only when completed === true
 *   - completed: false records remain in the remaining-source list
 *   - Duplicate checkpoint source entries are rejected
 *   - Checkpoints for sources not in the plan are rejected
 *   - Malformed entries are rejected
 *
 * @param {Array<{ source: string }>} plan
 * @param {Array<SourceCheckpoint>} [completed=[]]
 * @returns {{ checkpoints: SourceCheckpoint[], remaining: SourceCheckpoint[], done: boolean }}
 */
export function buildCheckpointLedger(plan, completed = []) {
  // Validate plan source uniqueness
  const planSources = new Set(plan.map((p) => p.source));
  if (planSources.size !== plan.length) {
    throw new Error("Duplicate sources in plan");
  }

  // Validate checkpoints
  const seenSources = new Set();
  for (const cp of completed) {
    if (!cp || typeof cp.source !== "string") {
      throw new Error("Malformed checkpoint entry: missing source");
    }
    if (!planSources.has(cp.source)) {
      throw new Error(`Checkpoint source not in plan: "${cp.source}"`);
    }
    if (seenSources.has(cp.source)) {
      throw new Error(`Duplicate checkpoint for source: "${cp.source}"`);
    }
    if (typeof cp.completed !== "boolean") {
      throw new Error(`Malformed checkpoint: completed must be boolean for "${cp.source}"`);
    }
    seenSources.add(cp.source);
  }

  const doneMap = new Map(completed.map((c) => [c.source, c]));
  const checkpoints = [];
  const remaining = [];

  for (const item of plan) {
    const done = doneMap.get(item.source);
    const cp = {
      source: item.source,
      completed: done ? done.completed : false,
      startedAt: done?.startedAt || null,
      completedAt: done?.completedAt || null,
      artifactKey: done?.artifactKey || null,
    };
    checkpoints.push(Object.freeze(cp));

    // completed: false stays in remaining
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

export default { CANONICAL_SOURCES, buildSourcePlan, sourceExecutionKey, buildCheckpointLedger };

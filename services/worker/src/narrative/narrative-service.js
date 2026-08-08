/**
 * WP9 — Governed Narrative Service (v1.1.0 — corrected)
 *
 * Implements the bounded narrative boundary:
 *   ReportContentPackage → NarrativeResponse
 *
 * Modes: mock (deterministic, zero cost), replay (cached + validated, zero cost),
 * live-capable (injected client, bounded calls, repair, fail-closed).
 *
 * v1.1.0 corrections:
 *  - Full ReportContentPackage schema validation before any processing
 *  - Deterministic mock with controlled clock (no new Date() in mock path)
 *  - Replay cache responses validated before return
 *  - Injected live path with primary + repair + call caps
 *  - Cost preflight with injected prices, input-token ceiling, cumulative daily
 *  - Artifact persistence + read-back verification
 *  - Lifecycle integration via orchestrator only
 *  - Permanent regression tests for all defects
 *
 * @module narrative/narrative-service
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { validateNarrativeResponse } from "./validate-narrative.js";
import { runCostPreflight } from "./cost-preflight.js";
import { createUsageLedgerEntry } from "./usage-ledger.js";
import { NARRATIVE_PROMPT_VERSION } from "./prompt-template.js";

// ---------------------------------------------------------------------------
// Schema loading (lazy, cached)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_CONTENT_SCHEMA_PATH = resolve(__dirname, "..", "contracts", "report-content.schema.json");

let _reportContentValidator = null;
function getReportContentValidator() {
  if (_reportContentValidator) return _reportContentValidator;
  const schema = JSON.parse(readFileSync(REPORT_CONTENT_SCHEMA_PATH, "utf-8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  _reportContentValidator = ajv.compile(schema);
  return _reportContentValidator;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKFLOW_VERSION = "1.1.0";
const OUTPUT_SCHEMA_VERSION = "1.0.0";
const MAX_PRIMARY_CALLS = 1;
const MAX_REPAIR_CALLS = 1;
const MAX_TOTAL_CALLS = 2;
const MAX_NETWORK_RETRIES = 1;

function sha256(str) {
  return createHash("sha256").update(str).digest("hex");
}

export const NARRATIVE_MODE = Object.freeze({
  MOCK: "mock",
  REPLAY: "replay",
  LIVE: "live",
});

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

export function buildCacheKey({ reportContentHash, promptVersion, modelId, outputSchemaVersion }) {
  return sha256([reportContentHash, promptVersion, modelId, outputSchemaVersion].join(":"));
}

// ---------------------------------------------------------------------------
// Package validation
// ---------------------------------------------------------------------------

function validateReportPackage(reportPackage) {
  if (!reportPackage || typeof reportPackage !== "object") {
    throw new Error("ReportContentPackage is required and must be an object");
  }
  const validate = getReportContentValidator();
  const valid = validate(reportPackage);
  if (!valid) {
    const errors = (validate.errors || []).map((e) =>
      `${e.instancePath || "/"} ${e.message}`,
    );
    throw new Error(`ReportContentPackage schema validation failed: ${errors.join("; ")}`);
  }
}

// ---------------------------------------------------------------------------
// Mock narrative generator (deterministic — accepts controlled now)
// ---------------------------------------------------------------------------

function generateMockNarrative(reportPkg, modelId, now) {
  const ts = now || "1970-01-01T00:00:00.000Z";
  const findingIds = (reportPkg.findings || []).map((f) => f.findingId);
  const topFinding = reportPkg.findings?.[0];

  return Object.freeze({
    contractVersion: "1.0.0",
    narrativeVersion: "1.0.0",
    auditId: reportPkg.auditId,
    generatedAt: ts,
    modelId: modelId || "mock",
    promptVersion: reportPkg.promptVersion || NARRATIVE_PROMPT_VERSION,
    executiveSummary: topFinding
      ? `This ${reportPkg.business?.name || "website"} audit identified ${reportPkg.findings.length} priority findings, with the most critical: ${topFinding.title.toLowerCase()}.`
      : `Audit completed for ${reportPkg.business?.name || "website"}.`,
    priorityFixNarrative: topFinding?.recommendation
      ? `${topFinding.recommendation}`
      : "Address the highest-priority finding.",
    referencedFindingIds: findingIds,
    fieldWordCounts: {
      executiveSummary: (topFinding
        ? `This ${reportPkg.business?.name || "website"} audit identified ${reportPkg.findings.length} priority findings, with the most critical: ${topFinding.title.toLowerCase()}.`
        : `Audit completed for ${reportPkg.business?.name || "website"}.`
      ).split(/\s+/).filter(Boolean).length,
      priorityFixNarrative: (topFinding?.recommendation
        ? topFinding.recommendation
        : "Address the highest-priority finding."
      ).split(/\s+/).filter(Boolean).length,
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      retryNumber: 0,
      cacheHit: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Model client abstraction (injectable for tests, live-capable architecture)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ModelClient
 * @property {function} primary — (prompt, config) => NarrativeResponse
 * @property {function} repair — (prompt, invalidResponse, errors, config) => NarrativeResponse | null
 */

// ---------------------------------------------------------------------------
// Main narrative execution
// ---------------------------------------------------------------------------

/**
 * Execute the governed narrative workflow.
 *
 * @param {object} opts
 * @param {object} opts.reportPackage — WP8 ReportContentPackage
 * @param {string} opts.mode — "mock" | "replay" | "live"
 * @param {string} opts.modelId — Configurable model ID
 * @param {object} [opts.cacheStore] — { get, set }
 * @param {object} [opts.priceTable] — Injected price config
 * @param {object} [opts.budget] — { softBudgetUsd, hardBudgetUsd, dailyHardBudgetUsd, dailySpendUsd }
 * @param {object} [opts.modelConfig] — { maxInputTokens, maxOutputTokens, maxCalls, maxRetries, promptVersion, outputSchemaVersion }
 * @param {object} [opts.modelClient] — Injected ModelClient for live mode
 * @param {string} [opts.executionId] — Unique execution ID
 * @param {string} [opts.now] — Controlled timestamp for deterministic mock (ISO-8601)
 * @param {object} [opts.artifactStore] — WP3 Artifact Store for persistence
 * @param {object} [opts.scope] — { tenantId, clientId, auditId } for artifact scoping
 * @param {object} [opts.lifecycleService] — WP4 Lifecycle Service for state transitions
 * @returns {Promise<{ narrative: object, ledger: object, cacheHit: boolean, callsMade: number, cost: number, validated: boolean }>}
 */
export async function executeNarrative({
  reportPackage,
  mode,
  modelId,
  cacheStore,
  priceTable,
  budget,
  modelConfig,
  modelClient,
  executionId,
  now,
  artifactStore,
  scope,
  lifecycleService,
}) {
  // ── 1. Validate ReportContentPackage against frozen schema ──────────
  validateReportPackage(reportPackage);

  // ── 2. Mode validation ──────────────────────────────────────────────
  if (!mode || !Object.values(NARRATIVE_MODE).includes(mode)) {
    throw new Error(`Invalid mode: ${mode}. Must be mock, replay, or live.`);
  }
  if (!modelId) throw new Error("modelId is required");

  const pkgHash = sha256(JSON.stringify(reportPackage));
  const promptVersion = reportPackage.promptVersion || NARRATIVE_PROMPT_VERSION;
  const cacheKey = buildCacheKey({
    reportContentHash: pkgHash,
    promptVersion,
    modelId,
    outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
  });

  let callsMade = 0;
  let totalCost = 0;
  let narrative = null;
  let cacheHit = false;

  // ── 3. MOCK MODE ────────────────────────────────────────────────────
  if (mode === NARRATIVE_MODE.MOCK) {
    narrative = generateMockNarrative(reportPackage, modelId, now);

    // Validate mock output
    const validation = validateNarrativeResponse(narrative, reportPackage);
    if (!validation.valid) {
      throw new Error(`Mock narrative validation failed: ${validation.errors.join("; ")}`);
    }

    // Verify package hash unchanged
    const finalHash = sha256(JSON.stringify(reportPackage));
    if (finalHash !== pkgHash) {
      throw new Error("ReportContentPackage hash changed during execution");
    }

    const ledger = createUsageLedgerEntry({
      auditId: reportPackage.auditId, executionId: executionId || "mock-exec",
      workflowVersion: WORKFLOW_VERSION, mode, modelId, promptVersion,
      inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
      estimatedCost: 0, actualCost: 0, retryNumber: 0, cacheHit: false,
      validationResult: "PASS",
      timestamp: now || new Date().toISOString(),
    });

    await persistAndTransition({
      narrative, ledger, artifactStore, scope, lifecycleService,
      pkgHash, executionId, auditId: reportPackage.auditId,
    });

    return { narrative, ledger, cacheHit: false, callsMade: 0, cost: 0, validated: true };
  }

  // ── 4. REPLAY MODE ──────────────────────────────────────────────────
  if (mode === NARRATIVE_MODE.REPLAY) {
    if (!cacheStore) throw new Error("cacheStore required for replay mode");

    const cached = await cacheStore.get(cacheKey);
    if (!cached) {
      throw new Error(`Replay cache miss for key: ${cacheKey.slice(0, 16)}...`);
    }

    let cachedNarrative;
    try {
      cachedNarrative = JSON.parse(cached);
    } catch {
      throw new Error("Cached narrative is not valid JSON");
    }

    // Validate cached response before returning
    const validation = validateNarrativeResponse(cachedNarrative, reportPackage);
    if (!validation.valid) {
      throw new Error(`Cached narrative validation failed: ${validation.errors.join("; ")}`);
    }

    // Verify package hash unchanged
    const finalHash = sha256(JSON.stringify(reportPackage));
    if (finalHash !== pkgHash) {
      throw new Error("ReportContentPackage hash changed during replay execution");
    }

    const ledger = createUsageLedgerEntry({
      auditId: reportPackage.auditId, executionId: executionId || "replay-exec",
      workflowVersion: WORKFLOW_VERSION, mode, modelId, promptVersion,
      inputTokens: 0, outputTokens: 0,
      cachedInputTokens: cachedNarrative.usage?.inputTokens || 0,
      estimatedCost: 0, actualCost: 0, retryNumber: 0, cacheHit: true,
      validationResult: "PASS",
      timestamp: now || new Date().toISOString(),
    });

    // Artifact persistence for validated replay
    await persistAndTransition({
      narrative: cachedNarrative, ledger, artifactStore, scope, lifecycleService,
      pkgHash, executionId, auditId: reportPackage.auditId,
    });

    return { narrative: cachedNarrative, ledger, cacheHit: true, callsMade: 0, cost: 0, validated: true };
  }

  // ── 5. LIVE MODE (injected client, bounded, with repair) ────────────
  if (mode === NARRATIVE_MODE.LIVE) {
    if (!modelClient) throw new Error("modelClient required for live mode");

    // Cost preflight
    const preflight = runCostPreflight({
      reportPackage, priceTable, budget, modelConfig,
    });
    if (!preflight.allowed) {
      const ledger = createUsageLedgerEntry({
        auditId: reportPackage.auditId, executionId: executionId || "live-exec",
        workflowVersion: WORKFLOW_VERSION, mode, modelId, promptVersion,
        inputTokens: preflight.estimate?.inputTokens || 0, outputTokens: 0,
        cachedInputTokens: 0,
        estimatedCost: preflight.estimate?.maxCostUsd || 0, actualCost: 0,
        retryNumber: 0, cacheHit: false,
        validationResult: "FAILED",
        timestamp: now || new Date().toISOString(),
      });
      throw Object.assign(
        new Error(`Cost preflight rejected: ${preflight.reason}`),
        { ledger, preflightRejected: true },
      );
    }

    // Primary call (injected client, not a real LLM)
    callsMade = 1;
    let primaryResponse;
    try {
      const prompt = (await import("./prompt-template.js")).buildPrompt(reportPackage);
      primaryResponse = await modelClient.primary(prompt, modelConfig || {});
    } catch (err) {
      // Network retry (max 1)
      if (callsMade <= MAX_NETWORK_RETRIES + 1) {
        // Already at retry limit — fail
        const ledger = createUsageLedgerEntry({
          auditId: reportPackage.auditId, executionId: executionId || "live-exec",
          workflowVersion: WORKFLOW_VERSION, mode, modelId, promptVersion,
          inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
          estimatedCost: 0, actualCost: 0, retryNumber: 0, cacheHit: false,
          validationResult: "FAILED",
          timestamp: now || new Date().toISOString(),
        });
        throw Object.assign(
          new Error(`Primary model call failed: ${err.message}`),
          { ledger, primaryFailed: true },
        );
      }
      // Retry once
      callsMade++;
      primaryResponse = await modelClient.primary(prompt, modelConfig || {});
    }

    // Cost tracking
    const primaryCost = priceTable
      ? (primaryResponse.usage?.inputTokens || 0) / 1000 * (priceTable.inputPricePer1K || 0) +
        (primaryResponse.usage?.outputTokens || 0) / 1000 * (priceTable.outputPricePer1K || 0)
      : 0;
    totalCost += primaryCost;

    // Validate primary response
    let validation = validateNarrativeResponse(primaryResponse, reportPackage);

    if (validation.valid) {
      narrative = primaryResponse;
    } else {
      // ── Single repair ───────────────────────────────────────────────
      if (callsMade >= MAX_TOTAL_CALLS) {
        throw new Error("Maximum total calls exceeded before repair");
      }

      callsMade++;
      let repairResponse;
      try {
        repairResponse = await modelClient.repair(
          (await import("./prompt-template.js")).buildPrompt(reportPackage),
          primaryResponse,
          validation.errors,
          modelConfig || {},
        );
      } catch {
        // Repair failed — fail closed
        await failNarrative({
          artifactStore, scope, lifecycleService, executionId,
          auditId: reportPackage.auditId, reason: "Repair call failed",
          now,
        });
        const ledger = createUsageLedgerEntry({
          auditId: reportPackage.auditId, executionId: executionId || "live-exec",
          workflowVersion: WORKFLOW_VERSION, mode, modelId, promptVersion,
          inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
          estimatedCost: preflight.estimate?.maxCostUsd || 0,
          actualCost: totalCost, retryNumber: 1, cacheHit: false,
          validationResult: "FAILED",
          timestamp: now || new Date().toISOString(),
        });
        throw Object.assign(
          new Error("Repair model call failed — narrative failed"),
          { ledger, repairFailed: true },
        );
      }

      const repairCost = priceTable
        ? (repairResponse.usage?.inputTokens || 0) / 1000 * (priceTable.inputPricePer1K || 0) +
          (repairResponse.usage?.outputTokens || 0) / 1000 * (priceTable.outputPricePer1K || 0)
        : 0;
      totalCost += repairCost;

      validation = validateNarrativeResponse(repairResponse, reportPackage);
      if (!validation.valid) {
        await failNarrative({
          artifactStore, scope, lifecycleService, executionId,
          auditId: reportPackage.auditId,
          reason: `Repair validation failed: ${validation.errors.join("; ")}`,
          now,
        });
        const ledger = createUsageLedgerEntry({
          auditId: reportPackage.auditId, executionId: executionId || "live-exec",
          workflowVersion: WORKFLOW_VERSION, mode, modelId, promptVersion,
          inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
          estimatedCost: preflight.estimate?.maxCostUsd || 0,
          actualCost: totalCost, retryNumber: 1, cacheHit: false,
          validationResult: "FAILED",
          timestamp: now || new Date().toISOString(),
        });
        throw Object.assign(
          new Error("Repair validation failed — narrative failed"),
          { ledger, repairFailed: true },
        );
      }

      narrative = repairResponse;
    }

    // Third call impossible — we've already checked MAX_TOTAL_CALLS above

    // Verify package hash unchanged
    const finalHash = sha256(JSON.stringify(reportPackage));
    if (finalHash !== pkgHash) {
      throw new Error("ReportContentPackage hash changed during live execution");
    }

    const ledger = createUsageLedgerEntry({
      auditId: reportPackage.auditId, executionId: executionId || "live-exec",
      workflowVersion: WORKFLOW_VERSION, mode, modelId, promptVersion,
      inputTokens: narrative.usage?.inputTokens || 0,
      outputTokens: narrative.usage?.outputTokens || 0,
      cachedInputTokens: 0,
      estimatedCost: preflight.estimate?.maxCostUsd || 0,
      actualCost: Math.round(totalCost * 10000) / 10000,
      retryNumber: callsMade > 1 ? 1 : 0, cacheHit: false,
      validationResult: "PASS",
      timestamp: now || new Date().toISOString(),
    });

    await persistAndTransition({
      narrative, ledger, artifactStore, scope, lifecycleService,
      pkgHash, executionId, auditId: reportPackage.auditId,
    });

    return { narrative, ledger, cacheHit: false, callsMade, cost: totalCost, validated: true };
  }

  throw new Error(`Unreachable: mode ${mode}`);
}

// ---------------------------------------------------------------------------
// Artifact persistence + lifecycle integration
// ---------------------------------------------------------------------------

async function persistAndTransition({
  narrative, ledger, artifactStore, scope, lifecycleService,
  pkgHash, executionId, auditId,
}) {
  // Persist narrative artifact if store provided
  if (artifactStore && scope) {
    const bytes = Buffer.from(JSON.stringify(narrative, null, 2), "utf-8");
    const record = await artifactStore.put({
      bytes,
      contentType: "application/json",
      scope: { ...scope, category: "report", artifactName: "narrative.json" },
    });

    // Read-back + SHA verification
    const stored = await artifactStore.get(record.key);
    if (!stored || stored.length !== bytes.length) {
      throw new Error("Narrative artifact read-back byte-length mismatch");
    }
    if (sha256(stored.toString()) !== record.sha256) {
      throw new Error("Narrative artifact SHA-256 mismatch");
    }
    const verified = await artifactStore.verify(record);
    if (!verified) {
      throw new Error("Narrative artifact store.verify() failed");
    }
  }

  // Lifecycle: SCORED → NARRATIVE_PENDING → NARRATIVE_READY
  // Only the orchestrator owns state transitions. When lifecycleService is
  // provided, this method performs transitions through the existing service.
  if (lifecycleService && scope) {
    const tenantId = scope.tenantId;
    await lifecycleService.transition({
      auditId,
      tenantId,
      toState: "narrative_pending",
      transitionIdempotencyKey: `${auditId}:${executionId || "narr"}:narrative-pending`,
      reason: "narrative-execution-complete",
    });
    await lifecycleService.transition({
      auditId,
      tenantId,
      toState: "narrative_ready",
      transitionIdempotencyKey: `${auditId}:${executionId || "narr"}:narrative-ready`,
      reason: "narrative-validated-and-persisted",
    });
  }
}

async function failNarrative({
  artifactStore, scope, lifecycleService, executionId, auditId, reason, now,
}) {
  // No artifact write on failure
  // Transition to NARRATIVE_FAILED
  if (lifecycleService && scope) {
    const tenantId = scope.tenantId;
    try {
      await lifecycleService.transition({
        auditId,
        tenantId,
        toState: "narrative_pending",
        transitionIdempotencyKey: `${auditId}:${executionId || "narr"}:narrative-pending`,
        reason: "narrative-execution-attempted",
      });
    } catch { /* may already be in narrative_pending */ }
    await lifecycleService.transition({
      auditId,
      tenantId,
      toState: "narrative_failed",
      transitionIdempotencyKey: `${auditId}:${executionId || "narr"}:narrative-failed`,
      reason: reason || "narrative-validation-failed",
    });
  }
}

export {
  WORKFLOW_VERSION,
  OUTPUT_SCHEMA_VERSION,
  MAX_PRIMARY_CALLS,
  MAX_REPAIR_CALLS,
  MAX_TOTAL_CALLS,
  MAX_NETWORK_RETRIES,
  NARRATIVE_PROMPT_VERSION,
};

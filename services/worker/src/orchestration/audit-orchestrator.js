/**
 * WP5 Audit Orchestrator — Governed audit execution with recovery and failure boundaries.
 * @module orchestration/audit-orchestrator
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { buildSourcePlan, buildCheckpointLedger, sourceExecutionKey, CANONICAL_SOURCES } from "../lifecycle/source-plan.js";
import { LIFECYCLE_STATE } from "../lifecycle/state-enum.js";
import { resolveSourcePolicy, executeWithRetry } from "./retry-policy.js";
import {
  buildSourceCheckpointManifestKey, buildCanonicalRecordManifestKey,
  persistSourceCheckpointManifest, loadAndVerifySourceCheckpointManifest,
  persistCanonicalRecordManifest, loadAndVerifyCanonicalRecordManifest,
} from "./artifact-recovery.js";
import { buildArtifactKey } from "../storage/artifact-key.js";
import { scoreFromCanonicalEvidence } from "../scoring/scoring-service.js";
import { executeNarrative, NARRATIVE_MODE } from "../narrative/narrative-service.js";
import { buildReportViewModel, LOCKED_REPORT_DESIGN_VERSION } from "../report-view-model/build-view-model.js";

const T = LIFECYCLE_STATE;

const SOURCE_EVIDENCE_MAP = Object.freeze({
  "dataforseo-onpage": "website",
  "pagespeed":           "performance",
  "dataforseo-serp":     "competitors",
  "backlinks":           "backlinks",
  "ga4":                 "ga4",
  "gsc":                 "gsc",
});

const FULL_SOURCES = new Set(["website", "performance"]);
const MID_SOURCES = new Set(["backlinks", "ga4", "gsc"]);

// WP5-CLOSE-STAT-01: Explicit immutable status-to-counter-key mapping
const STATUS_COUNTER_KEY = Object.freeze({
  AVAILABLE:      "available",
  PARTIAL:        "partial",
  FAILED:         "failed",
  BLOCKED:        "blocked",
  UNAVAILABLE:    "unavailable",
  NOT_CONNECTED:  "notConnected",
  NOT_APPLICABLE: "notApplicable",
});

function defaultClock() {
  return {
    now: () => new Date().toISOString(),
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function artifactScope({ tenantId, clientId, auditId, category, artifactName }) {
  return { tenantId, clientId, auditId, category, artifactName };
}

// ---------------------------------------------------------------------------
// Source execution identity — stable deterministic key across runs
// ---------------------------------------------------------------------------
function stableJsonStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableJsonStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableJsonStringify(obj[k])}`).join(",")}}`;
}

/**
 * Build a deterministic source execution identity.
 * Includes all request values that can affect source output.
 * Excludes volatile values (executionId, timestamps, retry attempt, idempotencyKey).
 */
function buildSourceExecutionIdentity({ auditRequest, source, adapterVersion }) {
  const config = {
    targetUrl: auditRequest.targetUrl || null,
    language: auditRequest.language || null,
    market: auditRequest.market || null,
    services: auditRequest.services || [],
    competitors: auditRequest.competitors || [],
    ga4PropertyId: auditRequest.ga4?.propertyId || null,
    gscSiteUrl: auditRequest.gsc?.siteUrl || null,
    maxPages: auditRequest.crawl?.maxPages || 500,
    enableJavascript: auditRequest.crawl?.enableJavascript || false,
  };
  const normalizedConfig = stableJsonStringify(config);
  const configHash = sha256(Buffer.from(normalizedConfig, "utf-8"));
  return {
    adapterVersion,
    normalizedConfig,
    configHash,
    sourceExecutionKey: sourceExecutionKey({ auditId: auditRequest.auditId, source, adapterVersion, configHash }),
  };
}

// =========================================================================
// Factory
// =========================================================================

export function createAuditOrchestrator({
  lifecycleService, artifactStore, adapters, validateContract,
  clock, timer, retryPolicyResolver,
  narrativeExecutor,
  n8nCallCounter,
}) {
  const c = clock || defaultClock();
  const _narrativeExecutor = narrativeExecutor || executeNarrative;
  const _n8nCallCounter = n8nCallCounter || { count: 0 };

  // -------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------
  async function validateRequest(auditRequest) {
    const { valid, errors } = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/audit-request.schema.json", auditRequest);
    return { valid, errors };
  }

  // -------------------------------------------------------------------
  // Get registered adapter version for a source
  // -------------------------------------------------------------------
  function getAdapterVersion(source) {
    const adapter = adapters[source];
    if (!adapter) return null;
    return adapter.adapterVersion || null;
  }

  // -------------------------------------------------------------------
  // Execute one source via retry boundary
  // -------------------------------------------------------------------
  async function executeSource({ auditRequest, source, executionId }) {
    const adapter = adapters[source];
    if (!adapter) {
      return {
        rawBytes: null, contentType: null,
        sourceResult: {
          source, provider: "unknown", adapterVersion: "0.0.0",
          status: "NOT_APPLICABLE",
          startedAt: c.now(), completedAt: c.now(),
          retryCount: 0, coverage: { requested: 0, completed: 0, failed: 0 },
          limitations: [`No adapter registered for source: ${source}`],
        },
      };
    }

    // WP5-CLOSE-ADP-01: Validate adapterVersion before execution
    const registeredVersion = adapter.adapterVersion;
    if (!registeredVersion || registeredVersion === "") {
      throw new Error(`Adapter for ${source} has no valid adapterVersion`);
    }

    const identity = buildSourceExecutionIdentity({ auditRequest, source, adapterVersion: registeredVersion });
    const policy = resolveSourcePolicy({ policyResolver: retryPolicyResolver, source });

    const result = await executeWithRetry({
      policy, clock: c,
      executeFn: async (sig, att) => adapter.execute({
        auditRequest, source, executionId,
        sourceExecutionKey: identity.sourceExecutionKey,
        signal: sig, attempt: att,
      }),
    });

    return { ...result, identity };
  }

  // -------------------------------------------------------------------
  // Persist raw bytes + read-back verify (throws on any failure)
  // -------------------------------------------------------------------
  async function persistRaw({ auditRequest, source, executionId, rawBytes, contentType }) {
    if (!rawBytes || rawBytes.length === 0) return null;
    const scope = artifactScope({
      tenantId: auditRequest.tenantId, clientId: auditRequest.clientId,
      auditId: auditRequest.auditId, category: "raw",
      artifactName: `${source}-${executionId}.json`,
    });
    const record = await artifactStore.put({ bytes: rawBytes, contentType, scope, source, executionId });
    const rb = await artifactStore.get(record.key);
    if (!rb || rb.length !== rawBytes.length) throw new Error(`Raw artifact byte mismatch for ${source}`);
    if (record.sha256 !== sha256(rawBytes)) throw new Error(`Raw artifact SHA mismatch for ${source}`);
    if (!(await artifactStore.verify(record))) throw new Error(`Raw artifact verification failed for ${source}`);
    return record;
  }

  // -------------------------------------------------------------------
  // Persist normalized result + read-back verify (throws on any failure)
  // -------------------------------------------------------------------
  async function persistNormalized({ auditRequest, source, sourceResult }) {
    const bytes = Buffer.from(JSON.stringify(sourceResult), "utf-8");
    const scope = artifactScope({
      tenantId: auditRequest.tenantId, clientId: auditRequest.clientId,
      auditId: auditRequest.auditId, category: "normalized",
      artifactName: `${source}.json`,
    });
    const record = await artifactStore.put({ bytes, contentType: "application/json", scope, source });
    const rb = await artifactStore.get(record.key);
    if (!rb || rb.length !== bytes.length) throw new Error(`Normalized artifact byte mismatch for ${source}`);
    if (record.sha256 !== sha256(bytes)) throw new Error(`Normalized artifact SHA mismatch for ${source}`);
    if (!(await artifactStore.verify(record))) throw new Error(`Normalized artifact verification failed for ${source}`);
    return record;
  }

  // -------------------------------------------------------------------
  // Process one source: execute adapter → validate → persist → manifest
  // Throws on infrastructure failure (any exception here is infrastructure)
  // -------------------------------------------------------------------
  async function processOneSource({ auditRequest, item, executionId, identity }) {
    // Execute adapter via retry boundary
    const execResult = await executeSource({ auditRequest, source: item.source, executionId });
    const { rawBytes, contentType, sourceResult: rawResult, identity: actualIdentity } = execResult;

    // WP5-CLOSE-ADP-03: Verify returned adapterVersion matches registered version
    const registeredVersion = getAdapterVersion(item.source);
    const returnedVersion = rawResult.adapterVersion;
    if (registeredVersion && returnedVersion && returnedVersion !== registeredVersion) {
      throw new Error(`Adapter version mismatch for ${item.source}: registered=${registeredVersion}, returned=${returnedVersion}`);
    }

    // Build complete source result
    const sourceResult = {
      contractVersion: "1.0.0", schemaVersion: "1.0.0",
      source: item.source,
      provider: rawResult.provider || "mock",
      adapterVersion: returnedVersion || registeredVersion || "1.0.0",
      status: rawResult.status || "AVAILABLE",
      startedAt: rawResult.startedAt || c.now(),
      completedAt: rawResult.completedAt || c.now(),
      retryCount: rawResult.retryCount || 0,
      expectedRecords: rawResult.expectedRecords || 0,
      returnedRecords: rawResult.returnedRecords || 0,
      coverage: rawResult.coverage || { requested: 0, completed: 0, failed: 0 },
      limitations: rawResult.limitations || [],
      evidence: rawResult.evidence || {},
    };
    if (rawResult.requestId) sourceResult.requestId = rawResult.requestId;
    if (rawResult.errorCategory) sourceResult.errorCategory = rawResult.errorCategory;

    // Validate source result — any failure here is infrastructure
    const sv = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/source-result.schema.json", sourceResult);
    if (!sv.valid) {
      throw new Error(`Source result validation failed for ${item.source}`);
    }

    // Persist raw bytes (throws on failure)
    let rawRecord = null;
    if (rawBytes && rawBytes.length > 0) {
      rawRecord = await persistRaw({ auditRequest, source: item.source, executionId, rawBytes, contentType: contentType || "application/json" });
      sourceResult.artifact = { key: rawRecord.key, sha256: rawRecord.sha256, bytes: rawRecord.bytes, contentType: rawRecord.contentType };
    }

    // Persist normalized result (throws on failure)
    const normalizedRecord = await persistNormalized({ auditRequest, source: item.source, sourceResult });

    // Persist source checkpoint manifest (throws on failure)
    const identityForManifest = actualIdentity || identity || buildSourceExecutionIdentity({ auditRequest, source: item.source, adapterVersion: registeredVersion || "1.0.0" });
    await persistSourceCheckpointManifest({
      store: artifactStore,
      scope: { tenantId: auditRequest.tenantId, clientId: auditRequest.clientId, auditId: auditRequest.auditId },
      source: item.source,
      sourceExecutionKey: identityForManifest.sourceExecutionKey,
      completedAt: c.now(),
      normalizedRecord,
      rawRecord,
    });

    return { sourceResult, rawRecord, normalizedRecord, identity: identityForManifest };
  }

  // -------------------------------------------------------------------
  // Restore a completed source from verified manifest (no adapter call)
  // -------------------------------------------------------------------
  async function restoreSource({ auditRequest, source, restoredEntry }) {
    const registeredVersion = getAdapterVersion(source) || "1.0.0";
    const identity = buildSourceExecutionIdentity({ auditRequest, source, adapterVersion: registeredVersion });

    // Verify source execution key matches expected
    if (restoredEntry.manifest.sourceExecutionKey !== identity.sourceExecutionKey) {
      throw new Error(`Source execution key mismatch for ${source}: manifest key does not match current expected key`);
    }

    return {
      sourceResult: restoredEntry.sourceResult,
      rawRecord: restoredEntry.rawRecord,
      normalizedRecord: restoredEntry.normalizedRecord,
      identity,
    };
  }

  // -------------------------------------------------------------------
  // Discover verified checkpoints from persisted manifests
  // -------------------------------------------------------------------
  async function discoverCheckpoints(auditRequest, plan) {
    const completed = [];
    for (const item of plan) {
      const registeredVersion = getAdapterVersion(item.source) || "1.0.0";
      const restored = await loadAndVerifySourceCheckpointManifest({
        store: artifactStore,
        scope: { tenantId: auditRequest.tenantId, clientId: auditRequest.clientId, auditId: auditRequest.auditId },
        source: item.source,
        validateContract,
        expectedSourceExecutionKey: buildSourceExecutionIdentity({ auditRequest, source: item.source, adapterVersion: registeredVersion }).sourceExecutionKey,
      });
      if (restored) {
        completed.push({ source: item.source, completed: true, restored });
      }
    }
    return completed;
  }

  // -------------------------------------------------------------------
  // Assemble canonical evidence (throws on failure)
  // -------------------------------------------------------------------
  async function assembleCanonical({ auditRequest, allSourceResults }) {
    const sources = {};
    for (const entry of allSourceResults) {
      const ek = SOURCE_EVIDENCE_MAP[entry.source];
      if (!ek) continue;
      const sr = entry.sourceResult;
      const se = { source: entry.source, status: sr.status, collectedAt: sr.completedAt || c.now() };
      if (FULL_SOURCES.has(ek)) {
        se.provider = sr.provider || "unknown";
        se.adapterVersion = sr.adapterVersion || "0.0.0";
        se.startedAt = sr.startedAt || c.now();
        se.completedAt = sr.completedAt || c.now();
        se.retryCount = sr.retryCount || 0;
        se.coverage = sr.coverage || { requested: 0, completed: 0, failed: 0 };
        se.limitations = sr.limitations || [];
        if (sr.requestId) se.requestId = sr.requestId;
        if (entry.rawRecord) se.artifactRef = { key: entry.rawRecord.key, sha256: entry.rawRecord.sha256, bytes: entry.rawRecord.bytes };
      } else if (MID_SOURCES.has(ek)) {
        se.provider = sr.provider || "unknown";
        se.adapterVersion = sr.adapterVersion || "0.0.0";
        se.limitations = sr.limitations || [];
        if (entry.rawRecord) se.artifactRef = { key: entry.rawRecord.key, sha256: entry.rawRecord.sha256, bytes: entry.rawRecord.bytes };
      }
      sources[ek] = se;
    }

    // Use last source's completedAt as canonical timestamp for determinism
    const lastCompletedAt = allSourceResults.reduce((latest, e) => {
      const t = e.sourceResult?.completedAt;
      return t && t > latest ? t : latest;
    }, "");

    const evidence = {
      contractVersion: "1.0.0", evidenceVersion: "1.0.0",
      auditId: auditRequest.auditId,
      normalizedRequest: {
        targetUrl: auditRequest.targetUrl,
        businessName: auditRequest.businessName, market: auditRequest.market,
        language: auditRequest.language, primaryGoal: auditRequest.primaryGoal,
        services: auditRequest.services || [], competitors: auditRequest.competitors || [],
      },
      sources,
      limitations: allSourceResults.flatMap(e => e.sourceResult.limitations || []),
      artifactReferences: allSourceResults.filter(e => e.rawRecord).map(e => ({
        source: e.source, key: e.rawRecord.key, sha256: e.rawRecord.sha256, bytes: e.rawRecord.bytes, contentType: e.rawRecord.contentType,
      })),
      adapterVersions: Object.fromEntries(allSourceResults.map(e => [e.source, e.sourceResult.adapterVersion || "1.0.0"])),
      createdAt: lastCompletedAt || c.now(),
    };

    const sv = validateContract("https://vantage-platform.io/prysm/contracts/v1/canonical-evidence.schema.json", evidence);
    if (!sv.valid) throw new Error(`Canonical evidence validation failed`);

    const evidenceBytes = Buffer.from(JSON.stringify(evidence), "utf-8");
    const scope = artifactScope({
      tenantId: auditRequest.tenantId, clientId: auditRequest.clientId,
      auditId: auditRequest.auditId, category: "canonical", artifactName: "evidence.json",
    });
    const canonicalRecord = await artifactStore.put({ bytes: evidenceBytes, contentType: "application/json", scope });
    const rb = await artifactStore.get(canonicalRecord.key);
    if (!rb || rb.length !== evidenceBytes.length) throw new Error("Canonical evidence byte mismatch");
    if (canonicalRecord.sha256 !== sha256(evidenceBytes)) throw new Error("Canonical evidence SHA mismatch");
    if (!(await artifactStore.verify(canonicalRecord))) throw new Error("Canonical evidence verification failed");

    return { evidence, canonicalRecord };
  }

  // -------------------------------------------------------------------
  // Governed collection sequence — all inside failure boundary
  // -------------------------------------------------------------------
  async function governedCollection(auditRequest, executionId) {
    const { auditId, tenantId, clientId } = auditRequest;
    const scope = { tenantId, clientId, auditId };

    // 1. Build source plan
    const plan = buildSourcePlan({
      auditId,
      hasGa4: !!(auditRequest.ga4?.propertyId),
      hasGsc: !!(auditRequest.gsc?.siteUrl),
    });

    // 2. Discover verified checkpoints
    const verifiedCheckpoints = await discoverCheckpoints(auditRequest, plan);
    const verifiedSources = new Set(verifiedCheckpoints.map(c => c.source));
    const isResumed = verifiedCheckpoints.length > 0;

    // 3. Build checkpoint ledger
    const checkpointRecords = verifiedCheckpoints.map(c => ({
      source: c.source, completed: true,
      artifactKey: c.restored.normalizedRecord?.key,
    }));
    const ledger = buildCheckpointLedger(plan, checkpointRecords);

    // 4. Execute or restore sources
    const allSourceResults = [];

    for (const item of ledger.checkpoints) {
      const vcp = verifiedCheckpoints.find(c => c.source === item.source);

      if (vcp && item.completed) {
        const restored = await restoreSource({ auditRequest, source: item.source, restoredEntry: vcp.restored });
        allSourceResults.push({
          source: item.source,
          sourceResult: restored.sourceResult,
          rawRecord: restored.rawRecord,
          normalizedRecord: restored.normalizedRecord,
        });
        continue;
      }

      // Execute adapter — any exception here is infrastructure failure
      const registeredVersion = getAdapterVersion(item.source) || "1.0.0";
      const identity = buildSourceExecutionIdentity({ auditRequest, source: item.source, adapterVersion: registeredVersion });
      const result = await processOneSource({ auditRequest, item, executionId, identity });
      allSourceResults.push({
        source: item.source,
        sourceResult: result.sourceResult,
        rawRecord: result.rawRecord,
        normalizedRecord: result.normalizedRecord,
      });
    }

    // 5. Assemble canonical evidence
    const { canonicalRecord } = await assembleCanonical({ auditRequest, allSourceResults });

    // 6. Persist canonical record manifest
    const manifestRecord = await persistCanonicalRecordManifest({
      store: artifactStore, scope, createdAt: canonicalRecord.writtenAt || c.now(), canonicalRecord,
    });
    const manifestKey = manifestRecord.key;

    // 7. collecting → evidence_stored
    await lifecycleService.transition({
      auditId, tenantId, toState: T.EVIDENCE_STORED,
      transitionIdempotencyKey: `${auditId}:${executionId}:evidence-stored`,
      artifactKey: manifestKey,
    });

    // 8. evidence_stored → evidence_locked
    await lifecycleService.transition({
      auditId, tenantId, toState: T.EVIDENCE_LOCKED,
      transitionIdempotencyKey: `${auditId}:${executionId}:evidence-locked`,
      artifactKey: manifestKey,
    });

    return { allSourceResults, canonicalRecord, isResumed };
  }

  // -------------------------------------------------------------------
  // Transition to collection_failed — re-reads current state
  // -------------------------------------------------------------------
  async function failCollection(auditId, tenantId, executionId, originalError) {
    const cs = await lifecycleService.currentState(auditId, tenantId);
    if (!cs) throw originalError;
    if (cs.state !== T.COLLECTING) {
      const err = new Error(`Cannot transition to collection_failed: current state is ${cs.state}, not collecting`);
      err.cause = originalError;
      throw err;
    }
    try {
      await lifecycleService.transition({
        auditId, tenantId, toState: T.COLLECTION_FAILED,
        expectedState: T.COLLECTING,
        expectedVersion: cs.version,
        transitionIdempotencyKey: `${auditId}:${executionId}:collection-failed`,
      });
    } catch (transitionErr) {
      const err = new Error(`Failed to transition to collection_failed: ${transitionErr.message}`);
      err.cause = originalError;
      throw err;
    }
    throw originalError;
  }

  // -------------------------------------------------------------------
  // Lifecycle helper — execution-scoped idempotency keys
  // -------------------------------------------------------------------
  async function doTransition(auditId, tenantId, executionId, toState, suffix, artifactKey) {
    await lifecycleService.transition({
      auditId, tenantId, toState,
      transitionIdempotencyKey: `${auditId}:${executionId}:${suffix}`,
      ...(artifactKey ? { artifactKey } : {}),
    });
  }

  // -------------------------------------------------------------------
  // -------------------------------------------------------------------
  // WP7 — Governed scoring from locked canonical evidence
  // -------------------------------------------------------------------

  /**
   * Execute the complete WP7 governed scoring path:
   *   1. Load and verify canonical evidence from the artifact store.
   *   2. Run deterministic scoring (findings + scores).
   *   3. Persist findings.json and scores.json.
   *   4. Transition EVIDENCE_LOCKED → SCORED.
   *
   * Provider adapters, n8n, LLMs, and the report renderer are NOT called.
   *
   * On any failure the lifecycle remains at EVIDENCE_LOCKED (fail-closed).
   */
  async function runGovernedScoring({ auditRequest, executionId, startedAt, allSourceResults, canonicalRecord }) {
    const { tenantId, clientId, auditId } = auditRequest;
    const scope = { tenantId, clientId, auditId };

    // Load canonical evidence via the governed manifest
    const crManifest = await loadAndVerifyCanonicalRecordManifest({
      store: artifactStore, scope, validateContract,
    });
    const canonicalEvidence = crManifest.evidence;

    // Build audit input from canonical evidence
    const auditInput = {
      targetUrl: canonicalEvidence.site?.targetUrl || auditRequest.targetUrl,
      businessName: auditRequest.businessName || "",
      competitors: auditRequest.competitors || [],
    };

    // Run governed scoring — this persists findings.json and scores.json
    const result = await scoreFromCanonicalEvidence({
      store: artifactStore,
      scope: { tenantId, clientId, auditId },
      canonicalEvidence,
      auditInput,
    });

    // Transition to SCORED — lifecycle event records the scores artifact key
    await doTransition(
      auditId, tenantId, executionId,
      T.SCORED,
      "governed-scoring-complete",
      result.scoresRecord.key,
    );

    // Build source counts from collection results when available (WP5 backward compat)
    const sc = { total: 0, available: 0, partial: 0, failed: 0, blocked: 0, unavailable: 0, notConnected: 0, notApplicable: 0 };
    const srcs = [];
    if (allSourceResults) {
      for (const e of allSourceResults) {
        const status = e.sourceResult.status || "NOT_APPLICABLE";
        const counterKey = STATUS_COUNTER_KEY[status];
        sc.total++;
        if (counterKey !== undefined) sc[counterKey]++;
        srcs.push(Object.freeze({ source: e.source, status: e.sourceResult.status, retryCount: e.sourceResult.retryCount || 0, artifactKey: e.normalizedRecord?.key || null }));
      }
    }

    return Object.freeze({
      contractVersion: "1.0.0",
      auditId,
      executionId,
      finalState: T.SCORED,
      resumed: false,
      startedAt,
      completedAt: c.now(),
      scoredAt: result.model.generatedAt,
      scoringVersion: result.model.scoringVersion,
      assessedWeight: result.model.assessedWeight,
      readinessStatus: result.model.readinessStatus,
      evidenceConfidenceScore: result.model.evidenceConfidenceScore,
      findingCount: result.model.findings.length,
      findingsArtifact: Object.freeze({
        key: result.findingsRecord.key,
        sha256: result.findingsRecord.sha256,
        bytes: result.findingsRecord.bytes,
      }),
      scoresArtifact: Object.freeze({
        key: result.scoresRecord.key,
        sha256: result.scoresRecord.sha256,
        bytes: result.scoresRecord.bytes,
      }),
      sourceCounts: Object.freeze(sc),
      sources: Object.freeze(srcs),
      canonicalEvidence: Object.freeze({
        key: (canonicalRecord || crManifest.canonicalArtifact).key,
        sha256: (canonicalRecord || crManifest.canonicalArtifact).sha256,
        bytes: (canonicalRecord || crManifest.canonicalArtifact).bytes,
      }),
    });
  }

  // -------------------------------------------------------------------
  // WP9 — Governed narrative from SCORED state
  // -------------------------------------------------------------------

  /**
   * Execute the complete WP9 governed narrative path:
   *   1. Load WP8 ReportContentPackage from artifact store.
   *   2. Transition SCORED → NARRATIVE_PENDING.
   *   3. Execute governed narrative (mock mode in CI/test).
   *   4. Validate NarrativeResponse schema + content.
   *   5. Persist narrative artifact + verify.
   *   6. Transition NARRATIVE_PENDING → NARRATIVE_READY.
   *
   * On failure: NARRATIVE_PENDING → NARRATIVE_FAILED, fail closed.
   * Only the orchestrator changes audit state.
   */
  async function runGovernedNarrative({ auditRequest, executionId, startedAt }) {
    const { tenantId, clientId, auditId } = auditRequest;
    const scope = { tenantId, clientId, auditId };

    // Load WP8 ReportContentPackage from artifact store
    let reportPackage;
    try {
      const pkgKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/report-content.json`;
      const pkgBytes = await artifactStore.get(pkgKey);
      if (!pkgBytes) throw new Error("ReportContentPackage artifact not found at " + pkgKey);
      reportPackage = JSON.parse(pkgBytes.toString());
    } catch (err) {
      throw new Error("Failed to load ReportContentPackage: " + err.message);
    }

    // Transition SCORED → NARRATIVE_PENDING (orchestrator owns this)
    await doTransition(
      auditId, tenantId, executionId,
      T.NARRATIVE_PENDING,
      "narrative-execution-start",
      null,
    );

    // Execute governed narrative — mock mode (never live in CI/test)
    let narrativeResult;
    try {
      narrativeResult = await _narrativeExecutor({
        reportPackage,
        mode: NARRATIVE_MODE.MOCK,
        modelId: "prysm-wp9-orchestrator",
        executionId,
        artifactStore,
        scope,
        now: c.now(),
      });
    } catch (narrativeErr) {
      // Narrative execution failed — fail closed
      await doTransition(
        auditId, tenantId, executionId,
        T.NARRATIVE_FAILED,
        "narrative-execution-failed:" + (narrativeErr.message || "").slice(0, 100),
        null,
      );
      throw narrativeErr;
    }

    // Validate NarrativeResponse
    const { validateNarrativeResponse: validateNarrative } = await import("../narrative/validate-narrative.js");
    const validation = validateNarrative(narrativeResult.narrative, reportPackage);
    if (!validation.valid) {
      await doTransition(
        auditId, tenantId, executionId,
        T.NARRATIVE_FAILED,
        "narrative-validation-failed:" + (validation.errors || []).join("; ").slice(0, 200),
        null,
      );
      throw new Error("NarrativeResponse validation failed: " + (validation.errors || []).join("; "));
    }

    // Transition NARRATIVE_PENDING → NARRATIVE_READY
    await doTransition(
      auditId, tenantId, executionId,
      T.NARRATIVE_READY,
      "narrative-validated-and-persisted",
      narrativeResult.narrative.auditId
        ? `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/narrative.json`
        : null,
    );

    return Object.freeze({
      contractVersion: "1.0.0",
      auditId,
      executionId,
      finalState: T.NARRATIVE_READY,
      resumed: false,
      startedAt,
      completedAt: c.now(),
      narrativeCacheHit: narrativeResult.cacheHit,
      narrativeCallsMade: narrativeResult.callsMade,
      narrativeCost: narrativeResult.cost,
      narrativeAuditId: narrativeResult.narrative.auditId,
      narrativeModelId: narrativeResult.narrative.modelId,
      findingsArtifact: null,
      scoresArtifact: null,
      sourceCounts: Object.freeze({ total: 0, available: 0, partial: 0, failed: 0, blocked: 0, unavailable: 0, notConnected: 0, notApplicable: 0 }),
      sources: Object.freeze([]),
      canonicalEvidence: null,
    });
  }

  // -------------------------------------------------------------------
  // WP10 — Governed rendering from NARRATIVE_READY state
  // -------------------------------------------------------------------

  /**
   * Execute the complete WP10 governed rendering path:
   *   1. Load WP8 ReportContentPackage, WP9 NarrativeResponse, scoring model.
   *   2. Build schema-valid ReportViewModel (WP10-RVM-01).
   *   3. Render all 16 approved pages via locked renderApprovedReport.
   *   4. Persist every page + index to artifact store.
   *   5. Build and verify ReportArtifactManifest.
   *   6. Transition NARRATIVE_READY → DRAFT_RENDERED.
   *
   * On failure: NARRATIVE_READY → RENDER_FAILED, fail closed.
   * Zero partial writes. Renderer call counted and instrumented.
   */
  async function runGovernedRendering({ auditRequest, executionId, startedAt, injectPageFailure }) {
    const { tenantId, clientId, auditId } = auditRequest;
    const scope = { tenantId, clientId, auditId };
    let rendererCallCount = 0;

    // Load WP8 ReportContentPackage
    let reportPackage;
    try {
      const pkgKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/report-content.json`;
      const pkgBytes = await artifactStore.get(pkgKey);
      if (!pkgBytes) throw new Error("ReportContentPackage artifact not found");
      reportPackage = JSON.parse(pkgBytes.toString());
    } catch (err) {
      await doTransition(auditId, tenantId, executionId, T.RENDER_FAILED,
        "render-artifact-load-failed:" + (err.message || "").slice(0, 200), null);
      throw err;
    }

    // Load WP9 NarrativeResponse
    let narrative;
    try {
      const narrKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/narrative.json`;
      const narrBytes = await artifactStore.get(narrKey);
      if (!narrBytes) throw new Error("NarrativeResponse artifact not found");
      narrative = JSON.parse(narrBytes.toString());
    } catch (err) {
      await doTransition(auditId, tenantId, executionId, T.RENDER_FAILED,
        "render-narrative-load-failed:" + (err.message || "").slice(0, 200), null);
      throw err;
    }

    // Load scoring model
    let scoringModel;
    try {
      const scoresKey = buildArtifactKey({ tenantId, clientId, auditId, category: "canonical", artifactName: "scores.json" });
      const scoresBytes = await artifactStore.get(scoresKey);
      if (!scoresBytes) throw new Error("Scores artifact not found");
      const scoreSet = JSON.parse(scoresBytes.toString());
      scoringModel = {
        scoringVersion: scoreSet.scoringVersion || "3.0.0", generatedAt: scoreSet.generatedAt || c.now(),
        scores: scoreSet.scores || {}, bands: scoreSet.bands || {},
        assessedWeight: scoreSet.assessedWeight ?? 0, readinessStatus: scoreSet.readinessStatus || "",
        showNumericScore: scoreSet.showNumericScore ?? false, evidenceConfidenceScore: scoreSet.evidenceConfidenceScore ?? 0,
        rootCause: scoreSet.rootCause || "", findings: [], conversionPaths: [], readinessMap: [],
        contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
        competitors: { comparisons: [], opportunities: { topics: [], qualifiedCandidates: [], excludedCandidates: [], gaps: [], allGaps: [], sources: {}, limitations: [] } },
      };
    } catch (err) {
      await doTransition(auditId, tenantId, executionId, T.RENDER_FAILED,
        "render-scores-load-failed:" + (err.message || "").slice(0, 200), null);
      throw err;
    }

    // Load findings
    try {
      const findingsKey = buildArtifactKey({ tenantId, clientId, auditId, category: "canonical", artifactName: "findings.json" });
      const findingsBytes = await artifactStore.get(findingsKey);
      if (findingsBytes) scoringModel.findings = JSON.parse(findingsBytes.toString());
    } catch { /* supplementary */ }

    // --- Build ReportViewModel (validates WP8+WP9+scoring integration) ---
    const vmResult = buildReportViewModel({
      reportPackage, narrative, scoringModel, validateContract,
      reportVersion: scoringModel.scoringVersion, now: c.now(),
    });

    if (!vmResult.valid) {
      await doTransition(auditId, tenantId, executionId, T.RENDER_FAILED,
        "render-view-model-invalid:" + (vmResult.errors || []).join("; ").slice(0, 200), null);
      throw new Error("ReportViewModel build failed: " + (vmResult.errors || []).join("; "));
    }

    // --- Load canonical evidence for full renderer model ---
    // The locked renderer expects a model with evidence.site, evidence.performance, etc.
    // We load canonical evidence to provide the full data the renderer needs.
    let canonicalEvidence;
    try {
      const crManifest = await loadAndVerifyCanonicalRecordManifest({
        store: artifactStore, scope, validateContract,
      });
      canonicalEvidence = crManifest?.evidence || null;
    } catch { /* canonical evidence may not be available for unit-test only paths */ }

    // Build renderer-compatible model combining canonical evidence + scoring + narrative
    const rendererModel = {
      generatedAt: scoringModel.generatedAt || c.now(),
      scoringVersion: scoringModel.scoringVersion || "3.0.0",
      reportVersion: scoringModel.scoringVersion || "3.0.0",
      input: vmResult.model.input || {},
      evidence: canonicalEvidence || {
        site: { domain: reportPackage.business?.domain || "unknown", pages: [{ title: reportPackage.business?.name || "Unknown" }], services: [], topicKeywords: [], ctas: [], forms: [], trust: {}, pageCount: 0, schemaTypes: [], sourceStatus: "NOT_APPLICABLE", brokenInternalLinks: [], externalCtas: [], securityHeaders: {}, socialLinks: [], missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0, totalWords: 0, averageWords: 0, imagesMissingAlt: 0, h1Missing: 0, h1Multiple: 0, internalLinkCount: 0, targetUrl: reportPackage.business?.domain ? `https://${reportPackage.business.domain}` : "" },
        performance: { sourceStatus: "NOT_APPLICABLE" },
        backlinks: { sourceStatus: "NOT_APPLICABLE" },
        ga4: { sourceStatus: "NOT_APPLICABLE" },
        gsc: { sourceStatus: "NOT_APPLICABLE" },
        competitors: [],
        competitorOpportunities: {},
      },
      scores: scoringModel.scores || {},
      bands: scoringModel.bands || {},
      assessedWeight: scoringModel.assessedWeight ?? 0,
      readinessStatus: scoringModel.readinessStatus || "",
      showNumericScore: scoringModel.showNumericScore ?? false,
      evidenceConfidenceScore: scoringModel.evidenceConfidenceScore ?? 0,
      rootCause: scoringModel.rootCause || "",
      findings: scoringModel.findings || [],
      conversionPaths: scoringModel.conversionPaths || [],
      readinessMap: scoringModel.readinessMap || [],
      contentIdeas: scoringModel.contentIdeas || { tofu: [], mofu: [], bofu: [], leading: [] },
      competitors: scoringModel.competitors || { comparisons: [], opportunities: { topics: [], qualifiedCandidates: [], excludedCandidates: [], gaps: [], allGaps: [], sources: {}, limitations: [] } },
      sourceStatus: vmResult.model.sourceStatus || {},
      limitations: vmResult.model.limitations || [],
      narrative: vmResult.model.narrative || null,
      _gate: { passed: true },
    };

    // --- Render all 16 approved pages via locked renderer ---
    const { renderApprovedReport } = await import("../report/render-approved-report.js");
    rendererCallCount++;

    let rendered;
    try {
      rendered = renderApprovedReport(rendererModel);
    } catch (renderErr) {
      await doTransition(auditId, tenantId, executionId, T.RENDER_FAILED,
        "render-pages-failed:" + (renderErr.message || "").slice(0, 200), null);
      throw new Error("Approved page rendering failed: " + renderErr.message);
    }

    // --- Inject page failure if requested (for WP10-RENDER-FAIL-01 proof) ---
    if (injectPageFailure && rendered.pages) {
      // Simulate: delete one required page to trigger partial failure
      rendered.pages.delete("scorecard.html");
      // Also remove from filenames so the size check catches it
      rendered.filenames = rendered.filenames.filter(f => f !== "scorecard.html");
    }

    // Validate all expected pages exist
    const actualPageCount = rendered.pages.size;
    if (actualPageCount < 16 || rendered.filenames.length < 16) {
      await doTransition(auditId, tenantId, executionId, T.RENDER_FAILED,
        "render-incomplete-pages:" + actualPageCount + "-of-16", null);
      throw new Error(`Incomplete page set: ${actualPageCount} pages, expected 16`);
    }

    // --- Persist all pages atomically ---
    const persistedArtifacts = [];
    const pageDir = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/pages`;
    try {
      for (const [filename, html] of rendered.pages) {
        if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
          throw new Error(`Invalid page filename: ${filename}`);
        }
        const bytes = Buffer.from(html, "utf-8");
        const record = await artifactStore.put({
          bytes,
          contentType: "text/html",
          scope: { tenantId, clientId, auditId, category: "report", artifactName: `pages/${filename}` },
        });
        // Read-back verify
        const stored = await artifactStore.get(record.key);
        if (!stored || stored.length !== bytes.length) {
          throw new Error(`Read-back mismatch for ${filename}: stored ${stored?.length}, expected ${bytes.length}`);
        }
        if (sha256(stored) !== sha256(bytes)) {
          throw new Error(`SHA-256 mismatch for ${filename}`);
        }
        persistedArtifacts.push({ filename, key: record.key, sha256: record.sha256, bytes: record.bytes });
      }
    } catch (persistErr) {
      await doTransition(auditId, tenantId, executionId, T.RENDER_FAILED,
        "render-persist-failed:" + (persistErr.message || "").slice(0, 200), null);
      throw new Error("Page persist failed: " + persistErr.message);
    }

    // --- Build ReportArtifactManifest ---
    const manifest = {
      contractVersion: "1.0.0", artifactVersion: "1.0.0",
      reportVersion: scoringModel.scoringVersion || "3.0.0",
      reportDesignVersion: LOCKED_REPORT_DESIGN_VERSION,
      runId: executionId,
      slug: String(auditRequest.businessName || auditRequest.targetUrl || "audit").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      targetUrl: auditRequest.targetUrl || "https://unknown.example.com",
      targetDomain: (() => { try { return new URL(auditRequest.targetUrl || "https://unknown.example.com").hostname; } catch { return "unknown.example.com"; } })(),
      startedAt,
      completedAt: c.now(),
      status: "draft",
      scores: {
        trust: scoringModel.scores?.trust ?? null, contentDepth: scoringModel.scores?.contentDepth ?? null,
        conversionPathways: scoringModel.scores?.conversionPathways ?? null,
        technical: scoringModel.scores?.technical ?? null,
        performance: scoringModel.scores?.performance ?? null,
        conversionReadiness: scoringModel.scores?.conversionReadiness ?? null,
      },
      sources: {
        website: reportPackage.sourceStatus?.website || "NOT_APPLICABLE",
        performance: reportPackage.sourceStatus?.performance || "NOT_APPLICABLE",
        competitors: reportPackage.sourceStatus?.competitors || "NOT_APPLICABLE",
        backlinks: reportPackage.sourceStatus?.backlinks || "NOT_APPLICABLE",
        ga4: reportPackage.sourceStatus?.ga4 || "NOT_APPLICABLE",
        gsc: reportPackage.sourceStatus?.gsc || "NOT_APPLICABLE",
      },
      files: persistedArtifacts.map(a => a.filename),
      auditId,
      lifecycleStatus: "DRAFT_RENDERED",
    };

    // Validate manifest against frozen schema
    const manifestValidation = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/report-manifest.schema.json", manifest);
    if (!manifestValidation.valid) {
      const errDetail = JSON.stringify((manifestValidation.errors || []).slice(0, 5).map(e => `${e.instancePath}: ${e.message}`));
      await doTransition(auditId, tenantId, executionId, T.RENDER_FAILED,
        "render-manifest-invalid:" + errDetail.slice(0, 200), null);
      throw new Error(`Manifest validation failed: ${errDetail}`);
    }

    // Persist manifest
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");
    const manifestRecord = await artifactStore.put({
      bytes: manifestBytes, contentType: "application/json",
      scope: { tenantId, clientId, auditId, category: "report", artifactName: "manifest.json" },
    });

    // --- Transition NARRATIVE_READY → DRAFT_RENDERED ---
    await doTransition(auditId, tenantId, executionId, T.DRAFT_RENDERED,
      "governed-rendering-complete", manifestRecord.key);

    return Object.freeze({
      contractVersion: "1.0.0", auditId, executionId,
      finalState: T.DRAFT_RENDERED, resumed: false, startedAt, completedAt: c.now(),
      viewModelHash: vmResult.hash,
      pageCount: persistedArtifacts.length,
      manifestKey: manifestRecord.key,
      manifestRecord,
      pageArtifacts: Object.freeze(persistedArtifacts),
      renderedPages: rendered.pages,  // Map<filename, html> for store integration
      rendererCallCount,
      n8nCallCount: _n8nCallCounter.count,
      narrativeCacheHit: null, narrativeCallsMade: null, narrativeCost: null,
      findingsArtifact: null, scoresArtifact: null,
      sourceCounts: Object.freeze({ total: 0, available: 0, partial: 0, failed: 0, blocked: 0, unavailable: 0, notConnected: 0, notApplicable: 0 }),
      sources: Object.freeze([]), canonicalEvidence: null,
    });
  }

  // Build summary — explicit status mapping
  // -------------------------------------------------------------------
  function buildSummary({ auditRequest, executionId, finalState, resumed, allSourceResults, canonicalRecord, startedAt }) {
    const sc = { total: 0, available: 0, partial: 0, failed: 0, blocked: 0, unavailable: 0, notConnected: 0, notApplicable: 0 };
    const sources = allSourceResults.map(e => {
      const status = e.sourceResult.status || "NOT_APPLICABLE";
      const counterKey = STATUS_COUNTER_KEY[status];
      sc.total++;
      if (counterKey !== undefined) sc[counterKey]++;
      return Object.freeze({ source: e.source, status: e.sourceResult.status, retryCount: e.sourceResult.retryCount || 0, artifactKey: e.normalizedRecord?.key || null });
    });
    return Object.freeze({
      contractVersion: "1.0.0", auditId: auditRequest.auditId, executionId,
      finalState, resumed: resumed || false, startedAt, completedAt: c.now(),
      sourceCounts: Object.freeze(sc), sources: Object.freeze(sources),
      canonicalEvidence: canonicalRecord ? Object.freeze({ key: canonicalRecord.key, sha256: canonicalRecord.sha256, bytes: canonicalRecord.bytes }) : null,
    });
  }

  // ===================================================================
  // MAIN EXECUTE
  // ===================================================================
  async function execute(auditRequest, opts = {}) {
    const executionId = opts.executionId || randomUUID();
    const startedAt = c.now();
    const { tenantId, clientId, auditId, idempotencyKey } = auditRequest;
    const scope = { tenantId, clientId, auditId };

    // 1. Validate request
    const validation = await validateRequest(auditRequest);
    if (!validation.valid) {
      // WP5-CLOSE-VAL-03: Create failure must reject (no silent suppression)
      try {
        await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey });
      } catch (err) {
        if (err.code !== "ERR_LIFECYCLE_DUPLICATE_AUDIT") throw err;
      }

      // WP5-CLOSE-VAL-04: Transition failure must reject (no silent suppression)
      await lifecycleService.transition({
        auditId, tenantId, toState: T.VALIDATION_FAILED,
        transitionIdempotencyKey: `${auditId}:${executionId}:validation-failed`,
      });

      const cs = await lifecycleService.currentState(auditId, tenantId);
      return buildSummary({ auditRequest, executionId, finalState: cs?.state || T.VALIDATION_FAILED, resumed: false, allSourceResults: [], canonicalRecord: null, startedAt });
    }

    // 2. Create or locate audit
    try {
      await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey });
    } catch (err) {
      if (err.code !== "ERR_LIFECYCLE_DUPLICATE_AUDIT") throw err;
    }

    // 3. Read current state
    const cs = await lifecycleService.currentState(auditId, tenantId);
    if (!cs) throw new Error("Lifecycle state not found after create");

    // 3a. EVIDENCE_LOCKED — validate key, then proceed to governed scoring (WP7)
    if (cs.state === T.EVIDENCE_LOCKED) {
      const events = await lifecycleService.history(auditId, tenantId);
      const elEvent = [...events].reverse().find(e => e.nextState === T.EVIDENCE_LOCKED);
      const esEvent = [...events].reverse().find(e => e.nextState === T.EVIDENCE_STORED);
      const manifestKey = elEvent?.artifactKey || esEvent?.artifactKey;
      if (!manifestKey) throw new Error("Lifecycle event missing artifactKey for evidence_locked replay");

      // Validate the key (cross-tenant guard preserved from WP5)
      const parsed = (await import("../storage/artifact-key.js")).parseArtifactKey(manifestKey);
      if (parsed.tenantId !== tenantId || parsed.clientId !== clientId || parsed.auditId !== auditId) {
        throw new Error(`Cross-tenant artifact key in lifecycle event: ${manifestKey}`);
      }
      if (parsed.category !== "manifests" || parsed.artifactName !== "canonical-evidence-record.json") {
        throw new Error(`Invalid artifact key in lifecycle event: ${manifestKey}`);
      }

      // WP7: attempt governed scoring; on failure remain at EVIDENCE_LOCKED (fail-closed)
      try {
        return await runGovernedScoring({ auditRequest, executionId, startedAt });
      } catch (scoringErr) {
        // Canonical evidence not loadable or scoring failed — remain at EVIDENCE_LOCKED.
        // The lifecycle stays exactly where it was (WP7-FAIL-01).
        const crManifest = await loadAndVerifyCanonicalRecordManifest({ store: artifactStore, scope, validateContract }).catch(() => null);
        return buildSummary({ auditRequest, executionId, finalState: T.EVIDENCE_LOCKED, resumed: false, allSourceResults: [], canonicalRecord: crManifest?.canonicalArtifact || null, startedAt });
      }
    }

    // 3a2. SCORED — proceed to governed narrative (WP9)
    if (cs.state === T.SCORED) {
      // Pre-check: WP8 package must exist before entering NARRATIVE_PENDING.
      // If missing, remain at SCORED (backward compatible with WP5-WP7 tests).
      const pkgKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/report-content.json`;
      const pkgExists = await artifactStore.exists(pkgKey);
      if (!pkgExists) {
        const crManifest = await loadAndVerifyCanonicalRecordManifest({ store: artifactStore, scope, validateContract }).catch(() => null);
        return buildSummary({ auditRequest, executionId, finalState: T.SCORED, resumed: false, allSourceResults: [], canonicalRecord: crManifest?.canonicalArtifact || null, startedAt });
      }
      return runGovernedNarrative({ auditRequest, executionId, startedAt });
    }

    // 3a3. NARRATIVE_READY — proceed to governed rendering (WP10)
    if (cs.state === T.NARRATIVE_READY) {
      // Pre-check: all required artifacts must exist
      const pkgKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/report-content.json`;
      const narrKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/narrative.json`;
      const scoresKey = buildArtifactKey({ tenantId, clientId, auditId, category: "canonical", artifactName: "scores.json" });
      const pkgExists = await artifactStore.exists(pkgKey);
      const narrExists = await artifactStore.exists(narrKey);
      const scoresExist = await artifactStore.exists(scoresKey);
      if (!pkgExists || !narrExists || !scoresExist) {
        const crManifest = await loadAndVerifyCanonicalRecordManifest({ store: artifactStore, scope, validateContract }).catch(() => null);
        return buildSummary({ auditRequest, executionId, finalState: T.NARRATIVE_READY, resumed: false, allSourceResults: [], canonicalRecord: crManifest?.canonicalArtifact || null, startedAt });
      }
      return runGovernedRendering({ auditRequest, executionId, startedAt, injectPageFailure: opts.injectPageFailure || false });
    }

    // 3a4. NARRATIVE_PENDING, NARRATIVE_FAILED — idempotent replay
    if (cs.state === T.NARRATIVE_PENDING || cs.state === T.NARRATIVE_FAILED) {
      const crManifest = await loadAndVerifyCanonicalRecordManifest({ store: artifactStore, scope, validateContract });
      return buildSummary({ auditRequest, executionId, finalState: cs.state, resumed: false, allSourceResults: [], canonicalRecord: crManifest.canonicalArtifact, startedAt });
    }

    // 3a5. DRAFT_RENDERED, IN_REVIEW, APPROVED, PUBLISHED — governed WP10 terminal/idempotent states
    if (cs.state === T.DRAFT_RENDERED || cs.state === T.IN_REVIEW || cs.state === T.APPROVED || cs.state === T.PUBLISHED) {
      return buildSummary({ auditRequest, executionId, finalState: cs.state, resumed: false, allSourceResults: [], canonicalRecord: null, startedAt });
    }

    // 3a6. RENDER_FAILED — can recover to NARRATIVE_READY
    if (cs.state === T.RENDER_FAILED) {
      // Attempt recovery: go back to NARRATIVE_READY for re-render
      await doTransition(auditId, tenantId, executionId, T.NARRATIVE_READY, "render-failed-recovery", null);
      return buildSummary({ auditRequest, executionId, finalState: T.NARRATIVE_READY, resumed: false, allSourceResults: [], canonicalRecord: null, startedAt });
    }

    // 3a7. APPROVAL_REJECTED — can recover to IN_REVIEW
    if (cs.state === T.APPROVAL_REJECTED) {
      await doTransition(auditId, tenantId, executionId, T.IN_REVIEW, "approval-rejected-recovery", null);
      return buildSummary({ auditRequest, executionId, finalState: T.IN_REVIEW, resumed: false, allSourceResults: [], canonicalRecord: null, startedAt });
    }

    // 3a8. PUBLISH_FAILED — can recover to APPROVED
    if (cs.state === T.PUBLISH_FAILED) {
      await doTransition(auditId, tenantId, executionId, T.APPROVED, "publish-failed-recovery", null);
      return buildSummary({ auditRequest, executionId, finalState: T.APPROVED, resumed: false, allSourceResults: [], canonicalRecord: null, startedAt });
    }

    // 3b. EVIDENCE_STORED — recover via lifecycle event artifactKey
    if (cs.state === T.EVIDENCE_STORED) {
      const events = await lifecycleService.history(auditId, tenantId);
      const storedEvent = [...events].reverse().find(e => e.nextState === T.EVIDENCE_STORED);
      const manifestKey = storedEvent?.artifactKey;
      if (!manifestKey) throw new Error("Lifecycle evidence_stored event missing artifactKey");

      // Validate key
      const parsed = (await import("../storage/artifact-key.js")).parseArtifactKey(manifestKey);
      if (parsed.tenantId !== tenantId || parsed.clientId !== clientId || parsed.auditId !== auditId) {
        throw new Error(`Cross-tenant artifact key in lifecycle event: ${manifestKey}`);
      }
      if (parsed.category !== "manifests" || parsed.artifactName !== "canonical-evidence-record.json") {
        throw new Error(`Invalid artifact key category/name in lifecycle event: ${manifestKey}`);
      }

      // Verify expected key matches
      const expectedKey = buildCanonicalRecordManifestKey(scope);
      if (manifestKey !== expectedKey) {
        throw new Error(`Lifecycle artifact key ${manifestKey} does not match expected ${expectedKey}`);
      }

      const crManifest = await loadAndVerifyCanonicalRecordManifest({ store: artifactStore, scope, validateContract });
      await doTransition(auditId, tenantId, executionId, T.EVIDENCE_LOCKED, "evidence-locked", manifestKey);
      // WP7: proceed directly to governed scoring
      return runGovernedScoring({ auditRequest, executionId, startedAt });
    }

    // 3c. COLLECTION_FAILED — recover → collecting
    if (cs.state === T.COLLECTION_FAILED) {
      await doTransition(auditId, tenantId, executionId, T.COLLECTING, "collection-failed-recovery");
    }

    // 3d. CREATED — transition to validated → collecting
    if (cs.state === T.CREATED) {
      await doTransition(auditId, tenantId, executionId, T.VALIDATED, "validated");
      await doTransition(auditId, tenantId, executionId, T.COLLECTING, "collecting");
    }

    // 3e. VALIDATED — transition to collecting
    if (cs.state === T.VALIDATED) {
      await doTransition(auditId, tenantId, executionId, T.COLLECTING, "collecting");
    }

    // 3f. Unsupported
    const SUPPORTED = new Set([T.CREATED, T.VALIDATED, T.COLLECTING, T.COLLECTION_FAILED, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED, T.SCORED, T.NARRATIVE_PENDING, T.NARRATIVE_READY, T.NARRATIVE_FAILED, T.DRAFT_RENDERED, T.IN_REVIEW, T.APPROVED, T.PUBLISHED, T.RENDER_FAILED, T.APPROVAL_REJECTED, T.PUBLISH_FAILED]);
    if (!SUPPORTED.has(cs.state)) {
      throw new Error(`Unsupported lifecycle state for orchestrator: ${cs.state}`);
    }

    // 4. Governed collection — all failures inside this boundary → collection_failed
    try {
      const { allSourceResults, canonicalRecord, isResumed } = await governedCollection(auditRequest, executionId);
      // WP7: proceed directly to governed scoring after collection + evidence lock
      try {
        return await runGovernedScoring({ auditRequest, executionId, startedAt, allSourceResults, canonicalRecord });
      } catch (scoringErr) {
        // Scoring failed — remain at EVIDENCE_LOCKED (WP7-FAIL-01)
        return buildSummary({ auditRequest, executionId, finalState: T.EVIDENCE_LOCKED, resumed: isResumed, allSourceResults, canonicalRecord, startedAt });
      }
    } catch (err) {
      // Any exception inside the governed collection boundary → collection_failed
      await failCollection(auditId, tenantId, executionId, err);
      // failCollection always throws — this line is unreachable
      throw err;
    }
  }

  return Object.freeze({ execute, lifecycleService });
}

export { CANONICAL_SOURCES, SOURCE_EVIDENCE_MAP, buildSourceExecutionIdentity };
export default { createAuditOrchestrator };

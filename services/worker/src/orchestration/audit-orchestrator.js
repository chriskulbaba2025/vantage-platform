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
import { scoreFromCanonicalEvidence } from "../scoring/scoring-service.js";

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
}) {
  const c = clock || defaultClock();

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

    // 3a2. SCORED — idempotent replay; load existing artifacts and return
    if (cs.state === T.SCORED) {
      const events = await lifecycleService.history(auditId, tenantId);
      const scoredEvent = [...events].reverse().find(e => e.nextState === T.SCORED);
      const manifestKey = scoredEvent?.artifactKey;
      // Re-load canonical evidence and scoring artifacts for the summary
      const crManifest = await loadAndVerifyCanonicalRecordManifest({ store: artifactStore, scope, validateContract });
      return buildSummary({ auditRequest, executionId, finalState: T.SCORED, resumed: false, allSourceResults: [], canonicalRecord: crManifest.canonicalArtifact, startedAt });
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
    const SUPPORTED = new Set([T.CREATED, T.VALIDATED, T.COLLECTING, T.COLLECTION_FAILED, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED, T.SCORED]);
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

  return Object.freeze({ execute });
}

export { CANONICAL_SOURCES, SOURCE_EVIDENCE_MAP, buildSourceExecutionIdentity };
export default { createAuditOrchestrator };

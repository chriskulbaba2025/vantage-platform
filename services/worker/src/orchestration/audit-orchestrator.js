/**
 * WP5 Audit Orchestrator — Governed audit execution boundary with recovery.
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
      "https://vantage-platform.io/prysm/contracts/v1/audit-request.schema.json",
      auditRequest,
    );
    return { valid, errors };
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
          retryCount: 0,
          coverage: { requested: 0, completed: 0, failed: 0 },
          limitations: [`No adapter registered for source: ${source}`],
        },
      };
    }

    const key = sourceExecutionKey({
      auditId: auditRequest.auditId, source,
      adapterVersion: "1.0.0",
      configHash: sha256(Buffer.from(JSON.stringify({ source, auditId: auditRequest.auditId }))),
    });

    const policy = resolveSourcePolicy({ policyResolver: retryPolicyResolver, source });

    return executeWithRetry({
      policy, clock: c,
      executeFn: async (sig, att) => adapter.execute({
        auditRequest, source, executionId,
        sourceExecutionKey: key, signal: sig, attempt: att,
      }),
    });
  }

  // -------------------------------------------------------------------
  // Persist raw bytes + read-back verify
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
    if (!rb || rb.length !== rawBytes.length) throw new Error(`Raw byte mismatch for ${source}`);
    if (record.sha256 !== sha256(rawBytes)) throw new Error(`Raw SHA mismatch for ${source}`);
    if (!(await artifactStore.verify(record))) throw new Error(`Raw verification failed for ${source}`);
    return record;
  }

  // -------------------------------------------------------------------
  // Persist normalized + read-back verify
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
    if (!rb || rb.length !== bytes.length) throw new Error(`Normalized byte mismatch for ${source}`);
    if (record.sha256 !== sha256(bytes)) throw new Error(`Normalized SHA mismatch for ${source}`);
    if (!(await artifactStore.verify(record))) throw new Error(`Normalized verification failed for ${source}`);
    return record;
  }

  // -------------------------------------------------------------------
  // Process one source (new execution or restored-from-checkpoint)
  // -------------------------------------------------------------------
  async function processOneSource({ auditRequest, item, executionId, restoredResult }) {
    let sourceResult, rawRecord, normalizedRecord;

    if (restoredResult) {
      // Restore from verified checkpoint — do NOT call adapter
      sourceResult = restoredResult.sourceResult;
      normalizedRecord = restoredResult.normalizedRecord;
      rawRecord = restoredResult.rawRecord;
    } else {
      // Execute adapter
      const execResult = await executeSource({ auditRequest, source: item.source, executionId });
      const { rawBytes, contentType, sourceResult: rawResult } = execResult;

      // Build complete source result
      sourceResult = {
        contractVersion: "1.0.0", schemaVersion: "1.0.0",
        source: item.source,
        provider: rawResult.provider || "mock",
        adapterVersion: rawResult.adapterVersion || "1.0.0",
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

      // Validate
      const sv = validateContract(
        "https://vantage-platform.io/prysm/contracts/v1/source-result.schema.json", sourceResult);
      if (!sv.valid) {
        throw Object.assign(
          new Error(`Source result validation failed for ${item.source}`),
          { infrastructureFailure: true },
        );
      }

      // Persist raw
      rawRecord = null;
      if (rawBytes && rawBytes.length > 0) {
        rawRecord = await persistRaw({ auditRequest, source: item.source, executionId, rawBytes, contentType: contentType || "application/json" });
        sourceResult.artifact = { key: rawRecord.key, sha256: rawRecord.sha256, bytes: rawRecord.bytes, contentType: rawRecord.contentType };
      }

      // Persist normalized
      normalizedRecord = await persistNormalized({ auditRequest, source: item.source, sourceResult });

      // Persist checkpoint manifest
      await persistSourceCheckpointManifest({
        store: artifactStore,
        scope: { tenantId: auditRequest.tenantId, clientId: auditRequest.clientId, auditId: auditRequest.auditId },
        source: item.source,
        sourceExecutionKey: sourceExecutionKey({ auditId: auditRequest.auditId, source: item.source, adapterVersion: "1.0.0", configHash: "" }),
        completedAt: c.now(),
        normalizedRecord,
        rawRecord,
      });
    }

    return { sourceResult, rawRecord, normalizedRecord };
  }

  // -------------------------------------------------------------------
  // Assemble canonical evidence
  // -------------------------------------------------------------------
  async function assembleAndPersistCanonical({ auditRequest, allSourceResults }) {
    const sources = {};
    for (const entry of allSourceResults) {
      const ek = SOURCE_EVIDENCE_MAP[entry.source];
      if (!ek) continue;
      const sr = entry.sourceResult;
      const se = { source: entry.source, status: sr.status, collectedAt: c.now() };
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
      createdAt: c.now(),
    };

    const sv = validateContract("https://vantage-platform.io/prysm/contracts/v1/canonical-evidence.schema.json", evidence);
    if (!sv.valid) throw Object.assign(new Error("Canonical evidence validation failed"), { infrastructureFailure: true });

    const evidenceBytes = Buffer.from(JSON.stringify(evidence), "utf-8");
    const scope = artifactScope({
      tenantId: auditRequest.tenantId, clientId: auditRequest.clientId,
      auditId: auditRequest.auditId, category: "canonical", artifactName: "evidence.json",
    });
    const canonicalRecord = await artifactStore.put({ bytes: evidenceBytes, contentType: "application/json", scope });
    const rb = await artifactStore.get(canonicalRecord.key);
    if (!rb || rb.length !== evidenceBytes.length) throw Object.assign(new Error("Canonical evidence byte mismatch"), { infrastructureFailure: true });
    if (canonicalRecord.sha256 !== sha256(evidenceBytes)) throw Object.assign(new Error("Canonical evidence SHA mismatch"), { infrastructureFailure: true });
    if (!(await artifactStore.verify(canonicalRecord))) throw Object.assign(new Error("Canonical evidence verification failed"), { infrastructureFailure: true });

    return { evidence, canonicalRecord };
  }

  // -------------------------------------------------------------------
  // Transition helper — wraps lifecycle with deterministic idempotency key
  // -------------------------------------------------------------------
  async function doTransition(auditId, tenantId, toState, keySuffix) {
    await lifecycleService.transition({
      auditId, tenantId, toState,
      transitionIdempotencyKey: `${auditId}-${keySuffix}`,
    });
  }

  // -------------------------------------------------------------------
  // Discover verified checkpoints from persisted manifests
  // -------------------------------------------------------------------
  async function discoverCheckpoints(auditRequest, plan) {
    const completed = [];
    for (const item of plan) {
      const restored = await loadAndVerifySourceCheckpointManifest({
        store: artifactStore,
        scope: { tenantId: auditRequest.tenantId, clientId: auditRequest.clientId, auditId: auditRequest.auditId },
        source: item.source,
        validateContract,
      });
      if (restored) {
        completed.push({
          source: item.source,
          completed: true,
          restored,
        });
      }
    }
    return completed;
  }

  // -------------------------------------------------------------------
  // Build concise execution summary
  // -------------------------------------------------------------------
  function buildSummary({ auditRequest, executionId, finalState, resumed, allSourceResults, canonicalRecord, startedAt }) {
    const sc = { total: 0, available: 0, partial: 0, failed: 0, blocked: 0, unavailable: 0, notConnected: 0, notApplicable: 0 };
    const sources = allSourceResults.map(e => {
      const s = e.sourceResult.status.toLowerCase();
      sc.total++;
      if (sc[s] !== undefined) sc[s]++;
      return Object.freeze({ source: e.source, status: e.sourceResult.status, retryCount: e.sourceResult.retryCount || 0, artifactKey: e.normalizedRecord?.key || null });
    });
    return Object.freeze({
      contractVersion: "1.0.0", auditId: auditRequest.auditId, executionId,
      finalState, resumed: resumed || false, startedAt, completedAt: c.now(),
      sourceCounts: Object.freeze(sc), sources: Object.freeze(sources),
      canonicalEvidence: canonicalRecord ? Object.freeze({ key: canonicalRecord.key, sha256: canonicalRecord.sha256, bytes: canonicalRecord.bytes }) : null,
    });
  }

  // -------------------------------------------------------------------
  // MAIN EXECUTE
  // -------------------------------------------------------------------
  async function execute(auditRequest, opts = {}) {
    const executionId = opts.executionId || randomUUID();
    const startedAt = c.now();
    const { tenantId, clientId, auditId, idempotencyKey } = auditRequest;
    const scope = { tenantId, clientId, auditId };

    // 1. Validate request
    const validation = await validateRequest(auditRequest);
    if (!validation.valid) {
      try { await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey }); } catch {}
      try { await doTransition(auditId, tenantId, T.VALIDATION_FAILED, "validation-failed"); } catch {}
      return buildSummary({ auditRequest, executionId, finalState: T.VALIDATION_FAILED, resumed: false, allSourceResults: [], canonicalRecord: null, startedAt });
    }

    // 2. Create or locate audit
    try {
      await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey });
    } catch (err) {
      if (err.code !== "ERR_LIFECYCLE_DUPLICATE_AUDIT") throw err;
    }

    // 3. Determine current state (re-read after create for accurate state)
    const cs = await lifecycleService.currentState(auditId, tenantId);
    if (!cs) throw new Error("Lifecycle state not found after create");

    // 3a. EVIDENCE_LOCKED — locked replay
    if (cs.state === T.EVIDENCE_LOCKED) {
      const canonicalKey = buildCanonicalRecordManifestKey(scope);
      const crManifest = await loadAndVerifyCanonicalRecordManifest({ store: artifactStore, scope, validateContract });
      return buildSummary({
        auditRequest, executionId, finalState: T.EVIDENCE_LOCKED, resumed: false,
        allSourceResults: [], canonicalRecord: crManifest.canonicalArtifact, startedAt,
      });
    }

    // 3b. EVIDENCE_STORED — recover → evidence_locked
    if (cs.state === T.EVIDENCE_STORED) {
      // Locate artifactKey from the evidence_stored lifecycle event
      const events = await lifecycleService.history(auditId, tenantId);
      const storedEvent = [...events].reverse().find(e => e.nextState === T.EVIDENCE_STORED);
      const manifestKey = storedEvent?.artifactKey || buildCanonicalRecordManifestKey(scope);

      const crManifest = await loadAndVerifyCanonicalRecordManifest({ store: artifactStore, scope, validateContract });
      await doTransition(auditId, tenantId, T.EVIDENCE_LOCKED, "evidence-locked");
      return buildSummary({
        auditRequest, executionId, finalState: T.EVIDENCE_LOCKED, resumed: true,
        allSourceResults: [], canonicalRecord: crManifest.canonicalArtifact, startedAt,
      });
    }

    // 3c. COLLECTION_FAILED — recover → collecting
    if (cs.state === T.COLLECTION_FAILED) {
      await doTransition(auditId, tenantId, T.COLLECTING, "collection-failed-recovery");
    }

    // 3d. CREATED — transition to validated → collecting (only for genuinely new audits)
    if (cs.state === T.CREATED) {
      await doTransition(auditId, tenantId, T.VALIDATED, "validated");
      await doTransition(auditId, tenantId, T.COLLECTING, "collecting");
    }

    // 3e. VALIDATED — transition to collecting
    if (cs.state === T.VALIDATED) {
      await doTransition(auditId, tenantId, T.COLLECTING, "collecting");
    }

    // 3f. Already COLLECTING — no entry transition needed
    // (falls through to source execution below)

    // 3g. Unsupported state
    const SUPPORTED = new Set([T.CREATED, T.VALIDATED, T.COLLECTING, T.COLLECTION_FAILED, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED]);
    if (!SUPPORTED.has(cs.state)) {
      throw new Error(`Unsupported lifecycle state for orchestrator: ${cs.state}`);
    }

    // 4. Build source plan
    const plan = buildSourcePlan({
      auditId,
      hasGa4: !!(auditRequest.ga4?.propertyId),
      hasGsc: !!(auditRequest.gsc?.siteUrl),
    });

    // 5. Discover verified checkpoints from persisted manifests
    const verifiedCheckpoints = await discoverCheckpoints(auditRequest, plan);
    const verifiedSources = new Set(verifiedCheckpoints.map(c => c.source));
    const isResumed = verifiedCheckpoints.length > 0;

    // Validate caller-supplied checkpoints against verified manifests
    if (opts.checkpoints) {
      for (const cp of opts.checkpoints) {
        if (cp.completed && !verifiedSources.has(cp.source)) {
          throw Object.assign(
            new Error(`Caller-supplied checkpoint for ${cp.source} has no matching verified manifest`),
            { infrastructureFailure: true },
          );
        }
      }
    }

    // Build checkpoint ledger from verified manifests
    const checkpointRecords = verifiedCheckpoints.map(c => ({
      source: c.source,
      completed: true,
      artifactKey: c.restored.normalizedRecord?.key,
    }));
    const ledger = buildCheckpointLedger(plan, checkpointRecords);

    // 6. Execute or restore sources
    const allSourceResults = [];
    let infrastructureFailed = false;
    let infrastructureError = null;

    for (const item of ledger.checkpoints) {
      // Check for verified checkpoint
      const vcp = verifiedCheckpoints.find(c => c.source === item.source);

      if (vcp && item.completed) {
        // Restore from verified manifest — do NOT call adapter
        allSourceResults.push({
          source: item.source,
          sourceResult: vcp.restored.sourceResult,
          rawRecord: vcp.restored.rawRecord,
          normalizedRecord: vcp.restored.normalizedRecord,
        });
        continue;
      }

      // Execute adapter
      try {
        const result = await processOneSource({
          auditRequest, item, executionId,
          restoredResult: null,
        });
        allSourceResults.push({
          source: item.source,
          sourceResult: result.sourceResult,
          rawRecord: result.rawRecord,
          normalizedRecord: result.normalizedRecord,
        });
      } catch (err) {
        if (err.infrastructureFailure) {
          infrastructureFailed = true;
          infrastructureError = err;
          break; // Stop processing sources immediately
        }
        // Source-level failure — record and continue
        allSourceResults.push({
          source: item.source,
          sourceResult: {
            contractVersion: "1.0.0", schemaVersion: "1.0.0",
            source: item.source, provider: "unknown", adapterVersion: "0.0.0",
            status: "FAILED", startedAt: c.now(), completedAt: c.now(),
            retryCount: 0,
            coverage: { requested: 0, completed: 0, failed: 0 },
            limitations: [`Source execution error: ${err.message}`],
            errorCategory: "internal",
          },
          rawRecord: null, normalizedRecord: null,
        });
      }
    }

    // 7. Handle infrastructure failure
    if (infrastructureFailed) {
      if (cs.state === T.COLLECTING || cs.state === T.COLLECTION_FAILED) {
        try {
          await doTransition(auditId, tenantId, T.COLLECTION_FAILED, "collection-failed");
        } catch {}
      }
      throw infrastructureError;
    }

    // 8. Assemble and persist canonical evidence
    const { canonicalRecord } = await assembleAndPersistCanonical({ auditRequest, allSourceResults });

    // 9. Persist canonical record manifest
    const manifestRecord = await persistCanonicalRecordManifest({
      store: artifactStore, scope, createdAt: c.now(), canonicalRecord,
    });
    const manifestKey = manifestRecord.key;

    // 10. COLLECTING → EVIDENCE_STORED (with manifest key as artifactKey)
    await lifecycleService.transition({
      auditId, tenantId, toState: T.EVIDENCE_STORED,
      transitionIdempotencyKey: `${auditId}-evidence-stored`,
      artifactKey: manifestKey,
    });

    // 11. EVIDENCE_STORED → EVIDENCE_LOCKED
    await lifecycleService.transition({
      auditId, tenantId, toState: T.EVIDENCE_LOCKED,
      transitionIdempotencyKey: `${auditId}-evidence-locked`,
      artifactKey: manifestKey,
    });

    return buildSummary({
      auditRequest, executionId, finalState: T.EVIDENCE_LOCKED,
      resumed: isResumed, allSourceResults, canonicalRecord, startedAt,
    });
  }

  return Object.freeze({ execute });
}

export { CANONICAL_SOURCES, SOURCE_EVIDENCE_MAP };
export default { createAuditOrchestrator };

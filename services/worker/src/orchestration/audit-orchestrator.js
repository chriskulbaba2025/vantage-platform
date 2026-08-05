/**
 * WP5 Audit Orchestrator — Governed audit execution boundary.
 *
 * Executes a full audit from CREATED through EVIDENCE_LOCKED using
 * dependency-injected WP2-WP4 governed modules. No production adapters,
 * databases, storage clients, or global infrastructure are instantiated
 * internally.
 *
 * @module orchestration/audit-orchestrator
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { buildSourcePlan, buildCheckpointLedger, sourceExecutionKey, CANONICAL_SOURCES } from "../lifecycle/source-plan.js";
import { LIFECYCLE_STATE } from "../lifecycle/state-enum.js";
import { resolveSourcePolicy, executeWithRetry } from "./retry-policy.js";

const T = LIFECYCLE_STATE;
const ORCHESTRATOR_VERSION = "5.0.0";

// ---------------------------------------------------------------------------
// Source → canonical evidence key mapping
// ---------------------------------------------------------------------------
const SOURCE_EVIDENCE_MAP = Object.freeze({
  "dataforseo-onpage": "website",
  "pagespeed":           "performance",
  "dataforseo-serp":     "competitors",
  "backlinks":           "backlinks",
  "ga4":                 "ga4",
  "gsc":                 "gsc",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a governed Audit Orchestrator.
 *
 * @param {object} deps
 * @param {object} deps.lifecycleService — WP4 lifecycle service { create, transition, currentState, history }
 * @param {object} deps.artifactStore — WP3 governed artifact store { put, get, exists, verify }
 * @param {object} deps.adapters — Map of source key → { execute }
 * @param {function} deps.validateContract — (schemaId, obj) => { valid, errors }
 * @param {object} [deps.clock] — { now, sleep, setTimeout }
 * @param {object} [deps.timer] — injected timer for tests
 * @param {function} [deps.retryPolicyResolver] — (source) => policy
 * @returns {object} orchestrator { execute }
 */
export function createAuditOrchestrator({
  lifecycleService,
  artifactStore,
  adapters,
  validateContract,
  clock,
  timer,
  retryPolicyResolver,
}) {
  const c = clock || defaultClock();

  // -----------------------------------------------------------------------
  // Validate audit request
  // -----------------------------------------------------------------------
  async function validateRequest(auditRequest) {
    const { valid, errors } = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/audit-request.schema.json",
      auditRequest,
    );
    return { valid, errors };
  }

  // -----------------------------------------------------------------------
  // Execute one source adapter
  // -----------------------------------------------------------------------
  async function executeSource({
    auditRequest, source, executionId,
    checkpoints, attempt, signal,
  }) {
    const adapter = adapters[source];
    if (!adapter) {
      return {
        rawBytes: null,
        contentType: null,
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
      auditId: auditRequest.auditId,
      source,
      adapterVersion: "1.0.0", // Mocked — WP6 supplies real versions
      configHash: sha256(Buffer.from(JSON.stringify({ source, auditRequest: auditRequest.auditId }))),
    });

    const policy = resolveSourcePolicy({ policyResolver: retryPolicyResolver, source });

    return executeWithRetry({
      policy,
      clock: c,
      executeFn: async (sig, att) => {
        return adapter.execute({
          auditRequest,
          source,
          executionId,
          sourceExecutionKey: key,
          signal: sig,
          attempt: att,
        });
      },
    });
  }

  // -----------------------------------------------------------------------
  // Persist raw bytes and verify
  // -----------------------------------------------------------------------
  async function persistRawBytes({ auditRequest, source, executionId, rawBytes, contentType }) {
    if (!rawBytes || rawBytes.length === 0) return null;

    const scope = artifactScope({
      tenantId: auditRequest.tenantId,
      clientId: auditRequest.clientId,
      auditId: auditRequest.auditId,
      category: "raw",
      artifactName: `${source}-${executionId}.json`,
    });

    // 1. Write
    const record = await artifactStore.put({ bytes: rawBytes, contentType, scope, source, executionId });

    // 2. Read back
    const readBack = await artifactStore.get(record.key);

    // 3. Verify exact bytes
    if (!readBack || readBack.length !== rawBytes.length) {
      throw new Error(`Raw artifact byte mismatch for ${source}: wrote ${rawBytes.length}, read ${readBack?.length || 0}`);
    }

    // 4. Verify SHA
    if (record.sha256 !== sha256(rawBytes)) {
      throw new Error(`Raw artifact SHA mismatch for ${source}`);
    }

    // 5. Verify via artifact store
    const verified = await artifactStore.verify(record);
    if (!verified) {
      throw new Error(`Raw artifact verification failed for ${source}`);
    }

    return record;
  }

  // -----------------------------------------------------------------------
  // Persist normalized result and verify
  // -----------------------------------------------------------------------
  async function persistNormalized({ auditRequest, source, sourceResult }) {
    const normalizedBytes = Buffer.from(JSON.stringify(sourceResult), "utf-8");
    const scope = artifactScope({
      tenantId: auditRequest.tenantId,
      clientId: auditRequest.clientId,
      auditId: auditRequest.auditId,
      category: "normalized",
      artifactName: `${source}.json`,
    });

    const record = await artifactStore.put({
      bytes: normalizedBytes,
      contentType: "application/json",
      scope,
      source,
    });

    // Read-back verify
    const readBack = await artifactStore.get(record.key);
    if (!readBack || readBack.length !== normalizedBytes.length) {
      throw new Error(`Normalized artifact byte mismatch for ${source}`);
    }
    if (record.sha256 !== sha256(normalizedBytes)) {
      throw new Error(`Normalized artifact SHA mismatch for ${source}`);
    }
    const verified = await artifactStore.verify(record);
    if (!verified) {
      throw new Error(`Normalized artifact verification failed for ${source}`);
    }

    return record;
  }

  // -----------------------------------------------------------------------
  // Assemble and persist canonical evidence
  // -----------------------------------------------------------------------
  async function assembleCanonicalEvidence({ auditRequest, sourceResults, artifactRecords }) {
    const sources = {};

    // Per-source field allowances (from canonical-evidence.schema.json):
    //   website, performance: full set (provider, adapterVersion, startedAt,
    //     completedAt, requestId, retryCount, coverage, artifactRef, limitations)
    //   backlinks, ga4, gsc: provider, adapterVersion, artifactRef, limitations
    //     (no startedAt, completedAt, requestId, retryCount, coverage)
    //   competitors: only source, status, collectedAt
    const FULL_SOURCES = new Set(["website", "performance"]);
    const MID_SOURCES = new Set(["backlinks", "ga4", "gsc"]);

    for (const entry of sourceResults) {
      const evidenceKey = SOURCE_EVIDENCE_MAP[entry.source];
      if (!evidenceKey) continue;

      const artifactRecord = artifactRecords.find(r => r.source === entry.source);
      const sr = entry.sourceResult;

      const sourceEntry = {
        source: entry.source,
        status: sr.status,
        collectedAt: c.now(),
      };

      if (FULL_SOURCES.has(evidenceKey)) {
        sourceEntry.provider = sr.provider || "unknown";
        sourceEntry.adapterVersion = sr.adapterVersion || "0.0.0";
        sourceEntry.startedAt = sr.startedAt || c.now();
        sourceEntry.completedAt = sr.completedAt || c.now();
        sourceEntry.retryCount = sr.retryCount || 0;
        sourceEntry.coverage = sr.coverage || { requested: 0, completed: 0, failed: 0 };
        sourceEntry.limitations = sr.limitations || [];
        if (sr.requestId) sourceEntry.requestId = sr.requestId;
        if (artifactRecord) {
          sourceEntry.artifactRef = { key: artifactRecord.key, sha256: artifactRecord.sha256, bytes: artifactRecord.bytes };
        }
      } else if (MID_SOURCES.has(evidenceKey)) {
        sourceEntry.provider = sr.provider || "unknown";
        sourceEntry.adapterVersion = sr.adapterVersion || "0.0.0";
        sourceEntry.limitations = sr.limitations || [];
        if (artifactRecord) {
          sourceEntry.artifactRef = { key: artifactRecord.key, sha256: artifactRecord.sha256, bytes: artifactRecord.bytes };
        }
      }

      sources[evidenceKey] = sourceEntry;
    }

    // Ensure required website source exists
    if (!sources.website) {
      sources.website = {
        source: "dataforseo-onpage",
        provider: "unknown",
        adapterVersion: "0.0.0",
        status: "NOT_APPLICABLE",
        startedAt: c.now(),
        completedAt: c.now(),
        retryCount: 0,
        coverage: { requested: 0, completed: 0, failed: 0 },
        limitations: ["Website source not collected"],
        collectedAt: c.now(),
      };
    }

    const allLimitations = [];
    const artifactReferences = [];
    const adapterVersions = {};

    for (const entry of sourceResults) {
      const sr = entry.sourceResult;
      if (sr.limitations) allLimitations.push(...sr.limitations);

      const artifactRecord = artifactRecords.find(r => r.source === entry.source);
      if (artifactRecord) {
        artifactReferences.push({
          source: entry.source,
          key: artifactRecord.key,
          sha256: artifactRecord.sha256,
          bytes: artifactRecord.bytes,
          contentType: artifactRecord.contentType,
        });
      }

      if (sr.adapterVersion) {
        adapterVersions[entry.source] = sr.adapterVersion;
      }
    }

    const evidence = {
      contractVersion: "1.0.0",
      evidenceVersion: "1.0.0",
      auditId: auditRequest.auditId,
      normalizedRequest: {
        targetUrl: auditRequest.targetUrl,
        businessName: auditRequest.businessName,
        market: auditRequest.market,
        language: auditRequest.language,
        primaryGoal: auditRequest.primaryGoal,
        services: auditRequest.services || [],
        competitors: auditRequest.competitors || [],
      },
      sources,
      limitations: allLimitations,
      artifactReferences,
      adapterVersions,
      createdAt: c.now(),
    };

    // Validate against canonical-evidence schema
    const { valid, errors } = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/canonical-evidence.schema.json",
      evidence,
    );
    if (!valid) {
      throw new Error(`Canonical evidence validation failed: ${(errors || []).map(e => e.message || e).join("; ")}`);
    }

    // Persist
    const evidenceBytes = Buffer.from(JSON.stringify(evidence), "utf-8");
    const scope = artifactScope({
      tenantId: auditRequest.tenantId,
      clientId: auditRequest.clientId,
      auditId: auditRequest.auditId,
      category: "canonical",
      artifactName: "evidence.json",
    });

    const record = await artifactStore.put({
      bytes: evidenceBytes,
      contentType: "application/json",
      scope,
    });

    // Read-back verify
    const readBack = await artifactStore.get(record.key);
    if (!readBack || readBack.length !== evidenceBytes.length) {
      throw new Error("Canonical evidence byte mismatch on read-back");
    }
    if (record.sha256 !== sha256(evidenceBytes)) {
      throw new Error("Canonical evidence SHA mismatch");
    }
    const verified = await artifactStore.verify(record);
    if (!verified) {
      throw new Error("Canonical evidence verification failed");
    }

    return { evidence, record };
  }

  // -----------------------------------------------------------------------
  // Build concise execution summary
  // -----------------------------------------------------------------------
  function buildSummary({ auditRequest, executionId, finalState, resumed, sourceResults, evidenceRecord, startedAt }) {
    const sourceCounts = { total: 0, available: 0, partial: 0, failed: 0, blocked: 0, unavailable: 0, notConnected: 0, notApplicable: 0 };

    const sources = sourceResults.map(entry => {
      const sr = entry.sourceResult;
      const status = (sr.status || "NOT_APPLICABLE").toLowerCase();
      sourceCounts.total++;
      if (sourceCounts[status] !== undefined) sourceCounts[status]++;
      else if (status === "not_connected") sourceCounts.notConnected++;

      const artifactRecord = entry.artifactRecord;
      return Object.freeze({
        source: entry.source,
        status: sr.status,
        retryCount: sr.retryCount || 0,
        artifactKey: artifactRecord?.key || null,
      });
    });

    return Object.freeze({
      contractVersion: "1.0.0",
      auditId: auditRequest.auditId,
      executionId,
      finalState,
      resumed: resumed || false,
      startedAt,
      completedAt: c.now(),
      sourceCounts: Object.freeze(sourceCounts),
      sources: Object.freeze(sources),
      canonicalEvidence: evidenceRecord ? Object.freeze({
        key: evidenceRecord.key,
        sha256: evidenceRecord.sha256,
        bytes: evidenceRecord.bytes,
      }) : null,
    });
  }

  // -----------------------------------------------------------------------
  // Main execute entry point
  // -----------------------------------------------------------------------
  async function execute(auditRequest, opts = {}) {
    const executionId = opts.executionId || randomUUID();
    const startedAt = c.now();
    const { tenantId, clientId, auditId, idempotencyKey } = auditRequest;

    // ── 1. Validate request ──
    const validation = await validateRequest(auditRequest);
    if (!validation.valid) {
      try {
        await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey });
      } catch {}
      try {
        await lifecycleService.transition({
          auditId, tenantId, toState: T.VALIDATION_FAILED,
          transitionIdempotencyKey: `${executionId}-validation-failed`,
        });
      } catch {}
      return buildSummary({
        auditRequest, executionId,
        finalState: T.VALIDATION_FAILED,
        resumed: false, sourceResults: [],
        evidenceRecord: null, startedAt,
      });
    }

    // ── 2. CREATED → VALIDATED ──
    try {
      await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey });
    } catch (err) {
      if (err.code !== "ERR_LIFECYCLE_DUPLICATE_AUDIT") throw err;
    }

    // ── 2.5 Check if already locked (idempotent replay) ──
    const currentAfterCreate = await lifecycleService.currentState(auditId, tenantId);
    if (currentAfterCreate && currentAfterCreate.state === T.EVIDENCE_LOCKED) {
      // Already locked — idempotent replay, no adapter calls
      let evidenceRecord = null;
      try {
        const evidenceKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/canonical/evidence.json`;
        const exists = await artifactStore.exists(evidenceKey);
        if (exists) {
          const buf = await artifactStore.get(evidenceKey);
          evidenceRecord = {
            key: evidenceKey,
            sha256: sha256(buf),
            bytes: buf.length,
          };
        }
      } catch {}
      return buildSummary({
        auditRequest, executionId,
        finalState: T.EVIDENCE_LOCKED,
        resumed: false, sourceResults: [],
        evidenceRecord, startedAt,
      });
    }

    await lifecycleService.transition({
      auditId, tenantId, toState: T.VALIDATED,
      transitionIdempotencyKey: `${executionId}-validated`,
    });

    // ── 3. VALIDATED → COLLECTING ──
    await lifecycleService.transition({
      auditId, tenantId, toState: T.COLLECTING,
      transitionIdempotencyKey: `${executionId}-collecting`,
    });

    // ── 5. Build source plan ──
    const plan = buildSourcePlan({
      auditId,
      hasGa4: !!(auditRequest.ga4?.propertyId),
      hasGsc: !!(auditRequest.gsc?.siteUrl),
    });

    // ── 6. Checkpoints for resume ──
    const prevCheckpoints = opts.checkpoints || [];
    const ledger = buildCheckpointLedger(plan, prevCheckpoints);
    const isResumed = prevCheckpoints.length > 0 && !ledger.done;

    // ── 7. Execute sources ──
    const sourceResults = [];
    const artifactRecords = [];

    for (const item of ledger.checkpoints) {
      if (item.completed) {
        // Already completed — skip (resume)
        sourceResults.push({
          source: item.source,
          sourceResult: { status: "AVAILABLE", source: item.source },
          artifactRecord: item.artifactKey ? { key: item.artifactKey } : null,
        });
        continue;
      }

      try {
        const execResult = await executeSource({
          auditRequest,
          source: item.source,
          executionId,
          checkpoints: prevCheckpoints,
          signal: new AbortController().signal,
        });

        const { rawBytes, contentType, sourceResult: rawResult } = execResult;

        // Build complete source result
        const sourceResult = {
          contractVersion: "1.0.0",
          schemaVersion: "1.0.0",
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
        if (rawResult.errorCategory) {
          sourceResult.errorCategory = rawResult.errorCategory;
        }

        // Validate source result
        const srValidation = validateContract(
          "https://vantage-platform.io/prysm/contracts/v1/source-result.schema.json",
          sourceResult,
        );
        if (!srValidation.valid) {
          throw new Error(`Source result validation failed for ${item.source}: ${srValidation.errors?.map(e => e.message || e).join("; ")}`);
        }

        // Persist raw bytes if received
        let rawRecord = null;
        if (rawBytes && rawBytes.length > 0) {
          rawRecord = await persistRawBytes({
            auditRequest, source: item.source,
            executionId, rawBytes, contentType: contentType || "application/json",
          });
          if (rawRecord) {
            sourceResult.artifact = {
              key: rawRecord.key,
              sha256: rawRecord.sha256,
              bytes: rawRecord.bytes,
              contentType: rawRecord.contentType,
            };
          }
        }

        // Persist normalized result
        const normalizedRecord = await persistNormalized({
          auditRequest,
          source: item.source,
          sourceResult,
        });

        sourceResults.push({
          source: item.source,
          sourceResult,
          artifactRecord: normalizedRecord,
        });

        if (normalizedRecord) artifactRecords.push(normalizedRecord);

      } catch (err) {
        // Source failure — record and continue
        sourceResults.push({
          source: item.source,
          sourceResult: {
            contractVersion: "1.0.0",
            schemaVersion: "1.0.0",
            source: item.source,
            provider: "unknown",
            adapterVersion: "0.0.0",
            status: "FAILED",
            startedAt: c.now(),
            completedAt: c.now(),
            retryCount: 0,
            coverage: { requested: 0, completed: 0, failed: 0 },
            limitations: [`Source execution error: ${err.message}`],
            errorCategory: "internal",
          },
          artifactRecord: null,
        });
      }
    }

    // ── 8. Assemble canonical evidence ──
    const { evidence, record: evidenceRecord } = await assembleCanonicalEvidence({
      auditRequest,
      sourceResults: sourceResults.filter(r => r.sourceResult && r.sourceResult.source),
      artifactRecords,
    });

    // ── 9. COLLECTING → EVIDENCE_STORED ──
    await lifecycleService.transition({
      auditId, tenantId, toState: T.EVIDENCE_STORED,
      transitionIdempotencyKey: `${executionId}-evidence-stored`,
    });

    // ── 10. EVIDENCE_STORED → EVIDENCE_LOCKED ──
    await lifecycleService.transition({
      auditId, tenantId, toState: T.EVIDENCE_LOCKED,
      transitionIdempotencyKey: `${executionId}-evidence-locked`,
    });

    // ── 11. Build summary ──
    return buildSummary({
      auditRequest, executionId,
      finalState: T.EVIDENCE_LOCKED,
      resumed: isResumed,
      sourceResults: sourceResults.filter(r => r.sourceResult && r.sourceResult.source),
      evidenceRecord: {
        key: evidenceRecord.key,
        sha256: evidenceRecord.sha256,
        bytes: evidenceRecord.bytes,
      },
      startedAt,
    });
  }

  return Object.freeze({ execute });
}

export { CANONICAL_SOURCES, SOURCE_EVIDENCE_MAP };
export default { createAuditOrchestrator };

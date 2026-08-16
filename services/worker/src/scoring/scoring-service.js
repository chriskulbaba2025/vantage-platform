/**
 * WP7 Scoring Service — Governed boundary from locked canonical evidence
 * to persisted findings and scores artifacts, concluding with the
 * EVIDENCE_LOCKED → SCORED lifecycle transition.
 *
 * This module is the single integration point between:
 *   1. WP3 Artifact Store (canonical artifact persistence)
 *   2. WP4 Lifecycle (EVIDENCE_LOCKED → SCORED)
 *   3. WP5 Orchestrator (canonical evidence handoff)
 *   4. Deterministic scoring (vantage-score.js)
 *
 * It does NOT invoke provider adapters, n8n, LLMs, or the report renderer.
 *
 * @module scoring/scoring-service
 */

import { createHash } from "node:crypto";
import { scoreAudit, SCORING_VERSION } from "./vantage-score.js";
import { buildArtifactKey } from "../storage/artifact-key.js";
import { loadAndValidateCapabilityEvidence } from "../evidence/capability-evidence.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Build a deterministic scoredAt timestamp from canonical evidence.
 * Uses max(collectedAt) across all evidence sources so identical evidence
 * always produces identical scoredAt.
 */
function deriveScoredAt(evidence) {
  const timestamps = [];
  const sources = ["site", "performance", "ga4", "gsc", "backlinks"];
  for (const key of sources) {
    const ev = evidence[key];
    const ts = ev?.collectedAt || ev?._sourceStatus?.completedAt;
    if (ts) timestamps.push(new Date(ts).getTime());
  }
  // Support both legacy array format and decision-evidence object format
  const compRaw = evidence.competitors || [];
  const competitors = Array.isArray(compRaw) ? compRaw : (compRaw.competitors || []);
  for (const c of competitors) {
    if (c.collectedAt) timestamps.push(new Date(c.collectedAt).getTime());
  }
  if (timestamps.length === 0) {
    return new Date(0).toISOString();
  }
  return new Date(Math.max(...timestamps)).toISOString();
}

// ---------------------------------------------------------------------------
// Artifact persistence
// ---------------------------------------------------------------------------

/**
 * Persist findings array as `findings.json` under the canonical artifact
 * boundary and verify the stored bytes and SHA-256.
 *
 * @param {object} opts
 * @param {import("../storage/governed-artifact-store.js").ArtifactStore} opts.store
 * @param {{ tenantId: string, clientId: string, auditId: string }} opts.scope
 * @param {Array<object>} opts.findings - Array of governed finding objects
 * @returns {Promise<import("../storage/governed-artifact-store.js").ArtifactRecord>}
 */
export async function persistFindings({ store, scope, findings, validateContract }) {
  // Validate each finding against the governed Finding contract before
  // persistence.  Malformed findings must never reach the artifact store.
  if (validateContract) {
    for (let i = 0; i < findings.length; i++) {
      const fv = validateContract(
        "https://vantage-platform.io/prysm/contracts/v1/finding.schema.json",
        findings[i],
      );
      if (!fv || !fv.valid) {
        throw new Error(
          `Finding[${i}] (ruleId=${findings[i].ruleId || "?"}) validation failed: ` +
          `${JSON.stringify((fv?.errors || []).slice(0, 3))}`,
        );
      }
    }
  }

  const bytes = Buffer.from(JSON.stringify(findings, null, 2), "utf-8");
  const key = buildArtifactKey({
    tenantId: scope.tenantId,
    clientId: scope.clientId,
    auditId: scope.auditId,
    category: "canonical",
    artifactName: "findings.json",
  });

  const record = await store.put({
    bytes,
    contentType: "application/json",
    scope: {
      tenantId: scope.tenantId,
      clientId: scope.clientId,
      auditId: scope.auditId,
      category: "canonical",
      artifactName: "findings.json",
    },
  });

  // Verify stored bytes match produced bytes
  if (record.key !== key) {
    throw new Error(`Findings artifact key mismatch: ${record.key} !== ${key}`);
  }
  if (record.bytes !== bytes.length) {
    throw new Error(`Findings artifact byte-length mismatch: ${record.bytes} !== ${bytes.length}`);
  }
  if (record.sha256 !== sha256(bytes)) {
    throw new Error("Findings artifact SHA-256 mismatch");
  }

  // Read-back verification
  const stored = await store.get(key);
  if (!stored || stored.length !== bytes.length) {
    throw new Error("Findings artifact read-back byte-length mismatch");
  }
  if (sha256(stored) !== record.sha256) {
    throw new Error("Findings artifact read-back SHA-256 mismatch");
  }

  // Governed verify
  const verified = await store.verify(record);
  if (!verified) {
    throw new Error("Findings artifact store.verify() failed");
  }

  return record;
}

/**
 * Persist Score Set as `scores.json` under the canonical artifact boundary
 * and verify the stored bytes and SHA-256.
 *
 * @param {object} opts
 * @param {import("../storage/governed-artifact-store.js").ArtifactStore} opts.store
 * @param {{ tenantId: string, clientId: string, auditId: string }} opts.scope
 * @param {object} opts.scoreSet - Governed Score Set object
 * @returns {Promise<import("../storage/governed-artifact-store.js").ArtifactRecord>}
 */
export async function persistScores({ store, scope, scoreSet, validateContract }) {
  // Validate ScoreSet against the governed score contract before persistence.
  if (validateContract) {
    const sv = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/score.schema.json",
      scoreSet,
    );
    if (!sv || !sv.valid) {
      throw new Error(
        `ScoreSet validation failed: ${JSON.stringify((sv?.errors || []).slice(0, 5))}`,
      );
    }
  }

  const bytes = Buffer.from(JSON.stringify(scoreSet, null, 2), "utf-8");
  const key = buildArtifactKey({
    tenantId: scope.tenantId,
    clientId: scope.clientId,
    auditId: scope.auditId,
    category: "canonical",
    artifactName: "scores.json",
  });

  const record = await store.put({
    bytes,
    contentType: "application/json",
    scope: {
      tenantId: scope.tenantId,
      clientId: scope.clientId,
      auditId: scope.auditId,
      category: "canonical",
      artifactName: "scores.json",
    },
  });

  // Verify stored bytes match produced bytes
  if (record.key !== key) {
    throw new Error(`Scores artifact key mismatch: ${record.key} !== ${key}`);
  }
  if (record.bytes !== bytes.length) {
    throw new Error(`Scores artifact byte-length mismatch: ${record.bytes} !== ${bytes.length}`);
  }
  if (record.sha256 !== sha256(bytes)) {
    throw new Error("Scores artifact SHA-256 mismatch");
  }

  // Read-back verification
  const stored = await store.get(key);
  if (!stored || stored.length !== bytes.length) {
    throw new Error("Scores artifact read-back byte-length mismatch");
  }
  if (sha256(stored) !== record.sha256) {
    throw new Error("Scores artifact read-back SHA-256 mismatch");
  }

  // Governed verify
  const verified = await store.verify(record);
  if (!verified) {
    throw new Error("Scores artifact store.verify() failed");
  }

  return record;
}

// ---------------------------------------------------------------------------
// Score Set builder
// ---------------------------------------------------------------------------

/**
 * Build a governed Score Set from the scoring model.
 *
 * The Score Set is a subset of the model containing the fields required
 * by the frozen WP2 Score contract — no client-facing prose, no HTML, no
 * raw evidence payload.
 */
function buildScoreSet(model, findingsRecord, scoresRecord) {
  return {
    contractVersion: "1.0.0",
    scoringVersion: SCORING_VERSION,
    generatedAt: model.generatedAt,
    assessedWeight: model.assessedWeight,
    readinessStatus: model.readinessStatus,
    readinessStatusDetail: model.readinessStatusDetail,
    showNumericScore: model.showNumericScore,
    evidenceConfidenceScore: model.evidenceConfidenceScore,
    evidenceConfidenceFactors: model.evidenceConfidenceFactors,
    evidenceConfidenceFactorAvailability: model.evidenceConfidenceFactorAvailability,
    capabilityEvidence: model.capabilityEvidence,
    suppressedFindingReasons: model.suppressedFindingReasons || [],
    aiReadinessBasis: model.aiReadinessBasis || null,
    // WP-G: report design v2 pillar inputs (display-only passthrough).
    moduleScores: model.moduleScores || {},
    moduleEligibility: model.moduleEligibility || {},
    suppressedModules: model.suppressedModules || [],
    scores: model.scores,
    bands: model.bands,
    dimensionEligibility: model.dimensionEligibility,
    moduleEligibility: model.moduleEligibility,
    suppressedModules: model.suppressedModules,
    rootCause: model.rootCause,
    findingCount: model.findings.length,
    findingIds: model.findings.map((f) => f.findingId),
    // Preserve downstream renderer-required data so the ReportViewModel
    // and renderer do not reconstruct these as empty arrays/objects.
    conversionPaths: model.conversionPaths || [],
    readinessMap: model.readinessMap || [],
    contentIdeas: model.contentIdeas || { tofu: [], mofu: [], bofu: [], leading: [] },
    competitors: model.competitors || { comparisons: [], opportunities: { topics: [], qualifiedCandidates: [], excludedCandidates: [], gaps: [], allGaps: [], sources: {}, limitations: [] } },
    renderingDiagnostics: model.renderingDiagnostics || [],
    findingsArtifact: findingsRecord ? {
      key: findingsRecord.key,
      sha256: findingsRecord.sha256,
      bytes: findingsRecord.bytes,
    } : null,
    scoresArtifact: scoresRecord ? {
      key: scoresRecord.key,
      sha256: scoresRecord.sha256,
      bytes: scoresRecord.bytes,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Execute the complete governed WP7 scoring path:
 *
 *   1. Run deterministic scoring from locked canonical evidence.
 *   2. Persist findings.json and verify.
 *   3. Persist scores.json and verify.
 *   4. Return the model, findings record, scores record, and score set.
 *
 * This function does NOT:
 *   - Call any provider adapter
 *   - Make network calls
 *   - Call any LLM
 *   - Write report artifacts
 *   - Modify canonical evidence
 *   - Change lifecycle state (the caller does that)
 *
 * @param {object} opts
 * @param {import("../storage/governed-artifact-store.js").ArtifactStore} opts.store
 * @param {{ tenantId: string, clientId: string, auditId: string }} opts.scope
 * @param {object} opts.canonicalEvidence - Parsed locked canonical evidence
 * @param {object} opts.auditInput - Audit request input ({ targetUrl, businessName, competitors })
 * @param {string} [opts.scoredAt] - Optional explicit scoring timestamp
 * @returns {Promise<{ model: object, findingsRecord: object, scoresRecord: object, scoreSet: object }>}
 */
export async function scoreFromCanonicalEvidence({
  store,
  scope,
  canonicalEvidence,
  auditInput,
  scoredAt,
  validateContract,
}) {
  // ── 1. Derive deterministic scoring timestamp ────────────────────────
  const effectiveScoredAt = scoredAt || deriveScoredAt(canonicalEvidence);

  // ── 1b. PRYSM-NEXT-01 WP-D — governed capability evidence is a scoring
  // input.  Load + verify + schema-validate the persisted artifact; a
  // missing or corrupt artifact fails closed (scoring v4 never runs on
  // unknown capability state).
  const capabilityEvidence = await loadAndValidateCapabilityEvidence({
    store,
    scope,
    validateContract,
  });

  // ── 2. Run deterministic scoring ─────────────────────────────────────
  const model = scoreAudit(auditInput, canonicalEvidence, {
    scoredAt: effectiveScoredAt,
    capabilityEvidence,
  });

  // ── 3. Persist findings artifact ─────────────────────────────────────
  const findingsRecord = await persistFindings({
    store,
    scope,
    findings: model.findings,
    validateContract,
  });

  // ── 4. Build and persist scores artifact ─────────────────────────────
  // Persist once. The persisted scoreSet includes findings artifact ref
  // and a placeholder for scores artifact (self-reference resolved after).
  const scoreSet = buildScoreSet(model, findingsRecord, null);
  const scoresRecord = await persistScores({
    store,
    scope,
    scoreSet,
    validateContract,
  });

  // Build final score set with the actual scores record reference
  const finalScoreSet = buildScoreSet(model, findingsRecord, scoresRecord);

  return {
    model,
    findingsRecord,
    scoresRecord,
    scoreSet: finalScoreSet,
  };
}

export { SCORING_VERSION, deriveScoredAt, buildScoreSet };

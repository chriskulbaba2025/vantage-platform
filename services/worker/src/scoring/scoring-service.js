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

    if (ts) {
      timestamps.push(new Date(ts).getTime());
    }
  }

  // Support both legacy array format and decision-evidence object format
  const compRaw = evidence.competitors || [];

  const competitors = Array.isArray(compRaw)
    ? compRaw
    : (compRaw.competitors || []);

  for (const c of competitors) {
    if (c.collectedAt) {
      timestamps.push(new Date(c.collectedAt).getTime());
    }
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
 */
export async function persistFindings({
  store,
  scope,
  findings,
  validateContract,
}) {
  if (validateContract) {
    for (let i = 0; i < findings.length; i += 1) {
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

  const bytes = Buffer.from(
    JSON.stringify(findings, null, 2),
    "utf-8",
  );

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

  if (record.key !== key) {
    throw new Error(
      `Findings artifact key mismatch: ${record.key} !== ${key}`,
    );
  }

  if (record.bytes !== bytes.length) {
    throw new Error(
      `Findings artifact byte-length mismatch: ${record.bytes} !== ${bytes.length}`,
    );
  }

  if (record.sha256 !== sha256(bytes)) {
    throw new Error("Findings artifact SHA-256 mismatch");
  }

  const stored = await store.get(key);

  if (!stored || stored.length !== bytes.length) {
    throw new Error(
      "Findings artifact read-back byte-length mismatch",
    );
  }

  if (sha256(stored) !== record.sha256) {
    throw new Error(
      "Findings artifact read-back SHA-256 mismatch",
    );
  }

  const verified = await store.verify(record);

  if (!verified) {
    throw new Error(
      "Findings artifact store.verify() failed",
    );
  }

  return record;
}

/**
 * Persist Score Set as `scores.json` under the canonical artifact
 * boundary and verify the stored bytes and SHA-256.
 */
export async function persistScores({
  store,
  scope,
  scoreSet,
  validateContract,
}) {
  if (validateContract) {
    const sv = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/score.schema.json",
      scoreSet,
    );

    if (!sv || !sv.valid) {
      throw new Error(
        `ScoreSet validation failed: ${JSON.stringify(
          (sv?.errors || []).slice(0, 5),
        )}`,
      );
    }
  }

  const bytes = Buffer.from(
    JSON.stringify(scoreSet, null, 2),
    "utf-8",
  );

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

  if (record.key !== key) {
    throw new Error(
      `Scores artifact key mismatch: ${record.key} !== ${key}`,
    );
  }

  if (record.bytes !== bytes.length) {
    throw new Error(
      `Scores artifact byte-length mismatch: ${record.bytes} !== ${bytes.length}`,
    );
  }

  if (record.sha256 !== sha256(bytes)) {
    throw new Error("Scores artifact SHA-256 mismatch");
  }

  const stored = await store.get(key);

  if (!stored || stored.length !== bytes.length) {
    throw new Error(
      "Scores artifact read-back byte-length mismatch",
    );
  }

  if (sha256(stored) !== record.sha256) {
    throw new Error(
      "Scores artifact read-back SHA-256 mismatch",
    );
  }

  const verified = await store.verify(record);

  if (!verified) {
    throw new Error(
      "Scores artifact store.verify() failed",
    );
  }

  return record;
}

// ---------------------------------------------------------------------------
// Score Set builder
// ---------------------------------------------------------------------------

/**
 * Build a governed Score Set from the scoring model.
 *
 * The Score Set is a bounded deterministic projection of the governed
 * scoring model. Representative-site coverage is preserved so downstream
 * Writer/Judge interpretation can distinguish assessed pages from the
 * broader discovered site footprint.
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

    evidenceConfidenceScore:
      model.evidenceConfidenceScore,

    evidenceConfidenceFactors:
      model.evidenceConfidenceFactors,

    evidenceConfidenceFactorAvailability:
      model.evidenceConfidenceFactorAvailability,

    capabilityEvidence:
      model.capabilityEvidence,

    suppressedFindingReasons:
      model.suppressedFindingReasons || [],

    aiReadinessBasis:
      model.aiReadinessBasis || null,

    // WP-G: report design v2 pillar inputs.
    moduleScores:
      model.moduleScores || {},

    moduleEligibility:
      model.moduleEligibility || {},

    suppressedModules:
      model.suppressedModules || [],

    scores:
      model.scores,

    bands:
      model.bands,

    dimensionEligibility:
      model.dimensionEligibility,

    rootCause:
      model.rootCause,

    findingCount:
      model.findings.length,

    findingIds:
      model.findings.map(
        (finding) => finding.findingId,
      ),

    // Deterministic report-analysis inputs.
    conversionPaths:
      model.conversionPaths || [],

    readinessMap:
      model.readinessMap || [],

    contentIdeas:
      model.contentIdeas || {
        tofu: [],
        mofu: [],
        bofu: [],
        leading: [],
      },

    competitors:
      model.competitors || {
        comparisons: [],
        opportunities: {
          topics: [],
          qualifiedCandidates: [],
          excludedCandidates: [],
          gaps: [],
          allGaps: [],
          sources: {},
          limitations: [],
        },
      },

    renderingDiagnostics:
      model.renderingDiagnostics || [],

    // Interpretation integrity defect #4:
    // carry the governed representative-site footprint into scores.json.
    // This is a deterministic projection of canonical DecisionEvidence;
    // no footprint values are reconstructed or inferred here.
    ...(model.evidence?.site?.siteFootprint !== undefined
      ? {
          siteFootprint:
            model.evidence.site.siteFootprint,
        }
      : {}),

    findingsArtifact: findingsRecord
      ? {
          key: findingsRecord.key,
          sha256: findingsRecord.sha256,
          bytes: findingsRecord.bytes,
        }
      : null,

    scoresArtifact: scoresRecord
      ? {
          key: scoresRecord.key,
          sha256: scoresRecord.sha256,
          bytes: scoresRecord.bytes,
        }
      : null,
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
 *   - Change lifecycle state
 */
export async function scoreFromCanonicalEvidence({
  store,
  scope,
  canonicalEvidence,
  auditInput,
  scoredAt,
  validateContract,
}) {
  const effectiveScoredAt =
    scoredAt ||
    deriveScoredAt(
      canonicalEvidence,
    );

  const capabilityEvidence =
    await loadAndValidateCapabilityEvidence({
      store,
      scope,
      validateContract,
    });

  const model = scoreAudit(
    auditInput,
    canonicalEvidence,
    {
      scoredAt: effectiveScoredAt,
      capabilityEvidence,
    },
  );

  const findingsRecord =
    await persistFindings({
      store,
      scope,
      findings: model.findings,
      validateContract,
    });

  const scoreSet =
    buildScoreSet(
      model,
      findingsRecord,
      null,
    );

  const scoresRecord =
    await persistScores({
      store,
      scope,
      scoreSet,
      validateContract,
    });

  const finalScoreSet =
    buildScoreSet(
      model,
      findingsRecord,
      scoresRecord,
    );

  return {
    model,
    findingsRecord,
    scoresRecord,
    scoreSet: finalScoreSet,
  };
}

export {
  SCORING_VERSION,
  deriveScoredAt,
  buildScoreSet,
};

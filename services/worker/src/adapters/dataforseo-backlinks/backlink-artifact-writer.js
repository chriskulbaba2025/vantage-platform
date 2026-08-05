/**
 * Backlink Artifact Writer
 *
 * Builds the four output artifacts for a backlink test run:
 *   1. raw-backlinks.json       — Raw DataForSEO response data
 *   2. normalized-backlinks.json — Normalized and classified records
 *   3. backlink-summary.json    — Human-readable summary
 *   4. backlink-manifest.json   — Stable contract for downstream consumers
 *
 * WP3: This module no longer owns permanent writes.  When a governed
 * `store` is passed, artifacts are persisted through the canonical
 * Artifact Store interface.  When omitted, artifact payloads are
 * returned in-memory so the caller decides how to persist them.
 */

import { resolve } from "node:path";
import { writeJsonArtifact } from "../../storage/artifact-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANIFEST_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the output directory. Directory creation is handled by the
 * artifact store on first write.
 */
function resolveOutputDir(outPath) {
  return outPath || resolve("artifacts", "local", "backlink-tests");
}

// ---------------------------------------------------------------------------
// Schema validators (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Required top-level fields for raw-backlinks.json.
 */
const RAW_REQUIRED_FIELDS = [
  "_description",
  "targetDomain",
  "competitorDomains",
  "mode",
  "createdAt",
  "summary",
  "backlinks",
];

/**
 * Required top-level fields for normalized-backlinks.json.
 */
const NORMALIZED_REQUIRED_FIELDS = [
  "_description",
  "targetDomain",
  "competitorDomains",
  "mode",
  "createdAt",
  "totalRecords",
  "records",
];

/**
 * Required top-level fields for backlink-summary.json.
 */
const SUMMARY_REQUIRED_FIELDS = [
  "targetDomain",
  "competitorDomains",
  "totalBacklinksReviewed",
  "goodCount",
  "badCount",
  "worthPursuingCount",
  "ignoredCount",
  "topGoodLinks",
  "topBadPatterns",
  "topWorthPursuingDomains",
  "authoritySummary",
  "limitations",
  "requestCount",
  "estimatedCost",
  "recommendedUse",
  "mode",
  "createdAt",
];

/**
 * Required top-level fields for backlink-manifest.json.
 */
const MANIFEST_REQUIRED_FIELDS = [
  "artifactVersion",
  "generatedAt",
  "mode",
  "target",
  "includeSubdomains",
  "hasCompetitors",
  "competitors",
  "worth_pursuing",
  "summaryMetrics",
  "files",
  "source",
  "limitations",
];

/**
 * Required fields inside manifest.summaryMetrics.
 */
const MANIFEST_METRICS_REQUIRED_FIELDS = [
  "rank",
  "backlinks",
  "referring_domains",
  "referring_pages",
  "backlinks_spam_score",
  "target_spam_score",
];

/**
 * Required fields inside manifest.files.
 */
const MANIFEST_FILES_REQUIRED_FIELDS = [
  "rawBacklinks",
  "normalizedBacklinks",
  "backlinkSummary",
];

/**
 * Required fields inside manifest.source.
 */
const MANIFEST_SOURCE_REQUIRED_FIELDS = [
  "provider",
  "endpoints",
  "responseMode",
];

/**
 * Validate that an object has all required fields (non-missing).
 *
 * @param {object} obj        - The object to validate.
 * @param {string[]} required - List of required field names.
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateRequiredFields(obj, required) {
  const missing = [];
  for (const field of required) {
    if (obj[field] === undefined || obj[field] === null) {
      missing.push(field);
    }
  }
  return { valid: missing.length === 0, missing };
}

/**
 * Validate the raw-backlinks.json artifact structure.
 *
 * @param {object} artifact - Parsed raw artifact.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRawArtifact(artifact) {
  const errors = [];
  const { valid, missing } = validateRequiredFields(
    artifact,
    RAW_REQUIRED_FIELDS,
  );
  if (!valid) {
    errors.push(`Missing required fields: ${missing.join(", ")}`);
  }
  if (artifact && !Array.isArray(artifact.backlinks)) {
    errors.push("backlinks must be an array");
  }
  if (artifact && !artifact.summary) {
    errors.push("summary is required");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate the normalized-backlinks.json artifact structure.
 *
 * @param {object} artifact - Parsed normalized artifact.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateNormalizedArtifact(artifact) {
  const errors = [];
  const { valid, missing } = validateRequiredFields(
    artifact,
    NORMALIZED_REQUIRED_FIELDS,
  );
  if (!valid) {
    errors.push(`Missing required fields: ${missing.join(", ")}`);
  }
  if (artifact && !Array.isArray(artifact.records)) {
    errors.push("records must be an array");
  }
  if (
    artifact &&
    typeof artifact.totalRecords === "number" &&
    artifact.records &&
    artifact.totalRecords !== artifact.records.length
  ) {
    errors.push(
      `totalRecords (${artifact.totalRecords}) does not match records.length (${artifact.records.length})`,
    );
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate the backlink-summary.json artifact structure.
 *
 * @param {object} artifact - Parsed summary artifact.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSummaryArtifact(artifact) {
  const errors = [];
  const { valid, missing } = validateRequiredFields(
    artifact,
    SUMMARY_REQUIRED_FIELDS,
  );
  if (!valid) {
    errors.push(`Missing required fields: ${missing.join(", ")}`);
  }
  // Cross-field consistency
  if (artifact) {
    const total =
      (artifact.goodCount || 0) +
      (artifact.badCount || 0) +
      (artifact.worthPursuingCount || 0) +
      (artifact.ignoredCount || 0);
    if (
      typeof artifact.totalBacklinksReviewed === "number" &&
      total !== artifact.totalBacklinksReviewed
    ) {
      errors.push(
        `Bucket sum (${total}) does not match totalBacklinksReviewed (${artifact.totalBacklinksReviewed})`,
      );
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate the backlink-manifest.json artifact structure.
 *
 * @param {object} manifest - Parsed manifest artifact.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManifestArtifact(manifest) {
  const errors = [];

  // Top-level required fields
  const top = validateRequiredFields(manifest, MANIFEST_REQUIRED_FIELDS);
  if (!top.valid) {
    errors.push(`Missing top-level fields: ${top.missing.join(", ")}`);
  }

  // summaryMetrics required fields
  if (manifest && manifest.summaryMetrics) {
    const metrics = validateRequiredFields(
      manifest.summaryMetrics,
      MANIFEST_METRICS_REQUIRED_FIELDS,
    );
    if (!metrics.valid) {
      errors.push(
        `Missing summaryMetrics fields: ${metrics.missing.join(", ")}`,
      );
    }
  } else if (manifest) {
    errors.push("summaryMetrics is required");
  }

  // files required fields
  if (manifest && manifest.files) {
    const files = validateRequiredFields(
      manifest.files,
      MANIFEST_FILES_REQUIRED_FIELDS,
    );
    if (!files.valid) {
      errors.push(`Missing files fields: ${files.missing.join(", ")}`);
    }
  } else if (manifest) {
    errors.push("files is required");
  }

  // source required fields
  if (manifest && manifest.source) {
    const source = validateRequiredFields(
      manifest.source,
      MANIFEST_SOURCE_REQUIRED_FIELDS,
    );
    if (!source.valid) {
      errors.push(`Missing source fields: ${source.missing.join(", ")}`);
    }
  } else if (manifest) {
    errors.push("source is required");
  }

  // Type checks
  if (manifest) {
    if (!Array.isArray(manifest.competitors)) {
      errors.push("competitors must be an array");
    }
    if (!Array.isArray(manifest.limitations)) {
      errors.push("limitations must be an array");
    }
    if (manifest.source && !Array.isArray(manifest.source.endpoints)) {
      errors.push("source.endpoints must be an array");
    }
    if (typeof manifest.hasCompetitors !== "boolean") {
      errors.push("hasCompetitors must be a boolean");
    }
    if (typeof manifest.includeSubdomains !== "boolean") {
      errors.push("includeSubdomains must be a boolean");
    }
    if (typeof manifest.worth_pursuing !== "number") {
      errors.push("worth_pursuing must be a number");
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Manifest builder
// ---------------------------------------------------------------------------

/**
 * Build the backlink-manifest.json artifact.
 *
 * This is the stable contract that downstream consumers (AWS storage,
 * Railway worker, n8n orchestration) can rely on without knowing the
 * internal structure of the other artifacts.
 *
 * @param {object} summary       - The built summary object.
 * @param {object} runMeta       - Run metadata.
 * @param {object} rawSummary    - Raw DataForSEO summary response.
 * @param {object} outputPaths   - Paths to the other three artifacts.
 * @param {Error|null} fetchError - Captured fetch error (for credential-blocker detection).
 * @returns {object} Manifest object.
 */
function buildManifest(
  summary,
  runMeta,
  rawSummary,
  outputPaths,
  fetchError,
) {
  const targetDomain = runMeta.targetDomain || "";
  const competitorDomains = runMeta.competitorDomains || [];
  const mode = runMeta.mode || "fixture";

  // Determine endpoints used
  const endpoints = ["/v3/backlinks/summary/live"];
  if (runMeta.requestCount >= 2) {
    endpoints.push("/v3/backlinks/backlinks/live");
  }

  // Build limitations from summary + credential detection
  const limitations = [...(summary.limitations || [])];

  // Detect live credential blocker from fetch error
  if (fetchError && mode === "live") {
    const isCredentialBlocker =
      fetchError.message &&
      (fetchError.message.includes("401") ||
        fetchError.message.includes("40100") ||
        fetchError.message.includes("Unauthorized") ||
        fetchError.message.includes("DATAFORSEO_LOGIN"));
    if (isCredentialBlocker) {
      limitations.push(
        "Live DataForSEO verification blocked by external credential authorization failure.",
      );
    }
  }

  // Deduplicate limitations
  const uniqueLimitations = [...new Set(limitations)];

  return {
    artifactVersion: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    target: targetDomain,
    includeSubdomains: false,
    hasCompetitors: competitorDomains.length > 0,
    competitors: competitorDomains,
    worth_pursuing: summary.worthPursuingCount,
    summaryMetrics: {
      rank: rawSummary?.rank ?? null,
      backlinks: rawSummary?.backlinks ?? null,
      referring_domains: rawSummary?.referring_domains ?? null,
      referring_pages: rawSummary?.referring_pages ?? null,
      backlinks_spam_score:
        rawSummary?.backlinks_spam_score ??
        rawSummary?.spam_score ??
        null,
      target_spam_score: rawSummary?.target_spam_score ?? null,
    },
    files: {
      rawBacklinks: outputPaths.rawPath,
      normalizedBacklinks: outputPaths.normalizedPath,
      backlinkSummary: outputPaths.summaryPath,
    },
    source: {
      provider: "dataforseo",
      endpoints,
      responseMode: mode,
    },
    limitations: uniqueLimitations,
  };
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

/**
 * Build the summary artifact from classified records and run metadata.
 *
 * PRD §11.3 — Output Summary
 */
function buildSummary(normalizedRecords, runMeta) {
  const targetDomain = runMeta.targetDomain || "";
  const competitorDomains = runMeta.competitorDomains || [];

  const good = normalizedRecords.filter((r) => r.bucket === "good");
  const bad = normalizedRecords.filter((r) => r.bucket === "bad");
  const worthPursuing = normalizedRecords.filter(
    (r) => r.bucket === "worth_pursuing",
  );
  const ignored = normalizedRecords.filter(
    (r) => r.bucket === "ignore",
  );

  // Top good links (top 5 by quality score)
  const topGoodLinks = [...good]
    .sort(
      (a, b) => b.backlinkQualityScore - a.backlinkQualityScore,
    )
    .slice(0, 5)
    .map((r) => ({
      referringDomain: r.referringDomain,
      referringPageUrl: r.referringPageUrl,
      anchorText: r.anchorText,
      backlinkQualityScore: r.backlinkQualityScore,
      evidenceClass: r.evidenceClass,
    }));

  // Top bad patterns (group by primary red flag)
  const spamHigh = bad.filter(
    (r) => r.spamScore != null && r.spamScore >= 61,
  );
  const irrelevant = bad.filter((r) => r.relevanceScore === 0);
  const badPlacement = bad.filter((r) => r.placementScore === 0);
  const spammyAnchor = bad.filter((r) => r._isSpammyAnchor);

  const topBadPatterns = [];
  if (spamHigh.length > 0) {
    topBadPatterns.push({
      pattern: "high_spam_score",
      count: spamHigh.length,
      description: `${spamHigh.length} backlink(s) with spam score ≥ 61`,
      examples: spamHigh.slice(0, 3).map((r) => ({
        referringDomain: r.referringDomain,
        spamScore: r.spamScore,
        anchorText: r.anchorText,
      })),
    });
  }
  if (irrelevant.length > 0) {
    topBadPatterns.push({
      pattern: "irrelevant_topic",
      count: irrelevant.length,
      description: `${irrelevant.length} backlink(s) from irrelevant topics`,
      examples: irrelevant.slice(0, 3).map((r) => ({
        referringDomain: r.referringDomain,
        referringPageUrl: r.referringPageUrl,
      })),
    });
  }
  if (badPlacement.length > 0) {
    topBadPatterns.push({
      pattern: "low_quality_placement",
      count: badPlacement.length,
      description: `${badPlacement.length} backlink(s) in footer/sidebar/widget`,
      examples: badPlacement.slice(0, 3).map((r) => ({
        referringDomain: r.referringDomain,
        semanticLocation: r.semanticLocation,
      })),
    });
  }
  if (spammyAnchor.length > 0) {
    topBadPatterns.push({
      pattern: "spammy_anchor_text",
      count: spammyAnchor.length,
      description: `${spammyAnchor.length} backlink(s) with spammy anchor text`,
      examples: spammyAnchor.slice(0, 3).map((r) => ({
        referringDomain: r.referringDomain,
        anchorText: r.anchorText,
      })),
    });
  }

  // Top worth-pursuing domains (group by referring domain, count overlaps)
  const domainMap = new Map();
  for (const wp of worthPursuing) {
    const domain = wp.referringDomain;
    if (!domainMap.has(domain)) {
      domainMap.set(domain, {
        referringDomain: domain,
        overlapCount: wp.competitorOverlapCount,
        referringPageUrl: wp.referringPageUrl,
        domainRank: wp.domainRank,
        evidenceClass: wp.evidenceClass,
      });
    } else {
      // Keep the entry with the highest overlap count
      const existing = domainMap.get(domain);
      if (wp.competitorOverlapCount > existing.overlapCount) {
        existing.overlapCount = wp.competitorOverlapCount;
      }
    }
  }

  const topWorthPursuingDomains = [...domainMap.values()]
    .sort((a, b) => b.overlapCount - a.overlapCount || a.domainRank - b.domainRank)
    .slice(0, 10);

  // Authority summary
  const spamScores = normalizedRecords
    .filter((r) => r.spamScore != null)
    .map((r) => r.spamScore);

  const authoritySummary = {
    referringDomains: new Set(
      normalizedRecords.map((r) => r.referringDomain).filter(Boolean),
    ).size,
    backlinks: normalizedRecords.length,
    backlinksSpamScore:
      spamScores.length > 0
        ? Math.round(
            spamScores.reduce((a, b) => a + b, 0) / spamScores.length,
          )
        : null,
    targetSpamScore:
      runMeta.targetSpamScore != null ? runMeta.targetSpamScore : null,
  };

  // Limitations
  const limitations = [];
  if (runMeta.mode === "fixture") {
    limitations.push(
      "Fixture mode — results use simulated data, not live DataForSEO API responses.",
    );
  }
  const missingSpam = normalizedRecords.filter(
    (r) => r._spamScoreMissing,
  );
  if (missingSpam.length > 0) {
    limitations.push(
      `${missingSpam.length} backlink(s) have missing spam scores; manual review required for those records.`,
    );
  }
  const missingFields = normalizedRecords.filter(
    (r) => r._missingFields && r._missingFields.length > 0,
  );
  if (missingFields.length > 0) {
    limitations.push(
      `${missingFields.length} backlink(s) have missing fields; confidence may be reduced.`,
    );
  }
  if (competitorDomains.length === 0) {
    limitations.push(
      "No competitor domains supplied; worth_pursuing discovery skipped.",
    );
  }

  return {
    targetDomain,
    competitorDomains,
    totalBacklinksReviewed: normalizedRecords.length,
    goodCount: good.length,
    badCount: bad.length,
    worthPursuingCount: worthPursuing.length,
    ignoredCount: ignored.length,
    topGoodLinks,
    topBadPatterns,
    topWorthPursuingDomains,
    authoritySummary,
    limitations,
    requestCount: runMeta.requestCount || 0,
    estimatedCost: runMeta.estimatedCost || 0,
    recommendedUse: "contextual_report_only",
    mode: runMeta.mode || "fixture",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write backlink artifacts through the WP3 governed Artifact Store.
 *
 * Persists all four artifacts through the canonical interface and returns
 * validated Artifact Records alongside the built payloads.
 *
 * @param {object} params
 * @param {Array<object>} params.rawBacklinks  - Raw DataForSEO backlink records.
 * @param {object} params.rawSummary           - Raw DataForSEO summary data.
 * @param {Array<object>} params.normalizedBacklinks - Normalized & classified records.
 * @param {object} params.runMeta              - Run metadata.
 * @param {object} params.store                - WP3 governed ArtifactStore (put/get/exists/verify).
 * @param {object} params.scope                - { tenantId, clientId, auditId }.
 * @param {Error|null} [params.fetchError]     - Captured fetch error.
 * @returns {Promise<object>} Artifact Records and built payloads.
 */
export async function writeArtifactsGoverned({
  rawBacklinks,
  rawSummary,
  normalizedBacklinks,
  runMeta,
  store,
  scope,
  fetchError = null,
}) {
  const rawPayload = {
    _description: "Raw backlink data from DataForSEO (or fixture source).",
    targetDomain: runMeta.targetDomain,
    competitorDomains: runMeta.competitorDomains || [],
    mode: runMeta.mode || "fixture",
    createdAt: new Date().toISOString(),
    summary: rawSummary,
    backlinks: rawBacklinks,
  };

  const normalizedPayload = {
    _description: "Normalized and classified backlink records per Vantage PRD §11.2.",
    targetDomain: runMeta.targetDomain,
    competitorDomains: runMeta.competitorDomains || [],
    mode: runMeta.mode || "fixture",
    createdAt: new Date().toISOString(),
    totalRecords: normalizedBacklinks.length,
    records: normalizedBacklinks.map((r) => {
      const { _missingFields, _spamScoreMissing, _isSpammyAnchor, _isDuplicate, ...clean } = r;
      return clean;
    }),
  };

  const summary = buildSummary(normalizedBacklinks, runMeta);

  const outputPaths = { rawPath: null, normalizedPath: null, summaryPath: null };
  const manifest = buildManifest(summary, runMeta, rawSummary, outputPaths, fetchError);

  const rawRecord = await store.put({
    bytes: JSON.stringify(rawPayload, null, 2),
    contentType: "application/json",
    scope: { ...scope, category: "raw", artifactName: "raw-backlinks.json" },
    source: "dataforseo-backlinks",
  });
  outputPaths.rawPath = rawRecord.key;

  const normalizedRecord = await store.put({
    bytes: JSON.stringify(normalizedPayload, null, 2),
    contentType: "application/json",
    scope: { ...scope, category: "normalized", artifactName: "normalized-backlinks.json" },
    source: "dataforseo-backlinks",
  });
  outputPaths.normalizedPath = normalizedRecord.key;

  const summaryRecord = await store.put({
    bytes: JSON.stringify(summary, null, 2),
    contentType: "application/json",
    scope: { ...scope, category: "normalized", artifactName: "backlink-summary.json" },
    source: "dataforseo-backlinks",
  });
  outputPaths.summaryPath = summaryRecord.key;

  const finalManifest = buildManifest(summary, runMeta, rawSummary, outputPaths, fetchError);
  const manifestRecord = await store.put({
    bytes: JSON.stringify(finalManifest, null, 2),
    contentType: "application/json",
    scope: { ...scope, category: "manifests", artifactName: "backlink-manifest.json" },
    source: "dataforseo-backlinks",
  });

  return {
    rawPayload,
    normalizedPayload,
    summary,
    manifest: finalManifest,
    rawRecord,
    normalizedRecord,
    summaryRecord,
    manifestRecord,
    rawPath: rawRecord.key,
    normalizedPath: normalizedRecord.key,
    summaryPath: summaryRecord.key,
    manifestPath: manifestRecord.key,
  };
}

/**
 * Write all backlink test artifacts to disk via the legacy artifact store.
 *
 * Preserved for backward compatibility.  New governed callers should use
 * {@link writeArtifactsGoverned} with an injected WP3 ArtifactStore.
 *
 * @param {object} params
 * @param {Array<object>} params.rawBacklinks  - Raw DataForSEO backlink records.
 * @param {object} params.rawSummary           - Raw DataForSEO summary data.
 * @param {Array<object>} params.normalizedBacklinks - Normalized & classified records.
 * @param {object} params.runMeta              - Run metadata (targetDomain, competitorDomains, mode, etc.).
 * @param {string} [params.outPath]            - Output directory. Defaults to artifacts/local/backlink-tests/.
 * @param {Error|null} [params.fetchError]     - Captured fetch error for credential-blocker detection.
 * @returns {{ rawPath: string, normalizedPath: string, summaryPath: string, manifestPath: string, summary: object, manifest: object }}
 */
export function writeArtifacts({
  rawBacklinks,
  rawSummary,
  normalizedBacklinks,
  runMeta,
  outPath,
  fetchError = null,
}) {
  const outputDir = resolveOutputDir(outPath);

  // 1. Raw artifact
  const rawPayload = {
    _description: "Raw backlink data from DataForSEO (or fixture source).",
    targetDomain: runMeta.targetDomain,
    competitorDomains: runMeta.competitorDomains || [],
    mode: runMeta.mode || "fixture",
    createdAt: new Date().toISOString(),
    summary: rawSummary,
    backlinks: rawBacklinks,
  };
  const rawPath = writeJsonArtifact(outputDir, "raw-backlinks.json", rawPayload);

  // 2. Normalized artifact
  const normalizedPayload = {
    _description: "Normalized and classified backlink records per Vantage PRD §11.2.",
    targetDomain: runMeta.targetDomain,
    competitorDomains: runMeta.competitorDomains || [],
    mode: runMeta.mode || "fixture",
    createdAt: new Date().toISOString(),
    totalRecords: normalizedBacklinks.length,
    records: normalizedBacklinks.map((r) => {
      const { _missingFields, _spamScoreMissing, _isSpammyAnchor, _isDuplicate, ...clean } = r;
      return clean;
    }),
  };
  const normalizedPath = writeJsonArtifact(outputDir, "normalized-backlinks.json", normalizedPayload);

  // 3. Summary artifact
  const summary = buildSummary(normalizedBacklinks, runMeta);
  const summaryPath = writeJsonArtifact(outputDir, "backlink-summary.json", summary);

  // 4. Manifest artifact
  const outputPaths = { rawPath, normalizedPath, summaryPath };
  const manifest = buildManifest(summary, runMeta, rawSummary, outputPaths, fetchError);
  const manifestPath = writeJsonArtifact(outputDir, "backlink-manifest.json", manifest);

  return { rawPath, normalizedPath, summaryPath, manifestPath, summary, manifest };
}

export default {
  writeArtifacts,
  writeArtifactsGoverned,
  validateRequiredFields,
  validateRawArtifact,
  validateNormalizedArtifact,
  validateSummaryArtifact,
  validateManifestArtifact,
};

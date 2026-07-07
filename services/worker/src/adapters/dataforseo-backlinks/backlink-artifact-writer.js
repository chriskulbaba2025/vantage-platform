/**
 * Backlink Artifact Writer
 *
 * Writes the three output artifacts for a backlink test run:
 *   1. raw-backlinks.json    — Raw DataForSEO response data
 *   2. normalized-backlinks.json — Normalized and classified records
 *   3. backlink-summary.json — Human-readable summary
 *
 * Default local output path: artifacts/local/backlink-tests/
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the output directory. Creates it if it doesn't exist.
 */
function ensureOutputDir(outPath) {
  mkdirSync(outPath, { recursive: true });
  return outPath;
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
 * Write all backlink test artifacts to disk.
 *
 * @param {object} params
 * @param {Array<object>} params.rawBacklinks  - Raw DataForSEO backlink records.
 * @param {object} params.rawSummary           - Raw DataForSEO summary data.
 * @param {Array<object>} params.normalizedBacklinks - Normalized & classified records.
 * @param {object} params.runMeta              - Run metadata (targetDomain, competitorDomains, mode, etc.).
 * @param {string} [params.outPath]            - Output directory. Defaults to artifacts/local/backlink-tests/.
 * @returns {{ rawPath: string, normalizedPath: string, summaryPath: string }}
 */
export function writeArtifacts({
  rawBacklinks,
  rawSummary,
  normalizedBacklinks,
  runMeta,
  outPath,
}) {
  const outputDir = ensureOutputDir(
    outPath || resolve("artifacts", "local", "backlink-tests"),
  );

  // 1. Raw artifact
  const rawPayload = {
    _description:
      "Raw backlink data from DataForSEO (or fixture source).",
    targetDomain: runMeta.targetDomain,
    competitorDomains: runMeta.competitorDomains || [],
    mode: runMeta.mode || "fixture",
    createdAt: new Date().toISOString(),
    summary: rawSummary,
    backlinks: rawBacklinks,
  };
  const rawPath = join(outputDir, "raw-backlinks.json");
  writeFileSync(rawPath, JSON.stringify(rawPayload, null, 2), "utf-8");

  // 2. Normalized artifact
  const normalizedPayload = {
    _description:
      "Normalized and classified backlink records per Vantage PRD §11.2.",
    targetDomain: runMeta.targetDomain,
    competitorDomains: runMeta.competitorDomains || [],
    mode: runMeta.mode || "fixture",
    createdAt: new Date().toISOString(),
    totalRecords: normalizedBacklinks.length,
    records: normalizedBacklinks.map((r) => {
      // Strip internal-only fields from output
      const { _missingFields, _spamScoreMissing, _isSpammyAnchor, _isDuplicate, ...clean } = r;
      return clean;
    }),
  };
  const normalizedPath = join(
    outputDir,
    "normalized-backlinks.json",
  );
  writeFileSync(
    normalizedPath,
    JSON.stringify(normalizedPayload, null, 2),
    "utf-8",
  );

  // 3. Summary artifact
  const summary = buildSummary(normalizedBacklinks, runMeta);
  const summaryPath = join(
    outputDir,
    "backlink-summary.json",
  );
  writeFileSync(
    summaryPath,
    JSON.stringify(summary, null, 2),
    "utf-8",
  );

  return { rawPath, normalizedPath, summaryPath, summary };
}

export default {
  writeArtifacts,
};

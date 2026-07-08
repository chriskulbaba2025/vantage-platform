#!/usr/bin/env node

/**
 * Vantage Backlink Adapter — Standalone Test Runner (Phase 1)
 *
 * Usage:
 *   node services/worker/src/runners/run-backlink-test.js \
 *     --target example.com \
 *     --competitors competitor-a.com,competitor-b.com,competitor-c.com \
 *     --fixture
 *
 *   node services/worker/src/runners/run-backlink-test.js \
 *     --target example.com \
 *     --fixture
 *
 * Flags:
 *   --target       Target domain to audit (required)
 *   --competitors  Comma-separated competitor domains (optional)
 *   --fixture      Use local fixture data instead of live API
 *   --out          Output directory override (default: artifacts/local/backlink-tests/)
 *
 * Produces:
 *   artifacts/local/backlink-tests/raw-backlinks.json
 *   artifacts/local/backlink-tests/normalized-backlinks.json
 *   artifacts/local/backlink-tests/backlink-summary.json
 *   + console summary
 */

import { resolve } from "node:path";
import { createDataforseoClient } from "../adapters/dataforseo-backlinks/dataforseo-backlinks-client.js";
import { normalizeBacklinks } from "../adapters/dataforseo-backlinks/backlink-normalizer.js";
import { classifyBacklinks } from "../adapters/dataforseo-backlinks/backlink-classifier.js";
import { writeArtifacts } from "../adapters/dataforseo-backlinks/backlink-artifact-writer.js";

// ---------------------------------------------------------------------------
// CLI argument parser (minimal, no external deps)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    target: null,
    competitors: [],
    fixture: false, // default to live mode — use --fixture for local testing
    out: null,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--target":
      case "-t":
        args.target = argv[++i] || null;
        break;
      case "--competitors":
      case "-c":
        args.competitors = (argv[++i] || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "--fixture":
        args.fixture = true;
        break;
      case "--live":
        args.fixture = false;
        break;
      case "--out":
      case "-o":
        args.out = argv[++i] || null;
        break;
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Console summary printer
// ---------------------------------------------------------------------------

function printConsoleSummary(summary, outputPaths) {
  const lines = [
    "",
    "════════════════════════════════════════════════════════",
    "  VANTAGE BACKLINK ADAPTER — TEST RUN COMPLETE",
    "════════════════════════════════════════════════════════",
    "",
    `  Target domain:          ${summary.targetDomain}`,
    `  Competitor domains:     ${summary.competitorDomains.length > 0 ? summary.competitorDomains.join(", ") : "(none — worth_pursuing skipped)"}`,
    `  Mode:                   ${summary.mode}`,
    "",
    "  ── Classification Results ──",
    "",
    `  Total backlinks reviewed: ${summary.totalBacklinksReviewed}`,
    "",
    `  Good:              ${summary.goodCount}`.padEnd(30),
    `  Bad:               ${summary.badCount}`.padEnd(30),
    `  Worth pursuing:    ${summary.worthPursuingCount}`.padEnd(30),
    `  Ignored:           ${summary.ignoredCount}`.padEnd(30),
    "",
    "  ── Authority Summary ──",
    "",
    `  Referring domains: ${summary.authoritySummary.referringDomains}`,
    `  Backlinks:         ${summary.authoritySummary.backlinks}`,
    `  Avg spam score:    ${summary.authoritySummary.backlinksSpamScore ?? "N/A"}`,
    `  Target spam score: ${summary.authoritySummary.targetSpamScore ?? "N/A"}`,
    "",
    "  ── Top Good Links ──",
    "",
  ];

  if (summary.topGoodLinks.length > 0) {
    for (const link of summary.topGoodLinks) {
      lines.push(
        `  • ${link.referringDomain} (Q=${link.backlinkQualityScore}) — ${link.evidenceClass}`,
      );
    }
  } else {
    lines.push("  (none)");
  }

  lines.push("", "  ── Top Bad Patterns ──", "");

  if (summary.topBadPatterns.length > 0) {
    for (const pattern of summary.topBadPatterns) {
      lines.push(`  • ${pattern.description}`);
    }
  } else {
    lines.push("  (none)");
  }

  lines.push("", "  ── Top Worth-Pursuing Domains ──", "");

  if (summary.topWorthPursuingDomains.length > 0) {
    for (const domain of summary.topWorthPursuingDomains.slice(0, 5)) {
      lines.push(
        `  • ${domain.referringDomain} (overlap: ${domain.overlapCount}) — ${domain.evidenceClass}`,
      );
    }
  } else {
    lines.push("  (none)");
  }

  lines.push(
    "",
    "  ── Limitations ──",
    "",
  );

  if (summary.limitations.length > 0) {
    for (const limit of summary.limitations) {
      lines.push(`  • ${limit}`);
    }
  } else {
    lines.push("  (none)");
  }

  lines.push(
    "",
    "  ── Output ──",
    "",
    `  Raw:           ${outputPaths.rawPath}`,
    `  Normalized:    ${outputPaths.normalizedPath}`,
    `  Summary:       ${outputPaths.summaryPath}`,
    "",
    `  Request count:    ${summary.requestCount}`,
    `  Estimated cost:   $${summary.estimatedCost.toFixed(4)}`,
    `  Recommended use:  ${summary.recommendedUse}`,
    "",
    "════════════════════════════════════════════════════════",
    "",
  );

  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Validate required args
  if (!args.target) {
    console.error(
      "ERROR: --target is required.\n" +
        "Usage: node run-backlink-test.js --target example.com [--competitors a.com,b.com] [--fixture]",
    );
    process.exitCode = 1;
    return;
  }

  // Cap competitor domains at 3 (PRD §16.2)
  const competitorDomains = args.competitors.slice(0, 3);

  if (args.competitors.length > 3) {
    console.warn(
      `WARNING: Maximum 3 competitors allowed. Using: ${competitorDomains.join(", ")}`,
    );
  }

  const mode = args.fixture ? "fixture" : "live";

  console.log(
    `\nStarting backlink test run for ${args.target} (mode: ${mode})...`,
  );

  // -------------------------------------------------------------------
  // 1. Create client
  // -------------------------------------------------------------------
  const client = createDataforseoClient({ mode });

  // -------------------------------------------------------------------
  // 2. Fetch data
  // -------------------------------------------------------------------
  let rawSummary;
  let rawBacklinks = [];
  let requestCount = 0;
  let estimatedCost = 0;

  try {
    rawSummary = await client.fetchBacklinkSummary(args.target);
    requestCount++;
  } catch (err) {
    console.error(`ERROR fetching summary: ${err.message}`);
    console.error("Cannot proceed without summary data.");
    process.exitCode = 1;
    return;
  }

  try {
    rawBacklinks = await client.fetchBacklinks(args.target, {
      limit: 500,
    });
    requestCount++;
  } catch (err) {
    console.error(`ERROR fetching backlinks: ${err.message}`);
    console.error("Proceeding with empty backlink list.");
  }

  // Fetch competitor data if competitors are provided
  if (competitorDomains.length > 0) {
    try {
      const competitorBacklinks =
        await client.fetchCompetitorIntersection(
          args.target,
          competitorDomains,
          { limit: 250 },
        );
      // Merge competitor backlinks into rawBacklinks for classification
      // These show up as worth_pursuing opportunities
      rawBacklinks = rawBacklinks.concat(competitorBacklinks);
      requestCount++;
    } catch (err) {
      console.error(
        `ERROR fetching competitor backlinks: ${err.message}`,
      );
      console.error("Proceeding with target-only backlink data.");
    }
  }

  // Cost estimation (DataForSEO rates are approximate)
  // Summary: ~$0.01, Backlinks list: ~$0.01 per 100 results
  estimatedCost =
    requestCount * 0.01 + (rawBacklinks.length / 100) * 0.01;

  // -------------------------------------------------------------------
  // 3. Normalize
  // -------------------------------------------------------------------
  const normalizedBacklinks = normalizeBacklinks(rawBacklinks, {
    targetDomain: args.target,
    competitorDomains,
  });

  // -------------------------------------------------------------------
  // 4. Classify
  // -------------------------------------------------------------------
  classifyBacklinks(normalizedBacklinks);

  // -------------------------------------------------------------------
  // 5. Write artifacts
  // -------------------------------------------------------------------
  const outPath = args.out
    ? resolve(args.out)
    : resolve("artifacts", "local", "backlink-tests");

  const runMeta = {
    targetDomain: args.target,
    competitorDomains,
    mode,
    requestCount,
    estimatedCost,
    targetSpamScore: rawSummary?.target_spam_score ?? null,
  };

  const { summary, ...outputPaths } = writeArtifacts({
    rawBacklinks,
    rawSummary,
    normalizedBacklinks,
    runMeta,
    outPath,
  });

  // -------------------------------------------------------------------
  // 6. Print console summary
  // -------------------------------------------------------------------
  printConsoleSummary(summary, outputPaths);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  console.error(err.stack);
  process.exitCode = 1;
});

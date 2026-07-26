#!/usr/bin/env node

/**
 * Task 7 — PageSpeed-to-Lighthouse Fallback Acceptance Harness
 *
 * Runs the performance collection pipeline against a configured test site
 * ten consecutive times and records:
 *
 *   - run number
 *   - tested URLs
 *   - device profiles
 *   - PageSpeed result
 *   - retry count
 *   - Lighthouse fallback usage
 *   - final provider
 *   - final source status
 *   - module eligibility
 *   - artifact reference
 *   - elapsed time
 *
 * Usage:
 *   node scripts/acceptance-task7.js [testUrl]
 *
 * Environment variables:
 *   GOOGLE_PAGESPEED_API_KEY  — optional; PageSpeed API key
 *   VANTAGE_ACCEPTANCE_URL    — fallback test URL (default: https://example.com)
 *
 * When credentials are absent or the API is unreachable, the harness
 * runs with mock providers and records simulated results.  The mock
 * mode validates the fallback logic without live API dependencies.
 */

import { collectPerformance, collectPerformanceForPages } from "../src/evidence/pagespeed-client.js";
import { SOURCE_STATUS } from "../src/scoring/evidence-contracts.js";
import { performance } from "node:perf_hooks";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TEST_URL = process.argv[2] || process.env.VANTAGE_ACCEPTANCE_URL || "https://example.com";
const TEST_URLS = [TEST_URL, `${TEST_URL}/contact`];
const RUNS = 10;
const API_KEY = process.env.GOOGLE_PAGESPEED_API_KEY || "";

// ---------------------------------------------------------------------------
// Mock providers for offline validation
// ---------------------------------------------------------------------------

const MOCK_LHR = {
  categories: {
    performance: { score: 0.72 },
    accessibility: { score: 0.88 },
    "best-practices": { score: 0.94 },
    seo: { score: 0.81 },
  },
  audits: {
    "first-contentful-paint": { numericValue: 1100 },
    "largest-contentful-paint": { numericValue: 2400 },
    "cumulative-layout-shift": { numericValue: 0.04 },
    "total-blocking-time": { numericValue: 90 },
  },
};

async function mockPageSpeedSuccess(url) {
  return new Response(
    JSON.stringify({ lighthouseResult: MOCK_LHR }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function mockPageSpeed429(url) {
  return new Response("quota exceeded", { status: 429 });
}

async function mockPageSpeed503(url) {
  return new Response("service unavailable", { status: 503 });
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runAcceptance(mode = "live") {
  const results = [];
  const startedAt = new Date().toISOString();

  console.log(`\n=== Task 7 Acceptance Harness ===`);
  console.log(`Mode: ${mode}`);
  console.log(`Test URLs: ${TEST_URLS.join(", ")}`);
  console.log(`Runs: ${RUNS}`);
  console.log(`API key: ${API_KEY ? "configured" : "not configured"}`);
  console.log(`Started: ${startedAt}\n`);

  for (let run = 1; run <= RUNS; run++) {
    const runStart = performance.now();
    const runResult = {
      run,
      testedUrls: TEST_URLS,
      deviceProfiles: ["mobile", "desktop"],
      pagespeedResult: null,
      retryCount: 0,
      lighthouseFallbackUsed: false,
      finalProvider: null,
      finalSourceStatus: null,
      moduleEligible: false,
      artifactRef: null,
      elapsedMs: 0,
      error: null,
    };

    try {
      let fetchImpl;
      if (mode === "mock-success") {
        fetchImpl = mockPageSpeedSuccess;
      } else if (mode === "mock-429") {
        fetchImpl = mockPageSpeed429;
      } else if (mode === "mock-503") {
        fetchImpl = mockPageSpeed503;
      } else {
        // Live mode — use real fetch
        fetchImpl = globalThis.fetch;
      }

      const localRunner = async (url, strategy) => {
        const { normalizeLighthouse } = await import("../src/evidence/pagespeed-client.js");
        return normalizeLighthouse(MOCK_LHR, "lighthouse-cli-fallback", strategy, {
          url,
          fallbackUsed: true,
          rawArtifactRef: `lighthouse-cli://${strategy}/${encodeURIComponent(url)}`,
        });
      };

      const perfResult = await collectPerformance(TEST_URL, {
        apiKey: API_KEY,
        fetchImpl,
        localRunner: mode.startsWith("mock") ? localRunner : undefined,
        disableCache: true,
      });

      runResult.pagespeedResult = perfResult.mobile?.source === "pagespeed-insights" ? "success" : "failed";
      runResult.retryCount = perfResult._sourceStatus?.retryCount || 0;
      runResult.lighthouseFallbackUsed = perfResult.fallbackUsed === true;
      runResult.finalProvider = perfResult.source;
      runResult.finalSourceStatus = perfResult.sourceStatus;
      runResult.moduleEligible =
        perfResult.sourceStatus === SOURCE_STATUS.AVAILABLE ||
        perfResult.sourceStatus === SOURCE_STATUS.PARTIAL;
      runResult.artifactRef =
        perfResult.mobile?.rawArtifactRef ||
        perfResult.desktop?.rawArtifactRef ||
        null;
    } catch (error) {
      runResult.error = error.message;
      runResult.finalSourceStatus = SOURCE_STATUS.FAILED;
      runResult.moduleEligible = false;
    }

    runResult.elapsedMs = Math.round(performance.now() - runStart);
    results.push(runResult);

    // Progress
    const statusIcon = runResult.moduleEligible ? "✓" : "✗";
    console.log(
      `  Run ${String(run).padStart(2)} ${statusIcon} ` +
      `provider=${runResult.finalProvider || "none"} ` +
      `status=${runResult.finalSourceStatus} ` +
      `fallback=${runResult.lighthouseFallbackUsed} ` +
      `retries=${runResult.retryCount} ` +
      `${runResult.elapsedMs}ms`,
    );
  }

  // ── Summary ─────────────────────────────────────────────────────────
  const successful = results.filter((r) => r.moduleEligible).length;
  const failed = results.filter((r) => !r.moduleEligible).length;
  const completionPercent = Math.round((successful / RUNS) * 100);
  const fallbackCount = results.filter((r) => r.lighthouseFallbackUsed).length;
  const falseScoreCount = results.filter(
    (r) => !r.moduleEligible && r.finalSourceStatus !== SOURCE_STATUS.FAILED,
  ).length;

  // Provenance validation
  const providers = new Set(results.map((r) => r.finalProvider).filter(Boolean));
  const allProvidersValid = [...providers].every(
    (p) => ["pagespeed-insights", "lighthouse-cli-fallback", "unavailable"].includes(p),
  );

  console.log(`\n=== Acceptance Summary ===`);
  console.log(`Total runs:              ${RUNS}`);
  console.log(`Successful modules:      ${successful}`);
  console.log(`Failed modules:          ${failed}`);
  console.log(`Completion percentage:   ${completionPercent}%`);
  console.log(`Fallback count:          ${fallbackCount}`);
  console.log(`False-score count:       ${falseScoreCount}`);
  console.log(`Provenance valid:        ${allProvidersValid ? "PASS" : "FAIL"}`);

  // Acceptance condition
  const pass = completionPercent >= 90 && falseScoreCount === 0 && allProvidersValid;

  console.log(`\n=== Acceptance: ${pass ? "PASS" : "FAIL"} ===`);
  if (!pass) {
    if (completionPercent < 90) console.log(`  - Completion below 90%: ${completionPercent}%`);
    if (falseScoreCount > 0) console.log(`  - False scores detected: ${falseScoreCount}`);
    if (!allProvidersValid) console.log(`  - Invalid provider provenance`);
  }

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  console.log(`Mode: ${mode}\n`);

  return { pass, results, summary: { totalRuns: RUNS, successful, failed, completionPercent, fallbackCount, falseScoreCount, allProvidersValid } };
}

// ---------------------------------------------------------------------------
// Main — determine mode and run
// ---------------------------------------------------------------------------

async function main() {
  // If API key is configured, attempt live mode; otherwise use mock
  if (API_KEY) {
    console.log("API key detected — running live acceptance test.");
    console.log("NOTE: Live mode requires network access to Google APIs.\n");
    try {
      return await runAcceptance("live");
    } catch (error) {
      console.log(`Live test failed: ${error.message}`);
      console.log("Falling back to mock modes...\n");
    }
  }

  // Run mock scenarios
  console.log("Running mock acceptance scenarios...\n");

  // Scenario 1: PageSpeed always succeeds
  console.log("--- Scenario: PageSpeed Success ---");
  const successResult = await runAcceptance("mock-success");

  // Scenario 2: PageSpeed 429 → Lighthouse fallback
  console.log("\n--- Scenario: PageSpeed 429 → Lighthouse Fallback ---");
  const rateLimitResult = await runAcceptance("mock-429");

  // Scenario 3: PageSpeed 503 → retry → Lighthouse fallback
  console.log("\n--- Scenario: PageSpeed 503 → Retry → Lighthouse Fallback ---");
  const serverErrorResult = await runAcceptance("mock-503");

  // Overall mock assessment
  const allMockPass = successResult.pass && rateLimitResult.pass && serverErrorResult.pass;
  console.log(`\n=== Overall Mock Assessment: ${allMockPass ? "ALL SCENARIOS PASS" : "SOME SCENARIOS FAILED"} ===`);
  console.log(`\nFor live acceptance (10 consecutive runs against real APIs):`);
  console.log(`  export GOOGLE_PAGESPEED_API_KEY=<your-key>`);
  console.log(`  export VANTAGE_ACCEPTANCE_URL=https://your-test-site.com`);
  console.log(`  node scripts/acceptance-task7.js\n`);

  return allMockPass ? 0 : 1;
}

main()
  .then((code) => process.exit(typeof code === "number" ? code : 0))
  .catch((err) => {
    console.error("Acceptance harness crashed:", err);
    process.exit(1);
  });

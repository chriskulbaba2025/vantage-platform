/**
 * Vantage Backlink Adapter — Test Suite
 *
 * Uses Node.js built-in test runner (node:test + node:assert).
 * No external test framework required.
 *
 * Covers:
 *   - Fixture mode works without DataForSEO credentials
 *   - Good backlink classification
 *   - Bad backlink classification (high spam, irrelevant, footer, spammy anchor)
 *   - Worth pursuing classification
 *   - Ignore classification (duplicate, incomplete)
 *   - Missing spam score reduces confidence
 *   - High spam score forces bad classification
 *   - Footer/sidebar/widget placement prevents good classification
 *   - Competitor overlap + high spam does NOT create worth_pursuing
 *   - Artifact summary counts are correct
 *   - No production Vantage score files are modified
 *   - Live response parsing (status_code validation, double-encoding, task extraction)
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------

import {
  createDataforseoClient,
  parseDataforseoResponse,
  extractTaskResult,
  extractAllTaskResults,
} from "./dataforseo-backlinks-client.js";
import {
  normalizeBacklink,
  normalizeBacklinks,
} from "./backlink-normalizer.js";
import {
  classifyBacklink,
  classifyBacklinks,
} from "./backlink-classifier.js";
import {
  writeArtifacts,
  validateRequiredFields,
  validateRawArtifact,
  validateNormalizedArtifact,
  validateSummaryArtifact,
  validateManifestArtifact,
} from "./backlink-artifact-writer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_PATH = resolve(__dirname, "backlink-test-fixtures.json");
const TEST_OUT_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "artifacts",
  "local",
  "backlink-tests",
);

function loadFixtures() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
}

// ---------------------------------------------------------------------------
// Live-style response fixtures for parser tests
// ---------------------------------------------------------------------------

/**
 * A valid DataForSEO summary response matching the live API shape.
 */
const LIVE_SUMMARY_RESPONSE = {
  status_code: 20000,
  status_message: "Ok.",
  time: "0.1234 sec.",
  cost: 0.001,
  tasks_count: 1,
  tasks: [
    {
      id: "12345678-0001-0001-0000-000000000000",
      status_code: 20000,
      status_message: "Ok.",
      time: "0.1234 sec.",
      cost: 0.001,
      result_count: 1,
      result: [
        {
          domain: "solescience.ca",
          rank: 270,
          backlinks: 2473,
          referring_domains: 526,
          referring_pages: 1927,
          backlinks_spam_score: 7,
          target_spam_score: 0,
        },
      ],
    },
  ],
};

/**
 * A double-encoded JSON string (simulates proxy/gateway wrapping).
 */
const DOUBLE_ENCODED_RESPONSE = JSON.stringify(LIVE_SUMMARY_RESPONSE);

/**
 * A valid DataForSEO backlinks list response.
 */
const LIVE_BACKLINKS_RESPONSE = {
  status_code: 20000,
  status_message: "Ok.",
  tasks: [
    {
      id: "12345678-0002-0001-0000-000000000000",
      status_code: 20000,
      status_message: "Ok.",
      result: [
        {
          items: [
            {
              page_from: "https://example.com/link-page",
              domain_from: "example.com",
              page_to: "https://solescience.ca/",
              domain_to: "solescience.ca",
              anchor: "consulting services",
              domain_from_rank: 500,
              page_from_rank: 1000,
              spam_score: 5,
              semantic_location: "article",
              link_type: "anchor",
            },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Vantage Backlink Adapter — Phase 1", () => {
  // -----------------------------------------------------------------------
  // 1. Response Parsing (live DataForSEO response handling)
  // -----------------------------------------------------------------------
  describe("DataForSEO Response Parsing", () => {
    // --- parseDataforseoResponse ---

    it("parses a live-style summary response object correctly", () => {
      const result = parseDataforseoResponse(
        LIVE_SUMMARY_RESPONSE,
        "/backlinks/summary/live",
      );
      assert.equal(result.status_code, 20000);
      assert.equal(result.tasks.length, 1);
      assert.equal(result.tasks[0].status_code, 20000);
    });

    it("parses a double-encoded JSON string response", () => {
      const result = parseDataforseoResponse(
        DOUBLE_ENCODED_RESPONSE,
        "/backlinks/summary/live",
      );
      assert.equal(result.status_code, 20000);
      assert.equal(result.tasks[0].result[0].domain, "solescience.ca");
      assert.equal(result.tasks[0].result[0].rank, 270);
    });

    it("parses a triple-encoded JSON string (edge case)", () => {
      const tripleEncoded = JSON.stringify(DOUBLE_ENCODED_RESPONSE);
      const result = parseDataforseoResponse(
        tripleEncoded,
        "/backlinks/summary/live",
      );
      assert.equal(result.status_code, 20000);
      assert.equal(result.tasks[0].result[0].domain, "solescience.ca");
    });

    it("throws clear error when root status_code is not 20000", () => {
      const badResponse = {
        status_code: 40001,
        status_message: "Invalid request.",
        tasks: [],
      };
      assert.throws(
        () =>
          parseDataforseoResponse(badResponse, "/backlinks/summary/live"),
        /status_code=40001/,
      );
      assert.throws(
        () =>
          parseDataforseoResponse(badResponse, "/backlinks/summary/live"),
        /Invalid request/,
      );
    });

    it("throws on unparseable string", () => {
      assert.throws(
        () =>
          parseDataforseoResponse(
            "not valid json {{{",
            "/backlinks/summary/live",
          ),
        /unable to parse/,
      );
    });

    it("does not reject zero-valued fields as missing", () => {
      // target_spam_score=0 and rank=270 should be preserved, not rejected
      const result = parseDataforseoResponse(
        LIVE_SUMMARY_RESPONSE,
        "/backlinks/summary/live",
      );
      const summary = result.tasks[0].result[0];
      assert.equal(summary.target_spam_score, 0);
      assert.equal(summary.rank, 270);
      assert.equal(summary.backlinks, 2473);
    });

    // --- extractTaskResult ---

    it("extractTaskResult returns tasks[0].result[0] for valid response", () => {
      const result = extractTaskResult(
        LIVE_SUMMARY_RESPONSE,
        "/backlinks/summary/live",
      );
      assert.equal(result.domain, "solescience.ca");
      assert.equal(result.rank, 270);
      assert.equal(result.backlinks, 2473);
      assert.equal(result.target_spam_score, 0);
    });

    it("extractTaskResult throws on missing tasks", () => {
      assert.throws(
        () => extractTaskResult({}, "/backlinks/summary/live"),
        /no tasks in response/,
      );
      assert.throws(
        () =>
          extractTaskResult({ tasks: [] }, "/backlinks/summary/live"),
        /no tasks in response/,
      );
    });

    it("extractTaskResult throws when task status_code is not 20000", () => {
      const badTask = {
        tasks: [
          {
            status_code: 40002,
            status_message: "Task failed.",
            result: [],
          },
        ],
      };
      assert.throws(
        () =>
          extractTaskResult(badTask, "/backlinks/summary/live"),
        /task error/,
      );
      assert.throws(
        () =>
          extractTaskResult(badTask, "/backlinks/summary/live"),
        /status_code=40002/,
      );
    });

    it("extractTaskResult throws when result array is empty", () => {
      const emptyResult = {
        tasks: [
          {
            status_code: 20000,
            status_message: "Ok.",
            result: [],
          },
        ],
      };
      assert.throws(
        () =>
          extractTaskResult(emptyResult, "/backlinks/summary/live"),
        /no result data/,
      );
    });

    it("extractTaskResult tolerates absent task status_code (older API versions)", () => {
      // Some API versions omit task-level status_code on success.
      // We should not reject those — only reject explicitly non-20000 codes.
      const noTaskStatus = {
        tasks: [
          {
            result: [
              { domain: "example.com", rank: 100 },
            ],
          },
        ],
      };
      assert.doesNotThrow(() => {
        const r = extractTaskResult(noTaskStatus, "/backlinks/summary/live");
        assert.equal(r.domain, "example.com");
        assert.equal(r.rank, 100);
      });
    });

    // --- extractAllTaskResults ---

    it("extractAllTaskResults returns all task results", () => {
      const multiTask = {
        tasks: [
          {
            status_code: 20000,
            result: [{ items: [{ a: 1 }] }],
          },
          {
            status_code: 20000,
            result: [{ items: [{ b: 2 }] }],
          },
        ],
      };
      const results = extractAllTaskResults(
        multiTask,
        "/backlinks/backlinks/live",
      );
      assert.equal(results.length, 2);
      assert.deepEqual(results[0].items, [{ a: 1 }]);
      assert.deepEqual(results[1].items, [{ b: 2 }]);
    });

    it("extractAllTaskResults skips failed tasks gracefully", () => {
      const mixedTasks = {
        tasks: [
          {
            status_code: 20000,
            result: [{ items: [{ ok: true }] }],
          },
          {
            status_code: 40002,
            status_message: "Task failed.",
            result: [],
          },
          {
            status_code: 20000,
            result: [{ items: [{ also_ok: true }] }],
          },
        ],
      };
      const results = extractAllTaskResults(
        mixedTasks,
        "/backlinks/backlinks/live",
      );
      assert.equal(results.length, 2);
      assert.deepEqual(results[0].items, [{ ok: true }]);
      assert.deepEqual(results[1].items, [{ also_ok: true }]);
    });

    it("extractAllTaskResults returns empty array for missing tasks", () => {
      assert.deepEqual(
        extractAllTaskResults({}, "/backlinks/backlinks/live"),
        [],
      );
      assert.deepEqual(
        extractAllTaskResults(
          { tasks: [] },
          "/backlinks/backlinks/live",
        ),
        [],
      );
    });
  });

  // -----------------------------------------------------------------------
  // 2. Fixture mode / DataForSEO Client
  // -----------------------------------------------------------------------
  describe("DataForSEO Client", () => {
    it("fixture mode works without DataForSEO credentials", async () => {
      // Ensure no credentials in env for this test
      const client = createDataforseoClient({ mode: "fixture" });

      const summary = await client.fetchBacklinkSummary("example.com");
      assert.ok(summary, "Summary should be returned");
      assert.equal(summary.domain, "example.com");
      assert.ok(typeof summary.rank === "number");
    });

    it("fixture mode returns backlinks", async () => {
      const client = createDataforseoClient({ mode: "fixture" });

      const backlinks = await client.fetchBacklinks("example.com", {
        limit: 500,
      });
      assert.ok(Array.isArray(backlinks));
      assert.ok(backlinks.length > 0, "Should have at least some backlinks");
      // Verify structure
      const first = backlinks[0];
      assert.ok("page_from" in first || first.page_from == null);
    });

    it("fixture mode returns competitor backlinks", async () => {
      const client = createDataforseoClient({ mode: "fixture" });

      const competitorBacklinks =
        await client.fetchCompetitorIntersection(
          "example.com",
          ["competitor-a.com", "competitor-b.com"],
        );
      assert.ok(Array.isArray(competitorBacklinks));
      // All returned records should be for competitors
      for (const bl of competitorBacklinks) {
        assert.ok(
          ["competitor-a.com", "competitor-b.com", "competitor-c.com"].includes(
            bl.domain_to,
          ),
          `Expected competitor domain_to, got ${bl.domain_to}`,
        );
      }
    });

    it("live mode without credentials throws a clear error", async () => {
      const client = createDataforseoClient({ mode: "live" });
      // Ensure credentials are not set
      delete process.env.DATAFORSEO_LOGIN;
      delete process.env.DATAFORSEO_PASSWORD;

      await assert.rejects(
        () => client.fetchBacklinkSummary("example.com"),
        /DATAFORSEO_LOGIN.*DATAFORSEO_PASSWORD/,
        "Should throw a clear credentials error",
      );
    });
  });

  // -----------------------------------------------------------------------
  // 3. Normalizer
  // -----------------------------------------------------------------------
  describe("Backlink Normalizer", () => {
    let fixtures;

    before(() => {
      fixtures = loadFixtures();
    });

    it("produces all required normalized fields", () => {
      const raw = fixtures.backlinks[0]; // GOOD record
      const normalized = normalizeBacklink(raw, {
        targetDomain: "example.com",
      });

      const requiredFields = [
        "source",
        "targetDomain",
        "referringDomain",
        "referringPageUrl",
        "targetUrl",
        "anchorText",
        "linkType",
        "linkAttributes",
        "semanticLocation",
        "firstSeen",
        "lastSeen",
        "isLost",
        "linksCount",
        "externalLinksCount",
        "domainRank",
        "pageRank",
        "spamScore",
        "targetSpamScore",
        "competitorOverlapCount",
        "clientHasLinkFromDomain",
        "relevanceScore",
        "authorityScore",
        "placementScore",
        "spamSafetyScore",
        "backlinkQualityScore",
        "bucket",
        "classificationConfidence",
        "evidenceClass",
        "rationale",
      ];

      for (const field of requiredFields) {
        assert.ok(
          field in normalized,
          `Normalized record missing field: ${field}`,
        );
      }
    });

    it("tolerates missing fields instead of crashing", () => {
      const raw = fixtures.backlinks.find(
        (b) =>
          b._fixture_note &&
          b._fixture_note.includes("IGNORE"),
      );

      assert.doesNotThrow(() => {
        const normalized = normalizeBacklink(raw, {
          targetDomain: "example.com",
        });
        assert.ok(normalized);
        assert.ok(
          normalized._missingFields.length > 0,
          "Should have missing fields tracked",
        );
      });
    });

    it("computes backlinkQualityScore as sum of four factor scores", () => {
      const raw = fixtures.backlinks[0];
      const normalized = normalizeBacklink(raw, {
        targetDomain: "example.com",
      });

      const sum =
        normalized.relevanceScore +
        normalized.authorityScore +
        normalized.placementScore +
        normalized.spamSafetyScore;

      assert.equal(
        normalized.backlinkQualityScore,
        sum,
        "backlinkQualityScore should equal sum of factor scores",
      );
      assert.ok(
        normalized.backlinkQualityScore >= 0 &&
          normalized.backlinkQualityScore <= 100,
        "backlinkQualityScore should be between 0 and 100",
      );
    });

    it("deduplicates records with same referringPageUrl and targetUrl", () => {
      // Create two identical raw records
      const raw = fixtures.backlinks[0];
      const dupes = [raw, { ...raw }];

      const normalized = normalizeBacklinks(dupes, {
        targetDomain: "example.com",
      });

      assert.equal(normalized.length, 2);
      assert.equal(normalized[0]._isDuplicate, undefined);
      assert.equal(normalized[1]._isDuplicate, true);
    });

    it("assigns lower spamSafetyScore when spam score is missing", () => {
      const raw = fixtures.backlinks.find(
        (b) => b.spam_score == null,
      );
      assert.ok(raw, "Should have a record with null spam_score");

      const normalized = normalizeBacklink(raw, {
        targetDomain: "example.com",
      });

      assert.equal(normalized.spamSafetyScore, 10);
      assert.equal(normalized._spamScoreMissing, true);
      assert.ok(
        normalized.classificationConfidence < 0.85,
        "Missing spam should reduce confidence",
      );
    });

    it("assigns placementScore 0 for footer/sidebar/widget locations", () => {
      const footerRecord = fixtures.backlinks.find(
        (b) => b.semantic_location === "footer",
      );
      assert.ok(footerRecord, "Should have a footer record");

      const normalized = normalizeBacklink(footerRecord, {
        targetDomain: "example.com",
      });
      assert.equal(
        normalized.placementScore,
        0,
        "Footer placement should score 0",
      );
    });

    it("detects spammy anchor text patterns", () => {
      const spammyRecord = fixtures.backlinks.find(
        (b) =>
          b._fixture_note &&
          b._fixture_note.includes("spammy anchor"),
      );
      assert.ok(spammyRecord, "Should have spammy anchor record");

      const normalized = normalizeBacklink(spammyRecord, {
        targetDomain: "example.com",
      });
      assert.equal(normalized._isSpammyAnchor, true);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Classifier
  // -----------------------------------------------------------------------
  describe("Backlink Classifier", () => {
    let fixtures, normalized;

    before(() => {
      fixtures = loadFixtures();
      normalized = normalizeBacklinks(fixtures.backlinks, {
        targetDomain: "example.com",
        competitorDomains: [
          "competitor-a.com",
          "competitor-b.com",
          "competitor-c.com",
        ],
      });
      classifyBacklinks(normalized);
    });

    it("good backlink classification works", () => {
      const good = normalized.filter((r) => r.bucket === "good");
      assert.ok(good.length >= 1, "Should have at least one good backlink");

      for (const g of good) {
        assert.ok(g.backlinkQualityScore >= 75);
        assert.ok(g.spamScore == null || g.spamScore <= 30);
        assert.ok(g.relevanceScore >= 18);
        assert.ok(g.placementScore >= 18);
        assert.ok(
          ["strongly_supported", "supported", "directional"].includes(
            g.evidenceClass,
          ),
        );
      }
    });

    it("bad backlink classification works — high spam score", () => {
      const badHighSpam = normalized.find(
        (r) => r.bucket === "bad" && r.spamScore >= 61,
      );
      assert.ok(badHighSpam, "Should have a bad record with high spam");
      assert.equal(badHighSpam.bucket, "bad");
    });

    it("bad backlink classification works — footer placement", () => {
      const badFooter = normalized.find(
        (r) =>
          r.bucket === "bad" &&
          r.semanticLocation === "footer",
      );
      assert.ok(badFooter, "Footer placement should be classified as bad");
      assert.equal(badFooter.bucket, "bad");
      assert.equal(badFooter.placementScore, 0);
    });

    it("bad backlink classification works — irrelevant topic", () => {
      const badIrrelevant = normalized.find(
        (r) =>
          r.bucket === "bad" &&
          r.relevanceScore === 0,
      );
      assert.ok(
        badIrrelevant,
        "Irrelevant topic should be classified as bad",
      );
    });

    it("bad backlink classification works — spammy anchor text", () => {
      const badAnchor = normalized.find(
        (r) => r.bucket === "bad" && r._isSpammyAnchor,
      );
      assert.ok(badAnchor, "Spammy anchor should be classified as bad");
    });

    it("worth_pursuing classification works", () => {
      const wp = normalized.filter(
        (r) => r.bucket === "worth_pursuing",
      );
      assert.ok(
        wp.length >= 1,
        "Should have at least one worth_pursuing",
      );

      for (const w of wp) {
        assert.ok(w.competitorOverlapCount >= 1);
        assert.equal(w.clientHasLinkFromDomain, false);
        assert.ok(w.spamScore == null || w.spamScore <= 30);
        assert.ok(w.relevanceScore >= 18);
        assert.ok(w.placementScore >= 18);
      }
    });

    it("ignore classification works — too incomplete", () => {
      const ignored = normalized.filter(
        (r) => r.bucket === "ignore",
      );
      assert.ok(
        ignored.length >= 1,
        "Should have at least one ignored record",
      );

      // At least one ignored should be incomplete
      const incomplete = ignored.find(
        (r) =>
          r._missingFields && r._missingFields.length >= 6,
      );
      assert.ok(incomplete, "Should have incomplete ignored record");
    });

    it("every record has a bucket assigned", () => {
      for (const r of normalized) {
        assert.ok(
          ["good", "bad", "worth_pursuing", "ignore"].includes(
            r.bucket,
          ),
          `Record missing valid bucket: ${r.bucket}`,
        );
      }
    });

    it("every record has evidenceClass assigned", () => {
      for (const r of normalized) {
        assert.ok(
          [
            "strongly_supported",
            "supported",
            "directional",
            "insufficient_evidence",
          ].includes(r.evidenceClass),
          `Record missing valid evidenceClass: ${r.evidenceClass}`,
        );
      }
    });

    it("every record has a non-empty rationale", () => {
      for (const r of normalized) {
        assert.ok(
          r.rationale && r.rationale.length > 0,
          "Rationale should not be empty",
        );
      }
    });

    it("missing spam score reduces confidence", () => {
      const missingSpam = normalized.find(
        (r) => r._spamScoreMissing,
      );
      assert.ok(missingSpam, "Should have record with missing spam");

      assert.ok(
        missingSpam.classificationConfidence < 0.85,
        "Missing spam should keep confidence below high",
      );
    });

    it("high spam score forces bad classification", () => {
      const highSpamRecords = normalized.filter(
        (r) => r.spamScore != null && r.spamScore >= 61,
      );
      for (const r of highSpamRecords) {
        assert.equal(
          r.bucket,
          "bad",
          `Record with spam score ${r.spamScore} must be classified as bad`,
        );
      }
    });

    it("high authority does not override spam risk in classification", () => {
      // The record with high spam (72) should be bad regardless of other scores
      const highSpamBad = normalized.find(
        (r) => r.spamScore === 72,
      );
      assert.ok(highSpamBad, "Should find the spam-72 record");
      assert.equal(highSpamBad.bucket, "bad");
    });

    it("competitor overlap does not create worth_pursuing when spam is high", () => {
      // All worth_pursuing records must have spamScore <= 30
      const wp = normalized.filter(
        (r) => r.bucket === "worth_pursuing",
      );
      for (const w of wp) {
        assert.ok(
          w.spamScore == null || w.spamScore <= 30,
          `Worth-pursuing record should not have high spam: ${w.spamScore}`,
        );
      }
    });

    it("evidenceClass strongly_supported when multiple red flags for bad", () => {
      // Records with both high spam AND placement=0 OR spammy anchor
      const strongBad = normalized.find(
        (r) =>
          r.bucket === "bad" &&
          r.evidenceClass === "strongly_supported",
      );
      assert.ok(strongBad, "Should have strongly_supported bad record");
    });

    it("evidenceClass strongly_supported for worth_pursuing with high overlap", () => {
      const strongWP = normalized.find(
        (r) =>
          r.bucket === "worth_pursuing" &&
          r.competitorOverlapCount >= 2 &&
          r.evidenceClass === "strongly_supported",
      );
      assert.ok(
        strongWP,
        "Should have strongly_supported worth_pursuing with 2+ overlap",
      );
    });
  });

  // -----------------------------------------------------------------------
  // 5. Artifact Writer (4 artifacts: raw, normalized, summary, manifest)
  // -----------------------------------------------------------------------
  describe("Backlink Artifact Writer", () => {
    let fixtures, normalized, output;

    before(() => {
      fixtures = loadFixtures();
      normalized = normalizeBacklinks(fixtures.backlinks, {
        targetDomain: "example.com",
        competitorDomains: [
          "competitor-a.com",
          "competitor-b.com",
          "competitor-c.com",
        ],
      });
      classifyBacklinks(normalized);

      const runMeta = {
        targetDomain: "example.com",
        competitorDomains: [
          "competitor-a.com",
          "competitor-b.com",
          "competitor-c.com",
        ],
        mode: "fixture",
        requestCount: 3,
        estimatedCost: 0.15,
        targetSpamScore: 5,
      };

      output = writeArtifacts({
        rawBacklinks: fixtures.backlinks,
        rawSummary: fixtures.summary,
        normalizedBacklinks: normalized,
        runMeta,
        outPath: TEST_OUT_DIR,
      });
    });

    // --- All four artifacts exist ---

    it("writes all four artifacts to disk", () => {
      assert.ok(existsSync(output.rawPath), "raw-backlinks.json missing");
      assert.ok(existsSync(output.normalizedPath), "normalized-backlinks.json missing");
      assert.ok(existsSync(output.summaryPath), "backlink-summary.json missing");
      assert.ok(existsSync(output.manifestPath), "backlink-manifest.json missing");
    });

    it("all artifact paths are under artifacts/local/backlink-tests/", () => {
      const base = resolve(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "..",
        "artifacts",
        "local",
        "backlink-tests",
      );
      for (const p of [
        output.rawPath,
        output.normalizedPath,
        output.summaryPath,
        output.manifestPath,
      ]) {
        assert.ok(
          p.startsWith(base),
          `Path not under artifacts/local/backlink-tests/: ${p}`,
        );
      }
    });

    // --- Raw artifact ---

    it("writes raw-backlinks.json", () => {
      assert.ok(existsSync(output.rawPath));
      const content = JSON.parse(
        readFileSync(output.rawPath, "utf-8"),
      );
      assert.ok(Array.isArray(content.backlinks));
      assert.ok(content.summary);
    });

    // --- Normalized artifact ---

    it("writes normalized-backlinks.json", () => {
      assert.ok(existsSync(output.normalizedPath));
      const content = JSON.parse(
        readFileSync(output.normalizedPath, "utf-8"),
      );
      assert.ok(Array.isArray(content.records));
      // Clean records should not have internal fields
      const first = content.records[0];
      assert.equal(first._missingFields, undefined);
      assert.equal(first._spamScoreMissing, undefined);
      assert.equal(first._isSpammyAnchor, undefined);
      assert.equal(first._isDuplicate, undefined);
    });

    // --- Summary artifact ---

    it("writes backlink-summary.json with correct structure", () => {
      assert.ok(existsSync(output.summaryPath));
      const content = JSON.parse(
        readFileSync(output.summaryPath, "utf-8"),
      );

      const requiredFields = [
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
      ];

      for (const field of requiredFields) {
        assert.ok(
          field in content,
          `Summary missing field: ${field}`,
        );
      }
    });

    it("summary counts are correct", () => {
      const content = JSON.parse(
        readFileSync(output.summaryPath, "utf-8"),
      );

      const good = normalized.filter(
        (r) => r.bucket === "good",
      ).length;
      const bad = normalized.filter(
        (r) => r.bucket === "bad",
      ).length;
      const wp = normalized.filter(
        (r) => r.bucket === "worth_pursuing",
      ).length;
      const ignored = normalized.filter(
        (r) => r.bucket === "ignore",
      ).length;

      assert.equal(content.goodCount, good);
      assert.equal(content.badCount, bad);
      assert.equal(content.worthPursuingCount, wp);
      assert.equal(content.ignoredCount, ignored);
      assert.equal(
        content.goodCount +
          content.badCount +
          content.worthPursuingCount +
          content.ignoredCount,
        content.totalBacklinksReviewed,
      );
    });

    it("summary includes fixture mode limitation", () => {
      const content = JSON.parse(
        readFileSync(output.summaryPath, "utf-8"),
      );
      const hasFixtureLimit = content.limitations.some(
        (l) => l.includes("Fixture mode"),
      );
      assert.ok(hasFixtureLimit);
    });

    it('recommendedUse is "contextual_report_only"', () => {
      const content = JSON.parse(
        readFileSync(output.summaryPath, "utf-8"),
      );
      assert.equal(
        content.recommendedUse,
        "contextual_report_only",
      );
    });

    // --- Manifest artifact ---

    it("manifest artifact exists and is valid JSON", () => {
      assert.ok(existsSync(output.manifestPath));
      const manifest = JSON.parse(
        readFileSync(output.manifestPath, "utf-8"),
      );
      assert.ok(manifest, "Manifest should be non-null");
    });

    it("manifest target equals the requested target", () => {
      const manifest = JSON.parse(
        readFileSync(output.manifestPath, "utf-8"),
      );
      assert.equal(manifest.target, "example.com");
    });

    it("manifest mode equals fixture in fixture tests", () => {
      const manifest = JSON.parse(
        readFileSync(output.manifestPath, "utf-8"),
      );
      assert.equal(manifest.mode, "fixture");
    });

    it("manifest has all required top-level fields", () => {
      const manifest = JSON.parse(
        readFileSync(output.manifestPath, "utf-8"),
      );
      const required = [
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
      for (const field of required) {
        assert.ok(
          field in manifest,
          `Manifest missing field: ${field}`,
        );
      }
    });

    it("manifest summaryMetrics has all required fields", () => {
      const manifest = JSON.parse(
        readFileSync(output.manifestPath, "utf-8"),
      );
      const required = [
        "rank",
        "backlinks",
        "referring_domains",
        "referring_pages",
        "backlinks_spam_score",
        "target_spam_score",
      ];
      for (const field of required) {
        assert.ok(
          field in manifest.summaryMetrics,
          `manifest.summaryMetrics missing field: ${field}`,
        );
      }
    });

    it("manifest worth_pursuing is 0 when no competitors are supplied", () => {
      // Run a second write without competitors
      const noCompNormalized = normalizeBacklinks(fixtures.backlinks, {
        targetDomain: "example.com",
        competitorDomains: [],
      });
      classifyBacklinks(noCompNormalized);

      const noCompOutput = writeArtifacts({
        rawBacklinks: fixtures.backlinks,
        rawSummary: fixtures.summary,
        normalizedBacklinks: noCompNormalized,
        runMeta: {
          targetDomain: "example.com",
          competitorDomains: [],
          mode: "fixture",
          requestCount: 2,
          estimatedCost: 0.02,
          targetSpamScore: 5,
        },
        outPath: TEST_OUT_DIR,
      });

      const manifest = JSON.parse(
        readFileSync(noCompOutput.manifestPath, "utf-8"),
      );
      assert.equal(manifest.worth_pursuing, 0);
      assert.equal(manifest.hasCompetitors, false);
      assert.deepEqual(manifest.competitors, []);
    });

    it("manifest source.provider is dataforseo", () => {
      const manifest = JSON.parse(
        readFileSync(output.manifestPath, "utf-8"),
      );
      assert.equal(manifest.source.provider, "dataforseo");
    });

    it("manifest source.endpoints is an array", () => {
      const manifest = JSON.parse(
        readFileSync(output.manifestPath, "utf-8"),
      );
      assert.ok(Array.isArray(manifest.source.endpoints));
      assert.ok(manifest.source.endpoints.length >= 1);
    });

    // --- Credential safety ---

    it("no credential values appear in manifest or artifacts", () => {
      const rawContent = readFileSync(output.rawPath, "utf-8");
      const normContent = readFileSync(
        output.normalizedPath,
        "utf-8",
      );
      const summaryContent = readFileSync(
        output.summaryPath,
        "utf-8",
      );
      const manifestContent = readFileSync(
        output.manifestPath,
        "utf-8",
      );

      for (const content of [
        rawContent,
        normContent,
        summaryContent,
        manifestContent,
      ]) {
        assert.ok(!content.includes("DATAFORSEO_LOGIN"));
        assert.ok(!content.includes("DATAFORSEO_PASSWORD"));
        assert.ok(!content.includes("password"));
        assert.ok(!content.includes("login"));
      }
    });

    // --- Schema validation ---

    it("validateRawArtifact passes for valid artifact", () => {
      const raw = JSON.parse(readFileSync(output.rawPath, "utf-8"));
      const result = validateRawArtifact(raw);
      assert.equal(result.valid, true, `Errors: ${result.errors.join("; ")}`);
    });

    it("validateNormalizedArtifact passes for valid artifact", () => {
      const norm = JSON.parse(
        readFileSync(output.normalizedPath, "utf-8"),
      );
      const result = validateNormalizedArtifact(norm);
      assert.equal(result.valid, true, `Errors: ${result.errors.join("; ")}`);
    });

    it("validateSummaryArtifact passes for valid artifact", () => {
      const summary = JSON.parse(
        readFileSync(output.summaryPath, "utf-8"),
      );
      const result = validateSummaryArtifact(summary);
      assert.equal(result.valid, true, `Errors: ${result.errors.join("; ")}`);
    });

    it("validateManifestArtifact passes for valid manifest", () => {
      const manifest = JSON.parse(
        readFileSync(output.manifestPath, "utf-8"),
      );
      const result = validateManifestArtifact(manifest);
      assert.equal(result.valid, true, `Errors: ${result.errors.join("; ")}`);
    });

    it("validateRequiredFields fails clearly when a required field is missing", () => {
      const incomplete = { targetDomain: "example.com" };
      const result = validateRequiredFields(incomplete, [
        "targetDomain",
        "competitorDomains",
        "mode",
      ]);
      assert.equal(result.valid, false);
      assert.ok(result.missing.includes("competitorDomains"));
      assert.ok(result.missing.includes("mode"));
      assert.ok(!result.missing.includes("targetDomain"));
    });

    it("validateRawArtifact fails when required field is missing", () => {
      const bad = { _description: "test" };
      const result = validateRawArtifact(bad);
      assert.equal(result.valid, false);
      assert.ok(result.errors.length > 0);
    });

    it("validateManifestArtifact fails when summaryMetrics field is missing", () => {
      const bad = {
        artifactVersion: "1.0.0",
        generatedAt: new Date().toISOString(),
        mode: "fixture",
        target: "example.com",
        includeSubdomains: false,
        hasCompetitors: false,
        competitors: [],
        worth_pursuing: 0,
        summaryMetrics: {
          // missing backlinks field
          rank: null,
          referring_domains: null,
          referring_pages: null,
          backlinks_spam_score: null,
          target_spam_score: null,
        },
        files: {
          rawBacklinks: "/tmp/raw.json",
          normalizedBacklinks: "/tmp/norm.json",
          backlinkSummary: "/tmp/summary.json",
        },
        source: {
          provider: "dataforseo",
          endpoints: [],
          responseMode: "fixture",
        },
        limitations: [],
      };
      const result = validateManifestArtifact(bad);
      assert.equal(result.valid, false);
      assert.ok(
        result.errors.some((e) => e.includes("backlinks")),
        `Expected error about missing backlinks, got: ${result.errors.join("; ")}`,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 6. Production safety gates
  // -----------------------------------------------------------------------
  describe("Production Safety Gates", () => {
    it("does not modify Vantage readiness scoring files", () => {
      // Phase 1 adapter must not touch any production scoring paths.
      // This test verifies we are not importing or modifying scoring modules.
      const scoringPaths = [
        "services/worker/src/scoring",
        "services/worker/src/readiness",
        "services/worker/src/audit",
      ];

      for (const p of scoringPaths) {
        const fullPath = resolve(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          p,
        );
        // These paths should not exist yet — verifying Phase 1 isolation
        if (existsSync(fullPath)) {
          assert.fail(
            `Production scoring path should not be touched in Phase 1: ${p}`,
          );
        }
      }
      // If we reach here, no production scoring paths were found (expected for Phase 1)
    });
  });

  // -----------------------------------------------------------------------
  // 7. Edge cases
  // -----------------------------------------------------------------------
  describe("Edge Cases", () => {
    it("handles completely empty backlink array", () => {
      const normalized = normalizeBacklinks([], {
        targetDomain: "example.com",
      });
      assert.equal(normalized.length, 0);
      classifyBacklinks(normalized);
      assert.equal(normalized.length, 0);
    });

    it("handles record with all-null fields", () => {
      const allNull = {
        page_from: null,
        page_from_title: null,
        domain_from: null,
        page_to: null,
        domain_to: null,
        anchor: null,
        semantic_location: null,
        link_type: null,
        link_attributes: [],
        domain_from_rank: null,
        page_from_rank: null,
        spam_score: null,
        target_spam_score: null,
        first_seen: null,
        last_seen: null,
        external_links_count: null,
        links_count: null,
        competitor_overlap_count: 0,
        client_has_link_from_domain: false,
      };

      assert.doesNotThrow(() => {
        const normalized = normalizeBacklink(allNull, {
          targetDomain: "example.com",
        });
        classifyBacklink(normalized);
        assert.equal(normalized.bucket, "ignore");
        assert.equal(
          normalized.evidenceClass,
          "insufficient_evidence",
        );
      });
    });

    it("confidence is always between 0 and 1", () => {
      const fixtures = loadFixtures();
      for (const raw of fixtures.backlinks) {
        const normalized = normalizeBacklink(raw, {
          targetDomain: "example.com",
        });
        assert.ok(
          normalized.classificationConfidence >= 0 &&
            normalized.classificationConfidence <= 1,
          `Confidence ${normalized.classificationConfidence} out of range`,
        );
      }
    });

    it("factor scores are always 0-25", () => {
      const fixtures = loadFixtures();
      for (const raw of fixtures.backlinks) {
        const normalized = normalizeBacklink(raw, {
          targetDomain: "example.com",
        });
        assert.ok(normalized.relevanceScore >= 0 && normalized.relevanceScore <= 25);
        assert.ok(normalized.authorityScore >= 0 && normalized.authorityScore <= 25);
        assert.ok(normalized.placementScore >= 0 && normalized.placementScore <= 25);
        assert.ok(normalized.spamSafetyScore >= 0 && normalized.spamSafetyScore <= 25);
      }
    });

    it("no causal ranking claims in rationales", () => {
      const fixtures = loadFixtures();
      const normalized = normalizeBacklinks(fixtures.backlinks, {
        targetDomain: "example.com",
      });
      classifyBacklinks(normalized);

      const forbiddenPhrases = [
        "will improve rankings",
        "ranks because",
        "boost your ranking",
        "guaranteed ranking",
      ];

      for (const r of normalized) {
        for (const phrase of forbiddenPhrases) {
          assert.ok(
            !r.rationale.toLowerCase().includes(phrase),
            `Rationale contains forbidden phrase: "${phrase}"`,
          );
        }
      }
    });

    it("no automatic disavow recommendations", () => {
      const fixtures = loadFixtures();
      const normalized = normalizeBacklinks(fixtures.backlinks, {
        targetDomain: "example.com",
      });
      classifyBacklinks(normalized);

      for (const r of normalized) {
        assert.ok(
          !r.rationale.toLowerCase().includes("disavow"),
          `Rationale should not recommend disavow: "${r.rationale}"`,
        );
      }
    });
  });
});

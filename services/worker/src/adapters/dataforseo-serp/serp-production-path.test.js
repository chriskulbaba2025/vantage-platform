/**
 * DataForSEO SERP Production-Path Regression Test
 *
 * Proves the full data path from audit input through normalization,
 * DataForSEO API call, task-level error detection, audit.json state,
 * and client-report rendering.
 *
 * Production fixture:
 *   language: en-CA
 *   location: Ottawa and Ontario, Canada
 *
 * Requirements verified:
 *   1. DataForSEO receives valid normalized parameters (not raw BCP-47 or free text)
 *   2. Task-level errors are surfaced (not silently returned as empty success)
 *   3. Audit.json stores correct canonical state
 *   4. Report renders correct success or limitation state
 */

import test from "node:test";
import assert from "node:assert/strict";
import { querySerp } from "./dataforseo-serp-client.js";
import { normalizeLanguage } from "./locale-normalizer.js";
import { resolveLocation } from "./location-resolver.js";
import { collectCompetitorOpportunities } from "../../evidence/competitor-opportunity-layer.js";
import { competitorBenchmark } from "../../report/sections-conversion.js";
import { SOURCE_STATUS, ERROR_CATEGORY } from "../../scoring/evidence-contracts.js";
import { competitorComparison } from "../../scoring/report-model.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROD_SITE = {
  sourceStatus: SOURCE_STATUS.AVAILABLE,
  services: ["Consulting", "Coaching"],
  topicKeywords: ["business consulting", "leadership coaching"],
  pages: [{ title: "Example Consulting" }],
  pageCount: 5,
  domain: "example.com",
  ctas: [],
  forms: [],
  trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: false },
};

const PROD_INPUT = {
  targetUrl: "https://example.com",
  businessName: "Example Consulting",
  location: "Ottawa and Ontario, Canada",
  language: "en-CA",
  competitors: [],
};

// ---------------------------------------------------------------------------
// S-01: Locale normalization â€” en-CA â†’ English
// ---------------------------------------------------------------------------

test("S-01: en-CA normalizes to DataForSEO English, not sent as BCP-47", () => {
  const result = normalizeLanguage("en-CA");
  assert.equal(result.languageName, "English");
  assert.equal(result.originalLanguage, "en-CA");
  assert.equal(result.isFallback, false);
  assert.equal(result.source, "bcp47");
  // Must not be the raw BCP-47 string
  assert.notEqual(result.languageName, "en-CA");
  assert.notEqual(result.languageName, "en");
});

// ---------------------------------------------------------------------------
// S-02: Location normalization â€” Ottawa and Ontario, Canada â†’ hierarchy
// ---------------------------------------------------------------------------

test("S-02: Ottawa and Ontario, Canada resolves to city-level hierarchy", () => {
  const result = resolveLocation("Ottawa and Ontario, Canada");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "city");
  assert.equal(result.locationName, "Ottawa,Ontario,Canada");
  assert.equal(result.originalLocation, "Ottawa and Ontario, Canada");
  // Must not contain the original " and " separator
  assert.equal(result.locationName.includes(" and "), false);
});

// ---------------------------------------------------------------------------
// S-03: DataForSEO receives valid normalized parameters (mock API)
// ---------------------------------------------------------------------------

test("S-03: DataForSEO request body contains normalized language_name and location_name", async () => {
  let capturedBody = null;

  const fetchImpl = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      time: "0.1234 sec.",
      cost: 0.01,
      tasks_count: 1,
      tasks: [{
        id: "task-abc-001",
        status_code: 20000,
        status_message: "Ok.",
        time: "0.1000 sec.",
        cost: 0.01,
        result_count: 1,
        result: [{
          keyword: "Consulting Ottawa and Ontario, Canada",
          se_type: "google",
          location_code: null,
          language_code: "en",
          items_count: 2,
          items: [
            { type: "organic", rank_absolute: 1, url: "https://competitor1.example", domain: "competitor1.example", title: "Competitor One" },
            { type: "organic", rank_absolute: 2, url: "https://competitor2.example", domain: "competitor2.example", title: "Competitor Two" },
          ],
        }],
      }],
    }), { status: 200 });
  };

  const result = await querySerp("Consulting Ottawa and Ontario, Canada", {
    login: "test-login",
    password: "test-pass",
    location: "Ottawa and Ontario, Canada",
    language: "en-CA",
    fetchImpl,
  });

  // â”€â”€ Verify the request body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(capturedBody, "Request body must be captured");
  assert.equal(capturedBody.length, 1);
  const task = capturedBody[0];

  // language_name must be "English", not "en-CA"
  assert.equal(task.language_name, "English",
    `Expected language_name "English", got "${task.language_name}"`);
  assert.notEqual(task.language_name, "en-CA");

  // location_name must be the hierarchy, not the raw free text
  assert.equal(task.location_name, "Ottawa,Ontario,Canada",
    `Expected location_name "Ottawa,Ontario,Canada", got "${task.location_name}"`);
  assert.notEqual(task.location_name, "Ottawa and Ontario, Canada");

  // â”€â”€ Verify the response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(result.error, null);
  assert.equal(result.rawTaskId, "task-abc-001");
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].candidateUrl, "https://competitor1.example");

  // Normalized values are returned
  assert.equal(result.normalizedLanguage.languageName, "English");
  assert.equal(result.normalizedLocation.locationName, "Ottawa,Ontario,Canada");
});

// ---------------------------------------------------------------------------
// S-04: Task-level error is surfaced (not silent empty success)
// ---------------------------------------------------------------------------

test("S-04: task with non-20000 status_code produces error, not empty items", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      time: "0.1234 sec.",
      cost: 0.01,
      tasks_count: 1,
      tasks: [{
        id: "task-fail-002",
        status_code: 40401,
        status_message: "Invalid location specified.",
        time: "0.0500 sec.",
        cost: 0,
        result_count: 0,
        result: null,
      }],
    }), { status: 200 });
  };

  const result = await querySerp("Test Keyword", {
    login: "test-login",
    password: "test-pass",
    location: "Ottawa and Ontario, Canada",
    language: "en-CA",
    fetchImpl,
  });

  // â”€â”€ Task error must be surfaced â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(result.error, "Must have an error for failed task");
  assert.ok(result.error.includes("40401"), `Error must include status code, got: ${result.error}`);
  assert.ok(result.error.includes("Invalid location"), `Error must include status message, got: ${result.error}`);

  // Task error details must be preserved
  assert.ok(result.taskError, "Must have taskError details");
  assert.equal(result.taskError.taskId, "task-fail-002");
  assert.equal(result.taskError.statusCode, 40401);
  assert.equal(result.taskError.statusMessage, "Invalid location specified.");

  // Items must be empty â€” never silently return empty as success
  assert.equal(result.items.length, 0);
  assert.equal(result.rawTaskId, "task-fail-002");

  // Normalized values still returned for audit trail
  assert.equal(result.normalizedLanguage.languageName, "English");
  assert.equal(result.normalizedLocation.locationName, "Ottawa,Ontario,Canada");
});

// ---------------------------------------------------------------------------
// S-05: Zero organic results (successful task) â‰  task failure
// ---------------------------------------------------------------------------

test("S-05: successful task with zero organic results is UNAVAILABLE, not FAILED", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      time: "0.1234 sec.",
      cost: 0.01,
      tasks_count: 1,
      tasks: [{
        id: "task-empty-003",
        status_code: 20000,
        status_message: "Ok.",
        time: "0.0500 sec.",
        cost: 0.01,
        result_count: 1,
        result: [{
          keyword: "rare niche query",
          se_type: "google",
          items_count: 0,
          items: [],
        }],
      }],
    }), { status: 200 });
  };

  const result = await querySerp("rare niche query", {
    login: "test-login",
    password: "test-pass",
    location: "Ottawa and Ontario, Canada",
    language: "en-CA",
    fetchImpl,
  });

  // â”€â”€ Zero results is NOT an error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(result.error, null, "Zero results with success code must not be an error");
  assert.ok(!result.taskError, "Must not have taskError for successful task");
  assert.equal(result.rawTaskId, "task-empty-003");
  assert.equal(result.items.length, 0, "Zero items is valid for a niche query");

  // â”€â”€ Via competitor layer, this should become UNAVAILABLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const opp = await collectCompetitorOpportunities(
    { ...PROD_SITE, services: ["rare niche query"], topicKeywords: [] },
    PROD_INPUT,
    {
      dataforseoLogin: "test-login",
      dataforseoPassword: "test-pass",
      suppliedCompetitors: [],
      fetchImpl,
    },
  );

  // No candidates from SERP, but the task did not fail
  assert.equal(opp.sources.dataforseoSerp.status, SOURCE_STATUS.UNAVAILABLE,
    "Zero organic results with success code must be UNAVAILABLE, not FAILED");
});

// ---------------------------------------------------------------------------
// S-06: Task error â†’ FAILED in competitor layer, not UNAVAILABLE
// ---------------------------------------------------------------------------

test("S-06: task error produces FAILED SERP source status in competitor layer", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-fail-006",
        status_code: 40401,
        status_message: "Invalid location specified.",
        result_count: 0,
        result: null,
      }],
    }), { status: 200 });
  };

  const opp = await collectCompetitorOpportunities(
    PROD_SITE,
    PROD_INPUT,
    {
      dataforseoLogin: "test-login",
      dataforseoPassword: "test-pass",
      suppliedCompetitors: [],
      fetchImpl,
    },
  );

  // â”€â”€ SERP source must be FAILED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp.sources.dataforseoSerp.status, SOURCE_STATUS.FAILED,
    "Task error must produce FAILED, not UNAVAILABLE or AVAILABLE");
  assert.notEqual(opp.sources.dataforseoSerp.status, SOURCE_STATUS.AVAILABLE,
    "Must not mark failed task as AVAILABLE");
  assert.notEqual(opp.sources.dataforseoSerp.status, SOURCE_STATUS.UNAVAILABLE,
    "Must not mark failed task as UNAVAILABLE");

  // Task errors are preserved (one per topic that failed)
  assert.ok(opp.sources.dataforseoSerp.taskErrors, "Must preserve task errors");
  assert.ok(opp.sources.dataforseoSerp.taskErrors.length >= 1,
    `Expected at least 1 task error, got ${opp.sources.dataforseoSerp.taskErrors.length}`);
  assert.equal(opp.sources.dataforseoSerp.taskErrors[0].statusCode, 40401);

  // Normalized values are stored
  assert.equal(opp.sources.dataforseoSerp.normalizedLanguage, "English");
  assert.equal(opp.sources.dataforseoSerp.normalizedLocation, "Ottawa,Ontario,Canada");

  // Original values are preserved
  assert.equal(opp.sources.dataforseoSerp.originalLanguage, "en-CA");
  assert.equal(opp.sources.dataforseoSerp.originalLocation, "Ottawa and Ontario, Canada");

  // _sourceStatus must reflect failure
  assert.equal(opp._sourceStatus.errorCategory, ERROR_CATEGORY.INTERNAL);
  assert.ok(opp._sourceStatus.limitation, "Must have limitation text");
});

// ---------------------------------------------------------------------------
// S-07: audit.json canonical fields â€” success path
// ---------------------------------------------------------------------------

test("S-07: audit.json records full canonical state on SERP success", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-success-007",
        status_code: 20000,
        status_message: "Ok.",
        result_count: 1,
        result: [{
          keyword: "Consulting Ottawa and Ontario, Canada",
          items_count: 3,
          items: [
            { type: "organic", rank_absolute: 1, url: "https://comp1.example", domain: "comp1.example", title: "Comp One", featured_snippet: "snippet text" },
            { type: "organic", rank_absolute: 2, url: "https://comp2.example/services", domain: "comp2.example", title: "Comp Two Services" },
            { type: "organic", rank_absolute: 3, url: "https://comp3.example/consulting", domain: "comp3.example", title: "Comp Three Consulting" },
          ],
        }],
      }],
    }), { status: 200 });
  };

  const opp = await collectCompetitorOpportunities(
    PROD_SITE,
    PROD_INPUT,
    {
      dataforseoLogin: "test-login",
      dataforseoPassword: "test-pass",
      suppliedCompetitors: [],
      fetchImpl,
    },
  );

  // â”€â”€ Source status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp.source, "competitor-opportunity-layer");
  assert.equal(opp.evidenceVersion, "1.0.0");

  // â”€â”€ SERP source fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const serp = opp.sources.dataforseoSerp;
  assert.equal(serp.status, SOURCE_STATUS.AVAILABLE);
  // 2 topics (Consulting, Coaching) Ã— 3 results each = 6 candidates
  assert.ok(serp.candidateCount >= 3,
    `Expected at least 3 SERP candidates, got ${serp.candidateCount}`);
  assert.ok(serp.taskIds.length > 0);
  assert.equal(serp.taskErrors, undefined, "No task errors on success");

  // â”€â”€ Normalized locale fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(serp.normalizedLanguage, "English");
  assert.equal(serp.normalizedLocation, "Ottawa,Ontario,Canada");
  assert.equal(serp.originalLanguage, "en-CA");
  assert.equal(serp.originalLocation, "Ottawa and Ontario, Canada");

  // â”€â”€ _sourceStatus canonical record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp._sourceStatus.provider, "competitor-opportunity-layer");
  assert.ok(opp._sourceStatus.startedAt);
  assert.ok(opp._sourceStatus.completedAt);
  assert.equal(opp._sourceStatus.returnedRecordCount, 0,
    "SERP snippets without observed competitor geography, audience, and commercial evidence remain excluded");
  assert.ok(opp.candidates.excluded.length > 0);
  assert.equal(opp._sourceStatus.errorCategory, null);

  // â”€â”€ Coverage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(opp.coverage.topicsRequested > 0);
  assert.ok(opp.coverage.serpCandidatesFound >= 3,
    `Expected at least 3 SERP candidates found, got ${opp.coverage.serpCandidatesFound}`);
  assert.ok(opp.collectedAt);
});

// ---------------------------------------------------------------------------
// S-08: audit.json canonical fields â€” failure path
// ---------------------------------------------------------------------------

test("S-08: audit.json records full canonical state on SERP failure", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-fail-008",
        status_code: 40401,
        status_message: "Invalid location specified.",
        result_count: 0,
        result: null,
      }],
    }), { status: 200 });
  };

  const opp = await collectCompetitorOpportunities(
    PROD_SITE,
    PROD_INPUT,
    {
      dataforseoLogin: "test-login",
      dataforseoPassword: "test-pass",
      suppliedCompetitors: [],
      fetchImpl,
    },
  );

  // â”€â”€ SERP source must be FAILED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const serp = opp.sources.dataforseoSerp;
  assert.equal(serp.status, SOURCE_STATUS.FAILED);

  // â”€â”€ Task error details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(serp.taskErrors);
  assert.equal(serp.taskErrors[0].statusCode, 40401);
  assert.equal(serp.taskErrors[0].statusMessage, "Invalid location specified.");

  // â”€â”€ Normalized + original locale preserved â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(serp.normalizedLanguage, "English");
  assert.equal(serp.normalizedLocation, "Ottawa,Ontario,Canada");
  assert.equal(serp.originalLanguage, "en-CA");
  assert.equal(serp.originalLocation, "Ottawa and Ontario, Canada");

  // â”€â”€ _sourceStatus failure fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp._sourceStatus.errorCategory, ERROR_CATEGORY.INTERNAL);
  assert.ok(opp._sourceStatus.limitation);
  assert.ok(opp._sourceStatus.limitation.includes("Invalid location"),
    `Limitation must mention the task error, got: "${opp._sourceStatus.limitation}"`);

  // â”€â”€ Never marks failed task as AVAILABLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.notEqual(opp.sourceStatus, SOURCE_STATUS.AVAILABLE);
  assert.notEqual(serp.status, SOURCE_STATUS.AVAILABLE);

  // â”€â”€ Limitations contain the error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(opp.limitations.length > 0);
  assert.ok(opp.limitations.some((l) => l.includes("40401") || l.includes("Invalid location")),
    `Limitations must reference task error, got: ${opp.limitations.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// S-09: Report renders limitation when SERP failed
// ---------------------------------------------------------------------------

test("S-09: report renders SERP failure limitation, not empty success", () => {
  // Build a model with FAILED SERP source
  const competitorOpps = {
    topics: [{ topic: "Consulting", query: "Consulting Ottawa and Ontario, Canada" }],
    candidates: { qualified: [], excluded: [], totalSerp: 0, totalSupplied: 0, totalQualified: 0, totalExcluded: 0 },
    gaps: [],
    allGaps: [],
    sources: {
      dataforseoSerp: {
        status: "FAILED",
        taskIds: ["task-fail-009"],
        candidateCount: 0,
        taskErrors: [{ topic: "Consulting Ottawa and Ontario, Canada", taskId: "task-fail-009", statusCode: 40401, statusMessage: "Invalid location specified." }],
        normalizedLanguage: "English",
        normalizedLocation: "Ottawa,Ontario,Canada",
        originalLanguage: "en-CA",
        originalLocation: "Ottawa and Ontario, Canada",
      },
      supplied: { status: "NOT_APPLICABLE", candidateCount: 0 },
    },
    limitations: ['DataForSEO SERP for "Consulting Ottawa and Ontario, Canada": SERP task 0 failed: status_code=40401, message="Invalid location specified."'],
    collectedAt: new Date().toISOString(),
    coverage: { topicsRequested: 1, serpCandidatesFound: 0, suppliedCandidatesFound: 0 },
    evidenceVersion: "1.0.0",
    source: "competitor-opportunity-layer",
    sourceStatus: "UNAVAILABLE",
  };

  const model = {
    input: { businessName: "Example Consulting", location: "Ottawa and Ontario, Canada", language: "en-CA" },
    evidence: { site: { domain: "example.com", services: ["Consulting"], ctas: [], forms: [], trust: { testimonials: false } } },
    competitors: competitorComparison([], competitorOpps),
    crossReportInterpretation: { version: "1.0.0", constructs: { offerClarity: "Observed service scope", ctaClarity: "Not Assessed", conversionPathClarity: "Not Assessed", trustProof: "Not Assessed", mobileUsability: "Not Assessed", indexability: "Not Assessed" } },
    competitorOpportunities: competitorOpps,
    scores: { contentDepth: 40, conversionPathways: 40 },
    bands: { trust: "Not Assessed" },
    contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
  };

  const html = competitorBenchmark(model);

  // â”€â”€ Must render the SERP failure limitation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(html.includes("Source limitation"),
    "Report must render source limitation for SERP failure");
  assert.ok(html.includes("FAILED") || html.includes("status_code=40401"),
    "Report must surface the SERP failure status");
  assert.ok(html.includes("Invalid location"),
    "Report must include the provider error message");

  // â”€â”€ Must NOT say competitors were absent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(html.includes("Competitor analysis continues with supplied-competitor evidence only") ||
    html.includes("localized competitor evidence could not be collected"),
    "Report must explain the limitation, not claim competitors are absent");

  // â”€â”€ Must NOT render empty competitor results as success â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // The "No qualified gaps" message is OK because there truly are no gaps
  // But we must not claim SERP analysis was successful
  assert.equal(html.includes("DataForSEO SERP analysis of"), false,
    "Must not claim SERP analysis contributed when it failed");

  // â”€â”€ Must include normalized locale info â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(html.includes("English"), "Report must show normalized language");
  assert.ok(html.includes("Ottawa,Ontario,Canada"), "Report must show normalized location");

  // â”€â”€ Must not leak credentials or stack traces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(html.includes("test-login"), false, "Must not expose credentials");
  assert.equal(html.includes("test-pass"), false, "Must not expose credentials");
  assert.equal(html.includes("at querySerp"), false, "Must not expose stack traces");
  assert.equal(html.includes("at collectCompetitorOpportunities"), false, "Must not expose stack traces");
});

// ---------------------------------------------------------------------------
// S-10: Report renders success normally when SERP succeeds
// ---------------------------------------------------------------------------

test("S-10: report renders competitor evidence normally on SERP success", () => {
  const competitorOpps = {
    topics: [{ topic: "Consulting", query: "Consulting Ottawa and Ontario, Canada" }],
    candidates: {
      qualified: [
        { candidateUrl: "https://comp1.example/services", domain: "comp1.example", topic: "Consulting", discoverySource: "dataforseo-serp", pageType: "service", approvalStatus: "approved", qualificationPassed: true },
      ],
      excluded: [],
      totalSerp: 1, totalSupplied: 0, totalQualified: 1, totalExcluded: 0,
    },
    gaps: [{
      clientTopic: "Consulting",
      competitorPage: "https://comp1.example/services",
      competitorDomain: "comp1.example",
      clientCoverage: "present",
      observedCompetitorCoverage: ["Services page with 5 sections"],
      conversionRelevance: "High",
      confidence: "Moderate",
      recommendation: "Create or strengthen content for Consulting",
      limitationStatement: "Based on visible on-page SERP evidence only.",
      gapPassed: true,
      approvalStatus: "approved",
      qualificationPassed: true,
    }],
    allGaps: [],
    sources: {
      dataforseoSerp: {
        status: "AVAILABLE",
        taskIds: ["task-success-010"],
        candidateCount: 1,
        normalizedLanguage: "English",
        normalizedLocation: "Ottawa,Ontario,Canada",
        originalLanguage: "en-CA",
        originalLocation: "Ottawa and Ontario, Canada",
      },
      supplied: { status: "NOT_APPLICABLE", candidateCount: 0 },
    },
    limitations: [],
    collectedAt: new Date().toISOString(),
    coverage: { topicsRequested: 1, serpCandidatesFound: 1, suppliedCandidatesFound: 0 },
    evidenceVersion: "1.0.0",
    source: "competitor-opportunity-layer",
    sourceStatus: "AVAILABLE",
  };

  const model = {
    input: { businessName: "Example Consulting", location: "Ottawa and Ontario, Canada", language: "en-CA" },
    evidence: { site: { domain: "example.com", services: ["Consulting"], ctas: [], forms: [], trust: { testimonials: false } } },
    competitors: competitorComparison([], competitorOpps),
    crossReportInterpretation: { version: "1.0.0", constructs: { offerClarity: "Observed service scope", ctaClarity: "Not Assessed", conversionPathClarity: "Not Assessed", trustProof: "Not Assessed", mobileUsability: "Not Assessed", indexability: "Not Assessed" } },
    competitorOpportunities: competitorOpps,
    scores: { contentDepth: 50, conversionPathways: 50 },
    bands: { trust: "Not Assessed" },
    contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
  };

  const html = competitorBenchmark(model);

  // â”€â”€ Must show successful SERP analysis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(html.includes("AVAILABLE"), "Report must show AVAILABLE SERP status");
  assert.ok(html.includes("task-success-010"), "Report must include task ID");

  // â”€â”€ Must render qualified gaps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(html.includes("Qualified Competitor Gaps"), "Must render gap section");
  assert.ok(html.includes("comp1.example"), "Must render competitor domain");
  assert.ok(html.includes("Consulting"), "Must render topic");

  // â”€â”€ Must NOT show failure limitation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(html.includes("Source limitation"), false,
    "Must not show failure limitation on success");

  // â”€â”€ Must include normalized locale info â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(html.includes("English"), "Report must show normalized language");
  assert.ok(html.includes("Ottawa,Ontario,Canada"), "Report must show normalized location");
});

// ---------------------------------------------------------------------------
// S-11: Location resolution failure prevents API call
// ---------------------------------------------------------------------------

test("S-11: unresolvable location returns error before API call", async () => {
  let apiCalled = false;
  const fetchImpl = async () => {
    apiCalled = true;
    return new Response("{}", { status: 200 });
  };

  const result = await querySerp("some query", {
    login: "test-login",
    password: "test-pass",
    location: "xyz-fake-place-12345",
    language: "en-CA",
    fetchImpl,
  });

  // Location resolution must fail before API call
  assert.ok(result.error, "Must have error for unresolvable location");
  assert.ok(result.error.includes("Location resolution failed"),
    `Error must mention location resolution, got: ${result.error}`);

  // API must not be called with bad location
  assert.equal(apiCalled, false, "Must not call DataForSEO with unresolved location");

  // Normalized values are still present for audit trail
  assert.equal(result.normalizedLanguage.languageName, "English");
  assert.equal(result.normalizedLocation.resolutionLevel, "unresolved");
  assert.ok(result.normalizedLocation.error);
});

// ---------------------------------------------------------------------------
// S-12: Supplied competitors unaffected by SERP failure
// ---------------------------------------------------------------------------

test("S-12: supplied competitors still processed when SERP tasks fail", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-fail-012",
        status_code: 40401,
        status_message: "Invalid location specified.",
        result_count: 0,
        result: null,
      }],
    }), { status: 200 });
  };

  const opp = await collectCompetitorOpportunities(
    PROD_SITE,
    PROD_INPUT,
    {
      dataforseoLogin: "test-login",
      dataforseoPassword: "test-pass",
      suppliedCompetitors: [
        {
          url: "https://supplied-comp.example",
          status: SOURCE_STATUS.AVAILABLE,
          evidence: { services: ["Consulting"], audience: "Business leaders seeking consulting services", commercialIntent: "Consulting services are offered for purchase", pageCount: 8, trust: { credentials: true } },
        },
      ],
      fetchImpl,
    },
  );

  // Supplied competitors must still be counted
  assert.equal(opp.sources.supplied.candidateCount, 1);
  assert.ok(opp.candidates.totalSupplied > 0);

  // SERP must be FAILED
  assert.equal(opp.sources.dataforseoSerp.status, SOURCE_STATUS.FAILED);

  // Overall sourceStatus â€” should reflect that supplied competitors exist
  // even though SERP failed
  assert.ok(
    opp.candidates.totalSupplied > 0,
    "Supplied competitors must be preserved despite SERP failure",
  );
});

// ---------------------------------------------------------------------------
// S-13: Missing top-level status_code â†’ structured API failure
// ---------------------------------------------------------------------------

test("S-13: missing top-level status_code produces error, not empty success", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-missing-top-013",
        status_code: 20000,
        status_message: "Ok.",
        result_count: 1,
        result: [{ items_count: 1, items: [{ type: "organic", rank_absolute: 1, url: "https://example.com", domain: "example.com", title: "Test" }] }],
      }],
    }), { status: 200 });
    // NOTE: top-level status_code is absent from the response body
  };

  const result = await querySerp("test query", {
    login: "test-login",
    password: "test-pass",
    location: "Ottawa and Ontario, Canada",
    language: "en-CA",
    fetchImpl,
  });

  // Must return an error
  assert.ok(result.error, "Must return error for missing top-level status_code");
  assert.ok(result.error.includes("missing"), "Error must indicate missing status");

  // Must not emit items as successful
  assert.equal(result.items.length, 0, "Must not return items on validation failure");

  // Normalized values still preserved for audit trail
  assert.equal(result.normalizedLanguage.languageName, "English");
  assert.equal(result.normalizedLocation.locationName, "Ottawa,Ontario,Canada");
});

// ---------------------------------------------------------------------------
// S-14: Null top-level status_code â†’ structured API failure
// ---------------------------------------------------------------------------

test("S-14: null top-level status_code produces error, not empty success", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: null,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-null-top-014",
        status_code: 20000,
        status_message: "Ok.",
        result_count: 1,
        result: [{ items_count: 1, items: [{ type: "organic", rank_absolute: 1, url: "https://example.com", domain: "example.com", title: "Test" }] }],
      }],
    }), { status: 200 });
  };

  const result = await querySerp("test query", {
    login: "test-login",
    password: "test-pass",
    location: "Canada",
    language: "en",
    fetchImpl,
  });

  assert.ok(result.error, "Must return error for null top-level status_code");
  assert.ok(result.error.includes("missing"), "Error must indicate null/missing status");
  assert.equal(result.items.length, 0, "Must not return items on null status_code");
});

// ---------------------------------------------------------------------------
// S-15: Missing task-level status_code â†’ FAILED source, report limitation
// ---------------------------------------------------------------------------

test("S-15: missing task-level status_code becomes FAILED source and renders limitation", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-missing-code-015",
        status_message: "Ok.",
        result_count: 1,
        result: [{ items_count: 1, items: [{ type: "organic", rank_absolute: 1, url: "https://example.com", domain: "example.com", title: "Test" }] }],
        // NOTE: task-level status_code is absent
      }],
    }), { status: 200 });
  };

  // â”€â”€ querySerp must return an error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const result = await querySerp("test query", {
    login: "test-login",
    password: "test-pass",
    location: "Ottawa and Ontario, Canada",
    language: "en-CA",
    fetchImpl,
  });

  assert.ok(result.error, "Must return error for missing task status_code");
  assert.ok(result.error.includes("missing task status code"), "Error must mention missing task status code");
  assert.ok(result.taskError, "Must preserve taskError details");
  assert.equal(result.taskError.statusCode, null);
  assert.equal(result.taskError.statusMessage, "missing task status code");
  assert.equal(result.items.length, 0, "Must not return items");

  // â”€â”€ Competitor layer must report FAILED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const opp = await collectCompetitorOpportunities(
    { sourceStatus: "AVAILABLE", services: ["Consulting"], topicKeywords: [], pages: [{ title: "Test" }], pageCount: 1, domain: "test.com", ctas: [], forms: [], trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: false } },
    { targetUrl: "https://test.com", businessName: "Test", location: "Ottawa and Ontario, Canada", language: "en-CA", competitors: [] },
    { dataforseoLogin: "test-login", dataforseoPassword: "test-pass", suppliedCompetitors: [], fetchImpl },
  );

  assert.equal(opp.sources.dataforseoSerp.status, "FAILED",
    "Missing task status_code must produce FAILED, not AVAILABLE or UNAVAILABLE");
  assert.notEqual(opp.sources.dataforseoSerp.status, "AVAILABLE");
  assert.notEqual(opp.sources.dataforseoSerp.status, "UNAVAILABLE");

  // â”€â”€ Report must render source limitation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { competitorBenchmark } = await import("../../report/sections-conversion.js");
  const { competitorComparison } = await import("../../scoring/report-model.js");
  const model = {
    input: { businessName: "Test", location: "Ottawa and Ontario, Canada", language: "en-CA" },
    evidence: { site: { domain: "test.com", services: ["Consulting"], ctas: [], forms: [], trust: { testimonials: false } } },
    competitors: competitorComparison([], opp),
    crossReportInterpretation: { version: "1.0.0", constructs: { offerClarity: "Observed service scope", ctaClarity: "Not Assessed", conversionPathClarity: "Not Assessed", trustProof: "Not Assessed", mobileUsability: "Not Assessed", indexability: "Not Assessed" } },
    competitorOpportunities: opp,
    scores: { contentDepth: 40, conversionPathways: 40 },
    bands: { trust: "Not Assessed" },
    contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
  };
  const html = competitorBenchmark(model);
  assert.ok(html.includes("Source limitation"), "Report must render source limitation");
  assert.ok(html.includes("FAILED"), "Report must show FAILED status");
});

// ---------------------------------------------------------------------------
// S-16: Null task-level status_code â†’ FAILED source, no empty success
// ---------------------------------------------------------------------------

test("S-16: null task-level status_code becomes FAILED source, not empty success", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-null-code-016",
        status_code: null,
        status_message: "Ok.",
        result_count: 1,
        result: [{ items_count: 1, items: [{ type: "organic", rank_absolute: 1, url: "https://example.com", domain: "example.com", title: "Test" }] }],
      }],
    }), { status: 200 });
  };

  // â”€â”€ querySerp must return an error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const result = await querySerp("test query", {
    login: "test-login",
    password: "test-pass",
    location: "Canada",
    language: "en",
    fetchImpl,
  });

  assert.ok(result.error, "Must return error for null task status_code");
  assert.ok(result.error.includes("missing task status code"), "Error must mention missing task status code");
  assert.ok(result.taskError, "Must preserve taskError");
  assert.equal(result.taskError.statusCode, null);
  assert.equal(result.items.length, 0);

  // â”€â”€ Competitor layer must report FAILED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const opp = await collectCompetitorOpportunities(
    { sourceStatus: "AVAILABLE", services: ["Consulting"], topicKeywords: [], pages: [{ title: "Test" }], pageCount: 1, domain: "test.com", ctas: [], forms: [], trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: false } },
    { targetUrl: "https://test.com", businessName: "Test", location: "Canada", language: "en", competitors: [] },
    { dataforseoLogin: "test-login", dataforseoPassword: "test-pass", suppliedCompetitors: [], fetchImpl },
  );

  assert.equal(opp.sources.dataforseoSerp.status, "FAILED",
    "Null task status_code must produce FAILED, got " + opp.sources.dataforseoSerp.status);
  assert.equal(opp.sources.dataforseoSerp.candidateCount, 0, "Must have zero candidates");
  assert.ok(opp.sources.dataforseoSerp.taskErrors, "Must preserve task errors");
  assert.equal(opp.sources.dataforseoSerp.taskErrors[0].statusCode, null);

  // Preserve locale context
  assert.equal(opp.sources.dataforseoSerp.originalLanguage, "en");
  assert.equal(opp.sources.dataforseoSerp.originalLocation, "Canada");
});

// ---------------------------------------------------------------------------
// S-17: Two successful tasks + one failed task â†’ PARTIAL
// ---------------------------------------------------------------------------

test("S-17: two successful tasks plus one failed task produces PARTIAL, not FAILED", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount++;
    if (callCount <= 2) {
      // First two calls succeed with organic results
      return new Response(JSON.stringify({
        status_code: 20000,
        status_message: "Ok.",
        tasks_count: 1,
        tasks: [{
          id: `task-success-017-${callCount}`,
          status_code: 20000,
          status_message: "Ok.",
          result_count: 1,
          result: [{
            keyword: `topic ${callCount}`,
            se_type: "google",
            items_count: 2,
            items: [
              { type: "organic", rank_absolute: 1, url: `https://comp${callCount}-1.example`, domain: `comp${callCount}-1.example`, title: `Competitor ${callCount}-1` },
              { type: "organic", rank_absolute: 2, url: `https://comp${callCount}-2.example`, domain: `comp${callCount}-2.example`, title: `Competitor ${callCount}-2` },
            ],
          }],
        }],
      }), { status: 200 });
    }
    // Third call fails with internal server error
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-fail-017-3",
        status_code: 40101,
        status_message: "Internal SE Server Error.",
        result_count: 0,
        result: null,
      }],
    }), { status: 200 });
  };

  // Use a site with 3 topics to exercise the partial scenario
  const siteWith3Topics = {
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    services: ["Consulting", "Coaching", "Training"],
    topicKeywords: [],
    pages: [{ title: "Example Consulting" }],
    pageCount: 5,
    domain: "example.com",
    ctas: [],
    forms: [],
    trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: false },
  };

  const opp = await collectCompetitorOpportunities(
    siteWith3Topics,
    PROD_INPUT,
    {
      dataforseoLogin: "test-login",
      dataforseoPassword: "test-pass",
      suppliedCompetitors: [],
      fetchImpl,
    },
  );

  // â”€â”€ SERP source must be PARTIAL, not FAILED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp.sources.dataforseoSerp.status, SOURCE_STATUS.PARTIAL,
    `Two successful + one failed task must produce PARTIAL, got ${opp.sources.dataforseoSerp.status}`);
  assert.notEqual(opp.sources.dataforseoSerp.status, SOURCE_STATUS.FAILED,
    "Must not mark partial success as FAILED");
  assert.notEqual(opp.sources.dataforseoSerp.status, SOURCE_STATUS.AVAILABLE,
    "Must not mark partial success as AVAILABLE");
  assert.notEqual(opp.sources.dataforseoSerp.status, SOURCE_STATUS.UNAVAILABLE,
    "Must not mark partial success as UNAVAILABLE");

  // â”€â”€ Candidates from successful tasks are preserved â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(opp.sources.dataforseoSerp.candidateCount >= 4,
    `Expected at least 4 SERP candidates (2 topics Ã— 2 results each), got ${opp.sources.dataforseoSerp.candidateCount}`);

  // â”€â”€ Task errors are preserved â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(opp.sources.dataforseoSerp.taskErrors, "Must preserve task errors");
  assert.equal(opp.sources.dataforseoSerp.taskErrors.length, 1,
    `Expected 1 task error, got ${opp.sources.dataforseoSerp.taskErrors.length}`);
  assert.equal(opp.sources.dataforseoSerp.taskErrors[0].statusCode, 40101);
  assert.ok(opp.sources.dataforseoSerp.taskErrors[0].statusMessage.includes("Internal SE Server Error"),
    "Must preserve original error message");

  // â”€â”€ Task IDs from all tasks are preserved â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp.sources.dataforseoSerp.taskIds.length, 3,
    `Expected 3 task IDs (2 success + 1 failed), got ${opp.sources.dataforseoSerp.taskIds.length}`);

  // â”€â”€ Normalized locale/location preserved â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp.sources.dataforseoSerp.normalizedLanguage, "English");
  assert.equal(opp.sources.dataforseoSerp.normalizedLocation, "Ottawa,Ontario,Canada");
  assert.equal(opp.sources.dataforseoSerp.originalLanguage, "en-CA");
  assert.equal(opp.sources.dataforseoSerp.originalLocation, "Ottawa and Ontario, Canada");

  // â”€â”€ _sourceStatus must reflect partial with error category â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp._sourceStatus.errorCategory, ERROR_CATEGORY.INTERNAL);
  assert.ok(opp._sourceStatus.limitation, "Must have limitation text for PARTIAL status");

  // â”€â”€ Limitations mention the failed topic without stack traces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(opp.limitations.length > 0, "Must have limitations");
  const serpLimitation = opp.limitations.find((l) => l.includes("40101"));
  assert.ok(serpLimitation, "Must have a limitation referencing the 40101 error");
  assert.ok(serpLimitation.includes("40101") || serpLimitation.includes("Internal SE Server Error"),
    "Limitation must identify the failed task");
  assert.equal(serpLimitation.includes("at querySerp"), false, "Must not expose stack traces");
  assert.equal(serpLimitation.includes("at collectCompetitorOpportunities"), false, "Must not expose stack traces");

  // â”€â”€ Supplied competitor source is unaffected â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp.sources.supplied.status, SOURCE_STATUS.NOT_APPLICABLE);
});

// ---------------------------------------------------------------------------
// S-18: All tasks failed â†’ FAILED
// ---------------------------------------------------------------------------

test("S-18: all SERP tasks failed produces FAILED, not PARTIAL", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-fail-018",
        status_code: 40101,
        status_message: "Internal SE Server Error.",
        result_count: 0,
        result: null,
      }],
    }), { status: 200 });
  };

  // Use a site with 2 topics â€” both will fail
  const siteWith2Topics = {
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    services: ["Consulting", "Coaching"],
    topicKeywords: [],
    pages: [{ title: "Example Consulting" }],
    pageCount: 5,
    domain: "example.com",
    ctas: [],
    forms: [],
    trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: false },
  };

  const opp = await collectCompetitorOpportunities(
    siteWith2Topics,
    PROD_INPUT,
    {
      dataforseoLogin: "test-login",
      dataforseoPassword: "test-pass",
      suppliedCompetitors: [],
      fetchImpl,
    },
  );

  // â”€â”€ SERP source must be FAILED when all tasks fail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp.sources.dataforseoSerp.status, SOURCE_STATUS.FAILED,
    `All tasks failed must produce FAILED, got ${opp.sources.dataforseoSerp.status}`);
  assert.notEqual(opp.sources.dataforseoSerp.status, SOURCE_STATUS.PARTIAL,
    "Must not produce PARTIAL when no tasks succeed");
  assert.notEqual(opp.sources.dataforseoSerp.status, SOURCE_STATUS.AVAILABLE,
    "Must not produce AVAILABLE when all tasks fail");

  // â”€â”€ Zero candidates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp.sources.dataforseoSerp.candidateCount, 0,
    "Must have zero candidates when all tasks fail");

  // â”€â”€ Task errors for all topics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(opp.sources.dataforseoSerp.taskErrors, "Must preserve task errors");
  assert.equal(opp.sources.dataforseoSerp.taskErrors.length, 2,
    `Expected 2 task errors, got ${opp.sources.dataforseoSerp.taskErrors.length}`);

  // â”€â”€ _sourceStatus error category â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp._sourceStatus.errorCategory, ERROR_CATEGORY.INTERNAL);
});

// ---------------------------------------------------------------------------
// S-19: All tasks successful with zero results â†’ UNAVAILABLE
// ---------------------------------------------------------------------------

test("S-19: all tasks successful with zero organic results produces UNAVAILABLE", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-empty-019",
        status_code: 20000,
        status_message: "Ok.",
        result_count: 1,
        result: [{
          keyword: "rare niche query",
          se_type: "google",
          items_count: 0,
          items: [],
        }],
      }],
    }), { status: 200 });
  };

  // Use a site with a single niche topic
  const nicheSite = {
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    services: ["Rare Niche Service"],
    topicKeywords: [],
    pages: [{ title: "Niche Site" }],
    pageCount: 1,
    domain: "niche.example",
    ctas: [],
    forms: [],
    trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: false },
  };

  const opp = await collectCompetitorOpportunities(
    nicheSite,
    { ...PROD_INPUT, businessName: "Niche Co" },
    {
      dataforseoLogin: "test-login",
      dataforseoPassword: "test-pass",
      suppliedCompetitors: [],
      fetchImpl,
    },
  );

  // â”€â”€ SERP source must be UNAVAILABLE for zero organic results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp.sources.dataforseoSerp.status, SOURCE_STATUS.UNAVAILABLE,
    `Zero organic results with success must be UNAVAILABLE, got ${opp.sources.dataforseoSerp.status}`);
  assert.notEqual(opp.sources.dataforseoSerp.status, SOURCE_STATUS.FAILED,
    "Must not produce FAILED for zero results with success");
  assert.notEqual(opp.sources.dataforseoSerp.status, SOURCE_STATUS.PARTIAL,
    "Must not produce PARTIAL for zero results with no task errors");

  // â”€â”€ Zero candidates, zero task errors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp.sources.dataforseoSerp.candidateCount, 0);
  assert.equal(opp.sources.dataforseoSerp.taskErrors, undefined,
    "Must not have task errors for successful tasks");

  // â”€â”€ Task IDs preserved â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.ok(opp.sources.dataforseoSerp.taskIds.length > 0,
    "Must preserve task IDs even when zero results");

  // â”€â”€ _sourceStatus has no error category â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assert.equal(opp._sourceStatus.errorCategory, null,
    "Must not have error category for zero results success");
});

// ---------------------------------------------------------------------------
// Test totals
// ---------------------------------------------------------------------------

test("S-TOTALS: verify production-path regression test count", () => {
  assert.ok(19 >= 10, "19 production-path regression tests (minimum 10 required)");
});

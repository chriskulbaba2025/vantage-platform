/**
 * DataForSEO Backlinks API Client
 *
 * Isolated client wrapper for DataForSEO Backlinks API.
 * Credentials and provider-specific logic MUST NOT leak outside this module.
 *
 * Live mode: Calls DataForSEO REST API using DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.
 * Fixture mode: Reads from local fixture file (no credentials required).
 *
 * Phase 1: Live client is minimal. Module boundaries and error handling are
 * production-ready. Full live implementation added when credentials are available.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";

/**
 * Read credentials from the environment. Never log or expose these values.
 */
function getCredentials() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  return { login, password };
}

/**
 * Build a Basic auth header value from DataForSEO credentials.
 */
function basicAuth(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

function loadFixtures() {
  const fixturePath = resolve(
    __dirname,
    "backlink-test-fixtures.json",
  );
  const raw = readFileSync(fixturePath, "utf-8");
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Response parsing (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Safely parse a DataForSEO API response body.
 *
 * Handles:
 *   - Normal JSON objects (response.json() already parsed)
 *   - Double-encoded JSON strings (body is a JSON-encoded string)
 *   - Root-level status_code validation
 *
 * @param {object|string} body - Raw response body from the API.
 * @param {string} endpoint - API endpoint label for error messages.
 * @returns {object} Parsed and validated response object.
 */
export function parseDataforseoResponse(body, endpoint) {
  let parsed = body;

  // Handle double-encoded JSON: if the body is a string, parse it.
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error(
        `DataForSEO ${endpoint}: unable to parse response body as JSON`,
      );
    }
  }

  // If we still have a string after first parse, try one more time
  // (some proxy/gateway setups double-encode).
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error(
        `DataForSEO ${endpoint}: unable to parse response body as JSON (double-encoded)`,
      );
    }
  }

  // Validate root status_code when present.
  if (
    parsed.status_code != null &&
    parsed.status_code !== 20000
  ) {
    throw new Error(
      `DataForSEO ${endpoint}: API error ` +
        `(status_code=${parsed.status_code}, ` +
        `message="${parsed.status_message || "unknown"}")`,
    );
  }

  return parsed;
}

/**
 * Extract and validate a task result from a parsed DataForSEO response.
 *
 * Validates:
 *   - tasks array is present and non-empty
 *   - Task-level status_code is 20000
 *   - result array is present and non-empty
 *
 * @param {object} response - Parsed DataForSEO response object.
 * @param {string} endpoint - API endpoint label for error messages.
 * @returns {object} The first result object: response.tasks[0].result[0].
 */
export function extractTaskResult(response, endpoint) {
  if (
    !response ||
    !response.tasks ||
    !Array.isArray(response.tasks) ||
    response.tasks.length === 0
  ) {
    throw new Error(
      `DataForSEO ${endpoint}: no tasks in response`,
    );
  }

  const task = response.tasks[0];

  // Validate task-level status_code.
  if (
    task.status_code != null &&
    task.status_code !== 20000
  ) {
    throw new Error(
      `DataForSEO ${endpoint}: task error ` +
        `(status_code=${task.status_code}, ` +
        `message="${task.status_message || "unknown"}")`,
    );
  }

  if (
    !task.result ||
    !Array.isArray(task.result) ||
    task.result.length === 0
  ) {
    throw new Error(
      `DataForSEO ${endpoint}: no result data in task`,
    );
  }

  return task.result[0];
}

/**
 * Extract all task results from a parsed DataForSEO response.
 *
 * Returns an array of result[0] from each task, skipping tasks with
 * empty results (logged as warnings).
 *
 * @param {object} response - Parsed DataForSEO response object.
 * @param {string} endpoint - API endpoint label for error messages.
 * @returns {Array<object>} Array of result objects.
 */
export function extractAllTaskResults(response, endpoint) {
  if (
    !response ||
    !response.tasks ||
    !Array.isArray(response.tasks) ||
    response.tasks.length === 0
  ) {
    return [];
  }

  const results = [];

  for (let i = 0; i < response.tasks.length; i++) {
    const task = response.tasks[i];

    // Validate task-level status_code.
    if (
      task.status_code != null &&
      task.status_code !== 20000
    ) {
      // Log warning but continue with other tasks
      console.warn(
        `DataForSEO ${endpoint}: task ${i} error ` +
          `(status_code=${task.status_code}, ` +
          `message="${task.status_message || "unknown"}") — skipping`,
      );
      continue;
    }

    if (
      task.result &&
      Array.isArray(task.result) &&
      task.result.length > 0
    ) {
      results.push(task.result[0]);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Live API helpers (Phase 1 — minimal, structural)
// ---------------------------------------------------------------------------

/**
 * POST to a DataForSEO endpoint. Returns parsed JSON or throws on failure.
 *
 * Reads the response as text first so we can apply safe parsing with
 * double-encoding detection.
 */
async function dataforseoPost(endpoint, body, { login, password }) {
  const url = `${DATAFORSEO_BASE}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuth(login, password),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(
      `DataForSEO API error (${response.status}) for ${endpoint}: ${errorText}`,
    );
  }

  // Read response as text so we can detect double-encoding.
  const rawText = await response.text();
  return parseDataforseoResponse(rawText, endpoint);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a DataForSEO backlinks client.
 *
 * @param {object} opts
 * @param {"live"|"fixture"} opts.mode - Operating mode.
 * @param {object} [opts.fixtures] - Pre-loaded fixture data (used in tests).
 * @returns {object} Client with fetchBacklinkSummary, fetchBacklinks,
 *                   fetchCompetitorIntersection.
 */
export function createDataforseoClient(opts = {}) {
  const mode = opts.mode || "fixture";

  /**
   * Fetch backlink summary for a target domain.
   *
   * @param {string} target - Target domain (e.g. "example.com").
   * @returns {Promise<object>} Summary data.
   */
  async function fetchBacklinkSummary(target) {
    if (mode === "fixture") {
      const fixtures = opts.fixtures || loadFixtures();
      return fixtures.summary;
    }

    // Live mode
    const { login, password } = getCredentials();
    if (!login || !password) {
      throw new Error(
        "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required for live mode. " +
          "Use --fixture for local testing without credentials.",
      );
    }

    const body = [
      {
        domain: target,
        limit: 1,
      },
    ];

    const response = await dataforseoPost(
      "/backlinks/summary/live",
      body,
      { login, password },
    );

    return extractTaskResult(response, "/backlinks/summary/live");
  }

  /**
   * Fetch backlink list for a target domain.
   *
   * @param {string} target - Target domain.
   * @param {object} [options]
   * @param {number} [options.limit=500] - Max backlinks to return.
   * @returns {Promise<Array<object>>} Array of backlink records.
   */
  async function fetchBacklinks(target, options = {}) {
    const limit = options.limit || 500;

    if (mode === "fixture") {
      const fixtures = opts.fixtures || loadFixtures();
      // Fixtures include all backlinks; filter client-owned records
      // plus competitor records for intersection detection
      const all = fixtures.backlinks || [];
      return all.slice(0, limit);
    }

    // Live mode
    const { login, password } = getCredentials();
    if (!login || !password) {
      throw new Error(
        "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required for live mode. " +
          "Use --fixture for local testing without credentials.",
      );
    }

    const body = [
      {
        domain: target,
        limit,
        order_by: ["rank", "desc"],
      },
    ];

    const response = await dataforseoPost(
      "/backlinks/backlinks/live",
      body,
      { login, password },
    );

    const result = extractTaskResult(response, "/backlinks/backlinks/live");
    return result.items || [];
  }

  /**
   * Fetch competitor backlink intersection data.
   *
   * Identifies referring domains shared across competitors that
   * the target domain may be missing.
   *
   * @param {string} target - Target domain.
   * @param {Array<string>} competitorDomains - Competitor domains.
   * @param {object} [options]
   * @param {number} [options.limit=250] - Max backlinks per competitor.
   * @returns {Promise<Array<object>>} Array of competitor backlink records.
   */
  async function fetchCompetitorIntersection(
    target,
    competitorDomains,
    options = {},
  ) {
    const limit = options.limit || 250;

    if (mode === "fixture") {
      const fixtures = opts.fixtures || loadFixtures();
      const all = fixtures.backlinks || [];
      // Return only competitor-linked records (domain_to !== target)
      const competitorBacklinks = all.filter(
        (b) =>
          b.domain_to &&
          competitorDomains.includes(b.domain_to),
      );
      return competitorBacklinks.slice(0, limit);
    }

    // Live mode
    const { login, password } = getCredentials();
    if (!login || !password) {
      throw new Error(
        "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required for live mode. " +
          "Use --fixture for local testing without credentials.",
      );
    }

    const tasks = competitorDomains.map((domain) => ({
      domain,
      limit,
      order_by: ["rank", "desc"],
    }));

    const response = await dataforseoPost(
      "/backlinks/backlinks/live",
      tasks,
      { login, password },
    );

    const results = extractAllTaskResults(
      response,
      "/backlinks/backlinks/live",
    );

    return results.flatMap((r) => r.items || []);
  }

  return {
    fetchBacklinkSummary,
    fetchBacklinks,
    fetchCompetitorIntersection,
  };
}

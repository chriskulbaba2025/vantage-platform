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
// Live API helpers (Phase 1 — minimal, structural)
// ---------------------------------------------------------------------------

/**
 * POST to a DataForSEO endpoint. Returns parsed JSON or throws on failure.
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

  return response.json();
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

    // Live mode — Phase 1 structural placeholder
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

    const result = await dataforseoPost(
      "/backlinks/summary/live",
      body,
      { login, password },
    );

    // DataForSEO wraps results in tasks array
    if (
      !result ||
      !result.tasks ||
      !result.tasks[0] ||
      !result.tasks[0].result ||
      !result.tasks[0].result[0]
    ) {
      throw new Error(`No summary data returned for ${target}`);
    }

    return result.tasks[0].result[0];
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

    // Live mode — Phase 1 structural placeholder
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

    const result = await dataforseoPost(
      "/backlinks/backlinks/live",
      body,
      { login, password },
    );

    if (
      !result ||
      !result.tasks ||
      !result.tasks[0] ||
      !result.tasks[0].result ||
      !result.tasks[0].result[0]
    ) {
      return [];
    }

    return result.tasks[0].result[0].items || [];
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

    // Live mode — Phase 1 structural placeholder
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

    const result = await dataforseoPost(
      "/backlinks/backlinks/live",
      tasks,
      { login, password },
    );

    if (
      !result ||
      !result.tasks
    ) {
      return [];
    }

    return result.tasks.flatMap(
      (t) => t?.result?.[0]?.items || [],
    );
  }

  return {
    fetchBacklinkSummary,
    fetchBacklinks,
    fetchCompetitorIntersection,
  };
}

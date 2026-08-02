/**
 * DataForSEO SERP API Client
 *
 * Queries the DataForSEO SERP API for localized organic search results.
 * Used by the competitor opportunity layer to discover SERP-based competitors
 * for specific topics in the audit's geographic market.
 *
 * Credentials: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD (same as other adapters).
 * Never log or expose credentials.
 *
 * API: POST /v3/serp/google/organic/live/advanced
 */

import { withTimeout } from "../../utils.js";
import { normalizeLanguage } from "./locale-normalizer.js";
import { resolveLocation } from "./location-resolver.js";

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";
const SERP_ENDPOINT = `${DATAFORSEO_BASE}/serp/google/organic/live/advanced`;

// ---------------------------------------------------------------------------
// DataForSEO API status codes
// ---------------------------------------------------------------------------

/**
 * Top-level API status codes that indicate a successful request.
 * DataForSEO returns 20000 for success.
 */
const API_SUCCESS_CODE = 20000;

/**
 * Task-level status codes.
 *
 * Per DataForSEO docs, a completed SERP task returns a result array.
 * The documented success code for a completed task is 20000.
 * Any other status_code indicates the task did not complete successfully.
 */
const TASK_SUCCESS_CODES = Object.freeze(new Set([20000]));

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function basicAuth(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Task builder
// ---------------------------------------------------------------------------

/**
 * Build a SERP query task for DataForSEO.
 *
 * Uses normalized language_name and location_name values that have
 * been pre-validated by the locale normalizer and location resolver.
 * Never sends raw BCP-47 locale strings or free-text location strings.
 *
 * @param {string} keyword         Search query (topic + geographic term)
 * @param {object} normalized
 * @param {string} normalized.languageName   DataForSEO-supported language name
 * @param {string} normalized.locationName   DataForSEO hierarchical location_name
 * @param {number|null} normalized.locationCode  DataForSEO location_code (country-level)
 * @returns {object} task payload
 */
function buildSerpTask(keyword, normalized) {
  const task = {
    keyword,
    language_name: normalized.languageName || "English",
    device: "desktop",
    os: "windows",
    depth: 20, // top 20 organic results
  };

  // Prefer location_code when available (more stable); fall back to location_name
  if (normalized.locationCode != null) {
    task.location_code = normalized.locationCode;
  } else if (normalized.locationName) {
    task.location_name = normalized.locationName;
  } else {
    // Last-resort fallback — should never happen in production because
    // the competitor-opportunity layer validates resolution before calling.
    task.location_name = "Canada";
  }

  return task;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a DataForSEO SERP result item into a competitor candidate.
 *
 * Extracts: url, domain, title, position, page type signals.
 */
function normalizeSerpItem(item, topic, location, language) {
  return {
    candidateUrl: item.url || "",
    domain: item.domain || "",
    title: item.title || "",
    position: item.rank_absolute || item.rank_group || null,
    topic,
    discoverySource: "dataforseo-serp",
    geographicContext: location || "Canada",
    languageContext: language || "English",
    pageType: inferPageType(item),
    rawArtifactRef: `dataforseo://serp/${item.rank_absolute || "unknown"}`,
    serpFeatures: item.featured_snippet ? ["featured_snippet"] : [],
    hasSchema: detectSchema(item),
  };
}

/**
 * Infer page type from SERP item signals.
 */
function inferPageType(item) {
  const url = (item.url || "").toLowerCase();
  const title = (item.title || "").toLowerCase();

  if (/contact|about-us|team|location|hours/i.test(url)) return "company_page";
  if (/blog|article|news|guide|how-to|what-is/i.test(url)) return "content";
  if (/pricing|plans|cost|quote|estimate/i.test(url)) return "pricing";
  if (/product|shop|store|buy/i.test(url)) return "product";
  if (/service|solutions|capabilities/i.test(url)) return "service";
  if (/faq|questions|help/i.test(url)) return "support";
  if (/directory\.|yellowpages|yelp\.|hotfrog|118|tripadvisor|facebook\.com\/pg|linkedin\.com\/company/i.test(url)) return "directory";
  if (/facebook\.com|instagram\.com|twitter\.com|linkedin\.com\/in|youtube\.com\/@/i.test(url)) return "social";
  if (/amazon\.|ebay\.|etsy\.|shopify\.|alibaba\./i.test(url)) return "marketplace";
  if (/wikipedia\.org|britannica\.|news\.|cnn\.|bbc\.|reuters\./i.test(url)) return "reference";
  if (/reddit\.com|quora\.com|medium\.com|forum\./i.test(url)) return "community";

  return "landing";
}

/** Detect schema hints from SERP metadata. */
function detectSchema(item) {
  if (!item) return [];
  const signals = [];
  if (item.rich_snippet?.type) signals.push("rich_snippet");
  if (item.featured_snippet) signals.push("featured_snippet");
  if (item.sitelinks?.length) signals.push("sitelinks");
  if (item.reviews?.length) signals.push("reviews");
  if (item.rating) signals.push("rating");
  return signals;
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

/**
 * Validate a DataForSEO API response.
 *
 * Checks:
 *   1. Top-level status_code === 20000
 *   2. Every task has status_code in TASK_SUCCESS_CODES
 *
 * Returns { valid, error } where error describes the first failure found.
 * A valid response may still have zero results (no organic listings for
 * that query) — that is NOT an error.
 *
 * @param {object} data  Parsed JSON response body
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateApiResponse(data) {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "SERP API returned non-object response" };
  }

  // Top-level status
  if (data.status_code !== undefined && data.status_code !== API_SUCCESS_CODE) {
    return {
      valid: false,
      error: `SERP API top-level status ${data.status_code}: ${data.status_message || "unknown error"}`,
    };
  }

  const tasks = data.tasks || [];
  if (tasks.length === 0) {
    return { valid: false, error: "SERP API returned no tasks" };
  }

  // Task-level status — every task must be successful
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const taskCode = task.status_code;
    if (taskCode !== undefined && !TASK_SUCCESS_CODES.has(taskCode)) {
      const taskMsg = task.status_message || "unknown task error";
      return {
        valid: false,
        error: `SERP task ${i} failed: status_code=${taskCode}, message="${taskMsg}"`,
        taskError: {
          taskId: task.id || null,
          statusCode: taskCode,
          statusMessage: taskMsg,
          endpoint: SERP_ENDPOINT,
        },
      };
    }
  }

  return { valid: true, error: null };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Query DataForSEO SERP API for organic results.
 *
 * Accepts raw audit language/location values and normalizes them before
 * sending to DataForSEO.  Never sends BCP-47 locale strings or free-text
 * location strings directly.
 *
 * Validates both top-level API status and every task-level status_code.
 * A failed task produces a structured error — it is never silently
 * returned as an empty successful result set.
 *
 * @param {string}   keyword   Search query
 * @param {object}   options
 * @param {string}   options.login       DataForSEO login
 * @param {string}   options.password    DataForSEO password
 * @param {string}   [options.location]  Free-text geographic market (raw audit input)
 * @param {string}   [options.language]  Audit language (BCP-47 or plain name)
 * @param {object}   [options.fetchImpl] Fetch implementation
 * @returns {object} { items, rawTaskId, error, normalizedLanguage, normalizedLocation, taskError }
 */
export async function querySerp(keyword, options = {}) {
  const login = options.login || "";
  const password = options.password || "";
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  // ── Normalize language ──────────────────────────────────────────────
  const langResult = normalizeLanguage(options.language || "en");
  const locResult = resolveLocation(options.location || "Canada");

  if (!login || !password) {
    return {
      items: [],
      rawTaskId: null,
      error: "DataForSEO credentials not configured",
      normalizedLanguage: langResult,
      normalizedLocation: locResult,
    };
  }

  // ── Validate location resolution ────────────────────────────────────
  if (locResult.error) {
    return {
      items: [],
      rawTaskId: null,
      error: `Location resolution failed: ${locResult.error}`,
      normalizedLanguage: langResult,
      normalizedLocation: locResult,
    };
  }

  const task = buildSerpTask(keyword, {
    languageName: langResult.languageName,
    locationName: locResult.locationName,
    locationCode: locResult.locationCode,
  });

  const body = [{ ...task }];

  try {
    const response = await withTimeout(
      fetchImpl(SERP_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: basicAuth(login, password),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      45000,
      `DataForSEO SERP: ${keyword}`,
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        items: [],
        rawTaskId: null,
        error: `SERP API ${response.status}: ${text.slice(0, 200)}`,
        normalizedLanguage: langResult,
        normalizedLocation: locResult,
      };
    }

    const data = await response.json();

    // ── Validate response ─────────────────────────────────────────────
    const validation = validateApiResponse(data);
    if (!validation.valid) {
      return {
        items: [],
        rawTaskId: validation.taskError?.taskId || null,
        error: validation.error,
        taskError: validation.taskError || null,
        normalizedLanguage: langResult,
        normalizedLocation: locResult,
      };
    }

    const serpTask = data.tasks[0];
    const rawTaskId = serpTask.id || null;
    const resultItems = serpTask.result?.[0]?.items || [];

    const items = resultItems
      .filter((item) => item.type === "organic")
      .map((item) => normalizeSerpItem(item, keyword, locResult.originalLocation || locResult.locationName, langResult.originalLanguage || langResult.languageName));

    return {
      items,
      rawTaskId,
      error: null,
      normalizedLanguage: langResult,
      normalizedLocation: locResult,
    };
  } catch (error) {
    return {
      items: [],
      rawTaskId: null,
      error: error.message,
      normalizedLanguage: langResult,
      normalizedLocation: locResult,
    };
  }
}

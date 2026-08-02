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

const API_SUCCESS_CODE = 20000;
const TASK_SUCCESS_CODES = Object.freeze(new Set([20000]));

const SERP_ERROR_TYPE = Object.freeze({
  CONFIGURATION: "CONFIGURATION",
  LOCATION: "LOCATION",
  HTTP: "HTTP",
  API_RESPONSE: "API_RESPONSE",
  TASK: "TASK",
  TIMEOUT: "TIMEOUT",
  TRANSPORT_OR_PARSE: "TRANSPORT_OR_PARSE",
});

function basicAuth(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

function buildSerpTask(keyword, normalized) {
  const task = {
    keyword,
    language_name: normalized.languageName || "English",
    device: "desktop",
    os: "windows",
    depth: 20,
  };

  if (normalized.locationCode != null) {
    task.location_code = normalized.locationCode;
  } else if (normalized.locationName) {
    task.location_name = normalized.locationName;
  } else {
    task.location_name = "Canada";
  }

  return task;
}

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

function inferPageType(item) {
  const url = (item.url || "").toLowerCase();

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

function validateApiResponse(data) {
  if (!data || typeof data !== "object") {
    return {
      valid: false,
      error: "SERP API returned non-object response",
      errorType: SERP_ERROR_TYPE.API_RESPONSE,
      statusCode: null,
    };
  }

  if (data.status_code !== API_SUCCESS_CODE) {
    const code = data.status_code;
    const msg = data.status_message || "missing top-level status code";
    return {
      valid: false,
      error: `SERP API top-level status ${code != null ? code : "missing"}: ${msg}`,
      errorType: SERP_ERROR_TYPE.API_RESPONSE,
      statusCode: code ?? null,
    };
  }

  const tasks = data.tasks || [];
  if (tasks.length === 0) {
    return {
      valid: false,
      error: "SERP API returned no tasks",
      errorType: SERP_ERROR_TYPE.API_RESPONSE,
      statusCode: null,
    };
  }

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const taskCode = task.status_code;
    if (taskCode == null) {
      const fallbackMsg = "missing task status code";
      return {
        valid: false,
        error: `SERP task ${i} failed: ${fallbackMsg}`,
        errorType: SERP_ERROR_TYPE.TASK,
        statusCode: null,
        taskError: {
          taskId: task.id || null,
          statusCode: null,
          statusMessage: fallbackMsg,
          endpoint: SERP_ENDPOINT,
        },
      };
    }
    if (!TASK_SUCCESS_CODES.has(taskCode)) {
      const taskMsg = task.status_message || "unknown task error";
      return {
        valid: false,
        error: `SERP task ${i} failed: status_code=${taskCode}, message="${taskMsg}"`,
        errorType: SERP_ERROR_TYPE.TASK,
        statusCode: taskCode,
        taskError: {
          taskId: task.id || null,
          statusCode: taskCode,
          statusMessage: taskMsg,
          endpoint: SERP_ENDPOINT,
        },
      };
    }
  }

  return {
    valid: true,
    error: null,
    errorType: null,
    statusCode: null,
  };
}

function classifyException(error) {
  const message = String(error?.message || error || "Unknown SERP request error");
  const isTimeout = error?.name === "AbortError" || /timed?\s*out|timeout/i.test(message);
  return {
    error: message,
    errorType: isTimeout ? SERP_ERROR_TYPE.TIMEOUT : SERP_ERROR_TYPE.TRANSPORT_OR_PARSE,
  };
}

export async function querySerp(keyword, options = {}) {
  const login = options.login || "";
  const password = options.password || "";
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  const langResult = normalizeLanguage(options.language || "en");
  const locResult = resolveLocation(options.location || "Canada");

  if (!login || !password) {
    return {
      items: [],
      rawTaskId: null,
      error: "DataForSEO credentials not configured",
      errorType: SERP_ERROR_TYPE.CONFIGURATION,
      errorStatusCode: null,
      normalizedLanguage: langResult,
      normalizedLocation: locResult,
    };
  }

  if (locResult.error) {
    return {
      items: [],
      rawTaskId: null,
      error: `Location resolution failed: ${locResult.error}`,
      errorType: SERP_ERROR_TYPE.LOCATION,
      errorStatusCode: null,
      normalizedLanguage: langResult,
      normalizedLocation: locResult,
    };
  }

  const task = buildSerpTask(keyword, {
    languageName: langResult.languageName,
    locationName: locResult.locationName,
    locationCode: locResult.locationCode,
  });

  try {
    const response = await withTimeout(
      fetchImpl(SERP_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: basicAuth(login, password),
          "content-type": "application/json",
        },
        body: JSON.stringify([task]),
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
        errorType: SERP_ERROR_TYPE.HTTP,
        errorStatusCode: response.status,
        normalizedLanguage: langResult,
        normalizedLocation: locResult,
      };
    }

    const data = await response.json();
    const validation = validateApiResponse(data);
    if (!validation.valid) {
      return {
        items: [],
        rawTaskId: validation.taskError?.taskId || null,
        error: validation.error,
        errorType: validation.errorType,
        errorStatusCode: validation.statusCode,
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
      .map((item) => normalizeSerpItem(
        item,
        keyword,
        locResult.originalLocation || locResult.locationName,
        langResult.originalLanguage || langResult.languageName,
      ));

    return {
      items,
      rawTaskId,
      error: null,
      errorType: null,
      errorStatusCode: null,
      normalizedLanguage: langResult,
      normalizedLocation: locResult,
    };
  } catch (error) {
    const classified = classifyException(error);
    return {
      items: [],
      rawTaskId: null,
      error: classified.error,
      errorType: classified.errorType,
      errorStatusCode: null,
      normalizedLanguage: langResult,
      normalizedLocation: locResult,
    };
  }
}

export { SERP_ERROR_TYPE, validateApiResponse, classifyException };

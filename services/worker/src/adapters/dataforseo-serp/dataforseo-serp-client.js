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

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";
const SERP_ENDPOINT = `${DATAFORSEO_BASE}/serp/google/organic/live/advanced`;

function basicAuth(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

/**
 * Build a SERP query task for DataForSEO.
 *
 * @param {string} keyword   Search query (topic + geographic term)
 * @param {string} location  Geographic location name (e.g. "London,Ontario,Canada")
 * @param {string} language  Language code (e.g. "en")
 * @returns {object} task payload
 */
function buildSerpTask(keyword, location, language) {
  return {
    keyword,
    location_name: location || "Canada",
    language_name: language || "English",
    device: "desktop",
    os: "windows",
    depth: 20, // top 20 organic results
  };
}

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

/**
 * Query DataForSEO SERP API for organic results.
 *
 * @param {string}   keyword   Search query
 * @param {object}   options
 * @param {string}   options.login       DataForSEO login
 * @param {string}   options.password    DataForSEO password
 * @param {string}   [options.location]  Geographic location
 * @param {string}   [options.language]  Language name
 * @param {object}   [options.fetchImpl] Fetch implementation
 * @returns {object} { items, rawTaskId, error? }
 */
export async function querySerp(keyword, options = {}) {
  const login = options.login || "";
  const password = options.password || "";
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const location = options.location || "Canada";
  const language = options.language || "English";

  if (!login || !password) {
    return { items: [], rawTaskId: null, error: "DataForSEO credentials not configured" };
  }

  const task = buildSerpTask(keyword, location, language);
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
      return { items: [], rawTaskId: null, error: `SERP API ${response.status}: ${text.slice(0, 200)}` };
    }

    const data = await response.json();
    const tasks = data.tasks || [];
    if (tasks.length === 0) {
      return { items: [], rawTaskId: null, error: "SERP API returned no tasks" };
    }

    const serpTask = tasks[0];
    const rawTaskId = serpTask.id || null;
    const resultItems = serpTask.result?.[0]?.items || [];

    const items = resultItems
      .filter((item) => item.type === "organic")
      .map((item) => normalizeSerpItem(item, keyword, location, language));

    return { items, rawTaskId, error: null };
  } catch (error) {
    return { items: [], rawTaskId: null, error: error.message };
  }
}

/**
 * Optional DataForSEO enrichment calls used by the governed SERP source.
 * These calls reuse the existing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD
 * credentials and never run at import/bootstrap time.
 */

import { withTimeout, domainOf } from "../../utils.js";
import { normalizeLanguage } from "./locale-normalizer.js";
import { resolveLocation } from "./location-resolver.js";

const BASE = "https://api.dataforseo.com/v3";

function authHeader(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

async function post(path, task, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const response = await withTimeout(fetchImpl(`${BASE}${path}`, {
    method: "POST",
    headers: {
      authorization: authHeader(options.login || "", options.password || ""),
      "content-type": "application/json",
    },
    body: JSON.stringify([task]),
    signal: options.signal || undefined,
  }), options.timeoutMs || 120000, `DataForSEO ${path}`);

  const text = await response.text();
  if (!response.ok) throw new Error(`DataForSEO ${path} failed (${response.status}): ${text.slice(0, 300)}`);

  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`DataForSEO ${path} returned invalid JSON`); }

  if (body?.status_code !== 20000) {
    throw new Error(`DataForSEO ${path}: ${body?.status_message || body?.status_code || "unknown error"}`);
  }

  const taskResult = body?.tasks?.[0];
  if (!taskResult || taskResult.status_code !== 20000) {
    throw new Error(`DataForSEO ${path}: ${taskResult?.status_message || taskResult?.status_code || "task failed"}`);
  }

  return {
    id: taskResult.id || null,
    cost: taskResult.cost ?? null,
    result: taskResult.result || [],
  };
}

function countryFromMarket(market) {
  const value = String(market || "").trim();
  if (!value) return "Canada";
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || value;
  const lower = last.toLowerCase();
  if (["canada"].includes(lower)) return "Canada";
  if (["united states", "united states of america", "usa", "us"].includes(lower)) return "United States";
  if (["united kingdom", "uk", "england"].includes(lower)) return "United Kingdom";
  return last;
}

function locationTaskFields(market, language) {
  const resolved = resolveLocation(market || "Canada");
  const lang = normalizeLanguage(language || "en");
  const out = {
    language_name: lang.languageName || "English",
  };
  if (resolved.locationCode != null) out.location_code = resolved.locationCode;
  else if (resolved.locationName) out.location_name = resolved.locationName;
  else out.location_name = "Canada";
  return out;
}

function cleanBusinessItem(item, targetDomain) {
  if (!item) return null;
  const cleaned = {
    title: item.title || item.original_title || null,
    description: item.description || null,
    category: item.category || null,
    additionalCategories: item.additional_categories || [],
    cid: item.cid || null,
    placeId: item.place_id || null,
    address: item.address || null,
    phone: item.phone || null,
    url: item.url || item.domain || null,
    rating: item.rating?.value ?? item.rating ?? null,
    reviewsCount: item.rating?.votes_count ?? item.reviews_count ?? null,
    workHours: item.work_hours || null,
    latitude: item.latitude ?? item.gps_coordinates?.latitude ?? null,
    longitude: item.longitude ?? item.gps_coordinates?.longitude ?? null,
    isClaimed: item.is_claimed ?? null,
  };
  let observedDomain = "";
  try {
    observedDomain = cleaned.url ? domainOf(cleaned.url) : "";
  } catch {
    observedDomain = "";
  }
  return {
    ...cleaned,
    targetDomain: targetDomain || null,
    observedDomain: observedDomain || null,
    identityStatus: observedDomain && targetDomain && observedDomain === targetDomain
      ? "MATCHED"
      : "UNRESOLVED",
  };
}

export async function collectDataForSeoEnrichment({
  targetUrl,
  businessName,
  market,
  language,
  keywords = [],
  login,
  password,
  fetchImpl,
  signal,
}) {
  const target = domainOf(targetUrl);
  const localKeyword = keywords[0] || businessName || target;
  const requestOptions = { login, password, fetchImpl, signal };
  const limitations = [];

  const result = {
    businessProfile: null,
    unmatchedBusinessProfile: null,
    localMaps: [],
    labs: {
      domainRank: null,
      competitors: [],
    },
    limitations,
  };

  try {
    const profile = await post("/business_data/google/my_business_info/live", {
      keyword: businessName || target,
      ...locationTaskFields(market, language),
    }, requestOptions);
    const items = profile.result?.[0]?.items || [];
    const candidate = cleanBusinessItem(items[0], target);
    if (candidate?.identityStatus === "MATCHED") {
      result.businessProfile = candidate;
    } else if (candidate) {
      result.unmatchedBusinessProfile = candidate;
      limitations.push(
        `Business profile identity was not matched to audited domain ${target}; profile facts were withheld from target-site evidence.`,
      );
    }
  } catch (error) {
    limitations.push(`Business profile: ${error.message}`);
  }

  try {
    const maps = await post("/serp/google/maps/live/advanced", {
      keyword: localKeyword,
      ...locationTaskFields(market, language),
      device: "desktop",
      os: "windows",
      depth: 20,
    }, requestOptions);
    const items = maps.result?.[0]?.items || [];
    result.localMaps = items.slice(0, 20).map((item) => ({
      title: item.title || null,
      domain: item.domain || null,
      url: item.url || null,
      rank: item.rank_absolute ?? item.rank_group ?? null,
      rating: item.rating?.value ?? item.rating ?? null,
      reviewsCount: item.rating?.votes_count ?? item.reviews_count ?? null,
      address: item.address || null,
      category: item.category || null,
      cid: item.cid || null,
      placeId: item.place_id || null,
    }));
  } catch (error) {
    limitations.push(`Local Maps: ${error.message}`);
  }

  const labsLocation = countryFromMarket(market);
  const labsLanguage = normalizeLanguage(language || "en").languageName || "English";

  try {
    const rank = await post("/dataforseo_labs/google/domain_rank_overview/live", {
      target,
      location_name: labsLocation,
      language_name: labsLanguage,
      limit: 10,
    }, requestOptions);
    const first = rank.result?.[0] || null;
    result.labs.domainRank = first ? {
      target: first.target || target,
      metrics: first.metrics || null,
      locationCode: first.location_code ?? null,
      languageCode: first.language_code ?? null,
    } : null;
  } catch (error) {
    limitations.push(`Labs domain rank: ${error.message}`);
  }

  try {
    const competitors = await post("/dataforseo_labs/google/competitors_domain/live", {
      target,
      location_name: labsLocation,
      language_name: labsLanguage,
      item_types: ["organic", "local_pack"],
      exclude_top_domains: true,
      limit: 20,
    }, requestOptions);
    const items = competitors.result?.[0]?.items || [];
    result.labs.competitors = items.slice(0, 20).map((item) => ({
      domain: item.domain || item.target || null,
      avgPosition: item.avg_position ?? null,
      intersections: item.intersections ?? null,
      metrics: item.metrics || null,
    }));
  } catch (error) {
    limitations.push(`Labs competitors: ${error.message}`);
  }

  return result;
}

export default { collectDataForSeoEnrichment };

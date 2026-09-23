import { createHash } from "node:crypto";

export const URL_DISCOVERY_PROVENANCE = Object.freeze({
  DATAFORSEO: "DATAFORSEO",
  XML_SITEMAP: "XML_SITEMAP",
  ROBOTS_SITEMAP: "ROBOTS_SITEMAP",
  INTERNAL_LINK: "INTERNAL_LINK",
  RENDERED_BROWSER: "RENDERED_BROWSER",
  HTML_SITEMAP: "HTML_SITEMAP",
  LLMS_TXT: "LLMS_TXT",
});

const KNOWN_PROVENANCE = new Set(Object.values(URL_DISCOVERY_PROVENANCE));

function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

export function canonicalizeDiscoveryUrl(value, targetUrl) {
  let url;
  try { url = new URL(String(value || ""), targetUrl); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/g, "");
  const query = [...url.searchParams.entries()]
    .sort(([ak, av], [bk, bv]) => compare(ak, bk) || compare(av, bv));
  url.search = "";
  for (const [key, valuePart] of query) url.searchParams.append(key, valuePart);
  return url.toString();
}

function sourceValues(source) {
  if (Array.isArray(source)) return source;
  if (source && Array.isArray(source.urls)) return source.urls;
  return [];
}

function sourceIsApplicable(value) {
  return value !== null && value !== undefined;
}

function stableId(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 24);
}

/**
 * Reconcile URL observations from independent discovery sources.
 *
 * This function is intentionally side-effect free. It never turns an absent
 * observation into a negative finding. A source may be unavailable, partial,
 * or simply not applicable; those states remain visible in the result.
 */
export function reconcileUrlDiscovery({
  targetUrl,
  sources = {},
  sourceStatuses = {},
  providerCoverage = null,
  now = null,
} = {}) {
  const origin = new URL(canonicalizeDiscoveryUrl(targetUrl) || targetUrl).origin;
  const observations = new Map();
  const sourceCounts = {};
  const limitations = [];
  const applicableSources = [];

  for (const [rawName, rawSource] of Object.entries(sources || {})) {
    const provenance = String(rawName).toUpperCase();
    if (!KNOWN_PROVENANCE.has(provenance)) {
      limitations.push(`Unknown discovery provenance was ignored: ${rawName}`);
      continue;
    }
    if (!sourceIsApplicable(rawSource)) continue;
    applicableSources.push(provenance);
    const seen = new Set();
    for (const item of sourceValues(rawSource)) {
      const rawUrl = typeof item === "string" ? item : item?.url;
      const url = canonicalizeDiscoveryUrl(rawUrl, targetUrl);
      if (!url || new URL(url).origin !== origin) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const current = observations.get(url) || {
        id: stableId(url), url, provenance: [], observations: [],
        redirectTargets: [], canonicalUrls: [],
      };
      if (!current.provenance.includes(provenance)) current.provenance.push(provenance);
      current.observations.push({
        source: provenance,
        observedUrl: rawUrl,
        observedAt: item?.observedAt || now,
        status: item?.status || sourceStatuses[provenance] || "UNKNOWN",
      });
      if (item && typeof item === "object") {
        if (item.redirectTo) current.redirectTargets.push(canonicalizeDiscoveryUrl(item.redirectTo, url));
        if (item.canonicalUrl) current.canonicalUrls.push(canonicalizeDiscoveryUrl(item.canonicalUrl, url));
      }
      observations.set(url, current);
    }
    sourceCounts[provenance] = seen.size;
  }

  const inventory = [...observations.values()]
    .map((item) => ({
      ...item,
      provenance: [...item.provenance].sort(),
      redirectTargets: [...new Set(item.redirectTargets.filter(Boolean))].sort(),
      canonicalUrls: [...new Set(item.canonicalUrls.filter(Boolean))].sort(),
      observations: item.observations.slice().sort((a, b) => compare(`${a.source}:${a.observedUrl}`, `${b.source}:${b.observedUrl}`)),
    }))
    .sort((a, b) => compare(a.url, b.url));

  const sourceSets = Object.fromEntries(Object.entries(sourceCounts).map(([source]) => [
    source,
    new Set(inventory.filter((item) => item.provenance.includes(source)).map((item) => item.url)),
  ]));
  const unionCount = inventory.length;
  const intersectionCount = Object.values(sourceSets).length > 1
    ? inventory.filter((item) => item.provenance.length > 1).length
    : 0;
  const disagreementCount = Object.values(sourceSets).length > 1
    ? inventory.filter((item) => item.provenance.length === 1).length
    : 0;

  const suspiciousReasons = [];
  if (providerCoverage && Number.isFinite(providerCoverage.completed) && unionCount > providerCoverage.completed * 2 && unionCount - providerCoverage.completed >= 5) {
    suspiciousReasons.push(`provider coverage (${providerCoverage.completed}) is materially below discovered inventory (${unionCount})`);
  }
  if (sourceStatuses.XML_SITEMAP === "PARTIAL" || sourceStatuses.ROBOTS_SITEMAP === "PARTIAL") {
    suspiciousReasons.push("sitemap discovery is partial");
  }
  if (disagreementCount >= 5 && intersectionCount === 0) {
    suspiciousReasons.push("discovery sources have no overlapping URLs");
  }
  if (applicableSources.length === 0 || unionCount === 0) suspiciousReasons.push("no usable discovery source was available");

  const incomplete = suspiciousReasons.length > 0 || Object.values(sourceStatuses).some((status) => ["FAILED", "PARTIAL", "UNAVAILABLE"].includes(status));
  return {
    contractVersion: "1.0.0",
    status: unionCount === 0 ? "UNAVAILABLE" : incomplete ? "PARTIAL" : "AVAILABLE",
    coverageState: unionCount === 0 ? "INCOMPLETE" : incomplete ? "INCOMPLETE" : "SUFFICIENT",
    inventory,
    sourceCounts,
    sourceStatuses: { ...sourceStatuses },
    sourceDisagreement: {
      present: disagreementCount > 0,
      disagreementCount,
      overlappingUrlCount: intersectionCount,
      sourceCount: applicableSources.length,
    },
    suspiciousCoverage: {
      present: suspiciousReasons.length > 0,
      reasons: suspiciousReasons,
      escalation: suspiciousReasons.length > 0 ? "BOUNDED_STRUCTURAL_BROWSER_DISCOVERY" : "NONE",
    },
    limitations,
    counts: { discovered: unionCount, sources: applicableSources.length },
  };
}

export default { canonicalizeDiscoveryUrl, reconcileUrlDiscovery, URL_DISCOVERY_PROVENANCE };

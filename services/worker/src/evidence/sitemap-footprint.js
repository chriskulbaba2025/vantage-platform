import { gunzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import { normalizeUrl, stableHash } from "../utils.js";

const HARD_MAX_SITEMAP_DOCUMENTS = 200;
const HARD_MAX_RETAINED_URLS = 100000;
const HARD_MAX_PRIORITY_URLS = 20;
const DEFAULT_DOCUMENT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const DEFAULT_VARIABLE_SIBLING_THRESHOLD = 5;
const DEFAULT_TOP_LEVEL_VARIABLE_SIBLING_THRESHOLD = 20;
const DEFAULT_MATERIAL_CLUSTER_MIN_URLS = 8;
const DEFAULT_CLUSTER_REPRESENTATIVES = 3;

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

const FOOTPRINT_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  PARTIAL: "PARTIAL",
  UNAVAILABLE: "UNAVAILABLE",
});

const STRUCTURAL_SEGMENTS = new Set([
  "about", "about-us", "article", "articles", "blog", "book", "booking",
  "case-study", "case-studies", "categories", "category", "company",
  "contact", "contact-us", "demo", "faq", "faqs", "help", "home",
  "industries", "industry", "locations", "location", "news", "plans",
  "portfolio", "pricing", "product", "products", "resources", "resource",
  "results", "review", "reviews", "service", "services", "solutions",
  "success-stories", "team", "testimonial", "testimonials", "work",
]);

const BUSINESS_ROLE_SEGMENTS = new Map([
  ["contact", 10], ["contact-us", 10], ["book", 10], ["booking", 10],
  ["demo", 10], ["consultation", 10], ["schedule", 10],
  ["pricing", 20], ["plans", 20],
  ["services", 30], ["service", 30], ["solutions", 30],
  ["about", 40], ["about-us", 40], ["company", 40], ["team", 40],
  ["case-study", 50], ["case-studies", 50], ["success-stories", 50],
  ["testimonial", 50], ["testimonials", 50], ["review", 50], ["reviews", 50],
]);

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("Sitemap footprint discovery aborted by caller");
}

function canonicalizeHttpUrl(input, base) {
  let url;
  try {
    url = new URL(input, base);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/g, "");

  const sortedParams = [...url.searchParams.entries()]
    .sort(([aKey, aValue], [bKey, bValue]) => {
      const keyOrder = compareStrings(aKey, bKey);
      return keyOrder || compareStrings(aValue, bValue);
    });
  url.search = "";
  for (const [key, value] of sortedParams) url.searchParams.append(key, value);

  return url.toString();
}

function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function localName(node) {
  const name = String(node?.name || "").toLowerCase();
  const colon = name.lastIndexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function parseSitemapXml(xml) {
  const $ = cheerio.load(String(xml || ""), { xmlMode: true });
  const root = $.root().children().first();
  const rootType = localName(root[0]);

  if (rootType !== "sitemapindex" && rootType !== "urlset") {
    return { type: "unknown", locations: [] };
  }

  const itemName = rootType === "sitemapindex" ? "sitemap" : "url";
  const locations = [];

  root.children().each((_, element) => {
    if (localName(element) !== itemName) return;
    let location = "";
    $(element).children().each((__, child) => {
      if (!location && localName(child) === "loc") {
        location = $(child).text().trim();
      }
    });
    if (location) locations.push(location);
  });

  return { type: rootType, locations };
}

function requestSignal(parentSignal, timeoutMs, label) {
  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason || new Error(`${label} aborted by caller`));
  };

  if (parentSignal?.aborted) {
    onParentAbort();
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
    },
  };
}

async function fetchTextResource(url, options) {
  const {
    fetchImpl,
    signal,
    timeoutMs,
    maxBytes,
    allowedOrigin,
    label,
  } = options;

  const scoped = requestSignal(signal, timeoutMs, label);
  let currentUrl = url;

  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      throwIfAborted(signal);

      const response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: scoped.signal,
        headers: {
          "user-agent": "PrysmAuditBot/1.0 (+https://omnipresence.com)",
          accept: "application/xml,text/xml,text/plain,*/*;q=0.5",
        },
              });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return { ok: false, status: response.status, url: currentUrl, text: "" };
        }
        const redirected = canonicalizeHttpUrl(location, currentUrl);
        if (!redirected || !sameOrigin(redirected, allowedOrigin)) {
          throw new Error(`Blocked cross-origin redirect from ${currentUrl}`);
        }
        currentUrl = redirected;
        continue;
      }

      if (!response.ok) {
        return { ok: false, status: response.status, url: currentUrl, text: "" };
      }

      const declaredLength = Number.parseInt(response.headers.get("content-length") || "", 10);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error(`${label} exceeds ${maxBytes} byte safety limit`);
      }

      let bytes = Buffer.from(await response.arrayBuffer());
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      const looksGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
      if (looksGzip || contentType.includes("application/gzip") || contentType.includes("application/x-gzip")) {
        if (looksGzip) bytes = gunzipSync(bytes);
      }

      if (bytes.length > maxBytes) {
        throw new Error(`${label} exceeds ${maxBytes} byte safety limit after decoding`);
      }

      return {
        ok: true,
        status: response.status,
        url: currentUrl,
        text: bytes.toString("utf8"),
      };
    }

    throw new Error(`${label} exceeded redirect limit`);
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    if (scoped.timedOut()) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    scoped.cleanup();
  }
}

async function discoverRobotsSitemaps(origin, options) {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  try {
    const result = await fetchTextResource(robotsUrl, {
      ...options,
      allowedOrigin: origin,
      maxBytes: Math.min(options.maxBytes, 1024 * 1024),
      label: `robots.txt ${robotsUrl}`,
    });
    if (!result.ok) return [];

    return result.text
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*sitemap\s*:\s*(\S+)\s*$/i)?.[1] || "")
      .filter(Boolean)
      .map((value) => canonicalizeHttpUrl(value, origin))
      .filter(Boolean)
      .filter((value) => sameOrigin(value, origin))
      .sort();
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return [];
  }
}

function safeDecodeSegment(segment) {
  try {
    return decodeURIComponent(segment).toLowerCase();
  } catch {
    return segment.toLowerCase();
  }
}

function intrinsicSegmentPattern(segment) {
  const value = safeDecodeSegment(segment);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "{date}";
  if (/^\d{4}$/.test(value)) return "{year}";
  if (/^\d+$/.test(value)) return "{number}";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return "{uuid}";
  if (/^[0-9a-f]{12,}$/i.test(value)) return "{id}";
  if (/^(?=.*\d)[a-z0-9_-]{16,}$/i.test(value)) return "{id}";
  return value;
}

function pathSegments(url) {
  return new URL(url).pathname
    .split("/")
    .filter(Boolean)
    .map(safeDecodeSegment);
}

function representativeUrls(urls, limit = DEFAULT_CLUSTER_REPRESENTATIVES) {
  const sorted = [...new Set(urls)].sort();
  if (sorted.length <= limit) return sorted;

  const indexes = new Set([0, sorted.length - 1]);
  if (limit >= 3) indexes.add(Math.floor((sorted.length - 1) / 2));

  for (let i = 1; indexes.size < limit && i < sorted.length - 1; i += 1) {
    indexes.add(Math.floor((i * (sorted.length - 1)) / (limit - 1)));
  }

  return [...indexes]
    .sort((a, b) => a - b)
    .slice(0, limit)
    .map((index) => sorted[index]);
}

export function clusterSitemapUrls(urls, options = {}) {
  const variableSiblingThreshold = clampInteger(
    options.variableSiblingThreshold,
    DEFAULT_VARIABLE_SIBLING_THRESHOLD,
    3,
    1000,
  );
  const topLevelVariableSiblingThreshold = clampInteger(
    options.topLevelVariableSiblingThreshold,
    DEFAULT_TOP_LEVEL_VARIABLE_SIBLING_THRESHOLD,
    variableSiblingThreshold,
    5000,
  );
  const materialClusterMinUrls = clampInteger(
    options.materialClusterMinUrls,
    DEFAULT_MATERIAL_CLUSTER_MIN_URLS,
    2,
    10000,
  );

  const records = [...new Set(urls)]
    .sort()
    .map((url) => {
      const segments = pathSegments(url);
      return {
        url,
        segments,
        generalized: segments.map(intrinsicSegmentPattern),
      };
    });

  const maxDepth = records.reduce((max, record) => Math.max(max, record.segments.length), 0);

  for (let index = 0; index < maxDepth; index += 1) {
    const groups = new Map();
    for (const record of records) {
      if (record.segments.length <= index) continue;
      const key = `${record.segments.length}|${record.generalized.slice(0, index).join("/")}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }

    for (const group of groups.values()) {
      const candidates = group.filter((record) => {
        const current = record.generalized[index];
        return !current.startsWith("{") && !STRUCTURAL_SEGMENTS.has(current);
      });
      const threshold = index === 0 ? topLevelVariableSiblingThreshold : variableSiblingThreshold;
      const distinct = new Set(candidates.map((record) => record.generalized[index]));
      if (distinct.size < threshold) continue;
      for (const record of candidates) record.generalized[index] = "{segment}";
    }
      }

  const grouped = new Map();
  for (const record of records) {
    const pattern = record.generalized.length ? `/${record.generalized.join("/")}` : "/";
    if (!grouped.has(pattern)) grouped.set(pattern, []);
    grouped.get(pattern).push(record.url);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([pattern, clusterUrls]) => {
      const reasonCodes = [];
      if (pattern.includes("{segment}")) reasonCodes.push("VARIABLE_SIBLING_FAMILY");
      if (/\{(?:date|year|number|uuid|id)\}/.test(pattern)) reasonCodes.push("DYNAMIC_IDENTIFIER_FAMILY");
      if (clusterUrls.length >= materialClusterMinUrls) reasonCodes.push("LARGE_REPEATED_FAMILY");

      return {
        id: `cluster-${stableHash(pattern).slice(0, 12)}`,
        pattern,
        discoveredUrlCount: clusterUrls.length,
        representativeUrls: representativeUrls(clusterUrls),
        requiresRepresentativeAssessment: clusterUrls.length >= materialClusterMinUrls,
        reasonCodes,
      };
    });
}

function serviceTerms(services = []) {
  const stop = new Set(["and", "for", "the", "with", "from", "your", "our", "services", "service"]);
  return [...new Set(
    services
      .flatMap((service) => String(service || "").toLowerCase().split(/[^a-z0-9]+/))
      .filter((term) => term.length >= 3 && !stop.has(term)),
  )].sort();
}

function businessRoleScore(url, services) {
  const segments = pathSegments(url);
  if (!segments.length) return null;

  let best = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    if (BUSINESS_ROLE_SEGMENTS.has(segment)) {
      best = Math.min(best, BUSINESS_ROLE_SEGMENTS.get(segment));
    }
  }

  const terms = serviceTerms(services);
  if (terms.some((term) => segments.some((segment) => segment.includes(term)))) {
    best = Math.min(best, 25);
  }

  return Number.isFinite(best) ? best : null;
}

export function selectPriorityUrls(targetUrl, retainedUrls, clusters, options = {}) {
  const maxPriorityUrls = clampInteger(
    options.maxPriorityUrls,
    HARD_MAX_PRIORITY_URLS,
    1,
    HARD_MAX_PRIORITY_URLS,
  );
  const services = Array.isArray(options.services) ? options.services : [];
  const normalizedTarget = canonicalizeHttpUrl(normalizeUrl(targetUrl));
  const rootUrl = new URL("/", normalizedTarget).toString();
  const sortedUrls = [...new Set(retainedUrls)].sort();
  const selected = [];
  const selectedSet = new Set();

  const add = (url) => {
    if (!url || selectedSet.has(url) || selected.length >= maxPriorityUrls) return false;
    selected.push(url);
    selectedSet.add(url);
    return true;
  };

  add(rootUrl);

  const businessCandidates = sortedUrls
    .map((url) => ({ url, score: businessRoleScore(url, services), depth: pathSegments(url).length }))
    .filter((item) => item.score !== null && item.url !== rootUrl)
    .sort((a, b) => a.score - b.score || a.depth - b.depth || compareStrings(a.url, b.url));

  const initialBusinessBudget = Math.min(6, Math.max(0, maxPriorityUrls - selected.length));
  for (const item of businessCandidates.slice(0, initialBusinessBudget)) add(item.url);

  const materialClusters = clusters
    .filter((cluster) => cluster.requiresRepresentativeAssessment)
    .sort((a, b) => b.discoveredUrlCount - a.discoveredUrlCount || compareStrings(a.pattern, b.pattern));

  for (const cluster of materialClusters) {
    const candidate = cluster.representativeUrls.find((url) => !selectedSet.has(url));
    add(candidate);
  }

  for (const item of businessCandidates.slice(initialBusinessBudget)) add(item.url);

  for (const cluster of materialClusters) {
    for (const url of cluster.representativeUrls) add(url);
  }

  const outliers = sortedUrls
    .filter((url) => !selectedSet.has(url))
    .map((url) => ({ url, depth: pathSegments(url).length }))
    .sort((a, b) => b.depth - a.depth || compareStrings(a.url, b.url));

  for (const item of outliers) add(item.url);

  return selected;
}

export async function discoverSitemapFootprint(targetUrl, options = {}) {
  const normalizedTarget = canonicalizeHttpUrl(normalizeUrl(targetUrl));
  const origin = new URL(normalizedTarget).origin;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");

  const maxSitemapDocuments = clampInteger(
    options.maxSitemapDocuments,
    HARD_MAX_SITEMAP_DOCUMENTS,
    1,
    HARD_MAX_SITEMAP_DOCUMENTS,
  );
  const maxRetainedUrls = clampInteger(
    options.maxRetainedUrls,
    HARD_MAX_RETAINED_URLS,
    1,
    HARD_MAX_RETAINED_URLS,
  );
  const maxPriorityUrls = clampInteger(
    options.maxPriorityUrls,
    HARD_MAX_PRIORITY_URLS,
    1,
    HARD_MAX_PRIORITY_URLS,
  );
  const timeoutMs = clampInteger(
    options.documentTimeoutMs,
    DEFAULT_DOCUMENT_TIMEOUT_MS,
    100,
    120000,
  );
  const maxDocumentBytes = clampInteger(
    options.maxDocumentBytes,
    DEFAULT_MAX_DOCUMENT_BYTES,
    1024,
    DEFAULT_MAX_DOCUMENT_BYTES,
  );

  throwIfAborted(options.signal);

  const robotsSitemaps = await discoverRobotsSitemaps(origin, {
    fetchImpl,
    signal: options.signal,
    timeoutMs,
    maxBytes: maxDocumentBytes,
  });

  const fallbackSitemaps = [
    new URL("/sitemap.xml", origin).toString(),
    new URL("/sitemap_index.xml", origin).toString(),
  ];

  const queue = [];
  const queued = new Set();
  const enqueue = (url, required) => {
    const canonical = canonicalizeHttpUrl(url, origin);
    if (!canonical || queued.has(canonical)) return;
    if (!sameOrigin(canonical, origin)) return;
    queued.add(canonical);
    queue.push({ url: canonical, required });
  };

  if (robotsSitemaps.length) {
    for (const url of robotsSitemaps) enqueue(url, true);
      } else {
    for (const url of fallbackSitemaps) enqueue(url, false);
  }

  const retained = new Set();
  const processedDocuments = new Set();
  const limitations = [];
  let attemptedDocuments = 0;
  let parsedDocuments = 0;
  let failedDocuments = 0;
  let duplicateUrlCount = 0;
  let skippedExternalPageUrlCount = 0;
  let skippedExternalSitemapCount = 0;
  let cappedByDocuments = false;
  let cappedByUrls = false;
  let incomplete = false;

  while (queue.length && attemptedDocuments < maxSitemapDocuments && !cappedByUrls) {
    throwIfAborted(options.signal);
    const entry = queue.shift();
    if (!entry || processedDocuments.has(entry.url)) continue;
    processedDocuments.add(entry.url);
    attemptedDocuments += 1;

    let resource;
    try {
      resource = await fetchTextResource(entry.url, {
        fetchImpl,
        signal: options.signal,
        timeoutMs,
        maxBytes: maxDocumentBytes,
        allowedOrigin: origin,
        label: `sitemap ${entry.url}`,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (entry.required) {
        failedDocuments += 1;
        incomplete = true;
        limitations.push(`Sitemap document failed at ${entry.url}: ${error.message}`);
      }
      continue;
    }

    if (!resource.ok) {
      if (entry.required) {
        failedDocuments += 1;
        incomplete = true;
        limitations.push(`Sitemap document returned HTTP ${resource.status}: ${entry.url}`);
      }
      continue;
    }

    const parsed = parseSitemapXml(resource.text);
    if (parsed.type === "unknown") {
      if (entry.required) {
        failedDocuments += 1;
        incomplete = true;
        limitations.push(`Sitemap document was not a sitemap index or URL set: ${entry.url}`);
      }
      continue;
    }

    parsedDocuments += 1;

    if (parsed.type === "sitemapindex") {
      const childSitemaps = parsed.locations
        .map((value) => canonicalizeHttpUrl(value, resource.url))
        .filter(Boolean)
        .sort();

      for (const child of childSitemaps) {
        if (!sameOrigin(child, origin)) {
          skippedExternalSitemapCount += 1;
          incomplete = true;
          continue;
        }
        enqueue(child, true);
      }
      continue;
    }

    for (const value of parsed.locations) {
      const pageUrl = canonicalizeHttpUrl(value, resource.url);
      if (!pageUrl) continue;
      if (!sameOrigin(pageUrl, origin)) {
        skippedExternalPageUrlCount += 1;
        continue;
      }
      if (retained.has(pageUrl)) {
        duplicateUrlCount += 1;
        continue;
      }
      if (retained.size >= maxRetainedUrls) {
        cappedByUrls = true;
        incomplete = true;
        break;
      }
      retained.add(pageUrl);
    }
  }

  if (queue.length && attemptedDocuments >= maxSitemapDocuments) {
    cappedByDocuments = true;
    incomplete = true;
  }

  if (skippedExternalSitemapCount > 0) {
    limitations.push(`${skippedExternalSitemapCount} cross-origin sitemap document reference(s) were not fetched.`);
  }
  if (skippedExternalPageUrlCount > 0) {
    limitations.push(`${skippedExternalPageUrlCount} cross-origin page URL(s) were excluded from the site footprint.`);
  }
  if (cappedByDocuments) {
    limitations.push(`Sitemap discovery reached the ${maxSitemapDocuments}-document cap; coverage is incomplete.`);
  }
  if (cappedByUrls) {
    limitations.push(`Sitemap discovery reached the ${maxRetainedUrls}-URL retention cap; coverage is incomplete.`);
  }

  const retainedUrls = [...retained].sort();
  const clusters = clusterSitemapUrls(retainedUrls, options);
  const priorityUrls = selectPriorityUrls(normalizedTarget, retainedUrls, clusters, {
    ...options,
    maxPriorityUrls,
  });
  const usableSitemap = parsedDocuments > 0 && retainedUrls.length > 0;

  if (!usableSitemap) {
    limitations.push("No usable same-origin sitemap URL footprint was discovered; absence of sitemap evidence does not prove absence of programmatic SEO.");
  }

  const status = !usableSitemap
    ? FOOTPRINT_STATUS.UNAVAILABLE
    : incomplete
      ? FOOTPRINT_STATUS.PARTIAL
      : FOOTPRINT_STATUS.AVAILABLE;

  return {
    status,
    discoveredUrlCount: retainedUrls.length,
    retainedUrlCount: retainedUrls.length,
    sitemapDocumentCount: attemptedDocuments,
    capped: cappedByDocuments || cappedByUrls,
    incomplete: !usableSitemap || incomplete,
    clusterCount: clusters.length,
    clusters,
    priorityUrls,
    coverage: {
      usableSitemap,
      complete: usableSitemap && !incomplete,
      parsedSitemapDocumentCount: parsedDocuments,
      failedSitemapDocumentCount: failedDocuments,
      duplicateUrlCount,
      skippedExternalPageUrlCount,
      skippedExternalSitemapCount,
      cappedByDocuments,
      cappedByUrls,
      sitemapDocumentCap: maxSitemapDocuments,
      retainedUrlCap: maxRetainedUrls,
      priorityUrlCap: maxPriorityUrls,
    },
    limitations: [...new Set(limitations)],
  };
}

export { FOOTPRINT_STATUS };
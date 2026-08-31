  /**
 * DataForSEO On-Page Adapter
 *
 * Orchestrates the full DataForSEO On-Page crawl flow and normalizes all
 * results into the canonical provider-independent evidence model required
 * by PRD v3.0 §8.
 *
 * Flow:
 *   POST on_page/task_post
 *   → store task ID
 *   → poll task status
 *   → retrieve summary
 *   → retrieve pages
 *   → retrieve links
 *   → retrieve duplicate tags
 *   → retrieve duplicate content
 *   → normalize into canonical site evidence
 *
 * The output shape matches the existing site-crawler.js output so that
 * scoring, reporting, and module gates work without modification.
 */

import { createHash } from "node:crypto";
import { domainOf } from "../../utils.js";
import {
  SOURCE_STATUS,
  ERROR_CATEGORY,
  buildSourceStatus,
  EVIDENCE_ENVELOPE_VERSION,
} from "../../scoring/evidence-contracts.js";
import {
  createDataforseoOnpageClient,
} from "./dataforseo-onpage-client.js";
import { selectImportantPages, normalizeUrl } from "../../evidence/important-page-selector.js";
import { discoverSitemapFootprint } from "../../evidence/sitemap-footprint.js";
import { analyzeProgrammaticSeo } from "../../evidence/programmatic-seo-analysis.js";

// ---------------------------------------------------------------------------
// Adapter version
// ---------------------------------------------------------------------------

const ADAPTER_VERSION = "1.4.1";
const HARD_MAX_PROVIDER_PAGES = 250;

// ---------------------------------------------------------------------------
// Default configuration (PRD v3.0 §8.4 + governed representative crawl)
// ---------------------------------------------------------------------------

const DEFAULTS = Object.freeze({
  maxPages: HARD_MAX_PROVIDER_PAGES,
  pollTimeoutMs: 1800000,   // 30-minute provider poll budget
  pollIntervalMs: 10000,
  enableJavascript: false,
  enableBrowserRendering: false,
  loadResources: true,
  validateMicromarkup: true,
  enableContentParsing: true,
  contentParsingPageLimit: 50,
  redirectChainsPageLimit: 20,
  nonIndexableLimit: 1000,
  resourcesPageLimit: 10,
});

function resolveProviderMaxPages(value) {
  const parsed = Number.parseInt(
    value ?? DEFAULTS.maxPages,
    10,
  );

  if (!Number.isFinite(parsed)) {
    return DEFAULTS.maxPages;
  }

  return Math.min(
    HARD_MAX_PROVIDER_PAGES,
    Math.max(1, parsed),
  );
}

function syntheticUnavailableFootprint(targetUrl, limitation) {
  const root = normalizeUrl(targetUrl);

  return {
    status: "UNAVAILABLE",
    discoveredUrlCount: 0,
    retainedUrlCount: 0,
    sitemapDocumentCount: 0,
    capped: false,
    incomplete: true,
    clusterCount: 0,
    clusters: [],
    priorityUrls: root ? [root] : [],
    coverage: {
      usableSitemap: false,
      complete: false,
      parsedDocumentCount: 0,
      failedDocumentCount: 0,
    },
    limitations: [limitation],
  };
}

function normalizeFootprintForAnalysis(footprint) {
  if (!footprint || typeof footprint !== "object") return footprint;

  const rawClusters = Array.isArray(footprint.clusters)
    ? footprint.clusters
    : [];

  const clusters = rawClusters.map((cluster) => ({
    ...cluster,
    discoveredUrlCount:
      cluster.discoveredUrlCount
      ?? cluster.discoveredCount
      ?? 0,
    representativeUrls: Array.isArray(cluster.representativeUrls)
      ? cluster.representativeUrls
      : Array.isArray(cluster.representatives)
        ? cluster.representatives
        : [],
  }));

  const priorityUrls = Array.isArray(footprint.priorityUrls)
    ? footprint.priorityUrls
    : Array.isArray(footprint.priority_urls)
      ? footprint.priority_urls
      : [];

  return {
    ...footprint,
    clusters,
    clusterCount: footprint.clusterCount ?? clusters.length,
    priorityUrls,
  };
}

async function resolveSiteFootprint(target, options, clientOpts) {
  if (options.siteFootprint) {
    return normalizeFootprintForAnalysis(options.siteFootprint);
  }

  const mode =
    clientOpts.mode ||
    (clientOpts.fixtures ? "fixture" : "live");

  if (mode === "fixture") {
    return syntheticUnavailableFootprint(
      target,
      "Sitemap footprint discovery was not executed in fixture mode.",
    );
  }

  try {
    const footprint = await discoverSitemapFootprint(target, {
      fetchImpl:
        options.sitemapFetchImpl ||
        clientOpts.fetchImpl,
      services: Array.isArray(options.businessServices)
        ? options.businessServices
        : [],
    });

    return normalizeFootprintForAnalysis(footprint);
  } catch (error) {
    return syntheticUnavailableFootprint(
      target,
      `Sitemap footprint discovery failed: ${error.message}`,
    );
  }
}

function mergeDeepPageUrls({
  normalizedPages,
  keyPages,
  siteFootprint,
}) {
  const byNormalizedUrl = new Map();

  for (const page of normalizedPages) {
    const rawUrl =
      page.crawledUrl ||
      page.url ||
      page.finalUrl ||
      "";

    const normalized =
      normalizeUrl(rawUrl);

    if (
      normalized &&
      !byNormalizedUrl.has(normalized)
    ) {
      byNormalizedUrl.set(
        normalized,
        rawUrl,
      );
    }
  }

  const selected = [];
  const seen = new Set();

  function add(candidate) {
    const normalized =
      normalizeUrl(candidate || "");

    if (
      !normalized ||
      seen.has(normalized)
    ) {
      return;
    }

    const rawUrl =
      byNormalizedUrl.get(normalized);

    if (!rawUrl) {
      return;
    }

    seen.add(normalized);
    selected.push(rawUrl);
  }

  // Governed must-have URLs always come first.
  for (
    const url of
    siteFootprint?.prioritySelection
      ?.mustHaveUrls || []
  ) {
    add(url);
  }

  // Add deterministic commercial/key pages.
  for (
    const item of
    keyPages.selected || []
  ) {
    add(item.url);
  }

  // Preserve every required material-family representative.
  for (
    const cluster of
    siteFootprint?.clusters || []
  ) {
    if (
      cluster?.requiresRepresentativeAssessment !==
      true
    ) {
      continue;
    }

    for (
      const url of
      cluster.representativeUrls || []
    ) {
      add(url);
    }
  }

  // Supplemental sitemap priority entries come last.
  for (
    const url of
    siteFootprint?.priorityUrls || []
  ) {
    add(url);
  }

  // IMPORTANT:
  // Do not apply the Content Parsing runtime budget here.
  // The complete governed selection must remain auditable.
  return selected;
}

// ---------------------------------------------------------------------------
// Page normalizer — maps DataForSEO page fields to canonical Vantage shape
// ---------------------------------------------------------------------------

/**
 * Normalize a single raw DataForSEO page into the canonical Vantage page shape.
 * Matches the extractPage() output from page-extractor.js.
 *
 * @param {object} raw - Raw DataForSEO page item.
 * @param {object} context - Additional context (target domain, etc.).
 * @returns {object} Canonical page object.
 */
function normalizePage(raw, context = {}) {
  const targetDomain = context.targetDomain || "";
  const resourceErrors = raw.resource_errors || raw.page_errors || {};

  // Determine page status
  const statusCode = raw.status_code || 0;
  const rendered = Boolean(raw.enable_javascript || raw.enable_browser_rendering);

  // Headings: DataForSEO nests under meta.htags.{h1…h6} (PRD v3.0 §8).
  // Fall back to meta.h1 (legacy fixture format) for test compatibility.
  const htags = raw.meta?.htags || {};
  const headings = {
    h1: htags.h1 || raw.meta?.h1 || [],
    h2: htags.h2 || raw.meta?.h2 || [],
    h3: htags.h3 || raw.meta?.h3 || [],
    h4: htags.h4 || raw.meta?.h4 || [],
    h5: htags.h5 || raw.meta?.h5 || [],
    h6: htags.h6 || raw.meta?.h6 || [],
  };

  // Links: the /on_page/pages endpoint returns counts (meta.internal_links_count,
  // meta.external_links_count), not arrays.  When a link array is supplied
  // (fixture tests or the separate /on_page/links endpoint), normalise it.
  // Otherwise leave the array empty — real link data comes via the links endpoint.
  const rawLinks = (Array.isArray(raw.links) && raw.links.length > 0)
  ? raw.links
  : (context.links || []);
  const links = rawLinks.map((link) => ({
    url: link.url || link.href || link.link_to || "",
    text: link.text || link.anchor || "",
    target: link.target || "",
  }));

  // Images: the pages endpoint returns meta.images_count (integer), not arrays.
  // Fixture tests may supply arrays under .images or .resources.images.
  const rawImages = raw.images || raw.resources?.images || [];
  const images = rawImages.map((img) => ({
    src: img.url || img.src || "",
    alt: img.alt || "",
    width: img.width || null,
    height: img.height || null,
    loading: img.loading || null,
  }));

  // Schema types from structured data (not available from pages endpoint;
  // falls back to empty for real API, uses test fixtures when present).
  const schemaTypes = extractSchemaTypes(raw);

  // Body text: NOT available from the /on_page/pages endpoint — it returns
  // meta.content.plain_text_size (integer) and meta.content.plain_text_word_count
  // (float), but never the actual text.  Trust signals therefore cannot be
  // detected from page body content when using DataForSEO.
  const bodyText = raw.content?.plain_text || raw.meta?.plain_text || "";
  const title = raw.meta?.title || "";
  const description = raw.meta?.description || "";

  const signals = detectTrustSignals(bodyText, title, description, raw);

  // Service candidates from headings and schema
  const serviceCandidates = extractServiceCandidates(raw);

  // Content availability: true only when actual body text was extracted.
  // DataForSEO pages endpoint does not provide body text, so this will be
  // false in production.  The legacy crawler (page-extractor.js) always
  // sets this to true because it parses full HTML.
  const contentAvailable = bodyText.length > 0;

  // Canonical field mapping from DataForSEO raw fields
  // §Complete normalized page contract — maps DataForSEO fields per PRD
  const meta = raw.meta || {};
  const checks = raw.checks || {};
  const fetchTiming = raw.fetch_timing || {};
  const pageTiming = raw.page_timing || {};

  return {
    // ── Required canonical fields ──────────────────────────────────────
    crawledUrl: raw.url || "",
    finalUrl: raw.location || raw.url || "",
    statusCode,
    redirectDestination: statusCode >= 300 && statusCode < 400 ? (raw.location || null) : null,
    indexable: meta.follow !== false && statusCode === 200,
    robotsDirectives: meta.robots || (meta.follow === false ? "nofollow" : null),
    canonicalUrl: meta.canonical || raw.canonical || null,

    // ── Content fields ─────────────────────────────────────────────────
    title,
    metaDescription: description,
    headings,

    wordCount: meta.content?.plain_text_word_count
      ?? meta.word_count
      ?? raw.content?.word_count
      ?? 0,

    // Link counts from meta (pages endpoint provides counts, not arrays)
    internalInlinks: meta.internal_links_count ?? null,
    internalOutlinks: null, // Not available from pages endpoint
    externalOutlinks: meta.external_links_count ?? null,
    brokenLinks: null, // Not available from pages endpoint; use links endpoint

    // ── Image evidence ─────────────────────────────────────────────────
    imageCount: meta.images_count ?? (images.length || null),
    imagesMissingAlt: images.length > 0
      ? images.filter((img) => !img.alt).length
      : null,
    imagesSizeBytes: meta.images_size ?? null,

    // ── Structured data / microdata ────────────────────────────────────
    schemaTypes,
    hasMicrodata: checks.has_micromarkup === true,

    // ── Sitemap and crawl metadata ─────────────────────────────────────
    sitemapMembership: checks.from_sitemap === true,
    crawlDepth: raw.click_depth ?? raw.crawl_depth ?? null,
    responseTimeMs: fetchTiming.duration_time ?? pageTiming.duration_time ?? null,
    pageSizeBytes: raw.size ?? null,

    // ── Platform / technology ──────────────────────────────────────────
    detectedTechnology: detectPlatform(raw),

    // ── Legacy backward-compatible fields ──────────────────────────────
    url: raw.url || "",
    status: statusCode,
    rendered,
    description,
    canonical: meta.canonical || raw.canonical || null,
    language: meta.content_language || raw.language || "",
    generator: meta.generator || raw.technologies?.cms || "",
    platform: detectPlatform(raw),
    words: meta.content?.plain_text_word_count
      ?? meta.word_count
      ?? raw.content?.word_count
      ?? 0,
    links,
    ctas: extractCtas(raw, targetDomain),
    images,
    forms: extractForms(raw),
    socialLinks: extractSocialLinks(rawLinks),
    emailLinks: links.filter((l) => l.url && l.url.startsWith("mailto:")),
    phoneLinks: links.filter((l) => l.url && l.url.startsWith("tel:")),
    serviceCandidates,
    signals,
    bodyText: bodyText.slice(0, 50000),
    responseHeaders: extractResponseHeaders(raw),

    _dataforseo: {
      resourceErrors,
      loadTime: raw.load_time || raw.time_to_interactive || null,
      sizeBytes: raw.size || raw.page_size || null,
      crawlDepth: raw.click_depth ?? raw.crawl_depth ?? null,
      sitemapUrl: raw.sitemap_url || null,
      metaInternalLinksCount: meta.internal_links_count ?? null,
      metaExternalLinksCount: meta.external_links_count ?? null,
      metaImagesCount: meta.images_count ?? null,
      imagesSize: meta.images_size ?? null,
      fetchDurationMs: fetchTiming.duration_time ?? null,
      pageDurationMs: pageTiming.duration_time ?? null,
      fromSitemap: checks.from_sitemap === true,
      hasMicromarkup: checks.has_micromarkup === true,
      inboundLinksCount: meta.inbound_links_count ?? null,
    },
    _contentAvailable: contentAvailable,
  };
}

// ---------------------------------------------------------------------------
// Schema type extraction
// ---------------------------------------------------------------------------

function extractSchemaTypes(raw) {
  const types = new Set();

  // From structured data / microdata
  const structuredData = raw.structured_data || raw.microdata || {};
  const items = structuredData.types || structuredData.items || [];

  for (const item of items) {
    if (item.type) {
      types.add(item.type);
    }
    if (item.types && Array.isArray(item.types)) {
      item.types.forEach((t) => types.add(t));
    }
  }

  // Also check meta structured data
  if (raw.meta?.structured_data_types) {
    for (const t of raw.meta.structured_data_types) {
      types.add(t);
    }
  }

  return [...types].sort();
}

// ---------------------------------------------------------------------------
// Platform detection from DataForSEO technology signals
// ---------------------------------------------------------------------------

function detectPlatform(raw) {
  const technologies = raw.technologies || {};
  const cms = (technologies.cms || "").toLowerCase();
  const generator = (raw.meta?.generator || "").toLowerCase();

  const combined = `${cms} ${generator}`;

  if (combined.includes("godaddy")) return "GoDaddy Website Builder";
  if (combined.includes("wordpress")) return "WordPress";
  if (combined.includes("wix")) return "Wix";
  if (combined.includes("squarespace")) return "Squarespace";
  if (combined.includes("shopify")) return "Shopify";
  if (combined.includes("webflow")) return "Webflow";
  if (combined.includes("next.js") || combined.includes("nextjs")) return "Next.js";
  if (combined.includes("drupal")) return "Drupal";
  if (combined.includes("joomla")) return "Joomla";

  return technologies.cms || raw.meta?.generator || "Unknown";
}

// ---------------------------------------------------------------------------
// Trust signal detection
// ---------------------------------------------------------------------------

const TESTIMONIAL_RE = /\b(testimonials?|what clients say|client stories|reviews?|success stor(?:y|ies))\b/i;
const CREDENTIAL_RE = /\b(certified|certification|licensed|registered|credential|years? experience|member of|accredited|degree|diploma)\b/i;
const CASE_RE = /\b(case stud(?:y|ies)|client result|before and after|outcome)\b/i;
const FAQ_RE = /\b(faq|frequently asked|common questions)\b/i;
const PRICE_RE = /(?:\$|CAD\s?\$|USD\s?\$|£|€)\s?\d|\b(pricing|price|cost|investment|fee)\b/i;
const POLICY_RE = /\b(privacy|terms|refund|cancellation|cookie policy)\b/i;

function detectTrustSignals(bodyText, title, description, raw) {
  const text = [bodyText, title, description].filter(Boolean).join(" ");

  // Check forms from raw page
  const hasForms = Boolean(
    (raw.forms && raw.forms.length > 0) ||
    (raw.resources?.forms && raw.resources.forms.length > 0),
  );

  return {
    testimonials: TESTIMONIAL_RE.test(text),
    credentials: CREDENTIAL_RE.test(text),
    caseStudies: CASE_RE.test(text),
    faq: FAQ_RE.test(text),
    pricing: PRICE_RE.test(text),
    policies: POLICY_RE.test(text),
    contact: hasForms || /contact/i.test(text),
  };
}

// ---------------------------------------------------------------------------
// Service candidate extraction
// ---------------------------------------------------------------------------

function extractServiceCandidates(raw) {
  const candidates = [];

  // From schema structured data
  const structuredData = raw.structured_data || raw.microdata || {};
  const items = structuredData.types || structuredData.items || [];
  for (const item of items) {
    if (
      item.type &&
      /service|offercatalog/i.test(item.type) &&
      item.name
    ) {
      candidates.push(item.name);
    }
  }

  return [...new Set(candidates)].slice(0, 20);
}

// ---------------------------------------------------------------------------
// CTA extraction
// ---------------------------------------------------------------------------

const CTA_RE = /\b(book|schedule|contact|call|subscribe|buy|start|get started|learn more|request|download|join|register|sign up|free consultation|discovery)\b/i;

function extractCtas(raw, targetDomain) {
  const ctas = [];

  // From buttons/forms
  const buttons = raw.resources?.buttons || raw.buttons || [];
  for (const btn of buttons) {
    const text = btn.text || btn.value || btn.aria_label || "";
    if (text && CTA_RE.test(text.toLowerCase())) {
      ctas.push({
        text,
        url: btn.url || raw.url || "",
        kind: "button",
      });
    }
  }

  // From links with CTA text
  const rawLinks = raw.links || [];
  for (const link of rawLinks) {
    const text = link.text || link.anchor || "";
    if (text && CTA_RE.test(text.toLowerCase())) {
      ctas.push({
        text,
        url: link.url || link.href || "",
        kind: "link",
      });
    }
  }

  return ctas;
}

// ---------------------------------------------------------------------------
// Form extraction
// ---------------------------------------------------------------------------

function extractForms(raw) {
  const forms = raw.resources?.forms || raw.forms || [];
  return forms.map((form) => ({
    action: form.action || form.url || raw.url || "",
    method: (form.method || "get").toLowerCase(),
    fields: form.fields_count || form.inputs_count || 0,
    hasCaptcha: /captcha|recaptcha/i.test(
      (form.html || ""),
    ),
  }));
}

// ---------------------------------------------------------------------------
// Social link extraction
// ---------------------------------------------------------------------------

const SOCIAL_HOSTS = [
  "linkedin.com", "facebook.com", "instagram.com", "youtube.com",
  "tiktok.com", "x.com", "twitter.com",
];

function extractSocialLinks(links) {
  return links.filter((link) => {
    const url = link.url || link.href || "";
    try {
      const host = new URL(url).hostname;
      return SOCIAL_HOSTS.some((social) => host.includes(social));
    } catch {
      return false;
    }
  }).map((link) => ({
    url: link.url || link.href || "",
    text: link.text || link.anchor || "",
  }));
}

// ---------------------------------------------------------------------------
// Response headers
// ---------------------------------------------------------------------------

function extractResponseHeaders(raw) {
  const headers = {};
  const rawHeaders = raw.response_headers || raw.headers || {};

  // Map common header names
  const headerMap = {
    "x-frame-options": "x-frame-options",
    "x-content-type-options": "x-content-type-options",
    "referrer-policy": "referrer-policy",
    "content-security-policy": "content-security-policy",
  };

  for (const [key, value] of Object.entries(rawHeaders)) {
    const lower = key.toLowerCase();
    if (headerMap[lower]) {
      headers[headerMap[lower]] = value;
    }
  }

  return headers;
}

// ---------------------------------------------------------------------------
// Deep sub-acquisition normalizers (PRYSM-NEXT-01 WP-B-09)
// ---------------------------------------------------------------------------

function extractTextFromContentParts(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (typeof p === "string" ? p : p?.text || p?.content || ""))
    .filter(Boolean)
    .join(" ");
}

/** EVIDENCE-MATRIX: content.body */
function normalizeContentParsing(raw) {
  const out = [];

  function addParts(parts, bucket, seen) {
    if (!Array.isArray(parts)) return;

    for (const part of parts) {
      const rawText =
        typeof part === "string"
          ? part
          : part?.text ?? part?.content ?? "";

      const text = String(rawText)
        .replace(/\s+/g, " ")
        .trim();

      if (!text || seen.has(text)) continue;

      seen.add(text);
      bucket.push(text);
    }
  }

  for (const res of raw?.results || []) {
    if (!res?.url) continue;

    const productionItem =
      Array.isArray(res.result?.items) && res.result.items.length > 0
        ? res.result.items[0]
        : null;

    const legacyItem =
      productionItem
      || (Array.isArray(res.items) ? res.items[0] : null)
      || res.result
      || null;

    if (!legacyItem) {
      out.push({
        url: res.url,
        wordCount: null,
        mainContentChars: null,
        hasMainContent: null,
        sentimentScore: null,
        text: "",
      });
      continue;
    }

    const mainFragments = [];
    const secondaryFragments = [];
    const seen = new Set();

    const pageContent = legacyItem.page_content || null;

    if (pageContent) {
      for (const topic of pageContent.main_topic || []) {
        addParts(topic?.primary_content, mainFragments, seen);
        addParts(topic?.secondary_content, mainFragments, seen);
      }

      for (const topic of pageContent.secondary_topic || []) {
        addParts(topic?.primary_content, secondaryFragments, seen);
        addParts(topic?.secondary_content, secondaryFragments, seen);
      }
    } else {
      // Preserve the older fixture/legacy response shape.
      addParts(legacyItem.main_content, mainFragments, seen);
      addParts(legacyItem.secondary_content, secondaryFragments, seen);
    }

    const main = mainFragments.join(" ");
    const secondary = secondaryFragments.join(" ");
    const fullText = [main, secondary].filter(Boolean).join(" ").trim();

    const wordCount =
      legacyItem.plain_text_word_count
      ?? legacyItem.word_count
      ?? pageContent?.plain_text_word_count
      ?? pageContent?.word_count
      ?? (fullText ? fullText.split(/\s+/).length : null);

    const sentimentScore =
      typeof legacyItem.sentiment_score === "number"
        ? legacyItem.sentiment_score
        : typeof pageContent?.sentiment_score === "number"
          ? pageContent.sentiment_score
          : null;

    out.push({
      url: res.url,
      wordCount,
      mainContentChars: main.length || null,
      hasMainContent: fullText.length > 0,
      sentimentScore,
      text: fullText.slice(0, 20000),
    });
  }

  return out;
}

/** EVIDENCE-MATRIX: technical.redirects */
function normalizeRedirectChains(raw) {
  const out = [];
  for (const res of raw?.results || []) {
    if (!res?.url) continue;
    const result = res.result || null;
    if (!result) {
      out.push({ from: res.url, to: null, statusCodes: [], hops: null });
      continue;
    }
    // Provider shape: result.items[0].chain = [{url, status_code, location}].
    // Defensive: treat result.items itself as the hop list.
    const first = Array.isArray(result.items) ? result.items[0] : null;
    const hopList = Array.isArray(first?.chain)
      ? first.chain
      : Array.isArray(result.items)
        ? result.items
        : [];
    const statusCodes = hopList
      .map((h) => h?.status_code ?? null)
      .filter((c) => c != null);
    const lastHop = hopList[hopList.length - 1];
    const to = lastHop?.location || lastHop?.redirect_url || lastHop?.url || null;
    out.push({ from: res.url, to, statusCodes, hops: hopList.length });
  }
  return out;
}

/** EVIDENCE-MATRIX: technical.indexability */
function normalizeNonIndexable(raw) {
  return (raw?.items || []).map((i) => ({
    url: i?.url || "",
    reason: i?.reason || i?.reason_code || i?.non_indexable_reason || "unknown",
  }));
}

/** EVIDENCE-MATRIX: technical.resources */
function normalizePageResources(raw) {
  const out = [];
  for (const res of raw?.results || []) {
    if (!res?.url) continue;
    const item = res.result || (res.items && res.items[0]) || null;
    if (!item) {
      out.push({ url: res.url, totalResources: null, brokenResources: null });
      continue;
    }
    const broken = Array.isArray(item.broken_resources)
      ? item.broken_resources.length
      : typeof item.broken_resources_count === "number"
        ? item.broken_resources_count
        : null;
    out.push({
      url: res.url,
      totalResources: item.total_resources ?? item.totalResources ?? null,
      brokenResources: broken,
    });
  }
  return out;
}

/** EVIDENCE-MATRIX: schema.structured_data (microdata endpoint) */
function extractMicrodataTypes(raw) {
  const types = new Set();
  const items = raw?.items || [];
  for (const item of items) {
    if (item.type) types.add(item.type);
    for (const t of item.types || []) types.add(t);
  }
  return [...types].sort();
}

// ---------------------------------------------------------------------------
// Site-level summarizer
// ---------------------------------------------------------------------------

/**
 * Build the canonical site evidence envelope from normalized pages
 * and DataForSEO raw results.
 *
 * Produces the same shape as site-crawler.js summarize().
 */
function summarizeSite({
  targetUrl,
  pages,
  rawSummary,
  rawDuplicateTags,
  rawDuplicateContent,
  rawMicrodata,
  microdataMeta,
  dtMeta,
  dcMeta,
  rawContentParsing = { results: [], metadata: [] },
  cpMeta = null,
  rawRedirectChains = { results: [], metadata: [] },
  rcMeta = null,
  rawNonIndexable = { items: [], totalCount: 0, metadata: [] },
  rawResources = { results: [], metadata: [] },
  resMeta = null,
  acquisition = null,
  links,
  limitations,
  rawTaskId,
  startedAt,
  completedAt,
  totalCrawlPages,
  cappedPages,
  jsContentMissing,
  robotsBlocked,
  loginBlocked,
}) {
  const domain = domainOf(targetUrl);

  // ── Pages used for content-quality counts ────────────────────────────
  // 404 and other error pages should not count toward missing-title,
  // missing-description, h1-missing, etc. — those pages are excluded from
  // content-quality assessment.  Site-level metrics (pageCount, statusCounts)
  // still include all pages.
  const contentPages = pages.filter((p) => p.status >= 200 && p.status < 400);

  // ── Deep sub-acquisition normalization (PRYSM-NEXT-01 WP-B-09) ──────
  const contentParsing = normalizeContentParsing(rawContentParsing);
  const redirectChains = normalizeRedirectChains(rawRedirectChains);
  const nonIndexablePages = normalizeNonIndexable(rawNonIndexable);
  const pageResources = normalizePageResources(rawResources);
  const microdataTypes = extractMicrodataTypes(rawMicrodata);

  // ── CRIT defect 2a — parsed content is evidence, not waste ────────────
  // The pages endpoint provides no body text.  When the content-parsing
  // endpoint returned real main content for a key page, hydrate that text
  // into the page evidence path so content-dependent signal detection
  // (trust/proof, offer) runs on ACTUAL parsed evidence with documented
  // key-page scoping.  CTA/form/path evidence is NOT fabricated from
  // parsed text — `_interactiveEvidenceAvailable: false` marks that
  // interactive extraction did not run (capability layer honours it).
  const cpByUrl = new Map(contentParsing.map((c) => [normalizeUrl(c.url || ""), c]));
  for (const page of pages) {
    const cp = cpByUrl.get(normalizeUrl(page.crawledUrl || page.url || ""));
    if (cp && cp.hasMainContent && cp.text) {
      page.bodyText = cp.text;
      page._contentAvailable = true;
      page.signals = detectTrustSignals(cp.text, page.title, page.description || "", page);
    }
  }

  // ── Content evidence availability ─────────────────────────────────────
  // DataForSEO /on_page/pages endpoint returns metadata only (no body text,
  // no link/image arrays, no structured_data).  When no content-page has
  // _contentAvailable === true (neither raw body text nor content-parsing
  // text), content-dependent signals must be treated as unavailable rather
  // than confirmed-absent.
  const contentEvidenceAvailable = contentPages.length > 0
    && contentPages.some((p) => p._contentAvailable === true);

  const allSchema = new Set(pages.flatMap((p) => p.schemaTypes));
  for (const t of microdataTypes) allSchema.add(t);
  const allServices = new Set(pages.flatMap((p) => p.serviceCandidates));

  // Build topic keywords from validated services, titles, and H1s.
  //
  // Domain-stripping: page titles commonly include the site name/domain
  // (e.g. "Home :: maycrawford.com").  After cleaning, this becomes
  // "home maycrawfordcom" — the domain fragment must be removed.
  const domainFragment = domain.replace(/\./g, "").toLowerCase();
  const domainAltFragment = domain.replace(/^www\./, "").replace(/\./g, "").toLowerCase();

  // Navigation/utility page labels that should never become topics.
  const UTILITY_LABELS = new Set([
    "home", "about", "about us", "blog", "news", "contact", "connect",
    "login", "sign in", "register", "sign up", "call scheduler",
    "scheduler", "book now", "schedule", "appointment", "get started",
    "welcome", "resources", "privacy policy", "terms of service",
    "terms and conditions", "faq", "frequently asked questions",
    "search", "search results", "404", "page not found", "sitemap",
    "accessibility", "cookies", "cookie policy", "refund policy",
    "shipping", "returns", "careers", "jobs", "press", "media",
    "subscribe", "newsletter", "vip club", "gold goal card",
    "vision board", "keynote speaking",
  ]);

  const phraseCounts = new Map();
  function addPhrase(phrase) {
    const cleaned = phrase
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Strip domain fragments that survived cleaning (e.g. "maycrawfordcom")
    let stripped = cleaned;
    if (domainFragment.length > 3) {
      stripped = stripped.replace(new RegExp(`\\b${domainFragment}\\b`, "g"), "").trim();
      if (domainAltFragment !== domainFragment && domainAltFragment.length > 3) {
        stripped = stripped.replace(new RegExp(`\\b${domainAltFragment}\\b`, "g"), "").trim();
      }
    }
    // Also strip standalone "com" that results from partial domain removal
    stripped = stripped.replace(/\bcom\b/g, "").replace(/\s+/g, " ").trim();

    if (!stripped || stripped.length < 3) return;

    const words = stripped.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 5) return;
    if (words.length === 1) {
      const w = words[0].replace(/-/g, "");
      if (w.length < 5) return;
    }

    // Reject known utility/navigation labels
    if (UTILITY_LABELS.has(stripped)) return;

    // Reject malformed mailto/URL fragments
    if (/\bmailto\b|\binfo@|\bwww\.|\bhttp/.test(stripped)) return;

    // Reject phrases that are just a single generic word
    const GENERIC_SINGLE = new Set([
      "about", "contact", "services", "service", "learn", "more", "home",
      "welcome", "assessment", "solution", "solutions", "page", "online",
      "better", "right", "good", "great", "professional", "quality",
      "expert", "experts", "dedicated", "comprehensive", "complete",
      "custom", "personal", "individual", "unique", "innovative",
      "advanced", "modern", "proven", "trusted", "leading", "premier",
      "premium", "affordable", "effective", "efficient", "reliable",
      "convenient", "flexible", "login", "register", "blog", "news",
    ]);
    if (words.length === 1 && GENERIC_SINGLE.has(words[0])) return;

    phraseCounts.set(stripped, (phraseCounts.get(stripped) || 0) + 1);
  }

  for (const svc of allServices) addPhrase(svc);
  for (const page of pages) {
    if (page.title) addPhrase(page.title);
    for (const h1 of page.headings.h1) addPhrase(h1);
  }

  const topicKeywords = [...phraseCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([phrase]) => phrase);

  // ── Internal links ──────────────────────────────────────────────────
  // DataForSEO /on_page/links endpoint returns items with link_to/link_from
  // (not url/href).  The legacy crawler and fixture tests use url/href.
  // Accept both formats and resolve to the best available destination URL.
  function linkDestinationUrl(l) {
    return l.link_to || l.url || l.href || "";
  }

  const internalLinks = links.filter((l) => {
    try {
      return domainOf(linkDestinationUrl(l)) === domain;
    } catch {
      return false;
    }
  });

  // ── Page-level content aggregates ────────────────────────────────────
  const allCtas = pages.flatMap((p) => p.ctas);
  const externalCtas = allCtas.filter((cta) => {
    try {
      return domainOf(cta.url) !== domain;
    } catch {
      return false;
    }
  });

  // Security headers from first page's response headers.
  // DataForSEO /on_page/pages endpoint does not return response headers,
  // so this will be {} in production.  The legacy crawler (page-extractor.js)
  // sets real headers because it performs HTTP fetches directly.
  const firstPageHeaders = pages[0]?.responseHeaders || {};
  const responseHeadersAvailable = Object.keys(firstPageHeaders).length > 0;
  const securityHeaders = {
    xFrameOptions: Boolean(firstPageHeaders["x-frame-options"]),
    xContentTypeOptions: Boolean(firstPageHeaders["x-content-type-options"]),
    referrerPolicy: Boolean(firstPageHeaders["referrer-policy"]),
    contentSecurityPolicy: Boolean(firstPageHeaders["content-security-policy"]),
  };

  // Platform from most common detection across pages
  const platforms = pages.map((p) => p.platform).filter(Boolean);
  const platformCounts = new Map();
  for (const p of platforms) {
    platformCounts.set(p, (platformCounts.get(p) || 0) + 1);
  }
  let dominantPlatform = "Unknown";
  let maxCount = 0;
  for (const [plat, count] of platformCounts) {
    if (count > maxCount) {
      maxCount = count;
      dominantPlatform = plat;
    }
  }

  // Status counts
  const statusCounts = pages.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  // All images
  const allImages = pages.flatMap((p) => p.images);

  // Forms across all pages
  const allForms = pages.flatMap((p) => p.forms);

  // Social links across all pages
  const allSocialLinks = pages.flatMap((p) => p.socialLinks);

  // Broken internal links — PRYSM production defect 3.
  // Trace every broken destination to its source page using the
  // already-retrieved link graph (link_from → link_to).  Destinations
  // without a proven source edge keep a record WITHOUT a source field so
  // downstream renderers never fabricate "unknown → unknown" traceability.
  const brokenInternalLinks = [];
  // Proven source edges from the already-retrieved link graph (link_from →
  // link_to), keyed by destination.  One record per broken page; the source
  // is attached only when an edge proves it — never fabricated.
  const sourceByDest = new Map();
  for (const l of links) {
    const dest = linkDestinationUrl(l);
    if (!dest) continue;
    const key = normalizeUrl(dest);
    if (!sourceByDest.has(key)) sourceByDest.set(key, []);
    if (l.link_from) sourceByDest.get(key).push(l.link_from);
  }
  for (const p of pages) {
    if (p.status >= 400) {
      const sources = sourceByDest.get(normalizeUrl(p.url || "")) || [];
      const record = { url: p.url };
      if (sources.length) record.source = sources[0];
      brokenInternalLinks.push(record);
    }
  }

  // ── Aggregate metrics from DataForSEO summary page_metrics ──────────
  // When page_metrics is present it contains authoritative provider-side
  // counts (links_internal, checks.no_h1_tag, etc.).  These are preferred
  // over page-derived counts when the pages endpoint doesn't provide
  // content-level data.
  const pageMetrics = rawSummary?.page_metrics;
  const metricChecks = pageMetrics?.checks || {};

  // imageCount: use page_metrics-derived estimate when image arrays aren't
  // available from individual pages.
  const hasPageImageData = allImages.length > 0;
  const imageCount = hasPageImageData
    ? allImages.length
    : null; // unavailable from DataForSEO — returned as null

  // h1Missing: prefer page_metrics.checks.no_h1_tag when page-level
  // headings were not extracted from body content.
  const hasPageHeadingData = pages.some((p) => p.headings.h1.length > 0);
  const h1Missing = hasPageHeadingData
    ? contentPages.filter((p) => p.headings.h1.length === 0).length
    : (metricChecks.no_h1_tag ?? null);

  const h1Multiple = hasPageHeadingData
    ? contentPages.filter((p) => p.headings.h1.length > 1).length
    : null;

  // missingDescriptions: prefer page_metrics.checks.no_description
  const hasPageDescriptionData = pages.some((p) => p.description);
  const missingDescriptions = hasPageDescriptionData
    ? contentPages.filter((p) => !p.description).length
    : (metricChecks.no_description ?? null);

  // imagesMissingAlt: prefer page_metrics.checks.no_image_alt
  const imagesMissingAlt = hasPageImageData
    ? allImages.filter((img) => !img.alt).length
    : (metricChecks.no_image_alt ?? null);

  const imagesMissingDimensions = hasPageImageData
    ? allImages.filter((img) => !img.width || !img.height).length
    : null;

  // missingTitles and missingCanonicals: page-level only from DataForSEO
  // (the summary doesn't have authoritative count fields for these).
  const missingTitles = contentPages.filter((p) => !p.title).length;
  const missingCanonicals = contentPages.filter((p) => !p.canonical).length;

  // internalLinkCount: use page_metrics.links_internal when link arrays
  // were not extracted from page content.
  const hasLinkArrayData = links.length > 0;
  const internalLinkCount = hasLinkArrayData
    ? internalLinks.length
    : (pageMetrics?.links_internal ?? null);

  // totalWords / averageWords: sum from page-level word counts
  const totalWords = contentPages.reduce((sum, p) => sum + (p.words || 0), 0);
  const averageWords = contentPages.length
    ? Math.round(totalWords / contentPages.length)
    : null;

  // broken_links count from summary
  const brokenLinksCount = pageMetrics?.broken_links ?? null;

  // ── Trust signals ────────────────────────────────────────────────────
  // When content evidence is not available (DataForSEO pages endpoint
  // doesn't return body text), trust signals are reported as false with
  // a clear content-availability marker.  Downstream consumers should
  // check _contentEvidenceAvailable before treating false as "confirmed
  // absent".
  const trust = {
    testimonials: contentEvidenceAvailable
      ? pages.some((p) => p.signals.testimonials)
      : false,
    credentials: contentEvidenceAvailable
      ? pages.some((p) => p.signals.credentials)
      : false,
    caseStudies: contentEvidenceAvailable
      ? pages.some((p) => p.signals.caseStudies)
      : false,
    faq: contentEvidenceAvailable
      ? pages.some((p) => p.signals.faq)
      : false,
    pricing: contentEvidenceAvailable
      ? pages.some((p) => p.signals.pricing)
      : false,
    policies: contentEvidenceAvailable
      ? pages.some((p) => p.signals.policies)
      : false,
    contact: contentEvidenceAvailable
      ? pages.some((p) => p.signals.contact)
      : false,
  };

  // ── Source status ────────────────────────────────────────────────────
  let sourceStatus = SOURCE_STATUS.AVAILABLE;

  if (robotsBlocked || loginBlocked) {
    sourceStatus = SOURCE_STATUS.BLOCKED;
  } else if (!pages.length) {
    sourceStatus = SOURCE_STATUS.FAILED;
  } else if (cappedPages || jsContentMissing || !contentEvidenceAvailable) {
    // PARTIAL when: page ceiling hit, JS content missing, OR content
    // evidence (body text, link/images arrays, structured data) is
    // unavailable from the provider.
    sourceStatus = SOURCE_STATUS.PARTIAL;
  }

  const requestedCrawlRecords = Math.max(
    pages.length,
    totalCrawlPages ?? pages.length,
  );

  const coverage = {
    requested: requestedCrawlRecords,
    completed: pages.length,
    failed: Math.max(
      0,
      requestedCrawlRecords - pages.length,
    ),
  };

  // Collect limitation strings
  const allLimitations = [...limitations];
  if (cappedPages) {
    allLimitations.push(
     `Page ceiling reached after ${pages.length} pages crawled`,
    );
  }
  if (jsContentMissing) {
    allLimitations.push(
      "JavaScript content may be partially missing on some pages",
    );
  }
  if (robotsBlocked) {
    allLimitations.push("Site blocked by robots.txt or access restrictions");
  }
  if (loginBlocked) {
    allLimitations.push("Site requires authentication (login wall)");
  }
  if (!contentEvidenceAvailable && pages.length > 0) {
    allLimitations.push(
      "Page body content, link arrays, image arrays, CTAs, forms, " +
      "and structured data are not extracted by the DataForSEO On-Page " +
      "pages endpoint. Content-dependent signals (trust, CTAs, forms, " +
      "schemas) are reported as unavailable rather than confirmed absent.",
    );
  }
  if (hasPageHeadingData === false && pages.length > 0) {
    allLimitations.push(
      "Per-page heading data was not extracted from page content; " +
      "heading counts are sourced from the DataForSEO summary page_metrics.",
    );
  }

  // Error category
  let errorCategory = null;
  if (robotsBlocked || loginBlocked) {
    errorCategory = null; // BLOCKED is expected, not an error
  } else if (sourceStatus === SOURCE_STATUS.FAILED) {
    errorCategory = ERROR_CATEGORY.NO_DATA;
  }

  // CRIT rescore #3 — this was an unreachable `return {` making the
  // SHA-256 provenance block below dead code; the rawArtifactRef never
  // gained its hash suffix.  Now the envelope is built, THEN stamped.
  const result = {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "dataforseo-onpage",
    sourceStatus,
    targetUrl,
    domain,
    crawledAt: completedAt,
    pages,
    pageCount: pages.length,
    robotsText: "", // DataForSEO handles robots internally
    sitemapUrls: rawSummary?.sitemap?.urls || [],
    statusCounts,
    totalWords,
    averageWords,
    missingTitles,
    missingDescriptions,
    missingCanonicals,
    h1Missing,
    h1Multiple,
    imageCount,
    imagesMissingAlt,
    imagesMissingDimensions,
    schemaTypes: [...allSchema],
    microdataTypes,
    forms: allForms,
    ctas: allCtas,
    externalCtas,
    socialLinks: allSocialLinks,
    internalLinkCount,
    brokenInternalLinks,
    brokenLinksCount,
    platform: dominantPlatform,
    services: [...allServices].slice(0, 12),
    topicKeywords,
    // PRYSM-NEXT-01 WP-B-09 — deep acquisition evidence (unknown stays null)
    contentParsing,
    redirectChains,
    nonIndexablePages,
    pageResources,
    acquisition: acquisition || {
      contentParsing: { requested: 0, completed: 0, failed: 0 },
      redirectChains: { requested: 0, completed: 0, failed: 0 },
      nonIndexable: { requested: 0, completed: 0, failed: 0 },
      resources: { requested: 0, completed: 0, failed: 0 },
      microdata: { requested: 0, completed: 0, failed: 0 },
    },
    trust,
    securityHeaders,
    limitations: allLimitations,
    collectedAt: completedAt,
    coverage,
    rawArtifactRef: rawTaskId
      ? `dataforseo://on_page/${rawTaskId}`
      : null,
    // Evidence-audit item 2 — the frozen decision-evidence schema coerces
    // counters to integers at hydration; per-FIELD availability markers
    // declare which counters were ACTUALLY collected (page-level data or
    // page_metrics checks).  Scorers gate each meta term on its field.
    _metaFieldAvailability: {
      titles: true, // page-derived (computed from collected page titles)
      descriptions:
        hasPageDescriptionData || typeof metricChecks.no_description === "number",
      canonicals: true, // page-derived (computed from collected canonicals)
      headings:
        hasPageHeadingData || typeof metricChecks.no_h1_tag === "number",
    },
    _contentEvidenceAvailable: contentEvidenceAvailable,
    _responseHeadersAvailable: responseHeadersAvailable,
    // CRIT defect 2a — parsed text proves CONTENT, not interactive
    // extraction (CTAs/forms/paths).  The capability layer must not treat
    // empty CTA/form arrays on this source as confirmed absence.
    _interactiveEvidenceAvailable: false,
    _sourceStatus: buildSourceStatus({
      provider: "dataforseo-onpage",
      adapterVersion: ADAPTER_VERSION,
      startedAt,
      completedAt,
      requestId: rawTaskId || null,
      retryCount: 0,
      returnedRecordCount: pages.length,
      expectedRecordCount: requestedCrawlRecords,
      errorCategory,
      limitation: allLimitations.join("; ") || null,
      rawArtifactRef: rawTaskId
        ? `dataforseo://on_page/${rawTaskId}`
        : null,
    }),
    // ── Raw artifact with SHA-256 proof ───────────────────────────
    _raw: {
      taskId: rawTaskId,
      summary: rawSummary,
      duplicateTags: rawDuplicateTags,
      duplicateContent: rawDuplicateContent,
      microdata: rawMicrodata,
      dtMeta: dtMeta || null,
      dcMeta: dcMeta || null,
      microdataMeta: microdataMeta || null,
      contentParsing: rawContentParsing,
      cpMeta: cpMeta || null,
      redirectChains: rawRedirectChains,
      rcMeta: rcMeta || null,
      nonIndexable: rawNonIndexable,
      resources: rawResources,
      resMeta: resMeta || null,
    },
  };

  // Compute SHA-256 of the raw artifact for proof of preservation
  const rawArtifactPayload = JSON.stringify(result._raw);
  const rawHash = createHash("sha256").update(rawArtifactPayload).digest("hex");
  const rawBytes = Buffer.byteLength(rawArtifactPayload, "utf8");
  result._rawSha256 = rawHash;
  result._rawBytes = rawBytes;
  result.rawArtifactRef = rawTaskId
    ? `dataforseo://on_page/${rawTaskId}?sha256=${rawHash}`
    : null;

  return result;
}

// ---------------------------------------------------------------------------
// Main adapter entry point
// ---------------------------------------------------------------------------

/**
 * Crawl a website using the DataForSEO On-Page API.
 *
 * This is the primary crawl provider for Vantage Phase 1 (PRD v3.0 §8).
 * It replaces the Screaming Frog / cheerio-based crawler for production use.
 *
 * @param {string} target - Target URL or domain.
 * @param {object} [options] - Crawl configuration.
 * @param {number} [options.maxPages=250] - Maximum pages to crawl; hard-capped at 250.
 * @param {number} [options.maxDepth] - Maximum crawl depth.
 * @param {boolean} [options.enableJavascript=false] - Enable JS rendering.
 * @param {boolean} [options.enableBrowserRendering=false] - Full browser rendering.
 * @param {boolean} [options.loadResources=true] - Load page resources.
 * @param {Array<string>} [options.includePatterns] - URL include patterns.
 * @param {Array<string>} [options.excludePatterns] - URL exclude patterns.
 * @param {number} [options.maxExternalResources] - External resource limit.
 * @param {number} [options.pollTimeoutMs=1800000] - Polling timeout in ms.
 * @param {number} [options.pollIntervalMs=10000] - Polling interval in ms.
 * @param {object} [options.clientOptions] - Client-level options (mode, fixtures, fetchImpl).
 * @returns {Promise<object>} Canonical site evidence envelope.
 */
export async function crawlWithDataforseo(target, options = {}) {
  const startedAt = new Date().toISOString();
  const limitations = [];
  const clientOpts = options.clientOptions || {};

  const client = createDataforseoOnpageClient({
    mode: clientOpts.mode || (clientOpts.fixtures ? "fixture" : "live"),
    fixtures: clientOpts.fixtures,
    fetchImpl: clientOpts.fetchImpl,
  });

  const requestedMaxPages = options.maxPages ?? DEFAULTS.maxPages;
  const maxPages = resolveProviderMaxPages(requestedMaxPages);

  if (Number(requestedMaxPages) > HARD_MAX_PROVIDER_PAGES) {
    limitations.push(
      `Requested crawl ceiling ${requestedMaxPages} was reduced to the governed ${HARD_MAX_PROVIDER_PAGES}-page provider maximum.`,
    );
  }

  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULTS.pollTimeoutMs;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULTS.pollIntervalMs;

  const siteFootprint = await resolveSiteFootprint(
    target,
    options,
    {
      ...clientOpts,
      mode:
        clientOpts.mode ||
        (clientOpts.fixtures ? "fixture" : "live"),
    },
  );

  const footprintMode =
    clientOpts.mode ||
    (clientOpts.fixtures ? "fixture" : "live");

  if (
    (options.siteFootprint || footprintMode !== "fixture") &&
    Array.isArray(siteFootprint?.limitations)
  ) {
    for (const limitation of siteFootprint.limitations) {
      limitations.push(
        `Sitemap footprint: ${limitation}`,
      );
    }
  }

  let rawTaskId = null;
  let retryCount = 0;
  let taskPostResult = null;

  // PRYSM-CLOSE-12: resuming a previously created provider task.
  // When a durable task ID is supplied, NO new paid task is submitted —
  // polling continues against the same task.
  const resumeTaskId = options.resumeTaskId || null;

  // -----------------------------------------------------------------------
  // Step 1: Submit task (skipped when resuming an existing provider task)
  // -----------------------------------------------------------------------
  try {
    if (resumeTaskId) {
      rawTaskId = resumeTaskId;
      taskPostResult = { taskId: resumeTaskId, resumed: true };
    } else {
      taskPostResult = await client.taskPost(target, {
        maxPages,
        maxDepth: options.maxDepth,
        enableJavascript: options.enableJavascript ?? DEFAULTS.enableJavascript,
        enableBrowserRendering:
          options.enableBrowserRendering ?? DEFAULTS.enableBrowserRendering,
                loadResources: options.loadResources ?? DEFAULTS.loadResources,
        priorityUrls:
          siteFootprint?.priorityUrls ||
          options.priorityUrls ||
          [],
        respectSitemap:
          options.respectSitemap ??
          (siteFootprint?.coverage?.usableSitemap === true),
        returnDespiteTimeout:
          options.returnDespiteTimeout ?? true,
        includePatterns: options.includePatterns,
        excludePatterns: options.excludePatterns,
        maxExternalResources: options.maxExternalResources,
        customRobotsTxt: options.customRobotsTxt || null,
        // PRYSM-NEXT-01 WP-B-02: prerequisites for microdata and
        // content-parsing sub-endpoints.
        validateMicromarkup: options.validateMicromarkup ?? DEFAULTS.validateMicromarkup,
        enableContentParsing: options.enableContentParsing ?? DEFAULTS.enableContentParsing,
      });
      rawTaskId = taskPostResult.taskId;
    }
  } catch (error) {
    const completedAt = new Date().toISOString();
    const isQuota = error.category === "rate_limit" ||
      /429|quota|rate.limit/i.test(error.message);
    const isAuth = error.category === "auth" ||
      /401|403|unauthorized|authentication/i.test(error.message);

    return buildFailedEnvelope({
      target,
      sourceStatus: isAuth ? SOURCE_STATUS.FAILED : SOURCE_STATUS.FAILED,
      errorCategory: isQuota
        ? ERROR_CATEGORY.RATE_LIMIT
        : isAuth
          ? ERROR_CATEGORY.AUTH
          : ERROR_CATEGORY.NETWORK,
      startedAt,
      completedAt,
      rawTaskId: null,
      retryCount,
      limitations: [`Task submission failed: ${error.message}`],
      error,
    });
  }

  // -----------------------------------------------------------------------
  // Step 2: Poll for completion
  // -----------------------------------------------------------------------
  try {
    await client.pollTask(rawTaskId, {
      timeoutMs: pollTimeoutMs,
      pollIntervalMs,
    });
  } catch (error) {
    const completedAt = new Date().toISOString();

    // Detect timeout
    if (/timed out/i.test(error.message)) {
      return buildFailedEnvelope({
        target,
        sourceStatus: SOURCE_STATUS.FAILED,
        errorCategory: ERROR_CATEGORY.TIMEOUT,
        startedAt,
        completedAt,
        rawTaskId,
        retryCount,
        limitations: [
          `Task ${rawTaskId} polling timed out after ${pollTimeoutMs}ms`,
        ],
        error,
      });
    }

    return buildFailedEnvelope({
      target,
      sourceStatus: SOURCE_STATUS.FAILED,
      errorCategory: ERROR_CATEGORY.INTERNAL,
      startedAt,
      completedAt,
      rawTaskId,
      retryCount,
      limitations: [`Task polling failed: ${error.message}`],
      error,
    });
  }

  // -----------------------------------------------------------------------
  // Step 3: Retrieve results
  // -----------------------------------------------------------------------
  let rawSummary;
  let rawPages = [];
  let rawLinks = [];
  let rawDuplicateTags = { results: [], metadata: [] };
  let rawDuplicateContent = { results: [], metadata: [] };
  let rawMicrodata = null;
  let microdataMeta = null;
  let dtMeta = null;
  let dcMeta = null;
  let rawContentParsing = { results: [], metadata: [] };
  let rawRedirectChains = { results: [], metadata: [] };
  let rawNonIndexable = { items: [], totalCount: 0, metadata: [] };
  let rawResources = { results: [], metadata: [] };
  let cpMeta = null;
  let rcMeta = null;
  let resMeta = null;
  const acquisition = {
    contentParsing: { requested: 0, completed: 0, failed: 0 },
    redirectChains: { requested: 0, completed: 0, failed: 0 },
    nonIndexable: { requested: 0, completed: 0, failed: 0 },
    resources: { requested: 0, completed: 0, failed: 0 },
    microdata: { requested: 0, completed: 0, failed: 0 },
  };
  let cappedPages = false;
  let jsContentMissing = false;
  let robotsBlocked = false;
  let loginBlocked = false;
  let totalCrawlPages = null;
  let normalizedPages = [];

  try {
    // 3a. Retrieve summary
    rawSummary = await client.getSummary(rawTaskId);

    // Check for blocking conditions from summary
    // §BLOCKED detection: uses provider-shaped fields from DataForSEO
    if (rawSummary) {
      const domainInfo = rawSummary.domain_info || {};
      const checks = domainInfo.checks || {};
      const crawlStatus = rawSummary.crawl_status || {};
      const crawlStatusStr = typeof crawlStatus === "string" ? crawlStatus : "";
      const extendedStatus = domainInfo.extended_crawl_status || crawlStatusStr;
      const startPageStatusCode = domainInfo.start_page_status_code || 0;

      // Production-shaped BLOCKED detection
      if (
        extendedStatus === "forbidden_robots" ||
        checks.start_page_deny_flag === true ||
        startPageStatusCode === 401 ||
        startPageStatusCode === 403 ||
        /blocked|robots/i.test(crawlStatusStr) ||
        /login|auth|forbidden/i.test(crawlStatusStr)
      ) {
        if (
          extendedStatus === "forbidden_robots" ||
          checks.start_page_deny_flag === true ||
          /blocked|robots/i.test(crawlStatusStr)
        ) {
          robotsBlocked = true;
        } else {
          loginBlocked = true;
        }
      }

      // §Crawl-limit detection: authoritative fields from crawl_status
      const crawlStopReason =
        crawlStatus.crawl_stop_reason ||
        rawSummary.crawl_stop_reason ||
        "";

      const maxCrawlPages =
        crawlStatus.max_crawl_pages ??
        rawSummary.max_crawl_pages ??
        maxPages;

      const pagesCrawled =
        crawlStatus.pages_crawled ??
        rawSummary.pages_crawled ??
        null;

      const pagesInQueue =
        crawlStatus.pages_in_queue ??
        rawSummary.pages_in_queue ??
        0;

      cappedPages =
        crawlStopReason === "limit_exceeded";

      // Evidence volume comes from provider-observed crawl execution.
      // max_crawl_pages is only a ceiling and must never become an
      // expected/requested record count.
      if (
        pagesCrawled !== null &&
        Number.isFinite(Number(pagesCrawled))
      ) {
        totalCrawlPages =
          Number(pagesCrawled);
      }

      // Record crawl-limit metadata
      if (cappedPages) {
        limitations.push(
          `Crawl stopped: ${crawlStopReason} (limit: ${maxCrawlPages}, crawled: ${pagesCrawled}, queued: ${pagesInQueue})`,
        );
      }
    }

    // If blocked, return early with no pages
    if (robotsBlocked || loginBlocked) {
      const completedAt = new Date().toISOString();
      return {
        evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
        source: "dataforseo-onpage",
        sourceStatus: SOURCE_STATUS.BLOCKED,
        status: SOURCE_STATUS.BLOCKED,
        targetUrl: target,
        domain: domainOf(target),
        crawledAt: completedAt,
        pages: [],
        pageCount: 0,
        robotsText: "",
        sitemapUrls: [],
        statusCounts: {},
        totalWords: 0,
        averageWords: 0,
        missingTitles: 0,
        missingDescriptions: 0,
        missingCanonicals: 0,
        h1Missing: 0,
        h1Multiple: 0,
        imageCount: 0,
        imagesMissingAlt: 0,
        imagesMissingDimensions: 0,
        schemaTypes: [],
        forms: [],
        ctas: [],
        externalCtas: [],
        socialLinks: [],
        internalLinkCount: 0,
        brokenInternalLinks: [],
        brokenLinksCount: null,
        platform: "Unknown",
        services: [],
        topicKeywords: [],
        trust: {
          testimonials: false,
          credentials: false,
          caseStudies: false,
          faq: false,
          pricing: false,
          policies: false,
          contact: false,
        },
        securityHeaders: {
          xFrameOptions: false,
          xContentTypeOptions: false,
          referrerPolicy: false,
          contentSecurityPolicy: false,
        },
        limitations: [
          robotsBlocked
            ? "Site blocked by robots.txt — crawl not attempted"
            : "Site requires authentication — crawl not attempted",
        ],
        collectedAt: completedAt,
        coverage: { requested: 0, completed: 0, failed: 0 },
        rawArtifactRef: `dataforseo://on_page/${rawTaskId}`,
        _contentEvidenceAvailable: false,
        _responseHeadersAvailable: false,
        _sourceStatus: buildSourceStatus({
          provider: "dataforseo-onpage",
          adapterVersion: ADAPTER_VERSION,
          startedAt,
          completedAt,
          requestId: rawTaskId,
          retryCount,
          returnedRecordCount: 0,
          expectedRecordCount: 0,
          errorCategory: null,
          limitation: robotsBlocked
            ? "robots.txt blocked the crawl"
            : "login wall blocked the crawl",
          rawArtifactRef: `dataforseo://on_page/${rawTaskId}`,
        }),
        _raw: { taskId: rawTaskId, summary: rawSummary },
      };
    }

    // 3b. Retrieve pages (paginated)
       rawPages = await client.getAllPages(rawTaskId, { maxPages });

    // Crawl coverage is based on provider-observed execution volume,
    // never on the configured max_crawl_pages ceiling.
    if (totalCrawlPages == null) {
      totalCrawlPages = rawPages.length;
    }

    // Page ceiling detection: only report capped when more pages
    // existed than were actually retrieved (i.e. we hit a genuine
    // ceiling where the provider stopped short of the full site).
    const morePagesExistBeyondRetrieved = totalCrawlPages > rawPages.length;
    if (rawPages.length >= maxPages && morePagesExistBeyondRetrieved) {
      cappedPages = true;
      limitations.push(
        `Page ceiling reached: ${rawPages.length} pages crawled (limit ${maxPages})`,
      );
    }

    // 3c. Retrieve links
    try {
      rawLinks = await client.getAllLinks(rawTaskId, {
        maxLinks: maxPages * 20,
      });
    } catch (linkError) {
      limitations.push(`Link retrieval failed: ${linkError.message}`);
    }

    // 3c2. Normalize pages EARLY so the deterministic key-page selector can
    // scope deep sub-acquisitions (content parsing, redirect chains,
    // resources) to decision-bearing pages only (PRYSM-NEXT-01 WP-B-08).
    const targetDomainEarly = domainOf(target);
    // Production /on_page/links records carry source/destination edges as
    // link_from/link_to, while /on_page/pages normally carries counts only.
    // Attach those already-fetched edges to their normalized source pages so
    // downstream internal-link analysis can prove a link is actually missing.
    const linksBySource = new Map();
    for (const link of rawLinks) {
      const sourceUrl = link.link_from || "";
      const destinationUrl = link.link_to || link.url || link.href || "";
      if (!sourceUrl || !destinationUrl) continue;
      const sourceKey = normalizeUrl(sourceUrl);
      if (!sourceKey) continue;
      const sourceLinks = linksBySource.get(sourceKey) || [];
      sourceLinks.push(link);
      linksBySource.set(sourceKey, sourceLinks);
    }
    normalizedPages = rawPages.map((raw) => {
      const pageUrl = raw.url || raw.location || "";
      return normalizePage(raw, {
        targetDomain: targetDomainEarly,
        links: linksBySource.get(normalizeUrl(pageUrl)) || [],
      });
    });

    // 3d. Retrieve duplicate tags (with required `type` fields, polls through 20100)
    try {
      rawDuplicateTags = await client.getDuplicateTags(rawTaskId,
        ["duplicate_title", "duplicate_description"]);
      dtMeta = rawDuplicateTags.metadata;
      for (const m of (dtMeta || [])) {
        if (m.timedOut) {
          limitations.push(
            `Duplicate ${m.type} retrieval timed out after ${m.retryCount} retries ` +
            `(final code ${m.finalCode ?? "none"}).`);
        } else if (m.finalCode !== 20000 && m.finalCode != null) {
          limitations.push(
            `Duplicate ${m.type} returned status code ${m.finalCode}: "${m.finalMessage || "unknown"}". ` +
            `Retries: ${m.retryCount}.`);
        }
      }
    } catch (dtError) {
      limitations.push(`Duplicate tag retrieval failed: ${dtError.message}`);
    }

    // 3e. Retrieve duplicate content (with required `url` fields, polls through 20100)
    try {
      // Get crawled page URLs for duplicate content checking (max 10 for safety)
      const pageUrlsForDup = (rawPages || []).slice(0, 10).map(p => p.url || p.location).filter(Boolean);
      rawDuplicateContent = await client.getDuplicateContent(rawTaskId, pageUrlsForDup,
        { maxUrls: 10 });
      dcMeta = rawDuplicateContent.metadata;
      for (const m of (dcMeta || [])) {
        if (m.timedOut) {
          limitations.push(
            `Duplicate content for ${m.url} timed out after ${m.retryCount} retries.`);
        } else if (m.finalCode !== 20000 && m.finalCode != null) {
          limitations.push(
            `Duplicate content for ${m.url} returned code ${m.finalCode}: "${m.finalMessage || "unknown"}".`);
        }
      }
    } catch (dcError) {
      limitations.push(`Duplicate content retrieval

        failed: ${dcError.message}`);
    }

        // Build the deterministic key-page set used by URL-scoped deep acquisitions.
    const keyPages = selectImportantPages({
      targetUrl: target,
      pages: normalizedPages,
      links: rawLinks,
      services: options.businessServices || [],
      maxSelected: 20,
    });

    // Merge business-critical pages with representatives from material
    // structural URL families. Provider sub-endpoints receive the exact
    // crawled URL already known to the DataForSEO task.
    const keyPageUrls = mergeDeepPageUrls({
      normalizedPages,
      keyPages,
      siteFootprint,
    });

    const contentParsingEnabled =
      options.enableContentParsing ??
      DEFAULTS.enableContentParsing;

    const contentParsingBudget =
      options.contentParsingPageLimit ??
      DEFAULTS.contentParsingPageLimit;

    const cpUrls =
      contentParsingEnabled
        ? keyPageUrls.slice(
            0,
            contentParsingBudget,
          )
        : [];

    const cpUnassessedUrls =
      contentParsingEnabled
        ? keyPageUrls.slice(
            contentParsingBudget,
          )
        : [...keyPageUrls];

    acquisition.contentParsing = {
      requested: cpUrls.length,
      completed: 0,
      failed: 0,
      selectedUrls: [...keyPageUrls],
      requestedUrls: [...cpUrls],
      completedUrls: [],
      failedUrls: [],
      unassessedUrls: cpUnassessedUrls,
      unassessedReason:
        cpUnassessedUrls.length > 0
          ? (
              contentParsingEnabled
                ? "CONTENT_PARSING_PAGE_LIMIT"
                : "CONTENT_PARSING_DISABLED"
            )
          : null,
    };

    if (cpUnassessedUrls.length > 0) {
      limitations.push(
        `${cpUnassessedUrls.length} governed Content Parsing URL(s) were not requested because ${
          contentParsingEnabled
            ? `the page limit is ${contentParsingBudget}`
            : "Content Parsing is disabled"
        }; these URLs are unassessed, not failed.`,
      );
    }

    const subPollOpts = {
      timeoutMs: options.subPollTimeoutMs ?? 120000,
      pollIntervalMs,
    };

          if (keyPageUrls.length === 0) {
      limitations.push(
        "No decision-bearing pages identified — microdata, content parsing, " +
        "redirect chains, and resource checks were skipped for this crawl.",
      );
    } else {
      // 3f. Retrieve microdata / structured data for the primary key page.
      // EVIDENCE-MATRIX: schema.structured_data — valid because the task was
      // created with validate_micromarkup (WP-B-02).
      acquisition.microdata.requested = 1;
      try {
        const mdResult = await client.getMicrodata(
          rawTaskId,
          keyPageUrls[0],
          subPollOpts,
        );
        rawMicrodata = mdResult.result || {};
        microdataMeta = mdResult.metadata;

        if (microdataMeta?.finalCode !== 20000 && microdataMeta?.finalCode != null) {
          acquisition.microdata.failed += 1;
          limitations.push(
            `Microdata retrieval returned code ${microdataMeta.finalCode}: "${microdataMeta.finalMessage || "unknown"}".`,
          );
        } else if (rawMicrodata?.items?.length || rawMicrodata?.types?.length) {
          acquisition.microdata.completed += 1;
        }
      } catch (mdError) {
        acquisition.microdata.failed += 1;
        limitations.push(`Microdata retrieval failed: ${mdError.message}`);
      }

      // 3g. Remaining deep sub-acquisitions scoped to the deterministic key-page set.

      // 3g1. Content parsing (key pages only)
      if (contentParsingEnabled) {
        try {
          rawContentParsing =
            await client.getContentParsing(
              rawTaskId,
              cpUrls,
              {
                ...subPollOpts,
                maxUrls: cpUrls.length,
              },
            );

          cpMeta =
            rawContentParsing.metadata || [];

          const metadataByUrl =
            new Map(
              cpMeta.map((metadata) => [
                normalizeUrl(metadata.url || ""),
                metadata,
              ]),
            );

          const resultUrls =
            new Set(
              (rawContentParsing.results || [])
                .map((result) =>
                  normalizeUrl(result.url || ""),
                )
                .filter(Boolean),
            );

          const completedUrls = [];
          const failedUrls = [];

          for (const url of cpUrls) {
            const normalized =
              normalizeUrl(url);

            const metadata =
              metadataByUrl.get(normalized);

            const failed =
              metadata
                ? (
                    metadata.timedOut === true ||
                    metadata.finalCode !== 20000
                  )
                : !resultUrls.has(normalized);

            if (failed) {
              failedUrls.push(url);
            } else {
              // A successful provider response is a completed
              // observation even when no main body was returned.
              completedUrls.push(url);
            }
          }

          acquisition.contentParsing.completedUrls =
            completedUrls;

          acquisition.contentParsing.failedUrls =
            failedUrls;

          acquisition.contentParsing.completed =
            completedUrls.length;

          acquisition.contentParsing.failed =
            failedUrls.length;

          for (const url of failedUrls) {
            const metadata =
              metadataByUrl.get(
                normalizeUrl(url),
              );

            limitations.push(
              `Content parsing for ${url} ${
                metadata?.timedOut
                  ? "timed out"
                  : `returned code ${
                      metadata?.finalCode ??
                      "unknown"
                    }`
              } after ${
                metadata?.retryCount ?? 0
              } retries.`,
            );
          }
        } catch (cpError) {
          acquisition.contentParsing.completed = 0;
          acquisition.contentParsing.completedUrls = [];

          acquisition.contentParsing.failed =
            cpUrls.length;

          acquisition.contentParsing.failedUrls =
            [...cpUrls];

          limitations.push(
            `Content parsing retrieval failed: ${cpError.message}`,
          );
        }
      }

      // 3g2. Redirect chains (key pages + pages observed with 3xx statuses)
      const redirectUrls = new Set(keyPageUrls);
      for (const p of rawPages) {
        const status = p.status_code ?? 0;
        if (status >= 300 && status < 400 && p.url) redirectUrls.add(p.url);
      }
      const rcUrls = [...redirectUrls].slice(
        0, options.redirectChainsPageLimit ?? DEFAULTS.redirectChainsPageLimit);
      acquisition.redirectChains.requested = rcUrls.length;
      try {
        rawRedirectChains = await client.getRedirectChains(rawTaskId, rcUrls, {
          ...subPollOpts,
          maxUrls: rcUrls.length,
        });
        rcMeta = rawRedirectChains.metadata;
        for (const res of rawRedirectChains.results) {
          if (res.items?.length || res.result) acquisition.redirectChains.completed += 1;
          else acquisition.redirectChains.failed += 1;
        }
        for (const m of (rcMeta || [])) {
          if (m.timedOut || (m.finalCode !== 20000 && m.finalCode != null)) {
            limitations.push(
              `Redirect-chain check for ${m.url} ${m.timedOut ? "timed out" : `returned code ${m.finalCode}`}.`);
          }
        }
      } catch (rcError) {
        acquisition.redirectChains.failed = acquisition.redirectChains.requested;
        limitations.push(`Redirect-chain retrieval failed: ${rcError.message}`);
      }

      // 3g3. Non-indexable pages (paginated, capped)
      acquisition.nonIndexable.requested = options.nonIndexableLimit ?? DEFAULTS.nonIndexableLimit;
      try {
        rawNonIndexable = await client.getNonIndexable(rawTaskId, {
          limit: 100,
          maxRecords: options.nonIndexableLimit ?? DEFAULTS.nonIndexableLimit,
          ...subPollOpts,
        });
        acquisition.nonIndexable.completed = rawNonIndexable.items?.length || 0;
        acquisition.nonIndexable.failed = 0;
        for (const m of (rawNonIndexable.metadata || [])) {
          if (m.timedOut || (m.finalCode !== 20000 && m.finalCode != null)) {
            limitations.push(
              `Non-indexable retrieval ${m.timedOut ? "timed out" : `returned code ${m.finalCode}`} at offset ${m.offset}.`);
          }
        }
      } catch (niError) {
        acquisition.nonIndexable.failed = acquisition.nonIndexable.requested;
        limitations.push(`Non-indexable retrieval failed: ${niError.message}`);
      }

      // 3g4. Resources (key pages only)
      const resUrls = keyPageUrls.slice(
        0, options.resourcesPageLimit ?? DEFAULTS.resourcesPageLimit);
      acquisition.resources.requested = resUrls.length;
      try {
        rawResources = await client.getResources(rawTaskId, resUrls, {
          ...subPollOpts,
          maxUrls: resUrls.length,
          limit: 500,
          offset: 0,
        });
        resMeta = rawResources.metadata;
        for (const res of rawResources.results) {
          if (res.items?.length || res.result) acquisition.resources.completed += 1;
          else acquisition.resources.failed += 1;
        }
        for (const m of (resMeta || [])) {
          if (m.timedOut || (m.finalCode !== 20000 && m.finalCode != null)) {
            limitations.push(
              `Resource check for ${m.url} ${m.timedOut ? "timed out" : `returned code ${m.finalCode}`}.`);
          }
        }
      } catch (resError) {
        acquisition.resources.failed = acquisition.resources.requested;
        limitations.push(`Resource retrieval failed: ${resError.message}`);
      }
    }

    // 3f. Detect JavaScript-content issues
    if (options.enableJavascript || options.enableBrowserRendering) {
      const jsPages = rawPages.filter(
        (p) =>
          p.enable_javascript ||
          p.enable_browser_rendering ||
          p.rendered_with_js,
      );
      if (jsPages.length > 0 && rawPages.some((p) => !p.meta?.title)) {
        jsContentMissing = true;
        limitations.push(
          "Some JavaScript-rendered pages may have incomplete content extraction",
        );
      }
    }
  } catch (error) {
    const completedAt = new Date().toISOString();
    return buildFailedEnvelope({
      target,
      sourceStatus: SOURCE_STATUS.FAILED,
      errorCategory: ERROR_CATEGORY.INTERNAL,
      startedAt,
      completedAt,
      rawTaskId,
      retryCount,
      limitations: [`Result retrieval failed: ${error.message}`],
      error,
    });
  }

  // -----------------------------------------------------------------------
  // Step 4: Normalize (pages were normalized in step 3c2 to scope the
  // key-page set; reuse that exact normalization here for continuity)
  // -----------------------------------------------------------------------
  const completedAt = new Date().toISOString();
  const targetDomain = domainOf(target);

    const result = summarizeSite({
    targetUrl: target,
    pages: normalizedPages,
    rawSummary,
    rawDuplicateTags,
    rawDuplicateContent,
    rawMicrodata,
    microdataMeta,
    dtMeta,
    dcMeta,
    rawContentParsing,
    cpMeta,
    rawRedirectChains,
    rcMeta,
    rawNonIndexable,
    rawResources,
    resMeta,
    acquisition,
    links: rawLinks,
    limitations,
    rawTaskId,
    startedAt,
    completedAt,
    totalCrawlPages,
    cappedPages,
    jsContentMissing,
    robotsBlocked,
    loginBlocked,
  });

  const programmaticSeo = analyzeProgrammaticSeo({
    siteFootprint,
    pages: result.pages,
    contentParsing: result.contentParsing,
    contentParsingAcquisition:
      result.acquisition?.contentParsing || null,
  });

  result.siteFootprint = siteFootprint;
  result.programmaticSeo = programmaticSeo;

  // ── Package raw artifact bytes for caller persistence ─────────────────
  // WP3: adapters return raw bytes to their caller; they no longer own
  // permanent artifact writes. The caller persists through the governed
  // Artifact Store.
  const artifactSlug = options.artifactSlug || null;
  const artifactRunId = options.artifactRunId || null;

  if (artifactSlug && artifactRunId && rawTaskId) {
    try {
      const rawPayload = {
        adapterVersion: ADAPTER_VERSION,
        collectedAt: completedAt,
        taskPost: taskPostResult,
        taskId: rawTaskId,
        pollStatus: clientOpts.pollStatus || "completed",
        summary: rawSummary,
        pages: rawPages,
        links: rawLinks,
        duplicateTags: rawDuplicateTags,
        duplicateContent: rawDuplicateContent,
        microdata: rawMicrodata,
        dtMeta,
        dcMeta,
        microdataMeta,
        // PRYSM-NEXT-01 WP-B-10 — deep acquisition raw payloads preserved
        contentParsing: rawContentParsing,
        cpMeta,
        redirectChains: rawRedirectChains,
        rcMeta,
        nonIndexable: rawNonIndexable,
        resources: rawResources,
        resMeta,
        acquisition,
        siteFootprint,
        programmaticSeo,
        retryCount,
      };
      const rawJson = JSON.stringify(rawPayload, null, 2);
      const rawHash = createHash("sha256").update(rawJson).digest("hex");
      const rawBytes = Buffer.byteLength(rawJson, "utf8");

      result._rawSha256 = rawHash;
      result._rawBytes = rawBytes;
      result._rawArtifactBytes = Buffer.from(rawJson, "utf-8");
      result._rawArtifactName = `${artifactRunId}.json`;
      result._rawArtifactContentType = "application/json";
    } catch (rawError) {
      result._rawError = rawError.message;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// FAILED envelope builder
// ---------------------------------------------------------------------------

function buildFailedEnvelope({
  target,
  sourceStatus,
  errorCategory,
  startedAt,
  completedAt,
  rawTaskId,
  retryCount,
  limitations,
  error,
}) {
  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "dataforseo-onpage",
    sourceStatus,
    status: sourceStatus,
    targetUrl: target,
    domain: domainOf(target),
    crawledAt: completedAt,
    pages: [],
    pageCount: 0,
    robotsText: "",
    sitemapUrls: [],
    statusCounts: {},
    totalWords: 0,
    averageWords: 0,
    missingTitles: 0,
    missingDescriptions: 0,
    missingCanonicals: 0,
    h1Missing: 0,
    h1Multiple: 0,
    imageCount: 0,
    imagesMissingAlt: 0,
    imagesMissingDimensions: 0,
    schemaTypes: [],
    forms: [],
    ctas: [],
    externalCtas: [],
    socialLinks: [],
    internalLinkCount: 0,
    brokenInternalLinks: [],
    brokenLinksCount: null,
    platform: "Unknown",
    services: [],
    topicKeywords: [],
    trust: {
      testimonials: false,
      credentials: false,
      caseStudies: false,
      faq: false,
      pricing: false,
      policies: false,
      contact: false,
    },
    securityHeaders: {
      xFrameOptions: false,
      xContentTypeOptions: false,
      referrerPolicy: false,
      contentSecurityPolicy: false,
    },
    limitations,
    collectedAt: completedAt,
    coverage: { requested: 0, completed: 0, failed: 0 },
    rawArtifactRef: rawTaskId
      ? `dataforseo://on_page/${rawTaskId}`
      : null,
    _contentEvidenceAvailable: false,
    _responseHeadersAvailable: false,
    _sourceStatus: buildSourceStatus({
      provider: "dataforseo-onpage",
      adapterVersion: ADAPTER_VERSION,
      startedAt,
      completedAt,
      requestId: rawTaskId || null,
      retryCount,
      returnedRecordCount: 0,
      expectedRecordCount: null,
      errorCategory,
      limitation: limitations.join("; ") || null,
      rawArtifactRef: rawTaskId
        ? `dataforseo://on_page/${rawTaskId}`
        : null,
    }),
    _raw: { taskId: rawTaskId, error: error?.message },
  };
}

// ---------------------------------------------------------------------------
// Governed execute() contract — WP6 universal adapter interface
// ---------------------------------------------------------------------------

/**
 * Execute the DataForSEO On-Page adapter behind the universal source contract.
 *
 * Conforms to the WP6 `execute({ auditRequest, source, executionId,
 * sourceExecutionKey, signal, attempt })` interface expected by the
 * AuditOrchestrator.
 *
 * @param {object} args
 * @param {object} args.auditRequest — full audit request with targetUrl, crawl config, etc.
 * @param {string} args.source — "dataforseo-onpage"
 * @param {string} args.executionId — unique execution ID for this run
 * @param {string} args.sourceExecutionKey — deterministic source execution key
 * @param {AbortSignal} args.signal — abort signal for timeout
 * @param {number} args.attempt — current attempt number (1-based)
 * @returns {Promise<{ rawBytes: Buffer|null, contentType: string|null, sourceResult: object }>}
 */
export async function execute({ auditRequest, source, executionId, sourceExecutionKey, signal, attempt }) {
  const startedAt = new Date().toISOString();
  const target = auditRequest.targetUrl;
  const crawl = auditRequest.crawl || {};

  // Build crawl options from audit request
  const crawlOptions = {
    maxPages: crawl.maxPages ?? DEFAULTS.maxPages,
    maxDepth: crawl.maxDepth,
    enableJavascript: crawl.enableJavascript ?? DEFAULTS.enableJavascript,
    enableBrowserRendering: crawl.enableBrowserRendering ?? DEFAULTS.enableBrowserRendering,
    loadResources: crawl.loadResources ?? DEFAULTS.loadResources,
    includePatterns: crawl.includePatterns,
    excludePatterns: crawl.excludePatterns,
    maxExternalResources: crawl.maxExternalResources,
    pollTimeoutMs: crawl.pollTimeoutMs ?? DEFAULTS.pollTimeoutMs,
    pollIntervalMs: crawl.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
    // PRYSM-CLOSE-12: durable provider task ID from a previous attempt —
    // resume polling on the same paid task, never re-submit.
    resumeTaskId: crawl.resumeTaskId || null,
    // PRYSM-NEXT-01 WP-B — deep acquisition configuration (see DEFAULTS).
    validateMicromarkup: crawl.validateMicromarkup ?? DEFAULTS.validateMicromarkup,
    enableContentParsing: crawl.enableContentParsing ?? DEFAULTS.enableContentParsing,
    contentParsingPageLimit: crawl.contentParsingPageLimit ?? DEFAULTS.contentParsingPageLimit,
    redirectChainsPageLimit: crawl.redirectChainsPageLimit ?? DEFAULTS.redirectChainsPageLimit,
    nonIndexableLimit: crawl.nonIndexableLimit ?? DEFAULTS.nonIndexableLimit,
    resourcesPageLimit: crawl.resourcesPageLimit ?? DEFAULTS.resourcesPageLimit,
    businessServices: auditRequest.services || [],
    clientOptions: {
      mode: crawl.fixtures || crawl.fetchImpl ? (crawl.fixtures ? "fixture" : "live") : "live",
      fixtures: crawl.fixtures || null,
      fetchImpl: crawl.fetchImpl || null,
    },
    artifactSlug: auditRequest.auditId,
    artifactRunId: executionId,
  };

  try {
    const envelope = await crawlWithDataforseo(target, crawlOptions);

    // Build the schema-valid source result from the envelope
    const sourceStatus = envelope._sourceStatus || {};
    const rawData = envelope._raw || {};

    // Serialize raw provider payload for artifact storage
    let rawBytes = null;
    if (envelope._rawArtifactBytes) {
      rawBytes = envelope._rawArtifactBytes;
    } else if (rawData.taskId) {
      const rawPayload = JSON.stringify(rawData);
      rawBytes = Buffer.from(rawPayload, "utf-8");
    }

    const sourceResult = {
      contractVersion: "1.0.0",
      schemaVersion: "1.0.0",
      source,
      provider: "DataForSEO",
      adapterVersion: ADAPTER_VERSION,
      status: envelope.sourceStatus || envelope.status || "AVAILABLE",
      startedAt: sourceStatus.startedAt || startedAt,
      completedAt: sourceStatus.completedAt || envelope.collectedAt || new Date().toISOString(),
      ...(sourceStatus.requestId || rawData.taskId ? { requestId: sourceStatus.requestId || rawData.taskId } : {}),
      retryCount: sourceStatus.retryCount || 0,
      expectedRecords: sourceStatus.expectedRecordCount ?? envelope.pageCount,
      returnedRecords: sourceStatus.returnedRecordCount ?? envelope.pageCount,
      coverage: envelope.coverage || {
        requested: envelope.pageCount,
        completed: envelope.pageCount,
        failed: 0,
      },
      limitations: envelope.limitations || [],
      evidence: {
        // Full normalized decision evidence — all fields required downstream
        // by scoring and rendering.  Raw provider payloads remain in rawBytes
        // and the _raw envelope key only.
        sourceStatus: envelope.sourceStatus || envelope.status,
        targetUrl: envelope.targetUrl,
        domain: envelope.domain,
        pageCount: envelope.pageCount,
        pages: envelope.pages || [],
        statusCounts: envelope.statusCounts || {},
        totalWords: envelope.totalWords,
        averageWords: envelope.averageWords,
        missingTitles: envelope.missingTitles,
        missingDescriptions: envelope.missingDescriptions,
        missingCanonicals: envelope.missingCanonicals,
        h1Missing: envelope.h1Missing,
        h1Multiple: envelope.h1Multiple,
        imageCount: envelope.imageCount,
        imagesMissingAlt: envelope.imagesMissingAlt,
        imagesMissingDimensions: envelope.imagesMissingDimensions,
        schemaTypes: envelope.schemaTypes || [],
        microdataTypes: envelope.microdataTypes || [],
        forms: envelope.forms || [],
        ctas: envelope.ctas || [],
        externalCtas: envelope.externalCtas || [],
        socialLinks: envelope.socialLinks || [],
        internalLinkCount: envelope.internalLinkCount,
        brokenInternalLinks: envelope.brokenInternalLinks || [],
        brokenLinksCount: envelope.brokenLinksCount,
        platform: envelope.platform || "Unknown",
        services: envelope.services || [],
        topicKeywords: envelope.topicKeywords || [],
        contentParsing: envelope.contentParsing || [],
        redirectChains: envelope.redirectChains || [],
        nonIndexablePages: envelope.nonIndexablePages || [],
        pageResources: envelope.pageResources || [],
        acquisition: envelope.acquisition || null,
        siteFootprint: envelope.siteFootprint || null,
        programmaticSeo: envelope.programmaticSeo || null,
        trust: envelope.trust || {},
        securityHeaders: envelope.securityHeaders || {},
        collectedAt: envelope.collectedAt,
        coverage: envelope.coverage || null,
        limitations: envelope.limitations || [],
        _contentEvidenceAvailable: envelope._contentEvidenceAvailable || false,
        _responseHeadersAvailable: envelope._responseHeadersAvailable || false,
        _interactiveEvidenceAvailable: envelope._interactiveEvidenceAvailable === true,
        ...(typeof envelope._metaCountersAvailable === "boolean"
          ? { _metaCountersAvailable: envelope._metaCountersAvailable }
          : {}),
        _metaFieldAvailability: envelope._metaFieldAvailability || null,
        rawArtifactRef: envelope.rawArtifactRef || null,
      },
    };

    if (sourceStatus.errorCategory) {
      sourceResult.errorCategory = sourceStatus.errorCategory;
    }

    return { rawBytes, contentType: "application/json", sourceResult };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const isQuota = error.category === "rate_limit" || /429|quota|rate.limit/i.test(error.message);
    const isAuth = error.category === "auth" || /401|403|unauthorized|authentication/i.test(error.message);

    return {
      rawBytes: null,
      contentType: null,
      sourceResult: {
        contractVersion: "1.0.0",
        schemaVersion: "1.0.0",
        source,
        provider: "DataForSEO",
        adapterVersion: ADAPTER_VERSION,
        status: "FAILED",
        startedAt,
        completedAt,
        retryCount: attempt - 1,
        expectedRecords: crawlOptions.maxPages,
        returnedRecords: 0,
        coverage: { requested: crawlOptions.maxPages, completed: 0, failed: crawlOptions.maxPages },
        limitations: [`DataForSEO On-Page execution failed: ${error.message}`],
        errorCategory: isQuota ? "rate_limit" : isAuth ? "auth" : "internal",
        evidence: {},
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export { ADAPTER_VERSION, DEFAULTS, normalizePage, summarizeSite };

export default { crawlWithDataforseo, execute };

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

// ---------------------------------------------------------------------------
// Adapter version
// ---------------------------------------------------------------------------

const ADAPTER_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Default configuration (PRD v3.0 §8.4)
// ---------------------------------------------------------------------------

const DEFAULTS = Object.freeze({
  maxPages: 500,
  pollTimeoutMs: 600000,    // 10 minutes
  pollIntervalMs: 10000,    // 10 seconds
  enableJavascript: false,
  enableBrowserRendering: false,
  loadResources: true,
});

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
  const rawLinks = raw.links || [];
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

  return {
    url: raw.url || "",
    status: statusCode,
    rendered,
    title,
    description,
    canonical: raw.meta?.canonical || raw.canonical || null,
    language: raw.meta?.content_language || raw.language || "",
    generator: raw.meta?.generator || raw.technologies?.cms || "",
    platform: detectPlatform(raw),
    // Word count: DataForSEO uses meta.content.plain_text_word_count (float).
    // Fall back to meta.word_count (legacy fixture format) then content.word_count.
    words: raw.meta?.content?.plain_text_word_count
      ?? raw.meta?.word_count
      ?? raw.content?.word_count
      ?? 0,
    headings,
    schemaTypes,
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
    // Provider-specific metadata preserved
    _dataforseo: {
      resourceErrors,
      loadTime: raw.load_time || raw.time_to_interactive || null,
      sizeBytes: raw.size || raw.page_size || null,
      crawlDepth: raw.crawl_depth ?? null,
      sitemapUrl: raw.sitemap_url || null,
      metaInternalLinksCount: raw.meta?.internal_links_count ?? null,
      metaExternalLinksCount: raw.meta?.external_links_count ?? null,
      metaImagesCount: raw.meta?.images_count ?? null,
    },
    // Content-availability marker — downstream consumers read this to
    // decide whether content-dependent signals (trust, CTA, forms) are
    // based on real extracted text or are unavailable.
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

  // ── Content evidence availability ─────────────────────────────────────
  // DataForSEO /on_page/pages endpoint returns metadata only (no body text,
  // no link/image arrays, no structured_data).  When every content-page has
  // _contentAvailable === false, content-dependent signals (trust, CTAs,
  // forms) were not extracted from real page text and must be treated as
  // unavailable rather than confirmed-absent.
  const contentEvidenceAvailable = contentPages.length > 0
    && contentPages.some((p) => p._contentAvailable === true);

  const allSchema = new Set(pages.flatMap((p) => p.schemaTypes));
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

  // Broken internal links
  const brokenInternalLinks = pages
    .filter((p) => p.status >= 400)
    .map((p) => p.url);

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

  // Build coverage information
  const coverage = {
    requested: totalCrawlPages ?? pages.length,
    completed: pages.length,
    failed: (totalCrawlPages ?? pages.length) - pages.length,
  };

  // Collect limitation strings
  const allLimitations = [...limitations];
  if (cappedPages) {
    allLimitations.push(
      `Page ceiling reached: ${pages.length} of ${totalCrawlPages} pages crawled`,
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

  return {
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
    trust,
    securityHeaders,
    limitations: allLimitations,
    collectedAt: completedAt,
    coverage,
    rawArtifactRef: rawTaskId ? `dataforseo://on_page/${rawTaskId}` : null,
    // Content-availability flag for downstream scoring/reporting.
    // When false, content-dependent signals were not extracted from
    // real page text and should be treated as unavailable.
    _contentEvidenceAvailable: contentEvidenceAvailable,
    // Response-headers availability flag.  DataForSEO does not return
    // HTTP response headers; findings that depend on them (e.g. security
    // headers) should be suppressed when this is false.
    _responseHeadersAvailable: responseHeadersAvailable,
    _sourceStatus: buildSourceStatus({
      provider: "dataforseo-onpage",
      adapterVersion: ADAPTER_VERSION,
      startedAt,
      completedAt,
      requestId: rawTaskId || null,
      retryCount: 0,
      returnedRecordCount: pages.length,
      expectedRecordCount: totalCrawlPages ?? pages.length,
      errorCategory,
      limitation: allLimitations.join("; ") || null,
      rawArtifactRef: rawTaskId
        ? `dataforseo://on_page/${rawTaskId}`
        : null,
    }),
    // Preserve raw provider data for artifact storage
    _raw: {
      taskId: rawTaskId,
      summary: rawSummary,
      duplicateTags: rawDuplicateTags,
      duplicateContent: rawDuplicateContent,
    },
  };
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
 * @param {number} [options.maxPages=500] - Maximum pages to crawl.
 * @param {number} [options.maxDepth] - Maximum crawl depth.
 * @param {boolean} [options.enableJavascript=false] - Enable JS rendering.
 * @param {boolean} [options.enableBrowserRendering=false] - Full browser rendering.
 * @param {boolean} [options.loadResources=true] - Load page resources.
 * @param {Array<string>} [options.includePatterns] - URL include patterns.
 * @param {Array<string>} [options.excludePatterns] - URL exclude patterns.
 * @param {number} [options.maxExternalResources] - External resource limit.
 * @param {number} [options.pollTimeoutMs=600000] - Polling timeout in ms.
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

  const maxPages = options.maxPages ?? DEFAULTS.maxPages;
  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULTS.pollTimeoutMs;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULTS.pollIntervalMs;

  let rawTaskId = null;
  let retryCount = 0;
  let taskPostResult = null;

  // -----------------------------------------------------------------------
  // Step 1: Submit task
  // -----------------------------------------------------------------------
  try {
    taskPostResult = await client.taskPost(target, {
      maxPages,
      maxDepth: options.maxDepth,
      enableJavascript: options.enableJavascript ?? DEFAULTS.enableJavascript,
      enableBrowserRendering:
        options.enableBrowserRendering ?? DEFAULTS.enableBrowserRendering,
      loadResources: options.loadResources ?? DEFAULTS.loadResources,
      includePatterns: options.includePatterns,
      excludePatterns: options.excludePatterns,
      maxExternalResources: options.maxExternalResources,
    });
    rawTaskId = taskPostResult.taskId;
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
  let rawDuplicateTags;
  let rawDuplicateContent;
  let cappedPages = false;
  let jsContentMissing = false;
  let robotsBlocked = false;
  let loginBlocked = false;
  let totalCrawlPages = maxPages;

  try {
    // 3a. Retrieve summary
    rawSummary = await client.getSummary(rawTaskId);

    // Check for blocking conditions from summary
    if (rawSummary) {
      const crawlStatus = rawSummary.crawl_status || rawSummary.status || "";

      if (/blocked|robots/i.test(crawlStatus)) {
        robotsBlocked = true;
      }
      if (/login|auth|forbidden/i.test(crawlStatus)) {
        loginBlocked = true;
      }

      // DataForSEO summary nests total/crawled page counts under
      // crawl_status and domain_info (not at the root).  Also fall back
      // to the old-format root-level fields for test compatibility.
      //
      // Priority: domain_info.total_pages (total pages on site, new
      // format) > rawSummary.total_pages (old format root-level) >
      // crawl_status.pages_crawled (pages actually crawled) >
      // rawSummary.pages_crawled (old format) > maxPages.
      const crawlStatusObj = rawSummary.crawl_status;
      const domainInfo = rawSummary.domain_info || {};
      totalCrawlPages =
        domainInfo.total_pages ||           // new format: total pages on site
        rawSummary.total_pages ||           // old-format fallback
        (crawlStatusObj && typeof crawlStatusObj === "object"
          ? crawlStatusObj.pages_crawled    // pages actually crawled
          : null) ||
        rawSummary.pages_crawled ||         // old-format fallback
        maxPages;
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
        coverage: { requested: maxPages, completed: 0, failed: maxPages },
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
          expectedRecordCount: maxPages,
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

    // 3d. Retrieve duplicate tags
    try {
      rawDuplicateTags = await client.getDuplicateTags(rawTaskId);
    } catch (dtError) {
      limitations.push(
        `Duplicate tag retrieval failed: ${dtError.message}`,
      );
    }

    // 3e. Retrieve duplicate content
    try {
      rawDuplicateContent = await client.getDuplicateContent(rawTaskId);
    } catch (dcError) {
      limitations.push(
        `Duplicate content retrieval failed: ${dcError.message}`,
      );
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
  // Step 4: Normalize
  // -----------------------------------------------------------------------
  const completedAt = new Date().toISOString();
  const targetDomain = domainOf(target);

  const normalizedPages = rawPages.map((raw) =>
    normalizePage(raw, { targetDomain }),
  );

  return summarizeSite({
    targetUrl: target,
    pages: normalizedPages,
    rawSummary,
    rawDuplicateTags,
    rawDuplicateContent,
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
// Public API
// ---------------------------------------------------------------------------

export { ADAPTER_VERSION, DEFAULTS, normalizePage, summarizeSite };

export default { crawlWithDataforseo };

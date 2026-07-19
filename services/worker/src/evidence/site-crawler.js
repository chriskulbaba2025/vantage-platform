import * as cheerio from "cheerio";
import { normalizeUrl, domainOf, withTimeout } from "../utils.js";

const CTA_RE = /\b(book|schedule|contact|call|subscribe|buy|start|get started|learn more|request|download|join|register|sign up|free consultation|discovery)\b/i;
const TESTIMONIAL_RE = /\b(testimonials?|what clients say|client stories|reviews?|success stor(?:y|ies))\b/i;
const CREDENTIAL_RE = /\b(certified|certification|licensed|registered|credential|years? experience|member of|accredited|degree|diploma)\b/i;
const CASE_RE = /\b(case stud(?:y|ies)|client result|before and after|outcome)\b/i;
const FAQ_RE = /\b(faq|frequently asked|common questions)\b/i;
const PRICE_RE = /(?:\$|CAD\s?\$|USD\s?\$|£|€)\s?\d|\b(pricing|price|cost|investment|fee)\b/i;
const POLICY_RE = /\b(privacy|terms|refund|cancellation|cookie policy)\b/i;
const SOCIAL_HOSTS = ["linkedin.com", "facebook.com", "instagram.com", "youtube.com", "tiktok.com", "x.com", "twitter.com"];
const SERVICE_HINT_RE = /\b(service|coaching|consulting|therapy|speaking|workshop|scan|membership|program|training|assessment|audit|solution)\b/i;

function absoluteUrl(href, base, allowedProtocols = ["http:", "https:"]) {
  try {
    const url = new URL(href, base);
    if (!allowedProtocols.includes(url.protocol)) return null;
    if (["http:", "https:"].includes(url.protocol)) url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseSchemaTypes($) {
  const types = new Set();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const value = JSON.parse($(el).text());
      const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(visit);
        const type = node["@type"];
        if (Array.isArray(type)) type.forEach((t) => types.add(String(t)));
        else if (type) types.add(String(type));
        Object.values(node).forEach(visit);
      };
      visit(value);
    } catch {
      types.add("InvalidJSONLD");
    }
  });
  return [...types].sort();
}

function detectPlatform($, html, headers) {
  const generator = cleanText($('meta[name="generator"]').attr("content"));
  const haystack = `${generator} ${html.slice(0, 120000)}`.toLowerCase();
  if (haystack.includes("godaddy website builder") || haystack.includes("wsimg.com")) return "GoDaddy Website Builder";
  if (haystack.includes("wp-content") || haystack.includes("wordpress")) return "WordPress";
  if (haystack.includes("wixstatic.com") || haystack.includes("wix.com")) return "Wix";
  if (haystack.includes("squarespace")) return "Squarespace";
  if (haystack.includes("cdn.shopify.com") || headers.get("x-shopid")) return "Shopify";
  if (haystack.includes("webflow")) return "Webflow";
  if (haystack.includes("__next_data__") || haystack.includes("/_next/")) return "Next.js";
  return generator || "Unknown";
}

function extractPage(url, status, headers, html, rendered = false) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();
  const bodyText = cleanText($("body").text());
  const words = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const headings = {};
  for (let level = 1; level <= 6; level++) {
    headings[`h${level}`] = $(`h${level}`).map((_, el) => cleanText($(el).text())).get().filter(Boolean);
  }

  const links = $("a[href]").map((_, el) => {
    const href = absoluteUrl($(el).attr("href"), url, ["http:", "https:", "mailto:", "tel:"]);
    return href ? { url: href, text: cleanText($(el).text()), target: $(el).attr("target") || "" } : null;
  }).get().filter(Boolean);
  const buttons = $("button, input[type=submit], [role=button]").map((_, el) => cleanText($(el).text() || $(el).attr("value") || $(el).attr("aria-label"))).get().filter(Boolean);
  const ctas = [...links.filter((l) => CTA_RE.test(l.text)).map((l) => ({ text: l.text, url: l.url, kind: "link" })), ...buttons.filter((b) => CTA_RE.test(b)).map((b) => ({ text: b, url, kind: "button" }))];
  const images = $("img").map((_, el) => ({
    src: absoluteUrl($(el).attr("src") || $(el).attr("data-src"), url),
    alt: cleanText($(el).attr("alt")),
    width: $(el).attr("width") || null,
    height: $(el).attr("height") || null,
    loading: $(el).attr("loading") || null,
  })).get();
  const forms = $("form").map((_, el) => ({
    action: absoluteUrl($(el).attr("action") || url, url),
    method: ($(el).attr("method") || "get").toLowerCase(),
    fields: $(el).find("input,select,textarea").length,
    hasCaptcha: /captcha|recaptcha/i.test($(el).html() || ""),
  })).get();

  const title = cleanText($("title").first().text());
  const description = cleanText($('meta[name="description"]').attr("content"));
  const canonical = absoluteUrl($('link[rel="canonical"]').attr("href"), url);
  const language = $("html").attr("lang") || "";
  const socialLinks = links.filter((l) => {
    try {
      return ["http:", "https:"].includes(new URL(l.url).protocol) && SOCIAL_HOSTS.some((host) => new URL(l.url).hostname.includes(host));
    } catch {
      return false;
    }
  });
  const emailLinks = links.filter((l) => l.url.startsWith("mailto:"));
  const phoneLinks = links.filter((l) => l.url.startsWith("tel:"));
  const serviceCandidates = [...headings.h2, ...headings.h3, ...links.map((l) => l.text)]
    .filter((text) => text.length > 2 && text.length < 80 && SERVICE_HINT_RE.test(text));

  return {
    url,
    status,
    rendered,
    title,
    description,
    canonical,
    language,
    generator: cleanText($('meta[name="generator"]').attr("content")),
    platform: detectPlatform($, html, headers),
    words,
    headings,
    schemaTypes: parseSchemaTypes(cheerio.load(html)),
    links,
    ctas,
    images,
    forms,
    socialLinks,
    emailLinks,
    phoneLinks,
    serviceCandidates: [...new Set(serviceCandidates)].slice(0, 20),
    signals: {
      testimonials: TESTIMONIAL_RE.test(bodyText),
      credentials: CREDENTIAL_RE.test(bodyText),
      caseStudies: CASE_RE.test(bodyText),
      faq: FAQ_RE.test(bodyText),
      pricing: PRICE_RE.test(bodyText),
      policies: POLICY_RE.test(bodyText),
      contact: forms.length > 0 || /contact/i.test(bodyText) || emailLinks.length > 0 || phoneLinks.length > 0,
    },
    bodyText: bodyText.slice(0, 50000),
    responseHeaders: Object.fromEntries(headers.entries()),
  };
}

async function fetchText(url, fetchImpl, timeoutMs = 20000) {
  const response = await withTimeout(fetchImpl(url, {
    redirect: "follow",
    headers: { "user-agent": "VantageAuditBot/0.2 (+https://omnipressence.com)" },
  }), timeoutMs, `fetch ${url}`);
  const text = await withTimeout(response.text(), timeoutMs, `read ${url}`);
  return { response, text };
}

async function renderWithBrowser(url, timeoutMs = 30000) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function discoverSitemap(origin, fetchImpl, limitations) {
  const candidates = [new URL("/sitemap.xml", origin).toString(), new URL("/sitemap_index.xml", origin).toString()];
  const urls = [];
  for (const candidate of candidates) {
    try {
      const { response, text } = await fetchText(candidate, fetchImpl, 10000);
      if (!response.ok || !/<(?:urlset|sitemapindex)/i.test(text)) continue;
      const $ = cheerio.load(text, { xmlMode: true });
      $("loc").each((_, el) => {
        const value = cleanText($(el).text());
        if (value) urls.push(value);
      });
      if (urls.length) break;
    } catch (error) {
      limitations.push(`Sitemap discovery failed at ${candidate}: ${error.message}`);
    }
  }
  return urls;
}

function summarize(pages, targetUrl, robotsText, sitemapUrls, limitations) {
  const domain = domainOf(targetUrl);
  const allSchema = new Set(pages.flatMap((p) => p.schemaTypes));
  const allServices = new Set(pages.flatMap((p) => p.serviceCandidates));
  const topicCounts = new Map();
  for (const page of pages) {
    const candidates = [...page.headings.h1, ...page.headings.h2, ...page.headings.h3];
    for (const heading of candidates) {
      for (const token of heading.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []) {
        if (["about", "contact", "services", "service", "learn", "more", "home", "welcome", "with", "from", "your", "this", "that"].includes(token)) continue;
        topicCounts.set(token, (topicCounts.get(token) || 0) + 1);
      }
    }
  }
  const topicKeywords = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([word]) => word);
  const internalLinks = pages.flatMap((p) => p.links).filter((l) => {
    try { return domainOf(l.url) === domain; } catch { return false; }
  });
  const externalCtas = pages.flatMap((p) => p.ctas).filter((cta) => {
    try { return domainOf(cta.url) !== domain; } catch { return false; }
  });
  const headers = pages[0]?.responseHeaders || {};
  const securityHeaders = {
    xFrameOptions: Boolean(headers["x-frame-options"]),
    xContentTypeOptions: Boolean(headers["x-content-type-options"]),
    referrerPolicy: Boolean(headers["referrer-policy"]),
    contentSecurityPolicy: Boolean(headers["content-security-policy"]),
  };
  const uniquePlatforms = [...new Set(pages.map((p) => p.platform).filter(Boolean))];
  const forms = pages.flatMap((p) => p.forms);
  const ctas = pages.flatMap((p) => p.ctas);
  const images = pages.flatMap((p) => p.images);
  return {
    targetUrl,
    domain,
    crawledAt: new Date().toISOString(),
    pages,
    pageCount: pages.length,
    robotsText,
    sitemapUrls,
    statusCounts: pages.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {}),
    totalWords: pages.reduce((sum, p) => sum + p.words, 0),
    averageWords: pages.length ? Math.round(pages.reduce((sum, p) => sum + p.words, 0) / pages.length) : 0,
    missingTitles: pages.filter((p) => !p.title).length,
    missingDescriptions: pages.filter((p) => !p.description).length,
    missingCanonicals: pages.filter((p) => !p.canonical).length,
    h1Missing: pages.filter((p) => p.headings.h1.length === 0).length,
    h1Multiple: pages.filter((p) => p.headings.h1.length > 1).length,
    imageCount: images.length,
    imagesMissingAlt: images.filter((img) => !img.alt).length,
    imagesMissingDimensions: images.filter((img) => !img.width || !img.height).length,
    schemaTypes: [...allSchema],
    forms,
    ctas,
    externalCtas,
    socialLinks: pages.flatMap((p) => p.socialLinks),
    internalLinkCount: internalLinks.length,
    brokenInternalLinks: pages.filter((p) => p.status >= 400).map((p) => p.url),
    platform: uniquePlatforms[0] || "Unknown",
    services: [...allServices].slice(0, 12),
    topicKeywords,
    trust: {
      testimonials: pages.some((p) => p.signals.testimonials),
      credentials: pages.some((p) => p.signals.credentials),
      caseStudies: pages.some((p) => p.signals.caseSudies),
      faq: pages.some((p) => p.signals.faq),
      pricing: pages.some((p) => p.signals.pricing),
      policies: pages.some((p) => p.signals.policies),
      contact: pages.some((p) => p.signals.contact),
    },
    securityHeaders,
    limitations,
  };
}

export async function crawlSite(input, options = {}) {
  const targetUrl = normalizeUrl(input);
  const origin = new URL(targetUrl).origin;
  const targetDomain = domainOf(targetUrl);
  const maxPages = Math.min(100, Math.max(1, options.maxPages || 30));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const browserMode = options.browserMode || "auto";
  const limitations = [];
  let robotsText = "";
  try {
    const robots = await fetchText(new URL("/robots.txt", origin).toString(), fetchImpl, 10000);
    if (robots.response.ok) robotsText = robots.text.slice(0, 50000);
  } catch (error) {
    limitations.push(`robots.txt unavailable: ${error.message}`);
  }

  const sitemapUrls = await discoverSitemap(origin, fetchImpl, limitations);
  const queue = [targetUrl, ...sitemapUrls].filter((url, index, arr) => arr.indexOf(url) === index).slice(0, maxPages * 2);
  const seen = new Set();
  const pages = [];

  while (queue.length && pages.length < maxPages) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const { response, text } = await fetchText(url, fetchImpl);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) continue;
      let html = text;
      let rendered = false;
      const textOnly = cleanText(cheerio.load(html)("body").text());
      const shouldRender = browserMode === "always" || (browserMode === "auto" && textOnly.length < 300 && /<script/i.test(html));
      if (shouldRender) {
        try {
          html = options.browserRenderer ? await options.browserRenderer(url) : await renderWithBrowser(url);
          rendered = true;
        } catch (error) {
          limitations.push(`Browser rendering unavailable for ${url}: ${error.message}`);
        }
      }
      const page = extractPage(response.url || url, response.status, response.headers, html, rendered);
      pages.push(page);
      for (const link of page.links) {
        try {
          if (domainOf(link.url) === targetDomain && !seen.has(link.url) && queue.length < maxPages * 5) queue.push(link.url);
        } catch { /* ignore */ }
      }
    } catch (error) {
      limitations.push(`Page capture failed for ${url}: ${error.message}`);
    }
  }

  if (!pages.length) throw new Error(`No crawlable HTML pages found for ${targetUrl}`);
  return summarize(pages, targetUrl, robotsText, sitemapUrls, limitations);
}

export async function crawlCompetitors(urls = [], options = {}) {
  const results = [];
  for (const url of urls.slice(0, 3)) {
    try {
      const evidence = await crawlSite(url, { ...options, maxPages: Math.min(options.maxPages || 8, 8) });
      results.push({ status: "complete", url, evidence });
    } catch (error) {
      results.push({ status: "failed", url, error: error.message });
    }
  }
  return results;
}

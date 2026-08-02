import * as cheerio from "cheerio";
import { normalizeUrl, domainOf, withTimeout } from "../utils.js";
import { cleanText, extractPage } from "./page-extractor.js";
import { SOURCE_STATUS, buildSourceStatus, EVIDENCE_ENVELOPE_VERSION } from "../scoring/evidence-contracts.js";

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
  const phraseCounts = new Map();

  function addPhrase(phrase) {
    const cleaned = phrase.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, " ").trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 5) return;

    // Skip single-word entries that are too short or generic
    if (words.length === 1) {
      const w = words[0].replace(/-/g, "");
      if (w.length < 5) return;
      const GENERIC_SINGLE = new Set([
        "about", "contact", "services", "service", "learn", "more", "home",
        "welcome", "assessment", "solution", "solutions", "area", "areas",
        "care", "help", "support", "team", "info", "information", "resource",
        "resources", "page", "online", "better", "right", "good", "great",
        "professional", "quality", "expert", "experts", "dedicated",
        "comprehensive", "complete", "custom", "personal", "individual",
        "unique", "innovative", "advanced", "modern", "proven", "trusted",
        "leading", "premier", "premium", "affordable", "effective",
        "efficient", "reliable", "convenient", "flexible",
      ]);
      if (GENERIC_SINGLE.has(w)) return;
    }

    phraseCounts.set(cleaned, (phraseCounts.get(cleaned) || 0) + 1);
  }

  // Feed validated services, page titles, and H1 headings into phrase extraction
  for (const svc of allServices) addPhrase(svc);
  for (const page of pages) {
    if (page.title) addPhrase(page.title);
    for (const h1 of page.headings.h1) addPhrase(h1);
  }

  const topicKeywords = [...phraseCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([phrase]) => phrase);
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
  const collectedAt = new Date().toISOString();
  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "prysm-crawler",
    sourceStatus: SOURCE_STATUS.AVAILABLE,
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
      caseStudies: pages.some((p) => p.signals.caseStudies),
      faq: pages.some((p) => p.signals.faq),
      pricing: pages.some((p) => p.signals.pricing),
      policies: pages.some((p) => p.signals.policies),
      contact: pages.some((p) => p.signals.contact),
    },
    securityHeaders,
    limitations,
    collectedAt,
    coverage: { requested: pages.length, completed: pages.length, failed: 0 },
    rawArtifactRef: null,
    _sourceStatus: buildSourceStatus({
      provider: "prysm-crawler",
      adapterVersion: "1.0.0",
      startedAt: null, // set by caller crawlSite
      completedAt: collectedAt,
      requestId: null,
      retryCount: 0,
      returnedRecordCount: pages.length,
      expectedRecordCount: pages.length,
      errorCategory: null,
      limitation: null,
      rawArtifactRef: null,
    }),
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
      results.push({ status: SOURCE_STATUS.AVAILABLE, url, evidence });
    } catch (error) {
      results.push({ status: SOURCE_STATUS.FAILED, url, error: error.message });
    }
  }
  return results;
}

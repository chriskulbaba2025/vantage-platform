import { crawlSite, crawlCompetitors } from "../evidence/site-crawler.js";
import { collectPerformance } from "../evidence/pagespeed-client.js";
import { collectBacklinks } from "../evidence/backlinks-provider.js";
import { collectGa4 } from "../evidence/ga4-client.js";
import { scoreAudit } from "../scoring/vantage-score.js";
import { renderReport } from "../report/render-report.js";
import { createReportStore } from "../storage/report-store.js";
import { createRunId, domainOf, normalizeUrl, slugify } from "../utils.js";
import { loadConfig } from "../config.js";

function validateInput(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Audit input must be an object");
  if (!raw.targetUrl || typeof raw.targetUrl !== "string") throw new Error("targetUrl is required");
  const targetUrl = normalizeUrl(raw.targetUrl);
  const competitors = Array.isArray(raw.competitors) ? raw.competitors.filter(Boolean).slice(0, 3).map(normalizeUrl) : [];
  return {
    targetUrl,
    businessName: String(raw.businessName || "").trim(),
    location: String(raw.location || "").trim(),
    language: String(raw.language || "en-CA").trim(),
    competitors,
    primaryGoal: String(raw.primaryGoal || "Generate qualified enquiries").trim(),
    ga4: raw.ga4 && typeof raw.ga4 === "object" ? raw.ga4 : {},
  };
}

function safeResult(provider, label) {
  return async (...args) => {
    try { return await provider(...args); }
    catch (error) { return { status: "failed", error: `${label}: ${error.message}`, limitations: [`${label}: ${error.message}`] }; }
  };
}

export async function runAudit(rawInput, options = {}) {
  const config = options.config || loadConfig();
  const input = validateInput(rawInput);
  const runId = options.runId || createRunId();
  const startedAt = new Date().toISOString();
  const crawler = options.crawlSite || crawlSite;
  const competitorCrawler = options.crawlCompetitors || crawlCompetitors;
  const performanceCollector = safeResult(options.collectPerformance || collectPerformance, "Performance collection failed");
  const backlinksCollector = safeResult(options.collectBacklinks || collectBacklinks, "Backlink collection failed");
  const ga4Collector = safeResult(options.collectGa4 || collectGa4, "GA4 collection failed");

  const site = await crawler(input.targetUrl, {
    maxPages: config.maxPages,
    browserMode: config.browserMode,
    fetchImpl: options.fetchImpl,
    browserRenderer: options.browserRenderer,
  });
  if (!input.businessName) input.businessName = site.pages[0]?.title || site.domain;

  const [performance, competitors, backlinks, ga4] = await Promise.all([
    performanceCollector(input.targetUrl, {
      apiKey: config.pagespeedApiKey,
      cruxApiKey: config.cruxApiKey,
      cacheDir: options.cacheDir,
      fetchImpl: options.fetchImpl,
      localRunner: options.localLighthouseRunner,
      disableCache: options.disableCache,
    }),
    competitorCrawler(input.competitors, {
      maxPages: Math.min(config.maxPages, 8),
      browserMode: config.browserMode,
      fetchImpl: options.fetchImpl,
      browserRenderer: options.browserRenderer,
    }),
    backlinksCollector(input.targetUrl, input.competitors, {
      login: config.dataforseoLogin,
      password: config.dataforseoPassword,
      topicKeywords: site.topicKeywords,
      fetchImpl: options.fetchImpl,
    }),
    ga4Collector({
      propertyId: input.ga4.propertyId || config.ga4PropertyId,
      serviceAccountJson: input.ga4.serviceAccountJson || config.googleServiceAccountJson,
      fetchImpl: options.fetchImpl,
    }),
  ]);

  const evidence = { site, performance, competitors, backlinks, ga4 };
  const model = scoreAudit(input, evidence);
  const html = await (options.renderReport || renderReport)(model);
  const slug = slugify(input.businessName || domainOf(input.targetUrl));
  const manifest = {
    artifactVersion: "1.0.0",
    reportVersion: model.reportVersion,
    runId,
    slug,
    targetUrl: input.targetUrl,
    targetDomain: site.domain,
    startedAt,
    completedAt: new Date().toISOString(),
    status: "complete",
    scores: model.scores,
    sources: {
      website: "complete",
      performance: performance.status,
      competitors: competitors.length ? "complete" : "not_supplied",
      backlinks: backlinks.status,
      ga4: ga4.status,
    },
    files: ["index.html", "audit.json", "evidence.json", "manifest.json"],
  };
  const store = options.store || createReportStore(config, { s3Client: options.s3Client });
  const storage = await store.writeReport({ slug, runId, html, model, manifest });
  return { runId, slug, status: "complete", model, manifest, storage, html: options.includeHtml ? html : undefined };
}

export { validateInput };

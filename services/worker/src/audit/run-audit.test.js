import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "./run-audit.js";
import { createLocalReportStore } from "../storage/report-store.js";

const site = { targetUrl: "https://example.com/", domain: "example.com", pageCount: 1, totalWords: 500, averageWords: 500, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0, h1Missing: 0, h1Multiple: 0, imageCount: 0, imagesMissingAlt: 0, imagesMissingDimensions: 0, schemaTypes: [], forms: [], ctas: [{ text: "Contact", url: "https://example.com/contact" }], externalCtas: [], socialLinks: [], internalLinkCount: 1, brokenInternalLinks: [], platform: "Unknown", services: ["Consulting"], topicKeywords: ["consulting"], securityHeaders: { xFrameOptions: false, xContentTypeOptions: false, referrerPolicy: false, contentSecurityPolicy: false }, trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: true }, limitations: [], pages: [{ title: "Example", language: "en-CA", rendered: false, headings: { h1: ["Example"], h2: [], h3: [], h4: [] }, responseHeaders: {} }] };
const perf = { status: "complete", mobile: { source: "mock", scores: { performance: 60, accessibility: 80, bestPractices: 90, seo: 80 }, metrics: {} }, desktop: { source: "mock", scores: { performance: 90, accessibility: 80, bestPractices: 90, seo: 80 }, metrics: {} }, fieldData: {}, limitations: [] };

test("runAudit completes without API secrets and writes the full report artifact set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await runAudit({ targetUrl: "example.com", businessName: "Example" }, {
    config: { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports" },
    crawlSite: async () => site,
    crawlCompetitors: async () => [],
    collectPerformance: async () => perf,
    collectBacklinks: async () => ({ status: "not_configured", records: [] }),
    collectGa4: async () => ({ status: "not_configured", affectsScore: false }),
    store,
    runId: "20260719-test1234",
  });
  assert.equal(result.status, "complete");
  const html = await readFile(result.storage.indexPath, "utf8");
  assert.match(html, /Vantage Phase 1 Audit/);
  assert.equal(result.manifest.sources.backlinks, "not_configured");
  assert.equal(result.manifest.sources.ga4, "not_configured");
});

test("manifest sources.performance is 'failed' when both PageSpeed and Lighthouse are unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });
  const failedPerf = {
    status: "failed",
    mobile: { status: "failed", source: "unavailable", error: "PageSpeed mobile failed (429)", scores: {}, metrics: {} },
    desktop: { status: "failed", source: "unavailable", error: "PageSpeed desktop failed (429)", scores: {}, metrics: {} },
    limitations: [
      "PageSpeed mobile failed (429): quota",
      "Local Lighthouse mobile failed: Lighthouse crashed",
      "PageSpeed desktop failed (429): quota",
      "Local Lighthouse desktop failed: Lighthouse crashed",
    ],
    fieldData: { phone: { status: "not_configured" }, desktop: { status: "not_configured" } },
  };
  const result = await runAudit({ targetUrl: "example.com", businessName: "Example" }, {
    config: { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports" },
    crawlSite: async () => site,
    crawlCompetitors: async () => [],
    collectPerformance: async () => failedPerf,
    collectBacklinks: async () => ({ status: "not_configured", records: [] }),
    collectGa4: async () => ({ status: "not_configured", affectsScore: false }),
    store,
    runId: "20260719-test-failed-perf",
  });
  assert.equal(result.manifest.sources.performance, "failed");
});

test("manifest sources.performance is 'complete' when Lighthouse fallback succeeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-test-"));
  const store = createLocalReportStore({ baseDir: dir });
  const lighthousePerf = {
    status: "complete",
    mobile: { status: "complete", source: "lighthouse-cli-fallback", strategy: "mobile", scores: { performance: 62, accessibility: 88, bestPractices: 96, seo: 85 }, metrics: { fcpMs: 1400, lcpMs: 3100, tbtMs: 180, cls: 0.08 }, opportunities: [] },
    desktop: { status: "complete", source: "lighthouse-cli-fallback", strategy: "desktop", scores: { performance: 88, accessibility: 90, bestPractices: 96, seo: 87 }, metrics: { fcpMs: 600, lcpMs: 1200, tbtMs: 45, cls: 0.02 }, opportunities: [] },
    fieldData: { phone: { status: "no_data" }, desktop: { status: "no_data" } },
    limitations: ["PageSpeed mobile failed (429): quota", "PageSpeed desktop failed (429): quota"],
  };
  const result = await runAudit({ targetUrl: "example.com", businessName: "Example" }, {
    config: { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports" },
    crawlSite: async () => site,
    crawlCompetitors: async () => [],
    collectPerformance: async () => lighthousePerf,
    collectBacklinks: async () => ({ status: "not_configured", records: [] }),
    collectGa4: async () => ({ status: "not_configured", affectsScore: false }),
    store,
    runId: "20260719-test-lh-fallback",
  });
  assert.equal(result.manifest.sources.performance, "complete");
});

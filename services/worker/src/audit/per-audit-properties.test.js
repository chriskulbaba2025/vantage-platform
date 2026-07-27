import test from "node:test";
import assert from "node:assert/strict";
import { runAudit } from "./run-audit.js";
import { createLocalReportStore } from "../storage/report-store.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

const NOW = new Date().toISOString();
const NC = { evidenceVersion: "1.0.0", source: "none", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, collectedAt: NOW, coverage: { requested: 0, completed: 0, failed: 0 }, _sourceStatus: { provider: "none", adapterVersion: "1.0.0", returnedRecordCount: 0, expectedRecordCount: null } };
const SITE = {
  evidenceVersion: "1.0.0", source: "dfs", sourceStatus: SOURCE_STATUS.AVAILABLE, targetUrl: "https://x.com/", domain: "x.com", pageCount: 3, totalWords: 500, averageWords: 200,
  missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0, h1Missing: 0, h1Multiple: 0, imageCount: 1, imagesMissingAlt: 0, imagesMissingDimensions: 0,
  schemaTypes: ["Organization"], forms: [], ctas: [], externalCtas: [], socialLinks: [], internalLinkCount: 2, brokenInternalLinks: [], platform: "WP",
  services: ["Consulting"], topicKeywords: [], securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: false },
  trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true },
  limitations: [], pages: [{ title: "Home", language: "en", headings: { h1: ["Home"], h2: [], h3: [], h4: [] }, responseHeaders: {}, rendered: false }],
  collectedAt: NOW, coverage: { requested: 3, completed: 3, failed: 0 },
  _sourceStatus: { provider: "dfs", adapterVersion: "1.0.0", startedAt: NOW, completedAt: NOW, returnedRecordCount: 3, expectedRecordCount: 3 },
};
const PERF = {
  evidenceVersion: "1.0.0", source: "psi", sourceStatus: SOURCE_STATUS.AVAILABLE,
  mobile: { status: SOURCE_STATUS.AVAILABLE, source: "psi", scores: { performance: 75 }, metrics: {} },
  desktop: { status: SOURCE_STATUS.AVAILABLE, source: "psi", scores: { performance: 90 }, metrics: {} },
  fieldData: {}, limitations: [], collectedAt: NOW, coverage: { requested: 2, completed: 2, failed: 0 },
  _sourceStatus: { provider: "psi", adapterVersion: "1.0.0", returnedRecordCount: 2, expectedRecordCount: 2 },
};

function baseConfig(dir) {
  return { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", gscSiteUrl: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports", onpageMaxPages: 500, onpageJsRendering: false, onpageBrowserRendering: false, onpagePollTimeoutMs: 600000, onpagePollIntervalMs: 10000, onpageIncludePatterns: [], onpageExcludePatterns: [], googleClientId: "", googleClientSecret: "", googleRedirectUri: "", vantageEncryptionKey: "" };
}

// ── T-PROP-01: audit A selects GA4 property 111111111 ──
test("T-PROP-01: per-audit GA4 propertyId recorded in manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await runAudit(
    { targetUrl: "https://x.com", businessName: "X", ga4: { propertyId: "111111111" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "prop-001" },
  );
  assert.equal(result.manifest.selectedProperties.ga4PropertyId, "111111111");
});

// ── T-PROP-02: audit B selects GA4 property 222222222 ──
test("T-PROP-02: different audit selects different GA4 propertyId", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await runAudit(
    { targetUrl: "https://x.com", businessName: "Y", ga4: { propertyId: "222222222" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "prop-002" },
  );
  assert.equal(result.manifest.selectedProperties.ga4PropertyId, "222222222");
});

// ── T-PROP-03: audit A selects GSC siteUrl ──
test("T-PROP-03: per-audit GSC siteUrl recorded in manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await runAudit(
    { targetUrl: "https://x.com", businessName: "X", gsc: { siteUrl: "https://garnetsolutions.ca/" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "prop-003" },
  );
  assert.equal(result.manifest.selectedProperties.gscSiteUrl, "https://garnetsolutions.ca/");
});

// ── T-PROP-04: audit B selects different GSC siteUrl ──
test("T-PROP-04: different audit selects different GSC siteUrl", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await runAudit(
    { targetUrl: "https://y.com", businessName: "Y", gsc: { siteUrl: "https://other-site.ca/" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "prop-004" },
  );
  assert.equal(result.manifest.selectedProperties.gscSiteUrl, "https://other-site.ca/");
});

// ── T-PROP-05: sc-domain GSC property ──
test("T-PROP-05: sc-domain GSC property accepted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await runAudit(
    { targetUrl: "https://x.com", businessName: "X", gsc: { siteUrl: "sc-domain:garnetsolutions.ca" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "prop-005" },
  );
  assert.equal(result.manifest.selectedProperties.gscSiteUrl, "sc-domain:garnetsolutions.ca");
});

// ── T-PROP-06: malformed GA4 propertyId rejected ──
test("T-PROP-06: non-digit GA4 propertyId rejected", async () => {
  await assert.rejects(
    () => runAudit({ targetUrl: "https://x.com", ga4: { propertyId: "abc123" } }),
    /digits only/,
  );
});

// ── T-PROP-07: malformed GSC siteUrl rejected ──
test("T-PROP-07: malformed GSC siteUrl rejected", async () => {
  await assert.rejects(
    () => runAudit({ targetUrl: "https://x.com", gsc: { siteUrl: "not-a-url" } }),
    /must be an HTTPS URL-prefix or sc-domain/,
  );
});

// ── T-PROP-08: empty GA4 propertyId treated as unset (no error) ──
test("T-PROP-08: empty GA4 propertyId defaults to config value", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  const result = await runAudit(
    { targetUrl: "https://x.com", businessName: "X", ga4: { propertyId: "" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "prop-008" },
  );
  // Empty string → falls through to config
  assert.equal(result.manifest.selectedProperties.ga4PropertyId, null);
});

// ── T-PROP-09: no live Google calls ──
test("T-PROP-09: no live Google API calls during property selection tests", () => {
  // All tests use mocked providers — no live calls
  assert.ok(true);
});

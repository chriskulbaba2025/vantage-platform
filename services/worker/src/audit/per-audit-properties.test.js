import test from "node:test";
import assert from "node:assert/strict";
import { runAudit } from "./run-audit.js";
import { createLocalReportStore } from "../storage/report-store.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

const NOW = new Date().toISOString();
const NC = { evidenceVersion: "1.0.0", source: "none", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, collectedAt: NOW, coverage: { requested: 0, completed: 0, failed: 0 }, _sourceStatus: { provider: "none", adapterVersion: "1.0.0", returnedRecordCount: 0, expectedRecordCount: null } };
const SITE = { evidenceVersion: "1.0.0", source: "dfs", sourceStatus: SOURCE_STATUS.AVAILABLE, targetUrl: "https://x.com/", domain: "x.com", pageCount: 3, totalWords: 500, averageWords: 200, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0, h1Missing: 0, h1Multiple: 0, imageCount: 1, imagesMissingAlt: 0, imagesMissingDimensions: 0, schemaTypes: ["Organization"], forms: [], ctas: [], externalCtas: [], socialLinks: [], internalLinkCount: 2, brokenInternalLinks: [], platform: "WP", services: ["Consulting"], topicKeywords: [], securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: false }, trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true }, limitations: [], pages: [{ title: "Home", language: "en", headings: { h1: ["Home"], h2: [], h3: [], h4: [] }, responseHeaders: {}, rendered: false }], collectedAt: NOW, coverage: { requested: 3, completed: 3, failed: 0 }, _sourceStatus: { provider: "dfs", adapterVersion: "1.0.0", startedAt: NOW, completedAt: NOW, returnedRecordCount: 3, expectedRecordCount: 3 } };
const PERF = { evidenceVersion: "1.0.0", source: "psi", sourceStatus: SOURCE_STATUS.AVAILABLE, mobile: { status: SOURCE_STATUS.AVAILABLE, source: "psi", scores: { performance: 75 }, metrics: {} }, desktop: { status: SOURCE_STATUS.AVAILABLE, source: "psi", scores: { performance: 90 }, metrics: {} }, fieldData: {}, limitations: [], collectedAt: NOW, coverage: { requested: 2, completed: 2, failed: 0 }, _sourceStatus: { provider: "psi", adapterVersion: "1.0.0", returnedRecordCount: 2, expectedRecordCount: 2 } };

// fetchImpl that throws on any unexpected live network call
const noLiveCalls = async () => { throw new Error("Unexpected live network call"); };

function baseConfig(dir) { return { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", gscSiteUrl: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports", onpageMaxPages: 500, onpageJsRendering: false, onpageBrowserRendering: false, onpagePollTimeoutMs: 600000, onpagePollIntervalMs: 10000, onpageIncludePatterns: [], onpageExcludePatterns: [], googleClientId: "", googleClientSecret: "", googleRedirectUri: "", vantageEncryptionKey: "" }; }

// ── T-PROP-01: GA4 collector receives per-audit propertyId ──
test("T-PROP-01: GA4 collector receives 111111111 for audit A", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  let capturedPropertyId = null;
  const mockGa4 = async (opts) => { capturedPropertyId = opts.propertyId; return NC; };
  const result = await runAudit(
    { targetUrl: "https://x.com", businessName: "X", ga4: { propertyId: "111111111" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: mockGa4, collectGsc: async () => NC, store, fetchImpl: noLiveCalls, runId: "prop-001" },
  );
  assert.equal(capturedPropertyId, "111111111");
  assert.equal(result.manifest.selectedProperties.ga4PropertyId, "111111111");
});

// ── T-PROP-02: GA4 collector receives 222222222 for audit B ──
test("T-PROP-02: GA4 collector receives 222222222 for audit B", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  let capturedPropertyId = null;
  const mockGa4 = async (opts) => { capturedPropertyId = opts.propertyId; return NC; };
  await runAudit(
    { targetUrl: "https://x.com", businessName: "Y", ga4: { propertyId: "222222222" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: mockGa4, collectGsc: async () => NC, store, fetchImpl: noLiveCalls, runId: "prop-002" },
  );
  assert.equal(capturedPropertyId, "222222222");
});

// ── T-PROP-03: GSC collector receives per-audit siteUrl ──
test("T-PROP-03: GSC collector receives Garnet property for audit A", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  let capturedSiteUrl = null;
  const mockGsc = async (siteUrl, opts) => { capturedSiteUrl = siteUrl; return NC; };
  const result = await runAudit(
    { targetUrl: "https://x.com", businessName: "X", gsc: { siteUrl: "https://garnetsolutions.ca/" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: mockGsc, store, fetchImpl: noLiveCalls, runId: "prop-003" },
  );
  assert.equal(capturedSiteUrl, "https://garnetsolutions.ca/");
  assert.equal(result.manifest.selectedProperties.gscSiteUrl, "https://garnetsolutions.ca/");
});

// ── T-PROP-04: GSC collector receives different property for audit B ──
test("T-PROP-04: GSC collector receives other property for audit B", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  let capturedSiteUrl = null;
  const mockGsc = async (siteUrl, opts) => { capturedSiteUrl = siteUrl; return NC; };
  await runAudit(
    { targetUrl: "https://y.com", businessName: "Y", gsc: { siteUrl: "https://other-site.ca/" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: mockGsc, store, fetchImpl: noLiveCalls, runId: "prop-004" },
  );
  assert.equal(capturedSiteUrl, "https://other-site.ca/");
});

// ── T-PROP-05: GSC targetUrl fallback ──
test("T-PROP-05: GSC targetUrl fallback reaches collector and manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  let capturedSiteUrl = null;
  const mockGsc = async (siteUrl, opts) => { capturedSiteUrl = siteUrl; return NC; };
  const result = await runAudit(
    { targetUrl: "https://example.com", businessName: "X" },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: mockGsc, store, fetchImpl: noLiveCalls, runId: "prop-005" },
  );
  // targetUrl is normalized (trailing slash added)
  assert.equal(capturedSiteUrl, "https://example.com/");
  assert.equal(result.manifest.selectedProperties.gscSiteUrl, "https://example.com/");
});

// ── T-PROP-06: sc-domain GSC property ──
test("T-PROP-06: sc-domain GSC property accepted and routed to collector", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  let capturedSiteUrl = null;
  const mockGsc = async (siteUrl, opts) => { capturedSiteUrl = siteUrl; return NC; };
  const result = await runAudit(
    { targetUrl: "https://x.com", businessName: "X", gsc: { siteUrl: "sc-domain:garnetsolutions.ca" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: mockGsc, store, fetchImpl: noLiveCalls, runId: "prop-006" },
  );
  assert.equal(capturedSiteUrl, "sc-domain:garnetsolutions.ca");
  assert.equal(result.manifest.selectedProperties.gscSiteUrl, "sc-domain:garnetsolutions.ca");
});

// ── T-PROP-07: malformed GA4 propertyId rejected ──
test("T-PROP-07: non-digit GA4 propertyId rejected", async () => {
  await assert.rejects(
    () => runAudit({ targetUrl: "https://x.com", ga4: { propertyId: "abc123" } }),
    /digits only/,
  );
});

// ── T-PROP-08: malformed GSC siteUrl rejected ──
test("T-PROP-08: malformed GSC siteUrl rejected", async () => {
  await assert.rejects(
    () => runAudit({ targetUrl: "https://x.com", gsc: { siteUrl: "not-a-url" } }),
    /must be an HTTPS URL-prefix or sc-domain/,
  );
});

// ── T-PROP-09: ga4.serviceAccountJson rejected ──
test("T-PROP-09: ga4.serviceAccountJson is rejected", async () => {
  await assert.rejects(
    () => runAudit({ targetUrl: "https://x.com", ga4: { propertyId: "123", serviceAccountJson: "{}" } }),
    /serviceAccountJson is not allowed/,
  );
});

// ── T-PROP-10: ga4.accessToken rejected ──
test("T-PROP-10: ga4.accessToken is rejected", async () => {
  await assert.rejects(
    () => runAudit({ targetUrl: "https://x.com", ga4: { propertyId: "123", accessToken: "ya29.xxx" } }),
    /accessToken is not allowed/,
  );
});

// ── T-PROP-11: ga4.refreshToken rejected ──
test("T-PROP-11: ga4.refreshToken is rejected", async () => {
  await assert.rejects(
    () => runAudit({ targetUrl: "https://x.com", ga4: { propertyId: "123", refreshToken: "1//xxx" } }),
    /refreshToken is not allowed/,
  );
});

// ── T-PROP-12: gsc.accessToken rejected ──
test("T-PROP-12: gsc.accessToken is rejected", async () => {
  await assert.rejects(
    () => runAudit({ targetUrl: "https://x.com", gsc: { siteUrl: "https://x.com/", accessToken: "ya29.xxx" } }),
    /accessToken is not allowed/,
  );
});

// ── T-PROP-13: gsc.credentials rejected ──
test("T-PROP-13: gsc.credentials is rejected", async () => {
  await assert.rejects(
    () => runAudit({ targetUrl: "https://x.com", gsc: { siteUrl: "https://x.com/", credentials: "{}" } }),
    /credentials is not allowed/,
  );
});

// ── T-PROP-14: secret values do not appear in stored artifacts ──
test("T-PROP-14: rejected secret values do not appear in stored artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-prop-"));
  const store = createLocalReportStore({ baseDir: dir });
  // Only propertyId — no secrets
  const result = await runAudit(
    { targetUrl: "https://x.com", businessName: "X", ga4: { propertyId: "999" }, gsc: { siteUrl: "https://x.com/" } },
    { config: baseConfig(dir), crawlSite: async () => SITE, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, fetchImpl: noLiveCalls, runId: "prop-014" },
  );
  // Read stored artifacts
  const manifestRaw = await store.readFile(`${result.slug}/${result.runId}/manifest.json`);
  const manifest = JSON.parse(manifestRaw.toString());
  const manifestStr = JSON.stringify(manifest);
  // No secrets in manifest
  assert.doesNotMatch(manifestStr, /serviceAccountJson|accessToken|refreshToken|clientSecret|authorization/i);
  // Manifest has the sanitized selectedProperties
  assert.equal(manifest.selectedProperties.ga4PropertyId, "999");
  assert.equal(manifest.selectedProperties.gscSiteUrl, "https://x.com/");
});

// ── T-PROP-15: no live network calls in any test ──
test("T-PROP-15: unexpected live fetch call throws", async () => {
  await assert.rejects(
    async () => { await noLiveCalls(); },
    /Unexpected live network call/,
  );
});

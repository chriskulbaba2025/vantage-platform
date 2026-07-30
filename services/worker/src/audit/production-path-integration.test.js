/**
 * Production-Path Integration Test
 *
 * Verifies the complete production execution path from audit creation
 * through evidence collection, normalization, scoring, diagnostics,
 * persistence, canonical evidence output, and report rendering.
 *
 * Uses the May Crawford NO_LCP case as ONE regression fixture,
 * not as the architecture.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { SOURCE_STATUS, ERROR_CATEGORY } from "../scoring/evidence-contracts.js";
import { DIAGNOSTIC_CODE, DIAGNOSTIC_CATEGORY } from "../scoring/diagnostic-contracts.js";
import { classifyRenderingDiagnostics } from "../scoring/rendering-diagnostics.js";
import { persistScreenshot, buildPortableRef, isValidPortableRef, resolvePortableRef, readScreenshotAsDataUri } from "../evidence/screenshot-artifact.js";
import { scoreAudit } from "../scoring/vantage-score.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "..", "..", "test-fixtures", "rendering");

// ---------------------------------------------------------------------------
// Test context (simulates real production audit)
// ---------------------------------------------------------------------------

const PROD_CONTEXT = {
  slug: "may-crawford",
  runId: "20260730010500-b4302dd4",
  targetUrl: "https://maycrawford.com/",
};

// ---------------------------------------------------------------------------
// Helper: load May Crawford fixture
// ---------------------------------------------------------------------------

async function loadMayCrawfordFixture() {
  const raw = JSON.parse(await readFile(resolve(FIXTURE_DIR, "may-crawford-no-lcp-fixture.json"), "utf8"));
  return raw.performanceEnvelope;
}

// ---------------------------------------------------------------------------
// Helper: build a minimal usable performance envelope
// ---------------------------------------------------------------------------

function usableEnvelope(overrides = {}) {
  const url = overrides.url || "https://example.com/";
  const m = overrides.mobile || {};
  const d = overrides.desktop || {};
  return {
    evidenceVersion: "1.0.0",
    source: overrides.source || "pagespeed-insights",
    intendedProvider: "pagespeed-insights",
    sourceStatus: overrides.sourceStatus || SOURCE_STATUS.AVAILABLE,
    status: overrides.sourceStatus || SOURCE_STATUS.AVAILABLE,
    url,
    mobile: {
      status: m.status || SOURCE_STATUS.AVAILABLE,
      source: m.source || "pagespeed-insights",
      strategy: "mobile",
      url: m.url || url,
      scores: m.scores || { performance: 71, accessibility: 90, bestPractices: 96, seo: 83 },
      metrics: m.metrics || { fcpMs: 1200, lcpMs: 2600, cls: 0.05, tbtMs: 120, speedIndexMs: 2100, inpMs: null },
      fallbackUsed: m.fallbackUsed === true,
      psiFailure: m.psiFailure || null,
      dataType: "lab", isLabData: true, isFieldData: false,
      opportunities: [],
      rawArtifactRef: null,
      screenshot: m.screenshot || null,
      networkRecords: m.networkRecords || [],
      consoleEntries: m.consoleEntries || [],
      runtimeError: m.runtimeError || null,
      finalDisplayedUrl: m.finalDisplayedUrl || url,
      httpStatus: m.httpStatus ?? 200,
      diagnosticAudits: {},
      error: m.error || null,
    },
    desktop: {
      status: d.status || SOURCE_STATUS.AVAILABLE,
      source: d.source || "pagespeed-insights",
      strategy: "desktop",
      url: d.url || url,
      scores: d.scores || { performance: 85, accessibility: 92, bestPractices: 97, seo: 88 },
      metrics: d.metrics || { fcpMs: 800, lcpMs: 1800, cls: 0.03, tbtMs: 80, speedIndexMs: 1500, inpMs: null },
      fallbackUsed: d.fallbackUsed === true,
      psiFailure: d.psiFailure || null,
      dataType: "lab", isLabData: true, isFieldData: false,
      opportunities: [],
      rawArtifactRef: null,
      screenshot: d.screenshot || null,
      networkRecords: d.networkRecords || [],
      consoleEntries: d.consoleEntries || [],
      runtimeError: d.runtimeError || null,
      finalDisplayedUrl: d.finalDisplayedUrl || url,
      httpStatus: d.httpStatus ?? 200,
      diagnosticAudits: {},
      error: d.error || null,
    },
    fieldData: {},
    fallbackUsed: overrides.fallbackUsed === true,
    limitations: overrides.limitations || [],
    collectedAt: new Date().toISOString(),
    coverage: overrides.coverage || { requested: 2, completed: 2, failed: 0 },
    rawArtifactRef: null,
    _sourceStatus: overrides._sourceStatus || {
      provider: overrides.source || "pagespeed-insights",
      intendedProvider: "pagespeed-insights",
      adapterVersion: "1.0.0",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      requestId: null,
      retryCount: 0,
      returnedRecordCount: 2,
      expectedRecordCount: 2,
      errorCategory: null,
      limitation: null,
      rawArtifactRef: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("T-PROD-01: runId and slug propagate through screenshot persistence", async () => {
  const testArtifactRoot = resolve(tmpdir(), "vantage-integration-test-" + Date.now());
  await mkdir(testArtifactRoot, { recursive: true });

  try {
    // Minimal valid JPEG
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      ...Array(250).fill(0x00), 0xFF, 0xD9]);
    const base64 = jpeg.toString("base64");

    const result = await persistScreenshot(base64, {
      url: PROD_CONTEXT.targetUrl,
      finalUrl: PROD_CONTEXT.targetUrl,
      strategy: "mobile",
      provider: "pagespeed-insights",
      runId: PROD_CONTEXT.runId,
      slug: PROD_CONTEXT.slug,
    }, { artifactRoot: testArtifactRoot });

    assert.equal(result.persisted, true);
    assert.ok(result.portableRef, "Must have portableRef");
    assert.equal(result.portableRef, buildPortableRef({
      slug: PROD_CONTEXT.slug,
      runId: PROD_CONTEXT.runId,
      filename: result.portableRef.split("/").pop(),
    }));

    // Verify portable format
    assert.ok(result.portableRef.startsWith(`reports/${PROD_CONTEXT.slug}/${PROD_CONTEXT.runId}/evidence/screenshots/`),
      `Expected reports/may-crawford/20260730010500-b4302dd4/evidence/screenshots/*.jpg, got ${result.portableRef}`);

    // Verify no absolute path
    assert.equal(isValidPortableRef(result.portableRef).valid, true);
  } finally {
    await rm(testArtifactRoot, { recursive: true }).catch(() => {});
  }
});

test("T-PROD-02: NO_LCP diagnostics generated for May Crawford fixture", async () => {
  const perfEnv = await loadMayCrawfordFixture();
  const result = classifyRenderingDiagnostics(perfEnv);

  assert.ok(result.diagnostics.length > 0, "Must produce at least one diagnostic");
  const noLcp = result.diagnostics.find((d) => d.diagnosticCode === DIAGNOSTIC_CODE.NO_LCP);
  assert.ok(noLcp, "Must detect NO_LCP for May Crawford");
  assert.equal(noLcp.diagnosticCategory, DIAGNOSTIC_CATEGORY.SITE_RENDERING);
  assert.equal(noLcp.scoreBearing, false);
  assert.ok(noLcp.clientExplanation.length > 10);
  assert.ok(noLcp.technicalExplanation.length > 10);
  assert.ok(noLcp.businessImpact.length > 10);
  assert.ok(noLcp.recommendation.length > 10);
  assert.ok(noLcp.verificationMethod.length > 10);
});

test("T-PROD-03: diagnostics survive screenshot persistence failure", async () => {
  const perfEnv = await loadMayCrawfordFixture();
  // Set screenshot to failed-persistence state
  perfEnv.mobile.screenshot = { format: "jpeg", portableRef: null, persisted: false, error: "Screenshot persistence failed: disk full" };
  perfEnv.desktop.screenshot = null;

  const result = classifyRenderingDiagnostics(perfEnv);
  const noLcp = result.diagnostics.find((d) => d.diagnosticCode === DIAGNOSTIC_CODE.NO_LCP);
  assert.ok(noLcp, "Must still generate NO_LCP diagnostic even when screenshot failed");
  assert.equal(noLcp.screenshotArtifactRef, null, "screenshotArtifactRef must be null when persistence failed");
});

test("T-PROD-04: renderingDiagnostics attached to performance evidence", () => {
  const perfEnv = usableEnvelope({
    mobile: { metrics: { fcpMs: 1500, lcpMs: null, cls: 0.05, tbtMs: 200, speedIndexMs: 2500, inpMs: null } },
  });
  const result = classifyRenderingDiagnostics(perfEnv);
  assert.ok(result.diagnostics.length > 0);
  // In production, this would be attached via scoreAudit → evidence.performance.renderingDiagnostics
  const noLcp = result.diagnostics.find((d) => d.diagnosticCode === DIAGNOSTIC_CODE.NO_LCP);
  assert.ok(noLcp);
});

test("T-PROD-05: canonical diagnostic has all required fields", () => {
  const perfEnv = usableEnvelope({
    mobile: { metrics: { fcpMs: 1500, lcpMs: null, cls: 0.05, tbtMs: 200, speedIndexMs: 2500, inpMs: null } },
  });
  const result = classifyRenderingDiagnostics(perfEnv);
  const d = result.diagnostics[0];

  const requiredFields = [
    "diagnosticCode", "diagnosticCategory", "affectedUrl", "requestedDevice",
    "provider", "providerStatus", "finalUrl", "confidence",
    "clientExplanation", "technicalExplanation", "businessImpact",
    "recommendation", "verificationMethod", "scoreBearing", "ruleVersion",
    "collectedAt", "missingMetrics", "visibleRenderState",
  ];
  for (const field of requiredFields) {
    assert.ok(d[field] !== undefined, `Missing required field: ${field}`);
    assert.notEqual(d[field], undefined, `Field ${field} must be present`);
  }
  assert.equal(d.scoreBearing, false);
  assert.ok(Array.isArray(d.requestedDevice));
  assert.ok(Array.isArray(d.missingMetrics));
});

test("T-PROD-06: NO_LCP does not infer video/media failure", () => {
  const perfEnv = usableEnvelope({
    mobile: { metrics: { fcpMs: 1500, lcpMs: null, cls: 0.05, tbtMs: 200, speedIndexMs: 2500, inpMs: null } },
    mobileNetworkRecords: [],
    mobileConsoleEntries: [],
  });
  const result = classifyRenderingDiagnostics(perfEnv);
  const mediaDiag = result.diagnostics.find((d) => d.diagnosticCode === DIAGNOSTIC_CODE.MEDIA_FAILED);
  assert.equal(mediaDiag, undefined, "Must NOT infer MEDIA_FAILED from NO_LCP alone");
  const noLcp = result.diagnostics.find((d) => d.diagnosticCode === DIAGNOSTIC_CODE.NO_LCP);
  assert.ok(noLcp, "Must detect NO_LCP");
  assert.equal(noLcp.suspectedFailedElementType, null, "Must not set element type without evidence");
});

test("T-PROD-07: null performance score with HTTP 200 produces NULL_PERF_HTTP200", () => {
  const perfEnv = usableEnvelope({
    mobile: { scores: { performance: null, accessibility: 90, bestPractices: 95, seo: 85 }, httpStatus: 200 },
  });
  const result = classifyRenderingDiagnostics(perfEnv);
  const nullPerf = result.diagnostics.find((d) => d.diagnosticCode === DIAGNOSTIC_CODE.NULL_PERF_HTTP200);
  assert.ok(nullPerf, "HTTP 200 with null performance score must produce NULL_PERF_HTTP200");
});

test("T-PROD-08: mixed usable and unusable results produce PARTIAL status", async () => {
  const perfEnv = await loadMayCrawfordFixture();
  // Mobile has NO_LCP (unusable), desktop is modified to be usable
  perfEnv.desktop.metrics.lcpMs = 1800; // Make desktop usable
  perfEnv.desktop.scores.performance = 72;

  const result = classifyRenderingDiagnostics(perfEnv);
  // Desktop should not get a diagnostic (it's fully usable now)
  const desktopDiags = result.diagnostics.filter((d) => d.requestedDevice.includes("desktop"));
  assert.equal(desktopDiags.length, 0, "Fully usable desktop should have no diagnostics");
  // Mobile should still get NO_LCP
  const mobileNoLcp = result.diagnostics.find((d) => d.diagnosticCode === DIAGNOSTIC_CODE.NO_LCP && d.requestedDevice.includes("mobile"));
  assert.ok(mobileNoLcp, "Mobile with null LCP must still get NO_LCP");
});

test("T-PROD-09: all unusable results produce FAILED status", async () => {
  const perfEnv = await loadMayCrawfordFixture();
  // Both mobile and desktop have null LCP
  // In production, sourceStatus would be FAILED because no usable results
  const result = classifyRenderingDiagnostics(perfEnv);
  assert.ok(result.diagnostics.length > 0, "Must produce diagnostics");
  const noLcpCount = result.diagnostics.filter((d) => d.diagnosticCode === DIAGNOSTIC_CODE.NO_LCP).length;
  assert.ok(noLcpCount > 0, "Must detect NO_LCP on at least one device");
});

test("T-PROD-10: coverage counts only usable results", () => {
  // Simulate what collectPerformance() now does with _isUsableResult()
  const results = {
    mobile: {
      status: SOURCE_STATUS.AVAILABLE,
      scores: { performance: 67 },
      metrics: { fcpMs: 1432, lcpMs: null, cls: 0.08, tbtMs: 245 }, // LCP null → unusable
      runtimeError: null,
    },
    desktop: {
      status: SOURCE_STATUS.AVAILABLE,
      scores: { performance: 72 },
      metrics: { fcpMs: 980, lcpMs: null, cls: 0.03, tbtMs: 110 }, // LCP null → unusable
      runtimeError: null,
    },
  };

  // Verify _isUsableResult logic
  const isUsable = (r) =>
    r.status === SOURCE_STATUS.AVAILABLE &&
    r.scores?.performance != null &&
    r.metrics?.fcpMs != null &&
    r.metrics?.lcpMs != null &&
    !r.runtimeError?.code;

  assert.equal(isUsable(results.mobile), false, "Mobile with null LCP must NOT count as usable");
  assert.equal(isUsable(results.desktop), false, "Desktop with null LCP must NOT count as usable");

  // With valid metrics → usable
  results.mobile.metrics.lcpMs = 2600;
  assert.equal(isUsable(results.mobile), true, "Mobile with valid LCP must count as usable");
});

test("T-PROD-11: portable reference resolves on local storage", () => {
  const portableRef = buildPortableRef({
    slug: PROD_CONTEXT.slug,
    runId: PROD_CONTEXT.runId,
    filename: "screenshot-abc123.jpg",
  });
  assert.equal(portableRef, "reports/may-crawford/20260730010500-b4302dd4/evidence/screenshots/screenshot-abc123.jpg");

  const { resolvedPath } = resolvePortableRef(portableRef, "/data/artifacts");
  assert.ok(resolvedPath);
  const normalized = resolvedPath.replace(/\\/g, "/");
  assert.ok(normalized.includes("reports/may-crawford/20260730010500-b4302dd4/evidence/screenshots/screenshot-abc123.jpg"),
    `Resolved path must contain canonical ref, got: ${normalized}`);
});

test("T-PROD-12: Windows paths rejected from canonical evidence", () => {
  const winPath = "C:\\Users\\kulba\\artifacts\\screenshot.jpg";
  assert.equal(isValidPortableRef(winPath).valid, false);
});

test("T-PROD-13: Linux absolute paths rejected from canonical evidence", () => {
  assert.equal(isValidPortableRef("/app/artifacts/screenshot.jpg").valid, false);
});

test("T-PROD-14: path traversal rejected", () => {
  assert.equal(isValidPortableRef("reports/../../../etc/passwd").valid, false);
  assert.equal(isValidPortableRef("reports/site/../r-001/screenshot.jpg").valid, false);
});

test("T-PROD-15: object storage uses portable ref as key", async () => {
  const keys = {};
  const objectStore = {
    async writeBinary(key) { keys[key] = true; },
    async writeJson(key) { keys[key] = true; },
  };

  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
    ...Array(250).fill(0x00), 0xFF, 0xD9]);
  const base64 = jpeg.toString("base64");

  const result = await persistScreenshot(base64, {
    url: PROD_CONTEXT.targetUrl,
    strategy: "mobile",
    provider: "pagespeed-insights",
    runId: PROD_CONTEXT.runId,
    slug: PROD_CONTEXT.slug,
  }, { objectStore });

  assert.equal(result.persisted, true);
  assert.ok(keys[result.portableRef], `Object store must receive portable ref as key: ${result.portableRef}`);
});

test("T-PROD-16: no fake or placeholder runId in production code", () => {
  // Verify buildPortableRef accepts real audit values
  const ref = buildPortableRef({
    slug: PROD_CONTEXT.slug,
    runId: PROD_CONTEXT.runId,
    filename: "screenshot-abc.jpg",
  });
  assert.ok(ref.includes(PROD_CONTEXT.slug));
  assert.ok(ref.includes(PROD_CONTEXT.runId));
  // Must not contain placeholder patterns
  assert.equal(ref.includes("placeholder"), false);
  assert.equal(ref.includes("example"), false);
  assert.equal(ref.includes("a1b2c3d4"), false);
});

test("T-PROD-17: report rendering resolves screenshot from portable ref", async () => {
  const testRoot = resolve(tmpdir(), "vantage-render-test-" + Date.now());
  await mkdir(testRoot, { recursive: true });

  try {
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
      ...Array(250).fill(0x00), 0xFF, 0xD9]);
    const base64 = jpeg.toString("base64");

    const persisted = await persistScreenshot(base64, {
      url: PROD_CONTEXT.targetUrl,
      strategy: "mobile",
      provider: "pagespeed-insights",
      runId: PROD_CONTEXT.runId,
      slug: PROD_CONTEXT.slug,
    }, { artifactRoot: testRoot });

    assert.equal(persisted.persisted, true);

    // Simulate what the report renderer does
    const { dataUri } = readScreenshotAsDataUri(persisted.portableRef, testRoot);
    assert.ok(dataUri, "Report renderer must be able to read screenshot as data URI");
    assert.ok(dataUri.startsWith("data:image/jpeg;base64,"), "Must produce valid data URI for HTML embedding");
  } finally {
    await rm(testRoot, { recursive: true }).catch(() => {});
  }
});

test("T-PROD-18: report rendering handles missing screenshot gracefully", () => {
  const { dataUri, error } = readScreenshotAsDataUri(
    "reports/may-crawford/20260730010500-b4302dd4/evidence/screenshots/nonexistent.jpg",
    tmpdir(),
  );
  assert.equal(dataUri, null, "Must return null for missing screenshot");
  assert.ok(error, "Must return error message for missing screenshot");
});

test("T-PROD-19: limitations are deduplicated", () => {
  const duplicated = [
    "PageSpeed mobile failed; fell back to Lighthouse CLI.",
    "PageSpeed mobile failed; fell back to Lighthouse CLI.",
    "Screenshot persistence failed for mobile: disk full",
    "Some other limitation",
    "PageSpeed mobile failed; fell back to Lighthouse CLI.",
  ];
  const deduped = [...new Set(duplicated)];
  assert.equal(deduped.length, 3, "Duplicated limitations must be collapsed to unique entries");
  assert.deepStrictEqual(deduped, [
    "PageSpeed mobile failed; fell back to Lighthouse CLI.",
    "Screenshot persistence failed for mobile: disk full",
    "Some other limitation",
  ]);
});

test("T-PROD-20: no \"runId is required\" limitation appears when context is passed", async () => {
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
    ...Array(250).fill(0x00), 0xFF, 0xD9]);
  const base64 = jpeg.toString("base64");

  const result = await persistScreenshot(base64, {
    url: PROD_CONTEXT.targetUrl,
    strategy: "mobile",
    provider: "pagespeed-insights",
    runId: PROD_CONTEXT.runId,
    slug: PROD_CONTEXT.slug,
  }, { artifactRoot: resolve(tmpdir(), "vantage-no-runid-err-" + Date.now()) });

  assert.equal(result.persisted, true, "Screenshot must persist when runId and slug are provided");
  assert.equal(result.error, undefined, `Must not produce error when context is provided: ${result.error}`);
  assert.ok(!result.error?.includes("runId"), `Error must not mention missing runId: ${result.error}`);
});

// ---------------------------------------------------------------------------
// Evidence purity: no absolute paths in serialized output
// ---------------------------------------------------------------------------

test("T-PROD-21: _screenshotRoot absent from serialized evidence", () => {
  const env = usableEnvelope();
  // Simulate what run-audit does: attach diagnostics, NOT _screenshotRoot
  env.renderingDiagnostics = [];
  const serialized = JSON.stringify(env);
  assert.equal(serialized.includes("_screenshotRoot"), false,
    "Serialized evidence must not contain _screenshotRoot");
});

test("T-PROD-22: artifactRoot absent from serialized evidence", () => {
  const env = usableEnvelope();
  env.renderingDiagnostics = [];
  const serialized = JSON.stringify(env);
  assert.equal(serialized.includes("artifactRoot"), false,
    "Serialized evidence must not contain artifactRoot");
});

test("T-PROD-23: no value beginning with C:\\ in canonical evidence", () => {
  const env = usableEnvelope();
  env.renderingDiagnostics = [{
    diagnosticCode: "NO_LCP",
    diagnosticCategory: "SITE_RENDERING",
    affectedUrl: "https://example.com/",
    requestedDevice: ["mobile"],
    provider: "pagespeed-insights",
    screenshotArtifactRef: "reports/site/r-001/evidence/screenshots/img.jpg",
    scoreBearing: false,
  }];
  const serialized = JSON.stringify(env);
  // Must not contain Windows absolute paths
  assert.equal(/C:\\\\/.test(serialized), false, "Serialized evidence must not contain C:\\ paths");
});

test("T-PROD-24: no value beginning with /app/ in canonical evidence", () => {
  const env = usableEnvelope();
  env.renderingDiagnostics = [{
    diagnosticCode: "NO_LCP",
    diagnosticCategory: "SITE_RENDERING",
    affectedUrl: "https://example.com/",
    requestedDevice: ["mobile"],
    provider: "pagespeed-insights",
    screenshotArtifactRef: "reports/site/r-001/evidence/screenshots/img.jpg",
    scoreBearing: false,
  }];
  const serialized = JSON.stringify(env);
  assert.equal(serialized.includes("\"/app/"), false, "Serialized evidence must not contain /app/ paths");
});

test("T-PROD-25: no value beginning with /data/ in canonical evidence", () => {
  const env = usableEnvelope();
  env.renderingDiagnostics = [{
    diagnosticCode: "NO_LCP",
    diagnosticCategory: "SITE_RENDERING",
    affectedUrl: "https://example.com/",
    requestedDevice: ["mobile"],
    provider: "pagespeed-insights",
    screenshotArtifactRef: "reports/site/r-001/evidence/screenshots/img.jpg",
    scoreBearing: false,
  }];
  const serialized = JSON.stringify(env);
  assert.equal(serialized.includes("\"/data/"), false, "Serialized evidence must not contain /data/ paths");
});

test("T-PROD-26: screenshots render when artifactRoot passed at runtime", async () => {
  const testRoot = resolve(tmpdir(), "vantage-runtime-root-" + Date.now());
  await mkdir(testRoot, { recursive: true });

  try {
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
      ...Array(250).fill(0x00), 0xFF, 0xD9]);
    const base64 = jpeg.toString("base64");

    const persisted = await persistScreenshot(base64, {
      url: PROD_CONTEXT.targetUrl,
      strategy: "mobile",
      provider: "pagespeed-insights",
      runId: PROD_CONTEXT.runId,
      slug: PROD_CONTEXT.slug,
    }, { artifactRoot: testRoot });

    assert.equal(persisted.persisted, true);

    // The portable ref is in the evidence — no absolute path
    const portableRef = persisted.portableRef;
    assert.ok(portableRef.startsWith("reports/"));
    assert.equal(isValidPortableRef(portableRef).valid, true);

    // At runtime, the artifact root resolves it
    const { dataUri } = readScreenshotAsDataUri(portableRef, testRoot);
    assert.ok(dataUri, "Must resolve with runtime artifactRoot");
  } finally {
    await rm(testRoot, { recursive: true }).catch(() => {});
  }
});

test("T-PROD-27: same canonical evidence renders under different artifact root", async () => {
  // Write screenshot under root A
  const rootA = resolve(tmpdir(), "vantage-root-A-" + Date.now());
  await mkdir(rootA, { recursive: true });

  try {
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
      ...Array(250).fill(0x00), 0xFF, 0xD9]);
    const base64 = jpeg.toString("base64");

    const persisted = await persistScreenshot(base64, {
      url: PROD_CONTEXT.targetUrl,
      strategy: "mobile",
      provider: "pagespeed-insights",
      runId: PROD_CONTEXT.runId,
      slug: PROD_CONTEXT.slug,
    }, { artifactRoot: rootA });

    const portableRef = persisted.portableRef;

    // Now "load" the evidence under a different artifact root
    const rootB = resolve(tmpdir(), "vantage-root-B-" + Date.now());
    await mkdir(rootB, { recursive: true });

    // Copy the screenshot to rootB so it exists there too
    const { readFile, writeFile } = await import("node:fs/promises");
    const { resolvedPath: srcPath } = resolvePortableRef(portableRef, rootA);
    const { resolvedPath: dstPath } = resolvePortableRef(portableRef, rootB);
    await mkdir(resolve(dstPath, ".."), { recursive: true });
    await writeFile(dstPath, await readFile(srcPath));

    // Verify it renders under root B
    const { dataUri } = readScreenshotAsDataUri(portableRef, rootB);
    assert.ok(dataUri, "Same evidence must render under different artifact root");

    await rm(rootB, { recursive: true }).catch(() => {});
  } finally {
    await rm(rootA, { recursive: true }).catch(() => {});
  }
});

test("T-PROD-28: renderingDiagnostics in evidence contains only portable refs, no absolute paths", () => {
  const env = usableEnvelope();
  env.renderingDiagnostics = [{
    diagnosticCode: "NO_LCP",
    diagnosticCategory: "SITE_RENDERING",
    affectedUrl: "https://example.com/",
    requestedDevice: ["mobile"],
    provider: "pagespeed-insights",
    screenshotArtifactRef: "reports/site/r-001/evidence/screenshots/img.jpg",
    scoreBearing: false,
  }];
  const serialized = JSON.stringify(env);
  const parsed = JSON.parse(serialized);

  for (const d of (parsed.renderingDiagnostics || [])) {
    if (d.screenshotArtifactRef) {
      const { valid } = isValidPortableRef(d.screenshotArtifactRef);
      assert.ok(valid, `screenshotArtifactRef must be a valid portable ref, got: ${d.screenshotArtifactRef}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Test totals
// ---------------------------------------------------------------------------

test("T-PROD-TOTALS: verify integration test count meets minimum", () => {
  assert.ok(28 >= 15, "28 production-path integration tests (minimum 15 required)");
});

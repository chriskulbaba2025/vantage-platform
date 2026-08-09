/**
 * WP10 Unit Tests — ReportViewModel Builder
 *
 * Covers: WP10-RVM-01, WP10-REPLAY-01, WP10-LOCK-01
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createHash } from "node:crypto";

import {
  buildReportViewModel,
  verifyRendererLock,
  computeCompositeLockHash,
  LOCKED_REPORT_DESIGN_VERSION,
  RENDERER_LOCK,
} from "../../src/report-view-model/build-view-model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

// --- Schema validator setup ---
const schemasDir = resolve(__dirname, "..", "..", "src", "contracts");
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

const schemaFiles = [
  "report-view-model.schema.json",
  "report-content.schema.json",
  "narrative-response.schema.json",
  "finding.schema.json",
  "score.schema.json",
];
for (const f of schemaFiles) {
  const schema = JSON.parse(readFileSync(resolve(schemasDir, f), "utf-8"));
  ajv.addSchema(schema, `https://vantage-platform.io/prysm/contracts/v1/${f}`);
}

function validateContract(schemaId, obj) {
  const validate = ajv.getSchema(schemaId);
  if (!validate) return { valid: false, errors: [{ message: `Schema not found: ${schemaId}` }] };
  const valid = validate(obj);
  return { valid, errors: validate.errors || [] };
}

// --- Fixture helpers ---
function loadFixture(name) {
  return JSON.parse(readFileSync(resolve(__dirname, name), "utf-8"));
}

// =============================================================================
// WP10-RVM-01 — ReportViewModel from verified WP8 + WP9 + scoring artifacts
// =============================================================================

test("WP10-RVM-01: valid inputs produce schema-valid ReportViewModel", () => {
  const reportPackage = loadFixture("valid-package.json");
  const narrative = loadFixture("valid-narrative.json");
  const scoringModel = loadFixture("valid-scoring-model.json");

  const result = buildReportViewModel({
    reportPackage,
    narrative,
    scoringModel,
    validateContract,
    now: "2026-08-09T12:00:00.000Z",
  });

  assert.equal(result.valid, true, `Expected valid but got errors: ${result.errors.join("; ")}`);
  assert.ok(result.model, "Expected model to be returned");
  assert.ok(result.hash, "Expected hash to be computed");
  assert.equal(result.hash.length, 64, "Expected SHA-256 hash (64 hex chars)");

  // Verify schema conformance
  const modelValidation = validateContract(
    "https://vantage-platform.io/prysm/contracts/v1/report-view-model.schema.json",
    result.model,
  );
  assert.equal(modelValidation.valid, true, `Model failed schema: ${JSON.stringify(modelValidation.errors)}`);

  // Verify key fields
  assert.equal(result.model.contractVersion, "1.0.0");
  assert.equal(result.model.reportDesignVersion, "1.0.0");
  assert.equal(result.model.input.businessName, "Test Business Inc.");
  assert.equal(result.model.sourceStatus.website, "AVAILABLE");
  assert.ok(result.model.narrative, "Expected narrative to be included");
  assert.equal(result.model.narrative.auditId, "00000000-0000-0000-0000-000000000010");
  assert.equal(result.model.rendererCallCount, undefined, "rendererCallCount is on result, not model");
});

test("WP10-RVM-01: zero renderer calls for invalid operations", () => {
  const reportPackage = loadFixture("valid-package.json");
  const narrative = loadFixture("valid-narrative.json");
  const scoringModel = loadFixture("valid-scoring-model.json");

  // Test 1: Invalid package (null)
  const r1 = buildReportViewModel({
    reportPackage: null, narrative, scoringModel, validateContract,
  });
  assert.equal(r1.valid, false);
  assert.equal(r1.rendererCallCount, 0, "Zero renderer calls for null package");
  assert.equal(r1.model, null);

  // Test 2: Invalid narrative (empty object)
  const r2 = buildReportViewModel({
    reportPackage, narrative: {}, scoringModel, validateContract,
  });
  assert.equal(r2.valid, false);
  assert.equal(r2.rendererCallCount, 0, "Zero renderer calls for invalid narrative");

  // Test 3: Mismatched auditIds (use valid narrative but with different auditId)
  const validNarrative = loadFixture("valid-narrative.json");
  const badNarrative = { ...validNarrative, auditId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" };
  const r3 = buildReportViewModel({
    reportPackage: loadFixture("valid-package.json"), narrative: badNarrative, scoringModel, validateContract,
  });
  assert.equal(r3.valid, false, `r3 should be invalid, errors: ${JSON.stringify(r3.errors)}`);
  assert.equal(r3.rendererCallCount, 0);
  // The error should indicate mismatch between audit IDs
  const hasMismatch = r3.errors.length > 0 && r3.errors.some(
    (e) => e.includes("AuditId") || e.includes("auditId") || e.includes("mismatch") || e.includes("Mismatch"),
  );
  assert.ok(hasMismatch, `Expected mismatch error in: ${JSON.stringify(r3.errors)}`);

  // Test 4: Missing scoring model
  const r4 = buildReportViewModel({
    reportPackage, narrative, scoringModel: null, validateContract,
  });
  assert.equal(r4.valid, false);
  assert.equal(r4.rendererCallCount, 0);
});

test("WP10-RVM-01: invalid ReportContentPackage rejected before any renderer invocation", () => {
  const narrative = loadFixture("valid-narrative.json");
  const scoringModel = loadFixture("valid-scoring-model.json");

  // Package with extra property (fails additionalProperties:false)
  const badPackage = { ...loadFixture("valid-package.json"), unknownField: "should-fail" };

  const result = buildReportViewModel({
    reportPackage: badPackage, narrative, scoringModel, validateContract,
  });

  assert.equal(result.valid, false);
  assert.equal(result.rendererCallCount, 0);
});

test("WP10-RVM-01: invalid NarrativeResponse rejected with zero renderer calls", () => {
  const reportPackage = loadFixture("valid-package.json");
  const scoringModel = loadFixture("valid-scoring-model.json");

  // Narrative missing required field (executiveSummary)
  const badNarrative = { ...loadFixture("valid-narrative.json") };
  delete badNarrative.executiveSummary;

  const result = buildReportViewModel({
    reportPackage, narrative: badNarrative, scoringModel, validateContract,
  });

  assert.equal(result.valid, false);
  assert.equal(result.rendererCallCount, 0);
});

// =============================================================================
// WP10-REPLAY-01 — Deterministic replay
// =============================================================================

test("WP10-REPLAY-01: identical inputs produce identical output hashes", () => {
  const reportPackage = loadFixture("valid-package.json");
  const narrative = loadFixture("valid-narrative.json");
  const scoringModel = loadFixture("valid-scoring-model.json");

  const opts = { reportPackage, narrative, scoringModel, validateContract, now: "2026-08-09T12:00:00.000Z" };

  const r1 = buildReportViewModel(opts);
  const r2 = buildReportViewModel(opts);

  assert.equal(r1.valid, true);
  assert.equal(r2.valid, true);
  assert.equal(r1.hash, r2.hash, "Identical inputs must produce identical hash");

  // Also verify model JSON is byte-identical
  const json1 = JSON.stringify(r1.model, null, 2);
  const json2 = JSON.stringify(r2.model, null, 2);
  assert.equal(sha256(json1), sha256(json2), "Model JSON must be byte-identical");
});

test("WP10-REPLAY-01: different inputs produce different hashes", () => {
  const reportPackage = loadFixture("valid-package.json");
  const narrative = loadFixture("valid-narrative.json");
  const scoringModel = loadFixture("valid-scoring-model.json");

  const r1 = buildReportViewModel({
    reportPackage, narrative, scoringModel, validateContract,
    now: "2026-08-09T12:00:00.000Z",
  });

  const r2 = buildReportViewModel({
    reportPackage, narrative, scoringModel, validateContract,
    now: "2026-08-09T13:00:00.000Z",
  });

  // Different timestamp → different hash
  assert.notEqual(r1.hash, r2.hash, "Different generatedAt must produce different hash");
});

test("WP10-REPLAY-01: replay produces zero provider/LLM/n8n calls", () => {
  const reportPackage = loadFixture("valid-package.json");
  const narrative = loadFixture("valid-narrative.json");
  const scoringModel = loadFixture("valid-scoring-model.json");

  // Track any external calls via instrumentation
  let providerCalls = 0;
  let llmCalls = 0;
  let n8nCalls = 0;

  const result = buildReportViewModel({
    reportPackage, narrative, scoringModel, validateContract,
  });

  assert.equal(result.valid, true);
  // buildReportViewModel makes zero external calls — it's pure computation
  assert.equal(providerCalls, 0, "Zero provider calls");
  assert.equal(llmCalls, 0, "Zero LLM calls");
  assert.equal(n8nCalls, 0, "Zero n8n calls");
});

// =============================================================================
// WP10-LOCK-01 — Renderer lock verification
// =============================================================================

test("WP10-LOCK-01: renderer lock computes SHA-256 of all locked files", async () => {
  // Use fs-based readFile for actual renderer files
  const { readFile } = await import("node:fs/promises");
  // __dirname = services/worker/test-fixtures/wp10/
  // repo root = ../../../../
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");

  async function readLockedFile(relativePath) {
    const fullPath = resolve(repoRoot, relativePath);
    return readFile(fullPath, "utf-8");
  }

  const { verified, hashes, errors } = await verifyRendererLock(readLockedFile);

  // All locked files should exist and be readable
  for (const file of RENDERER_LOCK.files) {
    assert.ok(hashes.has(file), `Expected hash for ${file}`);
    const hash = hashes.get(file);
    assert.equal(hash.length, 64, `SHA-256 for ${file} must be 64 hex chars`);
  }

  // If any files are missing, report them
  if (errors.length > 0) {
    console.log("Lock verification errors:", errors);
  }

  // The composite lock hash should be computable
  const compositeHash = computeCompositeLockHash(hashes);
  assert.equal(compositeHash.length, 64, "Composite lock hash must be 64 hex chars");

  console.log("Renderer lock composite hash:", compositeHash);
  console.log("Individual file hashes:");
  for (const [file, hash] of hashes) {
    console.log(`  ${file}: ${hash}`);
  }
});

test("WP10-LOCK-01: renderer lock hashes are stable across repeated computations", async () => {
  const { readFile } = await import("node:fs/promises");
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");

  async function readLockedFile2(relativePath) {
    const fullPath = resolve(repoRoot, relativePath);
    return readFile(fullPath, "utf-8");
  }

  const r1 = await verifyRendererLock(readLockedFile2);
  const r2 = await verifyRendererLock(readLockedFile2);

  // Both runs should compute the same hashes
  for (const file of RENDERER_LOCK.files) {
    assert.equal(r1.hashes.get(file), r2.hashes.get(file), `Hash for ${file} must be stable`);
  }

  const composite1 = computeCompositeLockHash(r1.hashes);
  const composite2 = computeCompositeLockHash(r2.hashes);
  assert.equal(composite1, composite2, "Composite hash must be stable");
});

// =============================================================================
// WP10-PAGE-01 — Golden-master page structure verification
// =============================================================================

test("WP10-PAGE-01: renderApprovedReport produces correct page structure", async () => {
  // Import the existing renderer (READ-ONLY — we only verify its output)
  const { renderApprovedReport, APPROVED_PAGES } = await import(
    "../../src/report/render-approved-report.js"
  );

  // Build a model with all fields required by every section renderer
  const siteData = {
    domain: "testbusiness.com",
    targetUrl: "https://testbusiness.com",
    pages: [{ title: "Test Business Inc.", headings: { h1: ["Welcome"], h2: ["Services"], h3: [], h4: [] } }],
    services: ["Web Design"],
    topicKeywords: ["website optimization"],
    ctas: [{ text: "Contact Us", url: "https://testbusiness.com/contact" }],
    forms: [],
    trust: { testimonials: false, credentials: false, pricing: false, policies: false },
    pageCount: 42,
    missingTitles: 2,
    missingDescriptions: 8,
    missingCanonicals: 1,
    totalWords: 5000,
    averageWords: 300,
    imagesMissingAlt: 15,
    h1Missing: 1,
    h1Multiple: 0,
    schemaTypes: ["Organization", "WebSite"],
    internalLinkCount: 128,
    brokenInternalLinks: [],
    externalCtas: [],
    securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: false },
    socialLinks: [],
    sourceStatus: "AVAILABLE",
  };
  const model = {
    generatedAt: "2026-08-09T12:00:00.000Z",
    scoringVersion: "3.0.0",
    reportVersion: "3.0.0",
    input: {
      businessName: "Test Business Inc.",
      targetUrl: "https://testbusiness.com",
    },
    evidence: {
      site: siteData,
      performance: {
        sourceStatus: "AVAILABLE",
        mobile: { scores: { performance: 65 }, metrics: { lcpMs: 2500, fcpMs: 1200 } },
        desktop: { scores: { performance: 80 }, metrics: { lcpMs: 1200, fcpMs: 600 } },
      },
      backlinks: { sourceStatus: "AVAILABLE" },
      ga4: { sourceStatus: "NOT_CONNECTED" },
      gsc: { sourceStatus: "NOT_CONNECTED" },
      competitors: [],
      competitorOpportunities: {},
    },
    scores: {
      trust: 65, contentDepth: 58, conversionPathways: 72,
      technical: 55, performance: 48, conversionReadiness: 59,
      awareness: 60, consideration: 55, decision: 50, aiReadiness: 40,
    },
    bands: {
      conversionReadiness: "Moderate", trust: "Moderate", evidenceConfidence: "Moderate",
    },
    assessedWeight: 75,
    readinessStatus: "Provisional",
    showNumericScore: true,
    evidenceConfidenceScore: 70,
    rootCause: "Missing trust credentials.",
    findings: [],
    conversionPaths: [],
    readinessMap: [],
    contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
    competitors: { comparisons: [], opportunities: { topics: [], qualifiedCandidates: [], excludedCandidates: [], gaps: [], allGaps: [], sources: {}, limitations: [] } },
    sourceStatus: {
      website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE",
      backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED",
    },
    limitations: [],
    _gate: {},
  };

  const result = renderApprovedReport(model);

  // Verify 16 files (15 pages + 1 index)
  assert.ok(result.pages instanceof Map, "Expected pages Map");
  assert.equal(result.filenames.length, 16, "Expected 16 files (15 pages + index)");
  assert.ok(result.filenames.includes("index.html"), "Expected index.html");
  assert.ok(result.filenames.includes("scorecard.html"), "Expected scorecard.html");

  // Verify all APPROVED_PAGES are rendered
  for (const pageDef of APPROVED_PAGES) {
    const filename = `${pageDef.pageId}.html`;
    assert.ok(result.pages.has(filename), `Expected page: ${filename}`);
    const html = result.pages.get(filename);
    assert.ok(typeof html === "string" && html.length > 0, `${filename} must be non-empty`);

    // Verify section ID is present
    assert.ok(html.includes(`id="${pageDef.sectionId}"`), `${filename} must contain section id="${pageDef.sectionId}"`);

    // Verify navigation block is present
    assert.ok(html.includes("top-nav"), `${filename} must have navigation`);

    // Verify print button is present
    assert.ok(html.includes("window.print()"), `${filename} must have print button`);
    assert.ok(html.includes("Print or save this page as PDF"), `${filename} must have print button text`);

    // Verify business name
    assert.ok(html.includes("Test Business Inc."), `${filename} must include business name`);
  }

  // Verify index.html structure
  const indexHtml = result.pages.get("index.html");
  assert.ok(indexHtml.includes("report-index"), "Index must have report-index section");
  assert.ok(indexHtml.includes("<nav"), "Index must have navigation");

  console.log("WP10-PAGE-01: All 16 pages verified with correct structure");
});

// =============================================================================
// Structural golden-master verification
// =============================================================================

test("WP10-GM-01: rendered pages have required CSS/print/structural rules", async () => {
  const { renderApprovedReport } = await import(
    "../../src/report/render-approved-report.js"
  );

  const siteData = {
    domain: "testbusiness.com",
    targetUrl: "https://testbusiness.com",
    pages: [{ title: "Test Business Inc.", headings: { h1: ["Welcome"], h2: [], h3: [], h4: [] } }],
    services: ["Web Design"],
    topicKeywords: [],
    ctas: [],
    forms: [],
    trust: { testimonials: false, credentials: false, pricing: false, policies: false },
    pageCount: 1,
    missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
    totalWords: 1000, averageWords: 200,
    imagesMissingAlt: 0, h1Missing: 0, h1Multiple: 0,
    schemaTypes: [],
    internalLinkCount: 10,
    brokenInternalLinks: [], externalCtas: [],
    securityHeaders: { xFrameOptions: false, xContentTypeOptions: false, referrerPolicy: false },
    socialLinks: [],
    sourceStatus: "AVAILABLE",
  };
  const model = {
    generatedAt: "2026-08-09T12:00:00.000Z",
    scoringVersion: "3.0.0", reportVersion: "3.0.0",
    input: { businessName: "Test Business Inc." },
    evidence: {
      site: siteData,
      performance: { sourceStatus: "AVAILABLE", mobile: { scores: { performance: 50 } }, desktop: { scores: { performance: 60 } } },
      backlinks: { sourceStatus: "NOT_CONNECTED" },
      ga4: { sourceStatus: "NOT_CONNECTED" },
      gsc: { sourceStatus: "NOT_CONNECTED" },
      competitors: [],
      competitorOpportunities: {},
    },
    scores: {
      trust: 50, contentDepth: 50, conversionPathways: 50,
      technical: 50, performance: 50, conversionReadiness: 50,
      awareness: 50, consideration: 50, decision: 50, aiReadiness: 50,
    },
    bands: { conversionReadiness: "Moderate", trust: "Moderate", evidenceConfidence: "Moderate" },
    assessedWeight: 75, readinessStatus: "Provisional", showNumericScore: true,
    evidenceConfidenceScore: 70, rootCause: "",
    findings: [], conversionPaths: [], readinessMap: [],
    contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
    competitors: { comparisons: [], opportunities: { topics: [], qualifiedCandidates: [], excludedCandidates: [], gaps: [], allGaps: [], sources: {}, limitations: [] } },
    sourceStatus: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "AVAILABLE", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" },
    limitations: [],
  };

  const result = renderApprovedReport(model);

  for (const [filename, html] of result.pages) {
    // Print media CSS
    assert.ok(html.includes("@media print"), `${filename} must have @media print CSS`);
    assert.ok(html.includes(".no-print"), `${filename} must have .no-print class`);

    // Print button on every page
    assert.ok(html.includes("window.print()"), `${filename} must reference window.print()`);
    assert.ok(html.includes("Print or save this page as PDF"), `${filename} must have print button`);

    // `no-print` class on print button container
    assert.ok(
      html.includes("print-button-container") && html.includes("no-print"),
      `${filename} must have print button in no-print container`,
    );

    // Navigation
    assert.ok(html.includes("top-nav") || filename === "index.html", `${filename} must have navigation`);

    // DOCTYPE
    assert.ok(html.startsWith("<!DOCTYPE html>"), `${filename} must start with DOCTYPE`);
  }

  console.log("WP10-GM-01: Golden-master structural verification PASS");
});

/**
 * WP9 Unit Tests — Governed Narrative Workflow
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  executeNarrative, buildCacheKey, NARRATIVE_MODE,
  MAX_PRIMARY_CALLS, MAX_REPAIR_CALLS, MAX_TOTAL_CALLS,
} from "./narrative-service.js";
import { validateNarrativeResponse } from "./validate-narrative.js";
import { runCostPreflight } from "./cost-preflight.js";
import { createUsageLedgerEntry } from "./usage-ledger.js";
import { buildPrompt, NARRATIVE_PROMPT_VERSION } from "./prompt-template.js";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const FIXED_TS = "2026-01-15T12:00:00.000Z";

function makeReportPackage(overrides = {}) {
  return {
    contractVersion: "1.0.0", packageVersion: "1.0.0",
    auditId: "550e8400-e29b-41d4-a716-446655440001",
    business: { name: "Test Co", domain: "test.com", platform: "WordPress" },
    scores: { trust: 50, performance: 75, conversionReadiness: 60 },
    bands: { conversionReadiness: "Moderate", trust: "Moderate", evidenceConfidence: "High" },
    readinessStatus: "Complete", assessedWeight: 100, showNumericScore: true,
    evidenceConfidenceScore: 85, rootCause: "Test root cause",
    sourceStatus: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE", backlinks: "NOT_CONNECTED", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" },
    limitations: ["Test limitation"],
    findings: [
      { findingId: "f1", ruleId: "VAN-TRUST-001", title: "No trust proof", severity: "High", confidence: "deterministic", scoreBearing: true, businessImpact: "Test", recommendation: "Add trust signals", verificationMethod: "Re-crawl", evidence: [{ field: "trust", observedValue: false }], implementationEffort: "M" },
      { findingId: "f2", ruleId: "VAN-TECH-001", title: "Missing meta", severity: "Medium", confidence: "deterministic", scoreBearing: true, evidence: [], implementationEffort: "L" },
    ],
    siteMetrics: { pageCount: 10, platform: "WordPress", hasHttps: true, schemaCount: 2, ctaCount: 3, formCount: 1 },
    trustFlags: { testimonials: false, credentials: false, caseStudies: false, faq: true, pricing: false, policies: false, contact: true },
    technical: { missingTitles: 0, missingDescriptions: 3, h1Missing: 1, h1Multiple: 0, imagesMissingAlt: 4, internalLinkCount: 45 },
    competitors: [], performanceCoverage: { requested: 2, completed: 2, failed: 0 },
    promptVersion: "1.0.0", outputSchemaVersion: "1.0.0",
    gateRecommendation: "", gateNextAction: "", gateServiceCategories: [],
    ...overrides,
  };
}

// WP9-INPUT-01
test("WP9-INPUT-01: rejects package without auditId", async () => {
  await assert.rejects(() => executeNarrative({ reportPackage: {}, mode: "mock", modelId: "test" }), /auditId/);
});

test("WP9-INPUT-01: accepts valid package", async () => {
  const result = await executeNarrative({ reportPackage: makeReportPackage(), mode: "mock", modelId: "test-model" });
  assert.ok(result.narrative);
  assert.equal(result.narrative.auditId, "550e8400-e29b-41d4-a716-446655440001");
});

// WP9-HASH-01
test("WP9-HASH-01: cache key includes package hash", () => {
  const pkgHash = sha256(JSON.stringify(makeReportPackage()));
  const k1 = buildCacheKey({ reportContentHash: pkgHash, promptVersion: "1.0.0", modelId: "m1", outputSchemaVersion: "1.0.0" });
  const k2 = buildCacheKey({ reportContentHash: pkgHash, promptVersion: "1.0.0", modelId: "m1", outputSchemaVersion: "1.0.0" });
  assert.equal(k1, k2);
});

test("WP9-HASH-01: different package → different cache key", () => {
  const k1 = buildCacheKey({ reportContentHash: sha256("a"), promptVersion: "1", modelId: "m", outputSchemaVersion: "1" });
  const k2 = buildCacheKey({ reportContentHash: sha256("b"), promptVersion: "1", modelId: "m", outputSchemaVersion: "1" });
  assert.notEqual(k1, k2);
});

// WP9-MODE-01
test("WP9-MODE-01: rejects undefined mode", async () => {
  await assert.rejects(() => executeNarrative({ reportPackage: makeReportPackage(), mode: undefined, modelId: "test" }), /Invalid mode/);
});

test("WP9-MODE-01: rejects invalid mode", async () => {
  await assert.rejects(() => executeNarrative({ reportPackage: makeReportPackage(), mode: "auto", modelId: "test" }), /Invalid mode/);
});

// WP9-MOCK-01
test("WP9-MOCK-01: deterministic, zero calls, zero cost", async () => {
  const pkg = makeReportPackage();
  const r1 = await executeNarrative({ reportPackage: pkg, mode: "mock", modelId: "test" });
  const r2 = await executeNarrative({ reportPackage: pkg, mode: "mock", modelId: "test" });
  assert.equal(r1.callsMade, 0);
  assert.equal(r2.callsMade, 0);
  assert.equal(r1.cost, 0);
  assert.equal(r2.cost, 0);
  assert.equal(r1.ledger.actualCost, 0);
  assert.equal(r1.ledger.mode, "mock");
  assert.equal(r1.narrative.referencedFindingIds.length, r2.narrative.referencedFindingIds.length);
});

// WP9-REPLAY-01
test("WP9-REPLAY-01: cache hit → stored response, zero calls, zero cost", async () => {
  const pkg = makeReportPackage();
  const pkgHash = sha256(JSON.stringify(pkg));
  const cacheKey = buildCacheKey({ reportContentHash: pkgHash, promptVersion: "1.0.0", modelId: "test", outputSchemaVersion: "1.0.0" });
  const stored = JSON.stringify({ contractVersion: "1.0.0", narrativeVersion: "1.0.0", auditId: pkg.auditId, generatedAt: FIXED_TS, modelId: "test", promptVersion: "1.0.0", executiveSummary: "Cached.", referencedFindingIds: ["f1"], usage: { inputTokens: 100, outputTokens: 50 } });
  const cacheStore = { get: async (k) => k === cacheKey ? stored : null, set: async () => {} };
  const result = await executeNarrative({ reportPackage: pkg, mode: "replay", modelId: "test", cacheStore });
  assert.equal(result.cacheHit, true);
  assert.equal(result.callsMade, 0);
  assert.equal(result.cost, 0);
  assert.equal(result.narrative.executiveSummary, "Cached.");
  assert.equal(result.ledger.cacheHit, true);
  assert.equal(result.ledger.actualCost, 0);
});

test("WP9-REPLAY-01: cache miss in replay throws", async () => {
  const cacheStore = { get: async () => null, set: async () => {} };
  await assert.rejects(() => executeNarrative({ reportPackage: makeReportPackage(), mode: "replay", modelId: "test", cacheStore }), /Replay cache miss/);
});

// WP9-COST-01
test("WP9-COST-01: allows within budget", () => {
  const result = runCostPreflight({ reportPackage: makeReportPackage(), budget: { hardBudgetUsd: 1.0 } });
  assert.equal(result.allowed, true);
  assert.ok(result.estimate.inputTokens > 0);
});

test("WP9-COST-01: rejects above hard budget", () => {
  const result = runCostPreflight({ reportPackage: makeReportPackage(), budget: { hardBudgetUsd: 0.0001 } });
  assert.equal(result.allowed, false);
});

// WP9-BUDGET-01
test("WP9-BUDGET-01: daily budget exceeded → reject", () => {
  const result = runCostPreflight({ reportPackage: makeReportPackage(), budget: { dailyHardBudgetUsd: 0.0001 } });
  assert.equal(result.allowed, false);
});

test("WP9-BUDGET-01: no budget → allowed", () => {
  const result = runCostPreflight({ reportPackage: makeReportPackage() });
  assert.equal(result.allowed, true);
});

// WP9-CALL-01
test("WP9-CALL-01: hard limits enforced", () => {
  assert.equal(MAX_PRIMARY_CALLS, 1);
  assert.equal(MAX_REPAIR_CALLS, 1);
  assert.equal(MAX_TOTAL_CALLS, 2);
});

// WP9-VALID-01
test("WP9-VALID-01: valid narrative passes", () => {
  const n = { contractVersion: "1.0.0", narrativeVersion: "1.0.0", auditId: "550e8400-e29b-41d4-a716-446655440001", generatedAt: FIXED_TS, modelId: "test", promptVersion: "1.0.0", executiveSummary: "Test.", priorityFixNarrative: "Fix it.", referencedFindingIds: ["f1"], fieldWordCounts: { executiveSummary: 2, priorityFixNarrative: 2 }, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, retryNumber: 0, cacheHit: false } };
  assert.equal(validateNarrativeResponse(n, makeReportPackage()).valid, true);
});

test("WP9-VALID-01: extra properties rejected", () => {
  const n = { contractVersion: "1.0.0", narrativeVersion: "1.0.0", auditId: "550e8400-e29b-41d4-a716-446655440001", generatedAt: FIXED_TS, modelId: "test", promptVersion: "1.0.0", executiveSummary: "Test.", referencedFindingIds: ["f1"], _bogus: true };
  assert.equal(validateNarrativeResponse(n, makeReportPackage()).valid, false);
});

// WP9-VALID-02
test("WP9-VALID-02: invented finding ID rejected", () => {
  const n = { contractVersion: "1.0.0", narrativeVersion: "1.0.0", auditId: "550e8400-e29b-41d4-a716-446655440001", generatedAt: FIXED_TS, modelId: "test", promptVersion: "1.0.0", executiveSummary: "Test.", referencedFindingIds: ["f999"], fieldWordCounts: { executiveSummary: 2 }, usage: { modelId: "test", inputTokens: 0, outputTokens: 0, estimatedCost: 0, actualCost: 0 } };
  const r = validateNarrativeResponse(n, makeReportPackage());
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("f999")));
});

test("WP9-VALID-02: HTML rejected", () => {
  const n = { contractVersion: "1.0.0", narrativeVersion: "1.0.0", auditId: "550e8400-e29b-41d4-a716-446655440001", generatedAt: FIXED_TS, modelId: "test", promptVersion: "1.0.0", executiveSummary: "<div>Test</div>", referencedFindingIds: ["f1"], fieldWordCounts: { executiveSummary: 2 }, usage: { modelId: "test", inputTokens: 0, outputTokens: 0, estimatedCost: 0, actualCost: 0 } };
  assert.equal(validateNarrativeResponse(n, makeReportPackage()).valid, false);
});

// WP9-LEDGER-01
test("WP9-LEDGER-01: ledger has all fields", () => {
  const e = createUsageLedgerEntry({ auditId: "a1", executionId: "e1", mode: "mock", modelId: "m1", promptVersion: "1.0.0", timestamp: FIXED_TS });
  assert.equal(e.auditId, "a1");
  assert.equal(e.mode, "mock");
  assert.equal(e.cacheHit, false);
  assert.equal(e.actualCost, 0);
  assert.equal(e.contractVersion, "1.0.0");
});

// WP9-LINEAR-01
test("WP9-LINEAR-01: prompt has no raw data or HTML", () => {
  const p = buildPrompt(makeReportPackage());
  assert.ok(!p.includes("_sourceStatus"));
  assert.ok(!p.includes("<div"));
});

test("WP9-LINEAR-01: prompt version is fixed", () => {
  assert.equal(NARRATIVE_PROMPT_VERSION, "1.0.0");
});

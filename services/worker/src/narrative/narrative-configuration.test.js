/**
 * C8 — Narrative mode production configuration fails closed.
 *
 * Proves:
 *   - PRYSM-CLOSE-08a: MOCK requires no external dependencies
 *   - PRYSM-CLOSE-08b: REPLAY without cacheStore fails configuration
 *   - PRYSM-CLOSE-08c: REPLAY with cacheStore passes configuration
 *   - PRYSM-CLOSE-08d: LIVE without modelClient fails configuration
 *   - PRYSM-CLOSE-08e: LIVE without budget fails configuration
 *   - PRYSM-CLOSE-08f: LIVE without priceTable fails configuration
 *   - PRYSM-CLOSE-08g: LIVE without modelConfig fails configuration
 *   - PRYSM-CLOSE-08h: LIVE with all dependencies passes configuration
 *   - PRYSM-CLOSE-08i: invalid mode fails configuration
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateNarrativeConfiguration } from "./narrative-configuration.js";

function cacheStore() { return { get: async () => null }; }
function modelClient() { return { primary: async () => ({}) }; }
function budget() { return { softBudgetUsd: 5, hardBudgetUsd: 10, dailyHardBudgetUsd: 50, dailySpendUsd: 0 }; }
function priceTable() { return { inputPer1k: 0.003, outputPer1k: 0.015 }; }
function modelConfig() { return { maxInputTokens: 100_000, maxOutputTokens: 16_000, maxCalls: 2, maxRetries: 1, promptVersion: "1.0.0", outputSchemaVersion: "1.0.0" }; }

// --- 08a: MOCK requires no external dependencies ---
test("PRYSM-CLOSE-08a: MOCK mode valid without dependencies", () => {
  const r = validateNarrativeConfiguration({ mode: "mock" });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

// --- 08b: REPLAY without cacheStore fails ---
test("PRYSM-CLOSE-08b: REPLAY without cacheStore fails configuration", () => {
  const r = validateNarrativeConfiguration({ mode: "replay" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("cacheStore")), "error names cacheStore");
});

// --- 08c: REPLAY with cacheStore passes ---
test("PRYSM-CLOSE-08c: REPLAY with cacheStore passes configuration", () => {
  const r = validateNarrativeConfiguration({ mode: "replay", cacheStore: cacheStore() });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

// --- 08d: LIVE without modelClient fails ---
test("PRYSM-CLOSE-08d: LIVE without modelClient fails configuration", () => {
  const r = validateNarrativeConfiguration({
    mode: "live",
    budget: budget(),
    priceTable: priceTable(),
    modelConfig: modelConfig(),
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("modelClient")), "error names modelClient");
});

// --- 08e: LIVE without budget fails ---
test("PRYSM-CLOSE-08e: LIVE without budget fails configuration", () => {
  const r = validateNarrativeConfiguration({
    mode: "live",
    modelClient: modelClient(),
    priceTable: priceTable(),
    modelConfig: modelConfig(),
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("budget")), "error names budget");
});

// --- 08f: LIVE without priceTable fails ---
test("PRYSM-CLOSE-08f: LIVE without priceTable fails configuration", () => {
  const r = validateNarrativeConfiguration({
    mode: "live",
    modelClient: modelClient(),
    budget: budget(),
    modelConfig: modelConfig(),
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("priceTable")), "error names priceTable");
});

// --- 08g: LIVE without modelConfig fails ---
test("PRYSM-CLOSE-08g: LIVE without modelConfig fails configuration", () => {
  const r = validateNarrativeConfiguration({
    mode: "live",
    modelClient: modelClient(),
    budget: budget(),
    priceTable: priceTable(),
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("modelConfig")), "error names modelConfig");
});

// --- 08h: LIVE with all dependencies passes ---
test("PRYSM-CLOSE-08h: LIVE with all dependencies passes configuration", () => {
  const r = validateNarrativeConfiguration({
    mode: "live",
    modelClient: modelClient(),
    budget: budget(),
    priceTable: priceTable(),
    modelConfig: modelConfig(),
  });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

// --- 08i: invalid mode fails ---
test("PRYSM-CLOSE-08i: invalid mode fails configuration", () => {
  const r = validateNarrativeConfiguration({ mode: "yolo" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("Invalid narrative mode")), "error names the invalid mode");
});

// --- 08j: LIVE with non-functional modelClient fails ---
test("PRYSM-CLOSE-08j: LIVE with modelClient missing primary() fails configuration", () => {
  const r = validateNarrativeConfiguration({
    mode: "live",
    modelClient: {},
    budget: budget(),
    priceTable: priceTable(),
    modelConfig: modelConfig(),
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("modelClient")), "error names modelClient");
});

// ---------------------------------------------------------------------------
// Runtime-level fail-closed proof: production runtime startup rejects
// missing narrative dependencies BEFORE any audit can execute.
// ---------------------------------------------------------------------------

test("PRYSM-CLOSE-08k: production runtime startup fails for REPLAY without cacheStore", async () => {
  const { createProductionRuntime } = await import("../application/production-runtime.js");
  const { createMemoryArtifactStore } = await import("../storage/memory-artifact-store.js");
  const { createGovernedArtifactStore } = await import("../storage/governed-artifact-store.js");
  const { createMemoryLifecycleRepository } = await import("../lifecycle/memory-repository.js");
  const { createLocalReportStore } = await import("../storage/report-store.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  let thrown = null;
  try {
    createProductionRuntime({
      config: {
        artifactDir: join(mkdtempSync(join(tmpdir(), "prysm-c8-")), "artifacts"),
        webhookSecret: "",
        vantageTenantId: "c8-tenant",
        databaseUrl: "",
        onpagePollTimeoutMs: 5000,
        narrativeMode: "replay",
        port: 3000,
        reportsBucket: "",
        awsRegion: "ca-central-1",
        reportsPrefix: "vantage/reports",
      },
      adapters: {},
      validateContract: () => ({ valid: true, errors: [] }),
      artifactStore: createGovernedArtifactStore({ store: createMemoryArtifactStore() }),
      lifecycleRepo: createMemoryLifecycleRepository(),
      reportStore: createLocalReportStore({ baseDir: join(mkdtempSync(join(tmpdir(), "prysm-c8-")), "reports") }),
      // narrative deps NOT provided — REPLAY requires cacheStore
    });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, "runtime startup must throw");
  assert.match(thrown.message, /PRODUCTION STARTUP FAILED/, "startup failure marker present");
  assert.match(thrown.message, /cacheStore/, "error names the missing cacheStore");
});

test("PRYSM-CLOSE-08l: production runtime startup fails for LIVE without model dependencies", async () => {
  const { createProductionRuntime } = await import("../application/production-runtime.js");
  const { createMemoryArtifactStore } = await import("../storage/memory-artifact-store.js");
  const { createGovernedArtifactStore } = await import("../storage/governed-artifact-store.js");
  const { createMemoryLifecycleRepository } = await import("../lifecycle/memory-repository.js");
  const { createLocalReportStore } = await import("../storage/report-store.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  let thrown = null;
  try {
    createProductionRuntime({
      config: {
        artifactDir: join(mkdtempSync(join(tmpdir(), "prysm-c8-")), "artifacts"),
        webhookSecret: "",
        vantageTenantId: "c8-tenant",
        databaseUrl: "",
        onpagePollTimeoutMs: 5000,
        narrativeMode: "live",
        port: 3000,
        reportsBucket: "",
        awsRegion: "ca-central-1",
        reportsPrefix: "vantage/reports",
      },
      adapters: {},
      validateContract: () => ({ valid: true, errors: [] }),
      artifactStore: createGovernedArtifactStore({ store: createMemoryArtifactStore() }),
      lifecycleRepo: createMemoryLifecycleRepository(),
      reportStore: createLocalReportStore({ baseDir: join(mkdtempSync(join(tmpdir(), "prysm-c8-")), "reports") }),
      // narrative deps NOT provided — LIVE requires modelClient, budget, priceTable, modelConfig
    });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, "runtime startup must throw");
  assert.match(thrown.message, /PRODUCTION STARTUP FAILED/, "startup failure marker present");
  assert.match(thrown.message, /modelClient/, "error names the missing modelClient");
  assert.match(thrown.message, /budget/, "error names the missing budget");
  assert.match(thrown.message, /priceTable/, "error names the missing priceTable");
  assert.match(thrown.message, /modelConfig/, "error names the missing modelConfig");
});

test("PRYSM-CLOSE-08m: production runtime startup succeeds with complete LIVE dependencies", async () => {
  const { createProductionRuntime } = await import("../application/production-runtime.js");
  const { createMemoryArtifactStore } = await import("../storage/memory-artifact-store.js");
  const { createGovernedArtifactStore } = await import("../storage/governed-artifact-store.js");
  const { createMemoryLifecycleRepository } = await import("../lifecycle/memory-repository.js");
  const { createLocalReportStore } = await import("../storage/report-store.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const runtime = createProductionRuntime({
    config: {
      artifactDir: join(mkdtempSync(join(tmpdir(), "prysm-c8-")), "artifacts"),
      webhookSecret: "",
      vantageTenantId: "c8-tenant",
      databaseUrl: "",
      onpagePollTimeoutMs: 5000,
      narrativeMode: "live",
      port: 3000,
      reportsBucket: "",
      awsRegion: "ca-central-1",
      reportsPrefix: "vantage/reports",
    },
    adapters: {},
    validateContract: () => ({ valid: true, errors: [] }),
    artifactStore: createGovernedArtifactStore({ store: createMemoryArtifactStore() }),
    lifecycleRepo: createMemoryLifecycleRepository(),
    reportStore: createLocalReportStore({ baseDir: join(mkdtempSync(join(tmpdir(), "prysm-c8-")), "reports") }),
    narrative: {
      cacheStore: null,
      modelClient: { primary: async () => ({}) },
      budget: { softBudgetUsd: 5, hardBudgetUsd: 10, dailyHardBudgetUsd: 50, dailySpendUsd: 0 },
      priceTable: { inputPer1k: 0.003, outputPer1k: 0.015 },
      modelConfig: { maxInputTokens: 100_000, maxOutputTokens: 16_000, maxCalls: 2, maxRetries: 1, promptVersion: "1.0.0", outputSchemaVersion: "1.0.0" },
    },
  });
  assert.ok(runtime.auditService, "runtime constructs with complete LIVE configuration");
});

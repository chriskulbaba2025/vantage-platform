/**
 * C13 — Persisted failure classification controls recovery.
 *
 * Proves every classification decision:
 *   - PRYSM-CLOSE-13a: terminal auth failure → RESTORE (no retry)
 *   - PRYSM-CLOSE-13b: terminal rate-limit → RESTORE (no retry)
 *   - PRYSM-CLOSE-13c: recoverable task timeout (requestId) → RESUME TASK
 *   - PRYSM-CLOSE-13d: timeout without task → REEXECUTE FRESH
 *   - PRYSM-CLOSE-13e: network 5xx → REEXECUTE FRESH (transient)
 *   - PRYSM-CLOSE-13f: BLOCKED → RESTORE (no bypass)
 *   - PRYSM-CLOSE-13g: NOT_CONNECTED → RESTORE (no provider call)
 *   - PRYSM-CLOSE-13h: UNAVAILABLE → RESTORE
 *   - PRYSM-CLOSE-13i: AVAILABLE/PARTIAL → RESTORE (completed)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, RECOVERY_ACTION } from "./failure-classification.js";

test("PRYSM-CLOSE-13a: terminal auth failure → RESTORE, no retry", () => {
  const r = classifyFailure({ status: "FAILED", errorCategory: "auth", requestId: null });
  assert.equal(r.action, RECOVERY_ACTION.RESTORE);
  assert.match(r.reason, /terminal/);
});

test("PRYSM-CLOSE-13b: terminal rate-limit → RESTORE, no retry", () => {
  const r = classifyFailure({ status: "FAILED", errorCategory: "rate_limit", requestId: null });
  assert.equal(r.action, RECOVERY_ACTION.RESTORE);
  assert.match(r.reason, /terminal/);
});

test("PRYSM-CLOSE-13c: timeout with recoverable provider task → RESUME SAME TASK", () => {
  const r = classifyFailure({ status: "FAILED", errorCategory: "timeout", requestId: "task-123" });
  assert.equal(r.action, RECOVERY_ACTION.REEXECUTE_RESUME_TASK);
  assert.equal(r.requestId, "task-123", "task ID carried through for resumption");
});

test("PRYSM-CLOSE-13d: timeout without provider task → REEXECUTE FRESH", () => {
  const r = classifyFailure({ status: "FAILED", errorCategory: "timeout", requestId: null });
  assert.equal(r.action, RECOVERY_ACTION.REEXECUTE_FRESH);
  assert.equal(r.requestId, null);
});

test("PRYSM-CLOSE-13e: network failure → REEXECUTE FRESH (transient)", () => {
  const r = classifyFailure({ status: "FAILED", errorCategory: "network", requestId: null });
  assert.equal(r.action, RECOVERY_ACTION.REEXECUTE_FRESH);
});

test("PRYSM-CLOSE-13f: BLOCKED → RESTORE, no bypass", () => {
  const r = classifyFailure({ status: "BLOCKED", errorCategory: null, requestId: null });
  assert.equal(r.action, RECOVERY_ACTION.RESTORE);
  assert.match(r.reason, /no bypass/);
});

test("PRYSM-CLOSE-13g: NOT_CONNECTED → RESTORE, no provider call", () => {
  const r = classifyFailure({ status: "NOT_CONNECTED", errorCategory: null, requestId: null });
  assert.equal(r.action, RECOVERY_ACTION.RESTORE);
  assert.match(r.reason, /no provider call/);
});

test("PRYSM-CLOSE-13h: UNAVAILABLE → RESTORE", () => {
  const r = classifyFailure({ status: "UNAVAILABLE", errorCategory: null, requestId: null });
  assert.equal(r.action, RECOVERY_ACTION.RESTORE);
});

test("PRYSM-CLOSE-13i: AVAILABLE/PARTIAL → RESTORE (completed work)", () => {
  assert.equal(classifyFailure({ status: "AVAILABLE" }).action, RECOVERY_ACTION.RESTORE);
  assert.equal(classifyFailure({ status: "PARTIAL", errorCategory: null, requestId: null }).action, RECOVERY_ACTION.RESTORE);
});

test("PRYSM-CLOSE-13j: NOT_APPLICABLE → RESTORE", () => {
  const r = classifyFailure({ status: "NOT_APPLICABLE", errorCategory: null, requestId: null });
  assert.equal(r.action, RECOVERY_ACTION.RESTORE);
});

test("PRYSM-CLOSE-13k: unknown status → fail-safe RESTORE", () => {
  const r = classifyFailure({ status: "WEIRD_STATUS", errorCategory: null, requestId: null });
  assert.equal(r.action, RECOVERY_ACTION.RESTORE);
});

test("PRYSM-CLOSE-13l: internal error → transient re-execute", () => {
  const r = classifyFailure({ status: "FAILED", errorCategory: "internal", requestId: null });
  assert.equal(r.action, RECOVERY_ACTION.REEXECUTE_FRESH);
});

test("PRYSM-CLOSE-13m: no_data → terminal RESTORE", () => {
  const r = classifyFailure({ status: "FAILED", errorCategory: "no_data", requestId: null });
  assert.equal(r.action, RECOVERY_ACTION.RESTORE);
});

// ---------------------------------------------------------------------------
// Orchestrator-level proof: persisted classification controls recovery
// ---------------------------------------------------------------------------

test("PRYSM-CLOSE-13n: terminal auth failure is RESTORED — adapter never re-called", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { randomUUID } = await import("node:crypto");
  const Ajv2020 = (await import("ajv/dist/2020.js")).default;
  const addFormats = (await import("ajv-formats")).default;
  const { createMemoryArtifactStore } = await import("../storage/memory-artifact-store.js");
  const { createGovernedArtifactStore } = await import("../storage/governed-artifact-store.js");
  const { createMemoryLifecycleRepository } = await import("../lifecycle/memory-repository.js");
  const { createLifecycleService } = await import("../lifecycle/lifecycle-service.js");
  const { createAuditOrchestrator } = await import("./audit-orchestrator.js");

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const schemasDir = resolve(__dirname, "..", "contracts");
  const _ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(_ajv);
  ["audit-request.schema.json", "source-result.schema.json", "canonical-evidence.schema.json", "decision-evidence.schema.json", "finding.schema.json", "score.schema.json", "narrative-response.schema.json", "report-content.schema.json", "report-view-model.schema.json", "artifact-record.schema.json"].forEach((f) => {
    _ajv.addSchema(JSON.parse(readFileSync(resolve(schemasDir, f), "utf-8")), `https://vantage-platform.io/prysm/contracts/v1/${f}`);
  });
  const validateContract = (sid, obj) => {
    const v = _ajv.getSchema(sid);
    if (!v) return { valid: true, errors: [] };
    const valid = v(obj);
    return { valid, errors: v.errors || [] };
  };
  const clock = { now: () => "2026-01-01T00:00:00.000Z", sleep: async () => {}, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 100)) };

  function failedResult(source, errorCategory, evidence = {}) {
    return {
      contractVersion: "1.0.0", schemaVersion: "1.0.0", source,
      provider: "Mock", adapterVersion: "1.0.0", status: "FAILED",
      startedAt: clock.now(), completedAt: clock.now(), retryCount: 0,
      coverage: { requested: 1, completed: 0, failed: 1 },
      limitations: [`controlled ${errorCategory}`], errorCategory, evidence,
    };
  }

  // First orchestrator: onpage fails with a TERMINAL auth error
  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const lifecycleService = createLifecycleService(createMemoryLifecycleRepository());
  const auditRequest = {
    contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "t1", clientId: "c1",
    idempotencyKey: randomUUID(), targetUrl: "https://proof.example.com",
    businessName: "Proof", market: "Canada", language: "en",
    primaryGoal: "conversion", services: ["service-a"], competitors: [],
  };
  const orch1 = createAuditOrchestrator({
    lifecycleService, artifactStore, validateContract, clock,
    adapters: {
      "dataforseo-onpage": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: failedResult("dataforseo-onpage", "auth") }) },
      pagespeed: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: failedResult("pagespeed", "network") }) },
      "dataforseo-serp": { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: failedResult("dataforseo-serp", "network") }) },
      backlinks: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: failedResult("backlinks", "network") }) },
      ga4: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: failedResult("ga4", "network") }) },
      gsc: { adapterVersion: "1.0.0", execute: async () => ({ rawBytes: null, contentType: null, sourceResult: failedResult("gsc", "network") }) },
    },
    narrativeMode: "mock",
  });

  // Force an infrastructure failure at the canonical-evidence write so the
  // audit strands at COLLECTION_FAILED with all source manifests persisted.
  const realPut = artifactStore.put.bind(artifactStore);
  artifactStore.put = async (input) => {
    if (input.scope?.category === "canonical" && input.scope?.artifactName === "evidence.json") {
      throw new Error("controlled canonical write failure");
    }
    return realPut(input);
  };
  try {
    await orch1.execute(auditRequest, { executionId: randomUUID() });
  } catch { /* collection_failed */ }
  artifactStore.put = realPut;

  const csAfter = await lifecycleService.currentState(auditRequest.auditId, "t1");
  assert.equal(csAfter.state, "collection_failed", "audit stranded at collection_failed");

  // Fresh orchestrator: counting adapters must NOT be called for the
  // terminal auth failure (restored), but MUST be called for transient
  // network failures (re-executed fresh).
  const calls = {};
  const orch2 = createAuditOrchestrator({
    lifecycleService, artifactStore, validateContract, clock,
    adapters: {
      "dataforseo-onpage": { adapterVersion: "1.0.0", execute: async () => { calls.onpage = (calls.onpage || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: failedResult("dataforseo-onpage", "auth") }; } },
      pagespeed: { adapterVersion: "1.0.0", execute: async () => { calls.pagespeed = (calls.pagespeed || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: failedResult("pagespeed", "network") }; } },
      "dataforseo-serp": { adapterVersion: "1.0.0", execute: async () => { calls.serp = (calls.serp || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: failedResult("dataforseo-serp", "network") }; } },
      backlinks: { adapterVersion: "1.0.0", execute: async () => { calls.backlinks = (calls.backlinks || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: failedResult("backlinks", "network") }; } },
      ga4: { adapterVersion: "1.0.0", execute: async () => { calls.ga4 = (calls.ga4 || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: failedResult("ga4", "network") }; } },
      gsc: { adapterVersion: "1.0.0", execute: async () => { calls.gsc = (calls.gsc || 0) + 1; return { rawBytes: null, contentType: null, sourceResult: failedResult("gsc", "network") }; } },
    },
    narrativeMode: "mock",
  });
  const result = await orch2.execute(auditRequest, { executionId: randomUUID() });

  assert.equal(calls.onpage, undefined, "terminal auth failure NOT re-executed (restored, no retry)");
  assert.equal(calls.pagespeed, 1, "transient network failure re-executed fresh");
  assert.ok(result, "recovery executed");
});

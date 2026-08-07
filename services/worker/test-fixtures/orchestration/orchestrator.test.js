/**
 * WP5 Orchestrator Behavioral Tests — governed recovery and failure boundaries.
 *
 * Covers all WP5-CLOSE checklist items.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { createMemoryLifecycleRepository } from "../../src/lifecycle/memory-repository.js";
import { createLifecycleService } from "../../src/lifecycle/lifecycle-service.js";
import { createGovernedArtifactStore, buildArtifactKey } from "../../src/storage/governed-artifact-store.js";
import { createAuditOrchestrator, buildSourceExecutionIdentity } from "../../src/orchestration/audit-orchestrator.js";
import { LIFECYCLE_STATE } from "../../src/lifecycle/state-enum.js";
import { persistSourceCheckpointManifest, persistCanonicalRecordManifest, buildSourceCheckpointManifestKey, buildCanonicalRecordManifestKey } from "../../src/orchestration/artifact-recovery.js";
import {
  createBaseMockAdapters, createFailingAdapter, createPartialAdapter,
  createMissingVersionAdapter, createEmptyVersionAdapter,
  createKeyCapturingAdapter, createVersionMismatchAdapter,
  createStatusAdapter, createTrackingAdapter,
} from "./mock-adapters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const T = LIFECYCLE_STATE;

// Shared validator
const schemasDir = resolve(__dirname, "..", "..", "src", "contracts");
const _ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(_ajv);
["audit-request.schema.json", "source-result.schema.json", "canonical-evidence.schema.json"].forEach(f => {
  _ajv.addSchema(JSON.parse(readFileSync(resolve(schemasDir, f), "utf-8")), `https://vantage-platform.io/prysm/contracts/v1/${f}`);
});
function validateContract(sid, obj) { const v = _ajv.getSchema(sid); return { valid: v(obj), errors: v.errors || [] }; }

// Helpers
function sha256(b) { return createHash("sha256").update(b).digest("hex"); }

function mockClock(iso = "2026-01-01T00:00:00.000Z") {
  let t = new Date(iso).getTime();
  return { now: () => new Date(t).toISOString(), sleep: async () => {}, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 100)) };
}

function baReq(overrides = {}) {
  return { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "t1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com", ...overrides };
}

function makePartialResult(source) {
  return {
    contractVersion: "1.0.0", schemaVersion: "1.0.0",
    source, provider: "Mock", adapterVersion: "1.0.0",
    status: "PARTIAL", startedAt: mockClock().now(), completedAt: mockClock().now(),
    retryCount: 2, expectedRecords: 5, returnedRecords: 3,
    coverage: { requested: 5, completed: 3, failed: 2 },
    limitations: ["controlled limitation"], evidence: {},
  };
}

function makeAvailResult(source) {
  return {
    contractVersion: "1.0.0", schemaVersion: "1.0.0",
    source, provider: "Mock", adapterVersion: "1.0.0",
    status: "AVAILABLE", startedAt: mockClock().now(), completedAt: mockClock().now(),
    retryCount: 1, expectedRecords: 1, returnedRecords: 1,
    coverage: { requested: 1, completed: 1, failed: 0 },
    limitations: [], evidence: {},
  };
}

async function persistSourceCheckpoint(store, scope, source, result, rawRecord = null) {
  const bytes = Buffer.from(JSON.stringify(result));
  const nr = await store.put({ bytes, contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: `${source}.json` }, source });
  return persistSourceCheckpointManifest({
    store, scope, source,
    sourceExecutionKey: buildSourceExecutionIdentity({ auditRequest: { auditId: scope.auditId, targetUrl: "https://example.com" }, source, adapterVersion: "1.0.0" }).sourceExecutionKey,
    completedAt: mockClock().now(), normalizedRecord: nr, rawRecord,
  });
}

// ===================================================================
// 1. New audit exact history + all manifests
// ===================================================================
test("1. new audit: exact lifecycle history + all manifests exist", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const req = baReq();
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);

  const events = await lc.history(req.auditId, req.tenantId);
  assert.deepEqual(events.map(e => e.nextState), [T.CREATED, T.VALIDATED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED]);

  const scope = { tenantId: req.tenantId, clientId: req.clientId, auditId: req.auditId };
  for (const s of ["dataforseo-onpage", "pagespeed", "dataforseo-serp", "backlinks"]) {
    assert.ok(await store.exists(buildSourceCheckpointManifestKey(scope, s)), `Manifest exists: ${s}`);
  }
  assert.ok(await store.exists(buildCanonicalRecordManifestKey(scope)), "Canonical record manifest exists");
  assert.ok(summary.canonicalEvidence);
});

// ===================================================================
// WP5-CLOSE-VAL-01 — Persisted invalid-request history
// ===================================================================
test("WP5-CLOSE-VAL-01: invalid request persists created → validation_failed", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const req = baReq({ targetUrl: undefined });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.VALIDATION_FAILED);

  const history = await lc.history(req.auditId, req.tenantId);
  assert.deepEqual(
    history.map(event => event.nextState),
    [T.CREATED, T.VALIDATION_FAILED]
  );
});

// ===================================================================
// WP5-CLOSE-VAL-02 — Validation summary requires persisted state
// ===================================================================
test("WP5-CLOSE-VAL-02: validation summary requires persisted state", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const req = baReq({ targetUrl: undefined });
  const summary = await orch.execute(req);

  const persistedState = await lc.currentState(req.auditId, req.tenantId);
  assert.equal(persistedState.state, T.VALIDATION_FAILED);
  assert.equal(summary.finalState, T.VALIDATION_FAILED);
});

// ===================================================================
// WP5-CLOSE-VAL-03 — Invalid-request create failure rejects
// ===================================================================
test("WP5-CLOSE-VAL-03: lifecycle create failure rejects, no summary", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const baseLc = createLifecycleService(repo);

  // Wrap lifecycle service to inject create failure
  let attemptedSummary = undefined;
  const lc = {
    create: async () => { throw new Error("injected create failure"); },
    transition: async () => {},
    currentState: async () => null,
    history: async () => [],
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const req = baReq({ targetUrl: undefined });

  await assert.rejects(() => orch.execute(req), /injected create failure/);
  // attemptedSummary should be undefined — no summary was returned
});

// ===================================================================
// WP5-CLOSE-VAL-04 — Invalid-request transition failure rejects
// ===================================================================
test("WP5-CLOSE-VAL-04: validation_failed transition failure rejects, no summary", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const baseLc = createLifecycleService(repo);
  const req = baReq({ targetUrl: undefined });
  const { auditId, tenantId, clientId } = req;

  // Wrap lifecycle: create succeeds, transition to validation_failed throws
  let transitionCallCount = 0;
  const lc = {
    create: async (args) => baseLc.create(args),
    transition: async (args) => {
      transitionCallCount++;
      if (args.toState === T.VALIDATION_FAILED) {
        throw new Error("injected transition failure for validation_failed");
      }
      return baseLc.transition(args);
    },
    currentState: async (aid, tid) => baseLc.currentState(aid, tid),
    history: async (aid, tid) => baseLc.history(aid, tid),
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });

  await assert.rejects(() => orch.execute(req), /injected transition failure for validation_failed/);

  // Verify created exists
  const history = await baseLc.history(auditId, tenantId);
  const states = history.map(e => e.nextState);
  assert.ok(states.includes(T.CREATED), "created must exist");
  assert.ok(!states.includes(T.VALIDATION_FAILED), "validation_failed must not exist");
});

// ===================================================================
// WP5-CLOSE-IDEM-01 — Failure transition key is execution-scoped
// ===================================================================
test("WP5-CLOSE-IDEM-01: collection_failed key is execution-scoped", async () => {
  const capturedKeys = [];

  // Execution 1 with ex1 — infrastructure failure triggers collection_failed
  {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const baseLc = createLifecycleService(repo);
    const lc = {
      create: async (args) => baseLc.create(args),
      transition: async (args) => {
        if (args.toState === T.COLLECTION_FAILED) capturedKeys.push(args.transitionIdempotencyKey);
        return baseLc.transition(args);
      },
      currentState: async (aid, tid) => baseLc.currentState(aid, tid),
      history: async (aid, tid) => baseLc.history(aid, tid),
    };

    const req = baReq();
    const { auditId, tenantId, clientId } = req;
    await baseLc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
    await baseLc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:ex1:validated` });
    await baseLc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:ex1:collecting` });

    // Inject raw artifact failure to trigger collection_failed (outside retry boundary)
    const realPut = store.put.bind(store);
    store.put = async (input) => {
      if (input.scope?.category === "raw") throw new Error("raw write failure");
      return realPut(input);
    };

    const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
    await assert.rejects(() => orch.execute(req, { executionId: "ex1" }));
  }

  // Execution 2 with ex2 — different executionId
  {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const baseLc = createLifecycleService(repo);
    const lc = {
      create: async (args) => baseLc.create(args),
      transition: async (args) => {
        if (args.toState === T.COLLECTION_FAILED) capturedKeys.push(args.transitionIdempotencyKey);
        return baseLc.transition(args);
      },
      currentState: async (aid, tid) => baseLc.currentState(aid, tid),
      history: async (aid, tid) => baseLc.history(aid, tid),
    };

    const req = baReq();
    const { auditId, tenantId, clientId } = req;
    await baseLc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
    await baseLc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:ex2:validated` });
    await baseLc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:ex2:collecting` });

    const realPut = store.put.bind(store);
    store.put = async (input) => {
      if (input.scope?.category === "raw") throw new Error("raw write failure");
      return realPut(input);
    };

    const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
    await assert.rejects(() => orch.execute(req, { executionId: "ex2" }));
  }

  assert.equal(capturedKeys.length, 2, "two collection_failed transitions captured");
  assert.ok(capturedKeys[0].includes("ex1"), `key 0 should contain ex1: ${capturedKeys[0]}`);
  assert.ok(capturedKeys[1].includes("ex2"), `key 1 should contain ex2: ${capturedKeys[1]}`);
  assert.notEqual(capturedKeys[0], capturedKeys[1], "keys must differ for different executionIds");
});

// ===================================================================
// WP5-CLOSE-IDEM-02 — Recovery transition key is execution-scoped
// ===================================================================
test("WP5-CLOSE-IDEM-02: collection_failed → collecting recovery key is execution-scoped", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const capturedKeys = [];
  const baseLc = createLifecycleService(repo);
  const lc = {
    create: async (args) => baseLc.create(args),
    transition: async (args) => {
      if (args.toState === T.COLLECTING && capturedKeys.length < 2) {
        // Capture initial collecting transitions
      }
      if (args.toState === T.COLLECTING) capturedKeys.push({ key: args.transitionIdempotencyKey, to: args.toState });
      return baseLc.transition(args);
    },
    currentState: async (aid, tid) => baseLc.currentState(aid, tid),
    history: async (aid, tid) => baseLc.history(aid, tid),
  };

  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  await baseLc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await baseLc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v1:validated` });
  await baseLc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:v1:collecting` });
  await baseLc.transition({ auditId, tenantId, toState: T.COLLECTION_FAILED, transitionIdempotencyKey: `${auditId}:v1:collection-failed` });

  // Now the recovery from collection_failed → collecting should use executionId
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const summary = await orch.execute(req, { executionId: "recovery-ex1" });
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);

  const recoveryKeys = capturedKeys.filter(k => k.key.includes("collection-failed-recovery"));
  assert.equal(recoveryKeys.length, 1, "one recovery transition");
  assert.ok(recoveryKeys[0].key.includes("recovery-ex1"), `recovery key should include executionId: ${recoveryKeys[0].key}`);
  assert.ok(recoveryKeys[0].key.includes(auditId), `recovery key should include auditId: ${recoveryKeys[0].key}`);
});

// ===================================================================
// WP5-CLOSE-IDEM-03 — Two failures then success append all transitions
// ===================================================================
test("WP5-CLOSE-IDEM-03: two failures then success — exact ordered history", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;

  // Execution 1: collection failure via raw artifact failure
  {
    const realPut = store.put.bind(store);
    let failRaw = true;
    store.put = async (input) => {
      if (failRaw && input.scope?.category === "raw") { failRaw = false; throw new Error("exec1 raw failure"); }
      return realPut(input);
    };
    const orch1 = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
    await assert.rejects(() => orch1.execute(req, { executionId: "ex1" }));
  }

  // Execution 2: collection failure via normalized artifact failure
  {
    const cs = await lc.currentState(auditId, tenantId);
    await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:ex2:collection-failed-recovery` });

    const realPut = store.put.bind(store);
    let failNorm = true;
    store.put = async (input) => {
      if (failNorm && input.scope?.category === "normalized") { failNorm = false; throw new Error("exec2 normalized failure"); }
      return realPut(input);
    };
    const orch2 = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
    await assert.rejects(() => orch2.execute(req, { executionId: "ex2" }));
  }

  // Execution 3: success
  {
    const cs = await lc.currentState(auditId, tenantId);
    await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:ex3:collection-failed-recovery` });

    const orch3 = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
    const summary3 = await orch3.execute(req, { executionId: "ex3" });
    assert.equal(summary3.finalState, T.EVIDENCE_LOCKED);
  }

  const actualStates = (await lc.history(auditId, tenantId)).map(e => e.nextState);
  assert.deepEqual(actualStates, [
    T.CREATED,
    T.VALIDATED,
    T.COLLECTING,
    T.COLLECTION_FAILED,
    T.COLLECTING,
    T.COLLECTION_FAILED,
    T.COLLECTING,
    T.EVIDENCE_STORED,
    T.EVIDENCE_LOCKED,
  ]);
});

// ===================================================================
// WP5-CLOSE-ADP-01 — Registered adapters declare versions
// ===================================================================
test("WP5-CLOSE-ADP-01: missing/empty adapterVersion rejects before execution", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Case A: missing adapterVersion
  const missingAdapter = createMissingVersionAdapter("dataforseo-onpage");
  const base = createBaseMockAdapters();
  const adapters1 = { ...base, "dataforseo-onpage": missingAdapter };

  const orch1 = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: adapters1, validateContract, clock: mockClock() });
  await assert.rejects(() => orch1.execute(req), /adapterVersion/);

  // Case B: empty adapterVersion
  const emptyAdapter = createEmptyVersionAdapter("dataforseo-onpage");
  const adapters2 = { ...base, "dataforseo-onpage": emptyAdapter };
  const orch2 = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: adapters2, validateContract, clock: mockClock() });
  await assert.rejects(() => orch2.execute(req), /adapterVersion/);
});

// ===================================================================
// WP5-CLOSE-ADP-02 — Real source execution key equality
// ===================================================================
test("WP5-CLOSE-ADP-02: source execution key equality — adapter, manifest, expected", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Use key-capturing adapter
  const keyCapture = createKeyCapturingAdapter("dataforseo-onpage", "1.0.0");
  const base = createBaseMockAdapters();
  const adapters = { ...base, "dataforseo-onpage": keyCapture };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);

  const adapterCallCount = keyCapture.getCallCount();
  const adapterReceivedKey = keyCapture.getReceivedKey();

  // Assert adapter executed exactly once
  assert.equal(adapterCallCount, 1);

  // Read persisted checkpoint manifest
  const manifestKey = buildSourceCheckpointManifestKey(scope, "dataforseo-onpage");
  const manifestBuf = await store.get(manifestKey);
  const manifest = JSON.parse(manifestBuf.toString());

  // Calculate expected key independently
  const expectedKey = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;

  assert.equal(adapterReceivedKey, expectedKey, "adapter received key = expected key");
  assert.equal(manifest.sourceExecutionKey, expectedKey, "manifest key = expected key");
  assert.equal(adapterReceivedKey, manifest.sourceExecutionKey, "adapter received key = manifest key");
});

// ===================================================================
// WP5-CLOSE-ADP-03 — Source result version must match registered adapter
// ===================================================================
test("WP5-CLOSE-ADP-03: version mismatch rejects, state=collection_failed", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Registered adapterVersion = 2.0.0, returned sourceResult.adapterVersion = 1.0.0
  const mismatchAdapter = createVersionMismatchAdapter("dataforseo-onpage", "2.0.0", "1.0.0");
  const base = createBaseMockAdapters();
  const adapters = {
    ...base,
    "dataforseo-onpage": mismatchAdapter,
  };
  // Track later adapters
  let serpCalls = 0, blCalls = 0, psCalls = 0;
  adapters["dataforseo-serp"] = { adapterVersion: "1.0.0", execute: async (a) => { serpCalls++; return base["dataforseo-serp"].execute(a); } };
  adapters["backlinks"] = { adapterVersion: "1.0.0", execute: async (a) => { blCalls++; return base["backlinks"].execute(a); } };
  adapters["pagespeed"] = { adapterVersion: "1.0.0", execute: async (a) => { psCalls++; return base["pagespeed"].execute(a); } };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  await assert.rejects(() => orch.execute(req), /version mismatch/);

  const cs = await lc.currentState(auditId, tenantId);
  assert.equal(cs.state, T.COLLECTION_FAILED);

  // Later adapter calls = 0
  assert.equal(serpCalls, 0, "serp calls = 0");
  assert.equal(blCalls, 0, "backlinks calls = 0");
  assert.equal(psCalls, 0, "pagespeed calls = 0");

  // evidence_stored and evidence_locked must not exist
  const events = await lc.history(auditId, tenantId);
  const states = events.map(e => e.nextState);
  assert.ok(!states.includes(T.EVIDENCE_STORED));
  assert.ok(!states.includes(T.EVIDENCE_LOCKED));
});

// ===================================================================
// WP5-CLOSE-ADP-04 — Valid checkpoint skips adapter
// ===================================================================
test("WP5-CLOSE-ADP-04: valid checkpoint skips adapter execution", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Persist checkpoint for onpage using current adapterVersion
  const result = makeAvailResult("dataforseo-onpage");
  const nr = await store.put({ bytes: Buffer.from(JSON.stringify(result)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  const expectedKey = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: expectedKey, completedAt: mockClock().now(), normalizedRecord: nr, rawRecord: null });

  // Track onpage calls
  let onpageCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {
    ...base,
    "dataforseo-onpage": { adapterVersion: "1.0.0", execute: async (a) => { onpageCalls++; return base["dataforseo-onpage"].execute(a); } },
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);

  // Adapter must NOT be called — checkpoint was valid
  assert.equal(onpageCalls, 0, "restored adapter call count = 0");
});

// ===================================================================
// WP5-CLOSE-STAT-01 — Explicit status mapping
// ===================================================================
test("WP5-CLOSE-STAT-01: explicit immutable status mapping", async () => {
  const ALL_STATUSES = ["AVAILABLE", "PARTIAL", "FAILED", "BLOCKED", "UNAVAILABLE", "NOT_CONNECTED", "NOT_APPLICABLE"];

  for (const status of ALL_STATUSES) {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const lc = createLifecycleService(repo);
    const req = baReq();

    const adapters = {
      "dataforseo-onpage": createStatusAdapter("dataforseo-onpage", status),
    };

    const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
    const summary = await orch.execute(req);

    // Verify each counter key exists
    const sc = summary.sourceCounts;
    assert.equal(typeof sc.available, "number", `${status}: available counter exists`);
    assert.equal(typeof sc.partial, "number", `${status}: partial counter exists`);
    assert.equal(typeof sc.failed, "number", `${status}: failed counter exists`);
    assert.equal(typeof sc.blocked, "number", `${status}: blocked counter exists`);
    assert.equal(typeof sc.unavailable, "number", `${status}: unavailable counter exists`);
    assert.equal(typeof sc.notConnected, "number", `${status}: notConnected counter exists`);
    assert.equal(typeof sc.notApplicable, "number", `${status}: notApplicable counter exists`);

    // The specific counter for this status should be exactly 1
    const expectedKey = {
      "AVAILABLE": "available", "PARTIAL": "partial", "FAILED": "failed",
      "BLOCKED": "blocked", "UNAVAILABLE": "unavailable",
      "NOT_CONNECTED": "notConnected", "NOT_APPLICABLE": "notApplicable",
    }[status];

    // NOT_APPLICABLE: unregistered sources also get NOT_APPLICABLE, so count is 4
    const expectedCount = status === "NOT_APPLICABLE" ? 4 : 1;
    assert.equal(sc[expectedKey], expectedCount, `${status}: ${expectedKey} counter = ${expectedCount}`);
    assert.equal(sc.total, 4, `${status}: total = 4 (one registered adapter + three unregistered → NOT_APPLICABLE)`);
  }
});

// ===================================================================
// WP5-CLOSE-STAT-02 — Counter sum equals total
// ===================================================================
test("WP5-CLOSE-STAT-02: counter sum equals total", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();

  // Use adapters representing all seven statuses
  const adapters = {
    "dataforseo-onpage": createStatusAdapter("dataforseo-onpage", "AVAILABLE"),
    "pagespeed": createStatusAdapter("pagespeed", "PARTIAL"),
    "dataforseo-serp": createStatusAdapter("dataforseo-serp", "FAILED"),
    "backlinks": createStatusAdapter("backlinks", "BLOCKED"),
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  const counts = summary.sourceCounts;

  assert.equal(
    counts.available + counts.partial + counts.failed + counts.blocked +
    counts.unavailable + counts.notConnected + counts.notApplicable,
    counts.total
  );
});

// ===================================================================
// WP5-CLOSE-STALE-01 — Changed target URL
// ===================================================================
test("WP5-CLOSE-STALE-01: changed targetUrl rejects stale checkpoint", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Persist manifest with OLD targetUrl key
  const oldKey = buildSourceExecutionIdentity({ auditRequest: { ...req, targetUrl: "https://old.example.com" }, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  const result = makePartialResult("dataforseo-onpage");
  const nr = await store.put({ bytes: Buffer.from(JSON.stringify(result)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: oldKey, completedAt: mockClock().now(), normalizedRecord: nr, rawRecord: null });

  // Track later adapters
  let serpCalls = 0, blCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {
    ...base,
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: async (a) => { serpCalls++; return base["dataforseo-serp"].execute(a); } },
    "backlinks": { adapterVersion: "1.0.0", execute: async (a) => { blCalls++; return base["backlinks"].execute(a); } },
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  await assert.rejects(() => orch.execute(req), /Source execution key mismatch/);

  const cs = await lc.currentState(auditId, tenantId);
  assert.equal(cs.state, T.COLLECTION_FAILED);

  // Every adapter after stale source has call count = 0
  assert.equal(serpCalls, 0);
  assert.equal(blCalls, 0);

  const events = await lc.history(auditId, tenantId);
  const states = events.map(e => e.nextState);
  assert.ok(!states.includes(T.EVIDENCE_STORED));
  assert.ok(!states.includes(T.EVIDENCE_LOCKED));
});

// ===================================================================
// WP5-CLOSE-STALE-02 — Changed language
// ===================================================================
test("WP5-CLOSE-STALE-02: changed language rejects stale checkpoint", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq({ language: "fr" });
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Persist manifest with old language key (English)
  const oldKey = buildSourceExecutionIdentity({ auditRequest: { ...req, language: "en" }, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  const result = makePartialResult("dataforseo-onpage");
  const nr = await store.put({ bytes: Buffer.from(JSON.stringify(result)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: oldKey, completedAt: mockClock().now(), normalizedRecord: nr, rawRecord: null });

  let serpCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {
    ...base,
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: async (a) => { serpCalls++; return base["dataforseo-serp"].execute(a); } },
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  await assert.rejects(() => orch.execute(req), /Source execution key mismatch/);

  const cs = await lc.currentState(auditId, tenantId);
  assert.equal(cs.state, T.COLLECTION_FAILED);
  assert.equal(serpCalls, 0);

  const events = await lc.history(auditId, tenantId);
  const states = events.map(e => e.nextState);
  assert.ok(!states.includes(T.EVIDENCE_STORED));
  assert.ok(!states.includes(T.EVIDENCE_LOCKED));
});

// ===================================================================
// WP5-CLOSE-STALE-03 — Changed registered adapter version
// ===================================================================
test("WP5-CLOSE-STALE-03: changed adapterVersion rejects stale checkpoint", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Persist manifest with old adapterVersion
  const oldKey = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  const result = makePartialResult("dataforseo-onpage");
  const nr = await store.put({ bytes: Buffer.from(JSON.stringify(result)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: oldKey, completedAt: mockClock().now(), normalizedRecord: nr, rawRecord: null });

  // Now register adapter with updated version 2.0.0
  let serpCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {
    ...base,
    "dataforseo-onpage": { adapterVersion: "2.0.0", execute: async () => { throw new Error("should not execute"); } },
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: async (a) => { serpCalls++; return base["dataforseo-serp"].execute(a); } },
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  await assert.rejects(() => orch.execute(req), /Source execution key mismatch/);

  const cs = await lc.currentState(auditId, tenantId);
  assert.equal(cs.state, T.COLLECTION_FAILED);
  assert.equal(serpCalls, 0);

  const events = await lc.history(auditId, tenantId);
  const states = events.map(e => e.nextState);
  assert.ok(!states.includes(T.EVIDENCE_STORED));
  assert.ok(!states.includes(T.EVIDENCE_LOCKED));
});

// ===================================================================
// WP5-CLOSE-INFRA-01 — Raw artifact failure
// ===================================================================
test("WP5-CLOSE-INFRA-01: raw artifact failure → collection_failed, zero later calls", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  let psCalls = 0, serpCalls = 0, blCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {
    ...base,
    "pagespeed": { adapterVersion: "1.0.0", execute: async (a) => { psCalls++; return base["pagespeed"].execute(a); } },
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: async (a) => { serpCalls++; return base["dataforseo-serp"].execute(a); } },
    "backlinks": { adapterVersion: "1.0.0", execute: async (a) => { blCalls++; return base["backlinks"].execute(a); } },
  };

  // Inject raw artifact failure on first source
  const realPut = store.put.bind(store);
  let failRaw = true;
  store.put = async (input) => {
    if (failRaw && input.scope?.category === "raw") { failRaw = false; throw new Error("raw write failure"); }
    return realPut(input);
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  await assert.rejects(() => orch.execute(req));

  const cs = await lc.currentState(auditId, tenantId);
  assert.equal(cs.state, T.COLLECTION_FAILED);

  // Every subsequent adapter call count = 0
  assert.equal(psCalls, 0, "pagespeed calls = 0");
  assert.equal(serpCalls, 0, "serp calls = 0");
  assert.equal(blCalls, 0, "backlinks calls = 0");

  const events = await lc.history(auditId, tenantId);
  const states = events.map(e => e.nextState);
  assert.ok(!states.includes(T.EVIDENCE_STORED));
  assert.ok(!states.includes(T.EVIDENCE_LOCKED));
});

// ===================================================================
// WP5-CLOSE-INFRA-02 — Normalized artifact failure
// ===================================================================
test("WP5-CLOSE-INFRA-02: normalized artifact failure → collection_failed, zero later calls", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  let serpCalls = 0, blCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {
    ...base,
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: async (a) => { serpCalls++; return base["dataforseo-serp"].execute(a); } },
    "backlinks": { adapterVersion: "1.0.0", execute: async (a) => { blCalls++; return base["backlinks"].execute(a); } },
  };

  // Inject normalized artifact failure on first source
  const realPut = store.put.bind(store);
  let failNorm = true;
  store.put = async (input) => {
    if (failNorm && input.scope?.category === "normalized") { failNorm = false; throw new Error("normalized write failure"); }
    return realPut(input);
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  await assert.rejects(() => orch.execute(req));

  const cs = await lc.currentState(auditId, tenantId);
  assert.equal(cs.state, T.COLLECTION_FAILED);
  assert.equal(serpCalls, 0);
  assert.equal(blCalls, 0);

  const events = await lc.history(auditId, tenantId);
  assert.ok(!events.map(e => e.nextState).includes(T.EVIDENCE_STORED));
  assert.ok(!events.map(e => e.nextState).includes(T.EVIDENCE_LOCKED));
});

// ===================================================================
// WP5-CLOSE-INFRA-03 — Source checkpoint manifest failure
// ===================================================================
test("WP5-CLOSE-INFRA-03: checkpoint manifest failure → collection_failed, zero later calls", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  let serpCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {
    ...base,
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: async (a) => { serpCalls++; return base["dataforseo-serp"].execute(a); } },
  };

  // Inject source checkpoint manifest failure
  const realPut = store.put.bind(store);
  store.put = async (input) => {
    if (input.scope?.category === "manifests" && input.scope?.artifactName?.startsWith("source-checkpoint")) {
      throw new Error("manifest write failure");
    }
    return realPut(input);
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  await assert.rejects(() => orch.execute(req));

  const cs = await lc.currentState(auditId, tenantId);
  assert.equal(cs.state, T.COLLECTION_FAILED);
  assert.equal(serpCalls, 0);

  const events = await lc.history(auditId, tenantId);
  assert.ok(!events.map(e => e.nextState).includes(T.EVIDENCE_STORED));
  assert.ok(!events.map(e => e.nextState).includes(T.EVIDENCE_LOCKED));
});

// ===================================================================
// WP5-CLOSE-INFRA-04 — Canonical artifact failure (post-adapter delta=0)
// ===================================================================
test("WP5-CLOSE-INFRA-04: canonical artifact failure → collection_failed, adapter delta=0", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  let totalCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {};
  for (const k of Object.keys(base)) {
    adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { totalCalls++; return base[k].execute(a); } };
  }

  // Inject canonical failure AFTER all adapters have completed
  // Capture adapter count at the exact moment of canonical failure
  let adapterCountAtFailure = 0;
  const realPut = store.put.bind(store);
  store.put = async (input) => {
    if (input.scope?.category === "canonical") {
      adapterCountAtFailure = totalCalls;
      throw new Error("canonical write failure");
    }
    return realPut(input);
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  await assert.rejects(() => orch.execute(req));

  // Assert call-count delta after failure is exactly zero
  assert.equal(totalCalls - adapterCountAtFailure, 0, "adapter call-count delta = 0");

  const cs = await lc.currentState(auditId, tenantId);
  assert.equal(cs.state, T.COLLECTION_FAILED);

  const events = await lc.history(auditId, tenantId);
  assert.ok(!events.map(e => e.nextState).includes(T.EVIDENCE_STORED));
  assert.ok(!events.map(e => e.nextState).includes(T.EVIDENCE_LOCKED));
});

// ===================================================================
// WP5-CLOSE-INFRA-05 — Canonical record manifest failure (post-adapter delta=0)
// ===================================================================
test("WP5-CLOSE-INFRA-05: canonical record manifest failure → collection_failed, adapter delta=0", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  let totalCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {};
  for (const k of Object.keys(base)) {
    adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { totalCalls++; return base[k].execute(a); } };
  }

  // Inject canonical record manifest failure (after canonical artifact succeeds)
  // Capture adapter count at the exact moment of manifest failure
  let adapterCountAtFailure = 0;
  const realPut = store.put.bind(store);
  let canonicalWritten = false;
  store.put = async (input) => {
    if (input.scope?.category === "canonical") { canonicalWritten = true; return realPut(input); }
    if (canonicalWritten && input.scope?.category === "manifests" && input.scope?.artifactName === "canonical-evidence-record.json") {
      adapterCountAtFailure = totalCalls;
      throw new Error("canonical manifest write failure");
    }
    return realPut(input);
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  await assert.rejects(() => orch.execute(req));

  // Assert call-count delta after failure is exactly zero
  assert.equal(totalCalls - adapterCountAtFailure, 0, "adapter call-count delta = 0");

  const cs = await lc.currentState(auditId, tenantId);
  assert.equal(cs.state, T.COLLECTION_FAILED);

  const events = await lc.history(auditId, tenantId);
  assert.ok(!events.map(e => e.nextState).includes(T.EVIDENCE_STORED));
  assert.ok(!events.map(e => e.nextState).includes(T.EVIDENCE_LOCKED));
});

// ===================================================================
// WP5-CLOSE-RESUME-01 — Exact adapter calls
// ===================================================================
test("WP5-CLOSE-RESUME-01: resume — completed=0, incomplete=1", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Persist onpage and pagespeed checkpoints (completed)
  const onpageResult = makePartialResult("dataforseo-onpage");
  const psResult = makeAvailResult("pagespeed");
  const nr1 = await store.put({ bytes: Buffer.from(JSON.stringify(onpageResult)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  const nr2 = await store.put({ bytes: Buffer.from(JSON.stringify(psResult)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "pagespeed.json" }, source: "pagespeed" });
  const onpageEk = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  const psEk = buildSourceExecutionIdentity({ auditRequest: req, source: "pagespeed", adapterVersion: "1.0.0" }).sourceExecutionKey;
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: onpageEk, completedAt: mockClock().now(), normalizedRecord: nr1, rawRecord: null });
  await persistSourceCheckpointManifest({ store, scope, source: "pagespeed", sourceExecutionKey: psEk, completedAt: mockClock().now(), normalizedRecord: nr2, rawRecord: null });

  let onpageCalls = 0, psCalls = 0, serpCalls = 0, blCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {
    "dataforseo-onpage": { adapterVersion: "1.0.0", execute: async (a) => { onpageCalls++; return base["dataforseo-onpage"].execute(a); } },
    "pagespeed": { adapterVersion: "1.0.0", execute: async (a) => { psCalls++; return base["pagespeed"].execute(a); } },
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: async (a) => { serpCalls++; return base["dataforseo-serp"].execute(a); } },
    "backlinks": { adapterVersion: "1.0.0", execute: async (a) => { blCalls++; return base["backlinks"].execute(a); } },
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);

  // Completed adapters = 0, incomplete = 1
  assert.equal(onpageCalls, 0, "completed onpage calls = 0");
  assert.equal(psCalls, 0, "completed pagespeed calls = 0");
  assert.equal(serpCalls, 1, "incomplete serp calls = 1");
  assert.equal(blCalls, 1, "incomplete backlinks calls = 1");
});

// ===================================================================
// WP5-CLOSE-RESUME-02 — Restored bytes and SHA unchanged
// ===================================================================
test("WP5-CLOSE-RESUME-02: restored bytes and SHA unchanged", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Persist a completed checkpoint
  const result = makePartialResult("dataforseo-onpage");
  const bytes = Buffer.from(JSON.stringify(result));
  const nr = await store.put({ bytes, contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  const ek = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: ek, completedAt: mockClock().now(), normalizedRecord: nr, rawRecord: null });

  // Read restored bytes BEFORE recovery
  const beforeBytes = await store.get(nr.key);
  const beforeSha = sha256(beforeBytes);

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);

  // Read restored bytes AFTER recovery
  const afterBytes = await store.get(nr.key);
  assert.equal(afterBytes.length, beforeBytes.length, "byte count unchanged");
  assert.equal(sha256(afterBytes), beforeSha, "SHA unchanged");
  assert.deepEqual(afterBytes, beforeBytes, "bytes identical");
});

// ===================================================================
// WP5-CLOSE-RESUME-03 — PARTIAL source metadata preserved
// ===================================================================
test("WP5-CLOSE-RESUME-03: PARTIAL metadata preserved in canonical evidence", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Persist with status=PARTIAL, retryCount=2, limitations=["controlled limitation"]
  const partialResult = makePartialResult("dataforseo-onpage");
  const nr = await store.put({ bytes: Buffer.from(JSON.stringify(partialResult)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  const ek = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: ek, completedAt: mockClock().now(), normalizedRecord: nr, rawRecord: null });

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);

  // Read canonical evidence from persisted bytes
  const evBuf = await store.get(summary.canonicalEvidence.key);
  const ev = JSON.parse(evBuf.toString());
  const restoredSource = ev.sources.website;

  assert.equal(restoredSource.status, "PARTIAL");
  assert.equal(restoredSource.retryCount, 2);
  assert.deepEqual(restoredSource.limitations, ["controlled limitation"]);
});

// ===================================================================
// WP5-CLOSE-STORED-01 — Zero adapter calls from evidence_stored
// ===================================================================
test("WP5-CLOSE-STORED-01: evidence_stored recovery — zero adapter calls", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Persist canonical evidence and transition to evidence_stored
  const ev = { contractVersion: "1.0.0", evidenceVersion: "1.0.0", auditId, normalizedRequest: { targetUrl: "https://example.com" }, sources: { website: { source: "dataforseo-onpage", status: "AVAILABLE", collectedAt: mockClock().now() } }, limitations: [], artifactReferences: [], adapterVersions: {}, createdAt: mockClock().now() };
  const cr = await store.put({ bytes: Buffer.from(JSON.stringify(ev)), contentType: "application/json", scope: { ...scope, category: "canonical", artifactName: "evidence.json" } });
  const mr = await persistCanonicalRecordManifest({ store, scope, createdAt: mockClock().now(), canonicalRecord: cr });
  await lc.transition({ auditId, tenantId, toState: T.EVIDENCE_STORED, transitionIdempotencyKey: `${auditId}:es`, artifactKey: mr.key });

  let totalAdapterCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {};
  for (const k of Object.keys(base)) {
    adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { totalAdapterCalls++; return base[k].execute(a); } };
  }

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(totalAdapterCalls, 0);
});

// ===================================================================
// WP5-CLOSE-STORED-02 — Zero artifact writes from evidence_stored
// ===================================================================
test("WP5-CLOSE-STORED-02: evidence_stored recovery — zero artifact writes", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  const ev = { contractVersion: "1.0.0", evidenceVersion: "1.0.0", auditId, normalizedRequest: { targetUrl: "https://example.com" }, sources: { website: { source: "dataforseo-onpage", status: "AVAILABLE", collectedAt: mockClock().now() } }, limitations: [], artifactReferences: [], adapterVersions: {}, createdAt: mockClock().now() };
  const cr = await store.put({ bytes: Buffer.from(JSON.stringify(ev)), contentType: "application/json", scope: { ...scope, category: "canonical", artifactName: "evidence.json" } });
  const mr = await persistCanonicalRecordManifest({ store, scope, createdAt: mockClock().now(), canonicalRecord: cr });
  await lc.transition({ auditId, tenantId, toState: T.EVIDENCE_STORED, transitionIdempotencyKey: `${auditId}:es`, artifactKey: mr.key });

  // Instrument put to count writes during recovery
  let writeCount = 0;
  const realPut = store.put.bind(store);
  store.put = async (input) => { writeCount++; return realPut(input); };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(writeCount, 0, "artifact write count = 0");
});

// ===================================================================
// WP5-CLOSE-STORED-03 — Exactly one lifecycle transition
// ===================================================================
test("WP5-CLOSE-STORED-03: evidence_stored → exactly one transition", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  const ev = { contractVersion: "1.0.0", evidenceVersion: "1.0.0", auditId, normalizedRequest: { targetUrl: "https://example.com" }, sources: { website: { source: "dataforseo-onpage", status: "AVAILABLE", collectedAt: mockClock().now() } }, limitations: [], artifactReferences: [], adapterVersions: {}, createdAt: mockClock().now() };
  const cr = await store.put({ bytes: Buffer.from(JSON.stringify(ev)), contentType: "application/json", scope: { ...scope, category: "canonical", artifactName: "evidence.json" } });
  const mr = await persistCanonicalRecordManifest({ store, scope, createdAt: mockClock().now(), canonicalRecord: cr });
  await lc.transition({ auditId, tenantId, toState: T.EVIDENCE_STORED, transitionIdempotencyKey: `${auditId}:es`, artifactKey: mr.key });

  const beforeHistory = await lc.history(auditId, tenantId);

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);

  const afterHistory = await lc.history(auditId, tenantId);
  assert.equal(afterHistory.length - beforeHistory.length, 1, "exactly one new transition");

  assert.deepEqual(
    afterHistory.slice(-1).map(event => [event.priorState, event.nextState]),
    [[T.EVIDENCE_STORED, T.EVIDENCE_LOCKED]]
  );
});

// ===================================================================
// WP5-CLOSE-REPLAY-01 — Zero adapter calls on locked replay
// ===================================================================
test("WP5-CLOSE-REPLAY-01: locked replay — zero adapter calls", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  let adapterCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {};
  for (const k of Object.keys(base)) {
    adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { adapterCalls++; return base[k].execute(a); } };
  }

  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  const req = baReq();
  const s1 = await orch.execute(req);
  assert.equal(s1.finalState, T.EVIDENCE_LOCKED);
  const callsBeforeReplay = adapterCalls;

  const s2 = await orch.execute(req);
  assert.equal(adapterCalls - callsBeforeReplay, 0, "zero new adapter calls on replay");
});

// ===================================================================
// WP5-CLOSE-REPLAY-02 — Zero artifact writes on locked replay
// ===================================================================
test("WP5-CLOSE-REPLAY-02: locked replay — zero artifact writes", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const req = baReq();
  const s1 = await orch.execute(req);
  assert.equal(s1.finalState, T.EVIDENCE_LOCKED);

  // Instrument put
  let writesBeforeReplay = 0;
  const realPut = store.put.bind(store);
  store.put = async (input) => { writesBeforeReplay++; return realPut(input); };

  const s2 = await orch.execute(req);
  assert.equal(writesBeforeReplay, 0, "zero artifact writes on replay");
});

// ===================================================================
// WP5-CLOSE-REPLAY-03 — Canonical identity unchanged on replay
// ===================================================================
test("WP5-CLOSE-REPLAY-03: locked replay — canonical identity + persisted bytes unchanged", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const req = baReq();

  const s1 = await orch.execute(req);
  assert.equal(s1.finalState, T.EVIDENCE_LOCKED);

  const s2 = await orch.execute(req);

  // Identity comparison
  assert.equal(s2.canonicalEvidence.key, s1.canonicalEvidence.key);
  assert.equal(s2.canonicalEvidence.sha256, s1.canonicalEvidence.sha256);
  assert.equal(s2.canonicalEvidence.bytes, s1.canonicalEvidence.bytes);

  // Persisted bytes proof
  const persistedBytes = await store.get(s1.canonicalEvidence.key);
  assert.ok(persistedBytes, "persisted bytes exist");
  assert.equal(persistedBytes.length, s1.canonicalEvidence.bytes);
  assert.equal(sha256(persistedBytes), s1.canonicalEvidence.sha256);

  const persistedBytes2 = await store.get(s2.canonicalEvidence.key);
  assert.equal(persistedBytes2.length, persistedBytes.length, "persisted byte count unchanged");
  assert.equal(sha256(persistedBytes2), sha256(persistedBytes), "persisted SHA unchanged");
  assert.deepEqual(persistedBytes2, persistedBytes, "persisted bytes unchanged");
});

// ===================================================================
// Retry-count regression tests (existing tests preserved)
// ===================================================================
test("15. first-attempt success: retryCount = 0", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let attempts = 0;
  const adapters = createBaseMockAdapters();
  adapters["pagespeed"] = { adapterVersion: "1.0.0", execute: async () => { attempts++; return { rawBytes: Buffer.from("{}"), contentType: "application/json", sourceResult: { provider: "MP", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), retryCount: 5, expectedRecords: 1, returnedRecords: 1, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: {} } }; } };
  const orch = createAuditOrchestrator({ lifecycleService: createLifecycleService(createMemoryLifecycleRepository()), artifactStore: store, adapters, validateContract, clock: mockClock() });
  const summary = await orch.execute(baReq());
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(attempts, 1);
  assert.equal(summary.sources.find(x => x.source === "pagespeed").retryCount, 0);
});

test("16. non-retryable: retryCount = 0", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let attempts = 0;
  const adapters = createBaseMockAdapters();
  adapters["backlinks"] = { adapterVersion: "1.0.0", execute: async () => { attempts++; const e = new Error("auth"); e.category = "auth"; throw e; } };
  const orch = createAuditOrchestrator({ lifecycleService: createLifecycleService(createMemoryLifecycleRepository()), artifactStore: store, adapters, validateContract, clock: mockClock(), retryPolicyResolver: () => ({ timeoutMs: 30000, maxAttempts: 3, retryable: e => e?.category !== "auth", delayMs: () => 0 }) });
  const summary = await orch.execute(baReq());
  assert.equal(attempts, 1);
  assert.equal(summary.sources.find(x => x.source === "backlinks").retryCount, 0);
});

test("17. third-attempt success: retryCount = 2", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let attempts = 0;
  const adapters = createBaseMockAdapters();
  adapters["dataforseo-serp"] = { adapterVersion: "1.0.0", execute: async () => { attempts++; if (attempts < 3) { const e = new Error("net"); e.category = "network"; e.statusCode = 503; throw e; } return { rawBytes: Buffer.from("{}"), contentType: "application/json", sourceResult: { provider: "MP", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), retryCount: 99, expectedRecords: 1, returnedRecords: 1, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: {} } }; } };
  const orch = createAuditOrchestrator({ lifecycleService: createLifecycleService(createMemoryLifecycleRepository()), artifactStore: store, adapters, validateContract, clock: mockClock(), retryPolicyResolver: () => ({ timeoutMs: 30000, maxAttempts: 3, retryable: e => e?.category === "network", delayMs: () => 0 }) });
  const summary = await orch.execute(baReq());
  assert.equal(attempts, 3);
  assert.equal(summary.sources.find(x => x.source === "dataforseo-serp").retryCount, 2);
});

test("18. timeout exhaustion: retryCount = 2", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let ta = 0;
  const adapters = createBaseMockAdapters();
  adapters["pagespeed"] = { adapterVersion: "1.0.0", execute: async ({ signal }) => { ta++; await new Promise(r => setTimeout(r, 10)); if (signal?.aborted) { const e = new Error("t/o"); e.category = "timeout"; throw e; } const e = new Error("t/o"); e.category = "timeout"; throw e; } };
  const orch = createAuditOrchestrator({ lifecycleService: createLifecycleService(createMemoryLifecycleRepository()), artifactStore: store, adapters, validateContract, clock: mockClock(), retryPolicyResolver: () => ({ timeoutMs: 1, maxAttempts: 3, retryable: e => e?.category === "timeout", delayMs: () => 0 }) });
  const summary = await orch.execute(baReq());
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(ta, 3);
  assert.equal(summary.sources.find(x => x.source === "pagespeed").retryCount, 2);
});

// Missing artifactKey fail-closed
test("19. missing/wrong/cross-tenant lifecycle artifactKey fails closed", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });
  // Transition to evidence_locked with wrong artifactKey
  await lc.transition({ auditId, tenantId, toState: T.EVIDENCE_STORED, transitionIdempotencyKey: `${auditId}:es`, artifactKey: "tenants/wrong/clients/wrong/audits/wrong/manifests/canonical-evidence-record.json" });
  await lc.transition({ auditId, tenantId, toState: T.EVIDENCE_LOCKED, transitionIdempotencyKey: `${auditId}:el`, artifactKey: "tenants/wrong/clients/wrong/audits/wrong/manifests/canonical-evidence-record.json" });

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  await assert.rejects(() => orch.execute(req), /Cross-tenant/);
});

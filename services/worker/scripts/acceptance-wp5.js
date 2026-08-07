#!/usr/bin/env node
/**
 * WP5 Acceptance Harness — governed recovery and failure boundary proof.
 *
 * Covers all WP5-CLOSE checklist items with direct runtime/persisted evidence.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { createMemoryLifecycleRepository } from "../src/lifecycle/memory-repository.js";
import { createLifecycleService } from "../src/lifecycle/lifecycle-service.js";
import { createGovernedArtifactStore } from "../src/storage/governed-artifact-store.js";
import { createAuditOrchestrator, buildSourceExecutionIdentity } from "../src/orchestration/audit-orchestrator.js";
import { LIFECYCLE_STATE } from "../src/lifecycle/state-enum.js";
import { persistSourceCheckpointManifest, persistCanonicalRecordManifest, buildSourceCheckpointManifestKey, buildCanonicalRecordManifestKey } from "../src/orchestration/artifact-recovery.js";
import {
  createBaseMockAdapters, createStatusAdapter,
  createKeyCapturingAdapter, createVersionMismatchAdapter,
  createMissingVersionAdapter, createEmptyVersionAdapter,
} from "../test-fixtures/orchestration/mock-adapters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const T = LIFECYCLE_STATE;

let allPassed = true;
function pass(t) { console.log(`  ✓ ${t}`); }
function fail(t) { allPassed = false; console.log(`  ✗ ${t}`); }
function assertEq(actual, expected, label) {
  if (actual === expected) { pass(label); return true; }
  else { fail(`${label}: expected ${expected}, got ${actual}`); return false; }
}
function assertDeep(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass(label); return true; }
  else { fail(`${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); return false; }
}

function sha256(b) { return createHash("sha256").update(b).digest("hex"); }
function mockClock(iso = "2026-01-01T00:00:00.000Z") { let t = new Date(iso).getTime(); return { now: () => new Date(t).toISOString(), sleep: async () => {}, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 100)) }; }

const schemasDir = resolve(ROOT, "src", "contracts");
const _ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(_ajv);
["audit-request.schema.json", "source-result.schema.json", "canonical-evidence.schema.json"].forEach(f => {
  _ajv.addSchema(JSON.parse(readFileSync(resolve(schemasDir, f), "utf-8")), `https://vantage-platform.io/prysm/contracts/v1/${f}`);
});
function vc(sid, obj) { const v = _ajv.getSchema(sid); return { valid: v(obj), errors: v.errors || [] }; }

function makeAvailResult(source) {
  return {
    contractVersion: "1.0.0", schemaVersion: "1.0.0",
    source, provider: "M", adapterVersion: "1.0.0",
    status: "AVAILABLE", startedAt: mockClock().now(), completedAt: mockClock().now(),
    retryCount: 1, expectedRecords: 1, returnedRecords: 1,
    coverage: { requested: 1, completed: 1, failed: 0 },
    limitations: [], evidence: {},
  };
}

// ===================================================================
// A. WP5-CLOSE-VAL-01 — Invalid request persists created → validation_failed
// ===================================================================
console.log("\n─ A. VAL-01/02: Invalid request lifecycle ─");
{
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
  const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "a1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: undefined };
  const summary = await orch.execute(req);

  const history = await lc.history(req.auditId, req.tenantId);
  assertDeep(history.map(e => e.nextState), [T.CREATED, T.VALIDATION_FAILED], "VAL-01: exact ordered history [created, validation_failed]");

  const persistedState = await lc.currentState(req.auditId, req.tenantId);
  assertEq(persistedState.state, T.VALIDATION_FAILED, "VAL-02: persisted state = validation_failed");
  assertEq(summary.finalState, T.VALIDATION_FAILED, "VAL-02: summary finalState = validation_failed");
}

// ===================================================================
// B. WP5-CLOSE-VAL-03/04 — Invalid-request create/transition failure rejects
// ===================================================================
console.log("\n─ B. VAL-03/04: Validation failure propagation ─");
{
  // VAL-03: create failure rejects
  const store = createGovernedArtifactStore({ type: "memory" });
  const lcInject = {
    create: async () => { throw new Error("injected create failure"); },
    transition: async () => {},
    currentState: async () => null,
    history: async () => [],
  };
  const orch = createAuditOrchestrator({ lifecycleService: lcInject, artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
  try {
    await orch.execute({ contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "b1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: undefined });
    fail("VAL-03: should have rejected on create failure");
  } catch (e) {
    if (e.message.includes("injected create failure")) pass("VAL-03: create failure rejects, no summary");
    else fail(`VAL-03: wrong error: ${e.message}`);
  }

  // VAL-04: transition failure rejects
  const repo2 = createMemoryLifecycleRepository();
  const baseLc2 = createLifecycleService(repo2);
  const req2 = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "b2", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: undefined };
  const lc2 = {
    create: async (args) => baseLc2.create(args),
    transition: async (args) => {
      if (args.toState === T.VALIDATION_FAILED) throw new Error("injected validation_failed transition failure");
      return baseLc2.transition(args);
    },
    currentState: async (aid, tid) => baseLc2.currentState(aid, tid),
    history: async (aid, tid) => baseLc2.history(aid, tid),
  };
  const orch2 = createAuditOrchestrator({ lifecycleService: lc2, artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
  try {
    await orch2.execute(req2);
    fail("VAL-04: should have rejected on validation_failed transition failure");
  } catch (e) {
    if (e.message.includes("injected validation_failed transition failure")) pass("VAL-04: transition failure rejects, no summary");
    else fail(`VAL-04: wrong error: ${e.message}`);
  }
  const h2 = await baseLc2.history(req2.auditId, req2.tenantId);
  assertEq(h2.map(e => e.nextState).includes(T.CREATED), true, "VAL-04: created exists");
  assertEq(h2.map(e => e.nextState).includes(T.VALIDATION_FAILED), false, "VAL-04: validation_failed does not exist");
}

// ===================================================================
// C. WP5-CLOSE-IDEM-01/02/03 — Execution-scoped idempotency keys
// ===================================================================
console.log("\n─ C. IDEM: Execution-scoped keys ─");
{
  // IDEM-01: collection_failed key execution-scoped — single fixed auditId
  const idem01AuditId = randomUUID();
  const idem01Req = { contractVersion: "1.0.0", auditId: idem01AuditId, tenantId: "c1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const capturedKeys01 = [];

  // Shared lifecycle setup
  const repo01 = createMemoryLifecycleRepository();
  const baseLc01 = createLifecycleService(repo01);
  await baseLc01.create({ auditId: idem01AuditId, tenantId: "c1", clientId: "c1", idempotencyKey: idem01Req.idempotencyKey });
  await baseLc01.transition({ auditId: idem01AuditId, tenantId: "c1", toState: T.VALIDATED, transitionIdempotencyKey: `${idem01AuditId}:setup:validated` });
  await baseLc01.transition({ auditId: idem01AuditId, tenantId: "c1", toState: T.COLLECTING, transitionIdempotencyKey: `${idem01AuditId}:setup:collecting` });

  function idem01MakeLc() {
    return {
      create: async (args) => baseLc01.create(args),
      transition: async (args) => {
        if (args.toState === T.COLLECTION_FAILED) capturedKeys01.push(args.transitionIdempotencyKey);
        return baseLc01.transition(args);
      },
      currentState: async (aid, tid) => baseLc01.currentState(aid, tid),
      history: async (aid, tid) => baseLc01.history(aid, tid),
    };
  }

  // exec-a (first time) → collection_failed
  {
    const store = createGovernedArtifactStore({ type: "memory" });
    const rp = store.put.bind(store);
    store.put = async (i) => { if (i.scope?.category === "raw") throw new Error("fail"); return rp(i); };
    const orch = createAuditOrchestrator({ lifecycleService: idem01MakeLc(), artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
    try { await orch.execute(idem01Req, { executionId: "exec-a" }); } catch {}
  }
  const sameExecutionKey1 = capturedKeys01[0];

  // Reset to collecting, then exec-b (different)
  await baseLc01.transition({ auditId: idem01AuditId, tenantId: "c1", toState: T.COLLECTING, transitionIdempotencyKey: `${idem01AuditId}:reset1:collection-failed-recovery` });
  {
    const store = createGovernedArtifactStore({ type: "memory" });
    const rp = store.put.bind(store);
    store.put = async (i) => { if (i.scope?.category === "raw") throw new Error("fail"); return rp(i); };
    const orch = createAuditOrchestrator({ lifecycleService: idem01MakeLc(), artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
    try { await orch.execute(idem01Req, { executionId: "exec-b" }); } catch {}
  }
  const differentExecutionKey = capturedKeys01[1];

  // Reset to collecting, then exec-a again (same)
  await baseLc01.transition({ auditId: idem01AuditId, tenantId: "c1", toState: T.COLLECTING, transitionIdempotencyKey: `${idem01AuditId}:reset2:collection-failed-recovery` });
  {
    const store = createGovernedArtifactStore({ type: "memory" });
    const rp = store.put.bind(store);
    store.put = async (i) => { if (i.scope?.category === "raw") throw new Error("fail"); return rp(i); };
    const orch = createAuditOrchestrator({ lifecycleService: idem01MakeLc(), artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
    try { await orch.execute(idem01Req, { executionId: "exec-a" }); } catch {}
  }
  const sameExecutionKey2 = capturedKeys01[2];

  assertEq(sameExecutionKey1, sameExecutionKey2, "IDEM-01: same auditId + exec-a → identical keys");
  assertEq(sameExecutionKey1, `${idem01AuditId}:exec-a:collection-failed`, "IDEM-01: key = {auditId}:exec-a:collection-failed");
  assertEq(sameExecutionKey1 !== differentExecutionKey, true, "IDEM-01: different executionIds → different keys");
  assertEq(differentExecutionKey, `${idem01AuditId}:exec-b:collection-failed`, "IDEM-01: different key = {auditId}:exec-b:collection-failed");

  // IDEM-02: recovery key execution-scoped — single fixed auditId
  const idem02AuditId = randomUUID();
  const idem02Req = { contractVersion: "1.0.0", auditId: idem02AuditId, tenantId: "c2", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const capturedKeys02 = [];

  const repo02 = createMemoryLifecycleRepository();
  const baseLc02 = createLifecycleService(repo02);
  await baseLc02.create({ auditId: idem02AuditId, tenantId: "c2", clientId: "c1", idempotencyKey: idem02Req.idempotencyKey });
  await baseLc02.transition({ auditId: idem02AuditId, tenantId: "c2", toState: T.VALIDATED, transitionIdempotencyKey: `${idem02AuditId}:setup:validated` });
  await baseLc02.transition({ auditId: idem02AuditId, tenantId: "c2", toState: T.COLLECTING, transitionIdempotencyKey: `${idem02AuditId}:setup:collecting` });

  function idem02MakeLc() {
    return {
      create: async (args) => baseLc02.create(args),
      transition: async (args) => {
        if (args.toState === T.COLLECTING && args.transitionIdempotencyKey.includes("collection-failed-recovery")) {
          capturedKeys02.push(args.transitionIdempotencyKey);
        }
        return baseLc02.transition(args);
      },
      currentState: async (aid, tid) => baseLc02.currentState(aid, tid),
      history: async (aid, tid) => baseLc02.history(aid, tid),
    };
  }

  // Helper: run failing recovery that triggers collection_failed (stays in loopable state)
  async function runFailingRecovery02(executionId) {
    const store = createGovernedArtifactStore({ type: "memory" });
    // Inject raw artifact failure so collection fails and we stay in collection_failed
    const rp = store.put.bind(store);
    store.put = async (i) => { if (i.scope?.category === "raw") throw new Error("fail"); return rp(i); };
    const orch = createAuditOrchestrator({ lifecycleService: idem02MakeLc(), artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
    try { await orch.execute(idem02Req, { executionId }); } catch {}
  }

  // Recovery exec-a (first time) — fails, stays in collection_failed
  await baseLc02.transition({ auditId: idem02AuditId, tenantId: "c2", toState: T.COLLECTION_FAILED, transitionIdempotencyKey: `${idem02AuditId}:f1:collection-failed` });
  await runFailingRecovery02("exec-a");
  const sameRecoveryKey1 = capturedKeys02[0];

  // Reset, transition to collection_failed, recover with exec-b (different)
  await baseLc02.transition({ auditId: idem02AuditId, tenantId: "c2", toState: T.COLLECTING, transitionIdempotencyKey: `${idem02AuditId}:reset1:collection-failed-recovery` });
  await baseLc02.transition({ auditId: idem02AuditId, tenantId: "c2", toState: T.COLLECTION_FAILED, transitionIdempotencyKey: `${idem02AuditId}:f2:collection-failed` });
  await runFailingRecovery02("exec-b");
  const differentRecoveryKey = capturedKeys02[1];

  // Reset, transition to collection_failed, recover with exec-a again (same)
  await baseLc02.transition({ auditId: idem02AuditId, tenantId: "c2", toState: T.COLLECTING, transitionIdempotencyKey: `${idem02AuditId}:reset2:collection-failed-recovery` });
  await baseLc02.transition({ auditId: idem02AuditId, tenantId: "c2", toState: T.COLLECTION_FAILED, transitionIdempotencyKey: `${idem02AuditId}:f3:collection-failed` });
  await runFailingRecovery02("exec-a");
  const sameRecoveryKey2 = capturedKeys02[2];

  assertEq(sameRecoveryKey1, sameRecoveryKey2, "IDEM-02: same auditId + exec-a → identical recovery keys");
  assertEq(sameRecoveryKey1, `${idem02AuditId}:exec-a:collection-failed-recovery`, "IDEM-02: key = {auditId}:exec-a:collection-failed-recovery");
  assertEq(sameRecoveryKey1 !== differentRecoveryKey, true, "IDEM-02: different executionIds → different recovery keys");
  assertEq(differentRecoveryKey, `${idem02AuditId}:exec-b:collection-failed-recovery`, "IDEM-02: different key = {auditId}:exec-b:collection-failed-recovery");

  // IDEM-03: Two failures then success — exact ordered history
  {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const lc = createLifecycleService(repo);
    const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "c3", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
    const { auditId, tenantId, clientId } = req;

    // Exec 1: raw artifact failure
    {
      const realPut = store.put.bind(store);
      let f = true;
      store.put = async (i) => { if (f && i.scope?.category === "raw") { f = false; throw new Error("e1"); } return realPut(i); };
      const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
      try { await orch.execute(req, { executionId: "e1" }); } catch {}
    }
    // Exec 2: normalized artifact failure
    {
      await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:e2:collection-failed-recovery` });
      const realPut = store.put.bind(store);
      let f = true;
      store.put = async (i) => { if (f && i.scope?.category === "normalized") { f = false; throw new Error("e2"); } return realPut(i); };
      const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
      try { await orch.execute(req, { executionId: "e2" }); } catch {}
    }
    // Exec 3: success
    {
      await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:e3:collection-failed-recovery` });
      const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
      const s = await orch.execute(req, { executionId: "e3" });
      assertEq(s.finalState, T.EVIDENCE_LOCKED, "IDEM-03: final state = evidence_locked");
    }
    const states = (await lc.history(auditId, tenantId)).map(e => e.nextState);
    assertDeep(states, [T.CREATED, T.VALIDATED, T.COLLECTING, T.COLLECTION_FAILED, T.COLLECTING, T.COLLECTION_FAILED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED], "IDEM-03: exact ordered history");
  }
}

// ===================================================================
// D. WP5-CLOSE-ADP — Adapter version identity
// ===================================================================
console.log("\n─ D. ADP: Adapter version identity ─");
{
  // ADP-01: missing/empty adapterVersion rejects
  {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const lc = createLifecycleService(repo);
    const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "d1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
    await lc.create({ auditId: req.auditId, tenantId: req.tenantId, clientId: req.clientId, idempotencyKey: req.idempotencyKey });
    await lc.transition({ auditId: req.auditId, tenantId: req.tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${req.auditId}:v:validated` });
    await lc.transition({ auditId: req.auditId, tenantId: req.tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${req.auditId}:c:collecting` });

    const missingAd = createMissingVersionAdapter("dataforseo-onpage");
    const base = createBaseMockAdapters();
    const adapters1 = { ...base, "dataforseo-onpage": missingAd };
    const orch1 = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: adapters1, validateContract: vc, clock: mockClock() });
    try { await orch1.execute(req); fail("ADP-01: missing version should reject"); }
    catch (e) { if (e.message.includes("adapterVersion")) pass("ADP-01: missing adapterVersion rejects"); else fail(`ADP-01: wrong error: ${e.message}`); }

    const emptyAd = createEmptyVersionAdapter("dataforseo-onpage");
    const adapters2 = { ...base, "dataforseo-onpage": emptyAd };
    const orch2 = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: adapters2, validateContract: vc, clock: mockClock() });
    try { await orch2.execute(req); fail("ADP-01: empty version should reject"); }
    catch (e) { if (e.message.includes("adapterVersion")) pass("ADP-01: empty adapterVersion rejects"); else fail(`ADP-01: wrong error: ${e.message}`); }
  }

  // ADP-02: Source execution key equality
  {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const lc = createLifecycleService(repo);
    const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "d2", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
    const scope = { tenantId: req.tenantId, clientId: req.clientId, auditId: req.auditId };
    await lc.create({ auditId: req.auditId, tenantId: req.tenantId, clientId: req.clientId, idempotencyKey: req.idempotencyKey });
    await lc.transition({ auditId: req.auditId, tenantId: req.tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${req.auditId}:v:validated` });
    await lc.transition({ auditId: req.auditId, tenantId: req.tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${req.auditId}:c:collecting` });

    const keyCap = createKeyCapturingAdapter("dataforseo-onpage", "1.0.0");
    const base = createBaseMockAdapters();
    const adapters = { ...base, "dataforseo-onpage": keyCap };
    const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
    const s = await orch.execute(req);
    assertEq(s.finalState, T.EVIDENCE_LOCKED, "ADP-02: final state = evidence_locked");
    assertEq(keyCap.getCallCount(), 1, "ADP-02: adapter called once");
    const adapterKey = keyCap.getReceivedKey();
    const expectedKey = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
    const mfBuf = await store.get(buildSourceCheckpointManifestKey(scope, "dataforseo-onpage"));
    const manifest = JSON.parse(mfBuf.toString());
    assertEq(adapterKey, expectedKey, "ADP-02: adapter key = expected key");
    assertEq(manifest.sourceExecutionKey, expectedKey, "ADP-02: manifest key = expected key");
    assertEq(adapterKey, manifest.sourceExecutionKey, "ADP-02: adapter key = manifest key");
  }

  // ADP-03: Version mismatch rejects
  {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const lc = createLifecycleService(repo);
    const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "d3", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
    const { auditId, tenantId, clientId } = req;
    await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
    await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
    await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

    const mismatch = createVersionMismatchAdapter("dataforseo-onpage", "2.0.0", "1.0.0");
    const base = createBaseMockAdapters();
    let laterCalls = 0;
    const adapters = {};
    for (const k of Object.keys(base)) {
      if (k === "dataforseo-onpage") adapters[k] = mismatch;
      else adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { laterCalls++; return base[k].execute(a); } };
    }
    const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
    try { await orch.execute(req); fail("ADP-03: should reject on version mismatch"); }
    catch (e) {
      if (e.message.includes("version mismatch")) pass("ADP-03: version mismatch rejects");
      else fail(`ADP-03: wrong error: ${e.message}`);
    }
    const cs = await lc.currentState(auditId, tenantId);
    assertEq(cs.state, T.COLLECTION_FAILED, "ADP-03: persisted state = collection_failed");
    assertEq(laterCalls, 0, "ADP-03: later adapter calls = 0");
    const events = await lc.history(auditId, tenantId);
    const states = events.map(e => e.nextState);
    assertEq(states.includes(T.EVIDENCE_STORED), false, "ADP-03: evidence_stored absent");
    assertEq(states.includes(T.EVIDENCE_LOCKED), false, "ADP-03: evidence_locked absent");
  }

  // ADP-04: Valid checkpoint skips adapter
  {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const lc = createLifecycleService(repo);
    const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "d4", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
    const scope = { tenantId: req.tenantId, clientId: req.clientId, auditId: req.auditId };
    await lc.create({ auditId: req.auditId, tenantId: req.tenantId, clientId: req.clientId, idempotencyKey: req.idempotencyKey });
    await lc.transition({ auditId: req.auditId, tenantId: req.tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${req.auditId}:v:validated` });
    await lc.transition({ auditId: req.auditId, tenantId: req.tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${req.auditId}:c:collecting` });

    const result = makeAvailResult("dataforseo-onpage");
    const nr = await store.put({ bytes: Buffer.from(JSON.stringify(result)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
    const ek = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
    await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: ek, completedAt: mockClock().now(), normalizedRecord: nr, rawRecord: null });

    let onCalls = 0;
    const base = createBaseMockAdapters();
    const adapters = { ...base, "dataforseo-onpage": { adapterVersion: "1.0.0", execute: async (a) => { onCalls++; return base["dataforseo-onpage"].execute(a); } } };
    const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
    const s = await orch.execute(req);
    assertEq(s.finalState, T.EVIDENCE_LOCKED, "ADP-04: final state = evidence_locked");
    assertEq(onCalls, 0, "ADP-04: restored adapter call count = 0");
  }
}

// ===================================================================
// E. WP5-CLOSE-STAT — Exact source-status counters
// ===================================================================
console.log("\n─ E. STAT: Source-status counters ─");
{
  // STAT-01: Explicit status mapping — each status individually
  const ALL_STATUSES = ["AVAILABLE", "PARTIAL", "FAILED", "BLOCKED", "UNAVAILABLE", "NOT_CONNECTED", "NOT_APPLICABLE"];
  const EXPECTED_KEY = {
    "AVAILABLE": "available", "PARTIAL": "partial", "FAILED": "failed",
    "BLOCKED": "blocked", "UNAVAILABLE": "unavailable",
    "NOT_CONNECTED": "notConnected", "NOT_APPLICABLE": "notApplicable",
  };
  let stat01Pass = true;
  for (const status of ALL_STATUSES) {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const lc = createLifecycleService(repo);
    const adapters = { "dataforseo-onpage": createStatusAdapter("dataforseo-onpage", status) };
    const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
    const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "e1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
    const summary = await orch.execute(req);
    const key = EXPECTED_KEY[status];
    const expectedCount = status === "NOT_APPLICABLE" ? 4 : 1;
    if (summary.sourceCounts[key] !== expectedCount) {
      fail(`STAT-01: ${status} → ${key} = ${summary.sourceCounts[key]}, expected ${expectedCount}`);
      stat01Pass = false;
    }
  }
  if (stat01Pass) pass("STAT-01: all seven statuses map to correct counter keys");

  // STAT-02: Counter sum equals total
  {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const lc = createLifecycleService(repo);
    const adapters = {
      "dataforseo-onpage": createStatusAdapter("dataforseo-onpage", "AVAILABLE"),
      "pagespeed": createStatusAdapter("pagespeed", "PARTIAL"),
      "dataforseo-serp": createStatusAdapter("dataforseo-serp", "FAILED"),
      "backlinks": createStatusAdapter("backlinks", "BLOCKED"),
    };
    const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
    const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "e2", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
    const summary = await orch.execute(req);
    const c = summary.sourceCounts;
    const sum = c.available + c.partial + c.failed + c.blocked + c.unavailable + c.notConnected + c.notApplicable;
    assertEq(sum, c.total, "STAT-02: counter sum equals total");
  }
}

// ===================================================================
// F. WP5-CLOSE-STALE — Complete stale-checkpoint proof
// ===================================================================
console.log("\n─ F. STALE: Stale checkpoint rejection ─");
async function proveStale(label, oldReq, newReq, source) {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = newReq;
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };
  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  const oldKey = buildSourceExecutionIdentity({ auditRequest: oldReq, source, adapterVersion: "1.0.0" }).sourceExecutionKey;
  const result = makeAvailResult(source);
  const nr = await store.put({ bytes: Buffer.from(JSON.stringify(result)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: `${source}.json` }, source });
  await persistSourceCheckpointManifest({ store, scope, source, sourceExecutionKey: oldKey, completedAt: mockClock().now(), normalizedRecord: nr, rawRecord: null });

  let laterCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {};
  for (const k of Object.keys(base)) {
    if (k === source) adapters[k] = base[k];
    else adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { laterCalls++; return base[k].execute(a); } };
  }

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
  try { await orch.execute(req); fail(`${label}: should have rejected`); }
  catch (e) {
    if (e.message.includes("Source execution key mismatch")) pass(`${label}: rejects with key mismatch`);
    else fail(`${label}: wrong error: ${e.message}`);
  }
  const cs = await lc.currentState(auditId, tenantId);
  assertEq(cs.state, T.COLLECTION_FAILED, `${label}: persisted state = collection_failed`);
  assertEq(laterCalls, 0, `${label}: later adapter calls = 0`);
  const events = await lc.history(auditId, tenantId);
  const states = events.map(e => e.nextState);
  assertEq(states.includes(T.EVIDENCE_STORED), false, `${label}: evidence_stored absent`);
  assertEq(states.includes(T.EVIDENCE_LOCKED), false, `${label}: evidence_locked absent`);
}

const baseReq = () => ({ contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "f1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com", language: "en" });
{
  const nr = baseReq();
  await proveStale("STALE-01: targetUrl", { ...nr, targetUrl: "https://old.example.com" }, nr, "dataforseo-onpage");
}
{
  const nr = baseReq();
  await proveStale("STALE-02: language", { ...nr, language: "fr" }, { ...nr, language: "en" }, "dataforseo-onpage");
}
// STALE-03: adapterVersion change — manifest stored with v1.0.0, registered adapter is v2.0.0
{
  const store2 = createGovernedArtifactStore({ type: "memory" });
  const repo2 = createMemoryLifecycleRepository();
  const lc2 = createLifecycleService(repo2);
  const req2 = baseReq();
  const { auditId: a2, tenantId: t2, clientId: c2 } = req2;
  const scope2 = { tenantId: t2, clientId: c2, auditId: a2 };
  await lc2.create({ auditId: a2, tenantId: t2, clientId: c2, idempotencyKey: req2.idempotencyKey });
  await lc2.transition({ auditId: a2, tenantId: t2, toState: T.VALIDATED, transitionIdempotencyKey: `${a2}:v:validated` });
  await lc2.transition({ auditId: a2, tenantId: t2, toState: T.COLLECTING, transitionIdempotencyKey: `${a2}:c:collecting` });

  const oldEk = buildSourceExecutionIdentity({ auditRequest: req2, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  const result = makeAvailResult("dataforseo-onpage");
  const nr2 = await store2.put({ bytes: Buffer.from(JSON.stringify(result)), contentType: "application/json", scope: { ...scope2, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  await persistSourceCheckpointManifest({ store: store2, scope: scope2, source: "dataforseo-onpage", sourceExecutionKey: oldEk, completedAt: mockClock().now(), normalizedRecord: nr2, rawRecord: null });

  const base = createBaseMockAdapters();
  let laterCalls = 0;
  const adapters = {
    ...base,
    "dataforseo-onpage": { adapterVersion: "2.0.0", execute: async () => { throw new Error("should not execute"); } },
  };
  for (const k of Object.keys(adapters)) {
    if (k !== "dataforseo-onpage") {
      const orig = adapters[k];
      adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { laterCalls++; return orig.execute(a); } };
    }
  }

  const orch = createAuditOrchestrator({ lifecycleService: lc2, artifactStore: store2, adapters, validateContract: vc, clock: mockClock() });
  try { await orch.execute(req2); fail("STALE-03: should reject on adapterVersion change"); }
  catch (e) {
    if (e.message.includes("Source execution key mismatch")) pass("STALE-03: adapterVersion mismatch rejects");
    else fail(`STALE-03: wrong error: ${e.message}`);
  }
  const cs = await lc2.currentState(a2, t2);
  assertEq(cs.state, T.COLLECTION_FAILED, "STALE-03: persisted state = collection_failed");
  assertEq(laterCalls, 0, "STALE-03: later calls = 0");
}

// ===================================================================
// G. WP5-CLOSE-INFRA — Infrastructure failure matrix
// ===================================================================
console.log("\n─ G. INFRA: Infrastructure failure matrix ─");
async function proveInfra(label, failSetup, opts = {}) {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "g1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const { auditId, tenantId, clientId } = req;
  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  const adapters = createBaseMockAdapters();
  let laterCalls = 0;
  for (const k of Object.keys(adapters)) {
    if (k !== "dataforseo-onpage") {
      const orig = adapters[k];
      adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { laterCalls++; return orig.execute(a); } };
    }
  }
  failSetup(adapters, store);

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
  try { await orch.execute(req); fail(`${label}: should have thrown`); }
  catch {}
  const cs = await lc.currentState(auditId, tenantId);
  assertEq(cs.state, T.COLLECTION_FAILED, `${label}: persisted state = collection_failed`);
  if (opts.checkLaterCalls !== false) assertEq(laterCalls, 0, `${label}: later adapter calls = 0`);
  const events = await lc.history(auditId, tenantId);
  const states = events.map(e => e.nextState);
  assertEq(states.includes(T.EVIDENCE_STORED), false, `${label}: evidence_stored absent`);
  assertEq(states.includes(T.EVIDENCE_LOCKED), false, `${label}: evidence_locked absent`);
}

await proveInfra("INFRA-01: raw artifact", (a, s) => {
  const rp = s.put.bind(s); let f = true;
  s.put = async (i) => { if (f && i.scope?.category === "raw") { f = false; throw new Error("fail"); } return rp(i); };
});

await proveInfra("INFRA-02: normalized artifact", (a, s) => {
  const rp = s.put.bind(s); let f = true;
  s.put = async (i) => { if (f && i.scope?.category === "normalized") { f = false; throw new Error("fail"); } return rp(i); };
});

await proveInfra("INFRA-03: checkpoint manifest", (a, s) => {
  const rp = s.put.bind(s);
  s.put = async (i) => { if (i.scope?.category === "manifests" && i.scope?.artifactName?.startsWith("source-checkpoint")) throw new Error("fail"); return rp(i); };
});

// INFRA-04: canonical artifact — post-adapter delta=0
{
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "g2", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const { auditId, tenantId, clientId } = req;
  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  let totalCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {};
  for (const k of Object.keys(base)) adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { totalCalls++; return base[k].execute(a); } };
  let adapterCountAtFailure = 0;
  const rp = store.put.bind(store);
  store.put = async (i) => { if (i.scope?.category === "canonical") { adapterCountAtFailure = totalCalls; throw new Error("fail"); } return rp(i); };
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
  try { await orch.execute(req); } catch {}
  assertEq(totalCalls - adapterCountAtFailure, 0, "INFRA-04: adapter call-count delta = 0");
}

// INFRA-05: canonical record manifest — post-adapter delta=0
{
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "g3", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const { auditId, tenantId, clientId } = req;
  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  let totalCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {};
  for (const k of Object.keys(base)) adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { totalCalls++; return base[k].execute(a); } };
  let adapterCountAtFailure = 0;
  let cw = false;
  const rp = store.put.bind(store);
  store.put = async (i) => { if (i.scope?.category === "canonical") { cw = true; return rp(i); } if (cw && i.scope?.category === "manifests" && i.scope?.artifactName === "canonical-evidence-record.json") { adapterCountAtFailure = totalCalls; throw new Error("fail"); } return rp(i); };
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
  try { await orch.execute(req); } catch {}
  assertEq(totalCalls - adapterCountAtFailure, 0, "INFRA-05: adapter call-count delta = 0");
}

// ===================================================================
// H. WP5-CLOSE-RESUME — Interrupted collecting recovery
// ===================================================================
console.log("\n─ H. RESUME: Interrupted collecting recovery ─");
{
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "h1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  // Persist PARTIAL onpage + AVAILABLE pagespeed checkpoints
  const partialResult = { contractVersion: "1.0.0", schemaVersion: "1.0.0", source: "dataforseo-onpage", provider: "M", adapterVersion: "1.0.0", status: "PARTIAL", startedAt: mockClock().now(), completedAt: mockClock().now(), retryCount: 2, expectedRecords: 5, returnedRecords: 3, coverage: { requested: 5, completed: 3, failed: 2 }, limitations: ["controlled limitation"], evidence: {} };
  const availResult = makeAvailResult("pagespeed");
  const nr1 = await store.put({ bytes: Buffer.from(JSON.stringify(partialResult)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  const nr2 = await store.put({ bytes: Buffer.from(JSON.stringify(availResult)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "pagespeed.json" }, source: "pagespeed" });

  const onpageEk = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  const psEk = buildSourceExecutionIdentity({ auditRequest: req, source: "pagespeed", adapterVersion: "1.0.0" }).sourceExecutionKey;
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: onpageEk, completedAt: mockClock().now(), normalizedRecord: nr1, rawRecord: null });
  await persistSourceCheckpointManifest({ store, scope, source: "pagespeed", sourceExecutionKey: psEk, completedAt: mockClock().now(), normalizedRecord: nr2, rawRecord: null });

  // Read before bytes
  const beforeBytes = await store.get(nr1.key);
  const beforeSha = sha256(beforeBytes);

  // Track adapter calls
  let onCalls = 0, psCalls = 0, serpCalls = 0, blCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {
    "dataforseo-onpage": { adapterVersion: "1.0.0", execute: async (a) => { onCalls++; return base["dataforseo-onpage"].execute(a); } },
    "pagespeed": { adapterVersion: "1.0.0", execute: async (a) => { psCalls++; return base["pagespeed"].execute(a); } },
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: async (a) => { serpCalls++; return base["dataforseo-serp"].execute(a); } },
    "backlinks": { adapterVersion: "1.0.0", execute: async (a) => { blCalls++; return base["backlinks"].execute(a); } },
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
  const s = await orch.execute(req);
  assertEq(s.finalState, T.EVIDENCE_LOCKED, "RESUME: final state = evidence_locked");

  // RESUME-01: exact adapter calls
  assertEq(onCalls, 0, "RESUME-01: completed onpage calls = 0");
  assertEq(psCalls, 0, "RESUME-01: completed pagespeed calls = 0");
  assertEq(serpCalls, 1, "RESUME-01: incomplete serp calls = 1");
  assertEq(blCalls, 1, "RESUME-01: incomplete backlinks calls = 1");

  // RESUME-02: bytes and SHA unchanged
  const afterBytes = await store.get(nr1.key);
  assertEq(afterBytes.length, beforeBytes.length, "RESUME-02: byte count unchanged");
  assertEq(sha256(afterBytes), beforeSha, "RESUME-02: SHA unchanged");
  assertDeep(afterBytes, beforeBytes, "RESUME-02: bytes identical");

  // RESUME-03: PARTIAL metadata preserved
  const evBuf = await store.get(s.canonicalEvidence.key);
  const ev = JSON.parse(evBuf.toString());
  assertEq(ev.sources.website.status, "PARTIAL", "RESUME-03: status = PARTIAL");
  assertEq(ev.sources.website.retryCount, 2, "RESUME-03: retryCount = 2");
  assertDeep(ev.sources.website.limitations, ["controlled limitation"], "RESUME-03: limitations preserved");
}

// ===================================================================
// I. WP5-CLOSE-STORED — Evidence-stored recovery
// ===================================================================
console.log("\n─ I. STORED: Evidence-stored recovery ─");
{
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "i1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}:v:validated` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}:c:collecting` });

  const ev = { contractVersion: "1.0.0", evidenceVersion: "1.0.0", auditId, normalizedRequest: { targetUrl: "https://example.com" }, sources: { website: { source: "dataforseo-onpage", status: "AVAILABLE", collectedAt: mockClock().now() } }, limitations: [], artifactReferences: [], adapterVersions: {}, createdAt: mockClock().now() };
  const cr = await store.put({ bytes: Buffer.from(JSON.stringify(ev)), contentType: "application/json", scope: { ...scope, category: "canonical", artifactName: "evidence.json" } });
  const mr = await persistCanonicalRecordManifest({ store, scope, createdAt: mockClock().now(), canonicalRecord: cr });
  await lc.transition({ auditId, tenantId, toState: T.EVIDENCE_STORED, transitionIdempotencyKey: `${auditId}:es`, artifactKey: mr.key });

  // Instrument adapter calls
  let totalCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {};
  for (const k of Object.keys(base)) adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { totalCalls++; return base[k].execute(a); } };

  // Instrument artifact writes
  let writeCount = 0;
  const rp = store.put.bind(store);
  store.put = async (i) => { writeCount++; return rp(i); };

  // Read history before
  const beforeHistory = await lc.history(auditId, tenantId);

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
  const s = await orch.execute(req);

  // STORED-01: zero adapter calls
  assertEq(totalCalls, 0, "STORED-01: total adapter calls = 0");

  // STORED-02: zero artifact writes
  assertEq(writeCount, 0, "STORED-02: artifact write count = 0");

  // STORED-03: exactly one lifecycle transition
  const afterHistory = await lc.history(auditId, tenantId);
  assertEq(afterHistory.length - beforeHistory.length, 1, "STORED-03: exactly one new transition");
  assertDeep(
    afterHistory.slice(-1).map(e => [e.priorState, e.nextState]),
    [[T.EVIDENCE_STORED, T.EVIDENCE_LOCKED]],
    "STORED-03: transition = evidence_stored → evidence_locked"
  );
}

// ===================================================================
// J. WP5-CLOSE-REPLAY — Locked replay proof
// ===================================================================
console.log("\n─ J. REPLAY: Locked replay proof ─");
{
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  let adapterCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {};
  for (const k of Object.keys(base)) adapters[k] = { adapterVersion: "1.0.0", execute: async (a) => { adapterCalls++; return base[k].execute(a); } };

  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
  const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "j1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };

  const s1 = await orch.execute(req);
  assertEq(s1.finalState, T.EVIDENCE_LOCKED, "REPLAY: first run = evidence_locked");

  // Instrument writes for replay
  let writesAfterFirstRun = 0;
  const rp = store.put.bind(store);
  store.put = async (i) => { writesAfterFirstRun++; return rp(i); };

  const callsBeforeReplay = adapterCalls;
  const s2 = await orch.execute(req);

  // REPLAY-01: zero adapter calls
  assertEq(adapterCalls - callsBeforeReplay, 0, "REPLAY-01: zero new adapter calls");

  // REPLAY-02: zero artifact writes
  assertEq(writesAfterFirstRun, 0, "REPLAY-02: zero artifact writes");

  // REPLAY-03: canonical identity unchanged + persisted bytes proof
  assertEq(s2.canonicalEvidence.key, s1.canonicalEvidence.key, "REPLAY-03: key unchanged");
  assertEq(s2.canonicalEvidence.sha256, s1.canonicalEvidence.sha256, "REPLAY-03: SHA unchanged");
  assertEq(s2.canonicalEvidence.bytes, s1.canonicalEvidence.bytes, "REPLAY-03: bytes unchanged");

  const persistedBytes = await store.get(s1.canonicalEvidence.key);
  assertEq(persistedBytes.length, s1.canonicalEvidence.bytes, "REPLAY-03: persisted byte count = canonical bytes count");
  assertEq(sha256(persistedBytes), s1.canonicalEvidence.sha256, "REPLAY-03: persisted SHA = canonical SHA");

  const persistedBytes2 = await store.get(s2.canonicalEvidence.key);
  assertEq(persistedBytes2.length, persistedBytes.length, "REPLAY-03: persisted byte count unchanged across replays");
  assertDeep(persistedBytes2, persistedBytes, "REPLAY-03: persisted bytes identical across replays");
}

// ===================================================================
// K. New audit (original acceptance)
// ===================================================================
console.log("\n─ K. New audit (original) ─");
{
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
  const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "k1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const s = await orch.execute(req);
  assertEq(s.finalState, T.EVIDENCE_LOCKED, "New audit: final state = evidence_locked");

  const sc = { tenantId: req.tenantId, clientId: req.clientId, auditId: req.auditId };
  let mc = 0;
  for (const src of ["dataforseo-onpage", "pagespeed", "dataforseo-serp", "backlinks"]) {
    if (await store.exists(buildSourceCheckpointManifestKey(sc, src))) mc++;
  }
  assertEq(mc, 4, "New audit: 4 source manifests");
  assertEq(await store.exists(buildCanonicalRecordManifestKey(sc)), true, "New audit: canonical manifest exists");
}

// ===================================================================
// Summary
// ===================================================================
console.log(`\n${"=".repeat(60)}`);
console.log(`WP5 Acceptance: ${allPassed ? "PASS" : "FAIL"}`);
console.log(`${"=".repeat(60)}`);
if (!allPassed) process.exit(1);

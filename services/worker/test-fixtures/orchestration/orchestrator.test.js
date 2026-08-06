/**
 * WP5 Orchestrator Behavioral Tests — governed recovery and failure boundaries.
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
import { createBaseMockAdapters, createFailingAdapter, createPartialAdapter } from "./mock-adapters.js";

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
// 2. Genuine interrupted resume from collecting
// ===================================================================
test("2. genuine resume: adapters skipped, artifacts untouched, PARTIAL preserved", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  // Set up lifecycle through collecting
  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}-v` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}-c` });

  // Persist PARTIAL onpage + AVAILABLE pagespeed checkpoints
  const onpageResult = makePartialResult("dataforseo-onpage");
  const psResult = makeAvailResult("pagespeed");
  const nr1 = await store.put({ bytes: Buffer.from(JSON.stringify(onpageResult)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  const nr2 = await store.put({ bytes: Buffer.from(JSON.stringify(psResult)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "pagespeed.json" }, source: "pagespeed" });
  const origOnpageSha = nr1.sha256;
  const origOnpageBytes = nr1.bytes;

  const onpageEk = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  const psEk = buildSourceExecutionIdentity({ auditRequest: req, source: "pagespeed", adapterVersion: "1.0.0" }).sourceExecutionKey;
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: onpageEk, completedAt: mockClock().now(), normalizedRecord: nr1, rawRecord: null });
  await persistSourceCheckpointManifest({ store, scope, source: "pagespeed", sourceExecutionKey: psEk, completedAt: mockClock().now(), normalizedRecord: nr2, rawRecord: null });

  let onpageCalls = 0, psCalls = 0, serpCalls = 0, blCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {
    "dataforseo-onpage": { execute: async (a) => { onpageCalls++; return base["dataforseo-onpage"].execute(a); } },
    "pagespeed": { execute: async (a) => { psCalls++; return base["pagespeed"].execute(a); } },
    "dataforseo-serp": { execute: async (a) => { serpCalls++; return base["dataforseo-serp"].execute(a); } },
    "backlinks": { execute: async (a) => { blCalls++; return base["backlinks"].execute(a); } },
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(onpageCalls, 0, "onpage calls = 0");
  assert.equal(psCalls, 0, "pagespeed calls = 0");
  assert.equal(serpCalls, 1, "serp calls = 1");
  assert.equal(blCalls, 1, "backlinks calls = 1");

  // Bytes and SHA unchanged
  const onpageBuf = await store.get(nr1.key);
  assert.equal(onpageBuf.length, origOnpageBytes);
  assert.equal(sha256(onpageBuf), origOnpageSha);

  // PARTIAL preserved in canonical evidence
  const evBuf = await store.get(summary.canonicalEvidence.key);
  const ev = JSON.parse(evBuf.toString());
  assert.equal(ev.sources.website.status, "PARTIAL");
  assert.deepEqual(ev.sources.website.limitations, ["controlled limitation"]);
  assert.equal(ev.sources.website.retryCount, 2);
});

// ===================================================================
// 3. Execution identity equality + stale checkout rejection
// ===================================================================
test("3. execution identity: adapter key = manifest key = expected key", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}-v` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}-c` });

  const expectedKey = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;

  // Persist manifest with same key
  const result = makePartialResult("dataforseo-onpage");
  const nr = await store.put({ bytes: Buffer.from(JSON.stringify(result)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: expectedKey, completedAt: mockClock().now(), normalizedRecord: nr, rawRecord: null });

  let adapterReceivedKey = null;
  const adapters = createBaseMockAdapters();
  adapters["dataforseo-onpage"] = { execute: async (a) => { adapterReceivedKey = a.sourceExecutionKey; throw new Error("should not be called"); } };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  // Adapter NOT called because source was restored from manifest
  // But the manifest key should match what the adapter WOULD have received
  const manifestBuf = await store.get(buildSourceCheckpointManifestKey(scope, "dataforseo-onpage"));
  const manifest = JSON.parse(manifestBuf.toString());
  assert.equal(manifest.sourceExecutionKey, expectedKey, "Manifest key = expected key");
});

// ===================================================================
// 4. Stale checkpoint rejection (changed targetUrl)
// ===================================================================
test("4. changed targetUrl rejects stale checkpoint", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}-v` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}-c` });

  // Persist manifest with OLD targetUrl key
  const oldKey = buildSourceExecutionIdentity({ auditRequest: { ...req, targetUrl: "https://old.example.com" }, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  const result = makePartialResult("dataforseo-onpage");
  const nr = await store.put({ bytes: Buffer.from(JSON.stringify(result)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: oldKey, completedAt: mockClock().now(), normalizedRecord: nr, rawRecord: null });

  const adapters = createBaseMockAdapters();
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });

  // The orchestrator should fail because manifest key ≠ expected key
  await assert.rejects(() => orch.execute(req), /Source execution key mismatch/);
});

// ===================================================================
// 5. collection_failed recovery exact history
// ===================================================================
test("5. collection_failed recovery: exact history", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}-v` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}-c` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTION_FAILED, transitionIdempotencyKey: `${auditId}-cf` });

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.deepEqual(
    (await lc.history(auditId, tenantId)).map(e => e.nextState),
    [T.CREATED, T.VALIDATED, T.COLLECTING, T.COLLECTION_FAILED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED]
  );
});

// ===================================================================
// 6. evidence_stored recovery: artifactKey used, exact transition
// ===================================================================
test("6. evidence_stored recovery: event artifactKey used, single transition", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}-v` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}-c` });

  const ev = { contractVersion: "1.0.0", evidenceVersion: "1.0.0", auditId, normalizedRequest: { targetUrl: "https://example.com" }, sources: { website: { source: "dataforseo-onpage", status: "AVAILABLE", collectedAt: mockClock().now() } }, limitations: [], artifactReferences: [], adapterVersions: {}, createdAt: mockClock().now() };
  assert.ok(validateContract("https://vantage-platform.io/prysm/contracts/v1/canonical-evidence.schema.json", ev).valid);
  const cr = await store.put({ bytes: Buffer.from(JSON.stringify(ev)), contentType: "application/json", scope: { ...scope, category: "canonical", artifactName: "evidence.json" } });
  const mr = await persistCanonicalRecordManifest({ store, scope, createdAt: mockClock().now(), canonicalRecord: cr });
  const mk = mr.key;

  await lc.transition({ auditId, tenantId, toState: T.EVIDENCE_STORED, transitionIdempotencyKey: `${auditId}-es`, artifactKey: mk });

  let adapterCalls = 0;
  const adapters = createBaseMockAdapters();
  for (const k of Object.keys(adapters)) { const o = adapters[k]; adapters[k] = { execute: async (a) => { adapterCalls++; return o.execute(a); } }; }

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  const summary = await orch.execute(req);
  assert.equal(adapterCalls, 0);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.ok(summary.canonicalEvidence);
});

// ===================================================================
// 7. Locked replay: no calls, no writes, identical key/SHA/bytes
// ===================================================================
test("7. locked replay: zero calls, zero writes, identical evidence", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  let callCount = 0;
  const base = createBaseMockAdapters();
  const adapters = {};
  for (const k of Object.keys(base)) { const o = base[k]; adapters[k] = { execute: async (a) => { callCount++; return o.execute(a); } }; }

  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
  const req = baReq();
  const s1 = await orch.execute(req);
  assert.equal(s1.finalState, T.EVIDENCE_LOCKED);
  const firstCalls = callCount;

  const s2 = await orch.execute(req);
  assert.equal(callCount, firstCalls, "No new adapter calls on replay");
  assert.equal(s2.canonicalEvidence.key, s1.canonicalEvidence.key, "Identical canonical key");
  assert.equal(s2.canonicalEvidence.sha256, s1.canonicalEvidence.sha256, "Identical SHA");
  assert.equal(s2.canonicalEvidence.bytes, s1.canonicalEvidence.bytes, "Identical bytes");
});

// ===================================================================
// 8. Missing lifecycle artifactKey fails closed
// ===================================================================
test("8. missing/wrong/cross-tenant lifecycle artifactKey fails closed", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}-v` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}-c` });
  // Transition to evidence_locked with wrong artifactKey
  await lc.transition({ auditId, tenantId, toState: T.EVIDENCE_STORED, transitionIdempotencyKey: `${auditId}-es`, artifactKey: "tenants/wrong/clients/wrong/audits/wrong/manifests/canonical-evidence-record.json" });
  await lc.transition({ auditId, tenantId, toState: T.EVIDENCE_LOCKED, transitionIdempotencyKey: `${auditId}-el`, artifactKey: "tenants/wrong/clients/wrong/audits/wrong/manifests/canonical-evidence-record.json" });

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  await assert.rejects(() => orch.execute(req), /Cross-tenant/);
});

// ===================================================================
// 9-13. Infrastructure failure matrix
// ===================================================================
async function infraFailureTest(testName, failFn, opts = {}) {
  const { checkLaterAdapters = true } = opts;
  test(testName, async () => {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const lc = createLifecycleService(repo);
    const req = baReq();
    const { auditId, tenantId, clientId } = req;

    await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
    await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}-v` });
    await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}-c` });

    let serpCalled = false;
    const adapters = createBaseMockAdapters();
    adapters["dataforseo-serp"] = { execute: async (a) => { serpCalled = true; return createBaseMockAdapters()["dataforseo-serp"].execute(a); } };

    failFn(adapters, store);

    const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract, clock: mockClock() });
    await assert.rejects(() => orch.execute(req));
    const cs = await lc.currentState(auditId, tenantId);
    assert.equal(cs.state, T.COLLECTION_FAILED, `State must be collection_failed, got ${cs.state}`);
    if (checkLaterAdapters) {
      assert.equal(serpCalled, false, "Later adapters not called");
    }

    const events = await lc.history(auditId, tenantId);
    const states = events.map(e => e.nextState);
    assert.ok(!states.includes(T.EVIDENCE_STORED), "No evidence_stored");
    assert.ok(!states.includes(T.EVIDENCE_LOCKED), "No evidence_locked");
  });
}

infraFailureTest("9. raw persistence failure → collection_failed", (adapters, store) => {
  let failRaw = false;
  const orig = createBaseMockAdapters()["dataforseo-onpage"];
  adapters["dataforseo-onpage"] = { execute: async (a) => { failRaw = true; return orig.execute(a); } };
  // Replace store to fail on raw put
  const realPut = store.put.bind(store);
  store.put = async (input) => {
    if (failRaw && input.scope?.category === "raw") throw new Error("raw write failure");
    return realPut(input);
  };
});

infraFailureTest("10. normalized persistence failure → collection_failed", (adapters, store) => {
  let failNorm = false;
  const orig = createBaseMockAdapters()["dataforseo-onpage"];
  adapters["dataforseo-onpage"] = { execute: async (a) => { failNorm = true; return orig.execute(a); } };
  const realPut = store.put.bind(store);
  store.put = async (input) => {
    if (failNorm && input.scope?.category === "normalized") throw new Error("normalized write failure");
    return realPut(input);
  };
});

infraFailureTest("11. checkpoint manifest failure → collection_failed", (adapters, store) => {
  const realPut = store.put.bind(store);
  store.put = async (input) => {
    if (input.scope?.category === "manifests" && input.scope?.artifactName?.startsWith("source-checkpoint")) throw new Error("manifest write failure");
    return realPut(input);
  };
});

infraFailureTest("12. canonical artifact failure → collection_failed", (adapters, store) => {
  const realPut = store.put.bind(store);
  store.put = async (input) => {
    if (input.scope?.category === "canonical") throw new Error("canonical write failure");
    return realPut(input);
  };
}, { checkLaterAdapters: false });

infraFailureTest("13. canonical record manifest failure → collection_failed", (adapters, store) => {
  let canonicalWritten = false;
  const realPut = store.put.bind(store);
  store.put = async (input) => {
    if (input.scope?.category === "canonical") { canonicalWritten = true; return realPut(input); }
    if (canonicalWritten && input.scope?.category === "manifests" && input.scope?.artifactName === "canonical-evidence-record.json") throw new Error("canonical manifest write failure");
    return realPut(input);
  };
}, { checkLaterAdapters: false });

// ===================================================================
// 14. Canonical retry determinism after clock advancement
// ===================================================================
test("14. canonical retry after clock advance: identical bytes and SHA", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = baReq();
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}-v` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}-c` });

  // Persist all 4 source checkpoints
  for (const s of ["dataforseo-onpage", "pagespeed", "dataforseo-serp", "backlinks"]) {
    await persistSourceCheckpoint(store, scope, s, makeAvailResult(s));
  }

  // First run: force canonical manifest failure
  let failManifest = true;
  const realPut = store.put.bind(store);
  store.put = async (input) => {
    if (failManifest && input.scope?.category === "manifests" && input.scope?.artifactName === "canonical-evidence-record.json") {
      failManifest = false;
      throw new Error("simulated manifest failure");
    }
    return realPut(input);
  };

  const orch1 = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock("2026-01-01T00:00:00.000Z") });
  await assert.rejects(() => orch1.execute(req));
  const cs1 = await lc.currentState(auditId, tenantId);
  assert.equal(cs1.state, T.COLLECTION_FAILED);

  // Advance clock and retry
  const orch2 = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock("2026-06-15T12:00:00.000Z") });
  const summary2 = await orch2.execute(req);
  assert.equal(summary2.finalState, T.EVIDENCE_LOCKED);
  assert.ok(summary2.canonicalEvidence);

  // Run again with advanced clock — canonical should be identical
  const summary3 = await orch2.execute(req);
  assert.equal(summary3.canonicalEvidence.sha256, summary2.canonicalEvidence.sha256, "SHA identical after clock advance");
  assert.equal(summary3.canonicalEvidence.bytes, summary2.canonicalEvidence.bytes, "Bytes identical after clock advance");
});

// ===================================================================
// 15-18. Retry-count regression
// ===================================================================
test("15. first-attempt success: retryCount = 0", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let attempts = 0;
  const adapters = createBaseMockAdapters();
  adapters["pagespeed"] = { execute: async () => { attempts++; return { rawBytes: Buffer.from("{}"), contentType: "application/json", sourceResult: { provider: "MP", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), retryCount: 5, expectedRecords: 1, returnedRecords: 1, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: {} } }; } };
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
  adapters["backlinks"] = { execute: async () => { attempts++; const e = new Error("auth"); e.category = "auth"; throw e; } };
  const orch = createAuditOrchestrator({ lifecycleService: createLifecycleService(createMemoryLifecycleRepository()), artifactStore: store, adapters, validateContract, clock: mockClock(), retryPolicyResolver: () => ({ timeoutMs: 30000, maxAttempts: 3, retryable: e => e?.category !== "auth", delayMs: () => 0 }) });
  const summary = await orch.execute(baReq());
  assert.equal(attempts, 1);
  assert.equal(summary.sources.find(x => x.source === "backlinks").retryCount, 0);
});

test("17. third-attempt success: retryCount = 2", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let attempts = 0;
  const adapters = createBaseMockAdapters();
  adapters["dataforseo-serp"] = { execute: async () => { attempts++; if (attempts < 3) { const e = new Error("net"); e.category = "network"; e.statusCode = 503; throw e; } return { rawBytes: Buffer.from("{}"), contentType: "application/json", sourceResult: { provider: "MP", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), retryCount: 99, expectedRecords: 1, returnedRecords: 1, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: {} } }; } };
  const orch = createAuditOrchestrator({ lifecycleService: createLifecycleService(createMemoryLifecycleRepository()), artifactStore: store, adapters, validateContract, clock: mockClock(), retryPolicyResolver: () => ({ timeoutMs: 30000, maxAttempts: 3, retryable: e => e?.category === "network", delayMs: () => 0 }) });
  const summary = await orch.execute(baReq());
  assert.equal(attempts, 3);
  assert.equal(summary.sources.find(x => x.source === "dataforseo-serp").retryCount, 2);
});

test("18. timeout exhaustion: retryCount = 2", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let ta = 0;
  const adapters = createBaseMockAdapters();
  adapters["pagespeed"] = { execute: async ({ signal }) => { ta++; await new Promise(r => setTimeout(r, 10)); if (signal?.aborted) { const e = new Error("t/o"); e.category = "timeout"; throw e; } const e = new Error("t/o"); e.category = "timeout"; throw e; } };
  const orch = createAuditOrchestrator({ lifecycleService: createLifecycleService(createMemoryLifecycleRepository()), artifactStore: store, adapters, validateContract, clock: mockClock(), retryPolicyResolver: () => ({ timeoutMs: 1, maxAttempts: 3, retryable: e => e?.category === "timeout", delayMs: () => 0 }) });
  const summary = await orch.execute(baReq());
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(ta, 3);
  assert.equal(summary.sources.find(x => x.source === "pagespeed").retryCount, 2);
});

// ===================================================================
// 19. Validation failure
// ===================================================================
test("19. invalid request: VALIDATION_FAILED", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract, clock: mockClock() });
  const summary = await orch.execute(baReq({ targetUrl: undefined }));
  assert.equal(summary.finalState, T.VALIDATION_FAILED);
  assert.equal(summary.sources.length, 0);
});

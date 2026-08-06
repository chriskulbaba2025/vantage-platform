#!/usr/bin/env node
/**
 * WP5 Acceptance Harness — governed recovery and failure boundary proof.
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
import { createBaseMockAdapters, createFailingAdapter } from "../test-fixtures/orchestration/mock-adapters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const T = LIFECYCLE_STATE;

let allPassed = true;
function pass(t) { console.log(`  ✓ ${t}`); }
function fail(t) { allPassed = false; console.log(`  ✗ ${t}`); }

function sha256(b) { return createHash("sha256").update(b).digest("hex"); }
function mockClock(iso = "2026-01-01T00:00:00.000Z") { let t = new Date(iso).getTime(); return { now: () => new Date(t).toISOString(), sleep: async () => {}, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 100)) }; }

const schemasDir = resolve(ROOT, "src", "contracts");
const _ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(_ajv);
["audit-request.schema.json", "source-result.schema.json", "canonical-evidence.schema.json"].forEach(f => {
  _ajv.addSchema(JSON.parse(readFileSync(resolve(schemasDir, f), "utf-8")), `https://vantage-platform.io/prysm/contracts/v1/${f}`);
});
function vc(sid, obj) { const v = _ajv.getSchema(sid); return { valid: v(obj), errors: v.errors || [] }; }

// ===================================================================
// A. New audit
// ===================================================================
console.log("\n─ A. New audit ─");
{
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
  const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "a1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const s = await orch.execute(req);
  const events = await lc.history(req.auditId, req.tenantId);
  const states = events.map(e => e.nextState);
  const expected = [T.CREATED, T.VALIDATED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED];
  if (JSON.stringify(states) === JSON.stringify(expected)) pass(`Exact history: ${states.join(" → ")}`);
  else fail(`History: ${states.join(" → ")}`);

  const sc = { tenantId: req.tenantId, clientId: req.clientId, auditId: req.auditId };
  let manifestCount = 0;
  for (const src of ["dataforseo-onpage", "pagespeed", "dataforseo-serp", "backlinks"]) {
    if (await store.exists(buildSourceCheckpointManifestKey(sc, src))) manifestCount++;
  }
  if (manifestCount === 4) pass("4 source checkpoint manifests exist");
  else fail(`${manifestCount}/4 source manifests`);

  if (await store.exists(buildCanonicalRecordManifestKey(sc))) pass("Canonical record manifest exists");
  else fail("Canonical record manifest missing");

  if (s.canonicalEvidence) pass("Canonical evidence in summary");
  else fail("Canonical evidence missing");
}

// ===================================================================
// B. Genuine interrupted resume
// ===================================================================
console.log("\n─ B. Genuine interrupted resume ─");
{
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "b1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const { auditId, tenantId, clientId } = req;
  const scope = { tenantId, clientId, auditId };

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}-v` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}-c` });

  // Persist PARTIAL onpage + AVAILABLE pagespeed
  const partial = { contractVersion: "1.0.0", schemaVersion: "1.0.0", source: "dataforseo-onpage", provider: "M", adapterVersion: "1.0.0", status: "PARTIAL", startedAt: mockClock().now(), completedAt: mockClock().now(), retryCount: 2, expectedRecords: 5, returnedRecords: 3, coverage: { requested: 5, completed: 3, failed: 2 }, limitations: ["controlled limitation"], evidence: {} };
  const avail = { contractVersion: "1.0.0", schemaVersion: "1.0.0", source: "pagespeed", provider: "M", adapterVersion: "1.0.0", status: "AVAILABLE", startedAt: mockClock().now(), completedAt: mockClock().now(), retryCount: 1, expectedRecords: 1, returnedRecords: 1, coverage: { requested: 1, completed: 1, failed: 0 }, limitations: [], evidence: {} };

  const nr1 = await store.put({ bytes: Buffer.from(JSON.stringify(partial)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "dataforseo-onpage.json" }, source: "dataforseo-onpage" });
  const nr2 = await store.put({ bytes: Buffer.from(JSON.stringify(avail)), contentType: "application/json", scope: { ...scope, category: "normalized", artifactName: "pagespeed.json" }, source: "pagespeed" });
  const origOnpageSha = nr1.sha256;

  const onpageEk = buildSourceExecutionIdentity({ auditRequest: req, source: "dataforseo-onpage", adapterVersion: "1.0.0" }).sourceExecutionKey;
  const psEk = buildSourceExecutionIdentity({ auditRequest: req, source: "pagespeed", adapterVersion: "1.0.0" }).sourceExecutionKey;
  await persistSourceCheckpointManifest({ store, scope, source: "dataforseo-onpage", sourceExecutionKey: onpageEk, completedAt: mockClock().now(), normalizedRecord: nr1, rawRecord: null });
  await persistSourceCheckpointManifest({ store, scope, source: "pagespeed", sourceExecutionKey: psEk, completedAt: mockClock().now(), normalizedRecord: nr2, rawRecord: null });

  let onCalls = 0, psCalls = 0, serpCalls = 0, blCalls = 0;
  const base = createBaseMockAdapters();
  const adapters = {
    "dataforseo-onpage": { execute: async (a) => { onCalls++; return base["dataforseo-onpage"].execute(a); } },
    "pagespeed": { execute: async (a) => { psCalls++; return base["pagespeed"].execute(a); } },
    "dataforseo-serp": { execute: async (a) => { serpCalls++; return base["dataforseo-serp"].execute(a); } },
    "backlinks": { execute: async (a) => { blCalls++; return base["backlinks"].execute(a); } },
  };

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
  const s = await orch.execute(req);
  if (s.finalState === T.EVIDENCE_LOCKED) pass("Final state: EVIDENCE_LOCKED");
  else fail(`Final state: ${s.finalState}`);

  if (onCalls === 0 && psCalls === 0) pass("onpage=0, pagespeed=0 calls");
  else fail(`onpage=${onCalls}, pagespeed=${psCalls}`);
  if (serpCalls === 1 && blCalls === 1) pass("serp=1, backlinks=1 calls");
  else fail(`serp=${serpCalls}, backlinks=${blCalls}`);

  const onpageBuf = await store.get(nr1.key);
  if (sha256(onpageBuf) === origOnpageSha) pass("Onpage SHA unchanged");
  else fail("Onpage SHA changed");

  const evBuf = await store.get(s.canonicalEvidence.key);
  const ev = JSON.parse(evBuf.toString());
  if (ev.sources.website.status === "PARTIAL" && ev.sources.website.retryCount === 2) pass("PARTIAL + retryCount=2 preserved");
  else fail(`Status=${ev.sources.website.status}, retryCount=${ev.sources.website.retryCount}`);
}

// ===================================================================
// C. Infrastructure failure matrix
// ===================================================================
console.log("\n─ C. Infrastructure failure matrix ─");
async function proveInfraFailure(label, failSetup) {
  const store = createGovernedArtifactStore({ type: "memory" });
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const req = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "cf", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const { auditId, tenantId, clientId } = req;

  await lc.create({ auditId, tenantId, clientId, idempotencyKey: req.idempotencyKey });
  await lc.transition({ auditId, tenantId, toState: T.VALIDATED, transitionIdempotencyKey: `${auditId}-v` });
  await lc.transition({ auditId, tenantId, toState: T.COLLECTING, transitionIdempotencyKey: `${auditId}-c` });

  const adapters = createBaseMockAdapters();
  failSetup(adapters, store);

  const orch = createAuditOrchestrator({ lifecycleService: lc, artifactStore: store, adapters, validateContract: vc, clock: mockClock() });
  try {
    await orch.execute(req);
    fail(`${label}: should have thrown`);
  } catch {
    const cs = await lc.currentState(auditId, tenantId);
    if (cs.state === T.COLLECTION_FAILED) pass(`${label} → collection_failed`);
    else fail(`${label}: state=${cs.state}, expected collection_failed`);
  }
}

await proveInfraFailure("raw artifact", (a, s) => {
  let failRaw = false;
  const orig = createBaseMockAdapters()["dataforseo-onpage"];
  a["dataforseo-onpage"] = { execute: async (args) => { failRaw = true; return orig.execute(args); } };
  const realPut = s.put.bind(s);
  s.put = async (i) => { if (failRaw && i.scope?.category === "raw") throw new Error("fail"); return realPut(i); };
});
await proveInfraFailure("normalized artifact", (a, s) => {
  let failNorm = false;
  const orig = createBaseMockAdapters()["dataforseo-onpage"];
  a["dataforseo-onpage"] = { execute: async (args) => { failNorm = true; return orig.execute(args); } };
  const realPut = s.put.bind(s);
  s.put = async (i) => { if (failNorm && i.scope?.category === "normalized") throw new Error("fail"); return realPut(i); };
});
await proveInfraFailure("checkpoint manifest", (a, s) => {
  const realPut = s.put.bind(s);
  s.put = async (i) => { if (i.scope?.category === "manifests" && i.scope?.artifactName?.startsWith("source-checkpoint")) throw new Error("fail"); return realPut(i); };
});
await proveInfraFailure("canonical artifact", (a, s) => {
  const realPut = s.put.bind(s);
  s.put = async (i) => { if (i.scope?.category === "canonical") throw new Error("fail"); return realPut(i); };
});
await proveInfraFailure("canonical record manifest", (a, s) => {
  let cw = false;
  const realPut = s.put.bind(s);
  s.put = async (i) => { if (i.scope?.category === "canonical") { cw = true; return realPut(i); } if (cw && i.scope?.category === "manifests") throw new Error("fail"); return realPut(i); };
});

// ===================================================================
// D. Collection-failed recovery + evidence_stored recovery + locked replay
// ===================================================================
console.log("\n─ D. Recovery paths ─");
{
  // collection_failed recovery
  const store1 = createGovernedArtifactStore({ type: "memory" });
  const repo1 = createMemoryLifecycleRepository();
  const lc1 = createLifecycleService(repo1);
  const req1 = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "d1", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const { auditId: a1, tenantId: t1, clientId: c1 } = req1;

  await lc1.create({ auditId: a1, tenantId: t1, clientId: c1, idempotencyKey: req1.idempotencyKey });
  await lc1.transition({ auditId: a1, tenantId: t1, toState: T.VALIDATED, transitionIdempotencyKey: `${a1}-v` });
  await lc1.transition({ auditId: a1, tenantId: t1, toState: T.COLLECTING, transitionIdempotencyKey: `${a1}-c` });
  await lc1.transition({ auditId: a1, tenantId: t1, toState: T.COLLECTION_FAILED, transitionIdempotencyKey: `${a1}-cf` });

  const orch1 = createAuditOrchestrator({ lifecycleService: lc1, artifactStore: store1, adapters: createBaseMockAdapters(), validateContract: vc, clock: mockClock() });
  const s1 = await orch1.execute(req1);
  const h1 = (await lc1.history(a1, t1)).map(e => e.nextState);
  const exp1 = [T.CREATED, T.VALIDATED, T.COLLECTING, T.COLLECTION_FAILED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED];
  if (JSON.stringify(h1) === JSON.stringify(exp1)) pass("collection_failed recovery: exact history");
  else fail(`collection_failed recovery: ${h1.join(" → ")}`);

  // evidence_stored recovery
  const store2 = createGovernedArtifactStore({ type: "memory" });
  const repo2 = createMemoryLifecycleRepository();
  const lc2 = createLifecycleService(repo2);
  const req2 = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "d2", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const { auditId: a2, tenantId: t2, clientId: c2 } = req2;
  const scope2 = { tenantId: t2, clientId: c2, auditId: a2 };

  await lc2.create({ auditId: a2, tenantId: t2, clientId: c2, idempotencyKey: req2.idempotencyKey });
  await lc2.transition({ auditId: a2, tenantId: t2, toState: T.VALIDATED, transitionIdempotencyKey: `${a2}-v` });
  await lc2.transition({ auditId: a2, tenantId: t2, toState: T.COLLECTING, transitionIdempotencyKey: `${a2}-c` });

  const ev = { contractVersion: "1.0.0", evidenceVersion: "1.0.0", auditId: a2, normalizedRequest: { targetUrl: "https://example.com" }, sources: { website: { source: "dataforseo-onpage", status: "AVAILABLE", collectedAt: mockClock().now() } }, limitations: [], artifactReferences: [], adapterVersions: {}, createdAt: mockClock().now() };
  const cr = await store2.put({ bytes: Buffer.from(JSON.stringify(ev)), contentType: "application/json", scope: { ...scope2, category: "canonical", artifactName: "evidence.json" } });
  const mr = await persistCanonicalRecordManifest({ store: store2, scope: scope2, createdAt: mockClock().now(), canonicalRecord: cr });

  await lc2.transition({ auditId: a2, tenantId: t2, toState: T.EVIDENCE_STORED, transitionIdempotencyKey: `${a2}-es`, artifactKey: mr.key });

  let esCalls = 0;
  const esAdapters = createBaseMockAdapters();
  for (const k of Object.keys(esAdapters)) { const o = esAdapters[k]; esAdapters[k] = { execute: async (a) => { esCalls++; return o.execute(a); } }; }

  const orch2 = createAuditOrchestrator({ lifecycleService: lc2, artifactStore: store2, adapters: esAdapters, validateContract: vc, clock: mockClock() });
  const s2 = await orch2.execute(req2);
  if (esCalls === 0) pass("evidence_stored: 0 adapter calls");
  else fail(`evidence_stored: ${esCalls} calls`);
  if (s2.finalState === T.EVIDENCE_LOCKED) pass("evidence_stored → evidence_locked");
  else fail(`evidence_stored: ${s2.finalState}`);

  // Locked replay
  const store3 = createGovernedArtifactStore({ type: "memory" });
  const repo3 = createMemoryLifecycleRepository();
  let lrCalls = 0;
  const lrAdapters = createBaseMockAdapters();
  for (const k of Object.keys(lrAdapters)) { const o = lrAdapters[k]; lrAdapters[k] = { execute: async (a) => { lrCalls++; return o.execute(a); } }; }

  const orch3 = createAuditOrchestrator({ lifecycleService: createLifecycleService(repo3), artifactStore: store3, adapters: lrAdapters, validateContract: vc, clock: mockClock() });
  const req3 = { contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "d3", clientId: "c1", idempotencyKey: randomUUID(), targetUrl: "https://example.com" };
  const s3a = await orch3.execute(req3);
  const firstCalls = lrCalls;
  const s3b = await orch3.execute(req3);
  if (lrCalls === firstCalls) pass("Locked replay: 0 new adapter calls");
  else fail(`Locked replay: ${lrCalls - firstCalls} new calls`);
  if (s3b.canonicalEvidence.sha256 === s3a.canonicalEvidence.sha256) pass("Locked replay: SHA identical");
  else fail("Locked replay: SHA changed");
  if (s3b.canonicalEvidence.key === s3a.canonicalEvidence.key) pass("Locked replay: key unchanged");
  else fail("Locked replay: key changed");
}

// ===================================================================
// Summary
// ===================================================================
console.log(`\n${"=".repeat(60)}`);
console.log(`WP5 Acceptance: ${allPassed ? "PASS" : "FAIL"}`);
console.log(`${"=".repeat(60)}`);
if (!allPassed) process.exit(1);

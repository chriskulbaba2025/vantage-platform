/**
 * WP4 Memory Lifecycle — Contract + Concurrency Tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runLifecycleContractTests } from "./contract-tests.js";
import { createMemoryLifecycleRepository } from "../../src/lifecycle/memory-repository.js";
import { createLifecycleService } from "../../src/lifecycle/lifecycle-service.js";
import { ConcurrencyConflictError, DuplicateAuditError } from "../../src/lifecycle/lifecycle-errors.js";

runLifecycleContractTests("memory", () => createMemoryLifecycleRepository());

// Concurrent transitions
test("memory: concurrent transitions — 1 success, 1 ConcurrencyConflictError, 2 events", async () => {
  const repo = createMemoryLifecycleRepository();
  const svc = createLifecycleService(repo);
  const auditId = randomUUID(); const tenantId = "race";
  await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: randomUUID() });
  const t1 = svc.transition({ auditId, tenantId, toState: "validated", expectedState: "created", expectedVersion: 1, transitionIdempotencyKey: randomUUID() });
  const t2 = svc.transition({ auditId, tenantId, toState: "validated", expectedState: "created", expectedVersion: 1, transitionIdempotencyKey: randomUUID() });
  const results = await Promise.allSettled([t1, t2]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1,
    "Exactly 1 transition must succeed");
  assert.equal(results.filter(r => r.status === "rejected").length, 1,
    "Exactly 1 transition must be rejected");
  const failure = results.find(r => r.status === "rejected");
  assert.ok(failure.reason instanceof ConcurrencyConflictError,
    `Expected ConcurrencyConflictError, got ${failure.reason?.constructor?.name}`);
  const events = await svc.history(auditId, tenantId);
  assert.equal(events.length, 2, "Exactly 2 events after concurrent transition");
  assert.equal(events[0].sequence, 0, "Event 0 sequence = 0");
  assert.equal(events[1].sequence, 1, "Event 1 sequence = 1");
});

// ── Deterministic stale-request (serialized, not timing-dependent) ──
test("memory: deterministic stale expectedState/expectedVersion → ConcurrencyConflictError", async () => {
  const repo = createMemoryLifecycleRepository();
  const svc = createLifecycleService(repo);
  const auditId = randomUUID(); const tenantId = "stale";
  await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: randomUUID() });

  // Advance to validated (version 2, state "validated")
  await svc.transition({ auditId, tenantId, toState: "validated", transitionIdempotencyKey: randomUUID() });

  // Now submit a stale request that expects the old state
  await assert.rejects(
    () => svc.transition({
      auditId, tenantId, toState: "validated",
      expectedState: "created",
      expectedVersion: 1,
      transitionIdempotencyKey: randomUUID(),
    }),
    (err) => err instanceof ConcurrencyConflictError,
    "Stale expectedState/expectedVersion must throw ConcurrencyConflictError",
  );

  // Verify no side effects
  const cs = await svc.currentState(auditId, tenantId);
  assert.equal(cs.state, "validated", "State must remain validated");
  const events = await svc.history(auditId, tenantId);
  assert.equal(events.length, 2, "No additional event appended");
});

// Concurrent creation — identical
test("memory: concurrent identical creation — both succeed, exactly 1 event", async () => {
  const repo = createMemoryLifecycleRepository();
  const svc = createLifecycleService(repo);
  const params = { auditId: randomUUID(), tenantId: "t1", clientId: "c1", idempotencyKey: randomUUID() };
  const [r1, r2] = await Promise.all([svc.create(params), svc.create(params)]);
  assert.equal(r1.version, r2.version);
  assert.equal((await svc.history(params.auditId, "t1")).length, 1);
});

// Concurrent creation — same tenant+key+auditId, different clientId
test("memory: concurrent creation — different clientId throws DuplicateAuditError", async () => {
  const repo = createMemoryLifecycleRepository();
  const svc = createLifecycleService(repo);
  const auditId = randomUUID();
  const idemKey = randomUUID();
  await svc.create({ auditId, tenantId: "t1", clientId: "correct-client", idempotencyKey: idemKey });

  await assert.rejects(
    () => svc.create({ auditId, tenantId: "t1", clientId: "wrong-client", idempotencyKey: idemKey }),
    (err) => err instanceof DuplicateAuditError,
  );
  const events = await svc.history(auditId, "t1");
  assert.equal(events.length, 1);
  assert.equal(events[0].clientId, "correct-client");
});

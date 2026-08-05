/**
 * WP4 Memory Lifecycle — Contract + Concurrency Tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runLifecycleContractTests } from "./contract-tests.js";
import { createMemoryLifecycleRepository } from "../../src/lifecycle/memory-repository.js";
import { createLifecycleService } from "../../src/lifecycle/lifecycle-service.js";
import { ConcurrencyConflictError } from "../../src/lifecycle/lifecycle-errors.js";

runLifecycleContractTests("memory", () => createMemoryLifecycleRepository());

// ── Concurrent transitions: exactly 1 succeeds ──────────────────────
test("memory: concurrent transitions — exactly 1 success, 1 ConcurrencyConflictError, 1 event", async () => {
  const repo = createMemoryLifecycleRepository();
  const svc = createLifecycleService(repo);
  const auditId = randomUUID();
  const tenantId = "race";

  await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: randomUUID() });

  const t1 = svc.transition({
    auditId, tenantId, toState: "validated",
    expectedState: "created", expectedVersion: 1,
    transitionIdempotencyKey: randomUUID(),
  });
  const t2 = svc.transition({
    auditId, tenantId, toState: "validated",
    expectedState: "created", expectedVersion: 1,
    transitionIdempotencyKey: randomUUID(),
  });

  const results = await Promise.allSettled([t1, t2]);
  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  assert.equal(succeeded, 1, "Exactly 1 must succeed");
  assert.equal(failed, 1, "Exactly 1 must fail");
  const failure = results.find((r) => r.status === "rejected");
  assert.ok(failure.reason instanceof ConcurrencyConflictError,
    `Expected ConcurrencyConflictError, got ${failure.reason?.constructor?.name}`);

  const events = await svc.history(auditId, tenantId);
  assert.equal(events.length, 2, "Exactly 2 events (create + 1 transition)");
});

// ── Concurrent creation: both succeed idempotently ───────────────────
test("memory: concurrent creation — both succeed, exactly 1 event", async () => {
  const repo = createMemoryLifecycleRepository();
  const svc = createLifecycleService(repo);
  const auditId = randomUUID();
  const params = { auditId, tenantId: "t1", clientId: "c1", idempotencyKey: randomUUID() };

  const [r1, r2] = await Promise.all([
    svc.create(params),
    svc.create(params),
  ]);

  assert.equal(r1.version, r2.version);
  assert.equal(r1.auditId, r2.auditId);
  const events = await svc.history(auditId, "t1");
  assert.equal(events.length, 1, "Exactly 1 event");
});

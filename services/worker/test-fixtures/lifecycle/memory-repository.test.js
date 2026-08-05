/**
 * WP4 Memory Lifecycle Repository — Contract Tests + Concurrency Race Test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runLifecycleContractTests } from "./contract-tests.js";
import { createMemoryLifecycleRepository } from "../../src/lifecycle/memory-repository.js";
import { createLifecycleService } from "../../src/lifecycle/lifecycle-service.js";
import { ConcurrencyConflictError } from "../../src/lifecycle/lifecycle-errors.js";

runLifecycleContractTests("memory", () => createMemoryLifecycleRepository());

// ── Concurrency race: two transitions from same expected state ─────────
test("memory: concurrent transitions — exactly one succeeds, one fails", async () => {
  const repo = createMemoryLifecycleRepository();
  const svc = createLifecycleService(repo);
  const auditId = randomUUID();
  const tenantId = "race-tenant";

  await svc.create({
    auditId, tenantId, clientId: "c1",
    idempotencyKey: randomUUID(),
  });

  // Try two transitions from the same expected state/version concurrently
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

  assert.equal(succeeded, 1, "Exactly one transition should succeed");
  assert.equal(failed, 1, "Exactly one transition should fail");

  // The failed one must be ConcurrencyConflictError
  const failure = results.find((r) => r.status === "rejected");
  assert.ok(
    failure.reason instanceof ConcurrencyConflictError,
    `Expected ConcurrencyConflictError, got ${failure.reason?.constructor?.name}`,
  );

  // Only one event should have been appended
  const events = await svc.history(auditId, tenantId);
  assert.equal(events.length, 2, "Should have exactly 2 events (create + 1 transition)");
});

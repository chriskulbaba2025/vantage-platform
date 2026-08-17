/**
 * PRYSM-OBSERVABILITY-01 — Lifecycle failure-reason persistence contract.
 *
 * Proves the full status-mapping chain for persisted transition reasons:
 *   lifecycleService.transition(reason) → repository event → history →
 *   AuditApplicationService.getAuditStatus → status.lifecycle[].reason.
 *
 * Also proves:
 *   - empty/legacy reasons remain valid and map to null (historical rows
 *     are never retrofitted),
 *   - transition idempotency and optimistic concurrency are unchanged when
 *     a reason is supplied (the reason participates in the fingerprint the
 *     same way it always has — no behavioral drift).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { createLifecycleService } from "../lifecycle/lifecycle-service.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createAuditApplicationService } from "./audit-service.js";
import { LIFECYCLE_STATE } from "../lifecycle/state-enum.js";
import { ConcurrencyConflictError } from "../lifecycle/lifecycle-errors.js";

const T = LIFECYCLE_STATE;

// Valid governed chain from CREATED (mirrors the production orchestrator's
// sequential transitions; direct jumps are rejected by the lifecycle contract).
const CHAIN = [
  T.VALIDATED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED,
  T.SCORED, T.NARRATIVE_PENDING, T.NARRATIVE_READY,
];

function buildHarness() {
  const lifecycleRepo = createMemoryLifecycleRepository();
  const lifecycleService = createLifecycleService(lifecycleRepo);
  const artifactStore = createMemoryArtifactStore();
  const service = createAuditApplicationService({
    orchestrator: { execute: async () => ({ finalState: "created" }) },
    lifecycleRepo,
    lifecycleService,
    artifactStore,
    reportStore: null,
    config: { artifactDir: "memory" },
    validateContract: () => ({ valid: true, errors: [] }),
  });
  return { lifecycleRepo, lifecycleService, service };
}

async function walkChain(lifecycleService, { auditId, tenantId, upTo, withReasons }) {
  const states = CHAIN.slice(0, CHAIN.indexOf(upTo) + 1);
  for (const toState of states) {
    const note = `${toState}-walk`;
    await lifecycleService.transition({
      auditId,
      tenantId,
      toState,
      transitionIdempotencyKey: `${auditId}:exec-walk:${note}`,
      ...(withReasons ? { reason: note } : {}),
    });
  }
}

test("PRYSM-OBSERVABILITY-01a: transition reason persists through history into status mapping", async () => {
  const { lifecycleService, service } = buildHarness();
  const auditId = randomUUID();
  const tenantId = "t1";
  const clientId = "c1";

  await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey: randomUUID() });
  await walkChain(lifecycleService, { auditId, tenantId, upTo: T.NARRATIVE_READY, withReasons: true });
  await lifecycleService.transition({
    auditId,
    tenantId,
    toState: T.RENDER_FAILED,
    transitionIdempotencyKey: `${auditId}:exec-1:render-finalization-gate-failed:Evidence confidence is 86 (High) but assessed weight is only 30%`,
    reason: "render-finalization-gate-failed:Evidence confidence is 86 (High) but assessed weight is only 30%",
  });

  const history = await lifecycleService.history(auditId, tenantId);
  const failed = history.find((e) => e.nextState === T.RENDER_FAILED);
  assert.ok(failed, "render_failed event must exist");
  assert.equal(
    failed.reason,
    "render-finalization-gate-failed:Evidence confidence is 86 (High) but assessed weight is only 30%",
    "history must return the exact persisted reason",
  );

  const status = await service.getAuditStatus(auditId, tenantId);
  assert.ok(status, "status must resolve");
  const mapped = (status.lifecycle || []).find((e) => e.to === T.RENDER_FAILED);
  assert.ok(mapped, "status lifecycle must include the render_failed event");
  assert.equal(
    mapped.reason,
    "render-finalization-gate-failed:Evidence confidence is 86 (High) but assessed weight is only 30%",
    "status mapping must return the exact persisted reason for the audit-detail page",
  );
});

test("PRYSM-OBSERVABILITY-01b: empty/legacy reasons remain valid and map to null", async () => {
  const { lifecycleService, service } = buildHarness();
  const auditId = randomUUID();
  const tenantId = "t1";
  const clientId = "c1";

  await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey: randomUUID() });
  await walkChain(lifecycleService, { auditId, tenantId, upTo: T.NARRATIVE_READY, withReasons: false });
  // Legacy-style transition: no reason supplied (historical production rows).
  await lifecycleService.transition({
    auditId,
    tenantId,
    toState: T.RENDER_FAILED,
    transitionIdempotencyKey: `${auditId}:exec-legacy:render`,
  });

  const history = await lifecycleService.history(auditId, tenantId);
  const failed = history.find((e) => e.nextState === T.RENDER_FAILED);
  assert.ok(failed, "render_failed event must exist");
  assert.equal(failed.reason || null, null, "legacy empty reason must map to null, never fabricated");

  const status = await service.getAuditStatus(auditId, tenantId);
  const mapped = (status.lifecycle || []).find((e) => e.to === T.RENDER_FAILED);
  assert.equal(mapped.reason, null, "status mapping must return null for legacy empty reasons");
});

test("PRYSM-OBSERVABILITY-01c: idempotency and optimistic concurrency unchanged when a reason is supplied", async () => {
  const { lifecycleService } = buildHarness();
  const auditId = randomUUID();
  const tenantId = "t1";
  const clientId = "c1";

  await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey: randomUUID() });
  await walkChain(lifecycleService, { auditId, tenantId, upTo: T.EVIDENCE_LOCKED, withReasons: true });
  const args = {
    auditId,
    tenantId,
    toState: T.SCORED,
    transitionIdempotencyKey: `${auditId}:exec-1:governed-scoring-complete`,
    reason: "governed-scoring-complete",
  };

  // Same transition (identical args incl. reason) twice → single event.
  await lifecycleService.transition(args);
  const first = await lifecycleService.history(auditId, tenantId);
  await lifecycleService.transition(args);
  const second = await lifecycleService.history(auditId, tenantId);
  assert.equal(second.length, first.length, "duplicate transition with identical reason must be idempotent");
  assert.equal(second[second.length - 1].reason, "governed-scoring-complete", "replayed transition keeps its reason");

  // Stale expectedVersion must still raise the concurrency conflict.
  await assert.rejects(
    () => lifecycleService.transition({ ...args, toState: T.SCORED, expectedVersion: 999, transitionIdempotencyKey: `${auditId}:exec-1:stale-concurrency`, reason: "governed-scoring-complete" }),
    ConcurrencyConflictError,
    "optimistic concurrency guard must be unchanged",
  );
});

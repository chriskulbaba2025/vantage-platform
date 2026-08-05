/**
 * WP4 Lifecycle — Shared Repository Contract Test Suite
 *
 * The same behavioural suite runs against memory and PostgreSQL (pg-mem)
 * lifecycle repositories.
 *
 * Zero live database calls. Zero provider calls. Deterministic.
 *
 * @module lifecycle-contract-tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLifecycleService } from "../../src/lifecycle/lifecycle-service.js";
import { LIFECYCLE_STATE } from "../../src/lifecycle/state-enum.js";
import {
  AuditNotFoundError,
  DuplicateAuditError,
  InvalidTransitionError,
  ConcurrencyConflictError,
} from "../../src/lifecycle/lifecycle-errors.js";

const T = LIFECYCLE_STATE;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAudit(overrides = {}) {
  return {
    auditId: randomUUID(),
    tenantId: "test-tenant",
    clientId: "test-client",
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite runner
// ---------------------------------------------------------------------------

/**
 * Run the complete WP4 contract suite against a repository.
 *
 * @param {string} label              - Human-readable label.
 * @param {() => object} repoFactory  - Synchronous factory returning a repository.
 */
export function runLifecycleContractTests(label, repoFactory) {
  // ── Creation ──────────────────────────────────────────────────────────
  test(`${label}: creates audit with idempotency`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    const state = await service.create(audit);
    assert.equal(state.state, T.CREATED);
    assert.equal(state.auditId, audit.auditId);
    assert.equal(state.version, 1);
    assert.ok(typeof state.lastTransitionedAt === "string");
  });

  test(`${label}: creation is idempotent with same idempotency key`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    const s1 = await service.create(audit);
    const s2 = await service.create(audit);

    assert.equal(s1.state, s2.state);
    assert.equal(s1.version, s2.version);
    // Only one event should exist
    const events = await service.history(audit.auditId);
    assert.equal(events.length, 1);
  });

  test(`${label}: duplicate creation with different idempotency key fails`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    await service.create(audit);

    await assert.rejects(
      () => service.create({ ...audit, idempotencyKey: "different-key" }),
      (err) => err instanceof DuplicateAuditError,
    );
  });

  // ── Normal-path transitions ───────────────────────────────────────────
  test(`${label}: every valid normal-path transition succeeds`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    await service.create(audit);

    const path = [
      T.VALIDATED,
      T.COLLECTING,
      T.EVIDENCE_STORED,
      T.EVIDENCE_LOCKED,
      T.SCORED,
      T.NARRATIVE_PENDING,
      T.NARRATIVE_READY,
      T.DRAFT_RENDERED,
      T.IN_REVIEW,
      T.APPROVED,
      T.PUBLISHED,
    ];

    for (const state of path) {
      const result = await service.transition({
        auditId: audit.auditId,
        toState: state,
        actor: "system",
        reason: `Transition to ${state}`,
      });
      assert.equal(result.state, state);
    }
  });

  test(`${label}: normal-to-failure transitions succeed`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);

    // Get to collecting
    const a1 = makeAudit();
    await service.create(a1);
    await service.transition({ auditId: a1.auditId, toState: T.VALIDATED });
    await service.transition({ auditId: a1.auditId, toState: T.COLLECTING });

    // Fail collection
    const failed = await service.transition({
      auditId: a1.auditId,
      toState: T.COLLECTION_FAILED,
      actor: "system",
      reason: "Provider timeout",
    });
    assert.equal(failed.state, T.COLLECTION_FAILED);
  });

  test(`${label}: recovery transitions succeed`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);

    const a1 = makeAudit();
    await service.create(a1);
    await service.transition({ auditId: a1.auditId, toState: T.VALIDATED });
    await service.transition({ auditId: a1.auditId, toState: T.COLLECTING });
    await service.transition({
      auditId: a1.auditId, toState: T.COLLECTION_FAILED,
      actor: "system", reason: "Provider failure",
    });

    // Recover back to COLLECTING
    const recovered = await service.transition({
      auditId: a1.auditId, toState: T.COLLECTING,
      actor: "system", reason: "Retrying",
    });
    assert.equal(recovered.state, T.COLLECTING);
  });

  // ── Invalid transitions ───────────────────────────────────────────────
  test(`${label}: invalid transition throws InvalidTransitionError`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    await service.create(audit);
    // Can't jump from CREATED to PUBLISHED
    await assert.rejects(
      () => service.transition({ auditId: audit.auditId, toState: T.PUBLISHED }),
      (err) => err instanceof InvalidTransitionError,
    );
  });

  test(`${label}: transition on nonexistent audit throws AuditNotFoundError`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);

    await assert.rejects(
      () => service.transition({
        auditId: randomUUID(),
        toState: T.VALIDATED,
      }),
      (err) => err instanceof AuditNotFoundError,
    );
  });

  // ── Optimistic concurrency ────────────────────────────────────────────
  test(`${label}: wrong expectedState throws ConcurrencyConflictError`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    await service.create(audit);

    await assert.rejects(
      () => service.transition({
        auditId: audit.auditId,
        toState: T.COLLECTING, // valid transition from VALIDATED, not CREATED
        expectedState: T.VALIDATED, // but we claim we're at VALIDATED
      }),
      (err) => err instanceof ConcurrencyConflictError,
    );
  });

  test(`${label}: wrong expectedVersion throws ConcurrencyConflictError`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    await service.create(audit);

    await assert.rejects(
      () => service.transition({
        auditId: audit.auditId,
        toState: T.VALIDATED,
        expectedVersion: 5, // version is actually 1
      }),
      (err) => err instanceof ConcurrencyConflictError,
    );
  });

  test(`${label}: correct expectedState and expectedVersion succeeds`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    await service.create(audit);

    const result = await service.transition({
      auditId: audit.auditId,
      toState: T.VALIDATED,
      expectedState: T.CREATED,
      expectedVersion: 1,
    });
    assert.equal(result.state, T.VALIDATED);
    assert.equal(result.version, 2);
  });

  // ── History and projection ────────────────────────────────────────────
  test(`${label}: currentState returns correct projection`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    assert.equal(await service.currentState(audit.auditId), null);

    await service.create(audit);
    const cs = await service.currentState(audit.auditId);
    assert.equal(cs.state, T.CREATED);
    assert.equal(cs.version, 1);
    assert.ok(typeof cs.lastTransitionedAt === "string");
  });

  test(`${label}: history returns events in sequence order`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    await service.create(audit);
    await service.transition({ auditId: audit.auditId, toState: T.VALIDATED });
    await service.transition({ auditId: audit.auditId, toState: T.COLLECTING });

    const events = await service.history(audit.auditId);
    assert.equal(events.length, 3);
    assert.equal(events[0].sequence, 0);
    assert.equal(events[1].sequence, 1);
    assert.equal(events[2].sequence, 2);
    assert.equal(events[0].nextState, T.CREATED);
    assert.equal(events[1].nextState, T.VALIDATED);
    assert.equal(events[2].nextState, T.COLLECTING);
  });

  test(`${label}: currentState for nonexistent audit returns null`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    assert.equal(await service.currentState(randomUUID()), null);
  });

  // ── Event immutability ────────────────────────────────────────────────
  test(`${label}: events are frozen (immutable)`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    await service.create(audit);
    const events = await service.history(audit.auditId);
    const event = events[0];

    assert.ok(Object.isFrozen(event));
    assert.throws(() => { event.nextState = "hacked"; }, TypeError);
  });

  // ── Tenant isolation ──────────────────────────────────────────────────
  test(`${label}: tenant isolation is enforced via auditId`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);

    const a1 = makeAudit({ tenantId: "tenant-a" });
    const a2 = makeAudit({ tenantId: "tenant-b" });

    await service.create(a1);
    await service.create(a2);

    const events1 = await service.history(a1.auditId);
    const events2 = await service.history(a2.auditId);

    assert.equal(events1.length, 1);
    assert.equal(events2.length, 1);
    assert.notEqual(events1[0].auditId, events2[0].auditId);
    assert.equal(events1[0].tenantId, "tenant-a");
    assert.equal(events2[0].tenantId, "tenant-b");
  });

  test(`${label}: event sequence is contiguous`, async () => {
    const repo = repoFactory();
    const service = createLifecycleService(repo);
    const audit = makeAudit();

    await service.create(audit);
    for (const state of [T.VALIDATED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED]) {
      await service.transition({ auditId: audit.auditId, toState: state });
    }

    const events = await service.history(audit.auditId);
    for (let i = 0; i < events.length; i++) {
      assert.equal(events[i].sequence, i, `Event at index ${i} has sequence ${events[i].sequence}`);
    }
  });
}

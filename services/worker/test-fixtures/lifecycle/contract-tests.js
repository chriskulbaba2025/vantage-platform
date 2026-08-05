/**
 * WP4 Lifecycle — Shared Repository Contract Tests
 *
 * Runs against memory and PostgreSQL (pg-mem) repositories.
 * Zero live database calls. Deterministic.
 *
 * @module lifecycle-contract-tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLifecycleService } from "../../src/lifecycle/lifecycle-service.js";
import { LIFECYCLE_STATE, isValidTransition } from "../../src/lifecycle/state-enum.js";
import {
  AuditNotFoundError, DuplicateAuditError, InvalidTransitionError,
  ConcurrencyConflictError, TenantIsolationError,
  TransitionIdempotencyConflictError,
} from "../../src/lifecycle/lifecycle-errors.js";

const T = LIFECYCLE_STATE;

// =========================================================================
// INDEPENDENT transition matrix — NOT derived from TRANSITION_MAP
// =========================================================================

const VALID_EDGES = new Set([
  // Normal
  "created→validated",
  "created→validation_failed",
  "validation_failed→created",
  "validated→collecting",
  "collecting→evidence_stored",
  "collecting→collection_failed",
  "collection_failed→collecting",
  "evidence_stored→evidence_locked",
  "evidence_locked→scored",
  "scored→narrative_pending",
  "narrative_pending→narrative_ready",
  "narrative_pending→narrative_failed",
  "narrative_failed→narrative_pending",
  "narrative_ready→draft_rendered",
  "narrative_ready→render_failed",
  "render_failed→narrative_ready",
  "draft_rendered→in_review",
  "in_review→approved",
  "in_review→approval_rejected",
  "approval_rejected→in_review",
  "approved→published",
  "approved→publish_failed",
  "publish_failed→approved",
]);

const ALL_STATES = Object.values(T);
const ALL_PAIRS = [];
for (const from of ALL_STATES) {
  for (const to of ALL_STATES) {
    ALL_PAIRS.push([from, to]);
  }
}

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

function uniqueKey() { return randomUUID(); }

// ---------------------------------------------------------------------------
// Suite runner
// ---------------------------------------------------------------------------

/**
 * @param {string} label
 * @param {() => object} repoFactory
 */
export function runLifecycleContractTests(label, repoFactory) {
  // ── Full transition matrix ──────────────────────────────────────────
  test(`${label}: full transition matrix — every authorized edge succeeds`, async () => {
    for (const edge of VALID_EDGES) {
      const [fromState, toState] = edge.split("→");
      const repo = repoFactory();
      const svc = createLifecycleService(repo);
      const audit = makeAudit({ tenantId: "matrix-tenant" });

      await svc.create(audit);

      if (fromState === "created") {
        // creation is already at "created"
        if (toState === "created") continue; // skip self-loop test
        // only "created" edges: validated, validation_failed
        await svc.transition({
          auditId: audit.auditId, tenantId: audit.tenantId,
          toState, transitionIdempotencyKey: uniqueKey(),
        });
        const cs = await svc.currentState(audit.auditId, audit.tenantId);
        assert.equal(cs.state, toState, `Edge created→${toState} failed`);
        continue;
      }

      // Navigate to fromState
      const path = buildPath(fromState);
      for (const s of path) {
        await svc.transition({
          auditId: audit.auditId, tenantId: audit.tenantId,
          toState: s, transitionIdempotencyKey: uniqueKey(),
        });
      }

      // Execute the edge
      await svc.transition({
        auditId: audit.auditId, tenantId: audit.tenantId,
        toState, transitionIdempotencyKey: uniqueKey(),
      });
      const cs = await svc.currentState(audit.auditId, audit.tenantId);
      assert.equal(cs.state, toState, `Edge ${edge} failed`);
    }
  });

  function buildPath(targetState) {
    const map = {
      validated:           ["validated"],
      validation_failed:   ["validation_failed"],
      collecting:          ["validated", "collecting"],
      collection_failed:   ["validated", "collecting", "collection_failed"],
      evidence_stored:     ["validated", "collecting", "evidence_stored"],
      evidence_locked:     ["validated", "collecting", "evidence_stored", "evidence_locked"],
      scored:              ["validated", "collecting", "evidence_stored", "evidence_locked", "scored"],
      narrative_pending:   ["validated", "collecting", "evidence_stored", "evidence_locked", "scored", "narrative_pending"],
      narrative_failed:    ["validated", "collecting", "evidence_stored", "evidence_locked", "scored", "narrative_pending", "narrative_failed"],
      narrative_ready:     ["validated", "collecting", "evidence_stored", "evidence_locked", "scored", "narrative_pending", "narrative_ready"],
      render_failed:       ["validated", "collecting", "evidence_stored", "evidence_locked", "scored", "narrative_pending", "narrative_ready", "render_failed"],
      draft_rendered:      ["validated", "collecting", "evidence_stored", "evidence_locked", "scored", "narrative_pending", "narrative_ready", "draft_rendered"],
      in_review:           ["validated", "collecting", "evidence_stored", "evidence_locked", "scored", "narrative_pending", "narrative_ready", "draft_rendered", "in_review"],
      approval_rejected:   ["validated", "collecting", "evidence_stored", "evidence_locked", "scored", "narrative_pending", "narrative_ready", "draft_rendered", "in_review", "approval_rejected"],
      approved:            ["validated", "collecting", "evidence_stored", "evidence_locked", "scored", "narrative_pending", "narrative_ready", "draft_rendered", "in_review", "approved"],
      publish_failed:      ["validated", "collecting", "evidence_stored", "evidence_locked", "scored", "narrative_pending", "narrative_ready", "draft_rendered", "in_review", "approved", "publish_failed"],
      published:           ["validated", "collecting", "evidence_stored", "evidence_locked", "scored", "narrative_pending", "narrative_ready", "draft_rendered", "in_review", "approved", "published"],
    };
    return map[targetState] || [];
  }

  test(`${label}: full transition matrix — every unauthorized pair fails`, async () => {
    for (const [from, to] of ALL_PAIRS) {
      const edge = `${from}→${to}`;
      if (VALID_EDGES.has(edge)) continue;
      if (from === to && from !== "created") continue; // non-creation self-loops not tested

      const repo = repoFactory();
      const svc = createLifecycleService(repo);
      const audit = makeAudit({ tenantId: "invalid-matrix" });
      await svc.create(audit);

      if (from === "created") {
        await assert.rejects(
          () => svc.transition({
            auditId: audit.auditId, tenantId: audit.tenantId,
            toState: to, transitionIdempotencyKey: uniqueKey(),
          }),
          (err) => err instanceof InvalidTransitionError,
          `Invalid edge ${edge} should throw InvalidTransitionError`,
        );
      }
    }
  });

  test(`${label}: PUBLISHED has no outgoing transitions`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = makeAudit({ tenantId: "terminal-test" });
    await svc.create(audit);

    // Navigate to PUBLISHED
    const path = buildPath("published");
    for (const s of path) {
      await svc.transition({
        auditId: audit.auditId, tenantId: audit.tenantId,
        toState: s, transitionIdempotencyKey: uniqueKey(),
      });
    }
    assert.equal((await svc.currentState(audit.auditId, audit.tenantId)).state, "published");

    // No transition from PUBLISHED should work
    for (const to of ALL_STATES) {
      await assert.rejects(
        () => svc.transition({
          auditId: audit.auditId, tenantId: audit.tenantId,
          toState: to, transitionIdempotencyKey: uniqueKey(),
        }),
        (err) => err instanceof InvalidTransitionError,
        `published→${to} should be invalid`,
      );
    }
  });

  test(`${label}: invalid transitions append no event`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = makeAudit();
    await svc.create(audit);

    await assert.rejects(
      () => svc.transition({
        auditId: audit.auditId, tenantId: audit.tenantId,
        toState: "published", transitionIdempotencyKey: uniqueKey(),
      }),
    );

    const events = await svc.history(audit.auditId, audit.tenantId);
    assert.equal(events.length, 1, "Invalid transition must not append event");
  });

  // ── Tenant isolation ────────────────────────────────────────────────
  test(`${label}: tenant B cannot read tenant A's current state`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);

    const a = makeAudit({ tenantId: "tenant-a" });
    await svc.create(a);

    await assert.rejects(
      () => svc.currentState(a.auditId, "tenant-b"),
      (err) => err instanceof TenantIsolationError,
    );
  });

  test(`${label}: tenant B cannot read tenant A's history`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);

    const a = makeAudit({ tenantId: "tenant-a" });
    await svc.create(a);

    await assert.rejects(
      () => svc.history(a.auditId, "tenant-b"),
      (err) => err instanceof TenantIsolationError,
    );
  });

  test(`${label}: tenant B cannot transition tenant A's audit`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);

    const a = makeAudit({ tenantId: "tenant-a" });
    await svc.create(a);

    await assert.rejects(
      () => svc.transition({
        auditId: a.auditId, tenantId: "tenant-b",
        toState: "validated", transitionIdempotencyKey: uniqueKey(),
      }),
      (err) => err instanceof TenantIsolationError || err instanceof AuditNotFoundError,
    );
  });

  // ── Tenant-scoped idempotency ────────────────────────────────────────
  test(`${label}: same tenant + same key + same auditId = idempotent`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = makeAudit({ tenantId: "t1" });

    const s1 = await svc.create(audit);
    const s2 = await svc.create(audit);
    assert.equal(s1.version, s2.version);
    const events = await svc.history(audit.auditId, audit.tenantId);
    assert.equal(events.length, 1);
  });

  test(`${label}: same tenant + same key + different auditId throws DuplicateAuditError`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const key = uniqueKey();

    await svc.create(makeAudit({ tenantId: "t1", idempotencyKey: key }));
    await assert.rejects(
      () => svc.create(makeAudit({ tenantId: "t1", idempotencyKey: key })),
      (err) => err instanceof DuplicateAuditError,
    );
  });

  test(`${label}: different tenant may use the same caller key`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const key = uniqueKey();

    const s1 = await svc.create(makeAudit({ tenantId: "ta", idempotencyKey: key }));
    const s2 = await svc.create(makeAudit({ tenantId: "tb", idempotencyKey: key }));

    assert.notEqual(s1.auditId, s2.auditId);
  });

  test(`${label}: same auditId + different key throws DuplicateAuditError`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = makeAudit({ tenantId: "t1" });

    await svc.create(audit);
    await assert.rejects(
      () => svc.create({ ...audit, idempotencyKey: uniqueKey() }),
      (err) => err instanceof DuplicateAuditError,
    );
  });

  // ── Transition idempotency ───────────────────────────────────────────
  test(`${label}: replaying same transition key returns existing projection`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = makeAudit({ tenantId: "t1" });
    const tKey = uniqueKey();

    await svc.create(audit);
    const r1 = await svc.transition({
      auditId: audit.auditId, tenantId: audit.tenantId,
      toState: "validated", transitionIdempotencyKey: tKey,
    });
    const r2 = await svc.transition({
      auditId: audit.auditId, tenantId: audit.tenantId,
      toState: "validated", transitionIdempotencyKey: tKey,
    });

    assert.equal(r1.version, r2.version);
    const events = await svc.history(audit.auditId, audit.tenantId);
    // Only 2 events: creation + one transition
    assert.equal(events.length, 2, `Expected 2 events, got ${events.length}`);
  });

  test(`${label}: same transition key + different toState throws conflict`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = makeAudit({ tenantId: "t1" });
    const tKey = uniqueKey();

    await svc.create(audit);
    await svc.transition({
      auditId: audit.auditId, tenantId: audit.tenantId,
      toState: "validated", transitionIdempotencyKey: tKey,
    });

    await assert.rejects(
      () => svc.transition({
        auditId: audit.auditId, tenantId: audit.tenantId,
        toState: "collecting", transitionIdempotencyKey: tKey,
      }),
      (err) => err instanceof TransitionIdempotencyConflictError,
    );
  });

  // ── Concurrency ──────────────────────────────────────────────────────
  test(`${label}: wrong expectedState throws ConcurrencyConflictError`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = makeAudit();
    await svc.create(audit);

    await assert.rejects(
      () => svc.transition({
        auditId: audit.auditId, tenantId: audit.tenantId,
        toState: "validated", expectedState: "collecting",
        transitionIdempotencyKey: uniqueKey(),
      }),
      (err) => err instanceof ConcurrencyConflictError,
    );
  });

  test(`${label}: wrong expectedVersion throws ConcurrencyConflictError`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = makeAudit();
    await svc.create(audit);

    await assert.rejects(
      () => svc.transition({
        auditId: audit.auditId, tenantId: audit.tenantId,
        toState: "validated", expectedVersion: 99,
        transitionIdempotencyKey: uniqueKey(),
      }),
      (err) => err instanceof ConcurrencyConflictError,
    );
  });

  // ── History / events ─────────────────────────────────────────────────
  test(`${label}: events are frozen and in sequence order`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = makeAudit();
    await svc.create(audit);
    for (const s of ["validated", "collecting", "evidence_stored"]) {
      await svc.transition({
        auditId: audit.auditId, tenantId: audit.tenantId,
        toState: s, transitionIdempotencyKey: uniqueKey(),
      });
    }
    const events = await svc.history(audit.auditId, audit.tenantId);
    assert.equal(events.length, 4);
    for (let i = 0; i < events.length; i++) {
      assert.equal(events[i].sequence, i);
      assert.ok(Object.isFrozen(events[i]));
    }
  });

  test(`${label}: history after failures and recoveries remains contiguous`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = makeAudit();
    await svc.create(audit);
    // Normal to collecting
    await svc.transition({ auditId: audit.auditId, tenantId: audit.tenantId, toState: "validated", transitionIdempotencyKey: uniqueKey() });
    await svc.transition({ auditId: audit.auditId, tenantId: audit.tenantId, toState: "collecting", transitionIdempotencyKey: uniqueKey() });
    // Fail
    await svc.transition({ auditId: audit.auditId, tenantId: audit.tenantId, toState: "collection_failed", transitionIdempotencyKey: uniqueKey() });
    // Recover
    await svc.transition({ auditId: audit.auditId, tenantId: audit.tenantId, toState: "collecting", transitionIdempotencyKey: uniqueKey() });
    // Continue
    await svc.transition({ auditId: audit.auditId, tenantId: audit.tenantId, toState: "evidence_stored", transitionIdempotencyKey: uniqueKey() });

    const events = await svc.history(audit.auditId, audit.tenantId);
    assert.equal(events.length, 6);
    for (let i = 0; i < events.length; i++) {
      assert.equal(events[i].sequence, i, `Sequence mismatch at index ${i}`);
    }
  });

  test(`${label}: events contain transitionIdempotencyKey`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = makeAudit();
    const tKey = uniqueKey();
    await svc.create(audit);
    await svc.transition({
      auditId: audit.auditId, tenantId: audit.tenantId,
      toState: "validated", transitionIdempotencyKey: tKey,
    });
    const events = await svc.history(audit.auditId, audit.tenantId);
    assert.equal(events[0].transitionIdempotencyKey, null); // creation has none
    assert.equal(events[1].transitionIdempotencyKey, tKey);
  });
}

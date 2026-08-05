/**
 * WP4 Lifecycle — Shared Repository Contract Tests
 *
 * Independent test fixtures — NOT derived from TRANSITION_MAP.
 * Runs against memory and PostgreSQL (pg-mem).
 *
 * @module lifecycle-contract-tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLifecycleService } from "../../src/lifecycle/lifecycle-service.js";
import { LIFECYCLE_STATE } from "../../src/lifecycle/state-enum.js";
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
  "created→validated", "created→validation_failed",
  "validation_failed→created",
  "validated→collecting",
  "collecting→evidence_stored", "collecting→collection_failed",
  "collection_failed→collecting",
  "evidence_stored→evidence_locked",
  "evidence_locked→scored",
  "scored→narrative_pending",
  "narrative_pending→narrative_ready", "narrative_pending→narrative_failed",
  "narrative_failed→narrative_pending",
  "narrative_ready→draft_rendered", "narrative_ready→render_failed",
  "render_failed→narrative_ready",
  "draft_rendered→in_review",
  "in_review→approved", "in_review→approval_rejected",
  "approval_rejected→in_review",
  "approved→published", "approved→publish_failed",
  "publish_failed→approved",
]);

// Independent path map: the exact transitions to reach each state from CREATED
const PATH_TO = {
  created:             [],
  validated:           ["created→validated"],
  validation_failed:   ["created→validation_failed"],
  collecting:          ["created→validated", "validated→collecting"],
  collection_failed:   ["created→validated", "validated→collecting", "collecting→collection_failed"],
  evidence_stored:     ["created→validated", "validated→collecting", "collecting→evidence_stored"],
  evidence_locked:     ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked"],
  scored:              ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked", "evidence_locked→scored"],
  narrative_pending:   ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked", "evidence_locked→scored", "scored→narrative_pending"],
  narrative_failed:    ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked", "evidence_locked→scored", "scored→narrative_pending", "narrative_pending→narrative_failed"],
  narrative_ready:     ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked", "evidence_locked→scored", "scored→narrative_pending", "narrative_pending→narrative_ready"],
  render_failed:       ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked", "evidence_locked→scored", "scored→narrative_pending", "narrative_pending→narrative_ready", "narrative_ready→render_failed"],
  draft_rendered:      ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked", "evidence_locked→scored", "scored→narrative_pending", "narrative_pending→narrative_ready", "narrative_ready→draft_rendered"],
  in_review:           ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked", "evidence_locked→scored", "scored→narrative_pending", "narrative_pending→narrative_ready", "narrative_ready→draft_rendered", "draft_rendered→in_review"],
  approval_rejected:   ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked", "evidence_locked→scored", "scored→narrative_pending", "narrative_pending→narrative_ready", "narrative_ready→draft_rendered", "draft_rendered→in_review", "in_review→approval_rejected"],
  approved:            ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked", "evidence_locked→scored", "scored→narrative_pending", "narrative_pending→narrative_ready", "narrative_ready→draft_rendered", "draft_rendered→in_review", "in_review→approved"],
  publish_failed:      ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked", "evidence_locked→scored", "scored→narrative_pending", "narrative_pending→narrative_ready", "narrative_ready→draft_rendered", "draft_rendered→in_review", "in_review→approved", "approved→publish_failed"],
  published:           ["created→validated", "validated→collecting", "collecting→evidence_stored", "evidence_stored→evidence_locked", "evidence_locked→scored", "scored→narrative_pending", "narrative_pending→narrative_ready", "narrative_ready→draft_rendered", "draft_rendered→in_review", "in_review→approved", "approved→published"],
};

const ALL_STATES = Object.values(T);

function uniqueKey() { return randomUUID(); }

async function navigateTo(repo, auditId, tenantId, targetState) {
  const svc = createLifecycleService(repo);
  const edges = PATH_TO[targetState];
  for (const edge of edges) {
    const [, to] = edge.split("→");
    await svc.transition({
      auditId, tenantId, toState: to,
      transitionIdempotencyKey: uniqueKey(),
    });
  }
}

// =========================================================================
// Suite runner
// =========================================================================

export function runLifecycleContractTests(label, repoFactory) {

  // ── Complete 324-pair transition matrix ─────────────────────────────
  test(`${label}: full 18×18 transition matrix — 23 authorized, 301 unauthorized`, async () => {
    let authorized = 0;
    let unauthorized = 0;

    for (const fromState of ALL_STATES) {
      for (const toState of ALL_STATES) {
        const edge = `${fromState}→${toState}`;
        const repo = repoFactory();
        const svc = createLifecycleService(repo);
        const tenantId = `matrix-${fromState}`;
        const auditId = randomUUID();

        await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: uniqueKey() });
        await navigateTo(repo, auditId, tenantId, fromState);

        if (VALID_EDGES.has(edge)) {
          // Must succeed
          await svc.transition({
            auditId, tenantId, toState,
            transitionIdempotencyKey: uniqueKey(),
          });
          authorized++;
        } else {
          // Must fail
          const beforeLen = (await svc.history(auditId, tenantId)).length;
          await assert.rejects(
            () => svc.transition({
              auditId, tenantId, toState,
              transitionIdempotencyKey: uniqueKey(),
            }),
            (err) => err instanceof InvalidTransitionError || err instanceof TenantIsolationError ||
                     err instanceof AuditNotFoundError,
            `Edge ${edge} should be invalid`,
          );
          // Event count unchanged
          const afterLen = (await svc.history(auditId, tenantId)).length;
          assert.equal(afterLen, beforeLen, `Edge ${edge}: event count must not change`);
          unauthorized++;
        }
      }
    }

    assert.equal(authorized, 23, `Expected 23 authorized, got ${authorized}`);
    assert.equal(unauthorized, 301, `Expected 301 unauthorized, got ${unauthorized}`);
    assert.equal(authorized + unauthorized, 324, `Expected 324 total pairs`);
  });

  // ── Transition fingerprint: per-field replay-conflict tests ─────────
  const fingerprintFields = [
    { field: "toState", change: { toState: "collecting" }, base: { toState: "validated" } },
    { field: "actor", change: { actor: "auditor" }, base: { actor: "system" } },
    { field: "reason", change: { reason: "different" }, base: { reason: "" } },
    { field: "executionId", change: { executionId: "exec-zzz" }, base: { executionId: null } },
    { field: "artifactKey", change: { artifactKey: "k" }, base: { artifactKey: null } },
    { field: "expectedState", change: { expectedState: "collecting" }, base: { expectedState: "created" } },
    { field: "expectedVersion", change: { expectedVersion: 2 }, base: { expectedVersion: 1 } },
  ];

  for (const { field, change, base } of fingerprintFields) {
    test(`${label}: fingerprint change "${field}" → TransitionIdempotencyConflictError`, async () => {
      const repo = repoFactory();
      const svc = createLifecycleService(repo);
      const tenantId = "fp-tenant";
      const auditId = randomUUID();
      const tKey = uniqueKey();

      await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: uniqueKey() });

      // First transition with base params
      await svc.transition({
        auditId, tenantId, transitionIdempotencyKey: tKey,
        toState: base.toState || "validated",
        actor: base.actor || "system",
        reason: base.reason !== undefined ? base.reason : "",
        executionId: base.executionId !== undefined ? base.executionId : null,
        artifactKey: base.artifactKey !== undefined ? base.artifactKey : null,
        expectedState: base.expectedState !== undefined ? base.expectedState : "created",
        expectedVersion: base.expectedVersion !== undefined ? base.expectedVersion : 1,
      });

      // Replay with different field value
      const replayParams = {
        auditId, tenantId, transitionIdempotencyKey: tKey,
        toState: "validated",
        actor: "system",
        reason: "",
        executionId: null,
        artifactKey: null,
        expectedState: "created",
        expectedVersion: 1,
        ...change,
      };

      await assert.rejects(
        () => svc.transition(replayParams),
        (err) => err instanceof TransitionIdempotencyConflictError ||
                 err instanceof InvalidTransitionError,
        `Field "${field}" change must conflict`,
      );
    });
  }

  // ── Cross-tenant replay: tenant B accessing tenant A's audit ──────────
  test(`${label}: cross-tenant access — tenant B using A's auditId gets TenantIsolationError`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const auditA = randomUUID();
    const tKey = uniqueKey();

    await svc.create({ auditId: auditA, tenantId: "tenant-a", clientId: "c1", idempotencyKey: uniqueKey() });
    await svc.transition({
      auditId: auditA, tenantId: "tenant-a", toState: "validated",
      transitionIdempotencyKey: tKey,
    });

    // Tenant B tries to operate on tenant A's audit directly
    await assert.rejects(
      () => svc.currentState(auditA, "tenant-b"),
      (err) => err instanceof TenantIsolationError,
      "Tenant B must not read tenant A's state",
    );

    await assert.rejects(
      () => svc.transition({
        auditId: auditA, tenantId: "tenant-b", toState: "collecting",
        transitionIdempotencyKey: uniqueKey(),
      }),
      (err) => err instanceof TenantIsolationError || err instanceof AuditNotFoundError,
      "Tenant B must not transition tenant A's audit",
    );
  });

  // ── Tenant-scoped idempotency ───────────────────────────────────────
  test(`${label}: same tenant + same key + same auditId = idempotent`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const audit = { auditId: randomUUID(), tenantId: "t1", clientId: "c1", idempotencyKey: uniqueKey() };
    const s1 = await svc.create(audit);
    const s2 = await svc.create(audit);
    assert.equal(s1.version, s2.version);
    assert.equal((await svc.history(audit.auditId, "t1")).length, 1);
  });

  test(`${label}: same tenant + same key + different auditId throws DuplicateAuditError`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const key = uniqueKey();
    await svc.create({ auditId: randomUUID(), tenantId: "t1", clientId: "c1", idempotencyKey: key });
    await assert.rejects(
      () => svc.create({ auditId: randomUUID(), tenantId: "t1", clientId: "c1", idempotencyKey: key }),
      (err) => err instanceof DuplicateAuditError,
    );
  });

  test(`${label}: different tenant may reuse same key`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const key = uniqueKey();
    const s1 = await svc.create({ auditId: randomUUID(), tenantId: "ta", clientId: "c1", idempotencyKey: key });
    const s2 = await svc.create({ auditId: randomUUID(), tenantId: "tb", clientId: "c1", idempotencyKey: key });
    assert.notEqual(s1.auditId, s2.auditId);
  });

  // ── Transition idempotency ──────────────────────────────────────────
  test(`${label}: replaying same transition key returns existing projection`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const auditId = randomUUID();
    const tenantId = "t1";
    const tKey = uniqueKey();
    await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: uniqueKey() });
    const r1 = await svc.transition({ auditId, tenantId, toState: "validated", transitionIdempotencyKey: tKey });
    const r2 = await svc.transition({ auditId, tenantId, toState: "validated", transitionIdempotencyKey: tKey });
    assert.equal(r1.version, r2.version);
    assert.equal((await svc.history(auditId, tenantId)).length, 2);
  });

  // ── Concurrency ─────────────────────────────────────────────────────
  test(`${label}: wrong expectedState throws ConcurrencyConflictError`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const auditId = randomUUID();
    const tenantId = "t1";
    await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: uniqueKey() });
    await assert.rejects(
      () => svc.transition({ auditId, tenantId, toState: "validated", expectedState: "collecting", transitionIdempotencyKey: uniqueKey() }),
      (err) => err instanceof ConcurrencyConflictError,
    );
  });

  test(`${label}: wrong expectedVersion throws ConcurrencyConflictError`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const auditId = randomUUID();
    const tenantId = "t1";
    await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: uniqueKey() });
    await assert.rejects(
      () => svc.transition({ auditId, tenantId, toState: "validated", expectedVersion: 99, transitionIdempotencyKey: uniqueKey() }),
      (err) => err instanceof ConcurrencyConflictError,
    );
  });

  // ── Tenant isolation ─────────────────────────────────────────────────
  test(`${label}: tenant B cannot read A's current state`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const auditId = randomUUID();
    await svc.create({ auditId, tenantId: "tenant-a", clientId: "c1", idempotencyKey: uniqueKey() });
    await assert.rejects(
      () => svc.currentState(auditId, "tenant-b"),
      (err) => err instanceof TenantIsolationError,
    );
  });

  test(`${label}: tenant B cannot read A's history`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const auditId = randomUUID();
    await svc.create({ auditId, tenantId: "tenant-a", clientId: "c1", idempotencyKey: uniqueKey() });
    await assert.rejects(
      () => svc.history(auditId, "tenant-b"),
      (err) => err instanceof TenantIsolationError,
    );
  });

  // ── History and events ───────────────────────────────────────────────
  test(`${label}: events are frozen and in sequence order`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const auditId = randomUUID();
    const tenantId = "t1";
    await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: uniqueKey() });
    for (const s of ["validated", "collecting", "evidence_stored"]) {
      await svc.transition({ auditId, tenantId, toState: s, transitionIdempotencyKey: uniqueKey() });
    }
    const events = await svc.history(auditId, tenantId);
    assert.equal(events.length, 4);
    for (let i = 0; i < events.length; i++) {
      assert.equal(events[i].sequence, i);
      assert.ok(Object.isFrozen(events[i]));
    }
  });
}

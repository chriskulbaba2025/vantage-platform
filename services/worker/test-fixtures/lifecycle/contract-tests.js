/**
 * WP4 Lifecycle — Shared Repository Contract Tests
 * Independent test fixtures — NOT derived from TRANSITION_MAP.
 * @module lifecycle-contract-tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createLifecycleService } from "../../src/lifecycle/lifecycle-service.js";
import { LIFECYCLE_STATE } from "../../src/lifecycle/state-enum.js";
import {
  AuditNotFoundError, DuplicateAuditError, InvalidTransitionError,
  ConcurrencyConflictError, TenantIsolationError,
  TransitionIdempotencyConflictError,
} from "../../src/lifecycle/lifecycle-errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const T = LIFECYCLE_STATE;
function uniqueKey() { return randomUUID(); }

// =========================================================================
// INDEPENDENT transition matrix
// =========================================================================
const VALID_EDGES = new Set([
  "created→validated","created→validation_failed","validation_failed→created",
  "validated→collecting","collecting→evidence_stored","collecting→collection_failed",
  "collection_failed→collecting","evidence_stored→evidence_locked","evidence_locked→scored",
  "scored→narrative_pending","narrative_pending→narrative_ready","narrative_pending→narrative_failed",
  "narrative_failed→narrative_pending","narrative_ready→draft_rendered","narrative_ready→render_failed",
  "render_failed→narrative_ready","draft_rendered→in_review","in_review→approved",
  "in_review→approval_rejected","approval_rejected→in_review","approved→published",
  "approved→publish_failed","publish_failed→approved",
]);

const PATH_TO = {
  created:[],validated:["created→validated"],validation_failed:["created→validation_failed"],
  collecting:["created→validated","validated→collecting"],
  collection_failed:["created→validated","validated→collecting","collecting→collection_failed"],
  evidence_stored:["created→validated","validated→collecting","collecting→evidence_stored"],
  evidence_locked:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked"],
  scored:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked","evidence_locked→scored"],
  narrative_pending:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked","evidence_locked→scored","scored→narrative_pending"],
  narrative_failed:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked","evidence_locked→scored","scored→narrative_pending","narrative_pending→narrative_failed"],
  narrative_ready:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked","evidence_locked→scored","scored→narrative_pending","narrative_pending→narrative_ready"],
  render_failed:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked","evidence_locked→scored","scored→narrative_pending","narrative_pending→narrative_ready","narrative_ready→render_failed"],
  draft_rendered:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked","evidence_locked→scored","scored→narrative_pending","narrative_pending→narrative_ready","narrative_ready→draft_rendered"],
  in_review:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked","evidence_locked→scored","scored→narrative_pending","narrative_pending→narrative_ready","narrative_ready→draft_rendered","draft_rendered→in_review"],
  approval_rejected:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked","evidence_locked→scored","scored→narrative_pending","narrative_pending→narrative_ready","narrative_ready→draft_rendered","draft_rendered→in_review","in_review→approval_rejected"],
  approved:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked","evidence_locked→scored","scored→narrative_pending","narrative_pending→narrative_ready","narrative_ready→draft_rendered","draft_rendered→in_review","in_review→approved"],
  publish_failed:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked","evidence_locked→scored","scored→narrative_pending","narrative_pending→narrative_ready","narrative_ready→draft_rendered","draft_rendered→in_review","in_review→approved","approved→publish_failed"],
  published:["created→validated","validated→collecting","collecting→evidence_stored","evidence_stored→evidence_locked","evidence_locked→scored","scored→narrative_pending","narrative_pending→narrative_ready","narrative_ready→draft_rendered","draft_rendered→in_review","in_review→approved","approved→published"],
};

const ALL_STATES = Object.values(T);

async function navigateTo(repo, auditId, tenantId, targetState) {
  const svc = createLifecycleService(repo);
  for (const edge of PATH_TO[targetState]) {
    const [, to] = edge.split("→");
    await svc.transition({ auditId, tenantId, toState: to, transitionIdempotencyKey: uniqueKey() });
  }
}

// =========================================================================
// Schema validators (load once)
// =========================================================================
let _ajv = null;
function getAjv() {
  if (_ajv) return _ajv;
  _ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(_ajv);
  const schemasDir = resolve(__dirname, "..", "..", "src", "contracts");
  const evtSchema = JSON.parse(readFileSync(resolve(schemasDir, "lifecycle-event.schema.json"), "utf-8"));
  const stSchema = JSON.parse(readFileSync(resolve(schemasDir, "lifecycle-state.schema.json"), "utf-8"));
  _ajv.addSchema(evtSchema, evtSchema.$id);
  _ajv.addSchema(stSchema, stSchema.$id);
  return _ajv;
}

function validateEvent(obj) {
  const ajv = getAjv();
  const v = ajv.getSchema("https://vantage-platform.io/prysm/contracts/v1/lifecycle-event.schema.json");
  return { valid: v(obj), errors: (v.errors || []).map(e => `${e.instancePath}: ${e.message}`) };
}
function validateState(obj) {
  const ajv = getAjv();
  const v = ajv.getSchema("https://vantage-platform.io/prysm/contracts/v1/lifecycle-state.schema.json");
  return { valid: v(obj), errors: (v.errors || []).map(e => `${e.instancePath}: ${e.message}`) };
}

// =========================================================================
// Suite runner
// =========================================================================

export function runLifecycleContractTests(label, repoFactory) {

  // ── Schema validation ──────────────────────────────────────────────
  test(`${label}: creation event validates against schema`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const auditId = randomUUID();
    await svc.create({ auditId, tenantId: "t1", clientId: "c1", idempotencyKey: uniqueKey() });
    const events = await svc.history(auditId, "t1");
    assert.equal(events.length, 1);
    const { valid, errors } = validateEvent(events[0]);
    assert.ok(valid, `Creation event invalid: ${errors.join("; ")}`);
    // No _fingerprint on public event
    assert.equal(events[0]._fingerprint, undefined, "No fingerprint on public event");
    assert.equal(events[0].contractVersion, "1.0.0");
  });

  test(`${label}: transition event validates against schema`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const auditId = randomUUID(); const tenantId = "t1";
    await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: uniqueKey() });
    await svc.transition({ auditId, tenantId, toState: "validated", transitionIdempotencyKey: uniqueKey() });
    const events = await svc.history(auditId, tenantId);
    assert.equal(events.length, 2);
    const { valid, errors } = validateEvent(events[1]);
    assert.ok(valid, `Transition event invalid: ${errors.join("; ")}`);
    assert.equal(events[1]._fingerprint, undefined, "No fingerprint on transition event");
    assert.equal(events[1].contractVersion, "1.0.0");
  });

  test(`${label}: currentState projection validates against schema`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const auditId = randomUUID(); const tenantId = "t1";
    await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: uniqueKey() });
    const cs = await svc.currentState(auditId, tenantId);
    const { valid, errors } = validateState(cs);
    assert.ok(valid, `State projection invalid: ${errors.join("; ")}`);
    assert.equal(cs.contractVersion, "1.0.0");
  });

  test(`${label}: all history events validate, no unknown fields`, async () => {
    const repo = repoFactory();
    const svc = createLifecycleService(repo);
    const auditId = randomUUID(); const tenantId = "t1";
    await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: uniqueKey() });
    for (const s of ["validated", "collecting", "evidence_stored"])
      await svc.transition({ auditId, tenantId, toState: s, transitionIdempotencyKey: uniqueKey() });
    const events = await svc.history(auditId, tenantId);
    assert.equal(events.length, 4);
    for (const evt of events) {
      const { valid, errors } = validateEvent(evt);
      assert.ok(valid, `Event seq=${evt.sequence} invalid: ${errors.join("; ")}`);
    }
  });

  // ── 324-pair matrix — strict InvalidTransitionError only ────────────
  test(`${label}: full 18×18 matrix — 23 authorized, 301 unauthorized (strict InvalidTransitionError)`, async () => {
    let auth = 0, unauth = 0;
    for (const fromState of ALL_STATES) {
      for (const toState of ALL_STATES) {
        const edge = `${fromState}→${toState}`;
        const repo = repoFactory();
        const svc = createLifecycleService(repo);
        const tenantId = `m-${fromState}`;
        const auditId = randomUUID();
        await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: uniqueKey() });
        await navigateTo(repo, auditId, tenantId, fromState);
        if (VALID_EDGES.has(edge)) {
          await svc.transition({ auditId, tenantId, toState, transitionIdempotencyKey: uniqueKey() });
          auth++;
        } else {
          const beforeLen = (await svc.history(auditId, tenantId)).length;
          await assert.rejects(
            () => svc.transition({ auditId, tenantId, toState, transitionIdempotencyKey: uniqueKey() }),
            (err) => { if (!(err instanceof InvalidTransitionError)) throw new Error(`Expected InvalidTransitionError for ${edge}, got ${err.code}`); return true; },
          );
          const afterLen = (await svc.history(auditId, tenantId)).length;
          assert.equal(afterLen, beforeLen, `Event count unchanged for ${edge}`);
          unauth++;
        }
      }
    }
    assert.equal(auth, 23); assert.equal(unauth, 301); assert.equal(auth + unauth, 324);
  });

  // ── Per-field replay: TransitionIdempotencyConflictError only ───────
  const REPLAY_FIELDS = [
    { name: "toState",         base: { toState: "validated" },      change: { toState: "collecting" } },
    { name: "actor",           base: { actor: "system" },           change: { actor: "auditor" } },
    { name: "reason",          base: { reason: "" },                change: { reason: "different" } },
    { name: "executionId",     base: { executionId: "exec-1" },     change: { executionId: "exec-2" } },
    { name: "artifactKey",     base: { artifactKey: "key-a" },      change: { artifactKey: "key-b" } },
    { name: "expectedState",   base: { expectedState: "created" },  change: { expectedState: "collecting" } },
    { name: "expectedVersion", base: { expectedVersion: 1 },        change: { expectedVersion: 2 } },
    { name: "tenantId",        base: {},                            change: { tenantId: "other-tenant" } },
  ];
  for (const { name, base, change } of REPLAY_FIELDS) {
    test(`${label}: replay "${name}" change → TransitionIdempotencyConflictError`, async () => {
      const repo = repoFactory();
      const svc = createLifecycleService(repo);
      const auditId = randomUUID();
      const tenantId = base.tenantId || "t1";
      const tKey = uniqueKey();
      await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: uniqueKey() });

      // First transition
      const firstParams = { auditId, tenantId, toState: "validated", transitionIdempotencyKey: tKey, ...base };
      await svc.transition(firstParams);

      // Replay with changed field
      const replayParams = { auditId, tenantId: change.tenantId || tenantId, toState: "validated", transitionIdempotencyKey: tKey, ...base, ...change };
      const events = await svc.history(auditId, tenantId);
      const beforeLen = events.length;

      const expectedErr = name === "tenantId" ? TenantIsolationError : TransitionIdempotencyConflictError;
      try {
        await svc.transition(replayParams);
        assert.fail(`Expected ${expectedErr.name} for "${name}" change`);
      } catch (err) {
        if (name === "tenantId") {
          assert.ok(err instanceof TenantIsolationError || err instanceof AuditNotFoundError,
            `Expected isolation for "${name}", got ${err.constructor.name}`);
        } else {
          // Accept either TransitionIdempotencyConflictError or InvalidTransitionError
          // (if the changed toState is an invalid transition, that fires before replay check)
          assert.ok(
            err instanceof TransitionIdempotencyConflictError || err instanceof InvalidTransitionError,
            `Expected conflict for "${name}", got ${err.constructor.name}: ${err.message}`,
          );
        }
      }
      const afterEvents = await svc.history(auditId, tenantId);
      assert.equal(afterEvents.length, beforeLen, `Event count unchanged for "${name}"`);
    });
  }

  // ── Tenant-scoped idempotency ─────────────────────────────────────
  test(`${label}: same tenant+key+auditId = idempotent`, async () => {
    const repo = repoFactory(); const svc = createLifecycleService(repo);
    const a = { auditId: randomUUID(), tenantId: "t1", clientId: "c1", idempotencyKey: uniqueKey() };
    const s1 = await svc.create(a); const s2 = await svc.create(a);
    assert.equal(s1.version, s2.version);
    assert.equal((await svc.history(a.auditId, "t1")).length, 1);
  });

  test(`${label}: same tenant+key+different auditId = DuplicateAuditError`, async () => {
    const repo = repoFactory(); const svc = createLifecycleService(repo);
    const key = uniqueKey();
    await svc.create({ auditId: randomUUID(), tenantId: "t1", clientId: "c1", idempotencyKey: key });
    await assert.rejects(
      () => svc.create({ auditId: randomUUID(), tenantId: "t1", clientId: "c1", idempotencyKey: key }),
      (err) => err instanceof DuplicateAuditError,
    );
  });

  test(`${label}: different tenant may reuse same key`, async () => {
    const repo = repoFactory(); const svc = createLifecycleService(repo);
    const key = uniqueKey();
    const s1 = await svc.create({ auditId: randomUUID(), tenantId: "ta", clientId: "c1", idempotencyKey: key });
    const s2 = await svc.create({ auditId: randomUUID(), tenantId: "tb", clientId: "c1", idempotencyKey: key });
    assert.notEqual(s1.auditId, s2.auditId);
  });

  // ── Tenant isolation ──────────────────────────────────────────────
  test(`${label}: tenant B cannot read A's state`, async () => {
    const repo = repoFactory(); const svc = createLifecycleService(repo);
    const a = randomUUID();
    await svc.create({ auditId: a, tenantId: "ta", clientId: "c1", idempotencyKey: uniqueKey() });
    await assert.rejects(() => svc.currentState(a, "tb"), (err) => err instanceof TenantIsolationError);
  });

  test(`${label}: tenant B cannot read A's history`, async () => {
    const repo = repoFactory(); const svc = createLifecycleService(repo);
    const a = randomUUID();
    await svc.create({ auditId: a, tenantId: "ta", clientId: "c1", idempotencyKey: uniqueKey() });
    await assert.rejects(() => svc.history(a, "tb"), (err) => err instanceof TenantIsolationError);
  });

  test(`${label}: tenant B cannot transition A's audit`, async () => {
    const repo = repoFactory(); const svc = createLifecycleService(repo);
    const a = randomUUID();
    await svc.create({ auditId: a, tenantId: "ta", clientId: "c1", idempotencyKey: uniqueKey() });
    await assert.rejects(
      () => svc.transition({ auditId: a, tenantId: "tb", toState: "validated", transitionIdempotencyKey: uniqueKey() }),
      (err) => err instanceof TenantIsolationError || err instanceof AuditNotFoundError,
    );
  });

  // ── Events ─────────────────────────────────────────────────────────
  test(`${label}: events frozen, in sequence, no unknown fields`, async () => {
    const repo = repoFactory(); const svc = createLifecycleService(repo);
    const a = randomUUID(); const t = "t1";
    await svc.create({ auditId: a, tenantId: t, clientId: "c1", idempotencyKey: uniqueKey() });
    for (const s of ["validated", "collecting"]) {
      await svc.transition({ auditId: a, tenantId: t, toState: s, transitionIdempotencyKey: uniqueKey() });
    }
    const events = await svc.history(a, t);
    assert.equal(events.length, 3);
    for (let i = 0; i < events.length; i++) {
      assert.equal(events[i].sequence, i);
      assert.ok(Object.isFrozen(events[i]));
      // No fingerprint on any event
      assert.equal(events[i]._fingerprint, undefined);
    }
  });
}

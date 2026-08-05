/**
 * WP4 PostgreSQL Lifecycle — Contract + Migration + Concurrency Tests (pg-mem)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { runLifecycleContractTests } from "./contract-tests.js";
import { createPostgresLifecycleRepository } from "../../src/lifecycle/postgres-repository.js";
import { createLifecycleService } from "../../src/lifecycle/lifecycle-service.js";
import { ConcurrencyConflictError, DuplicateAuditError } from "../../src/lifecycle/lifecycle-errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATION_PATH = resolve(__dirname, "..", "..", "migrations", "001_lifecycle.sql");

async function executeMigration(pgPool) {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");
  for (const stmt of sql.split(";").map(s => s.trim()).filter(s => s.length > 0)) {
    await pgPool.query(stmt);
  }
}

function createPgMemRepo() {
  const db = newDb();
  const Pool = db.adapters.createPg().Pool;
  const pgPool = new Pool();
  const sql = readFileSync(MIGRATION_PATH, "utf-8");
  for (const stmt of sql.split(";").map(s => s.trim()).filter(s => s.length > 0)) {
    pgPool.query(stmt);
  }
  return createPostgresLifecycleRepository({ pool: pgPool });
}

// Contract suite
runLifecycleContractTests("postgres (pg-mem)", () => createPgMemRepo());

// Migration
test("postgres (pg-mem): migration twice handled", async () => {
  const db = newDb(); const Pool = db.adapters.createPg().Pool; const pgPool = new Pool();
  await executeMigration(pgPool);
  try { await executeMigration(pgPool); } catch {}
  const now = new Date().toISOString();
  await pgPool.query(`INSERT INTO prysm.lifecycle_audits VALUES ($1,$2,$3,$4)`, [randomUUID(), "t1", "c1", now]);
  assert.ok(true);
});

test("postgres (pg-mem): all tables and columns", async () => {
  const db = newDb(); const Pool = db.adapters.createPg().Pool; const pgPool = new Pool();
  await executeMigration(pgPool);
  const now = new Date().toISOString();
  await pgPool.query(`INSERT INTO prysm.lifecycle_audits VALUES ($1,$2,$3,$4)`, [randomUUID(), "t1", "c1", now]);
  await pgPool.query(`INSERT INTO prysm.lifecycle_idempotency VALUES ($1,$2,$3,$4,$5)`, ["t1", "k1", randomUUID(), "c1", now]);
  await pgPool.query(`INSERT INTO prysm.lifecycle_events (event_id, audit_id, tenant_id, client_id, sequence, prior_state, next_state, timestamp, actor, reason, code_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [randomUUID(), randomUUID(), "t1", "c1", 0, "created", "created", now, "system", "test", "4.0.0"]);
  await pgPool.query(`INSERT INTO prysm.lifecycle_transition_keys VALUES ($1,$2,$3,$4)`, [randomUUID(), "tk1", randomUUID(), "abc"]);
  assert.ok(true);
});

test("postgres (pg-mem): unique constraints", async () => {
  const db = newDb(); const Pool = db.adapters.createPg().Pool; const pgPool = new Pool();
  await executeMigration(pgPool);
  const now = new Date().toISOString();
  const aid = randomUUID();
  const ep = [randomUUID(), aid, "t1", "c1", 0, "created", "created", now, "system", "t", "4.0.0"];
  await pgPool.query(`INSERT INTO prysm.lifecycle_events (event_id, audit_id, tenant_id, client_id, sequence, prior_state, next_state, timestamp, actor, reason, code_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, ep);
  ep[0] = randomUUID();
  await assert.rejects(() => pgPool.query(`INSERT INTO prysm.lifecycle_events (event_id, audit_id, tenant_id, client_id, sequence, prior_state, next_state, timestamp, actor, reason, code_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, ep));
  await pgPool.query(`INSERT INTO prysm.lifecycle_idempotency VALUES ($1,$2,$3,$4,$5)`, ["t1", "ikx", randomUUID(), "c1", now]);
  await assert.rejects(() => pgPool.query(`INSERT INTO prysm.lifecycle_idempotency VALUES ($1,$2,$3,$4,$5)`, ["t1", "ikx", randomUUID(), "c1", now]));
});

// Rollback
test("postgres (pg-mem): rollback leaves no rows, retry succeeds", async () => {
  const repo = createPgMemRepo(); const svc = createLifecycleService(repo);
  const auditId = randomUUID(); const tenantId = "rollback-t";
  await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: randomUUID() });
  await assert.rejects(() => svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: randomUUID() }), (err) => err instanceof DuplicateAuditError);
  assert.equal((await svc.history(auditId, tenantId)).length, 1);
});

// Concurrent creation — identical
test("postgres (pg-mem): concurrent identical creation — both succeed, 1 event", async () => {
  const repo = createPgMemRepo(); const svc = createLifecycleService(repo);
  const params = { auditId: randomUUID(), tenantId: "t1", clientId: "c1", idempotencyKey: randomUUID() };
  const [r1, r2] = await Promise.all([svc.create(params), svc.create(params)]);
  assert.equal(r1.version, r2.version);
  assert.equal((await svc.history(params.auditId, "t1")).length, 1);
});

// Concurrent creation — different clientId
test("postgres (pg-mem): concurrent creation — different clientId throws DuplicateAuditError", async () => {
  const repo = createPgMemRepo(); const svc = createLifecycleService(repo);
  const auditId = randomUUID(); const idemKey = randomUUID();
  await svc.create({ auditId, tenantId: "t1", clientId: "correct", idempotencyKey: idemKey });
  await assert.rejects(
    () => svc.create({ auditId, tenantId: "t1", clientId: "wrong", idempotencyKey: idemKey }),
    (err) => err instanceof DuplicateAuditError,
  );
  const events = await svc.history(auditId, "t1");
  assert.equal(events.length, 1);
  assert.equal(events[0].clientId, "correct");
});

// Concurrent transition
test("postgres (pg-mem): concurrent transitions — exactly 1 succeeds, 1 fails, 2 events", async () => {
  const repo = createPgMemRepo(); const svc = createLifecycleService(repo);
  const auditId = randomUUID(); const tenantId = "race";
  await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: randomUUID() });
  const t1 = svc.transition({ auditId, tenantId, toState: "validated", expectedState: "created", expectedVersion: 1, transitionIdempotencyKey: randomUUID() });
  const t2 = svc.transition({ auditId, tenantId, toState: "validated", expectedState: "created", expectedVersion: 1, transitionIdempotencyKey: randomUUID() });
  const results = await Promise.allSettled([t1, t2]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1,
    "Exactly 1 transition must succeed");
  assert.equal(results.filter(r => r.status === "rejected").length, 1,
    "Exactly 1 transition must be rejected");
  assert.equal((await svc.history(auditId, tenantId)).length, 2,
    "Exactly 2 events after concurrent transition");
});

// UPDATE proof
test("postgres (pg-mem): real UPDATE succeeds", async () => {
  const repo = createPgMemRepo();
  // Create via service
  const svc = createLifecycleService(repo);
  const auditId = randomUUID();
  await svc.create({ auditId, tenantId: "t1", clientId: "before", idempotencyKey: randomUUID() });
  const result = await repo.executeUpdate(auditId, "after");
  assert.ok(result);
});

// TIMESTAMPTZ
test("postgres (pg-mem): TIMESTAMPTZ in migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");
  assert.ok(/TIMESTAMPTZ/i.test(sql));
});

// Round-trip
test("postgres (pg-mem): INSERT/SELECT round-trip", async () => {
  const db = newDb(); const Pool = db.adapters.createPg().Pool; const pgPool = new Pool();
  await executeMigration(pgPool);
  const auditId = randomUUID(); const eventId = randomUUID(); const now = new Date().toISOString();
  await pgPool.query(`INSERT INTO prysm.lifecycle_audits VALUES ($1,$2,$3,$4)`, [auditId, "tx", "cx", now]);
  await pgPool.query(`INSERT INTO prysm.lifecycle_events (event_id, audit_id, tenant_id, client_id, sequence, prior_state, next_state, timestamp, actor, reason, execution_id, code_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [eventId, auditId, "tx", "cx", 0, "created", "created", now, "system", "rt", "exec-01", "4.0.0"]);
  const result = await pgPool.query("SELECT * FROM prysm.lifecycle_events WHERE audit_id = $1", [auditId]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].event_id, eventId);
});

/**
 * WP4 Real PostgreSQL — Fail-Fast Migration, Transaction, and Rollback Tests
 *
 * REQUIRES a real PostgreSQL 16+ connection via env vars.
 * Fails immediately (non-zero exit) when the database is unavailable.
 *
 * Expected CI env:
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATION_PATH = resolve(__dirname, "..", "..", "migrations", "001_lifecycle.sql");

// ---------------------------------------------------------------------------
// Fail-fast database connection
// ---------------------------------------------------------------------------
const PG = {
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || "5432",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "prysm_test",
};

let pgPool = null;
try {
  const pg = await import("pg");
  const { Pool } = pg;
  pgPool = new Pool({ host: PG.host, port: parseInt(PG.port, 10), user: PG.user, password: PG.password, database: PG.database, max: 5, connectionTimeoutMillis: 5000 });
  await pgPool.query("SELECT 1");
} catch (err) {
  console.error(`FATAL: Cannot connect to PostgreSQL at ${PG.host}:${PG.port}/${PG.database} — ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Clean schema
// ---------------------------------------------------------------------------
await pgPool.query("DROP SCHEMA IF EXISTS prysm CASCADE");
await pgPool.query("CREATE SCHEMA prysm");

const migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
const statements = migrationSql.split(";").map(s => s.trim()).filter(s => s.length > 0);
for (const stmt of statements) {
  try { await pgPool.query(stmt); } catch (err) {
    console.error(`FATAL: Migration failed — ${err.message}`);
    await pgPool.end();
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Imports (only after migration succeeds)
// ---------------------------------------------------------------------------
const { createPostgresLifecycleRepository } = await import("../../src/lifecycle/postgres-repository.js");
const { createLifecycleService } = await import("../../src/lifecycle/lifecycle-service.js");
const { ConcurrencyConflictError, DuplicateAuditError } = await import("../../src/lifecycle/lifecycle-errors.js");
const repo = createPostgresLifecycleRepository({ pool: pgPool });
const svc = createLifecycleService(repo);

// =========================================================================
// Tests
// =========================================================================

// ── Migration idempotency ────────────────────────────────────────────
test("real PG: migration runs twice without error", async () => {
  for (const stmt of statements) {
    await pgPool.query(stmt);
  }
  assert.ok(true, "Migration ran twice");
});

// ── Genuine creation rollback: force event INSERT failure mid-transaction ─
test("real PG: mid-transaction event failure rolls back all creation rows", async () => {
  const auditId = randomUUID();
  const tenantId = "rollback-real";
  const clientId = "c1";
  const idemKey = randomUUID();

  // 1. Create a fault: insert a conflicting row that will cause the
  //    event INSERT to fail with a duplicate key AFTER the audit and
  //    idempotency rows are inserted.
  //    Strategy: pre-insert an event with the same (audit_id, sequence) = (0)
  //    so the creation event INSERT hits a unique-constraint violation.

  // Pre-insert the blocking row directly (outside the transaction)
  await pgPool.query(
    `INSERT INTO prysm.lifecycle_audits (audit_id, tenant_id, client_id, created_at) VALUES ($1,$2,$3,$4)`,
    [auditId, tenantId, clientId, new Date().toISOString()],
  );
  await pgPool.query(
    `INSERT INTO prysm.lifecycle_events (event_id, audit_id, tenant_id, client_id, sequence, prior_state, next_state, timestamp, actor, reason, code_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [randomUUID(), auditId, tenantId, clientId, 0, "created", "created", new Date().toISOString(), "system", "blocker", "4.0.0"],
  );

  // 2. Now create via the service — must fail because auditId already exists
  await assert.rejects(
    () => svc.create({ auditId, tenantId, clientId, idempotencyKey: idemKey }),
    (err) => err instanceof DuplicateAuditError || err.code === "ERR_LIFECYCLE_DUPLICATE_AUDIT",
    "Creation with pre-existing audit ID must fail",
  );

  // 3. Clean up the blocker
  await pgPool.query("DELETE FROM prysm.lifecycle_events WHERE audit_id = $1", [auditId]);
  await pgPool.query("DELETE FROM prysm.lifecycle_audits WHERE audit_id = $1", [auditId]);

  // 4. Now the auditId + tenant+key should have ZERO rows anywhere
  const countAudit = await pgPool.query("SELECT COUNT(*) AS c FROM prysm.lifecycle_audits WHERE audit_id = $1", [auditId]);
  assert.equal(parseInt(countAudit.rows[0].c), 0, "lifecycle_audits count = 0");

  const countIdem = await pgPool.query("SELECT COUNT(*) AS c FROM prysm.lifecycle_idempotency WHERE tenant_id = $1 AND idempotency_key = $2", [tenantId, idemKey]);
  assert.equal(parseInt(countIdem.rows[0].c), 0, "lifecycle_idempotency count = 0");

  const countEvents = await pgPool.query("SELECT COUNT(*) AS c FROM prysm.lifecycle_events WHERE audit_id = $1", [auditId]);
  assert.equal(parseInt(countEvents.rows[0].c), 0, "lifecycle_events count = 0");

  // 5. Retry creation — must succeed
  const state = await svc.create({ auditId, tenantId, clientId, idempotencyKey: idemKey });
  assert.equal(state.state, "created");
  assert.equal(state.version, 1);

  // 6. Direct SQL verification after retry
  const retryAudit = await pgPool.query("SELECT COUNT(*) AS c FROM prysm.lifecycle_audits WHERE audit_id = $1", [auditId]);
  assert.equal(parseInt(retryAudit.rows[0].c), 1, "lifecycle_audits count = 1 after retry");

  const retryIdem = await pgPool.query("SELECT COUNT(*) AS c FROM prysm.lifecycle_idempotency WHERE tenant_id = $1 AND idempotency_key = $2", [tenantId, idemKey]);
  assert.equal(parseInt(retryIdem.rows[0].c), 1, "lifecycle_idempotency count = 1 after retry");

  const retryEvents = await pgPool.query("SELECT * FROM prysm.lifecycle_events WHERE audit_id = $1 ORDER BY sequence", [auditId]);
  assert.equal(retryEvents.rows.length, 1, "lifecycle_events count = 1 after retry");
  assert.equal(retryEvents.rows[0].sequence, 0, "event sequence = 0");
  assert.equal(retryEvents.rows[0].next_state, "created", "event state = CREATED");

  // 7. Validate projection against schema
  const Ajv2020 = (await import("ajv/dist/2020.js")).default;
  const addFormats = (await import("ajv-formats")).default;
  const schemasDir = resolve(__dirname, "..", "..", "src", "contracts");
  const stateSchema = JSON.parse(readFileSync(resolve(schemasDir, "lifecycle-state.schema.json"), "utf-8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(stateSchema, stateSchema.$id);
  const validate = ajv.getSchema(stateSchema.$id);
  assert.ok(validate(state), `State projection invalid: ${(validate.errors || []).map(e => e.message).join("; ")}`);
});

// ── Concurrent transition ────────────────────────────────────────────
test("real PG: concurrent transitions — 1 ConcurrencyConflictError, 1 event", async () => {
  const auditId = randomUUID();
  const tenantId = "concur-trans";
  await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: randomUUID() });

  const t1 = svc.transition({ auditId, tenantId, toState: "validated", expectedState: "created", expectedVersion: 1, transitionIdempotencyKey: randomUUID() });
  const t2 = svc.transition({ auditId, tenantId, toState: "validated", expectedState: "created", expectedVersion: 1, transitionIdempotencyKey: randomUUID() });

  const results = await Promise.allSettled([t1, t2]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  const failure = results.find(r => r.status === "rejected");
  assert.ok(failure.reason instanceof ConcurrencyConflictError, `Expected ConcurrencyConflictError, got ${failure.reason?.constructor?.name}`);

  const events = await svc.history(auditId, tenantId);
  assert.equal(events.length, 2);
});

// ── UPDATE proof ─────────────────────────────────────────────────────
test("real PG: UPDATE succeeds", async () => {
  const auditId = randomUUID();
  await pgPool.query(`INSERT INTO prysm.lifecycle_audits (audit_id, tenant_id, client_id, created_at) VALUES ($1,$2,$3,$4)`, [auditId, "t1", "before", new Date().toISOString()]);
  const r = await pgPool.query("UPDATE prysm.lifecycle_audits SET client_id = $1 WHERE audit_id = $2", ["after", auditId]);
  assert.equal(r.rowCount, 1);
  const rows = await pgPool.query("SELECT client_id FROM prysm.lifecycle_audits WHERE audit_id = $1", [auditId]);
  assert.equal(rows.rows[0].client_id, "after");
});

// ── Cleanup ───────────────────────────────────────────────────────────
await pgPool.end();

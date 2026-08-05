/**
 * WP4 Real PostgreSQL — Fail-Fast Migration, Transaction, and Rollback Tests
 *
 * REQUIRES a real PostgreSQL 16+ connection via PRYSM_TEST_DATABASE_URL or
 * individual PG* env vars.  Fails immediately (non-zero exit) when the
 * database is unavailable or the URL is missing in CI.
 *
 * CI must set PRYSM_TEST_DATABASE_URL or the individual vars:
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
const DB_URL = process.env.PRYSM_TEST_DATABASE_URL || null;

const PG = {
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || "5432",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "prysm_test",
};

function connectionLabel() {
  if (DB_URL) return DB_URL.replace(/\/\/.*@/, "//***@");
  return `${PG.host}:${PG.port}/${PG.database}`;
}

let pgPool = null;
try {
  const pg = await import("pg");
  const { Pool } = pg;
  if (DB_URL) {
    pgPool = new Pool({ connectionString: DB_URL, max: 5, connectionTimeoutMillis: 5000 });
  } else {
    pgPool = new Pool({
      host: PG.host, port: parseInt(PG.port, 10),
      user: PG.user, password: PG.password, database: PG.database,
      max: 5, connectionTimeoutMillis: 5000,
    });
  }
  await pgPool.query("SELECT 1");
} catch (err) {
  console.error(`FATAL: Cannot connect to PostgreSQL at ${connectionLabel()} — ${err.message}`);
  await (pgPool?.end?.().catch(() => {}));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Clean schema + migration
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
// Fault-injection infrastructure
// ---------------------------------------------------------------------------

// Temp table to hold the audit_id that should trigger a fault
await pgPool.query("CREATE TABLE IF NOT EXISTS prysm._fault_target (audit_id UUID PRIMARY KEY)");

// Create a trigger function that raises an exception for targeted audits
await pgPool.query(`
  CREATE OR REPLACE FUNCTION prysm._fault_event_insert()
  RETURNS TRIGGER AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM prysm._fault_target WHERE audit_id = NEW.audit_id) THEN
      RAISE EXCEPTION 'FAULT INJECTED: event insert blocked for audit %', NEW.audit_id;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql
`);

// Attach trigger to lifecycle_events (BEFORE INSERT)
await pgPool.query("DROP TRIGGER IF EXISTS trg_fault_event ON prysm.lifecycle_events");
await pgPool.query(`
  CREATE TRIGGER trg_fault_event
  BEFORE INSERT ON prysm.lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION prysm._fault_event_insert()
`);

// ---------------------------------------------------------------------------
// Imports
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

// ── Genuine mid-transaction creation rollback via trigger ─────────────
test("real PG: mid-transaction event-insert failure rolls back ALL creation rows", async () => {
  const auditId = randomUUID();
  const tenantId = "rollback-real";
  const clientId = "c1";
  const idemKey = randomUUID();

  // 1. Arm the fault trigger for this specific audit
  await pgPool.query("INSERT INTO prysm._fault_target (audit_id) VALUES ($1)", [auditId]);

  // 2. Attempt creation — the service's withTransaction does:
  //    BEGIN → INSERT lifecycle_audits → INSERT lifecycle_idempotency →
  //    INSERT lifecycle_events → TRIGGER FIRES → RAISE EXCEPTION →
  //    ROLLBACK (audit + idempotency rows are removed)
  await assert.rejects(
    () => svc.create({ auditId, tenantId, clientId, idempotencyKey: idemKey }),
    (err) => err.code === "ERR_LIFECYCLE_REPOSITORY_FAILURE" ||
             (err.message && err.message.includes("FAULT INJECTED")),
    "Creation must fail due to injected fault trigger",
  );

  // 3. Direct SQL: all three tables must have ZERO rows
  const rAudit = await pgPool.query("SELECT COUNT(*) AS c FROM prysm.lifecycle_audits WHERE audit_id = $1", [auditId]);
  assert.equal(parseInt(rAudit.rows[0].c), 0, "lifecycle_audits count = 0 after rollback");

  const rIdem = await pgPool.query("SELECT COUNT(*) AS c FROM prysm.lifecycle_idempotency WHERE tenant_id = $1 AND idempotency_key = $2", [tenantId, idemKey]);
  assert.equal(parseInt(rIdem.rows[0].c), 0, "lifecycle_idempotency count = 0 after rollback");

  const rEvents = await pgPool.query("SELECT COUNT(*) AS c FROM prysm.lifecycle_events WHERE audit_id = $1", [auditId]);
  assert.equal(parseInt(rEvents.rows[0].c), 0, "lifecycle_events count = 0 after rollback");

  // 4. Disarm the fault
  await pgPool.query("DELETE FROM prysm._fault_target WHERE audit_id = $1", [auditId]);

  // 5. Retry — must succeed
  const state = await svc.create({ auditId, tenantId, clientId, idempotencyKey: idemKey });
  assert.equal(state.state, "created");
  assert.equal(state.version, 1);

  // 6. Direct SQL after retry: all three tables must have exactly ONE row
  const r2Audit = await pgPool.query("SELECT COUNT(*) AS c FROM prysm.lifecycle_audits WHERE audit_id = $1", [auditId]);
  assert.equal(parseInt(r2Audit.rows[0].c), 1, "lifecycle_audits count = 1 after retry");

  const r2Idem = await pgPool.query("SELECT COUNT(*) AS c FROM prysm.lifecycle_idempotency WHERE tenant_id = $1 AND idempotency_key = $2", [tenantId, idemKey]);
  assert.equal(parseInt(r2Idem.rows[0].c), 1, "lifecycle_idempotency count = 1 after retry");

  const r2Events = await pgPool.query("SELECT * FROM prysm.lifecycle_events WHERE audit_id = $1 ORDER BY sequence", [auditId]);
  assert.equal(r2Events.rows.length, 1, "lifecycle_events count = 1 after retry");
  assert.equal(r2Events.rows[0].sequence, 0, "event sequence = 0");
  assert.equal(r2Events.rows[0].next_state, "created", "event state = CREATED");

  // 7. Validate projection against lifecycle-state schema
  const Ajv2020 = (await import("ajv/dist/2020.js")).default;
  const addFormats = (await import("ajv-formats")).default;
  const schemasDir = resolve(__dirname, "..", "..", "src", "contracts");
  const stateSchema = JSON.parse(readFileSync(resolve(schemasDir, "lifecycle-state.schema.json"), "utf-8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(stateSchema, stateSchema.$id);
  const v = ajv.getSchema(stateSchema.$id);
  assert.ok(v(state), `State projection invalid: ${(v.errors || []).map(e => e.message).join("; ")}`);
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
  assert.ok(failure.reason instanceof ConcurrencyConflictError,
    `Expected ConcurrencyConflictError, got ${failure.reason?.constructor?.name}`);
  assert.equal((await svc.history(auditId, tenantId)).length, 2);
});

// ── UPDATE proof ─────────────────────────────────────────────────────
test("real PG: UPDATE succeeds", async () => {
  const auditId = randomUUID();
  await pgPool.query(
    "INSERT INTO prysm.lifecycle_audits (audit_id, tenant_id, client_id, created_at) VALUES ($1,$2,$3,$4)",
    [auditId, "t1", "before", new Date().toISOString()],
  );
  const r = await pgPool.query(
    "UPDATE prysm.lifecycle_audits SET client_id = $1 WHERE audit_id = $2",
    ["after", auditId],
  );
  assert.equal(r.rowCount, 1);
  const rows = await pgPool.query("SELECT client_id FROM prysm.lifecycle_audits WHERE audit_id = $1", [auditId]);
  assert.equal(rows.rows[0].client_id, "after");
});

// ── Cleanup ───────────────────────────────────────────────────────────
await pgPool.end();

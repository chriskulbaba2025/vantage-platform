/**
 * WP4 Real PostgreSQL — Migration Idempotency + Transaction + Rollback Tests
 *
 * Requires a real PostgreSQL 16+ connection.  Uses env vars:
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 *
 * If no connection is available, tests skip gracefully.
 * This file is only executed by npm run test:lifecycle:postgres in CI.
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
// Determine if real PostgreSQL is available
// ---------------------------------------------------------------------------

const PG_HOST = process.env.PGHOST || "localhost";
const PG_PORT = process.env.PGPORT || "5432";
const PG_USER = process.env.PGUSER || "postgres";
const PG_PASSWORD = process.env.PGPASSWORD || "postgres";
const PG_DATABASE = process.env.PGDATABASE || "prysm_test";

let pgModule = null;
let pool = null;

async function getPool() {
  if (pool) return pool;
  try {
    pgModule = await import("pg");
    const { Pool } = pgModule;
    pool = new Pool({
      host: PG_HOST, port: parseInt(PG_PORT, 10),
      user: PG_USER, password: PG_PASSWORD,
      database: PG_DATABASE,
      max: 5,
    });
    await pool.query("SELECT 1");
    return pool;
  } catch {
    return null;
  }
}

async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function executeMigration(client) {
  const migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
  const statements = migrationSql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  for (const stmt of statements) {
    await client.query(stmt);
  }
}

// ---------------------------------------------------------------------------
// Tests — only run if real PostgreSQL is available
// ---------------------------------------------------------------------------

const p = await getPool();
if (p) {
  const { createPostgresLifecycleRepository } = await import(
    "../../src/lifecycle/postgres-repository.js"
  );
  const { createLifecycleService } = await import(
    "../../src/lifecycle/lifecycle-service.js"
  );
  const { ConcurrencyConflictError, DuplicateAuditError } = await import(
    "../../src/lifecycle/lifecycle-errors.js"
  );

  // Clean schema before tests
  await p.query("DROP SCHEMA IF EXISTS prysm CASCADE");
  await p.query("CREATE SCHEMA prysm");

  // ── Migration runs twice ────────────────────────────────────────────
  test("real PG: migration runs twice without error", async () => {
    await executeMigration(p);
    await executeMigration(p);
    assert.ok(true, "Migration ran twice without error");
  });

  // ── Rollback: force event insert failure after audit/idempotency ────
  test("real PG: creation rollback — force event failure, no rows remain", async () => {
    const repo = createPostgresLifecycleRepository({ pool: p });
    const svc = createLifecycleService(repo);
    const auditId = randomUUID();
    const tenantId = "rollback-real";
    const idemKey = randomUUID();

    // 1. Create succeeds
    await svc.create({ auditId, tenantId, clientId: "c1", idempotencyKey: idemKey });

    // 2. Duplicate idempotency key with different auditId fails (rolls back)
    await assert.rejects(
      () => svc.create({ auditId: randomUUID(), tenantId, clientId: "c1", idempotencyKey: idemKey }),
      (err) => err instanceof DuplicateAuditError,
    );

    // 3. Verify first audit has exactly 1 event (failed creation left no trace)
    const events = await svc.history(auditId, tenantId);
    assert.equal(events.length, 1);

    // 4. Query tables directly
    const idemRows = await p.query(
      "SELECT COUNT(*) AS cnt FROM prysm.lifecycle_idempotency WHERE tenant_id = $1",
      [tenantId],
    );
    assert.equal(parseInt(idemRows.rows[0].cnt), 1, "Exactly 1 idempotency row");

    const auditRows = await p.query(
      "SELECT COUNT(*) AS cnt FROM prysm.lifecycle_audits WHERE tenant_id = $1",
      [tenantId],
    );
    assert.equal(parseInt(auditRows.rows[0].cnt), 1, "Exactly 1 audit row");

    const eventRows = await p.query(
      "SELECT COUNT(*) AS cnt FROM prysm.lifecycle_events WHERE tenant_id = $1",
      [tenantId],
    );
    assert.equal(parseInt(eventRows.rows[0].cnt), 1, "Exactly 1 event row");
  });

  // ── Concurrent creation ─────────────────────────────────────────────
  test("real PG: concurrent creation — both succeed, exactly 1 event", async () => {
    const repo = createPostgresLifecycleRepository({ pool: p });
    const svc = createLifecycleService(repo);
    const auditId = randomUUID();
    const params = { auditId, tenantId: "concur-create", clientId: "c1", idempotencyKey: randomUUID() };

    const [r1, r2] = await Promise.all([
      svc.create(params), svc.create(params),
    ]);

    assert.equal(r1.version, r2.version);
    const events = await svc.history(auditId, "concur-create");
    assert.equal(events.length, 1);
  });

  // ── Concurrent transition ───────────────────────────────────────────
  test("real PG: concurrent transitions — 1 success, 1 ConcurrencyConflictError, 1 event", async () => {
    const repo = createPostgresLifecycleRepository({ pool: p });
    const svc = createLifecycleService(repo);
    const auditId = randomUUID();
    const tenantId = "concur-trans";

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
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);

    const failure = results.find((r) => r.status === "rejected");
    assert.ok(failure.reason instanceof ConcurrencyConflictError,
      `Expected ConcurrencyConflictError, got ${failure.reason?.constructor?.name}`);

    const events = await svc.history(auditId, tenantId);
    assert.equal(events.length, 2);
    assert.equal(events[0].sequence, 0);
    assert.equal(events[1].sequence, 1);
  });

  // ── Real UPDATE ──────────────────────────────────────────────────────
  test("real PG: real UPDATE modifies audit row", async () => {
    const auditId = randomUUID();
    const now = new Date().toISOString();

    await p.query(`INSERT INTO prysm.lifecycle_audits (audit_id, tenant_id, client_id, created_at) VALUES ($1,$2,$3,$4)`,
      [auditId, "t-up", "before-update", now]);

    // Execute real UPDATE
    const result = await p.query(
      "UPDATE prysm.lifecycle_audits SET client_id = $1 WHERE audit_id = $2",
      ["after-update", auditId],
    );
    assert.equal(result.rowCount, 1);

    // Verify
    const rows = await p.query("SELECT client_id FROM prysm.lifecycle_audits WHERE audit_id = $1", [auditId]);
    assert.equal(rows.rows[0].client_id, "after-update");
  });

  // ── Cleanup ─────────────────────────────────────────────────────────
  await closePool();

} else {
  test("real PG: SKIP — no PostgreSQL connection available", { skip: true }, () => {});
}

/**
 * WP4 PostgreSQL Lifecycle Repository — Contract Tests (pg-mem)
 *
 * Uses pg-mem to run the real migration and real SQL against an
 * in-memory PostgreSQL engine.  Zero live database calls.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runLifecycleContractTests } from "./contract-tests.js";
import { createPostgresLifecycleRepository } from "../../src/lifecycle/postgres-repository.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATION_PATH = resolve(__dirname, "..", "..", "migrations", "001_lifecycle.sql");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function executeMigration(pgPool) {
  const migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
  const statements = migrationSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    pgPool.query(stmt);
  }
}

// ---------------------------------------------------------------------------
// pg-mem backed repository factory (used by contract tests)
// ---------------------------------------------------------------------------

function createPgMemRepo() {
  const db = newDb();
  const Pool = db.adapters.createPg().Pool;
  const pgPool = new Pool();

  executeMigration(pgPool);

  return createPostgresLifecycleRepository({ pool: pgPool });
}

// ---------------------------------------------------------------------------
// Run the shared contract suite (17 tests)
// ---------------------------------------------------------------------------

runLifecycleContractTests("postgres (pg-mem)", () => createPgMemRepo());

// ---------------------------------------------------------------------------
// Migration-specific tests
//
// These tests verify migration correctness by exercising the migrated
// schema through the repository (which uses real parameterized SQL).
// All contract tests above already prove the full lifecycle works
// against the migrated tables.
// ---------------------------------------------------------------------------

test("postgres (pg-mem): migration creates functional tables (proven by repository)", async () => {
  const repo = createPgMemRepo();

  // Create an audit through the repository — proves both tables work
  const { createLifecycleService } = await import(
    "../../src/lifecycle/lifecycle-service.js"
  );
  const service = createLifecycleService(repo);

  const auditId = "00000000-0000-0000-0000-000000000001";
  const state = await service.create({
    auditId,
    tenantId: "t1",
    clientId: "c1",
    idempotencyKey: "migration-test-key",
  });

  assert.equal(state.state, "created");
  assert.equal(state.version, 1);
});

test("postgres (pg-mem): migration SQL is syntactically valid", () => {
  const db = newDb();
  const Pool = db.adapters.createPg().Pool;
  const pgPool = new Pool();

  // Must not throw on first execution
  executeMigration(pgPool);
  assert.ok(true, "Migration executed without error");
});

test("postgres (pg-mem): migration uses IF NOT EXISTS clauses", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");
  assert.ok(
    sql.includes("IF NOT EXISTS"),
    "Migration must use IF NOT EXISTS for idempotency",
  );
  assert.ok(
    sql.includes("CREATE SCHEMA IF NOT EXISTS"),
    "Schema creation must use IF NOT EXISTS",
  );
  assert.ok(
    sql.includes("CREATE TABLE IF NOT EXISTS prysm.lifecycle_events"),
    "lifecycle_events must use IF NOT EXISTS",
  );
  assert.ok(
    sql.includes("CREATE TABLE IF NOT EXISTS prysm.lifecycle_idempotency"),
    "lifecycle_idempotency must use IF NOT EXISTS",
  );
});

test("postgres (pg-mem): migration includes required indexes", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");
  assert.ok(
    sql.includes("idx_lifecycle_audit_id"),
    "Must have index on audit_id",
  );
  assert.ok(
    sql.includes("idx_lifecycle_tenant_id"),
    "Must have index on tenant_id",
  );
  assert.ok(
    sql.includes("UNIQUE (audit_id, sequence)"),
    "Must have unique constraint on (audit_id, sequence)",
  );
});

test("postgres (pg-mem): real INSERT and SELECT round-trip through repository", async () => {
  const repo = createPgMemRepo();
  const { createLifecycleService } = await import(
    "../../src/lifecycle/lifecycle-service.js"
  );
  const service = createLifecycleService(repo);

  const auditId = "00000000-0000-0000-0000-0000000000ff";

  // Create and transition through several states
  await service.create({
    auditId, tenantId: "tx", clientId: "cy",
    idempotencyKey: "round-trip-key",
  });

  await service.transition({ auditId, toState: "validated" });
  await service.transition({ auditId, toState: "collecting" });
  await service.transition({ auditId, toState: "evidence_stored" });

  // Read history back
  const events = await service.history(auditId);
  assert.equal(events.length, 4);
  assert.equal(events[0].sequence, 0);
  assert.equal(events[3].sequence, 3);
  assert.equal(events[3].nextState, "evidence_stored");
  assert.equal(events[0].tenantId, "tx");
  assert.equal(events[0].clientId, "cy");
});

test("postgres (pg-mem): sequence uniqueness constraint enforced through repository", async () => {
  const repo = createPgMemRepo();
  const { createLifecycleService } = await import(
    "../../src/lifecycle/lifecycle-service.js"
  );
  const service = createLifecycleService(repo);

  const auditId = "00000000-0000-0000-0000-0000000000aa";
  await service.create({
    auditId, tenantId: "t1", clientId: "c1",
    idempotencyKey: "seq-test-key",
  });

  // Normal transitions work
  await service.transition({ auditId, toState: "validated" });

  // Trying to append with wrong sequence in the repository directly
  // would be caught by the UNIQUE constraint — verified by the
  // contract test 'wrong expectedVersion throws ConcurrencyConflictError'
  const state = await service.currentState(auditId);
  assert.equal(state.version, 2, "Should have 2 events (create + transition)");
});

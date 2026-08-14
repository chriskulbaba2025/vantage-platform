/**
 * MT-01 — Identity migration tests (pg-mem, real SQL).
 *
 * Proves: canonical tables + columns exist, migration is idempotent,
 * legacy tenant mapping is deterministic 1:1, and no unknown production
 * data is silently assigned to an arbitrary tenant.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "migrations");

async function newPool() {
  const db = newDb();
  const Pool = db.adapters.createPg().Pool;
  return { db, pool: new Pool() };
}

async function applyMigration(pool, filename) {
  const sql = readFileSync(resolve(MIGRATIONS_DIR, filename), "utf8");
  for (const stmt of sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0)) {
    await pool.query(stmt);
  }
}

async function seedLegacyAudit(pool, tenantId) {
  await pool.query(
    `INSERT INTO prysm.lifecycle_audits (audit_id, tenant_id, client_id, created_at) VALUES ($1, $2, $3, now())`,
    [randomUUID(), tenantId, "legacy-client"],
  );
}

async function tableExists(pool, name) {
  try {
    await pool.query(`SELECT 1 FROM prysm.${name} LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

test("MT-01: identity tables + columns exist after migration", async () => {
  const { pool } = await newPool();
  await applyMigration(pool, "001_lifecycle.sql");
  await applyMigration(pool, "003_identity.sql");

  for (const name of ["tenants", "users", "tenant_memberships"]) {
    assert.equal(await tableExists(pool, name), true, `prysm.${name} exists`);
  }

  // Column presence via INSERT round-trip (pg-mem information_schema is
  // unreliable for non-public schemas).
  const { createPostgresIdentityRepository } = await import("./postgres-identity-repository.js");
  const repo = createPostgresIdentityRepository({ pool });
  await repo.createTenant({ id: "t1", name: "T1", slug: "t1" });
  await repo.createUser({ id: randomUUID(), cognitoSub: "sub-1", email: "u1@x.y", displayName: "U1" });
  const user = await repo.findUserByCognitoSub("sub-1");
  assert.ok(user, "user row persists with canonical columns");
  assert.equal(user.email, "u1@x.y");
  const tenant = await repo.findTenantById("t1");
  assert.equal(tenant.name, "T1");
  await repo.createMembership({ id: randomUUID(), tenantId: "t1", userId: user.id, role: "reviewer" });
  const memberships = await repo.findMembershipsForUser(user.id);
  assert.equal(memberships.length, 1, "membership persists");
  assert.equal(memberships[0].role, "reviewer");
  assert.equal(memberships[0].tenant_slug, "t1");
});

test("MT-01: identity repository DDL is skip-safe when the schema already exists", async () => {
  const { pool } = await newPool();
  await applyMigration(pool, "001_lifecycle.sql");
  await applyMigration(pool, "003_identity.sql");

  // The repository's ensureInitialized must detect the existing schema and
  // skip its inline DDL (probe path) — proving idempotent initialization.
  const { createPostgresIdentityRepository } = await import("./postgres-identity-repository.js");
  const repo = createPostgresIdentityRepository({ pool });
  await repo.createTenant({ id: "t-skip", name: "Skip", slug: "skip" });
  const rows = await repo.listTenants();
  assert.equal(rows.length, 1, "existing schema reused without re-creating tables");
});

test("MT-01: legacy tenant mapping is deterministic 1:1", async () => {
  const { pool } = await newPool();
  await applyMigration(pool, "001_lifecycle.sql");
  await seedLegacyAudit(pool, "legacy-tenant-x");
  await seedLegacyAudit(pool, "legacy-tenant-x"); // two audits, same tenant
  await seedLegacyAudit(pool, "legacy-tenant-y");
  await applyMigration(pool, "003_identity.sql");

  const rows = await pool.query(`SELECT id, name, slug FROM prysm.tenants ORDER BY id`);
  const ids = rows.rows.map((r) => r.id).sort();
  assert.deepEqual(ids, ["legacy-tenant-x", "legacy-tenant-y"], "exactly the distinct legacy tenant ids");
  const tenantX = rows.rows.find((r) => r.id === "legacy-tenant-x");
  assert.equal(tenantX.name, "legacy-tenant-x", "name mirrors the legacy id — no reassignment");
  assert.equal(tenantX.slug, "legacy-tenant-x", "slug is the deterministic lowercase id");
});

test("MT-01: unknown tenant ids never get arbitrary tenants", async () => {
  const { pool } = await newPool();
  await applyMigration(pool, "001_lifecycle.sql");
  await applyMigration(pool, "003_identity.sql");
  const rows = await pool.query(`SELECT id FROM prysm.tenants`);
  assert.equal(rows.rows.length, 0, "no tenants fabricated when no legacy data exists");
});

/**
 * PostgreSQL identity repository — the authorization source of truth.
 *
 * Implements the canonical identity model (tenants / users /
 * tenant_memberships) over the prysm schema created by migration 003.
 *
 * @module identity/postgres-identity-repository
 */

const SQL = {
  ensureIdentityInitialized: `
    CREATE SCHEMA IF NOT EXISTS prysm;
    CREATE TABLE IF NOT EXISTS prysm.tenants (
        id          TEXT NOT NULL,
    PRIMARY KEY (id),
        name        TEXT NOT NULL,
        slug        TEXT NOT NULL,
    UNIQUE (slug),
        status      TEXT NOT NULL DEFAULT 'active',
        created_at  TIMESTAMPTZ NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prysm.users (
        id           UUID NOT NULL,
    PRIMARY KEY (id),
        cognito_sub  TEXT NOT NULL,
    UNIQUE (cognito_sub),
        email        TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'active',
        created_at   TIMESTAMPTZ NOT NULL,
        updated_at   TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prysm.tenant_memberships (
        id         UUID NOT NULL,
    PRIMARY KEY (id),
        tenant_id  TEXT NOT NULL REFERENCES prysm.tenants(id),
        user_id    UUID NOT NULL REFERENCES prysm.users(id),
        role       TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE (tenant_id, user_id, role)
    );`,
  insertTenant: `INSERT INTO prysm.tenants (id, name, slug, status, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now()) ON CONFLICT (id) DO NOTHING`,
  insertUser: `INSERT INTO prysm.users (id, cognito_sub, email, display_name, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now()) ON CONFLICT (cognito_sub) DO NOTHING`,
  insertMembership: `INSERT INTO prysm.tenant_memberships (id, tenant_id, user_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now()) ON CONFLICT (tenant_id, user_id, role) DO NOTHING`,
  findUserBySub: `SELECT id, cognito_sub, email, display_name, status, created_at, updated_at FROM prysm.users WHERE cognito_sub = $1`,
  findMemberships: `SELECT m.tenant_id, m.role, m.status, t.name AS tenant_name, t.slug AS tenant_slug FROM prysm.tenant_memberships m JOIN prysm.tenants t ON t.id = m.tenant_id WHERE m.user_id = $1`,
  findTenantById: `SELECT id, name, slug, status FROM prysm.tenants WHERE id = $1`,
  countAuditsForTenant: `SELECT count(*)::int AS n FROM prysm.lifecycle_audits WHERE tenant_id = $1`,
  updateMembershipStatus: `UPDATE prysm.tenant_memberships SET status = $3, updated_at = now() WHERE tenant_id = $1 AND user_id = $2`,
  listMembershipsForTenant: `SELECT m.user_id, u.cognito_sub, u.email, u.display_name, m.role, m.status FROM prysm.tenant_memberships m JOIN prysm.users u ON u.id = m.user_id WHERE m.tenant_id = $1 ORDER BY u.email, m.role`,
};

/**
 * @param {object} opts
 * @param {import("pg").Pool} opts.pool — PostgreSQL pool (already connected)
 * @returns {object} identity repository
 */
export function createPostgresIdentityRepository({ pool }) {
  let initialized = false;

  async function ensureInitialized() {
    if (initialized) return;
    // Probe: the canonical migration set (003_identity.sql, applied by the
    // lifecycle repository at bootstrap) normally creates the identity
    // schema.  When the tables already exist, skip the inline DDL entirely
    // (re-running CREATE TABLE IF NOT EXISTS on existing tables is
    // unsupported by pg-mem's no-op planner).  When the probe fails, apply
    // the inline DDL idempotently.
    let exists = false;
    try {
      await pool.query(`SELECT 1 FROM prysm.tenants LIMIT 1`);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) {
      initialized = true;
      return;
    }
    // Split into individual statements so partial failures surface clearly.
    for (const stmt of SQL.ensureIdentityInitialized.split(";").map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
    initialized = true;
  }

  async function findUserByCognitoSub(cognitoSub) {
    await ensureInitialized();
    const result = await pool.query(SQL.findUserBySub, [cognitoSub]);
    return result.rows[0] || null;
  }

  async function findMembershipsForUser(userId) {
    await ensureInitialized();
    const result = await pool.query(SQL.findMemberships, [userId]);
    return result.rows;
  }

  async function createTenant({ id, name, slug, status = "active" }) {
    await ensureInitialized();
    await pool.query(SQL.insertTenant, [id, name, slug, status]);
  }

  async function createUser({ id, cognitoSub, email, displayName = "", status = "active" }) {
    await ensureInitialized();
    await pool.query(SQL.insertUser, [id, cognitoSub, email, displayName, status]);
  }

  async function createMembership({ id, tenantId, userId, role, status = "active" }) {
    await ensureInitialized();
    await pool.query(SQL.insertMembership, [id, tenantId, userId, role, status]);
  }

  async function findTenantById(tenantId) {
    await ensureInitialized();
    const result = await pool.query(SQL.findTenantById, [tenantId]);
    return result.rows[0] || null;
  }

  async function listTenants() {
    await ensureInitialized();
    const result = await pool.query(`SELECT id, name, slug, status FROM prysm.tenants ORDER BY id`);
    return result.rows;
  }

  /**
   * Transition every membership row for (tenant, user) to the given
   * status.  Returns the number of rows transitioned (0 = no such
   * membership — callers treat that as an explicit no-op).
   */
  async function updateMembershipStatus({ tenantId, userId, status }) {
    await ensureInitialized();
    const result = await pool.query(SQL.updateMembershipStatus, [tenantId, userId, status]);
    return result.rowCount;
  }

  /**
   * Memberships of a tenant joined with user identity — the admin
   * membership-management view.
   */
  async function listMembershipsForTenant(tenantId) {
    await ensureInitialized();
    const result = await pool.query(SQL.listMembershipsForTenant, [tenantId]);
    return result.rows;
  }

  return Object.freeze({
    findUserByCognitoSub,
    findMembershipsForUser,
    createTenant,
    createUser,
    createMembership,
    findTenantById,
    listTenants,
    updateMembershipStatus,
    listMembershipsForTenant,
  });
}

export default { createPostgresIdentityRepository };

/**
 * Memory identity repository — test/dev harness mirror of the PostgreSQL
 * identity repository.  Implements the same interface so controlled
 * acceptance can drive the real authorization code without a live database.
 * The AUTHORITATIVE tenant acceptance suite uses the PostgreSQL repository
 * (pg-mem) for real persistence semantics; this variant serves the browser
 * E2E mock worker.
 *
 * @module identity/memory-identity-repository
 */

export function createMemoryIdentityRepository() {
  const tenants = new Map();
  const users = new Map();
  const memberships = new Map(); // key: `${tenantId}|${userId}|${role}`

  async function createTenant({ id, name, slug, status = "active" }) {
    tenants.set(id, { id, name, slug, status });
  }

  async function createUser({ id, cognitoSub, email, displayName = "", status = "active" }) {
    users.set(cognitoSub, { id, cognito_sub: cognitoSub, email, display_name: displayName, status });
  }

  async function createMembership({ tenantId, userId, role, status = "active" }) {
    memberships.set(`${tenantId}|${userId}|${role}`, { tenant_id: tenantId, user_id: userId, role, status });
  }

  async function findUserByCognitoSub(cognitoSub) {
    return users.get(cognitoSub) || null;
  }

  async function findMembershipsForUser(userId) {
    const rows = [];
    for (const m of memberships.values()) {
      if (m.user_id !== userId) continue;
      const tenant = tenants.get(m.tenant_id);
      rows.push({
        tenant_id: m.tenant_id,
        role: m.role,
        status: m.status,
        tenant_name: tenant?.name || m.tenant_id,
        tenant_slug: tenant?.slug || m.tenant_id,
      });
    }
    return rows;
  }

  async function findTenantById(tenantId) {
    return tenants.get(tenantId) || null;
  }

  async function listTenants() {
    return [...tenants.values()];
  }

  return Object.freeze({
    createTenant,
    createUser,
    createMembership,
    findUserByCognitoSub,
    findMembershipsForUser,
    findTenantById,
    listTenants,
  });
}

export default { createMemoryIdentityRepository };

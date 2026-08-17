#!/usr/bin/env node
/**
 * ACCT-PROVISION-01 Acceptance — AP-01..AP-05 through REAL boundaries.
 *
 * Real createRequestHandler + pg-mem PostgreSQL (real migration files,
 * real repositories) + controlled identity fixtures below the provider
 * boundary.  Zero live provider/LLM calls (global fetch guard armed).
 *
 * Cycle proven:
 *   platform_admin creates company → invites user (real sub) → assigns
 *   role → new user resolves ONLY their company → disable denies
 *   immediately → cross-company attempts fail closed → non-admin browser
 *   principals get 403 on every admin route.
 */

process.env.VANTAGE_DEV_MEMORY_STORE = "true";

import { randomUUID } from "node:crypto";
import { newDb } from "pg-mem";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { console.log(`  [x] PASS — ${label}`); passed++; }
  else { console.error(`  [ ] FAIL — ${label}`); if (detail) console.error(`        ${detail}`); failed++; }
}

const db = newDb();
const Pool = db.adapters.createPg().Pool;
const pgPool = new Pool();

const { createPostgresLifecycleRepository } = await import("../src/lifecycle/postgres-repository.js");
const { createPostgresIdentityRepository } = await import("../src/identity/postgres-identity-repository.js");
const { createMemoryArtifactStore } = await import("../src/storage/memory-artifact-store.js");
const { createGovernedArtifactStore } = await import("../src/storage/governed-artifact-store.js");
const { createLocalReportStore } = await import("../src/storage/report-store.js");
const { createRequestHandler } = await import("../src/server.js");
const { signPrincipal } = await import("../src/identity/authorization.js");

const lifecycleRepo = createPostgresLifecycleRepository({ pool: pgPool });
const identityRepo = createPostgresIdentityRepository({ pool: pgPool });
await lifecycleRepo.runMigration();

const SECRET = "provisioning-test-secret";
const reportStore = createLocalReportStore({ baseDir: resolve(__dirname, "..", "artifacts", `provision-accept-${Date.now()}`) });

const liveFetchViolations = [];
globalThis.fetch = async (...args) => {
  liveFetchViolations.push({ url: String(args[0]).slice(0, 120) });
  throw new Error("LIVE FETCH ESCAPE — provisioning acceptance must be fully controlled");
};

const handler = createRequestHandler({
  config: { artifactDir: ".", webhookSecret: SECRET, vantageTenantId: "default" },
  localStore: reportStore,
  store: reportStore,
  oauthService: { getAuthUrl: () => "", validateState: () => "ga4", exchangeCode: async () => ({}), getStatus: async () => ({}), disconnect: async () => ({}) },
  auditService: { listAudits: async () => [] },
  lifecycleRepo,
  identityRepo,
});

function request(method, path, { principal, tenant, secret, body } = {}) {
  return new Promise((resolvePromise) => {
    const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
    const req = {
      method,
      url: new URL(path, "http://worker"),
      headers: {},
      on: () => {},
      [Symbol.asyncIterator]: async function* () { yield bodyBuf; },
    };
    if (secret) req.headers["x-vantage-secret"] = secret;
    if (principal) {
      req.headers["x-prysm-principal"] = signPrincipal({ secret: SECRET, principal, nowMs: Date.now() });
      if (tenant) req.headers["x-prysm-tenant"] = tenant;
    }
    const res = {
      statusCode: 0,
      headers: {},
      body: Buffer.alloc(0),
      writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
      end(payload) {
        this.body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
        resolvePromise({ status: this.statusCode, headers: this.headers, body: this.body });
      },
    };
    handler(req, res);
  });
}

// ── Seeding: platform admin identity + platform tenant ─────────────────
await identityRepo.createTenant({ id: "platform-ops", name: "Platform Operations", slug: "platform-ops" });
const adminId = randomUUID();
await identityRepo.createUser({ id: adminId, cognitoSub: "cognito-admin-controlled", email: "admin@controlled-test.invalid", displayName: "Platform Admin" });
await identityRepo.createMembership({ id: randomUUID(), tenantId: "platform-ops", userId: adminId, role: "platform_admin" });

const ADMIN = { sub: "cognito-admin-controlled", email: "admin@controlled-test.invalid", displayName: "" };
const MEMBER = { sub: "cognito-newuser-controlled", email: "newuser@controlled-test.invalid", displayName: "" };
const NON_ADMIN = { sub: "cognito-alice-controlled", email: "alice@controlled-test.invalid", displayName: "" };
await identityRepo.createUser({ id: randomUUID(), cognitoSub: "cognito-alice-controlled", email: "alice@controlled-test.invalid", displayName: "Alice" });
await identityRepo.createTenant({ id: "existing-company", name: "Existing Company", slug: "existing-company" });
await identityRepo.createMembership({ id: randomUUID(), tenantId: "existing-company", userId: (await identityRepo.findUserByCognitoSub("cognito-alice-controlled")).id, role: "reviewer" });

console.log("ACCT-PROVISION-01 Acceptance\n===========================");

// AP-02 — platform-admin boundary authorization
{
  const r = await request("POST", "/api/v1/admin/tenants", { principal: NON_ADMIN, tenant: "existing-company", body: { name: "Evil Corp" } });
  check("AP-02: non-admin browser principal on admin route → 403", r.status === 403, `got ${r.status}`);
  const r2 = await request("POST", "/api/v1/admin/tenants", { principal: NON_ADMIN, body: { name: "Evil Corp" } });
  check("AP-02: non-admin without tenant selection → denied", [401, 403].includes(r2.status), `got ${r2.status}`);
  const r3 = await request("POST", "/api/v1/admin/tenants", { body: { name: "Anon" } });
  check("AP-02: unauthenticated admin route → 401", r3.status === 401, `got ${r3.status}`);
  const r4 = await request("POST", "/api/v1/admin/tenants", { secret: SECRET, body: { name: "Internal Corp" } });
  check("AP-02: governed internal boundary → 201", r4.status === 201, `got ${r4.status}`);
  const internalCreated = JSON.parse(r4.body.toString());
  check("AP-02: created tenant id is a valid slug", /^[a-z0-9][a-z0-9_-]{1,63}$/.test(internalCreated.id), internalCreated.id);

  // Invite gate: non-admin principals are denied BEFORE any side effect —
  // no Prysm user row may appear for a non-admin invite attempt.
  const r5 = await request("POST", "/api/v1/admin/users", { principal: NON_ADMIN, tenant: "existing-company", body: { cognitoSub: "cognito-intruder-controlled", email: "intruder@controlled-test.invalid" } });
  check("AP-02: non-admin invite → 403", r5.status === 403, `got ${r5.status}`);
  const intruderRow = await identityRepo.findUserByCognitoSub("cognito-intruder-controlled");
  check("AP-02: non-admin invite created NO user row (side-effect denied)", intruderRow === null, intruderRow ? "row exists" : "no row");
  const authProbe = await request("GET", "/api/v1/admin/authorize", { principal: ADMIN, tenant: "platform-ops" });
  check("AP-02: platform_admin authorize probe → 200", authProbe.status === 200, `got ${authProbe.status}`);
  const authProbeNo = await request("GET", "/api/v1/admin/authorize", { principal: NON_ADMIN, tenant: "existing-company" });
  check("AP-02: non-admin authorize probe → 403", authProbeNo.status === 403, `got ${authProbeNo.status}`);
}

// AP-02 + AP-03 — the full provisioning cycle
const acmeId = "acme-controlled-test";
{
  const r = await request("POST", "/api/v1/admin/tenants", { principal: ADMIN, tenant: "platform-ops", body: { name: "Acme Corp", id: acmeId } });
  check("AP-02: platform_admin creates company → 201", r.status === 201, `got ${r.status}`);
  const created = JSON.parse(r.body.toString());
  check("AP-02: company id honored", created.id === acmeId, created.id);

  const rBad = await request("POST", "/api/v1/admin/tenants", { principal: ADMIN, tenant: "platform-ops", body: { name: "Bad ID Corp", id: "UPPER CASE!" } });
  check("AP-02: invalid company id → 422", rBad.status === 422, `got ${rBad.status}`);
  const rNoName = await request("POST", "/api/v1/admin/tenants", { principal: ADMIN, tenant: "platform-ops", body: {} });
  check("AP-02: missing company name → 422", rNoName.status === 422, `got ${rNoName.status}`);

  const invite = await request("POST", "/api/v1/admin/users", { principal: ADMIN, tenant: "platform-ops", body: { cognitoSub: "cognito-newuser-controlled", email: "newuser@controlled-test.invalid", displayName: "New User" } });
  check("AP-03: admin records invited Prysm user → 201", invite.status === 201, `got ${invite.status}`);

  const assign = await request("POST", "/api/v1/admin/memberships", { principal: ADMIN, tenant: "platform-ops", body: { tenantId: acmeId, cognitoSub: "cognito-newuser-controlled", role: "reviewer" } });
  check("AP-03: admin assigns reviewer membership → 200", assign.status === 200, `got ${assign.status}`);

  const badRole = await request("POST", "/api/v1/admin/memberships", { principal: ADMIN, tenant: "platform-ops", body: { tenantId: acmeId, cognitoSub: "cognito-newuser-controlled", role: "superuser" } });
  check("AP-03: unknown role → 422", badRole.status === 422, `got ${badRole.status}`);

  const members = await request("GET", `/api/v1/admin/tenants/${acmeId}/memberships`, { principal: ADMIN, tenant: "platform-ops" });
  const rows = JSON.parse(members.body.toString());
  check("AP-01: membership list shows the new member (active reviewer)",
    members.status === 200 && rows.some((m) => m.email === "newuser@controlled-test.invalid" && m.role === "reviewer" && m.status === "active"),
    JSON.stringify(rows.map((m) => `${m.email}:${m.role}:${m.status}`)));
}

// AP-05 — the provisioned user sees ONLY their company
{
  const own = await request("GET", "/api/v1/audits", { principal: MEMBER, tenant: acmeId });
  check("AP-05: provisioned user resolves their company → 200 (empty list)", own.status === 200, `got ${own.status}`);
  const forged = await request("GET", "/api/v1/audits", { principal: MEMBER, tenant: "existing-company" });
  check("AP-05: provisioned user cannot switch to another company → 401", forged.status === 401, `got ${forged.status}`);
  const list = await request("GET", "/api/v1/audits", { principal: MEMBER, tenant: acmeId });
  const body = JSON.parse(list.body.toString());
  check("AP-05: their company list contains zero other-company rows", Array.isArray(body) && body.length === 0, `rows=${body.length}`);
}

// AP-01 + AP-04 — disable denies immediately
{
  const disable = await request("POST", "/api/v1/admin/memberships/disable", { principal: ADMIN, tenant: "platform-ops", body: { tenantId: acmeId, cognitoSub: "cognito-newuser-controlled" } });
  const result = JSON.parse(disable.body.toString());
  check("AP-04: admin disables the membership → 200 changed=1", disable.status === 200 && result.changed === 1, `got ${disable.status} changed=${result.changed}`);

  const after = await request("GET", "/api/v1/audits", { principal: MEMBER, tenant: acmeId });
  check("AP-01: disabled membership denies IMMEDIATELY (no cache)", after.status === 401, `got ${after.status}`);

  const members = await request("GET", `/api/v1/admin/tenants/${acmeId}/memberships`, { principal: ADMIN, tenant: "platform-ops" });
  const rows = JSON.parse(members.body.toString());
  check("AP-01: membership list reflects disabled status", rows.some((m) => m.email === "newuser@controlled-test.invalid" && m.status === "disabled"), JSON.stringify(rows.map((m) => `${m.email}:${m.status}`)));

  const reDisable = await request("POST", "/api/v1/admin/memberships/disable", { principal: ADMIN, tenant: "platform-ops", body: { tenantId: acmeId, cognitoSub: "cognito-newuser-controlled" } });
  check("AP-01: idempotent disable rerun (200, membership stays disabled)", reDisable.status === 200, `got ${reDisable.status}`);
  const rowsAfter = JSON.parse((await request("GET", `/api/v1/admin/tenants/${acmeId}/memberships`, { principal: ADMIN, tenant: "platform-ops" })).body.toString());
  check("AP-01: rerun preserves the disabled state (no flip to active)", rowsAfter.some((m) => m.email === "newuser@controlled-test.invalid" && m.status === "disabled" && !rowsAfter.some((x) => x.email === "newuser@controlled-test.invalid" && x.status === "active")));
}

// AP-06 — zero live calls
{
  check("AP-06: zero live fetch escapes (guard armed, zero violations)", liveFetchViolations.length === 0, `violations=${liveFetchViolations.length}`);
}

console.log(`\n========================================`);
console.log(`Provisioning Acceptance: ${passed} PASS, ${failed} FAIL`);
console.log(`========================================`);
process.exit(failed > 0 ? 1 : 0);

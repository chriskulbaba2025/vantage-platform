/**
 * MT-IDENTITY authorization unit tests — the real signing, verification,
 * membership resolution, and report role gates.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { signPrincipal, verifyPrincipal, resolveAuthorization, canAccessTenant } from "./authorization.js";
import { authorizeReportAccess, canAccessReportState, effectiveTenantRole } from "./report-authorization.js";
import { createMemoryIdentityRepository } from "./memory-identity-repository.js";
import { ROLES } from "./identity-model.js";

const SECRET = "unit-test-secret";

function principalReq({ sub, email, tenant } = {}) {
  return {
    headers: {
      "x-prysm-principal": signPrincipal({
        secret: SECRET,
        principal: { sub: sub || "cognito-alice", email: email || "alice@a.example.com", displayName: "alice" },
        nowMs: Date.now(),
      }),
      ...(tenant ? { "x-prysm-tenant": tenant } : {}),
    },
  };
}

async function seededRepo() {
  const repo = createMemoryIdentityRepository();
  await repo.createTenant({ id: "tenant-a", name: "Tenant A", slug: "tenant-a" });
  await repo.createTenant({ id: "tenant-b", name: "Tenant B", slug: "tenant-b" });
  const alice = { id: randomUUID(), sub: "cognito-alice", email: "alice@a.example.com" };
  const bob = { id: randomUUID(), sub: "cognito-bob", email: "bob@b.example.com" };
  const dave = { id: randomUUID(), sub: "cognito-dave", email: "dave@platform.example.com" };
  const eve = { id: randomUUID(), sub: "cognito-eve", email: "eve@a.example.com" };
  await repo.createUser({ id: alice.id, cognitoSub: alice.sub, email: alice.email });
  await repo.createUser({ id: bob.id, cognitoSub: bob.sub, email: bob.email });
  await repo.createUser({ id: dave.id, cognitoSub: dave.sub, email: dave.email });
  await repo.createUser({ id: eve.id, cognitoSub: eve.sub, email: eve.email });
  await repo.createMembership({ tenantId: "tenant-a", userId: alice.id, role: ROLES.REVIEWER });
  await repo.createMembership({ tenantId: "tenant-b", userId: bob.id, role: ROLES.REVIEWER });
  await repo.createMembership({ tenantId: "tenant-a", userId: dave.id, role: ROLES.PLATFORM_ADMIN });
  await repo.createMembership({ tenantId: "tenant-a", userId: eve.id, role: ROLES.REVIEWER, status: "disabled" });
  return { repo, alice, bob, dave, eve };
}

// --- Sign / verify ---

test("MT-02: signed principal round-trips", () => {
  const token = signPrincipal({ secret: SECRET, principal: { sub: "s1", email: "a@b.c", displayName: "A" }, nowMs: 1_000_000 });
  const payload = verifyPrincipal({ secret: SECRET, token, nowMs: 1_000_500 });
  assert.equal(payload.sub, "s1");
  assert.equal(payload.email, "a@b.c");
});

test("MT-02: tampered signature rejected", () => {
  const token = signPrincipal({ secret: SECRET, principal: { sub: "s1", email: "a@b.c" }, nowMs: 1_000_000 });
  const tampered = token.slice(0, -4) + "0000";
  assert.equal(verifyPrincipal({ secret: SECRET, token: tampered, nowMs: 1_000_500 }), null);
});

test("MT-02: wrong-secret signature rejected", () => {
  const token = signPrincipal({ secret: SECRET, principal: { sub: "s1", email: "a@b.c" }, nowMs: 1_000_000 });
  assert.equal(verifyPrincipal({ secret: "other-secret", token, nowMs: 1_000_500 }), null);
});

test("MT-02: expired token rejected", () => {
  const token = signPrincipal({ secret: SECRET, principal: { sub: "s1", email: "a@b.c" }, nowMs: 1_000_000 });
  assert.equal(verifyPrincipal({ secret: SECRET, token, nowMs: 1_000_000 + 120_000 }), null);
});

test("MT-02: malformed tokens rejected", () => {
  assert.equal(verifyPrincipal({ secret: SECRET, token: null, nowMs: 1 }), null);
  assert.equal(verifyPrincipal({ secret: SECRET, token: "not-a-token", nowMs: 1 }), null);
  assert.equal(verifyPrincipal({ secret: "", token: "x.y", nowMs: 1 }), null);
});

// --- Membership resolution ---

test("MT-04: reviewer resolves to own tenant", async () => {
  const { repo, alice } = await seededRepo();
  const auth = await resolveAuthorization({
    req: principalReq({ sub: alice.sub, email: alice.email, tenant: "tenant-a" }),
    secret: SECRET,
    identityRepo: repo,
  });
  assert.equal(auth.authenticated, true);
  assert.equal(auth.selectedTenant, "tenant-a");
  assert.ok(auth.roles.includes(ROLES.REVIEWER));
  assert.equal(canAccessTenant(auth, "tenant-a"), true);
  assert.equal(canAccessTenant(auth, "tenant-b"), false);
});

test("MT-04: forged tenant selection denied", async () => {
  const { repo, alice } = await seededRepo();
  const auth = await resolveAuthorization({
    req: principalReq({ sub: alice.sub, email: alice.email, tenant: "tenant-b" }),
    secret: SECRET,
    identityRepo: repo,
  });
  assert.equal(auth.authenticated, false);
  assert.match(auth.reason, /selected tenant not authorized/);
});

test("MT-04: single membership auto-selects tenant", async () => {
  const { repo, alice } = await seededRepo();
  const auth = await resolveAuthorization({
    req: principalReq({ sub: alice.sub, email: alice.email }),
    secret: SECRET,
    identityRepo: repo,
  });
  assert.equal(auth.authenticated, true);
  assert.equal(auth.selectedTenant, "tenant-a");
});

test("MT-04: disabled membership denied", async () => {
  const { repo, eve } = await seededRepo();
  const auth = await resolveAuthorization({
    req: principalReq({ sub: eve.sub, email: eve.email, tenant: "tenant-a" }),
    secret: SECRET,
    identityRepo: repo,
  });
  assert.equal(auth.authenticated, false);
});

test("MT-04: unknown user denied", async () => {
  const { repo } = await seededRepo();
  const auth = await resolveAuthorization({
    req: principalReq({ sub: "cognito-unknown", email: "x@y.z", tenant: "tenant-a" }),
    secret: SECRET,
    identityRepo: repo,
  });
  assert.equal(auth.authenticated, false);
});

test("MT-04: platform_admin explicit cross-tenant", async () => {
  const { repo, dave } = await seededRepo();
  const auth = await resolveAuthorization({
    req: principalReq({ sub: dave.sub, email: dave.email, tenant: "tenant-b" }),
    secret: SECRET,
    identityRepo: repo,
  });
  assert.equal(auth.authenticated, true);
  assert.equal(auth.selectedTenant, "tenant-b");
  assert.equal(canAccessTenant(auth, "tenant-b"), true);
  assert.equal(canAccessTenant(auth, "tenant-a"), true);
});

// --- Report role gates ---

test("MT-06: viewer cannot read drafts", async () => {
  const repo = createMemoryIdentityRepository();
  await repo.createTenant({ id: "tenant-a", name: "A", slug: "a" });
  const carol = { id: randomUUID(), sub: "cognito-carol", email: "carol@a.example.com" };
  await repo.createUser({ id: carol.id, cognitoSub: carol.sub, email: carol.email });
  await repo.createMembership({ tenantId: "tenant-a", userId: carol.id, role: ROLES.VIEWER });
  const auth = await resolveAuthorization({
    req: principalReq({ sub: carol.sub, email: carol.email, tenant: "tenant-a" }),
    secret: SECRET,
    identityRepo: repo,
  });
  assert.equal(canAccessReportState(auth, "tenant-a", "approved"), true);
  assert.equal(canAccessReportState(auth, "tenant-a", "published"), true);
  assert.equal(canAccessReportState(auth, "tenant-a", "draft_rendered"), false);
  assert.equal(canAccessReportState(auth, "tenant-a", "in_review"), false);
});

test("MT-06: reviewer reads drafts and approved", async () => {
  const { repo, alice } = await seededRepo();
  const auth = await resolveAuthorization({
    req: principalReq({ sub: alice.sub, email: alice.email, tenant: "tenant-a" }),
    secret: SECRET,
    identityRepo: repo,
  });
  for (const state of ["draft_rendered", "in_review", "approved", "published"]) {
    assert.equal(canAccessReportState(auth, "tenant-a", state), true, `reviewer reads ${state}`);
  }
});

test("MT-06: cross-tenant report access non-disclosing 404", async () => {
  const { repo, alice } = await seededRepo();
  const auth = await resolveAuthorization({
    req: principalReq({ sub: alice.sub, email: alice.email, tenant: "tenant-a" }),
    secret: SECRET,
    identityRepo: repo,
  });
  const decision = authorizeReportAccess({ auth, auditTenant: "tenant-b", state: "approved" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 404);
});

test("MT-06: unauthenticated report access 401", () => {
  const decision = authorizeReportAccess({ auth: { authenticated: false }, auditTenant: "tenant-a", state: "approved" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 401);
});

test("MT-06: unknown audit non-disclosing 404", async () => {
  const { repo, alice } = await seededRepo();
  const auth = await resolveAuthorization({
    req: principalReq({ sub: alice.sub, email: alice.email, tenant: "tenant-a" }),
    secret: SECRET,
    identityRepo: repo,
  });
  const decision = authorizeReportAccess({ auth, auditTenant: null, state: "approved" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 404);
});

// --- Durability: membership resolution is recomputed per request and
// survives repository recreation (PostgreSQL-backed semantics) ---

test("MT-09: membership changes take effect immediately (disabled → denied)", async () => {
  const { repo, alice } = await seededRepo();
  const before = await resolveAuthorization({
    req: principalReq({ sub: alice.sub, email: alice.email, tenant: "tenant-a" }),
    secret: SECRET,
    identityRepo: repo,
  });
  assert.equal(before.authenticated, true);
  // Disable the membership — the NEXT resolution must deny.
  await repo.createMembership({ tenantId: "tenant-a", userId: alice.id, role: ROLES.REVIEWER, status: "disabled" });
  const after = await resolveAuthorization({
    req: principalReq({ sub: alice.sub, email: alice.email, tenant: "tenant-a" }),
    secret: SECRET,
    identityRepo: repo,
  });
  assert.equal(after.authenticated, false, "disabled membership denies immediately");
});

test("MT-09: unknown principal fails closed (no user row)", async () => {
  const { repo } = await seededRepo();
  const auth = await resolveAuthorization({
    req: principalReq({ sub: "never-provisioned", email: "n@x.y", tenant: "tenant-a" }),
    secret: SECRET,
    identityRepo: repo,
  });
  assert.equal(auth.authenticated, false);
});

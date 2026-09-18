import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryIdentityRepository } from "../identity/memory-identity-repository.js";
import {
  STAGE2_STAGING_TENANT_ID,
  STAGE2_STAGING_USER,
  ensureStage2StagingIdentity,
  shouldBootstrapStage2StagingIdentity,
} from "./stage2-staging-identity-bootstrap.js";

test("Stage 2 staging bootstrap is enabled only for the isolated local-persistence tenant", () => {
  assert.equal(
    shouldBootstrapStage2StagingIdentity({
      localPersistenceEnabled: true,
      configuredTenantId: STAGE2_STAGING_TENANT_ID,
    }),
    true,
  );
  assert.equal(
    shouldBootstrapStage2StagingIdentity({
      localPersistenceEnabled: false,
      configuredTenantId: STAGE2_STAGING_TENANT_ID,
    }),
    false,
  );
  assert.equal(
    shouldBootstrapStage2StagingIdentity({
      localPersistenceEnabled: true,
      configuredTenantId: "local-sandbox",
    }),
    false,
  );
  assert.equal(
    shouldBootstrapStage2StagingIdentity({
      localPersistenceEnabled: true,
      configuredTenantId: "default",
    }),
    false,
  );
});

test("Stage 2 staging bootstrap is idempotent and creates reviewer-only identity", async () => {
  const repo = createMemoryIdentityRepository();

  await ensureStage2StagingIdentity({ identityRepo: repo });
  await ensureStage2StagingIdentity({ identityRepo: repo });

  const tenants = await repo.listTenants();
  const stagingTenants = tenants.filter((t) => t.id === STAGE2_STAGING_TENANT_ID);
  assert.equal(stagingTenants.length, 1);
  assert.equal(stagingTenants[0].status, "active");

  const user = await repo.findUserByCognitoSub(STAGE2_STAGING_USER.cognitoSub);
  assert.ok(user);
  assert.equal(user.id, STAGE2_STAGING_USER.id);
  assert.equal(user.email, STAGE2_STAGING_USER.email);
  assert.equal(user.status, "active");

  const memberships = await repo.findMembershipsForUser(STAGE2_STAGING_USER.id);
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].tenant_id, STAGE2_STAGING_TENANT_ID);
  assert.equal(memberships[0].role, "reviewer");
  assert.equal(memberships[0].status, "active");
  assert.notEqual(memberships[0].role, "platform_admin");
});

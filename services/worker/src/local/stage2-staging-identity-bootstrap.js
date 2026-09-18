/**
 * Stage 2 isolated-staging identity bootstrap.
 *
 * This exists only to make the accepted staging principal deterministic across
 * worker process replacement while the Stage 2 harness intentionally uses the
 * non-production local-persistence composition (no DATABASE_URL).
 *
 * It must never broaden into generic self-registration. The caller must prove
 * both local-persistence mode and the exact isolated staging tenant.
 */

export const STAGE2_STAGING_TENANT_ID = "prysm-stage2-staging";
export const STAGE2_STAGING_USER = Object.freeze({
  id: "00000000-0000-4000-8000-000000000002",
  cognitoSub: "2408e438-0041-70dd-4a37-8709020a8068",
  email: "prysm-stage2-browser-20260918@staging.invalid",
  displayName: "PRYSM Stage 2 Browser",
});
export const STAGE2_STAGING_MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000003";

export function shouldBootstrapStage2StagingIdentity({
  localPersistenceEnabled,
  configuredTenantId,
}) {
  return (
    localPersistenceEnabled === true &&
    configuredTenantId === STAGE2_STAGING_TENANT_ID
  );
}

export async function ensureStage2StagingIdentity({ identityRepo }) {
  if (!identityRepo) {
    throw new Error("Stage 2 staging identity bootstrap requires identityRepo");
  }

  await identityRepo.createTenant({
    id: STAGE2_STAGING_TENANT_ID,
    name: "PRYSM Stage 2 Staging",
    slug: STAGE2_STAGING_TENANT_ID,
    status: "active",
  });

  await identityRepo.createUser({
    ...STAGE2_STAGING_USER,
    status: "active",
  });

  await identityRepo.createMembership({
    id: STAGE2_STAGING_MEMBERSHIP_ID,
    tenantId: STAGE2_STAGING_TENANT_ID,
    userId: STAGE2_STAGING_USER.id,
    role: "reviewer",
    status: "active",
  });

  return Object.freeze({
    tenantId: STAGE2_STAGING_TENANT_ID,
    userId: STAGE2_STAGING_USER.id,
    cognitoSub: STAGE2_STAGING_USER.cognitoSub,
    email: STAGE2_STAGING_USER.email,
    role: "reviewer",
  });
}

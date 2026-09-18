import { accessSync, constants, statSync } from "node:fs";

export const STAGE2_STAGING_TENANT_ID = "prysm-stage2-staging";
export const STAGE2_STAGING_DATA_ROOT = "/data";

/**
 * Validate the explicitly requested isolated Stage 2 staging composition.
 * Ordinary local development does not call this gate and retains its
 * existing home-relative sandbox fallback.
 */
export function validateStage2StagingPersistence({
  env = process.env,
  databaseUrl = env.DATABASE_URL || "",
  expectedDataRoot = STAGE2_STAGING_DATA_ROOT,
  fsImpl = { accessSync, statSync },
} = {}) {
  if (env.PRYSM_STAGE2_STAGING !== "true") {
    return { requested: false, enabled: false, dataDir: null };
  }

  const failures = [];
  if (env.NODE_ENV === "production") failures.push("NODE_ENV must not be production");
  if (env.VANTAGE_DEV_MEMORY_STORE !== "true") failures.push("VANTAGE_DEV_MEMORY_STORE=true is required");
  if (env.PRYSM_LOCAL_PERSISTENCE !== "true") failures.push("PRYSM_LOCAL_PERSISTENCE=true is required");
  if (databaseUrl) failures.push("DATABASE_URL must be unset");
  if (env.VANTAGE_TENANT_ID !== STAGE2_STAGING_TENANT_ID) {
    failures.push(`VANTAGE_TENANT_ID must be ${STAGE2_STAGING_TENANT_ID}`);
  }
  if (env.PRYSM_LOCAL_DATA_DIR !== expectedDataRoot) {
    failures.push(`PRYSM_LOCAL_DATA_DIR must be ${expectedDataRoot}`);
  }

  if (!failures.length) {
    try {
      const stat = fsImpl.statSync(expectedDataRoot);
      if (!stat.isDirectory()) failures.push(`${expectedDataRoot} is not a directory`);
      else fsImpl.accessSync(expectedDataRoot, constants.R_OK | constants.W_OK);
    } catch (error) {
      failures.push(`${expectedDataRoot} must be an accessible durable directory (${error.message})`);
    }
  }

  if (failures.length) {
    throw new Error(`Stage 2 staging persistence refused: ${failures.join("; ")}`);
  }

  return { requested: true, enabled: true, dataDir: expectedDataRoot };
}

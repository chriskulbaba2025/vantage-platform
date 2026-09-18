import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STAGE2_STAGING_TENANT_ID,
  validateStage2StagingPersistence,
} from "./stage2-staging-persistence.js";

function stagingEnv(dataDir) {
  return {
    NODE_ENV: "staging",
    VANTAGE_DEV_MEMORY_STORE: "true",
    PRYSM_LOCAL_PERSISTENCE: "true",
    PRYSM_STAGE2_STAGING: "true",
    VANTAGE_TENANT_ID: STAGE2_STAGING_TENANT_ID,
    PRYSM_LOCAL_DATA_DIR: dataDir,
  };
}

test("exact isolated Stage 2 staging composition accepts an accessible durable root", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prysm-stage2-data-"));
  try {
    assert.deepEqual(
      validateStage2StagingPersistence({ env: stagingEnv(dataDir), expectedDataRoot: dataDir }),
      { requested: true, enabled: true, dataDir },
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("explicit Stage 2 staging mode fails closed without the required durable root", () => {
  assert.throws(
    () => validateStage2StagingPersistence({
      env: stagingEnv("C:/missing-prysm-stage2-data"),
      expectedDataRoot: "C:/missing-prysm-stage2-data",
    }),
    /must be an accessible durable directory/,
  );
});

test("ordinary local development retains the governed home-relative fallback", () => {
  assert.deepEqual(
    validateStage2StagingPersistence({
      env: {
        NODE_ENV: "development",
        VANTAGE_DEV_MEMORY_STORE: "true",
        PRYSM_LOCAL_PERSISTENCE: "true",
      },
    }),
    { requested: false, enabled: false, dataDir: null },
  );
});

test("Stage 2 staging mode rejects the wrong tenant and disabled local persistence", () => {
  assert.throws(
    () => validateStage2StagingPersistence({
      env: {
        ...stagingEnv("C:/data"),
        VANTAGE_TENANT_ID: "wrong-tenant",
        PRYSM_LOCAL_PERSISTENCE: "false",
      },
      expectedDataRoot: "C:/data",
      fsImpl: { statSync: () => ({ isDirectory: () => true }), accessSync: () => {} },
    }),
    /PRYSM_LOCAL_PERSISTENCE=true is required; VANTAGE_TENANT_ID must be prysm-stage2-staging/,
  );
});

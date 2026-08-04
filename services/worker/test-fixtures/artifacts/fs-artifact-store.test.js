/**
 * WP3 Filesystem Artifact Store — Contract Tests
 *
 * Runs the full governed contract suite against the temporary-filesystem
 * implementation. Each factory call creates a fresh temporary directory
 * to ensure test isolation equivalent to the memory store.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runContractTests } from "./contract-tests.js";
import { createFsArtifactStore } from "../../src/storage/fs-artifact-store.js";

let counter = 0;

runContractTests("fs", () => {
  const dir = mkdtempSync(join(tmpdir(), `wp3-fs-${counter++}-`));
  return createFsArtifactStore({ baseDir: dir });
});

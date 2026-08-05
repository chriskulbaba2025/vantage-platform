/**
 * WP3 Filesystem Artifact Store — Contract Tests
 *
 * Runs the full governed contract suite + failure-injection suite
 * against the temporary-filesystem implementation.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runContractTests, runFailureContractTests } from "./contract-tests.js";
import { createFsArtifactStore } from "../../src/storage/fs-artifact-store.js";

let counter = 0;
function freshDir() {
  return mkdtempSync(join(tmpdir(), `wp3-fs-${counter++}-`));
}

runContractTests("fs", () => createFsArtifactStore({ baseDir: freshDir() }));

runFailureContractTests("fs", (opts = {}) =>
  createFsArtifactStore({
    baseDir: freshDir(),
    inject: {
      failWrite: opts.failWrite,
      failReadBack: opts.failReadBack,
      corruptRead: opts.corruptRead,
      failGet: opts.failGet,
      failHead: opts.failHead,
    },
  }),
);

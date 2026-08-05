/**
 * WP3 Memory Artifact Store — Contract Tests
 *
 * Runs the full governed contract suite + failure-injection suite
 * against the in-memory implementation.
 */

import { runContractTests, runFailureContractTests } from "./contract-tests.js";
import { createMemoryArtifactStore } from "../../src/storage/memory-artifact-store.js";

runContractTests("memory", () => createMemoryArtifactStore());

runFailureContractTests("memory", (opts = {}) =>
  createMemoryArtifactStore({
    failWrite: opts.failWrite,
    failReadBack: opts.failReadBack,
    corruptRead: opts.corruptRead,
    failGet: opts.failGet,
    failHead: opts.failHead,
  }),
);

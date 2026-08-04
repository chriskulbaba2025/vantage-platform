/**
 * WP3 Memory Artifact Store — Contract Tests
 *
 * Runs the full governed contract suite against the in-memory implementation.
 */

import { runContractTests } from "./contract-tests.js";
import { createMemoryArtifactStore } from "../../src/storage/memory-artifact-store.js";

runContractTests("memory", () => createMemoryArtifactStore());

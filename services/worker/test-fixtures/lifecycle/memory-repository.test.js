/**
 * WP4 Memory Lifecycle Repository — Contract Tests
 */

import { runLifecycleContractTests } from "./contract-tests.js";
import { createMemoryLifecycleRepository } from "../../src/lifecycle/memory-repository.js";

runLifecycleContractTests("memory", () => createMemoryLifecycleRepository());

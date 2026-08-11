/**
 * DataForSEO Backlinks Adapter — WP6 governed production adapter.
 *
 * Wraps the governed backlinks provider behind the universal source contract
 * required by the AuditOrchestrator and the production bootstrap.
 *
 * This module:
 *   - exports a factory function for server.js loadAdapters()
 *   - exports execute() for createProductionAdapters()
 *   - makes ZERO provider calls during import or factory creation
 *   - only invokes providers when execute() is explicitly called
 *
 * No node:test.  No test fixtures.  No top-level side effects.
 */

import { execute as backlinksExecute } from "../../evidence/backlinks-provider.js";

const ADAPTER_VERSION = "1.0.0";

/**
 * Create a governed production backlinks adapter.
 *
 * The factory conforms to the loadAdapters() contract in server.js.
 * It receives config (environment) and returns a frozen adapter shape
 * that the production runtime validates via injectedAdaptersAreValid().
 *
 * No provider calls occur during factory invocation.
 *
 * @param {object} _config — Environment configuration (reserved for future use).
 * @returns {{ adapterVersion: string, execute: Function }}
 */
export function createBacklinksAdapter(_config) {
  return Object.freeze({
    adapterVersion: ADAPTER_VERSION,
    execute: backlinksExecute,
  });
}

/**
 * Governed execute() — WP6 universal adapter interface.
 *
 * Identical contract to every other production adapter.  Accepts the
 * standard audit context and delegates to backlinks-provider.js.
 *
 * Provider calls happen ONLY inside this function, and ONLY when an
 * explicit governed audit invokes it.
 */
export { backlinksExecute as execute };

export { ADAPTER_VERSION };
export default { createBacklinksAdapter, execute: backlinksExecute };

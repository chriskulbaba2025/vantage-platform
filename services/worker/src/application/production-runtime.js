/**
 * WP12 Production Runtime Factory
 *
 * Constructs every governed WP4-WP11 component used by the production
 * worker.  Both server.js and the WP12 acceptance harness MUST call this
 * same factory — no parallel implementation.
 *
 * @module application/production-runtime
 */

import { createAuditOrchestrator } from "../orchestration/audit-orchestrator.js";
import { createGovernedArtifactStore } from "../storage/governed-artifact-store.js";
import { createAuditApplicationService } from "./audit-service.js";
import { createLifecycleService } from "../lifecycle/lifecycle-service.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {object} opts.config — production config (from loadConfig)
 * @param {object} opts.adapters — all six governed WP6 adapter execute fns
 * @param {Function} opts.validateContract — schema validator
 * @param {object} opts.artifactStore — governed artifact store
 * @param {object} opts.lifecycleRepo — lifecycle repository (PostgreSQL)
 * @param {object} opts.reportStore — report store for lifecycle/approval
 * @returns {object} { auditService, orchestrator, lifecycleService, artifactStore, reportStore }
 */
export function createProductionRuntime({
  config,
  adapters,
  validateContract,
  artifactStore,
  lifecycleRepo,
  reportStore,
}) {
  // Validate mandatory production infrastructure
  if (!lifecycleRepo) {
    throw new Error("PRODUCTION STARTUP FAILED: lifecycleRepo is required (DATABASE_URL not configured?)");
  }
  if (!artifactStore) {
    throw new Error("PRODUCTION STARTUP FAILED: artifactStore is required");
  }

  // 1. Lifecycle service
  const lifecycleService = createLifecycleService(lifecycleRepo);

  // 2. Governed orchestrator
  const orchestrator = createAuditOrchestrator({
    lifecycleService,
    artifactStore,
    adapters,
    validateContract,
    clock: {
      now: () => new Date().toISOString(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
    },
    retryPolicyResolver: (source) => ({
      timeoutMs: config.onpagePollTimeoutMs || 600_000,
      maxAttempts: 3,
      retryable: (err) => {
        // Retry on transient network errors, not on auth/permanent failures
        if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ENOTFOUND") return true;
        if (err?.statusCode && err.statusCode >= 500 && err.statusCode < 600) return true;
        return false;
      },
      delayMs: (attempt) => Math.min(1000 * Math.pow(2, attempt), 30000),
    }),
  });

  // 3. Application service (WP11)
  const auditService = createAuditApplicationService({
    orchestrator,
    lifecycleRepo,
    lifecycleService,
    artifactStore,
    reportStore,
    config,
    validateContract,
  });

  return {
    auditService,
    orchestrator,
    lifecycleService,
    artifactStore,
    reportStore,
  };
}

export default { createProductionRuntime };

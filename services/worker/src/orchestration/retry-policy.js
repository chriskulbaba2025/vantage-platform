/**
 * WP5 Retry Policy — Timeout and retry boundary for source execution.
 * @module orchestration/retry-policy
 */

/**
 * Default policy for a source adapter.
 * WP6 adapters supply their own governed policies through the policy resolver.
 */
export const DEFAULT_SOURCE_POLICY = Object.freeze({
  timeoutMs: 30_000,
  maxAttempts: 3,
  retryable(error) {
    if (!error) return false;
    // Retry on transient network/timeout errors only
    if (error.category === "timeout") return true;
    if (error.category === "network" && error.statusCode >= 500) return true;
    if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "ECONNREFUSED") return true;
    return false;
  },
  delayMs(attempt) {
    // Exponential backoff: 1s, 2s, 4s
    return Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
  },
});

/**
 * Resolve the policy for a source.
 * Injects through the policy resolver so WP6 adapters can supply governed policies.
 *
 * @param {object} opts
 * @param {function} [opts.policyResolver] — (source) => policy, defaults to DEFAULT_SOURCE_POLICY
 * @param {string} opts.source
 * @returns {{ timeoutMs: number, maxAttempts: number, retryable: function, delayMs: function }}
 */
export function resolveSourcePolicy({ policyResolver, source }) {
  if (typeof policyResolver === "function") {
    const resolved = policyResolver(source);
    if (resolved) return resolved;
  }
  return DEFAULT_SOURCE_POLICY;
}

/**
 * Execute a source with timeout and retry.
 *
 * @param {object} opts
 * @param {function} opts.executeFn — (signal, attempt) => Promise<{rawBytes, contentType, sourceResult}>
 * @param {object} opts.policy — resolved policy { timeoutMs, maxAttempts, retryable, delayMs }
 * @param {object} opts.clock — { now: () => ISO string, sleep: async (ms) => void }
 * @param {function} opts.onAttempt — (attempt, outcome) => void, called after each attempt
 * @returns {Promise<{ rawBytes: Buffer|null, contentType: string|null, sourceResult: object }>}
 */
export async function executeWithRetry({ executeFn, policy, clock, onAttempt }) {
  const { timeoutMs, maxAttempts, retryable, delayMs } = policy;
  let lastResult = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ac = new AbortController();
    const timer = clock ? clock.setTimeout(() => ac.abort(), timeoutMs) : setTimeout(() => ac.abort(), timeoutMs);

    try {
      const result = await executeFn(ac.signal, attempt);
      clearTimeout(timer);
      if (onAttempt) onAttempt(attempt, { status: "fulfilled" });
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      if (ac.signal.aborted) {
        lastError = Object.assign(new Error("Source execution timed out"), { category: "timeout" });
      }

      if (onAttempt) onAttempt(attempt, { status: "rejected", error: lastError });

      if (attempt < maxAttempts && retryable(lastError)) {
        const delay = delayMs(attempt);
        if (clock) await clock.sleep(delay);
        else await new Promise(r => setTimeout(r, delay));
        continue;
      }

      break;
    }
  }

  // All attempts exhausted — build a FAILED source result
  const now = clock ? clock.now() : new Date().toISOString();
  return {
    rawBytes: null,
    contentType: null,
    sourceResult: {
      status: "FAILED",
      retryCount: maxAttempts - 1,
      startedAt: now,
      completedAt: now,
      limitations: lastError ? [`Source execution failed: ${lastError.message}`] : ["Source execution failed"],
      errorCategory: lastError?.category || "internal",
    },
  };
}

export default { DEFAULT_SOURCE_POLICY, resolveSourcePolicy, executeWithRetry };

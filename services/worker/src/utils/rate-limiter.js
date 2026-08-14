/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * First line of defense for API cost/abuse protection.  State lives in
 * the process (a restart resets it) — the durable backstops are Cognito
 * adaptive throttling (login) and the orchestrator's paid-task
 * idempotency (audit creation).
 *
 * @module utils/rate-limiter
 */

/**
 * @param {object} opts
 * @param {number} opts.windowMs — sliding window length
 * @param {number} opts.max — maximum hits allowed within the window
 * @param {() => number} [opts.now] — clock (injectable for tests)
 * @param {number} [opts.maxKeys] — prune empty buckets beyond this size
 */
export function createSlidingWindowLimiter({ windowMs, max, now = () => Date.now(), maxKeys = 5000 }) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("rate-limiter requires a positive windowMs");
  if (!Number.isFinite(max) || max <= 0) throw new Error("rate-limiter requires a positive max");
  const buckets = new Map(); // key -> number[] of hit timestamps (ascending)

  function prune() {
    if (buckets.size <= maxKeys) return;
    for (const [key, entries] of buckets) {
      if (entries.length === 0) buckets.delete(key);
    }
  }

  /**
   * Record a hit for the key.  Returns false (and records nothing) when
   * the key has already reached its limit within the window.
   */
  function hit(key) {
    const t = now();
    let entries = buckets.get(key) || [];
    // Drop timestamps that have fallen out of the window.
    while (entries.length > 0 && entries[0] <= t - windowMs) entries.shift();
    if (entries.length >= max) return false;
    entries.push(t);
    buckets.set(key, entries);
    prune();
    return true;
  }

  return Object.freeze({ hit });
}

export default { createSlidingWindowLimiter };

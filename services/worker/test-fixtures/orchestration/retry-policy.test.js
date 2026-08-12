import test from "node:test";
import assert from "node:assert/strict";

import { executeWithRetry } from "../../src/orchestration/retry-policy.js";

function policy(overrides = {}) {
  return {
    timeoutMs: 20,
    maxAttempts: 1,
    retryable: () => false,
    delayMs: () => 0,
    ...overrides,
  };
}

test("hard timeout releases orchestration even when adapter ignores AbortSignal", async () => {
  let observedSignal = null;
  const started = Date.now();

  const result = await executeWithRetry({
    policy: policy(),
    executeFn: async (signal) => {
      observedSignal = signal;
      return new Promise(() => {});
    },
  });

  const elapsed = Date.now() - started;
  assert.equal(result.sourceResult.status, "FAILED");
  assert.equal(result.sourceResult.errorCategory, "timeout");
  assert.equal(result.sourceResult.retryCount, 0);
  assert.match(result.sourceResult.limitations[0], /timed out/i);
  assert.equal(observedSignal?.aborted, true);
  assert.ok(elapsed < 500, `timeout boundary took too long: ${elapsed}ms`);
});

test("successful adapter result is returned before timeout", async () => {
  const expected = {
    rawBytes: Buffer.from("{}"),
    contentType: "application/json",
    sourceResult: { status: "AVAILABLE", retryCount: 99 },
  };

  const result = await executeWithRetry({
    policy: policy({ timeoutMs: 100 }),
    executeFn: async () => expected,
  });

  assert.equal(result.sourceResult.status, "AVAILABLE");
  assert.equal(result.sourceResult.retryCount, 0);
  assert.deepEqual(result.rawBytes, expected.rawBytes);
});

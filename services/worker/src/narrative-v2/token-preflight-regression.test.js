import test from "node:test";
import assert from "node:assert/strict";

import { runCostPreflight } from "../narrative/cost-preflight.js";

const INPUT_CEILING = 150_000;

// Production audit 010a96e7-7288-4883-8cb0-9082ad8a8583 failed before Writer
// Pass 2 because the legacy estimator reported 160,914 tokens for a request
// package of roughly 123,780 serialized ASCII bytes. Recreate that exact size
// class without making any provider call.
test("TOKEN-PREFLIGHT-01: production-sized revision input is not falsely rejected", () => {
  const reportPackage = { prompt: "x".repeat(123_767) };
  assert.equal(Buffer.byteLength(JSON.stringify(reportPackage), "utf8"), 123_780);

  const result = runCostPreflight({
    reportPackage,
    modelConfig: { maxInputTokens: INPUT_CEILING, maxOutputTokens: 10_000 },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.estimate.inputTokens, 82_520);
  assert.ok(result.estimate.inputTokens < INPUT_CEILING);
});

test("TOKEN-PREFLIGHT-02: genuinely oversized governed input still fails closed", () => {
  const reportPackage = { prompt: "x".repeat(300_000) };

  const result = runCostPreflight({
    reportPackage,
    modelConfig: { maxInputTokens: INPUT_CEILING, maxOutputTokens: 10_000 },
  });

  assert.equal(result.allowed, false);
  assert.ok(result.estimate.inputTokens > INPUT_CEILING);
  assert.match(result.reason, /exceeds ceiling 150000/);
});

test("TOKEN-PREFLIGHT-03: UTF-8 byte length, not JavaScript character count, drives the conservative estimate", () => {
  const reportPackage = { prompt: "é".repeat(3_000) };
  const serialized = JSON.stringify(reportPackage);
  const utf8Bytes = Buffer.byteLength(serialized, "utf8");

  const result = runCostPreflight({ reportPackage });

  assert.equal(result.allowed, true);
  assert.equal(result.estimate.inputTokens, Math.ceil(utf8Bytes / 1.5));
});

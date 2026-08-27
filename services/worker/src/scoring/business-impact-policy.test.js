import test from "node:test";
import assert from "node:assert/strict";

import {
  BUSINESS_IMPACT_BASIS,
  governBusinessImpact,
} from "./business-impact-policy.js";

test("INTERPRETATION-05: bounded inferred risk language is accepted", () => {
  assert.equal(
    governBusinessImpact(
      "Slow loading may create friction for mobile visitors.",
    ),
    "Slow loading may create friction for mobile visitors.",
  );
});

test("INTERPRETATION-05: unsupported causal certainty is rejected", () => {
  assert.throws(
    () =>
      governBusinessImpact(
        "Slow loading causes visitors to abandon the page.",
      ),
    /unsupported causal certainty/,
  );
});

test("INTERPRETATION-05: unmeasured conversion outcomes are rejected even when hedged", () => {
  assert.throws(
    () =>
      governBusinessImpact(
        "Slow loading may reduce conversions.",
      ),
    /unmeasured commercial outcome/,
  );
});

test("INTERPRETATION-05: conversion-rate and engagement claims are rejected even when bounded", () => {
  assert.throws(
    () =>
      governBusinessImpact(
        "Incomplete rendering can reduce engagement and conversion rates.",
      ),
    /unmeasured commercial outcome/,
  );
});

test("INTERPRETATION-05: bounce-rate claims are rejected", () => {
  assert.throws(
    () =>
      governBusinessImpact(
        "Slow page loads may increase bounce rates.",
      ),
    /unmeasured commercial outcome/,
  );
});

test("INTERPRETATION-05: blocking conversion claims are rejected", () => {
  assert.throws(
    () =>
      governBusinessImpact(
        "A persistent loading screen may block conversion.",
      ),
    /unmeasured commercial outcome/,
  );
});

test("INTERPRETATION-05: directly observed evidence can be stated without artificial hedging", () => {
  assert.equal(
    governBusinessImpact(
      "Measured search visibility is not converting into visits at the observed CTR.",
      { basis: BUSINESS_IMPACT_BASIS.OBSERVED },
    ),
    "Measured search visibility is not converting into visits at the observed CTR.",
  );
});

test("INTERPRETATION-05: empty impact fails closed", () => {
  assert.throws(
    () => governBusinessImpact(""),
    /must be a non-empty string/,
  );
});

test("INTERPRETATION-05: unknown evidence basis fails closed", () => {
  assert.throws(
    () =>
      governBusinessImpact(
        "Some impact text.",
        { basis: "UNKNOWN" },
      ),
    /invalid evidence basis/,
  );
});
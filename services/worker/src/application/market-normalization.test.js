import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMarket } from "./audit-service.js";

test("normalizeMarket appends Canada for city/province input", () => {
  assert.equal(normalizeMarket("London, Ontario"), "London, Ontario, Canada");
});

test("normalizeMarket appends United States for city/state input", () => {
  assert.equal(normalizeMarket("Austin, Texas"), "Austin, Texas, United States");
});

test("normalizeMarket preserves already-qualified and non-geographic input", () => {
  assert.equal(normalizeMarket("London, Ontario, Canada"), "London, Ontario, Canada");
  assert.equal(normalizeMarket("Canada / national"), "Canada / national");
});

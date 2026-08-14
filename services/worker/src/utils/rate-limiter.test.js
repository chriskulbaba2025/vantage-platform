/**
 * Rate limiter — sliding-window behaviour with an injectable clock.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlidingWindowLimiter } from "./rate-limiter.js";

test("allows up to max hits within the window", () => {
  let t = 1000;
  const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 3, now: () => t });
  assert.equal(limiter.hit("k"), true);
  assert.equal(limiter.hit("k"), true);
  assert.equal(limiter.hit("k"), true);
  assert.equal(limiter.hit("k"), false, "4th hit within the window must be denied");
});

test("window slide re-admits hits after the window passes", () => {
  let t = 1000;
  const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 2, now: () => t });
  assert.equal(limiter.hit("k"), true);
  assert.equal(limiter.hit("k"), true);
  assert.equal(limiter.hit("k"), false);
  t += 60_001;
  assert.equal(limiter.hit("k"), true, "after the window slides, hits are admitted again");
});

test("keys are independent", () => {
  let t = 1000;
  const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 1, now: () => t });
  assert.equal(limiter.hit("a"), true);
  assert.equal(limiter.hit("b"), true, "a different key must not be affected");
  assert.equal(limiter.hit("a"), false);
});

test("many keys do not break the limiter (prune path)", () => {
  const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 5, maxKeys: 10 });
  for (let i = 0; i < 50; i++) {
    assert.equal(limiter.hit(`key-${i}`), true);
  }
  assert.equal(limiter.hit("key-0"), true, "still functional after pruning");
});

test("invalid configuration fails closed", () => {
  assert.throws(() => createSlidingWindowLimiter({ windowMs: 0, max: 5 }), /positive windowMs/);
  assert.throws(() => createSlidingWindowLimiter({ windowMs: 1000, max: 0 }), /positive max/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { planSequence, validateSequence } from "./solution-sequence.js";

function record(solutionId, rank, overrides = {}) {
  return {
    solutionId,
    disposition: "FIX_NOW",
    dependencies: [],
    sequenceInputs: { governedRank: rank, eligibility: true },
    ...overrides,
  };
}

test("governed rank orders dependency-ready records", () => {
  const result = planSequence([record("SOL-2", 2), record("SOL-1", 1)]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.sequence, ["SOL-1", "SOL-2"]);
});

test("dependency prerequisite precedes a higher-ranked dependent record", () => {
  const result = planSequence([
    record("SOL-1", 1, { dependencies: [{ targetSolutionId: "SOL-2", dependencyType: "prerequisite", reason: "Required first" }] }),
    record("SOL-2", 2),
  ]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.sequence, ["SOL-2", "SOL-1"]);
});

test("unresolved dependencies fail", () => {
  const result = validateSequence([record("SOL-1", 1, { dependencies: [{ targetSolutionId: "MISSING", dependencyType: "prerequisite", reason: "Required" }] })]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "V21"));
});

test("dependency cycles fail", () => {
  const result = validateSequence([
    record("SOL-1", 1, { dependencies: [{ targetSolutionId: "SOL-2", dependencyType: "prerequisite", reason: "A" }] }),
    record("SOL-2", 2, { dependencies: [{ targetSolutionId: "SOL-1", dependencyType: "prerequisite", reason: "B" }] }),
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "V22"));
});

test("ACCEPT and INVESTIGATE are excluded from active sequence", () => {
  const result = planSequence([
    record("SOL-1", 1, { disposition: "ACCEPT" }),
    record("SOL-2", 2, { disposition: "INVESTIGATE" }),
    record("SOL-3", 3),
  ]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.sequence, ["SOL-3"]);
});

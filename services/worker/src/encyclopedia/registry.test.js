import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_PROBLEMS,
  CANONICAL_PROBLEM_BY_ID,
  DIAGNOSTIC_AREAS,
  FRICTION_STATES,
  RELATIONSHIP_TYPES,
  validateEncyclopediaRegistry,
} from "./registry.js";

test("ENC-T1-01: frozen registry contains 12 areas and 75 canonical problems", () => {
  assert.equal(DIAGNOSTIC_AREAS.length, 12);
  assert.equal(CANONICAL_PROBLEMS.length, 75);
  assert.equal(Object.keys(CANONICAL_PROBLEM_BY_ID).length, 75);
  assert.deepEqual(Object.values(FRICTION_STATES), ["CLEAR", "WATCH", "FRICTION", "NOT_ENOUGH_EVIDENCE"]);
});

test("ENC-T1-02: all six relationship types are exact and unique", () => {
  assert.deepEqual(RELATIONSHIP_TYPES, ["Repeats", "Compounds", "Depends on", "May share a cause", "Same journey point", "Duplicate symptom"]);
  assert.equal(new Set(RELATIONSHIP_TYPES).size, 6);
});

test("ENC-T1-03: every registry entry has the complete canonical contract shape", () => {
  const result = validateEncyclopediaRegistry();
  assert.deepEqual(result, { valid: true, errors: [] });
  for (const problem of CANONICAL_PROBLEMS) {
    assert.equal(Object.isFrozen(problem), true);
    assert.equal(problem.firstDiagnosticChecks.length, 3);
    assert.equal(problem.reportPlacement.includes("priority-fixes"), true);
  }
});

test("ENC-T1-04: duplicate registry IDs fail closed", () => {
  const duplicate = [...CANONICAL_PROBLEMS, { ...CANONICAL_PROBLEMS[0] }];
  const result = validateEncyclopediaRegistry(duplicate);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /exactly 75|Duplicate/.test(error)));
});

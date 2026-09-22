import test from "node:test";
import assert from "node:assert/strict";
import { REMEDIATION_SUPPORT, REMEDIATION_TAXONOMY, REMEDIATION_NOT_YET_SUPPORTED, REMEDIATION_SEQUENCE_SLOTS, REMEDIATION_SEQUENCE_NOT_SUPPORTED, projectPriorityRemediation, projectRemediationSequence } from "./remediation-taxonomy.js";
import { RULE_TO_CANONICAL } from "../encyclopedia/projection.js";

const textKey = (option) => `${option.title.trim().toLowerCase()} ${option.detail.trim().toLowerCase()}`;

test("remediation coverage explicitly classifies every canonical rule family", () => {
  const reachable = new Set(Object.values(RULE_TO_CANONICAL));
  const classified = new Set([
    ...REMEDIATION_SUPPORT.supported,
    ...Object.keys(REMEDIATION_SUPPORT.unsupported),
  ]);
  assert.deepEqual([...classified].sort(), [...reachable].sort());
  assert.deepEqual(Object.keys(REMEDIATION_TAXONOMY).sort(), [...REMEDIATION_SUPPORT.supported].sort());
});

test("every supported family has exactly three distinct, specific options", () => {
  for (const [familyId, options] of Object.entries(REMEDIATION_TAXONOMY)) {
    assert.equal(options.length, 3, `${familyId} option count`);
    assert.equal(new Set(options.map((option) => option.title.toLowerCase())).size, 3, `${familyId} titles`);
    assert.equal(new Set(options.map(textKey)).size, 3, `${familyId} full options`);
    assert.deepEqual(options.map((option) => option.sequenceSlot).sort(), [...REMEDIATION_SEQUENCE_SLOTS].sort(), `${familyId} has one of each governed sequence slot`);
    for (const option of options) {
      assert.ok(option.title.length >= 12, `${familyId} title specificity`);
      assert.ok(option.detail.length >= 30, `${familyId} option detail specificity`);
      assert.doesNotMatch(`${option.title} ${option.detail}`, /the cause is|caused by|this is caused by|will increase conversion/i);
    }
  }
});

test("accepted LCP, schema, and search-result families project their own remediation taxonomy", () => {
  for (const [familyId, phrase] of [
    ["I01", /above-the-fold asset/],
    ["J04", /supported structured data/],
    ["A03", /page-specific descriptions/],
  ]) {
    const unit = { canonicalProblemId: familyId, findingIds: [`arbitrary-${familyId}`], severity: "High", rank: 2 };
    const original = structuredClone(unit);
    const projection = projectPriorityRemediation(unit);
    assert.equal(projection.status, "SUPPORTED");
    assert.equal(projection.options.length, 3);
    assert.deepEqual(projection.options.map((option) => option.sequenceSlot), REMEDIATION_SEQUENCE_SLOTS);
    assert.deepEqual(projection.options.map((option) => option.sequenceLabel), ["DO FIRST", "NEXT 7 DAYS", "BY 30 DAYS"]);
    assert.match(projection.options.map(textKey).join(" "), phrase);
    assert.match(projection.disclaimer, /has not established which fix is right/i);
    assert.deepEqual(unit, original, "taxonomy projection does not mutate priority identity or rank");
  }
});

test("remediation sequence follows explicit taxonomy slots, not source array order", () => {
  const source = structuredClone(REMEDIATION_TAXONOMY.I01).reverse();
  const before = structuredClone(source);
  const projected = projectRemediationSequence(source);
  assert.equal(projected.sequenceStatus, "SUPPORTED");
  assert.deepEqual(projected.options.map(({ sequenceSlot, sequenceLabel }) => [sequenceSlot, sequenceLabel]), [
    ["FIRST", "DO FIRST"],
    ["NEXT_7_DAYS", "NEXT 7 DAYS"],
    ["BY_30_DAYS", "BY 30 DAYS"],
  ]);
  assert.deepEqual(source, before, "projection preserves taxonomy input");
});

test("malformed sequence metadata fails closed and preserves unlabelled remedies", () => {
  const valid = structuredClone(REMEDIATION_TAXONOMY.I01);
  const malformed = [
    valid.map(({ sequenceSlot, ...option }) => option),
    valid.map((option, index) => ({ ...option, sequenceSlot: index === 0 ? "FIRST" : "NEXT_7_DAYS" })),
    valid.map((option, index) => ({ ...option, sequenceSlot: index === 2 ? "SOMEDAY" : option.sequenceSlot })),
    valid.slice(0, 2),
    [...valid, valid[0]],
  ];
  for (const options of malformed) {
    const result = projectRemediationSequence(options);
    assert.equal(result.sequenceStatus, "SEQUENCE_NOT_SUPPORTED");
    assert.equal(result.sequenceMessage, REMEDIATION_SEQUENCE_NOT_SUPPORTED);
    assert.deepEqual(result.options, options);
    assert.ok(result.options.every((option) => !Object.hasOwn(option, "sequenceLabel")));
  }
});

test("unsupported and unknown families fail closed without fabricated options", () => {
  for (const familyId of ["A01", "E07", "D07", "FUTURE-UNKNOWN"]) {
    const projection = projectPriorityRemediation({ canonicalProblemId: familyId });
    assert.equal(projection.status, "REMEDIATION_NOT_YET_SUPPORTED");
    assert.deepEqual(projection.options, []);
    assert.equal(projection.message, REMEDIATION_NOT_YET_SUPPORTED);
  }
});

test("ambiguous multi-family priority units fail closed rather than choosing the first family", () => {
  const result = projectPriorityRemediation({
    type: "accepted friction cluster",
    canonicalProblemId: "I01",
    canonicalProblemIds: ["I01", "J04"],
  });
  assert.equal(result.status, "REMEDIATION_NOT_YET_SUPPORTED");
  assert.deepEqual(result.options, []);
  assert.deepEqual(result.familyIds, ["I01", "J04"]);
});

test("same-family clusters receive the single family's three options", () => {
  const result = projectPriorityRemediation({
    type: "accepted friction cluster",
    canonicalProblemId: "J04",
    canonicalProblemIds: ["J04", "J04"],
  });
  assert.equal(result.status, "SUPPORTED");
  assert.equal(result.options.length, 3);
});

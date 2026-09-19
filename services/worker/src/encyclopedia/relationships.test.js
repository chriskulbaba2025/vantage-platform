import test from "node:test";
import assert from "node:assert/strict";
import { projectFinding, projectFindings } from "./projection.js";
import { buildRelationshipCandidates, relationshipCandidate, validateRelationship } from "./relationships.js";

function finding(id, overrides = {}) {
  return {
    findingId: id, ruleId: "VAN-TRUST-001", title: id, affectedUrls: ["https://example.test/service"],
    confidence: "deterministic", scoreBearing: true, severity: "High", conversionAction: "contact",
    evidence: [{ field: id, observedValue: true, sourceStatus: "AVAILABLE", lineageKey: `lineage:${id}`, independenceKey: `family:${id}` }],
    ...overrides,
  };
}

function pair(left, right) {
  const a = projectFinding(finding("a", left));
  const b = projectFinding(finding("b", right));
  return relationshipCandidate(a, b);
}

test("ENC-T3-01: same journey stage alone is not a relationship boundary", () => {
  const a = projectFinding(finding("a", { conversionAction: "contact" }));
  const b = projectFinding(finding("b", { conversionAction: "pricing" }));
  const result = relationshipCandidate(a, { ...b, scope: { level: "page", urls: ["https://example.test/other"], template: null } });
  assert.equal(result.eligible, false);
});

test("ENC-T3-02: duplicate symptoms collapse and do not become corroboration", () => {
  const result = pair({ evidence: [{ field: "a", observedValue: true, sourceStatus: "AVAILABLE", artifactRef: "same" }] }, { evidence: [{ field: "b", observedValue: true, sourceStatus: "AVAILABLE", artifactRef: "same" }] });
  assert.equal(result.type, "Duplicate symptom");
  assert.equal(validateRelationship(result).valid, true);
});

test("ENC-T3-03: repeats require same canonical problem and meaningful scope", () => {
  const result = pair({ affectedUrls: ["https://example.test/service-a"], conversionAction: null }, { affectedUrls: ["https://example.test/service-b"], conversionAction: null, template: "service-template" });
  assert.equal(result.eligible, false);
  const [a, b] = projectFindings([
    finding("a", { affectedUrls: ["https://example.test/service-a"], template: "service-template", conversionAction: null }),
    finding("b", { affectedUrls: ["https://example.test/service-b"], template: "service-template", conversionAction: null }),
  ]);
  const repeated = relationshipCandidate(a, b);
  assert.equal(repeated.type, "Repeats");
});

test("ENC-T3-04: explicit dependencies are directional and validated", () => {
  const result = pair({ dependsOnFindingIds: ["b"], conversionAction: "contact" }, { conversionAction: "contact" });
  assert.equal(result.type, "Depends on");
  assert.equal(validateRelationship(result).valid, true);
});

test("ENC-T3-05: shared cause stays a hypothesis and same action can share journey point", () => {
  const sharedCause = pair({ mechanismFamily: "form-runtime", conversionAction: "contact" }, { ruleId: "VAN-TRUST-002", mechanismFamily: "form-runtime", conversionAction: "contact" });
  assert.equal(sharedCause.type, "May share a cause");
  assert.equal(sharedCause.hypothesisOnly, true);
  const samePoint = pair({ mechanismFamily: null, conversionAction: "contact" }, { ruleId: "VAN-TRUST-002", mechanismFamily: null, conversionAction: "contact" });
  assert.equal(samePoint.type, "Same journey point");
});

test("ENC-T3-06: unknown evidence cannot strengthen a cluster; device mismatch stays separate", () => {
  const unknown = pair({ confidence: "insufficient", evidence: [] }, { conversionAction: "contact" });
  assert.equal(unknown.eligible, false);
  const device = pair({ device: "mobile" }, { device: "desktop" });
  assert.equal(device.eligible, false);
});

test("ENC-T3-07: candidate builder never performs an all-pairs semantic promotion", () => {
  const projections = projectFindings([finding("a"), finding("b", { conversionAction: "pricing" }), finding("c", { affectedUrls: ["https://other.test"], conversionAction: "other" })]);
  const candidates = buildRelationshipCandidates(projections);
  assert.ok(candidates.every((candidate) => candidate.eligible === true));
});

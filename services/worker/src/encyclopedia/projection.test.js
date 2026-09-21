import test from "node:test";
import assert from "node:assert/strict";
import { FRICTION_STATES } from "./registry.js";
import { projectFinding, projectFindings, validateProjection } from "./projection.js";

function finding(overrides = {}) {
  return {
    findingId: "F-1", ruleId: "VAN-TRUST-001", title: "Trust proof is absent",
    affectedUrls: ["https://example.test/service"], confidence: "deterministic",
    scoreBearing: true, severity: "High",
    evidence: [{ field: "trust.testimonials", observedValue: false, provider: "crawl", sourceStatus: "AVAILABLE", artifactRef: "artifact:1" }],
    ...overrides,
  };
}

test("ENC-T2-01: observed finding receives exactly one primary canonical problem", () => {
  const projection = projectFinding(finding());
  assert.equal(projection.canonicalProblemId, "E01");
  assert.equal(projection.primary, true);
  assert.equal(projection.frictionState, FRICTION_STATES.FRICTION);
  assert.deepEqual(validateProjection(projection), { valid: true, errors: [] });
});

test("ENC-T2-02: unknown rules remain historical and cannot be promoted", () => {
  const projection = projectFinding(finding({ ruleId: "LEGACY-UNKNOWN", evidence: [{ field: "x", observedValue: true, sourceStatus: "AVAILABLE" }] }));
  assert.equal(projection.canonicalProblemId, null);
  assert.equal(projection.primary, false);
  assert.equal(projection.frictionState, FRICTION_STATES.NOT_ENOUGH_EVIDENCE);
  assert.equal(projection.historicalCompatibility, "NO_ENCYCLOPEDIA_PROJECTION");
});

test("ENC-T2-03: missing, partial and conflicting evidence fail closed to bounded states", () => {
  assert.equal(projectFinding(finding({ evidence: [] })).frictionState, FRICTION_STATES.NOT_ENOUGH_EVIDENCE);
  assert.equal(projectFinding(finding({ evidence: [{ field: "x", observedValue: true, sourceStatus: "PARTIAL" }] })).frictionState, FRICTION_STATES.WATCH);
  assert.equal(projectFinding(finding({ conflictingEvidence: true })).frictionState, FRICTION_STATES.WATCH);
});

test("ENC-T2-04: same raw observation lineage/scope/device cannot create duplicate corroboration", () => {
  const first = finding({ findingId: "F-1" });
  const second = finding({ findingId: "F-2", evidence: [{ field: "trust.testimonials", observedValue: false, provider: "second-provider", sourceStatus: "AVAILABLE", artifactRef: "artifact:1" }] });
  const [a, b] = projectFindings([first, second]);
  assert.equal(a.primary, true);
  assert.equal(b.primary, false);
  assert.equal(b.duplicateOfFindingId, "F-1");
  assert.equal(b.historicalCompatibility, "DUPLICATE_PRIMARY_SUPPRESSED");
});

test("ENC-T2-04B: different observations in one crawl artifact remain distinct findings", () => {
  const first = finding({ findingId: "F-1", ruleId: "VAN-PERF-001", evidence: [{ field: "lcp_ms", observedValue: 5400, provider: "pagespeed-insights", sourceStatus: "AVAILABLE", artifactRef: "artifact:1" }] });
  const second = finding({ findingId: "F-2", ruleId: "VAN-SCHEMA-001", evidence: [{ field: "schema_types", observedValue: [], provider: "dataforseo_onpage", sourceStatus: "AVAILABLE", artifactRef: "artifact:1" }] });
  const [a, b] = projectFindings([first, second]);
  assert.equal(a.primary, true);
  assert.equal(b.primary, true);
  assert.notEqual(a.evidenceLineage.primaryKey, b.evidenceLineage.primaryKey);
});

test("ENC-T2-05: independent lineage families are retained without fake count inflation", () => {
  const projection = projectFinding(finding({ evidence: [
    { field: "x", observedValue: 1, provider: "crawl", sourceStatus: "AVAILABLE", artifactRef: "artifact:1", lineageKey: "condition:1", independenceKey: "condition:1" },
    { field: "y", observedValue: 2, provider: "browser", sourceStatus: "AVAILABLE", artifactRef: "artifact:2", lineageKey: "condition:2", independenceKey: "condition:2" },
  ] }));
  assert.equal(projection.evidenceIndependence.independentFamilyCount, 2);
  assert.equal(projection.evidenceLineage.keys.length, 2);
  assert.equal(projection.primary, true);
});

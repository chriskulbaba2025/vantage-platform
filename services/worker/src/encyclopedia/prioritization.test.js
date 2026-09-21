import test from "node:test";
import assert from "node:assert/strict";
import { FRICTION_STATES } from "./registry.js";
import { projectFinding, projectFindings } from "./projection.js";
import { buildRelationshipCandidates } from "./relationships.js";
import { PRIORITY_UNIT_TYPES, buildPriorityUnits, challengePriorityUnit, validatePriorityUnits } from "./prioritization.js";

function finding(id, overrides = {}) {
  return {
    findingId: id, ruleId: "VAN-TRUST-001", title: id, affectedUrls: ["https://example.test/service"],
    confidence: "deterministic", scoreBearing: true, severity: "High", conversionAction: "contact",
    evidence: [{ field: id, observedValue: true, sourceStatus: "AVAILABLE", lineageKey: `lineage:${id}`, independenceKey: `family:${id}` }],
    ...overrides,
  };
}

function p(id, overrides = {}) { return projectFinding(finding(id, overrides)); }

const rejectionCases = [
  ["missing evidence creates Clear", { evidence: [], frictionState: FRICTION_STATES.CLEAR }],
  ["missing evidence creates Friction", { evidence: [], frictionState: FRICTION_STATES.FRICTION }],
  ["finding count outranks blocker", { findingCountOnly: true }],
  ["duplicate symptoms increase strength", { duplicateOfFindingId: "x" }],
  ["same raw signal is independent", { sameSourceSignalCount: 2, independentEvidenceFamilies: 1 }],
  ["competitor difference creates defect", { competitorOnly: true }],
  ["opportunity is friction", { opportunity: true }],
  ["likely cause is verified", { provenCause: true, mechanismEvidenceStatus: "unknown" }],
  ["mechanism remedy without evidence", { remedySpecificity: "mechanism-specific", mechanismEvidenceStatus: "unknown" }],
  ["mobile generalizes desktop", { deviceContext: ["mobile"], desktopClaim: true }],
  ["single page becomes sitewide", { coverage: "partial", siteWideClaim: true }],
  ["partial acquisition creates certainty", { coverage: "partial", siteWideClaim: true }],
  ["measurement absence becomes conversion", { canonicalProblemId: "K01", frictionState: FRICTION_STATES.FRICTION }],
  ["technical success proves conversion lift", { outcomeVerificationClaim: true, outcomeEvidenceAvailable: false }],
  ["high risk weak repair", { repairRisk: "high", confidence: "directional" }],
  ["clear evidence omitted to look negative", { clearEvidenceOmitted: true, frictionState: FRICTION_STATES.FRICTION }],
  ["encyclopedia selects narrative", { rebuildRecommendation: true }],
  ["contradictory cluster ignored", { contradictoryEvidence: true, conflictResolution: "ignored" }],
  ["utility outranks conversion", { utilityPage: true, primaryConversionPage: false }],
  ["third party presented as client control", { thirdPartyOwnership: "booking-provider", clientDirectControl: true }],
  ["standalone excluded for no partner", { excludeWithoutPartner: true }],
  ["one condition gets multiple labels", { oneObservedConditionMultipleLabels: true }],
  ["journey stage creates relationship", { journeyStageOnly: true }],
  ["repetition proves shared cause", { provenCause: true, mechanismEvidenceStatus: "unknown" }],
  ["providers create independent corroboration", { sameSourceSignalCount: 3, independentEvidenceFamilies: 1 }],
  ["watch count creates friction", { watchCountOnly: true }],
  ["historical outage creates blocker", { historicalOnly: true, freshness: { status: "HISTORICAL" } }],
  ["individual insufficiency creates L01", { individualInsufficientCreatesL01: true }],
  ["mechanism proves business loss", { businessOutcomeClaim: true, businessOutcomeEvidenceStatus: "not available" }],
  ["accessibility implies legal noncompliance", { legalConclusion: true, canonicalProblemId: "H04", complianceOverreach: true }],
];

for (const [name, overrides] of rejectionCases) {
  test(`ENC-T4-REJECT-${name}`, () => {
    const unit = { ...p("x", overrides), ...overrides, canonicalProblemId: overrides.canonicalProblemId || "E01", scope: { urls: ["https://example.test/service"] }, evidence: overrides.evidence || [{ sourceStatus: "AVAILABLE" }], frictionState: overrides.frictionState || FRICTION_STATES.FRICTION };
    const result = challengePriorityUnit(unit);
    assert.equal(result.valid, false, name);
  });
}

test("ENC-T4-01: blocker overrides moderate findings and finding count", () => {
  const blocker = { ...p("blocker", { ruleId: "VAN-PATH-001" }), canonicalProblemId: "F04", currentlyReproducible: true, freshness: { status: "CURRENT" } };
  const moderate = p("moderate", { ruleId: "VAN-TECH-001", severity: "Low" });
  const units = buildPriorityUnits([blocker, moderate], { context: { currentlyReproducible: true } });
  assert.equal(units[0].type, PRIORITY_UNIT_TYPES.BLOCKER);
});

test("ENC-T4-02: accepted cluster requires independent related friction and has explanation", () => {
  const one = p("one", { ruleId: "VAN-TRUST-001", mechanismFamily: "proof", conversionAction: "contact" });
  const two = p("two", { ruleId: "VAN-TRUST-002", mechanismFamily: null, conversionAction: "contact" });
  const relationships = buildRelationshipCandidates([one, two]);
  const units = buildPriorityUnits([one, two], { relationships });
  assert.ok(units.some((unit) => unit.type === PRIORITY_UNIT_TYPES.CLUSTER));
  assert.equal(validatePriorityUnits(units).valid, true);
});

test("ENC-T4-03: standalone material finding is eligible without a cluster partner", () => {
  const one = p("one", { ruleId: "VAN-PATH-001", conversionAction: "contact" });
  const units = buildPriorityUnits([one], { relationships: [] });
  assert.equal(units[0].type, PRIORITY_UNIT_TYPES.STANDALONE);
  assert.equal(validatePriorityUnits(units).valid, true);
});

test("ENC-T4-04: clear, watch and opportunity outcomes remain distinct", () => {
  const clear = p("clear", { confidence: "supported", scoreBearing: false });
  const watch = p("watch", { confidence: "directional" });
  const opportunity = p("opportunity", { opportunity: true });
  assert.equal(clear.frictionState, FRICTION_STATES.CLEAR);
  assert.equal(watch.frictionState, FRICTION_STATES.WATCH);
  assert.equal(challengePriorityUnit({ ...opportunity, canonicalProblemId: "E01", scope: { urls: ["https://example.test"] }, frictionState: FRICTION_STATES.CLEAR, opportunity: true }).valid, false);
});


test("ENC-T3-STANDALONE-ID: standalone priority units retain their source finding IDs for downstream report linkage", () => {
  const projections = [{
    findingId: "F-PERF",
    canonicalProblemId: "I01",
    primary: true,
    title: "Slow primary content display",
    frictionState: FRICTION_STATES.FRICTION,
    scope: { level: "page", urls: ["https://example.test/"] },
    evidence: [{ sourceStatus: "AVAILABLE" }],
    evidenceLineage: { keys: ["artifact:perf#lcp_ms"], primaryKey: "artifact:perf#lcp_ms" },
    evidenceIndependence: { keys: ["artifact:perf#lcp_ms"], independentFamilyCount: 1 },
    confidence: "deterministic",
    severity: "High",
    scoreBearing: true,
    deviceContext: ["mobile"],
    freshness: { status: "CURRENT" },
  }];
  const units = buildPriorityUnits(projections, { relationships: [] });
  assert.equal(units.length, 1);
  assert.deepEqual(units[0].findingIds, ["F-PERF"]);
});


test("ENC-T3-09: a current critical blocker is emitted once and is not duplicated as standalone", () => {
  const projection = {
    findingId: "F-BLOCK",
    canonicalProblemId: "F02",
    primary: true,
    title: "Primary lead form is broken",
    frictionState: FRICTION_STATES.FRICTION,
    scope: { level: "page", urls: ["https://example.test/contact"] },
    conversionAction: "contact",
    evidence: [{ sourceStatus: "AVAILABLE" }],
    evidenceLineage: { keys: ["browser:contact#submit"], primaryKey: "browser:contact#submit" },
    evidenceIndependence: { keys: ["browser:contact#submit"], independentFamilyCount: 1 },
    confidence: "deterministic",
    severity: "High",
    scoreBearing: true,
    deviceContext: ["unspecified"],
    freshness: { status: "CURRENT" },
  };
  const units = buildPriorityUnits([projection], { relationships: [], context: { currentlyReproducible: true } });
  assert.equal(units.length, 1);
  assert.equal(units[0].type, PRIORITY_UNIT_TYPES.BLOCKER);
  assert.deepEqual(units[0].findingIds, ["F-BLOCK"]);
});

test("ENC-T3-10: accepted clusters cannot overlap by reusing the same finding", () => {
  const make = (findingId, canonicalProblemId, action, family) => ({
    findingId,
    canonicalProblemId,
    primary: true,
    title: findingId,
    frictionState: FRICTION_STATES.FRICTION,
    scope: { level: "page", urls: ["https://example.test/service"] },
    conversionAction: action,
    evidence: [{ sourceStatus: "AVAILABLE" }],
    evidenceLineage: { keys: [family], primaryKey: family },
    evidenceIndependence: { keys: [family], independentFamilyCount: 1 },
    confidence: "deterministic",
    severity: "High",
    scoreBearing: true,
    deviceContext: ["unspecified"],
    freshness: { status: "CURRENT" },
  });
  const projections = [
    make("F-1", "F01", "contact", "family:1"),
    make("F-2", "F03", "contact", "family:2"),
    make("F-3", "E01", "contact", "family:3"),
  ];
  const relationships = [
    { eligible: true, type: "Same journey point", findingIds: ["F-1", "F-2"] },
    { eligible: true, type: "Same journey point", findingIds: ["F-2", "F-3"] },
  ];
  const units = buildPriorityUnits(projections, { relationships });
  const ids = units.flatMap((unit) => unit.findingIds || []);
  assert.equal(new Set(ids).size, ids.length);
});

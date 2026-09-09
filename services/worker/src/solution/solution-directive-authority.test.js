import test from "node:test";
import assert from "node:assert/strict";
import { buildSolutionDirectiveInput, SolutionDirectiveAuthorityError } from "./solution-directive-authority.js";
import { generateCanonicalSolutions } from "./solution-generator.js";

const pages = new Set([
  "executive-scorecard",
  "priority-fixes",
  "conversion-paths",
  "content-ideas",
  "competitor-benchmark",
  "trust-eeat",
  "supporting-detail",
]);

function finding(id = "F-1", evidenceRef = "E-1", overrides = {}) {
  return {
    findingId: id,
    title: "Observed condition",
    ruleId: "VAN-TEST-001",
    recommendation: "Legacy recommendation must not be promoted automatically.",
    businessImpact: "Legacy impact must not be promoted automatically.",
    implementationEffort: "M",
    verificationMethod: "Re-crawl and confirm the condition.",
    affectedUrls: ["https://example.com/service", "https://example.com/about"],
    confidence: "deterministic",
    dimension: "technical",
    module: "technical",
    evidence: [{ field: "observed", observedValue: "condition", artifactRef: evidenceRef }],
    ...overrides,
  };
}

function authority(id = "F-1", evidenceRef = "E-1", overrides = {}) {
  const scope = id === "F-2" ? "https://example.com/about" : "https://example.com/service";
  return {
    failureMode: "missing-element",
    findingRefs: [id],
    evidenceRefs: [{ refId: evidenceRef }],
    evidenceGrade: "CONFIRMED",
    prescriptionMode: "PRESCRIPTIVE",
    problem: "The assessed page has the explicitly observed condition.",
    whyItMatters: "The condition can create friction before the next step.",
    siteAnchor: { type: "MISSING_ELEMENT", locator: "observed-component", scope, exact: true, evidenceRefIds: [evidenceRef] },
    whatToChange: "Change the observed condition on the assessed page.",
    howToFix: "Update the affected component and verify the same scoped page.",
    capabilityRequired: ["FRONT_END_DEVELOPMENT"],
    effortBand: "MEDIUM",
    dependencies: [],
    implementationCheck: { checkId: `CHECK-${id}`, instruction: `Inspect ${scope}.`, passCondition: "The changed component is present.", failCondition: "The changed component remains absent.", anchorScope: scope },
    disposition: "FIX_NOW",
    clientProminence: { level: "PRIMARY", displayAllowed: true, displayReason: "Explicitly prominent governed action." },
    crossPageReferences: [{ pageId: "priority-fixes", referenceType: "DETAIL", label: "Priority Fixes" }],
    ...overrides,
  };
}

function input(overrides = {}) {
  const findings = overrides.findings || [finding("F-1", "E-1"), finding("F-2", "E-2")];
  const scoreSet = overrides.scoreSet || {
    decisionHierarchy: {
      hierarchyVersion: "1.0.0",
      provenance: "decision-hierarchy-v1",
      rootCauseRuleId: "VAN-TEST-001",
      orderedFindingIds: findings.map((item) => item.findingId),
      actions: findings.map((item, index) => ({ findingId: item.findingId, rank: index + 1 })),
    },
  };
  const authorityRecords = overrides.authorityRecords || {
    "F-1": authority("F-1", "E-1"),
    "F-2": authority("F-2", "E-2"),
  };
  return {
    findings,
    scoreSet,
    decisionEvidence: overrides.decisionEvidence || { rawArtifactRef: "E-1" },
    authorityRecords,
    pageRegistry: overrides.pageRegistry || pages,
  };
}

function authorityFails(value, code) {
  assert.throws(() => buildSolutionDirectiveInput(value), (error) => {
    assert.ok(error instanceof SolutionDirectiveAuthorityError);
    assert.ok(error.errors.some((item) => item.code === code), JSON.stringify(error.errors));
    return true;
  });
}

function generatorFails(value, code) {
  assert.throws(() => generateCanonicalSolutions(value), (error) => {
    assert.ok(error.errors.some((item) => item.code === code), JSON.stringify(error.errors));
    return true;
  });
}

test("complete explicit authority builds input and passes the accepted generator", () => {
  const generatorInput = buildSolutionDirectiveInput(input());
  assert.deepEqual(Object.keys(generatorInput).sort(), ["decisionHierarchy", "findings", "solutionDirectives", "validationContext"]);
  const generated = generateCanonicalSolutions(generatorInput);
  assert.equal(generated.records.length, 2);
});

test("missing authority record fails closed", () => authorityFails(input({ authorityRecords: { "F-1": authority("F-1", "E-1") } }), "AUTH-MISSING"));
test("extra authority outside the governed hierarchy fails closed", () => authorityFails(input({ authorityRecords: { "F-1": authority("F-1", "E-1"), "F-2": authority("F-2", "E-2"), "F-3": authority("F-3", "E-1") } }), "AUTH-HIERARCHY"));
test("duplicate authority value fails closed", () => authorityFails(input({ authorityRecords: { "F-1": [authority("F-1", "E-1"), authority("F-1", "E-1")] } }), "AUTH-DUPLICATE"));
test("hierarchy ID without a finding fails", () => authorityFails(input({ scoreSet: { decisionHierarchy: { provenance: "x", orderedFindingIds: ["MISSING"], actions: [{ findingId: "MISSING", rank: 1 }] } } }), "AUTH-HIERARCHY"));
test("actionable finding absent from hierarchy fails", () => authorityFails(input({ findings: [finding("F-1", "E-1"), finding("F-2", "E-2")], scoreSet: { decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-1"], actions: [{ findingId: "F-1", rank: 1 }] } }, authorityRecords: { "F-1": authority("F-1", "E-1") } }), "AUTH-HIERARCHY"));
test("governed rank is preserved exactly", () => {
  const result = buildSolutionDirectiveInput(input({ scoreSet: { decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-1", "F-2"], actions: [{ findingId: "F-1", rank: 7 }, { findingId: "F-2", rank: 11 }] } } }));
  assert.deepEqual(result.decisionHierarchy.actions.map((item) => item.rank), [7, 11]);
});
test("hierarchy provenance becomes unchanged rank source", () => assert.equal(buildSolutionDirectiveInput(input()).decisionHierarchy.provenance, "decision-hierarchy-v1"));

for (const [name, field, legacy] of [
  ["recommendation is never used for whatToChange", "whatToChange", undefined],
  ["recommendation is never used for howToFix", "howToFix", undefined],
  ["businessImpact is never promoted to whyItMatters", "whyItMatters", undefined],
  ["legacy effort is never promoted to canonical effortBand", "effortBand", "M"],
  ["verificationMethod is never promoted to implementationCheck", "implementationCheck", undefined],
]) {
  test(name, () => {
    const record = authority("F-1", "E-1");
    delete record[field];
    const expected = field === "effortBand" ? "AUTH-EFFORT" : field === "implementationCheck" ? "AUTH-IMPLEMENTATION-CHECK" : "AUTH-MISSING";
    authorityFails(input({ authorityRecords: { "F-1": record, "F-2": authority("F-2", "E-2") } }), expected);
    void legacy;
  });
}

test("sourceStatus is never promoted to evidenceGrade", () => {
  const record = authority("F-1", "E-1"); delete record.evidenceGrade;
  authorityFails(input({ decisionEvidence: { sourceStatus: "AVAILABLE", rawArtifactRef: "E-1" }, authorityRecords: { "F-1": record, "F-2": authority("F-2", "E-2") } }), "AUTH-EVIDENCE-GRADE");
});
test("confidence is never promoted to evidenceGrade", () => {
  const record = authority("F-1", "E-1"); delete record.evidenceGrade;
  authorityFails(input({ authorityRecords: { "F-1": record, "F-2": authority("F-2", "E-2") } }), "AUTH-EVIDENCE-GRADE");
});
test("module/rule/dimension is never promoted to capabilityRequired", () => {
  const record = authority("F-1", "E-1"); delete record.capabilityRequired;
  authorityFails(input({ authorityRecords: { "F-1": record, "F-2": authority("F-2", "E-2") } }), "AUTH-CAPABILITY");
});
test("priority/rank is never promoted to disposition", () => {
  const record = authority("F-1", "E-1"); delete record.disposition;
  authorityFails(input({ authorityRecords: { "F-1": record, "F-2": authority("F-2", "E-2") } }), "AUTH-DISPOSITION");
});
test("priority/order never creates a dependency", () => {
  const result = buildSolutionDirectiveInput(input());
  assert.deepEqual(result.solutionDirectives["F-1"].dependencies, []);
});

test("missing failureMode fails", () => { const r = authority("F-1", "E-1"); delete r.failureMode; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-MISSING"); });
test("missing evidenceGrade fails", () => { const r = authority("F-1", "E-1"); delete r.evidenceGrade; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-EVIDENCE-GRADE"); });
test("missing prescriptionMode fails", () => { const r = authority("F-1", "E-1"); delete r.prescriptionMode; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-PRESCRIPTION"); });
test("missing explicit siteAnchor fails", () => { const r = authority("F-1", "E-1"); delete r.siteAnchor; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-ANCHOR"); });
test("multiple affected URLs do not select an anchor automatically", () => { const r = authority("F-1", "E-1"); delete r.siteAnchor; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-ANCHOR"); });
test("multiple evidence records do not select evidence automatically", () => { const r = authority("F-1", "E-1"); delete r.evidenceRefs; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-EVIDENCE-REF"); });
test("missing evidence reference fails", () => { const r = authority("F-1", "MISSING"); authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-EVIDENCE-REF"); });
test("missing anchor evidence reference fails", () => { const r = authority("F-1", "E-1"); r.siteAnchor.evidenceRefIds = ["MISSING"]; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-ANCHOR"); });
test("PARTIAL with PRESCRIPTIVE fails", () => { const r = authority("F-1", "E-1", { evidenceGrade: "PARTIAL" }); authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-PRESCRIPTION"); });
test("UNKNOWN with FIX_NOW remediation fails", () => { const r = authority("F-1", "E-1", { evidenceGrade: "UNKNOWN", prescriptionMode: "PRESCRIPTIVE" }); authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-PRESCRIPTION"); });
test("explicit UNKNOWN effort is preserved", () => { const r = authority("F-1", "E-1", { effortBand: "UNKNOWN" }); const out = buildSolutionDirectiveInput(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } })); assert.equal(out.solutionDirectives["F-1"].effortBand, "UNKNOWN"); });
test("missing capability fails", () => { const r = authority("F-1", "E-1"); delete r.capabilityRequired; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-CAPABILITY"); });
test("missing disposition fails", () => { const r = authority("F-1", "E-1"); delete r.disposition; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-DISPOSITION"); });
test("missing implementation check fails", () => { const r = authority("F-1", "E-1"); delete r.implementationCheck; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-IMPLEMENTATION-CHECK"); });
test("generic verificationMethod does not rescue missing implementation check", () => { const r = authority("F-1", "E-1"); delete r.implementationCheck; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-IMPLEMENTATION-CHECK"); });
for (const field of ["passCondition", "failCondition"]) test(`missing implementation ${field} fails`, () => { const r = authority("F-1", "E-1"); delete r.implementationCheck[field]; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-IMPLEMENTATION-CHECK"); });
test("identical pass/fail condition fails", () => { const r = authority("F-1", "E-1"); r.implementationCheck.failCondition = r.implementationCheck.passCondition; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-IMPLEMENTATION-CHECK"); });
test("anchor scope mismatch fails", () => { const r = authority("F-1", "E-1"); r.implementationCheck.anchorScope = "https://example.com/about"; authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-IMPLEMENTATION-CHECK"); });
test("explicit dependency is preserved", () => { const r = authority("F-1", "E-1", { dependencies: [{ targetIssueId: "F-2", dependencyType: "prerequisite", reason: "Foundation first" }] }); assert.deepEqual(buildSolutionDirectiveInput(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } })).solutionDirectives["F-1"].dependencies[0].targetIssueId, "F-2"); });
test("missing dependency target fails", () => { const r = authority("F-1", "E-1", { dependencies: [{ targetIssueId: "MISSING", dependencyType: "prerequisite", reason: "Required" }] }); authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-DEPENDENCY"); });
test("dependency cycle fails through accepted generator", () => { const r1 = authority("F-1", "E-1", { dependencies: [{ targetIssueId: "F-2", dependencyType: "prerequisite", reason: "A" }] }); const r2 = authority("F-2", "E-2", { dependencies: [{ targetIssueId: "F-1", dependencyType: "prerequisite", reason: "B" }] }); generatorFails(buildSolutionDirectiveInput(input({ authorityRecords: { "F-1": r1, "F-2": r2 } })), "V22"); });
test("ACCEPT remains non-active", () => { const r = authority("F-1", "E-1", { prescriptionMode: "NON_REMEDIATION", disposition: "ACCEPT", clientProminence: { level: "DIAGNOSTIC", displayAllowed: false, displayReason: "Accepted explicitly." } }); assert.deepEqual(generateCanonicalSolutions(buildSolutionDirectiveInput(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }))).activeSequence.length, 1); });
test("INVESTIGATE remains non-active", () => { const r = authority("F-1", "E-1", { evidenceGrade: "UNKNOWN", prescriptionMode: "INVESTIGATIVE", disposition: "INVESTIGATE", clientProminence: { level: "DIAGNOSTIC", displayAllowed: false, displayReason: "Investigation explicitly required." } }); assert.deepEqual(generateCanonicalSolutions(buildSolutionDirectiveInput(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }))).activeSequence.length, 1); });
test("unknown page ID fails", () => { const r = authority("F-1", "E-1", { crossPageReferences: [{ pageId: "page-7", referenceType: "DETAIL", label: "Invalid" }] }); authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-PAGE"); });
test("existing registered page ID passes", () => { const out = buildSolutionDirectiveInput(input()); assert.equal(out.solutionDirectives["F-1"].crossPageReferences[0].pageId, "priority-fixes"); });
test("no Page 7 is synthesized", () => { const out = buildSolutionDirectiveInput(input()); assert.equal(out.validationContext.pageIds.has("page-7"), false); });
test("diagnostic prominence with displayAllowed fails", () => { const r = authority("F-1", "E-1", { clientProminence: { level: "DIAGNOSTIC", displayAllowed: true, displayReason: "Invalid" } }); authorityFails(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } }), "AUTH-DISPOSITION"); });
test("outcomeSignal is absent when not explicit", () => assert.equal(Object.hasOwn(buildSolutionDirectiveInput(input()).solutionDirectives["F-1"], "outcomeSignal"), false));
test("complete explicit outcomeSignal is preserved", () => { const r = authority("F-1", "E-1", { outcomeSignal: { signalId: "O-1", metric: "LCP", baseline: "6464ms lab baseline", measurementPath: "Repeat the same lab run", timeHorizon: "next audit", boundedInterpretation: "Compare implementation state without promising a business result." } }); assert.deepEqual(buildSolutionDirectiveInput(input({ authorityRecords: { "F-1": r, "F-2": authority("F-2", "E-2") } })).solutionDirectives["F-1"].outcomeSignal, r.outcomeSignal); });

test("findings are not mutated", () => { const value = input(); const before = structuredClone(value.findings); buildSolutionDirectiveInput(value); assert.deepEqual(value.findings, before); });
test("ScoreSet is not mutated", () => { const value = input(); const before = structuredClone(value.scoreSet); buildSolutionDirectiveInput(value); assert.deepEqual(value.scoreSet, before); });
test("DecisionEvidence is not mutated", () => { const value = input(); const before = structuredClone(value.decisionEvidence); buildSolutionDirectiveInput(value); assert.deepEqual(value.decisionEvidence, before); });
test("authorityRecords are not mutated", () => { const value = input(); const before = structuredClone(value.authorityRecords); buildSolutionDirectiveInput(value); assert.deepEqual(value.authorityRecords, before); });
test("pageRegistry is not mutated", () => { const value = input(); const before = [...value.pageRegistry]; buildSolutionDirectiveInput(value); assert.deepEqual([...value.pageRegistry], before); });
test("equivalent cloned input produces deeply equal authority output", () => assert.deepEqual(buildSolutionDirectiveInput(input()), buildSolutionDirectiveInput(structuredClone(input()))));
test("equivalent authority output produces stable generator result", () => { const a = generateCanonicalSolutions(buildSolutionDirectiveInput(input())); const b = generateCanonicalSolutions(buildSolutionDirectiveInput(structuredClone(input()))); assert.deepEqual(a, b); });
test("conflicting overlapping directives fail closed rather than selecting one", () => { const r1 = authority("F-1", "E-1"); const r2 = authority("F-2", "E-2", { siteAnchor: { ...authority("F-1", "E-1").siteAnchor, evidenceRefIds: ["E-2"] }, implementationCheck: { ...authority("F-1", "E-1").implementationCheck }, whatToChange: "A conflicting remedy." }); generatorFails(buildSolutionDirectiveInput(input({ authorityRecords: { "F-1": r1, "F-2": r2 } })), "GEN-MERGE-CONFLICT"); });
test("strictest evidence constraint remains enforced during explicit merge", () => { const shared = authority("F-1", "E-1", { prescriptionMode: "CONDITIONAL", disposition: "FIX_LATER" }); const partial = authority("F-2", "E-2", { failureMode: "missing-element", evidenceGrade: "PARTIAL", prescriptionMode: "CONDITIONAL", disposition: "FIX_LATER", evidenceRefs: [{ refId: "E-1" }, { refId: "E-2" }], siteAnchor: { ...shared.siteAnchor, evidenceRefIds: ["E-1"] }, implementationCheck: { ...shared.implementationCheck }, }); const result = generateCanonicalSolutions(buildSolutionDirectiveInput(input({ authorityRecords: { "F-1": shared, "F-2": partial } }))); assert.equal(result.records.length, 1); assert.equal(result.records[0].evidenceGrade, "PARTIAL"); });

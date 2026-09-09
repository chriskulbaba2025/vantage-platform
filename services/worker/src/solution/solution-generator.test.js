import test from "node:test";
import assert from "node:assert/strict";
import { generateCanonicalSolutions, SolutionGeneratorError } from "./solution-generator.js";

const context = {
  evidenceRefs: new Set(["E-1", "E-2", "E-3"]),
  pageIds: new Set(["priority-fixes", "supporting-detail"]),
};

function directive(overrides = {}) {
  return {
    failureMode: "missing-element",
    mergedFrom: [],
    findingRefs: ["F-1"],
    evidenceGrade: "CONFIRMED",
    prescriptionMode: "PRESCRIPTIVE",
    problem: "A confirmed page condition was observed.",
    whyItMatters: "It may create friction before the next step.",
    siteAnchor: { type: "URL", locator: "https://example.com/service", scope: "https://example.com/service", exact: true, evidenceRefIds: ["E-1"] },
    whatToChange: "Change the observed page condition.",
    howToFix: "Update the affected page component and retest the same URL.",
    capabilityRequired: ["FRONT_END_DEVELOPMENT"],
    effortBand: "MEDIUM",
    dependencies: [],
    implementationCheck: { checkId: "CHK-1", instruction: "Check the affected URL.", passCondition: "The changed component is present.", failCondition: "The changed component is absent.", anchorScope: "https://example.com/service" },
    disposition: "FIX_NOW",
    clientProminence: { level: "PRIMARY", displayAllowed: true, displayReason: "Top governed client action." },
    crossPageReferences: [{ pageId: "priority-fixes", referenceType: "DETAIL", label: "Priority Fixes" }],
    evidenceRefs: [{ refId: "E-1" }],
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    findings: [{ findingId: "F-1" }, { findingId: "F-2" }],
    decisionHierarchy: {
      provenance: "decision-hierarchy-v1",
      orderedFindingIds: ["F-1", "F-2"],
      actions: [{ findingId: "F-1", rank: 1 }, { findingId: "F-2", rank: 2 }],
    },
    solutionDirectives: {
      "F-1": directive(),
      "F-2": directive({ findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-2" }], siteAnchor: { type: "URL", locator: "https://example.com/about", scope: "https://example.com/about", exact: true, evidenceRefIds: ["E-2"] }, implementationCheck: { checkId: "CHK-2", instruction: "Check the about URL.", passCondition: "The change is present.", failCondition: "The change is absent.", anchorScope: "https://example.com/about" } }),
    },
    validationContext: context,
    ...overrides,
  };
}

function fails(value, pattern) {
  assert.throws(() => generateCanonicalSolutions(value), (error) => {
    assert.ok(error instanceof SolutionGeneratorError);
    assert.ok(error.errors.some((item) => pattern.test(`${item.code} ${item.field} ${item.message}`)), JSON.stringify(error.errors));
    return true;
  });
}

test("CONFIRMED anchored prescriptive record generates successfully", () => {
  const result = generateCanonicalSolutions(input({ findings: [{ findingId: "F-1" }], decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-1"], actions: [{ findingId: "F-1", rank: 1 }] }, solutionDirectives: { "F-1": directive() } }));
  assert.equal(result.records.length, 1);
  assert.match(result.records[0].solutionId, /^SOL-[A-F0-9]{16}$/);
});

test("PARTIAL conditional record generates successfully", () => {
  const d = directive({ evidenceGrade: "PARTIAL", prescriptionMode: "CONDITIONAL", disposition: "FIX_LATER", problem: "Some assessed pages have a condition.", whatToChange: "Where the assessed condition is confirmed, change the scoped page.", howToFix: "Confirm the condition on the assessed page, then update it." });
  const result = generateCanonicalSolutions(input({ findings: [{ findingId: "F-1" }], decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-1"], actions: [{ findingId: "F-1", rank: 1 }] }, solutionDirectives: { "F-1": d } }));
  assert.equal(result.records[0].evidenceGrade, "PARTIAL");
});

test("UNKNOWN investigative record generates successfully", () => {
  const d = directive({ evidenceGrade: "UNKNOWN", prescriptionMode: "INVESTIGATIVE", disposition: "INVESTIGATE", whatToChange: "Investigate the unassessed condition.", howToFix: "Collect the missing evidence before proposing remediation.", clientProminence: { level: "DIAGNOSTIC", displayAllowed: false, displayReason: "Unknown evidence requires investigation." } });
  const result = generateCanonicalSolutions(input({ findings: [{ findingId: "F-1" }], decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-1"], actions: [{ findingId: "F-1", rank: 1 }] }, solutionDirectives: { "F-1": d } }));
  assert.equal(result.records[0].disposition, "INVESTIGATE");
  assert.deepEqual(result.activeSequence, []);
});

test("PARTIAL unqualified prescriptive input fails closed", () => fails(input({ solutionDirectives: { "F-1": directive({ evidenceGrade: "PARTIAL" }), "F-2": directive({ findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-2" }], siteAnchor: { type: "URL", locator: "https://example.com/about", scope: "https://example.com/about", exact: true, evidenceRefIds: ["E-2"] }, implementationCheck: { checkId: "CHK-2", instruction: "Check the about URL.", passCondition: "The change is present.", failCondition: "The change is absent.", anchorScope: "https://example.com/about" } }) } }), /V10/));

test("UNKNOWN remediation input fails closed", () => fails(input({ solutionDirectives: { "F-1": directive({ evidenceGrade: "UNKNOWN" }), "F-2": directive({ findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-2" }], siteAnchor: { type: "URL", locator: "https://example.com/about", scope: "https://example.com/about", exact: true, evidenceRefIds: ["E-2"] }, implementationCheck: { checkId: "CHK-2", instruction: "Check the about URL.", passCondition: "The change is present.", failCondition: "The change is absent.", anchorScope: "https://example.com/about" } }) } }), /V12/));

test("missing site anchor is not invented and fails", () => fails(input({ solutionDirectives: { "F-1": directive({ siteAnchor: undefined }), "F-2": directive({ findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-2" }], siteAnchor: { type: "URL", locator: "https://example.com/about", scope: "https://example.com/about", exact: true, evidenceRefIds: ["E-2"] }, implementationCheck: { checkId: "CHK-2", instruction: "Check the about URL.", passCondition: "The change is present.", failCondition: "The change is absent.", anchorScope: "https://example.com/about" } }) } }), /GEN-DIRECTIVE/));

test("missing capability is not invented and fails", () => fails(input({ solutionDirectives: { "F-1": directive({ capabilityRequired: [] }), "F-2": directive({ findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-2" }], siteAnchor: { type: "URL", locator: "https://example.com/about", scope: "https://example.com/about", exact: true, evidenceRefIds: ["E-2"] }, implementationCheck: { checkId: "CHK-2", instruction: "Check the about URL.", passCondition: "The change is present.", failCondition: "The change is absent.", anchorScope: "https://example.com/about" } }) } }), /V15/));

test("missing governed effort is not guessed", () => fails(input({ solutionDirectives: { "F-1": directive({ effortBand: undefined }), "F-2": directive({ findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-2" }], siteAnchor: { type: "URL", locator: "https://example.com/about", scope: "https://example.com/about", exact: true, evidenceRefIds: ["E-2"] }, implementationCheck: { checkId: "CHK-2", instruction: "Check the about URL.", passCondition: "The change is present.", failCondition: "The change is absent.", anchorScope: "https://example.com/about" } }) } }), /V16/));

test("explicit UNKNOWN effort is accepted", () => {
  const d = directive({ effortBand: "UNKNOWN" });
  const result = generateCanonicalSolutions(input({ findings: [{ findingId: "F-1" }], decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-1"], actions: [{ findingId: "F-1", rank: 1 }] }, solutionDirectives: { "F-1": d } }));
  assert.equal(result.records[0].effortBand, "UNKNOWN");
});

test("missing implementation check is not synthesized from vague prose", () => fails(input({ solutionDirectives: { "F-1": directive({ implementationCheck: undefined }), "F-2": directive({ findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-2" }], siteAnchor: { type: "URL", locator: "https://example.com/about", scope: "https://example.com/about", exact: true, evidenceRefIds: ["E-2"] }, implementationCheck: { checkId: "CHK-2", instruction: "Check the about URL.", passCondition: "The change is present.", failCondition: "The change is absent.", anchorScope: "https://example.com/about" } }) } }), /V17/));

test("outcomeSignal is absent by default and complete signal passes", () => {
  const result = generateCanonicalSolutions(input({ findings: [{ findingId: "F-1" }], decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-1"], actions: [{ findingId: "F-1", rank: 1 }] }, solutionDirectives: { "F-1": directive() } }));
  assert.equal("outcomeSignal" in result.records[0], false);
  const withSignal = generateCanonicalSolutions(input({ findings: [{ findingId: "F-1" }], decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-1"], actions: [{ findingId: "F-1", rank: 1 }] }, solutionDirectives: { "F-1": directive({ outcomeSignal: { signalId: "O-1", metric: "LCP", baseline: "6464ms on assessed lab run", measurementPath: "PageSpeed Insights mobile rerun", timeHorizon: "next audit", boundedInterpretation: "Compare the implementation metric; no business outcome is promised." } }) } }));
  assert.equal(withSignal.records[0].outcomeSignal.signalId, "O-1");
});

test("stable solutionId is repeatable and independent of input array order", () => {
  const first = generateCanonicalSolutions(input());
  const reversed = input({ findings: [{ findingId: "F-2" }, { findingId: "F-1" }], solutionDirectives: { "F-1": directive(), "F-2": input().solutionDirectives["F-2"] } });
  const second = generateCanonicalSolutions(reversed);
  assert.equal(first.records[0].solutionId, second.records[0].solutionId);
});

test("same normalized issue identity merges with strictest evidence and deduplicated refs", () => {
  const d1 = directive({ prescriptionMode: "CONDITIONAL", disposition: "FIX_LATER" });
  const d2 = directive({ findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-1" }, { refId: "E-2" }], evidenceGrade: "PARTIAL", prescriptionMode: "CONDITIONAL", disposition: "FIX_LATER" });
  const result = generateCanonicalSolutions(input({ solutionDirectives: { "F-1": d1, "F-2": d2 } }));
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].evidenceGrade, "PARTIAL");
  assert.deepEqual(result.records[0].findingRefs, ["F-1", "F-2"]);
  assert.equal(new Set(result.records[0].evidenceRefs.map((ref) => ref.refId)).size, 2);
});

test("conflicting merged remedy fails closed", () => fails(input({ solutionDirectives: { "F-1": directive(), "F-2": directive({ findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-2" }], siteAnchor: { type: "URL", locator: "https://example.com/service", scope: "https://example.com/service", exact: true, evidenceRefIds: ["E-2"] }, whatToChange: "A materially different remedy." }) } }), /GEN-MERGE-CONFLICT/));

test("different normalized identities remain separate", () => {
  const result = generateCanonicalSolutions(input());
  assert.equal(result.records.length, 2);
});

test("decisionHierarchy mismatch fails closed", () => fails(input({ decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-2", "F-1"], actions: [{ findingId: "F-2", rank: 2 }, { findingId: "F-1", rank: 1 }] } }), /GEN-HIERARCHY/));

test("governed rank is preserved", () => {
  const result = generateCanonicalSolutions(input());
  assert.deepEqual(result.records.map((record) => record.sequenceInputs.governedRank), [1, 2]);
});

test("explicit dependency places prerequisite before dependent", () => {
  const d1 = directive({ dependencies: [{ targetIssueId: "F-2", dependencyType: "prerequisite", reason: "Foundation first" }] });
  const result = generateCanonicalSolutions(input({ solutionDirectives: { "F-1": d1, "F-2": input().solutionDirectives["F-2"] } }));
  assert.deepEqual(result.activeSequence, [result.records[1].solutionId, result.records[0].solutionId]);
});

test("missing dependency fails", () => fails(input({ solutionDirectives: { "F-1": directive({ dependencies: [{ targetIssueId: "MISSING", dependencyType: "prerequisite", reason: "Required" }] }), "F-2": input().solutionDirectives["F-2"] } }), /GEN-DEPENDENCY/));

test("dependency cycle fails", () => fails(input({ solutionDirectives: { "F-1": directive({ dependencies: [{ targetIssueId: "F-2", dependencyType: "prerequisite", reason: "A" }] }), "F-2": input().solutionDirectives["F-2"] = directive({ findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-2" }], siteAnchor: { type: "URL", locator: "https://example.com/about", scope: "https://example.com/about", exact: true, evidenceRefIds: ["E-2"] }, implementationCheck: { checkId: "CHK-2", instruction: "Check the about URL.", passCondition: "The change is present.", failCondition: "The change is absent.", anchorScope: "https://example.com/about" }, dependencies: [{ targetIssueId: "F-1", dependencyType: "prerequisite", reason: "B" }] }) } }), /V22/));

test("ACCEPT and INVESTIGATE remain outside active sequence", () => {
  const result = generateCanonicalSolutions(input({ solutionDirectives: { "F-1": directive({ disposition: "ACCEPT", prescriptionMode: "NON_REMEDIATION", whatToChange: "No remediation proposed.", howToFix: "Retain the accepted state.", clientProminence: { level: "DIAGNOSTIC", displayAllowed: false, displayReason: "Accepted state is not an active fix." } }), "F-2": directive({ evidenceGrade: "UNKNOWN", prescriptionMode: "INVESTIGATIVE", disposition: "INVESTIGATE", findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-2" }], siteAnchor: { type: "URL", locator: "https://example.com/about", scope: "https://example.com/about", exact: true, evidenceRefIds: ["E-2"] }, whatToChange: "Investigate the unknown condition.", howToFix: "Collect evidence first.", clientProminence: { level: "DIAGNOSTIC", displayAllowed: false, displayReason: "Investigation only." }, implementationCheck: { checkId: "CHK-2", instruction: "Collect evidence for the about URL.", passCondition: "Evidence is available.", failCondition: "Evidence remains unavailable.", anchorScope: "https://example.com/about" } }) } }));
  assert.deepEqual(result.activeSequence, []);
});

test("unsupported/stale cross-page reference and diagnostic display fail through validator", () => {
  fails(input({ solutionDirectives: { "F-1": directive({ crossPageReferences: [{ pageId: "stale", referenceType: "DETAIL", label: "Stale" }] }), "F-2": input().solutionDirectives["F-2"] } }), /V23/);
  fails(input({ solutionDirectives: { "F-1": directive({ clientProminence: { level: "DIAGNOSTIC", displayAllowed: true, displayReason: "bad" } }), "F-2": input().solutionDirectives["F-2"] } }), /V24/);
});

test("generator surfaces validator errors with stage/code instead of hiding them", () => {
  assert.throws(() => generateCanonicalSolutions(input({ solutionDirectives: { "F-1": directive({ capabilityRequired: [] }), "F-2": input().solutionDirectives["F-2"] } })), (error) => {
    assert.ok(error.errors.some((item) => item.stage === "validation" && item.code === "V15"));
    return true;
  });
});

test("input objects are not mutated and equivalent cloned input is deeply equal", () => {
  const original = input();
  const snapshot = structuredClone(original);
  const first = generateCanonicalSolutions(original);
  const second = generateCanonicalSolutions(structuredClone(original));
  assert.deepEqual(original, snapshot);
  assert.deepEqual(first, second);
});

test("missing explicit directive fails before any inferred solution is emitted", () => {
  fails(input({ solutionDirectives: { "F-1": directive() } }), /GEN-DIRECTIVE/);
});

test("missing persisted evidence context fails closed", () => {
  fails(input({ validationContext: {} }), /GEN-EVIDENCE-CONTEXT/);
});

test("missing governed finding fails closed", () => {
  fails(input({ findings: [{ findingId: "F-1" }] }), /GEN-HIERARCHY/);
});

test("invalid complete-looking outcome signal is delegated to V20", () => {
  fails(input({ findings: [{ findingId: "F-1" }], decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-1"], actions: [{ findingId: "F-1", rank: 1 }] }, solutionDirectives: { "F-1": directive({ outcomeSignal: { signalId: "O-1", metric: "LCP" } }) } }), /V20/);
});

test("job-title capability is not accepted as a generated capability", () => {
  fails(input({ findings: [{ findingId: "F-1" }], decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-1"], actions: [{ findingId: "F-1", rank: 1 }] }, solutionDirectives: { "F-1": directive({ capabilityRequired: ["developer"] }) } }), /V15/);
});

test("merged UNKNOWN evidence remains UNKNOWN rather than being upgraded", () => {
  const unknown = directive({ evidenceGrade: "UNKNOWN", prescriptionMode: "INVESTIGATIVE", disposition: "INVESTIGATE", whatToChange: "Investigate the condition.", howToFix: "Collect the missing evidence before remediation.", clientProminence: { level: "DIAGNOSTIC", displayAllowed: false, displayReason: "Investigation only." } });
  const second = directive({ findingRefs: ["F-2"], evidenceRefs: [{ refId: "E-2" }], evidenceGrade: "UNKNOWN", prescriptionMode: "INVESTIGATIVE", disposition: "INVESTIGATE", whatToChange: "Investigate the condition.", howToFix: "Collect the missing evidence before remediation.", clientProminence: { level: "DIAGNOSTIC", displayAllowed: false, displayReason: "Investigation only." } });
  const result = generateCanonicalSolutions(input({ solutionDirectives: { "F-1": unknown, "F-2": second } }));
  assert.equal(result.records[0].evidenceGrade, "UNKNOWN");
});

test("non-default governed ranks are preserved without recomputation", () => {
  const result = generateCanonicalSolutions(input({ decisionHierarchy: { provenance: "x", orderedFindingIds: ["F-1", "F-2"], actions: [{ findingId: "F-1", rank: 7 }, { findingId: "F-2", rank: 11 }] } }));
  assert.deepEqual(result.records.map((record) => record.sequenceInputs.governedRank), [7, 11]);
});

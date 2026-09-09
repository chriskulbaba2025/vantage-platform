import test from "node:test";
import assert from "node:assert/strict";
import { validateSolutionRecord, validateSolutionSet } from "./solution-validator.js";

const context = {
  findingIds: new Set(["F-1", "F-2"]),
  mergedIds: new Set(["F-1", "F-2"]),
  evidenceRefs: new Set(["E-1", "E-2"]),
  pageIds: new Set(["priority-fixes", "supporting-detail"]),
};

function base(overrides = {}) {
  return {
    solutionId: "SOL-1",
    issueId: "ISSUE-1",
    mergedFrom: ["F-1"],
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
    sequenceInputs: { governedRank: 1, rankSource: "conversion-influence", dependencyState: "READY", effortBand: "MEDIUM", eligibility: true },
    evidenceRefs: [{ refId: "E-1" }],
    clientProminence: { level: "PRIMARY", displayAllowed: true, displayReason: "Top governed client action." },
    crossPageReferences: [{ pageId: "priority-fixes", referenceType: "DETAIL", label: "Priority Fixes" }],
    ...overrides,
  };
}

function codes(result) { return new Set(result.errors.map((error) => error.code)); }

test("valid CONFIRMED record passes", () => assert.equal(validateSolutionRecord(base(), context).valid, true));

test("valid PARTIAL conditional record passes", () => {
  const result = validateSolutionRecord(base({
    evidenceGrade: "PARTIAL",
    prescriptionMode: "CONDITIONAL",
    disposition: "FIX_LATER",
    problem: "Some assessed pages have a missing element.",
    whatToChange: "Where the assessed condition is confirmed, add the missing element on the assessed page.",
    howToFix: "Confirm the condition on the scoped page, then update that page only.",
  }), context);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("valid UNKNOWN investigative record passes", () => {
  const result = validateSolutionRecord(base({
    evidenceGrade: "UNKNOWN", prescriptionMode: "INVESTIGATIVE", disposition: "INVESTIGATE",
    whatToChange: "Investigate whether the condition exists on the unassessed scope.",
    howToFix: "Collect the missing evidence before proposing remediation.",
    clientProminence: { level: "DIAGNOSTIC", displayAllowed: false, displayReason: "Unknown evidence requires investigation." },
  }), context);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("required fields and V01/V03 failures are fail-closed", () => {
  const result = validateSolutionRecord({}, context);
  assert.ok(codes(result).has("V01"));
  assert.ok(codes(result).has("V03"));
});

test("V02 duplicate solution IDs and V04 duplicate issue identity are rejected", () => {
  const result = validateSolutionSet([base(), base({ issueId: "ISSUE-1" })], context);
  assert.ok(codes(result).has("V02"));
  assert.ok(codes(result).has("V04"));
});

test("V05/V06/V07 reject missing or unresolved references", () => {
  assert.ok(codes(validateSolutionRecord(base({ mergedFrom: ["NOPE"] }), context)).has("V05"));
  assert.ok(codes(validateSolutionRecord(base({ evidenceRefs: [] }), context)).has("V06"));
  assert.ok(codes(validateSolutionRecord(base({ evidenceRefs: [{ refId: "NOPE" }] }), context)).has("V07"));
});

test("V08/V09 reject invalid evidence and prescription enums", () => {
  const result = validateSolutionRecord(base({ evidenceGrade: "MAYBE", prescriptionMode: "GUESS" }), context);
  assert.ok(codes(result).has("V08"));
  assert.ok(codes(result).has("V09"));
});

test("V10/V11/V12 enforce evidence strength", () => {
  assert.ok(codes(validateSolutionRecord(base({ evidenceGrade: "PARTIAL", prescriptionMode: "PRESCRIPTIVE" }), context)).has("V10"));
  assert.ok(codes(validateSolutionRecord(base({ evidenceGrade: "PARTIAL", prescriptionMode: "CONDITIONAL", problem: "A confirmed issue.", whatToChange: "Fix it.", howToFix: "Do it." }), context)).has("V11"));
  assert.ok(codes(validateSolutionRecord(base({ evidenceGrade: "UNKNOWN", prescriptionMode: "PRESCRIPTIVE" }), context)).has("V12"));
});

test("V13/V14 reject missing and vague anchors", () => {
  assert.ok(codes(validateSolutionRecord(base({ siteAnchor: null }), context)).has("V13"));
  assert.ok(codes(validateSolutionRecord(base({ siteAnchor: { type: "URL", locator: "some pages", scope: "some pages", exact: true, evidenceRefIds: ["E-1"] } }), context)).has("V13"));
  assert.ok(codes(validateSolutionRecord(base({ prescriptionMode: "INVESTIGATIVE", evidenceGrade: "UNKNOWN", disposition: "INVESTIGATE", siteAnchor: { type: "URL", locator: "some pages", scope: "some pages", exact: true, evidenceRefIds: ["E-1"] }, clientProminence: { level: "DIAGNOSTIC", displayAllowed: false, displayReason: "Investigate." } }), context)).has("V14"));
});

test("V15 rejects missing capabilities and job titles", () => {
  assert.ok(codes(validateSolutionRecord(base({ capabilityRequired: [] }), context)).has("V15"));
  assert.ok(codes(validateSolutionRecord(base({ capabilityRequired: ["DEVELOPER"] }), context)).has("V15"));
});

test("V16 allows UNKNOWN effort and rejects guessed effort metadata", () => {
  const safe = validateSolutionRecord(base({ effortBand: "UNKNOWN", sequenceInputs: { ...base().sequenceInputs, effortBand: "UNKNOWN" } }), context);
  assert.equal(safe.valid, true, JSON.stringify(safe.errors));
  const bad = validateSolutionRecord(base({ effortBand: "4 hours" }), context);
  assert.ok(codes(bad).has("V16"));
});

test("V17/V18 reject missing, vague, and outcome-based implementation checks", () => {
  assert.ok(codes(validateSolutionRecord(base({ implementationCheck: undefined }), context)).has("V17"));
  assert.ok(codes(validateSolutionRecord(base({ implementationCheck: { checkId: "x", instruction: "Improve search visibility", passCondition: "More leads", failCondition: "Fewer leads", anchorScope: "https://example.com/service" } }), context)).has("V18"));
});

test("V19 rejects invalid disposition pairing", () => {
  assert.ok(codes(validateSolutionRecord(base({ disposition: "INVESTIGATE" }), context)).has("V19"));
});

test("V20 rejects outcome signals without bounded baseline/path", () => {
  const result = validateSolutionRecord(base({ outcomeSignal: { signalId: "O-1", metric: "conversion rate" } }), context);
  assert.ok(codes(result).has("V20"));
});

test("V21 rejects malformed/unresolved dependencies", () => {
  assert.ok(codes(validateSolutionRecord(base({ dependencies: [{ targetSolutionId: "NOPE" }] }), { ...context, solutionIds: new Set(["SOL-1"]) })).has("V21"));
});

test("V23 rejects orphan references and V24 rejects invalid prominence", () => {
  assert.ok(codes(validateSolutionRecord(base({ crossPageReferences: [{ pageId: "missing", referenceType: "DETAIL", label: "x" }] }), context)).has("V23"));
  assert.ok(codes(validateSolutionRecord(base({ clientProminence: { level: "DIAGNOSTIC", displayAllowed: true, displayReason: "x" } }), context)).has("V24"));
});

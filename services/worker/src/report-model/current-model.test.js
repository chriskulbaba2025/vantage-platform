import test from "node:test";
import assert from "node:assert/strict";
import { hydrateCurrentReportModel } from "./current-model.js";

const scoreSet = {
  scoringVersion: "4.2.0", generatedAt: "2026-08-31T00:00:00.000Z",
  scores: { conversionReadiness: 65 }, bands: { conversionReadiness: "MEDIUM" },
  assessedWeight: 1, readinessStatus: "READY", readinessStatusDetail: "Evidence-backed",
  showNumericScore: true, evidenceConfidenceScore: 95, evidenceConfidenceFactorAvailability: [],
  rootCauseRuleId: "VAN-CONV-001", rootCause: "Offer clarity",
  decisionHierarchy: { version: "1.0.0", orderedFindingIds: ["F-1"], rootCauseRuleId: "VAN-CONV-001", actions: [{ findingId: "F-1", ruleId: "VAN-CONV-001", rank: 1, effort: "S", actionClass: "CLARITY", conversionInfluence: "DIRECT" }] },
  conversionPaths: [], readinessMap: [], contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
  competitors: { comparisons: [], opportunities: { topics: [], qualifiedCandidates: [], excludedCandidates: [], gaps: [], allGaps: [], sources: {}, limitations: [] } },
  crossReportInterpretation: { version: "1.0.0", constructs: { offerClarity: "Observed service scope", ctaClarity: "Clear", conversionPathClarity: "Clear", trustProof: "Moderate", mobileUsability: "Strong", indexability: "Strong" } },
};

test("T2-MODEL-01: current report consumers receive one persisted semantic source", () => {
  const model = hydrateCurrentReportModel({ scoreSet, findings: [{ findingId: "F-1" }], decisionEvidence: { sourceStatus: { competitors: "AVAILABLE" } }, capabilityEvidence: {} });
  assert.equal(model.rootCauseRuleId, scoreSet.decisionHierarchy.rootCauseRuleId);
  assert.strictEqual(model.decisionHierarchy, scoreSet.decisionHierarchy);
  assert.strictEqual(model.findings[0].findingId, "F-1");
});

test("T2-MODEL-02: missing persisted hierarchy fails closed", () => {
  assert.throws(() => hydrateCurrentReportModel({ scoreSet: { ...scoreSet, decisionHierarchy: null }, findings: [] }), /decision hierarchy/);
});

test("P1-CROSS-03: missing persisted interpretation fails closed at hydration", () => {
  const { crossReportInterpretation, ...missingProjection } = scoreSet;
  assert.throws(() => hydrateCurrentReportModel({ scoreSet: missingProjection, findings: [] }), /persisted cross-report interpretation/);
});

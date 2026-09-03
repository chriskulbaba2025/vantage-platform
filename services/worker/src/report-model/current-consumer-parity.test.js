import test from "node:test";
import assert from "node:assert/strict";
import { buildReportViewModel } from "../report-view-model/build-view-model.js";
import { buildV2Model as buildNarrativeV2Model } from "../narrative-v2/production-path.js";
import { buildV2Model as buildReplayV2Model } from "../../scripts/replay-report.js";

const decisionHierarchy = {
  version: "1.0.0", rootCauseRuleId: "VAN-CONV-001", orderedFindingIds: ["F-1", "F-2"],
  actions: [
    { findingId: "F-1", ruleId: "VAN-CONV-001", rank: 1, effort: "S", actionClass: "CLARITY", conversionInfluence: "DIRECT" },
    { findingId: "F-2", ruleId: "VAN-CONV-002", rank: 2, effort: "M", actionClass: "TRUST", conversionInfluence: "SUPPORTING" },
  ],
};
const findings = [{ findingId: "F-1" }, { findingId: "F-2" }];
const scoreSet = {
  contractVersion: "2.0.0", scoringVersion: "4.2.0", generatedAt: "2026-08-31T00:00:00.000Z",
  scores: {}, bands: {}, assessedWeight: 1, readinessStatus: "READY", readinessStatusDetail: "Evidence-backed",
  showNumericScore: true, evidenceConfidenceScore: 95, evidenceConfidenceFactorAvailability: [],
  rootCauseRuleId: "VAN-CONV-001", rootCause: "Offer clarity", decisionHierarchy,
  conversionPaths: [], readinessMap: [], contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
  competitors: { comparisons: [], opportunities: { topics: [], qualifiedCandidates: [], excludedCandidates: [], gaps: [], allGaps: [], sources: {}, limitations: [] } },
  crossReportInterpretation: { version: "1.0.0", constructs: { offerClarity: "Observed service scope", ctaClarity: "Clear", conversionPathClarity: "Clear", trustProof: "Moderate", mobileUsability: "Strong", indexability: "Strong" } },
  findings,
};
const decisionEvidence = { site: { targetUrl: "https://example.test" }, sourceStatus: { competitors: "PARTIAL" } };
const capabilityEvidence = { contractVersion: "1.0.0", sourceCapabilities: { competitors: { status: "PARTIAL" } } };
const auditRequest = { businessName: "Example", targetUrl: "https://example.test" };

test("T2-PARITY-01: base, Narrative v2, and replay preserve one current semantic identity", () => {
  const baseResult = buildReportViewModel({
    reportPackage: { auditId: "A-1", business: { domain: "example.test", name: "Example" }, sourceStatus: {} },
    narrative: { auditId: "A-1" }, scoringModel: scoreSet,
    validateContract: () => ({ valid: true, errors: [] }), now: "2026-08-31T00:00:00.000Z",
    decisionEvidence, capabilityEvidence,
  });
  const narrative = buildNarrativeV2Model({ auditRequest, scoreSet, findings, decisionEvidence, capabilityEvidence });
  const replay = buildReplayV2Model({ auditRequest, scoreSet, findings, decisionEvidence, capabilityEvidence });

  assert.equal(baseResult.valid, true);
  for (const model of [baseResult.model, narrative, replay]) {
    assert.strictEqual(model.decisionHierarchy, decisionHierarchy);
    assert.equal(model.rootCauseRuleId, decisionHierarchy.rootCauseRuleId);
    assert.strictEqual(model.evidence, decisionEvidence);
    assert.strictEqual(model.capabilityEvidence, capabilityEvidence);
  }
  assert.deepEqual(narrative.sourceStatus, replay.sourceStatus);
});

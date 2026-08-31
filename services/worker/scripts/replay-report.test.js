import test from "node:test";
import assert from "node:assert/strict";
import { buildV2Model } from "./replay-report.js";

const decisionHierarchy = {
  version: "1.0.0",
  rootCauseRuleId: "VAN-CONV-001",
  orderedFindingIds: ["F-1", "F-2"],
  actions: [],
};

const scoreSet = {
  scoringVersion: "4.2.0",
  generatedAt: "2026-08-31T00:00:00.000Z",
  scores: {}, bands: {}, assessedWeight: 1,
  readinessStatus: "READY", readinessStatusDetail: "Evidence-backed",
  showNumericScore: true, evidenceConfidenceScore: 95,
  evidenceConfidenceFactorAvailability: [],
  rootCauseRuleId: "VAN-CONV-001", rootCause: "Offer clarity",
  decisionHierarchy,
};

test("T2-REPLAY-01: current replay consumes the canonical persisted model", () => {
  const model = buildV2Model({
    auditRequest: { businessName: "Example", targetUrl: "https://example.test" },
    scoreSet,
    findings: [{ findingId: "F-1" }, { findingId: "F-2" }],
    capabilityEvidence: {},
    decisionEvidence: { site: { targetUrl: "https://example.test" }, sourceStatus: { competitors: "AVAILABLE" } },
  });

  assert.strictEqual(model.decisionHierarchy, decisionHierarchy);
  assert.equal(model.rootCauseRuleId, decisionHierarchy.rootCauseRuleId);
  assert.deepEqual(model.decisionHierarchy.orderedFindingIds, ["F-1", "F-2"]);
});

test("T2-REPLAY-02: current replay fails closed without persisted hierarchy", () => {
  assert.throws(
    () => buildV2Model({ auditRequest: {}, scoreSet: { ...scoreSet, decisionHierarchy: null }, findings: [], capabilityEvidence: {}, decisionEvidence: {} }),
    /decision hierarchy/,
  );
});

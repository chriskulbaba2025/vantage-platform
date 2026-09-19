import test from "node:test";
import assert from "node:assert/strict";
import { hydrateCurrentReportModel } from "./current-model.js";

const scoreSet = {
  scoringVersion: "4.2.0", generatedAt: "2026-08-31T00:00:00.000Z", scores: {}, bands: {}, assessedWeight: 100,
  readinessStatus: "READY", readinessStatusDetail: "Evidence-backed", showNumericScore: true, evidenceConfidenceScore: 95,
  rootCauseRuleId: "VAN-TRUST-001", rootCause: "Trust proof",
  decisionHierarchy: { version: "1.0.0", orderedFindingIds: ["F-1"], rootCauseRuleId: "VAN-TRUST-001", actions: [{ findingId: "F-1", ruleId: "VAN-TRUST-001", rank: 1, effort: "M", actionClass: "TRUST", conversionInfluence: "DIRECT" }] },
  crossReportInterpretation: { version: "1.0.0", constructs: { conversionPathClarity: "Clear", trustProof: "Moderate" } },
};

const finding = { findingId: "F-1", ruleId: "VAN-TRUST-001", title: "Trust proof missing", affectedUrls: ["https://example.test"], evidence: [{ field: "trust.testimonials", observedValue: false, sourceStatus: "AVAILABLE", artifactRef: "a" }], confidence: "deterministic", scoreBearing: true, severity: "High" };

test("ENC-T5-04: current report hydration carries encyclopedia as downstream data", () => {
  const model = hydrateCurrentReportModel({ scoreSet, findings: [finding], decisionEvidence: {}, capabilityEvidence: {} });
  assert.equal(model.encyclopedia.status, "AVAILABLE");
  assert.equal(model.encyclopedia.projections[0].canonicalProblemId, "E01");
});

test("ENC-T5-05: explicit historical absence remains not available", () => {
  const model = hydrateCurrentReportModel({ scoreSet, findings: [finding], decisionEvidence: {}, capabilityEvidence: {}, encyclopediaProjection: { status: "NOT_AVAILABLE", projections: [], relationships: [], priorityUnits: [] } });
  assert.equal(model.encyclopedia.status, "NOT_AVAILABLE");
});

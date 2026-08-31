import test from "node:test";
import assert from "node:assert/strict";

import { buildScoreSet } from "../scoring/scoring-service.js";
import { buildWriterInput } from "./writer-input.js";

const AUDIT_ID = "97d6b2c7-03b9-4530-8ea7-16557502c638";

test("INTERPRETATION-04: siteFootprint survives ScoreSet into WriterInput and reference index", () => {
  const siteFootprint = {
    discoveredUrlCount: 1248,
    retainedUrlCount: 1000,
    assessedPageCount: 250,
    providerCrawlCeiling: 250,
    priorityUrlCount: 20,
    discoveryComplete: false,
    materialFamilies: [
      {
        familyId: "services",
        discoveredCount: 87,
        represented: true,
      },
      {
        familyId: "locations",
        discoveredCount: 642,
        represented: true,
      },
    ],
    limitations: [
      "Discovery was bounded before exhaustive site coverage was established.",
    ],
  };

  const model = {
    generatedAt: "2026-08-26T00:00:00.000Z",
    assessedWeight: 100,
    readinessStatus: "Moderate",
    readinessStatusDetail: "Core dimensions were assessed.",
    showNumericScore: true,
    evidenceConfidenceScore: 90,
    evidenceConfidenceFactors: {},
    evidenceConfidenceFactorAvailability: {},
    capabilityEvidence: {},
    suppressedFindingReasons: [],
    aiReadinessBasis: null,
    moduleScores: {},
    moduleEligibility: {},
    suppressedModules: [],
    scores: {
      trust: 70,
      contentDepth: 70,
      conversionPathways: 70,
      technical: 70,
      performance: 70,
      conversionReadiness: 70,
      awareness: 70,
      consideration: 70,
      decision: 70,
      aiReadiness: 70,
      conversionPathwaysDimension: 70,
      trustEeatDimension: 70,
      contentFunnelDimension: 70,
      technicalPerformanceDimension: 70,
      entitySchemaAiDimension: 70,
    },
    bands: {
      conversionReadiness: "Moderate",
      trust: "Moderate",
      evidenceConfidence: "High",
    },
    dimensionEligibility: {},
    rootCause: "Example deterministic root cause.",
    findings: [],
    conversionPaths: [],
    readinessMap: [],
    contentIdeas: {},
    competitors: {},
    renderingDiagnostics: [],
    evidence: {
      site: {
        siteFootprint,
      },
    },
  };

  const scoreSet = buildScoreSet(model, null, null);
  scoreSet.rootCauseRuleId = null;
  scoreSet.findingIds = [];
  scoreSet.decisionHierarchy = {
    hierarchyVersion: "1.0.0",
    provenance: "scoreAudit/action-priority",
    rootCauseRuleId: null,
    orderedFindingIds: [],
    actions: [],
  };

  assert.deepEqual(scoreSet.siteFootprint, siteFootprint);

  const writerInput = buildWriterInput({
    auditId: AUDIT_ID,
    auditRequest: {
      businessName: "Reboot Business Coaching",
      targetUrl: "https://rebootbusinesscoaching.com/",
    },
    scoreSet,
    findings: [],
    capabilityEvidence: {
      auditId: AUDIT_ID,
      capabilityEvidenceVersion: "2.0.0",
      capabilities: {},
    },
  });

  assert.deepEqual(
    writerInput.deterministicAnalysis.siteFootprint,
    siteFootprint,
  );

  assert.deepEqual(
    writerInput.referenceIndex["analysis:siteFootprint"],
    {
      kind: "deterministic-analysis",
      path: "deterministicAnalysis.siteFootprint",
    },
  );
});

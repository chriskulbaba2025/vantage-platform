import test from "node:test";
import assert from "node:assert/strict";
import { hydrateCurrentReportModel } from "../report-model/current-model.js";
import { renderReportV2, REPORT_V2_VIEWER_PAGES } from "./render-report-v2.js";

function solution(solutionId, rank, overrides = {}) {
  return {
    solutionId,
    findingRefs: [`finding-${rank}`],
    evidenceRefs: [{ refId: `evidence-${rank}` }],
    evidenceGrade: "PARTIAL",
    prescriptionMode: "CONDITIONAL",
    problem: `Canonical problem ${rank}`,
    whyItMatters: `Canonical reason ${rank}`,
    whatToChange: `Canonical change ${rank}`,
    howToFix: `Canonical fix ${rank}`,
    siteAnchor: { type: "URL", locator: `/page-${rank}`, scope: "https://example.test/", exact: true },
    capabilityRequired: ["CONTENT_STRATEGY"],
    effortBand: "MEDIUM",
    dependencies: [],
    implementationCheck: {
      instruction: `Inspect canonical ${rank}.`,
      passCondition: `Canonical ${rank} is present.`,
      failCondition: `Canonical ${rank} is absent.`,
    },
    disposition: "FIX_LATER",
    clientProminence: { displayAllowed: true, level: "PRIMARY" },
    crossPageReferences: [{ pageId: "priority-fixes", referenceType: "DETAIL" }],
    sequenceInputs: { governedRank: rank },
    ...overrides,
  };
}

function model(canonicalSolutions) {
  const truth = Object.fromEntries([
    "offerClarity", "ctaClarity", "conversionPathClarity", "buyerQuestionCoverage",
    "trustProof", "performanceReadiness", "mobileUsability", "indexability", "evidenceScope",
  ].map((key) => [key, {
    state: "assessed", scope: "governed scope", observation: "governed observation",
    clientConclusion: "governed conclusion", prohibitedUpgrades: [], evidenceRefs: [],
  }]));
  return {
    scoringVersion: "4.1.1",
    generatedAt: "2026-09-09T00:00:00.000Z",
    scores: { conversionReadiness: 50 },
    bands: { conversionReadiness: "Moderate", evidenceConfidence: "Moderate" },
    assessedWeight: 100,
    readinessStatus: "Provisional",
    readinessStatusDetail: "Governed assessment",
    evidenceConfidenceScore: 70,
    evidenceConfidenceFactorAvailability: [],
    rootCauseRuleId: "ROOT-1",
    rootCause: "Governed root cause",
    decisionHierarchy: { orderedFindingIds: ["finding-1", "finding-2"] },
    findings: [
      { findingId: "finding-1", actionable: true, ruleId: "VAN-CONTENT-001", scoreBearing: true },
      { findingId: "finding-2", actionable: true, ruleId: "VAN-CONTENT-002", scoreBearing: true },
    ],
    renderingDiagnostics: [],
    suppressedFindingReasons: [],
    moduleEligibility: {},
    moduleScores: {},
    suppressedModules: [],
    capabilityEvidence: { summary: { total: 1, assessed: 1 }, capabilities: [] },
    evidence: {
      site: { sourceStatus: "AVAILABLE", targetUrl: "https://example.test/", domain: "example.test", pages: [], pageCount: 0 },
      performance: { sourceStatus: "UNAVAILABLE" },
    },
    canonicalSolutions,
    conversionPaths: [],
    readinessMap: [],
    contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
    competitors: { comparisons: [], opportunities: { topics: [], qualifiedCandidates: [], excludedCandidates: [], gaps: [], allGaps: [], sources: {}, limitations: [] } },
    crossReportInterpretation: {
      version: "2.0.0",
      contract: "CLIENT_TRUTH",
      constructs: {
        offerClarity: "assessed",
        ctaClarity: "assessed",
        conversionPathClarity: "assessed",
        trustProof: "assessed",
        mobileUsability: "assessed",
        indexability: "assessed",
      },
      truth,
    },
  };
}

test("canonical solutions are carried by the current report model", () => {
  const canonicalSolutions = { records: [solution("SOL-ONE", 1)], sequence: ["SOL-ONE"] };
  const hydrated = hydrateCurrentReportModel({
    scoreSet: { ...model(canonicalSolutions), decisionHierarchy: { orderedFindingIds: [] } },
    findings: [],
    decisionEvidence: {},
    capabilityEvidence: {},
    canonicalSolutions,
  });
  assert.deepEqual(hydrated.canonicalSolutions, canonicalSolutions);
});

test("Priority Fixes renders canonical detail and stable IDs in governed order", () => {
  const canonicalSolutions = {
    records: [solution("SOL-ONE", 1), solution("SOL-TWO", 2)],
    sequence: ["SOL-TWO", "SOL-ONE"],
  };
  const html = renderReportV2(model({ ...canonicalSolutions, records: [solution("SOL-TWO", 2), solution("SOL-ONE", 1)] }));
  const priority = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  assert.match(priority, /data-solution-id="SOL-TWO"/);
  assert.match(priority, /Canonical problem 2/);
  assert.match(priority, /Canonical reason 2/);
  assert.match(priority, /Canonical change 2/);
  assert.match(priority, /Canonical fix 2/);
  assert.doesNotMatch(priority, /<dt>What needs attention<\/dt>/);
  assert.match(priority, /<dt>What to change<\/dt>[\s\S]*Canonical change 2/);
  assert.match(priority, /<dt>How to fix it<\/dt>[\s\S]*Canonical fix 2/);
  assert.ok(priority.indexOf("SOL-TWO") < priority.indexOf("SOL-ONE"));
});

test("missing canonical solutions fail closed without legacy remedy fallback", () => {
  const html = renderReportV2({ ...model({ records: [], sequence: [] }), findings: [], decisionHierarchy: { orderedFindingIds: [] } });
  const priority = html.slice(html.indexOf('id="blockers"'), html.indexOf('id="foundations"'));
  assert.match(priority, /No prioritized action was produced from the available evidence/);
  assert.doesNotMatch(priority, /recommendation|businessImpact|how to fix it/i);
});

test("viewer architecture remains six primary pages plus Supporting Detail", () => {
  assert.deepEqual(REPORT_V2_VIEWER_PAGES.map((page) => page.pageId), [
    "executive-scorecard", "priority-fixes", "conversion-paths", "content-ideas",
    "competitor-benchmark", "trust-eeat", "supporting-detail",
  ]);
});

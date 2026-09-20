import test from "node:test";
import assert from "node:assert/strict";
import { buildPersistedV2RenderModel } from "./audit-orchestrator.js";
import { renderReportV2 } from "../report/render-report-v2.js";
import { SOLUTION_RULE_VERSION } from "../solution/solution-authority-provider.js";
import { buildCrossReportInterpretation } from "../report-model/cross-report-interpretation.js";

const rules = [
  "VAN-CONTENT-001",
  "VAN-CONTENT-002",
  "VAN-PERF-001",
  "VAN-TRUST-001",
  "VAN-TECH-001",
];
const evidenceFields = ["page_count", "trust.faq", "lcp_ms", "trust.testimonials", "meta_description"];

const findings = rules.map((ruleId, index) => ({
  findingId: `TBK-F-${index + 1}`,
  ruleId,
  ruleVersion: SOLUTION_RULE_VERSION,
  evidence: [{ field: evidenceFields[index], observedValue: "governed observation", artifactRef: `TBK-E-${index + 1}` }],
  confidence: "deterministic",
  implementationEffort: "M",
  finalPriority: 100 - index,
  title: `Governed finding ${index + 1}`,
  recommendation: "Governed recommendation",
  businessImpact: "Governed impact",
  verificationMethod: "Governed verification",
  affectedUrls: ["https://tbk.example/"],
  module: "governed",
  dimension: "governed",
}));

const scoreSet = {
  contractVersion: "2.0.0",
  scoringVersion: "4.1.2",
  generatedAt: "2026-09-14T00:00:00.000Z",
  scores: { performance: 63, trust: 75 },
  bands: {},
  assessedWeight: 100,
  readinessStatus: "Provisional",
  readinessStatusDetail: "Governed persisted assessment",
  showNumericScore: true,
  evidenceConfidenceScore: 80,
  evidenceConfidenceFactorAvailability: [],
  rootCauseRuleId: rules[0],
  rootCause: "Governed root cause",
  decisionHierarchy: {
    provenance: "scoreAudit/action-priority",
    rootCauseRuleId: rules[0],
    orderedFindingIds: findings.map((finding) => finding.findingId),
    actions: findings.map((finding, index) => ({ findingId: finding.findingId, rank: index + 1 })),
  },
  suppressedFindingReasons: [],
  moduleEligibility: {},
  moduleScores: {},
  suppressedModules: [],
  conversionPaths: [],
  readinessMap: [],
  contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
  competitors: { comparisons: [], opportunities: { topics: [], qualifiedCandidates: [], excludedCandidates: [], gaps: [], allGaps: [], sources: {}, limitations: [] } },
  crossReportInterpretation: {
    version: "1.0.0",
    constructs: {
      offerClarity: "governed",
      ctaClarity: "governed",
      conversionPathClarity: "governed",
      trustProof: "governed",
      mobileUsability: "governed",
      indexability: "governed",
    },
  },
};

const decisionEvidence = {
  contractVersion: "1.0.0",
  decisionEvidenceVersion: "1.0.0",
  site: {
    sourceStatus: "AVAILABLE",
    targetUrl: "https://tbk.example/",
    domain: "tbk.example",
    trust: { sourceStatus: "AVAILABLE", score: 75, proof: "AVAILABLE" },
  },
  performance: {
    sourceStatus: "AVAILABLE",
    lab: { sourceStatus: "AVAILABLE", score: 63 },
    field: { sourceStatus: "UNAVAILABLE" },
  },
};

test("TBK Stage 2: persisted v2 projections preserve evidence and five-action order", () => {
  const persistedScoreSet = {
    ...scoreSet,
    crossReportInterpretation: buildCrossReportInterpretation({
      site: decisionEvidence.site,
      performance: decisionEvidence.performance,
      scores: scoreSet.scores,
      bands: scoreSet.bands,
      conversionPaths: scoreSet.conversionPaths,
      capabilities: {},
    }),
  };
  const model = buildPersistedV2RenderModel({
    auditRequest: { businessName: "TBK", targetUrl: "https://tbk.example/" },
    scoreSet: persistedScoreSet,
    findings,
    decisionEvidence,
    capabilityEvidence: {},
  });

  assert.strictEqual(model.evidence.performance, decisionEvidence.performance);
  assert.equal(model.evidence.performance.lab.sourceStatus, "AVAILABLE");
  assert.equal(model.evidence.performance.field.sourceStatus, "UNAVAILABLE");
  assert.strictEqual(model.evidence.site.trust, decisionEvidence.site.trust);
  assert.equal(model.scores.performance, 63);
  assert.equal(model.scores.trust, 75);
  assert.deepEqual(model.findings.map((finding) => finding.findingId), findings.map((finding) => finding.findingId));
  assert.deepEqual(model.decisionHierarchy.orderedFindingIds, findings.map((finding) => finding.findingId));
  assert.equal(model.canonicalSolutions.records.length, 5);
  assert.deepEqual(model.canonicalSolutions.sequence, model.canonicalSolutions.records.map((record) => record.solutionId));

  const html = renderReportV2(model);
  assert.doesNotMatch(html, /No performance evidence was collected/);
  assert.doesNotMatch(html, /No prioritized action was produced from the available evidence/);
});

import test from "node:test";
import assert from "node:assert/strict";

import { buildWriterInput } from "./writer-input.js";

const auditId = "33333333-3333-4333-8333-333333333333";

function fixture() {
  const findingId = "finding-1";
  return {
    auditId,
    auditRequest: {
      businessName: "Reference Test",
      targetUrl: "https://example.com/",
      primaryGoal: "qualified enquiries",
    },
    scoreSet: {
      scoringVersion: "4.0.0",
      scores: {
        trust: 70,
        contentDepth: 80,
        conversionPathways: 60,
        technical: 75,
        performance: 77,
        conversionReadiness: 72,
        trustEeatDimension: 70,
      },
      bands: { conversionReadiness: "Moderate", trust: "Moderate", evidenceConfidence: "High" },
      assessedWeight: 90,
      readinessStatus: "Moderate",
      showNumericScore: true,
      evidenceConfidenceScore: 92,
      dimensionEligibility: {
        conversion_pathways: true,
        trust_eeat: true,
        content_funnel: true,
        technical_performance: true,
        entity_schema_ai: true,
      },
      moduleEligibility: { trust_proof: true },
      suppressedModules: [],
      rootCause: "Proof is not consistently connected to the conversion path.",
      findingIds: [findingId],
      rootCauseRuleId: "trust.proof.1",
      decisionHierarchy: {
        hierarchyVersion: "1.0.0",
        provenance: "scoreAudit/action-priority",
        rootCauseRuleId: "trust.proof.1",
        orderedFindingIds: [findingId],
        actions: [{ findingId, ruleId: "trust.proof.1", rank: 1, priority: 90, effort: "M", actionClass: "conversion", foundationDomain: null, conversionInfluence: "direct", conversionInfluenceRank: 1 }],
      },
      sourceDependencies: { website: "AVAILABLE", backlinks: "FAILED" },
      contentIdeas: { awareness: [], consideration: [], decision: [] },
    },
    findings: [{
      findingId,
      ruleId: "trust.proof.1",
      ruleVersion: "1.0.0",
      dimension: "trust_eeat",
      module: "trust_proof",
      title: "Proof is separated from decision content",
      affectedUrls: ["https://example.com/"],
      evidence: [{ field: "site.pages[].bodyText", observedValue: "proof evidence", source: "dataforseo-onpage" }],
      confidence: "supported",
      businessImpact: "Visitors must work harder to validate the offer.",
      recommendation: "Move relevant proof into decision-stage pages.",
      implementationEffort: "M",
      verificationMethod: "Re-crawl the decision page and confirm proof appears in-page.",
      scoreBearing: true,
      severity: "High",
      finalPriority: 90,
    }],
    capabilityEvidence: {
      capabilityEvidenceVersion: "2.0.0",
      auditId,
      capabilities: {
        "trust.proof": {
          capability: "trust.proof",
          status: "PARTIAL",
          coverage: { requested: 5, completed: 4, failed: 1 },
          provenance: { source: "dataforseo-onpage", adapterVersion: "1.0.0", artifactRef: "evidence.json" },
          limitations: ["One page unavailable"],
          requiredFieldsPresent: true,
        },
      },
      summary: { total: 1, partial: 1, assessed: 1 },
    },
  };
}

test("WRITER-REF-01: reference index exposes only governed packet paths", () => {
  const packet = buildWriterInput(fixture());

  assert.deepEqual(packet.referenceIndex["business:primaryGoal"], {
    kind: "business",
    path: "business.primaryGoal",
  });
  assert.deepEqual(packet.referenceIndex["score:trustEeatDimension"], {
    kind: "score",
    path: "score.scores.trustEeatDimension",
  });
  assert.deepEqual(packet.referenceIndex["finding:finding-1"], {
    kind: "finding",
    path: "findings.finding-1",
  });
  assert.deepEqual(packet.referenceIndex["capability:trust.proof"], {
    kind: "capability",
    path: "capabilityContext.capabilities.trust.proof",
  });
  assert.deepEqual(packet.referenceIndex["source:backlinks"], {
    kind: "source-status",
    path: "scoreGovernance.sourceDependencies.backlinks",
  });
  assert.deepEqual(packet.referenceIndex["analysis:contentIdeas"], {
    kind: "deterministic-analysis",
    path: "deterministicAnalysis.contentIdeas",
  });
});

test("WRITER-REF-02: reference index cannot expose guessed aliases", () => {
  const input = fixture();
  input.scoreSet.scores.eeatScore = 999;
  input.auditRequest.domain = "guessed.example";
  input.findings[0].impact = "compatibility alias";

  const packet = buildWriterInput(input);
  const ids = Object.keys(packet.referenceIndex);

  assert.equal(ids.includes("score:eeatScore"), false);
  assert.equal(ids.includes("business:domain"), false);
  assert.equal(ids.includes("finding:impact"), false);
  assert.equal(JSON.stringify(packet.referenceIndex).includes("eeatScore"), false);
  assert.equal(JSON.stringify(packet.referenceIndex).includes("guessed.example"), false);
});

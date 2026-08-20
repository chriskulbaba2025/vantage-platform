import test from "node:test";
import assert from "node:assert/strict";

import { buildWriterInput, WRITER_INPUT_VERSION } from "./writer-input.js";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";
const FINDING_ID = "finding-technical-001";

function finding(overrides = {}) {
  return {
    findingId: FINDING_ID,
    ruleId: "technical.canonical.missing",
    ruleVersion: "1.0.0",
    dimension: "technical_performance",
    module: "technical_hygiene",
    title: "Canonical tag missing",
    affectedUrls: ["https://example.com/service"],
    evidence: [{
      field: "site.pages[].canonicalUrl",
      observedValue: null,
      source: "dataforseo-onpage",
      provider: "dataforseo",
      sourceStatus: "AVAILABLE",
      artifactRef: "tenant/example/evidence.json",
    }],
    confidence: "deterministic",
    businessImpact: "Search engines may receive a weaker canonical URL signal.",
    recommendation: "Add a self-referencing canonical tag.",
    implementationEffort: "L",
    verificationMethod: "Re-crawl the affected URL and confirm canonicalUrl is present.",
    scoreBearing: true,
    severity: "Medium",
    finalPriority: 72,
    ...overrides,
  };
}

function scoreSet(overrides = {}) {
  return {
    contractVersion: "1.0.0",
    scoringVersion: "4.0.0",
    scores: {
      trust: 74,
      contentDepth: 81,
      conversionPathways: 68,
      technical: 66,
      performance: 71,
      conversionReadiness: 72,
      awareness: 82,
      consideration: 76,
      decision: 65,
      aiReadiness: 70,
      conversionPathwaysDimension: 68,
      trustEeatDimension: 74,
      contentFunnelDimension: 77,
      technicalPerformanceDimension: 66,
      entitySchemaAiDimension: 70,
      eeatScore: 999,
    },
    bands: {
      conversionReadiness: "Moderate",
      trust: "Moderate",
      evidenceConfidence: "High",
    },
    assessedWeight: 93,
    readinessStatus: "Moderate",
    readinessStatusDetail: "Most core dimensions were assessed.",
    showNumericScore: true,
    evidenceConfidenceScore: 91,
    evidenceConfidenceFactors: { website: 100, competitors: 80 },
    dimensionEligibility: {
      conversion_pathways: true,
      trust_eeat: true,
      content_funnel: true,
      technical_performance: true,
      entity_schema_ai: true,
    },
    moduleEligibility: { technical_hygiene: true },
    suppressedModules: [],
    rootCause: "Strong subject depth is not consistently carried into proof and conversion pathways.",
    findingIds: [FINDING_ID],
    sourceDependencies: {
      website: "AVAILABLE",
      performance: "AVAILABLE",
      competitors: "PARTIAL",
      backlinks: "FAILED",
    },
    conversionPaths: [{ pathId: "path-1", status: "validated" }],
    readinessMap: [{ area: "decision", status: "Limited" }],
    contentIdeas: { awareness: ["Guide topic"], consideration: ["Comparison topic"], decision: ["Proof topic"] },
    competitors: { supplied: ["https://competitor.example/"] },
    renderingDiagnostics: [{ code: "R1", category: "coverage", explanation: "example", confidence: "deterministic" }],
    ...overrides,
  };
}

function capabilityEvidence(overrides = {}) {
  return {
    contractVersion: "1.0.0",
    capabilityEvidenceVersion: "2.0.0",
    auditId: AUDIT_ID,
    generatedAt: "2026-08-20T00:00:00.000Z",
    capabilities: {
      "technical.indexability": {
        capability: "technical.indexability",
        status: "AVAILABLE",
        coverage: { requested: 12, completed: 12, failed: 0 },
        provenance: { source: "dataforseo-onpage", adapterVersion: "1.0.0", artifactRef: "tenant/example/evidence.json" },
        limitations: [],
        requiredFieldsPresent: true,
      },
      "trust.proof": {
        capability: "trust.proof",
        status: "PARTIAL",
        coverage: { requested: 10, completed: 7, failed: 3 },
        provenance: { source: "dataforseo-onpage", adapterVersion: "1.0.0", artifactRef: "tenant/example/evidence.json" },
        limitations: ["Three key pages did not return usable parsed content"],
        requiredFieldsPresent: true,
      },
    },
    summary: { total: 2, available: 1, partial: 1, assessed: 2 },
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    businessName: "Example Business",
    targetUrl: "https://example.com/",
    primaryGoal: "generate qualified enquiries",
    market: "Canada",
    language: "en-CA",
    services: ["Business coaching"],
    competitors: ["https://competitor.example/"],
    ...overrides,
  };
}

test("WRITER-V2-01: packet preserves exact canonical business, scores, findings and capability evidence", () => {
  const packet = buildWriterInput({
    auditId: AUDIT_ID,
    auditRequest: request(),
    scoreSet: scoreSet(),
    findings: [finding()],
    capabilityEvidence: capabilityEvidence(),
  });

  assert.equal(packet.contractVersion, "1.0.0");
  assert.equal(packet.writerInputVersion, WRITER_INPUT_VERSION);
  assert.equal(packet.business.businessName, "Example Business");
  assert.equal(packet.business.language, "en-CA");
  assert.equal(packet.score.scores.trustEeatDimension, 74);
  assert.equal(packet.findings[0].businessImpact, "Search engines may receive a weaker canonical URL signal.");
  assert.equal(packet.findings[0].evidence[0].field, "site.pages[].canonicalUrl");
  assert.equal(packet.capabilityContext.capabilities["trust.proof"].status, "PARTIAL");
  assert.deepEqual(packet.capabilityContext.capabilities["trust.proof"].coverage, { requested: 10, completed: 7, failed: 3 });
  assert.equal(packet.scoreGovernance.sourceDependencies.backlinks, "FAILED");
  assert.deepEqual(packet.deterministicAnalysis.contentIdeas.decision, ["Proof topic"]);
});

test("WRITER-V2-02: aliases and raw/provider extras do not cross the Writer boundary", () => {
  const aliasFinding = finding({
    problem: "alias problem",
    impact: "alias impact",
    fix: "alias fix",
    effort: "H",
    rawProviderPayload: { status_code: 20000 },
  });
  const packet = buildWriterInput({
    auditId: AUDIT_ID,
    auditRequest: request({ rawProviderPayload: { secret: true } }),
    scoreSet: scoreSet({ rawProviderPayload: { tasks: [] } }),
    findings: [aliasFinding],
    capabilityEvidence: capabilityEvidence({ rawProviderPayload: { result: [] } }),
  });

  assert.equal(Object.hasOwn(packet.business, "rawProviderPayload"), false);
  assert.equal(Object.hasOwn(packet.score.scores, "eeatScore"), false);
  assert.equal(Object.hasOwn(packet.findings[0], "problem"), false);
  assert.equal(Object.hasOwn(packet.findings[0], "impact"), false);
  assert.equal(Object.hasOwn(packet.findings[0], "fix"), false);
  assert.equal(Object.hasOwn(packet.findings[0], "effort"), false);
  assert.equal(Object.hasOwn(packet.findings[0], "rawProviderPayload"), false);
  assert.equal(JSON.stringify(packet).includes("status_code"), false);
});

test("WRITER-V2-03: absent optional business context remains absent", () => {
  const packet = buildWriterInput({
    auditId: AUDIT_ID,
    auditRequest: { targetUrl: "https://example.com/", businessName: "Example Business" },
    scoreSet: scoreSet(),
    findings: [finding()],
    capabilityEvidence: capabilityEvidence(),
  });

  for (const field of ["primaryGoal", "market", "language", "services", "competitors"]) {
    assert.equal(Object.hasOwn(packet.business, field), false, `${field} should remain absent`);
  }
});

test("WRITER-V2-04: FindingSet mismatch against ScoreSet fails closed", () => {
  assert.throws(
    () => buildWriterInput({
      auditId: AUDIT_ID,
      auditRequest: request(),
      scoreSet: scoreSet({ findingIds: ["different-finding"] }),
      findings: [finding()],
      capabilityEvidence: capabilityEvidence(),
    }),
    /FindingSet does not match ScoreSet findingIds/,
  );
});

test("WRITER-V2-05: capability evidence missing canonical status fails closed", () => {
  const broken = capabilityEvidence();
  delete broken.capabilities["technical.indexability"].status;

  assert.throws(
    () => buildWriterInput({
      auditId: AUDIT_ID,
      auditRequest: request(),
      scoreSet: scoreSet(),
      findings: [finding()],
      capabilityEvidence: broken,
    }),
    /Capability technical.indexability missing canonical field: status/,
  );
});

test("WRITER-V2-06: capability evidence from another audit fails closed", () => {
  assert.throws(
    () => buildWriterInput({
      auditId: AUDIT_ID,
      auditRequest: request(),
      scoreSet: scoreSet(),
      findings: [finding()],
      capabilityEvidence: capabilityEvidence({ auditId: "22222222-2222-4222-8222-222222222222" }),
    }),
    /capabilityEvidence.auditId mismatch/,
  );
});

test("WRITER-V2-07: unavailable and failed states remain explicit and are never converted to false or zero", () => {
  const caps = capabilityEvidence();
  caps.capabilities["trust.proof"].status = "UNAVAILABLE";
  caps.capabilities["trust.proof"].requiredFieldsPresent = false;
  caps.capabilities["trust.proof"].coverage = { requested: 10, completed: 0, failed: 10 };

  const packet = buildWriterInput({
    auditId: AUDIT_ID,
    auditRequest: request(),
    scoreSet: scoreSet(),
    findings: [finding()],
    capabilityEvidence: caps,
  });

  const trust = packet.capabilityContext.capabilities["trust.proof"];
  assert.equal(trust.status, "UNAVAILABLE");
  assert.equal(trust.requiredFieldsPresent, false);
  assert.deepEqual(trust.coverage, { requested: 10, completed: 0, failed: 10 });
  assert.deepEqual(trust.limitations, ["Three key pages did not return usable parsed content"]);
  assert.equal(packet.scoreGovernance.sourceDependencies.backlinks, "FAILED");
});

test("WRITER-V2-08: incomplete canonical ScoreSet fails closed instead of accepting aliases", () => {
  const broken = scoreSet();
  delete broken.scores.trust;
  broken.scores.trustScore = 74;

  assert.throws(
    () => buildWriterInput({
      auditId: AUDIT_ID,
      auditRequest: request(),
      scoreSet: broken,
      findings: [finding()],
      capabilityEvidence: capabilityEvidence(),
    }),
    /scoreSet\.scores missing canonical field: trust/,
  );
});

test("WRITER-V2-09: capability evidence without canonical audit identity fails closed", () => {
  const broken = capabilityEvidence();
  delete broken.auditId;

  assert.throws(
    () => buildWriterInput({
      auditId: AUDIT_ID,
      auditRequest: request(),
      scoreSet: scoreSet(),
      findings: [finding()],
      capabilityEvidence: broken,
    }),
    /capabilityEvidence\.auditId is required/,
  );
});

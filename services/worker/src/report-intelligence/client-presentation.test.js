import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClientPresentation } from "./client-presentation.js";
import { buildSemanticLedger } from "./semantic-ledger.js";
import { renderReportV2 } from "../report/render-report-v2.js";
import { scoreAudit } from "../scoring/vantage-score.js";

function baseModel(overrides = {}) {
  const site = {
    sourceStatus: "AVAILABLE",
    _contentEvidenceAvailable: true,
    services: ["Residential plumbing"],
    pages: [{
      title: "Residential plumbing",
      bodyText: "Residential plumbing services and completed work gallery.",
      crawledUrl: "https://client.test/services?utm_source=chatgpt.com",
      headings: { h1: ["Residential plumbing"], h2: [] },
    }],
    trust: { pricing: true },
  };
  const findings = [
    { findingId: "trust-1", ruleId: "TRUST-1", dimension: "trust_eeat", scoreBearing: true, actionable: true, confidence: "supported", finalPriority: 1, title: "Pricing and proof placement" },
    { findingId: "schema-1", ruleId: "SCHEMA-1", module: "structured_data", scoreBearing: true, actionable: true, confidence: "supported", finalPriority: 99, title: "Structured data" },
  ];
  const scoreSet = {
    scores: { conversionReadiness: 82 }, bands: { conversionReadiness: "Strong" },
    crossReportInterpretation: { constructs: { trustProof: { state: "ABSENT" } } },
    contentIdeas: { tofu: [{ idea: "What is residential plumbing?", question: "What is this?" }, { idea: "How quickly can emergency plumbing help?", question: "How quickly can I get help?" }] },
  };
  const semanticLedger = buildSemanticLedger({ scoreSet, findings, decisionEvidence: { site, sourceStatus: { content: "AVAILABLE" } }, contentIdeas: scoreSet.contentIdeas });
  return {
    ...scoreSet,
    ...overrides,
    findings,
    evidence: { site },
    semanticLedger,
    conversionPaths: [{ name: "Primary path", status: "Weak" }],
    moduleScores: { conversion_paths: { score: 82 } },
  };
}

test("client presentation contract ranks supported buyer work and bounds technical work", () => {
  const presentation = buildClientPresentation(baseModel());
  assert.deepEqual(presentation.priority.orderedFindingIds, ["trust-1", "schema-1"]);
  assert.deepEqual(presentation.journey.findingIds, ["trust-1"]);
  assert.equal(presentation.scoreQualifications.conversionPath.weakPathNames[0], "Primary path");
  assert.ok(presentation.trust.proofForms.includes("GALLERY_OR_COMPLETED_WORK"));
});

test("client presentation contract rejects generic covered content and keeps buyer question work", () => {
  const presentation = buildClientPresentation(baseModel());
  const actions = Object.fromEntries(presentation.content.opportunities.map((row) => [row.topic, row.action]));
  assert.equal(actions["What is residential plumbing?"], "NO_ACTION");
  assert.equal(actions["How quickly can emergency plumbing help?"], "CREATE");
});

test("primary renderer consumes the contract for score qualification, journey eligibility, and URL display", () => {
  const model = scoreAudit(
    { targetUrl: "https://client.test", businessName: "Client", services: ["Residential plumbing"], competitors: [] },
    { site: { sourceStatus: "AVAILABLE", _contentEvidenceAvailable: true, pages: [{ title: "Home", bodyText: "Residential plumbing", crawledUrl: "https://client.test/home?utm_source=chatgpt.com", headings: { h1: ["Home"], h2: [] } }], services: ["Residential plumbing"], trust: { pricing: true, contact: true } }, performance: { sourceStatus: "UNAVAILABLE" }, competitors: null, ga4: null, gsc: null, backlinks: null },
  );
  model.semanticLedger = buildSemanticLedger({ scoreSet: model, findings: model.findings, decisionEvidence: model.evidence, contentIdeas: model.contentIdeas });
  model.conversionPaths = [{ name: "Primary path", status: "Weak" }];
  model.moduleScores = { conversion_paths: { score: 82 } };
  const html = renderReportV2(model);
  assert.match(html, /data-presentation-contract="conversion-path-qualification"/);
  assert.doesNotMatch(html, /utm_source=chatgpt\.com/);
  const journey = html.slice(html.indexOf('id="paths"'), html.indexOf('id="content-ideas"'));
  assert.doesNotMatch(journey, /Structured data/);
});

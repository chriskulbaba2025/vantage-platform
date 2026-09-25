import test from "node:test";
import assert from "node:assert/strict";
import { buildSemanticLedger, classifyOpportunity, normalizeUrl, proofSemantics } from "./semantic-ledger.js";

test("normalizes tracking parameters without changing the resource path", () => {
  assert.equal(normalizeUrl("https://example.test/work?utm_source=chatgpt.com&ref=abc#x"), "https://example.test/work?ref=abc");
});

test("recognizes equivalent proof forms without upgrading their meaning", () => {
  const proof = proofSemantics({ _contentEvidenceAvailable: true, pages: [{ title: "Project gallery", bodyText: "Completed work examples" }] });
  assert.equal(proof.observed, true);
  assert.deepEqual(proof.forms, ["GALLERY_OR_COMPLETED_WORK"]);
  assert.match(proof.qualifier, /not treated as a detailed outcome case study/);
});

test("content coverage prevents CREATE when assessed content already answers the need", () => {
  const result = classifyOpportunity({ idea: "Pricing and What to Expect" }, { pages: [{ title: "Pricing and process", bodyText: "What to expect and pricing drivers" }] }, "AVAILABLE");
  assert.equal(result.action, "NO_ACTION");
  assert.equal(result.coverage.state, "MATERIAL");
});

test("partial and unavailable evidence remain bounded", () => {
  assert.equal(classifyOpportunity({ idea: "Decision support" }, { pages: [{ title: "Decision support" }] }, "PARTIAL").action, "IMPROVE");
  assert.equal(classifyOpportunity({ idea: "Decision support" }, {}, "UNAVAILABLE").action, "NO_ACTION");
});

test("ledger routes ordinary interpretation to Terra and records only justified Sol escalation", () => {
  const ledger = buildSemanticLedger({
    scoreSet: { scores: { trust: 53 }, bands: { trust: "Moderate" }, contentIdeas: { mofu: [{ idea: "What is plumbing?" }] } },
    findings: [{ findingId: "f-1" }],
    decisionEvidence: { sourceStatus: { content: "AVAILABLE" }, site: { _contentEvidenceAvailable: true, pages: [] } },
  });
  assert.equal(ledger.routing.defaultModel, "TERRA");
  assert.deepEqual(ledger.routing.escalationReasons, ["USEFULNESS_UNCERTAIN"]);
  assert.equal(ledger.contentOpportunities[0].action, "NO_ACTION");
  assert.deepEqual(ledger.provenance.findingIds, ["f-1"]);
});

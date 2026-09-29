import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionEvidence } from "./decision-evidence.js";

const source = (items) => ({ source: "dataforseo-serp", sourceResult: {
  source: "dataforseo-serp", status: "AVAILABLE", completedAt: "2026-09-27T00:00:00.000Z",
  rawArtifactRef: "raw://serp", evidence: { competitors: items },
} });

test("SERP candidates are persisted separately from qualified competitors", () => {
  const { evidence } = buildDecisionEvidence({
    auditRequest: { targetUrl: "https://client.example/", market: "London", services: ["Renovations"] },
    allSourceResults: [source([
      { url: "https://yellowpages.com/listing", domain: "yellowpages.com", title: "Renovations London", _keyword: "Renovations London" },
      { url: "https://builder.example/services", domain: "builder.example", title: "Renovations London", description: "Renovations in London", _keyword: "Renovations London" },
    ])],
    suppliedCompetitors: [],
  });
  assert.equal(evidence.competitors.length, 2);
  assert.equal(evidence.competitorOpportunities.candidates.excluded.length, 2);
  assert.ok(evidence.competitorOpportunities.candidates.excluded.every((candidate) => candidate.provenance.source === "dataforseo-serp"));
  assert.equal(evidence.competitorOpportunities.candidates.excluded[0].status, "UNRESOLVED");
});

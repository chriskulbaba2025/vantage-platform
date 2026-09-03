import assert from "node:assert/strict";
import { qualifyCandidate, qualifyGap } from "../src/evidence/competitor-opportunity-layer.js";

const client = {
  location: "Toronto, Canada",
  services: ["Physiotherapy"],
  topicKeywords: [],
};

const queryOnly = qualifyCandidate({
  candidateUrl: "https://query-only.example/services/physiotherapy",
  domain: "query-only.example",
  topic: "Physiotherapy",
  discoverySource: "dataforseo-serp",
  queryGeographicContext: "Toronto, Canada",
  pageType: "service",
}, client);

assert.equal(queryOnly.passed, false, "P-B16 query-only SERP candidate must fail closed");
assert.deepEqual(
  Object.fromEntries(Object.entries(queryOnly.results).filter(([, value]) => !value)),
  {
    geographic_relevance: false,
    audience_relevance: false,
    commercial_intent_relevance: false,
  },
  "P-B16 query locale and inferred page type cannot satisfy observed-evidence checks",
);

const observed = {
  candidateUrl: "https://observed.example/services/physiotherapy",
  domain: "observed.example",
  topic: "Physiotherapy",
  discoverySource: "dataforseo-serp",
  queryGeographicContext: "Toronto, Canada",
  geographicContext: "Toronto, Canada",
  audienceContext: "Toronto physiotherapy patients",
  commercialContext: "Physiotherapy appointments are offered",
  pageType: "service",
  hasSchema: ["Service"],
};
const observedQualification = qualifyCandidate(observed, client);
assert.equal(observedQualification.passed, true, "P-B16 observed SERP candidate may qualify");
const gap = qualifyGap("Physiotherapy", observed, ["Physiotherapy"], ["Physiotherapy appointments"]);
assert.equal(gap.passed, true, "P-B16 qualified candidate remains compatible with the approved-gap consumer");

process.stdout.write("P-B16 SERP qualification gate: PASS\n");

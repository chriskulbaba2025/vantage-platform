import assert from "node:assert/strict";
import { qualifyCandidate, qualifyGap } from "../src/evidence/competitor-opportunity-layer.js";
import { querySerp } from "../src/adapters/dataforseo-serp/dataforseo-serp-client.js";

const client = {
  location: "Toronto, Canada",
  services: ["Physiotherapy"],
  topicKeywords: [],
};

const normalized = await querySerp("Physiotherapy", {
  login: "fixture-login",
  password: "fixture-password",
  location: "Toronto, Canada",
  language: "en",
  fetchImpl: async () => new Response(JSON.stringify({
    status_code: 20000,
    tasks: [{
      id: "p-b16-fixture",
      status_code: 20000,
      result: [{ items: [{
        type: "organic",
        rank_absolute: 1,
        url: "https://query-only.example/services/accounting",
        domain: "query-only.example",
        title: "Accounting & Tax Services",
      }] }],
    }],
  }), { status: 200 }),
});
assert.equal(normalized.error, null);
const produced = normalized.items[0];
assert.equal(produced.topic, "Physiotherapy", "P-B16 preserves query topic as discovery metadata");
assert.equal(produced.observedServiceContext, "Accounting & Tax Services");
assert.equal(produced.serviceEvidenceSource, "serp-title");

const queryOnly = qualifyCandidate(produced, client);

assert.equal(queryOnly.passed, false, "P-B16 query-only SERP candidate must fail closed");
assert.deepEqual(
  Object.fromEntries(Object.entries(queryOnly.results).filter(([, value]) => !value)),
  {
    service_relevance: false,
    geographic_relevance: false,
    audience_relevance: false,
    commercial_intent_relevance: false,
  },
  "P-B16 query topic, query locale, and inferred page type cannot override observed competitor evidence",
);

const observed = {
  ...produced,
  candidateUrl: "https://observed.example/services/physiotherapy",
  domain: "observed.example",
  observedServiceContext: "Physiotherapy Clinic & Rehabilitation Services",
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

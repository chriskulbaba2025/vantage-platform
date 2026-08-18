import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { buildDecisionEvidence } from "./decision-evidence.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, "..", "contracts");
const sourceSchema = JSON.parse(readFileSync(resolve(contractsDir, "source-result.schema.json"), "utf8"));
const decisionSchema = JSON.parse(readFileSync(resolve(contractsDir, "decision-evidence.schema.json"), "utf8"));

function createValidator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(sourceSchema, sourceSchema.$id);
  ajv.addSchema(decisionSchema, decisionSchema.$id);
  return (schemaId, value) => {
    const validate = ajv.getSchema(schemaId);
    if (!validate) return { valid: false, errors: [{ message: `Schema not loaded: ${schemaId}` }] };
    const valid = validate(value);
    return { valid, errors: validate.errors || [] };
  };
}

const FIXED_TIME = "2026-08-18T13:43:00.000Z";

function viableSiteSourceResult() {
  return {
    contractVersion: "1.0.0",
    schemaVersion: "1.0.0",
    source: "site",
    provider: "DataForSEO",
    adapterVersion: "1.2.0",
    status: "AVAILABLE",
    startedAt: "2026-08-18T13:42:00.000Z",
    completedAt: FIXED_TIME,
    retryCount: 0,
    coverage: { requested: 2, completed: 2, failed: 0 },
    limitations: [],
    evidence: {
      domain: "example.com",
      targetUrl: "https://example.com",
      pageCount: 2,
      pages: [
        {
          url: "https://example.com/blog/governed-evidence-guide",
          status: 200,
          title: "Governed Evidence Guide",
          words: 400,
          headings: {
            h1: ["Governed Evidence Guide"],
            h2: ["Governed Evidence Service"],
            h3: [],
          },
          links: [],
        },
        {
          url: "https://example.com/governed-evidence-service",
          status: 200,
          title: "Governed Evidence Service",
          words: 500,
          headings: {
            h1: ["Governed Evidence Service"],
            h2: [],
            h3: [],
          },
          links: [],
        },
      ],
      services: ["Governed Evidence Service"],
      trust: {},
      platform: "TestCMS",
      schemaTypes: [],
      internalLinkCount: 0,
      brokenInternalLinks: [],
    },
  };
}

function failedSiteSourceResult() {
  return {
    contractVersion: "1.0.0",
    schemaVersion: "1.0.0",
    source: "site",
    provider: "DataForSEO",
    adapterVersion: "1.2.0",
    status: "FAILED",
    startedAt: "2026-08-18T13:42:00.000Z",
    completedAt: FIXED_TIME,
    retryCount: 0,
    coverage: { requested: 1, completed: 0, failed: 1 },
    limitations: ["Crawl unavailable."],
  };
}

test("PRYSM-INTERNAL-LINK-01: governed decision evidence derives legitimate internal-link opportunities", () => {
  const validateContract = createValidator();
  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [{ source: "dataforseo-onpage", sourceResult: viableSiteSourceResult() }],
    suppliedCompetitors: [],
    validateContract,
  });

  assert.deepEqual(errors, []);
  assert.ok(evidence.internalLinkOpportunities, "derived evidence is present for a viable crawl");
  assert.ok(
    evidence.internalLinkOpportunities.opportunities.some((item) =>
      item.sourceUrl === "https://example.com/blog/governed-evidence-guide" &&
      item.targetUrl === "https://example.com/governed-evidence-service" &&
      item.proposedAnchor === "Governed Evidence Service"
    ),
    "a recommendation is emitted only from the evidenced source/target relationship",
  );

  const decisionValidation = validateContract(decisionSchema.$id, evidence);
  assert.equal(decisionValidation.valid, true, JSON.stringify(decisionValidation.errors));
});

test("PRYSM-INTERNAL-LINK-01: unavailable site evidence never fabricates internal links", () => {
  const validateContract = createValidator();
  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [{ source: "dataforseo-onpage", sourceResult: failedSiteSourceResult() }],
    suppliedCompetitors: [],
    validateContract,
  });

  assert.deepEqual(errors, []);
  assert.equal(evidence.internalLinkOpportunities, null);
});

test("PRYSM-INTERNAL-LINK-01: canonical derivation is deterministic for identical persisted evidence", () => {
  const validateContract = createValidator();
  const input = {
    allSourceResults: [{ source: "dataforseo-onpage", sourceResult: viableSiteSourceResult() }],
    suppliedCompetitors: [],
    validateContract,
  };

  const first = buildDecisionEvidence(input);
  const second = buildDecisionEvidence(input);

  assert.deepEqual(first, second, "identical SourceResults produce byte-stable logical evidence");
  assert.equal(first.evidence.internalLinkOpportunities.collectedAt, FIXED_TIME);
  assert.equal(first.evidence.internalLinkOpportunities._sourceStatus.startedAt, FIXED_TIME);
  assert.equal(first.evidence.internalLinkOpportunities._sourceStatus.completedAt, FIXED_TIME);
});

test("PRYSM-INTERNAL-LINK-01: schema 1.1.0 explicitly governs the new optional field while accepting historical 1.0.0 payloads", () => {
  const validateContract = createValidator();

  assert.equal(decisionSchema.version, "1.1.0");
  assert.ok(decisionSchema.properties.internalLinkOpportunities);

  const historicalEvidence = {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: {
      sourceStatus: "FAILED",
      collectedAt: "2026-08-17T20:16:34.603Z",
      limitations: ["Historical unavailable state."],
    },
  };
  const historicalValidation = validateContract(decisionSchema.$id, historicalEvidence);
  assert.equal(historicalValidation.valid, true, JSON.stringify(historicalValidation.errors));
});

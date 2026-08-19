import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCapabilityEvidence } from "./capability-evidence.js";

const AUDIT_ID = "22222222-3333-4444-8555-666666666666";
const GENERATED_AT = "2026-08-19T02:40:00.000Z";

function build(contentParsing, marker = false) {
  const decisionEvidence = {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: {
      sourceStatus: "AVAILABLE",
      adapterVersion: "1.1.0",
      targetUrl: "https://example.com/",
      domain: "example.com",
      pages: [],
      services: [],
      ctas: [],
      forms: [],
      schemaTypes: [],
      microdataTypes: [],
      trust: {},
      securityHeaders: {},
      _contentEvidenceAvailable: marker,
      _interactiveEvidenceAvailable: false,
      _responseHeadersAvailable: false,
      acquisition: { contentParsing },
    },
    performance: null,
    competitors: null,
    backlinks: null,
    ga4: null,
    gsc: null,
  };

  return buildCapabilityEvidence({
    decisionEvidence,
    auditId: AUDIT_ID,
    generatedAt: GENERATED_AT,
  });
}

function capability(result, name) {
  return result.capabilities[name];
}

test("complete contentParsing acquisition makes content-dependent capabilities AVAILABLE even when legacy marker is false", () => {
  const result = build({ requested: 3, completed: 3, failed: 0 }, false);

  assert.equal(capability(result, "content.body").status, "AVAILABLE");
  assert.equal(capability(result, "offer.clarity").status, "AVAILABLE");
  assert.equal(capability(result, "trust.proof").status, "AVAILABLE");
  assert.equal(capability(result, "offer.clarity").requiredFieldsPresent, true);
  assert.equal(capability(result, "trust.proof").requiredFieldsPresent, true);
});

test("partial contentParsing acquisition propagates PARTIAL to content-dependent capabilities", () => {
  const result = build({ requested: 3, completed: 1, failed: 2 }, false);

  assert.equal(capability(result, "content.body").status, "PARTIAL");
  assert.equal(capability(result, "offer.clarity").status, "PARTIAL");
  assert.equal(capability(result, "trust.proof").status, "PARTIAL");
  assert.equal(capability(result, "offer.clarity").requiredFieldsPresent, true);
  assert.equal(capability(result, "trust.proof").requiredFieldsPresent, true);
});

test("zero usable content keeps all body-content capabilities UNAVAILABLE", () => {
  const result = build({ requested: 3, completed: 0, failed: 3 }, false);

  assert.equal(capability(result, "content.body").status, "UNAVAILABLE");
  assert.equal(capability(result, "offer.clarity").status, "UNAVAILABLE");
  assert.equal(capability(result, "trust.proof").status, "UNAVAILABLE");
  assert.equal(capability(result, "offer.clarity").requiredFieldsPresent, false);
  assert.equal(capability(result, "trust.proof").requiredFieldsPresent, false);
});

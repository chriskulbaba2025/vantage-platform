/**
 * C2 — DecisionEvidence fail-closed proof.
 *
 * Proves:
 *   - PRYSM-CLOSE-02a: malformed AVAILABLE SourceResult → evidence key stays null
 *   - PRYSM-CLOSE-02b: malformed PARTIAL SourceResult → evidence key stays null
 *   - PRYSM-CLOSE-02c: missing sources are NOT fabricated as NOT_CONNECTED
 *   - PRYSM-CLOSE-02d: valid sources hydrate correctly
 *   - PRYSM-CLOSE-02e: non-viable invalid sources are reported but hydrated
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionEvidence } from "./decision-evidence.js";

// Minimal contract validator using JSON Schema
function makeValidator() {
  return (schemaId, obj) => {
    // Validate required fields exist on SourceResult
    const errors = [];
    if (!obj || typeof obj !== "object") {
      return { valid: false, errors: [{ message: "not an object" }] };
    }
    // Required fields per source-result.schema.json
    const required = ["contractVersion","schemaVersion","source","provider","adapterVersion","status","startedAt","completedAt","retryCount","coverage","limitations"];
    for (const f of required) {
      if (!(f in obj)) errors.push({ message: `missing required field: ${f}` });
    }
    const validStatuses = ["AVAILABLE","PARTIAL","FAILED","BLOCKED","UNAVAILABLE","NOT_CONNECTED","NOT_APPLICABLE"];
    if (obj.status && !validStatuses.includes(obj.status)) {
      errors.push({ message: `invalid status: ${obj.status}` });
    }
    return { valid: errors.length === 0, errors };
  };
}

// Valid SourceResult builder
function validSr(source, overrides = {}) {
  return {
    contractVersion: "1.0.0",
    schemaVersion: "1.0.0",
    source,
    provider: "controlled",
    adapterVersion: "1.0.0",
    status: "AVAILABLE",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    retryCount: 0,
    coverage: { requested: 1, completed: 1, failed: 0 },
    limitations: [],
    evidence: {
      sourceStatus: "AVAILABLE",
      domain: "example.com",
      pages: [],
    },
    ...overrides,
  };
}

// --- PRYSM-CLOSE-02a: malformed AVAILABLE → evidence key stays null ---
test("PRYSM-CLOSE-02a: malformed AVAILABLE SourceResult → evidence key stays null", () => {
  const validateContract = makeValidator();
  // Missing required fields → validation fails
  const malformed = {
    source: "dataforseo-onpage",
    status: "AVAILABLE",
    // missing contractVersion, schemaVersion, provider, etc.
  };
  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [{ source: "dataforseo-onpage", sourceResult: malformed }],
    validateContract,
  });
  assert.ok(errors.length > 0, "validation error recorded");
  assert.ok(errors.some(e => e.includes("validation failed")), "error mentions validation failure");
  // Site key must remain null — malformed AVAILABLE evidence is NOT hydrated
  assert.equal(evidence.site, null, "site evidence is null (fail-closed)");
});

// --- PRYSM-CLOSE-02b: malformed PARTIAL → evidence key stays null ---
test("PRYSM-CLOSE-02b: malformed PARTIAL SourceResult → evidence key stays null", () => {
  const validateContract = makeValidator();
  const malformed = {
    source: "dataforseo-onpage",
    status: "PARTIAL",
  };
  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [{ source: "dataforseo-onpage", sourceResult: malformed }],
    validateContract,
  });
  assert.ok(errors.length > 0, "validation error recorded");
  assert.equal(evidence.site, null, "site evidence is null (fail-closed)");
});

// --- PRYSM-CLOSE-02c: missing sources NOT fabricated as NOT_CONNECTED ---
test("PRYSM-CLOSE-02c: missing sources are NOT fabricated", () => {
  // No backlinks, ga4, gsc in allSourceResults — keys must stay null
  const { evidence } = buildDecisionEvidence({
    allSourceResults: [],
  });
  assert.equal(evidence.backlinks, null, "backlinks is null (not fabricated)");
  assert.equal(evidence.ga4, null, "ga4 is null (not fabricated)");
  assert.equal(evidence.gsc, null, "gsc is null (not fabricated)");
  assert.equal(evidence.site, null, "site is null (not fabricated)");
  assert.equal(evidence.performance, null, "performance is null (not fabricated)");
  assert.equal(evidence.competitors, null, "competitors is null (not fabricated)");
});

// --- PRYSM-CLOSE-02d: valid sources hydrate correctly ---
test("PRYSM-CLOSE-02d: valid AVAILABLE sources hydrate with evidence fields", () => {
  const validateContract = makeValidator();
  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [
      { source: "dataforseo-onpage", sourceResult: validSr("dataforseo-onpage", {
        evidence: { sourceStatus: "AVAILABLE", domain: "proof.example.com", pageCount: 3, pages: [], services: ["Gov Service"], trust: { credentials: true }, platform: "ProofCMS", schemaTypes: ["ProfessionalService"] },
        coverage: { requested: 3, completed: 3, failed: 0 },
      })},
      { source: "pagespeed", sourceResult: validSr("pagespeed", {
        evidence: { sourceStatus: "AVAILABLE", mobile: { scores: { performance: 73 } }, desktop: { scores: { performance: 88 } } },
      })},
      { source: "backlinks", sourceResult: validSr("backlinks", {
        evidence: { sourceStatus: "AVAILABLE", totalBacklinksReviewed: 150, goodCount: 42 },
      })},
      { source: "ga4", sourceResult: validSr("ga4", {
        evidence: { sourceStatus: "AVAILABLE", totals: { sessions: 4200 } },
      })},
      { source: "gsc", sourceResult: validSr("gsc", {
        evidence: { sourceStatus: "AVAILABLE", totals: { clicks: 1250 } },
      })},
    ],
    validateContract,
  });
  assert.equal(errors.length, 0, "no validation errors");
  assert.equal(evidence.site?.domain, "proof.example.com", "site domain preserved");
  assert.equal(evidence.site?.platform, "ProofCMS", "platform preserved");
  assert.equal(evidence.site?.trust?.credentials, true, "trust credentials preserved");
  assert.equal(evidence.site?.schemaTypes?.[0], "ProfessionalService", "schemaType preserved");
  assert.equal(evidence.performance?.mobile?.scores?.performance, 73, "mobile perf preserved");
  assert.equal(evidence.performance?.desktop?.scores?.performance, 88, "desktop perf preserved");
  assert.equal(evidence.backlinks?.totalBacklinksReviewed, 150, "backlinks preserved");
  assert.equal(evidence.ga4?.totals?.sessions, 4200, "ga4 preserved");
  assert.equal(evidence.gsc?.totals?.clicks, 1250, "gsc preserved");
});

// --- PRYSM-CLOSE-02e: non-viable invalid sources are reported but hydrated ---
test("PRYSM-CLOSE-02e: FAILED SourceResult validation errors are reported but source still hydrates", () => {
  const validateContract = makeValidator();
  const failedSr = {
    source: "gsc",
    status: "FAILED",
    // missing required fields
  };
  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [{ source: "gsc", sourceResult: failedSr }],
    validateContract,
  });
  // Error is recorded but hydration proceeds (FAILED is not a viable status)
  assert.ok(errors.length > 0, "validation error recorded for FAILED source");
  // FAILED source gets hydrated with minimal evidence (sourceStatus, limitations)
  assert.equal(evidence.gsc?.sourceStatus, "FAILED", "FAILED source still hydrates with status");
});

// --- PRYSM-CLOSE-02f: site with AVAILABLE but empty evidence still hydrates ---
// DE-04: critical structural fields (domain/pages/services/trust/platform/
// schemaTypes) are NOT defaulted during hydration — absence propagates to
// the persistence boundary where the schema rejects malformed AVAILABLE
// evidence.
test("PRYSM-CLOSE-02f: AVAILABLE site with minimal evidence hydrates without fabricating structural fields", () => {
  const validateContract = makeValidator();
  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [
      { source: "dataforseo-onpage", sourceResult: validSr("dataforseo-onpage", {
        evidence: { sourceStatus: "AVAILABLE" },
      })},
    ],
    validateContract,
  });
  assert.equal(errors.length, 0, "no errors");
  assert.equal(evidence.site?.sourceStatus, "AVAILABLE", "site hydrates");
  assert.equal(evidence.site?.domain, undefined, "empty domain is undefined (not fabricated)");
  assert.equal(evidence.site?.pageCount, 0, "pageCount defaults to 0");
  assert.equal(evidence.site?.services, undefined, "services NOT fabricated (absence preserved)");
  assert.equal(evidence.site?.pages, undefined, "pages NOT fabricated");
  assert.equal(evidence.site?.trust, undefined, "trust NOT fabricated");
  assert.equal(evidence.site?.schemaTypes, undefined, "schemaTypes NOT fabricated");
});

// PRYSM-NEXT-01 WP-B — deep acquisition fields survive the hydration
// boundary into decision evidence (scoring consumer continuity).
test("WP-B: deep acquisition fields pass through hydrateSite losslessly", () => {
  const validateContract = makeValidator();
  const deepEvidence = {
    sourceStatus: "AVAILABLE",
    domain: "example.com",
    targetUrl: "https://example.com/",
    pages: [],
    contentParsing: [
      { url: "https://example.com/", wordCount: 9, mainContentChars: 40, hasMainContent: true, sentimentScore: null },
    ],
    redirectChains: [
      { from: "https://example.com/", to: "https://example.com/home", statusCodes: [301, 200], hops: 2 },
    ],
    nonIndexablePages: [{ url: "https://example.com/404-page", reason: "4xx" }],
    pageResources: [{ url: "https://example.com/", totalResources: 12, brokenResources: 1 }],
    microdataTypes: ["Organization", "LocalBusiness"],
    acquisition: { contentParsing: { requested: 1, completed: 1, failed: 0 } },
  };
  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [
      { source: "dataforseo-onpage", sourceResult: validSr("dataforseo-onpage", { evidence: deepEvidence }) },
    ],
    validateContract,
  });
  assert.equal(errors.length, 0, "no hydration errors");
  assert.deepEqual(evidence.site.contentParsing, deepEvidence.contentParsing);
  assert.deepEqual(evidence.site.redirectChains, deepEvidence.redirectChains);
  assert.deepEqual(evidence.site.nonIndexablePages, deepEvidence.nonIndexablePages);
  assert.deepEqual(evidence.site.pageResources, deepEvidence.pageResources);
  assert.deepEqual(evidence.site.microdataTypes, deepEvidence.microdataTypes);
  assert.deepEqual(evidence.site.acquisition, deepEvidence.acquisition);
  // Real-validator schema acceptance of the extended site shape is covered
  // by DE-16 (production regression with the real contract validator).
});

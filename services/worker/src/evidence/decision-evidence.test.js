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
  // WP-C-03: unknown is NOT coerced to false at hydration.
  assert.equal(
    evidence.site?._contentEvidenceAvailable,
    undefined,
    "_contentEvidenceAvailable stays undefined when absent (unknown ≠ false)",
  );
  assert.equal(
    evidence.site?._responseHeadersAvailable,
    undefined,
    "_responseHeadersAvailable stays undefined when absent",
  );
  assert.equal(
    evidence.site?.adapterVersion,
    "1.0.0",
    "adapterVersion from the SourceResult survives hydration (provenance)",
  );
});

// Evidence-audit item 2 — end-to-end through the PRODUCTION hydration
// boundary: the adapter declares counter-collection truth via
// `_metaCountersAvailable`; fabricated 0s at hydration (frozen schema
// forces integers) must NOT earn scoring credit when the marker is false.
test("CRIT rescore: uncollected meta counters earn no credit end-to-end", async () => {
  const { buildDecisionEvidence } = await import("./decision-evidence.js");
  const { scoreAudit } = await import("../scoring/vantage-score.js");
  const validateContract = makeValidator();

  // Adapter-shaped metadata-only SourceResult: page_metrics checks and
  // page-level counter data absent → adapter marks counters uncollected.
  const sr = validSr("dataforseo-onpage", {
    status: "PARTIAL",
    adapterVersion: "1.2.0",
    evidence: {
      sourceStatus: "PARTIAL",
      domain: "example.com",
      targetUrl: "https://example.com/",
      platform: "WordPress",
      pages: [{ url: "https://example.com/", title: "Home", headings: { h1: [], h2: [], h3: [], h4: [] }, status: 200 }],
      services: [],
      trust: {},
      schemaTypes: [],
      ctas: [],
      forms: [],
      missingTitles: null,
      missingDescriptions: null,
      missingCanonicals: null,
      h1Missing: null,
      h1Multiple: null,
      imageCount: null,
      imagesMissingAlt: null,
      _metaCountersAvailable: false,
      _contentEvidenceAvailable: true,
      _responseHeadersAvailable: true,
      _interactiveEvidenceAvailable: false,
      collectedAt: "2026-01-15T12:00:00.000Z",
      coverage: { requested: 500, completed: 2, failed: 498 },
    },
  });

  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [{ source: "dataforseo-onpage", sourceResult: sr }],
    validateContract,
  });
  assert.equal(errors.length, 0, "hydration clean");
  assert.equal(evidence.site._metaCountersAvailable, false, "collection marker survives hydration");

  // R3 — raw artifact provenance survives hydration (capability/finding ref).
  const srWithRef = validSr("dataforseo-onpage", {
    adapterVersion: "1.2.0",
    evidence: {
      sourceStatus: "PARTIAL",
      domain: "example.com",
      targetUrl: "https://example.com/",
      platform: "WordPress",
      pages: [{ url: "https://example.com/", title: "Home", headings: { h1: ["H"], h2: [], h3: [], h4: [] }, status: 200 }],
      services: [], trust: {}, schemaTypes: [], ctas: [], forms: [],
      rawArtifactRef: "dataforseo://on_page/t1?sha256=abc",
      _metaCountersAvailable: true,
      _contentEvidenceAvailable: true,
      _responseHeadersAvailable: true,
      collectedAt: "2026-01-15T12:00:00.000Z",
    },
  });
  const withRef = buildDecisionEvidence({
    allSourceResults: [{ source: "dataforseo-onpage", sourceResult: srWithRef }],
    validateContract,
  }).evidence;
  assert.equal(
    withRef.site.rawArtifactRef,
    "dataforseo://on_page/t1?sha256=abc",
    "rawArtifactRef survives hydration",
  );

  const model = scoreAudit(
    { targetUrl: "https://example.com/", businessName: "X", competitors: [] },
    { ...evidence, performance: null, ga4: null, gsc: null, backlinks: null },
  );
  const tech = model.moduleScores.technical_hygiene;
  const subKeys = (tech.subScores || []).map((s) => s.key);
  assert.ok(!subKeys.includes("meta"), "uncollected meta counters earn no credit end-to-end");
  assert.ok(!subKeys.includes("images"), "uncollected image counters earn no credit end-to-end");

  // Legacy semantics preserved: without the marker, collected-counter
  // evidence (extractor ran) keeps scoring the meta sub-rule.
  const legacySr = validSr("dataforseo-onpage", {
    status: "AVAILABLE",
    evidence: {
      sourceStatus: "AVAILABLE",
      domain: "example.com",
      targetUrl: "https://example.com/",
      platform: "WordPress",
      pages: [{ url: "https://example.com/", title: "Home", headings: { h1: ["Home"], h2: [], h3: [], h4: [] }, status: 200 }],
      services: [], trust: {}, schemaTypes: [], ctas: [], forms: [],
      missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
      h1Missing: 0, h1Multiple: 0, imageCount: 2, imagesMissingAlt: 0,
      _contentEvidenceAvailable: true, _responseHeadersAvailable: true,
      collectedAt: "2026-01-15T12:00:00.000Z",
    },
  });
  const legacyEvidence = buildDecisionEvidence({
    allSourceResults: [{ source: "dataforseo-onpage", sourceResult: legacySr }],
    validateContract,
  }).evidence;
  const legacyModel = scoreAudit(
    { targetUrl: "https://example.com/", businessName: "X", competitors: [] },
    { ...legacyEvidence, performance: null, ga4: null, gsc: null, backlinks: null },
  );
  const legacySubKeys = (legacyModel.moduleScores.technical_hygiene.subScores || []).map((s) => s.key);
  assert.ok(legacySubKeys.includes("meta"), "legacy collected counters keep meta scoring");
});

// WP-C-03: adapterVersion survives hydration for capability provenance,
// and explicit false markers are preserved exactly.
test("WP-C: explicit content-evidence markers and adapterVersion pass through hydrateSite", () => {
  const validateContract = makeValidator();
  const { evidence } = buildDecisionEvidence({
    allSourceResults: [
      {
        source: "dataforseo-onpage",
        sourceResult: validSr("dataforseo-onpage", {
          adapterVersion: "1.1.0",
          evidence: {
            sourceStatus: "AVAILABLE",
            domain: "example.com",
            targetUrl: "https://example.com/",
            pages: [],
            _contentEvidenceAvailable: false,
            _responseHeadersAvailable: false,
          },
        }),
      },
    ],
    validateContract,
  });
  assert.equal(evidence.site._contentEvidenceAvailable, false, "explicit false preserved");
  assert.equal(evidence.site._responseHeadersAvailable, false, "explicit false preserved");
  assert.equal(evidence.site.adapterVersion, "1.1.0", "adapterVersion survives hydration");
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

// DQV-001 Track B — representative site evidence must survive the canonical
// hydration boundary losslessly when the On-Page source is viable.
test("DQV-001: available representative site evidence survives hydrateSite losslessly", () => {
  const validateContract = makeValidator();

  const siteFootprint = {
    status: "AVAILABLE",
    discoveredUrlCount: 2400,
    retainedUrlCount: 2400,
    sitemapDocumentCount: 4,
    capped: false,
    clusters: [
      {
        id: "cluster-location",
        pattern: "/locations/:segment",
        discoveredUrlCount: 1800,
        representativeUrls: [
          "https://example.com/locations/pennsylvania",
          "https://example.com/locations/texas",
        ],
      },
    ],
    priorityUrls: [
      "https://example.com/",
      "https://example.com/locations/pennsylvania",
      "https://example.com/locations/texas",
    ],
    coverage: {
      complete: true,
      retainedUrlCount: 2400,
    },
    limitations: [],
  };

  const programmaticSeo = {
    status: "LIKELY",
    clusterCount: 1,
    assessedClusterCount: 1,
    clusters: [
      {
        clusterId: "cluster-location",
        status: "LIKELY",
        sampledUrls: [
          "https://example.com/locations/pennsylvania",
          "https://example.com/locations/texas",
        ],
        limitations: [],
      },
    ],
    limitations: [],
  };

  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [
      {
        source: "dataforseo-onpage",
        sourceResult: validSr("dataforseo-onpage", {
          adapterVersion: "1.3.0",
          evidence: {
            sourceStatus: "AVAILABLE",
            domain: "example.com",
            targetUrl: "https://example.com/",
            pages: [],
            siteFootprint,
            programmaticSeo,
          },
        }),
      },
    ],
    validateContract,
  });

  assert.equal(errors.length, 0, "representative evidence hydrates cleanly");
  assert.deepEqual(
    evidence.site.siteFootprint,
    siteFootprint,
    "siteFootprint survives SourceResult → DecisionEvidence losslessly",
  );
  assert.deepEqual(
    evidence.site.programmaticSeo,
    programmaticSeo,
    "programmaticSeo survives SourceResult → DecisionEvidence losslessly",
  );
});

// DQV-001 Track B — unavailable footprint evidence must remain unavailable.
// Hydration must never manufacture the stronger semantic conclusion
// NOT_DETECTED when representative acquisition could not establish absence.
test("DQV-001: unavailable sitemap evidence cannot become NOT_DETECTED programmatic SEO", () => {
  const validateContract = makeValidator();

  const siteFootprint = {
    status: "UNAVAILABLE",
    discoveredUrlCount: 0,
    retainedUrlCount: 0,
    sitemapDocumentCount: 0,
    capped: false,
    clusters: [],
    priorityUrls: [],
    coverage: {
      complete: false,
      retainedUrlCount: 0,
    },
    limitations: ["No usable sitemap evidence was available"],
  };

  const programmaticSeo = {
    status: "INSUFFICIENT_EVIDENCE",
    clusterCount: 0,
    assessedClusterCount: 0,
    clusters: [],
    limitations: [
      "Programmatic SEO could not be assessed without usable footprint evidence",
    ],
  };

  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [
      {
        source: "dataforseo-onpage",
        sourceResult: validSr("dataforseo-onpage", {
          status: "PARTIAL",
          adapterVersion: "1.3.0",
          evidence: {
            sourceStatus: "PARTIAL",
            domain: "example.com",
            targetUrl: "https://example.com/",
            pages: [],
            siteFootprint,
            programmaticSeo,
          },
        }),
      },
    ],
    validateContract,
  });

  assert.equal(errors.length, 0, "partial source hydrates cleanly");
  assert.equal(
    evidence.site.siteFootprint.status,
    "UNAVAILABLE",
    "unavailable footprint status is preserved",
  );
  assert.equal(
    evidence.site.programmaticSeo.status,
    "INSUFFICIENT_EVIDENCE",
    "insufficient programmatic evidence is preserved",
  );
  assert.notEqual(
    evidence.site.programmaticSeo.status,
    "NOT_DETECTED",
    "unavailable footprint evidence is never converted to NOT_DETECTED",
  );
  assert.deepEqual(
    evidence.site.siteFootprint,
    siteFootprint,
    "unavailable footprint evidence survives losslessly",
  );
  assert.deepEqual(
    evidence.site.programmaticSeo,
    programmaticSeo,
    "insufficient programmatic evidence survives losslessly",
  );
});
// DQV-005 — source status and returned records are separate facts.
// A failed SERP collection with zero competitors must retain FAILED rather
// than being reconstructed downstream as NOT_CONNECTED or NOT_APPLICABLE.
test("DQV-005: FAILED competitor source survives empty competitor hydration", () => {
  const validateContract = makeValidator();

  const failedSerp = validSr("dataforseo-serp", {
    status: "FAILED",
    coverage: {
      requested: 1,
      completed: 0,
      failed: 1,
    },
    limitations: [
      "SERP collection failed before usable competitor evidence returned",
    ],
    evidence: {
      competitors: [],
    },
  });

  const { evidence, errors } = buildDecisionEvidence({
    allSourceResults: [
      {
        source: "dataforseo-serp",
        sourceResult: failedSerp,
      },
    ],
    validateContract,
  });

  assert.equal(errors.length, 0, "valid FAILED SourceResult hydrates cleanly");
  assert.deepEqual(
    evidence.competitors,
    [],
    "zero returned competitors remains an empty evidence collection",
  );
  assert.equal(
    evidence.sourceStatus.competitors,
    "FAILED",
    "source-level FAILED status survives independently of item count",
  );
  assert.notEqual(
    evidence.sourceStatus.competitors,
    "NOT_CONNECTED",
    "FAILED is never rewritten as NOT_CONNECTED",
  );
  assert.notEqual(
    evidence.sourceStatus.competitors,
    "NOT_APPLICABLE",
    "FAILED is never rewritten as NOT_APPLICABLE",
  );
});

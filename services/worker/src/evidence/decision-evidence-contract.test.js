/**
 * DE-04/DE-05/DE-06 — Executable DecisionEvidence contract.
 *
 * The decision-evidence schema must reject malformed AVAILABLE/PARTIAL site
 * evidence BEFORE persistence, and the persisted artifact must be verified
 * and schema-validated after read-back before any consumer uses it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createGovernedArtifactStore, buildArtifactKey } from "../storage/governed-artifact-store.js";
import { persistDecisionEvidence, loadAndValidateDecisionEvidence } from "./decision-evidence.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(__dirname, "..", "contracts");
const _ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(_ajv);
_ajv.addSchema(
  JSON.parse(readFileSync(resolve(schemasDir, "decision-evidence.schema.json"), "utf-8")),
  "https://vantage-platform.io/prysm/contracts/v1/decision-evidence.schema.json",
);
const realValidate = (sid, obj) => {
  const v = _ajv.getSchema(sid);
  if (!v) return { valid: false, errors: [{ message: `Schema not loaded: ${sid}` }] };
  const valid = v(obj);
  return { valid, errors: v.errors || [] };
};

/** Complete AVAILABLE decision evidence (all critical structural fields). */
function completeDecisionEvidence(overrides = {}) {
  const siteDefaults = {
    sourceStatus: "AVAILABLE",
    collectedAt: "2026-01-01T00:00:01.000Z",
    domain: "proof.example.com",
    targetUrl: "https://proof.example.com",
    pageCount: 1,
    pages: [{ url: "https://proof.example.com", title: "Proof", headings: { h1: ["Proof"], h2: [], h3: [] } }],
    services: ["Governed Evidence Service"],
    topicKeywords: [],
    ctas: [],
    forms: [],
    externalCtas: [],
    socialLinks: [],
    trust: { credentials: true },
    platform: "ProofCMS",
    schemaTypes: ["ProfessionalService"],
    statusCounts: { "200": 1 },
    totalWords: 300,
    averageWords: 300,
    missingTitles: 0,
    missingDescriptions: 0,
    missingCanonicals: 0,
    h1Missing: 0,
    h1Multiple: 0,
    imageCount: 0,
    imagesMissingAlt: 0,
    internalLinkCount: 0,
    brokenInternalLinks: [],
    securityHeaders: {},
    _contentEvidenceAvailable: true,
    _responseHeadersAvailable: false,
    limitations: [],
  };
  // `overrides.site` REPLACES the site object verbatim so removed-field
  // tests genuinely remove fields.
  const site = Object.prototype.hasOwnProperty.call(overrides, "site")
    ? overrides.site
    : siteDefaults;
  return {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site,
    performance: {
      sourceStatus: "AVAILABLE",
      collectedAt: "2026-01-01T00:00:02.000Z",
      provider: "pagespeed-insights",
      fallbackUsed: false,
      testedUrls: ["https://proof.example.com"],
      mobile: { status: "AVAILABLE", scores: { performance: 73 }, metrics: { fcpMs: 1200, lcpMs: 1800 } },
      desktop: { status: "AVAILABLE", scores: { performance: 88 }, metrics: { fcpMs: 600, lcpMs: 900 } },
      limitations: [],
    },
    competitors: [],
    backlinks: null,
    ga4: null,
    gsc: null,
    competitorOpportunities: null,
    ...(overrides.top || {}),
  };
}

const CRITICAL_FIELDS = ["domain", "pages", "services", "trust", "platform", "schemaTypes"];

// DE-05: each critical structural field class removed → persistence rejects
for (const field of CRITICAL_FIELDS) {
  test(`DE-05: AVAILABLE site missing ${field} → persistence rejects before scoring`, async () => {
    const store = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
    const { [field]: _removed, ...siteRest } = completeDecisionEvidence().site;
    const evidence = completeDecisionEvidence({ site: siteRest });

    // Positive control: the complete evidence passes
    await persistDecisionEvidence({
      store,
      scope: { tenantId: "t1", clientId: "c1", auditId: "550e8400-e29b-41d4-a716-446655440010" },
      evidence: completeDecisionEvidence(),
      validateContract: realValidate,
    });

    // The defective evidence must be rejected
    let rejected = null;
    try {
      await persistDecisionEvidence({
        store,
        scope: { tenantId: "t1", clientId: "c1", auditId: "550e8400-e29b-41d4-a716-446655440011" },
        evidence,
        validateContract: realValidate,
      });
    } catch (err) {
      rejected = err;
    }
    assert.ok(rejected, `AVAILABLE site missing ${field} must be rejected`);
    assert.match(rejected.message, /validation failed/, "rejection names validation");
  });
}

// DE-05: unavailable states may have reduced fields
test("DE-05: FAILED site with reduced fields remains valid", () => {
  const evidence = completeDecisionEvidence({
    site: { sourceStatus: "FAILED", collectedAt: "2026-01-01T00:00:01.000Z", limitations: ["provider failure"] },
  });
  const sv = realValidate(
    "https://vantage-platform.io/prysm/contracts/v1/decision-evidence.schema.json",
    evidence,
  );
  assert.equal(sv.valid, true, `unavailable states keep reduced fields: ${JSON.stringify(sv.errors?.slice(0, 3))}`);
});

// DE-04: minimal `{site: {sourceStatus: "AVAILABLE"}}` must NOT pass
test("DE-04: minimal AVAILABLE site object must NOT pass the executable schema", () => {
  const sv = realValidate(
    "https://vantage-platform.io/prysm/contracts/v1/decision-evidence.schema.json",
    { contractVersion: "1.0.0", decisionEvidenceVersion: "1.0.0", site: { sourceStatus: "AVAILABLE" } },
  );
  assert.equal(sv.valid, false, "minimal AVAILABLE site must be rejected by the schema");
});

// DE-06: read-back integrity — persisted, read back, byte/SHA verified, and
// schema-validated after read-back before use.
test("DE-06: loadAndValidateDecisionEvidence verifies and validates the persisted artifact", async () => {
  const store = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const evidence = completeDecisionEvidence();
  const record = await persistDecisionEvidence({
    store,
    scope: { tenantId: "t1", clientId: "c1", auditId: "550e8400-e29b-41d4-a716-446655440012" },
    evidence,
    validateContract: realValidate,
  });

  const loaded = await loadAndValidateDecisionEvidence({
    store,
    scope: { tenantId: "t1", clientId: "c1", auditId: "550e8400-e29b-41d4-a716-446655440012" },
    validateContract: realValidate,
  });

  assert.deepEqual(loaded, evidence, "loaded evidence deep-equals persisted evidence");
  assert.equal(record.sha256.length, 64, "SHA-256 recorded");
});

// DE-06: corrupt artifact rejected on load
test("DE-06: corrupt persisted decision evidence is rejected on load", async () => {
  const store = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const scope = { tenantId: "t1", clientId: "c1", auditId: "550e8400-e29b-41d4-a716-446655440013" };
  await store.put({
    bytes: Buffer.from("{ not valid json", "utf-8"),
    contentType: "application/json",
    scope: { ...scope, category: "canonical", artifactName: "decision-evidence.json" },
  });

  let rejected = null;
  try {
    await loadAndValidateDecisionEvidence({ store, scope, validateContract: realValidate });
  } catch (err) {
    rejected = err;
  }
  assert.ok(rejected, "corrupt artifact must be rejected on load");
});

// DE-06: schema-invalid persisted artifact rejected on load (post-read-back
// validation, not a parse check).
test("DE-06: schema-invalid persisted decision evidence is rejected on load", async () => {
  const store = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const scope = { tenantId: "t1", clientId: "c1", auditId: "550e8400-e29b-41d4-a716-446655440014" };
  await store.put({
    bytes: Buffer.from(JSON.stringify({ contractVersion: "1.0.0", decisionEvidenceVersion: "1.0.0", site: { sourceStatus: "AVAILABLE" } }), "utf-8"),
    contentType: "application/json",
    scope: { ...scope, category: "canonical", artifactName: "decision-evidence.json" },
  });

  let rejected = null;
  try {
    await loadAndValidateDecisionEvidence({ store, scope, validateContract: realValidate });
  } catch (err) {
    rejected = err;
  }
  assert.ok(rejected, "schema-invalid AVAILABLE evidence must be rejected on load");
  assert.match(rejected.message, /validation failed on load/, "rejection names load validation");
});
// DQV-005 — source-level status is canonical governed evidence.
// An empty item collection must not erase the status of the source that
// attempted to collect it.
test("DQV-005: canonical source-status map survives governed persistence", async () => {
  const store = createGovernedArtifactStore({
    store: createMemoryArtifactStore(),
  });

  const evidence = completeDecisionEvidence({
    top: {
      sourceStatus: {
        site: "AVAILABLE",
        performance: "AVAILABLE",
        competitors: "FAILED",
        backlinks: "NOT_CONNECTED",
        ga4: "NOT_CONNECTED",
        gsc: "NOT_CONNECTED",
      },
    },
  });

  const sv = realValidate(
    "https://vantage-platform.io/prysm/contracts/v1/decision-evidence.schema.json",
    evidence,
  );

  assert.equal(
    sv.valid,
    true,
    `source-status map is accepted by the governed contract: ${JSON.stringify(
      sv.errors?.slice(0, 3),
    )}`,
  );

  await persistDecisionEvidence({
    store,
    scope: {
      tenantId: "t1",
      clientId: "c1",
      auditId: "550e8400-e29b-41d4-a716-446655440015",
    },
    evidence,
    validateContract: realValidate,
  });

  const loaded = await loadAndValidateDecisionEvidence({
    store,
    scope: {
      tenantId: "t1",
      clientId: "c1",
      auditId: "550e8400-e29b-41d4-a716-446655440015",
    },
    validateContract: realValidate,
  });

  assert.deepEqual(
    loaded.sourceStatus,
    evidence.sourceStatus,
    "canonical source-status map survives persistence and governed read-back",
  );
  assert.equal(
    loaded.sourceStatus.competitors,
    "FAILED",
    "FAILED competitor source status survives governed persistence",
  );
});

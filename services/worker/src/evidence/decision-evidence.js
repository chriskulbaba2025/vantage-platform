/**
 * WP12 Decision Evidence — Governed hydration boundary.
 *
 * Accepts ONLY validated persisted SourceResults (loaded from normalized
 * checkpoints) and builds the deterministic { site, performance, competitors,
 * backlinks, ga4, gsc } evidence model required by scoring and rendering.
 *
 * This module does NOT:
 *   - Call provider adapters
 *   - Make network requests
 *   - Read raw provider payloads (only normalized artifacts)
 *   - Fabricate default data when evidence is missing
 *
 * @module evidence/decision-evidence
 */

import { createHash } from "node:crypto";
import { buildArtifactKey } from "../storage/artifact-key.js";

// ---------------------------------------------------------------------------
// Source-to-evidence-key mapping (must match SOURCE_EVIDENCE_MAP)
// ---------------------------------------------------------------------------
const SOURCE_KEY = Object.freeze({
  "dataforseo-onpage": "site",
  "pagespeed":           "performance",
  "dataforseo-serp":     "competitors",
  "backlinks":           "backlinks",
  "ga4":                 "ga4",
  "gsc":                 "gsc",
});

const VIABLE_STATUSES = new Set(["AVAILABLE", "PARTIAL"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Remove keys with undefined values so schema validation passes. */
function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Validate a single SourceResult before hydration.
 * Returns { valid, errors }.
 */
function validateSourceResult(sourceResult, validateContract) {
  if (!validateContract) return { valid: true, errors: [] };
  return validateContract(
    "https://vantage-platform.io/prysm/contracts/v1/source-result.schema.json",
    sourceResult,
  );
}

/**
 * Build the site (website) evidence from the DataForSEO On-Page SourceResult.
 */
function hydrateSite(sourceResult) {
  const ev = sourceResult.evidence || {};
  const status = sourceResult.status || "NOT_APPLICABLE";

  if (!VIABLE_STATUSES.has(status)) {
    return {
      sourceStatus: status,
      collectedAt: sourceResult.completedAt || undefined,
      limitations: sourceResult.limitations || [],
    };
  }

  return stripUndefined({
    sourceStatus: status,
    collectedAt: sourceResult.completedAt || undefined,
    // PRYSM-NEXT-01 WP-C — adapter version survives hydration for
    // capability provenance.
    adapterVersion: sourceResult.adapterVersion || undefined,
    // DE-04 critical structural fields: passed through WITHOUT defaults.
    // When the adapter did not supply them, the hydrated evidence omits
    // them and decision-evidence.schema.json rejects the AVAILABLE/PARTIAL
    // site at the persistence boundary (malformed evidence fails closed).
    domain: ev.domain || undefined,
    targetUrl: ev.targetUrl || undefined,
    pages: ev.pages,
    services: ev.services,
    trust: ev.trust,
    platform: ev.platform || undefined,
    schemaTypes: ev.schemaTypes,
    pageCount: ev.pageCount ?? 0,
    topicKeywords: ev.topicKeywords || [],
    ctas: ev.ctas || [],
    forms: ev.forms || [],
    externalCtas: ev.externalCtas || [],
    socialLinks: ev.socialLinks || [],
    statusCounts: ev.statusCounts || {},
    totalWords: ev.totalWords ?? 0,
    averageWords: ev.averageWords ?? 0,
    missingTitles: ev.missingTitles ?? 0,
    missingDescriptions: ev.missingDescriptions ?? 0,
    missingCanonicals: ev.missingCanonicals ?? 0,
    h1Missing: ev.h1Missing ?? 0,
    h1Multiple: ev.h1Multiple ?? 0,
    imageCount: ev.imageCount ?? 0,
    imagesMissingAlt: ev.imagesMissingAlt ?? 0,
    internalLinkCount: ev.internalLinkCount ?? 0,
    brokenInternalLinks: ev.brokenInternalLinks || [],
    securityHeaders: ev.securityHeaders || {},
    // PRYSM-NEXT-01 WP-C — unknown is NOT coerced to false. Absent stays
    // absent (undefined → stripped); capability derivation treats
    // undefined as "unknown", never "confirmed absent".
    _contentEvidenceAvailable: ev._contentEvidenceAvailable,
    _responseHeadersAvailable: ev._responseHeadersAvailable,
    limitations: sourceResult.limitations || [],
    coverage: sourceResult.coverage || undefined,
    // PRYSM-NEXT-01 WP-B — deep acquisition fields pass through the
    // hydration boundary losslessly (schema allows additional site
    // properties; decision-evidence v1.0.0 untouched).
    contentParsing: ev.contentParsing,
    redirectChains: ev.redirectChains,
    nonIndexablePages: ev.nonIndexablePages,
    pageResources: ev.pageResources,
    microdataTypes: ev.microdataTypes,
    acquisition: ev.acquisition,
  });
}

/**
 * Build the performance evidence from the PageSpeed SourceResult.
 */
function hydratePerformance(sourceResult) {
  const ev = sourceResult.evidence || {};
  const status = sourceResult.status || "NOT_APPLICABLE";

  if (!VIABLE_STATUSES.has(status)) {
    return {
      sourceStatus: status,
      collectedAt: sourceResult.completedAt || undefined,
      limitations: sourceResult.limitations || [],
    };
  }

  return stripUndefined({
    sourceStatus: status,
    collectedAt: sourceResult.completedAt || undefined,
    provider: sourceResult.provider || "pagespeed-insights",
    fallbackUsed: ev.fallbackUsed || false,
    testedUrls: ev.testedUrls || [],
    mobile: ev.mobile || undefined,
    desktop: ev.desktop || undefined,
    renderingDiagnostics: ev.renderingDiagnostics || undefined,
    limitations: sourceResult.limitations || [],
    coverage: sourceResult.coverage || undefined,
  });
}

/**
 * Build the competitor evidence from the DataForSEO SERP SourceResult.
 * Returns an array of competitor objects matching the shape scoring expects
 * ({ url, domain, status, collectedAt, evidence }), with source metadata
 * appended as non-enumerable or stored under competitorOpportunities.
 */
function hydrateCompetitors(sourceResult, suppliedCompetitors) {
  const ev = sourceResult.evidence || {};
  const status = sourceResult.status || "NOT_APPLICABLE";
  const rawCompetitors = ev.competitors || [];

  // Map raw SERP items into competitor comparison objects.
  // The SERP adapter normalizes items to { candidateUrl, domain, title,
  // position, ... } — the candidateUrl field must survive into the
  // competitor evidence (lossless adapter boundary).
  return rawCompetitors.map((item, i) => {
    const competitorUrl = item.url || item.candidateUrl || item.link || "";
    return {
      url: competitorUrl || `serp-result-${i}`,
      domain: item.domain || (() => { try { return new URL(competitorUrl).hostname; } catch { return ""; } })(),
      status,
      collectedAt: sourceResult.completedAt || undefined,
      evidence: {
        source: "dataforseo-serp",
        keyword: item._keyword || "",
        title: item.title || "",
        description: item.description || "",
        position: item.position ?? item.rank_absolute ?? i + 1,
        candidateUrl: competitorUrl,
        ...item,
      },
    };
  });
}

/**
 * Build generic MID-source evidence (backlinks, ga4, gsc).
 */
function hydrateMidSource(sourceResult) {
  const ev = sourceResult.evidence || {};
  const status = sourceResult.status || "NOT_APPLICABLE";

  return stripUndefined({
    sourceStatus: status,
    collectedAt: sourceResult.completedAt || undefined,
    provider: sourceResult.provider || "unknown",
    adapterVersion: sourceResult.adapterVersion || "0.0.0",
    limitations: sourceResult.limitations || [],
    ...ev,
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build the governed decision evidence model from validated persisted
 * SourceResults.
 *
 * Each SourceResult must have been validated against the source-result schema
 * before being passed here.  The function is pure and deterministic: identical
 * SourceResults always produce identical decision evidence.
 *
 * @param {object} opts
 * @param {Array<{ source: string, sourceResult: object }>} opts.allSourceResults
 * @param {Array<string>} [opts.suppliedCompetitors] — from audit request
 * @param {function} [opts.validateContract] — optional contract validator
 * @returns {{ evidence: object, errors: Array<string> }}
 */
export function buildDecisionEvidence({ allSourceResults, suppliedCompetitors, validateContract }) {
  const errors = [];
  const evidence = {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: null,
    performance: null,
    competitors: null,
    backlinks: null,
    ga4: null,
    gsc: null,
    competitorOpportunities: null,
  };

  for (const entry of allSourceResults) {
    const ek = SOURCE_KEY[entry.source];
    if (!ek) {
      errors.push(`Unknown source "${entry.source}" — no evidence key mapping`);
      continue;
    }

    const sr = entry.sourceResult;
    if (!sr) {
      errors.push(`Missing sourceResult for "${entry.source}"`);
      continue;
    }

    // Validate SourceResult before hydration.
    // AVAILABLE/PARTIAL sources that fail validation are NOT hydrated —
    // malformed evidence must never reach scoring or rendering.
    if (validateContract) {
      const validation = validateSourceResult(sr, validateContract);
      if (!validation.valid) {
        const status = sr.status || "NOT_APPLICABLE";
        errors.push(`SourceResult validation failed for "${entry.source}" (status=${status}): ${JSON.stringify(validation.errors?.slice(0, 3))}`);
        if (VIABLE_STATUSES.has(status)) {
          // Malformed AVAILABLE/PARTIAL evidence — fail closed.
          // Do NOT hydrate this source.  The evidence key stays null.
          continue;
        }
        // Non-viable sources (FAILED, BLOCKED, etc.) that still fail
        // validation are reported but do not block the pipeline.
      }
    }

    switch (ek) {
      case "site":
        evidence.site = hydrateSite(sr);
        break;
      case "performance":
        evidence.performance = hydratePerformance(sr);
        break;
      case "competitors":
        evidence.competitors = hydrateCompetitors(sr, suppliedCompetitors);
        break;
      case "backlinks":
        evidence.backlinks = hydrateMidSource(sr);
        break;
      case "ga4":
        evidence.ga4 = hydrateMidSource(sr);
        break;
      case "gsc":
        evidence.gsc = hydrateMidSource(sr);
        break;
      default:
        errors.push(`No hydration handler for evidence key "${ek}"`);
    }
  }

  // Decision evidence is built from validated, persisted SourceResults only.
  // Missing keys are NOT fabricated — downstream code must null-check.

  return { evidence, errors };
}

/**
 * Persist decision evidence as a governed immutable artifact.
 *
 * @param {object} opts
 * @param {import("../storage/governed-artifact-store.js").ArtifactStore} opts.store
 * @param {{ tenantId: string, clientId: string, auditId: string }} opts.scope
 * @param {object} opts.evidence — hydrated decision evidence
 * @param {function} opts.validateContract
 * @returns {Promise<import("../storage/governed-artifact-store.js").ArtifactRecord>}
 */
export async function persistDecisionEvidence({ store, scope, evidence, validateContract }) {
  // Validate against decision-evidence schema.  Fail closed — a missing or
  // unloadable schema is a production defect, not a recoverable error.
  if (validateContract) {
    const sv = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/decision-evidence.schema.json",
      evidence,
    );
    if (!sv || !sv.valid) {
      throw new Error(`Decision evidence validation failed: ${JSON.stringify((sv?.errors || []).slice(0, 5))}`);
    }
  }

  const bytes = Buffer.from(JSON.stringify(evidence), "utf-8");
  const record = await store.put({
    bytes,
    contentType: "application/json",
    scope: { ...scope, category: "canonical", artifactName: "decision-evidence.json" },
  });

  // Read-back verify
  const stored = await store.get(record.key);
  if (!stored || stored.length !== bytes.length) {
    throw new Error("Decision evidence read-back byte mismatch");
  }
  if (record.sha256 !== sha256(bytes)) {
    throw new Error("Decision evidence SHA-256 mismatch");
  }
  if (typeof store.verify === "function") {
    const verified = await store.verify(record);
    if (!verified) throw new Error("Decision evidence store.verify() failed");
  }

  return record;
}

/**
 * DE-06 / DE-08: load the persisted decision-evidence.json, verify artifact
 * integrity, and schema-validate the content BEFORE any consumer uses it.
 *
 * Sequence:
 *   load decision-evidence.json
 *   → verify artifact record (key/bytes/SHA)
 *   → schema validate the parsed content
 *   → return the validated evidence object
 *
 * @param {object} opts
 * @param {import("../storage/governed-artifact-store.js").ArtifactStore} opts.store
 * @param {{ tenantId: string, clientId: string, auditId: string }} opts.scope
 * @param {function} opts.validateContract
 * @returns {Promise<object>} the validated decision evidence
 * @throws {Error} when the artifact is missing, corrupt, or schema-invalid
 */
export async function loadAndValidateDecisionEvidence({ store, scope, validateContract }) {
  const key = buildArtifactKey({
    ...scope,
    category: "canonical",
    artifactName: "decision-evidence.json",
  });

  const bytes = await store.get(key);
  if (!bytes || bytes.length === 0) {
    throw new Error("Decision evidence artifact not found or empty — cannot proceed without governed evidence");
  }

  let evidence;
  try {
    evidence = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (parseErr) {
    throw new Error(`Decision evidence artifact is not valid JSON: ${parseErr.message}`);
  }

  // Schema validation AFTER read-back, BEFORE use.  Malformed
  // AVAILABLE/PARTIAL evidence fails closed here — scoring and rendering
  // are never reached with an incompatible evidence shape.
  if (validateContract) {
    const sv = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/decision-evidence.schema.json",
      evidence,
    );
    if (!sv || !sv.valid) {
      throw new Error(
        `Decision evidence validation failed on load: ${JSON.stringify((sv?.errors || []).slice(0, 5))}`,
      );
    }
  }

  return evidence;
}

export { SOURCE_KEY, VIABLE_STATUSES };
export default { buildDecisionEvidence, persistDecisionEvidence, loadAndValidateDecisionEvidence };

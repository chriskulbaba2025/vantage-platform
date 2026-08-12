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
    domain: ev.domain || undefined,
    targetUrl: ev.targetUrl || undefined,
    pageCount: ev.pageCount ?? 0,
    pages: ev.pages || [],
    services: ev.services || [],
    topicKeywords: ev.topicKeywords || [],
    ctas: ev.ctas || [],
    forms: ev.forms || [],
    externalCtas: ev.externalCtas || [],
    socialLinks: ev.socialLinks || [],
    trust: ev.trust || {},
    platform: ev.platform || undefined,
    schemaTypes: ev.schemaTypes || [],
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
    _contentEvidenceAvailable: ev._contentEvidenceAvailable ?? false,
    _responseHeadersAvailable: ev._responseHeadersAvailable ?? false,
    limitations: sourceResult.limitations || [],
    coverage: sourceResult.coverage || undefined,
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
  // Each item has { url, title, description, _keyword, ... } from the SERP adapter.
  // The competitorComparison function expects { url, domain, status, evidence }.
  return rawCompetitors.map((item, i) => ({
    url: item.url || item.link || `serp-result-${i}`,
    domain: item.domain || (() => { try { return new URL(item.url || "").hostname; } catch { return ""; } })(),
    status,
    collectedAt: sourceResult.completedAt || undefined,
    evidence: {
      source: "dataforseo-serp",
      keyword: item._keyword || "",
      title: item.title || "",
      description: item.description || "",
      position: item.position ?? i + 1,
      ...item,
    },
  }));
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

    // Validate SourceResult before hydration
    if (validateContract) {
      const validation = validateSourceResult(sr, validateContract);
      if (!validation.valid) {
        errors.push(`SourceResult validation failed for "${entry.source}": ${JSON.stringify(validation.errors?.slice(0, 3))}`);
        // Continue with hydration — structural errors are reported but don't
        // block the remaining sources.  Callers decide fail-closed policy.
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

  // Fill missing evidence keys with defaults so downstream code does not
  // need to null-check every evidence key.
  if (!evidence.site) evidence.site = { sourceStatus: "NOT_CONNECTED" };
  if (!evidence.performance) evidence.performance = { sourceStatus: "NOT_CONNECTED" };
  if (!evidence.competitors) evidence.competitors = [];
  if (!evidence.backlinks) evidence.backlinks = { sourceStatus: "NOT_CONNECTED" };
  if (!evidence.ga4) evidence.ga4 = { sourceStatus: "NOT_CONNECTED" };
  if (!evidence.gsc) evidence.gsc = { sourceStatus: "NOT_CONNECTED" };
  if (!evidence.competitorOpportunities) evidence.competitorOpportunities = {};

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

export { SOURCE_KEY, VIABLE_STATUSES };
export default { buildDecisionEvidence, persistDecisionEvidence };

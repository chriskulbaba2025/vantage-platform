/**
 * Prysm → n8n Payload Preparation Script
 *
 * Reads a completed Prysm audit.json and produces a compact, evidence-safe
 * payload suitable for GPT interpretation.  Strips oversized artifacts,
 * credentials, raw provider payloads, and duplicated competitor data.
 *
 * Preserves: scores, source statuses, finding IDs, rule IDs, URLs,
 * limitations, confidence, recommendations, verification methods.
 *
 * Usage:
 *   node src/n8n/prepare-payload.js <path-to-audit.json>
 *
 * Output: compact JSON payload to stdout
 */

import { readFileSync } from "fs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FINDINGS = 30;
const MAX_COMPETITORS = 5;
const MAX_LIMITATIONS = 20;
const MAX_KEYWORDS = 20;
const STRIP_KEYS = new Set([
  "_sourceStatus", "rawArtifactRef", "evidenceVersion", "_crawlSuppressed",
  "input", "generatedAt", "reportVersion", "scoringVersion",
  "evidenceConfidenceFactors", "moduleEligibility", "dimensionEligibility",
  "conversionPaths", "readinessMap", "contentIdeas", "suppressedModules",
  "evidence", "competitorOpportunities",
]);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node src/n8n/prepare-payload.js <path-to-audit.json>");
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(path, "utf8"));
  const compact = preparePayload(raw);
  process.stdout.write(JSON.stringify(compact, null, 2));
}

// ---------------------------------------------------------------------------
// Payload preparation
// ---------------------------------------------------------------------------

/**
 * Convert a full Prysm audit model into a compact GPT-safe payload.
 */
export function preparePayload(audit) {
  const compact = {};

  // Business context
  const business = audit.input?.businessName || audit.evidence?.site?.domain || "Unknown";
  const domain = audit.evidence?.site?.domain || "Unknown";
  const platform = audit.evidence?.site?.platform || "Unknown";
  compact.business = { name: business, domain, platform };

  // Scores — preserve all
  compact.scores = _preserveScores(audit.scores || {});

  // Bands
  compact.bands = _preserveBands(audit.bands || {});

  // Readiness
  compact.readinessStatus = audit.readinessStatus || "Unknown";
  compact.assessedWeight = audit.assessedWeight ?? null;
  compact.showNumericScore = audit.showNumericScore !== false;

  // Evidence confidence
  compact.evidenceConfidenceScore = audit.evidenceConfidenceScore ?? null;

  // Root cause
  compact.rootCause = _truncate(audit.rootCause || "", 500);

  // Performance diagnostics
  if (audit.renderingDiagnostics && audit.renderingDiagnostics.length > 0) {
    compact.renderingDiagnostics = audit.renderingDiagnostics.map((d) => ({
      code: d.diagnosticCode,
      category: d.diagnosticCategory,
      explanation: d.clientExplanation,
      confidence: d.confidence,
    }));
  }

  // Source statuses — from evidence
  const ev = audit.evidence || {};
  compact.sourceStatus = {
    website: ev.site?.sourceStatus || "UNKNOWN",
    performance: ev.performance?.sourceStatus || "UNKNOWN",
    competitors: (ev.competitors || []).length > 0 ? "SUPPLIED" : "NONE",
    backlinks: ev.backlinks?.sourceStatus || "NOT_CONNECTED",
    ga4: ev.ga4?.sourceStatus || "NOT_CONNECTED",
    gsc: ev.gsc?.sourceStatus || "NOT_CONNECTED",
  };

  // Competitors — limited count, key fields only
  const competitors = ev.competitors || [];
  compact.competitors = competitors.slice(0, MAX_COMPETITORS).map((c) => ({
    url: c.url || c.targetUrl || "",
    domain: c.domain || "",
    pageCount: c.pageCount || 0,
    status: c.sourceStatus || "UNKNOWN",
  }));

  // Performance coverage
  compact.performanceCoverage = {
    requested: ev.performance?.coverage?.requested || 0,
    completed: ev.performance?.coverage?.completed || 0,
    failed: ev.performance?.coverage?.failed || 0,
    pagesTested: ev.performance?.coverage?.pagesTested || 0,
  };

  // Limitations — deduplicated, truncated
  const allLimits = [
    ...(ev.site?.limitations || []),
    ...(ev.performance?.limitations || []),
    ...(ev.backlinks?.limitations || []),
    ...(ev.ga4?.limitations || []),
    ...(ev.gsc?.limitations || []),
  ];
  compact.limitations = [...new Set(allLimits)].slice(0, MAX_LIMITATIONS);

  // Findings — preserve IDs, rule IDs, URLs, evidence, confidence, recommendations
  const findings = audit.findings || [];
  compact.findings = findings.slice(0, MAX_FINDINGS).map((f) => ({
    findingId: f.findingId,
    ruleId: f.ruleId,
    title: f.title,
    severity: f.severity,
    confidence: f.confidence,
    scoreBearing: f.scoreBearing,
    businessImpact: f.businessImpact || "",
    recommendation: f.recommendation || "",
    verificationMethod: f.verificationMethod || "",
    affectedUrls: (f.affectedUrls || []).slice(0, 10),
    evidence: (f.evidence || []).slice(0, 3).map((er) => ({
      field: er.field,
      observedValue: er.observedValue,
    })),
    implementationEffort: f.implementationEffort || "M",
  }));

  // Site key metrics
  const site = ev.site || {};
  compact.siteMetrics = {
    pageCount: site.pageCount || 0,
    services: (site.services || []).slice(0, MAX_KEYWORDS),
    topicKeywords: (site.topicKeywords || []).slice(0, MAX_KEYWORDS),
    platform: site.platform || "Unknown",
    hasHttps: (site.targetUrl || "").startsWith("https://"),
    schemaCount: (site.schemaTypes || []).length,
    ctaCount: (site.ctas || []).length,
    formCount: (site.forms || []).length,
  };

  // Trust flags
  const trust = site.trust || {};
  compact.trustFlags = {
    testimonials: !!trust.testimonials,
    credentials: !!trust.credentials,
    caseStudies: !!trust.caseStudies,
    faq: !!trust.faq,
    pricing: !!trust.pricing,
    policies: !!trust.policies,
    contact: !!trust.contact,
  };

  // Technical counts
  compact.technical = {
    missingTitles: site.missingTitles || 0,
    missingDescriptions: site.missingDescriptions || 0,
    h1Missing: site.h1Missing || 0,
    h1Multiple: site.h1Multiple || 0,
    imagesMissingAlt: site.imagesMissingAlt || 0,
    internalLinkCount: site.internalLinkCount || 0,
  };

  // Gate output
  if (audit._gate) {
    compact.gateRecommendation = audit._gate.commercialRecommendation || "";
    compact.gateNextAction = audit._gate.nextAction || "";
    compact.gateServiceCategories = audit._gate.serviceCategories || [];
  }

  // Strip oversized keys
  for (const key of STRIP_KEYS) {
    delete compact[key];
  }

  return compact;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _preserveScores(scores) {
  const keys = [
    "trust", "contentDepth", "conversionPathways", "technical", "performance",
    "conversionReadiness", "awareness", "consideration", "decision", "aiReadiness",
    "conversionPathwaysDimension", "trustEeatDimension", "contentFunnelDimension",
    "technicalPerformanceDimension", "entitySchemaAiDimension",
  ];
  const out = {};
  for (const k of keys) {
    if (k in scores) out[k] = scores[k];
  }
  return out;
}

function _preserveBands(bands) {
  return {
    conversionReadiness: bands.conversionReadiness || "Not Assessed",
    trust: bands.trust || "Not Assessed",
    evidenceConfidence: bands.evidenceConfidence || "Not Assessed",
  };
}

function _truncate(str, max) {
  if (!str || str.length <= max) return str || "";
  return str.slice(0, max) + "...";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main();
}

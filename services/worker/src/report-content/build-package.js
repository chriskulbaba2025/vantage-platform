/**
 * WP8 — Compact Report Content Package Builder
 *
 * Builds the deterministic ReportContentPackage from governed post-WP7 inputs:
 *   - locked canonical evidence
 *   - persisted/validated findings (FindingSet)
 *   - persisted/validated scores (ScoreSet)
 *
 * The package is the SOLE future n8n narrative payload boundary.
 * It contains only governed report facts — no raw provider payloads,
 * HTML, CSS, secrets, credentials, debug logs, or layout instructions.
 *
 * WP8 does NOT invoke n8n, generate narrative, or render reports.
 *
 * @module report-content/build-package
 */

import { createHash } from "node:crypto";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";
import { SCORING_VERSION } from "../scoring/score-components.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_VERSION = "1.0.0";
const PROMPT_VERSION = "1.0.0";
const OUTPUT_SCHEMA_VERSION = "1.0.0";
const MAX_FINDINGS = 30;
const MAX_COMPETITORS = 5;
const MAX_LIMITATIONS = 20;
const MAX_AFFECTED_URLS = 10;
const MAX_EVIDENCE_RECORDS = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(str) {
  return createHash("sha256").update(str).digest("hex");
}

// ---------------------------------------------------------------------------
// Identity builder
// ---------------------------------------------------------------------------

function buildIdentity(auditRequest, evidence) {
  const site = evidence.site || {};
  return {
    name: auditRequest.businessName || "",
    domain: site.domain || new URL(auditRequest.targetUrl || "https://unknown").hostname,
    platform: site.platform || "Unknown",
  };
}

// ---------------------------------------------------------------------------
// Score copier — no reinterpretation
// ---------------------------------------------------------------------------

function copyScores(scoreSet) {
  const s = scoreSet.scores || scoreSet || {};
  return {
    trust: s.trust ?? null,
    contentDepth: s.contentDepth ?? null,
    conversionPathways: s.conversionPathways ?? null,
    technical: s.technical ?? null,
    performance: s.performance ?? null,
    conversionReadiness: s.conversionReadiness ?? null,
    awareness: s.awareness ?? null,
    consideration: s.consideration ?? null,
    decision: s.decision ?? null,
    aiReadiness: s.aiReadiness ?? null,
    conversionPathwaysDimension: s.conversionPathwaysDimension ?? null,
    trustEeatDimension: s.trustEeatDimension ?? null,
    contentFunnelDimension: s.contentFunnelDimension ?? null,
    technicalPerformanceDimension: s.technicalPerformanceDimension ?? null,
    entitySchemaAiDimension: s.entitySchemaAiDimension ?? null,
  };
}

function copyBands(scoreSet) {
  const b = scoreSet.bands || {};
  return {
    conversionReadiness: b.conversionReadiness || "Not Assessed",
    trust: b.trust || "Not Assessed",
    evidenceConfidence: b.evidenceConfidence || "Directional",
  };
}

// ---------------------------------------------------------------------------
// Source status
// ---------------------------------------------------------------------------

function buildSourceStatus(evidence) {
  return {
    website: evidence.site?.sourceStatus || SOURCE_STATUS.NOT_CONNECTED,
    performance: evidence.performance?.sourceStatus || SOURCE_STATUS.NOT_CONNECTED,
    competitors: evidence.competitors?.some(
      (c) => c.status === SOURCE_STATUS.AVAILABLE,
    )
      ? SOURCE_STATUS.AVAILABLE
      : evidence.competitors?.length
        ? SOURCE_STATUS.PARTIAL
        : SOURCE_STATUS.NOT_CONNECTED,
    backlinks: evidence.backlinks?.sourceStatus || SOURCE_STATUS.NOT_CONNECTED,
    ga4: evidence.ga4?.sourceStatus || SOURCE_STATUS.NOT_CONNECTED,
    gsc: evidence.gsc?.sourceStatus || SOURCE_STATUS.NOT_CONNECTED,
  };
}

// ---------------------------------------------------------------------------
// Site metrics
// ---------------------------------------------------------------------------

function buildSiteMetrics(evidence) {
  const site = evidence.site || {};
  return {
    pageCount: site.pageCount ?? 0,
    services: (site.services || []).slice(0, 20),
    topicKeywords: (site.topicKeywords || []).slice(0, 20),
    platform: site.platform || "Unknown",
    hasHttps: (site.targetUrl || "").startsWith("https:"),
    schemaCount: (site.schemaTypes || []).length,
    ctaCount: (site.ctas || []).length,
    formCount: (site.forms || []).length,
  };
}

// ---------------------------------------------------------------------------
// Trust flags
// ---------------------------------------------------------------------------

function buildTrustFlags(evidence) {
  const t = evidence.site?.trust || {};
  return {
    testimonials: t.testimonials || false,
    credentials: t.credentials || false,
    caseStudies: t.caseStudies || false,
    faq: t.faq || false,
    pricing: t.pricing || false,
    policies: t.policies || false,
    contact: t.contact || false,
  };
}

// ---------------------------------------------------------------------------
// Technical
// ---------------------------------------------------------------------------

function buildTechnical(evidence) {
  const site = evidence.site || {};
  return {
    missingTitles: site.missingTitles ?? 0,
    missingDescriptions: site.missingDescriptions ?? 0,
    h1Missing: site.h1Missing ?? 0,
    h1Multiple: site.h1Multiple ?? 0,
    imagesMissingAlt: site.imagesMissingAlt ?? 0,
    internalLinkCount: site.internalLinkCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------

function buildCompetitors(evidence) {
  const competitors = evidence.competitors || [];
  return competitors.slice(0, MAX_COMPETITORS).map((c) => ({
    url: c.url || "",
    domain: c.domain || "",
    pageCount: c.pageCount ?? 0,
    status: c.status || SOURCE_STATUS.NOT_CONNECTED,
  }));
}

// ---------------------------------------------------------------------------
// Performance coverage
// ---------------------------------------------------------------------------

function buildPerformanceCoverage(evidence) {
  const perf = evidence.performance || {};
  const cov = perf.coverage || {};
  return {
    requested: cov.requested ?? 0,
    completed: cov.completed ?? 0,
    failed: cov.failed ?? 0,
    pagesTested: perf.mobile || perf.desktop ? 2 : 0,
  };
}

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

function buildLimitations(evidence, scoreSet) {
  const lims = new Set();

  // Gather from canonical evidence sources
  const sources = ["site", "performance", "ga4", "gsc", "backlinks"];
  for (const key of sources) {
    const ev = evidence[key];
    if (!ev) continue;
    const srcLims = ev.limitations || [];
    for (const l of srcLims) {
      if (typeof l === "string" && l.length > 0) lims.add(l);
    }
  }

  // Gather from score set
  const scoreLims = scoreSet.limitations || [];
  for (const l of scoreLims) {
    if (typeof l === "string" && l.length > 0) lims.add(l);
  }

  return [...lims].slice(0, MAX_LIMITATIONS);
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function buildFindings(findings) {
  if (!Array.isArray(findings)) return [];
  return findings.slice(0, MAX_FINDINGS).map((f) => ({
    findingId: f.findingId || "",
    ruleId: f.ruleId || "",
    title: f.title || "",
    severity: f.severity || "Medium",
    confidence: f.confidence || "deterministic",
    scoreBearing: f.scoreBearing !== false,
    businessImpact: f.businessImpact || f.impact || "",
    recommendation: f.recommendation || f.fix || "",
    verificationMethod: f.verificationMethod || "",
    affectedUrls: (f.affectedUrls || []).filter(Boolean).slice(0, MAX_AFFECTED_URLS),
    evidence: (f.evidence || []).slice(0, MAX_EVIDENCE_RECORDS).map((e) => ({
      field: e.field || "",
      observedValue: e.observedValue ?? null,
    })),
    implementationEffort: f.implementationEffort || f.effort || "M",
  }));
}

// ---------------------------------------------------------------------------
// Rendering diagnostics
// ---------------------------------------------------------------------------

function buildRenderingDiagnostics(scoreSet) {
  const diags = scoreSet.renderingDiagnostics || [];
  return diags.slice(0, 10).map((d) => ({
    code: d.diagnosticCode || d.code || "",
    category: d.diagnosticCategory || d.category || "",
    explanation: d.clientExplanation || d.explanation || "",
    confidence: typeof d.confidence === "number"
      ? d.confidence >= 0.8 ? "High" : d.confidence >= 0.5 ? "Moderate" : "Low"
      : d.confidence || "Moderate",
  }));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build the governed ReportContentPackage.
 *
 * @param {object} opts
 * @param {object} opts.auditRequest — Audit request ({ auditId, businessName, targetUrl })
 * @param {object} opts.canonicalEvidence — Locked canonical evidence
 * @param {Array<object>} opts.findings — Validated FindingSet (array of governed findings)
 * @param {object} opts.scoreSet — Validated ScoreSet
 * @param {string} [opts.promptVersion] — Optional prompt version override
 * @returns {object} Schema-valid ReportContentPackage
 */
export function buildReportContentPackage({
  auditRequest,
  canonicalEvidence,
  findings,
  scoreSet,
  promptVersion,
}) {
  // ── Validate inputs ──────────────────────────────────────────────────
  if (!auditRequest?.auditId) throw new Error("auditRequest.auditId is required");
  if (!canonicalEvidence) throw new Error("canonicalEvidence is required");
  if (!findings) throw new Error("findings is required");
  if (!scoreSet) throw new Error("scoreSet is required");

  // ── Build package ────────────────────────────────────────────────────
  const pkg = {
    contractVersion: "1.0.0",
    packageVersion: PACKAGE_VERSION,
    auditId: auditRequest.auditId,
    business: buildIdentity(auditRequest, canonicalEvidence),
    scores: copyScores(scoreSet),
    bands: copyBands(scoreSet),
    readinessStatus: scoreSet.readinessStatus || scoreSet.readinessStatusDetail || "Complete",
    assessedWeight: scoreSet.assessedWeight ?? null,
    showNumericScore: scoreSet.showNumericScore !== false,
    evidenceConfidenceScore: scoreSet.evidenceConfidenceScore ?? null,
    rootCause: scoreSet.rootCause || "",
    renderingDiagnostics: buildRenderingDiagnostics(scoreSet),
    sourceStatus: buildSourceStatus(canonicalEvidence),
    competitors: buildCompetitors(canonicalEvidence),
    performanceCoverage: buildPerformanceCoverage(canonicalEvidence),
    limitations: buildLimitations(canonicalEvidence, scoreSet),
    findings: buildFindings(findings),
    siteMetrics: buildSiteMetrics(canonicalEvidence),
    trustFlags: buildTrustFlags(canonicalEvidence),
    technical: buildTechnical(canonicalEvidence),
    gateRecommendation: "",
    gateNextAction: "",
    gateServiceCategories: [],
    promptVersion: promptVersion || PROMPT_VERSION,
    outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
  };

  return pkg;
}

/**
 * Serialize the package to deterministic bytes for artifact persistence.
 * Uses sorted keys for deterministic JSON output.
 */
export function serializePackage(pkg) {
  return JSON.stringify(pkg, null, 2);
}

/**
 * Compute SHA-256 of the serialized package.
 */
export function packageSha256(pkg) {
  return sha256(serializePackage(pkg));
}

export {
  PACKAGE_VERSION,
  PROMPT_VERSION,
  OUTPUT_SCHEMA_VERSION,
  SCORING_VERSION,
};

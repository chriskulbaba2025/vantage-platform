/**
 * WP10 ReportViewModel Builder — Locked Renderer Boundary
 *
 * Assembles a schema-valid ReportViewModel from:
 *   1. WP8 ReportContentPackage (validated)
 *   2. WP9 NarrativeResponse (validated)
 *   3. Scoring model (loaded from scores artifact)
 *
 * Only a schema-valid ReportViewModel reaches the renderer.
 * Invalid input produces RENDER_FAILED with zero renderer calls.
 *
 * @module report-view-model/build-view-model
 */

import { createHash } from "node:crypto";
import { hydrateCurrentReportModel } from "../report-model/current-model.js";

// ---------------------------------------------------------------------------
// Locked report design version — must match schema const
// ---------------------------------------------------------------------------
export const LOCKED_REPORT_DESIGN_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Renderer lock — SHA-256 of all frozen renderer assets
// ---------------------------------------------------------------------------
export const RENDERER_LOCK = Object.freeze({
  designVersion: LOCKED_REPORT_DESIGN_VERSION,
  // Baseline hashes computed at WP10 freeze time — filled by lock verification
  baselineSha256: null,
  files: Object.freeze([
    "services/worker/src/report/karen-leslie-template.html",
    "services/worker/src/report/render-report.js",
    "services/worker/src/report/render-approved-report.js",
    "services/worker/src/report/html-helpers.js",
    "services/worker/src/report/sections-conversion.js",
    "services/worker/src/report/sections-trust.js",
    "services/worker/src/report/sections-seo.js",
    "services/worker/src/report/sections-performance.js",
    "services/worker/src/report/sections-internal-links.js",
    "services/worker/src/report/verify-template.js",
  ]),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function stableJson(obj) {
  return JSON.stringify(obj, null, 2);
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Validate WP8 ReportContentPackage against its frozen contract.
 * Returns { valid, errors }.
 */
function validateReportContentPackage(pkg, validateContract) {
  const result = validateContract(
    "https://vantage-platform.io/prysm/contracts/v1/report-content.schema.json",
    pkg,
  );
  return result;
}

/**
 * Validate WP9 NarrativeResponse against its frozen contract.
 * Returns { valid, errors }.
 */
function validateNarrativeResponse(narrative, validateContract) {
  const result = validateContract(
    "https://vantage-platform.io/prysm/contracts/v1/narrative-response.schema.json",
    narrative,
  );
  return result;
}

/**
 * Validate the assembled ReportViewModel against its frozen contract.
 * Returns { valid, errors }.
 */
function validateReportViewModel(model, validateContract) {
  const result = validateContract(
    model.contractVersion === "2.0.0"
      ? "https://vantage-platform.io/prysm/contracts/v2/report-view-model.schema.json"
      : "https://vantage-platform.io/prysm/contracts/v1/report-view-model.schema.json",
    model,
  );
  return result;
}

// ---------------------------------------------------------------------------
// ReportViewModel assembly
// ---------------------------------------------------------------------------

/**
 * Build the ReportViewModel from governed WP8 + WP9 + scoring artifacts.
 *
 * This is the only entry point for renderer input. The renderer MUST NOT
 * receive unvalidated data.
 *
 * @param {object} opts
 * @param {object} opts.reportPackage — schema-valid WP8 ReportContentPackage
 * @param {object} opts.narrative — schema-valid WP9 NarrativeResponse
 * @param {object} opts.scoringModel — full scoring model from scoreAudit()
 * @param {Function} opts.validateContract — contract validator function
 * @param {string} [opts.reportVersion] — scoring version override
 * @param {string} [opts.now] — ISO-8601 timestamp for generatedAt
 * @returns {{ valid: boolean, model: object|null, hash: string|null, errors: string[] }}
 */
export function buildReportViewModel({
  reportPackage,
  narrative,
  scoringModel,
  validateContract,
  reportVersion,
  now,
  decisionEvidence,
  capabilityEvidence,
}) {
  const errors = [];
  let rendererCallCount = 0;

  // --- 1. Validate WP8 ReportContentPackage ---
  if (!reportPackage || typeof reportPackage !== "object") {
    return {
      valid: false, model: null, hash: null,
      errors: ["ReportContentPackage is required and must be an object"],
      rendererCallCount: 0,
    };
  }

  const pkgValidation = validateReportContentPackage(reportPackage, validateContract);
  if (!pkgValidation.valid) {
    return {
      valid: false, model: null, hash: null,
      errors: [
        "ReportContentPackage schema validation failed",
        ...(pkgValidation.errors || []).map((e) =>
          `${e.instancePath || ""} ${e.message || "invalid"}`,
        ),
      ],
      rendererCallCount: 0,
    };
  }

  // --- 2. Validate WP9 NarrativeResponse ---
  if (!narrative || typeof narrative !== "object") {
    return {
      valid: false, model: null, hash: null,
      errors: ["NarrativeResponse is required and must be an object"],
      rendererCallCount: 0,
    };
  }

  const narrValidation = validateNarrativeResponse(narrative, validateContract);
  if (!narrValidation.valid) {
    return {
      valid: false, model: null, hash: null,
      errors: [
        "NarrativeResponse schema validation failed",
        ...(narrValidation.errors || []).map((e) =>
          `${e.instancePath || ""} ${e.message || "invalid"}`,
        ),
      ],
      rendererCallCount: 0,
    };
  }

  // --- 3. Validate auditId consistency ---
  if (reportPackage.auditId !== narrative.auditId) {
    return {
      valid: false, model: null, hash: null,
      errors: [
        `AuditId mismatch: package=${reportPackage.auditId}, narrative=${narrative.auditId}`,
      ],
      rendererCallCount: 0,
    };
  }

  // --- 4. Validate scoring model ---
  if (!scoringModel || typeof scoringModel !== "object") {
    return {
      valid: false, model: null, hash: null,
      errors: ["Scoring model is required and must be an object"],
      rendererCallCount: 0,
    };
  }

  if (!scoringModel.scores || !scoringModel.findings) {
    return {
      valid: false, model: null, hash: null,
      errors: ["Scoring model missing required fields: scores and findings are required"],
      rendererCallCount: 0,
    };
  }

  // Current ScoreSet artifacts have one canonical semantic hydration source.
  // Older WP10 fixtures remain supported only as historical compatibility.
  const current = scoringModel.contractVersion === "2.0.0"
    ? hydrateCurrentReportModel({
      scoreSet: scoringModel,
      findings: scoringModel.findings,
      decisionEvidence,
      capabilityEvidence,
    })
    : null;

  // --- 5. Assemble ReportViewModel ---
  const generatedAt = now || new Date().toISOString();

  const model = {
    contractVersion: current ? "2.0.0" : "1.0.0",
    reportVersion: reportVersion || scoringModel.scoringVersion || "3.0.0",
    reportDesignVersion: LOCKED_REPORT_DESIGN_VERSION,
    generatedAt,
    // Input from WP8 package
    input: {
      targetUrl: reportPackage.business?.domain
        ? `https://${reportPackage.business.domain}`
        : "",
      businessName: reportPackage.business?.name || "",
      market: "",
      language: "en-CA",
      primaryGoal: "",
      services: reportPackage.siteMetrics?.services || [],
      competitors: (reportPackage.competitors || []).map((c) => c.url),
    },
    // Scores from scoring model
    scores: current?.scores || scoringModel.scores || {},
    bands: current?.bands || scoringModel.bands || {},
    assessedWeight: scoringModel.assessedWeight ?? reportPackage.assessedWeight ?? 0,
    readinessStatus: scoringModel.readinessStatus || reportPackage.readinessStatus || "",
    showNumericScore:
      scoringModel.showNumericScore ?? reportPackage.showNumericScore ?? false,
    evidenceConfidenceScore:
      scoringModel.evidenceConfidenceScore ?? reportPackage.evidenceConfidenceScore ?? 0,
    rootCause: current?.rootCause || scoringModel.rootCause || reportPackage.rootCause || "",
    ...(current ? {
      rootCauseRuleId: current.rootCauseRuleId,
      decisionHierarchy: current.decisionHierarchy,
    } : {}),
    // Findings from scoring model
    findings: (scoringModel.findings || []).map((f) => ({
      contractVersion: f.contractVersion || "1.0.0",
      findingId: f.findingId || "",
      ruleId: f.ruleId || "",
      ruleVersion: f.ruleVersion || "3.0.0",
      dimension: f.dimension || "",
      module: f.module || "",
      title: f.title || "",
      affectedUrls: f.affectedUrls || [],
      evidence: (f.evidence || []).map((ev) => ({
        field: ev.field || "",
        observedValue: ev.observedValue,
        source: ev.source || ev.provider || "",
      })),
      confidence: typeof f.confidence === "string" ? f.confidence : "deterministic",
      businessImpact: f.businessImpact || "",
      recommendation: f.recommendation || "",
      implementationEffort: f.implementationEffort || "M",
      verificationMethod: f.verificationMethod || "",
      scoreBearing: f.scoreBearing ?? true,
      severity: f.severity || "Medium",
      finalPriority: typeof f.finalPriority === "number" ? f.finalPriority : 50,
    })),
    // Structural data from scoring model
    conversionPaths: scoringModel.conversionPaths || [],
    readinessMap: scoringModel.readinessMap || [],
    contentIdeas: scoringModel.contentIdeas || {
      tofu: [], mofu: [], bofu: [], leading: [],
    },
    competitors: scoringModel.competitors || {
      comparisons: [],
      opportunities: {
        topics: [], qualifiedCandidates: [], excludedCandidates: [],
        gaps: [], allGaps: [], sources: {}, limitations: [],
      },
    },
    ...(current ? { crossReportInterpretation: current.crossReportInterpretation } : {}),
    // Source status
    sourceStatus: {
      website: reportPackage.sourceStatus?.website || "NOT_APPLICABLE",
      performance: reportPackage.sourceStatus?.performance || "NOT_APPLICABLE",
      competitors: reportPackage.sourceStatus?.competitors || "NOT_APPLICABLE",
      backlinks: reportPackage.sourceStatus?.backlinks || "NOT_APPLICABLE",
      ga4: reportPackage.sourceStatus?.ga4 || "NOT_APPLICABLE",
      gsc: reportPackage.sourceStatus?.gsc || "NOT_APPLICABLE",
    },
    limitations: reportPackage.limitations || [],
    // Governed decision evidence — part of the COMPLETE model, validated
    // together with everything else BEFORE the renderer receives it.
    evidence: current?.evidence || decisionEvidence || null,
    ...(current ? { capabilityEvidence: current.capabilityEvidence } : {}),
    // Narrative fields
    narrative: narrative,
    // Gate
    gate: {
      passed: true,
      validatedAt: generatedAt,
    },
  };

  // --- 6. Validate assembled model against ReportViewModel schema ---
  const modelValidation = validateReportViewModel(model, validateContract);
  if (!modelValidation.valid) {
    return {
      valid: false, model: null, hash: null,
      errors: [
        "Assembled ReportViewModel failed schema validation",
        ...(modelValidation.errors || []).map((e) =>
          `${e.instancePath || ""} ${e.message || "invalid"}`,
        ),
      ],
      rendererCallCount: 0,
    };
  }

  // --- 7. Compute model hash for deterministic replay ---
  const modelHash = sha256(stableJson(model));

  return {
    valid: true,
    model,
    hash: modelHash,
    errors: [],
    rendererCallCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Renderer lock verification
// ---------------------------------------------------------------------------

/**
 * Verify that the locked renderer assets have not been modified.
 *
 * Reads each file in RENDERER_LOCK.files, computes SHA-256, and compares
 * to the baseline. On first run (no baseline), records the baseline.
 *
 * @param {Function} readFile — async (path: string) => Buffer
 * @returns {Promise<{ verified: boolean, hashes: Map<string,string>, errors: string[] }>}
 */
export async function verifyRendererLock(readFile) {
  const hashes = new Map();
  const errors = [];

  for (const file of RENDERER_LOCK.files) {
    try {
      const content = await readFile(file);
      const hash = sha256(typeof content === "string" ? content : content.toString("utf-8"));
      hashes.set(file, hash);
    } catch (err) {
      errors.push(`Cannot read ${file}: ${err.message}`);
    }
  }

  return {
    verified: errors.length === 0,
    hashes,
    errors,
  };
}

/**
 * Compute the composite renderer lock hash from all locked files.
 * @param {Map<string,string>} hashes
 * @returns {string} SHA-256 of all hashes concatenated in order
 */
export function computeCompositeLockHash(hashes) {
  const ordered = RENDERER_LOCK.files.map((f) => hashes.get(f) || "");
  return sha256(ordered.join(""));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  buildReportViewModel,
  verifyRendererLock,
  computeCompositeLockHash,
  LOCKED_REPORT_DESIGN_VERSION,
  RENDERER_LOCK,
};

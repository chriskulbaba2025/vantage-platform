/**
 * Governed reportability boundary.
 *
 * Rendering a byte-valid artifact is not proof that the audit has enough
 * first-party evidence to support client conclusions. This module owns the
 * deterministic distinction between reportable site evidence and an
 * incomplete audit. It deliberately does not score, rank, or collect data.
 */

const REPORTABLE_SOURCE_STATUSES = new Set(["AVAILABLE", "PARTIAL"]);

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Evaluate whether the persisted decision evidence supports a client report.
 *
 * A site needs inspected page evidence and content evidence. A source may be
 * PARTIAL and still reportable when those minimum foundations exist; the
 * limitation remains explicit. Peripheral sources never substitute for the
 * first-party site boundary.
 */
export function evaluateReportEvidenceSufficiency(decisionEvidence = {}) {
  const site = decisionEvidence?.site && typeof decisionEvidence.site === "object"
    ? decisionEvidence.site
    : {};
  const status = String(site.sourceStatus || "UNKNOWN").toUpperCase();
  const pageCount = Number.isInteger(site.pageCount) ? site.pageCount : 0;
  const inspectedPages = Math.max(pageCount, Array.isArray(site.pages) ? site.pages.length : 0);
  const contentAvailable = site._contentEvidenceAvailable === true;
  const structureObserved = positiveInteger(pageCount) || nonEmptyArray(site.pages);
  const limitations = Array.isArray(site.limitations) ? site.limitations.slice() : [];
  const reasons = [];

  if (!REPORTABLE_SOURCE_STATUSES.has(status)) {
    reasons.push(`first-party site source is ${status}`);
  }
  if (!structureObserved) reasons.push("no inspected website pages are available");
  if (!contentAvailable) reasons.push("website content evidence is unavailable");

  const reportable = REPORTABLE_SOURCE_STATUSES.has(status) && structureObserved && contentAvailable;
  const classification = reportable
    ? (status === "PARTIAL" ? "PARTIAL_BUT_REPORTABLE" : "SUFFICIENT")
    : "INSUFFICIENT";

  return Object.freeze({
    contractVersion: "1.0.0",
    classification,
    reportable,
    core: Object.freeze({
      firstPartySite: Object.freeze({
        status,
        pageCount,
        inspectedPages,
        contentAvailable,
        structureObserved,
        required: true,
      }),
    }),
    optionalSourcesDoNotSubstitute: true,
    limitations: Object.freeze(limitations),
    reasons: Object.freeze(reasons),
  });
}

export function reportEvidenceInsufficientError(evaluation) {
  const error = new Error("We could not collect enough website evidence to complete this audit yet.");
  error.code = "REPORT_EVIDENCE_INSUFFICIENT";
  error.statusCode = 409;
  error.reportEvidenceSufficiency = evaluation;
  error.clientMessage = "This audit is incomplete because we could not collect enough website evidence. No conclusion is being made from the missing information; the website evidence needs to be retried.";
  return error;
}

export default { evaluateReportEvidenceSufficiency, reportEvidenceInsufficientError };

/**
 * PRYSM canonical solution contract.
 *
 * This module is deliberately independent of scoring, Client Truth, narrative
 * generation, and report rendering. It describes the data boundary consumed by
 * a future deterministic solution generator.
 */

export const EVIDENCE_GRADES = Object.freeze(["CONFIRMED", "PARTIAL", "UNKNOWN"]);
export const PRESCRIPTION_MODES = Object.freeze([
  "PRESCRIPTIVE",
  "CONDITIONAL",
  "INVESTIGATIVE",
  "NON_REMEDIATION",
]);
export const DISPOSITIONS = Object.freeze(["FIX_NOW", "FIX_LATER", "ACCEPT", "INVESTIGATE"]);
export const EFFORT_BANDS = Object.freeze(["SMALL", "MEDIUM", "LARGE", "UNKNOWN"]);
export const CAPABILITIES = Object.freeze([
  "COPY_CONTENT",
  "CONTENT_STRATEGY",
  "UX_DESIGN",
  "FRONT_END_DEVELOPMENT",
  "TECHNICAL_SEO",
  "CMS_CONFIGURATION",
  "HOSTING_PLATFORM_CONFIGURATION",
  "ANALYTICS_MEASUREMENT",
  "SUBJECT_MATTER_INPUT",
  "ACCESSIBILITY_REVIEW",
]);
export const CLIENT_PROMINENCE = Object.freeze(["PRIMARY", "SUPPORTING", "DIAGNOSTIC"]);
export const SITE_ANCHOR_TYPES = Object.freeze([
  "URL",
  "PAGE_TEMPLATE",
  "HEADING",
  "COPY_STRING",
  "COMPONENT",
  "CTA",
  "MISSING_ELEMENT",
  "RESPONSE_ENVIRONMENT",
  "EVIDENCE_ARTIFACT",
  "SCOPE_OBJECT",
]);
export const CROSS_PAGE_REFERENCE_TYPES = Object.freeze([
  "SUMMARY",
  "DETAIL",
  "CONTEXT",
  "DIAGNOSTIC",
]);

export const CANONICAL_SOLUTION_FIELDS = Object.freeze([
  "solutionId",
  "issueId",
  "mergedFrom",
  "findingRefs",
  "evidenceGrade",
  "prescriptionMode",
  "problem",
  "whyItMatters",
  "siteAnchor",
  "whatToChange",
  "howToFix",
  "capabilityRequired",
  "effortBand",
  "dependencies",
  "implementationCheck",
  "outcomeSignal",
  "disposition",
  "sequenceInputs",
  "evidenceRefs",
  "clientProminence",
  "crossPageReferences",
]);

export const REQUIRED_SOLUTION_FIELDS = Object.freeze([
  ...CANONICAL_SOLUTION_FIELDS.filter((field) => field !== "outcomeSignal"),
]);

export const OPTIONAL_SOLUTION_FIELDS = Object.freeze(["outcomeSignal"]);

export const SOLUTION_CONTRACT_VERSION = "1.0.0";

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isEnumValue(value, values) {
  return typeof value === "string" && values.includes(value);
}

export function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeIssueIdentity(record, context = {}) {
  const failureMode = context.failureModes?.get?.(record.issueId)
    ?? context.failureModes?.[record.issueId]
    ?? record.issueId;
  const anchor = record.siteAnchor || {};
  const location = anchor.scope || anchor.locator || "unscoped";
  return `${normalizeToken(location)}×${normalizeToken(failureMode)}`;
}

export function createSolutionRecord(input) {
  return {
    solutionId: input.solutionId,
    issueId: input.issueId,
    mergedFrom: [...(input.mergedFrom || [])],
    findingRefs: [...(input.findingRefs || [])],
    evidenceGrade: input.evidenceGrade,
    prescriptionMode: input.prescriptionMode,
    problem: input.problem,
    whyItMatters: input.whyItMatters,
    siteAnchor: input.siteAnchor,
    ...(input.whatToChange === undefined ? {} : { whatToChange: input.whatToChange }),
    ...(input.howToFix === undefined ? {} : { howToFix: input.howToFix }),
    capabilityRequired: [...(input.capabilityRequired || [])],
    effortBand: input.effortBand,
    dependencies: [...(input.dependencies || [])],
    implementationCheck: input.implementationCheck,
    ...(input.outcomeSignal === undefined ? {} : { outcomeSignal: input.outcomeSignal }),
    disposition: input.disposition,
    sequenceInputs: input.sequenceInputs,
    evidenceRefs: [...(input.evidenceRefs || [])],
    clientProminence: input.clientProminence,
    crossPageReferences: [...(input.crossPageReferences || [])],
  };
}

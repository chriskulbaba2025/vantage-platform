import {
  CAPABILITIES,
  CANONICAL_SOLUTION_FIELDS,
  CLIENT_PROMINENCE,
  CROSS_PAGE_REFERENCE_TYPES,
  DISPOSITIONS,
  EFFORT_BANDS,
  EVIDENCE_GRADES,
  PRESCRIPTION_MODES,
  SITE_ANCHOR_TYPES,
  isEnumValue,
  isNonEmptyString,
  normalizeIssueIdentity,
} from "./solution-contract.js";

const VAGUE_ANCHORS = new Set([
  "some pages",
  "the website",
  "important pages",
  "mobile pages",
  "assessed response",
]);
const JOB_TITLE_WORDS = /\b(manager|director|owner|developer|designer|writer|marketer|seo specialist|administrator|agency)\b/i;
const PROMISE_WORDS = /\b(will|guarantee|guarantees|ensures|increase|decrease|boost|reduce revenue|increase revenue|conversion uplift)\b/i;

export function makeValidationError(code, solutionId, field, message) {
  return { code, solutionId: solutionId ?? null, field: field ?? null, message };
}

function hasValue(setOrMap, value) {
  if (!setOrMap) return false;
  if (typeof setOrMap.has === "function") return setOrMap.has(value);
  if (Array.isArray(setOrMap)) return setOrMap.includes(value);
  return Object.prototype.hasOwnProperty.call(setOrMap, value);
}

function resolveReference(ref, context, kind) {
  if (typeof context.resolveReference === "function") return context.resolveReference(ref, kind) === true;
  const refId = typeof ref === "string" ? ref : ref?.refId;
  if (!isNonEmptyString(refId)) return false;
  if (kind === "evidence" && hasValue(context.evidenceRefs, refId)) return true;
  if (kind === "finding" && hasValue(context.findingIds, refId)) return true;
  if (kind === "merged" && (hasValue(context.findingIds, refId) || hasValue(context.mergedIds, refId))) return true;
  return Boolean(typeof ref === "object" && ref.persisted === true);
}

function hasScopedAnchor(anchor, record, context) {
  if (!anchor || typeof anchor !== "object") return false;
  if (!isEnumValue(anchor.type, SITE_ANCHOR_TYPES)) return false;
  if (!isNonEmptyString(anchor.locator) || !isNonEmptyString(anchor.scope)) return false;
  if (VAGUE_ANCHORS.has(normalizeText(anchor.locator)) && anchor.type !== "SCOPE_OBJECT") return false;
  if (typeof anchor.exact !== "boolean") return false;
  if (!Array.isArray(anchor.evidenceRefIds) || anchor.evidenceRefIds.length === 0) return false;
  return anchor.evidenceRefIds.every((ref) => record.evidenceRefs.some((candidate) => (candidate?.refId ?? candidate) === ref)
    && resolveReference(ref, context, "evidence"));
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isConditionalLanguage(record) {
  const combined = `${record.problem} ${record.whyItMatters} ${record.whatToChange || ""} ${record.howToFix || ""}`;
  const scope = normalizeText(record.siteAnchor?.scope);
  return combined.includes(scope) || /assessed|partial|where supported|if confirmed|subject to|condition/i.test(combined);
}

function checkImplementationCheck(check, record) {
  if (!check || typeof check !== "object") return false;
  if (!record.siteAnchor || typeof record.siteAnchor !== "object") return false;
  if (!isNonEmptyString(check.checkId) || !isNonEmptyString(check.instruction)
    || !isNonEmptyString(check.passCondition) || !isNonEmptyString(check.failCondition)
    || !isNonEmptyString(check.anchorScope)) return false;
  if (normalizeText(check.passCondition) === normalizeText(check.failCondition)) return false;
  const combined = `${check.instruction} ${check.passCondition} ${check.failCondition}`;
  if (PROMISE_WORDS.test(combined) || /business outcome|revenue|conversion rate|search visibility/i.test(combined)) return false;
  return normalizeText(check.anchorScope) === normalizeText(record.siteAnchor.scope)
    || normalizeText(check.anchorScope).includes(normalizeText(record.siteAnchor.scope));
}

function checkOutcomeSignal(signal) {
  if (signal === undefined || signal === null) return true;
  if (typeof signal !== "object") return false;
  if (!["signalId", "metric", "baseline", "measurementPath", "timeHorizon", "boundedInterpretation"]
    .every((field) => isNonEmptyString(signal[field]))) return false;
  return !PROMISE_WORDS.test(signal.boundedInterpretation);
}

function checkDisposition(record) {
  const { prescriptionMode: mode, disposition } = record;
  if (!isEnumValue(disposition, DISPOSITIONS)) return false;
  if ((mode === "PRESCRIPTIVE" || mode === "CONDITIONAL") && !["FIX_NOW", "FIX_LATER"].includes(disposition)) return false;
  if (mode === "INVESTIGATIVE" && disposition !== "INVESTIGATE") return false;
  if (mode === "NON_REMEDIATION" && !["ACCEPT", "INVESTIGATE"].includes(disposition)) return false;
  return true;
}

export function validateSolutionRecord(record, context = {}) {
  const errors = [];
  const solutionId = record?.solutionId ?? null;
  const error = (code, field, message) => errors.push(makeValidationError(code, solutionId, field, message));

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { valid: false, errors: [makeValidationError("V01", null, "solutionId", "Solution record must be an object.")] };
  }
  for (const field of CANONICAL_SOLUTION_FIELDS) {
    if (field === "outcomeSignal") continue;
    if (!(field in record) || record[field] === undefined || record[field] === null) error("V01", field, `Required field ${field} is missing.`);
  }
  if (!isNonEmptyString(record.solutionId)) error("V01", "solutionId", "solutionId must be a non-empty string.");
  if (!isNonEmptyString(record.issueId)) error("V03", "issueId", "issueId must be a non-empty string.");

  for (const [field, values, code] of [
    ["evidenceGrade", EVIDENCE_GRADES, "V08"],
    ["prescriptionMode", PRESCRIPTION_MODES, "V09"],
    ["effortBand", EFFORT_BANDS, "V16"],
  ]) if (!isEnumValue(record[field], values)) error(code, field, `${field} must be one of ${values.join(", ")}.`);

  if (!Array.isArray(record.mergedFrom) || record.mergedFrom.length === 0
    || new Set(record.mergedFrom).size !== record.mergedFrom.length
    || !record.mergedFrom.every((ref) => resolveReference(ref, context, "merged"))) {
    error("V05", "mergedFrom", "mergedFrom must contain resolvable unique source references.");
  }
  if (!Array.isArray(record.findingRefs) || record.findingRefs.length === 0
    || !record.findingRefs.every((ref) => resolveReference(ref, context, "finding"))) {
    error("V05", "findingRefs", "findingRefs must contain resolvable persisted finding references.");
  }
  if (!Array.isArray(record.evidenceRefs) || record.evidenceRefs.length === 0) {
    error("V06", "evidenceRefs", "At least one evidence reference is required.");
  } else if (!record.evidenceRefs.every((ref) => resolveReference(ref, context, "evidence"))) {
    error("V07", "evidenceRefs", "Every evidence reference must resolve to persisted evidence.");
  }

  if (!isNonEmptyString(record.problem)) error("V03", "problem", "problem must be bounded client-facing text.");
  if (!isNonEmptyString(record.whyItMatters)) error("V03", "whyItMatters", "whyItMatters is required.");

  const activeMode = ["PRESCRIPTIVE", "CONDITIONAL"].includes(record.prescriptionMode);
  if (activeMode && !hasScopedAnchor(record.siteAnchor, record, context)) {
    error("V13", "siteAnchor", "Active prescriptive or conditional guidance requires a valid site-specific anchor.");
  } else if (record.siteAnchor && !hasScopedAnchor(record.siteAnchor, record, context)) {
    error("V14", "siteAnchor", "siteAnchor is vague, malformed, or does not resolve to persisted evidence.");
  }
  if (activeMode && !isNonEmptyString(record.whatToChange)) error("V03", "whatToChange", "Active guidance requires whatToChange.");
  if (activeMode && !isNonEmptyString(record.howToFix)) error("V03", "howToFix", "Active guidance requires howToFix.");

  if (record.evidenceGrade === "CONFIRMED" && activeMode && !hasScopedAnchor(record.siteAnchor, record, context)) error("V10", "prescriptionMode", "CONFIRMED remediation cannot emit without an evidence-supported anchor.");
  if (record.evidenceGrade === "PARTIAL") {
    if (!["CONDITIONAL", "INVESTIGATIVE"].includes(record.prescriptionMode)) error("V10", "prescriptionMode", "PARTIAL evidence permits only conditional or investigative guidance.");
    if (record.prescriptionMode === "CONDITIONAL" && !isConditionalLanguage(record)) error("V11", "whatToChange", "PARTIAL guidance must preserve assessed scope and condition.");
  }
  if (record.evidenceGrade === "UNKNOWN" && !["INVESTIGATIVE", "NON_REMEDIATION"].includes(record.prescriptionMode)) error("V12", "prescriptionMode", "UNKNOWN evidence cannot emit remediation.");

  if (!Array.isArray(record.capabilityRequired) || record.capabilityRequired.length === 0
    || record.capabilityRequired.some((capability) => !isEnumValue(capability, CAPABILITIES) || JOB_TITLE_WORDS.test(capability))) {
    error("V15", "capabilityRequired", "capabilityRequired must contain only controlled capability values.");
  }
  if (record.effortBand === "UNKNOWN" && record.sequenceInputs?.effortBand && record.sequenceInputs.effortBand !== "UNKNOWN") error("V16", "effortBand", "Unknown effort cannot be contradicted by sequenceInputs.");
  if (!checkImplementationCheck(record.implementationCheck, record)) error("V18", "implementationCheck", "implementationCheck must be binary, observable, and scoped to the site anchor.");
  if (!record.implementationCheck) error("V17", "implementationCheck", "implementationCheck is mandatory.");
  if (!checkOutcomeSignal(record.outcomeSignal)) error("V20", "outcomeSignal", "Outcome signal requires a baseline, measurement path, time horizon, and bounded interpretation.");
  if (!checkDisposition(record)) error("V19", "disposition", "Invalid disposition or prescriptionMode/disposition pairing.");

  const sequence = record.sequenceInputs;
  if (!sequence || !Number.isInteger(sequence.governedRank) || sequence.governedRank < 1
    || !isNonEmptyString(sequence.rankSource)
    || !isNonEmptyString(sequence.dependencyState)
    || !isNonEmptyString(sequence.effortBand)
    || typeof sequence.eligibility !== "boolean") error("V16", "sequenceInputs", "sequenceInputs must carry governed rank, source, dependency state, effort, and eligibility.");
  if (!Array.isArray(record.dependencies)) error("V21", "dependencies", "dependencies must be an array.");
  else for (const dependency of record.dependencies) {
    if (!dependency || typeof dependency !== "object" || !isNonEmptyString(dependency.dependencyType) || !isNonEmptyString(dependency.reason)
      || (!isNonEmptyString(dependency.targetSolutionId) && !isNonEmptyString(dependency.externalCondition))) {
      error("V21", "dependencies", "Each dependency must resolve to a solution ID or external condition.");
    } else if (dependency.targetSolutionId && context.solutionIds && !hasValue(context.solutionIds, dependency.targetSolutionId)) {
      error("V21", "dependencies", `Dependency ${dependency.targetSolutionId} does not resolve.`);
    }
  }

  if (!isEnumValue(record.clientProminence?.level, CLIENT_PROMINENCE) || typeof record.clientProminence?.displayAllowed !== "boolean"
    || !isNonEmptyString(record.clientProminence?.displayReason)) error("V24", "clientProminence", "clientProminence is malformed.");
  if (record.clientProminence?.level === "DIAGNOSTIC" && record.clientProminence.displayAllowed) error("V24", "clientProminence", "DIAGNOSTIC records cannot be client-displayed.");
  if (["ACCEPT", "INVESTIGATE"].includes(record.disposition) && record.clientProminence?.displayAllowed) error("V24", "clientProminence", "Accepted/investigated records cannot display as active client fixes.");

  if (!Array.isArray(record.crossPageReferences)) error("V23", "crossPageReferences", "crossPageReferences must be an array.");
  else for (const reference of record.crossPageReferences) {
    if (!reference || !isNonEmptyString(reference.pageId) || !isEnumValue(reference.referenceType, CROSS_PAGE_REFERENCE_TYPES)
      || !isNonEmptyString(reference.label)) error("V23", "crossPageReferences", "Cross-page reference is malformed.");
    else if (context.pageIds && !hasValue(context.pageIds, reference.pageId)) error("V23", "crossPageReferences", `Page ${reference.pageId} does not resolve.`);
  }

  return { valid: errors.length === 0, errors };
}

export function validateSolutionSet(records, context = {}) {
  const errors = [];
  if (!Array.isArray(records)) return { valid: false, errors: [makeValidationError("V01", null, "records", "Solution set must be an array.")] };
  const solutionIds = new Set();
  const identities = new Set();
  const setContext = { ...context, solutionIds: context.solutionIds || new Set(records.map((record) => record?.solutionId).filter(Boolean)) };
  for (const record of records) {
    if (record?.solutionId && solutionIds.has(record.solutionId)) errors.push(makeValidationError("V02", record.solutionId, "solutionId", "solutionId is duplicated."));
    if (record?.solutionId) solutionIds.add(record.solutionId);
    const result = validateSolutionRecord(record, setContext);
    errors.push(...result.errors);
    if (record?.issueId && record?.siteAnchor) {
      const identity = normalizeIssueIdentity(record, setContext);
      if (identities.has(identity)) errors.push(makeValidationError("V04", record.solutionId, "issueId", `Duplicate normalized issue identity: ${identity}.`));
      identities.add(identity);
    }
  }
  return { valid: errors.length === 0, errors };
}

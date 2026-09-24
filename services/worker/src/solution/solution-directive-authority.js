import {
  CAPABILITIES,
  DISPOSITIONS,
  EFFORT_BANDS,
  EVIDENCE_GRADES,
  PRESCRIPTION_MODES,
  SITE_ANCHOR_TYPES,
  CROSS_PAGE_REFERENCE_TYPES,
} from "./solution-contract.js";

const ACTIVE_MODES = new Set(["PRESCRIPTIVE", "CONDITIONAL"]);
const VALID_DEPENDENCY_KEYS = new Set(["targetIssueId", "externalCondition"]);
const EXPLICIT_REFERENCE_KEYS = new Set([
  "artifactRef",
  "rawArtifactRef",
  "persistedEvidenceId",
  "evidenceRefId",
  "refId",
]);
const OUTCOME_WORDS = /\b(revenue|conversion rate|conversion uplift|traffic|ranking|guarantee|guarantees|will increase|will decrease|will boost)\b/i;

export class SolutionDirectiveAuthorityError extends Error {
  constructor(errors) {
    super("Solution directive authority resolution failed closed.");
    this.name = "SolutionDirectiveAuthorityError";
    this.errors = errors;
  }
}

function authorityError(code, findingId, field, message) {
  return { stage: "authority", code, findingId: findingId ?? null, field: field ?? null, message };
}

function fail(code, findingId, field, message) {
  throw new SolutionDirectiveAuthorityError([authorityError(code, findingId, field, message)]);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function own(record, field) {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function refIdOf(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof value.refId === "string") return value.refId.trim();
  return "";
}

function refKey(value) {
  return refIdOf(value);
}

function normalizeRegistry(pageRegistry) {
  if (pageRegistry instanceof Set) return new Set([...pageRegistry].map(String));
  if (Array.isArray(pageRegistry)) return new Set(pageRegistry.map(String));
  if (pageRegistry && typeof pageRegistry === "object") return new Set(Object.keys(pageRegistry));
  fail("AUTH-PAGE", null, "pageRegistry", "pageRegistry must be an explicit Set, array, or keyed object.");
}

function normalizeAuthorityRecords(authorityRecords) {
  if (authorityRecords instanceof Map) {
    return new Map([...authorityRecords.entries()].map(([key, value]) => [String(key), value]));
  }
  if (!authorityRecords || typeof authorityRecords !== "object" || Array.isArray(authorityRecords)) {
    fail("AUTH-INPUT", null, "authorityRecords", "authorityRecords must be an object keyed by findingId or a Map.");
  }
  const entries = Object.entries(authorityRecords);
  const result = new Map();
  for (const [findingId, authority] of entries) {
    if (Array.isArray(authority)) {
      fail("AUTH-DUPLICATE", findingId, "authorityRecords", "Duplicate authority records are not allowed.");
    }
    if (result.has(findingId)) fail("AUTH-DUPLICATE", findingId, "authorityRecords", "Duplicate authority key.");
    result.set(findingId, authority);
  }
  return result;
}

function collectExplicitRefs(value, refs, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => collectExplicitRefs(item, refs, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (EXPLICIT_REFERENCE_KEYS.has(key)) {
      const id = refIdOf(child);
      if (id) refs.add(id);
    }
    collectExplicitRefs(child, refs, seen);
  }
}

function buildEvidenceIndex(findings, decisionEvidence) {
  const refs = new Set();
  for (const finding of findings) collectExplicitRefs(finding?.evidence, refs);
  collectExplicitRefs(decisionEvidence, refs);
  return refs;
}

function assertStringField(authority, findingId, field) {
  if (!own(authority, field) || !nonEmpty(authority[field])) {
    fail("AUTH-MISSING", findingId, field, `${field} must be explicitly supplied as non-empty text.`);
  }
}

function assertReferenceList(authority, findingId, field, known, kind) {
  if (!Array.isArray(authority[field]) || authority[field].length === 0) {
    fail(kind === "evidence" ? "AUTH-EVIDENCE-REF" : "AUTH-FINDING-REF", findingId, field, `${field} must be a non-empty explicit reference list.`);
  }
  const ids = authority[field].map(refKey);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    fail(kind === "evidence" ? "AUTH-EVIDENCE-REF" : "AUTH-FINDING-REF", findingId, field, `${field} contains an invalid or duplicate reference.`);
  }
  for (const id of ids) {
    if (!known.has(id)) fail(kind === "evidence" ? "AUTH-EVIDENCE-REF" : "AUTH-FINDING-REF", findingId, field, `Reference ${id} does not resolve.`);
  }
}

function assertSiteAnchor(authority, findingId, evidenceIds) {
  const anchor = authority.siteAnchor;
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
    fail("AUTH-ANCHOR", findingId, "siteAnchor", "siteAnchor must be explicitly supplied.");
  }
  if (!SITE_ANCHOR_TYPES.includes(anchor.type) || !nonEmpty(anchor.locator) || !nonEmpty(anchor.scope) || typeof anchor.exact !== "boolean") {
    fail("AUTH-ANCHOR", findingId, "siteAnchor", "siteAnchor requires an allowed type, locator, scope, and boolean exact value.");
  }
  if (!Array.isArray(anchor.evidenceRefIds) || anchor.evidenceRefIds.length === 0) {
    fail("AUTH-ANCHOR", findingId, "siteAnchor.evidenceRefIds", "Anchor evidence references must be explicit and non-empty.");
  }
  const anchorIds = anchor.evidenceRefIds.map(refKey);
  if (anchorIds.some((id) => !id) || anchorIds.some((id) => !evidenceIds.has(id))) {
    fail("AUTH-ANCHOR", findingId, "siteAnchor.evidenceRefIds", "Every anchor evidence reference must resolve and belong to solution evidenceRefs.");
  }
}

function assertEvidencePolicy(authority, findingId) {
  if (!EVIDENCE_GRADES.includes(authority.evidenceGrade)) fail("AUTH-EVIDENCE-GRADE", findingId, "evidenceGrade", "evidenceGrade must be explicit and governed.");
  if (!PRESCRIPTION_MODES.includes(authority.prescriptionMode)) fail("AUTH-PRESCRIPTION", findingId, "prescriptionMode", "prescriptionMode must be explicit and governed.");
  if (authority.evidenceGrade === "PARTIAL" && !["CONDITIONAL", "INVESTIGATIVE"].includes(authority.prescriptionMode)) {
    fail("AUTH-PRESCRIPTION", findingId, "prescriptionMode", "PARTIAL evidence permits only CONDITIONAL or INVESTIGATIVE guidance.");
  }
  if (authority.evidenceGrade === "UNKNOWN" && !["INVESTIGATIVE", "NON_REMEDIATION"].includes(authority.prescriptionMode)) {
    fail("AUTH-PRESCRIPTION", findingId, "prescriptionMode", "UNKNOWN evidence cannot emit active remediation.");
  }
}

function assertCapabilities(authority, findingId) {
  if (!Array.isArray(authority.capabilityRequired) || authority.capabilityRequired.length === 0
    || authority.capabilityRequired.some((value) => !CAPABILITIES.includes(value))) {
    fail("AUTH-CAPABILITY", findingId, "capabilityRequired", "capabilityRequired must explicitly contain controlled capability values.");
  }
}

function assertEffort(authority, findingId) {
  if (!EFFORT_BANDS.includes(authority.effortBand)) {
    fail("AUTH-EFFORT", findingId, "effortBand", "effortBand must explicitly use the canonical effort taxonomy, including UNKNOWN when necessary.");
  }
}

function assertImplementationCheck(authority, findingId) {
  const check = authority.implementationCheck;
  if (!check || typeof check !== "object" || Array.isArray(check)) fail("AUTH-IMPLEMENTATION-CHECK", findingId, "implementationCheck", "implementationCheck must be explicit.");
  for (const field of ["checkId", "instruction", "passCondition", "failCondition", "anchorScope"]) {
    if (!nonEmpty(check[field])) fail("AUTH-IMPLEMENTATION-CHECK", findingId, `implementationCheck.${field}`, `${field} must be explicit and non-empty.`);
  }
  if (check.passCondition.trim() === check.failCondition.trim()) fail("AUTH-IMPLEMENTATION-CHECK", findingId, "implementationCheck", "passCondition and failCondition must differ.");
  if (check.anchorScope.trim() !== authority.siteAnchor.scope.trim()) fail("AUTH-IMPLEMENTATION-CHECK", findingId, "implementationCheck.anchorScope", "anchorScope must equal the explicit siteAnchor scope.");
  if (OUTCOME_WORDS.test(`${check.instruction} ${check.passCondition} ${check.failCondition}`)) fail("AUTH-IMPLEMENTATION-CHECK", findingId, "implementationCheck", "Implementation checks may not assert business outcomes.");
}

function assertDisposition(authority, findingId) {
  if (!DISPOSITIONS.includes(authority.disposition)) fail("AUTH-DISPOSITION", findingId, "disposition", "disposition must be explicitly governed.");
  if (ACTIVE_MODES.has(authority.prescriptionMode) && !["FIX_NOW", "FIX_LATER"].includes(authority.disposition)) {
    fail("AUTH-DISPOSITION", findingId, "disposition", "Active prescription requires FIX_NOW or FIX_LATER.");
  }
  if (authority.prescriptionMode === "INVESTIGATIVE" && authority.disposition !== "INVESTIGATE") {
    fail("AUTH-DISPOSITION", findingId, "disposition", "INVESTIGATIVE guidance requires INVESTIGATE.");
  }
  if (authority.prescriptionMode === "NON_REMEDIATION" && !["ACCEPT", "INVESTIGATE"].includes(authority.disposition)) {
    fail("AUTH-DISPOSITION", findingId, "disposition", "NON_REMEDIATION requires ACCEPT or INVESTIGATE.");
  }
}

function assertDependencies(authority, findingId, hierarchyIds) {
  if (!Array.isArray(authority.dependencies)) fail("AUTH-DEPENDENCY", findingId, "dependencies", "dependencies must be explicitly supplied as an array.");
  for (const dependency of authority.dependencies) {
    if (!dependency || typeof dependency !== "object") fail("AUTH-DEPENDENCY", findingId, "dependencies", "Every dependency must be an object.");
    const keys = [...VALID_DEPENDENCY_KEYS].filter((key) => nonEmpty(dependency[key]));
    if (keys.length !== 1 || !nonEmpty(dependency.dependencyType) || !nonEmpty(dependency.reason)) {
      fail("AUTH-DEPENDENCY", findingId, "dependencies", "Each dependency requires exactly one explicit targetIssueId or externalCondition, type, and reason.");
    }
    if (dependency.targetIssueId && !hierarchyIds.has(dependency.targetIssueId)) {
      fail("AUTH-DEPENDENCY", findingId, "dependencies", `Dependency target ${dependency.targetIssueId} does not resolve to the governed hierarchy.`);
    }
  }
}

function assertProminence(authority, findingId) {
  const prominence = authority.clientProminence;
  if (!prominence || !["PRIMARY", "SUPPORTING", "DIAGNOSTIC"].includes(prominence.level)
    || typeof prominence.displayAllowed !== "boolean" || !nonEmpty(prominence.displayReason)) {
    fail("AUTH-MISSING", findingId, "clientProminence", "clientProminence must be explicit with level, displayAllowed, and reason.");
  }
  if (prominence.level === "DIAGNOSTIC" && prominence.displayAllowed) fail("AUTH-DISPOSITION", findingId, "clientProminence", "DIAGNOSTIC prominence cannot be displayed.");
}

function assertCrossPageReferences(authority, findingId, pageIds) {
  if (!Array.isArray(authority.crossPageReferences)) fail("AUTH-PAGE", findingId, "crossPageReferences", "crossPageReferences must be explicitly supplied as an array.");
  for (const reference of authority.crossPageReferences) {
    if (!reference || !nonEmpty(reference.pageId) || !pageIds.has(reference.pageId)
      || !CROSS_PAGE_REFERENCE_TYPES.includes(reference.referenceType) || !nonEmpty(reference.label)) {
      fail("AUTH-PAGE", findingId, "crossPageReferences", "Every cross-page reference must resolve to a registered page and type.");
    }
  }
}

function assertAuthorityRecord(authority, findingId, findingIds, pageIds, evidenceIndex, hierarchyIds) {
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) fail("AUTH-MISSING", findingId, "authorityRecords", "An explicit authority record is required.");
  if (own(authority, "findingId") && authority.findingId !== findingId) fail("AUTH-DUPLICATE", findingId, "findingId", "Authority findingId does not match its keyed finding.");
  if (!own(authority, "failureMode") || !nonEmpty(authority.failureMode)) fail("AUTH-MISSING", findingId, "failureMode", "failureMode must be explicitly supplied for deterministic issue identity.");
  assertReferenceList(authority, findingId, "findingRefs", findingIds, "finding");
  assertReferenceList(authority, findingId, "evidenceRefs", evidenceIndex, "evidence");
  assertEvidencePolicy(authority, findingId);
  for (const field of ["problem", "whyItMatters", "whatToChange", "howToFix"]) assertStringField(authority, findingId, field);
  assertSiteAnchor(authority, findingId, new Set(authority.evidenceRefs.map(refKey)));
  assertCapabilities(authority, findingId);
  assertEffort(authority, findingId);
  assertDependencies(authority, findingId, hierarchyIds);
  assertImplementationCheck(authority, findingId);
  assertDisposition(authority, findingId);
  assertProminence(authority, findingId);
  assertCrossPageReferences(authority, findingId, pageIds);
  if (own(authority, "outcomeSignal") && authority.outcomeSignal !== undefined && authority.outcomeSignal !== null) {
    if (!authority.outcomeSignal || typeof authority.outcomeSignal !== "object") fail("AUTH-MISSING", findingId, "outcomeSignal", "outcomeSignal must be an explicit complete object when supplied.");
    for (const field of ["signalId", "metric", "baseline", "measurementPath", "timeHorizon", "boundedInterpretation"]) {
      if (!nonEmpty(authority.outcomeSignal[field])) fail("AUTH-MISSING", findingId, `outcomeSignal.${field}`, `${field} must be explicitly supplied as non-empty text.`);
    }
  }
}

function hierarchyOf(scoreSet, findingIds) {
  const hierarchy = scoreSet?.decisionHierarchy;
  if (!hierarchy || !Array.isArray(hierarchy.orderedFindingIds) || !Array.isArray(hierarchy.actions) || !nonEmpty(hierarchy.provenance)) {
    fail("AUTH-HIERARCHY", null, "scoreSet.decisionHierarchy", "A complete governed decision hierarchy is required.");
  }
  const ordered = hierarchy.orderedFindingIds;
  const actionIds = hierarchy.actions.map((action) => action?.findingId);
  if (actionIds.length !== ordered.length || actionIds.some((id, index) => id !== ordered[index])) fail("AUTH-HIERARCHY", null, "decisionHierarchy", "Hierarchy action IDs must exactly match orderedFindingIds.");
  const ranks = new Map();
  for (const action of hierarchy.actions) {
    if (!findingIds.has(action?.findingId) || !Number.isInteger(action.rank) || action.rank < 1 || ranks.has(action.findingId)) fail("AUTH-HIERARCHY", action?.findingId, "decisionHierarchy.actions", "Every hierarchy action must resolve to a unique positive governed rank.");
    ranks.set(action.findingId, action.rank);
  }
  return { hierarchy, ordered, ranks };
}

export function buildSolutionDirectiveInput({ findings, scoreSet, decisionEvidence, authorityRecords, pageRegistry }) {
  if (!Array.isArray(findings) || findings.length === 0) fail("AUTH-INPUT", null, "findings", "findings must be a non-empty array.");
  if (!scoreSet || typeof scoreSet !== "object" || Array.isArray(scoreSet)) fail("AUTH-INPUT", null, "scoreSet", "scoreSet is required.");
  if (!decisionEvidence || typeof decisionEvidence !== "object" || Array.isArray(decisionEvidence)) fail("AUTH-INPUT", null, "decisionEvidence", "decisionEvidence is required.");
  const findingIds = new Set();
  for (const finding of findings) {
    if (!finding || !nonEmpty(finding.findingId) || findingIds.has(finding.findingId)) fail("AUTH-HIERARCHY", finding?.findingId, "findings", "findings require unique non-empty findingId values.");
    findingIds.add(finding.findingId);
  }
  const { hierarchy, ordered, ranks } = hierarchyOf(scoreSet, findingIds);
  const hierarchyIds = new Set(ordered);
  const actionableOutside = findings.filter((finding) => finding.actionable !== false && !hierarchyIds.has(finding.findingId));
  if (actionableOutside.length) fail("AUTH-HIERARCHY", actionableOutside[0].findingId, "decisionHierarchy", "An actionable finding is absent from the governed hierarchy.");
  const authorityMap = normalizeAuthorityRecords(authorityRecords);
  for (const key of authorityMap.keys()) {
    if (!findingIds.has(key) || !hierarchyIds.has(key)) fail("AUTH-HIERARCHY", key, "authorityRecords", "Authority may not introduce a finding outside the governed hierarchy.");
  }
  const pageIds = normalizeRegistry(pageRegistry);
  const evidenceIndex = buildEvidenceIndex(findings, decisionEvidence);
  for (const findingId of ordered) {
    if (!findingIds.has(findingId)) fail("AUTH-HIERARCHY", findingId, "findings", "A governed hierarchy entry has no finding.");
    if (!authorityMap.has(findingId)) fail("AUTH-MISSING", findingId, "authorityRecords", "Every governed finding requires exactly one explicit authority record.");
    assertAuthorityRecord(authorityMap.get(findingId), findingId, findingIds, pageIds, evidenceIndex, hierarchyIds);
  }
  const directives = {};
  for (const findingId of ordered) directives[findingId] = clone(authorityMap.get(findingId));
  const context = {
    evidenceRefs: evidenceIndex,
    findingIds: new Set(findingIds),
    mergedIds: new Set(findingIds),
    pageIds: new Set(pageIds),
  };
  return {
    findings: clone(findings),
    decisionHierarchy: clone(hierarchy),
    solutionDirectives: directives,
    validationContext: context,
  };
}

export default { buildSolutionDirectiveInput, SolutionDirectiveAuthorityError };

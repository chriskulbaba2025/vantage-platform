import { FRICTION_STATES, RELATIONSHIP_TYPES } from "./registry.js";

const UNKNOWN_STATES = new Set([FRICTION_STATES.NOT_ENOUGH_EVIDENCE]);
const NON_MATERIAL_STATES = new Set([FRICTION_STATES.CLEAR, FRICTION_STATES.NOT_ENOUGH_EVIDENCE]);

function urls(projection) {
  return new Set((projection?.scope?.urls || []).map((url) => String(url).replace(/\/$/, "")));
}

function overlap(left, right) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function deviceCompatible(left, right) {
  const a = new Set(left?.deviceContext || ["unspecified"]);
  const b = new Set(right?.deviceContext || ["unspecified"]);
  return a.has("unspecified") || b.has("unspecified") || overlap(a, b);
}

function scopeCompatible(left, right) {
  const a = left?.scope || {};
  const b = right?.scope || {};
  if (a.template && b.template && a.template === b.template) return true;
  if (overlap(urls(left), urls(right))) return true;
  if (left?.conversionAction && left.conversionAction === right?.conversionAction) return true;
  if (left?.buyerDecisionQuestion && left.buyerDecisionQuestion === right?.buyerDecisionQuestion) return true;
  return false;
}

function boundary(left, right) {
  const sharedUrls = overlap(urls(left), urls(right));
  const sharedTemplate = Boolean(left?.scope?.template && left.scope.template === right?.scope?.template);
  const sharedAction = Boolean(left?.conversionAction && left.conversionAction === right?.conversionAction);
  const sharedQuestion = Boolean(left?.buyerDecisionQuestion && left.buyerDecisionQuestion === right?.buyerDecisionQuestion);
  const dependency = (left?.dependsOnFindingIds || []).includes(right?.findingId)
    || (right?.dependsOnFindingIds || []).includes(left?.findingId)
    || (left?.dependsOnCanonicalProblemIds || []).includes(right?.canonicalProblemId)
    || (right?.dependsOnCanonicalProblemIds || []).includes(left?.canonicalProblemId);
  return { sharedUrls, sharedTemplate, sharedAction, sharedQuestion, dependency };
}

function duplicate(left, right) {
  const leftLineage = new Set(left?.evidenceLineage?.keys || []);
  const rightLineage = new Set(right?.evidenceLineage?.keys || []);
  return overlap(leftLineage, rightLineage) || left?.duplicateFingerprint && left.duplicateFingerprint === right?.duplicateFingerprint;
}

function relationshipFor(left, right, shared) {
  if (duplicate(left, right)) return "Duplicate symptom";
  if (shared.dependency) return "Depends on";
  if (left?.canonicalProblemId && left.canonicalProblemId === right?.canonicalProblemId && (shared.sharedTemplate || shared.sharedUrls || shared.sharedAction)) return "Repeats";
  if (left?.mechanismFamily && left.mechanismFamily === right?.mechanismFamily) return "May share a cause";
  if (shared.sharedAction || shared.sharedQuestion) return "Same journey point";
  if (left?.frictionState === FRICTION_STATES.FRICTION && right?.frictionState === FRICTION_STATES.FRICTION) return "Compounds";
  return null;
}

export function relationshipCandidate(left, right) {
  if (!left || !right || left.findingId === right.findingId) return { eligible: false, reason: "same-or-missing-finding" };
  if (!left.primary || !right.primary) return { eligible: false, reason: "only-primary-projections-may-relate" };
  if (!deviceCompatible(left, right)) return { eligible: false, reason: "device-boundary-mismatch" };
  if (!scopeCompatible(left, right)) return { eligible: false, reason: "no-meaningful-shared-boundary" };
  const shared = boundary(left, right);
  const type = relationshipFor(left, right, shared);
  if (!type || !RELATIONSHIP_TYPES.includes(type)) return { eligible: false, reason: "no-governed-relationship" };
  if (type !== "Duplicate symptom" && (UNKNOWN_STATES.has(left.frictionState) || UNKNOWN_STATES.has(right.frictionState))) {
    return { eligible: false, reason: "unknown-evidence-cannot-strengthen-relationship" };
  }
  return {
    eligible: true,
    type,
    findingIds: [left.findingId, right.findingId],
    canonicalProblemIds: [left.canonicalProblemId, right.canonicalProblemId].filter(Boolean),
    boundary: shared,
    independentEvidenceFamilies: new Set([...(left.evidenceIndependence?.keys || []), ...(right.evidenceIndependence?.keys || [])]).size,
    hypothesisOnly: type === "May share a cause",
  };
}

export function buildRelationshipCandidates(projections) {
  if (!Array.isArray(projections)) throw new Error("Projections must be an array.");
  const candidates = [];
  for (let i = 0; i < projections.length; i += 1) {
    for (let j = i + 1; j < projections.length; j += 1) {
      const candidate = relationshipCandidate(projections[i], projections[j]);
      if (candidate.eligible) candidates.push(Object.freeze(candidate));
    }
  }
  return Object.freeze(candidates);
}

export function validateRelationship(candidate) {
  const errors = [];
  if (!candidate?.eligible) errors.push("Relationship must be eligible.");
  if (!RELATIONSHIP_TYPES.includes(candidate?.type)) errors.push("Relationship type is not governed.");
  if (!Array.isArray(candidate?.findingIds) || candidate.findingIds.length !== 2) errors.push("Relationship must connect exactly two findings.");
  if (candidate?.type === "May share a cause" && candidate.hypothesisOnly !== true) errors.push("Shared-cause relationship must remain a hypothesis.");
  if (candidate?.type === "Depends on" && !candidate.boundary?.dependency) errors.push("Dependency must have an explicit dependency boundary.");
  return { valid: errors.length === 0, errors };
}

export default { relationshipCandidate, buildRelationshipCandidates, validateRelationship };

import { CANONICAL_PROBLEM_BY_ID, FRICTION_STATES } from "./registry.js";
import { buildRelationshipCandidates } from "./relationships.js";

export const PRIORITY_UNIT_TYPES = Object.freeze({ BLOCKER: "confirmed critical blocker", CLUSTER: "accepted friction cluster", STANDALONE: "reviewed standalone material finding" });
const DOMAIN_ORDER = Object.freeze({ blocker: 0, direct: 1, trust: 2, usability: 3, acquisition: 4, technical: 5, other: 6 });

function problemOf(unit) {
  return unit?.canonicalProblemId ? CANONICAL_PROBLEM_BY_ID[unit.canonicalProblemId] : null;
}

function stateOf(unit) {
  return unit?.frictionState || FRICTION_STATES.NOT_ENOUGH_EVIDENCE;
}

function evidenceCurrent(unit) {
  const status = unit?.freshness?.status;
  return !["STALE", "HISTORICAL", "UNKNOWN"].includes(String(status || "UNKNOWN").toUpperCase())
    && (unit?.evidence?.some((record) => ["AVAILABLE", "PARTIAL"].includes(record.sourceStatus)) ?? false);
}

function currentBlocker(unit) {
  return Boolean(problemOf(unit)?.criticalBlockerEligibility)
    && stateOf(unit) === FRICTION_STATES.FRICTION
    && evidenceCurrent(unit)
    && (unit.currentlyReproducible === true || unit.freshness?.status === "CURRENT");
}

function meaningfulScope(unit) {
  return Boolean(unit?.scope?.urls?.length || unit?.scope?.template || unit?.conversionAction || unit?.buyerDecisionQuestion);
}

function mechanismSafe(unit) {
  return unit?.remedySpecificity !== "mechanism-specific" || unit?.mechanismEvidenceStatus === "verified";
}

function outcomeSafe(unit) {
  return unit?.businessOutcomeEvidenceStatus !== "verified" || unit?.businessOutcomeEvidenceStatus === "verified";
}

function measurementOnly(unit) {
  return problemOf(unit)?.primaryClassification === "Evidence/measurement limitation";
}

function explanation(unit, type) {
  const target = unit?.clusterName || problemOf(unit)?.name || unit?.title || "the reviewed condition";
  const scope = unit?.scope?.template ? `the ${unit.scope.template} template` : unit?.scope?.urls?.length ? "the assessed page scope" : "the recorded scope";
  return `We prioritized ${target} because the evidence places it at ${scope} and it affects the governed decision or action.`;
}

export function challengePriorityUnit(unit, { allUnits = [], relationships = [] } = {}) {
  const errors = [];
  const problem = problemOf(unit);
  if (!problem) errors.push("canonical-problem-required");
  if (stateOf(unit) === FRICTION_STATES.NOT_ENOUGH_EVIDENCE) errors.push("insufficient-evidence-cannot-prioritize");
  if (stateOf(unit) === FRICTION_STATES.CLEAR) errors.push("clear-condition-cannot-be-friction-priority");
  if ((!Array.isArray(unit?.evidence) || unit.evidence.length === 0) && [FRICTION_STATES.CLEAR, FRICTION_STATES.FRICTION].includes(stateOf(unit))) errors.push("missing-evidence-cannot-create-clear-or-friction");
  if (unit?.opportunity === true) errors.push("opportunity-cannot-be-friction");
  if (unit?.competitorOnly === true) errors.push("competitor-context-cannot-create-client-defect");
  if (unit?.historicalOnly === true || unit?.freshness?.status === "HISTORICAL") errors.push("historical-evidence-cannot-create-current-blocker");
  if (measurementOnly(unit) && unit?.frictionState === FRICTION_STATES.FRICTION) errors.push("measurement-limitation-cannot-masquerade-as-friction");
  if (!meaningfulScope(unit)) errors.push("material-scope-required");
  if (!mechanismSafe(unit)) errors.push("mechanism-specific-remedy-needs-mechanism-evidence");
  if (unit?.legalConclusion === true && ["E07", "H03", "H04", "H05"].includes(unit.canonicalProblemId)) errors.push("observable-condition-is-not-automatic-legal-conclusion");
  if (unit?.businessOutcomeClaim === true && unit?.businessOutcomeEvidenceStatus !== "verified") errors.push("technical-condition-does-not-prove-business-outcome");
  if (unit?.repairRisk === "high" && unit?.confidence === "directional") errors.push("high-risk-repair-needs-stronger-evidence");
  if (unit?.thirdPartyOwnership && unit?.clientDirectControl === true) errors.push("third-party-ownership-must-remain-explicit");
  if (unit?.coverage === "partial" && unit?.siteWideClaim === true) errors.push("partial-coverage-cannot-create-site-wide-claim");
  if (unit?.deviceContext?.length === 1 && unit.deviceContext[0] === "mobile" && unit.desktopClaim === true) errors.push("mobile-evidence-cannot-generalize-to-desktop");
  if (unit?.duplicateOfFindingId) errors.push("duplicate-symptom-cannot-strengthen-priority");
  if (unit?.sameSourceSignalCount > 1 && unit?.independentEvidenceFamilies <= 1) errors.push("same-source-signal-is-not-independent-corroboration");
  if (unit?.watchCountOnly === true) errors.push("watch-count-cannot-become-friction");
  if (unit?.journeyStageOnly === true) errors.push("journey-stage-only-cannot-create-relationship");
  if (unit?.provenCause === true && unit?.mechanismEvidenceStatus !== "verified") errors.push("likely-cause-cannot-be-presented-as-verified");
  if (unit?.findingCountOnly === true) errors.push("finding-count-cannot-determine-priority");
  if (unit?.clearEvidenceOmitted === true) errors.push("clear-evidence-must-remain-visible-when-material");
  if (unit?.excludeWithoutPartner === true) errors.push("material-standalone-finding-must-not-be-excluded-for-lack-of-partner");
  if (unit?.utilityPage === true && unit?.primaryConversionPage === false) errors.push("utility-page-cannot-displace-primary-conversion-path");
  if (unit?.contradictoryEvidence === true && unit?.conflictResolution === "ignored") errors.push("contradictory-evidence-cannot-be-ignored");
  if (unit?.oneObservedConditionMultipleLabels === true) errors.push("one-observed-condition-requires-one-primary-problem");
  if (unit?.outcomeVerificationClaim === true && unit?.outcomeEvidenceAvailable !== true) errors.push("condition-verification-is-not-outcome-verification");
  if (unit?.rebuildRecommendation === true) errors.push("encyclopedia-cannot-authorize-rebuild");
  if (unit?.individualInsufficientCreatesL01 === true) errors.push("individual-insufficiency-is-not-audit-level-L01");
  if (unit?.complianceOverreach === true) errors.push("compliance-overreach");
  if (unit?.cluster) {
    const distinct = new Set(unit.cluster.map((item) => item.canonicalProblemId).filter(Boolean));
    if (distinct.size < 2) errors.push("cluster-needs-two-distinct-canonical-problems");
    if (unit.cluster.some((item) => stateOf(item) === FRICTION_STATES.NOT_ENOUGH_EVIDENCE)) errors.push("unknown-member-cannot-strengthen-cluster");
    if (unit.cluster.some((item) => item.conflictingEvidence?.present)) errors.push("cluster-must-address-conflicting-evidence");
    if (unit.cluster.some((item) => item.duplicateOfFindingId)) errors.push("cluster-must-remove-duplicates");
    const clusterFamilies = new Set(unit.cluster.flatMap((item) => item.evidenceIndependence?.keys || []));
    if (clusterFamilies.size <= 1) errors.push("cluster-needs-independent-evidence-or-explicit-compounding");
  }
  return { valid: errors.length === 0, errors };
}

function unitFromProjection(projection, type = PRIORITY_UNIT_TYPES.STANDALONE) {
  const unit = { ...projection, type, cluster: null };
  return { ...unit, priorityExplanation: explanation(unit, type) };
}

export function buildPriorityUnits(projections, { relationships = buildRelationshipCandidates(projections), context = {} } = {}) {
  if (!Array.isArray(projections)) throw new Error("Projections are required.");
  const primary = projections.filter((projection) => projection.primary);
  const byId = new Map(primary.map((projection) => [projection.findingId, projection]));
  const blockers = primary.filter((projection) => currentBlocker({ ...projection, ...context }));
  const clusters = [];
  const used = new Set();
  for (const relationship of relationships) {
    if (!relationship.eligible || ["Duplicate symptom", "Repeats", "Depends on"].includes(relationship.type)) continue;
    const members = relationship.findingIds.map((id) => byId.get(id)).filter(Boolean);
    const candidate = { clusterName: "Accepted friction cluster", cluster: members, canonicalProblemId: members[0]?.canonicalProblemId, frictionState: FRICTION_STATES.FRICTION, scope: members[0]?.scope, evidence: members.flatMap((member) => member.evidence), evidenceIndependence: { independentFamilyCount: new Set(members.flatMap((member) => member.evidenceIndependence?.keys || [])).size, keys: [...new Set(members.flatMap((member) => member.evidenceIndependence?.keys || []))] }, confidence: "supported", repairRisk: "medium" };
    const challenged = challengePriorityUnit(candidate, { relationships });
    if (challenged.valid) {
      const memberIds = members.map((member) => member.findingId);
      clusters.push({ ...candidate, type: PRIORITY_UNIT_TYPES.CLUSTER, findingIds: memberIds, canonicalProblemIds: [...new Set(members.map((member) => member.canonicalProblemId))], priorityExplanation: explanation(candidate, PRIORITY_UNIT_TYPES.CLUSTER) });
      memberIds.forEach((id) => used.add(id));
    }
  }
  const standalone = primary.filter((projection) => !used.has(projection.findingId) && projection.frictionState === FRICTION_STATES.FRICTION && challengePriorityUnit(projection).valid).map((projection) => unitFromProjection(projection));
  const blockerUnits = blockers.map((projection) => unitFromProjection({ ...projection, currentlyReproducible: true, freshness: { ...(projection.freshness || {}), status: "CURRENT" } }, PRIORITY_UNIT_TYPES.BLOCKER));
  const units = [...blockerUnits, ...clusters, ...standalone].sort((a, b) => {
    if (a.type !== b.type) return a.type === PRIORITY_UNIT_TYPES.BLOCKER ? -1 : b.type === PRIORITY_UNIT_TYPES.BLOCKER ? 1 : 0;
    const aRank = DOMAIN_ORDER[problemOf(a)?.primaryClassification === "Direct conversion friction" ? "direct" : problemOf(a)?.primaryClassification === "Conversion influence" && ["Trust"].includes(problemOf(a)?.primaryJourneyStage) ? "trust" : "other"];
    const bRank = DOMAIN_ORDER[problemOf(b)?.primaryClassification === "Direct conversion friction" ? "direct" : problemOf(b)?.primaryClassification === "Conversion influence" && ["Trust"].includes(problemOf(b)?.primaryJourneyStage) ? "trust" : "other"];
    return aRank - bRank;
  });
  return Object.freeze(units.slice(0, 5));
}

export function validatePriorityUnits(units) {
  const errors = [];
  if (!Array.isArray(units)) errors.push("Priority units must be an array.");
  if ((units || []).length > 5) errors.push("Client report may show no more than five major priority units.");
  const ids = new Set();
  for (const unit of units || []) {
    if (!Object.values(PRIORITY_UNIT_TYPES).includes(unit.type)) errors.push("Priority unit type is not governed.");
    for (const id of unit.findingIds || []) { if (ids.has(id)) errors.push(`Finding appears in multiple priority units: ${id}`); ids.add(id); }
    const challenge = unit.type === PRIORITY_UNIT_TYPES.CLUSTER ? challengePriorityUnit(unit) : challengePriorityUnit(unit);
    if (!challenge.valid) errors.push(...challenge.errors.map((error) => `${unit.type}:${error}`));
    if (typeof unit.priorityExplanation !== "string" || !unit.priorityExplanation.trim()) errors.push("Priority explanation is required.");
  }
  return { valid: errors.length === 0, errors };
}

export default { PRIORITY_UNIT_TYPES, challengePriorityUnit, buildPriorityUnits, validatePriorityUnits };

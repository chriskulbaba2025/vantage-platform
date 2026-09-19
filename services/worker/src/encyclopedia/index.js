import { projectFindings } from "./projection.js";
import { buildRelationshipCandidates } from "./relationships.js";
import { buildPriorityUnits, validatePriorityUnits } from "./prioritization.js";

export const ENCYCLOPEDIA_PROJECTION_VERSION = "1.0.0";

export function buildEncyclopediaProjection(findings, { historical = false, persisted = null } = {}) {
  if (historical || persisted?.status === "NOT_AVAILABLE") {
    return Object.freeze({ projectionVersion: ENCYCLOPEDIA_PROJECTION_VERSION, status: "NOT_AVAILABLE", reason: "Historical audit has no encyclopedia projection.", projections: [], relationships: [], priorityUnits: [] });
  }
  if (!Array.isArray(findings)) throw new Error("Findings are required to build the encyclopedia projection.");
  if (persisted?.status === "AVAILABLE") return Object.freeze(persisted);
  const projections = projectFindings(findings);
  const relationships = buildRelationshipCandidates(projections);
  const priorityUnits = buildPriorityUnits(projections, { relationships });
  const priorityValidation = validatePriorityUnits(priorityUnits);
  if (!priorityValidation.valid) throw new Error(`Encyclopedia priority units failed validation: ${priorityValidation.errors.join(" ")}`);
  return Object.freeze({
    projectionVersion: ENCYCLOPEDIA_PROJECTION_VERSION,
    status: "AVAILABLE",
    projections,
    relationships,
    priorityUnits,
    limitations: projections.some((projection) => projection.historicalCompatibility === "NO_ENCYCLOPEDIA_PROJECTION")
      ? ["Some historical findings have no encyclopedia mapping and remain available only in Supporting Detail."]
      : [],
  });
}

export function validateEncyclopediaProjection(value) {
  const errors = [];
  if (!value || typeof value !== "object") errors.push("Encyclopedia projection must be an object.");
  if (!(["AVAILABLE", "NOT_AVAILABLE"].includes(value?.status))) errors.push("Encyclopedia projection status is invalid.");
  if (!Array.isArray(value?.priorityUnits)) errors.push("Encyclopedia priorityUnits must be an array.");
  if ((value?.priorityUnits || []).length > 5) errors.push("Encyclopedia priorityUnits cannot exceed five.");
  return { valid: errors.length === 0, errors };
}

export default { ENCYCLOPEDIA_PROJECTION_VERSION, buildEncyclopediaProjection, validateEncyclopediaProjection };

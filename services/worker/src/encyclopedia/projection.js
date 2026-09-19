import { CANONICAL_PROBLEM_BY_ID, FRICTION_STATES } from "./registry.js";

/**
 * Explicit, reviewable bridge from current deterministic rule IDs to the
 * frozen canonical problem taxonomy. Unknown rules remain unprojected.
 */
export const RULE_TO_CANONICAL = Object.freeze({
  "VAN-TECH-001": "A03",
  "VAN-GSC-001": "A03",
  "VAN-GSC-002": "A01",
  "VAN-GSC-003": "D01",
  "VAN-PATH-001": "F02",
  "VAN-TRUST-001": "E01",
  "VAN-TRUST-002": "D03",
  "VAN-CONTENT-001": "D06",
  "VAN-CONTENT-002": "D01",
  "VAN-TECH-002": "J03",
  "VAN-TECH-003": "E07",
  "VAN-TECH-004": "H04",
  "VAN-TECH-005": "H06",
  "VAN-SCHEMA-001": "J04",
  "VAN-PERF-001": "I01",
});

const VALID_SOURCE_STATUSES = new Set(["AVAILABLE", "PARTIAL", "UNAVAILABLE", "UNKNOWN", "FAILED", "BLOCKED", "NOT_CONNECTED", "NOT_COLLECTED", "NOT_APPLICABLE"]);
const VALID_CONFIDENCE = new Set(["deterministic", "strongly_supported", "supported", "directional", "insufficient"]);

function nonEmpty(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function evidenceStatus(record) {
  const status = String(record?.sourceStatus || "UNKNOWN").toUpperCase();
  return VALID_SOURCE_STATUSES.has(status) ? status : "UNKNOWN";
}

function evidenceLineage(record, finding) {
  return nonEmpty(record?.lineageKey, nonEmpty(record?.artifactRef, `${record?.provider || record?.source || "unknown"}:${record?.field || "unknown"}`));
}

function evidenceIndependence(record, finding) {
  return nonEmpty(record?.independenceKey, evidenceLineage(record, finding));
}

function scopeFor(finding, evidence) {
  const explicit = finding?.scope;
  if (explicit && typeof explicit === "object") return { ...explicit };
  const urls = Array.isArray(finding?.affectedUrls) ? finding.affectedUrls.filter(Boolean) : [];
  return {
    level: urls.length > 1 ? "page" : "page",
    urls,
    template: finding?.template || null,
    pageRole: finding?.pageRole || null,
  };
}

function deviceFor(finding, evidence) {
  const values = [...(Array.isArray(evidence) ? evidence : []), finding]
    .map((item) => item?.device || item?.deviceContext)
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return [...new Set(values)].length ? [...new Set(values)] : ["unspecified"];
}

function freshnessFor(finding, evidence) {
  const values = [...(Array.isArray(evidence) ? evidence : []), finding]
    .map((item) => item?.collectedAt || item?.observedAt || item?.freshness)
    .filter(Boolean);
  return { status: finding?.freshnessStatus || "UNKNOWN", observedAt: values[0] || null, values };
}

function conflictFor(finding, evidence) {
  const statuses = evidence.map(evidenceStatus);
  return {
    present: finding?.conflictingEvidence === true || new Set(statuses).has("AVAILABLE") && new Set(statuses).has("FAILED"),
    notes: Array.isArray(finding?.conflictNotes) ? [...finding.conflictNotes] : [],
  };
}

function deriveState(finding, evidence, conflict) {
  if (!evidence.length || evidence.every((record) => ["UNKNOWN", "UNAVAILABLE", "FAILED", "BLOCKED", "NOT_COLLECTED"].includes(evidenceStatus(record)))) return FRICTION_STATES.NOT_ENOUGH_EVIDENCE;
  if (conflict.present || evidence.some((record) => evidenceStatus(record) === "PARTIAL") || finding.confidence === "directional" || finding.confidence === "insufficient") return FRICTION_STATES.WATCH;
  if (finding.scoreBearing === true && ["deterministic", "strongly_supported"].includes(finding.confidence) && ["High", "Medium"].includes(finding.severity)) return FRICTION_STATES.FRICTION;
  return FRICTION_STATES.CLEAR;
}

function normalizeEvidence(finding) {
  return (Array.isArray(finding?.evidence) ? finding.evidence : []).map((record) => ({
    field: nonEmpty(record?.field, "unknown"),
    observedValue: record?.observedValue,
    expectedValue: record?.expectedValue,
    source: nonEmpty(record?.source, nonEmpty(record?.provider, "unknown")),
    provider: record?.provider || record?.source || null,
    sourceStatus: evidenceStatus(record),
    artifactRef: record?.artifactRef || null,
    lineageKey: evidenceLineage(record, finding),
    independenceKey: evidenceIndependence(record, finding),
    collectedAt: record?.collectedAt || record?.observedAt || null,
    device: record?.device || record?.deviceContext || null,
  }));
}

export function projectFinding(finding, { ruleMap = RULE_TO_CANONICAL } = {}) {
  if (!finding || typeof finding !== "object") throw new Error("Finding is required for encyclopedia projection.");
  const canonicalProblemId = ruleMap[finding.ruleId] || null;
  const evidence = normalizeEvidence(finding);
  const conflict = conflictFor(finding, evidence);
  const lineageKeys = [...new Set(evidence.map((record) => record.lineageKey))];
  const independenceKeys = [...new Set(evidence.map((record) => record.independenceKey))];
  const confidence = VALID_CONFIDENCE.has(finding.confidence) ? finding.confidence : "insufficient";
  const projected = {
    projectionVersion: "1.0.0",
    findingId: nonEmpty(finding.findingId, `unidentified:${finding.ruleId || "finding"}`),
    sourceRuleId: nonEmpty(finding.ruleId, "unknown"),
    canonicalProblemId,
    primary: canonicalProblemId !== null,
    title: nonEmpty(finding.title, "Observed condition"),
    evidence,
    evidenceLineage: { keys: lineageKeys, primaryKey: lineageKeys[0] || null },
    evidenceIndependence: { keys: independenceKeys, independentFamilyCount: independenceKeys.length },
    scope: scopeFor(finding, evidence),
    deviceContext: deviceFor(finding, evidence),
    freshness: freshnessFor(finding, evidence),
    conflictingEvidence: conflict,
    confidence,
    scoreBearing: finding.scoreBearing === true,
    severity: finding.severity || "Low",
    thirdPartyOwnership: finding.thirdPartyOwnership || null,
    repairRisk: finding.repairRisk || null,
    mechanismEvidenceStatus: finding.mechanismEvidenceStatus || "unknown",
    businessOutcomeEvidenceStatus: finding.businessOutcomeEvidenceStatus || "not available",
    disposition: finding.disposition || (canonicalProblemId ? "Investigate" : "Collect evidence"),
    frictionState: canonicalProblemId ? deriveState({ ...finding, confidence }, evidence, conflict) : FRICTION_STATES.NOT_ENOUGH_EVIDENCE,
    positivePatternsToPreserve: Array.isArray(finding.positivePatternsToPreserve) ? [...finding.positivePatternsToPreserve] : [],
    historicalCompatibility: canonicalProblemId === null ? "NO_ENCYCLOPEDIA_PROJECTION" : "PROJECTED",
  };
  if (canonicalProblemId && !CANONICAL_PROBLEM_BY_ID[canonicalProblemId]) throw new Error(`Unknown canonical problem: ${canonicalProblemId}`);
  return Object.freeze(projected);
}

export function projectFindings(findings, options = {}) {
  if (!Array.isArray(findings)) throw new Error("Findings must be an array.");
  const projections = findings.map((finding) => projectFinding(finding, options));
  const assigned = projections.filter((projection) => projection.primary);
  const primaryByCondition = new Map();
  for (const projection of assigned) {
    const conditionKey = `${projection.evidenceLineage.primaryKey || projection.findingId}|${projection.scope.level}|${projection.deviceContext.join(",")}`;
    if (primaryByCondition.has(conditionKey)) {
      const prior = primaryByCondition.get(conditionKey);
      const duplicate = Object.freeze({
        ...projection,
        duplicateOfFindingId: prior.findingId,
        primary: false,
        frictionState: FRICTION_STATES.WATCH,
        historicalCompatibility: "DUPLICATE_PRIMARY_SUPPRESSED",
      });
      projections[projections.indexOf(projection)] = duplicate;
    } else {
      primaryByCondition.set(conditionKey, projection);
    }
  }
  return Object.freeze(projections);
}

export function validateProjection(projection) {
  const errors = [];
  if (!projection || typeof projection !== "object") errors.push("Projection must be an object.");
  if (!projection?.findingId) errors.push("Projection findingId is required.");
  if (projection?.primary && !projection.canonicalProblemId) errors.push("Primary projection must have one canonical problem.");
  if (projection?.canonicalProblemId && !CANONICAL_PROBLEM_BY_ID[projection.canonicalProblemId]) errors.push("Projection canonical problem is not in the frozen registry.");
  if (!Array.isArray(projection?.evidenceLineage?.keys)) errors.push("Evidence lineage keys are required.");
  if (!Array.isArray(projection?.evidenceIndependence?.keys)) errors.push("Evidence independence keys are required.");
  if (!Object.values(FRICTION_STATES).includes(projection?.frictionState)) errors.push("Projection friction state is not governed.");
  return { valid: errors.length === 0, errors };
}

export default { RULE_TO_CANONICAL, projectFinding, projectFindings, validateProjection };

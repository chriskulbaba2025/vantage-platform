import { CANONICAL_PROBLEM_BY_ID } from "../encyclopedia/registry.js";

const EVIDENCE_SOURCES = Object.freeze([
  { key: "site", label: "Website", status: (model) => model?.evidence?.site?.sourceStatus ?? model?.sourceStatus?.site, coverage: (model) => model?.evidence?.site?.coverage },
  { key: "browser", label: "Browser path", status: (model) => model?.recoveredAuditData?.conversionValidation?.status },
  { key: "performance", label: "Performance", status: (model) => model?.evidence?.performance?.sourceStatus ?? model?.sourceStatus?.performance, coverage: (model) => model?.evidence?.performance?.coverage },
  { key: "competitors", label: "Competitors", status: (model) => model?.evidence?.competitors?.sourceStatus ?? model?.sourceStatus?.competitors },
  { key: "ga4", label: "Analytics", status: (model) => model?.evidence?.ga4?.sourceStatus ?? model?.evidence?.ga4?.status ?? model?.sourceStatus?.ga4 },
  { key: "gsc", label: "Search data", status: (model) => model?.evidence?.gsc?.sourceStatus ?? model?.evidence?.gsc?.status ?? model?.sourceStatus?.gsc },
  { key: "backlinks", label: "Backlink data", status: (model) => model?.evidence?.backlinks?.sourceStatus ?? model?.evidence?.backlinks?.status ?? model?.sourceStatus?.backlinks },
]);

const STATUS_LABELS = Object.freeze({
  AVAILABLE: "Reviewed",
  PARTIAL: "Partly reviewed",
  UNAVAILABLE: "Not available",
  NOT_COLLECTED: "Not collected",
  NOT_CONNECTED: "Not connected",
  NOT_APPLICABLE: "Not applicable",
  FAILED: "Could not be reviewed",
  BLOCKED: "Could not be reviewed",
  UNKNOWN: "Not recorded",
});

const JOURNEY_STAGES = Object.freeze(["Awareness", "Consideration", "Decision", "Action"]);
const CANONICAL_STAGE_MAP = Object.freeze({
  Acquire: "Awareness",
  Understand: "Consideration",
  Trust: "Consideration",
  Decide: "Decision",
  Act: "Action",
  Complete: "Action",
});

const JOURNEY_STATE_LABELS = Object.freeze({
  FRICTION: "Needs attention",
  WATCH: "Worth checking",
  CLEAR: "No material issue found",
});

const RAW_CLIENT_ERROR = /\b(?:HTTP\s*)?[45]\d\d\b|\b(?:TypeError|ReferenceError|SyntaxError|ECONN[A-Z]+)\b|\bError:\s|\bexception\b|\bstack trace\b|runId\s+is\s+required|screenshot persistence failed|CrUX\s+(?:PHONE|DESKTOP)\s+failed|\b(?:VAN-[A-Z0-9-]+|[A-Z]\d{2})\b/i;

export function clientEvidenceStatus(status) {
  const value = String(status ?? "UNKNOWN").trim().toUpperCase();
  return STATUS_LABELS[value] || "Not recorded";
}

function directCoverageText(coverage, key) {
  const requested = coverage?.requested;
  const completed = coverage?.completed;
  if (!Number.isInteger(requested) || requested < 1 || !Number.isInteger(completed) || completed < 0 || completed > requested) return "";
  return `${completed} of ${requested} ${key === "site" ? "pages" : "checks"}`;
}

export function projectEvidenceCoverage(model) {
  return EVIDENCE_SOURCES.flatMap((source) => {
    const status = source.status(model);
    if (typeof status !== "string" || !status.trim()) return [];
    const coverage = source.coverage?.(model);
    const coverageText = directCoverageText(coverage, source.key);
    return [{
      key: source.key,
      label: source.label,
      status: clientEvidenceStatus(status),
      ...(coverageText ? { coverage: coverageText } : {}),
    }];
  });
}

export function projectEvidenceConfidence(model) {
  const band = String(model?.bands?.evidenceConfidence ?? "").trim().toUpperCase();
  if (band === "HIGH") return "High";
  if (band === "MODERATE") return "Moderate";
  if (band === "LIMITED" || band === "DIRECTIONAL") return "Limited";
  return "Not established";
}

export function projectDimensionRows(pillars) {
  return (Array.isArray(pillars) ? pillars : []).map((pillar) => {
    const score = pillar?.score;
    const assessed = Number.isFinite(score) && score >= 0 && score <= 100;
    return {
      id: String(pillar?.id || "unknown"),
      label: String(pillar?.label || "Dimension"),
      score: assessed ? score : null,
      state: assessed ? dimensionState(score) : "Not assessed",
      evidence: (Array.isArray(pillar?.capabilities) ? pillar.capabilities : []).map((item) => ({
        label: String(item?.key || item?.label || "Evidence"),
        status: clientEvidenceStatus(item?.status),
      })),
    };
  });
}

function dimensionState(score) {
  if (score >= 80) return "Strong";
  if (score >= 60) return "Adequate";
  if (score >= 40) return "Needs attention";
  return "Low score";
}

function journeyStageForUnit(unit) {
  if (!unit || !(unit.conversionAction || unit.buyerDecisionQuestion)) return null;
  if (!Array.isArray(unit.evidence) || unit.evidence.length === 0) return null;
  const ids = Array.isArray(unit.canonicalProblemIds) && unit.canonicalProblemIds.length
    ? unit.canonicalProblemIds
    : [unit.canonicalProblemId];
  if (ids.some((id) => typeof id !== "string" || !id)) return null;
  const mapped = ids.map((id) => {
    const problem = CANONICAL_PROBLEM_BY_ID[id];
    const stage = CANONICAL_STAGE_MAP[problem?.primaryJourneyStage] || null;
    const classification = problem?.primaryClassification;
    const journeyRelated = ["Direct conversion friction", "Conversion influence"].includes(classification) ||
      (stage === "Awareness" && classification === "Acquisition issue");
    return journeyRelated ? stage : null;
  });
  if (mapped.some((stage) => !stage) || new Set(mapped).size !== 1) return null;
  return mapped[0];
}

export function projectJourneyStages(acceptedUnits) {
  const stages = new Map(JOURNEY_STAGES.map((stage) => [stage, {
    stage,
    status: "Not established",
    context: "No accepted, evidence-linked relationship established this stage.",
  }]));

  for (const unit of Array.isArray(acceptedUnits) ? acceptedUnits : []) {
    const stage = journeyStageForUnit(unit);
    const state = JOURNEY_STATE_LABELS[String(unit?.frictionState || "").toUpperCase()];
    if (!stage || !state || stages.get(stage).status !== "Not established") continue;
    const ids = Array.isArray(unit.canonicalProblemIds) && unit.canonicalProblemIds.length
      ? unit.canonicalProblemIds
      : [unit.canonicalProblemId];
    const names = ids.map((id) => CANONICAL_PROBLEM_BY_ID[id]?.name).filter(Boolean);
    stages.set(stage, {
      stage,
      status: state,
      context: names.length ? names.join("; ") : "An accepted finding is linked to this stage.",
    });
  }

  return JOURNEY_STAGES.map((stage) => stages.get(stage));
}

function platformIsKnown(platform) {
  const value = String(platform ?? "").trim().toLowerCase();
  return Boolean(value) && !["unknown", "not known", "not detected", "not available", "not assessed", "n/a"].includes(value);
}

export function projectImplementationContext(record, platform) {
  if (!platformIsKnown(platform)) {
    return {
      label: "Needs checking",
      detail: "We need to confirm what the site allows before choosing the final fix.",
    };
  }

  const capabilities = new Set(Array.isArray(record?.capabilityRequired) ? record.capabilityRequired : []);
  const helpers = [];
  if (capabilities.has("CMS_CONFIGURATION")) helpers.push("site admin or CMS access");
  if (capabilities.has("FRONT_END_DEVELOPMENT")) helpers.push("a web developer");
  if (capabilities.has("HOSTING_PLATFORM_CONFIGURATION")) helpers.push("hosting or platform support");

  if (!helpers.length) {
    return {
      label: "Needs checking",
      detail: "The available notes do not show what access or help this fix needs.",
    };
  }

  const helperText = helpers.length === 1
    ? helpers[0]
    : `${helpers.slice(0, -1).join(", ")} and ${helpers.at(-1)}`;
  const dependencyNote = Array.isArray(record?.dependencies) && record.dependencies.length
    ? " A prerequisite is also recorded; confirm it before work begins."
    : "";
  return {
    label: `Likely needs ${helperText}`,
    detail: `This is based on the recorded implementation notes for the detected ${String(platform).trim()} platform.${dependencyNote}`,
  };
}

export function clientSafeCopy(value, fallback = "Technical details for this check are not shown in this client report.") {
  const text = String(value ?? "").trim();
  if (!text || RAW_CLIENT_ERROR.test(text)) return fallback;
  return text;
}

export const CLIENT_JOURNEY_STAGES = JOURNEY_STAGES;

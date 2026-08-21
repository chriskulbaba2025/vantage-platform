// PRYSM Narrative v2 — lossless deterministic normalization at model boundaries.
//
// This module never creates evidence or prose. It only canonicalizes structural
// metadata that is already implied by array order or the governed contracts,
// and removes repeated identical evidence references while preserving order.

import {
  RUBRIC,
  WRITER_SECTION_FIELDS,
  deriveJudgeDecision,
  JUDGE_DECISION,
} from "./judge-contract.js";

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function dedupe(values) {
  return Array.isArray(values) ? [...new Set(values)] : values;
}

function normalizeEvidenceRefs(value) {
  if (Array.isArray(value)) {
    value.forEach(normalizeEvidenceRefs);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value.evidenceRefs)) value.evidenceRefs = dedupe(value.evidenceRefs);
  Object.values(value).forEach(normalizeEvidenceRefs);
}

function pad2(index) {
  return String(index + 1).padStart(2, "0");
}

export function normalizeWriterModelOutput(output) {
  const normalized = clone(output);
  normalizeEvidenceRefs(normalized);

  if (Array.isArray(normalized.strengths)) {
    normalized.strengths.forEach((item, index) => { if (item && typeof item === "object") item.itemId = `STR-${pad2(index)}`; });
  }

  const funnelPrefixes = { awareness: "A", consideration: "C", decision: "D" };
  for (const [stage, prefix] of Object.entries(funnelPrefixes)) {
    const items = normalized?.funnelOpportunities?.[stage];
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => { if (item && typeof item === "object") item.itemId = `FUN-${prefix}-${pad2(index)}`; });
  }

  if (Array.isArray(normalized.limitations)) {
    normalized.limitations.forEach((item, index) => { if (item && typeof item === "object") item.itemId = `LIM-${pad2(index)}`; });
  }

  if (Array.isArray(normalized.actionPlan)) {
    normalized.actionPlan.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      item.actionId = `ACT-${pad2(index)}`;
      item.priority = index + 1;
    });
  }

  return normalized;
}

function canonicalizeJudgeIds(normalized) {
  const defectIdMap = new Map();
  if (Array.isArray(normalized.defects)) {
    normalized.defects.forEach((defect, index) => {
      if (!defect || typeof defect !== "object") return;
      const previous = defect.defectId;
      const next = `D-${pad2(index)}`;
      if (typeof previous === "string" && previous) defectIdMap.set(previous, next);
      defect.defectId = next;
      defect.evidenceRefs = dedupe(defect.evidenceRefs);
      defect.allowedFields = dedupe(defect.allowedFields);
      defect.mustPreserve = dedupe(defect.mustPreserve);
    });
  }

  if (normalized.rubric && typeof normalized.rubric === "object") {
    for (const [key, maxScore] of Object.entries(RUBRIC)) {
      const record = normalized.rubric[key];
      if (!record || typeof record !== "object") continue;
      record.maxScore = maxScore;
      record.evidenceRefs = dedupe(record.evidenceRefs);
      record.defectIds = dedupe(record.defectIds)
        .map((id) => defectIdMap.get(id))
        .filter(Boolean);
    }
  }

  if (Array.isArray(normalized?.hardGate?.violations)) {
    normalized.hardGate.violations.forEach((violation, index) => {
      if (!violation || typeof violation !== "object") return;
      violation.violationId = `HG-${pad2(index)}`;
      violation.automaticFail = true;
      violation.evidenceRefs = dedupe(violation.evidenceRefs);
    });
    normalized.hardGate.status = normalized.hardGate.violations.length ? "FAIL" : "PASS";
  }

  return defectIdMap;
}

function deterministicJudgeTotals(normalized) {
  if (!normalized.rubric || typeof normalized.rubric !== "object") return;
  let total = 0;
  for (const key of Object.keys(RUBRIC)) {
    const score = normalized.rubric?.[key]?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) return;
    total += score;
  }
  normalized.totalScore = total;
  normalized.decision = deriveJudgeDecision(normalized);
}

function deterministicRevisionDirective(normalized) {
  const decision = normalized.decision;
  const defects = Array.isArray(normalized.defects) ? normalized.defects : [];
  const defectIds = defects.map((defect) => defect?.defectId).filter(Boolean);
  const allowed = new Set();
  for (const defect of defects) {
    for (const field of defect?.allowedFields || []) allowed.add(field);
  }
  const fieldsToRewrite = WRITER_SECTION_FIELDS.filter((field) => allowed.has(field));
  const fieldsLocked = WRITER_SECTION_FIELDS.filter((field) => !allowed.has(field));

  if (decision === JUDGE_DECISION.REVISE) {
    normalized.revisionDirective = {
      required: true,
      mode: "TARGETED",
      fieldsToRewrite,
      fieldsLocked,
      defectIds,
    };
    return;
  }
  if (decision === JUDGE_DECISION.PASS) {
    normalized.revisionDirective = {
      required: false,
      mode: "NONE",
      fieldsToRewrite: [],
      fieldsLocked: [...WRITER_SECTION_FIELDS],
      defectIds: [],
    };
    return;
  }
  normalized.revisionDirective = {
    required: false,
    mode: "HUMAN_REVIEW",
    fieldsToRewrite: [],
    fieldsLocked: [...WRITER_SECTION_FIELDS],
    defectIds,
  };
}

export function normalizeJudgeModelOutput(output) {
  const normalized = clone(output);
  normalizeEvidenceRefs(normalized);
  canonicalizeJudgeIds(normalized);
  deterministicJudgeTotals(normalized);
  deterministicRevisionDirective(normalized);
  return normalized;
}

export default { normalizeWriterModelOutput, normalizeJudgeModelOutput };

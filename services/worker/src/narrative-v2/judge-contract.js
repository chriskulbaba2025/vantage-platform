/**
 * PRYSM Narrative v2 — deterministic Judge contract and three-pass release gate.
 *
 * The Judge may score and identify defects. It may not rewrite narrative text,
 * create evidence, change scores, or change source status. All evidence
 * references must resolve against WriterInput.referenceIndex.
 */

export const JUDGE_CONTRACT_VERSION = "1.1.0";
export const JUDGE_PROMPT_VERSION = "2.1.0";
export const MAX_NARRATIVE_PASSES = 3;
export const NARRATIVE_PASS_SCORE = 92;
export const MIN_DIMENSION_RATIO = 0.70;

export const JUDGE_DECISION = Object.freeze({
  PASS: "PASS",
  REVISE: "REVISE",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
});

export const NEXT_ACTION = Object.freeze({
  RELEASE_CANDIDATE: "RELEASE_CANDIDATE",
  WRITE_NEXT_PASS: "WRITE_NEXT_PASS",
  HUMAN_REVIEW: "HUMAN_REVIEW",
});

export const RUBRIC = Object.freeze({
  evidenceFidelity: 20,
  businessRelevance: 10,
  executiveClarity: 10,
  rootCauseCoherence: 10,
  actionability: 10,
  conversionInterpretation: 8,
  contentFunnelDepth: 8,
  eeatTrust: 6,
  seoTechnical: 6,
  competitiveUsefulness: 4,
  strengthsBalance: 4,
  nonRepetition: 4,
});

export const RUBRIC_TOTAL = Object.values(RUBRIC).reduce((sum, value) => sum + value, 0);
if (RUBRIC_TOTAL !== 100) throw new Error(`Judge rubric must total 100, got ${RUBRIC_TOTAL}`);

export const HARD_GATE_CODES = Object.freeze([
  "UNSUPPORTED_FACT",
  "INVENTED_METRIC",
  "INVENTED_URL",
  "SCORE_MUTATION",
  "SOURCE_STATUS_MUTATION",
  "UNAVAILABLE_AS_ABSENT",
  "CONTRADICTS_FINDING",
  "CONVERSION_HIERARCHY_CONTRADICTION",
  "UNSUPPORTED_COMPETITOR_CLAIM",
  "OBSERVATION_WITHOUT_EVIDENCE",
  "UNAUTHORIZED_EVIDENCE",
  "MISSING_REQUIRED_SECTION",
]);

export const WRITER_SECTION_FIELDS = Object.freeze([
  "executiveConclusion",
  "strengths",
  "rootCause",
  "conversion",
  "content",
  "funnelOpportunities.awareness",
  "funnelOpportunities.consideration",
  "funnelOpportunities.decision",
  "seoSerp",
  "aiSearch",
  "eeatTrust",
  "technical",
  "performanceUx",
  "competitors",
  "limitations",
  "actionPlan",
  "executiveDecision",
]);

const WRITER_SECTION_SET = new Set(WRITER_SECTION_FIELDS);
const HARD_GATE_SET = new Set(HARD_GATE_CODES);
const RUBRIC_KEYS = Object.keys(RUBRIC);
const RUBRIC_KEY_SET = new Set(RUBRIC_KEYS);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function arraySet(values) {
  return new Set(Array.isArray(values) ? values : []);
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function validateReferenceIds(refs, writerInput, label, errors) {
  if (!Array.isArray(refs)) {
    errors.push(`${label} must be an array`);
    return;
  }
  const index = writerInput?.referenceIndex;
  if (!isObject(index)) {
    errors.push("writerInput.referenceIndex is required");
    return;
  }
  for (const ref of refs) {
    if (!nonEmptyString(ref) || !Object.hasOwn(index, ref)) {
      errors.push(`${label} contains unknown Writer reference: ${String(ref)}`);
    }
  }
}

function validateHardGate(hardGate, writerInput, errors) {
  if (!isObject(hardGate)) {
    errors.push("hardGate is required");
    return;
  }
  if (!["PASS", "FAIL"].includes(hardGate.status)) errors.push("hardGate.status must be PASS or FAIL");
  if (!Array.isArray(hardGate.violations)) {
    errors.push("hardGate.violations must be an array");
    return;
  }

  const ids = new Set();
  for (const [index, violation] of hardGate.violations.entries()) {
    const prefix = `hardGate.violations[${index}]`;
    if (!isObject(violation)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!nonEmptyString(violation.violationId)) errors.push(`${prefix}.violationId is required`);
    else if (ids.has(violation.violationId)) errors.push(`Duplicate violationId: ${violation.violationId}`);
    else ids.add(violation.violationId);
    if (!HARD_GATE_SET.has(violation.code)) errors.push(`${prefix}.code is not governed: ${String(violation.code)}`);
    if (!nonEmptyString(violation.section)) errors.push(`${prefix}.section is required`);
    if (!nonEmptyString(violation.explanation)) errors.push(`${prefix}.explanation is required`);
    if (violation.automaticFail !== true) errors.push(`${prefix}.automaticFail must be true`);
    validateReferenceIds(violation.evidenceRefs, writerInput, `${prefix}.evidenceRefs`, errors);
  }

  if (hardGate.violations.length === 0 && hardGate.status !== "PASS") {
    errors.push("hardGate.status must be PASS when violations is empty");
  }
  if (hardGate.violations.length > 0 && hardGate.status !== "FAIL") {
    errors.push("hardGate.status must be FAIL when any violation exists");
  }
}

function validateRubric(rubric, writerInput, errors) {
  if (!isObject(rubric)) {
    errors.push("rubric is required");
    return null;
  }

  const provided = Object.keys(rubric);
  for (const key of RUBRIC_KEYS) {
    if (!Object.hasOwn(rubric, key)) errors.push(`rubric.${key} is required`);
  }
  for (const key of provided) {
    if (!RUBRIC_KEY_SET.has(key)) errors.push(`Unknown rubric criterion: ${key}`);
  }

  let total = 0;
  for (const key of RUBRIC_KEYS) {
    const record = rubric[key];
    if (!isObject(record)) continue;
    const max = RUBRIC[key];
    if (record.maxScore !== max) errors.push(`rubric.${key}.maxScore must equal ${max}`);
    if (typeof record.score !== "number" || !Number.isFinite(record.score) || record.score < 0 || record.score > max) {
      errors.push(`rubric.${key}.score must be between 0 and ${max}`);
    } else {
      total += record.score;
    }
    if (!nonEmptyString(record.rationale)) errors.push(`rubric.${key}.rationale is required`);
    if (!Array.isArray(record.defectIds)) errors.push(`rubric.${key}.defectIds must be an array`);
        validateReferenceIds(
      record.evidenceRefs,
      writerInput,
      `rubric.${key}.evidenceRefs`,
      errors,
    );
  }

  /*
   * CF-01:
   * When the Writer received the governed Conversion-First decision view,
   * the Judge must explicitly ground conversionInterpretation in that same
   * view. This adds a consistency requirement without weakening any
   * evidence-fidelity, score, dimension-floor, or release gate.
   */
  const hasConversionHierarchy =
    Object.hasOwn(
      writerInput?.deterministicAnalysis || {},
      "conversionInfluence",
    );

  if (hasConversionHierarchy) {
    const hierarchyRef =
      "analysis:conversionInfluence";

    const conversionRefs =
      rubric?.conversionInterpretation
        ?.evidenceRefs;

    if (
      !Array.isArray(conversionRefs) ||
      !conversionRefs.includes(
        hierarchyRef,
      )
    ) {
      errors.push(
        "rubric.conversionInterpretation.evidenceRefs must include analysis:conversionInfluence when governed conversion hierarchy is present",
      );
    }
  }

  return total;
}

function validateDefects(defects, writerInput, errors) {
  if (!Array.isArray(defects)) {
    errors.push("defects must be an array");
    return { ids: new Set(), allowedFields: new Set(), hasMajor: false };
  }

  const ids = new Set();
  const allowedFields = new Set();
  let hasMajor = false;

  for (const [index, defect] of defects.entries()) {
    const prefix = `defects[${index}]`;
    if (!isObject(defect)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!nonEmptyString(defect.defectId)) errors.push(`${prefix}.defectId is required`);
    else if (ids.has(defect.defectId)) errors.push(`Duplicate defectId: ${defect.defectId}`);
    else ids.add(defect.defectId);
    if (!RUBRIC_KEY_SET.has(defect.criterion)) errors.push(`${prefix}.criterion is not governed: ${String(defect.criterion)}`);
    if (!nonEmptyString(defect.section)) errors.push(`${prefix}.section is required`);
    if (!['MAJOR', 'MINOR'].includes(defect.severity)) errors.push(`${prefix}.severity must be MAJOR or MINOR`);
    if (defect.severity === "MAJOR") hasMajor = true;
    for (const field of ["problem", "whyItMatters", "requiredCorrection"]) {
      if (!nonEmptyString(defect[field])) errors.push(`${prefix}.${field} is required`);
    }
    validateReferenceIds(defect.evidenceRefs, writerInput, `${prefix}.evidenceRefs`, errors);
        if (!Array.isArray(defect.allowedFields) || defect.allowedFields.length === 0) {
      errors.push(`${prefix}.allowedFields must contain at least one governed Writer field`);
    } else {
      const defectAllowedFields = new Set();

      for (const field of defect.allowedFields) {
        if (!WRITER_SECTION_SET.has(field)) {
          errors.push(`${prefix}.allowedFields contains unknown Writer field: ${String(field)}`);
        } else {
          defectAllowedFields.add(field);
          allowedFields.add(field);
        }
      }

      if (nonEmptyString(defect.section)) {
        if (!WRITER_SECTION_SET.has(defect.section)) {
          errors.push(`${prefix}.section must be a governed Writer field`);
        } else if (!defectAllowedFields.has(defect.section)) {
          errors.push(
            `${prefix}.allowedFields must include defect section ${defect.section}`,
          );
        }
      }
    }
    if (!Array.isArray(defect.mustPreserve)) errors.push(`${prefix}.mustPreserve must be an array`);
    else {
      for (const field of defect.mustPreserve) {
        if (!WRITER_SECTION_SET.has(field)) errors.push(`${prefix}.mustPreserve contains unknown Writer field: ${String(field)}`);
      }
    }
  }

  return { ids, allowedFields, hasMajor };
}

export function deriveJudgeDecision(response) {
  const passNumber = response?.passNumber;
  const hardFail = response?.hardGate?.status === "FAIL" || (response?.hardGate?.violations?.length || 0) > 0;
  const totalScore = response?.totalScore;
  const evidenceScore = response?.rubric?.evidenceFidelity?.score;
  const hasMajor = Array.isArray(response?.defects) && response.defects.some((defect) => defect?.severity === "MAJOR");

  let dimensionFloorFailed = false;
  for (const [key, max] of Object.entries(RUBRIC)) {
    const score = response?.rubric?.[key]?.score;
    if (typeof score !== "number" || score / max < MIN_DIMENSION_RATIO) dimensionFloorFailed = true;
  }

  const passes = !hardFail
    && typeof totalScore === "number"
    && totalScore >= NARRATIVE_PASS_SCORE
    && evidenceScore === RUBRIC.evidenceFidelity
    && !dimensionFloorFailed
    && !hasMajor;

  if (passes) return JUDGE_DECISION.PASS;
  if (passNumber >= MAX_NARRATIVE_PASSES) return JUDGE_DECISION.HUMAN_REVIEW_REQUIRED;
  return JUDGE_DECISION.REVISE;
}

function validateRevisionDirective(response, defectSummary, errors) {
  const directive = response.revisionDirective;
  if (!isObject(directive)) {
    errors.push("revisionDirective is required");
    return;
  }

  for (const field of ["fieldsToRewrite", "fieldsLocked", "defectIds"]) {
    if (!Array.isArray(directive[field])) errors.push(`revisionDirective.${field} must be an array`);
  }
  if (!Array.isArray(directive.fieldsToRewrite) || !Array.isArray(directive.fieldsLocked) || !Array.isArray(directive.defectIds)) return;

  for (const field of [...directive.fieldsToRewrite, ...directive.fieldsLocked]) {
    if (!WRITER_SECTION_SET.has(field)) errors.push(`revisionDirective contains unknown Writer field: ${String(field)}`);
  }

  const rewrite = arraySet(directive.fieldsToRewrite);
  const locked = arraySet(directive.fieldsLocked);
  for (const field of rewrite) {
    if (locked.has(field)) errors.push(`Writer field cannot be both rewritten and locked: ${field}`);
  }

  const decision = deriveJudgeDecision(response);
  if (decision === JUDGE_DECISION.REVISE) {
    if (directive.required !== true || directive.mode !== "TARGETED") {
      errors.push("REVISE requires revisionDirective.required=true and mode=TARGETED");
    }
    if (!sameSet(rewrite, defectSummary.allowedFields)) {
      errors.push("revisionDirective.fieldsToRewrite must exactly equal the union of defect.allowedFields");
    }
    if (!sameSet(arraySet(directive.defectIds), defectSummary.ids)) {
      errors.push("revisionDirective.defectIds must exactly match defects[].defectId");
    }
    if (defectSummary.ids.size === 0) errors.push("REVISE requires at least one defect");
  } else if (decision === JUDGE_DECISION.PASS) {
    if (directive.required !== false || directive.mode !== "NONE") {
      errors.push("PASS requires revisionDirective.required=false and mode=NONE");
    }
    if (rewrite.size > 0 || directive.defectIds.length > 0) {
      errors.push("PASS cannot request rewritten fields or defect IDs");
    }
  } else {
    if (directive.required !== false || directive.mode !== "HUMAN_REVIEW") {
      errors.push("HUMAN_REVIEW_REQUIRED requires revisionDirective.required=false and mode=HUMAN_REVIEW");
    }
    if (rewrite.size > 0) errors.push("HUMAN_REVIEW_REQUIRED cannot authorize an automatic fourth rewrite");
  }
}

/**
 * Deterministically validate a Judge response against the exact Writer packet.
 * Returns errors; never repairs Judge output.
 */
export function validateJudgeResponse(response, { writerInput, expectedPassNumber } = {}) {
  const errors = [];
  if (!isObject(response)) return { valid: false, errors: ["Judge response must be an object"] };
  if (!isObject(writerInput)) return { valid: false, errors: ["writerInput is required"] };

  if (response.contractVersion !== JUDGE_CONTRACT_VERSION) errors.push(`contractVersion must equal ${JUDGE_CONTRACT_VERSION}`);
  if (response.auditId !== writerInput.auditId) errors.push(`auditId mismatch: ${String(response.auditId)} vs ${String(writerInput.auditId)}`);
  if (!Number.isInteger(response.passNumber) || response.passNumber < 1 || response.passNumber > MAX_NARRATIVE_PASSES) {
    errors.push(`passNumber must be an integer from 1 to ${MAX_NARRATIVE_PASSES}`);
  }
  if (expectedPassNumber !== undefined && response.passNumber !== expectedPassNumber) {
    errors.push(`passNumber mismatch: ${String(response.passNumber)} vs expected ${String(expectedPassNumber)}`);
  }
    if (!nonEmptyString(response.judgeModelId)) errors.push("judgeModelId is required");
  if (response.judgePromptVersion !== JUDGE_PROMPT_VERSION) {
    errors.push(`judgePromptVersion must equal ${JUDGE_PROMPT_VERSION}`);
  }
  if (!nonEmptyString(response.evaluatedAt)) errors.push("evaluatedAt is required");

  validateHardGate(response.hardGate, writerInput, errors);
  const calculatedTotal = validateRubric(response.rubric, writerInput, errors);
  if (typeof response.totalScore !== "number" || !Number.isFinite(response.totalScore)) errors.push("totalScore must be a number");
  else if (calculatedTotal !== null && response.totalScore !== calculatedTotal) {
    errors.push(`totalScore mismatch: ${response.totalScore} vs calculated ${calculatedTotal}`);
  }

  const defectSummary = validateDefects(response.defects, writerInput, errors);
  const derived = deriveJudgeDecision(response);
  if (response.decision !== derived) errors.push(`decision must be ${derived}, got ${String(response.decision)}`);
  validateRevisionDirective(response, defectSummary, errors);

  const rubricDefectIds = new Set();
  for (const record of Object.values(response.rubric || {})) {
    for (const id of record?.defectIds || []) rubricDefectIds.add(id);
  }
  for (const id of rubricDefectIds) {
    if (!defectSummary.ids.has(id)) errors.push(`Rubric references unknown defectId: ${id}`);
  }

  return { valid: errors.length === 0, errors };
}

export function nextActionForJudge(response) {
  const decision = deriveJudgeDecision(response);
  if (decision === JUDGE_DECISION.PASS) return NEXT_ACTION.RELEASE_CANDIDATE;
  if (decision === JUDGE_DECISION.REVISE) return NEXT_ACTION.WRITE_NEXT_PASS;
  return NEXT_ACTION.HUMAN_REVIEW;
}

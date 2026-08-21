// PRYSM Narrative v2 — strict provider schema for governed Judge output.
//
// The Judge may evaluate and identify defects, but provider output is bounded
// to exact governed references, rubric criteria, hard-gate codes and Writer
// section identifiers before deterministic Judge normalization/validation.

import {
  HARD_GATE_CODES,
  JUDGE_CONTRACT_VERSION,
  JUDGE_DECISION,
  RUBRIC,
  WRITER_SECTION_FIELDS,
} from "./judge-contract.js";

const JUDGE_PROMPT_VERSION = "2.0.0";
const MAX_JUDGE_REFS = 16;
const MAX_DEFECTS = 20;
const MAX_HARD_GATE_VIOLATIONS = 20;

function objectSchema(properties) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function enumString(...values) {
  return { type: "string", enum: values };
}

function nonEmptyString(maxChars = null) {
  return {
    type: "string",
    pattern: Number.isInteger(maxChars)
      ? `^[\\s\\S]{1,${maxChars}}$`
      : "\\S",
  };
}

function evidenceRefs({ minItems = 0 } = {}) {
  return {
    type: "array",
    minItems,
    maxItems: MAX_JUDGE_REFS,
    items: { $ref: "#/$defs/evidenceRef" },
  };
}

function stringArray(itemSchema, { minItems = 0, maxItems = 20 } = {}) {
  return {
    type: "array",
    minItems,
    maxItems,
    items: itemSchema,
  };
}

function rubricRecordSchema(maxScore) {
  return objectSchema({
    score: { type: "number", minimum: 0, maximum: maxScore },
    maxScore: { type: "number", enum: [maxScore] },
    status: enumString("PASS", "FAIL"),
    rationale: nonEmptyString(),
    evidenceRefs: evidenceRefs(),
    defectIds: stringArray(nonEmptyString()),
  });
}

function hardGateSchema() {
  return objectSchema({
    status: enumString("PASS", "FAIL"),
    violations: {
      type: "array",
      maxItems: MAX_HARD_GATE_VIOLATIONS,
      items: objectSchema({
        violationId: nonEmptyString(),
        code: { type: "string", enum: [...HARD_GATE_CODES] },
        section: nonEmptyString(),
        explanation: nonEmptyString(),
        evidenceRefs: evidenceRefs(),
        automaticFail: { type: "boolean", enum: [true] },
      }),
    },
  });
}

function defectsSchema() {
  return {
    type: "array",
    maxItems: MAX_DEFECTS,
    items: objectSchema({
      defectId: nonEmptyString(),
      criterion: { type: "string", enum: Object.keys(RUBRIC) },
      section: nonEmptyString(),
      severity: enumString("MAJOR", "MINOR"),
      problem: nonEmptyString(),
      whyItMatters: nonEmptyString(),
      evidenceRefs: evidenceRefs(),
      requiredCorrection: nonEmptyString(),
      allowedFields: stringArray(
        { type: "string", enum: [...WRITER_SECTION_FIELDS] },
        { minItems: 1, maxItems: WRITER_SECTION_FIELDS.length },
      ),
      mustPreserve: stringArray(
        { type: "string", enum: [...WRITER_SECTION_FIELDS] },
        { maxItems: WRITER_SECTION_FIELDS.length },
      ),
    }),
  };
}

function revisionDirectiveSchema() {
  return objectSchema({
    required: { type: "boolean" },
    mode: enumString("NONE", "TARGETED", "HUMAN_REVIEW"),
    fieldsToRewrite: stringArray(
      { type: "string", enum: [...WRITER_SECTION_FIELDS] },
      { maxItems: WRITER_SECTION_FIELDS.length },
    ),
    fieldsLocked: stringArray(
      { type: "string", enum: [...WRITER_SECTION_FIELDS] },
      { maxItems: WRITER_SECTION_FIELDS.length },
    ),
    defectIds: stringArray(nonEmptyString(), { maxItems: MAX_DEFECTS }),
  });
}

export function buildJudgeStructuredOutputSchema({ writerInput, passNumber, modelId }) {
  if (!writerInput || typeof writerInput !== "object") throw new Error("writerInput is required for Judge structured output schema");
  if (!Number.isInteger(passNumber) || passNumber < 1 || passNumber > 3) throw new Error("passNumber must be 1, 2, or 3 for Judge structured output schema");
  if (typeof modelId !== "string" || !modelId.trim()) throw new Error("modelId is required for Judge structured output schema");

  const allowedRefs = Object.keys(writerInput.referenceIndex || {});
  if (allowedRefs.length === 0) throw new Error("writerInput.referenceIndex must contain at least one Judge reference");

  const rubricProperties = Object.fromEntries(
    Object.entries(RUBRIC).map(([key, maxScore]) => [key, rubricRecordSchema(maxScore)]),
  );

  const schema = objectSchema({
    contractVersion: enumString(JUDGE_CONTRACT_VERSION),
    auditId: enumString(writerInput.auditId),
    passNumber: { type: "integer", enum: [passNumber] },
    judgeModelId: enumString(modelId),
    judgePromptVersion: enumString(JUDGE_PROMPT_VERSION),
    evaluatedAt: nonEmptyString(),
    hardGate: hardGateSchema(),
    rubric: objectSchema(rubricProperties),
    totalScore: { type: "number", minimum: 0, maximum: 100 },
    decision: { type: "string", enum: Object.values(JUDGE_DECISION) },
    defects: defectsSchema(),
    revisionDirective: revisionDirectiveSchema(),
  });

  schema.$defs = {
    evidenceRef: { type: "string", enum: allowedRefs },
  };
  return schema;
}

export function buildJudgeStructuredResponseFormat(args) {
  return {
    type: "json_schema",
    json_schema: {
      name: "prysm_narrative_v2_judge_response",
      strict: true,
      schema: buildJudgeStructuredOutputSchema(args),
    },
  };
}

export default { buildJudgeStructuredOutputSchema, buildJudgeStructuredResponseFormat };

// PRYSM Narrative v2 — strict provider schema for governed Writer output.
//
// The schema is generated from the exact WriterInput. It closes provider-side
// gaps that previously allowed structurally valid model output to fail the
// deterministic Writer validator after a paid response returned.

import { WRITER_OUTPUT_VERSION, WRITER_PROMPT_VERSION } from "./writer-output.js";
import { governedStatusForWriterReference } from "./writer-reference.js";

const INTERPRETATION = "INTERPRETATION";
const OPPORTUNITY = "OPPORTUNITY";
const MAX_REFS_PER_ATOM = 12;

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

function nonEmptyString(maxLength = null) {
  return {
    type: "string",
    minLength: 1,
    ...(Number.isInteger(maxLength) ? { maxLength } : {}),
  };
}

function boundedWords(maxWords) {
  // Same whitespace-delimited word model used by validateWriterOutput().
  return {
    type: "string",
    minLength: 1,
    pattern: `^\\s*\\S+(?:\\s+\\S+){0,${maxWords - 1}}\\s*$`,
  };
}

function evidenceRefArray(allowedRefs = null) {
  return {
    type: "array",
    minItems: 1,
    maxItems: MAX_REFS_PER_ATOM,
    items: Array.isArray(allowedRefs) && allowedRefs.length > 0
      ? { type: "string", enum: allowedRefs }
      : { $ref: "#/$defs/evidenceRef" },
  };
}

function atomSchema(statementClass, maxWords, allowedRefs = null) {
  return objectSchema({
    text: boundedWords(maxWords),
    statementClass: enumString(statementClass),
    evidenceRefs: evidenceRefArray(allowedRefs),
  });
}

function standardSectionSchema(fields, opportunityFields = new Set()) {
  const properties = { headline: nonEmptyString(160) };
  for (const field of fields) {
    properties[field] = atomSchema(
      opportunityFields.has(field) ? OPPORTUNITY : INTERPRETATION,
      130,
    );
  }
  return objectSchema(properties);
}

function governedStatusRefs(writerInput) {
  const groups = new Map();
  for (const ref of Object.keys(writerInput?.referenceIndex || {})) {
    const status = governedStatusForWriterReference(writerInput, ref);
    if (!status) continue;
    if (!groups.has(status)) groups.set(status, []);
    groups.get(status).push(ref);
  }
  return groups;
}

function limitationItemForStatus(status, statusRefs) {
  return objectSchema({
    itemId: nonEmptyString(),
    area: nonEmptyString(),
    status: enumString(status),
    clientExplanation: atomSchema(INTERPRETATION, 100, statusRefs),
    whatThisMeans: atomSchema(INTERPRETATION, 100, statusRefs),
    whatThisDoesNotMean: atomSchema(INTERPRETATION, 100, statusRefs),
    impactOnReport: atomSchema(INTERPRETATION, 100),
  });
}

function limitationItemSchema(writerInput) {
  const groups = governedStatusRefs(writerInput);
  const branches = [...groups.entries()].map(([status, refs]) => limitationItemForStatus(status, refs));
  if (branches.length === 1) return branches[0];
  if (branches.length > 1) return { anyOf: branches };

  // Fail-closed structural fallback. Production WriterInput is expected to
  // expose governed source/capability statuses; semantic validation remains
  // authoritative if that invariant is ever absent.
  return objectSchema({
    itemId: nonEmptyString(),
    area: nonEmptyString(),
    status: nonEmptyString(),
    clientExplanation: atomSchema(INTERPRETATION, 100),
    whatThisMeans: atomSchema(INTERPRETATION, 100),
    whatThisDoesNotMean: atomSchema(INTERPRETATION, 100),
    impactOnReport: atomSchema(INTERPRETATION, 100),
  });
}

function funnelItemSchema() {
  return objectSchema({
    itemId: nonEmptyString(),
    concept: atomSchema(OPPORTUNITY, 70),
    userNeed: atomSchema(OPPORTUNITY, 70),
    rationale: atomSchema(OPPORTUNITY, 100),
    businessObjective: atomSchema(OPPORTUNITY, 70),
    nextAction: atomSchema(OPPORTUNITY, 70),
  });
}

function actionPlanItemSchema() {
  return objectSchema({
    actionId: nonEmptyString(),
    priority: { type: "integer", enum: [1, 2, 3, 4, 5] },
    title: nonEmptyString(160),
    action: atomSchema(OPPORTUNITY, 100),
    whyNow: atomSchema(OPPORTUNITY, 100),
    expectedBusinessEffect: atomSchema(OPPORTUNITY, 100),
    effort: enumString("L", "M", "H"),
    verification: atomSchema(OPPORTUNITY, 100),
  });
}

export function buildWriterStructuredOutputSchema({ writerInput, passNumber, modelId }) {
  if (!writerInput || typeof writerInput !== "object") throw new Error("writerInput is required for Writer structured output schema");
  if (!Number.isInteger(passNumber) || passNumber < 1 || passNumber > 3) throw new Error("passNumber must be 1, 2, or 3 for Writer structured output schema");
  if (typeof modelId !== "string" || !modelId.trim()) throw new Error("modelId is required for Writer structured output schema");

  const allowedRefs = Object.keys(writerInput.referenceIndex || {});
  if (allowedRefs.length === 0) throw new Error("writerInput.referenceIndex must contain at least one Writer reference");

  const funnelItem = funnelItemSchema();
  const schema = objectSchema({
    contractVersion: enumString("1.0.0"),
    writerOutputVersion: enumString(WRITER_OUTPUT_VERSION),
    auditId: enumString(writerInput.auditId),
    passNumber: { type: "integer", enum: [passNumber] },
    modelId: enumString(modelId),
    promptVersion: enumString(WRITER_PROMPT_VERSION),
    generatedAt: nonEmptyString(),
    executiveConclusion: objectSchema({
      headline: nonEmptyString(160),
      narrative: atomSchema(INTERPRETATION, 220),
    }),
    strengths: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: objectSchema({
        itemId: nonEmptyString(),
        title: nonEmptyString(160),
        narrative: atomSchema(INTERPRETATION, 120),
      }),
    },
    rootCause: objectSchema({
      headline: nonEmptyString(160),
      narrative: atomSchema(INTERPRETATION, 220),
      businessConsequences: {
        type: "array",
        maxItems: 5,
        items: objectSchema({
          area: nonEmptyString(),
          narrative: atomSchema(INTERPRETATION, 90),
        }),
      },
    }),
    conversion: standardSectionSchema(["whatWorks", "constraints", "businessMeaning", "priority"]),
    content: standardSectionSchema(["currentStrength", "coverageAssessment", "qualityAssessment", "topicalArchitecture", "importantGaps", "businessMeaning"]),
    funnelOpportunities: objectSchema({
      awareness: { type: "array", maxItems: 3, items: funnelItem },
      consideration: { type: "array", maxItems: 3, items: funnelItem },
      decision: { type: "array", maxItems: 3, items: funnelItem },
    }),
    seoSerp: standardSectionSchema(["whatWorks", "constraints", "searchImplication", "priority"]),
    aiSearch: standardSectionSchema(["answerability", "entityStrength", "citationReadiness", "constraints", "opportunity"], new Set(["opportunity"])),
    eeatTrust: standardSectionSchema(["experience", "expertise", "authority", "trust", "proofGaps", "businessMeaning"]),
    technical: standardSectionSchema(["assessment", "materialIssues", "businessMeaning"]),
    performanceUx: standardSectionSchema(["assessment", "userImpact", "conversionImpact"]),
    competitors: standardSectionSchema(["advantages", "disadvantages", "marketInterpretation", "differentiatorToProtect"]),
    limitations: {
      type: "array",
      maxItems: 10,
      items: limitationItemSchema(writerInput),
    },
    actionPlan: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: actionPlanItemSchema(),
    },
    executiveDecision: objectSchema({
      preserve: atomSchema(INTERPRETATION, 100),
      change: atomSchema(INTERPRETATION, 100),
      doNext: atomSchema(OPPORTUNITY, 100),
    }),
  });

  schema.$defs = {
    evidenceRef: { type: "string", enum: allowedRefs },
  };
  return schema;
}

export function buildWriterStructuredResponseFormat(args) {
  return {
    type: "json_schema",
    json_schema: {
      name: "prysm_narrative_v2_writer_output",
      strict: true,
      schema: buildWriterStructuredOutputSchema(args),
    },
  };
}

export default { buildWriterStructuredOutputSchema, buildWriterStructuredResponseFormat };

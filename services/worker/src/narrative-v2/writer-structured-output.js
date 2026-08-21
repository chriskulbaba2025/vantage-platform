// PRYSM Narrative v2 — OpenAI Structured Outputs schema for governed Writer output.
//
// This schema enforces deterministic contract metadata and statement classes at
// the provider boundary. The existing validateWriterOutput() remains the
// semantic authority for evidence lineage, word limits, revision locking, and
// all other governed checks after the model response returns.

import { WRITER_OUTPUT_VERSION, WRITER_PROMPT_VERSION } from "./writer-output.js";
import { governedStatusForWriterReference } from "./writer-reference.js";

const INTERPRETATION = "INTERPRETATION";
const OPPORTUNITY = "OPPORTUNITY";

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

function evidenceRefArray(allowedRefs = null) {
  return {
    type: "array",
    items: Array.isArray(allowedRefs) && allowedRefs.length > 0
      ? { type: "string", enum: allowedRefs }
      : { type: "string" },
  };
}

function atomSchema(statementClass, allowedRefs = null) {
  return objectSchema({
    text: { type: "string" },
    statementClass: enumString(statementClass),
    evidenceRefs: evidenceRefArray(allowedRefs),
  });
}

function standardSectionSchema(fields, opportunityFields = new Set()) {
  const properties = { headline: { type: "string" } };
  for (const field of fields) {
    properties[field] = atomSchema(opportunityFields.has(field) ? OPPORTUNITY : INTERPRETATION);
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
    itemId: { type: "string" },
    area: { type: "string" },
    status: enumString(status),
    clientExplanation: atomSchema(INTERPRETATION, statusRefs),
    whatThisMeans: atomSchema(INTERPRETATION, statusRefs),
    whatThisDoesNotMean: atomSchema(INTERPRETATION, statusRefs),
    impactOnReport: atomSchema(INTERPRETATION),
  });
}

function limitationItemSchema(writerInput) {
  const groups = governedStatusRefs(writerInput);
  const branches = [...groups.entries()].map(([status, refs]) => limitationItemForStatus(status, refs));
  if (branches.length === 1) return branches[0];
  if (branches.length > 1) return { anyOf: branches };

  // A production WriterInput is expected to expose governed source/capability
  // statuses. Keep a structural fallback so schema construction itself remains
  // deterministic; validateWriterOutput() will still fail closed if an emitted
  // limitation cannot be grounded.
  return objectSchema({
    itemId: { type: "string" },
    area: { type: "string" },
    status: { type: "string" },
    clientExplanation: atomSchema(INTERPRETATION),
    whatThisMeans: atomSchema(INTERPRETATION),
    whatThisDoesNotMean: atomSchema(INTERPRETATION),
    impactOnReport: atomSchema(INTERPRETATION),
  });
}

function funnelItemSchema() {
  return objectSchema({
    itemId: { type: "string" },
    concept: atomSchema(OPPORTUNITY),
    userNeed: atomSchema(OPPORTUNITY),
    rationale: atomSchema(OPPORTUNITY),
    businessObjective: atomSchema(OPPORTUNITY),
    nextAction: atomSchema(OPPORTUNITY),
  });
}

function actionPlanItemSchema() {
  return objectSchema({
    actionId: { type: "string" },
    priority: { type: "integer", enum: [1, 2, 3, 4, 5] },
    title: { type: "string" },
    action: atomSchema(OPPORTUNITY),
    whyNow: atomSchema(OPPORTUNITY),
    expectedBusinessEffect: atomSchema(OPPORTUNITY),
    effort: enumString("L", "M", "H"),
    verification: atomSchema(OPPORTUNITY),
  });
}

export function buildWriterStructuredOutputSchema({ writerInput, passNumber, modelId }) {
  if (!writerInput || typeof writerInput !== "object") throw new Error("writerInput is required for Writer structured output schema");
  if (!Number.isInteger(passNumber) || passNumber < 1 || passNumber > 3) throw new Error("passNumber must be 1, 2, or 3 for Writer structured output schema");
  if (typeof modelId !== "string" || !modelId.trim()) throw new Error("modelId is required for Writer structured output schema");

  const funnelItem = funnelItemSchema();

  return objectSchema({
    contractVersion: enumString("1.0.0"),
    writerOutputVersion: enumString(WRITER_OUTPUT_VERSION),
    auditId: enumString(writerInput.auditId),
    passNumber: { type: "integer", enum: [passNumber] },
    modelId: enumString(modelId),
    promptVersion: enumString(WRITER_PROMPT_VERSION),
    generatedAt: { type: "string" },
    executiveConclusion: objectSchema({
      headline: { type: "string" },
      narrative: atomSchema(INTERPRETATION),
    }),
    strengths: {
      type: "array",
      items: objectSchema({
        itemId: { type: "string" },
        title: { type: "string" },
        narrative: atomSchema(INTERPRETATION),
      }),
    },
    rootCause: objectSchema({
      headline: { type: "string" },
      narrative: atomSchema(INTERPRETATION),
      businessConsequences: {
        type: "array",
        items: objectSchema({
          area: { type: "string" },
          narrative: atomSchema(INTERPRETATION),
        }),
      },
    }),
    conversion: standardSectionSchema(["whatWorks", "constraints", "businessMeaning", "priority"]),
    content: standardSectionSchema(["currentStrength", "coverageAssessment", "qualityAssessment", "topicalArchitecture", "importantGaps", "businessMeaning"]),
    funnelOpportunities: objectSchema({
      awareness: { type: "array", items: funnelItem },
      consideration: { type: "array", items: funnelItem },
      decision: { type: "array", items: funnelItem },
    }),
    seoSerp: standardSectionSchema(["whatWorks", "constraints", "searchImplication", "priority"]),
    aiSearch: standardSectionSchema(["answerability", "entityStrength", "citationReadiness", "constraints", "opportunity"], new Set(["opportunity"])),
    eeatTrust: standardSectionSchema(["experience", "expertise", "authority", "trust", "proofGaps", "businessMeaning"]),
    technical: standardSectionSchema(["assessment", "materialIssues", "businessMeaning"]),
    performanceUx: standardSectionSchema(["assessment", "userImpact", "conversionImpact"]),
    competitors: standardSectionSchema(["advantages", "disadvantages", "marketInterpretation", "differentiatorToProtect"]),
    limitations: {
      type: "array",
      items: limitationItemSchema(writerInput),
    },
    actionPlan: {
      type: "array",
      items: actionPlanItemSchema(),
    },
    executiveDecision: objectSchema({
      preserve: atomSchema(INTERPRETATION),
      change: atomSchema(INTERPRETATION),
      doNext: atomSchema(OPPORTUNITY),
    }),
  });
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

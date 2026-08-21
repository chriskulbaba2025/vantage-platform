// PRYSM Narrative v2 — OpenAI Structured Outputs schema for governed Writer output.
//
// This schema enforces deterministic contract metadata and statement classes at
// the provider boundary. The existing validateWriterOutput() remains the
// semantic authority for evidence lineage, word limits, revision locking, and
// all other governed checks after the model response returns.

import { WRITER_OUTPUT_VERSION, WRITER_PROMPT_VERSION } from "./writer-output.js";

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

function evidenceRefArray(refs) {
  return {
    type: "array",
    items: refs.length > 0
      ? { type: "string", enum: refs }
      : { type: "string" },
  };
}

function atomSchema(statementClass, refs) {
  return objectSchema({
    text: { type: "string" },
    statementClass: enumString(statementClass),
    evidenceRefs: evidenceRefArray(refs),
  });
}

function standardSectionSchema(fields, refs, opportunityFields = new Set()) {
  const properties = { headline: { type: "string" } };
  for (const field of fields) {
    properties[field] = atomSchema(opportunityFields.has(field) ? OPPORTUNITY : INTERPRETATION, refs);
  }
  return objectSchema(properties);
}

function getPathValue(object, path) {
  return String(path || "").split(".").reduce((value, key) => value?.[key], object);
}

function governedStatusRefs(writerInput) {
  const groups = new Map();
  for (const [ref, record] of Object.entries(writerInput?.referenceIndex || {})) {
    if (!record || typeof record !== "object" || typeof record.path !== "string") continue;
    const value = getPathValue(writerInput, record.path);
    let status;
    if (record.kind === "source-status" && typeof value === "string" && value) {
      status = value;
    } else if (record.kind === "capability" && value && typeof value === "object" && typeof value.status === "string" && value.status) {
      status = value.status;
    }
    if (!status) continue;
    if (!groups.has(status)) groups.set(status, []);
    groups.get(status).push(ref);
  }
  return groups;
}

function limitationItemForStatus(status, statusRefs, allRefs) {
  return objectSchema({
    itemId: { type: "string" },
    area: { type: "string" },
    status: enumString(status),
    clientExplanation: atomSchema(INTERPRETATION, statusRefs),
    whatThisMeans: atomSchema(INTERPRETATION, statusRefs),
    whatThisDoesNotMean: atomSchema(INTERPRETATION, statusRefs),
    impactOnReport: atomSchema(INTERPRETATION, allRefs),
  });
}

function limitationItemSchema(writerInput, allRefs) {
  const groups = governedStatusRefs(writerInput);
  const branches = [...groups.entries()].map(([status, refs]) => limitationItemForStatus(status, refs, allRefs));
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
    clientExplanation: atomSchema(INTERPRETATION, allRefs),
    whatThisMeans: atomSchema(INTERPRETATION, allRefs),
    whatThisDoesNotMean: atomSchema(INTERPRETATION, allRefs),
    impactOnReport: atomSchema(INTERPRETATION, allRefs),
  });
}

function funnelItemSchema(refs) {
  return objectSchema({
    itemId: { type: "string" },
    concept: atomSchema(OPPORTUNITY, refs),
    userNeed: atomSchema(OPPORTUNITY, refs),
    rationale: atomSchema(OPPORTUNITY, refs),
    businessObjective: atomSchema(OPPORTUNITY, refs),
    nextAction: atomSchema(OPPORTUNITY, refs),
  });
}

function actionPlanItemSchema(refs) {
  return objectSchema({
    actionId: { type: "string" },
    priority: { type: "integer", enum: [1, 2, 3, 4, 5] },
    title: { type: "string" },
    action: atomSchema(OPPORTUNITY, refs),
    whyNow: atomSchema(OPPORTUNITY, refs),
    expectedBusinessEffect: atomSchema(OPPORTUNITY, refs),
    effort: enumString("L", "M", "H"),
    verification: atomSchema(OPPORTUNITY, refs),
  });
}

export function buildWriterStructuredOutputSchema({ writerInput, passNumber, modelId }) {
  if (!writerInput || typeof writerInput !== "object") throw new Error("writerInput is required for Writer structured output schema");
  if (!Number.isInteger(passNumber) || passNumber < 1 || passNumber > 3) throw new Error("passNumber must be 1, 2, or 3 for Writer structured output schema");
  if (typeof modelId !== "string" || !modelId.trim()) throw new Error("modelId is required for Writer structured output schema");

  const refs = Object.keys(writerInput.referenceIndex || {});
  const funnelItem = funnelItemSchema(refs);

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
      narrative: atomSchema(INTERPRETATION, refs),
    }),
    strengths: {
      type: "array",
      items: objectSchema({
        itemId: { type: "string" },
        title: { type: "string" },
        narrative: atomSchema(INTERPRETATION, refs),
      }),
    },
    rootCause: objectSchema({
      headline: { type: "string" },
      narrative: atomSchema(INTERPRETATION, refs),
      businessConsequences: {
        type: "array",
        items: objectSchema({
          area: { type: "string" },
          narrative: atomSchema(INTERPRETATION, refs),
        }),
      },
    }),
    conversion: standardSectionSchema(["whatWorks", "constraints", "businessMeaning", "priority"], refs),
    content: standardSectionSchema(["currentStrength", "coverageAssessment", "qualityAssessment", "topicalArchitecture", "importantGaps", "businessMeaning"], refs),
    funnelOpportunities: objectSchema({
      awareness: { type: "array", items: funnelItem },
      consideration: { type: "array", items: funnelItem },
      decision: { type: "array", items: funnelItem },
    }),
    seoSerp: standardSectionSchema(["whatWorks", "constraints", "searchImplication", "priority"], refs),
    aiSearch: standardSectionSchema(["answerability", "entityStrength", "citationReadiness", "constraints", "opportunity"], refs, new Set(["opportunity"])),
    eeatTrust: standardSectionSchema(["experience", "expertise", "authority", "trust", "proofGaps", "businessMeaning"], refs),
    technical: standardSectionSchema(["assessment", "materialIssues", "businessMeaning"], refs),
    performanceUx: standardSectionSchema(["assessment", "userImpact", "conversionImpact"], refs),
    competitors: standardSectionSchema(["advantages", "disadvantages", "marketInterpretation", "differentiatorToProtect"], refs),
    limitations: {
      type: "array",
      items: limitationItemSchema(writerInput, refs),
    },
    actionPlan: {
      type: "array",
      items: actionPlanItemSchema(refs),
    },
    executiveDecision: objectSchema({
      preserve: atomSchema(INTERPRETATION, refs),
      change: atomSchema(INTERPRETATION, refs),
      doNext: atomSchema(OPPORTUNITY, refs),
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

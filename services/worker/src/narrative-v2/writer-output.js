// PRYSM Narrative v2 — governed Writer output contract.
//
// Writer v2 may interpret deterministic evidence and propose opportunities.
// It may not create new observations, scores, source states, URLs, or evidence.
// Every substantive narrative field carries exact references into
// WriterInput.referenceIndex so the Judge can verify lineage.

import { governedStatusForWriterReference } from "./writer-reference.js";

export const WRITER_OUTPUT_VERSION = "1.0.0";
export const WRITER_PROMPT_VERSION = "2.1.0";
export const WRITER_STATEMENT_CLASS = Object.freeze({
  INTERPRETATION: "INTERPRETATION",
  OPPORTUNITY: "OPPORTUNITY",
});

export const WRITER_OUTPUT_SECTION_PATHS = Object.freeze([
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

const SECTION_PATH_SET = new Set(WRITER_OUTPUT_SECTION_PATHS);
const STATEMENT_CLASS_SET = new Set(Object.values(WRITER_STATEMENT_CLASS));

const TOP_LEVEL_REQUIRED = Object.freeze([
  "contractVersion",
  "writerOutputVersion",
  "auditId",
  "passNumber",
  "modelId",
  "promptVersion",
  "generatedAt",
  "executiveConclusion",
  "strengths",
  "rootCause",
  "conversion",
  "content",
  "funnelOpportunities",
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

const TOP_LEVEL_ALLOWED = new Set([
  ...TOP_LEVEL_REQUIRED,
  "usage",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function countWords(value) {
  return typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean).length : 0;
}

function validateTextSafety(text, label, errors) {
  if (!nonEmptyString(text)) {
    errors.push(`${label}.text is required`);
    return;
  }
  if (/<\/?(?:html|body|head|div|style|script|section|article|table|p|h[1-6])\b/i.test(text)) {
    errors.push(`${label}.text contains HTML`);
  }
  if (/```|^\s{0,3}#{1,6}\s|\[[^\]]+\]\([^\)]+\)/m.test(text)) {
    errors.push(`${label}.text contains Markdown`);
  }
  if (/https?:\/\//i.test(text)) {
    errors.push(`${label}.text contains a URL; URLs must come from deterministic render data, not Writer prose`);
  }
}

function validateRefs(refs, writerInput, label, errors) {
  if (!Array.isArray(refs) || refs.length === 0) {
    errors.push(`${label}.evidenceRefs must contain at least one Writer reference`);
    return;
  }
  const index = writerInput?.referenceIndex;
  if (!isObject(index)) {
    errors.push("writerInput.referenceIndex is required");
    return;
  }
  const seen = new Set();
  for (const ref of refs) {
    if (!nonEmptyString(ref) || !Object.hasOwn(index, ref)) {
      errors.push(`${label}.evidenceRefs contains unknown Writer reference: ${String(ref)}`);
      continue;
    }
    if (seen.has(ref)) errors.push(`${label}.evidenceRefs contains duplicate reference: ${ref}`);
    seen.add(ref);
  }
}

function validateNarrativeAtom(atom, writerInput, label, errors, { className, maxWords = 220 } = {}) {
  if (!isObject(atom)) {
    errors.push(`${label} must be an object`);
    return;
  }
  validateTextSafety(atom.text, label, errors);
  if (!STATEMENT_CLASS_SET.has(atom.statementClass)) {
    errors.push(`${label}.statementClass must be INTERPRETATION or OPPORTUNITY`);
  }
  if (className && atom.statementClass !== className) {
    errors.push(`${label}.statementClass must be ${className}`);
  }
  validateRefs(atom.evidenceRefs, writerInput, label, errors);
  if (countWords(atom.text) > maxWords) {
    errors.push(`${label}.text exceeds ${maxWords} words`);
  }
  for (const key of Object.keys(atom)) {
    if (!["text", "statementClass", "evidenceRefs"].includes(key)) {
      errors.push(`${label} contains unknown field: ${key}`);
    }
  }
}

function validateHeadline(value, label, errors) {
  if (!nonEmptyString(value)) errors.push(`${label} is required`);
  else if (value.length > 160) errors.push(`${label} exceeds 160 characters`);
  else if (/https?:\/\//i.test(value) || /<[^>]+>/.test(value)) errors.push(`${label} contains prohibited markup or URL`);
}

function validateStrengths(strengths, writerInput, errors) {
  if (!Array.isArray(strengths) || strengths.length === 0 || strengths.length > 5) {
    errors.push("strengths must contain 1 to 5 evidence-backed items");
    return;
  }
  const ids = new Set();
  strengths.forEach((item, index) => {
    const label = `strengths[${index}]`;
    if (!isObject(item)) return errors.push(`${label} must be an object`);
    if (!nonEmptyString(item.itemId)) errors.push(`${label}.itemId is required`);
    else if (ids.has(item.itemId)) errors.push(`Duplicate strength itemId: ${item.itemId}`);
    else ids.add(item.itemId);
    validateHeadline(item.title, `${label}.title`, errors);
    validateNarrativeAtom(item.narrative, writerInput, `${label}.narrative`, errors, {
      className: WRITER_STATEMENT_CLASS.INTERPRETATION,
      maxWords: 120,
    });
  });
}

function validateRootCause(rootCause, writerInput, errors) {
  if (!isObject(rootCause)) return errors.push("rootCause must be an object");
  validateHeadline(rootCause.headline, "rootCause.headline", errors);
  validateNarrativeAtom(rootCause.narrative, writerInput, "rootCause.narrative", errors, {
    className: WRITER_STATEMENT_CLASS.INTERPRETATION,
    maxWords: 220,
  });
  if (!Array.isArray(rootCause.businessConsequences) || rootCause.businessConsequences.length > 5) {
    errors.push("rootCause.businessConsequences must be an array with at most 5 items");
  } else {
    rootCause.businessConsequences.forEach((item, index) => {
      const label = `rootCause.businessConsequences[${index}]`;
      if (!isObject(item)) return errors.push(`${label} must be an object`);
      if (!nonEmptyString(item.area)) errors.push(`${label}.area is required`);
      validateNarrativeAtom(item.narrative, writerInput, `${label}.narrative`, errors, {
        className: WRITER_STATEMENT_CLASS.INTERPRETATION,
        maxWords: 90,
      });
    });
  }
}

const STANDARD_SECTIONS = Object.freeze({
  conversion: ["whatWorks", "constraints", "businessMeaning", "priority"],
  content: ["currentStrength", "coverageAssessment", "qualityAssessment", "topicalArchitecture", "importantGaps", "businessMeaning"],
  seoSerp: ["whatWorks", "constraints", "searchImplication", "priority"],
  aiSearch: ["answerability", "entityStrength", "citationReadiness", "constraints", "opportunity"],
  eeatTrust: ["experience", "expertise", "authority", "trust", "proofGaps", "businessMeaning"],
  technical: ["assessment", "materialIssues", "businessMeaning"],
  performanceUx: ["assessment", "userImpact", "conversionImpact"],
  competitors: ["advantages", "disadvantages", "marketInterpretation", "differentiatorToProtect"],
});

function validateStandardSection(sectionName, value, writerInput, errors) {
  if (!isObject(value)) return errors.push(`${sectionName} must be an object`);
  validateHeadline(value.headline, `${sectionName}.headline`, errors);
  for (const field of STANDARD_SECTIONS[sectionName]) {
    validateNarrativeAtom(value[field], writerInput, `${sectionName}.${field}`, errors, {
      className: field === "opportunity" ? undefined : WRITER_STATEMENT_CLASS.INTERPRETATION,
      maxWords: 130,
    });
    if (field === "opportunity" && value[field]?.statementClass !== WRITER_STATEMENT_CLASS.OPPORTUNITY) {
      errors.push(`${sectionName}.${field}.statementClass must be OPPORTUNITY`);
    }
  }
}

function validateFunnelStage(stageName, items, writerInput, errors) {
  if (!Array.isArray(items) || items.length > 3) {
    errors.push(`funnelOpportunities.${stageName} must contain 0 to 3 items`);
    return;
  }
  const ids = new Set();
  items.forEach((item, index) => {
    const label = `funnelOpportunities.${stageName}[${index}]`;
    if (!isObject(item)) return errors.push(`${label} must be an object`);
    if (!nonEmptyString(item.itemId)) errors.push(`${label}.itemId is required`);
    else if (ids.has(item.itemId)) errors.push(`Duplicate funnel itemId in ${stageName}: ${item.itemId}`);
    else ids.add(item.itemId);
    for (const field of ["concept", "userNeed", "rationale", "businessObjective", "nextAction"]) {
      validateNarrativeAtom(item[field], writerInput, `${label}.${field}`, errors, {
        className: WRITER_STATEMENT_CLASS.OPPORTUNITY,
        maxWords: field === "rationale" ? 100 : 70,
      });
    }
  });
}

function governedStatusForReference(writerInput, ref) {
  return governedStatusForWriterReference(writerInput, ref);
}

function validateLimitationStatus(item, writerInput, label, errors) {
  const governedStatuses = new Set();
  for (const field of ["clientExplanation", "whatThisMeans", "whatThisDoesNotMean"]) {
    for (const ref of item?.[field]?.evidenceRefs || []) {
      const status = governedStatusForReference(writerInput, ref);
      if (status !== undefined) governedStatuses.add(status);
    }
  }

  if (governedStatuses.size === 0) {
    errors.push(`${label}.status must be grounded in a governed source-status or capability reference`);
    return;
  }
  if (governedStatuses.size > 1) {
    errors.push(`${label}.status evidence resolves to conflicting governed statuses: ${[...governedStatuses].sort().join(", ")}`);
    return;
  }

  const [expectedStatus] = governedStatuses;
  if (item.status !== expectedStatus) {
    errors.push(`${label}.status must equal governed status ${expectedStatus}, got ${String(item.status)}`);
  }
}

function validateLimitations(items, writerInput, errors) {
  if (!Array.isArray(items) || items.length > 10) {
    errors.push("limitations must contain 0 to 10 items");
    return;
  }
  items.forEach((item, index) => {
    const label = `limitations[${index}]`;
    if (!isObject(item)) return errors.push(`${label} must be an object`);
    if (!nonEmptyString(item.itemId)) errors.push(`${label}.itemId is required`);
    if (!nonEmptyString(item.area)) errors.push(`${label}.area is required`);
    if (!nonEmptyString(item.status)) errors.push(`${label}.status is required`);
    for (const field of ["clientExplanation", "whatThisMeans", "whatThisDoesNotMean", "impactOnReport"]) {
      validateNarrativeAtom(item[field], writerInput, `${label}.${field}`, errors, {
        className: WRITER_STATEMENT_CLASS.INTERPRETATION,
        maxWords: 100,
      });
    }
    validateLimitationStatus(item, writerInput, label, errors);
  });
}

function validateActionPlan(items, writerInput, errors) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 5) {
    errors.push("actionPlan must contain 1 to 5 items");
    return;
  }
  const priorities = new Set();
  items.forEach((item, index) => {
    const label = `actionPlan[${index}]`;
    if (!isObject(item)) return errors.push(`${label} must be an object`);
    if (!nonEmptyString(item.actionId)) errors.push(`${label}.actionId is required`);
    if (!Number.isInteger(item.priority) || item.priority < 1 || item.priority > 5) errors.push(`${label}.priority must be an integer from 1 to 5`);
    else if (priorities.has(item.priority)) errors.push(`Duplicate action priority: ${item.priority}`);
    else priorities.add(item.priority);
    validateHeadline(item.title, `${label}.title`, errors);
    for (const field of ["action", "whyNow", "expectedBusinessEffect", "verification"]) {
      validateNarrativeAtom(item[field], writerInput, `${label}.${field}`, errors, {
        className: WRITER_STATEMENT_CLASS.OPPORTUNITY,
        maxWords: 100,
      });
    }
    if (!["L", "M", "H"].includes(item.effort)) errors.push(`${label}.effort must be L, M, or H`);
  });
}

function collectNarrativeAtoms(
  value,
  path = "writerOutput",
  atoms = [],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectNarrativeAtoms(
        item,
        `${path}[${index}]`,
        atoms,
      ),
    );

    return atoms;
  }

  if (!isObject(value)) {
    return atoms;
  }

  if (
    nonEmptyString(value.text) &&
    Array.isArray(value.evidenceRefs)
  ) {
    atoms.push({
      path,
      atom: value,
    });

    return atoms;
  }

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    collectNarrativeAtoms(
      child,
      `${path}.${key}`,
      atoms,
    );
  }

  return atoms;
}

function referenceSupportsAiSearch(
  writerInput,
  ref,
) {
  const record =
    writerInput?.referenceIndex?.[ref];

  const findingId =
    typeof ref === "string" &&
    ref.startsWith("finding:")
      ? ref.slice(
          "finding:".length,
        )
      : null;

  const finding =
    findingId &&
    Array.isArray(
      writerInput?.findings,
    )
      ? writerInput.findings.find(
          (item) =>
            item?.findingId ===
            findingId,
        )
      : null;

  const searchable =
    [
      ref,
      record?.path,
      finding?.module,
      finding?.dimension,
      finding?.title,
      finding?.description,
    ]
      .filter(Boolean)
      .join(" ");

  return /ai[_\s-]?search|schema|structured data|entity|citation/i.test(
    searchable,
  );
}

export function validateWriterSemanticFidelity(
  output,
  writerInput,
  errors = [],
) {
  const atoms =
    collectNarrativeAtoms(
      output,
    );

  const absencePattern =
    /\b(?:no|none|missing|absent|lacks?|without|does not have|do not have|not present|not found|not detected)\b/i;

  const boundedPartialPattern =
    /not detected.{0,50}(?:available|partial|assessed)|(?:available|partial|assessed|observed).{0,50}(?:assessment|coverage|evidence|pages?|sample)|does not establish|cannot establish/i;

  const commercialOutcomePattern =
    /\b(?:revenue|sales|leads?|enquiries|inquiries|conversions?|traffic|rankings?|engagement|abandonment|bounce rate|customers?|pipeline)\b/i;

  const causalCertaintyPattern =
    /\b(?:will|(?<!root-)(?<!root )causes?|caused|drives?|driven|results? in|led to|increases?|decreases?|reduces?|improves?|hurts?|damages?|loses?|costs?)\b/i;

  const boundedOutcomePattern =
    /\b(?:may|might|could|can|risk|potential|possible|likely|opportunity|suggests?|indicates?)\b/i;

  const negativeAiPattern =
    /\b(?:limited|limitation|weak|poor|missing|absent|lacks?|insufficient|not ready|cannot|can't)\b/i;

  const boundedAiPattern =
    /\b(?:may|might|could|potential|opportunity|not assessed|not established|does not establish|cannot establish|requires? (?:separate )?assessment)\b/i;

  const negatedAiEstablishmentPattern =
    /\bno\b[^.!?]{0,120}\b(?:limitation|constraint|weakness|gap)\b[^.!?]{0,80}\b(?:established|identified|observed|detected)\b/i;

  for (
    const { path, atom }
    of atoms
  ) {
    const text =
      atom.text || "";

    const statuses =
      new Set(
        (
          atom.evidenceRefs ||
          []
        )
          .map((ref) =>
            governedStatusForReference(
              writerInput,
              ref,
            ),
          )
          .filter(Boolean),
      );

    if (
      statuses.has("PARTIAL") &&
      absencePattern.test(text) &&
      !boundedPartialPattern.test(
        text,
      )
    ) {
      errors.push(
        `${path}.text converts PARTIAL evidence into an unqualified absence claim`,
      );
    }

    if (
      atom.statementClass ===
        WRITER_STATEMENT_CLASS.INTERPRETATION &&
      commercialOutcomePattern.test(
        text,
      ) &&
      causalCertaintyPattern.test(
        text,
      ) &&
      !boundedOutcomePattern.test(
        text,
      )
    ) {
      errors.push(
        `${path}.text states an unmeasured business outcome with causal certainty`,
      );
    }

    if (
      path.startsWith(
        "writerOutput.aiSearch.",
      ) &&
      atom.statementClass ===
        WRITER_STATEMENT_CLASS.INTERPRETATION &&
      negativeAiPattern.test(
        text,
      )
    ) {
      const hasDirectAiSupport =
        (
          atom.evidenceRefs ||
          []
        ).some((ref) =>
          referenceSupportsAiSearch(
            writerInput,
            ref,
          ),
        );

      if (
        !hasDirectAiSupport &&
        !boundedAiPattern.test(
          text,
        ) &&
        !negatedAiEstablishmentPattern.test(
          text,
        )
      ) {
        errors.push(
          `${path}.text converts non-AI evidence into an established AI-search limitation`,
        );
      }
    }
  }

  const influence =
    writerInput
      ?.deterministicAnalysis
      ?.conversionInfluence;

  const orderedFindingIds =
    Array.isArray(
      influence?.orderedFindingIds,
    )
      ? influence.orderedFindingIds
      : [];

  const byFindingId =
    isObject(
      influence?.byFindingId,
    )
      ? influence.byFindingId
      : {};

  if (
    orderedFindingIds.length > 0 &&
    Array.isArray(
      output?.actionPlan,
    )
  ) {
    output.actionPlan.forEach(
      (item, index) => {
        const expectedFindingId =
          orderedFindingIds[
            index
          ];

        if (!expectedFindingId) {
          errors.push(
            `actionPlan[${index}] exceeds the governed deterministic action order`,
          );

          return;
        }

        const expected =
          byFindingId[
            expectedFindingId
          ];

        if (!isObject(expected)) {
          errors.push(
            `actionPlan[${index}] is missing governed action data for ${expectedFindingId}`,
          );

          return;
        }

        if (
          Number.isInteger(
            expected.rank,
          ) &&
          item?.priority !==
            expected.rank
        ) {
          errors.push(
            `actionPlan[${index}].priority must equal governed rank ${expected.rank}`,
          );
        }

        if (
          ["L", "M", "H"].includes(
            expected.effort,
          ) &&
          item?.effort !==
            expected.effort
        ) {
          errors.push(
            `actionPlan[${index}].effort must equal governed effort ${expected.effort}`,
          );
        }

        const actionRefs =
          [
            item?.action,
            item?.whyNow,
            item
              ?.expectedBusinessEffect,
            item?.verification,
          ]
            .flatMap(
              (field) =>
                field
                  ?.evidenceRefs ||
                [],
            )
            .filter(
              (ref) =>
                typeof ref ===
                  "string" &&
                ref.startsWith(
                  "finding:",
                ),
            );

        if (
          actionRefs.length > 0 &&
          !actionRefs.includes(
            `finding:${expectedFindingId}`,
          )
        ) {
          errors.push(
            `actionPlan[${index}] does not follow governed finding order ${expectedFindingId}`,
          );
        }
      },
    );
  }

  return {
    valid:
      errors.length === 0,
    errors,
  };
}

function validateExecutiveDecision(value, writerInput, errors) {
  if (!isObject(value)) return errors.push("executiveDecision must be an object");
  for (const field of ["preserve", "change", "doNext"]) {
    validateNarrativeAtom(value[field], writerInput, `executiveDecision.${field}`, errors, {
      className: field === "doNext" ? WRITER_STATEMENT_CLASS.OPPORTUNITY : WRITER_STATEMENT_CLASS.INTERPRETATION,
      maxWords: 100,
    });
  }
}

function getPathValue(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function validateTargetedWriterRevision({ previousOutput, revisedOutput, revisionDirective }) {
  const errors = [];
  if (!isObject(previousOutput) || !isObject(revisedOutput)) return { valid: false, errors: ["previousOutput and revisedOutput are required"] };
  if (!isObject(revisionDirective) || revisionDirective.mode !== "TARGETED" || revisionDirective.required !== true) {
    return { valid: false, errors: ["A TARGETED revisionDirective is required for Pass 2 or Pass 3"] };
  }
  const rewrite = new Set(revisionDirective.fieldsToRewrite || []);
  for (const field of rewrite) if (!SECTION_PATH_SET.has(field)) errors.push(`Unknown rewrite field: ${field}`);

  for (const path of WRITER_OUTPUT_SECTION_PATHS) {
    if (rewrite.has(path)) continue;
    if (stableJson(getPathValue(previousOutput, path)) !== stableJson(getPathValue(revisedOutput, path))) {
      errors.push(`Unauthorized Writer change outside revision directive: ${path}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateWriterOutput(output, { writerInput, expectedPassNumber, previousOutput, revisionDirective } = {}) {
  const errors = [];
  if (!isObject(output)) return { valid: false, errors: ["Writer output must be an object"] };
  if (!isObject(writerInput)) return { valid: false, errors: ["writerInput is required"] };

  for (const field of TOP_LEVEL_REQUIRED) {
    if (!Object.hasOwn(output, field) || output[field] === undefined) errors.push(`Writer output missing required field: ${field}`);
  }
  for (const field of Object.keys(output)) {
    if (!TOP_LEVEL_ALLOWED.has(field)) errors.push(`Writer output contains unknown top-level field: ${field}`);
  }

  if (output.contractVersion !== "1.0.0") errors.push("contractVersion must equal 1.0.0");
  if (output.writerOutputVersion !== WRITER_OUTPUT_VERSION) errors.push(`writerOutputVersion must equal ${WRITER_OUTPUT_VERSION}`);
  if (output.auditId !== writerInput.auditId) errors.push(`auditId mismatch: ${String(output.auditId)} vs ${String(writerInput.auditId)}`);
  if (!Number.isInteger(output.passNumber) || output.passNumber < 1 || output.passNumber > 3) errors.push("passNumber must be an integer from 1 to 3");
  if (expectedPassNumber !== undefined && output.passNumber !== expectedPassNumber) errors.push(`passNumber mismatch: ${String(output.passNumber)} vs expected ${String(expectedPassNumber)}`);
  if (!nonEmptyString(output.modelId)) errors.push("modelId is required");
  if (output.promptVersion !== WRITER_PROMPT_VERSION) errors.push(`promptVersion must equal ${WRITER_PROMPT_VERSION}`);
  if (!nonEmptyString(output.generatedAt)) errors.push("generatedAt is required");

  if (!isObject(output.executiveConclusion)) errors.push("executiveConclusion must be an object");
  else {
    validateHeadline(output.executiveConclusion.headline, "executiveConclusion.headline", errors);
    validateNarrativeAtom(output.executiveConclusion.narrative, writerInput, "executiveConclusion.narrative", errors, {
      className: WRITER_STATEMENT_CLASS.INTERPRETATION,
      maxWords: 180,
    });
  }

  validateStrengths(output.strengths, writerInput, errors);
  validateRootCause(output.rootCause, writerInput, errors);
  for (const sectionName of Object.keys(STANDARD_SECTIONS)) {
    validateStandardSection(sectionName, output[sectionName], writerInput, errors);
  }

  if (!isObject(output.funnelOpportunities)) errors.push("funnelOpportunities must be an object");
  else {
    for (const stage of ["awareness", "consideration", "decision"]) {
      validateFunnelStage(stage, output.funnelOpportunities[stage], writerInput, errors);
    }
  }

  validateLimitations(output.limitations, writerInput, errors);
  validateActionPlan(output.actionPlan, writerInput, errors);
  validateExecutiveDecision(output.executiveDecision, writerInput, errors);
  validateWriterSemanticFidelity(output, writerInput, errors);

  if (output.passNumber > 1) {
    const targeted = validateTargetedWriterRevision({ previousOutput, revisedOutput: output, revisionDirective });
    errors.push(...targeted.errors);
  }

  return { valid: errors.length === 0, errors };
}

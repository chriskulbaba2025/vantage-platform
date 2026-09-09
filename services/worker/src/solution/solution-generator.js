import { createHash } from "node:crypto";
import {
  createSolutionRecord,
  normalizeIssueIdentity,
  normalizeToken,
} from "./solution-contract.js";
import { validateSolutionSet } from "./solution-validator.js";
import { planSequence } from "./solution-sequence.js";

const STRICTNESS = Object.freeze({ CONFIRMED: 0, PARTIAL: 1, UNKNOWN: 2 });
const ACTIVE_DISPOSITIONS = new Set(["FIX_NOW", "FIX_LATER"]);
const MATERIAL_FIELDS = Object.freeze([
  "prescriptionMode",
  "problem",
  "whyItMatters",
  "siteAnchor",
  "whatToChange",
  "howToFix",
  "capabilityRequired",
  "effortBand",
  "dependencies",
  "implementationCheck",
  "outcomeSignal",
  "disposition",
  "clientProminence",
  "crossPageReferences",
]);

export class SolutionGeneratorError extends Error {
  constructor(errors) {
    super("Canonical solution generation failed closed.");
    this.name = "SolutionGeneratorError";
    this.errors = errors;
  }
}

function error(stage, code, findingId, solutionId, field, message) {
  return { stage, code, findingId: findingId ?? null, solutionId: solutionId ?? null, field: field ?? null, message };
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function refKey(ref) {
  return typeof ref === "string" ? ref : ref?.refId || stable(ref);
}

function uniqueRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    const key = refKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(clone);
}

function directiveMap(input) {
  if (input instanceof Map) return new Map(input);
  if (!input || typeof input !== "object" || Array.isArray(input)) return new Map();
  return new Map(Object.entries(input));
}

function findingIdOf(finding) {
  return finding?.findingId ?? finding?.issueId ?? null;
}

function hierarchyActions(hierarchy) {
  if (!hierarchy || !Array.isArray(hierarchy.orderedFindingIds) || !Array.isArray(hierarchy.actions)) {
    throw new SolutionGeneratorError([error("input", "GEN-HIERARCHY", null, null, "decisionHierarchy", "decisionHierarchy requires orderedFindingIds and actions.")]);
  }
  const actionIds = hierarchy.actions.map((action) => action?.findingId);
  if (actionIds.length !== hierarchy.orderedFindingIds.length
    || actionIds.some((id, index) => id !== hierarchy.orderedFindingIds[index])) {
    throw new SolutionGeneratorError([error("input", "GEN-HIERARCHY", null, null, "decisionHierarchy", "decisionHierarchy action order is inconsistent with orderedFindingIds.")]);
  }
  const ranks = new Map();
  hierarchy.actions.forEach((action, index) => {
    if (!Number.isInteger(action?.rank) || action.rank < 1 || ranks.has(action.findingId)) {
      throw new SolutionGeneratorError([error("input", "GEN-HIERARCHY", action?.findingId, null, "decisionHierarchy.actions", "Every governed action requires a unique positive integer rank.")]);
    }
    ranks.set(action.findingId, action.rank);
    if (index > 0 && action.rank <= hierarchy.actions[index - 1].rank) {
      throw new SolutionGeneratorError([error("input", "GEN-HIERARCHY", action.findingId, null, "decisionHierarchy.actions", "orderedFindingIds must preserve ascending governed rank.")]);
    }
  });
  if (!Number.isInteger(hierarchy.actions[0]?.rank) || !String(hierarchy.provenance || "").trim()) {
    throw new SolutionGeneratorError([error("input", "GEN-HIERARCHY", null, null, "decisionHierarchy", "decisionHierarchy requires provenance and governed ranks.")]);
  }
  return { ranks, ordered: [...hierarchy.orderedFindingIds], rankSource: hierarchy.provenance };
}

function stableIdentity(directive, issueId) {
  const identityRecord = {
    issueId,
    siteAnchor: directive.siteAnchor,
  };
  const identityContext = { failureModes: new Map([[issueId, directive.failureMode]]) };
  return normalizeIssueIdentity(identityRecord, identityContext);
}

function solutionIdFor(identity) {
  return `SOL-${createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 16).toUpperCase()}`;
}

function normalizeDependencies(dependencies, issueToSolution, findingId) {
  if (!Array.isArray(dependencies)) return dependencies;
  return dependencies.map((dependency) => {
    const value = clone(dependency);
    if (value?.targetIssueId) {
      const targetSolutionId = issueToSolution.get(value.targetIssueId);
      if (!targetSolutionId) throw new SolutionGeneratorError([error("merge", "GEN-DEPENDENCY", findingId, null, "dependencies", `Dependency target ${value.targetIssueId} does not resolve.`)]);
      delete value.targetIssueId;
      value.targetSolutionId = targetSolutionId;
    }
    return value;
  });
}

function materialConflict(group, field) {
  const values = group.map(({ directive }) => stable(directive[field]));
  return new Set(values).size > 1;
}

function mergeGroup(group, hierarchy, issueToSolution) {
  const first = group[0];
  const conflicting = MATERIAL_FIELDS.filter((field) => materialConflict(group, field));
  if (conflicting.length) {
    throw new SolutionGeneratorError([error("merge", "GEN-MERGE-CONFLICT", first.findingId, null, conflicting.join(","), `Conflicting governed directives cannot merge for ${conflicting.join(", ")}.`)]);
  }
  const strictest = group.reduce((current, item) => STRICTNESS[item.directive.evidenceGrade] > STRICTNESS[current]
    ? item.directive.evidenceGrade : current, first.directive.evidenceGrade);
  const sourceFindingIds = group.map((item) => item.findingId);
  const mergedFrom = uniqueRefs(group.flatMap((item) => [item.findingId, ...(item.directive.mergedFrom || [])]));
  const findingRefs = uniqueRefs(group.flatMap((item) => item.directive.findingRefs || []));
  const evidenceRefs = uniqueRefs(group.flatMap((item) => item.directive.evidenceRefs || []));
  const solutionId = solutionIdFor(first.identity);
  const dependencies = normalizeDependencies(first.directive.dependencies, issueToSolution, first.findingId);
  const recordInput = {
    ...clone(first.directive),
    solutionId,
    issueId: first.findingId,
    mergedFrom,
    findingRefs,
    evidenceRefs,
    evidenceGrade: strictest,
    dependencies,
    sequenceInputs: {
      governedRank: Math.min(...group.map((item) => hierarchy.ranks.get(item.findingId))),
      rankSource: hierarchy.rankSource,
      dependencyState: dependencies.length ? "PENDING" : "READY",
      effortBand: first.directive.effortBand,
      eligibility: ACTIVE_DISPOSITIONS.has(first.directive.disposition),
    },
  };
  delete recordInput.failureMode;
  return createSolutionRecord(recordInput);
}

function assertInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SolutionGeneratorError([error("input", "GEN-INPUT", null, null, "input", "Generator input must be an object.")]);
  }
  if (!Array.isArray(input.findings) || input.findings.length === 0) {
    throw new SolutionGeneratorError([error("input", "GEN-FINDINGS", null, null, "findings", "findings must be a non-empty array.")]);
  }
  const ids = input.findings.map(findingIdOf);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new SolutionGeneratorError([error("input", "GEN-FINDINGS", null, null, "findings", "Every finding requires a unique findingId.")]);
  }
}

function validatorContext(input, findingIds, solutionIds) {
  const context = input.validationContext || {};
  if (!context.evidenceRefs) {
    throw new SolutionGeneratorError([error("input", "GEN-EVIDENCE-CONTEXT", null, null, "validationContext.evidenceRefs", "A persisted evidence resolver/context is required; generator will not treat directives as evidence.")]);
  }
  return {
    ...context,
    findingIds: context.findingIds || new Set(findingIds),
    mergedIds: context.mergedIds || new Set(findingIds),
    solutionIds: context.solutionIds || new Set(solutionIds),
  };
}

export function generateCanonicalSolutions(input) {
  assertInput(input);
  const hierarchy = hierarchyActions(input.decisionHierarchy);
  const findingsById = new Map(input.findings.map((finding) => [findingIdOf(finding), finding]));
  const directives = directiveMap(input.solutionDirectives || input.directives);
  const eligibleIds = new Set(hierarchy.ordered);
  const actionableInputIds = input.findings.filter((finding) => finding.actionable !== false).map(findingIdOf);
  const mismatch = actionableInputIds.filter((id) => !eligibleIds.has(id));
  if (mismatch.length) throw new SolutionGeneratorError([error("input", "GEN-HIERARCHY", mismatch[0], null, "decisionHierarchy", `Actionable finding ${mismatch[0]} is absent from the governed order.`)]);

  const entries = [];
  for (const findingId of hierarchy.ordered) {
    if (!findingsById.has(findingId)) throw new SolutionGeneratorError([error("input", "GEN-HIERARCHY", findingId, null, "findings", `Governed finding ${findingId} is missing.`)]);
    const directive = directives.get(findingId);
    if (!directive || typeof directive !== "object") throw new SolutionGeneratorError([error("input", "GEN-DIRECTIVE", findingId, null, "solutionDirectives", "An explicit governed solution directive is required.")]);
    if (!String(directive.failureMode || "").trim()) throw new SolutionGeneratorError([error("input", "GEN-DIRECTIVE", findingId, null, "failureMode", "failureMode is required for deterministic dedupe identity.")]);
    if (!Array.isArray(directive.findingRefs) || directive.findingRefs.length === 0) throw new SolutionGeneratorError([error("input", "GEN-DIRECTIVE", findingId, null, "findingRefs", "findingRefs must be explicitly supplied.")]);
    if (!Array.isArray(directive.evidenceRefs) || directive.evidenceRefs.length === 0) throw new SolutionGeneratorError([error("input", "GEN-DIRECTIVE", findingId, null, "evidenceRefs", "evidenceRefs must be explicitly supplied.")]);
    if (!directive.siteAnchor || typeof directive.siteAnchor !== "object") throw new SolutionGeneratorError([error("input", "GEN-DIRECTIVE", findingId, null, "siteAnchor", "siteAnchor must be explicitly supplied.")]);
    entries.push({ findingId, directive: clone(directive), identity: stableIdentity(directive, findingId) });
  }

  const groupsByIdentity = new Map();
  for (const entry of entries) {
    if (!groupsByIdentity.has(entry.identity)) groupsByIdentity.set(entry.identity, []);
    groupsByIdentity.get(entry.identity).push(entry);
  }
  const groups = [...groupsByIdentity.values()];
  const issueToSolution = new Map();
  for (const group of groups) issueToSolution.set(group[0].findingId, solutionIdFor(group[0].identity));
  for (const group of groups) for (const entry of group) issueToSolution.set(entry.findingId, solutionIdFor(group[0].identity));

  const records = groups
    .sort((a, b) => hierarchy.ranks.get(a[0].findingId) - hierarchy.ranks.get(b[0].findingId))
    .map((group) => mergeGroup(group, hierarchy, issueToSolution));
  const findingIds = input.findings.map(findingIdOf);
  const context = validatorContext(input, findingIds, records.map((record) => record.solutionId));
  const validation = validateSolutionSet(records, context);
  if (!validation.valid) throw new SolutionGeneratorError(validation.errors.map((item) => ({ stage: "validation", ...item })));
  const planned = planSequence(records);
  if (!planned.valid) throw new SolutionGeneratorError(planned.errors.map((item) => ({ stage: "sequence", ...item })));
  return {
    records,
    sequence: [...planned.sequence],
    activeSequence: [...planned.sequence],
  };
}

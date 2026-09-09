/**
 * PRYSM canonical Solution Authority Provider.
 *
 * This is the governed source for solution semantics. It is intentionally
 * separate from finding production, scoring, evidence hydration, and report
 * rendering. The registry never reads legacy finding prose to author a fix.
 */

import {
  buildSolutionDirectiveInput,
} from "./solution-directive-authority.js";
import { generateCanonicalSolutions } from "./solution-generator.js";

export const SOLUTION_AUTHORITY_PROVIDER_VERSION = "1.0.0";
export const SOLUTION_AUTHORITY_SOURCE =
  "prysm-static-solution-authority/1.0.0";
export const SOLUTION_RULE_VERSION = "4.1.1";

export const SOLUTION_PAGE_REGISTRY = Object.freeze([
  "executive-scorecard",
  "priority-fixes",
  "conversion-paths",
  "content-ideas",
  "competitor-benchmark",
  "trust-eeat",
  "supporting-detail",
]);

const REQUIRED_AUTHORITY_FIELDS = Object.freeze([
  "failureMode",
  "findingRefs",
  "evidenceRefs",
  "evidenceGrade",
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
  "disposition",
  "clientProminence",
  "crossPageReferences",
]);

export class SolutionAuthorityProviderError extends Error {
  constructor(code, ruleId, message) {
    super(message);
    this.name = "SolutionAuthorityProviderError";
    this.code = code;
    this.ruleId = ruleId ?? null;
  }
}

function fail(code, ruleId, message) {
  throw new SolutionAuthorityProviderError(code, ruleId, message);
}

function freezeEntry(entry) {
  return Object.freeze({
    ...entry,
    evidenceFields: Object.freeze([...entry.evidenceFields]),
    capabilityRequired: Object.freeze([...entry.capabilityRequired]),
    dependencies: Object.freeze([...entry.dependencies]),
    crossPageReferences: Object.freeze(
      entry.crossPageReferences.map((reference) => Object.freeze({ ...reference })),
    ),
  });
}

function entry({
  ruleId,
  failureMode,
  evidenceFields,
  anchorType,
  anchorLocator,
  problem,
  whyItMatters,
  whatToChange,
  howToFix,
  capabilityRequired,
  effortBand,
}) {
  return freezeEntry({
    ruleId,
    ruleVersion: SOLUTION_RULE_VERSION,
    failureMode,
    evidenceFields,
    evidenceGrade: "PARTIAL",
    prescriptionMode: "CONDITIONAL",
    problem,
    whyItMatters,
    anchorType,
    anchorLocator,
    whatToChange,
    howToFix,
    capabilityRequired,
    effortBand,
    dependencies: [],
    disposition: "FIX_LATER",
    clientProminence: {
      level: "SUPPORTING",
      displayAllowed: true,
      displayReason: "Explicit governed solution authority for a supported actionable rule.",
    },
    crossPageReferences: [
      { pageId: "priority-fixes", referenceType: "DETAIL", label: "Priority Fixes" },
    ],
  });
}

const REGISTRY_ENTRIES = [
  entry({
    ruleId: "VAN-CONTENT-001",
    failureMode: "insufficient-service-page-depth",
    evidenceFields: ["page_count", "services"],
    anchorType: "PAGE_TEMPLATE",
    anchorLocator: "service-page-template",
    problem: "The governed assessment indicates that primary service topics lack dedicated page depth.",
    whyItMatters: "Visitors may have less context for evaluating a service when the assessed topic lacks a dedicated page.",
    whatToChange: "If the governed service-depth condition remains present, create a focused page for each primary service topic.",
    howToFix: "Define the primary service set, create one scoped page per service, and verify that each page is present in the governed crawl.",
    capabilityRequired: ["CONTENT_STRATEGY", "COPY_CONTENT"],
    effortBand: "LARGE",
  }),
  entry({
    ruleId: "VAN-CONTENT-002",
    failureMode: "missing-buyer-decision-content",
    evidenceFields: ["trust.faq"],
    anchorType: "PAGE_TEMPLATE",
    anchorLocator: "buyer-decision-support-template",
    problem: "The governed assessment indicates that buyer decision-support content is incomplete.",
    whyItMatters: "Unanswered buyer questions may leave decision context unresolved at the assessed scope.",
    whatToChange: "If the governed decision-support gap remains present, add content that answers the relevant buyer questions at the scoped page or journey stage.",
    howToFix: "Collect the recurring questions for the assessed offer, publish bounded answers in the appropriate page component, and verify the component is present.",
    capabilityRequired: ["CONTENT_STRATEGY", "SUBJECT_MATTER_INPUT"],
    effortBand: "MEDIUM",
  }),
  entry({
    ruleId: "VAN-GSC-001",
    failureMode: "low-search-query-click-through",
    evidenceFields: ["query:"],
    anchorType: "EVIDENCE_ARTIFACT",
    anchorLocator: "governed-search-query-evidence",
    problem: "The governed search evidence identifies queries with low click-through activity.",
    whyItMatters: "Search-result messaging may not be aligned closely enough with the assessed query intent.",
    whatToChange: "If the governed low-click-through condition remains present, review the associated search-result messaging against the query intent.",
    howToFix: "Group the governed queries by intent, revise the relevant title and description messaging, and verify the updated pages against the same query set.",
    capabilityRequired: ["TECHNICAL_SEO", "COPY_CONTENT"],
    effortBand: "MEDIUM",
  }),
  entry({
    ruleId: "VAN-GSC-002",
    failureMode: "search-query-below-page-one",
    evidenceFields: ["query:"],
    anchorType: "EVIDENCE_ARTIFACT",
    anchorLocator: "governed-search-position-evidence",
    problem: "The governed search evidence identifies queries ranking below page one.",
    whyItMatters: "The assessed topics may have insufficient supporting content or internal context for the current search position.",
    whatToChange: "If the governed position gap remains present, expand the relevant topic content and strengthen its internal context.",
    howToFix: "Map each governed query to its best supporting page, expand the page to answer the topic, add relevant internal links, and verify the same query mapping.",
    capabilityRequired: ["CONTENT_STRATEGY", "TECHNICAL_SEO"],
    effortBand: "LARGE",
  }),
  entry({
    ruleId: "VAN-GSC-003",
    failureMode: "search-demand-content-gap",
    evidenceFields: ["search_demand"],
    anchorType: "EVIDENCE_ARTIFACT",
    anchorLocator: "governed-search-demand-evidence",
    problem: "The governed search evidence identifies demand without matching dedicated content depth.",
    whyItMatters: "The assessed demand may not have a clear content destination that supports evaluation.",
    whatToChange: "If the governed demand/content gap remains present, create bounded content for the highest-priority assessed topics.",
    howToFix: "Select topics from the governed demand evidence, assign each to a clear page purpose, publish the content, and verify its indexed page destination.",
    capabilityRequired: ["CONTENT_STRATEGY", "COPY_CONTENT"],
    effortBand: "LARGE",
  }),
  entry({
    ruleId: "VAN-PATH-001",
    failureMode: "conversion-action-obstruction",
    evidenceFields: ["conversion.path.obstruction"],
    anchorType: "CTA",
    anchorLocator: "primary-conversion-action",
    problem: "The governed path evidence identifies an obstruction at the primary conversion action.",
    whyItMatters: "An obstructed action may prevent visitors from reaching the assessed next step.",
    whatToChange: "If the governed obstruction remains present, remove or reposition the blocking interface element at the primary conversion action.",
    howToFix: "Inspect the obstructing overlay or stacked element at the governed CTA scope, adjust its layout or behavior, and re-run the same path check.",
    capabilityRequired: ["UX_DESIGN", "FRONT_END_DEVELOPMENT"],
    effortBand: "MEDIUM",
  }),
  entry({
    ruleId: "VAN-PERF-001",
    failureMode: "slow-largest-contentful-paint",
    evidenceFields: ["lcp_ms"],
    anchorType: "COMPONENT",
    anchorLocator: "largest-above-fold-asset",
    problem: "The governed performance evidence identifies a slow largest contentful paint.",
    whyItMatters: "Delayed above-the-fold rendering may make the assessed page feel less responsive before its primary content is visible.",
    whatToChange: "If the governed LCP condition remains present, optimize the largest above-the-fold asset and remove render-blocking work in the assessed path.",
    howToFix: "Identify the governed LCP element, reduce its transfer or render cost, remove blocking work, and repeat the same performance measurement.",
    capabilityRequired: ["FRONT_END_DEVELOPMENT", "HOSTING_PLATFORM_CONFIGURATION"],
    effortBand: "MEDIUM",
  }),
  entry({
    ruleId: "VAN-SCHEMA-001",
    failureMode: "missing-structured-data",
    evidenceFields: ["schema_types"],
    anchorType: "COMPONENT",
    anchorLocator: "structured-data-block",
    problem: "The governed site evidence indicates that structured data was not detected in the assessed scope.",
    whyItMatters: "Explicit entity context may remain incomplete for systems interpreting the assessed pages.",
    whatToChange: "If the governed structured-data gap remains present, add only schema types supported by the assessed organization, service, and page content.",
    howToFix: "Model the supported entities from the governed page content, publish valid structured data, and verify the emitted types on the same scoped pages.",
    capabilityRequired: ["TECHNICAL_SEO", "FRONT_END_DEVELOPMENT"],
    effortBand: "MEDIUM",
  }),
  entry({
    ruleId: "VAN-TECH-001",
    failureMode: "missing-meta-description",
    evidenceFields: ["meta_description"],
    anchorType: "URL",
    anchorLocator: "assessed-page-url",
    problem: "The governed page evidence indicates that meta descriptions are missing in the assessed scope.",
    whyItMatters: "Search-result messaging may be less controlled for the assessed pages.",
    whatToChange: "If the governed meta-description gap remains present, write a distinct description for each affected assessed page.",
    howToFix: "Draft page-specific descriptions from the actual page purpose, publish them in the page metadata, and verify them on the same URLs.",
    capabilityRequired: ["COPY_CONTENT", "TECHNICAL_SEO"],
    effortBand: "MEDIUM",
  }),
  entry({
    ruleId: "VAN-TECH-002",
    failureMode: "inconsistent-heading-structure",
    evidenceFields: ["h1_missing", "h1_multiple"],
    anchorType: "HEADING",
    anchorLocator: "page-heading-structure",
    problem: "The governed page evidence indicates inconsistent heading structure in the assessed scope.",
    whyItMatters: "Visitors and systems may have less consistent structure for understanding the page content.",
    whatToChange: "If the governed heading condition remains present, establish one descriptive H1 and an ordered section hierarchy on each affected page.",
    howToFix: "Review the affected page headings, assign one H1 and sequential section headings, publish the change, and verify the resulting hierarchy.",
    capabilityRequired: ["COPY_CONTENT", "TECHNICAL_SEO"],
    effortBand: "MEDIUM",
  }),
  entry({
    ruleId: "VAN-TECH-003",
    failureMode: "missing-security-response-headers",
    evidenceFields: ["security_headers"],
    anchorType: "RESPONSE_ENVIRONMENT",
    anchorLocator: "assessed-response-headers",
    problem: "The governed response evidence indicates that required security response headers are incomplete in the assessed scope.",
    whyItMatters: "The response environment may not express the intended browser-side safety controls consistently.",
    whatToChange: "If the governed header gap remains present, configure the missing supported response headers at the delivery boundary.",
    howToFix: "Add the governed header configuration at the hosting or edge boundary, deploy it through the normal change process, and verify the response headers on the assessed URL.",
    capabilityRequired: ["HOSTING_PLATFORM_CONFIGURATION", "FRONT_END_DEVELOPMENT"],
    effortBand: "LARGE",
  }),
  entry({
    ruleId: "VAN-TECH-004",
    failureMode: "missing-image-alternative-text",
    evidenceFields: ["images_missing_alt"],
    anchorType: "COMPONENT",
    anchorLocator: "meaningful-image-component",
    problem: "The governed page evidence indicates that meaningful images lack alternative text in the assessed scope.",
    whyItMatters: "People using assistive technology may receive less information from the assessed visual content.",
    whatToChange: "If the governed alternative-text gap remains present, add concise text alternatives to meaningful images and keep decorative images empty.",
    howToFix: "Classify each affected image, add an accurate text alternative for meaningful content, and verify the rendered attributes on the same pages.",
    capabilityRequired: ["ACCESSIBILITY_REVIEW", "COPY_CONTENT"],
    effortBand: "MEDIUM",
  }),
  entry({
    ruleId: "VAN-TECH-005",
    failureMode: "missing-image-dimensions",
    evidenceFields: ["images_missing_dimensions"],
    anchorType: "COMPONENT",
    anchorLocator: "rendered-image-component",
    problem: "The governed page evidence indicates that rendered images lack explicit dimensions in the assessed scope.",
    whyItMatters: "The page may have less stable layout behavior while image resources load.",
    whatToChange: "If the governed image-dimension gap remains present, set explicit width and height for the affected rendered images.",
    howToFix: "Add intrinsic dimensions or an equivalent governed aspect-ratio reservation to each affected image component, then verify layout stability.",
    capabilityRequired: ["FRONT_END_DEVELOPMENT"],
    effortBand: "MEDIUM",
  }),
  entry({
    ruleId: "VAN-TRUST-001",
    failureMode: "missing-visible-trust-proof",
    evidenceFields: ["trust.testimonials", "trust.credentials", "trust.caseStudies"],
    anchorType: "MISSING_ELEMENT",
    anchorLocator: "visible-trust-proof",
    problem: "The governed site evidence indicates that visible trust proof is missing in the assessed scope.",
    whyItMatters: "Visitors may have fewer site-specific signals for evaluating credibility before deciding what to do next.",
    whatToChange: "If the governed trust-proof gap remains present, add accurate credentials, client proof, or case-study evidence that the business can substantiate.",
    howToFix: "Select substantiated proof, place it beside the relevant decision point, label it accurately, and verify that it is visible in the assessed page scope.",
    capabilityRequired: ["CONTENT_STRATEGY", "SUBJECT_MATTER_INPUT"],
    effortBand: "MEDIUM",
  }),
  entry({
    ruleId: "VAN-TRUST-002",
    failureMode: "missing-pricing-risk-reassurance",
    evidenceFields: ["trust.pricing"],
    anchorType: "MISSING_ELEMENT",
    anchorLocator: "pricing-or-risk-reassurance",
    problem: "The governed site evidence indicates that pricing or risk-reassurance information is missing in the assessed scope.",
    whyItMatters: "Visitors may have unresolved practical questions before deciding whether to continue.",
    whatToChange: "If the governed reassurance gap remains present, add only substantiated pricing guidance or risk-reassurance content appropriate to the offer.",
    howToFix: "Confirm the information with the business, place it at the relevant decision point, state its limits clearly, and verify the published content.",
    capabilityRequired: ["CONTENT_STRATEGY", "SUBJECT_MATTER_INPUT"],
    effortBand: "LARGE",
  }),
];

export function createSolutionAuthorityRegistry(entries = REGISTRY_ENTRIES) {
  if (!Array.isArray(entries) || entries.length === 0) {
    fail("AUTHORITY-REGISTRY", null, "Solution authority registry must be a non-empty array.");
  }
  const registry = {};
  for (const candidate of entries) {
    if (!candidate || typeof candidate !== "object") {
      fail("AUTHORITY-REGISTRY", null, "Every solution authority entry must be an object.");
    }
    const key = `${candidate.ruleId}@${candidate.ruleVersion}`;
    if (!candidate.ruleId || !candidate.ruleVersion || registry[key]) {
      fail("AUTHORITY-DUPLICATE", candidate.ruleId, `Duplicate or malformed solution authority key: ${key}`);
    }
    registry[key] = freezeEntry(candidate);
  }
  return Object.freeze(registry);
}

export const SOLUTION_AUTHORITY_REGISTRY = createSolutionAuthorityRegistry();
export const SUPPORTED_SOLUTION_RULE_IDS = Object.freeze(
  REGISTRY_ENTRIES.map((candidate) => candidate.ruleId),
);

function explicitEvidenceRef(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return "";
  for (const key of ["refId", "evidenceRefId", "persistedEvidenceId", "rawArtifactRef", "artifactRef"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return "";
}

function fieldMatches(field, configuredField) {
  return configuredField.endsWith(":")
    ? typeof field === "string" && field.startsWith(configuredField)
    : field === configuredField;
}

function resolveEvidenceRefs(finding, configuredFields, ruleId) {
  const refs = [];
  for (const record of finding?.evidence || []) {
    if (!configuredFields.some((field) => fieldMatches(record?.field, field))) continue;
    const ref = explicitEvidenceRef(record);
    if (ref && !refs.includes(ref)) refs.push(ref);
  }
  if (refs.length === 0) {
    fail("AUTH-EVIDENCE-REF", ruleId, "No explicit governed evidence reference matches the registry selector.");
  }
  return refs.map((refId) => ({ refId }));
}

function buildAuthorityRecord(entryDefinition, finding, decisionEvidence, pageRegistry) {
  const ruleId = finding.ruleId;
  const scope = decisionEvidence?.site?.targetUrl;
  if (typeof scope !== "string" || scope.trim().length === 0) {
    fail("AUTH-ANCHOR", ruleId, "DecisionEvidence.site.targetUrl is required for the governed site anchor scope.");
  }
  const evidenceRefs = resolveEvidenceRefs(
    finding,
    entryDefinition.evidenceFields,
    ruleId,
  );
  const implementationCheck = {
    checkId: `SOLUTION-CHECK-${ruleId}`,
    instruction: `Inspect the governed ${entryDefinition.anchorLocator} at the assessed scope.`,
    passCondition: "The explicitly governed change is present at the assessed scope.",
    failCondition: "The explicitly governed change is absent at the assessed scope.",
    anchorScope: scope.trim(),
  };
  const record = {
    failureMode: entryDefinition.failureMode,
    findingRefs: [finding.findingId],
    evidenceRefs,
    evidenceGrade: entryDefinition.evidenceGrade,
    prescriptionMode: entryDefinition.prescriptionMode,
    problem: entryDefinition.problem,
    whyItMatters: entryDefinition.whyItMatters,
    siteAnchor: {
      type: entryDefinition.anchorType,
      locator: entryDefinition.anchorLocator,
      scope: scope.trim(),
      exact: true,
      evidenceRefIds: evidenceRefs.map((reference) => reference.refId),
    },
    whatToChange: entryDefinition.whatToChange,
    howToFix: entryDefinition.howToFix,
    capabilityRequired: [...entryDefinition.capabilityRequired],
    effortBand: entryDefinition.effortBand,
    dependencies: entryDefinition.dependencies.map((dependency) => ({ ...dependency })),
    implementationCheck,
    disposition: entryDefinition.disposition,
    clientProminence: { ...entryDefinition.clientProminence },
    crossPageReferences: entryDefinition.crossPageReferences.map((reference) => ({ ...reference })),
  };
  for (const field of REQUIRED_AUTHORITY_FIELDS) {
    if (!Object.hasOwn(record, field)) fail("AUTHORITY-INCOMPLETE", ruleId, `Registry output is missing ${field}.`);
  }
  if (Object.hasOwn(record, "outcomeSignal")) fail("AUTHORITY-INCOMPLETE", ruleId, "outcomeSignal is not allowed without explicit governance.");
  if (!pageRegistry.has("priority-fixes")) fail("AUTH-PAGE", ruleId, "The governed page registry must contain priority-fixes.");
  return record;
}

function normalizePageRegistry(pageRegistry) {
  if (pageRegistry instanceof Set) return new Set([...pageRegistry].map(String));
  if (Array.isArray(pageRegistry)) return new Set(pageRegistry.map(String));
  if (pageRegistry && typeof pageRegistry === "object") return new Set(Object.keys(pageRegistry));
  fail("AUTH-PAGE", null, "pageRegistry must be an explicit Set, array, or keyed object.");
}

function indexRegistry(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    fail("AUTHORITY-REGISTRY", null, "Solution authority registry must be a keyed object.");
  }
  const indexed = new Map();
  for (const [key, definition] of Object.entries(registry)) {
    if (indexed.has(key) || !definition?.ruleId || !definition?.ruleVersion) {
      fail("AUTHORITY-DUPLICATE", definition?.ruleId, `Malformed or duplicate registry key: ${key}`);
    }
    indexed.set(key, definition);
  }
  return indexed;
}

export function buildSolutionAuthorityRecords({
  findings,
  scoreSet,
  decisionEvidence,
  pageRegistry = SOLUTION_PAGE_REGISTRY,
  registry = SOLUTION_AUTHORITY_REGISTRY,
}) {
  if (!Array.isArray(findings) || !findings.length) fail("AUTHORITY-INPUT", null, "findings must be a non-empty array.");
  if (!scoreSet || typeof scoreSet !== "object") fail("AUTHORITY-INPUT", null, "scoreSet is required.");
  if (!decisionEvidence || typeof decisionEvidence !== "object") fail("AUTHORITY-INPUT", null, "decisionEvidence is required.");
  const hierarchyIds = scoreSet.decisionHierarchy?.orderedFindingIds;
  if (!Array.isArray(hierarchyIds)) fail("AUTHORITY-HIERARCHY", null, "ScoreSet decisionHierarchy.orderedFindingIds is required.");
  const findingById = new Map();
  for (const finding of findings) {
    if (!finding?.findingId || findingById.has(finding.findingId)) fail("AUTHORITY-DUPLICATE", finding?.findingId, "Findings must have unique findingId values.");
    findingById.set(finding.findingId, finding);
  }
  const indexed = indexRegistry(registry);
  const pages = normalizePageRegistry(pageRegistry);
  const authorityRecords = {};
  for (const findingId of hierarchyIds) {
    const finding = findingById.get(findingId);
    if (!finding) fail("AUTHORITY-HIERARCHY", findingId, "A hierarchy finding is missing from findings.");
    const key = `${finding.ruleId}@${finding.ruleVersion}`;
    const definition = indexed.get(key);
    if (!definition) {
      const sameRule = [...indexed.values()].some((candidate) => candidate.ruleId === finding.ruleId);
      fail(sameRule ? "AUTHORITY-VERSION" : "AUTHORITY-UNSUPPORTED", finding.ruleId, `No exact governed authority exists for ${key}.`);
    }
    authorityRecords[findingId] = buildAuthorityRecord(definition, finding, decisionEvidence, pages);
  }
  return Object.freeze(authorityRecords);
}

export function buildCanonicalSolutionSet({
  findings,
  scoreSet,
  decisionEvidence,
  pageRegistry = SOLUTION_PAGE_REGISTRY,
  registry = SOLUTION_AUTHORITY_REGISTRY,
}) {
  const authorityRecords = buildSolutionAuthorityRecords({
    findings,
    scoreSet,
    decisionEvidence,
    pageRegistry,
    registry,
  });
  const authorityInput = buildSolutionDirectiveInput({
    findings,
    scoreSet,
    decisionEvidence,
    authorityRecords,
    pageRegistry,
  });
  return generateCanonicalSolutions(authorityInput);
}

export default {
  SOLUTION_AUTHORITY_PROVIDER_VERSION,
  SOLUTION_AUTHORITY_SOURCE,
  SOLUTION_AUTHORITY_REGISTRY,
  SUPPORTED_SOLUTION_RULE_IDS,
  buildSolutionAuthorityRecords,
  buildCanonicalSolutionSet,
  createSolutionAuthorityRegistry,
};

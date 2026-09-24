/**
 * Frozen Conversion Friction Encyclopedia authority.
 *
 * This module is diagnostic metadata only. It does not score findings, select
 * narrative states, or claim that evidence exists for a problem.
 */

export const ENCYCLOPEDIA_CONTRACT_VERSION = "1.0.0";

export const DIAGNOSTIC_AREAS = Object.freeze([
  "Acquisition and Search Entry",
  "Site Structure and Findability",
  "Offer and Page Understanding",
  "Content and Decision Support",
  "Trust, Proof and Risk Reduction",
  "Conversion Actions and Lead Capture",
  "Booking, Commerce and Completion",
  "Mobile, Accessibility and Interaction",
  "Performance, Delivery and Reliability",
  "Technical Integrity and Search Foundations",
  "Measurement and Experimentation",
  "Evidence, Scope and Business Context",
]);

export const FRICTION_STATES = Object.freeze({
  CLEAR: "CLEAR",
  WATCH: "WATCH",
  FRICTION: "FRICTION",
  NOT_ENOUGH_EVIDENCE: "NOT_ENOUGH_EVIDENCE",
});

export const RELATIONSHIP_TYPES = Object.freeze([
  "Repeats",
  "Compounds",
  "Depends on",
  "May share a cause",
  "Same journey point",
  "Duplicate symptom",
]);

const PAGE_ROLES = Object.freeze(["home", "landing", "service", "product", "pricing", "contact", "booking", "checkout", "utility", "template", "external-flow", "unknown"]);
const PAGE_INTENTS = Object.freeze(["High", "Medium", "Low", "Unknown"]);
const SCOPES = Object.freeze(["section", "page", "template", "device", "site", "external flow"]);
const OBSERVATION_MODES = Object.freeze(["direct", "mapped", "bounded", "unavailable"]);
const DISPOSITIONS = Object.freeze(["Repair", "Investigate", "Collect evidence", "Opportunity", "Preserve", "Do nothing"]);
const REMEDY_MODES = Object.freeze(["outcome-level", "mechanism-specific"]);

const ROWS = `
A01|Search entry does not match buyer intent|Acquisition issue|Acquire
A02|Important page is not discoverable or indexable|Acquisition issue|Acquire
A03|Search-result message is unclear or misaligned|Acquisition issue|Acquire
A04|Local search relevance is incomplete or inconsistent|Acquisition issue|Acquire
A05|Language or geographic targeting is mismatched|Acquisition issue|Acquire
A06|Key offer or entity information is unclear to search and answer systems|Acquisition issue|Acquire
B01|Navigation hides an important path|Conversion influence|Understand
B02|Information architecture makes important content difficult to find|Conversion influence|Understand
B03|Internal links do not support buyer progression|Conversion influence|Decide
B04|Important page is orphaned or weakly connected|Technical foundation issue|Understand
B05|URL or path integrity creates dead ends or confusion|Technical foundation issue|Understand
B06|Site search fails to surface relevant choices|Conversion influence|Decide
C01|Page purpose is unclear|Direct conversion friction|Understand
C02|Offer or value proposition is unclear|Direct conversion friction|Understand
C03|Intended customer or fit is unclear|Conversion influence|Understand
C04|Differentiation is unclear|Conversion influence|Decide
C05|The decision path is unclear|Direct conversion friction|Decide
C06|Important page information conflicts or contradicts itself|Direct conversion friction|Decide
C07|Important context appears too late for the decision being asked|Conversion influence|Understand
D01|Important buyer questions are unanswered|Conversion influence|Decide
D02|Critical service or product details are missing|Conversion influence|Decide
D03|Cost or pricing expectations are unclear where they materially affect the decision|Conversion influence|Decide
D04|Process, timing or next-step expectations are unclear|Conversion influence|Decide
D05|Material objections are not addressed|Conversion influence|Decide
D06|Content is too thin or generic to support the decision|Conversion influence|Understand
D07|Content overload or weak hierarchy makes the decision harder|Direct conversion friction|Decide
E01|Important trust proof is absent where it is needed|Conversion influence|Trust
E02|Proof does not clearly support the claim or offer|Conversion influence|Trust
E03|Useful proof appears at the wrong point in the decision|Conversion influence|Trust
E04|Relevant expertise or authority is not demonstrated|Conversion influence|Trust
E05|Important risk reducers, policies or assurances are unclear|Conversion influence|Trust
E06|Brand or visual inconsistency weakens confidence|Conversion influence|Trust
E07|Privacy, security or consent experience undermines confidence or action|Conversion influence|Trust
F01|Primary action control is unclear|Direct conversion friction|Act
F02|Primary action is difficult to see or reach|Direct conversion friction|Act
F03|Action wording and destination do not match|Direct conversion friction|Act
F04|Form submission is broken or fails|Direct conversion friction|Act
F05|Form requests unnecessary or excessive information|Direct conversion friction|Act
F06|Form instructions, requirements or errors are unclear|Direct conversion friction|Act
F07|Phone or contact path is broken or difficult to use|Direct conversion friction|Act
F08|Competing actions create unnecessary decision friction|Direct conversion friction|Act
G01|Booking flow is broken or unavailable|Direct conversion friction|Complete
G02|Booking flow contains unnecessary steps or confusion|Direct conversion friction|Complete
G03|Product, service or option selection is difficult|Direct conversion friction|Decide
G04|Cart or checkout flow is broken|Direct conversion friction|Complete
G05|Checkout creates avoidable completion friction|Direct conversion friction|Complete
G06|Payment, shipping, tax or fulfilment expectations are unclear|Conversion influence|Complete
G07|Post-conversion confirmation or next steps are unclear|Conversion influence|Complete
H01|Mobile layout obstructs important content or action|Direct conversion friction|Act
H02|Tap targets or controls are difficult to use|Direct conversion friction|Act
H03|Keyboard or focus behaviour creates an interaction barrier|Direct conversion friction|Act
H04|Important visual or media content is inaccessible|Conversion influence|Understand
H05|Contrast or readability creates a usability barrier|Direct conversion friction|Understand
H06|Layout movement disrupts reading or interaction|Direct conversion friction|Act
H07|Interaction response is slow enough to interfere with use|Direct conversion friction|Act
I01|Slow primary content display|Conversion influence|Understand
I02|General page loading or response delay|Conversion influence|Understand
I03|Third-party resources delay or block important experience|Technical foundation issue|Act
I04|Resource delivery is inefficient|Technical foundation issue|Understand
I05|Server, hosting or CDN reliability is poor|Technical foundation issue|Acquire
I06|Page or site is unavailable or repeatedly fails|Direct conversion friction|Act
J01|Indexing directives unintentionally block an important page|Acquisition issue|Acquire
J02|Broken links, redirects or errors interfere with access|Technical foundation issue|Understand
J03|Document structure makes content harder to understand or interpret|Technical foundation issue|Understand
J04|Structured data is invalid, misleading or materially absent|Technical foundation issue|Acquire
J05|Duplicate or canonicalized content creates ambiguity|Technical foundation issue|Acquire
J06|CMS, template or migration defect creates repeated site-wide errors|Technical foundation issue|Understand
K01|Primary conversion action is not measured|Evidence/measurement limitation|Act
K02|Analytics data is incomplete, duplicated or misconfigured|Evidence/measurement limitation|Complete
K03|Funnel or source attribution cannot answer the key business question|Evidence/measurement limitation|Complete
K04|A change cannot be evaluated against a usable baseline|Evidence/measurement limitation|Complete
L01|Evidence coverage is insufficient for the judgment|Evidence/measurement limitation|Relevant stage
L02|Evidence is stale, conflicting or unrepresentative|Evidence/measurement limitation|Relevant stage
L03|Business goal, page role or conversion objective is unclear or mismatched|Evidence/measurement limitation|Relevant stage
L04|Third-party, ownership or platform constraints prevent reliable diagnosis or repair|Evidence/measurement limitation|Relevant stage
`.trim().split("\n").map((row) => row.split("|"));

const AREA_BY_PREFIX = Object.freeze({ A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11 });

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function buildProblem([id, name, classification, journeyStage]) {
  const area = DIAGNOSTIC_AREAS[AREA_BY_PREFIX[id[0]]];
  const measurement = classification === "Evidence/measurement limitation";
  const direct = classification === "Direct conversion friction";
  const pageRole = journeyStage === "Complete" ? "checkout" : journeyStage === "Act" ? "contact" : journeyStage === "Trust" ? "service" : "landing";
  return {
    id,
    name,
    diagnosticArea: area,
    definition: `Observable condition represented by ${id}: ${name}.`,
    applicability: measurement ? "Apply only when the governed measurement or audit-evidence boundary is material." : "Apply only when the governed website evidence establishes the condition in scope.",
    observationMode: "direct",
    primaryClassification: classification,
    primaryJourneyStage: journeyStage,
    secondaryJourneyStage: null,
    pageRole,
    pageIntent: "Unknown",
    primaryConversionAction: journeyStage === "Complete" ? "complete" : journeyStage === "Act" ? "contact or submit" : "continue decision",
    secondaryConversionActions: [],
    scope: "page",
    deviceContext: "unspecified",
    observableSignals: [id],
    requiredEvidence: [`evidence:${id}`],
    evidenceSufficiencyRule: "Known evidence may support a bounded conclusion; missing evidence cannot create a negative finding.",
    evidenceLineageKey: `canonical:${id}`,
    evidenceIndependenceKey: `observation:${id}`,
    evidenceFreshnessRule: "Use evidence current enough for the affected page, device, flow or system.",
    conflictingEvidenceRule: "Preserve material conflict; narrow, downgrade or collect evidence.",
    clientFacingFrictionStateRule: measurement ? "Not enough evidence unless the audit-level limitation is established." : "Clear, Watch, Friction or Not enough evidence according to evidence and materiality review.",
    materialityRule: direct ? "Material when it affects an important action or decision in governed scope." : "Material only when it affects the stated buyer or audit objective.",
    whyItMayMatter: `${name} may make the governed buyer decision or audit judgment harder, without proving business-outcome causation.`,
    firstDiagnosticChecks: [`Confirm the observed ${id} condition at its recorded scope.`, "Check a plausible alternative explanation without assuming cause.", "Retest the affected page, template, device or flow."],
    prohibitedAssumptions: ["does not prove conversion loss", "does not prove a mechanism without mechanism evidence", "does not expand beyond recorded scope"],
    possibleFindings: [name],
    likelyHelpNeeded: measurement ? ["analytics or measurement specialist"] : ["website owner or implementation specialist"],
    ownershipConstraints: ["Third-party ownership remains explicit where applicable."],
    repairRisk: direct ? "medium" : "low",
    positivePatternToPreserve: "Preserve working content, proof, paths and device behavior outside the proven affected boundary.",
    verificationMethod: `Retest the ${id} condition at the governed scope and preserve outcome measurement as a separate question.`,
    relationshipEligibility: ["same page", "same template", "same conversion action", "known dependency", "same buyer decision"],
    duplicateFingerprint: `condition:${id}`,
    criticalBlockerEligibility: ["F04", "G01", "G04", "I06"].includes(id),
    disposition: measurement ? "Collect evidence" : "Investigate",
    remedySpecificity: "outcome-level",
    mechanismEvidenceStatus: "unknown",
    businessOutcomeEvidenceStatus: "not available",
    reportPlacement: ["priority-fixes", "supporting-detail"],
  };
}

export const CANONICAL_PROBLEMS = freeze(ROWS.map(buildProblem));
export const CANONICAL_PROBLEM_BY_ID = freeze(Object.fromEntries(CANONICAL_PROBLEMS.map((problem) => [problem.id, problem])));

export function validateEncyclopediaRegistry(registry = CANONICAL_PROBLEMS) {
  const errors = [];
  if (!Array.isArray(registry) || registry.length !== 75) errors.push("Registry must contain exactly 75 canonical problems.");
  const ids = new Set();
  for (const problem of registry || []) {
    if (!problem || typeof problem !== "object") { errors.push("Every canonical problem must be an object."); continue; }
    if (ids.has(problem.id)) errors.push(`Duplicate canonical problem ID: ${problem.id}`);
    ids.add(problem.id);
    for (const field of ["id", "name", "diagnosticArea", "definition", "applicability", "observationMode", "primaryClassification", "primaryJourneyStage", "pageRole", "pageIntent", "primaryConversionAction", "scope", "deviceContext", "evidenceLineageKey", "evidenceIndependenceKey", "clientFacingFrictionStateRule", "materialityRule", "whyItMayMatter", "verificationMethod", "duplicateFingerprint", "disposition", "remedySpecificity", "reportPlacement"]) {
      if (problem[field] === undefined || problem[field] === null || problem[field] === "") errors.push(`${problem.id || "?"}.${field} is required.`);
    }
    if (!DIAGNOSTIC_AREAS.includes(problem.diagnosticArea)) errors.push(`${problem.id}.diagnosticArea is not governed.`);
    if (!PAGE_ROLES.includes(problem.pageRole)) errors.push(`${problem.id}.pageRole is not governed.`);
    if (!PAGE_INTENTS.includes(problem.pageIntent)) errors.push(`${problem.id}.pageIntent is not governed.`);
    if (!SCOPES.includes(problem.scope)) errors.push(`${problem.id}.scope is not governed.`);
    if (!OBSERVATION_MODES.includes(problem.observationMode)) errors.push(`${problem.id}.observationMode is not governed.`);
    if (!DISPOSITIONS.includes(problem.disposition)) errors.push(`${problem.id}.disposition is not governed.`);
    if (!REMEDY_MODES.includes(problem.remedySpecificity)) errors.push(`${problem.id}.remedySpecificity is not governed.`);
    if (!Object.values(FRICTION_STATES).some((state) => problem.clientFacingFrictionStateRule.includes(state.replaceAll("_", " ")) || problem.clientFacingFrictionStateRule.includes("Clear") || problem.clientFacingFrictionStateRule.includes("Not enough evidence"))) {
      errors.push(`${problem.id}.clientFacingFrictionStateRule must reference governed states.`);
    }
    if (!Array.isArray(problem.firstDiagnosticChecks) || problem.firstDiagnosticChecks.length !== 3) errors.push(`${problem.id} must have exactly three diagnostic checks.`);
  }
  if (new Set(registry.map((problem) => problem.diagnosticArea)).size !== 12) errors.push("Registry must cover all 12 diagnostic areas.");
  return { valid: errors.length === 0, errors };
}

const registryValidation = validateEncyclopediaRegistry();
if (!registryValidation.valid) throw new Error(`Invalid frozen encyclopedia registry: ${registryValidation.errors.join(" ")}`);

export default {
  ENCYCLOPEDIA_CONTRACT_VERSION,
  DIAGNOSTIC_AREAS,
  FRICTION_STATES,
  RELATIONSHIP_TYPES,
  CANONICAL_PROBLEMS,
  CANONICAL_PROBLEM_BY_ID,
  validateEncyclopediaRegistry,
};

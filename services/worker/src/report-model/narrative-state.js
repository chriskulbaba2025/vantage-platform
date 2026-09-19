import { requireClientTruth } from "./cross-report-interpretation.js";

export const NARRATIVE_STATE = Object.freeze({
  STRONG: "STRONG",
  MIDDLE: "MIDDLE",
  WEAK: "WEAK",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
});

export const EVIDENCE_SUFFICIENCY = Object.freeze({
  SUFFICIENT: "SUFFICIENT",
  BOUNDED_PARTIAL: "BOUNDED_PARTIAL",
  INSUFFICIENT: "INSUFFICIENT",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

export const NARRATIVE_PAGE_IDS = Object.freeze([
  "executive-scorecard",
  "priority-fixes",
  "conversion-journey",
  "content-opportunities",
  "trust-credibility",
  "competitor-comparison",
  "supporting-detail",
]);

const CLIENT_TRUTH_STATES = new Set([
  "assessed",
  "partial",
  "not assessed",
  "not applicable",
  "finding",
]);
const SOURCE_STATUSES = new Set([
  "AVAILABLE",
  "PARTIAL",
  "UNAVAILABLE",
  "UNKNOWN",
  "FAILED",
  "BLOCKED",
  "NOT_CONNECTED",
  "NOT_COLLECTED",
  "NOT_APPLICABLE",
]);
const CERTAINTY_RANK = Object.freeze({
  NONE: 0,
  BOUNDED: 1,
  ESTABLISHED: 2,
});

const TRUTH_BY_PAGE = Object.freeze({
  "conversion-journey": ["conversionPathClarity"],
  "content-opportunities": ["buyerQuestionCoverage"],
  "trust-credibility": ["trustProof"],
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function statusOf(value) {
  if (typeof value !== "string") return null;
  const status = value.trim().toUpperCase();
  if (!SOURCE_STATUSES.has(status)) throw new Error(`Unsupported evidence status: ${value}`);
  return status;
}

function truthState(value, label) {
  if (!value || typeof value !== "object" || !CLIENT_TRUTH_STATES.has(value.state)) {
    throw new Error(`Unsupported Client Truth state for ${label}`);
  }
  if (typeof value.scope !== "string" || !value.scope.trim() || !Array.isArray(value.evidenceRefs)) {
    throw new Error(`Client Truth traceability is incomplete for ${label}`);
  }
  return value;
}

function truthSufficiency(value) {
  if (value.state === "not applicable") return EVIDENCE_SUFFICIENCY.NOT_APPLICABLE;
  if (value.state === "not assessed") return EVIDENCE_SUFFICIENCY.INSUFFICIENT;
  if (value.state === "partial") return EVIDENCE_SUFFICIENCY.BOUNDED_PARTIAL;
  return EVIDENCE_SUFFICIENCY.SUFFICIENT;
}

function stateFromTruth(value) {
  if (value.state === "not assessed") return NARRATIVE_STATE.INSUFFICIENT_EVIDENCE;
  if (value.state === "finding") return NARRATIVE_STATE.WEAK;
  if (value.state === "partial") return NARRATIVE_STATE.MIDDLE;
  return NARRATIVE_STATE.STRONG;
}

function evidenceRank(sufficiency) {
  return sufficiency === EVIDENCE_SUFFICIENCY.SUFFICIENT
    ? CERTAINTY_RANK.ESTABLISHED
    : sufficiency === EVIDENCE_SUFFICIENCY.BOUNDED_PARTIAL
      ? CERTAINTY_RANK.BOUNDED
      : CERTAINTY_RANK.NONE;
}

function recommendationCertainty(sufficiency, state) {
  if (state === NARRATIVE_STATE.INSUFFICIENT_EVIDENCE) return "NONE";
  return sufficiency === EVIDENCE_SUFFICIENCY.SUFFICIENT ? "ESTABLISHED" : "BOUNDED";
}

function sourceStatuses(model) {
  const statuses = [];
  const capabilities = model?.capabilityEvidence?.capabilities || {};
  for (const capability of Object.values(capabilities)) {
    if (capability?.status !== undefined) statuses.push(statusOf(capability.status));
  }
  for (const value of [model?.sourceStatus?.site, model?.sourceStatus?.performance, model?.sourceStatus?.competitors]) {
    if (value !== undefined) statuses.push(statusOf(value));
  }
  return [...new Set(statuses)];
}

function pageRecord({ pageId, decisionQuestion, truth, state, message, action, limitations = [], extra = {} }) {
  const sufficiency = truth ? truthSufficiency(truth) : EVIDENCE_SUFFICIENCY.INSUFFICIENT;
  const finalState = sufficiency === EVIDENCE_SUFFICIENCY.INSUFFICIENT
    ? NARRATIVE_STATE.INSUFFICIENT_EVIDENCE
    : state;
  const evidenceRefs = truth?.evidenceRefs?.length ? truth.evidenceRefs : ["capabilityEvidence.capabilities"];
  const record = {
    pageId,
    decisionQuestion,
    evidenceSufficiency: sufficiency,
    state: finalState,
    reviewedScope: truth?.scope || "No material scope was established.",
    evidenceRefs: [...evidenceRefs],
    conditionFacts: truth ? [truth.observation, truth.clientConclusion] : [],
    message,
    limitations: [...new Set([truth?.qualifier, ...limitations].filter(Boolean))],
    boundedAction: action,
    recommendationCertainty: recommendationCertainty(sufficiency, finalState),
    rebuildAuthorization: { allowed: false, basis: "No separate governed platform/architecture determination was supplied." },
    prohibitedUpgrades: [...(truth?.prohibitedUpgrades || [])],
    sourceStatuses: [],
    ...extra,
  };
  return record;
}

function pageMessage(pageId, state) {
  const messages = {
    "executive-scorecard": {
      STRONG: "The reviewed foundation is working in the assessed scope; preserve it and improve selectively.",
      MIDDLE: "Keep the current site/foundation, preserve its strengths, and fix the material constraints established in the reviewed evidence.",
      WEAK: "Material readiness problems are established in the reviewed scope; prioritize correction without treating this state as a rebuild decision.",
      INSUFFICIENT_EVIDENCE: "The audit cannot make a dependable overall readiness conclusion yet; the missing evidence boundary is shown below.",
    },
    "priority-fixes": {
      STRONG: "No material problem is established for this page; preserve what is working and make only supported refinements.",
      MIDDLE: "Start with the highest-value proven fixes, keeping diagnostic checks separate from established causes.",
      WEAK: "Start with the highest-impact proven corrective work in the reviewed scope.",
      INSUFFICIENT_EVIDENCE: "Do not rank uncertain causes as confident remedies; show only bounded checks and verifiable next steps.",
    },
    "conversion-journey": {
      STRONG: "The reviewed journey evidence supports preserving the working route and making selective friction or measurement improvements.",
      MIDDLE: "The reviewed journey is workable but bounded; preserve the route and address the specific friction established in scope.",
      WEAK: "The reviewed evidence establishes points where buyer movement becomes materially unclear or broken; correct those points first.",
      INSUFFICIENT_EVIDENCE: "The audit cannot make a broad journey judgment; only the observable and missing stages can be stated.",
    },
    "content-opportunities": {
      STRONG: "The reviewed content evidence supports expansion and refinement opportunities, not a broad content deficiency claim.",
      MIDDLE: "The reviewed scope shows material buyer-question gaps alongside existing strengths; confirm each gap before creating content.",
      WEAK: "Only the demonstrably thin decision-support areas in the reviewed scope are treated as material content weaknesses.",
      INSUFFICIENT_EVIDENCE: "The audit withholds a broad content-coverage conclusion; available opportunities remain qualified planning guidance.",
    },
    "trust-credibility": {
      STRONG: "Visible proof is established in the reviewed scope; preserve it and amplify it selectively where placement is verified.",
      MIDDLE: "Trust proof is usable but bounded; distinguish observed assets from placement or timing questions that still need checking.",
      WEAK: "Material trust gaps are established only in the reviewed scope; no conversion, traffic, ranking, or citation outcome is promised.",
      INSUFFICIENT_EVIDENCE: "The audit withholds a broad trust conclusion and separates observed proof from unknown proof surfaces.",
    },
    "competitor-comparison": {
      STRONG: "The available comparison supports established competitiveness or differentiation in the named set.",
      MIDDLE: "The named benchmark is mixed; protect strengths, improve only material client-supported differences, and ignore noise.",
      WEAK: "Only material comparable buying-experience gaps supported by the client evidence are treated as weaknesses.",
      INSUFFICIENT_EVIDENCE: "The audit states what could and could not be compared and withholds a broad comparative conclusion.",
    },
    "supporting-detail": {
      STRONG: "Evidence coverage is sufficient for the material conclusions made in the reviewed scope.",
      MIDDLE: "Evidence is usable but bounded or mixed; each limitation remains connected to the conclusions it affects.",
      WEAK: "Evidence quality or coverage is poor in the reviewed scope; that does not become a poor website-condition claim.",
      INSUFFICIENT_EVIDENCE: "Material report conclusions are suppressed where supporting evidence is insufficient.",
    },
  };
  return messages[pageId][state];
}

function actionFor(pageId, state) {
  if (state === NARRATIVE_STATE.INSUFFICIENT_EVIDENCE) return "Preserve the evidence boundary, run only bounded checks, and verify before making a condition claim.";
  if (pageId === "executive-scorecard") return state === NARRATIVE_STATE.STRONG ? "Preserve the current foundation and verify selective improvements." : "Preserve the current foundation, fix proven material issues, and verify outcomes.";
  if (pageId === "priority-fixes") return state === NARRATIVE_STATE.STRONG ? "Do not manufacture problems; retain the existing evidence-backed priorities." : "Use What we know → Check these first → How to know it worked.";
  if (pageId === "competitor-comparison") return "Use competitor context to inform review; act only on the client's own established evidence.";
  return "Keep the conclusion within the reviewed scope, fix only proven material issues, and verify outcomes.";
}

function derivePriority(model) {
  const findings = Array.isArray(model?.findings) ? model.findings : [];
  const material = findings.filter((finding) => finding?.scoreBearing === true && finding?.actionable !== false);
  const refs = material.flatMap((finding) => (finding.evidence || []).map((item) => item.field).filter(Boolean));
  const truth = {
    state: material.length ? (material.some((finding) => ["deterministic", "strongly-supported"].includes(finding.confidence)) ? "finding" : "partial") : "assessed",
    scope: "the governed findings and canonical action scope",
    observation: material.length ? `${material.length} governed material finding(s) were retained.` : "No governed material finding was retained.",
    clientConclusion: material.length ? "Material corrective work is available from governed findings." : "No material corrective work was established.",
    evidenceRefs: refs.length ? refs : ["findings[].evidence", "decisionHierarchy.orderedFindingIds"],
    prohibitedUpgrades: ["diagnostic check is a proven cause"],
  };
  return { truth, state: stateFromTruth(truth) };
}

function deriveCompetitor(model) {
  const source = model?.sourceStatus?.competitors || (model?.competitors ? "AVAILABLE" : "NOT_APPLICABLE");
  const normalized = statusOf(source);
  const comparisons = Array.isArray(model?.competitors?.comparisons) ? model.competitors.comparisons : [];
  if (normalized === "NOT_APPLICABLE" || normalized !== "AVAILABLE" && normalized !== "PARTIAL") return null;
  const assessed = comparisons.filter((item) => String(item?.status || "AVAILABLE").trim().toUpperCase() === "AVAILABLE");
  if (!assessed.length) return null;
  const gaps = model?.competitors?.opportunities?.gaps;
  const truth = {
    state: normalized === "PARTIAL" ? "partial" : "assessed",
    scope: `the ${assessed.length} named competitor comparison(s) available in the audit`,
    observation: `${assessed.length} named competitor comparison(s) were available; competitor behavior remains context only.`,
    clientConclusion: Array.isArray(gaps) && gaps.length ? "Comparable differences were observed; client action still requires own-site evidence." : "No client defect was established by competitor context alone.",
    evidenceRefs: ["competitors.comparisons", "competitors.opportunities"],
    prohibitedUpgrades: ["competitor behavior creates a client defect", "competitor difference proves a rebuild"],
  };
  return { truth, state: normalized === "PARTIAL" ? NARRATIVE_STATE.MIDDLE : NARRATIVE_STATE.STRONG };
}

function validateRecord(record) {
  if (!NARRATIVE_PAGE_IDS.includes(record?.pageId)) throw new Error("Unsupported narrative page");
  if (!Object.values(NARRATIVE_STATE).includes(record.state)) throw new Error(`Unsupported narrative state for ${record.pageId}`);
  if (!Object.values(EVIDENCE_SUFFICIENCY).includes(record.evidenceSufficiency)) throw new Error(`Unsupported sufficiency for ${record.pageId}`);
  if (!Array.isArray(record.evidenceRefs) || !record.evidenceRefs.length) throw new Error(`Untraceable narrative conclusion for ${record.pageId}`);
  if (record.evidenceSufficiency === EVIDENCE_SUFFICIENCY.INSUFFICIENT && record.state !== NARRATIVE_STATE.INSUFFICIENT_EVIDENCE) throw new Error(`Insufficient evidence upgraded for ${record.pageId}`);
  if (record.rebuildAuthorization?.allowed !== false) throw new Error("Rebuild authorization must be separately governed");
  if (CERTAINTY_RANK[record.recommendationCertainty] > evidenceRank(record.evidenceSufficiency)) throw new Error(`Recommendation certainty exceeds evidence certainty for ${record.pageId}`);
}

export function validateNarrativeStateMap(stateMap) {
  if (!stateMap || typeof stateMap !== "object") throw new Error("Narrative state map is required");
  const keys = Object.keys(stateMap);
  if (keys.length !== NARRATIVE_PAGE_IDS.length || keys.some((key) => !NARRATIVE_PAGE_IDS.includes(key))) throw new Error("Narrative state map must contain exactly seven frozen pages");
  for (const pageId of NARRATIVE_PAGE_IDS) validateRecord(stateMap[pageId]);
  const supporting = stateMap["supporting-detail"];
  if (supporting.evidenceSufficiency === EVIDENCE_SUFFICIENCY.INSUFFICIENT) {
    for (const pageId of NARRATIVE_PAGE_IDS.filter((id) => id !== "supporting-detail" && id !== "executive-scorecard")) {
      if (stateMap[pageId].state !== NARRATIVE_STATE.INSUFFICIENT_EVIDENCE) throw new Error("Supporting Detail insufficiency cannot coexist with certainty elsewhere");
    }
  }
  const executive = stateMap["executive-scorecard"];
  for (const pageId of NARRATIVE_PAGE_IDS.filter((id) => id !== "executive-scorecard" && id !== "supporting-detail")) {
    if (stateMap[pageId].state === NARRATIVE_STATE.WEAK && executive.state === NARRATIVE_STATE.STRONG) throw new Error("Executive Scorecard contradicts a material weak page");
    if (stateMap[pageId].state === NARRATIVE_STATE.INSUFFICIENT_EVIDENCE && executive.state !== NARRATIVE_STATE.INSUFFICIENT_EVIDENCE) throw new Error("Executive Scorecard overrules insufficient supporting evidence");
  }
  return deepFreeze(stateMap);
}

export function deriveNarrativeStates(model) {
  const clientTruth = requireClientTruth(model);
  for (const [key, value] of Object.entries(clientTruth.truth)) truthState(value, key);
  const source = sourceStatuses(model);
  const supportingTruth = clientTruth.truth.evidenceScope;
  const priority = derivePriority(model);
  const pageTruth = (pageId) => {
    const keys = TRUTH_BY_PAGE[pageId] || [];
    return keys.length ? clientTruth.truth[keys[0]] : null;
  };
  const stateMap = {};
  for (const pageId of NARRATIVE_PAGE_IDS) {
    if (pageId === "executive-scorecard") continue;
    if (pageId === "priority-fixes") {
      stateMap[pageId] = pageRecord({ pageId, decisionQuestion: "What should the client fix first?", truth: priority.truth, state: priority.state, message: pageMessage(pageId, priority.state), action: actionFor(pageId, priority.state) });
    } else if (pageId === "competitor-comparison") {
      const competitor = deriveCompetitor(model);
      const state = competitor ? competitor.state : NARRATIVE_STATE.INSUFFICIENT_EVIDENCE;
      stateMap[pageId] = pageRecord({ pageId, decisionQuestion: "What meaningful differences exist between the reviewed site and named competitors?", truth: competitor?.truth, state, message: pageMessage(pageId, state), action: actionFor(pageId, state), limitations: ["Competitor behavior cannot create a client defect without own-site evidence."] });
    } else if (pageId === "supporting-detail") {
      const state = stateFromTruth(supportingTruth);
      stateMap[pageId] = pageRecord({ pageId, decisionQuestion: "What evidence supports the report, and where are its limits?", truth: supportingTruth, state, message: pageMessage(pageId, state), action: actionFor(pageId, state) });
    } else {
      const truth = pageTruth(pageId);
      const state = stateFromTruth(truth);
      stateMap[pageId] = pageRecord({ pageId, decisionQuestion: pageId === "conversion-journey" ? "Can a buyer move from interest to action with enough clarity and confidence?" : pageId === "content-opportunities" ? "Where can content better answer buyer questions?" : "Does visible proof reduce buyer uncertainty?", truth, state, message: pageMessage(pageId, state), action: actionFor(pageId, state) });
    }
  }
  const supportingState = stateMap["supporting-detail"];
  if (supportingState.evidenceSufficiency === EVIDENCE_SUFFICIENCY.INSUFFICIENT) {
    for (const pageId of NARRATIVE_PAGE_IDS.filter((id) => id !== "supporting-detail" && id !== "executive-scorecard")) {
      const record = stateMap[pageId];
      record.state = NARRATIVE_STATE.INSUFFICIENT_EVIDENCE;
      record.message = pageMessage(pageId, record.state);
      record.boundedAction = actionFor(pageId, record.state);
      record.recommendationCertainty = "NONE";
      record.limitations = [...new Set([...record.limitations, "Supporting Detail could not establish the material evidence boundary for this conclusion."])]
    }
  }
  const underlying = NARRATIVE_PAGE_IDS.filter((id) => id !== "executive-scorecard" && id !== "supporting-detail").map((id) => stateMap[id]);
  const executiveState = supportingState.state === NARRATIVE_STATE.INSUFFICIENT_EVIDENCE || underlying.some((item) => item.state === NARRATIVE_STATE.INSUFFICIENT_EVIDENCE)
    ? NARRATIVE_STATE.INSUFFICIENT_EVIDENCE
    : underlying.some((item) => item.state === NARRATIVE_STATE.WEAK)
      ? NARRATIVE_STATE.WEAK
      : underlying.some((item) => item.state === NARRATIVE_STATE.MIDDLE) ? NARRATIVE_STATE.MIDDLE : NARRATIVE_STATE.STRONG;
  const executiveTruth = {
    scope: underlying.map((item) => item.reviewedScope).join("; "),
    evidenceRefs: underlying.flatMap((item) => item.evidenceRefs),
    observation: "Executive state is the validated summary of the six supporting page contracts.",
    clientConclusion: "Executive synthesis cannot outrank supporting evidence.",
    prohibitedUpgrades: ["supporting page insufficiency becomes executive certainty", "material weakness becomes healthy site-wide"],
  };
  stateMap["executive-scorecard"] = pageRecord({ pageId: "executive-scorecard", decisionQuestion: "What is the overall client decision from the reviewed audit evidence?", truth: executiveTruth, state: executiveState, message: pageMessage("executive-scorecard", executiveState), action: actionFor("executive-scorecard", executiveState) });
  for (const record of Object.values(stateMap)) record.sourceStatuses = source;
  return validateNarrativeStateMap(stateMap);
}

export { CERTAINTY_RANK };

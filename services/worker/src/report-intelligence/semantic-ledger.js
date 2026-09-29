import {
  buildSemanticEvidenceAuthority,
  isObserved,
  semanticFact,
} from "./semantic-evidence-authority.js";

/**
 * Deterministic report-intelligence ledger.
 *
 * This module is deliberately model-free. It records what the evidence says,
 * how existing content covers buyer needs, and whether semantic escalation is
 * warranted. Terra/Sol may interpret this ledger; neither may rewrite it.
 */

export const SEMANTIC_LEDGER_VERSION = "1.0.0";

const VALID_STATUSES = new Set([
  "AVAILABLE",
  "PARTIAL",
  "UNKNOWN",
  "UNAVAILABLE",
  "FAILED",
  "NOT_CONNECTED",
  "NOT_APPLICABLE",
]);

const ACTIONS = Object.freeze([
  "CREATE",
  "EXPAND",
  "IMPROVE",
  "CONSOLIDATE",
  "MAKE_EASIER_TO_FIND",
  "NO_ACTION",
]);

function statusOf(value) {
  return VALID_STATUSES.has(value) ? value : "UNKNOWN";
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"].forEach((key) => url.searchParams.delete(key));
    url.hash = "";
    const query = url.searchParams.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return raw.replace(/[?#].*$/, "");
  }
}

function proofSemantics(authorityOrEvidence) {
  const authority = authorityOrEvidence?.facts
    ? authorityOrEvidence
    : buildSemanticEvidenceAuthority(authorityOrEvidence?.site ? authorityOrEvidence : { site: authorityOrEvidence });
  const forms = [];
  if (isObserved(authority, "TESTIMONIAL_OR_REVIEW")) forms.push("TESTIMONIAL_OR_REVIEW");
  if (isObserved(authority, "CUSTOMER_OUTCOME")) forms.push("CUSTOMER_STORY_OR_RESULT");
  if (isObserved(authority, "DETAILED_CASE_STUDY")) forms.push("CUSTOMER_STORY_OR_RESULT");
  if (isObserved(authority, "COMPLETED_WORK")) forms.push("GALLERY_OR_COMPLETED_WORK");
  if (isObserved(authority, "FORMAL_CREDENTIAL")) forms.push("CREDENTIAL_OR_EXPERIENCE");
  if (isObserved(authority, "OPERATING_EXPERIENCE")) forms.push("CREDENTIAL_OR_EXPERIENCE");
  return {
    status: authority.sourceStatus,
    forms: [...new Set(forms)],
    observed: forms.length > 0,
    qualifier: isObserved(authority, "COMPLETED_WORK") && !isObserved(authority, "DETAILED_CASE_STUDY")
      ? "Completed-work evidence was observed; it is not treated as a detailed outcome case study."
      : null,
  };
}

function coverageFor(topic, site, status) {
  const words = text(topic).toLowerCase().split(/\s+/).filter((word) => word.length >= 3);
  const pages = Array.isArray(site?.pages) ? site.pages : [];
  const matches = pages.filter((page) => {
    const haystack = [page?.title, page?.description, page?.bodyText, ...(page?.headings?.h1 || []), ...(page?.headings?.h2 || [])].join(" ").toLowerCase();
    return words.length > 0 && words.filter((word) => haystack.includes(word)).length >= Math.max(1, Math.ceil(words.length / 2));
  });
  if (!["AVAILABLE", "PARTIAL"].includes(status)) return { state: status, urls: [], matchCount: 0 };
  if (matches.length === 0) return { state: "ABSENT", urls: [], matchCount: 0 };
  const bodyMatches = matches.filter((page) => text(page?.bodyText).length > 0);
  return {
    state: bodyMatches.length === matches.length ? "MATERIAL" : "PARTIAL",
    urls: matches.map((page) => normalizeUrl(page?.crawledUrl || page?.url)).filter(Boolean),
    matchCount: matches.length,
  };
}

function genericServiceDefinition(topic, row, site) {
  const normalized = text(topic).toLowerCase().replace(/[?.!]+$/g, "");
  const match =
    normalized.match(/^what (?:is|are) (.+)$/i) ||
    normalized.match(/^explain what (.+) is$/i);
  if (!match) return false;

  const subject = text(match[1]).toLowerCase();
  if (!subject) return false;

  const decisionQuestion = text(row?.question || row?.buyerQuestion).toLowerCase();
  const looksPurelyDefinitional =
    !decisionQuestion ||
    /^(what is this|what is it|what does this mean)\??$/.test(decisionQuestion);

  const services = (Array.isArray(site?.services) ? site.services : [])
    .map((value) => text(value).toLowerCase())
    .filter(Boolean);
  const subjectWords = subject.split(/\s+/).filter((word) => word.length >= 3);
  const matchesKnownService = services.some((service) => {
    const serviceWords = service.split(/\s+/).filter((word) => word.length >= 3);
    if (!serviceWords.length || !subjectWords.length) return false;
    const overlap = subjectWords.filter((word) => serviceWords.includes(word)).length;
    return overlap >= Math.max(1, Math.ceil(Math.min(subjectWords.length, serviceWords.length) * 0.6));
  });

  return looksPurelyDefinitional && matchesKnownService;
}

function classifyOpportunity(row, site, contentStatus) {
  const topic = text(row?.topic || row?.idea || row?.query);
  const coverage = coverageFor(topic, site, contentStatus);
  if (!["AVAILABLE", "PARTIAL"].includes(contentStatus)) {
    return { action: "NO_ACTION", reason: `Content coverage is ${contentStatus}; a CREATE claim is not supportable.` , coverage };
  }
  if (coverage.state === "MATERIAL") return { action: "NO_ACTION", reason: "Assessed content materially answers this buyer need.", coverage };
  if (coverage.state === "PARTIAL") return { action: "IMPROVE", reason: "Related assessed content exists but does not fully answer the buyer need.", coverage };
  if (
    genericServiceDefinition(topic, row, site) ||
    (/\bwhat is|explain|definition\b/i.test(topic) && topic.split(/\s+/).length < 4)
  ) {
    return { action: "NO_ACTION", reason: "The suggestion is generic ontology slot-filling rather than a specific buyer decision-support need.", coverage };
  }
  return { action: "CREATE", reason: "No materially covering assessed content was found for this buyer need.", coverage };
}

function buildDimensionMeaning(score, band) {
  if (score == null || band === "Not Assessed") return "Not enough assessed evidence for a dimension conclusion.";
  return `${band} reflects the deterministic score across its governed inputs; it is not a claim that every buyer interaction is strong.`;
}

export function buildSemanticLedger({ scoreSet = {}, findings = [], decisionEvidence = {}, semanticEvidence = null, contentIdeas = scoreSet.contentIdeas } = {}) {
  const site = decisionEvidence?.site || {};
  const sourceStatus = decisionEvidence?.sourceStatus || {};
  const contentStatus = statusOf(sourceStatus.content || (site?._contentEvidenceAvailable === true ? "AVAILABLE" : site?._contentEvidenceAvailable === false ? "UNAVAILABLE" : "UNKNOWN"));
  const authority = semanticEvidence || buildSemanticEvidenceAuthority(decisionEvidence);
  const trustProof = proofSemantics(authority);
  const opportunityRows = Object.entries(contentIdeas || {})
    .filter(([, rows]) => Array.isArray(rows))
    .flatMap(([stage, rows]) => rows.map((row) => {
      const classified = classifyOpportunity(row, site, contentStatus);
      return {
        stage,
        topic: text(row?.topic || row?.idea || row?.query),
        action: classified.action,
        reason: classified.reason,
        coverage: classified.coverage,
        urls: classified.coverage.urls,
      };
    }));
  const dimensions = Object.fromEntries(Object.entries(scoreSet.scores || {}).map(([key, value]) => [key, {
    score: value,
    label: scoreSet.bands?.[key] || "Not Assessed",
    meaning: buildDimensionMeaning(value, scoreSet.bands?.[key]),
  }]));
  const contradictions = [];
  if (scoreSet.bands?.conversionReadiness === "Strong" && scoreSet.crossReportInterpretation?.constructs?.conversionPath?.state === "UNAVAILABLE") {
    contradictions.push({ code: "SCORE_NARRATIVE_MISMATCH", concept: "conversionPath", explanation: "The composite score remains governed, but the buyer-path narrative must qualify that path evidence is unavailable." });
  }
  if (trustProof.observed && scoreSet.crossReportInterpretation?.constructs?.trustProof?.state === "ABSENT") {
    contradictions.push({ code: "PROOF_CLASSIFICATION_MISMATCH", concept: "trustProof", explanation: "Observed proof forms cannot be rendered as no proof; their type and limits must be preserved." });
  }
  const escalationReasons = [];
  if (contradictions.length) escalationReasons.push("CONTRADICTION");
  if (contentStatus === "PARTIAL") escalationReasons.push("PARTIAL_INTERPRETATION");
  if (opportunityRows.some((row) => row.action === "NO_ACTION" && row.reason.includes("generic"))) escalationReasons.push("USEFULNESS_UNCERTAIN");
  return {
    version: SEMANTIC_LEDGER_VERSION,
    evidenceAuthority: "DETERMINISTIC_EVIDENCE_ENGINE",
    semanticEvidence: authority,
    sourceStatus: Object.fromEntries(Object.entries(sourceStatus).map(([key, value]) => [key, statusOf(value)])),
    dimensions,
    concepts: {
      trustProof,
      contentCoverage: { status: contentStatus },
      pricing: { status: statusOf(site?.trust?.pricing === true ? "AVAILABLE" : contentStatus) },
      conversionPath: { status: statusOf(sourceStatus.conversion || contentStatus) },
      completedWork: semanticFact(authority, "COMPLETED_WORK"),
      detailedCaseStudy: semanticFact(authority, "DETAILED_CASE_STUDY"),
      operatingExperience: semanticFact(authority, "OPERATING_EXPERIENCE"),
      formalCredential: semanticFact(authority, "FORMAL_CREDENTIAL"),
      customerOutcome: semanticFact(authority, "CUSTOMER_OUTCOME"),
    },
    contentOpportunities: opportunityRows,
    contradictions,
    usefulness: {
      evaluated: opportunityRows.length,
      accepted: opportunityRows.filter((row) => row.action !== "NO_ACTION").length,
      rejectedOrDeferred: opportunityRows.filter((row) => row.action === "NO_ACTION").length,
    },
    routing: {
      defaultModel: "TERRA",
      escalationRequired: escalationReasons.length > 0,
      escalationReasons: [...new Set(escalationReasons)],
      solAuthority: "ESCALATION_ONLY; IMMUTABLE_EVIDENCE_UNCHANGED",
    },
    provenance: {
      findingIds: findings.map((finding) => finding?.findingId).filter(Boolean),
      normalizedUrls: [...new Set(opportunityRows.flatMap((row) => row.urls))],
    },
  };
}

export { ACTIONS, normalizeUrl, proofSemantics, classifyOpportunity };

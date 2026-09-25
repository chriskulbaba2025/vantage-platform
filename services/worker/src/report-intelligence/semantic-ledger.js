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

function siteText(site) {
  const pages = Array.isArray(site?.pages) ? site.pages : [];
  return pages.map((page) => [
    page?.title,
    page?.description,
    page?.bodyText,
    ...(page?.headings?.h1 || []),
    ...(page?.headings?.h2 || []),
  ].join(" ")).join(" ").toLowerCase();
}

function proofSemantics(site) {
  const trust = site?.trust || {};
  const corpus = siteText(site);
  const forms = [];
  if (trust.testimonials === true || /\btestimonial|review|rated\b/.test(corpus)) forms.push("TESTIMONIAL_OR_REVIEW");
  if (trust.caseStudies === true || /\bcase study|customer story|client story|results? story|outcome/.test(corpus)) forms.push("CUSTOMER_STORY_OR_RESULT");
  if (/\bportfolio|gallery|completed work|projects?\b/.test(corpus)) forms.push("GALLERY_OR_COMPLETED_WORK");
  if (trust.credentials === true || /\bcredential|certif|award|licensed|years of experience/.test(corpus)) forms.push("CREDENTIAL_OR_EXPERIENCE");
  return {
    status: statusOf(site?._contentEvidenceAvailable === true ? "AVAILABLE" : site?._contentEvidenceAvailable === false ? "UNAVAILABLE" : site?.sourceStatus),
    forms: [...new Set(forms)],
    observed: forms.length > 0,
    qualifier: forms.includes("GALLERY_OR_COMPLETED_WORK") && !forms.includes("CUSTOMER_STORY_OR_RESULT")
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

function classifyOpportunity(row, site, contentStatus) {
  const topic = text(row?.topic || row?.idea || row?.query);
  const coverage = coverageFor(topic, site, contentStatus);
  if (!["AVAILABLE", "PARTIAL"].includes(contentStatus)) {
    return { action: "NO_ACTION", reason: `Content coverage is ${contentStatus}; a CREATE claim is not supportable.` , coverage };
  }
  if (coverage.state === "MATERIAL") return { action: "NO_ACTION", reason: "Assessed content materially answers this buyer need.", coverage };
  if (coverage.state === "PARTIAL") return { action: "IMPROVE", reason: "Related assessed content exists but does not fully answer the buyer need.", coverage };
  if (/\bwhat is|explain|definition\b/i.test(topic) && topic.split(/\s+/).length < 4) {
    return { action: "NO_ACTION", reason: "The suggestion is generic ontology slot-filling rather than a decision-support need.", coverage };
  }
  return { action: "CREATE", reason: "No materially covering assessed content was found for this buyer need.", coverage };
}

function buildDimensionMeaning(score, band) {
  if (score == null || band === "Not Assessed") return "Not enough assessed evidence for a dimension conclusion.";
  return `${band} reflects the deterministic score across its governed inputs; it is not a claim that every buyer interaction is strong.`;
}

export function buildSemanticLedger({ scoreSet = {}, findings = [], decisionEvidence = {}, contentIdeas = scoreSet.contentIdeas } = {}) {
  const site = decisionEvidence?.site || {};
  const sourceStatus = decisionEvidence?.sourceStatus || {};
  const contentStatus = statusOf(sourceStatus.content || (site?._contentEvidenceAvailable === true ? "AVAILABLE" : site?._contentEvidenceAvailable === false ? "UNAVAILABLE" : "UNKNOWN"));
  const trustProof = proofSemantics(site);
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
    sourceStatus: Object.fromEntries(Object.entries(sourceStatus).map(([key, value]) => [key, statusOf(value)])),
    dimensions,
    concepts: {
      trustProof,
      contentCoverage: { status: contentStatus },
      pricing: { status: statusOf(site?.trust?.pricing === true ? "AVAILABLE" : contentStatus) },
      conversionPath: { status: statusOf(sourceStatus.conversion || contentStatus) },
      completedWork: { observed: trustProof.forms.includes("GALLERY_OR_COMPLETED_WORK"), evidenceForms: trustProof.forms },
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

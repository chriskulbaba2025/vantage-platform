/**
 * V3 Competitor Opportunity Layer (PRD §12)
 *
 * Implements:
 *  1. Per-topic competitor discovery from SERP and user-supplied sources
 *  2. Five-check candidate qualification gate
 *  3. Auditor approval workflow for competitor selections
 *  4. Six-check qualified gap rule for recommendations
 *  5. Provider-independent canonical evidence output
 *
 * No causal ranking claims. No unapproved competitor evidence is score-bearing.
 */

import { SOURCE_STATUS, ERROR_CATEGORY, buildSourceStatus, EVIDENCE_ENVELOPE_VERSION } from "../scoring/evidence-contracts.js";
import { domainOf } from "../utils.js";
import { querySerp } from "../adapters/dataforseo-serp/dataforseo-serp-client.js";

const QUALIFICATION_CHECKS = Object.freeze([
  "geographic_relevance",
  "service_relevance",
  "audience_relevance",
  "commercial_intent_relevance",
  "page_type_comparability",
]);

const EXCLUDED_PAGE_TYPES = new Set([
  "directory", "marketplace", "social", "reference", "community",
]);

export function qualifyCandidate(candidate, clientContext) {
  const results = new Map();

  const geoMatch =
    !clientContext.location
      ? true
      : !candidate.geographicContext
        ? false
      : candidate.geographicContext.toLowerCase().includes(
          clientContext.location.toLowerCase().split(",")[0]?.trim() || "",
        ) ||
        clientContext.location.toLowerCase().includes(
          (candidate.geographicContext || "").toLowerCase().split(",")[0]?.trim() || "",
        );
  results.set("geographic_relevance", geoMatch);

  const topicMatch =
    !candidate.topic
      ? false
      : (clientContext.services || []).some(
          (svc) =>
            candidate.topic.toLowerCase().includes(svc.toLowerCase()) ||
            svc.toLowerCase().includes((candidate.topic || "").toLowerCase()),
        ) || (clientContext.topicKeywords || []).some(
          (kw) => candidate.topic.toLowerCase().includes(kw.toLowerCase()),
        );
  results.set("service_relevance", topicMatch);

  const audienceMatch = Boolean(candidate.audienceContext);
  results.set("audience_relevance", audienceMatch);

  const commercialMatch = Boolean(candidate.commercialContext);
  results.set("commercial_intent_relevance", commercialMatch);

  const comparable =
    !EXCLUDED_PAGE_TYPES.has(candidate.pageType) &&
    candidate.pageType !== "support";
  results.set("page_type_comparability", comparable);

  const passed = [...results.values()].every(Boolean);
  const exclusionReason = !passed
    ? [...results.entries()]
        .filter(([, value]) => !value)
        .map(([key]) => key)
        .join(", ")
    : null;

  return { passed, results: Object.fromEntries(results), exclusionReason };
}

const GAP_CHECKS = Object.freeze([
  "offer_alignment",
  "audience_alignment",
  "buyer_journey_alignment",
  "expertise_credibility",
  "conversion_path_viability",
  "realistic_competitive_feasibility",
]);

export function qualifyGap(clientTopic, competitorPage, clientCoverage, competitorCoverage) {
  const results = new Map();

  results.set("offer_alignment", Boolean(clientTopic && competitorPage?.topic));
  results.set("audience_alignment", Boolean(competitorPage?.domain));

  const journeyMatch = competitorPage?.pageType === "service" ||
    competitorPage?.pageType === "landing" ||
    competitorPage?.pageType === "pricing" ||
    competitorPage?.pageType === "company_page";
  results.set("buyer_journey_alignment", journeyMatch);

  const expertise = competitorPage?.hasSchema?.length > 0 ||
    (competitorCoverage?.length || 0) > 0;
  results.set("expertise_credibility", expertise);

  results.set("conversion_path_viability", Boolean(competitorPage?.candidateUrl));
  results.set("realistic_competitive_feasibility", clientCoverage !== null);

  const passed = [...results.values()].every(Boolean);
  return { passed, results: Object.fromEntries(results) };
}

function isExcludedPageType(pageType) {
  return EXCLUDED_PAGE_TYPES.has(pageType);
}

function extractTopics(site, input) {
  const topics = [];
  const services = site.services || [];
  const keywords = site.topicKeywords || [];
  const location = input.location || "";

  for (const service of services.slice(0, 5)) {
    const query = location ? `${service} ${location}` : service;
    topics.push({ topic: service, query, source: "service", language: input.language || "en" });
  }

  for (const keyword of keywords.slice(0, 3)) {
    if (!services.some((service) => keyword.toLowerCase().includes(service.toLowerCase()))) {
      const query = location ? `${keyword} ${location}` : keyword;
      topics.push({ topic: keyword, query, source: "keyword", language: input.language || "en" });
    }
  }

  if (topics.length === 0 && input.businessName) {
    const query = location ? `${input.businessName} ${location}` : input.businessName;
    topics.push({ topic: input.businessName, query, source: "business_name", language: input.language || "en" });
  }

  return topics.slice(0, 5);
}

function normalizeQueryFailure(topic, result = {}, caughtError = null) {
  if (caughtError) {
    return {
      topic,
      errorType: "EXCEPTION",
      taskId: null,
      statusCode: null,
      statusMessage: String(caughtError?.message || caughtError || "Unknown SERP exception"),
    };
  }

  return {
    topic,
    errorType: result.errorType || (result.taskError ? "TASK" : "UNKNOWN"),
    taskId: result.taskError?.taskId || result.rawTaskId || null,
    statusCode: result.taskError?.statusCode ?? result.errorStatusCode ?? null,
    statusMessage: result.taskError?.statusMessage || result.error || "Unknown SERP query failure",
  };
}

function formatQueryFailureForLimitation(failure) {
  const message = failure.statusMessage || "Unknown SERP query failure";
  return failure.statusCode != null
    ? `status_code=${failure.statusCode}, message="${message}"`
    : message;
}

function deriveSerpStatus({ hasCredentials, attemptedCount, successfulCount, failureCount, candidateCount }) {
  if (!hasCredentials) return SOURCE_STATUS.NOT_CONNECTED;

  if (failureCount > 0) {
    return successfulCount > 0 || candidateCount > 0
      ? SOURCE_STATUS.PARTIAL
      : SOURCE_STATUS.FAILED;
  }

  if (successfulCount > 0) {
    return candidateCount > 0
      ? SOURCE_STATUS.AVAILABLE
      : SOURCE_STATUS.UNAVAILABLE;
  }

  return attemptedCount > 0 ? SOURCE_STATUS.FAILED : SOURCE_STATUS.UNAVAILABLE;
}

export async function collectCompetitorOpportunities(site, input, options = {}) {
  const startedAt = new Date().toISOString();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const login = options.dataforseoLogin || "";
  const password = options.dataforseoPassword || "";
  const hasDfsCredentials = Boolean(login && password);
  const suppliedCompetitors = options.suppliedCompetitors || [];
  const auditorApprovals = options.auditorApprovals || {};

  const limitations = [];
  const topics = extractTopics(site, input);
  const clientContext = {
    location: input.location || "",
    language: input.language || "en",
    services: site.services || [],
    topicKeywords: site.topicKeywords || [],
    businessName: input.businessName || "",
  };

  const serpCandidates = [];
  const serpTaskIds = [];
  const serpQueryFailures = [];
  let serpQueriesAttempted = 0;
  let serpQueriesSucceeded = 0;
  let serpNormalizedLanguage = null;
  let serpNormalizedLocation = null;
  const serpOriginalLanguage = input.language || null;
  const serpOriginalLocation = input.location || null;

  if (hasDfsCredentials && topics.length > 0) {
    for (const topic of topics.slice(0, 3)) {
      serpQueriesAttempted += 1;

      try {
        const result = await querySerp(topic.query, {
          login,
          password,
          location: input.location || "Canada",
          language: input.language || "en",
          fetchImpl,
        });

        if (!serpNormalizedLanguage && result.normalizedLanguage) {
          serpNormalizedLanguage = result.normalizedLanguage;
        }
        if (!serpNormalizedLocation && result.normalizedLocation) {
          serpNormalizedLocation = result.normalizedLocation;
        }
        if (result.rawTaskId) serpTaskIds.push(result.rawTaskId);

        if (result.error) {
          const failure = normalizeQueryFailure(topic.query, result);
          serpQueryFailures.push(failure);
          limitations.push(`DataForSEO SERP for "${topic.query}": ${formatQueryFailureForLimitation(failure)}`);
          continue;
        }

        serpQueriesSucceeded += 1;
        for (const item of result.items || []) {
          serpCandidates.push(item);
        }
      } catch (error) {
        const failure = normalizeQueryFailure(topic.query, {}, error);
        serpQueryFailures.push(failure);
        limitations.push(`DataForSEO SERP failed for topic "${topic.query}": ${formatQueryFailureForLimitation(failure)}`);
      }
    }
  } else if (!hasDfsCredentials) {
    limitations.push("DataForSEO credentials not configured — SERP competitor discovery skipped.");
  }

  const serpTaskErrors = serpQueryFailures.filter((failure) => failure.errorType === "TASK");

  const suppliedCandidates = suppliedCompetitors
    .filter((competitor) => competitor.status === SOURCE_STATUS.AVAILABLE)
    .map((competitor) => ({
      candidateUrl: competitor.url,
      domain: domainOf(competitor.url),
      // A supplied competitor's topic must come from its observed evidence;
      // inheriting the client's first topic can qualify unrelated businesses.
      topic: competitor.evidence?.services?.[0] || competitor.evidence?.title || "",
      discoverySource: "user-supplied",
      geographicContext: competitor.evidence?.geographicContext || competitor.evidence?.location || "",
      // Supplied URLs have no SERP observation to establish these factors.
      // Do not infer them from a default page type or from client context.
      audienceContext: competitor.evidence?.audience || competitor.evidence?.audiences || competitor.evidence?.customerSegments || "",
      commercialContext: competitor.evidence?.commercialIntent || competitor.evidence?.commercialOffer || "",
      languageContext: input.language || "en",
      pageType: "landing",
      position: null,
      rawArtifactRef: `user-supplied://${competitor.url}`,
      evidence: competitor.evidence,
      serpFeatures: [],
      hasSchema: competitor.evidence?.schemaTypes || [],
    }));

  const allCandidates = [...serpCandidates, ...suppliedCandidates];
  const qualified = [];
  const excluded = [];

  for (const candidate of allCandidates) {
    const qualification = qualifyCandidate(candidate, clientContext);
    if (qualification.passed) {
      qualified.push({
        ...candidate,
        qualificationPassed: true,
        qualificationResults: qualification.results,
        approvalStatus: auditorApprovals[candidate.candidateUrl] || "pending",
      });
    } else {
      excluded.push({
        candidateUrl: candidate.candidateUrl,
        domain: candidate.domain,
        topic: candidate.topic,
        discoverySource: candidate.discoverySource,
        exclusionReason: qualification.exclusionReason,
        qualificationResults: qualification.results,
      });
    }
  }

  const gaps = [];

  for (const candidate of qualified) {
    const clientCoverage = site.services?.some(
      (service) => candidate.topic?.toLowerCase().includes(service.toLowerCase()),
    ) || site.topicKeywords?.some(
      (keyword) => candidate.topic?.toLowerCase().includes(keyword.toLowerCase()),
    );

    const competitorCoverage = candidate.evidence
      ? [candidate.evidence.services?.join(", ")].filter(Boolean)
      : [candidate.title].filter(Boolean);

    const gapCheck = qualifyGap(
      candidate.topic,
      candidate,
      clientCoverage ? [candidate.topic] : null,
      competitorCoverage,
    );

    gaps.push({
      clientTopic: candidate.topic,
      competitorPage: candidate.candidateUrl,
      competitorDomain: candidate.domain,
      observedCompetitorCoverage: competitorCoverage,
      clientCoverage: clientCoverage ? "present" : "absent",
      conversionRelevance: candidate.pageType === "service" || candidate.pageType === "landing" ? "High" : "Medium",
      recommendation: gapCheck.passed
        ? `Create or strengthen content for "${candidate.topic}" to match competitive depth`
        : null,
      confidence: gapCheck.passed ? "Moderate" : "Directional",
      limitationStatement: gapCheck.passed
        ? "Based on visible on-page SERP evidence only. Does not assess domain authority, backlinks, or traffic."
        : `Gap check failed: ${Object.entries(gapCheck.results).filter(([, value]) => !value).map(([key]) => key).join(", ")}`,
      gapPassed: gapCheck.passed,
      gapResults: gapCheck.results,
      approvalStatus: candidate.approvalStatus,
      qualificationPassed: candidate.qualificationPassed,
      qualificationResults: candidate.qualificationResults,
      source: candidate.discoverySource,
      sourceStatus: candidate.discoverySource === "dataforseo-serp" && !hasDfsCredentials
        ? SOURCE_STATUS.NOT_CONNECTED
        : SOURCE_STATUS.AVAILABLE,
      rawArtifactRef: candidate.rawArtifactRef || null,
    });
  }

  const serpStatus = deriveSerpStatus({
    hasCredentials: hasDfsCredentials,
    attemptedCount: serpQueriesAttempted,
    successfulCount: serpQueriesSucceeded,
    failureCount: serpQueryFailures.length,
    candidateCount: serpCandidates.length,
  });

  const suppliedStatus = suppliedCompetitors.length > 0
    ? (suppliedCompetitors.some((competitor) => competitor.status === SOURCE_STATUS.AVAILABLE)
        ? SOURCE_STATUS.AVAILABLE
        : SOURCE_STATUS.FAILED)
    : SOURCE_STATUS.NOT_APPLICABLE;

  const completedAt = new Date().toISOString();

  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "competitor-opportunity-layer",
    sourceStatus: (qualified.length > 0 || serpCandidates.length > 0 || suppliedCandidates.length > 0)
      ? (serpStatus === SOURCE_STATUS.PARTIAL ? SOURCE_STATUS.PARTIAL : SOURCE_STATUS.AVAILABLE)
      : serpStatus,
    status: SOURCE_STATUS.AVAILABLE,
    topics,
    candidates: {
      qualified: qualified.slice(0, 20),
      excluded: excluded.slice(0, 50),
      totalSerp: serpCandidates.length,
      totalSupplied: suppliedCandidates.length,
      totalQualified: qualified.length,
      totalExcluded: excluded.length,
    },
    gaps: gaps.filter((gap) => gap.approvalStatus === "approved" && gap.gapPassed).slice(0, 10),
    allGaps: gaps,
    sources: {
      dataforseoSerp: {
        status: serpStatus,
        taskIds: serpTaskIds,
        candidateCount: serpCandidates.length,
        attemptedCount: serpQueriesAttempted,
        successfulCount: serpQueriesSucceeded,
        failedCount: serpQueryFailures.length,
        queryFailures: serpQueryFailures.length > 0 ? serpQueryFailures : undefined,
        taskErrors: serpTaskErrors.length > 0 ? serpTaskErrors : undefined,
        normalizedLanguage: serpNormalizedLanguage?.languageName || null,
        normalizedLocation: serpNormalizedLocation?.locationName || null,
        originalLanguage: serpOriginalLanguage,
        originalLocation: serpOriginalLocation,
      },
      supplied: {
        status: suppliedStatus,
        candidateCount: suppliedCandidates.length,
      },
    },
    limitations,
    collectedAt: completedAt,
    coverage: {
      topicsRequested: topics.length,
      serpQueriesAttempted,
      serpQueriesSucceeded,
      serpQueriesFailed: serpQueryFailures.length,
      serpCandidatesFound: serpCandidates.length,
      suppliedCandidatesFound: suppliedCandidates.length,
      qualifiedCandidates: qualified.length,
      excludedCandidates: excluded.length,
      approvedGaps: gaps.filter((gap) => gap.approvalStatus === "approved" && gap.gapPassed).length,
    },
    rawArtifactRef: serpTaskIds.length > 0 ? serpTaskIds.join(",") : null,
    _sourceStatus: buildSourceStatus({
      provider: "competitor-opportunity-layer",
      adapterVersion: "1.1.0",
      startedAt,
      completedAt,
      requestId: serpTaskIds[0] || null,
      retryCount: 0,
      returnedRecordCount: qualified.length,
      expectedRecordCount: topics.length * 20 + suppliedCandidates.length,
      errorCategory: (serpStatus === SOURCE_STATUS.FAILED || serpStatus === SOURCE_STATUS.PARTIAL)
        ? ERROR_CATEGORY.INTERNAL
        : null,
      limitation: limitations.length > 0 ? limitations.join("; ") : null,
      rawArtifactRef: serpTaskIds.length > 0 ? serpTaskIds.join(",") : null,
      normalizedLanguage: serpNormalizedLanguage?.languageName || null,
      normalizedLocation: serpNormalizedLocation?.locationName || null,
      originalLanguage: serpOriginalLanguage,
      originalLocation: serpOriginalLocation,
      serpQueryFailures: serpQueryFailures.length > 0 ? serpQueryFailures : undefined,
      serpTaskErrors: serpTaskErrors.length > 0 ? serpTaskErrors : undefined,
    }),
  };
}

export {
  QUALIFICATION_CHECKS,
  GAP_CHECKS,
  EXCLUDED_PAGE_TYPES,
  extractTopics,
  isExcludedPageType,
  deriveSerpStatus,
  normalizeQueryFailure,
  formatQueryFailureForLimitation,
};

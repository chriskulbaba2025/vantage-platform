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
 * No causal ranking claims.  No unapproved competitor evidence is score-bearing.
 */

import { SOURCE_STATUS, ERROR_CATEGORY, buildSourceStatus, EVIDENCE_ENVELOPE_VERSION } from "../scoring/evidence-contracts.js";
import { domainOf } from "../utils.js";
import { querySerp } from "../adapters/dataforseo-serp/dataforseo-serp-client.js";

// ---------------------------------------------------------------------------
// Candidate qualification gate (PRD §12.3)
// ---------------------------------------------------------------------------

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

/**
 * Run the five qualification checks on a competitor candidate.
 *
 * Returns { passed, results } where `results` is a Map of check name → boolean.
 * All five must pass for the candidate to be retained.
 */
export function qualifyCandidate(candidate, clientContext) {
  const results = new Map();

  // 1. Geographic relevance — candidate serves same market
  const geoMatch =
    !candidate.geographicContext || !clientContext.location
      ? true // can't determine — pass by default
      : candidate.geographicContext.toLowerCase().includes(
          clientContext.location.toLowerCase().split(",")[0]?.trim() || "",
        ) ||
        clientContext.location.toLowerCase().includes(
          (candidate.geographicContext || "").toLowerCase().split(",")[0]?.trim() || "",
        );
  results.set("geographic_relevance", geoMatch);

  // 2. Service relevance — candidate topic aligns with client services
  const topicMatch =
    !candidate.topic
      ? false
      : (clientContext.services || []).some(
          (svc) =>
            candidate.topic.toLowerCase().includes(svc.toLowerCase()) ||
            svc.toLowerCase().includes((candidate.topic || "").toLowerCase()),
        ) || (clientContext.topicKeywords || []).some(
          (kw) =>
            candidate.topic.toLowerCase().includes(kw.toLowerCase()),
        );
  results.set("service_relevance", topicMatch);

  // 3. Audience relevance — candidate targets same audience type
  // For MVP, infer from page type and domain signals
  const audienceMatch = candidate.pageType !== "reference" && candidate.pageType !== "community";
  results.set("audience_relevance", audienceMatch);

  // 4. Commercial-intent relevance — candidate has commercial intent
  const commercialMatch =
    candidate.pageType === "service" ||
    candidate.pageType === "product" ||
    candidate.pageType === "pricing" ||
    candidate.pageType === "company_page" ||
    candidate.pageType === "landing";
  results.set("commercial_intent_relevance", commercialMatch);

  // 5. Page-type comparability — can we compare this page to client pages?
  const comparable =
    !EXCLUDED_PAGE_TYPES.has(candidate.pageType) &&
    candidate.pageType !== "support";
  results.set("page_type_comparability", comparable);

  const passed = [...results.values()].every(Boolean);
  const exclusionReason = !passed
    ? [...results.entries()]
        .filter(([, v]) => !v)
        .map(([k]) => k)
        .join(", ")
    : null;

  return { passed, results: Object.fromEntries(results), exclusionReason };
}

// ---------------------------------------------------------------------------
// Qualified gap rule (PRD §12.4)
// ---------------------------------------------------------------------------

const GAP_CHECKS = Object.freeze([
  "offer_alignment",
  "audience_alignment",
  "buyer_journey_alignment",
  "expertise_credibility",
  "conversion_path_viability",
  "realistic_competitive_feasibility",
]);

/**
 * Run the six qualified-gap checks.
 *
 * Returns { passed, results }.
 * All six must pass for a gap to become a recommendation.
 * Unknown/undetermined = failure (conservative).
 */
export function qualifyGap(clientTopic, competitorPage, clientCoverage, competitorCoverage) {
  const results = new Map();

  // 1. Offer alignment — do they offer comparable services?
  results.set("offer_alignment", Boolean(clientTopic && competitorPage?.topic));

  // 2. Audience alignment — same audience?
  results.set("audience_alignment", Boolean(competitorPage?.domain));

  // 3. Buyer-journey alignment — same funnel stage?
  const journeyMatch = competitorPage?.pageType === "service" ||
    competitorPage?.pageType === "landing" ||
    competitorPage?.pageType === "pricing" ||
    competitorPage?.pageType === "company_page";
  results.set("buyer_journey_alignment", journeyMatch);

  // 4. Expertise credibility — does competitor show credible expertise?
  const expertise = competitorPage?.hasSchema?.length > 0 ||
    (competitorCoverage?.length || 0) > 0;
  results.set("expertise_credibility", expertise);

  // 5. Conversion-path viability — is there a visible conversion action?
  results.set("conversion_path_viability", Boolean(competitorPage?.candidateUrl));

  // 6. Realistic competitive feasibility — can the client realistically compete?
  const feasible = clientCoverage !== null; // Client has some coverage = feasible
  results.set("realistic_competitive_feasibility", feasible);

  const passed = [...results.values()].every(Boolean);

  return { passed, results: Object.fromEntries(results) };
}

// ---------------------------------------------------------------------------
// Exclusion matcher
// ---------------------------------------------------------------------------

function isExcludedPageType(pageType) {
  return EXCLUDED_PAGE_TYPES.has(pageType);
}

// ---------------------------------------------------------------------------
// Topic extraction from audit context
// ---------------------------------------------------------------------------

function extractTopics(site, input) {
  const topics = [];
  const services = site.services || [];
  const keywords = site.topicKeywords || [];
  const location = input.location || "";

  for (const svc of services.slice(0, 5)) {
    const query = location ? `${svc} ${location}` : svc;
    topics.push({ topic: svc, query, source: "service", language: input.language || "en" });
  }

  for (const kw of keywords.slice(0, 3)) {
    if (!services.some((s) => kw.toLowerCase().includes(s.toLowerCase()))) {
      const query = location ? `${kw} ${location}` : kw;
      topics.push({ topic: kw, query, source: "keyword", language: input.language || "en" });
    }
  }

  // Ensure at least one topic
  if (topics.length === 0 && input.businessName) {
    const query = location ? `${input.businessName} ${location}` : input.businessName;
    topics.push({ topic: input.businessName, query, source: "business_name", language: input.language || "en" });
  }

  return topics.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Main entry point: collect competitor opportunities
// ---------------------------------------------------------------------------

/**
 * Collect competitor opportunities from all available sources.
 *
 * @param {object} site          Crawl site evidence
 * @param {object} input         Validated audit input
 * @param {object} options
 * @param {string} options.dataforseoLogin
 * @param {string} options.dataforseoPassword
 * @param {object} [options.suppliedCompetitors]  Pre-crawled supplied competitors
 * @param {object} [options.fetchImpl]
 * @param {object} [options.auditorApprovals]     Existing auditor decisions
 * @returns {object} competitor evidence envelope
 */
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

  // ── Source 1: DataForSEO SERP ─────────────────────────────────────────
  const serpCandidates = [];
  let serpTaskIds = [];
  let serpTaskErrors = [];
  let serpNormalizedLanguage = null;
  let serpNormalizedLocation = null;
  let serpOriginalLanguage = input.language || null;
  let serpOriginalLocation = input.location || null;

  if (hasDfsCredentials && topics.length > 0) {
    for (const topic of topics.slice(0, 3)) {
      try {
        const result = await querySerp(topic.query, {
          login,
          password,
          location: input.location || "Canada",
          language: input.language || "en",
          fetchImpl,
        });

        // Capture normalized values from first successful resolution
        if (!serpNormalizedLanguage && result.normalizedLanguage) {
          serpNormalizedLanguage = result.normalizedLanguage;
        }
        if (!serpNormalizedLocation && result.normalizedLocation) {
          serpNormalizedLocation = result.normalizedLocation;
        }

        if (result.error) {
          limitations.push(`DataForSEO SERP for "${topic.query}": ${result.error}`);
        }

        // Track task-level errors separately (distinct from empty results)
        if (result.taskError) {
          serpTaskErrors.push({
            topic: topic.query,
            taskId: result.taskError.taskId,
            statusCode: result.taskError.statusCode,
            statusMessage: result.taskError.statusMessage,
          });
        }

        if (result.rawTaskId) serpTaskIds.push(result.rawTaskId);

        for (const item of result.items || []) {
          serpCandidates.push(item);
        }
      } catch (error) {
        limitations.push(`DataForSEO SERP failed for topic "${topic.query}": ${error.message}`);
      }
    }
  } else if (!hasDfsCredentials) {
    limitations.push("DataForSEO credentials not configured — SERP competitor discovery skipped.");
  }

  // ── Source 2: User-supplied competitors ───────────────────────────────
  const suppliedCandidates = suppliedCompetitors
    .filter((c) => c.status === SOURCE_STATUS.AVAILABLE)
    .map((c) => ({
      candidateUrl: c.url,
      domain: domainOf(c.url),
      topic: topics[0]?.topic || input.businessName || "general",
      discoverySource: "user-supplied",
      geographicContext: input.location || "",
      languageContext: input.language || "en",
      pageType: "landing",
      position: null,
      rawArtifactRef: `user-supplied://${c.url}`,
      evidence: c.evidence,
      serpFeatures: [],
      hasSchema: c.evidence?.schemaTypes || [],
    }));

  // ── Qualification ─────────────────────────────────────────────────────
  const allCandidates = [...serpCandidates, ...suppliedCandidates];
  const qualified = [];
  const excluded = [];

  for (const candidate of allCandidates) {
    const q = qualifyCandidate(candidate, clientContext);
    if (q.passed) {
      qualified.push({
        ...candidate,
        qualificationPassed: true,
        qualificationResults: q.results,
        approvalStatus: auditorApprovals[candidate.candidateUrl] || "pending",
      });
    } else {
      excluded.push({
        candidateUrl: candidate.candidateUrl,
        domain: candidate.domain,
        topic: candidate.topic,
        discoverySource: candidate.discoverySource,
        exclusionReason: q.exclusionReason,
        qualificationResults: q.results,
      });
    }
  }

  // ── Gap analysis ─────────────────────────────────────────────────────
  const gaps = [];

  for (const candidate of qualified) {
    const clientCoverage = site.services?.some(
      (s) => candidate.topic?.toLowerCase().includes(s.toLowerCase()),
    ) || site.topicKeywords?.some(
      (k) => candidate.topic?.toLowerCase().includes(k.toLowerCase()),
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
        : `Gap check failed: ${Object.entries(gapCheck.results).filter(([, v]) => !v).map(([k]) => k).join(", ")}`,
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

  // ── Source statuses ───────────────────────────────────────────────────
  // Distinguish task failures from genuine empty results:
  //   - FAILED: all SERP tasks returned an error status_code (no usable evidence)
  //   - PARTIAL: at least one task succeeded with usable candidates, but one
  //     or more other tasks failed
  //   - AVAILABLE: at least one candidate found, no task errors
  //   - UNAVAILABLE: tasks succeeded but returned zero organic results
  //   - NOT_CONNECTED: no DataForSEO credentials
  const serpStatus = hasDfsCredentials
    ? (serpTaskErrors.length > 0
        ? (serpCandidates.length > 0 ? SOURCE_STATUS.PARTIAL : SOURCE_STATUS.FAILED)
        : (serpCandidates.length > 0 ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.UNAVAILABLE))
    : SOURCE_STATUS.NOT_CONNECTED;

  const suppliedStatus = suppliedCompetitors.length > 0
    ? (suppliedCompetitors.some((c) => c.status === SOURCE_STATUS.AVAILABLE)
        ? SOURCE_STATUS.AVAILABLE
        : SOURCE_STATUS.FAILED)
    : SOURCE_STATUS.NOT_APPLICABLE;

  const completedAt = new Date().toISOString();

  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "competitor-opportunity-layer",
    sourceStatus: (qualified.length > 0 || serpCandidates.length > 0 || suppliedCompetitors.length > 0)
      ? SOURCE_STATUS.AVAILABLE
      : SOURCE_STATUS.UNAVAILABLE,
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
    gaps: gaps.filter((g) => g.approvalStatus === "approved" && g.gapPassed).slice(0, 10),
    allGaps: gaps,
    sources: {
      dataforseoSerp: {
        status: serpStatus,
        taskIds: serpTaskIds,
        candidateCount: serpCandidates.length,
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
      serpCandidatesFound: serpCandidates.length,
      suppliedCandidatesFound: suppliedCandidates.length,
      qualifiedCandidates: qualified.length,
      excludedCandidates: excluded.length,
      approvedGaps: gaps.filter((g) => g.approvalStatus === "approved" && g.gapPassed).length,
    },
    rawArtifactRef: serpTaskIds.length > 0 ? serpTaskIds.join(",") : null,
    _sourceStatus: buildSourceStatus({
      provider: "competitor-opportunity-layer",
      adapterVersion: "1.0.0",
      startedAt,
      completedAt,
      requestId: serpTaskIds[0] || null,
      retryCount: 0,
      returnedRecordCount: qualified.length,
      expectedRecordCount: topics.length * 20 + suppliedCandidates.length,
      errorCategory: (serpStatus === SOURCE_STATUS.FAILED || serpStatus === SOURCE_STATUS.PARTIAL) ? ERROR_CATEGORY.INTERNAL : null,
      limitation: limitations.length > 0 ? limitations.join("; ") : null,
      rawArtifactRef: serpTaskIds.length > 0 ? serpTaskIds.join(",") : null,
      // Preserve locale/location context for audit trail
      normalizedLanguage: serpNormalizedLanguage?.languageName || null,
      normalizedLocation: serpNormalizedLocation?.locationName || null,
      originalLanguage: serpOriginalLanguage,
      originalLocation: serpOriginalLocation,
      serpTaskErrors: serpTaskErrors.length > 0 ? serpTaskErrors : undefined,
    }),
  };
}

// Re-export for testing
export { QUALIFICATION_CHECKS, GAP_CHECKS, EXCLUDED_PAGE_TYPES, extractTopics, isExcludedPageType };

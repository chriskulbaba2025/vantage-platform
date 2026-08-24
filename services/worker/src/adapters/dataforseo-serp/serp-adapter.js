/**
 * DataForSEO SERP Adapter — WP6 governed execute() wrapper.
 *
 * Wraps querySerp() behind the universal source contract expected by the
 * AuditOrchestrator. User-supplied competitor URLs are benchmarked through
 * the repository's existing bounded direct-crawl path before SERP discovery.
 * Returns schema-valid source results with raw bytes for artifact storage.
 *
 * @module adapters/dataforseo-serp/serp-adapter
 */

import { querySerp } from "./dataforseo-serp-client.js";
import { crawlCompetitors } from "../../evidence/site-crawler.js";

const ADAPTER_VERSION = "1.2.0";
const AUDIENCE_SCOPES = new Set(["local", "regional", "national"]);

function domainKey(value) {
  try {
    const raw = String(value || "").trim();
    const host = raw.includes("://") ? new URL(raw).hostname : raw;
    return host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeSuppliedCompetitor(result) {
  if (result?.status !== "AVAILABLE" || !result.evidence) return null;

  const site = result.evidence;

  if (
    site.sourceStatus &&
    site.sourceStatus !== "AVAILABLE" &&
    site.sourceStatus !== "PARTIAL"
  ) {
    return null;
  }

  const pages = Array.isArray(site.pages) ? site.pages : [];

  const viablePages = pages.filter((page) => {
    const status = Number(page?.status);
    return Number.isFinite(status) && status >= 200 && status < 400;
  });

  if (viablePages.length === 0) return null;

  const domain = site.domain || domainKey(result.url);
  const firstPage = viablePages[0];

  const services = [
    ...new Set(
      viablePages.flatMap((page) =>
        Array.isArray(page?.serviceCandidates)
          ? page.serviceCandidates
          : [],
      ),
    ),
  ];

  const ctas = viablePages.flatMap((page) =>
    Array.isArray(page?.ctas) ? page.ctas : [],
  );

  const forms = viablePages.flatMap((page) =>
    Array.isArray(page?.forms) ? page.forms : [],
  );

  const socialLinks = viablePages.flatMap((page) =>
    Array.isArray(page?.socialLinks) ? page.socialLinks : [],
  );

  const schemaTypes = [
    ...new Set(
      viablePages.flatMap((page) =>
        Array.isArray(page?.schemaTypes) ? page.schemaTypes : [],
      ),
    ),
  ];

  const signals = viablePages.map((page) => page?.signals || {});

  return {
    candidateUrl: result.url,
    domain,
    title: firstPage?.title || domain || result.url,
    description: firstPage?.description || "",
    position: null,
    _keyword: "",
    _evidenceStatus: "AVAILABLE",
    discoverySource: "user-supplied",
    source: "prysm-direct-crawl",
    directCrawlCollectedAt: site.collectedAt || null,
    pageCount: viablePages.length,
    pages: viablePages.slice(0, 8).map((page) => ({
      url: page.url || "",
      title: page.title || "",
    })),
    services,
    topicKeywords: Array.isArray(site.topicKeywords)
      ? site.topicKeywords
      : [],
    ctas,
    forms,
    trust: {
      testimonials: signals.some((signal) => signal.testimonials === true),
      credentials: signals.some((signal) => signal.credentials === true),
      caseStudies: signals.some((signal) => signal.caseStudies === true),
      faq: signals.some((signal) => signal.faq === true),
      pricing: signals.some((signal) => signal.pricing === true),
      policies: signals.some((signal) => signal.policies === true),
      contact: signals.some((signal) => signal.contact === true),
    },
    socialLinks,
    schemaTypes,
    limitations: Array.isArray(site.limitations)
      ? site.limitations
      : [],
  };
}

function combineSourceStatus({
  serpStatus,
  suppliedAvailable,
  suppliedFailed,
}) {
  if (suppliedAvailable > 0) {
    if (
      suppliedFailed > 0 ||
      serpStatus === "PARTIAL" ||
      serpStatus === "FAILED" ||
      serpStatus === "NOT_CONNECTED"
    ) {
      return "PARTIAL";
    }

    return "AVAILABLE";
  }

  if (
    suppliedFailed > 0 &&
    (
      serpStatus === "NOT_CONNECTED" ||
      serpStatus === "NOT_APPLICABLE"
    )
  ) {
    return "FAILED";
  }

  return serpStatus;
}

function deriveSerpStatus({
  successfulQueries,
  requestedQueries,
  itemCount,
}) {
  if (requestedQueries === 0) {
    return "NOT_APPLICABLE";
  }

  if (successfulQueries === requestedQueries) {
    return itemCount > 0 ? "AVAILABLE" : "UNAVAILABLE";
  }

  if (successfulQueries > 0) {
    return "PARTIAL";
  }

  return "FAILED";
}

function dedupeSerpAgainstSupplied(
  serpItems,
  suppliedDomains,
) {
  return serpItems.filter((item) => {
    const key = domainKey(
      item.domain ||
      item.candidateUrl ||
      item.url ||
      item.link,
    );

    return !key || !suppliedDomains.has(key);
  });
}

function sourceAbortLimitation(keyword = null) {
  return keyword
    ? `SERP execution aborted before completing keyword "${keyword}".`
    : "SERP execution aborted before all requested keywords completed.";
}

/** Execute the DataForSEO SERP adapter behind the universal source contract. */
export async function execute({
  auditRequest,
  source,
  executionId,
  sourceExecutionKey,
  signal,
  attempt,
}) {
  const startedAt = new Date().toISOString();

  const competitorConfig = auditRequest.competitors || {};

  const suppliedCompetitors = Array.isArray(auditRequest.competitors)
    ? auditRequest.competitors
    : (competitorConfig.supplied || []);

  const services = auditRequest.services || [];

  const keywords = services.length > 0
    ? services
      .slice(0, 5)
      .map((service) =>
        typeof service === "string"
          ? service
          : service.name || service.service || "",
      )
      .filter(Boolean)
    : [
        auditRequest.primaryGoal ||
        auditRequest.businessName ||
        "",
      ].filter(Boolean);

  const rawMarket = String(
    auditRequest.market ||
    competitorConfig.market ||
    "",
  ).trim();

  const audienceScope = AUDIENCE_SCOPES.has(
    rawMarket.toLowerCase(),
  )
    ? rawMarket.toLowerCase()
    : null;

  // Local/regional/national is a competitive-scope classification, not a
  // DataForSEO location name. Keep the provider location valid while carrying
  // the scope through evidence/report context. Geographic refinement can be
  // added later without changing the intake contract.
  const controlledFetch =
    (
      auditRequest.serp &&
      typeof auditRequest.serp === "object"
        ? auditRequest.serp.fetchImpl
        : null
    ) || null;

  const options = {
    location: audienceScope
      ? "Canada"
      : (rawMarket || "Canada"),
    language:
      auditRequest.language ||
      competitorConfig.language ||
      "en",
    login: process.env.DATAFORSEO_LOGIN || "",
    password: process.env.DATAFORSEO_PASSWORD || "",

    // Testability seam: controlled transport below the adapter layer.
    // Production default behaviour is unchanged (null -> live fetch).
    fetchImpl: controlledFetch,

    // DQV-001: the source/orchestrator AbortSignal must reach every live
    // DataForSEO SERP request. querySerp() combines this caller signal with
    // its request-local 120-second ceiling and bounded transient retry.
    signal,
  };

  // Supplied URLs are intentional competitor selections. Reuse the existing
  // direct competitor crawler, but keep this production closure bounded and
  // static: maximum 8 pages per URL, no Playwright/browser fallback.
  const directFetch = async (...args) => {
    if (signal?.aborted) {
      throw Object.assign(
        new Error("Competitor execution aborted"),
        { category: "timeout" },
      );
    }

    const fetchImpl = controlledFetch || globalThis.fetch;
    return fetchImpl(...args);
  };

  const suppliedResults = suppliedCompetitors.length > 0
    ? await crawlCompetitors(suppliedCompetitors, {
        maxPages: 8,
        browserMode: "never",
        fetchImpl: directFetch,
      })
    : [];

  const suppliedEntries = suppliedResults.map((result) => ({
    result,
    item: normalizeSuppliedCompetitor(result),
  }));

  const suppliedItems = suppliedEntries
    .map((entry) => entry.item)
    .filter(Boolean);

  const suppliedFailed = suppliedEntries
    .filter((entry) => !entry.item)
    .map((entry) => ({
      ...entry.result,
      error:
        entry.result?.error ||
        "no usable 2xx/3xx HTML evidence returned",
    }));

  const suppliedResultSummaries = suppliedEntries.map((entry) => ({
    status: entry.item
      ? "AVAILABLE"
      : (
          entry.result?.status === "AVAILABLE"
            ? "FAILED"
            : entry.result?.status || "FAILED"
        ),
    url: entry.result?.url || null,
    error: entry.item
      ? null
      : (
          entry.result?.error ||
          "no usable 2xx/3xx HTML evidence returned"
        ),
  }));

  const suppliedDomains = new Set(
    suppliedItems
      .map((item) =>
        domainKey(item.domain || item.candidateUrl),
      )
      .filter(Boolean),
  );

  const suppliedLimitations = suppliedFailed.map(
    (item) =>
      `Supplied competitor crawl failed for ${item.url}: ${
        item.error || "no usable evidence returned"
      }`,
  );

  // No SERP keywords is not a blocker when direct supplied evidence exists.
  if (keywords.length === 0) {
    const completedAt = new Date().toISOString();

    const status = suppliedItems.length > 0
      ? (
          suppliedFailed.length > 0
            ? "PARTIAL"
            : "AVAILABLE"
        )
      : (
          suppliedFailed.length > 0
            ? "FAILED"
            : "NOT_APPLICABLE"
        );

    const rawPayload = {
      adapterVersion: ADAPTER_VERSION,
      collectedAt: completedAt,
      audienceScope,
      providerLocation: options.location,
      keywords: [],
      items: suppliedItems,
      suppliedCompetitors,
      suppliedResults: suppliedResultSummaries,
      errors: suppliedLimitations,
    };

    const rawBytes = suppliedCompetitors.length > 0
      ? Buffer.from(
          JSON.stringify(rawPayload),
          "utf-8",
        )
      : null;

    const sourceResult = {
      contractVersion: "1.0.0",
      schemaVersion: "1.0.0",
      source,
      provider:
        suppliedCompetitors.length > 0
          ? "Prysm direct crawl"
          : "DataForSEO",
      adapterVersion: ADAPTER_VERSION,
      status,
      startedAt,
      completedAt,
      retryCount: Math.max(
        0,
        (attempt || 1) - 1,
      ),
      expectedRecords: suppliedCompetitors.length,
      returnedRecords: suppliedItems.length,
      coverage: {
        requested: suppliedCompetitors.length,
        completed: suppliedItems.length,
        failed: suppliedFailed.length,
      },
      limitations:
        suppliedItems.length > 0
          ? suppliedLimitations
          : [
              ...suppliedLimitations,
              "No service keywords configured for SERP analysis.",
            ],
      evidence: {
        competitors: suppliedItems,
        suppliedCompetitors,
        suppliedCompetitorCoverage: {
          requested: suppliedCompetitors.length,
          completed: suppliedItems.length,
          failed: suppliedFailed.length,
        },
        audienceScope,
        providerLocation: options.location,
        keywordCount: 0,
        resultCount: suppliedItems.length,
      },
    };

    if (status === "FAILED") {
      sourceResult.errorCategory = "no_data";
    }

    return {
      rawBytes,
      contentType:
        rawBytes
          ? "application/json"
          : null,
      sourceResult,
    };
  }

  // Missing SERP credentials suppress only SERP discovery. Successfully
  // collected supplied evidence remains usable and is carried as PARTIAL
  // composite evidence rather than being discarded as NOT_CONNECTED.
  if (!options.login || !options.password) {
    const completedAt = new Date().toISOString();

    const serpLimitation =
      "DataForSEO credentials not configured for SERP queries.";

    const status = combineSourceStatus({
      serpStatus: "NOT_CONNECTED",
      suppliedAvailable: suppliedItems.length,
      suppliedFailed: suppliedFailed.length,
    });

    const limitations = [
      ...suppliedLimitations,
      serpLimitation,
    ];

    const rawPayload = {
      adapterVersion: ADAPTER_VERSION,
      collectedAt: completedAt,
      audienceScope,
      providerLocation: options.location,
      keywords,
      items: suppliedItems,
      suppliedCompetitors,
      suppliedResults: suppliedResultSummaries,
      errors: limitations,
    };

    const rawBytes = suppliedCompetitors.length > 0
      ? Buffer.from(
          JSON.stringify(rawPayload),
          "utf-8",
        )
      : null;

    const sourceResult = {
      contractVersion: "1.0.0",
      schemaVersion: "1.0.0",
      source,
      provider:
        suppliedItems.length > 0
          ? "Prysm direct crawl + DataForSEO"
          : "DataForSEO",
      adapterVersion: ADAPTER_VERSION,
      status,
      startedAt,
      completedAt,
      retryCount: Math.max(
        0,
        (attempt || 1) - 1,
      ),
      expectedRecords:
        suppliedCompetitors.length +
        keywords.length,
      returnedRecords: suppliedItems.length,
      coverage: {
        requested:
          suppliedCompetitors.length +
          keywords.length,
        completed: suppliedItems.length,
        failed:
          suppliedFailed.length +
          keywords.length,
      },
      limitations,
      evidence: {
        competitors: suppliedItems,
        suppliedCompetitors,
        suppliedCompetitorCoverage: {
          requested: suppliedCompetitors.length,
          completed: suppliedItems.length,
          failed: suppliedFailed.length,
        },
        serpStatus: "NOT_CONNECTED",
        audienceScope,
        providerLocation: options.location,
        keywordCount: keywords.length,
        resultCount: suppliedItems.length,
      },
    };

    if (status === "NOT_CONNECTED") {
      sourceResult.errorCategory = "not_configured";
    }

    if (status === "FAILED") {
      sourceResult.errorCategory = "no_data";
    }

    return {
      rawBytes,
      contentType:
        rawBytes
          ? "application/json"
          : null,
      sourceResult,
    };
  }
    const allItems = [];
  const errors = [];

  const totalRequested = keywords.length;

  let successfulQueries = 0;
  let sourceAborted = false;

  for (const keyword of keywords) {
    /*
     * Caller cancellation is terminal for this source execution. Do not start
     * another paid provider request after the orchestration signal is aborted.
     *
     * Unlike the previous implementation, we do not throw here and discard
     * already-collected SERP evidence. We stop the loop and finalize whatever
     * usable evidence was completed before cancellation.
     */
    if (signal?.aborted) {
      sourceAborted = true;
      errors.push(sourceAbortLimitation(keyword));
      break;
    }

    try {
      const result = await querySerp(
        keyword,
        options,
      );

      if (result.error) {
        errors.push(
          `${keyword}: ${result.error}`,
        );

        /*
         * querySerp() returns a governed failure object for cancellation.
         * Once the caller signal is aborted, stop immediately so another
         * keyword/provider request cannot begin.
         */
        if (signal?.aborted) {
          sourceAborted = true;
          break;
        }

        continue;
      }

      successfulQueries += 1;

      if (
        result.items &&
        result.items.length > 0
      ) {
        allItems.push(
          ...result.items.map((item) => ({
            ...item,
            _keyword: keyword,
            _evidenceStatus: "AVAILABLE",
          })),
        );
      }
    } catch (keywordError) {
      errors.push(
        `${keyword}: ${
          keywordError?.message ||
          String(keywordError)
        }`,
      );

      if (signal?.aborted) {
        sourceAborted = true;
        break;
      }
    }
  }

  if (
    sourceAborted &&
    !errors.some((entry) =>
      /SERP execution aborted/i.test(entry),
    )
  ) {
    errors.push(
      sourceAbortLimitation(),
    );
  }

  // A directly benchmarked supplied domain is stronger evidence for the
  // supplied comparison than a search-result snippet for that same domain.
  const dedupedSerpItems = dedupeSerpAgainstSupplied(
    allItems,
    suppliedDomains,
  );

  const combinedItems = [
    ...suppliedItems,
    ...dedupedSerpItems,
  ];

  const completedAt = new Date().toISOString();

  /*
   * A successful keyword remains a completed provider request even when it
   * returns zero organic candidates.
   *
   * This preserves the distinction between:
   * - AVAILABLE: every keyword succeeded and usable organic results exist;
   * - UNAVAILABLE: every keyword succeeded but no organic results exist;
   * - PARTIAL: some keywords succeeded and some failed/aborted;
   * - FAILED: no keyword completed successfully.
   */
  const serpStatus = deriveSerpStatus({
    successfulQueries,
    requestedQueries: totalRequested,
    itemCount: allItems.length,
  });

  const status = combineSourceStatus({
    serpStatus,
    suppliedAvailable: suppliedItems.length,
    suppliedFailed: suppliedFailed.length,
  });

  const limitations = [
    ...suppliedLimitations,
    ...errors,
  ];

  const rawPayload = {
    adapterVersion: ADAPTER_VERSION,
    collectedAt: completedAt,
    audienceScope,
    providerLocation: options.location,
    keywords,
    items: combinedItems,
    suppliedCompetitors,
    suppliedResults: suppliedResultSummaries,
    serpStatus,
    errors: limitations,
  };

  /*
   * Preserve the raw artifact whenever any provider or supplied-competitor
   * execution occurred. This includes graceful PARTIAL/FAILED SERP outcomes
   * so completed evidence is not replaced by a synthetic empty failure.
   */
  const rawBytes = Buffer.from(
    JSON.stringify(rawPayload),
    "utf-8",
  );

  const sourceResult = {
    contractVersion: "1.0.0",
    schemaVersion: "1.0.0",
    source,
    provider:
      suppliedCompetitors.length > 0
        ? "DataForSEO + Prysm direct crawl"
        : "DataForSEO",
    adapterVersion: ADAPTER_VERSION,
    status,
    startedAt,
    completedAt,
    requestId: executionId,
    retryCount: Math.max(
      0,
      (attempt || 1) - 1,
    ),
    expectedRecords:
      suppliedCompetitors.length +
      totalRequested,
    returnedRecords:
      suppliedItems.length +
      successfulQueries,
    coverage: {
      requested:
        suppliedCompetitors.length +
        totalRequested,
      completed:
        suppliedItems.length +
        successfulQueries,
      failed:
        suppliedFailed.length +
        (
          totalRequested -
          successfulQueries
        ),
    },
    limitations,
    evidence: {
      competitors: combinedItems.slice(0, 100),
      suppliedCompetitors,
      suppliedCompetitorCoverage: {
        requested: suppliedCompetitors.length,
        completed: suppliedItems.length,
        failed: suppliedFailed.length,
      },
      serpStatus,
      audienceScope,
      providerLocation: options.location,
      keywordCount: keywords.length,
      resultCount: combinedItems.length,
    },
  };

  if (
    status === "FAILED" &&
    limitations.length > 0
  ) {
    sourceResult.errorCategory =
      sourceAborted
        ? "timeout"
        : "no_data";
  }

  return {
    rawBytes,
    contentType: "application/json",
    sourceResult,
  };
}

export { ADAPTER_VERSION };
export default { execute };
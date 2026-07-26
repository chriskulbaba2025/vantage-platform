import { crawlSite, crawlCompetitors } from "../evidence/site-crawler.js";
import { crawlWithDataforseo } from "../adapters/dataforseo-onpage/dataforseo-onpage-adapter.js";
import { collectPerformance, collectPerformanceForPages } from "../evidence/pagespeed-client.js";
import { collectBacklinks } from "../evidence/backlinks-provider.js";
import { collectGa4 } from "../evidence/ga4-client.js";
import { collectGsc } from "../evidence/gsc-client.js";
import { collectCompetitorOpportunities } from "../evidence/competitor-opportunity-layer.js";
import { scoreAudit } from "../scoring/vantage-score.js";
import { renderReport } from "../report/render-report.js";
import { createReportStore } from "../storage/report-store.js";
import { createRunId, domainOf, normalizeUrl, slugify } from "../utils.js";
import { loadConfig } from "../config.js";
import {
  SOURCE_STATUS,
  ERROR_CATEGORY,
  buildSourceStatus,
  EVIDENCE_ENVELOPE_VERSION,
  validateEvidenceEnvelope,
  downgradeToFailed,
} from "../scoring/evidence-contracts.js";
import {
  LIFECYCLE_STATUS,
  buildReviewRecord,
  buildApprovalRecord,
  validateTransition,
  isReviewComplete,
  validateCompetitorDecisions,
  buildCompetitorOverrides,
} from "./review-gate.js";
import { renderApprovedReport } from "../report/render-approved-report.js";

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateInput(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Audit input must be an object");
  if (!raw.targetUrl || typeof raw.targetUrl !== "string") throw new Error("targetUrl is required");
  const targetUrl = normalizeUrl(raw.targetUrl);
  const competitors = Array.isArray(raw.competitors)
    ? raw.competitors.filter(Boolean).slice(0, 3).map(normalizeUrl)
    : [];
  return {
    targetUrl,
    businessName: String(raw.businessName || "").trim(),
    location: String(raw.location || "").trim(),
    language: String(raw.language || "en-CA").trim(),
    competitors,
    primaryGoal: String(raw.primaryGoal || "Generate qualified enquiries").trim(),
    ga4: raw.ga4 && typeof raw.ga4 === "object" ? raw.ga4 : {},
  };
}

// ---------------------------------------------------------------------------
// Safe provider wrapper
// ---------------------------------------------------------------------------

function safeResult(provider, label) {
  return async (...args) => {
    try {
      return await provider(...args);
    } catch (error) {
      return {
        evidenceVersion: "1.0.0",
        source: label,
        sourceStatus: SOURCE_STATUS.FAILED,
        status: SOURCE_STATUS.FAILED,
        error: `${label}: ${error.message}`,
        limitations: [`${label}: ${error.message}`],
        collectedAt: new Date().toISOString(),
        coverage: { requested: 0, completed: 0, failed: 0 },
        rawArtifactRef: null,
        _sourceStatus: {
          provider: label,
          adapterVersion: "1.0.0",
          startedAt: null,
          completedAt: new Date().toISOString(),
          requestId: null,
          retryCount: 0,
          returnedRecordCount: 0,
          expectedRecordCount: null,
          errorCategory: "internal",
          limitation: `${label}: ${error.message}`,
          rawArtifactRef: null,
        },
      };
    }
  };
}

// ---------------------------------------------------------------------------
// NOT_CONNECTED crawl envelope (PRD v3.0 §8.5, §8.6)
// ---------------------------------------------------------------------------

function notConnectedCrawlEnvelope(targetUrl) {
  const now = new Date().toISOString();
  const domain = domainOf(targetUrl);
  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "dataforseo-onpage",
    sourceStatus: SOURCE_STATUS.NOT_CONNECTED,
    status: SOURCE_STATUS.NOT_CONNECTED,
    targetUrl,
    domain,
    crawledAt: now,
    pages: [],
    pageCount: 0,
    robotsText: "",
    sitemapUrls: [],
    statusCounts: {},
    totalWords: 0,
    averageWords: 0,
    missingTitles: 0,
    missingDescriptions: 0,
    missingCanonicals: 0,
    h1Missing: 0,
    h1Multiple: 0,
    imageCount: 0,
    imagesMissingAlt: 0,
    imagesMissingDimensions: 0,
    schemaTypes: [],
    forms: [],
    ctas: [],
    externalCtas: [],
    socialLinks: [],
    internalLinkCount: 0,
    brokenInternalLinks: [],
    platform: "Unknown",
    services: [],
    topicKeywords: [],
    trust: {
      testimonials: false,
      credentials: false,
      caseStudies: false,
      faq: false,
      pricing: false,
      policies: false,
      contact: false,
    },
    securityHeaders: {
      xFrameOptions: false,
      xContentTypeOptions: false,
      referrerPolicy: false,
      contentSecurityPolicy: false,
    },
    limitations: [
      "DataForSEO credentials are not configured. Crawl-dependent modules will show Not Assessed.",
    ],
    collectedAt: now,
    coverage: { requested: 0, completed: 0, failed: 0 },
    rawArtifactRef: null,
    _sourceStatus: buildSourceStatus({
      provider: "dataforseo-onpage",
      adapterVersion: "1.0.0",
      startedAt: now,
      completedAt: now,
      requestId: null,
      retryCount: 0,
      returnedRecordCount: 0,
      expectedRecordCount: null,
      errorCategory: ERROR_CATEGORY.NOT_CONFIGURED,
      limitation:
        "DataForSEO credentials not configured. Crawl-dependent modules suppressed.",
      rawArtifactRef: null,
    }),
  };
}

// ---------------------------------------------------------------------------
// Production crawl provider factory
// ---------------------------------------------------------------------------

/**
 * Build the default production crawl provider.
 *
 * When DataForSEO credentials are configured the factory returns an async
 * function that calls the DataForSEO On-Page adapter with all config values.
 * When credentials are absent it returns a function that produces a
 * NOT_CONNECTED envelope immediately — no network call is attempted.
 *
 * Tests inject their own crawl function via `options.crawlSite` and this
 * factory is never invoked in that path.
 */
function createProductionCrawlProvider(config) {
  const hasCredentials = Boolean(
    config.dataforseoLogin && config.dataforseoPassword,
  );

  if (!hasCredentials) {
    return async (targetUrl, _options) =>
      notConnectedCrawlEnvelope(targetUrl);
  }

  return async (targetUrl, options = {}) => {
    return crawlWithDataforseo(targetUrl, {
      maxPages: config.onpageMaxPages,
      maxDepth: options.maxDepth,
      enableJavascript: config.onpageJsRendering,
      enableBrowserRendering: config.onpageBrowserRendering,
      pollTimeoutMs: config.onpagePollTimeoutMs,
      pollIntervalMs: config.onpagePollIntervalMs,
      includePatterns:
        config.onpageIncludePatterns.length > 0
          ? config.onpageIncludePatterns
          : undefined,
      excludePatterns:
        config.onpageExcludePatterns.length > 0
          ? config.onpageExcludePatterns
          : undefined,
      ...options,
    });
  };
}

// ---------------------------------------------------------------------------
// Primary conversion page discovery
// ---------------------------------------------------------------------------

/**
 * Identify the primary conversion page from crawl data.
 *
 * Heuristic:
 *  1. Page with the most forms
 *  2. Page whose URL contains "contact", "booking", "quote", "get-started", "apply"
 *  3. Page with the most CTAs
 *  4. First non-homepage internal page with CTAs/forms
 *  5. Fall back to the homepage (targetUrl)
 */
function findPrimaryConversionPage(site, targetUrl) {
  const pages = site.pages || [];
  if (pages.length === 0) return targetUrl;

  const normalizedTarget = targetUrl.replace(/\/$/, "").toLowerCase();

  // Pages with forms get highest priority
  const pagesWithForms = pages.filter((p) => (p.forms?.length || 0) > 0);
  if (pagesWithForms.length > 0) {
    // Prefer the one that is NOT the homepage
    const nonHomepage = pagesWithForms.find(
      (p) => (p.url || "").replace(/\/$/, "").toLowerCase() !== normalizedTarget,
    );
    return nonHomepage?.url || pagesWithForms[0].url || targetUrl;
  }

  // Pages with conversion-oriented URLs
  const conversionUrlPatterns = /contact|booking|quote|get-started|apply|pricing|services|schedule|appointment/i;
  const conversionPages = pages.filter((p) =>
    conversionUrlPatterns.test(p.url || "") &&
    (p.url || "").replace(/\/$/, "").toLowerCase() !== normalizedTarget,
  );
  if (conversionPages.length > 0) {
    return conversionPages[0].url || targetUrl;
  }

  // Pages with high CTA count
  const pagesWithCtas = pages
    .filter((p) => (p.url || "").replace(/\/$/, "").toLowerCase() !== normalizedTarget)
    .sort((a, b) => ((b.ctas?.length || 0) + (b.externalCtas?.length || 0)) -
                    ((a.ctas?.length || 0) + (a.externalCtas?.length || 0)));
  if (pagesWithCtas.length > 0 && ((pagesWithCtas[0].ctas?.length || 0) > 0)) {
    return pagesWithCtas[0].url || targetUrl;
  }

  // Fall back to first non-homepage page, or homepage
  const nonHomepage = pages.find(
    (p) => (p.url || "").replace(/\/$/, "").toLowerCase() !== normalizedTarget,
  );
  return nonHomepage?.url || targetUrl;
}

// ---------------------------------------------------------------------------
// Main audit entry point
// ---------------------------------------------------------------------------

export async function runAudit(rawInput, options = {}) {
  const config = options.config || loadConfig();
  const input = validateInput(rawInput);
  const runId = options.runId || createRunId();
  const startedAt = new Date().toISOString();

  // ── Crawl provider ──────────────────────────────────────────────────
  // Production path: DataForSEO On-Page adapter (PRD v3.0 §8.1, §8.2).
  // Tests override via options.crawlSite for isolation.
  const productionCrawler = createProductionCrawlProvider(config);
  const crawler = options.crawlSite || productionCrawler;

  const competitorCrawler =
    options.crawlCompetitors || crawlCompetitors;

  const competitorOpportunityCollector = safeResult(
    options.collectCompetitorOpportunities || collectCompetitorOpportunities,
    "Competitor opportunity collection failed",
  );

  const performanceCollector = safeResult(
    options.collectPerformance || collectPerformance,
    "Performance collection failed",
  );
  const backlinksCollector = safeResult(
    options.collectBacklinks || collectBacklinks,
    "Backlink collection failed",
  );
  const ga4Collector = safeResult(
    options.collectGa4 || collectGa4,
    "GA4 collection failed",
  );
  const gscCollector = safeResult(
    options.collectGsc || collectGsc,
    "GSC collection failed",
  );

  // ── Collect evidence ────────────────────────────────────────────────
  const site = await crawler(input.targetUrl, {
    maxPages: config.maxPages,
    browserMode: config.browserMode,
    fetchImpl: options.fetchImpl,
    browserRenderer: options.browserRenderer,
  });
  if (!input.businessName) {
    input.businessName = site.pages?.[0]?.title || site.domain;
  }

  // ── Primary conversion page discovery ────────────────────────────────
  const conversionPageUrl = findPrimaryConversionPage(site, input.targetUrl);
  const perfUrls = conversionPageUrl && conversionPageUrl !== input.targetUrl
    ? [input.targetUrl, conversionPageUrl]
    : [input.targetUrl];

  // Use multi-page collector when available; fall back to single-page for
  // backward compatibility with tests that inject collectPerformance directly.
  let effectivePerformanceCollector;
  if (options.collectPerformance) {
    // Test override: use the injected collector directly (single-URL compat)
    effectivePerformanceCollector = async (urls, opts) => {
      const result = await options.collectPerformance(urls[0], opts);
      // Wrap single-URL result in multi-page shape when needed
      if (urls.length > 1) {
        return {
          ...result,
          pageResults: [result],
          testedUrls: urls,
          coverage: { ...result.coverage, pagesTested: 1 },
        };
      }
      return result;
    };
  } else {
    effectivePerformanceCollector = collectPerformanceForPages;
  }

  const [performance, competitors, backlinks, ga4, gsc] = await Promise.all([
    performanceCollector(perfUrls, {
      apiKey: config.pagespeedApiKey,
      cruxApiKey: config.cruxApiKey,
      cacheDir: options.cacheDir,
      fetchImpl: options.fetchImpl,
      localRunner: options.localLighthouseRunner,
      disableCache: options.disableCache,
    }),
    competitorCrawler(input.competitors, {
      maxPages: Math.min(config.maxPages, 8),
      browserMode: config.browserMode,
      fetchImpl: options.fetchImpl,
      browserRenderer: options.browserRenderer,
    }),
    backlinksCollector(input.targetUrl, input.competitors, {
      login: config.dataforseoLogin,
      password: config.dataforseoPassword,
      topicKeywords: site.topicKeywords,
      fetchImpl: options.fetchImpl,
    }),
    ga4Collector({
      propertyId: input.ga4.propertyId || config.ga4PropertyId,
      serviceAccountJson:
        input.ga4.serviceAccountJson || config.googleServiceAccountJson,
      fetchImpl: options.fetchImpl,
      oauthService: options.oauthService || null,
    }),
    gscCollector(input.targetUrl, {
      serviceAccountJson: config.googleServiceAccountJson,
      fetchImpl: options.fetchImpl,
      oauthService: options.oauthService || null,
    }),
  ]);

  // ── Competitor opportunity layer (runs after crawl + supplied competitors) ──
  const competitorOpportunities = await competitorOpportunityCollector(site, input, {
    dataforseoLogin: config.dataforseoLogin,
    dataforseoPassword: config.dataforseoPassword,
    suppliedCompetitors: competitors,
    fetchImpl: options.fetchImpl,
  });

  // ── Boundary validation ─────────────────────────────────────────────
  function validateAndDowngrade(shape, label) {
    const result = validateEvidenceEnvelope(shape, label);
    if (result.valid) return shape;
    return downgradeToFailed(shape, result.errors, label);
  }
  const validatedSite = validateAndDowngrade(site, "site");
  const validatedPerformance = validateAndDowngrade(
    performance,
    "performance",
  );
  const validatedBacklinks = validateAndDowngrade(backlinks, "backlinks");
  const validatedGa4 = validateAndDowngrade(ga4, "ga4");
  const validatedGsc = validateAndDowngrade(gsc, "gsc");

  const evidence = {
    site: validatedSite,
    performance: validatedPerformance,
    competitors,
    competitorOpportunities,
    backlinks: validatedBacklinks,
    ga4: validatedGa4,
    gsc: validatedGsc,
  };

  // ── Score ───────────────────────────────────────────────────────────
  const model = scoreAudit(input, evidence);

  // ── Render ──────────────────────────────────────────────────────────
  const html = await (options.renderReport || renderReport)(model);
  const slug = slugify(input.businessName || domainOf(input.targetUrl));
  const completedAt = new Date().toISOString();

  const manifest = {
    artifactVersion: "1.0.0",
    reportVersion: model.reportVersion,
    runId,
    slug,
    targetUrl: input.targetUrl,
    targetDomain: site.domain,
    startedAt,
    completedAt,
    status: "draft",
    scores: model.scores,
    sources: {
      website: validatedSite.sourceStatus,
      performance: validatedPerformance.sourceStatus,
      competitors: competitors.length
        ? SOURCE_STATUS.AVAILABLE
        : SOURCE_STATUS.NOT_APPLICABLE,
      backlinks: validatedBacklinks.sourceStatus,
      ga4: validatedGa4.sourceStatus,
      gsc: validatedGsc.sourceStatus,
    },
    files: ["index.html", "audit.json", "evidence.json", "manifest.json"],
  };

  const store =
    options.store || createReportStore(config, { s3Client: options.s3Client });
  const storage = await store.writeReport({
    slug,
    runId,
    html,
    model,
    manifest,
  });

  return {
    runId,
    slug,
    status: "draft",
    lifecycleStatus: LIFECYCLE_STATUS.DRAFT,
    model,
    manifest,
    storage,
    html: options.includeHtml ? html : undefined,
  };
}

// ---------------------------------------------------------------------------
// Review and approval operations (PRD §18)
// ---------------------------------------------------------------------------

/**
 * Submit a Principal Auditor review for an audit.
 *
 * Validates the review payload, persists the review record, and transitions
 * the lifecycle from draft → reviewed (or reviewed → reviewed for re-review).
 *
 * Returns the updated lifecycle record.
 */
/**
 * Apply competitor approval/rejection decisions from a review payload.
 *
 * Loads the canonical evidence + model, applies decisions, rebuilds gaps,
 * persists updated artifacts, and appends override records.
 *
 * This is called by submitReview() before the review is persisted.
 * Atomic: if evidence/model persistence fails, the review is not written.
 *
 * @returns {{ evidence, model }} updated evidence and model
 */
async function _applyCompetitorDecisions(store, slug, runId, reviewPayload, reviewer) {
  const decisions = reviewPayload.competitorDecisions;
  if (!Array.isArray(decisions) || decisions.length === 0) {
    // No decisions to apply — return null
    return null;
  }

  // Load canonical artifacts
  let evidence;
  let model;
  try {
    const evidenceRaw = await store.readFile(`${slug}/${runId}/evidence.json`);
    evidence = JSON.parse(evidenceRaw.toString("utf8"));
    const modelRaw = await store.readFile(`${slug}/${runId}/audit.json`);
    model = JSON.parse(modelRaw.toString("utf8"));
  } catch {
    throw Object.assign(
      new Error("Cannot apply competitor decisions — audit artifacts not found"),
      { statusCode: 404 },
    );
  }

  const opp = evidence.competitorOpportunities;
  const qualifiedCandidates = opp?.candidates?.qualified || [];

  // Build known candidate URL set from qualified candidates only
  const knownCandidateUrls = new Set(qualifiedCandidates.map((c) => c.candidateUrl));

  // Validate decisions against known candidates
  const validation = validateCompetitorDecisions(decisions, knownCandidateUrls);
  if (!validation.valid) {
    throw Object.assign(
      new Error(`Invalid competitor decisions: ${validation.errors.join("; ")}`),
      { statusCode: 422, errors: validation.errors },
    );
  }

  // Apply decisions to qualified candidates
  const decisionMap = new Map(validation.records.map((r) => [r.candidateUrl, r.decision]));
  for (const candidate of qualifiedCandidates) {
    if (decisionMap.has(candidate.candidateUrl)) {
      candidate.approvalStatus = decisionMap.get(candidate.candidateUrl);
    }
  }

  // Rebuild gaps: only approved + all gates passed → client-facing
  const allGaps = opp.allGaps || [];
  const updatedAllGaps = allGaps.map((g) => {
    const candidateDecision = decisionMap.get(g.competitorPage);
    const newApproval = candidateDecision || g.approvalStatus || "pending";
    return { ...g, approvalStatus: newApproval };
  });

  // Re-filter client-facing gaps
  const updatedGaps = updatedAllGaps.filter(
    (g) => g.approvalStatus === "approved" && g.gapPassed === true,
  );

  // Update evidence in place
  if (opp.candidates) {
    opp.candidates.qualified = qualifiedCandidates;
  }
  opp.allGaps = updatedAllGaps;
  opp.gaps = updatedGaps;

  // Update the model's competitor evidence
  evidence.competitorOpportunities = opp;

  // Re-score with updated evidence to reflect competitor decisions
  // (scoring weights unaffected; only competitor findings/gaps change)
  const updatedModel = scoreAudit(model.input, evidence);

  // Build override records for audit history
  const overrideRecords = buildCompetitorOverrides(validation.records, reviewer);

  // Persist updated evidence and model atomically BEFORE review write
  // (if this fails, the review won't be written — atomic safety)
  await store.writeEvidenceAndModel(slug, runId, evidence, updatedModel);

  // Return updated artifacts + override records
  return { evidence, model: updatedModel, overrides: overrideRecords };
}

/**
 * Submit a Principal Auditor review for an audit.
 *
 * Validates the review payload, applies competitor approval/rejection
 * decisions (when provided), persists updated evidence/model, and
 * transitions the lifecycle from draft → reviewed.
 *
 * Returns the updated lifecycle record.
 */
export async function submitReview(store, slug, runId, reviewPayload) {
  // ── Apply competitor decisions BEFORE building review record ──────────
  const reviewer = String(reviewPayload.reviewer || "").trim();
  let competitorOverrides = [];

  try {
    const decisionResult = await _applyCompetitorDecisions(
      store, slug, runId, reviewPayload, reviewer,
    );
    if (decisionResult?.overrides) {
      competitorOverrides = decisionResult.overrides;
    }
  } catch (err) {
    // Re-throw with appropriate status code
    throw err;
  }

  // ── Build review record ───────────────────────────────────────────────
  const { valid, record, errors } = buildReviewRecord({
    ...reviewPayload,
    runId,
    overrides: [
      ...(reviewPayload.overrides || []),
      ...competitorOverrides,
    ],
  });

  if (!valid) {
    throw Object.assign(
      new Error(`Invalid review: ${errors.join("; ")}`),
      { statusCode: 422, errors },
    );
  }

  // Persist
  const updated = await store.writeReview(slug, runId, record);
  return updated;
}

/**
 * Approve an audit after review.
 *
 * Requires a complete review. Renders the approved multi-page report
 * (15 individual pages + index) and persists all pages atomically.
 *
 * If any page write fails, the lifecycle is NOT updated to approved —
 * the audit remains in its current (reviewed) state and the failure
 * is recorded as a limitation.
 *
 * No server-generated PDF. Each approved page includes a browser-print
 * button that uses window.print() + @media print CSS.
 *
 * Returns { lifecycle, pageCount }.
 */
export async function approveAudit(store, slug, runId, approver, opts = {}) {
  // Load current lifecycle
  const lc = await store._readLifecycle(slug, runId);
  if (!lc) {
    throw Object.assign(new Error("Audit not found"), { statusCode: 404 });
  }

  // Idempotency: already approved
  if (lc.status === LIFECYCLE_STATUS.APPROVED) {
    return { lifecycle: lc, pageCount: (lc.artifacts?.final || []).length };
  }

  // Validate transition
  const transition = validateTransition(lc.status, LIFECYCLE_STATUS.APPROVED);
  if (!transition.valid) {
    throw Object.assign(
      new Error(`Invalid state transition: ${transition.errors.join("; ")}`),
      { statusCode: 409 },
    );
  }

  // Ensure review is complete
  if (!lc.review || !isReviewComplete(lc.review)) {
    throw Object.assign(
      new Error("Approval requires a complete review"),
      { statusCode: 422 },
    );
  }

  // Require model for multi-page rendering
  if (!opts.model) {
    throw Object.assign(
      new Error("Audit model is required for approved report rendering"),
      { statusCode: 422 },
    );
  }

  // ── Competitor approval gate (Task 9) ─────────────────────────────────
  // Validate: no pending or rejected competitor candidates in client-facing gaps
  const competitorOpps = opts.model.evidence?.competitorOpportunities;
  if (competitorOpps) {
    const gaps = competitorOpps.gaps || [];
    const allGaps = competitorOpps.allGaps || [];
    const qualifiedCandidates = competitorOpps.candidates?.qualified || [];

    // Check 1: no pending/rejected gaps in client-facing output
    for (const gap of gaps) {
      if (gap.approvalStatus !== "approved") {
        throw Object.assign(
          new Error(
            `Approval rejected — client-facing competitor gap for "${gap.competitorPage}" ` +
            `has approval status "${gap.approvalStatus}". All gaps must be approved.`,
          ),
          { statusCode: 422 },
        );
      }
    }

    // Check 2: every approved gap still passes all gates
    for (const gap of gaps) {
      if (!gap.gapPassed) {
        throw Object.assign(
          new Error(
            `Approval rejected — competitor gap for "${gap.competitorPage}" ` +
            `does not pass all qualified-gap checks.`,
          ),
          { statusCode: 422 },
        );
      }
      if (!gap.qualificationPassed) {
        throw Object.assign(
          new Error(
            `Approval rejected — competitor candidate "${gap.competitorPage}" ` +
            `does not pass all qualification checks.`,
          ),
          { statusCode: 422 },
        );
      }
    }

    // Check 3: evidence and model agree on approval states
    for (const candidate of qualifiedCandidates) {
      if (candidate.approvalStatus === "pending") {
        // Pending candidates are allowed as long as they have no client-facing gaps
        const hasGap = gaps.some((g) => g.competitorPage === candidate.candidateUrl);
        if (hasGap) {
          throw Object.assign(
            new Error(
              `Approval rejected — pending candidate "${candidate.candidateUrl}" ` +
              `has a client-facing gap. Approve or reject all competitors before approval.`,
            ),
            { statusCode: 422 },
          );
        }
      }
    }

    // Check 4: competitor_selections checklist item must be reviewed
    const competitorChecklistItem = lc.review?.checklist?.find(
      (item) => item.id === "competitor_selections",
    );
    if (!competitorChecklistItem || !competitorChecklistItem.reviewed) {
      throw Object.assign(
        new Error(
          "Approval rejected — the \"Competitor selections\" checklist item must be reviewed before approval.",
        ),
        { statusCode: 422 },
      );
    }
  }

  // Build approval record
  const { valid, record: approvalRecord, errors } = buildApprovalRecord(
    runId,
    lc.review,
    approver,
    { notes: opts.notes },
  );

  if (!valid) {
    throw Object.assign(
      new Error(`Invalid approval: ${errors.join("; ")}`),
      { statusCode: 422, errors },
    );
  }

  // Render approved multi-page report (all-or-nothing)
  let approvedPages;
  try {
    const result = renderApprovedReport(opts.model);
    approvedPages = result.pages; // Map<filename, html>
  } catch (renderErr) {
    await store.addLimitation(
      slug, runId,
      `Approved report rendering failed: ${renderErr.message}`,
    );
    throw Object.assign(
      new Error(`Approved report rendering failed: ${renderErr.message}`),
      { statusCode: 500 },
    );
  }

  // Write all approved pages atomically
  // If any page write fails, the store throws and lifecycle stays at reviewed
  const updatedLc = await store.writeApprovedPages(
    slug, runId, approvalRecord, approvedPages,
  );

  return {
    lifecycle: updatedLc,
    pageCount: approvedPages.size,
  };
}

/**
 * Retrieve the full lifecycle and review state for an audit.
 */
export async function getAuditStatus(store, slug, runId) {
  return store.getStatus(slug, runId);
}

export { validateInput };

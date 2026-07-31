import { resolve } from "node:path";
import { crawlSite, crawlCompetitors } from "../evidence/site-crawler.js";
import { crawlWithDataforseo } from "../adapters/dataforseo-onpage/dataforseo-onpage-adapter.js";
import { collectPerformance, collectPerformanceForPages } from "../evidence/pagespeed-client.js";
import { collectBacklinks } from "../evidence/backlinks-provider.js";
import { collectGa4 } from "../evidence/ga4-client.js";
import { collectGsc } from "../evidence/gsc-client.js";
import { collectCompetitorOpportunities } from "../evidence/competitor-opportunity-layer.js";
import { generateInternalLinkOpportunities } from "../evidence/internal-link-opportunity.js";
import { scoreAudit } from "../scoring/vantage-score.js";
import { runFinalizationGate } from "../scoring/report-finalization-gate.js";
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
  normalizeCompetitorApprovalState,
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

  // ── GA4 validation (strict allowlist — only propertyId) ───────────────
  const GA4_ALLOWED = new Set(["propertyId"]);
  const ga4 = {};
  if (raw.ga4 && typeof raw.ga4 === "object") {
    for (const key of Object.keys(raw.ga4)) {
      if (!GA4_ALLOWED.has(key)) {
        throw new Error(`ga4.${key} is not allowed — only ga4.propertyId is accepted`);
      }
    }
    if (raw.ga4.propertyId !== undefined && raw.ga4.propertyId !== null && raw.ga4.propertyId !== "") {
      if (!/^\d+$/.test(String(raw.ga4.propertyId))) {
        throw new Error("ga4.propertyId must contain digits only");
      }
      ga4.propertyId = String(raw.ga4.propertyId);
    }
  }

  // ── GSC validation (strict allowlist — only siteUrl) ──────────────────
  const GSC_ALLOWED = new Set(["siteUrl"]);
  const gsc = {};
  if (raw.gsc && typeof raw.gsc === "object") {
    for (const key of Object.keys(raw.gsc)) {
      if (!GSC_ALLOWED.has(key)) {
        throw new Error(`gsc.${key} is not allowed — only gsc.siteUrl is accepted`);
      }
    }
    if (raw.gsc.siteUrl !== undefined && raw.gsc.siteUrl !== null && raw.gsc.siteUrl !== "") {
      const url = String(raw.gsc.siteUrl).trim();
      if (/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(url)) {
        // URL-prefix — valid
      } else if (/^sc-domain:[a-z0-9.-]+\.[a-z]{2,}$/i.test(url)) {
        // sc-domain — valid
      } else {
        throw new Error(`gsc.siteUrl must be an HTTPS URL-prefix or sc-domain property, got: ${url}`);
      }
      gsc.siteUrl = url;
    }
  }

  return {
    targetUrl,
    businessName: String(raw.businessName || "").trim(),
    location: String(raw.location || "").trim(),
    language: String(raw.language || "en-CA").trim(),
    competitors,
    primaryGoal: String(raw.primaryGoal || "Generate qualified enquiries").trim(),
    ga4,
    gsc,
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
  const slug = slugify(input.businessName || domainOf(input.targetUrl));
  const artifactRoot = resolve(config.artifactDir, "..");
  const startedAt = new Date().toISOString();

  // ── Effective properties (calculated once, used for collection + manifest) ──
  const effectiveGa4PropertyId = input.ga4.propertyId || config.ga4PropertyId || null;
  const effectiveGscSiteUrl = input.gsc.siteUrl || config.gscSiteUrl || input.targetUrl;

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

  // Performance collection: when a test supplies a single-URL collector,
  // wrap it for multi-URL compatibility.  In production, always use the
  // multi-page collector directly so every URL is tested independently
  // (never string-coerced or comma-joined).
  const performanceCollector = safeResult(
    options.collectPerformance
      ? (urls, opts) => {
          // Legacy single-URL test override — run for first URL only
          return options.collectPerformance(urls[0], opts);
        }
      : (urls, opts) => collectPerformanceForPages(urls, opts),
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

  const [performance, competitors, backlinks, ga4, gsc] = await Promise.all([
    performanceCollector(perfUrls, {
      apiKey: config.pagespeedApiKey,
      cruxApiKey: config.cruxApiKey,
      cacheDir: options.cacheDir,
      fetchImpl: options.fetchImpl,
      localRunner: options.localLighthouseRunner,
      disableCache: options.disableCache,
      screenshotMeta: { runId, slug, artifactRoot },
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
      propertyId: effectiveGa4PropertyId,
      serviceAccountJson: config.googleServiceAccountJson,
      fetchImpl: options.fetchImpl,
      oauthService: options.oauthService || null,
    }),
    gscCollector(effectiveGscSiteUrl, {
      serviceAccountJson: config.googleServiceAccountJson,
      fetchImpl: options.fetchImpl,
      oauthService: options.oauthService || null,
    }),
  ]);

  // ── Internal-link opportunities (runs after crawl) ────────────────────
  const internalLinkOpportunities = generateInternalLinkOpportunities(site, input);

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
    internalLinkOpportunities,
  };

  // ── Score ───────────────────────────────────────────────────────────
  const model = scoreAudit(input, evidence);

  if (model.renderingDiagnostics && model.renderingDiagnostics.length > 0) {
    evidence.performance.renderingDiagnostics = model.renderingDiagnostics;
  }

  // ── Finalization gate ───────────────────────────────────────────────
  // Must run after scoring + diagnostics, before rendering.
  // Block renders with contradictory or incomplete evidence.
  const gate = runFinalizationGate(model, evidence);
  const gatedModel = gate.model;

  // ── Render ──────────────────────────────────────────────────────────
  if (!gate.passed) {
    // Audit stays in draft; structured errors attached to model for auditor review
    gatedModel._renderBlocked = true;
  }
  const html = gate.passed
    ? await (options.renderReport || renderReport)(gatedModel, { artifactRoot })
    : "";
  const completedAt = new Date().toISOString();

  const manifest = {
    artifactVersion: "1.0.0",
    reportVersion: gatedModel.reportVersion,
    runId,
    slug,
    targetUrl: input.targetUrl,
    targetDomain: site.domain,
    startedAt,
    completedAt,
    status: gate.passed ? "draft" : "draft",
    scores: gatedModel.scores,
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
    selectedProperties: {
      ga4PropertyId: effectiveGa4PropertyId,
      gscSiteUrl: effectiveGscSiteUrl,
      competitors: input.competitors,
    },
    files: gate.passed
      ? ["index.html", "audit.json", "evidence.json", "manifest.json"]
      : ["audit.json", "evidence.json", "manifest.json"],
  };

  const store =
    options.store || createReportStore(config, { s3Client: options.s3Client });
  const storage = await store.writeReport({
    slug,
    runId,
    html: gate.passed ? html : "",
    includeIndexHtml: gate.passed,
    model: gatedModel,
    manifest,
  });

  return {
    runId,
    slug,
    status: "draft",
    lifecycleStatus: LIFECYCLE_STATUS.DRAFT,
    model: gatedModel,
    manifest,
    storage,
    html: options.includeHtml ? html : undefined,
    _gateBlocked: !gate.passed,
    _gateErrors: gate.errors,
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
 * Submit a Principal Auditor review for an audit.
 *
 * ALL validation happens in memory BEFORE any persistent mutation.
 * Competitor decisions are applied, evidence + model recalculated,
 * override records built, and the complete review record validated.
 * Only then is the atomic transaction committed via the store.
 *
 * Atomic: if any stage fails (validation, staging, or commit), the
 * previous evidence, model, review, and lifecycle remain fully active.
 */
export async function submitReview(store, slug, runId, reviewPayload) {
  const reviewer = String(reviewPayload.reviewer || "").trim();
  const decisions = reviewPayload.competitorDecisions;

  // ── Phase 1: Load current committed state ─────────────────────────────
  const committed = await store.readCommittedArtifacts(slug, runId);
  if (!committed) {
    throw Object.assign(
      new Error("Cannot review — audit artifacts not found"),
      { statusCode: 404 },
    );
  }

  let evidence = committed.evidence;
  let model = committed.model;
  let competitorOverrides = [];

  // ── Phase 2: Validate and apply competitor decisions (in memory) ──────
  if (Array.isArray(decisions) && decisions.length > 0) {
    const opp = evidence.competitorOpportunities;
    const qualifiedCandidates = opp?.candidates?.qualified || [];
    const knownCandidateUrls = new Set(qualifiedCandidates.map((c) => c.candidateUrl));

    const validation = validateCompetitorDecisions(decisions, knownCandidateUrls);
    if (!validation.valid) {
      throw Object.assign(
        new Error(`Invalid competitor decisions: ${validation.errors.join("; ")}`),
        { statusCode: 422, errors: validation.errors },
      );
    }

    // Capture current approval states BEFORE applying decisions
    const previousStates = new Map();
    for (const candidate of qualifiedCandidates) {
      previousStates.set(candidate.candidateUrl, candidate.approvalStatus || "pending");
    }

    // Apply decisions (in-memory only — no files touched yet)
    const decisionMap = new Map(validation.records.map((r) => [r.candidateUrl, r.decision]));
    for (const candidate of qualifiedCandidates) {
      if (decisionMap.has(candidate.candidateUrl)) {
        candidate.approvalStatus = decisionMap.get(candidate.candidateUrl);
      }
    }

    const allGaps = opp.allGaps || [];
    const updatedAllGaps = allGaps.map((g) => {
      const candidateDecision = decisionMap.get(g.competitorPage);
      return { ...g, approvalStatus: candidateDecision || g.approvalStatus || "pending" };
    });

    opp.allGaps = updatedAllGaps;
    opp.gaps = updatedAllGaps.filter((g) => g.approvalStatus === "approved" && g.gapPassed === true);
    if (opp.candidates) opp.candidates.qualified = qualifiedCandidates;
    evidence.competitorOpportunities = opp;

    // Re-score with updated evidence
    model = scoreAudit(model.input, evidence);

    // Build override records with actual previous values
    competitorOverrides = buildCompetitorOverrides(validation.records, previousStates, reviewer);
  }

  // ── Phase 3: Build and validate complete review record ────────────────
  const { valid, record: reviewRecord, errors } = buildReviewRecord({
    ...reviewPayload,
    runId,
    overrides: [
      ...(reviewPayload.overrides || []),
      ...competitorOverrides,
    ],
  });

  if (!valid) {
    // NO persistent mutation occurred — evidence/model changes were in-memory only
    throw Object.assign(
      new Error(`Invalid review: ${errors.join("; ")}`),
      { statusCode: 422, errors },
    );
  }

  // ── Phase 4: Atomic transaction commit ────────────────────────────────
  // All-or-nothing: if this fails, nothing was changed on disk
  const updated = await store.commitCompetitorReview({
    slug,
    runId,
    evidence,
    model,
    reviewRecord,
  });

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

  // ── Load committed artifacts (authoritative — never accept stale model) ──
  const committed = await store.readCommittedArtifacts(slug, runId);

  // When lifecycle has an active transaction but committed artifacts are missing
  // or mismatched, block approval.
  if (lc.activeReviewTxId) {
    if (!committed) {
      throw Object.assign(
        new Error(`Approval rejected — lifecycle references transaction "${lc.activeReviewTxId}" but committed artifacts could not be read`),
        { statusCode: 422 },
      );
    }
    if (committed.txId !== lc.activeReviewTxId) {
      throw Object.assign(
        new Error(`Approval rejected — transaction ID mismatch: lifecycle has "${lc.activeReviewTxId}", committed artifacts have "${committed.txId}"`),
        { statusCode: 422 },
      );
    }
  }

  if (!committed || !committed.model) {
    throw Object.assign(
      new Error("Audit model is required for approved report rendering — committed artifacts not found"),
      { statusCode: 422 },
    );
  }

  // When an active transaction exists, the review record is mandatory
  if (lc.activeReviewTxId && !committed.reviewRecord) {
    throw Object.assign(
      new Error("Approval rejected — active transaction is missing the review record"),
      { statusCode: 422 },
    );
  }

  if (!committed.evidence) {
    throw Object.assign(
      new Error("Approval rejected — committed evidence not found"),
      { statusCode: 422 },
    );
  }

  const model = committed.model;

  // ── Evidence/model competitor agreement (full structural comparison) ──
  const evOpp = committed.evidence.competitorOpportunities;
  const mdOpp = model.evidence?.competitorOpportunities;
  if (evOpp || mdOpp) {
    const evNorm = normalizeCompetitorApprovalState(evOpp);
    const mdNorm = normalizeCompetitorApprovalState(mdOpp);
    const evJson = JSON.stringify(evNorm);
    const mdJson = JSON.stringify(mdNorm);
    if (evJson !== mdJson) {
      throw Object.assign(
        new Error("Approval rejected — evidence and model competitor approval states disagree"),
        { statusCode: 422 },
      );
    }
  }

  // ── Competitor approval gate (Task 9) ─────────────────────────────────
  const competitorOpps = model.evidence?.competitorOpportunities;
  if (competitorOpps) {
    const gaps = competitorOpps.gaps || [];
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
            `Approval rejected — competitor gap for "${gap.competitorPage}" does not pass all qualified-gap checks.`,
          ),
          { statusCode: 422 },
        );
      }
      if (!gap.qualificationPassed) {
        throw Object.assign(
          new Error(
            `Approval rejected — competitor candidate "${gap.competitorPage}" does not pass all qualification checks.`,
          ),
          { statusCode: 422 },
        );
      }
    }

    // Check 3: evidence and model agree on approval states
    for (const candidate of qualifiedCandidates) {
      if (candidate.approvalStatus === "pending") {
        const hasGap = gaps.some((g) => g.competitorPage === candidate.candidateUrl);
        if (hasGap) {
          throw Object.assign(
            new Error(
              `Approval rejected — pending candidate "${candidate.candidateUrl}" has a client-facing gap.`,
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
          "Approval rejected — the \"Competitor selections\" checklist item must be reviewed.",
        ),
        { statusCode: 422 },
      );
    }
  }

  // ── Internal-link checklist gate ──────────────────────────────────────
  if (model.evidence?.internalLinkOpportunities) {
    const ilChecklistItem = lc.review?.checklist?.find(
      (item) => item.id === "internal_link_recommendations",
    );
    if (!ilChecklistItem || !ilChecklistItem.reviewed) {
      throw Object.assign(
        new Error(
          "Approval rejected — the \"Internal-link recommendations\" checklist item must be reviewed.",
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
    const result = renderApprovedReport(model);
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

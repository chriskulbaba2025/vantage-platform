import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stableHash, withTimeout } from "../utils.js";
import { SOURCE_STATUS, ERROR_CATEGORY, buildSourceStatus, EVIDENCE_ENVELOPE_VERSION } from "../scoring/evidence-contracts.js";

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function cachePath(cacheDir, url) {
  return resolve(cacheDir, `${stableHash(url)}.json`);
}

async function readCache(cacheDir, url, ttlMs) {
  try {
    const raw = JSON.parse(await readFile(cachePath(cacheDir, url), "utf8"));
    if (Date.now() - new Date(raw.cachedAt).getTime() <= ttlMs) return raw.value;
  } catch { /* cache miss */ }
  return null;
}

async function writeCache(cacheDir, url, value) {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath(cacheDir, url), JSON.stringify({ cachedAt: new Date().toISOString(), value }, null, 2));
}

// ---------------------------------------------------------------------------
// Retry helper — one retry for transient errors only
// ---------------------------------------------------------------------------

/**
 * Execute `fn` once, and if it throws a transient error (HTTP 5xx, timeout,
 * or network error), retry once.  Does NOT retry on HTTP 429 (rate-limit
 * should trigger fallback, not more requests) or on 4xx client errors.
 *
 * Returns { result, retryCount, transientError }.
 */
async function retryOnce(fn, label) {
  let retryCount = 0;
  let transientError = null;

  try {
    const result = await fn();
    return { result, retryCount: 0, transientError: null };
  } catch (firstError) {
    // Only retry on transient errors: 5xx, timeout, or network
    const category = firstError.errorCategory || null;
    const status = firstError.status || 0;
    const isTransient =
      category === ERROR_CATEGORY.TIMEOUT ||
      category === ERROR_CATEGORY.NETWORK ||
      (status >= 500 && status < 600);

    if (!isTransient) {
      // 429, 4xx, invalid response — do NOT retry, fail immediately
      return { result: null, retryCount: 0, transientError: firstError };
    }

    // Retry once
    retryCount = 1;
    try {
      const result = await fn();
      return { result, retryCount: 1, transientError: firstError };
    } catch (secondError) {
      transientError = secondError;
      return { result: null, retryCount: 1, transientError: secondError };
    }
  }
}

// ---------------------------------------------------------------------------
// Metric extraction
// ---------------------------------------------------------------------------

function metricValue(audits, id) {
  const item = audits?.[id];
  return item?.numericValue ?? null;
}

// ---------------------------------------------------------------------------
// Normalize a Lighthouse result to the canonical performance contract
// ---------------------------------------------------------------------------

/**
 * Produce a canonical per-strategy performance record.
 *
 * Every record includes:
 *  - provider, device, runTime, url, dataType (lab/field),
 *  - strategy / configuration, raw artifact reference,
 *  - isLabData / isFieldData flags,
 *  - fallbackUsed flag.
 */
function normalizeLighthouse(lhr, source, strategy, opts = {}) {
  const categories = lhr?.categories || {};
  const audits = lhr?.audits || {};
  const score = (key) => categories[key]?.score == null ? null : Math.round(categories[key].score * 100);

  return {
    status: SOURCE_STATUS.AVAILABLE,
    source,
    strategy,
    url: opts.url || null,
    runTime: new Date().toISOString(),
    dataType: "lab",
    isLabData: true,
    isFieldData: false,
    fallbackUsed: opts.fallbackUsed === true,
    psiFailure: opts.psiFailure || null,
    fetchedAt: new Date().toISOString(),
    scores: {
      performance: score("performance"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      seo: score("seo"),
    },
    metrics: {
      fcpMs: metricValue(audits, "first-contentful-paint"),
      lcpMs: metricValue(audits, "largest-contentful-paint"),
      cls: metricValue(audits, "cumulative-layout-shift"),
      tbtMs: metricValue(audits, "total-blocking-time"),
      speedIndexMs: metricValue(audits, "speed-index"),
      inpMs: metricValue(audits, "interaction-to-next-paint"),
    },
    opportunities: Object.values(audits)
      .filter((item) => item?.details?.type === "opportunity" && Number(item.numericValue) > 0)
      .sort((a, b) => (b.numericValue || 0) - (a.numericValue || 0))
      .slice(0, 10)
      .map((item) => ({ id: item.id, title: item.title, savingsMs: item.numericValue || 0 })),
    rawArtifactRef: opts.rawArtifactRef || null,
  };
}

// ---------------------------------------------------------------------------
// PageSpeed API call
// ---------------------------------------------------------------------------

/**
 * Call PageSpeed Insights API for one URL + strategy.
 *
 * Retries once for transient failures (5xx, timeout, network).
 * Returns the normalized Lighthouse result on success.
 * Throws on failure with errorCategory attached for caller classification.
 */
async function callPsi(url, strategy, apiKey, fetchImpl) {
  const query = new URLSearchParams({
    url,
    strategy,
    category: "performance",
  });
  ["accessibility", "best-practices", "seo"].forEach((category) => query.append("category", category));
  if (apiKey) query.set("key", apiKey);
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${query}`;

  const makeRequest = async () => {
    const response = await withTimeout(fetchImpl(endpoint), 90000, `PageSpeed ${strategy}`);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`PageSpeed ${strategy} failed (${response.status}): ${body.slice(0, 300)}`);
      error.status = response.status;
      error.errorCategory =
        response.status === 429 ? ERROR_CATEGORY.RATE_LIMIT
        : response.status === 403 || response.status === 401 ? ERROR_CATEGORY.AUTH
        : response.status >= 500 ? ERROR_CATEGORY.INTERNAL
        : null;
      throw error;
    }
    const body = await response.json();
    if (!body.lighthouseResult) {
      const error = new Error(`PageSpeed ${strategy} returned no lighthouseResult`);
      error.errorCategory = ERROR_CATEGORY.SCHEMA_VALIDATION;
      throw error;
    }
    return body;
  };

  const { result, retryCount, transientError } = await retryOnce(makeRequest, `PageSpeed ${strategy}`);

  if (!result) {
    // Preserve retry count on the error so callers can track it
    transientError.retryCount = retryCount;
    throw transientError;
  }

  return {
    lhr: result.lighthouseResult,
    retryCount,
    cruxData: result.loadingExperience || null,
    rawArtifactRef: endpoint,
  };
}

// ---------------------------------------------------------------------------
// Local Lighthouse CLI fallback
// ---------------------------------------------------------------------------

async function runLocalLighthouse(url, strategy) {
  const [{ default: lighthouse }, chromeLauncher, playwright] = await Promise.all([
    import("lighthouse"),
    import("chrome-launcher"),
    import("playwright"),
  ]);
  const chrome = await chromeLauncher.launch({
    chromePath: playwright.chromium.executablePath(),
    chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
  });
  try {
    const flags = {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      formFactor: strategy === "mobile" ? "mobile" : "desktop",
      screenEmulation: strategy === "mobile"
        ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }
        : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
      throttlingMethod: strategy === "mobile" ? "simulate" : "provided",
    };
    const result = await lighthouse(url, flags);
    if (!result?.lhr) throw new Error("Local Lighthouse returned no report");
    return result.lhr;
  } finally {
    await chrome.kill();
  }
}

// ---------------------------------------------------------------------------
// CrUX query
// ---------------------------------------------------------------------------

async function queryCrux(url, apiKey, formFactor, fetchImpl) {
  if (!apiKey) return { status: SOURCE_STATUS.NOT_CONNECTED, formFactor, metrics: null, dataType: "field", isLabData: false, isFieldData: true };
  const endpoint = `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(apiKey)}`;
  const response = await withTimeout(fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, formFactor }),
  }), 30000, `CrUX ${formFactor}`);
  if (response.status === 404) return { status: SOURCE_STATUS.UNAVAILABLE, formFactor, metrics: null };
  if (!response.ok) throw new Error(`CrUX ${formFactor} failed (${response.status})`);
  const body = await response.json();
  return {
    status: SOURCE_STATUS.AVAILABLE,
    formFactor,
    metrics: body.record?.metrics || null,
    collectionPeriod: body.record?.collectionPeriod || null,
    dataType: "field",
    isLabData: false,
    isFieldData: true,
  };
}

// ---------------------------------------------------------------------------
// Single-URL performance collection
// ---------------------------------------------------------------------------

/**
 * Collect performance for a single URL.
 *
 * Flow:
 *   1. PageSpeed first attempt
 *   2. Retry once for transient errors (5xx, timeout, network)
 *   3. If still unavailable → Lighthouse CLI fallback
 *   4. If both fail → FAILED
 *
 * Returns a per-URL performance envelope with:
 *   - mobile and desktop normalized results
 *   - CrUX field data
 *   - full provenance (provider, dataType, fallbackUsed, etc.)
 *   - source-status record with retry count and error category
 */
export async function collectPerformance(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cacheDir = options.cacheDir || resolve("artifacts", "cache", "pagespeed");
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const cacheKey = `${url}|${options.apiKey ? "key" : "nokey"}`;
  if (!options.disableCache) {
    const cached = await readCache(cacheDir, cacheKey, ttlMs);
    if (cached) return { ...cached, cache: "hit" };
  }

  const startedAt = new Date().toISOString();
  const limitations = [];
  const results = {};
  const strategyErrors = {};
  let totalRetries = 0;

  for (const strategy of ["mobile", "desktop"]) {
    const psiFailureInfo = {};

    try {
      const psiResult = await callPsi(url, strategy, options.apiKey || "", fetchImpl);
      totalRetries += psiResult.retryCount;
      const normalized = normalizeLighthouse(psiResult.lhr, "pagespeed-insights", strategy, {
        url,
        fallbackUsed: false,
        rawArtifactRef: psiResult.rawArtifactRef,
      });
      // Attach CrUX data from the same PageSpeed response when available
      if (psiResult.cruxData?.metrics) {
        normalized.cruxMetrics = psiResult.cruxData.metrics;
        normalized.cruxCollectionPeriod = psiResult.cruxData.collectionPeriod || null;
      }
      results[strategy] = normalized;
    } catch (psiError) {
      // Preserve PageSpeed failure for provenance
      psiFailureInfo.category = psiError.errorCategory || ERROR_CATEGORY.INTERNAL;
      psiFailureInfo.message = psiError.message;
      psiFailureInfo.status = psiError.status || null;
      // Capture retry count from the psiError (set by callPsi)
      totalRetries += psiError.retryCount || 0;
      limitations.push(psiError.message);
      strategyErrors[strategy] = {
        category: psiFailureInfo.category,
        message: psiError.message,
      };

      // Attempt Lighthouse CLI fallback
      try {
        const runner = options.localRunner || runLocalLighthouse;
        const raw = await runner(url, strategy);
        // Runner returns normalized result; add/enrich provenance fields
        results[strategy] = {
          ...raw,
          url: raw.url || url,
          runTime: raw.runTime || new Date().toISOString(),
          isLabData: true,
          isFieldData: false,
          dataType: raw.dataType || "lab",
          fallbackUsed: true,
          psiFailure: psiFailureInfo,
          rawArtifactRef: raw.rawArtifactRef || `lighthouse-cli://${strategy}/${encodeURIComponent(url)}`,
        };
        limitations.push(`PageSpeed ${strategy} failed (${psiError.message.slice(0, 120)}); fell back to Lighthouse CLI.`);
      } catch (localError) {
        limitations.push(`Local Lighthouse ${strategy} failed: ${localError.message}`);
        strategyErrors[strategy] = {
          category: strategyErrors[strategy]?.category || ERROR_CATEGORY.INTERNAL,
          message: `${psiError.message}; Local Lighthouse: ${localError.message}`,
        };
        results[strategy] = {
          status: SOURCE_STATUS.FAILED,
          strategy,
          url,
          source: "unavailable",
          dataType: "lab",
          isLabData: true,
          isFieldData: false,
          fallbackUsed: true,
          psiFailure: psiFailureInfo,
          error: localError.message,
          runTime: new Date().toISOString(),
          scores: {},
          metrics: {},
          opportunities: [],
          rawArtifactRef: null,
        };
      }
    }
  }

  // ── CrUX field data ──────────────────────────────────────────────────
  const fieldData = {};
  for (const formFactor of ["PHONE", "DESKTOP"]) {
    try {
      fieldData[formFactor.toLowerCase()] = await queryCrux(url, options.cruxApiKey || "", formFactor, fetchImpl);
    } catch (error) {
      limitations.push(error.message);
      fieldData[formFactor.toLowerCase()] = {
        status: SOURCE_STATUS.FAILED,
        formFactor,
        metrics: null,
        error: error.message,
        dataType: "field",
        isLabData: false,
        isFieldData: true,
      };
    }
  }

  // ── Determine source status ──────────────────────────────────────────
  const strategies = Object.values(results);
  const completeCount = strategies.filter((r) => r.status === SOURCE_STATUS.AVAILABLE).length;
  const totalStrategies = strategies.length;
  const sourceStatus = completeCount === totalStrategies ? SOURCE_STATUS.AVAILABLE
    : completeCount > 0 ? SOURCE_STATUS.PARTIAL
    : SOURCE_STATUS.FAILED;

  // ── Determine providers used ─────────────────────────────────────────
  const intendedProvider = "pagespeed-insights";
  const actualProviders = new Set(strategies.map((r) => r.source));
  const primarySource = actualProviders.has("pagespeed-insights")
    ? "pagespeed-insights"
    : actualProviders.has("lighthouse-cli-fallback")
      ? "lighthouse-cli-fallback"
      : "unavailable";

  const fallbackUsed = strategies.some((r) => r.fallbackUsed === true);

  const completedAt = new Date().toISOString();

  // Determine aggregate error category for failed/partial results
  let aggregateErrorCategory = null;
  if (completeCount === 0) {
    aggregateErrorCategory = Object.values(strategyErrors).some((e) => e.category === ERROR_CATEGORY.RATE_LIMIT)
      ? ERROR_CATEGORY.RATE_LIMIT
      : Object.values(strategyErrors).some((e) => e.category === ERROR_CATEGORY.TIMEOUT)
        ? ERROR_CATEGORY.TIMEOUT
        : Object.values(strategyErrors).some((e) => e.category === ERROR_CATEGORY.AUTH)
          ? ERROR_CATEGORY.AUTH
          : ERROR_CATEGORY.INTERNAL;
  } else if (completeCount < totalStrategies) {
    aggregateErrorCategory = Object.values(strategyErrors).some((e) => e.category === ERROR_CATEGORY.RATE_LIMIT)
      ? ERROR_CATEGORY.RATE_LIMIT
      : null;
  }

  const value = {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: primarySource,
    intendedProvider,
    sourceStatus,
    status: sourceStatus,
    url,
    mobile: results.mobile,
    desktop: results.desktop,
    fieldData,
    fallbackUsed,
    limitations,
    collectedAt: completedAt,
    coverage: {
      requested: totalStrategies,
      completed: completeCount,
      failed: totalStrategies - completeCount,
    },
    rawArtifactRef: null,
    _sourceStatus: buildSourceStatus({
      provider: primarySource,
      intendedProvider,
      adapterVersion: "1.0.0",
      startedAt,
      completedAt,
      requestId: null,
      retryCount: totalRetries,
      returnedRecordCount: completeCount,
      expectedRecordCount: totalStrategies,
      errorCategory: aggregateErrorCategory,
      limitation: completeCount === 0
        ? "No usable PageSpeed or Lighthouse result."
        : fallbackUsed
          ? "PageSpeed failed; Lighthouse CLI fallback succeeded."
          : null,
      rawArtifactRef: null,
    }),
    cache: "miss",
  };
  if (!options.disableCache) await writeCache(cacheDir, cacheKey, value);
  return value;
}

// ---------------------------------------------------------------------------
// Multi-page performance collection
// ---------------------------------------------------------------------------

/**
 * Collect performance for multiple pages (homepage + conversion pages).
 *
 * Calls `collectPerformance` for each unique URL and aggregates results
 * into a single evidence envelope with backward-compatible shape.
 *
 * The envelope's `mobile` and `desktop` fields reference the first URL's
 * results for backward compatibility with existing scoring and report code.
 * Full per-page results are available in the `pageResults` array.
 */
export async function collectPerformanceForPages(urls, options = {}) {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  if (uniqueUrls.length === 0) {
    throw new Error("collectPerformanceForPages requires at least one URL");
  }

  const pageResults = [];
  for (const url of uniqueUrls) {
    try {
      const result = await collectPerformance(url, options);
      pageResults.push(result);
    } catch (error) {
      pageResults.push({
        evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
        source: "unavailable",
        intendedProvider: "pagespeed-insights",
        sourceStatus: SOURCE_STATUS.FAILED,
        status: SOURCE_STATUS.FAILED,
        url,
        mobile: { status: SOURCE_STATUS.FAILED, source: "unavailable", url, error: error.message, scores: {}, metrics: {} },
        desktop: { status: SOURCE_STATUS.FAILED, source: "unavailable", url, error: error.message, scores: {}, metrics: {} },
        fieldData: {},
        fallbackUsed: false,
        limitations: [`Performance collection failed for ${url}: ${error.message}`],
        collectedAt: new Date().toISOString(),
        coverage: { requested: 2, completed: 0, failed: 2 },
        rawArtifactRef: null,
        _sourceStatus: buildSourceStatus({
          provider: "unavailable",
          intendedProvider: "pagespeed-insights",
          adapterVersion: "1.0.0",
          startedAt: null,
          completedAt: new Date().toISOString(),
          requestId: null,
          retryCount: 0,
          returnedRecordCount: 0,
          expectedRecordCount: 2,
          errorCategory: ERROR_CATEGORY.INTERNAL,
          limitation: `Performance collection failed: ${error.message}`,
          rawArtifactRef: null,
        }),
      });
    }
  }

  // ── Aggregate status across all pages ────────────────────────────────
  const firstPage = pageResults[0];
  const allAvailable = pageResults.every((p) => p.sourceStatus === SOURCE_STATUS.AVAILABLE);
  const anyAvailable = pageResults.some((p) =>
    p.sourceStatus === SOURCE_STATUS.AVAILABLE || p.sourceStatus === SOURCE_STATUS.PARTIAL,
  );
  const allFailed = pageResults.every((p) => p.sourceStatus === SOURCE_STATUS.FAILED);

  const aggregateStatus = allAvailable ? SOURCE_STATUS.AVAILABLE
    : allFailed ? SOURCE_STATUS.FAILED
    : SOURCE_STATUS.PARTIAL;

  // Aggregate providers
  const allSources = new Set();
  const allFallbackUsed = pageResults.some((p) => p.fallbackUsed === true);
  let intendedProvider = "pagespeed-insights";
  for (const pr of pageResults) {
    if (pr.mobile?.source) allSources.add(pr.mobile.source);
    if (pr.desktop?.source) allSources.add(pr.desktop.source);
  }
  const primarySource = allSources.has("pagespeed-insights")
    ? "pagespeed-insights"
    : allSources.has("lighthouse-cli-fallback")
      ? "lighthouse-cli-fallback"
      : "unavailable";

  // Aggregate coverage
  const totalRequested = pageResults.reduce((sum, p) => sum + (p.coverage?.requested || 2), 0);
  const totalCompleted = pageResults.reduce((sum, p) => sum + (p.coverage?.completed || 0), 0);
  const totalFailed = totalRequested - totalCompleted;

  // Aggregate limitations
  const allLimitations = pageResults.flatMap((p) => p.limitations || []);

  const startedAt = new Date().toISOString();
  const completedAt = new Date().toISOString();

  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: primarySource,
    intendedProvider,
    sourceStatus: aggregateStatus,
    status: aggregateStatus,
    // Backward-compatible: expose first page's mobile/desktop
    mobile: firstPage.mobile,
    desktop: firstPage.desktop,
    fieldData: firstPage.fieldData || {},
    fallbackUsed: allFallbackUsed,
    // Multi-page results
    pageResults,
    testedUrls: uniqueUrls,
    limitations: allLimitations,
    collectedAt: completedAt,
    coverage: {
      requested: totalRequested,
      completed: totalCompleted,
      failed: totalFailed,
      pagesTested: uniqueUrls.length,
    },
    rawArtifactRef: null,
    _sourceStatus: buildSourceStatus({
      provider: primarySource,
      intendedProvider,
      adapterVersion: "1.0.0",
      startedAt,
      completedAt,
      requestId: null,
      retryCount: pageResults.reduce((sum, p) => sum + (p._sourceStatus?.retryCount || 0), 0),
      returnedRecordCount: totalCompleted,
      expectedRecordCount: totalRequested,
      errorCategory: allFailed
        ? (pageResults.some((p) => p._sourceStatus?.errorCategory === ERROR_CATEGORY.RATE_LIMIT)
            ? ERROR_CATEGORY.RATE_LIMIT
            : ERROR_CATEGORY.INTERNAL)
        : null,
      limitation: allFailed
        ? "No usable PageSpeed or Lighthouse result for any tested page."
        : allFallbackUsed
          ? "PageSpeed failed for some pages; Lighthouse CLI fallback used."
          : null,
      rawArtifactRef: null,
    }),
    cache: "miss",
  };
}

export { normalizeLighthouse };

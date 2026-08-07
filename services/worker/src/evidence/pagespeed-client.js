import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stableHash, withTimeout } from "../utils.js";
import { SOURCE_STATUS, ERROR_CATEGORY, buildSourceStatus, EVIDENCE_ENVELOPE_VERSION } from "../scoring/evidence-contracts.js";
import { persistScreenshot } from "./screenshot-artifact.js";

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

  // Diagnostic evidence enrichment (optional, non-breaking)
  const captureDiagnostic = opts.captureDiagnosticEvidence !== false;
  const screenshot = captureDiagnostic ? _extractScreenshot(lhr) : null;
  const networkRecords = captureDiagnostic ? _extractNetworkRecords(lhr) : [];
  const consoleEntries = captureDiagnostic ? _extractConsoleEntries(lhr) : [];
  const runtimeError = captureDiagnostic ? _extractRuntimeError(lhr) : null;
  const finalDisplayedUrl = lhr?.finalDisplayedUrl || lhr?.finalUrl || opts.url || null;
  const httpStatus = captureDiagnostic ? _resolveHttpStatus(networkRecords, opts.url) : null;

  const hasPerformanceScore = score("performance") !== null;

  return {
    status: hasPerformanceScore ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.PARTIAL,
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
    // Diagnostic enrichment fields (null/[] when evidence not captured)
    screenshot,
    networkRecords,
    consoleEntries,
    runtimeError,
    finalDisplayedUrl,
    httpStatus,
    diagnosticAudits: captureDiagnostic
      ? {
          errorsInConsole: audits["errors-in-console"] || null,
          networkRequests: audits["network-requests"] || null,
        }
      : {},
  };
}

// ---------------------------------------------------------------------------
// Diagnostic evidence extractors
// ---------------------------------------------------------------------------

/**
 * Extract final screenshot from Lighthouse result.
 * Returns { format, data, ref } or null.
 */
function _extractScreenshot(lhr) {
  const audit = lhr?.audits?.["final-screenshot"];
  if (!audit?.details?.data) return null;
  return {
    format: "jpeg",
    data: typeof audit.details.data === "string" ? audit.details.data : null,
    ref: "lighthouse://screenshot/final",
  };
}

/**
 * Extract network records from Lighthouse result.
 * Returns array of { url, status, mimeType, failed, blocked }.
 */
function _extractNetworkRecords(lhr) {
  const items = lhr?.audits?.["network-requests"]?.details?.items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    url: item.url || "",
    status: item.statusCode || 0,
    mimeType: item.mimeType || "",
    failed: item.failed === true || (item.statusCode && item.statusCode >= 400),
    blocked: item.blocked === true || item.statusCode === 0,
  }));
}

/**
 * Extract console entries from Lighthouse result.
 * Returns array of { level, text, source }.
 */
function _extractConsoleEntries(lhr) {
  const items = lhr?.audits?.["errors-in-console"]?.details?.items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    level: item.level || "error",
    text: item.description || item.text || "",
    source: item.source || "",
  }));
}

/**
 * Extract runtime error from Lighthouse result.
 * Returns { code, message } or null.
 */
function _extractRuntimeError(lhr) {
  if (!lhr?.runtimeError) return null;
  return {
    code: lhr.runtimeError.code || null,
    message: lhr.runtimeError.message || null,
  };
}

/**
 * Resolve HTTP status from network records for the main document.
 */
function _resolveHttpStatus(networkRecords, targetUrl) {
  if (!Array.isArray(networkRecords) || networkRecords.length === 0) return null;
  // Find the main document request
  const mainDoc = networkRecords.find(
    (r) => r.url === targetUrl || (r.mimeType && r.mimeType.includes("html")),
  );
  return mainDoc?.status || null;
}

/**
 * Extract a runtime error code and message from an error message string.
 * Used when a strategy fails and we don't have a structured runtimeError.
 */
function _extractErrorFromMessage(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  if (lower.includes("navigation timeout") || lower.includes("protocol timeout")) {
    return { code: "NAVIGATION_TIMEOUT", message: message.slice(0, 200) };
  }
  if (lower.includes("page load timeout")) {
    return { code: "PAGE_LOAD_TIMEOUT", message: message.slice(0, 200) };
  }
  if (lower.includes("certificate") || lower.includes("tls") || lower.includes("ssl") || lower.includes("dns")) {
    return { code: "TLS_DNS_FAILURE", message: message.slice(0, 200) };
  }
  if (lower.includes("browser") && (lower.includes("crash") || lower.includes("disconnect"))) {
    return { code: "BROWSER_CRASH", message: message.slice(0, 200) };
  }
  return { code: null, message: message.slice(0, 200) };
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
        captureDiagnosticEvidence: options.captureDiagnosticEvidence !== false,
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
          // Diagnostic fields (null — no evidence from failed strategy)
          screenshot: null,
          networkRecords: [],
          consoleEntries: [],
          runtimeError: _extractErrorFromMessage(localError.message),
          finalDisplayedUrl: null,
          httpStatus: null,
          diagnosticAudits: {},
        };
      }
    }
  }

  // ── Persist screenshots for each strategy ──────────────────────────
  const screenshotMeta = options.screenshotMeta || {};
  for (const strategy of ["mobile", "desktop"]) {
    const result = results[strategy];
    if (!result || result.status === SOURCE_STATUS.FAILED) continue;

    try {
      // Get screenshot data — may be in normalized result or raw LHR spread
      let screenshotData = result.screenshot?.data || null;
      if (!screenshotData && result.audits?.["final-screenshot"]?.details?.data) {
        // Raw LHR was spread from Lighthouse fallback — extract directly
        screenshotData = result.audits["final-screenshot"].details.data;
      }

      if (screenshotData && typeof screenshotData === "string") {
        const persisted = await persistScreenshot(screenshotData, {
          url: result.url || url,
          finalUrl: result.finalDisplayedUrl || result.url || url,
          strategy,
          provider: result.source || "unknown",
          runId: screenshotMeta.runId || null,
          slug: screenshotMeta.slug || null,
          diagnosticCode: screenshotMeta.diagnosticCode || null,
        }, {
          artifactRoot: screenshotMeta.artifactRoot || resolve("artifacts"),
          objectStore: options.objectStore || null,
        });

        if (persisted.persisted && persisted.portableRef) {
          result.screenshot = {
            format: "jpeg",
            portableRef: persisted.portableRef,
            checksum: persisted.checksum,
            sizeBytes: persisted.sizeBytes,
            persisted: true,
          };
        } else {
          limitations.push(`Screenshot persistence failed for ${strategy}: ${persisted.error || "unknown error"}`);
          result.screenshot = { format: "jpeg", portableRef: null, persisted: false, error: persisted.error };
        }
      }
    } catch (screenshotError) {
      limitations.push(`Screenshot artifact write failed for ${strategy}: ${screenshotError.message}`);
      if (result.screenshot?.data) {
        result.screenshot = { format: "jpeg", portableRef: null, persisted: false, error: screenshotError.message };
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
  // A strategy is AVAILABLE when it produced a non-null performance score.
  // A strategy is PARTIAL when it ran (no provider error) but the score is null.
  // A strategy is FAILED when the provider could not run at all.
  const strategies = Object.values(results);
  const totalStrategies = strategies.length;
  const ranCount = strategies.filter((r) => r.status !== SOURCE_STATUS.FAILED).length;
  const usableCount = strategies.filter((r) => r.scores?.performance != null).length;
  const sourceStatus = usableCount === totalStrategies ? SOURCE_STATUS.AVAILABLE
    : ranCount > 0 ? SOURCE_STATUS.PARTIAL
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
  if (ranCount === 0) {
    aggregateErrorCategory = Object.values(strategyErrors).some((e) => e.category === ERROR_CATEGORY.RATE_LIMIT)
      ? ERROR_CATEGORY.RATE_LIMIT
      : Object.values(strategyErrors).some((e) => e.category === ERROR_CATEGORY.TIMEOUT)
        ? ERROR_CATEGORY.TIMEOUT
        : Object.values(strategyErrors).some((e) => e.category === ERROR_CATEGORY.AUTH)
          ? ERROR_CATEGORY.AUTH
          : ERROR_CATEGORY.INTERNAL;
  } else if (usableCount < totalStrategies) {
    aggregateErrorCategory = Object.values(strategyErrors).some((e) => e.category === ERROR_CATEGORY.RATE_LIMIT)
      ? ERROR_CATEGORY.RATE_LIMIT
      : null;
  }

  // Build a precise limitation message
  let sourceLimitation = null;
  if (ranCount === 0) {
    sourceLimitation = "No usable PageSpeed or Lighthouse result.";
  } else if (usableCount === 0 && ranCount > 0) {
    sourceLimitation = "Performance tests ran but did not produce measurable scores. The page may have timed out during metric collection or lacked sufficient content for Lighthouse scoring.";
  } else if (fallbackUsed) {
    sourceLimitation = "PageSpeed failed for at least one strategy; Lighthouse CLI fallback succeeded.";
  } else if (usableCount < totalStrategies) {
    sourceLimitation = `Only ${usableCount} of ${totalStrategies} device strategies produced a measurable performance score.`;
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
      completed: ranCount,
      failed: totalStrategies - ranCount,
      usableScores: usableCount,
    },
    rawArtifactRef: null,
    _sourceStatus: buildSourceStatus({
      provider: primarySource,
      intendedProvider,
      adapterVersion: "1.1.0",
      startedAt,
      completedAt,
      requestId: null,
      retryCount: totalRetries,
      returnedRecordCount: usableCount,
      expectedRecordCount: totalStrategies,
      errorCategory: aggregateErrorCategory,
      limitation: sourceLimitation,
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
  const totalUsableScores = pageResults.reduce((sum, p) => sum + (p.coverage?.usableScores || 0), 0);

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
      usableScores: totalUsableScores,
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

// ---------------------------------------------------------------------------
// Governed execute() contract — WP6 universal adapter interface
// ---------------------------------------------------------------------------

const PAGESPEED_ADAPTER_VERSION = "1.1.0";

/**
 * Execute the PageSpeed + Lighthouse adapter behind the universal source contract.
 *
 * Conforms to the WP6 `execute({ auditRequest, source, executionId,
 * sourceExecutionKey, signal, attempt })` interface.
 *
 * Extracts the target URL from auditRequest and uses the first URL for
 * performance testing. Multi-page testing can be configured via
 * auditRequest.performance settings.
 */
export async function execute({ auditRequest, source, executionId, sourceExecutionKey, signal, attempt }) {
  const startedAt = new Date().toISOString();
  const targetUrl = auditRequest.targetUrl;
  const perfConfig = auditRequest.performance || {};

  // Build options from audit request
  const options = {
    apiKey: perfConfig.pagespeedApiKey || process.env.PAGESPEED_API_KEY || "",
    cruxApiKey: perfConfig.cruxApiKey || process.env.CRUX_API_KEY || "",
    disableCache: true,
    captureDiagnosticEvidence: true,
  };

  try {
    let envelope;
    const urls = perfConfig.urls || [targetUrl];

    if (urls.length > 1) {
      envelope = await collectPerformanceForPages(urls, options);
    } else {
      envelope = await collectPerformance(targetUrl, options);
    }

    // Serialize raw evidence for artifact storage
    const rawPayload = {
      adapterVersion: PAGESPEED_ADAPTER_VERSION,
      collectedAt: envelope.collectedAt,
      mobile: envelope.mobile ? {
        source: envelope.mobile.source,
        scores: envelope.mobile.scores,
        metrics: envelope.mobile.metrics,
      } : null,
      desktop: envelope.desktop ? {
        source: envelope.desktop.source,
        scores: envelope.desktop.scores,
        metrics: envelope.desktop.metrics,
      } : null,
      fieldData: envelope.fieldData,
    };
    const rawBytes = Buffer.from(JSON.stringify(rawPayload), "utf-8");

    const sourceStatus = envelope._sourceStatus || {};
    const sourceResult = {
      contractVersion: "1.0.0",
      schemaVersion: "1.0.0",
      source,
      provider: envelope.source || sourceStatus.provider || "Google",
      adapterVersion: PAGESPEED_ADAPTER_VERSION,
      status: envelope.sourceStatus || envelope.status || "AVAILABLE",
      startedAt: sourceStatus.startedAt || startedAt,
      completedAt: sourceStatus.completedAt || envelope.collectedAt || new Date().toISOString(),
      requestId: sourceStatus.requestId || null,
      retryCount: sourceStatus.retryCount || 0,
      expectedRecords: sourceStatus.expectedRecordCount ?? envelope.coverage?.requested ?? 2,
      returnedRecords: sourceStatus.returnedRecordCount ?? envelope.coverage?.completed ?? 0,
      coverage: envelope.coverage || { requested: 2, completed: 0, failed: 2 },
      limitations: envelope.limitations || [],
      evidence: {
        sourceStatus: envelope.sourceStatus || envelope.status,
        fallbackUsed: envelope.fallbackUsed || false,
        primarySource: envelope.source,
        intendedProvider: envelope.intendedProvider || "pagespeed-insights",
        mobileStatus: envelope.mobile?.status || null,
        desktopStatus: envelope.desktop?.status || null,
      },
    };

    if (sourceStatus.errorCategory) {
      sourceResult.errorCategory = sourceStatus.errorCategory;
    }
    if (envelope.mobile?.scores?.performance != null) {
      sourceResult.evidence.mobilePerformanceScore = envelope.mobile.scores.performance;
    }
    if (envelope.desktop?.scores?.performance != null) {
      sourceResult.evidence.desktopPerformanceScore = envelope.desktop.scores.performance;
    }

    return { rawBytes, contentType: "application/json", sourceResult };
  } catch (error) {
    const completedAt = new Date().toISOString();
    return {
      rawBytes: null,
      contentType: null,
      sourceResult: {
        contractVersion: "1.0.0",
        schemaVersion: "1.0.0",
        source,
        provider: "Google",
        adapterVersion: PAGESPEED_ADAPTER_VERSION,
        status: "FAILED",
        startedAt,
        completedAt,
        requestId: null,
        retryCount: attempt - 1,
        expectedRecords: 2,
        returnedRecords: 0,
        coverage: { requested: 2, completed: 0, failed: 2 },
        limitations: [`Performance collection failed: ${error.message}`],
        errorCategory: error.errorCategory || "internal",
        evidence: {},
      },
    };
  }
}

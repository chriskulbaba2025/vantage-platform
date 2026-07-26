import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stableHash, withTimeout } from "../utils.js";
import { SOURCE_STATUS, ERROR_CATEGORY, buildSourceStatus, EVIDENCE_ENVELOPE_VERSION } from "../scoring/evidence-contracts.js";

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

function metricValue(audits, id) {
  const item = audits?.[id];
  return item?.numericValue ?? null;
}

function normalizeLighthouse(lhr, source, strategy) {
  const categories = lhr?.categories || {};
  const audits = lhr?.audits || {};
  const score = (key) => categories[key]?.score == null ? null : Math.round(categories[key].score * 100);
  return {
    status: SOURCE_STATUS.AVAILABLE,
    source,
    strategy,
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
  };
}

async function callPsi(url, strategy, apiKey, fetchImpl) {
  const query = new URLSearchParams({
    url,
    strategy,
    category: "performance",
  });
  ["accessibility", "best-practices", "seo"].forEach((category) => query.append("category", category));
  if (apiKey) query.set("key", apiKey);
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${query}`;
  const response = await withTimeout(fetchImpl(endpoint), 90000, `PageSpeed ${strategy}`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`PageSpeed ${strategy} failed (${response.status}): ${body.slice(0, 300)}`);
    error.status = response.status;
    // Attach error category so callers can distinguish rate-limit from other failures.
    error.errorCategory = response.status === 429 ? ERROR_CATEGORY.RATE_LIMIT
      : response.status === 403 || response.status === 401 ? ERROR_CATEGORY.AUTH
      : null;
    throw error;
  }
  const body = await response.json();
  if (!body.lighthouseResult) throw new Error(`PageSpeed ${strategy} returned no lighthouseResult`);
  return normalizeLighthouse(body.lighthouseResult, "pagespeed-insights", strategy);
}

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
    return normalizeLighthouse(result.lhr, "lighthouse-cli-fallback", strategy);
  } finally {
    await chrome.kill();
  }
}

async function queryCrux(url, apiKey, formFactor, fetchImpl) {
  if (!apiKey) return { status: SOURCE_STATUS.NOT_CONNECTED, formFactor, metrics: null };
  const endpoint = `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(apiKey)}`;
  const response = await withTimeout(fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, formFactor }),
  }), 30000, `CrUX ${formFactor}`);
  if (response.status === 404) return { status: SOURCE_STATUS.UNAVAILABLE, formFactor, metrics: null };
  if (!response.ok) throw new Error(`CrUX ${formFactor} failed (${response.status})`);
  const body = await response.json();
  return { status: SOURCE_STATUS.AVAILABLE, formFactor, metrics: body.record?.metrics || null, collectionPeriod: body.record?.collectionPeriod || null };
}

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
  for (const strategy of ["mobile", "desktop"]) {
    try {
      results[strategy] = await callPsi(url, strategy, options.apiKey || "", fetchImpl);
    } catch (psiError) {
      limitations.push(psiError.message);
      strategyErrors[strategy] = { category: psiError.errorCategory || ERROR_CATEGORY.INTERNAL, message: psiError.message };
      try {
        const runner = options.localRunner || runLocalLighthouse;
        results[strategy] = await runner(url, strategy);
      } catch (localError) {
        limitations.push(`Local Lighthouse ${strategy} failed: ${localError.message}`);
        strategyErrors[strategy] = {
          category: strategyErrors[strategy]?.category || ERROR_CATEGORY.INTERNAL,
          message: `${psiError.message}; Local Lighthouse: ${localError.message}`,
        };
        results[strategy] = {
          status: SOURCE_STATUS.FAILED,
          strategy,
          source: "unavailable",
          error: localError.message,
          scores: {},
          metrics: {},
          opportunities: [],
        };
      }
    }
  }

  const fieldData = {};
  for (const formFactor of ["PHONE", "DESKTOP"]) {
    try {
      fieldData[formFactor.toLowerCase()] = await queryCrux(url, options.cruxApiKey || "", formFactor, fetchImpl);
    } catch (error) {
      limitations.push(error.message);
      fieldData[formFactor.toLowerCase()] = { status: SOURCE_STATUS.FAILED, formFactor, metrics: null, error: error.message };
    }
  }

  const strategies = Object.values(results);
  const completeCount = strategies.filter((r) => r.status === SOURCE_STATUS.AVAILABLE).length;
  const totalStrategies = strategies.length;
  const sourceStatus = completeCount === totalStrategies ? SOURCE_STATUS.AVAILABLE
    : completeCount > 0 ? SOURCE_STATUS.PARTIAL
    : SOURCE_STATUS.FAILED;

  // Determine the primary source label.
  const primarySource = strategies.some((r) => r.source === "pagespeed-insights")
    ? "pagespeed-insights"
    : strategies.some((r) => r.source === "lighthouse-cli-fallback")
      ? "lighthouse-cli-fallback"
      : "unavailable";

  const completedAt = new Date().toISOString();
  const value = {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: primarySource,
    sourceStatus,
    status: sourceStatus, // canonical alias — consumers should use sourceStatus
    mobile: results.mobile,
    desktop: results.desktop,
    fieldData,
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
      adapterVersion: "1.0.0",
      startedAt,
      completedAt,
      requestId: null,
      retryCount: 0,
      returnedRecordCount: completeCount,
      expectedRecordCount: totalStrategies,
      errorCategory: completeCount === 0
        ? (Object.values(strategyErrors).some((e) => e.category === ERROR_CATEGORY.RATE_LIMIT)
            ? ERROR_CATEGORY.RATE_LIMIT
            : ERROR_CATEGORY.INTERNAL)
        : completeCount < totalStrategies
          ? (Object.values(strategyErrors).some((e) => e.category === ERROR_CATEGORY.RATE_LIMIT)
              ? ERROR_CATEGORY.RATE_LIMIT
              : null)
          : null,
      limitation: completeCount === 0 ? "No usable PageSpeed or Lighthouse result." : null,
      rawArtifactRef: null,
    }),
    cache: "miss",
  };
  if (!options.disableCache) await writeCache(cacheDir, cacheKey, value);
  return value;
}

export { normalizeLighthouse };

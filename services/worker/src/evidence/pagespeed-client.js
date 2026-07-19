import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stableHash, withTimeout } from "../utils.js";

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
    status: "complete",
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
  if (!apiKey) return { status: "not_configured", formFactor, metrics: null };
  const endpoint = `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(apiKey)}`;
  const response = await withTimeout(fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, formFactor }),
  }), 30000, `CrUX ${formFactor}`);
  if (response.status === 404) return { status: "no_data", formFactor, metrics: null };
  if (!response.ok) throw new Error(`CrUX ${formFactor} failed (${response.status})`);
  const body = await response.json();
  return { status: "complete", formFactor, metrics: body.record?.metrics || null, collectionPeriod: body.record?.collectionPeriod || null };
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

  const limitations = [];
  const results = {};
  for (const strategy of ["mobile", "desktop"]) {
    try {
      results[strategy] = await callPsi(url, strategy, options.apiKey || "", fetchImpl);
    } catch (psiError) {
      limitations.push(psiError.message);
      try {
        const runner = options.localRunner || runLocalLighthouse;
        results[strategy] = await runner(url, strategy);
      } catch (localError) {
        limitations.push(`Local Lighthouse ${strategy} failed: ${localError.message}`);
        results[strategy] = { status: "failed", strategy, source: "unavailable", error: localError.message, scores: {}, metrics: {}, opportunities: [] };
      }
    }
  }

  const fieldData = {};
  for (const formFactor of ["PHONE", "DESKTOP"]) {
    try {
      fieldData[formFactor.toLowerCase()] = await queryCrux(url, options.cruxApiKey || "", formFactor, fetchImpl);
    } catch (error) {
      limitations.push(error.message);
      fieldData[formFactor.toLowerCase()] = { status: "failed", formFactor, metrics: null, error: error.message };
    }
  }

  const value = {
    status: Object.values(results).some((r) => r.status === "complete") ? "complete" : "failed",
    mobile: results.mobile,
    desktop: results.desktop,
    fieldData,
    limitations,
    cache: "miss",
    collectedAt: new Date().toISOString(),
  };
  if (!options.disableCache) await writeCache(cacheDir, cacheKey, value);
  return value;
}

export { normalizeLighthouse };

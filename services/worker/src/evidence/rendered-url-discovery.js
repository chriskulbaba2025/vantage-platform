import { canonicalizeDiscoveryUrl, URL_DISCOVERY_PROVENANCE } from "./url-discovery-reconciliation.js";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_PAGE_CAP = 4;
const DEFAULT_STRUCTURAL_PATHS = ["/", "/services", "/pricing", "/contact", "/about"];

function sameOrigin(url, targetUrl) {
  try { return new URL(url).origin === new URL(targetUrl).origin; } catch { return false; }
}

function candidateUrls(targetUrl, structuralUrls, maxPages) {
  const supplied = Array.isArray(structuralUrls) ? structuralUrls : [];
  const values = [new URL(targetUrl).origin + "/", ...DEFAULT_STRUCTURAL_PATHS.map((path) => new URL(path, targetUrl).toString()), ...supplied];
  return [...new Set(values.map((value) => canonicalizeDiscoveryUrl(value, targetUrl)).filter((url) => url && sameOrigin(url, targetUrl)))].slice(0, maxPages);
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("rendered discovery aborted");
}

/**
 * Bounded structural browser discovery. It is opt-in at the caller because a
 * browser is an expensive capability, but when enabled it is only permitted
 * to visit a small structural URL set and only returns same-origin links.
 */
export async function discoverRenderedStructuralUrls(targetUrl, options = {}) {
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 60000));
  const maxPages = Math.max(1, Math.min(Number(options.maxPages) || DEFAULT_PAGE_CAP, DEFAULT_PAGE_CAP));
  const urls = candidateUrls(targetUrl, options.structuralUrls, maxPages);
  const limitations = [];
  const discovered = new Map();
  let browser;
  let pagesAttempted = 0;
  try {
    let chromium = options.browserImpl;
    if (!chromium) ({ chromium } = await import("playwright"));
    if (!chromium?.launch) throw new Error("browser launcher unavailable");
    browser = await chromium.launch({ headless: true });
    for (const url of urls) {
      abortIfNeeded(options.signal);
      pagesAttempted += 1;
      let page;
      try {
        page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({ url: anchor.href, status: "AVAILABLE" })));
        for (const item of links) {
          const normalized = canonicalizeDiscoveryUrl(item.url, targetUrl);
          if (normalized && sameOrigin(normalized, targetUrl)) discovered.set(normalized, { url: normalized, status: item.status, sourceUrl: url });
        }
      } catch (error) {
        limitations.push(`Rendered structural discovery failed at ${url}: ${error.message}`);
      } finally {
        await page?.close().catch(() => {});
      }
    }
  } catch (error) {
    limitations.push(`Rendered browser discovery unavailable: ${error.message}`);
  } finally {
    await browser?.close().catch(() => {});
  }
  const values = [...discovered.values()].sort((a, b) => a.url.localeCompare(b.url));
  return {
    source: URL_DISCOVERY_PROVENANCE.RENDERED_BROWSER,
    urls: values,
    status: values.length ? "AVAILABLE" : "FAILED",
    limitations,
    pagesAttempted,
    bounded: true,
    pageCap: maxPages,
  };
}

export default { discoverRenderedStructuralUrls };

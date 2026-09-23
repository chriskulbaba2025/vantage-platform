import * as cheerio from "cheerio";
import { canonicalizeDiscoveryUrl, URL_DISCOVERY_PROVENANCE } from "./url-discovery-reconciliation.js";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_SOURCES = 4;

function sameOrigin(url, targetUrl) {
  try { return new URL(url).origin === new URL(targetUrl).origin; } catch { return false; }
}

function boundedSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("supplemental discovery timeout")), timeoutMs);
  const onAbort = () => controller.abort(parentSignal.reason || new Error("supplemental discovery aborted"));
  if (parentSignal?.aborted) onAbort();
  else if (parentSignal) parentSignal.addEventListener("abort", onAbort, { once: true });
  return { signal: controller.signal, cleanup: () => { clearTimeout(timer); parentSignal?.removeEventListener("abort", onAbort); } };
}

async function fetchBounded(url, { fetchImpl, signal, timeoutMs, maxBytes }) {
  const scoped = boundedSignal(signal, timeoutMs);
  try {
    const response = await fetchImpl(url, { redirect: "manual", signal: scoped.signal, headers: { "user-agent": "PrysmAuditBot/1.0", accept: "text/html,text/plain,text/markdown,*/*;q=0.2" } });
    if (!response.ok) return { status: response.status, text: "", ok: false };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`supplemental source exceeds ${maxBytes} bytes`);
    return { status: response.status, text: bytes.toString("utf8"), ok: true };
  } finally { scoped.cleanup(); }
}

function linksFromHtml(html, targetUrl) {
  const $ = cheerio.load(String(html || ""));
  const urls = [];
  $("a[href]").each((_, node) => {
    const raw = $(node).attr("href");
    const url = canonicalizeDiscoveryUrl(raw, targetUrl);
    if (url && sameOrigin(url, targetUrl)) urls.push(url);
  });
  return [...new Set(urls)].sort();
}

function linksFromLlms(text, targetUrl) {
  const urls = [];
  const markdown = /\]\(([^)\s]+)\)/g;
  const raw = /https?:\/\/[^\s)<>]+/g;
  for (const match of String(text || "").matchAll(markdown)) urls.push(match[1]);
  for (const match of String(text || "").matchAll(raw)) urls.push(match[0]);
  return [...new Set(urls.map((value) => canonicalizeDiscoveryUrl(value, targetUrl)).filter((url) => url && sameOrigin(url, targetUrl)))].sort();
}

function candidateStructuralUrls(targetUrl, options) {
  const origin = new URL(targetUrl).origin;
  const supplied = Array.isArray(options.structuralUrls) ? options.structuralUrls : [];
  const defaults = ["/sitemap.html", "/site-map", "/sitemap/"];
  return [...new Set([...defaults.map((path) => new URL(path, origin).toString()), ...supplied.map((value) => canonicalizeDiscoveryUrl(value, targetUrl)).filter(Boolean)])]
    .filter((url) => sameOrigin(url, targetUrl));
}

/** Bounded, supporting discovery. It never asserts that an omitted URL is absent. */
export async function discoverSupplementalUrlSources(targetUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");
  const timeoutMs = Math.max(100, Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 120000));
  const maxBytes = Math.max(1024, Math.min(Number(options.maxBytes) || DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES));
  const maxSources = Math.max(1, Math.min(Number(options.maxSources) || DEFAULT_MAX_SOURCES, DEFAULT_MAX_SOURCES));
  const sources = {};
  const statuses = {};
  const limitations = [];
  const llmsUrl = new URL("/llms.txt", targetUrl).toString();
  try {
    const result = await fetchBounded(llmsUrl, { fetchImpl, signal: options.signal, timeoutMs, maxBytes });
    statuses[URL_DISCOVERY_PROVENANCE.LLMS_TXT] = result.ok ? "AVAILABLE" : result.status === 404 ? "NOT_APPLICABLE" : "FAILED";
    if (result.ok) sources[URL_DISCOVERY_PROVENANCE.LLMS_TXT] = linksFromLlms(result.text, targetUrl).map((url) => ({ url, status: "AVAILABLE" }));
  } catch (error) {
    if (options.signal?.aborted) throw error;
    statuses[URL_DISCOVERY_PROVENANCE.LLMS_TXT] = "FAILED";
    limitations.push(`llms.txt discovery failed: ${error.message}`);
  }

  const structural = candidateStructuralUrls(targetUrl, options).slice(0, Math.max(0, maxSources - 1));
  const htmlUrls = [];
  let attempted = 0;
  let successful = 0;
  for (const sourceUrl of structural) {
    try {
      attempted += 1;
      const result = await fetchBounded(sourceUrl, { fetchImpl, signal: options.signal, timeoutMs, maxBytes });
      if (!result.ok) continue;
      successful += 1;
      htmlUrls.push(...linksFromHtml(result.text, targetUrl).map((url) => ({ url, status: "AVAILABLE", sourceUrl })));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      limitations.push(`HTML sitemap discovery failed at ${sourceUrl}: ${error.message}`);
    }
  }
  statuses[URL_DISCOVERY_PROVENANCE.HTML_SITEMAP] = htmlUrls.length ? "AVAILABLE" : successful ? "AVAILABLE" : "NOT_APPLICABLE";
  if (htmlUrls.length) sources[URL_DISCOVERY_PROVENANCE.HTML_SITEMAP] = htmlUrls;
  return { sources, statuses, limitations, attemptedSources: attempted + 1, bounded: true };
}

export default { discoverSupplementalUrlSources };

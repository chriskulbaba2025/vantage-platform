import { crawlSite } from "./site-crawler.js";
import { SOURCE_STATUS, buildSourceStatus } from "../scoring/evidence-contracts.js";

const ACCESS_BLOCK_RE = /\b403\b|forbidden|access denied|request blocked|blocked by (?:the )?(?:provider|host|firewall|waf)|bot protection/i;
const CHALLENGE_RE = /captcha|recaptcha|verify (?:you are|that you are) human|checking your browser|just a moment|access denied|request rejected|cloudflare ray id/i;

function primaryFailureText(primary) {
  return [
    ...(Array.isArray(primary?.limitations) ? primary.limitations : []),
    primary?.error,
    primary?._sourceStatus?.limitation,
    primary?._raw?.error,
  ].filter(Boolean).join(" ");
}

export function isPrimaryAccessBlocked(primary) {
  if (!primary || ![SOURCE_STATUS.FAILED, SOURCE_STATUS.BLOCKED].includes(primary.sourceStatus || primary.status)) return false;
  // Some provider failures omit the upstream HTTP detail from the persisted
  // envelope. A zero-page core-source failure is still eligible for the
  // governed public-access probe; the probe itself must prove real HTML and
  // all access-control checks before any fallback is accepted.
  return ACCESS_BLOCK_RE.test(primaryFailureText(primary))
    || (primary.sourceStatus === SOURCE_STATUS.FAILED && primary.pageCount !== undefined && Number(primary.pageCount) === 0);
}

function robotsDisallowsTarget(robotsText, targetUrl) {
  if (typeof robotsText !== "string" || !robotsText.trim()) return false;
  const path = new URL(targetUrl).pathname || "/";
  let applies = false;
  let disallow = [];
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      applies = value === "*";
      disallow = [];
    } else if (applies && key === "disallow" && value) {
      disallow.push(value);
    } else if (applies && key === "allow" && value) {
      disallow.push(`!${value}`);
    }
  }
  const rules = disallow.filter((rule) => !rule.startsWith("!"));
  const allows = disallow.filter((rule) => rule.startsWith("!")).map((rule) => rule.slice(1));
  return rules.some((rule) => path.startsWith(rule) && !allows.some((allow) => path.startsWith(allow)));
}

function sameSitePages(pages, targetUrl) {
  const targetHost = new URL(targetUrl).hostname.replace(/^www\./i, "");
  return (Array.isArray(pages) ? pages : []).filter((page) => {
    try {
      const host = new URL(page?.url || "").hostname.replace(/^www\./i, "");
    return host === targetHost && Number(page?.status) === 200;
    } catch {
      return false;
    }
  });
}

function looksLikeChallenge(page) {
  const headers = page?.responseHeaders || {};
  const headerText = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" ");
  return CHALLENGE_RE.test(`${page?.title || ""} ${page?.bodyText || ""} ${headerText}`)
    || /\b(?:sg-captcha|captcha|challenge)\b/i.test(headerText)
    || (typeof page?.bodyText === "string" && page.bodyText.trim().length === 0);
}

/**
 * Recover first-party evidence when a primary provider cannot fetch a public
 * target. Returns null for robots, auth/challenge, error-page, cross-domain,
 * or zero-page results.
 */
export async function collectPublicAccessFallback({ targetUrl, primary, options = {} }) {
  if (!isPrimaryAccessBlocked(primary)) return null;
  const explicitlyBlocked = ACCESS_BLOCK_RE.test(primaryFailureText(primary));
  // Undetailed zero-page failures are probed only during an explicit,
  // governed evidence-recovery run. Ordinary adapter calls, including
  // missing-credential failures, must not start a live crawl.
  if (!explicitlyBlocked && options.allowUndetailedProbe !== true) return null;
  let fallback;
  try {
    fallback = await crawlSite(targetUrl, {
      // A fallback is representative first-party recovery, not an attempt
      // to reproduce the provider's full crawl ceiling. Keep it bounded so a
      // blocked-provider recovery cannot monopolize the worker.
      maxPages: Math.min(options.maxPages || 10, 10),
      browserMode: options.browserMode || "auto",
      fetchImpl: options.fetchImpl,
      browserRenderer: options.browserRenderer,
      businessName: options.businessName || "",
    });
  } catch {
    return null;
  }
  if (robotsDisallowsTarget(fallback.robotsText, targetUrl)) return null;
  const pages = sameSitePages(fallback.pages, targetUrl);
  if (!pages.length || pages.some(looksLikeChallenge)) return null;

  const primaryLimitations = Array.isArray(primary.limitations) ? primary.limitations : [];
  const limitation = "Primary website collection was blocked; governed public-access fallback used.";
  const status = pages.length < (fallback.pages?.length || pages.length) ? SOURCE_STATUS.PARTIAL : SOURCE_STATUS.AVAILABLE;
  const contentEvidenceAvailable = pages.some((page) =>
    typeof page?.bodyText === "string" && page.bodyText.trim().length > 0,
  );
  return {
    ...fallback,
    source: "prysm-public-access-fallback",
    sourceStatus: status,
    status,
    pages,
    pageCount: pages.length,
    fallbackUsed: true,
    fallbackType: "public-access-direct-crawl",
    primarySource: primary.source || "dataforseo-onpage",
    primaryStatus: primary.sourceStatus || primary.status || SOURCE_STATUS.FAILED,
    primaryLimitations,
    _contentEvidenceAvailable: contentEvidenceAvailable,
    _interactiveEvidenceAvailable: false,
    limitations: [...primaryLimitations, limitation, ...(fallback.limitations || [])],
    _sourceStatus: buildSourceStatus({
      provider: "prysm-public-access-fallback",
      intendedProvider: "dataforseo-onpage",
      adapterVersion: "1.0.0",
      startedAt: fallback._sourceStatus?.startedAt || null,
      completedAt: fallback._sourceStatus?.completedAt || fallback.collectedAt,
      requestId: null,
      retryCount: 0,
      returnedRecordCount: pages.length,
      expectedRecordCount: fallback.pageCount,
      errorCategory: null,
      limitation,
      rawArtifactRef: null,
    }),
  };
}

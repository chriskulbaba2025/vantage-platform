/**
 * V3 Internal-Link Opportunity Module (PRD §13)
 *
 * Generates implementation-ready internal-link recommendations from
 * crawled page evidence. Every recommendation is traceable to source
 * and target page content.  A topic mention alone is never enough.
 */

import { SOURCE_STATUS, buildSourceStatus, EVIDENCE_ENVELOPE_VERSION } from "../scoring/evidence-contracts.js";

// ---------------------------------------------------------------------------
// Normalize + match helpers
// ---------------------------------------------------------------------------

const UTIL_PATH = /\/(privacy|terms|cookie|login|cart|account|tag|search|wp-admin|admin|checkout|my-account|basket|signin|signup|register|logout|reset|ajax|api|feed|xmlrpc|trackback|author\/|category\/|\d{4}\/\d{2}\/)/i;
const UTIL_TITLE = /^(privacy|terms|cookie policy|login|cart|account|sign in|sign up|register|checkout|404|search results)/i;
const GENERIC_ANCHOR = /^(click here|learn more|read more|here|more|details|info|link|click|go|visit|view more|continue reading|find out more|discover more|get started|explore)$/i;

const CONF_ORDER = { high: 0, medium: 1, low: 2 };
const STAGE_ORDER = { awareness: 0, consideration: 1, decision: 2, "conversion-support": 3 };

function norm(s) { return (s || "").replace(/\/$/, "").toLowerCase().trim(); }
function normWS(s) { return (s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
function isGenAnchor(t) { return GENERIC_ANCHOR.test((t || "").trim()); }
function isUtility(p) { return !p || UTIL_PATH.test(p.url || "") || UTIL_TITLE.test(p.title || ""); }

// ---------------------------------------------------------------------------
// Page validation (PRD §13 requirement 2)
// ---------------------------------------------------------------------------

function pageStatusExcluded(page) {
  const st = page.status || 200;
  if (st < 200 || st >= 300) {
    if (st === 301 || st === 302 || st === 307 || st === 308) return { excluded: true, reason: "redirected" };
    if (st === 403 || st === 401) return { excluded: true, reason: "blocked" };
    if (st >= 400) return { excluded: true, reason: "failed" };
  }
  return { excluded: false, reason: null };
}

function isExternal(page, siteUrl) {
  try {
    const siteHost = new URL(siteUrl).hostname.replace(/^www\./, "").toLowerCase();
    const pageHost = new URL(page.url).hostname.replace(/^www\./, "").toLowerCase();
    return pageHost !== siteHost;
  } catch { return true; }
}

function isNonIndexable(page) {
  if (page.canonical && page.url && norm(page.canonical) !== norm(page.url)) return true;
  if (page.metaRobots && /noindex/i.test(page.metaRobots)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Anchor extraction (must be verbatim from source page — PRD §13 requirement 4)
// ---------------------------------------------------------------------------

function sourceAnchor(sourcePage, services) {
  const h = [...(sourcePage.headings?.h2 || []), ...(sourcePage.headings?.h3 || []), ...(sourcePage.headings?.h1 || [])];
  // Best: heading mentioning a relevant service
  for (const svc of services) {
    const m = h.find((x) => x.length >= 3 && x.length <= 80 && !isGenAnchor(x) && x.toLowerCase().includes(svc.toLowerCase()));
    if (m) return m;
  }
  // Good: first meaningful non-generic heading
  const first = h.find((x) => x.length >= 3 && x.length <= 80 && !isGenAnchor(x));
  if (first) return first;
  return null; // no valid source anchor → exclude or low-confidence only
}

function sourceContext(sourcePage, anchor) {
  const all = [...(sourcePage.headings?.h1 || []), ...(sourcePage.headings?.h2 || []), ...(sourcePage.headings?.h3 || [])];
  const idx = all.indexOf(anchor);
  if (idx >= 0 && idx + 1 < all.length) return all[idx + 1];
  if (idx >= 0 && idx > 0) return all[idx - 1];
  return null;
}

// ---------------------------------------------------------------------------
// Relationship (must be source→target specific — PRD §13 requirement 3)
// ---------------------------------------------------------------------------

function relationship(sourcePage, targetPage, services) {
  const srcH = [...(sourcePage.headings?.h1 || []), ...(sourcePage.headings?.h2 || []), ...(sourcePage.headings?.h3 || [])].join(" ").toLowerCase();
  const tgtH = [...(targetPage.headings?.h1 || [])].join(" ").toLowerCase();
  const tgtUrl = (targetPage.url || "").toLowerCase();

  // 1) Source content supports a related service page
  for (const svc of services) {
    const s = svc.toLowerCase();
    if (srcH.includes(s) && (tgtUrl.includes(s.replace(/\s+/g, "-")) || tgtUrl.includes(s.replace(/\s+/g, "")) || tgtH.includes(s))) {
      return "source_content_supports_related_service_page";
    }
  }

  // 2) Informational → commercial (source is blog/article/guide, target is service page)
  const srcPath = (sourcePage.url || "").toLowerCase();
  if (/\/blog\/|\/article\/|\/guide\/|\/news\/|\/resources\/|\/learn\//i.test(srcPath)) {
    for (const svc of services) {
      if (tgtUrl.includes(svc.toLowerCase().replace(/\s+/g, "-"))) return "informational_content_progresses_to_commercial_page";
    }
  }

  // 3) Consideration → conversion (source heading mentions service, target is contact/booking)
  if (/\/contact|\/booking|\/quote|\/get-started|\/apply|\/schedule/i.test(tgtUrl)) {
    for (const svc of services) {
      if (srcH.includes(svc.toLowerCase())) return "consideration_content_progresses_to_conversion_page";
    }
    // Source mentions a service in its headings
    for (const svc of services) {
      if (sourcePage.title && sourcePage.title.toLowerCase().includes(svc.toLowerCase())) return "consideration_content_progresses_to_conversion_page";
    }
  }

  // 4) Pages belong to the same verified topic hierarchy
  for (const svc of services) {
    const s = svc.toLowerCase();
    if (srcH.includes(s) && tgtH.includes(s) && sourcePage.url !== targetPage.url) {
      return "pages_belong_to_same_topic_hierarchy";
    }
  }

  // 5) Source content clarifies a referenced topic (shared heading word > 4 chars)
  const srcWords = new Set(srcH.split(/\s+/).filter((w) => w.length > 4));
  const tgtWords = new Set(tgtH.split(/\s+/).filter((w) => w.length > 4));
  const shared = [...srcWords].filter((w) => tgtWords.has(w));
  if (shared.length >= 2) return "source_content_clarifies_referenced_topic";

  // 6) Specific common word — check if there's exactly one shared meaningful word
  if (shared.length === 1) {
    return "generic_topic_mention"; // NOT sufficient
  }

  return null;
}

// ---------------------------------------------------------------------------
// Funnel classification (deterministic only — PRD §13 requirement 6)
// ---------------------------------------------------------------------------

function funnelStage(sourcePage, targetPage, reason) {
  const srcPath = (sourcePage.url || "").toLowerCase();
  const tgtPath = (targetPage.url || "").toLowerCase();

  // Awareness → any blog/article/guide target
  if (/\/blog\/|\/article\/|\/guide\/|\/news\/|\/resources\/|\/learn\//i.test(tgtPath)) return "awareness";

  // Conversion-support → contact/booking
  if (/\/contact|\/booking|\/quote|\/get-started|\/apply|\/schedule|\/appointment/i.test(tgtPath)) return "conversion-support";

  // Decision → pricing
  if (/\/pricing|\/plans|\/cost|\/fee|\/estimate/i.test(tgtPath)) return "decision";

  // Reason-based
  if (reason === "consideration_content_progresses_to_conversion_page" && /contact|booking|quote|get-started/i.test(tgtPath)) return "conversion-support";
  if (reason === "informational_content_progresses_to_commercial_page") return "consideration";
  if (reason === "source_content_supports_related_service_page") return "consideration";
  if (reason === "pages_belong_to_same_topic_hierarchy") return "awareness";
  if (reason === "source_content_clarifies_referenced_topic") return "awareness";

  return null; // cannot determine → exclude from client-facing
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

function confidence(sourcePage, targetPage, reason, services) {
  let s = 0;
  if ((sourcePage.words || 0) > 100) s++;
  if (services.some((sv) => (targetPage.url || "").toLowerCase().includes(sv.toLowerCase().replace(/\s+/g, "-")))) s++;
  const srcH = [...(sourcePage.headings?.h1 || []), ...(sourcePage.headings?.h2 || [])].join(" ").toLowerCase();
  if (services.some((sv) => srcH.includes(sv.toLowerCase()) && (targetPage.title || "").toLowerCase().includes(sv.toLowerCase()))) s++;
  if (targetPage.headings?.h1?.length > 0 && targetPage.title) s++;
  if ((sourcePage.links || []).length >= 5) s++;
  if (s >= 4) return "high";
  if (s >= 2) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Already-linked & link map
// ---------------------------------------------------------------------------

function alreadyLinksTo(page, targetUrl) {
  const tNorm = norm(targetUrl);
  return (page.links || []).some((l) => {
    try { return norm(l.url || "") === tNorm; } catch { return false; }
  });
}

function buildInlinkMap(pages) {
  const map = new Map();
  for (const p of pages) {
    for (const l of (p.links || [])) {
      try {
        const tn = norm(l.url);
        if (tn && tn !== norm(p.url)) map.set(tn, (map.get(tn) || 0) + 1);
      } catch { /* ignore */ }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function generateInternalLinkOpportunities(site, input) {
  const startedAt = new Date().toISOString();
  const pages = site.pages || [];
  const services = site.services || [];
  const limitations = [];

  if (pages.length < 2) {
    return buildEnvelope(SOURCE_STATUS.PARTIAL, [], [], [], [], [], limitations.concat("Fewer than 2 crawlable pages."), { pagesEvaluated: pages.length }, startedAt);
  }

  // ── Filter valid pages ────────────────────────────────────────────────
  const excludedPages = [];
  const valid = [];

  for (const p of pages) {
    if (!p.url) { excludedPages.push({ url: p.url || "(none)", reason: "no_url" }); continue; }
    if (isExternal(p, input.targetUrl)) { excludedPages.push({ url: p.url, reason: "external" }); continue; }

    const st = pageStatusExcluded(p);
    if (st.excluded) { excludedPages.push({ url: p.url, reason: st.reason }); continue; }

    if (isUtility(p)) { excludedPages.push({ url: p.url, reason: "utility_page" }); continue; }
    if (isNonIndexable(p)) { excludedPages.push({ url: p.url, reason: "non_indexable" }); continue; }

    valid.push(p);
  }

  if (valid.length < 2) {
    limitations.push(`Only ${valid.length} valid crawlable page(s) after exclusions — internal-link analysis requires at least 2.`);
    return buildEnvelope(SOURCE_STATUS.PARTIAL, [], [], [], excludedPages, [], limitations, { pagesEvaluated: valid.length, totalPages: pages.length }, startedAt);
  }

  // ── Inlink map (before orphan analysis) ────────────────────────────────
  const inlinkMap = buildInlinkMap(valid);

  // ── Crawl coverage ─────────────────────────────────────────────────────
  const coverageComplete = (site.coverage?.completed || 0) >= (site.coverage?.requested || 0) && (site.pageCount || 0) <= (site.coverage?.completed || 0);

  // ── Generate candidates ───────────────────────────────────────────────
  const opportunities = [];
  const excludedCandidates = [];

  for (const src of valid) {
    for (const tgt of valid) {
      if (src.url === tgt.url) { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "self_link" }); continue; }
      if (alreadyLinksTo(src, tgt.url)) { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "already_linked" }); continue; }

      const rel = relationship(src, tgt, services);
      if (!rel) { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "no_meaningful_relationship" }); continue; }
      if (rel === "generic_topic_mention") { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "generic_topic_mention", detail: "Single shared word — not sufficient for a recommendation" }); continue; }

      const anchor = sourceAnchor(src, services);
      const stage = funnelStage(src, tgt, rel);
      const conf = confidence(src, tgt, rel, services);

      if (!anchor) { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "no_source_anchor", detail: "No valid source-verified anchor text available" }); continue; }
      if (!stage) { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "unknown_funnel_stage", detail: "Funnel stage could not be determined from available evidence" }); continue; }

      const ctx = sourceContext(src, anchor);

      opportunities.push({
        sourceUrl: src.url,
        targetUrl: tgt.url,
        proposedAnchor: anchor,
        relevantSurroundingText: ctx || anchor,
        reasonForLink: rel,
        funnelStage: stage,
        confidence: conf,
        duplicateAnchorWarning: null, // populated after dedup
      });
    }
  }

  // ── Dedup + sort ───────────────────────────────────────────────────────
  const seen = new Set();
  const deduped = [];
  for (const o of opportunities) {
    const k = `${norm(o.sourceUrl)}|${norm(o.targetUrl)}`;
    if (!seen.has(k)) { seen.add(k); deduped.push(o); }
    else { excludedCandidates.push({ sourceUrl: o.sourceUrl, targetUrl: o.targetUrl, reason: "duplicate" }); }
  }
  deduped.sort((a, b) => {
    const c = (CONF_ORDER[a.confidence] ?? 2) - (CONF_ORDER[b.confidence] ?? 2);
    if (c !== 0) return c;
    const su = norm(a.sourceUrl).localeCompare(norm(b.sourceUrl));
    if (su !== 0) return su;
    const tu = norm(a.targetUrl).localeCompare(norm(b.targetUrl));
    if (tu !== 0) return tu;
    return (a.proposedAnchor || "").localeCompare(b.proposedAnchor || "");
  });

  // ── Duplicate anchor detection ────────────────────────────────────────
  const existingAnchors = new Map(); // normWS(anchor) → Set of targetUrls
  for (const p of valid) {
    for (const l of (p.links || [])) {
      const a = normWS(l.text);
      if (a && !isGenAnchor(a)) {
        const s = existingAnchors.get(a) || new Set();
        s.add(norm(l.url));
        existingAnchors.set(a, s);
      }
    }
  }

  const anchorWarnings = [];
  for (const o of deduped) {
    const na = normWS(o.proposedAnchor);
    // Check against existing links
    if (existingAnchors.has(na)) {
      const existingTargets = [...existingAnchors.get(na)];
      if (existingTargets.some((t) => t !== norm(o.targetUrl))) {
        o.duplicateAnchorWarning = `Anchor "${o.proposedAnchor}" is already used for: ${existingTargets.slice(0, 3).join(", ")}`;
        anchorWarnings.push(o.duplicateAnchorWarning);
      }
    }
    // Check against other recommendations
    for (const o2 of deduped) {
      if (o2 === o) continue;
      if (normWS(o2.proposedAnchor) === na && norm(o2.targetUrl) !== norm(o.targetUrl)) {
        if (!o.duplicateAnchorWarning) o.duplicateAnchorWarning = `Anchor collides with recommendation targeting ${o2.targetUrl}`;
        anchorWarnings.push(o.duplicateAnchorWarning);
      }
    }
  }

  // ── Client-facing (high + medium only) ─────────────────────────────────
  const clientFacing = deduped.filter((o) => o.confidence !== "low");

  // ── Orphans (only when coverage is complete) ───────────────────────────
  const orphans = [];
  if (coverageComplete) {
    for (const p of valid) {
      if ((inlinkMap.get(norm(p.url)) || 0) === 0 && !isUtility(p)) {
        orphans.push({ url: p.url, title: p.title || "", incomingLinks: 0 });
      }
    }
  } else {
    limitations.push("Crawl coverage is incomplete — definitive orphan claims cannot be made. Orphan analysis is PARTIAL.");
  }

  const sourceStatus = clientFacing.length > 0 ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.PARTIAL;
  if (!coverageComplete && sourceStatus === SOURCE_STATUS.PARTIAL) {
    limitations.push("Internal-link analysis may be incomplete due to partial crawl coverage.");
  }

  return buildEnvelope(sourceStatus, clientFacing, deduped, orphans, excludedCandidates, deduped.filter((o) => o.confidence === "low"), limitations, {
    pagesEvaluated: valid.length,
    totalPages: pages.length,
    excludedPages: excludedPages.length,
    opportunitiesFound: deduped.length,
    clientFacing: clientFacing.length,
    excluded: excludedCandidates.length,
    orphansDetected: orphans.length,
    crawlComplete: coverageComplete,
  }, startedAt, anchorWarnings);
}

// ---------------------------------------------------------------------------
// Envelope builder
// ---------------------------------------------------------------------------

function buildEnvelope(sourceStatus, clientFacing, all, orphans, excluded, lowConf, limitations, coverage, startedAt, duplicateAnchorWarnings = []) {
  const completedAt = new Date().toISOString();
  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "internal-link-opportunity-module",
    sourceStatus,
    status: sourceStatus,
    opportunities: clientFacing,
    allOpportunities: all,
    orphans,
    excludedCandidates: excluded,
    lowConfidenceCandidates: lowConf,
    duplicateAnchorWarnings: [...new Set(duplicateAnchorWarnings.filter(Boolean))],
    limitations,
    collectedAt: completedAt,
    coverage,
    rawArtifactRef: null,
    _sourceStatus: buildSourceStatus({
      provider: "internal-link-opportunity-module", adapterVersion: "1.0.0",
      startedAt, completedAt, requestId: null, retryCount: 0,
      returnedRecordCount: clientFacing.length,
      expectedRecordCount: coverage.pagesEvaluated * (coverage.pagesEvaluated - 1),
      errorCategory: null, limitation: limitations.length > 0 ? limitations.join("; ") : null, rawArtifactRef: null,
    }),
  };
}

export { isUtility, isGenAnchor, alreadyLinksTo, sourceAnchor, relationship, funnelStage, confidence, isExternal, isNonIndexable, pageStatusExcluded, norm, normWS };

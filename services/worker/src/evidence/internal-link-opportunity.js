/**
 * V3 Internal-Link Opportunity Module (PRD §13)
 */
import { SOURCE_STATUS, buildSourceStatus, EVIDENCE_ENVELOPE_VERSION } from "../scoring/evidence-contracts.js";

const UTIL_PATH = /\/(privacy|terms|cookie|login|cart|account|tag|search|wp-admin|admin|checkout|my-account|basket|signin|signup|register|logout|reset|ajax|api|feed|xmlrpc|trackback|author\/|category\/|\d{4}\/\d{2}\/)/i;
const UTIL_TITLE = /^(privacy|terms|cookie policy|login|cart|account|sign in|sign up|register|checkout|404|search results)/i;
const GENERIC_ANCHOR = /^(click here|learn more|read more|here|more|details|info|link|click|go|visit|view more|continue reading|find out more|discover more|get started|explore)$/i;
const CONF_ORDER = { high: 0, medium: 1, low: 2 };

function norm(s) { return (s || "").replace(/\/$/, "").toLowerCase().trim(); }
function normWS(s) { return (s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
function isGenAnchor(t) { return GENERIC_ANCHOR.test((t || "").trim()); }
function isUtility(p) { return !p || UTIL_PATH.test(p.url || "") || UTIL_TITLE.test(p.title || ""); }

// ── Page validation ─────────────────────────────────────────────────────

function pageStatusExcluded(page) {
  const st = page.status || 200;
  if (st === 301 || st === 302 || st === 307 || st === 308) return { excluded: true, reason: "redirected" };
  if (st === 403 || st === 401) return { excluded: true, reason: "blocked" };
  if (st >= 400) return { excluded: true, reason: "failed" };
  return { excluded: false, reason: null };
}

function isExternal(page, siteUrl) {
  try { return new URL(page.url).hostname.replace(/^www\./, "") !== new URL(siteUrl).hostname.replace(/^www\./, ""); }
  catch { return true; }
}

function isNonIndexable(page) {
  if (page.canonical && page.url && norm(page.canonical) !== norm(page.url)) return true;
  if (page.metaRobots && /noindex/i.test(page.metaRobots)) return true;
  return false;
}

// ── Target-specific relationship (defect 1) ─────────────────────────────

function relationship(sourcePage, targetPage, services) {
  const srcH = [...(sourcePage.headings?.h1 || []), ...(sourcePage.headings?.h2 || []), ...(sourcePage.headings?.h3 || [])].join(" ").toLowerCase();
  const tgtH = [...(targetPage.headings?.h1 || [])].join(" ").toLowerCase();
  const tgtUrl = (targetPage.url || "").toLowerCase();
  const tgtTitle = (targetPage.title || "").toLowerCase();

  // 1) Consideration → conversion: source mentions a service, target is contact/booking
  // (check BEFORE generic service support — contact is a specific conversion target)
  if (/\/contact|\/booking|\/quote|\/get-started|\/apply|\/schedule/i.test(tgtUrl)) {
    for (const svc of services) {
      if (srcH.includes(svc.toLowerCase())) return "consideration_content_progresses_to_conversion_page";
    }
  }

  // 2) Informational → commercial: source is blog/article AND target heading matches source content
  const srcPath = (sourcePage.url || "").toLowerCase();
  if (/\/blog\/|\/article\/|\/guide\/|\/news\/|\/resources\/|\/learn\//i.test(srcPath)) {
    for (const svc of services) {
      if (srcH.includes(svc.toLowerCase()) && (tgtUrl.includes(svc.toLowerCase().replace(/\s+/g, "-")) || tgtH.includes(svc.toLowerCase()))) {
        return "informational_content_progresses_to_commercial_page";
      }
    }
    const tgtWords = new Set(tgtH.split(/\s+/).filter((w) => w.length > 4));
    const srcWords = new Set(srcH.split(/\s+/).filter((w) => w.length > 4));
    const overlap = [...tgtWords].filter((w) => srcWords.has(w));
    if (overlap.length >= 2) return "informational_content_progresses_to_commercial_page";
    if (overlap.length === 1) return "generic_topic_mention";
  }

  // 3) Source content supports a related service page — target-specific
  for (const svc of services) {
    const s = svc.toLowerCase();
    if (srcH.includes(s) && (tgtUrl.includes(s.replace(/\s+/g, "-")) || tgtUrl.includes(s.replace(/\s+/g, "")) || tgtH.includes(s))) {
      return "source_content_supports_related_service_page";
    }
  }

  // 4) Source heading mentions target service by name (target-specific)
  for (const svc of services) {
    if (srcH.includes(svc.toLowerCase()) && tgtH.includes(svc.toLowerCase()) && sourcePage.url !== targetPage.url) {
      return "source_content_references_target_service";
    }
  }

  // 5) Pages belong to the same verified topic hierarchy (≥2 shared meaningful words)
  const srcWords = new Set(srcH.split(/\s+/).filter((w) => w.length > 4));
  const tgtWords = new Set(tgtH.split(/\s+/).filter((w) => w.length > 4));
  const shared = [...srcWords].filter((w) => tgtWords.has(w));
  if (shared.length >= 2) return "pages_belong_to_same_topic_hierarchy";
  if (shared.length === 1) return "generic_topic_mention";

  return null;
}

// ── Target-specific anchor (defect 2) ────────────────────────────────────

function sourceAnchor(sourcePage, targetPage, services) {
  const srcH = [...(sourcePage.headings?.h2 || []), ...(sourcePage.headings?.h3 || []), ...(sourcePage.headings?.h1 || [])];
  const tgtH = [...(targetPage.headings?.h1 || [])].join(" ").toLowerCase();
  const tgtTitle = (targetPage.title || "").toLowerCase();

  // Best: source heading matches a service AND target heading
  for (const svc of services) {
    const svcL = svc.toLowerCase();
    for (const h of srcH) {
      if (h.length >= 3 && h.length <= 80 && !isGenAnchor(h) && h.toLowerCase().includes(svcL)) {
        if (tgtH.includes(svcL) || tgtTitle.includes(svcL)) return h;
        if ((targetPage.url || "").toLowerCase().includes(svcL.replace(/\s+/g, "-"))) return h;
      }
    }
  }

  // Source heading shares ≥2 meaningful words with target heading
  for (const h of srcH) {
    if (h.length < 3 || h.length > 80 || isGenAnchor(h)) continue;
    const hWords = new Set(h.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const tWords = new Set(tgtH.split(/\s+/).filter((w) => w.length > 3));
    const overlap = [...hWords].filter((w) => tWords.has(w));
    if (overlap.length >= 2) return h;
  }

  // Source heading shares 1 meaningful word with target URL path (target-specific)
  for (const h of srcH) {
    if (h.length < 3 || h.length > 80 || isGenAnchor(h)) continue;
    const hWords = h.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const urlWords = (targetPage.url || "").toLowerCase().replace(/[\/-]/g, " ").split(/\s+/).filter((w) => w.length > 3);
    if (hWords.some((w) => urlWords.includes(w))) return h;
  }

  return null;
}

// ── Funnel (defect 5) ────────────────────────────────────────────────────

function funnelStage(sourcePage, targetPage, reason) {
  const tgtPath = (targetPage.url || "").toLowerCase();
  const srcPath = (sourcePage.url || "").toLowerCase();

  if (reason === "consideration_content_progresses_to_conversion_page") return "conversion-support";
  if (reason === "informational_content_progresses_to_commercial_page") return "consideration";
  if (reason === "source_content_supports_related_service_page") return "consideration";
  if (reason === "pages_belong_to_same_topic_hierarchy") return "awareness";
  if (reason === "source_content_references_target_service") return "consideration";

  // URL-based for conversion/decision pages
  if (/\/contact|\/booking|\/quote|\/get-started|\/apply|\/schedule|\/appointment/i.test(tgtPath)) return "conversion-support";
  if (/\/pricing|\/plans|\/cost|\/fee|\/estimate/i.test(tgtPath)) return "decision";
  if (/\/blog\/|\/article\/|\/guide\/|\/news\/|\/resources\/|\/learn\//i.test(tgtPath)) return "awareness";

  return null;
}

// ── Confidence ────────────────────────────────────────────────────────────

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

// ── Already-linked + inlink map ───────────────────────────────────────────

function alreadyLinksTo(page, targetUrl) {
  const tNorm = norm(targetUrl);
  return (page.links || []).some((l) => { try { return norm(l.url || "") === tNorm; } catch { return false; } });
}

function buildInlinkMap(pages) {
  const m = new Map();
  for (const p of pages)
    for (const l of (p.links || []))
      try { const tn = norm(l.url); if (tn && tn !== norm(p.url)) m.set(tn, (m.get(tn) || 0) + 1); } catch { /* ignore */ }
  return m;
}

// ── Source context ────────────────────────────────────────────────────────

function sourceContext(sourcePage, anchor) {
  const all = [...(sourcePage.headings?.h1 || []), ...(sourcePage.headings?.h2 || []), ...(sourcePage.headings?.h3 || [])];
  const idx = all.indexOf(anchor);
  if (idx >= 0 && idx + 1 < all.length) return all[idx + 1];
  if (idx >= 0 && idx > 0) return all[idx - 1];
  return null;
}

// ── Main entry point ──────────────────────────────────────────────────────

export function generateInternalLinkOpportunities(site, input) {
  const startedAt = new Date().toISOString();
  const pages = site.pages || [];
  const services = site.services || [];
  const limitations = [];
  const excludedPages = [];

  if (pages.length < 2) {
    return buildResult(SOURCE_STATUS.PARTIAL, [], [], [], [], [], limitations.concat("Fewer than 2 crawlable pages."), excludedPages, { pagesEvaluated: 0, totalPages: pages.length, crawlComplete: true }, startedAt);
  }

  // ── Filter valid pages ──────────────────────────────────────────────────
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
    limitations.push(`Only ${valid.length} valid crawlable page(s) after exclusions.`);
    return buildResult(SOURCE_STATUS.PARTIAL, [], [], [], [], [], limitations, excludedPages, { pagesEvaluated: valid.length, totalPages: pages.length, crawlComplete: true }, startedAt);
  }

  // ── Crawl coverage (defect 4) ───────────────────────────────────────────
  const coverageComplete = (site.coverage?.completed || 0) >= (site.coverage?.requested || 0) &&
    (site.pageCount || 0) <= (site.coverage?.completed || 0);

  if (!coverageComplete) {
    limitations.push("Crawl coverage is incomplete — definitive orphan claims cannot be made. Internal-link analysis may be incomplete.");
  }

  // ── Inlink map ──────────────────────────────────────────────────────────
  const inlinkMap = buildInlinkMap(valid);

  // ── Generate candidates ─────────────────────────────────────────────────
  const opportunities = [];
  const excludedCandidates = [];

  for (const src of valid) {
    for (const tgt of valid) {
      if (src.url === tgt.url) { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "self_link" }); continue; }
      if (alreadyLinksTo(src, tgt.url)) { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "already_linked" }); continue; }

      const rel = relationship(src, tgt, services);
      if (!rel) { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "no_meaningful_relationship" }); continue; }
      if (rel === "generic_topic_mention") { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "generic_topic_mention", detail: "Single shared word — not sufficient for a recommendation" }); continue; }
      // PRYSM production defect 2 — shared topic words alone are not an
      // implementation-ready relationship.  Topic-hierarchy-only pairs remain
      // available as diagnostic/excluded candidates but never become
      // client-facing recommendations (which require target-specific service,
      // informational→commercial, consideration→conversion, or explicit
      // target-service evidence).
      if (rel === "pages_belong_to_same_topic_hierarchy") { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "topic_hierarchy_only_insufficient", detail: "Shared topic words alone are not implementation-ready evidence" }); continue; }
      // PRYSM production defect 2 (second path) — a heading-only service match
      // against the SITE ROOT must not qualify the homepage as a service
      // target (this produced repetitive "link back to the homepage"
      // recommendations).  Service-target evidence requires a non-root
      // service URL; the homepage has no URL-slug evidence by definition.
      if (norm(tgt.url) === norm(input.targetUrl) && (rel === "source_content_supports_related_service_page" || rel === "source_content_references_target_service" || rel === "informational_content_progresses_to_commercial_page")) {
        excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "homepage_target_insufficient", detail: "Homepage heading match alone is not service-page evidence" });
        continue;
      }

      const anchor = sourceAnchor(src, tgt, services);
      if (!anchor) { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "no_source_anchor", detail: "No target-specific source heading available" }); continue; }

      const stage = funnelStage(src, tgt, rel);
      if (!stage) { excludedCandidates.push({ sourceUrl: src.url, targetUrl: tgt.url, reason: "unknown_funnel_stage" }); continue; }

      const conf = confidence(src, tgt, rel, services);
      const ctx = sourceContext(src, anchor);

      opportunities.push({
        sourceUrl: src.url, targetUrl: tgt.url,
        proposedAnchor: anchor,
        relevantSurroundingText: ctx || anchor,
        reasonForLink: rel, funnelStage: stage, confidence: conf,
        duplicateAnchorWarning: null,
      });
    }
  }

  // ── Dedup + sort (defect 8) ─────────────────────────────────────────────
  const seen = new Set();
  const deduped = [];
  for (const o of opportunities) {
    const k = `${norm(o.sourceUrl)}|${norm(o.targetUrl)}`;
    if (!seen.has(k)) { seen.add(k); deduped.push(o); }
    else { excludedCandidates.push({ sourceUrl: o.sourceUrl, targetUrl: o.targetUrl, reason: "duplicate" }); }
  }
  deduped.sort((a, b) => {
    const c = (CONF_ORDER[a.confidence] ?? 2) - (CONF_ORDER[b.confidence] ?? 2);
    if (c) return c;
    const su = norm(a.sourceUrl).localeCompare(norm(b.sourceUrl));
    if (su) return su;
    const tu = norm(a.targetUrl).localeCompare(norm(b.targetUrl));
    if (tu) return tu;
    return (a.proposedAnchor || "").localeCompare(b.proposedAnchor || "");
  });

  // ── Duplicate anchor detection ──────────────────────────────────────────
  const existingAnchors = new Map();
  for (const p of valid)
    for (const l of (p.links || []))
      if (l.text && !isGenAnchor(l.text)) {
        const a = normWS(l.text);
        if (a) { const s = existingAnchors.get(a) || new Set(); s.add(norm(l.url)); existingAnchors.set(a, s); }
      }
  const anchorWarnings = [];
  for (const o of deduped) {
    const na = normWS(o.proposedAnchor);
    if (existingAnchors.has(na)) {
      const exist = [...existingAnchors.get(na)].filter((t) => t !== norm(o.targetUrl));
      if (exist.length) { o.duplicateAnchorWarning = `Anchor already used for: ${exist.slice(0, 3).join(", ")}`; anchorWarnings.push(o.duplicateAnchorWarning); }
    }
    for (const o2 of deduped) {
      if (o2 === o) continue;
      if (normWS(o2.proposedAnchor) === na && norm(o2.targetUrl) !== norm(o.targetUrl)) {
        if (!o.duplicateAnchorWarning) o.duplicateAnchorWarning = `Collides with recommendation for ${o2.targetUrl}`;
        anchorWarnings.push(o.duplicateAnchorWarning);
      }
    }
  }

  // ── Client-facing (high + medium only) ───────────────────────────────────
  const clientFacing = deduped.filter((o) => o.confidence !== "low");

  // ── Orphans (only when coverage complete) ───────────────────────────────
  const orphans = [];
  if (coverageComplete) {
    for (const p of valid)
      if ((inlinkMap.get(norm(p.url)) || 0) === 0 && !isUtility(p))
        orphans.push({ url: p.url, title: p.title || "", incomingLinks: 0 });
  }

  const sourceStatus = (!coverageComplete) ? SOURCE_STATUS.PARTIAL :
    clientFacing.length > 0 ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.PARTIAL;

  return buildResult(sourceStatus, clientFacing, deduped, orphans, excludedCandidates, deduped.filter((o) => o.confidence === "low"), limitations, excludedPages, {
    pagesEvaluated: valid.length, totalPages: pages.length,
    excludedPages: excludedPages.length,
    opportunitiesFound: deduped.length, clientFacing: clientFacing.length,
    excludedCandidates: excludedCandidates.length, orphansDetected: orphans.length,
    crawlComplete: coverageComplete,
  }, startedAt, anchorWarnings);
}

// ── Envelope builder (defect 3) ───────────────────────────────────────────

function buildResult(sourceStatus, clientFacing, all, orphans, excludedCandidates, lowConf, limitations, excludedPages, coverage, startedAt, dupWarnings = []) {
  const ct = new Date().toISOString();
  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "internal-link-opportunity-module",
    sourceStatus,
    status: sourceStatus,
    opportunities: clientFacing,
    allOpportunities: all,
    orphans,
    excludedCandidates,
    excludedPages,
    lowConfidenceCandidates: lowConf,
    duplicateAnchorWarnings: [...new Set(dupWarnings.filter(Boolean))],
    limitations,
    collectedAt: ct,
    coverage,
    rawArtifactRef: null,
    _sourceStatus: buildSourceStatus({
      provider: "internal-link-opportunity-module", adapterVersion: "1.0.0",
      startedAt, completedAt: ct, requestId: null, retryCount: 0,
      returnedRecordCount: clientFacing.length,
      expectedRecordCount: coverage.pagesEvaluated * (coverage.pagesEvaluated - 1),
      errorCategory: null, limitation: limitations.join("; ") || null, rawArtifactRef: null,
    }),
  };
}

export { isUtility, isGenAnchor, alreadyLinksTo, sourceAnchor, relationship, funnelStage, confidence, isExternal, isNonIndexable, pageStatusExcluded, norm, normWS };

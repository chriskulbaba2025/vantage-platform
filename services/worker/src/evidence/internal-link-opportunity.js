/**
 * V3 Internal-Link Opportunity Module (PRD §13)
 *
 * Generates implementation-ready internal-link recommendations from
 * crawled page evidence. Every recommendation is traceable to source
 * and target page content.
 *
 * Excluded: navigation-only, footer, utility, self-links, already-linked,
 * generic topic mentions.
 *
 * Confidence: high/medium/low. Low-confidence = excluded from client output.
 * Duplicate anchor warnings when the same anchor targets different pages.
 */

import { SOURCE_STATUS, buildSourceStatus, EVIDENCE_ENVELOPE_VERSION } from "../scoring/evidence-contracts.js";
import { domainOf } from "../utils.js";

// ---------------------------------------------------------------------------
// Exclusion patterns
// ---------------------------------------------------------------------------

const UTILITY_PATH_RE = /\/(privacy|terms|cookie|login|cart|account|tag|search|wp-admin|admin|checkout|my-account|basket|signin|signup|register|logout|reset|ajax|api|feed|xmlrpc|trackback|author\/|category\/|\d{4}\/\d{2}\/)/i;
const UTILITY_TITLE_RE = /^(privacy|terms|cookie policy|login|cart|account|sign in|sign up|register|checkout|404|search results)/i;
const GENERIC_ANCHOR_RE = /^(click here|learn more|read more|here|more|details|info|link|click|go|visit|view more|continue reading|find out more|discover more|get started|explore)$/i;

function isUtilityPage(page) {
  if (!page) return true;
  if (UTILITY_PATH_RE.test(page.url || "")) return true;
  if (UTILITY_TITLE_RE.test(page.title || "")) return true;
  return false;
}

function isGenericAnchor(text) {
  return GENERIC_ANCHOR_RE.test((text || "").trim());
}

// ---------------------------------------------------------------------------
// Funnel stage classification
// ---------------------------------------------------------------------------

const FUNNEL_STAGES = ["awareness", "consideration", "decision", "conversion-support"];

function classifyFunnelStage(sourcePage, targetPage, services) {
  const tgtUrl = (targetPage.url || "").toLowerCase();
  const tgtTitle = (targetPage.title || "").toLowerCase();
  const srcHeadings = (sourcePage.headings?.h1 || []).concat(sourcePage.headings?.h2 || []).join(" ").toLowerCase();

  // Pages with booking/contact/signup → conversion-support
  if (/contact|booking|quote|get-started|apply|sign.?up|schedule|appointment|consultation/i.test(tgtUrl)) return "conversion-support";
  // Pages with pricing/cost → decision
  if (/pricing|plans|cost|fee|estimate|packages/i.test(tgtUrl) || /pricing|plans|cost/i.test(tgtTitle)) return "decision";
  // Service pages → consideration
  if (services.some((s) => tgtUrl.includes(s.toLowerCase().replace(/\s+/g, "-")) || tgtUrl.includes(s.toLowerCase().replace(/\s+/g, "")))) return "consideration";
  if (services.some((s) => tgtTitle.includes(s.toLowerCase()))) return "consideration";
  // Blog/article/guide → awareness
  if (/blog|article|news|guide|how-to|what-is|resources|learn/i.test(tgtUrl)) return "awareness";
  // About/team → awareness
  if (/about|team|story|who-we-are/i.test(tgtUrl)) return "awareness";
  // Homepage or service headings → consideration
  if (srcHeadings.length > 0 && services.some((s) => srcHeadings.includes(s.toLowerCase()))) return "consideration";

  return "consideration"; // default
}

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

function computeConfidence(sourcePage, targetPage, reason, services) {
  let score = 0;

  // Source has meaningful body text (+1)
  if ((sourcePage.words || 0) > 100) score++;
  // Target is a known service page (+1)
  if (services.some((s) => (targetPage.url || "").toLowerCase().includes(s.toLowerCase().replace(/\s+/g, "-")))) score++;
  // Source headings match target topic (+1)
  const srcText = ((sourcePage.headings?.h1 || []).concat(sourcePage.headings?.h2 || [])).join(" ").toLowerCase();
  const tgtTitle = (targetPage.title || "").toLowerCase();
  if (services.some((s) => srcText.includes(s.toLowerCase()) && tgtTitle.includes(s.toLowerCase()))) score++;
  // Clear page intent (+1)
  if (targetPage.headings?.h1?.length > 0 && targetPage.title) score++;
  // Well-linked source page (+1)
  if ((sourcePage.links || []).length >= 5) score++;

  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Anchor extraction
// ---------------------------------------------------------------------------

function extractAnchor(sourcePage, targetPage, services) {
  const headings = (sourcePage.headings?.h2 || []).concat(sourcePage.headings?.h3 || []);

  // Try to find a heading that mentions a service related to the target
  for (const svc of services) {
    const match = headings.find((h) => h.toLowerCase().includes(svc.toLowerCase()));
    if (match && match.length >= 3 && match.length <= 80 && !isGenericAnchor(match)) {
      return match;
    }
  }

  // Use target page title if clean
  const tgtTitle = (targetPage.title || "").trim();
  if (tgtTitle && tgtTitle.length >= 3 && tgtTitle.length <= 80 && !isGenericAnchor(tgtTitle)) {
    return tgtTitle;
  }

  // Fall back to first meaningful heading
  const firstHeading = headings.find((h) => h.length >= 3 && h.length <= 80 && !isGenericAnchor(h));
  return firstHeading || "Related information";
}

// ---------------------------------------------------------------------------
// Surrounding text
// ---------------------------------------------------------------------------

function extractSurroundingText(sourcePage, anchor) {
  // Return relevant heading context
  const allHeadings = (sourcePage.headings?.h1 || [])
    .concat(sourcePage.headings?.h2 || [])
    .concat(sourcePage.headings?.h3 || []);
  const idx = allHeadings.findIndex((h) => h === anchor);
  if (idx >= 0 && idx + 1 < allHeadings.length) {
    return `${anchor} — ${allHeadings[idx + 1]}`;
  }
  return anchor;
}

// ---------------------------------------------------------------------------
// Already-linked check
// ---------------------------------------------------------------------------

function alreadyLinksTo(sourcePage, targetUrl) {
  const normalized = targetUrl.replace(/\/$/, "").toLowerCase();
  return (sourcePage.links || []).some((l) => {
    try {
      return (l.url || "").replace(/\/$/, "").toLowerCase() === normalized;
    } catch { return false; }
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate internal-link recommendations from crawl evidence.
 *
 * @param {object} site    Crawl site evidence (with pages array)
 * @param {object} input   Validated audit input
 * @returns {object} internal-link evidence envelope
 */
export function generateInternalLinkOpportunities(site, input) {
  const startedAt = new Date().toISOString();
  const pages = site.pages || [];
  const domain = site.domain || domainOf(input.targetUrl);
  const services = site.services || [];
  const limitations = [];

  if (pages.length < 2) {
    return {
      evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
      source: "internal-link-opportunity-module",
      sourceStatus: SOURCE_STATUS.PARTIAL,
      status: SOURCE_STATUS.PARTIAL,
      opportunities: [],
      excluded: [],
      evaluatedPageCount: pages.length,
      limitations: ["Insufficient page evidence — fewer than 2 crawlable pages. Internal-link analysis requires at least 2 pages."],
      collectedAt: new Date().toISOString(),
      coverage: { pagesEvaluated: pages.length, opportunitiesFound: 0, excluded: 0 },
      rawArtifactRef: null,
      _sourceStatus: buildSourceStatus({
        provider: "internal-link-opportunity-module", adapterVersion: "1.0.0",
        startedAt, completedAt: new Date().toISOString(), requestId: null, retryCount: 0,
        returnedRecordCount: 0, expectedRecordCount: null,
        errorCategory: null,
        limitation: "Fewer than 2 crawlable pages — internal-link analysis skipped.",
        rawArtifactRef: null,
      }),
    };
  }

  const opportunities = [];
  const excluded = [];
  let duplicateAnchorWarnings = [];

  // Filter to valid source/target pages (non-utility, crawled successfully)
  const validPages = pages.filter((p) => !isUtilityPage(p) && p.url);

  // Build page index for target checks
  const pageUrls = new Set(validPages.map((p) => p.url.replace(/\/$/, "").toLowerCase()));

  // Build existing link map for duplicate anchor detection
  const anchorUsage = new Map(); // anchor → [targetUrl, ...]
  for (const page of validPages) {
    for (const link of (page.links || [])) {
      const text = (link.text || "").trim();
      if (text && !isGenericAnchor(text)) {
        const targets = anchorUsage.get(text) || [];
        if (!targets.includes(link.url)) targets.push(link.url);
        anchorUsage.set(text, targets);
      }
    }
  }

  // Generate candidate recommendations
  for (const sourcePage of validPages) {
    for (const targetPage of validPages) {
      if (sourcePage.url === targetPage.url) continue; // No self-links

      const srcNorm = sourcePage.url.replace(/\/$/, "").toLowerCase();
      const tgtNorm = targetPage.url.replace(/\/$/, "").toLowerCase();

      // Already linked?
      if (alreadyLinksTo(sourcePage, targetPage.url)) {
        excluded.push({
          sourceUrl: sourcePage.url, targetUrl: targetPage.url,
          reason: "already_linked", detail: "Source page already links to target page",
        });
        continue;
      }

      // Determine reason for link
      const reason = determineReason(sourcePage, targetPage, services, domain);

      // Generic topic mention → exclude
      if (reason === "generic_topic_mention") {
        excluded.push({
          sourceUrl: sourcePage.url, targetUrl: targetPage.url,
          reason: "generic_topic_mention", detail: "Relationship does not exceed a shared generic word",
        });
        continue;
      }

      if (!reason) {
        excluded.push({
          sourceUrl: sourcePage.url, targetUrl: targetPage.url,
          reason: "no_meaningful_relationship", detail: "No contextual or structural relationship detected",
        });
        continue;
      }

      const anchor = extractAnchor(sourcePage, targetPage, services);
      const funnelStage = classifyFunnelStage(sourcePage, targetPage, services);
      const confidence = computeConfidence(sourcePage, targetPage, reason, services);

      // Duplicate anchor check
      const existingTargets = anchorUsage.get(anchor) || [];
      const duplicateAnchorWarning = existingTargets.length > 0
        ? `Anchor "${anchor}" is already used for: ${existingTargets.slice(0, 3).join(", ")}`
        : null;

      opportunities.push({
        sourceUrl: sourcePage.url,
        targetUrl: targetPage.url,
        proposedAnchor: anchor,
        relevantSurroundingText: extractSurroundingText(sourcePage, anchor),
        reasonForLink: reason,
        funnelStage,
        confidence,
        duplicateAnchorWarning,
      });
    }
  }

  // Deduplicate: same source-target pair
  const seen = new Set();
  const deduped = [];
  for (const opp of opportunities) {
    const key = `${opp.sourceUrl}|${opp.targetUrl}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(opp);
    } else {
      excluded.push({ sourceUrl: opp.sourceUrl, targetUrl: opp.targetUrl, reason: "duplicate", detail: "Duplicate source-target recommendation removed" });
    }
  }

  // Sort: high confidence first, then medium
  const sorted = deduped.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 };
    return (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2);
  });

  // Client-facing: high + medium only
  const clientFacing = sorted.filter((o) => o.confidence !== "low");

  // Orphan/weakly-linked page detection
  const linkedFrom = new Map();
  for (const page of validPages) {
    for (const link of (page.links || [])) {
      try {
        const norm = link.url.replace(/\/$/, "").toLowerCase();
        if (pageUrls.has(norm) && norm !== page.url.replace(/\/$/, "").toLowerCase()) {
          linkedFrom.set(norm, (linkedFrom.get(norm) || 0) + 1);
        }
      } catch { /* ignore */ }
    }
  }

  const orphans = validPages
    .filter((p) => !linkedFrom.has(p.url.replace(/\/$/, "").toLowerCase()))
    .filter((p) => !isUtilityPage(p))
    .map((p) => ({ url: p.url, title: p.title || "", incomingLinks: 0 }));

  if (pages.length < site.pageCount && site.coverage?.completed < site.coverage?.requested) {
    limitations.push("Crawl coverage is incomplete — some pages may be missing. Orphan analysis is PARTIAL; definitive orphan claims cannot be made.");
  }

  const completedAt = new Date().toISOString();

  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "internal-link-opportunity-module",
    sourceStatus: clientFacing.length > 0 ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.PARTIAL,
    status: clientFacing.length > 0 ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.PARTIAL,
    opportunities: clientFacing,
    allOpportunities: sorted,
    excludedCandidates: excluded,
    orphans,
    evaluatedPageCount: validPages.length,
    totalCrawledPages: pages.length,
    duplicateAnchorWarnings: [...new Set(duplicateAnchorWarnings.filter(Boolean))],
    limitations,
    collectedAt: completedAt,
    coverage: {
      pagesEvaluated: validPages.length,
      totalPages: pages.length,
      opportunitiesFound: sorted.length,
      clientFacing: clientFacing.length,
      excluded: excluded.length,
      orphansDetected: orphans.length,
    },
    rawArtifactRef: null,
    _sourceStatus: buildSourceStatus({
      provider: "internal-link-opportunity-module",
      adapterVersion: "1.0.0",
      startedAt,
      completedAt,
      requestId: null,
      retryCount: 0,
      returnedRecordCount: clientFacing.length,
      expectedRecordCount: validPages.length * (validPages.length - 1),
      errorCategory: null,
      limitation: limitations.length > 0 ? limitations.join("; ") : null,
      rawArtifactRef: null,
    }),
  };
}

// ---------------------------------------------------------------------------
// Reason determination
// ---------------------------------------------------------------------------

function determineReason(sourcePage, targetPage, services, domain) {
  const srcText = ((sourcePage.headings?.h1 || []).concat(sourcePage.headings?.h2 || []).concat(sourcePage.headings?.h3 || [])).join(" ").toLowerCase();
  const tgtUrl = (targetPage.url || "").toLowerCase();
  const tgtTitle = (targetPage.title || "").toLowerCase();

  // Service relationship
  for (const svc of services) {
    const svcLower = svc.toLowerCase();
    if (srcText.includes(svcLower) && (tgtUrl.includes(svcLower.replace(/\s+/g, "-")) || tgtUrl.includes(svcLower.replace(/\s+/g, "")) || tgtTitle.includes(svcLower))) {
      return "source_content_supports_related_service_page";
    }
  }

  // Awareness → consideration progression
  const srcIsAwareness = /blog|article|news|guide|resources|learn/i.test(sourcePage.url || "");
  if (srcIsAwareness && services.some((s) => tgtUrl.includes(s.toLowerCase().replace(/\s+/g, "-")))) {
    return "informational_content_progresses_to_commercial_page";
  }

  // Consideration → decision (has pricing/contact)
  if (/pricing|contact|booking|quote|get-started/i.test(tgtUrl) && srcText.length > 0) {
    return "consideration_content_progresses_to_conversion_page";
  }

  // Same topic hierarchy
  for (const svc of services) {
    const svcLower = svc.toLowerCase();
    if (srcText.includes(svcLower) && tgtTitle.includes(svcLower)) {
      return "pages_belong_to_same_topic_hierarchy";
    }
  }

  // Referenced service or concept
  for (const svc of services) {
    if (srcText.includes(svc.toLowerCase())) {
      return "source_content_references_target_service";
    }
  }

  // Check for heading overlap (weaker signal)
  const srcHeadings = new Set((sourcePage.headings?.h1 || []).concat(sourcePage.headings?.h2 || []).map((h) => h.toLowerCase()));
  const tgtHeadings = new Set((targetPage.headings?.h1 || []).map((h) => h.toLowerCase()));
  const overlap = [...srcHeadings].filter((h) => [...tgtHeadings].some((th) => h.includes(th) || th.includes(h)));
  if (overlap.length > 0) return "pages_belong_to_same_topic_hierarchy";

  // High-value page has no incoming internal links (orphan recovery)
  const isImportantPage = /service|product|contact|about|pricing/i.test(tgtUrl);
  if (isImportantPage && srcText.length > 0) {
    return "high_value_page_is_weakly_linked";
  }

  // Check if source mentions a word that matches a target heading
  const srcWords = new Set(srcText.split(/\s+/));
  for (const h of (targetPage.headings?.h1 || [])) {
    const hWords = h.toLowerCase().split(/\s+/);
    if (hWords.some((w) => w.length > 4 && srcWords.has(w))) {
      return "source_content_clarifies_referenced_topic";
    }
  }

  return null;
}

export { isUtilityPage, isGenericAnchor, classifyFunnelStage, alreadyLinksTo };

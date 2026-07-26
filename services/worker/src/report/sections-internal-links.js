import { e, severityClass, table } from "./html-helpers.js";

/**
 * Internal-Link Opportunities section — PRD v3.0 §13, §17.2 §13.
 *
 * Generates implementation-ready internal-link recommendations from
 * crawl-visible evidence.
 */
export function internalLinks(model) {
  const site = model.evidence.site;
  const brokenCount = site.brokenInternalLinks?.length || 0;
  const totalLinks = site.internalLinkCount || 0;

  // Build link-opportunity rows from crawl evidence
  const opportunities = [];

  // Broken links are high priority
  for (const broken of (site.brokenInternalLinks || []).slice(0, 10)) {
    opportunities.push({
      source: broken.source || "unknown",
      target: broken.url || broken.target || "unknown",
      anchor: "—",
      reason: "Broken internal link — returns error status",
      funnel: "—",
      confidence: "Deterministic",
      priority: "H",
    });
  }

  // Orphan-recovery signals: pages with low inlink count
  for (const page of (site.pages || []).slice(0, 5)) {
    const inlinks = page.internalInlinks ?? page.inlinkCount ?? 0;
    if (inlinks === 0 && page.url) {
      opportunities.push({
        source: site.domain,
        target: page.url,
        anchor: page.title || page.url,
        reason: "Potential orphan — no detected internal inlinks",
        funnel: "Contextual discovery",
        confidence: "Supported",
        priority: "M",
      });
    }
  }

  // Service-to-service contextual linking
  const services = site.services || [];
  for (let i = 0; i < Math.min(services.length, 4); i++) {
    for (let j = i + 1; j < Math.min(services.length, 4); j++) {
      if (services[i] && services[j]) {
        opportunities.push({
          source: `${services[i]} page`,
          target: `${services[j]} page`,
          anchor: services[j],
          reason: "Cross-link related services for topic hierarchy",
          funnel: "Consideration",
          confidence: "Directional",
          priority: "M",
        });
      }
    }
  }

  const oppSlice = opportunities.slice(0, 20);

  const body = oppSlice.length
    ? table(
        ["Source", "Target", "Proposed Anchor", "Reason", "Funnel Stage", "Confidence", "Pri"],
        oppSlice.map((o) => [
          e(o.source),
          e(o.target),
          e(o.anchor),
          e(o.reason),
          e(o.funnel),
          e(o.confidence),
          `<span class="${severityClass(o.priority)}">${e(o.priority)}</span>`,
        ]),
      )
    : `<p>No internal-link opportunities were identified from crawl evidence.</p>`;

  return `<section id="internal-link-opportunities">
<h2><span class="sec-num">13 /</span> Internal-Link Opportunities</h2>
<p style="font-size:.85rem;color:var(--muted);margin-bottom:16px">Implementation-ready link recommendations to improve topic hierarchy, service discovery, and conversion progression. Generated from crawl-visible evidence only.</p>
<div class="note"><strong>Summary:</strong> ${e(totalLinks)} total internal links detected. ${e(brokenCount)} broken. ${e(oppSlice.length)} opportunity(s) identified.</div>
${body}
<p style="font-size:.8rem;color:var(--muted);margin-top:12px">Recommendations are directional. Verify page existence and relevance before implementing. Anchor text should use natural, descriptive language — not keyword repetition.</p>
</section>`;
}

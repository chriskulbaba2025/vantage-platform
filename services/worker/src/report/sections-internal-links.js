import { e, section, table } from "./html-helpers.js";

function formatReason(reason) {
  const map = {
    source_content_supports_related_service_page: "Content supports related service",
    informational_content_progresses_to_commercial_page: "Info content → commercial",
    consideration_content_progresses_to_conversion_page: "Consideration → conversion",
    pages_belong_to_same_topic_hierarchy: "Same topic hierarchy",
    source_content_references_target_service: "References target service",
    source_content_clarifies_referenced_topic: "Clarifies referenced topic",
    high_value_page_is_weakly_linked: "High-value page weakly linked",
  };
  return map[reason] || reason;
}

export function internalLinks(model) {
  const opp = model.evidence?.internalLinkOpportunities;

  if (!opp) {
    return section("internal-link-opportunities", "13", "Internal-Link Opportunities",
      '<div class="note"><strong>Not available:</strong> Internal-link opportunities were not computed for this audit.</div>');
  }

  const opportunities = opp.opportunities || [];
  const allOpps = opp.allOpportunities || [];
  const lowConf = allOpps.filter((o) => o.confidence === "low");
  const excluded = opp.excludedCandidates || [];
  const orphans = opp.orphans || [];
  const limitations = opp.limitations || [];

  // Also show broken internal links from crawl evidence
  const brokenLinks = model.evidence.site.brokenInternalLinks || [];
  const totalLinks = model.evidence.site.internalLinkCount || 0;

  const recSection = opportunities.length > 0
    ? `<h3>Implementation-Ready Recommendations (${opportunities.length})</h3>
<p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">High- and medium-confidence recommendations traceable to crawled source and target page content.</p>
${table(
  ["Source", "Target", "Anchor", "Context", "Reason", "Stage", "Conf", "Warning"],
  opportunities.slice(0, 25).map((o) => [
    `<a href="${e(o.sourceUrl)}" target="_blank" rel="noopener">${e((o.sourceUrl || "").replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 40))}</a>`,
    `<a href="${e(o.targetUrl)}" target="_blank" rel="noopener">${e((o.targetUrl || "").replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 40))}</a>`,
    e(o.proposedAnchor),
    e((o.relevantSurroundingText || "").slice(0, 70)),
    e(formatReason(o.reasonForLink)),
    e(o.funnelStage),
    `<span class="${o.confidence === "high" ? "path-clear" : "path-weak"}">${e(o.confidence)}</span>`,
    o.duplicateAnchorWarning ? `<span style="color:var(--orange,#c7521a)" title="${e(o.duplicateAnchorWarning)}">⚠</span>` : "—",
  ]),
)}`
    : '<div class="note"><strong>No implementation-ready recommendations:</strong> No high- or medium-confidence opportunities were identified from crawl evidence.</div>';

  const brokenSection = brokenLinks.length > 0
    ? `<h3>Broken Internal Links (${brokenLinks.length})</h3>
${table(["Source", "Target"], brokenLinks.slice(0, 10).map((b) => [e(b.source || "unknown"), e(b.url || b.target || "unknown")]))}`
    : "";

  const lowSection = lowConf.length > 0
    ? `<h3>Low-Confidence Candidates (${lowConf.length} — Auditor Review)</h3>${table(["Source", "Target", "Anchor", "Reason"], lowConf.slice(0, 10).map((o) => [e((o.sourceUrl || "").slice(0, 50)), e((o.targetUrl || "").slice(0, 50)), e(o.proposedAnchor), e(formatReason(o.reasonForLink))]))}`
    : "";

  const orphanSection = orphans.length > 0
    ? `<h3>Orphan / Weakly Linked Pages (${orphans.length})</h3>
<p style="font-size:.8rem;color:var(--muted)">${opp.coverage?.totalPages < opp.coverage?.pagesEvaluated ? "<strong>Crawl coverage incomplete — definitive orphan claims cannot be made.</strong>" : ""}</p>
${table(["URL", "Title"], orphans.slice(0, 15).map((o) => [e((o.url || "").slice(0, 60)), e(o.title || "—")]))}`
    : "";

  const stats = `<p style="font-size:.8rem;color:var(--muted);margin-top:12px"><strong>Summary:</strong> ${e(totalLinks)} total internal links, ${e(brokenLinks.length)} broken. ${e(opp.coverage?.pagesEvaluated || 0)} pages evaluated. ${e(opportunities.length)} recommendations, ${e(excluded.length)} excluded, ${e(lowConf.length)} low-confidence, ${e(orphans.length)} orphan(s).</p>`;

  return section("internal-link-opportunities", "13", "Internal-Link Opportunities",
    `${stats}${recSection}${brokenSection}${lowSection}${orphanSection}${limitations.length ? `<h3>Limitations</h3><ul>${limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : ""}`);
}

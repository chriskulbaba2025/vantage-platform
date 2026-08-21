/**
 * PRYSM-NEXT-01 WP-G — Report Design v2 renderer.
 *
 * Report content/data contract remains v2.0.0. PRYSM-V2-SECTION-VIEWER-01
 * versions the presentation layer as 2.1.0: the same governed index.html
 * artifact is presented as 15 conceptual pages with left navigation and
 * current-page browser printing. No evidence, scoring, lifecycle, storage,
 * route, or report-artifact contract is changed here.
 */

import { REPORT_DESIGN_V2 } from "./report-design.js";
import { computePillars } from "./v2-pillars.js";
import { ACTION_CLASS, buildActionPlan } from "./action-priority.js";
import { buildFoundationChecklist } from "./foundation-readiness.js";
import {
  foundationSection,
  eeatSection,
  technicalDetailSection,
  headingSection,
  schemaSection,
  performanceDetailSection,
  machineReadinessSection,
  strengthsSection,
  actionPlanSection,
  phase2Section,
} from "./report-detail-sections.js";

export const REPORT_V2_VIEWER_VERSION = "2.1.0";

export const REPORT_V2_VIEWER_PAGES = Object.freeze([
  Object.freeze({ pageId: "executive-scorecard", title: "Executive Scorecard", sectionIds: Object.freeze(["executive", "strengths"]) }),
  Object.freeze({ pageId: "priority-fixes", title: "Priority Fixes", sectionIds: Object.freeze(["blockers", "foundations", "action-plan"]) }),
  Object.freeze({ pageId: "conversion-paths", title: "Conversion Path Architecture", sectionIds: Object.freeze(["paths"]) }),
  Object.freeze({ pageId: "readiness-map", title: "Conversion Readiness Map", sectionIds: Object.freeze(["pillars"]) }),
  Object.freeze({ pageId: "content-ideas", title: "Topical Map & Qualified Content Opportunities", sectionIds: Object.freeze(["content-ideas"]) }),
  Object.freeze({ pageId: "competitor-benchmark", title: "Competitor Benchmark", sectionIds: Object.freeze(["competitors"]) }),
  Object.freeze({ pageId: "trust-eeat", title: "Trust & E-E-A-T Readiness", sectionIds: Object.freeze(["eeat"]) }),
  Object.freeze({ pageId: "cms-constraints", title: "CMS & Platform Constraints", sectionIds: Object.freeze(["cms"]) }),
  Object.freeze({ pageId: "technical-seo", title: "Technical SEO Hygiene", sectionIds: Object.freeze(["technical"]) }),
  Object.freeze({ pageId: "headings", title: "Heading & Semantic Structure", sectionIds: Object.freeze(["headings"]) }),
  Object.freeze({ pageId: "schema", title: "Schema & Entity Clarity", sectionIds: Object.freeze(["schema", "machine-readiness"]) }),
  Object.freeze({ pageId: "performance", title: "Performance", sectionIds: Object.freeze(["performance"]) }),
  Object.freeze({ pageId: "internal-links", title: "Internal-Link Opportunities", sectionIds: Object.freeze(["internal-links"]) }),
  Object.freeze({ pageId: "evidence-appendix", title: "Evidence Appendix", sectionIds: Object.freeze(["evidence"]) }),
  Object.freeze({ pageId: "deferred", title: "Deferred & Unavailable Analysis", sectionIds: Object.freeze(["phase2"]) }),
]);

function e(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bandChip(band) {
  const cls = {
    Strong: "band-strong",
    Moderate: "band-moderate",
    Limited: "band-limited",
    Weak: "band-weak",
    High: "band-strong",
    Directional: "band-weak",
  }[band] || "band-moderate";
  return `<span class="chip ${cls}">${e(band)}</span>`;
}

function impactCategory(finding) {
  if (finding.severity === "High") return "High impact";
  if (finding.severity === "Medium") return "Medium impact";
  return "Low impact";
}

const EFFORT_LABEL = { H: "High effort", M: "Medium effort", L: "Low effort" };

function capabilityStatusClass(status) {
  if (status === "AVAILABLE") return "cap-ok";
  if (status === "PARTIAL") return "cap-partial";
  if (status === "FAILED") return "cap-missing";
  return "cap-neutral";
}

function executiveScorecard(model, pillars) {
  const readiness = model.scores.conversionReadiness;
  const readinessLine =
    readiness === null
      ? `<div class="readiness-none">${e(model.readinessStatus || "Insufficient Evidence for Overall Score")}</div>`
      : `<div class="readiness">${e(readiness)}<span class="readiness-max">/100</span></div>
         <div class="readiness-band">${bandChip(model.bands.conversionReadiness)}</div>`;

  const confidence = model.evidenceConfidenceScore;
  const availability = model.evidenceConfidenceFactorAvailability || [];
  const unknownFactors = availability.filter((f) => f.available === false).map((f) => f.factor);
  const knownFactors = availability.filter((f) => f.available === true).map((f) => f.factor);
  const capSummary = model.capabilityEvidence?.summary || { total: 0, assessed: 0 };
  const assessedCapabilities = `${capSummary.assessed ?? 0} of ${capSummary.total ?? 0} evidence capabilities`;

  return `
  <section id="executive" class="card">
    <div class="grid-3">
      <div>
        <h2>A. Conversion Readiness</h2>
        ${readinessLine}
        <p class="muted">${e(model.readinessStatusDetail || model.readinessStatus || "")}</p>
        <p class="muted">Assessed weight: ${e(model.assessedWeight)}% of intended dimensions</p>
      </div>
      <div>
        <h2>B. Evidence Confidence</h2>
        <div class="confidence">${e(confidence)}<span class="readiness-max">/100</span></div>
        ${bandChip(model.bands.evidenceConfidence)}
        <p class="muted">Known factors: ${e(knownFactors.length)} · Unknown (excluded): ${e(unknownFactors.length)}</p>
        ${unknownFactors.length ? `<p class="muted small">Unknown: ${e(unknownFactors.join(", "))}</p>` : ""}
      </div>
      <div>
        <h2>C. Evidence Coverage</h2>
        <div class="coverage">${e(model.assessedWeight)}<span class="readiness-max">%</span></div>
        <p class="muted">${e(assessedCapabilities)}</p>
        <p class="muted">Modules assessed: ${Object.values(model.moduleScores || {}).filter((m) => m?.score !== null && m?.score !== undefined).length} of ${Object.values(model.moduleScores || {}).length}</p>
      </div>
    </div>
  </section>`;
}

function pillarSection(pillars) {
  const cards = pillars.map((p) => {
    const scoreHtml = p.score === null
      ? `<div class="pillar-score none">Not Assessed</div>`
      : `<div class="pillar-score">${e(p.score)}<span class="readiness-max">/100</span></div>`;
    const modules = p.modules
      .map((m) => `<li>${e(m.moduleId)}: ${m.score === null ? "suppressed" : e(m.score)} (weight ${e(m.weight)})</li>`)
      .join("");
    const caps = p.capabilities
      .map((c) => `<span class="chip ${capabilityStatusClass(c.status)}">${e(c.key)}: ${e(c.status)}</span>`)
      .join(" ");
    return `
      <div class="pillar">
        <h3>${e(p.label)}</h3>
        ${scoreHtml}
        <ul class="pillar-modules">${modules}</ul>
        <div class="pillar-caps">${caps}</div>
      </div>`;
  }).join("");
  return `<section id="pillars"><h2>D. Where are the problems?</h2><div class="pillar-grid">${cards}</div></section>`;
}

const ACTION_CLASS_LABEL = {
  [ACTION_CLASS.FOUNDATION_BLOCKER]: "Foundation blocker",
  [ACTION_CLASS.HIGH_CONVERSION]: "High conversion impact",
  [ACTION_CLASS.OPTIMIZATION]: "Optimization",
};

function blockersSection(model, plan) {
  if (plan.actions.length === 0) {
    return `<section id="blockers" class="card"><h2>E. What should be fixed first?</h2><p>No score-bearing findings — no prioritized blockers available from the assessed evidence.</p></section>`;
  }
  const rows = plan.actions.slice(0, 8).map((a) => {
    const f = a.finding;
    const classChip = a.actionClass === ACTION_CLASS.FOUNDATION_BLOCKER
      ? `<span class="chip cap-missing">${e(ACTION_CLASS_LABEL[a.actionClass])}</span>`
      : `<span class="chip cap-neutral">${e(ACTION_CLASS_LABEL[a.actionClass] || a.actionClass)}</span>`;
    return `
      <tr>
        <td>${e(a.rank)}</td>
        <td class="mono">${e(f.finalPriority)}</td>
        <td>${classChip}<br><span class="small">${e(a.group)}</span></td>
        <td><strong>${e(f.title)}</strong><br><span class="small">${e(f.ruleId)} · ${e(f.dimension)}</span></td>
        <td>${e(f.businessImpact || "")}</td>
        <td class="small">${(f.evidence || []).map((ev) => `${e(ev.provider || "")}/${e(ev.field || "")}=${e(ev.observedValue ?? "null")} (${e(ev.sourceStatus || "")})`).join("<br>")}</td>
        <td>${e(f.recommendation || "")}</td>
        <td>${e(impactCategory(f))}</td>
        <td>${e(EFFORT_LABEL[f.implementationEffort] || f.implementationEffort || "")}</td>
        <td>${e(f.confidence || "")}</td>
      </tr>`;
  }).join("");
  return `
  <section id="blockers" class="card">
    <h2>E. What should be fixed first?</h2>
    <p class="muted small">Ranked conversion-first: verified foundation blockers lead, then the highest
      conversion-impact work adjusted for evidence confidence.</p>
    <div class="table-wrap">
    <table class="blockers">
      <thead><tr>
        <th>#</th><th>Priority</th><th>Class</th><th>Problem</th><th>Business consequence</th>
        <th>Evidence / provenance</th><th>Recommended action</th><th>Impact</th>
        <th>Effort</th><th>Confidence</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  </section>`;
}

function conversionPathSection(model) {
  const paths = Array.isArray(model.conversionPaths) ? model.conversionPaths : [];
  if (paths.length === 0) {
    return `<section id="paths" class="card"><h2>Conversion path architecture</h2><p>No conversion-path evidence available for this assessment.</p></section>`;
  }
  const rows = paths.map((p) => `
      <div class="path-item">
        <strong>${e(p.name || "Conversion path")}</strong>
        <span class="chip ${p.status === "Clear" ? "cap-ok" : p.status === "Weak" ? "cap-partial" : "cap-missing"}">${e(p.status || "Unknown")}</span>
        ${p.host ? `<span class="small">via ${e(p.host)}</span>` : ""}
        <ol class="small">${(p.steps || []).map((s) => `<li>${e(s)}</li>`).join("")}</ol>
        ${(p.blockers || []).length ? `<p class="small">Blockers: ${e(p.blockers.join(", "))}</p>` : ""}
      </div>`).join("");
  return `<section id="paths" class="card"><h2>Conversion path architecture</h2>${rows}</section>`;
}

function competitorSection(model) {
  const comparisons = model.competitors?.comparisons || [];
  const limitations = model.competitors?.opportunities?.limitations || [];
  if (comparisons.length === 0) {
    return `<section id="competitors" class="card"><h2>Competitive context</h2>
      <p>No competitor evidence was supplied or collected for this assessment, so no comparison is made.
      No market-wide or industry-average claim is inferred.</p>
      ${limitations.length ? `<ul class="small">${limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : ""}
    </section>`;
  }

  const site = model.evidence?.site || {};
  const trustBand = model.bands?.trust;
  const ownSite = {
    offerClarity: (site.services || []).length ? `${(site.services || []).length} service topic(s)` : "Not Assessed",
    trustProof: trustBand && trustBand !== "Not Assessed" ? trustBand : "Not Assessed",
    ctaClarity: (site.ctas || []).length ? `${(site.ctas || []).length} CTA(s)` : "Not Assessed",
    contentDepth: site.pageCount ? `${site.pageCount} page(s)` : "Not Assessed",
    pathClarity: (site.forms || []).length || (site.ctas || []).length ? "Detected" : "Not Assessed",
  };
  const SIGNALS = [
    ["Offer clarity", "offerClarity"],
    ["Trust proof", "trustProof"],
    ["CTA clarity", "ctaClarity"],
    ["Content coverage", "contentDepth"],
    ["Conversion path", "pathClarity"],
  ];
  const header = comparisons.map((c) => `<th>${e(c.name || c.url || "Competitor")}</th>`).join("");
  const signalRows = SIGNALS.map(([label, key]) => `<tr>
        <td><strong>${e(label)}</strong></td>
        <td>${e(ownSite[key])}</td>
        ${comparisons.map((c) => `<td>${e(c[key] || "Not Assessed")}</td>`).join("")}
      </tr>`).join("");
  const sourceRows = comparisons.map((c) => `<tr><td class="small">${e(c.name || c.url || "")}</td><td class="small">${e(c.url || "")}</td><td class="small">${e(c.status || "AVAILABLE")}</td><td class="small">${e(c.topic || c.note || "Not Assessed")}</td></tr>`).join("");

  return `
  <section id="competitors" class="card">
    <h2>Competitive context</h2>
    <p class="muted small">Signal-by-signal comparison against the competitor evidence that was actually collected.
      No traffic, ranking, backlink, market-share, or domain-authority claim is made.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Signal</th><th>This site</th>${header}</tr></thead>
      <tbody>${signalRows}</tbody>
    </table></div>
    <h3>Competitor sources</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Competitor</th><th>URL</th><th>Status</th><th>Observed topic</th></tr></thead>
      <tbody>${sourceRows}</tbody>
    </table></div>
    ${limitations.length ? `<h3>Limitations</h3><ul class="small">${limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : ""}
  </section>`;
}

function contentOpportunitiesSection(model) {
  const ideas = model.contentIdeas || {};
  const tofu = ideas.tofu || [];
  const mofu = ideas.mofu || [];
  const bofu = ideas.bofu || [];
  const leading = ideas.leading || [];
  const ideaRow = (i) => `
    <tr>
      <td>${e(i.idea || "")}</td>
      <td>${e(i.type || "")}</td>
      <td>${e(i.frame || "")}</td>
      <td class="small">${e(i.question || "")}</td>
      <td>${e(i.priority || "")}</td>
    </tr>`;
  const stageBlock = (label, rows, stageIdeas) => stageIdeas.length
    ? `<h3>${e(label)}</h3>
<div class="table-wrap"><table>
<thead><tr><th>Content idea</th><th>Type</th><th>Frame</th><th>Buyer question answered</th><th>Priority</th></tr></thead>
<tbody>${stageIdeas.map(ideaRow).join("")}</tbody>
</table></div>`
    : `<h3>${e(label)}</h3><p class="small">No qualified ideas available from the assessed evidence for this stage.</p>`;
  const leadingBlock = leading.length
    ? `<h3>Qualified search intents</h3>
<div class="table-wrap"><table>
<thead><tr><th>Query</th><th>Rationale</th><th>Priority</th></tr></thead>
<tbody>${leading.map((q) => `<tr><td>${e(q.query || "")}</td><td class="small">${e(q.rationale || "")}</td><td>${e(q.priority || "")}</td></tr>`).join("")}</tbody>
</table></div>`
    : "";
  if (tofu.length + mofu.length + bofu.length + leading.length === 0) {
    return `<section id="content-ideas" class="card"><h2>Topical Map &amp; Content Opportunities</h2><p>Not available: no qualified topical/content opportunity evidence was produced for this assessment.</p></section>`;
  }
  return `
  <section id="content-ideas" class="card">
    <h2>Topical Map &amp; Content Opportunities</h2>
    <p class="muted small">Ideas are derived from the business-context topics supplied at intake and multi-word topics found in crawled site content — no external content research is implied.</p>
    ${stageBlock("Top of Funnel — Awareness", "", tofu)}
    ${stageBlock("Middle of Funnel — Evaluation", "", mofu)}
    ${stageBlock("Bottom of Funnel — Decision", "", bofu)}
    ${leadingBlock}
  </section>`;
}

function cmsPlatformSection(model) {
  const site = model.evidence?.site || {};
  const detected = typeof site.platform === "string" && site.platform.trim() && site.platform !== "Unknown" ? site.platform : null;
  const server = site.pages?.[0]?.responseHeaders?.server;
  const headersAvailable = site._responseHeadersAvailable === true;
  const proprietary = detected ? /GoDaddy|Wix|Squarespace|Shopify/i.test(detected) : false;
  const migrationRisk = detected
    ? proprietary
      ? "Medium — proprietary platform constraints may limit deeper implementation"
      : "Low to Medium — implementation depends on hosting and theme controls"
    : null;
  const observedRows = [
    `<tr><td>Platform</td><td>${detected ? e(detected) : `<span class="chip cap-neutral">Not verified</span> The crawl did not return a platform signal.`}</td></tr>`,
    `<tr><td>Server / delivery</td><td>${headersAvailable && server ? e(server) : `<span class="chip cap-neutral">Not assessed</span> Response headers were not returned by the crawl provider.`}</td></tr>`,
    `<tr><td>Migration risk</td><td>${migrationRisk ? e(migrationRisk) : `<span class="chip cap-neutral">Not assessed</span> Migration risk is not stated because the platform was not verified.`}</td></tr>`,
  ].join("");
  const questions = [
    "Can page-level titles, descriptions, and canonical URLs be edited?",
    "Can JSON-LD structured data be added globally and per service page?",
    "Can semantic heading levels be chosen independently of visual styling?",
    "Does the current plan allow dedicated service, FAQ, and policy pages?",
    "Can response headers be configured at the host, CDN, or platform layer?",
    "Can a lead-capture form be embedded on the pages that need it?",
  ];
  return `
  <section id="cms" class="card">
    <h2>CMS &amp; Platform Constraints</h2>
    <h3>Observed from the crawl</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Signal</th><th>Value</th></tr></thead>
      <tbody>${observedRows}</tbody>
    </table></div>
    <h3>Implementation questions — generic verification checklist</h3>
    <p class="muted small">The questions below are a generic checklist, not findings about this site. None of them
      has been verified: platform administration access is required to confirm the answers.</p>
    <ul class="small">${questions.map((q) => `<li>${e(q)}</li>`).join("")}</ul>
  </section>`;
}

function safeHref(u) {
  try {
    const parsed = new URL(String(u || ""), "https://placeholder.local");
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return e(u);
  } catch { /* fall through */ }
  return "#";
}

const LINK_REASON_LABEL = {
  source_content_supports_related_service_page: "Content supports related service",
  informational_content_progresses_to_commercial_page: "Info content → commercial",
  consideration_content_progresses_to_conversion_page: "Consideration → conversion",
  pages_belong_to_same_topic_hierarchy: "Same topic hierarchy",
  source_content_references_target_service: "References target service",
  source_content_clarifies_referenced_topic: "Clarifies referenced topic",
  high_value_page_is_weakly_linked: "High-value page weakly linked",
};

function internalLinksSection(model) {
  const site = model.evidence?.site || {};
  const opp = model.evidence?.internalLinkOpportunities;
  const brokenLinks = site.brokenInternalLinks || [];
  const totalLinks = site.internalLinkCount || 0;
  const opportunities = opp?.opportunities || [];
  const orphans = opp?.orphans || [];
  const limitations = opp?.limitations || [];

  let body = "";
  if (!opp) {
    body = `<p>Not available: internal-link opportunities were not computed for this audit.${brokenLinks.length ? " Broken links from crawl evidence are shown below." : ""}</p>`;
  } else if (opportunities.length === 0) {
    body = `<p>No implementation-ready recommendations: no high- or medium-confidence opportunities were identified from crawl evidence.</p>`;
  } else {
    body = `<h3>Implementation-Ready Recommendations (${opportunities.length})</h3>
<p class="muted small">High- and medium-confidence recommendations traceable to crawled source and target page content.</p>
<div class="table-wrap"><table>
<thead><tr><th>Source</th><th>Target</th><th>Anchor</th><th>Source context</th><th>Reason</th><th>Stage</th><th>Confidence</th><th>Warning</th></tr></thead>
<tbody>${opportunities.slice(0, 25).map((o) => `
  <tr>
    <td class="small"><a href="${safeHref(o.sourceUrl)}">${e((o.sourceUrl || "").replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 40))}</a></td>
    <td class="small"><a href="${safeHref(o.targetUrl)}">${e((o.targetUrl || "").replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 40))}</a></td>
    <td>${e(o.proposedAnchor || "")}</td>
    <td class="small">${e(o.relevantSurroundingText || "—")}</td>
    <td class="small">${e(LINK_REASON_LABEL[o.reasonForLink] || o.reasonForLink || "")}</td>
    <td>${e(o.funnelStage || "")}</td>
    <td><span class="chip ${o.confidence === "high" ? "cap-ok" : "cap-partial"}">${e(o.confidence || "")}</span></td>
    <td class="small">${o.duplicateAnchorWarning ? e(o.duplicateAnchorWarning) : "—"}</td>
  </tr>`).join("")}</tbody>
</table></div>`;
  }

  const tracedBroken = brokenLinks.filter((b) => typeof b === "object" && b && b.source && (b.url || b.target));
  const untracedBroken = brokenLinks.filter((b) => !(typeof b === "object" && b && b.source));
  const brokenTable = tracedBroken.length
    ? `<h3>Broken Internal Links (${tracedBroken.length} traced)</h3>
<div class="table-wrap"><table>
<thead><tr><th>Source</th><th>Target</th></tr></thead>
<tbody>${tracedBroken.slice(0, 10).map((b) => `<tr><td class="small">${e(b.source)}</td><td class="small">${e(b.url || b.target)}</td></tr>`).join("")}</tbody>
</table></div>`
    : "";
  const untracedNote = untracedBroken.length
    ? `<h3>Broken Internal Links (${untracedBroken.length} untraced)</h3>
<p class="small">${e(untracedBroken.length)} broken link destination(s) could not be traced to a source page from the collected evidence — count only, no source implied.</p>`
    : "";
  const orphanBlock = orphans.length && opp?.coverage?.crawlComplete !== false
    ? `<h3>Orphan / Weakly Linked Pages (${orphans.length})</h3>
<div class="table-wrap"><table>
<thead><tr><th>URL</th><th>Title</th></tr></thead>
<tbody>${orphans.slice(0, 15).map((o) => `<tr><td class="small">${e((o.url || "").slice(0, 60))}</td><td class="small">${e(o.title || "—")}</td></tr>`).join("")}</tbody>
</table></div>`
    : opp?.coverage?.crawlComplete === false
      ? `<p class="small">Orphan analysis: crawl coverage is incomplete — definitive orphan claims cannot be made.</p>`
      : "";
  return `
  <section id="internal-links" class="card">
    <h2>Internal-Link Opportunities</h2>
    <p class="muted small">Summary: ${e(totalLinks)} total internal links, ${e(brokenLinks.length)} broken. ${e(opp?.coverage?.pagesEvaluated ?? 0)} pages evaluated. ${e(opportunities.length)} recommendation(s).</p>
    ${body}
    ${brokenTable}${untracedNote}
    ${orphanBlock}
    ${limitations.length ? `<h3>Limitations</h3><ul class="small">${limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : ""}
  </section>`;
}

function deepEvidenceLayer(model) {
  const findings = (model.findings || []).map((f) => `
      <li>
        <strong>${e(f.ruleId)}</strong> — ${e(f.title)}
        <span class="small">(${e(f.confidence)}, priority ${e(f.finalPriority)}, ${f.scoreBearing ? "score-bearing" : "non-scored"})</span>
        <ul class="small">
          ${(f.evidence || []).map((ev) => `<li>${e(ev.provider)} · ${e(ev.field)} · ${e(ev.observedValue ?? "null")} · ${e(ev.sourceStatus)}</li>`).join("")}
        </ul>
      </li>`).join("");
  const sources = ["site", "performance", "competitors", "backlinks", "ga4", "gsc"].map((key) => {
    const ev = model.evidence?.[key];
    if (!ev) return `<li>${e(key)}: not collected</li>`;
    const status = ev.sourceStatus || "UNKNOWN";
    return `<li>${e(key)}: ${e(status)}${ev.collectedAt ? ` (${e(ev.collectedAt)})` : ""}</li>`;
  }).join("");
  const caps = model.capabilityEvidence?.capabilities || {};
  const capRows = Object.entries(caps).map(([key, c]) =>
    `<tr><td>${e(key)}</td><td><span class="chip ${capabilityStatusClass(c.status)}">${e(c.status)}</span></td><td class="small">${e((c.limitations || []).join("; "))}</td><td class="small">${c.validated ? "validated by " + e(c.validatedBy) : "inferred"}</td></tr>`
  ).join("");
  const suppressed = (model.suppressedFindingReasons || [])
    .map((r) => `<li>${e(r.ruleId)} suppressed: capability ${e(r.capability)} is ${e(r.capabilityStatus)}</li>`)
    .join("");
  const deferredBlock = suppressed.length
    ? `<h3>Deferred &amp; unavailable analysis</h3><ul class="small">${suppressed}</ul>`
    : `<h3>Deferred &amp; unavailable analysis</h3><p class="small">None deferred: all analyses with eligible evidence are rendered above; unavailable sources are shown in Source statuses.</p>`;
  return `
  <section id="evidence" class="card">
    <h2>Evidence detail</h2>
    <h3>Findings (${e((model.findings || []).length)})</h3>
    <ul class="findings">${findings}</ul>
    <h3>Source statuses</h3>
    <ul class="small">${sources}</ul>
    <h3>Evidence capabilities</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Capability</th><th>Status</th><th>Limitations</th><th>Kind</th></tr></thead>
      <tbody>${capRows}</tbody>
    </table></div>
    ${deferredBlock}
  </section>`;
}

function renderViewerNav() {
  return REPORT_V2_VIEWER_PAGES.map((page, index) => `
    <a class="viewer-nav-link" href="#${e(page.pageId)}" data-viewer-page="${e(page.pageId)}">
      <span class="viewer-nav-num">${String(index + 1).padStart(2, "0")}</span>
      <span>${e(page.title)}</span>
    </a>`).join("");
}

function pageShell(model, date, pillars, checklist, plan) {
  const business = model.input?.businessName || "Business";
  const domain = model.evidence?.site?.domain || model.input?.targetUrl || "";
  const scoringVersion = model.scoringVersion || "";
  const viewerConfig = JSON.stringify(REPORT_V2_VIEWER_PAGES.map((page) => ({
    pageId: page.pageId,
    title: page.title,
    sectionIds: [...page.sectionIds],
  })));
  const browserTitleBusiness = JSON.stringify(String(business));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(business)} — Conversion Readiness Report</title>
<style>
:root { --navy:#0d1b33; --navy2:#122544; --ink:#142033; --muted:#667085; --bg:#f4f7fb; --card:#ffffff; --line:#dfe5ee; --accent:#2d6cdf; --accent-soft:#eaf2ff; --warn:#b7791f; --ok:#16875b; --bad:#c2413b; --shadow:0 8px 28px rgba(21,31,51,.08); }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { margin:0; min-height:100vh; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:var(--ink); background:var(--bg); line-height:1.55; }
.mono { font-family:'Courier New',ui-monospace,monospace; }
header.brand { position:sticky; top:0; z-index:20; background:#fff; color:var(--ink); min-height:64px; padding:.85rem 1.5rem; border-bottom:1px solid var(--line); display:flex; flex-direction:column; justify-content:center; }
header.brand h1 { margin:0; font-size:1.35rem; line-height:1.2; letter-spacing:-.01em; }
header.brand .sub { margin:.25rem 0 0; color:var(--muted); font-size:.78rem; }
.report-layout { display:grid; grid-template-columns:280px minmax(0,1fr); grid-template-areas:'sidebar content'; gap:24px; max-width:1600px; margin:0 auto; padding:24px; align-items:start; }
.viewer-sidebar { grid-area:sidebar; position:sticky; top:88px; max-height:calc(100vh - 112px); overflow-y:auto; background:var(--navy); color:#fff; border:0; border-radius:16px; padding:18px; box-shadow:var(--shadow); }
.viewer-sidebar-title { margin:4px 8px 12px; font-size:.68rem; text-transform:uppercase; letter-spacing:.12em; color:#9eb0cc; font-weight:800; }
.viewer-nav { display:flex; flex-direction:column; gap:5px; }
.viewer-nav-link { display:grid; grid-template-columns:26px 1fr; gap:10px; align-items:start; padding:10px 11px; border-radius:9px; color:#dce5f3; text-decoration:none; font-size:.8rem; line-height:1.25; }
.viewer-nav-link:hover { background:rgba(255,255,255,.08); color:#fff; }
.viewer-nav-link[aria-current='page'] { background:#fff; color:var(--navy); font-weight:800; }
.viewer-nav-num { display:inline-grid; place-items:center; min-width:22px; height:22px; border-radius:6px; background:rgba(255,255,255,.08); font-family:'Courier New',ui-monospace,monospace; font-size:.67rem; line-height:1; }
.viewer-nav-link[aria-current='page'] .viewer-nav-num { background:var(--accent-soft); color:var(--accent); }
.viewer-content { grid-area:content; min-width:0; }
.viewer-toolbar { display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; background:transparent; border:0; padding:2px 0 14px; margin:0 0 4px; }
.viewer-toolbar h2 { margin:0; font-size:1.45rem; line-height:1.2; letter-spacing:-.02em; }
.print-page-btn { border:1px solid var(--accent); border-radius:9px; padding:.65rem .9rem; background:var(--accent); color:#fff; font-weight:750; cursor:pointer; white-space:nowrap; box-shadow:0 3px 10px rgba(45,108,223,.18); }
.print-page-btn:hover { filter:brightness(.95); }
main { min-width:0; }
body.viewer-ready main > section:not(.viewer-active) { display:none; }
body.viewer-ready main > section.viewer-active { display:block; }
body.viewer-ready .narrative-layer > section:not(.viewer-active) { display:none; }
body.viewer-ready .narrative-layer > section.viewer-active { display:block; }
.card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; margin:0 0 18px; box-shadow:var(--shadow); }
main > section:not(.card) { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; margin:0 0 18px; box-shadow:var(--shadow); }
section > h2 { margin:.05rem 0 .8rem; font-size:1.05rem; border-bottom:1px solid #edf0f5; padding-bottom:.62rem; letter-spacing:-.01em; }
section > h3, .card h3 { font-size:.9rem; margin:1rem 0 .55rem; }
.grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }
.pillar-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; }
.pillar { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:15px; box-shadow:0 4px 16px rgba(21,31,51,.05); }
.pillar h3 { margin:.1rem 0 .5rem; font-size:.9rem; }
.pillar-score { font-size:1.65rem; font-weight:800; letter-spacing:-.02em; }
.pillar-score.none { font-size:1rem; color:var(--muted); }
.pillar-modules { margin:.5rem 0; padding-left:1rem; font-size:.76rem; color:var(--muted); }
.pillar-caps { display:flex; flex-wrap:wrap; gap:.3rem; }
.readiness, .confidence, .coverage { font-size:2rem; font-weight:800; letter-spacing:-.03em; }
.readiness-none { font-size:1.1rem; font-weight:800; color:var(--warn); }
.readiness-max { font-size:.92rem; color:var(--muted); font-weight:500; }
.chip { display:inline-block; font-size:.7rem; padding:.18rem .5rem; border-radius:999px; background:#eef2f8; color:var(--muted); font-weight:700; }
.band-strong, .cap-ok { background:#e9f8f1; color:var(--ok); }
.band-moderate, .cap-partial { background:#fff4db; color:var(--warn); }
.band-limited { background:#feeceb; color:var(--bad); }
.band-weak, .cap-missing { background:#feeceb; color:var(--bad); }
.cap-neutral { background:#eef2f8; color:var(--muted); }
.muted { color:var(--muted); }
.small { font-size:.76rem; color:var(--muted); }
.table-wrap { overflow-x:auto; border-radius:10px; }
table { width:100%; border-collapse:collapse; font-size:.78rem; font-family:inherit; }
th, td { border:0; border-bottom:1px solid #edf0f5; padding:.62rem .55rem; text-align:left; vertical-align:top; }
th { background:#f8fafc; color:var(--muted); font-size:.72rem; font-weight:750; }
tbody tr:last-child td { border-bottom:0; }
a { color:var(--accent); }
ul.findings { padding-left:1.1rem; }
ul.findings > li { margin:.5rem 0; }
footer { text-align:center; color:var(--muted); font-size:.72rem; padding:1rem 1.2rem 1.4rem; }
@media (max-width:900px) {
  .report-layout { grid-template-columns:220px minmax(0,1fr); grid-template-areas:'sidebar content'; gap:14px; padding:14px; }
  .viewer-sidebar { position:sticky; top:78px; max-height:calc(100vh - 92px); overflow-y:auto; padding:12px; border-radius:12px; }
  .viewer-nav { flex-direction:column; overflow:visible; }
  .viewer-nav-link { min-width:0; padding:9px 8px; }
  .viewer-sidebar-title { margin-left:6px; }
  .grid-3 { grid-template-columns:1fr; }
}
@media (max-width:720px) {
  .report-layout { grid-template-columns:180px minmax(0,1fr); gap:10px; padding:10px; }
  .viewer-sidebar { top:76px; max-height:calc(100vh - 86px); padding:9px; }
  .viewer-nav-link { grid-template-columns:22px 1fr; gap:7px; padding:8px 7px; font-size:.72rem; }
  .viewer-nav-num { min-width:20px; height:20px; font-size:.62rem; }
  header.brand { padding:.75rem 1rem; }
  header.brand h1 { font-size:1.05rem; }
  header.brand .sub { font-size:.68rem; }
  .viewer-toolbar { align-items:flex-start; flex-direction:column; }
  .viewer-toolbar h2 { font-size:1.15rem; }
  .print-page-btn { width:100%; }
  .card, main > section:not(.card) { padding:14px; }
}
@media print {
  .nav-jump, .no-print { display:none !important; }
  body { background:#fff; }
  header.brand { position:static; border:0; padding:0 0 1rem; }
  .report-layout { display:block; max-width:100%; margin:0; padding:0; }
  .viewer-content, main { max-width:100%; padding:0; }
  body.viewer-ready main > section:not(.viewer-active) { display:none !important; }
  body.viewer-ready main > section.viewer-active { display:block !important; }
  body.viewer-ready .narrative-layer > section:not(.viewer-active) { display:none !important; }
  body.viewer-ready .narrative-layer > section.viewer-active { display:block !important; }
  .card, .pillar, main > section:not(.card) { box-shadow:none; page-break-inside:avoid; }
}
</style>
</head>
<body data-report-design="${e(REPORT_DESIGN_V2)}" data-viewer-version="${e(REPORT_V2_VIEWER_VERSION)}">
<header class="brand">
  <h1>${e(business)} — Conversion Readiness Report</h1>
  <p class="sub">${e(domain)} · ${e(date)} · Report design v${e(REPORT_DESIGN_V2)} · Viewer v${e(REPORT_V2_VIEWER_VERSION)} · Scoring version ${e(scoringVersion)}</p>
</header>
<div class="report-layout">
  <div class="viewer-content">
    <div class="viewer-toolbar no-print">
      <h2 id="viewerPageTitle">Executive Scorecard</h2>
      <button type="button" class="print-page-btn" onclick="window.print()" aria-label="Print or save this page as PDF">Print or save this page as PDF</button>
    </div>
    <main id="reportContent" tabindex="-1">
      ${executiveScorecard(model, pillars)}
      ${pillarSection(pillars)}
      ${blockersSection(model, plan)}
      ${foundationSection(checklist)}
      ${conversionPathSection(model)}
      ${competitorSection(model)}
      ${contentOpportunitiesSection(model)}
      ${eeatSection(model)}
      ${technicalDetailSection(model)}
      ${headingSection(model)}
      ${schemaSection(model)}
      ${performanceDetailSection(model)}
      ${machineReadinessSection(model)}
      ${cmsPlatformSection(model)}
      ${internalLinksSection(model)}
      ${strengthsSection(model, checklist)}
      ${actionPlanSection(plan, checklist)}
      ${phase2Section()}
      ${deepEvidenceLayer(model)}
    </main>
  </div>
  <aside class="viewer-sidebar no-print" aria-label="Report sections">
    <p class="viewer-sidebar-title">Report sections</p>
    <nav class="viewer-nav">${renderViewerNav()}</nav>
  </aside>
</div>
<footer>Generated by Prysm (Omnipressence) · Report design v${e(REPORT_DESIGN_V2)} · Viewer v${e(REPORT_V2_VIEWER_VERSION)} · Evidence-grounded conversion-readiness assessment</footer>
<script>
(() => {
  const pages = ${viewerConfig};
  const fallback = pages[0];
  const businessName = ${browserTitleBusiness};
  const byId = new Map(pages.map((page) => [page.pageId, page]));
  const allSectionIds = new Set(pages.flatMap((page) => page.sectionIds));
  const title = document.getElementById("viewerPageTitle");
  const content = document.getElementById("reportContent");
  const links = Array.from(document.querySelectorAll("[data-viewer-page]"));
  const narrativeSections = Array.from(document.querySelectorAll("#narrative-layer > section[data-viewer-page]"));

  for (const id of allSectionIds) {
    const section = document.getElementById(id);
    if (section) section.classList.add("viewer-section");
  }
  for (const section of narrativeSections) section.classList.add("viewer-section");

  function resolvePage() {
    const requested = decodeURIComponent((window.location.hash || "").replace(/^#/, ""));
    return byId.get(requested) || fallback;
  }

  function activate(page, options = {}) {
    const focus = options.focus === true;
    document.body.classList.add("viewer-ready");
    const activeIds = new Set(page.sectionIds);
    for (const id of allSectionIds) {
      const section = document.getElementById(id);
      if (section) section.classList.toggle("viewer-active", activeIds.has(id));
    }
    for (const section of narrativeSections) {
      section.classList.toggle("viewer-active", section.dataset.viewerPage === page.pageId);
    }
    for (const link of links) {
      if (link.dataset.viewerPage === page.pageId) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (title) title.textContent = page.title;
    document.title = page.title + " — " + businessName;
    if (focus && content) content.focus({ preventScroll: true });
  }

  function syncFromHash(options = {}) {
    const page = resolvePage();
    if (window.location.hash !== "#" + page.pageId) {
      history.replaceState(null, "", "#" + page.pageId);
    }
    activate(page, options);
  }

  for (const link of links) {
    link.addEventListener("click", (event) => {
      const page = byId.get(link.dataset.viewerPage);
      if (!page) return;
      event.preventDefault();
      history.pushState(null, "", "#" + page.pageId);
      activate(page, { focus: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  window.addEventListener("hashchange", () => syncFromHash({ focus: true }));
  window.addEventListener("popstate", () => syncFromHash({ focus: true }));
  syncFromHash();
})();
</script>
</body>
</html>`;
}

export function renderReportV2(model, options = {}) {
  const generated = model?.generatedAt ? new Date(model.generatedAt) : new Date(0);
  const date = options.date || (Number.isNaN(generated.getTime()) ? "Unknown date" : generated.toISOString().slice(0, 10));
  const pillars = computePillars(model);
  const checklist = buildFoundationChecklist(model);
  const plan = buildActionPlan(model, checklist);
  return pageShell(model, date, pillars, checklist, plan);
}

export { computePillars };
export default { renderReportV2, computePillars, REPORT_V2_VIEWER_PAGES, REPORT_V2_VIEWER_VERSION };

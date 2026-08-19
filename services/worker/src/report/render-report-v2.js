/**
 * PRYSM-NEXT-01 WP-G — Report Design v2.0.0 renderer.
 *
 * A DISTINCT governed design (prysm-report-design-v2.0.0) with its own DOM,
 * CSS, and print rules.  v1.0.0 (render-report.js / render-approved-report.js)
 * is untouched — this renderer is selected only through the versioned
 * product contract (auditRequest.report.designVersion === "2.0.0").
 *
 * The executive report answers, in order:
 *   A. What is the website's Conversion Readiness?
 *   B. How trustworthy is that assessment? (Evidence Confidence)
 *   C. How much of the intended assessment was completed? (Evidence Coverage)
 *   D. Where are the problems? (five pillars)
 *   E. What should be fixed first? (top blockers)
 * Deep evidence layers (findings, source statuses, capability states,
 * suppression reasons) remain available underneath.
 *
 * INVARIANT: every material claim is rendered FROM the governed model
 * (findings, scores, capability evidence) — this renderer never invents
 * evidence, never changes scores.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  // UNAVAILABLE / NOT_CONNECTED / NOT_APPLICABLE are NOT failures —
  // neutral styling so unavailable evidence is never shown as a defect.
  return "cap-neutral";
}

// ---------------------------------------------------------------------------
// Section builders (all content derived from the governed model)
// ---------------------------------------------------------------------------

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
    const scoreHtml =
      p.score === null
        ? `<div class="pillar-score none">Not Assessed</div>`
        : `<div class="pillar-score">${e(p.score)}<span class="readiness-max">/100</span></div>`;
    const modules = p.modules
      .map(
        (m) =>
          `<li>${e(m.moduleId)}: ${m.score === null ? "suppressed" : e(m.score)} (weight ${e(m.weight)})</li>`,
      )
      .join("");
    const caps = p.capabilities
      .map(
        (c) =>
          `<span class="chip ${capabilityStatusClass(c.status)}">${e(c.key)}: ${e(c.status)}</span>`,
      )
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

/**
 * E. What should be fixed first?
 *
 * PRYSM-V2-REPORT-DEPTH-01 — ordered by the conversion-first action plan
 * rather than raw score, so a verified foundation blocker leads even when an
 * ordinary optimization carries a higher weighted priority.
 */
function blockersSection(model, plan) {
  if (plan.actions.length === 0) {
    return `<section id="blockers" class="card"><h2>E. What should be fixed first?</h2><p>No score-bearing findings — no prioritized blockers available from the assessed evidence.</p></section>`;
  }
  const rows = plan.actions
    .slice(0, 8)
    .map((a) => {
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
        <td class="small">${(f.evidence || [])
          .map(
            (ev) =>
              `${e(ev.provider || "")}/${e(ev.field || "")}=${e(ev.observedValue ?? "null")} (${e(ev.sourceStatus || "")})`,
          )
          .join("<br>")}</td>
        <td>${e(f.recommendation || "")}</td>
        <td>${e(impactCategory(f))}</td>
        <td>${e(EFFORT_LABEL[f.implementationEffort] || f.implementationEffort || "")}</td>
        <td>${e(f.confidence || "")}</td>
      </tr>`;
    })
    .join("");
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
  const rows = paths
    .map(
      (p) => `
      <div class="path-item">
        <strong>${e(p.name || "Conversion path")}</strong>
        <span class="chip ${p.status === "Clear" ? "cap-ok" : p.status === "Weak" ? "cap-partial" : "cap-missing"}">${e(p.status || "Unknown")}</span>
        ${p.host ? `<span class="small">via ${e(p.host)}</span>` : ""}
        <ol class="small">${(p.steps || []).map((s) => `<li>${e(s)}</li>`).join("")}</ol>
        ${(p.blockers || []).length ? `<p class="small">Blockers: ${e(p.blockers.join(", "))}</p>` : ""}
      </div>`,
    )
    .join("");
  return `<section id="paths" class="card"><h2>Conversion path architecture</h2>${rows}</section>`;
}

/**
 * Competitive context.
 *
 * PRYSM-V2-REPORT-DEPTH-01 — renders a side-by-side signal comparison so the
 * section answers where this site is stronger and where competitor evidence
 * is stronger.  Uses only already-collected competitor evidence: no provider
 * scope is added, and when evidence is unavailable the exact limitation is
 * stated instead of generic market commentary.
 */
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
  // Own-site values come from the same governed model that produced the
  // competitor values — never a placeholder, never an absence-derived label.
  const ownSite = {
    offerClarity: (site.services || []).length
      ? `${(site.services || []).length} service topic(s)`
      : "Not Assessed",
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

  const header = comparisons
    .map((c) => `<th>${e(c.name || c.url || "Competitor")}</th>`)
    .join("");
  const signalRows = SIGNALS
    .map(([label, key]) => `<tr>
        <td><strong>${e(label)}</strong></td>
        <td>${e(ownSite[key])}</td>
        ${comparisons.map((c) => `<td>${e(c[key] || "Not Assessed")}</td>`).join("")}
      </tr>`)
    .join("");

  const sourceRows = comparisons
    .map((c) => `<tr><td class="small">${e(c.name || c.url || "")}</td><td class="small">${e(c.url || "")}</td><td class="small">${e(c.status || "AVAILABLE")}</td><td class="small">${e(c.topic || c.note || "Not Assessed")}</td></tr>`)
    .join("");

  return `
  <section id="competitors" class="card">
    <h2>Competitive context</h2>
    <p class="muted small">Signal-by-signal comparison against the competitor evidence that was actually collected.
      No traffic, ranking, backlink, market-share, or domain-authority claim is made.</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Signal</th><th>This site</th>${header}</tr></thead>
      <tbody>${signalRows}</tbody>
    </table>
    </div>
    <h3>Competitor sources</h3>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Competitor</th><th>URL</th><th>Status</th><th>Observed topic</th></tr></thead>
      <tbody>${sourceRows}</tbody>
    </table>
    </div>
    ${limitations.length ? `<h3>Limitations</h3><ul class="small">${limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : ""}
  </section>`;
}

// ---------------------------------------------------------------------------
// PRYSM-V2-RENDER-01 — required informational sections.
// All content is rendered FROM the governed model only (contentIdeas, site
// evidence, internalLinkOpportunities).  Absent data renders an explicit
// governed unavailable/not-computed state — never silent omission, never
// fabrication, and never a business-failure framing of missing evidence.
// ---------------------------------------------------------------------------

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
  const stageBlock = (label, rows, stageIdeas) =>
    stageIdeas.length
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

/**
 * CMS & platform.
 *
 * PRYSM-V2-REPORT-DEPTH-01 — v1 rendered a fixed nine-row feasibility matrix
 * ("Likely" / "Uncertain" / "Hosting-dependent") for every site, which reads
 * as a verified assessment of THIS client's platform.  Detected facts and
 * generic guidance are now strictly separated: the observed block carries
 * only what the crawl returned, and the checklist below is explicitly
 * labelled as unverified questions to confirm with admin access.
 */
function cmsPlatformSection(model) {
  const site = model.evidence?.site || {};
  const detected = typeof site.platform === "string" && site.platform.trim() && site.platform !== "Unknown"
    ? site.platform
    : null;
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

/** Only http/https URLs may become link targets — anything else renders inert. */
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

  // PRYSM production defect 3 — broken links are either traced
  // ({source, url} records from the link graph) or untraced (historical
  // strings / records without a proven source).  Untraced destinations
  // render an honest count-only state — never "unknown → unknown".
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
  const brokenBlock = brokenTable + untracedNote;

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
    ${brokenBlock}
    ${orphanBlock}
    ${limitations.length ? `<h3>Limitations</h3><ul class="small">${limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : ""}
  </section>`;
}

function deepEvidenceLayer(model) {
  const findings = (model.findings || [])
    .map(
      (f) => `
      <li>
        <strong>${e(f.ruleId)}</strong> — ${e(f.title)}
        <span class="small">(${e(f.confidence)}, priority ${e(f.finalPriority)}, ${f.scoreBearing ? "score-bearing" : "non-scored"})</span>
        <ul class="small">
          ${(f.evidence || []).map((ev) => `<li>${e(ev.provider)} · ${e(ev.field)} · ${e(ev.observedValue ?? "null")} · ${e(ev.sourceStatus)}</li>`).join("")}
        </ul>
      </li>`,
    )
    .join("");

  const sources = ["site", "performance", "competitors", "backlinks", "ga4", "gsc"]
    .map((key) => {
      const ev = model.evidence?.[key];
      if (!ev) return `<li>${e(key)}: not collected</li>`;
      const status = ev.sourceStatus || "UNKNOWN";
      return `<li>${e(key)}: ${e(status)}${ev.collectedAt ? ` (${e(ev.collectedAt)})` : ""}</li>`;
    })
    .join("");

  const caps = model.capabilityEvidence?.capabilities || {};
  const capRows = Object.entries(caps)
    .map(
      ([key, c]) =>
        `<tr><td>${e(key)}</td><td><span class="chip ${capabilityStatusClass(c.status)}">${e(c.status)}</span></td><td class="small">${e((c.limitations || []).join("; "))}</td><td class="small">${c.validated ? "validated by " + e(c.validatedBy) : "inferred"}</td></tr>`,
    )
    .join("");

  const suppressed = (model.suppressedFindingReasons || [])
    .map((r) => `<li>${e(r.ruleId)} suppressed: capability ${e(r.capability)} is ${e(r.capabilityStatus)}</li>`)
    .join("");

  // PRYSM-V2-RENDER-01 — the deferred/unavailable analysis is ALWAYS an
  // explicit state: suppressed items when they exist, otherwise an explicit
  // statement that nothing was deferred.  Missing evidence is never silently
  // omitted and never converted into a business failure.
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
    <div class="table-wrap">
    <table>
      <thead><tr><th>Capability</th><th>Status</th><th>Limitations</th><th>Kind</th></tr></thead>
      <tbody>${capRows}</tbody>
    </table>
    </div>
    ${deferredBlock}
  </section>`;
}

function pageShell(model, date, pillars, checklist, plan) {
  const business = model.input?.businessName || "Business";
  const domain = model.evidence?.site?.domain || model.input?.targetUrl || "";
  const scoringVersion = model.scoringVersion || "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(business)} — Conversion Readiness Report</title>
<style>
:root { --ink:#1a2333; --muted:#5b6b82; --bg:#f6f8fb; --card:#ffffff; --line:#dfe5ee; --accent:#0f4c81; --warn:#b45309; --ok:#15803d; --bad:#b91c1c; }
* { box-sizing: border-box; }
body { margin:0; font-family: Georgia, 'Times New Roman', serif; color:var(--ink); background:var(--bg); line-height:1.55; }
.mono, table { font-family: 'Courier New', ui-monospace, monospace; }
header.brand { background:var(--ink); color:#fff; padding:1.2rem 1.5rem; }
header.brand h1 { margin:0; font-size:1.4rem; }
header.brand .sub { color:#b9c4d4; font-size:.85rem; }
main { max-width: 1060px; margin: 0 auto; padding: 1.2rem; }
.card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:1.1rem 1.2rem; margin:1rem 0; }
section > h2 { margin-top:.2rem; font-size:1.15rem; border-bottom:1px solid var(--line); padding-bottom:.4rem; }
.grid-3 { display:grid; grid-template-columns: repeat(3, 1fr); gap:1rem; }
.pillar-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:.8rem; }
.pillar { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.9rem; }
.pillar h3 { margin:.1rem 0 .5rem; font-size:1rem; }
.pillar-score { font-size:1.5rem; font-weight:bold; }
.pillar-score.none { font-size:1rem; color:var(--muted); }
.pillar-modules { margin:.4rem 0; padding-left:1rem; font-size:.8rem; color:var(--muted); }
.pillar-caps { display:flex; flex-wrap:wrap; gap:.3rem; }
.readiness, .confidence, .coverage { font-size:2rem; font-weight:bold; }
.readiness-none { font-size:1.1rem; font-weight:bold; color:var(--warn); }
.readiness-max { font-size:1rem; color:var(--muted); font-weight:normal; }
.chip { display:inline-block; font-size:.72rem; padding:.1rem .5rem; border-radius:999px; background:#eef2f8; color:var(--muted); }
.band-strong, .cap-ok { background:#e7f5ec; color:var(--ok); }
.band-moderate, .cap-partial { background:#fdf3e3; color:var(--warn); }
.band-limited { background:#fdf0f0; color:var(--bad); }
.band-weak, .cap-missing { background:#fbeaea; color:var(--bad); }
.cap-neutral { background:#eef2f8; color:var(--muted); }
.muted { color:var(--muted); }
.small { font-size:.78rem; color:var(--muted); }
.table-wrap { overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-size:.82rem; }
th, td { border:1px solid var(--line); padding:.4rem .55rem; text-align:left; vertical-align:top; }
th { background:#eef2f8; }
ul.findings { padding-left:1.1rem; }
ul.findings > li { margin:.5rem 0; }
.nav-jump { display:flex; gap:.6rem; flex-wrap:wrap; margin:.6rem 0; }
.nav-jump a { color:var(--accent); font-size:.85rem; }
footer { text-align:center; color:var(--muted); font-size:.8rem; padding:1.2rem; }
@media (max-width: 720px) {
  .grid-3 { grid-template-columns: 1fr; }
  header.brand h1 { font-size:1.1rem; }
}
@media print {
  .nav-jump, .no-print { display:none !important; }
  body { background:#fff; }
  .card, .pillar { border:none; page-break-inside: avoid; }
  main { max-width:100%; padding:0; }
}
</style>
</head>
<body>
<header class="brand">
  <h1>${e(business)} — Conversion Readiness Report</h1>
  <p class="sub">${e(domain)} · ${e(date)} · Report design v${e(REPORT_DESIGN_V2)} · Scoring version ${e(scoringVersion)}</p>
</header>
<main>
  <nav class="nav-jump no-print">
    <a href="#executive">Executive</a><a href="#pillars">Pillars</a><a href="#blockers">Fix first</a><a href="#foundations">Foundations</a><a href="#action-plan">Plan</a><a href="#paths">Paths</a><a href="#competitors">Competitors</a><a href="#content-ideas">Content ideas</a><a href="#eeat">Trust proof</a><a href="#technical">Technical</a><a href="#headings">Headings</a><a href="#schema">Entities</a><a href="#performance">Speed</a><a href="#cms">Platform</a><a href="#internal-links">Internal links</a><a href="#strengths">Strengths</a><a href="#evidence">Evidence</a>
  </nav>
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
<footer>Generated by Prysm (Omnipressence) · Report design v${e(REPORT_DESIGN_V2)} · Evidence-grounded conversion-readiness assessment</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Render the report-design-v2.0.0 executive report.
 *
 * @param {object} model — scored audit model (scoreAudit v4 output)
 * @param {object} [options]
 * @param {string} [options.date] — report date (defaults to model.generatedAt date)
 * @returns {string} complete HTML document
 */
export function renderReportV2(model, options = {}) {
  const generated = model?.generatedAt ? new Date(model.generatedAt) : new Date(0);
  const date =
    options.date ||
    (Number.isNaN(generated.getTime())
      ? "Unknown date"
      : generated.toISOString().slice(0, 10));
  const pillars = computePillars(model);
  // Derived display models — no governed artifact or schema is modified.
  const checklist = buildFoundationChecklist(model);
  const plan = buildActionPlan(model, checklist);
  return pageShell(model, date, pillars, checklist, plan);
}

export { computePillars };
export default { renderReportV2, computePillars };

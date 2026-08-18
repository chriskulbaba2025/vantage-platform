/**
 * PRYSM-V2-REPORT-DEPTH-01 — governed depth sections for report design v2.
 *
 * Restores the useful diagnostic depth of the v1 ("Karen Leslie") report
 * beneath the v2 executive A–E summary, with the modern governance rule
 * applied throughout:
 *
 *     UNKNOWN != BAD      UNAVAILABLE != MISSING      NOT ASSESSED != FAILURE
 *
 * Where v1 used `if (!signal) => "Missing"`, these sections first ask whether
 * the governed capability proves the signal was actually assessed.  Only an
 * assessed absence renders as a deficiency; an unassessed one renders as
 * "Not Assessed" and says what evidence is missing.
 *
 * No section invents evidence, changes a score, or adds a provider call.
 */

import { FOUNDATION_STATUS, FOUNDATION_STATUS_LABEL } from "./foundation-readiness.js";
import { ACTION_CLASS, ACTION_GROUP } from "./action-priority.js";

function e(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const NOT_ASSESSED = "Not Assessed";
const AVAILABLE = new Set(["AVAILABLE", "PARTIAL"]);

function capStatus(model, key) {
  return model?.capabilityEvidence?.capabilities?.[key]?.status ?? "NOT_ASSESSED";
}
function capAvailable(model, key) {
  return AVAILABLE.has(capStatus(model, key));
}

/** Renders a value, or an explicit unavailable state — never a fabricated 0. */
function orUnavailable(value, suffix = "") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value}${suffix}`
    : "Unavailable";
}

function statusChip(status) {
  const cls = {
    [FOUNDATION_STATUS.PASS]: "cap-ok",
    [FOUNDATION_STATUS.ACTION_REQUIRED]: "cap-missing",
    [FOUNDATION_STATUS.NOT_ASSESSED]: "cap-neutral",
    [FOUNDATION_STATUS.NOT_APPLICABLE]: "cap-neutral",
  }[status] || "cap-neutral";
  return `<span class="chip ${cls}">${e(FOUNDATION_STATUS_LABEL[status] || status)}</span>`;
}

// ---------------------------------------------------------------------------
// First Things First — foundational readiness checklist
// ---------------------------------------------------------------------------

export function foundationSection(checklist) {
  const rows = checklist
    .map((i) => {
      const requires = i.status === FOUNDATION_STATUS.NOT_ASSESSED && i.requires
        ? `<br><span class="small">NOT ASSESSED — requires ${e(i.requires)}</span>`
        : "";
      return `<tr>
        <td><strong>${e(i.label)}</strong></td>
        <td>${statusChip(i.status)}</td>
        <td class="small">${e(i.detail)}${requires}</td>
      </tr>`;
    })
    .join("");

  const counts = checklist.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {});

  return `
  <section id="foundations" class="card">
    <h2>First Things First — Foundational Readiness</h2>
    <p class="muted small">Before optimizing content and conversion, these fundamentals need to be in place.
      An item is marked ACTION REQUIRED only when collected evidence proves a deficiency; where evidence was
      not collected it is marked NOT ASSESSED with the source that would be required.</p>
    <p class="muted small">
      ${e(counts[FOUNDATION_STATUS.PASS] || 0)} pass ·
      ${e(counts[FOUNDATION_STATUS.ACTION_REQUIRED] || 0)} action required ·
      ${e(counts[FOUNDATION_STATUS.NOT_ASSESSED] || 0)} not assessed ·
      ${e(counts[FOUNDATION_STATUS.NOT_APPLICABLE] || 0)} not applicable
    </p>
    <div class="table-wrap"><table>
      <thead><tr><th>Foundation</th><th>Status</th><th>What the evidence shows</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

// ---------------------------------------------------------------------------
// E-E-A-T — Experience / Expertise / Authoritativeness / Trust
// ---------------------------------------------------------------------------

const EEAT_DIMENSIONS = [
  {
    key: "Experience",
    signals: [["caseStudies", "case studies or documented outcomes"]],
    risk: "Visitors cannot see evidence that the work produces results.",
    fix: "Publish outcome-based case studies describing the situation, the work, and the result.",
  },
  {
    key: "Expertise",
    signals: [["credentials", "credentials, qualifications, or certifications"]],
    risk: "Prospects cannot confirm who is qualified to deliver the service.",
    fix: "State named credentials and qualifications on the service and about pages.",
  },
  {
    key: "Authoritativeness",
    signals: [["testimonials", "testimonials or client validation"]],
    risk: "There is no independent validation of the claims made on the site.",
    fix: "Add attributed client testimonials next to the relevant service and conversion points.",
  },
  {
    key: "Trust",
    signals: [
      ["contact", "contact information"],
      ["policies", "policy or terms content"],
      ["pricing", "pricing or investment context"],
    ],
    risk: "Visitors lack the reassurance normally needed before making contact.",
    fix: "Publish contact details, policy pages, and clear pricing or an explanation of how cost is determined.",
  },
];

export function eeatSection(model) {
  const site = model?.evidence?.site || {};
  const assessed = capAvailable(model, "trust.proof");
  const trust = site.trust || {};

  const cards = EEAT_DIMENSIONS.map((dim) => {
    if (!assessed) {
      // The v1 report rendered "No … detected" here from a falsy boolean.
      // When trust-proof content was never extracted, the honest state is
      // Not Assessed — absence of evidence is not evidence of absence.
      return `
        <div class="pillar">
          <h4>${e(dim.key)}</h4>
          <p><span class="chip cap-neutral">${e(NOT_ASSESSED)}</span></p>
          <p class="small">Page content was not extracted for this audit, so ${e(dim.key.toLowerCase())} signals could not be evaluated.</p>
        </div>`;
    }
    const found = dim.signals.filter(([flag]) => trust[flag] === true).map(([, label]) => label);
    const absent = dim.signals.filter(([flag]) => trust[flag] !== true).map(([, label]) => label);
    return `
      <div class="pillar">
        <h4>${e(dim.key)}</h4>
        <p class="small"><strong>Found:</strong> ${found.length ? e(found.join("; ")) : "none of the checked signals"}</p>
        <p class="small"><strong>Missing:</strong> ${absent.length ? e(absent.join("; ")) : "none — all checked signals were detected"}</p>
        ${absent.length ? `<p class="small"><strong>Risk:</strong> ${e(dim.risk)}</p>
        <p class="small"><strong>Recommended fix:</strong> ${e(dim.fix)}</p>` : ""}
      </div>`;
  }).join("");

  return `
  <section id="eeat" class="card">
    <h2>E-E-A-T — Trust Readiness Detail</h2>
    <p class="muted small">Assessed from crawled page content only. This is an Omnipressence assessment of observable
      on-page signals, not a Google-issued score.</p>
    <div class="pillar-grid">${cards}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Technical detail
// ---------------------------------------------------------------------------

function techRow(label, assessed, value, note = "") {
  return `<tr>
    <td>${e(label)}</td>
    <td>${assessed ? e(value) : `<span class="chip cap-neutral">${e(NOT_ASSESSED)}</span>`}</td>
    <td class="small">${e(note)}</td>
  </tr>`;
}

export function technicalDetailSection(model) {
  const site = model?.evidence?.site || {};
  const avail = site._metaFieldAvailability || {};
  const contentOk = capAvailable(model, "content.body");
  const headersOk = capAvailable(model, "technical.headers");
  const pages = site.pageCount ?? 0;

  const metadata = [
    techRow("Titles", avail.titles === true, `${site.missingTitles ?? 0} of ${pages} page(s) missing a title`,
      avail.titles === true ? "" : "Title evidence was not collected."),
    techRow("Meta descriptions", avail.descriptions === true, `${site.missingDescriptions ?? 0} of ${pages} page(s) missing a description`,
      avail.descriptions === true ? "" : "Description evidence was not collected."),
    techRow("Canonical URLs", avail.canonicals === true, `${site.missingCanonicals ?? 0} of ${pages} page(s) missing a canonical`,
      avail.canonicals === true ? "" : "Canonical evidence was not collected."),
  ].join("");

  const quality = [
    techRow("Average words per page", contentOk, `${site.averageWords ?? 0}`,
      contentOk ? "" : "Body content was not extracted."),
    techRow("Images missing alt text", contentOk, `${site.imagesMissingAlt ?? 0} of ${site.imageCount ?? 0}`,
      contentOk ? "" : "Image evidence was not extracted."),
  ].join("");

  const links = [
    techRow("Internal links", true, `${site.internalLinkCount ?? 0} detected`, ""),
    techRow("Broken internal links", true, `${(site.brokenInternalLinks || []).length} detected`, ""),
  ].join("");

  // v1 rendered each absent header as "Missing" even when headers were never
  // returned.  Headers are now reported only behind technical.headers.
  const headerNames = ["xFrameOptions", "xContentTypeOptions", "referrerPolicy", "contentSecurityPolicy"];
  const headerRows = headerNames
    .map((name) => {
      const present = site.securityHeaders?.[name] === true;
      return techRow(name, headersOk, present ? "Present" : "Not present in the observed response",
        headersOk ? "" : "Response headers were not returned by the crawl provider.");
    })
    .join("");

  const perfScore = model?.scores?.performance;
  const perfRow = techRow(
    "Performance module score",
    typeof perfScore === "number" && Number.isFinite(perfScore),
    `${perfScore}/100`,
    typeof perfScore === "number" ? "" : "No performance score was produced for this audit.",
  );

  return `
  <section id="technical" class="card">
    <h2>Technical Detail</h2>
    <p class="muted small">Each panel reports only what the crawl actually returned. Where a signal was not
      collected the row reads Not Assessed — it is never reported as a defect.</p>
    <h3>Metadata</h3>
    <div class="table-wrap"><table><thead><tr><th>Signal</th><th>Observed</th><th>Note</th></tr></thead><tbody>${metadata}</tbody></table></div>
    <h3>Page quality</h3>
    <div class="table-wrap"><table><thead><tr><th>Signal</th><th>Observed</th><th>Note</th></tr></thead><tbody>${quality}</tbody></table></div>
    <h3>Link structure</h3>
    <div class="table-wrap"><table><thead><tr><th>Signal</th><th>Observed</th><th>Note</th></tr></thead><tbody>${links}</tbody></table></div>
    <h3>Server &amp; security headers</h3>
    <div class="table-wrap"><table><thead><tr><th>Header</th><th>Observed</th><th>Note</th></tr></thead><tbody>${headerRows}</tbody></table></div>
    <h3>Performance</h3>
    <div class="table-wrap"><table><thead><tr><th>Signal</th><th>Observed</th><th>Note</th></tr></thead><tbody>${perfRow}</tbody></table></div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Heading structure — explicitly scoped to the evaluated page
// ---------------------------------------------------------------------------

export function headingSection(model) {
  const site = model?.evidence?.site || {};
  const page = (site.pages || [])[0];
  const url = page?.crawledUrl || page?.url || site.targetUrl || "";
  const headings = page?.headings || {};
  const collected = site._metaFieldAvailability?.headings === true
    && ["h1", "h2", "h3", "h4"].some((k) => Array.isArray(headings[k]));

  if (!collected) {
    return `
    <section id="headings" class="card">
      <h2>Heading Structure — Evaluated Page</h2>
      <p class="muted small">Scope: this section reports the single evaluated page${url ? ` (${e(url)})` : ""}. It is not a site-wide heading assessment.</p>
      <p><span class="chip cap-neutral">${e(NOT_ASSESSED)}</span> Heading evidence was not collected for this audit.</p>
    </section>`;
  }

  const rows = ["h1", "h2", "h3", "h4"]
    .map((level) => {
      const list = Array.isArray(headings[level]) ? headings[level] : [];
      // An issue is only stated when heading evidence was actually collected.
      const issue = level === "h1"
        ? list.length === 1 ? "Single H1 — correct" : list.length === 0 ? "No H1 on this page" : `${list.length} H1 headings on this page`
        : list.length === 0 ? "None on this page" : `${list.length} detected`;
      return `<tr>
        <td>${e(level.toUpperCase())}</td>
        <td>${e(list.length)}</td>
        <td class="small">${e(list.slice(0, 5).join(" · ")) || "—"}</td>
        <td class="small">${e(issue)}</td>
      </tr>`;
    })
    .join("");

  const siteWide = site._metaFieldAvailability?.headings === true
    ? `<p class="muted small">Across all ${e(site.pageCount ?? 0)} crawled page(s): ${e(site.h1Missing ?? 0)} missing an H1, ${e(site.h1Multiple ?? 0)} with multiple H1s.</p>`
    : "";

  return `
  <section id="headings" class="card">
    <h2>Heading Structure — Evaluated Page</h2>
    <p class="muted small">Scope: the table below reports the single evaluated page${url ? ` (${e(url)})` : ""}. It is not a site-wide heading assessment.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Level</th><th>Count</th><th>Content on this page</th><th>Observation</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${siteWide}
  </section>`;
}

// ---------------------------------------------------------------------------
// Schema / entity — OBSERVED and RECOMMENDED are strictly separated
// ---------------------------------------------------------------------------

const RECOMMENDED_SCHEMA = [
  ["Organization or LocalBusiness", "Identifies the business as an entity to search and AI systems."],
  ["Service", "Describes each service so it can be matched to a specific need."],
  ["Person", "Attributes expertise to a named individual."],
  ["FAQPage", "Marks up buyer questions already answered on the page."],
];

export function schemaSection(model) {
  const site = model?.evidence?.site || {};
  const assessed = capAvailable(model, "schema.structured_data");
  const observed = [...new Set([...(site.schemaTypes || []), ...(site.microdataTypes || [])])];

  const observedBlock = !assessed
    ? `<p><span class="chip cap-neutral">${e(NOT_ASSESSED)}</span> Structured-data evidence was not collected for this audit.</p>`
    : observed.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Type detected on the site</th></tr></thead>
          <tbody>${observed.map((t) => `<tr><td>${e(t)}</td></tr>`).join("")}</tbody>
        </table></div>`
      : `<p class="small">No structured-data types were found on the crawled pages.</p>`;

  const recommendedBlock = `<div class="table-wrap"><table>
      <thead><tr><th>Candidate type</th><th>Why it may help</th></tr></thead>
      <tbody>${RECOMMENDED_SCHEMA.map(([t, why]) => `<tr><td>${e(t)}</td><td class="small">${e(why)}</td></tr>`).join("")}</tbody>
    </table></div>`;

  return `
  <section id="schema" class="card">
    <h2>Schema &amp; Entity Signals</h2>
    <h3>Observed — structured data detected on this site</h3>
    ${observedBlock}
    <h3>Recommended — candidate types not asserted as present</h3>
    <p class="muted small">The types below are suggestions for consideration. They are NOT detections, and none of
      them is claimed to exist on the site.</p>
    ${recommendedBlock}
  </section>`;
}

// ---------------------------------------------------------------------------
// Performance detail — provenance aware, unavailable never becomes zero
// ---------------------------------------------------------------------------

function deviceCard(label, data) {
  if (!data || data.status === "FAILED" || data.status === "UNAVAILABLE") {
    return `
      <div class="pillar">
        <h4>${e(label)}</h4>
        <p class="small">Result: Unavailable${data?.status ? ` (${e(data.status)})` : ""}.
          No score or metric is inferred for this profile.</p>
      </div>`;
  }
  const s = data.scores || {};
  const m = data.metrics || {};
  const provenance = data.isFieldData === true
    ? "Field data (CrUX)"
    : data.isLabData === true
      ? "Lab data"
      : "Provenance not recorded";
  return `
    <div class="pillar">
      <h4>${e(label)}</h4>
      <p class="small">Tested URL: ${e(data.url || "Unavailable")}<br>
        Provider: ${e(data.source || "Unavailable")} · ${e(provenance)}${data.fallbackUsed ? " · fallback used" : ""}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Score</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Performance</td><td>${e(orUnavailable(s.performance))}</td></tr>
          <tr><td>Accessibility</td><td>${e(orUnavailable(s.accessibility))}</td></tr>
          <tr><td>Best Practices</td><td>${e(orUnavailable(s.bestPractices))}</td></tr>
          <tr><td>SEO</td><td>${e(orUnavailable(s.seo))}</td></tr>
        </tbody>
      </table></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Metric</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>FCP</td><td>${e(orUnavailable(m.fcpMs, " ms"))}</td></tr>
          <tr><td>LCP</td><td>${e(orUnavailable(m.lcpMs, " ms"))}</td></tr>
          <tr><td>TBT</td><td>${e(orUnavailable(m.tbtMs, " ms"))}</td></tr>
          <tr><td>CLS</td><td>${e(orUnavailable(m.cls))}</td></tr>
        </tbody>
      </table></div>
    </div>`;
}

export function performanceDetailSection(model) {
  const perf = model?.evidence?.performance;
  if (!perf) {
    return `<section id="performance" class="card"><h2>Performance Detail</h2>
      <p>Unavailable: no performance evidence was collected for this audit.</p></section>`;
  }

  const field = perf.fieldData || {};
  const cruxNote = Object.keys(field).length
    ? `CrUX field data available for: ${Object.keys(field).join(", ")}.`
    : "CrUX field data was not available; lab results remain valid on their own.";

  const pageResults = Array.isArray(perf.pageResults) ? perf.pageResults : [];
  const multiPage = pageResults.length
    ? `<h3>Tested pages (${pageResults.length})</h3>
       <div class="table-wrap"><table>
         <thead><tr><th>URL</th><th>Provider</th><th>Status</th><th>Fallback</th></tr></thead>
         <tbody>${pageResults.slice(0, 15).map((p) => `<tr>
           <td class="small">${e(p.url || "")}</td>
           <td class="small">${e(p.source || "Unavailable")}</td>
           <td class="small">${e(p.sourceStatus || "")}</td>
           <td class="small">${p.fallbackUsed ? "yes" : "no"}</td>
         </tr>`).join("")}</tbody>
       </table></div>`
    : "";

  // An ABSENT diagnostics array means the analysis was not carried into this
  // model — that is Not Assessed, not a clean bill of health.  Only an
  // explicitly empty array proves nothing was raised.
  const collected = Array.isArray(model.renderingDiagnostics);
  const diagnostics = collected ? model.renderingDiagnostics : [];
  const siteRendering = diagnostics.filter((d) => d.diagnosticCategory === "SITE_RENDERING");
  const providerIssues = diagnostics.filter((d) => d.diagnosticCategory !== "SITE_RENDERING");
  const diagnosticBlock = !collected
    ? `<h3>Rendering integrity</h3><p class="small"><span class="chip cap-neutral">${e(NOT_ASSESSED)}</span> Rendering-integrity diagnostics were not included for this audit.</p>`
    : diagnostics.length
      ? `<h3>Rendering integrity</h3>
       <p class="small">${e(siteRendering.length)} site-rendering diagnostic(s); ${e(providerIssues.length)} provider/infrastructure diagnostic(s).</p>
       <ul class="small">${siteRendering.slice(0, 10).map((d) => `<li>${e(d.diagnosticCode)} — ${e(d.clientExplanation || "")} (${e(d.affectedUrl || "")})</li>`).join("")}</ul>`
      : `<h3>Rendering integrity</h3><p class="small">Rendering integrity was assessed and no diagnostic was raised.</p>`;

  return `
  <section id="performance" class="card">
    <h2>Performance Detail</h2>
    <p class="muted small">Source: ${e(perf.provider || perf.source || "Unavailable")}${perf.fallbackUsed ? " · a fallback provider was used" : ""}.
      ${e(cruxNote)} Metrics that were not returned render as Unavailable — they are never reported as zero.</p>
    <div class="pillar-grid">
      ${deviceCard("Mobile", perf.mobile)}
      ${deviceCard("Desktop", perf.desktop)}
    </div>
    ${multiPage}
    ${diagnosticBlock}
    ${(perf.limitations || []).length ? `<h3>Limitations</h3><ul class="small">${perf.limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : ""}
  </section>`;
}

// ---------------------------------------------------------------------------
// Machine readiness — structural readability only, never AI visibility
// ---------------------------------------------------------------------------

export function machineReadinessSection(model) {
  const score = model?.scores?.aiReadiness;
  const value = typeof score === "number" && Number.isFinite(score) ? `${score}/100` : NOT_ASSESSED;
  return `
  <section id="machine-readiness" class="card">
    <h2>Machine Readability</h2>
    <p class="muted small">This measures how readable the site's structure is to automated systems —
      structured data, heading hierarchy, and content depth. It is a structural machine-readability signal
      and is <strong>not</strong> a measurement of whether the site actually appears in, or is retrieved by,
      any AI assistant or AI search product.</p>
    <p><strong>Structural machine-readability score:</strong> ${e(value)}</p>
  </section>`;
}

// ---------------------------------------------------------------------------
// What is already good — assessed positives only
// ---------------------------------------------------------------------------

export function strengthsSection(model, checklist) {
  const site = model?.evidence?.site || {};
  const strengths = [];

  for (const item of checklist || []) {
    if (item.status === FOUNDATION_STATUS.PASS) {
      strengths.push([item.label, item.detail]);
    }
  }

  if (capAvailable(model, "schema.structured_data") && (site.schemaTypes || []).length) {
    strengths.push(["Structured data present", `Detected type(s): ${(site.schemaTypes || []).join(", ")}.`]);
  }

  if (capAvailable(model, "trust.proof")) {
    const found = Object.entries(site.trust || {})
      .filter(([, present]) => present === true)
      .map(([name]) => name);
    if (found.length) {
      strengths.push(["Trust signals detected", `Detected on crawled pages: ${found.join(", ")}.`]);
    }
  }

  const desktop = model?.evidence?.performance?.desktop?.scores?.performance;
  if (typeof desktop === "number" && desktop >= 90) {
    strengths.push(["Desktop performance", `Desktop performance scored ${desktop}/100 in lab testing.`]);
  }

  const brokenLinks = (site.brokenInternalLinks || []).length;
  if ((site.internalLinkCount ?? 0) > 0 && brokenLinks === 0) {
    strengths.push(["Internal links resolve", `${site.internalLinkCount} internal link(s) detected with none broken.`]);
  }

  const body = strengths.length
    ? `<ul class="small">${strengths.map(([label, detail]) => `<li><strong>${e(label)}</strong> — ${e(detail)}</li>`).join("")}</ul>`
    : `<p class="small">No strength could be confirmed from the evidence that was collected. This is a limit of the
        assessed evidence, not a judgement that the site has no strengths.</p>`;

  return `
  <section id="strengths" class="card">
    <h2>What Is Already Good</h2>
    <p class="muted small">Only items whose supporting capability was actually assessed appear here.</p>
    ${body}
  </section>`;
}

// ---------------------------------------------------------------------------
// Client action plan
// ---------------------------------------------------------------------------

const GROUP_INTRO = {
  [ACTION_GROUP.DO_NOW]: "Verified foundations and the highest-confidence conversion work.",
  [ACTION_GROUP.DO_NEXT]: "Material conversion improvements once the items above are in progress.",
  [ACTION_GROUP.LATER]: "Refinement and optimization after the core issues are resolved.",
};

function actionRows(actions) {
  if (!actions.length) return `<p class="small">Nothing in this group from the assessed evidence.</p>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>What we change</th><th>Why</th><th>Class</th><th>Effort</th><th>How we verify it</th></tr></thead>
    <tbody>${actions.map((a) => `<tr>
      <td>${e(a.rank)}</td>
      <td><strong>${e(a.finding.title)}</strong><br><span class="small">${e(a.finding.recommendation || "")}</span></td>
      <td class="small">${e(a.finding.businessImpact || "")}</td>
      <td class="small">${e(a.actionClass)}</td>
      <td class="small">${e(a.effort)}</td>
      <td class="small">${e(a.verificationMethod)}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

export function actionPlanSection(plan, checklist) {
  const groupBlocks = [ACTION_GROUP.DO_NOW, ACTION_GROUP.DO_NEXT, ACTION_GROUP.LATER]
    .map((group) => `<h3>${e(group)}</h3>
      <p class="muted small">${e(GROUP_INTRO[group])}</p>
      ${actionRows(plan.groups[group] || [])}`)
    .join("");

  // MEASURE reuses the verification method already carried on each governed
  // finding — no new expected business result is invented.
  const measures = [...new Set(plan.actions.map((a) => a.verificationMethod).filter(Boolean))];
  const foundationsToFix = (checklist || [])
    .filter((i) => i.status === FOUNDATION_STATUS.ACTION_REQUIRED && i.foundational === true)
    .map((i) => i.label);

  return `
  <section id="action-plan" class="card">
    <h2>Client Action Plan</h2>
    <p class="muted small">Derived from the same governed priorities as Section E. Sequence only — no business
      outcome, revenue figure, or performance projection is stated.</p>
    ${foundationsToFix.length ? `<p class="small"><strong>Foundations to resolve alongside these actions:</strong> ${e(foundationsToFix.join(", "))}.</p>` : ""}
    ${groupBlocks}
    <h3>MEASURE</h3>
    <p class="muted small">Evidence to compare in the next audit:</p>
    ${measures.length
      ? `<ul class="small">${measures.map((m) => `<li>${e(m)}</li>`).join("")}</ul>`
      : `<p class="small">No verification step is available because no score-bearing action was produced.</p>`}
  </section>`;
}

// ---------------------------------------------------------------------------
// Phase 2 scope — explicitly not assessed in this audit
// ---------------------------------------------------------------------------

const PHASE_2_ITEMS = [
  ["Backlinks and referring domains", "Off-site authority evidence"],
  ["Third-party reviews", "Review-platform evidence"],
  ["External entity mentions", "Entity corroboration across external sources"],
  ["Long-term authority growth", "Trend evidence across repeated audits"],
];

export function phase2Section() {
  return `
  <section id="phase2" class="card">
    <h2>Beyond This Audit — Not Assessed in Phase 1</h2>
    <p class="muted small">These areas were outside the scope of this audit. They are listed so the scope is explicit;
      nothing below is a finding, and none of them affects the Conversion Readiness score.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Area</th><th>Evidence that would be required</th><th>Status</th></tr></thead>
      <tbody>${PHASE_2_ITEMS.map(([area, req]) => `<tr><td>${e(area)}</td><td class="small">${e(req)}</td><td><span class="chip cap-neutral">${e(NOT_ASSESSED)}</span></td></tr>`).join("")}</tbody>
    </table></div>
  </section>`;
}

export default {
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
};

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
  return "cap-missing";
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
        <p class="muted">Modules assessed: ${Object.values(model.moduleEligibility || {}).filter(Boolean).length} of ${Object.values(model.moduleEligibility || {}).length}</p>
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

function blockersSection(model) {
  const scoreBearing = (model.findings || [])
    .filter((f) => f.scoreBearing === true)
    .slice(0, 5);
  if (scoreBearing.length === 0) {
    return `<section id="blockers" class="card"><h2>E. What should be fixed first?</h2><p>No score-bearing findings — no prioritized blockers available from the assessed evidence.</p></section>`;
  }
  const rows = scoreBearing
    .map(
      (f, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="mono">${e(f.finalPriority)}</td>
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
      </tr>`,
    )
    .join("");
  return `
  <section id="blockers" class="card">
    <h2>E. What should be fixed first?</h2>
    <div class="table-wrap">
    <table class="blockers">
      <thead><tr>
        <th>#</th><th>Priority</th><th>Problem</th><th>Business consequence</th>
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

function competitorSection(model) {
  const comparisons = model.competitors?.comparisons || [];
  if (comparisons.length === 0) {
    return `<section id="competitors" class="card"><h2>Competitive context</h2><p>No competitor evidence supplied for this assessment.</p></section>`;
  }
  const rows = comparisons
    .map(
      (c) => `
      <tr>
        <td>${e(c.name || c.url || "")}</td>
        <td class="small">${e(c.url || "")}</td>
        <td>${e(c.status || "")}</td>
        <td>${e(c.offerClarity || c.topic || "")}</td>
        <td>${e(c.trustProof || "")}</td>
        <td>${e(c.ctaClarity || "")}</td>
      </tr>`,
    )
    .join("");
  return `
  <section id="competitors" class="card">
    <h2>Competitive context</h2>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Competitor</th><th>URL</th><th>Status</th><th>Offer/topic</th><th>Trust proof</th><th>CTA clarity</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
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
    ${suppressed ? `<h3>Suppressed findings</h3><ul class="small">${suppressed}</ul>` : ""}
  </section>`;
}

function pageShell(model, date, pillars) {
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
    <a href="#executive">Executive</a><a href="#pillars">Pillars</a><a href="#blockers">Fix first</a><a href="#paths">Paths</a><a href="#competitors">Competitors</a><a href="#evidence">Evidence</a>
  </nav>
  ${executiveScorecard(model, pillars)}
  ${pillarSection(pillars)}
  ${blockersSection(model)}
  ${conversionPathSection(model)}
  ${competitorSection(model)}
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
  return pageShell(model, date, pillars);
}

export { computePillars };
export default { renderReportV2, computePillars };

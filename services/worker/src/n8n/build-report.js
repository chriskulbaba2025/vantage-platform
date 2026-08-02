/**
 * Prysm Static HTML Report Builder
 *
 * Assembles a multi-page static HTML report from validated GPT output
 * and the compact Prysm audit payload.
 *
 * Output directory structure:
 *   {outputDir}/
 *     index.html
 *     netlify.toml
 *     css/report.css
 *     pages/01-executive-summary.html
 *     pages/02-priority-fixes.html
 *     ...
 *
 * Usage:
 *   node src/n8n/build-report.js <outputDir>
 *
 * Expects /tmp/vantage-report-input.json with { gpt, payload }
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

const INPUT_PATH = "/tmp/vantage-report-input.json";

// ---------------------------------------------------------------------------
// Shared CSS
// ---------------------------------------------------------------------------

const REPORT_CSS = `:root{--bg:#fafaf9;--card:#fff;--text:#1a1a1a;--muted:#6b6b6b;--border:#e5e5e5;--accent:#2563eb;--accent-light:#dbeafe;--red:#dc2626;--amber:#d97706;--green:#16a34a;--slate:#475569;--radius:8px}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
.container{max-width:960px;margin:0 auto;padding:24px 20px}
header{background:transparent;padding:18px 0 12px}
header .container{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;background:linear-gradient(135deg,#123a72,#2563eb);border-radius:16px;padding:26px 24px;color:#fff}
header h1{font-size:1.75rem;font-weight:800}
header .subtitle{color:rgba(255,255,255,.9);font-size:.9rem;margin-top:8px}
.badge{display:inline-block;padding:5px 12px;border-radius:100px;font-size:.72rem;font-weight:700}
.badge-warn{background:rgba(255,255,255,.18);color:#fff}
.top-nav{position:sticky;top:0;z-index:100;background:var(--bg);border-bottom:1px solid var(--border);margin-bottom:20px}
.top-nav .container{padding:10px 20px}
.nav-list{display:flex;gap:8px;list-style:none;overflow-x:auto}
.nav-list a{display:block;padding:9px 13px;font-size:.78rem;font-weight:700;color:var(--slate);text-decoration:none;border:1px solid var(--border);border-radius:8px;background:var(--card)}
.nav-list a:hover,.nav-list a.active{color:#fff;border-color:var(--accent);background:var(--accent)}
section{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:20px}
section h2{font-size:1.2rem;font-weight:700;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid var(--accent-light)}
.score-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:16px 0}
.score-card{text-align:center;padding:16px;border-radius:var(--radius);border:1px solid var(--border)}
.score-card .value{font-size:2rem;font-weight:700}
.score-card .label{font-size:.8rem;color:var(--muted)}
.score-green .value{color:var(--green)}.score-amber .value{color:var(--amber)}.score-red .value{color:var(--red)}
table{width:100%;border-collapse:collapse;font-size:.9rem;margin:12px 0}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border)}
th{background:#f8fafc;font-weight:600;font-size:.8rem;text-transform:uppercase;color:var(--slate)}
.sev-high{color:var(--red);font-weight:600}.sev-med{color:var(--amber)}.sev-low{color:var(--slate)}
footer{text-align:center;padding:32px 20px;color:var(--muted);font-size:.8rem;border-top:1px solid var(--border);margin-top:40px}
@media(max-width:768px){header .container{flex-direction:column}header h1{font-size:1.45rem}}
@media print{.top-nav,footer button{display:none!important}body{font-size:11pt;color:#000;background:#fff}section{box-shadow:none;border:1px solid #ddd;break-inside:avoid}@page{margin:15mm}}`;

// ---------------------------------------------------------------------------
// Netlify config
// ---------------------------------------------------------------------------

const NETLIFY_TOML = `[build]
  publish = "."

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
`;

// ---------------------------------------------------------------------------
// Page definitions
// ---------------------------------------------------------------------------

const PAGES = [
  { id: "01-executive-summary", title: "Executive Summary", nav: "Summary" },
  { id: "02-priority-fixes", title: "Priority Fixes", nav: "Priorities" },
  { id: "03-performance", title: "Performance & Diagnostics", nav: "Performance" },
  { id: "04-evidence", title: "Evidence & Sources", nav: "Evidence" },
  { id: "05-next-steps", title: "Next Steps", nav: "Next Steps" },
];

// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function pageShell(pageId, title, navLinks, body, footer) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${esc(title)} — Prysm Client Report</title><style>${REPORT_CSS}</style></head><body>
<header><div class="container"><div><span class="badge badge-warn">PRYSM PHASE 1 AUDIT</span><h1>${esc(title)}</h1></div></div></header>
<nav class="top-nav"><div class="container"><ul class="nav-list">${navLinks}</ul></div></nav>
<div class="container">${body}</div>
${footer}
</body></html>`;
}

function navLinks(currentId, business) {
  return PAGES.map(p => {
    const cls = p.id === currentId ? ' class="active"' : '';
    return `<li><a href="${esc(p.id)}.html"${cls}>${esc(p.nav)}</a></li>`;
  }).join("");
}

function footerHtml(business) {
  return `<footer><p>Prysm Client Report for ${esc(business)}</p><p>Generated from evidence-grounded audit. No outcomes are promised without supporting measurement data.</p></footer>`;
}

function scoreCardHtml(label, value) {
  const cls = value >= 80 ? "score-green" : value >= 60 ? "score-amber" : "score-red";
  return `<div class="score-card ${cls}"><div class="value">${value ?? "—"}</div><div class="label">${esc(label)}</div></div>`;
}

function findingsTable(findings) {
  if (!findings || findings.length === 0) return "<p>No findings to display.</p>";
  const rows = findings.map(f =>
    `<tr><td class="sev-${(f.severity||'Medium').toLowerCase().slice(0,3)}">${esc(f.severity||'')}</td><td><strong>${esc(f.ruleId||'')}</strong>: ${esc(f.title||'')}</td><td>${esc(f.recommendation||'')}</td></tr>`
  ).join("");
  return `<table><thead><tr><th>Sev</th><th>Finding</th><th>Recommendation</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Page renderers
// ---------------------------------------------------------------------------

function renderExecutiveSummary(payload) {
  const s = payload.scores || {};
  const b = payload.bands || {};
  return `<section><h2>Conversion Readiness</h2>
<div class="score-grid">${scoreCardHtml("Readiness", s.conversionReadiness)}${scoreCardHtml("Trust", s.trust)}${scoreCardHtml("Content", s.contentDepth)}${scoreCardHtml("Performance", s.performance)}</div>
<p style="margin-top:12px"><strong>Readiness Status:</strong> ${esc(payload.readinessStatus)} (${payload.assessedWeight}% assessed weight)</p>
<p><strong>Confidence:</strong> ${esc(b.evidenceConfidence)} (score: ${payload.evidenceConfidenceScore})</p>
<p style="margin-top:16px">${esc(payload.rootCause||'')}</p>
</section>
<section><h2>Source Status</h2>
<table><thead><tr><th>Source</th><th>Status</th></tr></thead>
<tbody>${Object.entries(payload.sourceStatus||{}).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
</section>`;
}

function renderPriorityFixes(payload) {
  return `<section><h2>Findings by Priority</h2>
${findingsTable(payload.findings)}
</section>
<section><h2>Performance Coverage</h2>
<table><thead><tr><th>Metric</th><th>Value</th></tr></thead>
<tbody>
<tr><td>Tests Requested</td><td>${payload.performanceCoverage?.requested||0}</td></tr>
<tr><td>Tests Completed</td><td>${payload.performanceCoverage?.completed||0}</td></tr>
<tr><td>Tests Failed</td><td>${payload.performanceCoverage?.failed||0}</td></tr>
</tbody></table>
</section>`;
}

function renderPerformance(payload) {
  const diags = payload.renderingDiagnostics || [];
  return `<section><h2>Performance Scores</h2>
<div class="score-grid">${scoreCardHtml("Performance", payload.scores?.performance)}${scoreCardHtml("Technical", payload.scores?.technical)}${scoreCardHtml("Accessibility", payload.scores?.accessibility || "—")}</div>
</section>
<section><h2>Rendering Diagnostics</h2>
${diags.length > 0 ? `<table><thead><tr><th>Code</th><th>Category</th><th>Explanation</th><th>Confidence</th></tr></thead><tbody>${diags.map(d=>`<tr><td>${esc(d.code)}</td><td>${esc(d.category)}</td><td>${esc(d.explanation)}</td><td>${Math.round(d.confidence*100)}%</td></tr>`).join("")}</tbody></table>` : "<p>No rendering defects detected.</p>"}
</section>`;
}

function renderEvidence(payload) {
  return `<section><h2>Technical Metrics</h2>
<table><thead><tr><th>Metric</th><th>Value</th></tr></thead>
<tbody>
<tr><td>Pages Crawled</td><td>${payload.siteMetrics?.pageCount||0}</td></tr>
<tr><td>Missing Titles</td><td>${payload.technical?.missingTitles||0}</td></tr>
<tr><td>Missing Descriptions</td><td>${payload.technical?.missingDescriptions||0}</td></tr>
<tr><td>H1 Missing</td><td>${payload.technical?.h1Missing||0}</td></tr>
<tr><td>Images Missing Alt</td><td>${payload.technical?.imagesMissingAlt||0}</td></tr>
<tr><td>Internal Links</td><td>${payload.technical?.internalLinkCount||0}</td></tr>
</tbody></table>
</section>
<section><h2>Services & Topics</h2>
<p><strong>Services:</strong> ${esc((payload.siteMetrics?.services||[]).join(", "))}</p>
<p><strong>Topics:</strong> ${esc((payload.siteMetrics?.topicKeywords||[]).join(", "))}</p>
</section>
<section><h2>Trust Signals</h2>
<table><thead><tr><th>Signal</th><th>Present</th></tr></thead>
<tbody>${Object.entries(payload.trustFlags||{}).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v?'Yes':'No'}</td></tr>`).join("")}</tbody></table>
</section>
<section><h2>Limitations</h2>
<ul>${(payload.limitations||[]).map(l=>`<li>${esc(l)}</li>`).join("")}</ul>
</section>`;
}

function renderNextSteps(payload) {
  const rec = payload.gateRecommendation || "";
  const next = payload.gateNextAction || "Book an implementation scoping session to determine whether targeted remediation or a full redesign is the better investment.";
  const cats = payload.gateServiceCategories || [];
  return `<section><h2>Commercial Recommendation</h2>
<p style="font-size:1.1rem;margin-bottom:16px">${esc(rec)}</p>
</section>
<section><h2>Required Next Action</h2>
<p style="font-size:1rem;font-weight:600">${esc(next)}</p>
</section>
<section><h2>Service Categories</h2>
<ul>${cats.map(c=>`<li>${esc(c)}</li>`).join("")}</ul>
</section>
<section><h2>Evidence Statement</h2>
<p>This report is generated from a completed Prysm Phase 1 Conversion Readiness Audit. All findings reference specific evidence sources and rule IDs. No outcomes are promised without supporting measurement data. The audit captures a point-in-time assessment and does not guarantee future performance.</p>
</section>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const outputDir = process.argv[2] || "/tmp/vantage-report-output";

  // Read validated GPT output — fall back to raw compact payload if unavailable
  let input = null;
  try { input = JSON.parse(readFileSync(INPUT_PATH, "utf8")); } catch { /* ok */ }
  if (!input) {
    const altPath = process.argv[3];
    if (altPath && existsSync(altPath)) {
      input = { payload: JSON.parse(readFileSync(altPath, "utf8")), gpt: null };
    }
  }
  if (!input || !input.payload) {
    console.error("No input found. Pass payload path as: node build-report.js <outDir> <compactPayload.json>");
    process.exit(1);
  }

  const payload = input.payload || {};
  const business = payload.business?.name || "Client";

  // Build directory structure
  const pagesDir = resolve(outputDir, "pages");
  const cssDir = resolve(outputDir, "css");
  mkdirSync(pagesDir, { recursive: true });
  mkdirSync(cssDir, { recursive: true });

  // Write CSS
  writeFileSync(resolve(cssDir, "report.css"), REPORT_CSS, "utf8");

  // Write netlify.toml
  writeFileSync(resolve(outputDir, "netlify.toml"), NETLIFY_TOML, "utf8");

  // Renderers per page
  const renderers = {
    "01-executive-summary": renderExecutiveSummary,
    "02-priority-fixes": renderPriorityFixes,
    "03-performance": renderPerformance,
    "04-evidence": renderEvidence,
    "05-next-steps": renderNextSteps,
  };

  // Build all pages
  for (const page of PAGES) {
    const renderer = renderers[page.id] || (() => "<section><p>Content coming soon.</p></section>");
    const body = renderer(payload);
    const nav = navLinks(page.id, business);
    const footer = footerHtml(business);
    const html = pageShell(page.id, page.title, nav, body, footer);
    writeFileSync(resolve(pagesDir, page.id + ".html"), html, "utf8");
  }

  // Build index.html
  const indexNav = navLinks("index", business);
  const indexBody = `<section><h2>Prysm Client Report</h2>
<p>This evidence-grounded report was generated from a completed Prysm Phase 1 Conversion Readiness Audit.</p>
<p style="margin-top:12px"><strong>Business:</strong> ${esc(business)}</p>
<p><strong>Domain:</strong> ${esc(payload.business?.domain||'N/A')}</p>
<p><strong>Platform:</strong> ${esc(payload.business?.platform||'Unknown')}</p>
<p><strong>Conversion Readiness:</strong> ${payload.scores?.conversionReadiness ?? '—'}/100</p>
<p><strong>Assessed Weight:</strong> ${payload.assessedWeight ?? '—'}%</p>
</section>
<section><h2>Report Pages</h2>
<ul>${PAGES.map(p=>`<li><a href="pages/${esc(p.id)}.html">${esc(p.title)}</a></li>`).join("")}</ul>
</section>`;
  const indexHtml = pageShell("index", "Prysm Client Report", indexNav, indexBody, footerHtml(business));
  writeFileSync(resolve(outputDir, "index.html"), indexHtml, "utf8");

  console.log(`Report built at ${outputDir}`);
  console.log(`Pages: ${PAGES.length + 1} (including index)`);
}

main();

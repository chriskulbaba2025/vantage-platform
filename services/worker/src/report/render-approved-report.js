import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { e } from "./html-helpers.js";
import { withUnavailableRoadmap } from "./unavailable-roadmap.js";
import {
  scorecard,
  priorityFixes,
  conversionPaths,
  readinessMap,
  contentIdeas,
  competitorBenchmark,
} from "./sections-conversion.js";
import { eeat, cms } from "./sections-trust.js";
import { technical, headings, schema } from "./sections-seo.js";
import { performance, appendix } from "./sections-performance.js";
import { internalLinks } from "./sections-internal-links.js";

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Page definitions — PRD §17.2 sections
// ---------------------------------------------------------------------------

/**
 * Each page maps to a PRD §17.2 report section.
 *
 * Fields:
 *  - pageId:     URL-safe identifier (used as filename: pageId.html)
 *  - title:      Human-readable page title
 *  - secNum:     Section number from PRD §17.2
 *  - sectionId:  HTML section element id (must match what the renderer emits)
 *  - render:     (model) => section HTML string
 */
export const APPROVED_PAGES = Object.freeze([
  { pageId: "scorecard",             title: "Executive Scorecard",                     secNum: "01", sectionId: "executive-conversion-scorecard",       render: scorecard },
  { pageId: "priority-fixes",        title: "Priority Fixes",                          secNum: "02", sectionId: "priority-fixes",                        render: priorityFixes },
  { pageId: "conversion-paths",      title: "Conversion Path Architecture",            secNum: "03", sectionId: "conversion-path-architecture",          render: conversionPaths },
  { pageId: "readiness-map",         title: "Conversion Readiness Map",                secNum: "04", sectionId: "conversion-readiness-map",              render: readinessMap },
  { pageId: "content-ideas",         title: "Topical Map & Qualified Content Opportunities", secNum: "05", sectionId: "topical-map-content-ideas",      render: contentIdeas },
  { pageId: "competitor-benchmark",  title: "Competitor Benchmark",                    secNum: "06", sectionId: "supplied-competitor-benchmark",         render: competitorBenchmark },
  { pageId: "trust-eeat",            title: "Trust & E-E-A-T Readiness",               secNum: "07", sectionId: "e-e-a-t-conversion-trust-readiness",    render: eeat },
  { pageId: "cms-constraints",       title: "CMS & Platform Constraints",              secNum: "08", sectionId: "cms-platform-constraints",              render: cms },
  { pageId: "technical-seo",         title: "Technical SEO Hygiene",                   secNum: "09", sectionId: "technical-seo-hygiene",                 render: technical },
  { pageId: "headings",              title: "Heading & Semantic Structure",            secNum: "10", sectionId: "heading-structure-and-semantic-seo",    render: headings },
  { pageId: "schema",                title: "Schema & Entity Clarity",                 secNum: "11", sectionId: "schema-and-entity-trust",               render: schema },
  { pageId: "performance",           title: "Performance",                             secNum: "12", sectionId: "experience-and-performance",            render: performance },
  { pageId: "internal-links",        title: "Internal-Link Opportunities",             secNum: "13", sectionId: "internal-link-opportunities",           render: internalLinks },
  { pageId: "evidence-appendix",     title: "Evidence Appendix",                       secNum: "14", sectionId: "evidence-appendix",                     render: appendix },
  { pageId: "deferred",              title: "Deferred & Unavailable Analysis",         secNum: "15", sectionId: "deferred-unavailable-analysis",         render: deferredAnalysis },
]);

const PAGE_COUNT = APPROVED_PAGES.length; // 15

// ---------------------------------------------------------------------------
// Deferred & Unavailable Analysis (PRD §17.2 §15)
// ---------------------------------------------------------------------------

function deferredAnalysis(model) {
  const ev = model.evidence;
  const items = [];

  if (ev.ga4?.sourceStatus !== "AVAILABLE") {
    items.push(withUnavailableRoadmap({ area: "Google Analytics 4", status: ev.ga4?.sourceStatus || "UNAVAILABLE", reason: "GA4 was not connected or available.", impact: "Conversion measurement and engagement analysis deferred.", phase: "Continuous Evidence" }, "ga4"));
  }
  if (ev.backlinks?.sourceStatus !== "AVAILABLE") {
    items.push(withUnavailableRoadmap({ area: "Backlink Analysis", status: ev.backlinks?.sourceStatus || "UNAVAILABLE", reason: "Backlink data source was not configured.", impact: "External authority and link-gap analysis deferred.", phase: "Continuous Evidence" }, "backlinks"));
  }
  if (!ev.site?.schemaTypes?.length) {
    items.push(withUnavailableRoadmap({ area: "Rich-Result Validation", status: "UNAVAILABLE", reason: "No structured data was detected on the site.", impact: "Rich-result eligibility cannot be confirmed.", phase: "Post-implementation" }, "structuredData"));
  }
  if (ev.performance?.sourceStatus !== "AVAILABLE" && ev.performance?.sourceStatus !== "PARTIAL") {
    items.push(withUnavailableRoadmap({ area: "Field Performance (CrUX)", status: ev.performance?.sourceStatus || "UNAVAILABLE", reason: "No performance data was available.", impact: "Real-user experience cannot be assessed.", phase: "Continuous Evidence" }, "fieldPerformance"));
  }

  const rows = items.length
    ? items.map((i) => `<tr><td>${e(i.area)}</td><td>${e(i.status)}</td><td>${e(i.reason)}</td><td>${e(i.impact)}</td><td>${e(i.roadmap.requiredInformation)}</td><td>${e(i.roadmap.enablement)}</td><td>${e(i.roadmap.additionalInsight)}</td><td>${e(i.phase)}</td></tr>`).join("")
    : `<tr><td colspan="8">No deferred analysis items — all sources were available.</td></tr>`;

  return `<section id="deferred-unavailable-analysis">
<h2><span class="sec-num">15 /</span> Deferred &amp; Unavailable Analysis</h2>
<p style="font-size:.85rem;color:var(--muted);margin-bottom:16px">Analysis that could not be completed because required data sources were unavailable, not connected, or insufficient. These items do not affect the Conversion Readiness Score.</p>
<table>
<thead><tr><th>Area</th><th>Status</th><th>Reason</th><th>Impact</th><th>Required source / information</th><th>How to enable / collect</th><th>Additional insight enabled</th><th>Available In</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p style="font-size:.8rem;color:var(--muted);margin-top:12px">Items listed here may become available when the required data sources are connected. The Continuous Evidence Layer (Phase 2) can monitor these areas after a baseline exists.</p>
</section>`;
}

// ---------------------------------------------------------------------------
// Shared page chrome
// ---------------------------------------------------------------------------

const PRINT_BUTTON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`;

function renderApprovedHeader(model, date, pageTitle) {
  const site = model.evidence.site;
  const business = model.input.businessName || site.pages[0]?.title || site.domain;
  const readiness = model.scores.conversionReadiness !== null ? `${model.scores.conversionReadiness}/100` : "—";
  return `<header><div class="container"><div><span class="badge badge-warn" style="margin-bottom:10px">APPROVED CLIENT REPORT</span><h1>${e(pageTitle)}</h1><p class="subtitle">${e(business)} &middot; ${e(site.domain)} &middot; ${e(date)}</p></div><div><span class="badge badge-warn">Readiness: ${e(readiness)}</span><p class="subtitle" style="margin-top:4px">Scoring v${e(model.scoringVersion || model.reportVersion)} &middot; Approved</p></div></div></header>`;
}

function renderPrintButton() {
  return `<div class="print-button-container no-print" style="text-align:right;padding:0 20px;margin-top:-8px;margin-bottom:12px">
<button class="print-page-btn no-print" onclick="window.print()" style="display:inline-flex;align-items:center;gap:8px;padding:10px 22px;font-size:.88rem;font-weight:600;color:#fff;background:linear-gradient(135deg,#123a72 0%,#2563eb 100%);border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,.25);transition:all .15s"
  onmouseover="this.style.boxShadow='0 4px 14px rgba(37,99,235,.35)';this.style.transform='translateY(-1px)'"
  onmouseout="this.style.boxShadow='0 2px 8px rgba(37,99,235,.25)';this.style.transform='none'"
  aria-label="Print or save this page as PDF">
  ${PRINT_BUTTON_SVG}
  Print or save this page as PDF
</button>
<p class="no-print" style="font-size:.72rem;color:var(--muted);margin:6px 0 0 0">Uses your browser&rsquo;s print dialog. No server-generated file is created.</p>
</div>`;
}

function renderApprovedFooter(model, date) {
  const site = model.evidence.site;
  const business = model.input.businessName || site.pages[0]?.title || site.domain;
  return `<footer><p>Prysm Phase 1 Audit — Conversion Readiness</p><p>${e(business)} &middot; ${e(site.domain)} &middot; ${e(date)}</p><p style="margin-top:8px">Report by Omnipressence &middot; Approved for client delivery</p></footer>`;
}

function renderNav(currentPageId) {
  const links = APPROVED_PAGES.map((p) => {
    const active = p.pageId === currentPageId ? ' style="background:var(--accent);border-color:var(--accent);color:#fff"' : "";
    return `<li><a href="${e(p.pageId)}.html"${active}>${e(p.title)}</a></li>`;
  }).join("");

  return `<nav class="top-nav no-print" id="topNav"><div class="container"><ul class="nav-list" id="navList">${links}</ul></div></nav>`;
}

// ---------------------------------------------------------------------------
// CSS (embedded — matches locked template)
// ---------------------------------------------------------------------------

const SHARED_CSS = `:root{--bg:#fafaf9;--card:#fff;--text:#1a1a1a;--muted:#6b6b6b;--border:#e5e5e5;--accent:#2563eb;--accent-light:#dbeafe;--red:#dc2626;--red-light:#fef2f2;--amber:#d97706;--amber-light:#fffbeb;--green:#16a34a;--green-light:#f0fdf4;--slate:#475569;--radius:8px}*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}.container{max-width:960px;margin:0 auto;padding:24px 20px}
header{background:transparent;border-bottom:0;padding:18px 0 12px;margin-bottom:0}header .container{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;background:linear-gradient(135deg,#123a72 0%,#184fb5 52%,#2563eb 100%);border-radius:16px;padding:26px 24px;color:#fff;box-shadow:0 8px 22px rgba(37,99,235,.18)}header h1{font-size:1.75rem;font-weight:800;line-height:1.12;letter-spacing:-.02em;color:#fff;max-width:720px}header .subtitle{color:rgba(255,255,255,.9);font-size:.9rem;margin-top:8px}.badge{display:inline-block;padding:5px 12px;border-radius:100px;font-size:.72rem;font-weight:700;letter-spacing:.02em}.badge-warn{background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.24)}
.top-nav{position:sticky;top:0;z-index:100;background:var(--bg);border-bottom:1px solid var(--border);box-shadow:0 1px 4px rgba(0,0,0,.04);margin-bottom:20px}.top-nav .container{padding:10px 20px}.nav-list{display:flex;gap:8px;list-style:none;margin:0;padding:0 0 2px 0;overflow-x:auto;-webkit-overflow-scrolling:touch;scroll-behavior:smooth}.nav-list li{flex-shrink:0}.nav-list a{display:block;padding:9px 13px;font-size:.78rem;font-weight:700;color:var(--slate);text-decoration:none;white-space:nowrap;border:1px solid var(--border);border-radius:8px;background:var(--card);box-shadow:0 1px 2px rgba(0,0,0,.05);transition:all .15s}.nav-list a:hover{color:#fff;border-color:var(--accent);background:var(--accent)}.nav-list a[aria-current="page"]{background:var(--accent);border-color:var(--accent);color:#fff}
section{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.06)}section h2{font-size:1.2rem;font-weight:700;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid var(--accent-light)}section h2 .sec-num{font-size:.75rem;color:var(--muted);font-weight:400;letter-spacing:.5px}section h3{font-size:1rem;font-weight:600;margin:16px 0 8px;color:var(--slate)}section h4{font-size:.9rem;font-weight:600;margin:12px 0 6px;color:var(--slate)}.score-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:16px 0}.score-card{text-align:center;padding:16px;border-radius:var(--radius);border:1px solid var(--border)}.score-card .value{font-size:2rem;font-weight:700}.score-card .label{font-size:.8rem;color:var(--muted);margin-top:4px}.score-red .value{color:var(--red)}.score-amber .value{color:var(--amber)}.score-green .value{color:var(--green)}table{width:100%;border-collapse:collapse;font-size:.9rem;margin:12px 0}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border)}th{background:#f8fafc;font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.5px;color:var(--slate)}tr:hover{background:#fafafa}.severity-high{color:var(--red);font-weight:600}.severity-medium{color:var(--amber);font-weight:600}.severity-low{color:var(--slate);font-weight:600}ul,ol{margin-left:20px;margin-top:8px}li{margin-bottom:4px}.note{background:var(--amber-light);border-left:3px solid var(--amber);padding:12px 16px;margin:16px 0;border-radius:0 var(--radius) var(--radius) 0;font-size:.9rem}.confidence-note{background:var(--accent-light);border-left:3px solid var(--accent);border-radius:var(--radius);padding:16px;margin:16px 0;font-size:.9rem}.confidence-note h3{font-size:.95rem;margin-top:0;color:var(--accent)}.hygiene-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin:16px 0}.hygiene-card{border:1px solid var(--border);border-radius:var(--radius);padding:16px;background:#fafdf9}.hygiene-card h4{font-size:.9rem;font-weight:700;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid var(--accent-light)}.hygiene-card .metric{font-size:.8rem;padding:3px 0;color:var(--slate)}.hygiene-card .tag{display:inline-block;font-size:.65rem;padding:1px 6px;border-radius:3px;background:#e5e7eb;color:var(--slate);margin-right:4px}.eeat-grid-2x2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.eeat-card{border:1px solid var(--border);border-radius:var(--radius);padding:16px}.eeat-card h4{font-size:.9rem;font-weight:700;margin-bottom:8px}.eeat-found{color:var(--green);font-size:.85rem}.eeat-missing{color:var(--red);font-size:.85rem}.eeat-weak{border-left:3px solid var(--red)}.eeat-constrained{border-left:3px solid var(--amber)}.path-clear{color:var(--green);font-weight:600}.path-weak{color:var(--amber);font-weight:600}.path-missing{color:var(--red);font-weight:600}.p1-tag{display:inline-block;padding:2px 8px;border-radius:3px;font-size:.7rem;font-weight:600;background:var(--green-light);color:var(--green)}.p2-tag{display:inline-block;padding:2px 8px;border-radius:3px;font-size:.7rem;font-weight:600;background:#f1f5f9;color:var(--slate)}.finding-list{list-style:none;margin-left:0}.finding-list li{padding:8px 12px;margin-bottom:6px;border-radius:6px;border:1px solid var(--border);font-size:.9rem}.finding-list li.high{border-left:3px solid var(--red);background:var(--red-light)}.finding-list li.medium{border-left:3px solid var(--amber);background:var(--amber-light)}.finding-list li.low{border-left:3px solid var(--slate)}footer{text-align:center;padding:32px 20px;color:var(--muted);font-size:.8rem;border-top:1px solid var(--border);margin-top:40px}footer p{margin:4px 0}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.section-nav{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:20px;padding:16px 0;border-top:1px solid var(--border)}.section-nav button{padding:10px 20px;font-size:.85rem;font-weight:600;color:#fff;background:var(--accent);border:none;border-radius:8px;cursor:pointer;transition:all .15s;box-shadow:0 2px 6px rgba(37,99,235,.2)}.section-nav button:hover{background:#1d4ed8;box-shadow:0 4px 12px rgba(37,99,235,.3);transform:translateY(-1px)}.section-nav button:disabled{background:var(--border);color:var(--muted);cursor:default;box-shadow:none;transform:none}.section-nav .position{font-size:.82rem;color:var(--muted);font-weight:500}
@media(max-width:768px){header .container{flex-direction:column;border-radius:12px;padding:22px 18px}header h1{font-size:1.45rem}.top-nav .container{padding:8px 12px}.nav-list{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch}.nav-list a{padding:9px 11px;font-size:.74rem}.eeat-grid-2x2{grid-template-columns:1fr}.two-col{grid-template-columns:1fr}.hygiene-grid{grid-template-columns:1fr}.section-nav{flex-wrap:wrap;gap:8px}.section-nav button{flex:1;min-width:100px}}
@media(max-width:640px){section{padding:16px}.score-grid{grid-template-columns:1fr 1fr}}
@media print{
  .top-nav,.section-nav,.print-button-container,footer button,.no-print{display:none!important}
  section{display:block!important;break-inside:avoid;page-break-inside:avoid;box-shadow:none;border:1px solid #ddd;margin-bottom:12px;padding:16px}
  section:not(:first-of-type){page-break-before:always}
  body{font-size:11pt;color:#000;background:#fff}
  header .container{background:#fff!important;color:#000!important;box-shadow:none!important;border:1px solid #ccc!important;padding:16px 0!important}
  header h1,header .subtitle,.badge-warn{color:#000!important}
  .badge-warn{background:#eee!important;border:1px solid #999!important}
  .container{max-width:100%;padding:0}
  table{font-size:9pt}th,td{padding:6px 8px}th{background:#eee;color:#000}
  .score-card{border-color:#999}.score-card .value{color:#000!important}
  .note,.confidence-note{background:#f9f9f9;border-left-color:#999}
  .severity-high{color:#000!important;font-weight:700}.severity-medium{color:#000!important}.severity-low{color:#666!important}
  a{color:#000;text-decoration:underline}
  .finding-list li.high,.finding-list li.medium,.finding-list li.low{background:#fff;border-left-color:#999}
  .hygiene-card{background:#fff;border-color:#ddd}
  .eeat-card{background:#fff;border-color:#ddd}.eeat-weak,.eeat-constrained{border-left-color:#999}
  @page{margin:15mm}
  h2,h3,h4{page-break-after:avoid}
  tr{page-break-inside:avoid}
}`;

// ---------------------------------------------------------------------------
// Page builder
// ---------------------------------------------------------------------------

/**
 * Build a single approved page as a standalone HTML document.
 */
function buildApprovedPage(model, pageDef, date) {
  const sectionHtml = pageDef.render(model);
  const title = `Prysm Phase 1 —${pageDef.title} | ${model.input.businessName || model.evidence.site.domain}`;

  // Validate the rendered section includes the expected id
  if (!sectionHtml.includes(`id="${pageDef.sectionId}"`)) {
    throw new Error(`Section renderer for "${pageDef.pageId}" did not produce expected id="${pageDef.sectionId}"`);
  }

  return `<!DOCTYPE html>
<html lang="en-CA">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${e(title)}</title>
<style>${SHARED_CSS}</style>
</head>
<body>
${renderApprovedHeader(model, date, pageDef.title)}
${renderPrintButton()}
${renderNav(pageDef.pageId)}
<div class="container">
${sectionHtml}
</div>
${renderApprovedFooter(model, date)}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Index page builder
// ---------------------------------------------------------------------------

function buildIndexPage(model, date) {
  const site = model.evidence.site;
  const business = model.input.businessName || site.pages[0]?.title || site.domain;
  const readiness = model.scores.conversionReadiness !== null ? `${model.scores.conversionReadiness}/100` : "—";
  const title = `Prysm Phase 1 Audit — Approved Report | ${business}`;

  const pageLinks = APPROVED_PAGES.map((p) =>
    `<li style="margin-bottom:8px"><a href="${e(p.pageId)}.html" style="font-weight:600;font-size:1rem">${e(p.secNum)}. ${e(p.title)}</a></li>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="en-CA">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${e(title)}</title>
<style>${SHARED_CSS}
.index-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin:20px 0}
.index-card{border:1px solid var(--border);border-radius:var(--radius);padding:16px;background:var(--card);transition:all .15s}
.index-card:hover{border-color:var(--accent);box-shadow:0 2px 8px rgba(37,99,235,.1)}
.index-card a{text-decoration:none;color:var(--text);display:block}
.index-card .num{font-size:.75rem;color:var(--muted);font-weight:400;letter-spacing:.5px}
.index-card .label{font-size:.95rem;font-weight:600;margin-top:4px}
</style>
</head>
<body>
<header><div class="container"><div><span class="badge badge-warn" style="margin-bottom:10px">APPROVED CLIENT REPORT</span><h1>Prysm Phase 1 Audit — Conversion Readiness</h1><p class="subtitle">${e(business)} &middot; ${e(site.domain)} &middot; ${e(date)}</p></div><div><span class="badge badge-warn">Readiness: ${e(readiness)}</span><p class="subtitle" style="margin-top:4px">Scoring v${e(model.scoringVersion || model.reportVersion)} &middot; Approved</p></div></div></header>

<div class="print-button-container no-print" style="text-align:right;padding:0 20px;margin-top:-8px;margin-bottom:12px">
<button class="print-page-btn no-print" onclick="window.print()" style="display:inline-flex;align-items:center;gap:8px;padding:10px 22px;font-size:.88rem;font-weight:600;color:#fff;background:linear-gradient(135deg,#123a72 0%,#2563eb 100%);border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,.25)">
${PRINT_BUTTON_SVG}
Print or save this page as PDF
</button>
<p class="no-print" style="font-size:.72rem;color:var(--muted);margin:6px 0 0 0">Uses your browser&rsquo;s print dialog. No server-generated file is created.</p>
</div>

<nav class="top-nav no-print"><div class="container"><ul class="nav-list">${APPROVED_PAGES.map((p) => `<li><a href="${e(p.pageId)}.html">${e(p.title)}</a></li>`).join("")}</ul></div></nav>

<div class="container">
<section id="report-index">
<h2><span class="sec-num">Approved Report</span> Contents</h2>
<p style="margin-bottom:16px">This approved Vantage Phase 1 audit consists of ${PAGE_COUNT} individual pages. Each page can be printed or saved as a PDF using your browser&rsquo;s print dialog.</p>
<div class="index-grid">${APPROVED_PAGES.map((p) => `<div class="index-card"><a href="${e(p.pageId)}.html"><div class="num">${e(p.secNum)}</div><div class="label">${e(p.title)}</div></a></div>`).join("")}</div>
</section>
</div>

<footer><p>Prysm Phase 1 Audit — Conversion Readiness</p><p>${e(business)} &middot; ${e(site.domain)} &middot; ${e(date)}</p><p style="margin-top:8px">Report by Omnipressence &middot; Approved for client delivery</p></footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Render the approved multi-page report.
 *
 * Returns { pages: Map<filename, htmlString>, indexHtml: string, filenames: string[] }
 *
 * - pages:       "scorecard.html" → full HTML, etc.
 * - indexHtml:   "index.html" content
 * - filenames:   ["index.html", "scorecard.html", ...] (all files to write)
 *
 * Validation: every page must include its expected section id.
 * If any section renderer fails or produces the wrong section, the
 * entire function throws — the caller MUST NOT write partial results.
 */
export function renderApprovedReport(model) {
  const date = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto",
  }).format(new Date(model.generatedAt));

  const pages = new Map();
  const filenames = ["index.html"];

  // Validate all sections upfront before building pages
  const errors = [];
  for (const pageDef of APPROVED_PAGES) {
    try {
      const sectionHtml = pageDef.render(model);
      if (!sectionHtml || typeof sectionHtml !== "string") {
        errors.push(`${pageDef.pageId}: renderer returned non-string`);
      } else if (!sectionHtml.includes(`id="${pageDef.sectionId}"`)) {
        errors.push(`${pageDef.pageId}: rendered section missing id="${pageDef.sectionId}"`);
      }
    } catch (err) {
      errors.push(`${pageDef.pageId}: ${err.message}`);
    }
  }

  if (errors.length) {
    throw new Error(`Approved report validation failed: ${errors.join("; ")}`);
  }

  // Build all pages
  for (const pageDef of APPROVED_PAGES) {
    const filename = `${pageDef.pageId}.html`;
    const html = buildApprovedPage(model, pageDef, date);
    pages.set(filename, html);
    filenames.push(filename);
  }

  // Build index
  const indexHtml = buildIndexPage(model, date);
  pages.set("index.html", indexHtml);

  return { pages, indexHtml, filenames };
}

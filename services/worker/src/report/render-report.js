import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { e } from "./html-helpers.js";
import { scorecard, priorityFixes, conversionPaths, readinessMap, contentIdeas, competitorBenchmark } from "./sections-conversion.js";
import { eeat, cms } from "./sections-trust.js";
import { technical, headings, schema } from "./sections-seo.js";
import { performance, appendix } from "./sections-performance.js";

const here = dirname(fileURLToPath(import.meta.url));

function renderHeader(model, date) {
  const site = model.evidence.site;
  const business = model.input.businessName || site.pages[0]?.title || site.domain;
  return `<header><div class="container"><div><span class="badge badge-warn" style="margin-bottom:10px">OFFLINE STRATEGIC REPORT DASHBOARD</span><h1>Vantage Phase 1 Audit — Conversion Readiness</h1><p class="subtitle">${e(business)} &middot; ${e(site.domain)} &middot; ${e(date)}</p></div><div><span class="badge badge-warn">Conversion Readiness: ${e(model.scores.conversionReadiness)}/100</span><p class="subtitle" style="margin-top:4px">${e(model.input.location || "Location not supplied")} &middot; ${e(model.input.language || site.pages[0]?.language || "en-CA")}</p></div></div></header>`;
}

function renderFooter(model, date) {
  const site = model.evidence.site;
  const business = model.input.businessName || site.pages[0]?.title || site.domain;
  return `<footer><p>Vantage Phase 1 Audit — Conversion Readiness</p><p>${e(business)} &middot; ${e(site.domain)} &middot; ${e(date)}</p><p style="margin-top:8px">Report by Omnipressence</p></footer>`;
}

/**
 * Render the print-to-PDF button. Only shown on approved client-facing reports.
 * Uses browser-native window.print() with @media print CSS in the template.
 */
function renderPrintButton(model, isApproved) {
  if (!isApproved) return "";

  const date = model.generatedAt
    ? new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" }).format(new Date(model.generatedAt))
    : "";
  const business = model.input?.businessName || model.evidence?.site?.domain || "";
  const scoringVersion = model.scoringVersion || model.reportVersion || "";

  return `<div class="print-button-container" style="text-align:right;padding:0 20px;margin-top:-8px;margin-bottom:12px">
<button class="print-page-btn no-print" onclick="window.print()" style="display:inline-flex;align-items:center;gap:8px;padding:10px 22px;font-size:.88rem;font-weight:600;color:#fff;background:linear-gradient(135deg,#123a72 0%,#2563eb 100%);border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,.25);transition:all .15s"
  onmouseover="this.style.boxShadow='0 4px 14px rgba(37,99,235,.35)';this.style.transform='translateY(-1px)'"
  onmouseout="this.style.boxShadow='0 2px 8px rgba(37,99,235,.25)';this.style.transform='none'"
  aria-label="Print or save this page as PDF">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
  Print or save this page as PDF
</button>
<p class="no-print" style="font-size:.72rem;color:var(--muted);margin:6px 0 0 0">Uses your browser&rsquo;s print dialog. No server-generated file is created.</p>
</div>`;
}

export async function renderReport(model, options = {}) {
  const template = await readFile(options.templatePath || resolve(here, "karen-leslie-template.html"), "utf8");
  const date = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" }).format(new Date(model.generatedAt));
  const sections = [scorecard(model), priorityFixes(model), conversionPaths(model), readinessMap(model), contentIdeas(model), competitorBenchmark(model), eeat(model), cms(model), technical(model), headings(model), schema(model), performance(model), appendix(model)].join("\n");
  const title = `Vantage Phase 1 Audit — Conversion Readiness | ${model.input.businessName || model.evidence.site.domain}`;
  const isApproved = options.isApproved === true;

  const html = template
    .replace("{{TITLE}}", e(title))
    .replace("{{HEADER}}", renderHeader(model, date))
    .replace("{{PRINT_BUTTON}}", renderPrintButton(model, isApproved))
    .replace("{{SECTIONS}}", sections)
    .replace("{{FOOTER}}", renderFooter(model, date));

  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error("Report template contains unresolved tokens");
  for (const id of ["executive-conversion-scorecard", "priority-fixes", "conversion-path-architecture", "conversion-readiness-map", "topical-map-content-ideas", "supplied-competitor-benchmark", "e-e-a-t-conversion-trust-readiness", "cms-platform-constraints", "technical-seo-hygiene", "heading-structure-and-semantic-seo", "schema-and-entity-trust", "experience-and-performance", "evidence-appendix"]) {
    if (!html.includes(`id="${id}"`)) throw new Error(`Rendered report missing section ${id}`);
  }
  return html;
}

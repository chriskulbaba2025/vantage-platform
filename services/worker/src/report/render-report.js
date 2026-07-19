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

export async function renderReport(model, options = {}) {
  const template = await readFile(options.templatePath || resolve(here, "karen-leslie-template.html"), "utf8");
  const date = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" }).format(new Date(model.generatedAt));
  const sections = [scorecard(model), priorityFixes(model), conversionPaths(model), readinessMap(model), contentIdeas(model), competitorBenchmark(model), eeat(model), cms(model), technical(model), headings(model), schema(model), performance(model), appendix(model)].join("\n");
  const title = `Vantage Phase 1 Audit — Conversion Readiness | ${model.input.businessName || model.evidence.site.domain}`;
  const html = template.replace("{{TITLE}}", e(title)).replace("{{HEADER}}", renderHeader(model, date)).replace("{{SECTIONS}}", sections).replace("{{FOOTER}}", renderFooter(model, date));
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error("Report template contains unresolved tokens");
  for (const id of ["executive-conversion-scorecard", "priority-fixes", "conversion-path-architecture", "conversion-readiness-map", "topical-map-content-ideas", "supplied-competitor-benchmark", "e-e-a-t-conversion-trust-readiness", "cms-platform-constraints", "technical-seo-hygiene", "heading-structure-and-semantic-seo", "schema-and-entity-trust", "experience-and-performance", "evidence-appendix"]) {
    if (!html.includes(`id="${id}"`)) throw new Error(`Rendered report missing section ${id}`);
  }
  return html;
}

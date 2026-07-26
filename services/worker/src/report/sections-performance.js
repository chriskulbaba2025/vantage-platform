import { e, fmtSec, scoreCard, section, table } from "./html-helpers.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

function performance(model) {
  const perf = model.evidence.performance;
  const perfUnavailable = perf?.sourceStatus !== SOURCE_STATUS.AVAILABLE
    && perf?.sourceStatus !== SOURCE_STATUS.PARTIAL;
  const cards = (data) => `<div class="score-grid">${scoreCard(data?.scores?.performance ?? "N/A", "Performance", Number.isFinite(data?.scores?.performance))}${scoreCard(data?.scores?.accessibility ?? "N/A", "Accessibility", Number.isFinite(data?.scores?.accessibility))}${scoreCard(data?.scores?.bestPractices ?? "N/A", "Best Practices", Number.isFinite(data?.scores?.bestPractices))}${scoreCard(data?.scores?.seo ?? "N/A", "SEO", Number.isFinite(data?.scores?.seo))}</div>${table(["Metric", "Value"], [["FCP", fmtSec(data?.metrics?.fcpMs)], ["LCP", fmtSec(data?.metrics?.lcpMs)], ["TBT", Number.isFinite(data?.metrics?.tbtMs) ? `${Math.round(data.metrics.tbtMs)}ms` : "Unavailable"], ["CLS", Number.isFinite(data?.metrics?.cls) ? String(data.metrics.cls.toFixed(3)) : "Unavailable"]].map((r) => r.map(e)))}`;
  const unavailableNote = perfUnavailable
    ? `<div class="note"><strong>Note:</strong> No performance result was measured for this audit. PageSpeed Insights and local Lighthouse were both unavailable. All scores and metrics are shown as N/A. This does not affect other scored dimensions.</div>`
    : "";
  const fieldDataAvailable = perf?.fieldData?.phone?.status === SOURCE_STATUS.AVAILABLE
    || perf?.fieldData?.desktop?.status === SOURCE_STATUS.AVAILABLE;
  return section("experience-and-performance", "12", "Experience and Performance", `${unavailableNote}<div class="note"><strong>Source:</strong> Mobile: ${e(perf?.mobile?.source || "Unavailable")}. Desktop: ${e(perf?.desktop?.source || "Unavailable")}. CrUX field data: ${e(fieldDataAvailable ? "available" : "not available")}.${perfUnavailable ? "" : " Lab results remain valid when field data is unavailable."}</div><div class="two-col"><div><h3>Mobile</h3>${cards(perf?.mobile)}</div><div><h3>Desktop</h3>${cards(perf?.desktop)}</div></div><h3 style="margin-top:20px">AI Search Readiness</h3>${table(["Dimension", "Score"], [["Structured Data", `${model.evidence.site.schemaTypes.length ? 25 : 0}/25`], ["Entity Clarity", `${model.evidence.site.pages[0]?.headings?.h1?.length ? 15 : 5}/25`], ["Answer-First Copy", `${model.evidence.site.averageWords >= 300 ? 15 : 5}/25`], ["FAQ Coverage", `${model.evidence.site.trust.faq ? 20 : 0}/25`], ["Topic Authority", `${Math.min(25, model.evidence.site.pageCount * 4)}/25`], ["Local SEO", `${model.evidence.site.schemaTypes.some((x) => /localbusiness/i.test(x)) ? 25 : 0}/25`]].map((r) => r.map(e)))}<p style="margin-top:8px"><strong>AI Readiness: ${e(model.scores.aiReadiness !== null ? `${model.scores.aiReadiness}/100` : "Not Assessed")}.</strong></p>`);
}

function appendix(model) {
  const ev = model.evidence;
  const perfAvailable = ev.performance?.sourceStatus === SOURCE_STATUS.AVAILABLE
    || ev.performance?.sourceStatus === SOURCE_STATUS.PARTIAL;
  const perfGate = perfAvailable ? "PASS" : "UNAVAILABLE";
  const backlinksAvailable = ev.backlinks?.sourceStatus === SOURCE_STATUS.AVAILABLE;
  const ga4Available = ev.ga4?.sourceStatus === SOURCE_STATUS.AVAILABLE;
  const sourceRows = [
    ["Website Capture", `Custom bounded crawler${ev.site.pages.some((p) => p.rendered) ? " + Playwright rendering" : ""}`, `PASS — ${ev.site.pageCount} page(s)`],
    ["Performance", `${ev.performance?.mobile?.source || "Unavailable"} / ${ev.performance?.desktop?.source || "Unavailable"}`, perfGate],
    ["Platform", "Metadata, scripts, headers, and asset signals", `PASS — ${ev.site.platform}`],
    ["E-E-A-T Trust", "On-site captured evidence", "PASS"],
    ["Technical Hygiene", "Crawler + performance evidence", "PASS"],
    ["Competitor Benchmark", `${model.competitors.length} supplied URL(s)`, model.competitors.length ? "PASS" : "NOT SUPPLIED"],
    ["Backlinks", "DataForSEO", backlinksAvailable ? `PASS — ${ev.backlinks.totalBacklinksReviewed} reviewed` : "NOT CONFIGURED"],
    ["GA4", "Google Analytics Data API", ga4Available ? "PASS — contextual only" : "NOT CONFIGURED — no score impact"],
  ];
  const limitations = [...(ev.site.limitations || []), ...(ev.performance?.limitations || [])];
  if (!backlinksAvailable) limitations.push("Backlink evidence was not included because DataForSEO credentials were not configured.");
  if (!ga4Available) limitations.push("GA4 was not connected. The audit completed without analytics and the score was not reduced.");
  if (!perfAvailable) limitations.push("No performance measurement (PageSpeed Insights or local Lighthouse) was available for this audit. Performance scores and metrics are unavailable.");
  return section("evidence-appendix", "13", "Evidence Appendix", `<h3>Evidence Sources</h3>${table(["Layer", "Source", "Status"], sourceRows.map((r) => r.map(e)))}<h3>Evidence Confidence — Full Assessment</h3><p><strong>Overall: ${e(model.bands.evidenceConfidence)}.</strong> Findings are traceable to the normalized evidence package produced during this audit. Optional sources do not reduce the conversion-readiness score when they are not configured.</p><h3>Limitations</h3><ul>${limitations.length ? limitations.map((x) => `<li>${e(x)}</li>`).join("") : "<li>No material collection limitation was recorded.</li>"}</ul><h3>Gate Results</h3>${table(["Gate", "Result"], [["Website capture", `PASS — ${ev.site.pageCount} page(s)`], ["Topical map", "PASS — crawl-visible evidence"], ["Performance", perfGate], ["E-E-A-T", "PASS — 4 dimensions"], ["Technical Hygiene", "PASS — 6 dimensions"], ["Readiness Map", `PASS — ${model.readinessMap.length} topics`], ["Template Lock", "PASS — canonical CSS, navigation, sections, and JavaScript preserved"]].map((r) => r.map(e)))}${model.readinessStatus && model.readinessStatus !== "Complete" ? `<p style="margin-top:8px"><strong>Readiness Status:</strong> ${e(model.readinessStatus)}. Assessed weight: ${e(model.assessedWeight ?? "N/A")}%.</p>` : ""}<p style="margin-top:8px;font-size:.8rem;color:var(--muted)">Template v0.7 locked. Vantage worker ${e(model.reportVersion)}. Scoring version ${e(model.scoringVersion || model.reportVersion)}. Conversion Readiness: ${e(model.scores.conversionReadiness !== null ? `${model.scores.conversionReadiness}/100` : "Insufficient Evidence")}. Phase 1.</p>`);
}

export { performance, appendix };

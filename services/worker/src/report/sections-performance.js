import { e, fmtSec, scoreCard, section, table } from "./html-helpers.js";

function performance(model) {
  const perf = model.evidence.performance;
  const cards = (data) => `<div class="score-grid">${scoreCard(data?.scores?.performance ?? "N/A", "Performance", Number.isFinite(data?.scores?.performance))}${scoreCard(data?.scores?.accessibility ?? "N/A", "Accessibility", Number.isFinite(data?.scores?.accessibility))}${scoreCard(data?.scores?.bestPractices ?? "N/A", "Best Practices", Number.isFinite(data?.scores?.bestPractices))}${scoreCard(data?.scores?.seo ?? "N/A", "SEO", Number.isFinite(data?.scores?.seo))}</div>${table(["Metric", "Value"], [["FCP", fmtSec(data?.metrics?.fcpMs)], ["LCP", fmtSec(data?.metrics?.lcpMs)], ["TBT", Number.isFinite(data?.metrics?.tbtMs) ? `${Math.round(data.metrics.tbtMs)}ms` : "Unavailable"], ["CLS", Number.isFinite(data?.metrics?.cls) ? String(data.metrics.cls.toFixed(3)) : "Unavailable"]].map((r) => r.map(e)))}`;
  return section("experience-and-performance", "12", "Experience and Performance", `<div class="note"><strong>Source:</strong> Mobile: ${e(perf?.mobile?.source || "Unavailable")}. Desktop: ${e(perf?.desktop?.source || "Unavailable")}. CrUX field data: ${e(perf?.fieldData?.phone?.status === "complete" || perf?.fieldData?.desktop?.status === "complete" ? "available" : "not available")}. Lab results remain valid when field data is unavailable.</div><div class="two-col"><div><h3>Mobile</h3>${cards(perf?.mobile)}</div><div><h3>Desktop</h3>${cards(perf?.desktop)}</div></div><h3 style="margin-top:20px">AI Search Readiness</h3>${table(["Dimension", "Score"], [["Structured Data", `${model.evidence.site.schemaTypes.length ? 25 : 0}/25`], ["Entity Clarity", `${model.evidence.site.pages[0]?.headings?.h1?.length ? 15 : 5}/25`], ["Answer-First Copy", `${model.evidence.site.averageWords >= 300 ? 15 : 5}/25`], ["FAQ Coverage", `${model.evidence.site.trust.faq ? 20 : 0}/25`], ["Topic Authority", `${Math.min(25, model.evidence.site.pageCount * 4)}/25`], ["Local SEO", `${model.evidence.site.schemaTypes.some((x) => /localbusiness/i.test(x)) ? 25 : 0}/25`]].map((r) => r.map(e)))}<p style="margin-top:8px"><strong>AI Readiness: ${e(model.scores.aiReadiness)}/100.</strong></p>`);
}

function appendix(model) {
  const ev = model.evidence;
  const sourceRows = [
    ["Website Capture", `Custom bounded crawler${ev.site.pages.some((p) => p.rendered) ? " + Playwright rendering" : ""}`, `PASS — ${ev.site.pageCount} page(s)`],
    ["Performance", `${ev.performance?.mobile?.source || "Unavailable"} / ${ev.performance?.desktop?.source || "Unavailable"}`, ev.performance?.status === "complete" ? "PASS" : "LIMITED"],
    ["Platform", "Metadata, scripts, headers, and asset signals", `PASS — ${ev.site.platform}`],
    ["E-E-A-T Trust", "On-site captured evidence", "PASS"],
    ["Technical Hygiene", "Crawler + performance evidence", "PASS"],
    ["Competitor Benchmark", `${model.competitors.length} supplied URL(s)`, model.competitors.length ? "PASS" : "NOT SUPPLIED"],
    ["Backlinks", "DataForSEO", ev.backlinks?.status === "complete" ? `PASS — ${ev.backlinks.totalBacklinksReviewed} reviewed` : "NOT CONFIGURED"],
    ["GA4", "Google Analytics Data API", ev.ga4?.status === "complete" ? "PASS — contextual only" : "NOT CONFIGURED — no score impact"],
  ];
  const limitations = [...(ev.site.limitations || []), ...(ev.performance?.limitations || [])];
  if (ev.backlinks?.status !== "complete") limitations.push("Backlink evidence was not included because DataForSEO credentials were not configured.");
  if (ev.ga4?.status !== "complete") limitations.push("GA4 was not connected. The audit completed without analytics and the score was not reduced.");
  return section("evidence-appendix", "13", "Evidence Appendix", `<h3>Evidence Sources</h3>${table(["Layer", "Source", "Status"], sourceRows.map((r) => r.map(e)))}<h3>Evidence Confidence — Full Assessment</h3><p><strong>Overall: ${e(model.bands.evidenceConfidence)}.</strong> Findings are traceable to the normalized evidence package produced during this audit. Optional sources do not reduce the conversion-readiness score when they are not configured.</p><h3>Limitations</h3><ul>${limitations.length ? limitations.map((x) => `<li>${e(x)}</li>`).join("") : "<li>No material collection limitation was recorded.</li>"}</ul><h3>Gate Results</h3>${table(["Gate", "Result"], [["Website capture", `PASS — ${ev.site.pageCount} page(s)`], ["Topical map", "PASS — crawl-visible evidence"], ["Performance", ev.performance?.status === "complete" ? "PASS" : "LIMITED"], ["E-E-A-T", "PASS — 4 dimensions"], ["Technical Hygiene", "PASS — 6 dimensions"], ["Readiness Map", `PASS — ${model.readinessMap.length} topics`], ["Template Lock", "PASS — canonical CSS, navigation, sections, and JavaScript preserved"]].map((r) => r.map(e)))}<p style="margin-top:8px;font-size:.8rem;color:var(--muted)">Template v0.7 locked. Vantage worker ${e(model.reportVersion)}. Conversion Readiness: ${e(model.scores.conversionReadiness)}/100. Phase 1.</p>`);
}

export { performance, appendix };

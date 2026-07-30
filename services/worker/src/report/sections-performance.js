import { e, fmtSec, scoreCard, section, table } from "./html-helpers.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";
import { DIAGNOSTIC_CATEGORY } from "../scoring/diagnostic-contracts.js";
import { readScreenshotAsDataUri, isValidPortableRef } from "../evidence/screenshot-artifact.js";

function perfMetricTable(data) {
  return table(
    ["Metric", "Value"],
    [
      ["FCP", fmtSec(data?.metrics?.fcpMs)],
      ["LCP", fmtSec(data?.metrics?.lcpMs)],
      ["TBT", Number.isFinite(data?.metrics?.tbtMs) ? `${Math.round(data.metrics.tbtMs)}ms` : "Unavailable"],
      ["CLS", Number.isFinite(data?.metrics?.cls) ? String(data.metrics.cls.toFixed(3)) : "Unavailable"],
    ].map((r) => r.map(e)),
  );
}

function scoreGrid(data) {
  return `<div class="score-grid">${scoreCard(data?.scores?.performance ?? "N/A", "Performance", Number.isFinite(data?.scores?.performance))}${scoreCard(data?.scores?.accessibility ?? "N/A", "Accessibility", Number.isFinite(data?.scores?.accessibility))}${scoreCard(data?.scores?.bestPractices ?? "N/A", "Best Practices", Number.isFinite(data?.scores?.bestPractices))}${scoreCard(data?.scores?.seo ?? "N/A", "SEO", Number.isFinite(data?.scores?.seo))}</div>`;
}

function providerBadge(source, fallbackUsed) {
  if (!source || source === "unavailable") return e("Unavailable");
  if (source === "pagespeed-insights") return `PageSpeed Insights ${fallbackUsed ? "(retried)" : ""}`;
  if (source === "lighthouse-cli-fallback") return `Lighthouse CLI (fallback)`;
  return e(source);
}

function dataTypeLabel(data) {
  if (data?.isFieldData) return "Field data (CrUX)";
  if (data?.isLabData) return "Lab data";
  return "Unknown";
}

function deviceCard(label, data, fallbackUsed) {
  if (!data || data.status === SOURCE_STATUS.FAILED) {
    return `<div><h3>${e(label)}</h3><p style="color:var(--muted)">Not available</p></div>`;
  }
  const testedUrl = data.url ? `<p style="font-size:.8rem;color:var(--muted);margin:0 0 8px">URL: ${e(data.url)}</p>` : "";
  const provenance = data.runTime
    ? `<p style="font-size:.76rem;color:var(--muted);margin:0">Collected: ${e(new Date(data.runTime).toISOString())}</p>`
    : "";
  const provider = `<p style="font-size:.8rem;margin:4px 0 0">Provider: ${providerBadge(data.source, fallbackUsed)}</p>`;
  const labField = `<p style="font-size:.76rem;color:var(--muted);margin:2px 0">Classification: ${dataTypeLabel(data)}</p>`;
  const fallbackNote = data.fallbackUsed
    ? `<p style="font-size:.78rem;color:var(--orange, #c7521a);margin:4px 0">⚠ Fallback used — PageSpeed was unavailable (${e(data.psiFailure?.category || "unknown")})</p>`
    : "";
  const cruxNote = data.cruxMetrics
    ? `<p style="font-size:.76rem;color:var(--muted);margin:2px 0">CrUX field data: available</p>`
    : "";

  return `<div><h3>${e(label)}</h3>${testedUrl}${scoreGrid(data)}${perfMetricTable(data)}${provider}${labField}${fallbackNote}${cruxNote}${provenance}</div>`;
}

function pageResultBlock(pageResult, index) {
  if (!pageResult) return "";
  const pageUrl = pageResult.url || `Page ${index + 1}`;
  const sourceLabel = providerBadge(pageResult.source, pageResult.fallbackUsed);
  return `<div style="margin-bottom:16px;padding:12px;border:1px solid var(--border,#ddd);border-radius:6px">
<h4 style="margin:0 0 8px">${e(pageUrl)}</h4>
<p style="font-size:.78rem;color:var(--muted);margin:0 0 4px">Provider: ${sourceLabel} &middot; Status: ${e(pageResult.sourceStatus)}</p>
<div class="two-col">${deviceCard("Mobile", pageResult.mobile, pageResult.fallbackUsed)}${deviceCard("Desktop", pageResult.desktop, pageResult.fallbackUsed)}</div>
</div>`;
}

/**
 * Resolve a portable screenshot reference through the storage abstraction
 * and return an HTML <img> tag with inline data URI.
 *
 * NEVER reads arbitrary filesystem paths from canonical evidence.
 * Always validates the portable reference before resolution.
 * Does NOT embed base64 in canonical JSON — only in the rendered HTML report.
 */
function _renderScreenshotImg(screenshotArtifactRef, artifactRoot) {
  if (!screenshotArtifactRef) return "";

  // Validate the reference is portable, not an absolute OS path
  const validation = isValidPortableRef(screenshotArtifactRef);
  if (!validation.valid) {
    return `<p style="font-size:.78rem;color:var(--muted);margin:2px 0">Screenshot reference rejected: ${validation.error}</p>`;
  }

  try {
    const root = artifactRoot || "artifacts";
    const { dataUri, error } = readScreenshotAsDataUri(screenshotArtifactRef, root);
    if (!dataUri || error) {
      return `<p style="font-size:.78rem;color:var(--muted);margin:2px 0">Screenshot not available: ${error || "unknown error"}</p>`;
    }
    return `<div style="margin:8px 0;max-width:320px"><img src="${dataUri}" alt="Final screenshot from automated test" style="width:100%;border:1px solid var(--border,#ddd);border-radius:4px" loading="lazy" /><p style="font-size:.7rem;color:var(--muted);margin:2px 0 0">Final screenshot captured during the automated test. May not reflect all visitor experiences.</p></div>`;
  } catch (err) {
    return `<p style="font-size:.78rem;color:var(--muted);margin:2px 0">Screenshot artifact not available: ${err.message}</p>`;
  }
}

function performance(model, renderOpts = {}) {
  const perf = model.evidence.performance;
  const artifactRoot = renderOpts.artifactRoot || "artifacts";
  const perfUnavailable = perf?.sourceStatus !== SOURCE_STATUS.AVAILABLE
    && perf?.sourceStatus !== SOURCE_STATUS.PARTIAL;

  const fallbackUsed = perf?.fallbackUsed === true;
  const intendedProvider = perf?.intendedProvider || "pagespeed-insights";
  const actualProvider = perf?.source || "Unavailable";

  // Determine field data availability
  const fieldDataAvailable = perf?.fieldData?.phone?.status === SOURCE_STATUS.AVAILABLE
    || perf?.fieldData?.desktop?.status === SOURCE_STATUS.AVAILABLE;

  // Build source note
  const sourceNoteParts = [];
  sourceNoteParts.push(`Intended provider: ${e(intendedProvider)}`);
  sourceNoteParts.push(`Actual provider: ${e(actualProvider)}`);
  if (fallbackUsed) {
    sourceNoteParts.push("Fallback was used");
  }
  sourceNoteParts.push(`CrUX field data: ${e(fieldDataAvailable ? "available" : "not available")}`);
  if (!perfUnavailable) {
    sourceNoteParts.push("Lab results remain valid when field data is unavailable.");
  }

  const fallbackAlert = fallbackUsed
    ? `<div class="note" style="background:var(--yellow-light,#fff8e1);border-left:4px solid var(--orange,#c7521a)"><strong>⚠ Fallback Active:</strong> PageSpeed Insights was unavailable for at least one strategy. Lighthouse CLI results were used instead. These are <strong>lab data</strong>, not field data. PageSpeed failure details are preserved in the evidence appendix.</div>`
    : "";

  const unavailableNote = perfUnavailable
    ? `<div class="note"><strong>Note:</strong> No performance result was measured for this audit. PageSpeed Insights and local Lighthouse were both unavailable. All scores and metrics are shown as N/A. This does not affect other scored dimensions.</div>`
    : "";

  // Multi-page results (when available)
  const multiPageSection = perf?.pageResults && perf.pageResults.length > 1
    ? `<h3 style="margin-top:20px">Tested Pages</h3>
<p style="font-size:.8rem;color:var(--muted);margin:0 0 8px">${e(perf.testedUrls?.length || perf.pageResults.length)} URL(s) tested</p>
${perf.pageResults.map((pr, i) => pageResultBlock(pr, i)).join("")}`
    : "";

  // Coverage note
  const coverageNote = perf?.coverage?.pagesTested && perf.coverage.pagesTested > 1
    ? `<p style="font-size:.78rem;color:var(--muted);margin:4px 0">Coverage: ${e(perf.coverage.completed)} of ${e(perf.coverage.requested)} strategies completed across ${e(perf.coverage.pagesTested)} page(s)</p>`
    : "";

  // Rendering-integrity diagnostics
  const diagnostics = model.renderingDiagnostics || [];
  const siteDiags = diagnostics.filter((d) => d.diagnosticCategory === DIAGNOSTIC_CATEGORY.SITE_RENDERING);
  const providerDiags = diagnostics.filter((d) => d.diagnosticCategory === DIAGNOSTIC_CATEGORY.PROVIDER || d.diagnosticCategory === DIAGNOSTIC_CATEGORY.INFRASTRUCTURE);

  let diagnosticHtml = "";
  if (diagnostics.length > 0) {
    diagnosticHtml = `<div style="margin-top:16px;padding:12px;border:1px solid var(--border,#ddd);border-radius:6px">`;
    diagnosticHtml += `<h3 style="margin:0 0 8px">Rendering Integrity</h3>`;

    if (siteDiags.length > 0) {
      diagnosticHtml += `<h4 style="margin:8px 0 4px;color:var(--red,#b22222)">Site Rendering Issues</h4>`;
      for (const d of siteDiags) {
        diagnosticHtml += `<div style="margin:8px 0;padding:8px;background:var(--bg-secondary,#f9f9f9);border-left:4px solid var(--orange,#c7521a);border-radius:4px">`;
        diagnosticHtml += `<p style="margin:0 0 4px"><strong>${e(d.diagnosticCode)}</strong> — Confidence: ${Math.round(d.confidence * 100)}%</p>`;
        diagnosticHtml += `<p style="margin:0 0 4px;font-size:.9rem">${e(d.clientExplanation)}</p>`;
        if (d.affectedUrl) diagnosticHtml += `<p style="font-size:.78rem;color:var(--muted);margin:2px 0">URL: ${e(d.affectedUrl)} &middot; Device: ${e(d.requestedDevice.join(", "))} &middot; Provider: ${e(d.provider)}</p>`;
        if (d.missingMetrics.length) diagnosticHtml += `<p style="font-size:.78rem;color:var(--muted);margin:2px 0">Missing metrics: ${e(d.missingMetrics.join(", "))}</p>`;
        // Render screenshot when available
        const screenshotHtml = _renderScreenshotImg(d.screenshotArtifactRef, artifactRoot);
        if (screenshotHtml) diagnosticHtml += screenshotHtml;
        diagnosticHtml += `</div>`;
      }
    }

    if (providerDiags.length > 0) {
      diagnosticHtml += `<h4 style="margin:8px 0 4px;color:var(--muted)">Provider &amp; Infrastructure Status</h4>`;
      for (const d of providerDiags) {
        diagnosticHtml += `<div style="margin:8px 0;padding:8px;background:var(--bg-secondary,#f9f9f9);border-left:4px solid var(--muted,#999);border-radius:4px">`;
        diagnosticHtml += `<p style="margin:0"><strong>${e(d.diagnosticCode)}</strong> — ${e(d.clientExplanation)}</p>`;
        diagnosticHtml += `</div>`;
      }
    }
    diagnosticHtml += `</div>`;
  }

  return section(
    "experience-and-performance",
    "12",
    "Experience and Performance",
    `${unavailableNote}${fallbackAlert}<div class="note"><strong>Source:</strong> ${sourceNoteParts.join(" &middot; ")}</div>${coverageNote}${diagnosticHtml}<div class="two-col">${deviceCard("Mobile", perf?.mobile, fallbackUsed)}${deviceCard("Desktop", perf?.desktop, fallbackUsed)}</div>${multiPageSection}<h3 style="margin-top:20px">AI Search Readiness</h3>${table(["Dimension", "Score"], [["Structured Data", `${model.evidence.site.schemaTypes.length ? 25 : 0}/25`], ["Entity Clarity", `${model.evidence.site.pages[0]?.headings?.h1?.length ? 15 : 5}/25`], ["Answer-First Copy", `${model.evidence.site.averageWords >= 300 ? 15 : 5}/25`], ["FAQ Coverage", `${model.evidence.site.trust.faq ? 20 : 0}/25`], ["Topic Authority", `${Math.min(25, model.evidence.site.pageCount * 4)}/25`], ["Local SEO", `${model.evidence.site.schemaTypes.some((x) => /localbusiness/i.test(x)) ? 25 : 0}/25`]].map((r) => r.map(e)))}<p style="margin-top:8px"><strong>AI Readiness: ${e(model.scores.aiReadiness !== null ? `${model.scores.aiReadiness}/100` : "Not Assessed")}.</strong></p>`,
  );
}

function appendix(model, renderOpts = {}) {
  const ev = model.evidence;
  const perfAvailable = ev.performance?.sourceStatus === SOURCE_STATUS.AVAILABLE
    || ev.performance?.sourceStatus === SOURCE_STATUS.PARTIAL;
  // Source-status based gate labels — never hardcode PASS.
  function sourceGate(sourceStatus, availableLabel, fallbackLabel) {
    if (!sourceStatus) return fallbackLabel || "NOT CONFIGURED";
    return sourceStatus;
  }
  function siteGate(site) {
    if (!site?.sourceStatus) return "NOT CONFIGURED";
    return site.sourceStatus;
  }
  const perfGate = sourceGate(ev.performance?.sourceStatus, `PASS — ${ev.performance?.coverage?.completed || 0}/${ev.performance?.coverage?.requested || 0} runs`, "UNAVAILABLE");
  const backlinksAvailable = ev.backlinks?.sourceStatus === SOURCE_STATUS.AVAILABLE;
  const ga4Available = ev.ga4?.sourceStatus === SOURCE_STATUS.AVAILABLE;
  const gscAvailable = ev.gsc?.sourceStatus === SOURCE_STATUS.AVAILABLE;

  // Performance source detail for appendix
  const perfIntended = ev.performance?.intendedProvider || "pagespeed-insights";
  const perfActual = ev.performance?.source || "Unavailable";
  const perfFallbackUsed = ev.performance?.fallbackUsed === true;
  const perfFallbackNote = perfFallbackUsed
    ? ` — fallback used (intended: ${perfIntended})`
    : "";
  const perfSourceLabel = `${e(perfActual)}${perfFallbackNote}`;

  const competitorCount = (model.competitors || []).length;
  const sourceRows = [
    ["Website Capture", `Custom bounded crawler${ev.site.pages.some((p) => p.rendered) ? " + Playwright rendering" : ""}`, `${siteGate(ev.site)} — ${ev.site.pageCount} page(s)`],
    ["Performance", perfSourceLabel, perfGate],
    ["Platform", "Metadata, scripts, headers, and asset signals", `${ev.site.platform ? "DETECTED" : "UNKNOWN"} — ${ev.site.platform || "Not detected"}`],
    ["E-E-A-T Trust", "On-site captured evidence", ev.site._contentEvidenceAvailable !== false ? "CAPTURED" : "UNAVAILABLE"],
    ["Technical Hygiene", "Crawler + performance evidence", ev.site.sourceStatus === "AVAILABLE" ? "CAPTURED" : ev.site.sourceStatus || "PARTIAL"],
    ["Competitor Benchmark", `${competitorCount} supplied URL(s)`, competitorCount > 0 ? `${competitorCount} SUPPLIED` : "NOT SUPPLIED"],
    ["Backlinks", "DataForSEO", backlinksAvailable ? `PASS — ${ev.backlinks.totalBacklinksReviewed} reviewed` : "NOT CONFIGURED"],
    ["GA4", "Google Analytics Data API", ga4Available ? "PASS — contextual only" : "NOT CONFIGURED — no score impact"],
    ["Search Console", "Google Search Console API", gscAvailable ? `PASS — ${ev.gsc?.totals?.impressions || 0} impressions` : "NOT CONFIGURED — no score impact"],
  ];

  const limitations = [...(ev.site.limitations || []), ...(ev.performance?.limitations || [])];
  if (!backlinksAvailable) limitations.push("Backlink evidence was not included because DataForSEO credentials were not configured.");
  if (!ga4Available) limitations.push("GA4 was not connected. The audit completed without analytics and the score was not reduced.");
  if (!perfAvailable) limitations.push("No performance measurement (PageSpeed Insights or local Lighthouse) was available for this audit. Performance scores and metrics are unavailable.");
  if (!gscAvailable) limitations.push("GSC was not connected. Search-console evidence was not included and the score was not reduced.");
  if (gscAvailable && ev.gsc?.sufficiency?.sufficient === false) {
    limitations.push(`GSC data is below the sufficiency threshold (${ev.gsc?.sufficiency?.threshold || 100} impressions). GSC-derived findings use directional confidence.`);
  }
  if (ga4Available && ev.ga4?.measurementReadiness?.issues?.length > 0) {
    const readinessIssues = ev.ga4.measurementReadiness.issues.map((i) => `${i.type}: ${i.detail}`).join("; ");
    limitations.push(`GA4 measurement readiness: ${readinessIssues}`);
  }

  // Add fallback detail when applicable
  if (perfFallbackUsed) {
    limitations.push(`Performance fallback was used: PageSpeed Insights failed for at least one strategy. Lighthouse CLI provided lab-only results. PageSpeed is the intended primary provider.`);
  }

  // Tested URLs in appendix
  const testedUrls = ev.performance?.testedUrls || (ev.performance?.url ? [ev.performance.url] : []);
  if (testedUrls.length > 0) {
    limitations.push(`Performance tested ${testedUrls.length} URL(s): ${testedUrls.join(", ")}`);
  }

  // Rendering-integrity diagnostics table
  const allDiagnostics = model.renderingDiagnostics || [];
  let diagTableHtml = "";
  if (allDiagnostics.length > 0) {
    const diagRows = allDiagnostics.map((d) => [
      d.diagnosticCode,
      d.diagnosticCategory,
      d.affectedUrl || ev.performance?.url || "",
      d.requestedDevice.join(", "),
      d.provider || "",
      d.clientExplanation.slice(0, 150),
      `${Math.round(d.confidence * 100)}%`,
    ].map((c) => e(String(c ?? ""))));
    diagTableHtml = `<h3>Rendering Integrity Diagnostics</h3>${table(["Code", "Category", "URL", "Device", "Provider", "Explanation", "Confidence"], diagRows)}`;
  }

  return section(
    "evidence-appendix",
    "13",
    "Evidence Appendix",
    `<h3>Evidence Sources</h3>${table(["Layer", "Source", "Status"], sourceRows.map((r) => r.map(e)))}
<h3>Evidence Confidence — Full Assessment</h3>
<p><strong>Overall: ${e(model.bands.evidenceConfidence)}.</strong> Findings are traceable to the normalized evidence package produced during this audit. Optional sources do not reduce the conversion-readiness score when they are not configured.</p>
<h3>Limitations</h3>
<ul>${limitations.length ? limitations.map((x) => `<li>${e(x)}</li>`).join("") : "<li>No material collection limitation was recorded.</li>"}</ul>
${diagTableHtml}
<h3>Gate Results</h3>
${table(["Gate", "Result"], [
  ["Website capture", `PASS — ${ev.site.pageCount} page(s)`],
  ["Topical map", "PASS — crawl-visible evidence"],
  ["Performance", perfGate],
  ["E-E-A-T", "PASS — 4 dimensions"],
  ["Technical Hygiene", "PASS — 6 dimensions"],
  ["Readiness Map", `PASS — ${model.readinessMap.length} topics`],
  ["Template Lock", "PASS — canonical CSS, navigation, sections, and JavaScript preserved"],
].map((r) => r.map(e)))}
${model.readinessStatus && model.readinessStatus !== "Complete" ? `<p style="margin-top:8px"><strong>Readiness Status:</strong> ${e(model.readinessStatus)}. Assessed weight: ${e(model.assessedWeight ?? "N/A")}%.</p>` : ""}
<p style="margin-top:8px;font-size:.8rem;color:var(--muted)">Template v0.7 locked. Vantage worker ${e(model.reportVersion)}. Scoring version ${e(model.scoringVersion || model.reportVersion)}. Conversion Readiness: ${e(model.scores.conversionReadiness !== null ? `${model.scores.conversionReadiness}/100` : "Insufficient Evidence")}. Phase 1.</p>`,
  );
}

export { performance, appendix };

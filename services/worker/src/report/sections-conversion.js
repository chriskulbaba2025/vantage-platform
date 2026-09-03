import { e, severityClass, scoreCard, section, table } from "./html-helpers.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";
import { requireCrossReportInterpretation } from "../report-model/cross-report-interpretation.js";

function scorecard(model) {
  const { scores, bands, evidenceConfidenceScore, rootCause, evidence } = model;
  const site = evidence.site;

  const assessedWeight = model.assessedWeight ?? 100;
  const readinessStatus = model.readinessStatus ?? null;
  const showNumeric = model.showNumericScore !== false;

  const readinessDisplay = showNumeric && scores.conversionReadiness !== null
    ? scores.conversionReadiness
    : "—";
  const readinessLabel = readinessStatus === "Provisional"
    ? "Conversion Readiness (Provisional)"
    : "Conversion Readiness";

  const statusBanner = readinessStatus && readinessStatus !== "Complete"
    ? `<div class="note" style="margin-bottom:16px"><strong>Readiness Status:</strong> ${e(readinessStatus)}. <strong>Assessed Weight:</strong> ${e(assessedWeight)}% of total intended dimensions. ${!showNumeric ? "An overall numeric score cannot be shown because assessed weight is below 60%." : "The score is provisional because less than 80% of intended evidence dimensions were assessed. Missing module weight was not redistributed."}</div>`
    : "";

  const legacyReadiness = model._crawlSuppressed
    ? '<div class="score-grid" style="margin:20px 0">' +
      scoreCard("Not Assessed", "Conversion Readiness", false) +
      scoreCard(bands.evidenceConfidence, "Evidence Confidence", false) +
      '</div>'
    : `<div class="score-grid" style="margin:20px 0">
${scoreCard(readinessDisplay, readinessLabel, showNumeric && scores.conversionReadiness !== null)}
${scoreCard(bands.evidenceConfidence, "Evidence Confidence", false)}
${scoreCard(bands.trust !== "Not Assessed" ? bands.trust : "Not Assessed", "On-Site Trust Proof", false)}
${scoreCard(scores.contentDepth, "Content Depth")}
${scoreCard(scores.conversionPathways, "Conversion Pathways")}
</div>`;

  return section("executive-conversion-scorecard", "01", "Executive Conversion Scorecard", `
<p>Prysm Phase 1 Audit of <strong>${e(site.domain)}</strong>, a ${e(site.pageCount)}-page crawlable website detected as ${e(site.platform)}.</p>
${statusBanner}${legacyReadiness}
<div class="confidence-note"><h3>Evidence Confidence — ${e(bands.evidenceConfidence)}</h3>
<p><strong>Website crawl:</strong> ${e(site.pageCount)} page(s) captured. Source status: ${e(site.sourceStatus)}. ${site._contentEvidenceAvailable !== false ? "Page-level headings, links, forms, trust signals, schema, images, and headers were extracted." : "Page body content, CTAs, forms, trust signals, and structured data are not available from this provider."}</p>
<p style="margin-top:6px"><strong>Performance:</strong> ${e(evidence.performance?.sourceStatus || "No performance source")}${evidence.performance?.testedUrls ? " — " + e(evidence.performance.testedUrls.length) + " URL(s) tested" : ""}. ${evidence.performance?.fallbackUsed === true ? "Lighthouse CLI fallback was used for some strategies." : ""}</p>
<p style="margin-top:6px"><strong>Competitors:</strong> ${e((model.competitors || []).length)} supplied competitor site(s) produced comparable on-page evidence.</p>
<p style="margin-top:6px"><strong>Optional analytics:</strong> ${e(evidence.ga4?.sourceStatus === SOURCE_STATUS.AVAILABLE ? "GA4 data was included as context." : "GA4 was not connected; the audit completed without analytics and no score was reduced.")}</p>
<p style="margin-top:6px"><strong>Confidence score:</strong> ${e(evidenceConfidenceScore)}/100.</p>
<p style="margin-top:6px"><strong>Assessed weight:</strong> ${e(assessedWeight)}% of intended dimensions.</p></div>
<h3>Root Cause</h3><p>${e(rootCause)}</p>
<h3>Funnel-Stage Readiness</h3>
<div class="score-grid">${scoreCard(scores.awareness, "Awareness (TOFU)")}${scoreCard(scores.consideration, "Consideration (MOFU)")}${scoreCard(scores.decision, "Decision (BOFU)")}</div>
<p style="font-size:.85rem;color:var(--muted);margin-top:8px"><strong>TOFU:</strong> ${scores.awareness === null ? "Not assessed." : scores.awareness < 50 ? "Educational discovery coverage is limited." : "The site has a usable awareness foundation."} <strong>MOFU:</strong> ${scores.consideration === null ? "Not assessed." : scores.consideration < 50 ? "Proof and comparison content are insufficient." : "Consideration support is present."} <strong>BOFU:</strong> ${scores.decision === null ? "Not assessed." : scores.decision < 50 ? "Conversion reassurance and offer clarity remain weak." : "Decision-stage actions are reasonably clear."}</p>`);
}

function priorityFixes(model) {
  function renderEvidence(finding) {
    if (finding.evidenceText) return e(finding.evidenceText);
    if (Array.isArray(finding.evidence)) {
      return e(finding.evidence.map((record) => `${record.field}: ${record.observedValue ?? "unavailable"}`).join("; "));
    }
    return e(String(finding.evidence || ""));
  }

  return section("priority-fixes", "02", "Priority Fixes", `<p style="margin-bottom:16px">Ranked by conversion impact. Each fix is tied to captured website or performance evidence.</p>${table(["#", "Sev", "Problem", "Evidence", "Conversion Impact", "Fix", "Effort"], model.findings.map((finding, index) => [e(index + 1), `<span class="${severityClass(finding.severity)}">${e(finding.severity)}</span>`, e(finding.problem), renderEvidence(finding), e(finding.impact), e(finding.fix), e(finding.effort)]))}`);
}

function conversionPaths(model) {
  const body = model.conversionPaths.map((path) => `<h3>${e(path.name)}</h3><ol>${path.steps.map((step) => `<li>${e(step)}</li>`).join("")}</ol>`).join("");
  const issues = [...new Set(model.conversionPaths.flatMap((path) => path.blockers))];
  return section("conversion-path-architecture", "03", "Conversion Path Architecture", `<p style="margin-bottom:16px">Tests whether a visitor can move from landing on the site to completing a conversion action across the captured website.</p>${body}<h3>Conversion Path Issues</h3><ul class="finding-list">${issues.length ? issues.map((issue, index) => `<li class="${index < 2 ? "high" : "medium"}"><strong>${e(issue)}</strong> — this weakens confidence or clarity before the action is completed.</li>`).join("") : '<li class="low"><strong>No major path blocker detected</strong> — the visible path includes sufficient support.</li>'}</ul><p style="margin-top:12px"><strong>Path Summary:</strong> ${e(model.conversionPaths.length)} path(s) tested. ${e(model.conversionPaths.filter((path) => path.status === "Clear").length)} clear.</p>`);
}

function readinessMap(model) {
  const rows = model.readinessMap.map((row) => [e(row.topic), e(row.stage), e(row.blocker), e(row.trustAsset), e(row.eeat), e(row.cta), `<span class="${row.path === "Clear" ? "path-clear" : row.path === "Weak" ? "path-weak" : "path-missing"}">${e(row.path)}</span>`, `<span class="${severityClass(row.priority)}">${e(row.priority)}</span>`]);
  const clear = model.readinessMap.filter((row) => row.path === "Clear").length;
  const weak = model.readinessMap.filter((row) => row.path === "Weak").length;
  const missing = model.readinessMap.length - clear - weak;
  return section("conversion-readiness-map", "04", "Conversion Readiness Map", `<p style="font-size:.85rem;color:var(--muted);margin-bottom:16px">Connects each detected service or topic to the evidence needed for conversion readiness.</p>${table(["Topic / Service", "Stage", "Blocker", "Trust Asset", "E-E-A-T Signal", "CTA", "Path", "Pri"], rows)}<p style="margin-top:12px"><strong>Summary:</strong> ${e(model.readinessMap.length)} topics. <span class="path-clear">${clear} clear</span>, <span class="path-weak">${weak} weak</span>, <span class="path-missing">${missing} missing</span>.</p>`);
}

function ideaTable(items) {
  return table(["Idea", "Frame", "Type", "Question Answered", "Pri"], items.map((item) => [e(item.idea), e(item.frame), e(item.type), e(item.question), `<span class="${severityClass(item.priority)}">${e(item.priority)}</span>`]));
}

function contentIdeas(model) {
  const site = model.evidence.site;
  const covered = [...new Set([...site.services, ...site.topicKeywords.map((item) => item.replace(/\b\w/g, (character) => character.toUpperCase()))])].slice(0, 8);
  const half = Math.ceil(covered.length / 2);
  const coverageTable = (items) => table(["Topic", "Coverage"], items.map((item, index) => [e(item), e(index < 2 ? "Moderate" : "Light")]));
  return section("topical-map-content-ideas", "05", "Topical Map + Content Ideas", `<p style="font-size:.85rem;color:var(--muted);margin-bottom:16px">Generated from crawl-visible evidence only. Suggestions answer buyer questions and strengthen trust.</p><h3>Covered Topics</h3><div class="two-col"><div>${coverageTable(covered.slice(0, half))}</div><div>${coverageTable(covered.slice(half))}</div></div><h3>TOFU — Awareness</h3>${ideaTable(model.contentIdeas.tofu)}<h3>MOFU — Consideration</h3>${ideaTable(model.contentIdeas.mofu)}<h3>BOFU — Decision</h3>${ideaTable(model.contentIdeas.bofu)}<h3>Leading-Edge Queries</h3>${table(["Query", "Rationale", "Pri"], model.contentIdeas.leading.map((item) => [e(item.query), e(item.rationale), `<span class="${severityClass(item.priority)}">${e(item.priority)}</span>`]))}`);
}

function competitorBenchmark(model) {
  const site = model.evidence.site;
  const competitors = model.competitors;
  const opportunities = model.competitorOpportunities || {};

  const supplied = competitors.comparisons
    ? competitors.comparisons.length
      ? table(["#", "Name", "URL", "Topic"], competitors.comparisons.map((competitor, index) => [e(index + 1), e(competitor.name), `<a href="${e(competitor.url)}" target="_blank" rel="noopener">${e(new URL(competitor.url).hostname)}</a>`, e(competitor.topic || competitor.note || "Unavailable")]))
      : '<div class="note"><strong>Limitation:</strong> No competitor URLs were supplied. The audit continued without a competitor benchmark.</div>'
    : '<div class="note"><strong>Limitation:</strong> No competitor URLs were supplied. The audit continued without a competitor benchmark.</div>';

  const comparisons = competitors.comparisons || [];
  const interpretation = requireCrossReportInterpretation(model);
  const headers = ["Signal", site.domain, ...comparisons.map((competitor) => competitor.name)];
  const value = (label, target, key) => [e(label), e(target), ...comparisons.map((competitor) => e(competitor[key] || "Unavailable"))];
  const rows = [
    value("Offer Clarity", interpretation.constructs.offerClarity, "offerClarity"),
    value("Trust Proof (on-site)", model.bands.trust, "trustProof"),
    value("CTA Clarity", interpretation.constructs.ctaClarity, "ctaClarity"),
    value("Content Depth", (model.scores.contentDepth ?? 0) >= 70 ? "Strong" : (model.scores.contentDepth ?? 0) >= 40 ? "Moderate" : "Light", "contentDepth"),
    value("On-Site E-E-A-T Proof", model.bands.trust === "Not Assessed" ? "Not Assessed" : model.bands.trust, "eeat"),
    value("Conversion Path Clarity", interpretation.constructs.conversionPathClarity, "pathClarity"),
  ];

  const gaps = opportunities.gaps || [];
  const qualifiedCandidates = opportunities.qualifiedCandidates || [];
  const excludedCandidates = opportunities.excludedCandidates || [];
  const sources = opportunities.sources || {};
  const limitations = opportunities.limitations || [];

  const serpSourceData = sources.dataforseoSerp || {};
  const serpSource = serpSourceData.status || "NOT_CONNECTED";
  const suppliedSource = sources.supplied?.status || "NOT_APPLICABLE";
  const serpFailed = serpSource === "FAILED";
  const serpPartial = serpSource === "PARTIAL";
  const serpUnavailable = serpSource === "UNAVAILABLE";
  const queryFailures = serpSourceData.queryFailures || serpSourceData.taskErrors || [];

  const describeFailure = (failure) => {
    const codePart = failure.statusCode != null
      ? `code ${e(String(failure.statusCode))}`
      : e(failure.errorType || "provider error");
    const messagePart = failure.statusMessage && failure.statusMessage !== "Unknown SERP query failure"
      ? `: ${e(failure.statusMessage)}`
      : "";
    return `"${e(failure.topic || "unknown topic")}" (${codePart}${messagePart})`;
  };

  let serpLimitationHtml = "";
  if (serpFailed) {
    const failureDetail = queryFailures.length > 0
      ? queryFailures.map(describeFailure).join("; ")
      : "failure details unavailable";
    serpLimitationHtml = `<div class="note"><strong>Source limitation:</strong> DataForSEO SERP could not collect localized competitor evidence. ` +
      `The search provider could not complete: ${failureDetail}. ` +
      `Competitor analysis continues with supplied-competitor evidence only. ` +
      `Original market: ${e(serpSourceData.originalLocation || "not specified")}. ` +
      `Normalized location: ${e(serpSourceData.normalizedLocation || "unresolved")}.</div>`;
  } else if (serpPartial) {
    const failedQueries = queryFailures.length > 0
      ? queryFailures.map(describeFailure).join("; ")
      : "failure details unavailable";
    const candidateCount = serpSourceData.candidateCount || 0;
    const attemptedCount = serpSourceData.attemptedCount ?? serpSourceData.taskIds?.length ?? 0;
    const successfulCount = serpSourceData.successfulCount ?? Math.max(0, attemptedCount - queryFailures.length);
    serpLimitationHtml = `<div class="note"><strong>Source limitation:</strong> DataForSEO SERP collected partial localized competitor evidence. ` +
      `${candidateCount} candidate(s) were preserved from ${successfulCount} successful query or queries out of ${attemptedCount} attempted. ` +
      `SERP data could not be retrieved for: ${failedQueries}. ` +
      `Competitor analysis continues with the available SERP evidence plus any supplied-competitor evidence. ` +
      `Original market: ${e(serpSourceData.originalLocation || "not specified")}. ` +
      `Normalized location: ${e(serpSourceData.normalizedLocation || "unresolved")}.</div>`;
  } else if (serpUnavailable) {
    serpLimitationHtml = `<div class="note"><strong>Source limitation:</strong> DataForSEO SERP query completed but returned no organic results for the targeted topics. This may indicate a very narrow niche or an unsupported location. Competitor analysis continues with supplied-competitor evidence only.</div>`;
  }

  const opportunitySection = gaps.length > 0
    ? `<h3>Qualified Competitor Gaps</h3>
<p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">Only approved, qualified gaps that passed all eligibility checks are shown. Each gap is tied to SERP or supplied-competitor evidence.</p>
${table(
  ["Topic", "Competitor Page", "Client Coverage", "Competitor Coverage", "Conversion Relevance", "Confidence", "Limitation"],
  gaps.map((gap) => [
    e(gap.clientTopic),
    `<a href="${e(gap.competitorPage)}" target="_blank" rel="noopener">${e(gap.competitorDomain || new URL(gap.competitorPage).hostname)}</a>`,
    e(gap.clientCoverage),
    e((gap.observedCompetitorCoverage || []).join(", ") || "N/A"),
    e(gap.conversionRelevance),
    e(gap.confidence),
    e(gap.limitationStatement?.slice(0, 120)),
  ]),
)}
${gaps.some((gap) => gap.recommendation) ? `<h3>Recommendations</h3><ul>${gaps.filter((gap) => gap.recommendation).map((gap) => `<li><strong>${e(gap.clientTopic)}:</strong> ${e(gap.recommendation)}</li>`).join("")}</ul>` : ""}`
    : '<div class="note"><strong>No qualified gaps:</strong> No competitor gaps passed all qualification checks and auditor approval. This may indicate that competitors have not been approved, or that available competitors do not meet the comparison criteria.</div>';

  const sourcesSection = `<h3>Competitor Sources</h3>
<ul>
<li><strong>User-supplied:</strong> ${e(suppliedSource)} — ${e(sources.supplied?.candidateCount || 0)} candidate(s)</li>
<li><strong>DataForSEO SERP:</strong> ${e(serpSource)} — ${e(serpSourceData.candidateCount || 0)} candidate(s), ${e(serpSourceData.successfulCount ?? 0)} successful and ${e(serpSourceData.failedCount ?? queryFailures.length)} failed query or queries from ${e(serpSourceData.attemptedCount ?? serpSourceData.taskIds?.length ?? 0)} attempted${serpSourceData.taskIds?.length ? ` (task: ${e(serpSourceData.taskIds.join(", "))})` : ""}${serpSourceData.normalizedLanguage ? `, language: ${e(serpSourceData.normalizedLanguage)}` : ""}${serpSourceData.normalizedLocation ? `, location: ${e(serpSourceData.normalizedLocation)}` : ""}</li>
<li><strong>Qualified candidates:</strong> ${e(qualifiedCandidates.length)}</li>
<li><strong>Excluded candidates:</strong> ${e(excludedCandidates.length)}</li>
</ul>`;

  const excludedSection = excludedCandidates.length > 0
    ? `<h3>Excluded Candidates</h3>
<p style="font-size:.8rem;color:var(--muted)">These candidates were excluded by the qualification gate and did not generate recommendations.</p>
${table(["URL", "Domain", "Reason"], excludedCandidates.slice(0, 10).map((candidate) => [e(candidate.candidateUrl?.slice(0, 60)), e(candidate.domain), e(candidate.exclusionReason)]))}`
    : "";

  const hasSerpEvidence = serpSource === "AVAILABLE" || serpSource === "PARTIAL";
  const opportunity = comparisons.length
    ? `The strongest positioning opportunity is to make the detected offer stack explicit, support it with visible proof, and connect each offer to one primary action. The comparison is based on visible on-page evidence from ${comparisons.length} supplied competitor site(s)${hasSerpEvidence ? ` and DataForSEO SERP analysis of ${qualifiedCandidates.length} qualified candidates` : ""}.`
    : "A competitor-based positioning opportunity cannot be stated until competitor URLs are supplied. The report does not invent market-wide claims.";

  return section(
    "supplied-competitor-benchmark",
    "06",
    "Supplied Competitor Benchmark — Conversion Positioning",
    `${sourcesSection}${serpLimitationHtml}<div class="note"><strong>Disclaimer:</strong> This benchmark compares supplied competitor URLs and SERP-discovered competitors for visible conversion-readiness signals only. It does not claim traffic, rankings, backlinks, market share, or domain authority. No causal ranking claims are made.</div><h3>Supplied Competitors</h3>${supplied}<h3>Conversion-Positioning Comparison</h3>${table(headers, rows)}${opportunitySection}${excludedSection}<h3>Positioning Opportunity</h3><p><strong>${e(model.input.businessName || site.domain)}:</strong> ${e(opportunity)}</p>${limitations.length ? `<h3>Limitations</h3><ul>${limitations.map((limitation) => `<li>${e(limitation)}</li>`).join("")}</ul>` : ""}`,
  );
}

export { scorecard, priorityFixes, conversionPaths, readinessMap, contentIdeas, competitorBenchmark };

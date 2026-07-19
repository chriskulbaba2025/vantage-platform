import { e, severityClass, scoreCard, section, table } from "./html-helpers.js";

function scorecard(model) {
  const { scores, bands, evidenceConfidenceScore, rootCause, evidence } = model;
  const site = evidence.site;
  return section("executive-conversion-scorecard", "01", "Executive Conversion Scorecard", `
<p>Vantage Phase 1 Audit of <strong>${e(site.domain)}</strong>, a ${e(site.pageCount)}-page crawlable website detected as ${e(site.platform)}.</p>
<div class="score-grid" style="margin:20px 0">
${scoreCard(scores.conversionReadiness, "Conversion Readiness")}
${scoreCard(bands.evidenceConfidence, "Evidence Confidence", false)}
${scoreCard(bands.trust, "On-Site Trust Proof", false)}
${scoreCard(scores.contentDepth, "Content Depth")}
${scoreCard(scores.conversionPathways, "Conversion Pathways")}
</div>
<div class="confidence-note"><h3>Evidence Confidence — ${e(bands.evidenceConfidence)}</h3>
<p><strong>Strong:</strong> ${e(site.pageCount)} page(s) were captured with page-level metadata, headings, links, forms, trust signals, schema, images, and response-header evidence.</p>
<p style="margin-top:6px"><strong>Performance:</strong> ${e(evidence.performance?.mobile?.source || "No performance source")} supplied mobile data and ${e(evidence.performance?.desktop?.source || "no performance source")} supplied desktop data.</p>
<p style="margin-top:6px"><strong>Competitors:</strong> ${e(model.competitors.length)} supplied competitor site(s) produced comparable on-page evidence.</p>
<p style="margin-top:6px"><strong>Optional analytics:</strong> ${e(evidence.ga4?.status === "complete" ? "GA4 data was included as context." : "GA4 was not connected; the audit completed without analytics and no score was reduced.")}</p>
<p style="margin-top:6px"><strong>Confidence score:</strong> ${e(evidenceConfidenceScore)}/100.</p></div>
<h3>Root Cause</h3><p>${e(rootCause)}</p>
<h3>Funnel-Stage Readiness</h3>
<div class="score-grid">${scoreCard(scores.awareness, "Awareness (TOFU)")}${scoreCard(scores.consideration, "Consideration (MOFU)")}${scoreCard(scores.decision, "Decision (BOFU)")}</div>
<p style="font-size:.85rem;color:var(--muted);margin-top:8px"><strong>TOFU:</strong> ${scores.awareness < 50 ? "Educational discovery coverage is limited." : "The site has a usable awareness foundation."} <strong>MOFU:</strong> ${scores.consideration < 50 ? "Proof and comparison content are insufficient." : "Consideration support is present."} <strong>BOFU:</strong> ${scores.decision < 50 ? "Conversion reassurance and offer clarity remain weak." : "Decision-stage actions are reasonably clear."}</p>`);
}

function priorityFixes(model) {
  return section("priority-fixes", "02", "Priority Fixes", `<p style="margin-bottom:16px">Ranked by conversion impact. Each fix is tied to captured website or performance evidence.</p>${table(["#", "Sev", "Problem", "Evidence", "Conversion Impact", "Fix", "Effort"], model.findings.map((f, i) => [e(i + 1), `<span class="${severityClass(f.severity)}">${e(f.severity)}</span>`, e(f.problem), e(f.evidence), e(f.impact), e(f.fix), e(f.effort)]))}`);
}

function conversionPaths(model) {
  const body = model.conversionPaths.map((path) => `<h3>${e(path.name)}</h3><ol>${path.steps.map((step) => `<li>${e(step)}</li>`).join("")}</ol>`).join("");
  const issues = [...new Set(model.conversionPaths.flatMap((path) => path.blockers))];
  return section("conversion-path-architecture", "03", "Conversion Path Architecture", `<p style="margin-bottom:16px">Tests whether a visitor can move from landing on the site to completing a conversion action across the captured website.</p>${body}<h3>Conversion Path Issues</h3><ul class="finding-list">${issues.length ? issues.map((issue, i) => `<li class="${i < 2 ? "high" : "medium"}"><strong>${e(issue)}</strong> — this weakens confidence or clarity before the action is completed.</li>`).join("") : '<li class="low"><strong>No major path blocker detected</strong> — the visible path includes sufficient support.</li>'}</ul><p style="margin-top:12px"><strong>Path Summary:</strong> ${e(model.conversionPaths.length)} path(s) tested. ${e(model.conversionPaths.filter((p) => p.status === "Clear").length)} clear.</p>`);
}

function readinessMap(model) {
  const rows = model.readinessMap.map((r) => [e(r.topic), e(r.stage), e(r.blocker), e(r.trustAsset), e(r.eeat), e(r.cta), `<span class="${r.path === "Clear" ? "path-clear" : r.path === "Weak" ? "path-weak" : "path-missing"}">${e(r.path)}</span>`, `<span class="${severityClass(r.priority)}">${e(r.priority)}</span>`]);
  const clear = model.readinessMap.filter((r) => r.path === "Clear").length;
  const weak = model.readinessMap.filter((r) => r.path === "Weak").length;
  const missing = model.readinessMap.length - clear - weak;
  return section("conversion-readiness-map", "04", "Conversion Readiness Map", `<p style="font-size:.85rem;color:var(--muted);margin-bottom:16px">Connects each detected service or topic to the evidence needed for conversion readiness.</p>${table(["Topic / Service", "Stage", "Blocker", "Trust Asset", "E-E-A-T Signal", "CTA", "Path", "Pri"], rows)}<p style="margin-top:12px"><strong>Summary:</strong> ${e(model.readinessMap.length)} topics. <span class="path-clear">${clear} clear</span>, <span class="path-weak">${weak} weak</span>, <span class="path-missing">${missing} missing</span>.</p>`);
}

function ideaTable(items) {
  return table(["Idea", "Frame", "Type", "Question Answered", "Pri"], items.map((x) => [e(x.idea), e(x.frame), e(x.type), e(x.question), `<span class="${severityClass(x.priority)}">${e(x.priority)}</span>`]));
}

function contentIdeas(model) {
  const site = model.evidence.site;
  const covered = [...new Set([...site.services, ...site.topicKeywords.map((x) => x.replace(/\b\w/g, (c) => c.toUpperCase()))])].slice(0, 8);
  const half = Math.ceil(covered.length / 2);
  const coverageTable = (items) => table(["Topic", "Coverage"], items.map((x, i) => [e(x), e(i < 2 ? "Moderate" : "Light")]));
  return section("topical-map-content-ideas", "05", "Topical Map + Content Ideas", `<p style="font-size:.85rem;color:var(--muted);margin-bottom:16px">Generated from crawl-visible evidence only. Suggestions answer buyer questions and strengthen trust.</p><h3>Covered Topics</h3><div class="two-col"><div>${coverageTable(covered.slice(0, half))}</div><div>${coverageTable(covered.slice(half))}</div></div><h3>TOFU — Awareness</h3>${ideaTable(model.contentIdeas.tofu)}<h3>MOFU — Consideration</h3>${ideaTable(model.contentIdeas.mofu)}<h3>BOFU — Decision</h3>${ideaTable(model.contentIdeas.bofu)}<h3>Leading-Edge Queries</h3>${table(["Query", "Rationale", "Pri"], model.contentIdeas.leading.map((x) => [e(x.query), e(x.rationale), `<span class="${severityClass(x.priority)}">${e(x.priority)}</span>`]))}`);
}

function competitorBenchmark(model) {
  const site = model.evidence.site;
  const competitors = model.competitors;
  const supplied = competitors.length ? table(["#", "Name", "URL", "Topic"], competitors.map((c, i) => [e(i + 1), e(c.name), `<a href="${e(c.url)}" target="_blank" rel="noopener">${e(new URL(c.url).hostname)}</a>`, e(c.topic || c.note || "Unavailable")])) : '<div class="note"><strong>Limitation:</strong> No competitor URLs were supplied. The audit continued without a competitor benchmark.</div>';
  const headers = ["Signal", site.domain, ...competitors.map((c) => c.name)];
  const value = (label, target, key) => [e(label), e(target), ...competitors.map((c) => e(c[key] || "Unavailable"))];
  const rows = [
    value("Offer Clarity", site.services.length >= 3 ? "Moderate" : "Light", "offerClarity"),
    value("Trust Proof (on-site)", model.bands.trust, "trustProof"),
    value("CTA Clarity", site.ctas.length ? "Moderate" : "Light", "ctaClarity"),
    value("Content Depth", model.scores.contentDepth >= 70 ? "Strong" : model.scores.contentDepth >= 40 ? "Moderate" : "Light", "contentDepth"),
    value("On-Site E-E-A-T Proof", model.bands.trust, "eeat"),
    value("Conversion Path Clarity", model.scores.conversionPathways >= 70 ? "Strong" : model.scores.conversionPathways >= 40 ? "Moderate" : "Light", "pathClarity"),
  ];
  const opportunity = competitors.length ? `The strongest positioning opportunity is to make the detected offer stack explicit, support it with visible proof, and connect each offer to one primary action. The comparison is based on visible on-page evidence from ${competitors.length} supplied competitor site(s).` : "A competitor-based positioning opportunity cannot be stated until competitor URLs are supplied. The report does not invent market-wide claims.";
  return section("supplied-competitor-benchmark", "06", "Supplied Competitor Benchmark — Conversion Positioning", `<div class="note"><strong>Disclaimer:</strong> This benchmark compares supplied competitor URLs for visible conversion-readiness signals only. It does not claim traffic, rankings, backlinks, market share, or domain authority.</div><h3>Supplied Competitors</h3>${supplied}<h3>Conversion-Positioning Comparison</h3>${table(headers, rows)}<h3>Positioning Opportunity</h3><p><strong>${e(model.input.businessName || site.domain)}:</strong> ${e(opportunity)}</p>`);
}

export { scorecard, priorityFixes, conversionPaths, readinessMap, contentIdeas, competitorBenchmark };

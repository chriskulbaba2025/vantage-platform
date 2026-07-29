import { e, severityClass, scoreCard, section, table } from "./html-helpers.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

function scorecard(model) {
  const { scores, bands, evidenceConfidenceScore, rootCause, evidence } = model;
  const site = evidence.site;

  // PRD §15.3 — assessed weight and readiness status
  const assessedWeight = model.assessedWeight ?? 100;
  const readinessStatus = model.readinessStatus ?? null;
  const showNumeric = model.showNumericScore !== false;

  // Readiness score card
  const readinessDisplay = showNumeric && scores.conversionReadiness !== null
    ? scores.conversionReadiness
    : "—";
  const readinessLabel = readinessStatus === "Provisional"
    ? "Conversion Readiness (Provisional)"
    : "Conversion Readiness";

  // Assessed weight and status banner
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
<p>Vantage Phase 1 Audit of <strong>${e(site.domain)}</strong>, a ${e(site.pageCount)}-page crawlable website detected as ${e(site.platform)}.</p>
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
  // Render evidence as readable text — never raw object coercion.
  function renderEvidence(f) {
    if (f.evidenceText) return e(f.evidenceText);
    if (Array.isArray(f.evidence)) {
      return e(f.evidence.map((er) => `${er.field}: ${er.observedValue ?? "unavailable"}`).join("; "));
    }
    return e(String(f.evidence || ""));
  }
  return section("priority-fixes", "02", "Priority Fixes", `<p style="margin-bottom:16px">Ranked by conversion impact. Each fix is tied to captured website or performance evidence.</p>${table(["#", "Sev", "Problem", "Evidence", "Conversion Impact", "Fix", "Effort"], model.findings.map((f, i) => [e(i + 1), `<span class="${severityClass(f.severity)}">${e(f.severity)}</span>`, e(f.problem), renderEvidence(f), e(f.impact), e(f.fix), e(f.effort)]))}`);
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
  const opp = model.competitorOpportunities || {};

  // Traditional crawl-based comparison (backward compat)
  const supplied = competitors.comparisons
    ? competitors.comparisons.length
      ? table(["#", "Name", "URL", "Topic"], competitors.comparisons.map((c, i) => [e(i + 1), e(c.name), `<a href="${e(c.url)}" target="_blank" rel="noopener">${e(new URL(c.url).hostname)}</a>`, e(c.topic || c.note || "Unavailable")]))
      : '<div class="note"><strong>Limitation:</strong> No competitor URLs were supplied. The audit continued without a competitor benchmark.</div>'
    : '<div class="note"><strong>Limitation:</strong> No competitor URLs were supplied. The audit continued without a competitor benchmark.</div>';

  const comps = competitors.comparisons || [];
  const headers = ["Signal", site.domain, ...comps.map((c) => c.name)];
  const value = (label, target, key) => [e(label), e(target), ...comps.map((c) => e(c[key] || "Unavailable"))];
  const rows = [
    value("Offer Clarity", site.services.length >= 3 ? "Moderate" : "Light", "offerClarity"),
    value("Trust Proof (on-site)", model.bands.trust, "trustProof"),
    value("CTA Clarity", site.ctas.length ? "Moderate" : "Light", "ctaClarity"),
    value("Content Depth", (model.scores.contentDepth ?? 0) >= 70 ? "Strong" : (model.scores.contentDepth ?? 0) >= 40 ? "Moderate" : "Light", "contentDepth"),
    value("On-Site E-E-A-T Proof", model.bands.trust === "Not Assessed" ? "Not Assessed" : model.bands.trust, "eeat"),
    value("Conversion Path Clarity", (model.scores.conversionPathways ?? 0) >= 70 ? "Strong" : (model.scores.conversionPathways ?? 0) >= 40 ? "Moderate" : "Light", "pathClarity"),
  ];

  // ── Competitor Opportunity Layer ─────────────────────────────────────
  const gaps = opp.gaps || [];
  const qualifiedCandidates = opp.qualifiedCandidates || [];
  const excludedCandidates = opp.excludedCandidates || [];
  const sources = opp.sources || {};
  const limitations = opp.limitations || [];

  const serpSource = sources.dataforseoSerp?.status || "NOT_CONNECTED";
  const suppliedSource = sources.supplied?.status || "NOT_APPLICABLE";

  const oppSection = gaps.length > 0
    ? `<h3>Qualified Competitor Gaps</h3>
<p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">Only approved, qualified gaps that passed all eligibility checks are shown. Each gap is tied to SERP or supplied-competitor evidence.</p>
${table(
  ["Topic", "Competitor Page", "Client Coverage", "Competitor Coverage", "Conversion Relevance", "Confidence", "Limitation"],
  gaps.map((g) => [
    e(g.clientTopic),
    `<a href="${e(g.competitorPage)}" target="_blank" rel="noopener">${e(g.competitorDomain || new URL(g.competitorPage).hostname)}</a>`,
    e(g.clientCoverage),
    e((g.observedCompetitorCoverage || []).join(", ") || "N/A"),
    e(g.conversionRelevance),
    e(g.confidence),
    e(g.limitationStatement?.slice(0, 120)),
  ]),
)}
${gaps.some((g) => g.recommendation) ? `<h3>Recommendations</h3><ul>${gaps.filter((g) => g.recommendation).map((g) => `<li><strong>${e(g.clientTopic)}:</strong> ${e(g.recommendation)}</li>`).join("")}</ul>` : ""}`
    : '<div class="note"><strong>No qualified gaps:</strong> No competitor gaps passed all qualification checks and auditor approval. This may indicate that competitors have not been approved, or that available competitors do not meet the comparison criteria.</div>';

  const sourcesSection = `<h3>Competitor Sources</h3>
<ul>
<li><strong>User-supplied:</strong> ${e(suppliedSource)} — ${e(sources.supplied?.candidateCount || 0)} candidate(s)</li>
<li><strong>DataForSEO SERP:</strong> ${e(serpSource)} — ${e(sources.dataforseoSerp?.candidateCount || 0)} candidate(s)${sources.dataforseoSerp?.taskIds?.length ? ` (task: ${e(sources.dataforseoSerp.taskIds.join(", "))})` : ""}</li>
<li><strong>Qualified candidates:</strong> ${e(qualifiedCandidates.length)}</li>
<li><strong>Excluded candidates:</strong> ${e(excludedCandidates.length)}</li>
</ul>`;

  const excludedSection = excludedCandidates.length > 0
    ? `<h3>Excluded Candidates</h3>
<p style="font-size:.8rem;color:var(--muted)">These candidates were excluded by the qualification gate and did not generate recommendations.</p>
${table(["URL", "Domain", "Reason"], excludedCandidates.slice(0, 10).map((c) => [e(c.candidateUrl?.slice(0, 60)), e(c.domain), e(c.exclusionReason)]))}`
    : "";

  const opportunity = comps.length
    ? `The strongest positioning opportunity is to make the detected offer stack explicit, support it with visible proof, and connect each offer to one primary action. The comparison is based on visible on-page evidence from ${comps.length} supplied competitor site(s)${serpSource === "AVAILABLE" ? ` and DataForSEO SERP analysis of ${qualifiedCandidates.length} qualified candidates` : ""}.`
    : "A competitor-based positioning opportunity cannot be stated until competitor URLs are supplied. The report does not invent market-wide claims.";

  return section(
    "supplied-competitor-benchmark",
    "06",
    "Supplied Competitor Benchmark — Conversion Positioning",
    `${sourcesSection}<div class="note"><strong>Disclaimer:</strong> This benchmark compares supplied competitor URLs and SERP-discovered competitors for visible conversion-readiness signals only. It does not claim traffic, rankings, backlinks, market share, or domain authority. No causal ranking claims are made.</div><h3>Supplied Competitors</h3>${supplied}<h3>Conversion-Positioning Comparison</h3>${table(headers, rows)}${oppSection}${excludedSection}<h3>Positioning Opportunity</h3><p><strong>${e(model.input.businessName || site.domain)}:</strong> ${e(opportunity)}</p>${limitations.length ? `<h3>Limitations</h3><ul>${limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : ""}`,
  );
}

export { scorecard, priorityFixes, conversionPaths, readinessMap, contentIdeas, competitorBenchmark };

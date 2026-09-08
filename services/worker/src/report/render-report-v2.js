/**
 * PRYSM-NEXT-01 WP-G — Report Design v2 renderer.
 *
 * Report content/data contract remains v2.0.0. PRYSM-V2-SECTION-VIEWER-01
 * versions the presentation layer as 2.2.0: the same governed index.html
 * artifact is presented as 16 conceptual pages with left navigation and
 * current-page browser printing. No evidence, scoring, lifecycle, storage,
 * route, or report-artifact contract is changed here.
 */

import { REPORT_DESIGN_V2 } from "./report-design.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";
import { computePillars } from "./v2-pillars.js";
import { buildActionPlan } from "./action-priority.js";
import { buildFoundationChecklist } from "./foundation-readiness.js";
import {
  foundationSection,
  eeatSection,
  technicalDetailSection,
  headingSection,
  schemaSection,
  performanceDetailSection,
  accessibilityMobileSection,
  machineReadinessSection,
  actionPlanSection,
  phase2Section,
} from "./report-detail-sections.js";

export const REPORT_V2_VIEWER_VERSION = "2.3.0";

export const REPORT_V2_VIEWER_PAGES = Object.freeze([
  Object.freeze({ pageId: "executive-scorecard", title: "Executive Scorecard", tier: "PRIMARY", sectionIds: Object.freeze(["executive"]) }),
  Object.freeze({ pageId: "priority-fixes", title: "Priority Fixes", tier: "PRIMARY", sectionIds: Object.freeze(["blockers"]) }),
  Object.freeze({ pageId: "conversion-paths", title: "Conversion Journey", tier: "PRIMARY", sectionIds: Object.freeze(["paths"]) }),
  Object.freeze({ pageId: "content-ideas", title: "Content Opportunities", tier: "PRIMARY", sectionIds: Object.freeze(["content-ideas"]) }),
  Object.freeze({ pageId: "competitor-benchmark", title: "Competitor Comparison", tier: "PRIMARY", sectionIds: Object.freeze(["competitors"]) }),
  Object.freeze({ pageId: "trust-eeat", title: "Trust & Credibility", tier: "PRIMARY", sectionIds: Object.freeze(["eeat"]) }),
  Object.freeze({
    pageId: "supporting-detail",
    title: "Supporting Detail",
    tier: "SUPPORTING",
    sectionIds: Object.freeze([
      "pillars",
      "foundations",
      "action-plan",
      "content-opportunities-detail",
      "competitor-detail",
      "eeat-detail",
      "performance",
      "accessibility-mobile",
      "cms",
      "technical",
      "headings",
      "schema",
      "machine-readiness",
      "internal-links",
      "evidence",
      "phase2",
    ]),
  }),
]);

function e(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bandChip(band) {
  const cls = {
    Strong: "band-strong",
    Moderate: "band-moderate",
    Limited: "band-limited",
    Weak: "band-weak",
    High: "band-strong",
    Directional: "band-weak",
  }[band] || "band-moderate";
  return `<span class="chip ${cls}">${e(band)}</span>`;
}

function impactCategory(finding) {
  if (finding.severity === "High") return "High impact";
  if (finding.severity === "Medium") return "Medium impact";
  return "Low impact";
}

const EFFORT_LABEL = { H: "High effort", M: "Medium effort", L: "Low effort" };

function capabilityStatusClass(status) {
  if (status === "AVAILABLE") return "cap-ok";
  if (status === "PARTIAL") return "cap-partial";
  if (status === "FAILED") return "cap-missing";
  return "cap-neutral";
}

export function clientFacingPageUrls(model, urls) {
  if (!Array.isArray(urls)) return [];

  let targetHost = "";

  try {
    const target =
      model?.input?.targetUrl ||
      model?.evidence?.site?.domain ||
      "";

    targetHost = new URL(
      String(target).startsWith("http")
        ? target
        : `https://${target}`,
    ).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    targetHost = "";
  }

  return urls.filter((value) => {
    try {
      const parsed = new URL(String(value));
      const host = parsed.hostname
        .replace(/^www\./, "")
        .toLowerCase();
      const path = parsed.pathname.toLowerCase();

      // Only client-owned site URLs belong in the client-facing report.
      if (
        targetHost &&
        host !== targetHost &&
        !host.endsWith(`.${targetHost}`)
      ) {
        return false;
      }

      // Infrastructure / proxy / holder routes are evidence, not pages.
      if (
        path.startsWith("/cdn-cgi/") ||
        path.match(
          /\.(?:css|js|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)$/i,
        )
      ) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  });
}

function clientFacingReportModel(model) {
  return {
    ...model,
    findings: (model?.findings || []).map((finding) => ({
      ...finding,
      affectedUrls: clientFacingPageUrls(
        model,
        finding.affectedUrls,
      ),
    })),
  };
}

function legacyExecutiveScorecard(model, pillars) {
  const site = model.evidence?.site || {};
  const readiness = model.scores.conversionReadiness;
  const confidence = model.evidenceConfidenceScore;
  const assessedWeight = model.assessedWeight ?? 0;
   const plan =
    buildActionPlan(
      model,
      buildFoundationChecklist(model),
    );

  const actions =
    (plan.actions || []).slice(0, 3);

  const findings =
    actions.map(
      (action) => action.finding,
    );

  const readinessLine =
    readiness === null
      ? `<div class="readiness-none">${e(model.readinessStatus || "Insufficient Evidence for Overall Score")}</div>`
      : `<div class="readiness">${e(readiness)}<span class="readiness-max">/100</span></div>
         <div class="readiness-band">${bandChip(model.bands.conversionReadiness)}</div>`;

  const availability = model.evidenceConfidenceFactorAvailability || [];
  const unknownFactors = availability.filter((f) => f.available === false).map((f) => f.factor);
  const knownFactors = availability.filter((f) => f.available === true).map((f) => f.factor);
  const capSummary = model.capabilityEvidence?.summary || { total: 0, assessed: 0 };
  const assessedCapabilities = `${capSummary.assessed ?? 0} of ${capSummary.total ?? 0} evidence capabilities`;

  const verdict =
    readiness === null
      ? "PRYSM could not produce a dependable overall conversion-readiness score from the available evidence. The report therefore separates what was assessed from what remains unavailable."
      : model.readinessStatus === "Provisional"
        ? `The site has a measurable conversion-readiness baseline of ${readiness}/100, but the result is provisional because some intended evidence was unavailable.`
        : `The site has a conversion-readiness score of ${readiness}/100. The priority is to address the highest-impact issues that most directly affect clarity, trust, and movement toward action.`;

   const primaryFinding =
    actions[0]?.finding || null;

  const rootCause =
    primaryFinding
      ? `${primaryFinding.title || "Primary governed finding"}. ${
          primaryFinding.businessImpact ||
          "Material impact was identified in the assessed evidence."
        }`
      : "No single primary constraint was established from the available evidence.";

  const findingsHtml = findings.length
    ? `<ol>${findings.map((f) => `<li><strong>${e(f.title || "Finding")}</strong> — ${e(f.businessImpact || "Material impact identified in the assessed evidence.")}</li>`).join("")}</ol>`
    : ["BLOCKED", "FAILED", "UNAVAILABLE", "NOT_CONNECTED"].includes(String(site.sourceStatus || ""))
      ? `<p><span class="chip cap-neutral">LIMITED EVIDENCE</span> No page-level conclusion is made because usable page evidence was not available for this audit.</p>`
      : `<p><span class="chip cap-ok">PASS</span> No material finding was produced from the evidence assessed.</p>`;

  const actionsHtml = actions.length
    ? `<ol>${actions.map((a) => `<li><strong>${e(a.finding?.title || "Priority action")}</strong> — ${e(a.finding?.recommendation || "Address the governed finding and verify the change.")}</li>`).join("")}</ol>`
    : `<p>No priority action was generated from the assessed evidence.</p>`;

  const strengths = [];
  for (const p of pillars || []) {
    if (typeof p.score === "number" && p.score >= 60) {
      strengths.push(`${p.label}: ${p.score}/100`);
    }
  }

  const limitationItems = [];
  if (assessedWeight < 100) {
    limitationItems.push(`${assessedWeight}% of intended dimension weight was assessed.`);
  }
  if (unknownFactors.length) {
    limitationItems.push(`Evidence-confidence factors not available: ${unknownFactors.join(", ")}.`);
  }
  if (model.readinessStatus === "Provisional") {
    limitationItems.push("The overall readiness result is provisional.");
  }
  if (readiness === null) {
    limitationItems.push("PRYSM withheld the overall numeric readiness score because evidence coverage was insufficient.");
  }

  return `
  <section id="executive" class="card">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">How ready is your website to convert the right visitors?</p>
    <p class="muted small">Executive Scorecard</p>

    <h2>Executive verdict</h2>
    <p>${e(verdict)}</p>

    <div class="grid-3">
      <div>
        <h2>A. Conversion Readiness</h2>
        ${readinessLine}
        <p class="muted">${e(model.readinessStatusDetail || model.readinessStatus || "")}</p>
        <p class="muted small">How effectively the assessed site supports a visitor moving toward action.</p>
      </div>
      <div>
        <h2>B. Evidence Confidence</h2>
        <div class="confidence">${e(confidence)}<span class="readiness-max">/100</span></div>
        ${bandChip(model.bands.evidenceConfidence)}
        <p class="muted">Known factors: ${e(knownFactors.length)} · Unknown (excluded): ${e(unknownFactors.length)}</p>
        <p class="muted small">How dependable and complete the available audit evidence is.</p>
      </div>
      <div>
        <h2>C. Evidence Coverage</h2>
        <div class="coverage">${e(assessedWeight)}<span class="readiness-max">%</span></div>
        <p class="muted">${e(assessedCapabilities)}</p>
        <p class="muted">Modules assessed: ${Object.values(model.moduleScores || {}).filter((m) => m?.score !== null && m?.score !== undefined).length} of ${Object.values(model.moduleScores || {}).length}</p>
        <p class="muted small">Missing evidence is not treated as a negative site finding.</p>
      </div>
    </div>

    <h3>What is really holding the site back?</h3>
    <p><strong>Primary root cause:</strong> ${e(rootCause)}</p>
    ${findingsHtml}

    <h3>What should you do first?</h3>
    ${actionsHtml}

    <h3>What Is Already Working</h3>
    ${strengths.length
      ? `<ul>${strengths.slice(0, 5).map((s) => `<li>${e(s)}</li>`).join("")}</ul>`
      : `<p>No readiness dimension reached the positive reporting threshold in the currently assessed evidence.</p>`}

    <h3>What could we not determine?</h3>
    ${limitationItems.length
      ? `<div class="note"><strong>PARTIAL:</strong> ${e(limitationItems.join(" "))}</div>`
      : `<div class="note"><strong>PASS:</strong> The intended executive evidence was sufficiently available for the reported conclusion.</div>`}

    <h3>Where to go next</h3>
    <p>Continue to <strong>Priority Fixes</strong> for the ranked actions, supporting evidence, and verification steps behind these executive priorities.</p>
  </section>`;
}
function executiveText(value) {
  return String(value || "")
    .replace(
      /Buyer-question content was not detected in the available partial assessment/gi,
      "Some common buyer questions are not clearly answered on the pages we could assess",
    )
    .replace(
      /The available partial assessment did not detect buyer-question content on the assessed pages, so some buyer questions may remain unsupported there; unassessed pages remain unknown\.?/gi,
      "Some common buyer questions are not clearly answered on the pages we could assess. Other pages were not assessed.",
    )
    .replace(/available\s+partial\s+assessment/gi, "pages we could assess")
    .replace(/assessed evidence/gi, "evidence reviewed")
    .replace(/largest contentful paint|\bLCP\b/gi, "main content")
    .replace(/meta descriptions?/gi, "Search-result descriptions")
    .replace(/render-blocking/gi, "unnecessary loading")
    .replace(/evidence capabilities?/gi, "assessment evidence")
    .replace(/supporting capabilities?/gi, "supporting evidence")
    .replace(/JSON-LD/gi, "structured-data")
    .replace(/browser validation/gi, "review")
    .replace(/Known factors|Unknown \(excluded\)|Modules assessed|intended dimension weight/gi, "assessment detail");
}

function executivePriority(action) {
  const finding = action.finding || {};
  if (finding.ruleId === "VAN-PERF-001" || finding.id === "VAN-PERF-001") {
    return {
      problem: "Main content takes too long to appear on mobile.",
      why: "This can create friction for people using the site on mobile devices.",
      action: "Reduce the time it takes for the main mobile content to appear, then retest the page.",
    };
  }
  return {
    problem: executiveText(finding.title || "A supported improvement needs attention."),
    why: executiveText(finding.businessImpact || "This may create friction for visitors in the assessed scope."),
    action: executiveText(finding.recommendation || "Address the supported finding, then verify the change."),
  };
}

function executiveScorecard(model, pillars) {
  const readiness = model.scores.conversionReadiness;
  const assessedWeight = Number(model.assessedWeight ?? 0);
  const actions = (buildActionPlan(model, buildFoundationChecklist(model)).actions || []).slice(0, 3);
  const readinessLine = readiness === null
    ? `<div class="readiness-none">${e(model.readinessStatus || "Overall score unavailable")}</div>`
    : `<div class="readiness">${e(readiness)}<span class="readiness-max">/100</span></div><div class="readiness-band">${bandChip(model.bands.conversionReadiness)}</div>`;
  const priorities = actions.length
    ? `<ol class="executive-priorities">${actions.map((action) => {
      const item = executivePriority(action);
      return `<li><p><strong>Problem:</strong> ${e(executiveText(item.problem))}</p><p><strong>Why it matters:</strong> ${e(executiveText(item.why))}</p><p><strong>Action:</strong> ${e(executiveText(item.action))}</p></li>`;
    }).join("")}</ol>`
    : `<p>No priority action was generated from the information reviewed.</p>`;
  const strengths = (pillars || [])
    .filter((pillar) => typeof pillar.score === "number" && pillar.score >= 60)
    .slice(0, 5)
    .map((pillar) => `${pillar.label} provides a solid foundation in the pages and signals reviewed.`);
  const coverage = assessedWeight >= 100
    ? `<p><strong>Assessment coverage was complete.</strong> The available information was sufficient for the reported conclusion.</p>`
    : assessedWeight >= 90
      ? `<p>Assessment coverage was nearly complete. Areas with limited evidence are clearly marked.</p>`
      : `<p>Assessment coverage was limited. Areas with limited evidence are clearly marked.</p>`;
  const uncertainty = readiness === null
    ? "There was not enough information to produce an overall score. The report distinguishes what was reviewed from what remains unknown."
    : model.readinessStatus === "Provisional"
      ? "Some information was unavailable, so this overall result should be read as provisional."
      : "No material limitation changes the overall conclusion.";
  return `
  <section id="executive" class="card">
    <h2>How ready is your website to convert visitors?</h2>
    <p class="muted small">Executive Scorecard</p>
    <div class="executive-readiness"><h3>Conversion Readiness</h3>${readinessLine}<p class="muted small">How effectively the site supports a visitor moving toward action.</p></div>
    <h3>What should you improve first?</h3>${priorities}
    <h3>What is already working?</h3>
    ${strengths.length ? `<ul>${strengths.map((strength) => `<li>${e(strength)}</li>`).join("")}</ul>` : `<p>No supported positive finding was available in the information reviewed.</p>`}
    <h3>What could we not determine?</h3><div class="note"><p>${e(uncertainty)}</p>${coverage}</div>
    <h3>Where to find supporting detail</h3><p>Go to <strong>Priority Fixes</strong> for ranked actions and evidence detail. Use <strong>Supporting Detail</strong> for deeper evidence, technical diagnostics, and assessment limitations.</p>
  </section>`;
}

function pillarSection(pillars) {
  const available = (pillars || []).filter((p) => typeof p.score === "number");
  const weak = available.filter((p) => p.score < 60).sort((a, b) => a.score - b.score);
  const strong = available.filter((p) => p.score >= 60).sort((a, b) => b.score - a.score);

  const bandLabel = (score) => {
    if (score === null || score === undefined) return "Limited Evidence";
    if (score >= 80) return "Strong";
    if (score >= 60) return "Adequate";
    if (score >= 40) return "Needs Attention";
    return "Material Gap";
  };

  const cx = 230;
  const cy = 170;
  const radius = 112;
  const angleFor = (index) => (-Math.PI / 2) + (index * 2 * Math.PI / Math.max(1, pillars.length));
  const pointFor = (index, value) => {
    const angle = angleFor(index);
    const r = radius * (value / 100);
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };
  const polygonFor = (value) =>
    pillars.map((_, index) => pointFor(index, value).map((n) => n.toFixed(1)).join(",")).join(" ");

  const allAvailable = pillars.length === 5 && pillars.every((p) => typeof p.score === "number");
  const dataPolygon = allAvailable
    ? pillars.map((p, index) => pointFor(index, p.score).map((n) => n.toFixed(1)).join(",")).join(" ")
    : "";

  const axes = pillars.map((p, index) => {
    const [x, y] = pointFor(index, 100);
    const [lx, ly] = pointFor(index, 126);
    const short = [
      "Conversion",
      "Trust",
      "Content",
      "Technical",
      "Entity / AI",
    ][index] || p.label;
    const marker = typeof p.score === "number"
      ? (() => {
          const [mx, my] = pointFor(index, p.score);
          return `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="4"><title>${e(p.label)}: ${e(p.score)}</title></circle>`;
        })()
      : "";
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="currentColor" opacity=".22"/>
      ${marker}
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="11">${e(short)}${typeof p.score === "number" ? "" : "*"}</text>`;
  }).join("");

  const cards = pillars.map((p) => {
    const scoreHtml = p.score === null
      ? `<div class="pillar-score none">Not Assessed</div>`
      : `<div class="pillar-score">${e(p.score)}<span class="readiness-max">/100</span></div>`;
    const modules = p.modules
      .map((m) => `<li>${e(m.moduleId)}: ${m.score === null ? "suppressed" : e(m.score)} (weight ${e(m.weight)})</li>`)
      .join("");
    const caps = p.capabilities
      .map((c) => `<span class="chip ${capabilityStatusClass(c.status)}">${e(c.key)}: ${e(c.status)}</span>`)
      .join(" ");
    return `
      <div class="pillar">
        <h3>${e(p.label)}</h3>
        ${scoreHtml}
        <p class="small"><strong>${e(bandLabel(p.score))}</strong>${p.hasIncompleteFieldEvidence ? " · Real-user performance data was not available, so this result reflects lab measurements and is not a complete real-user readiness conclusion." : ""}</p>
        <ul class="pillar-modules">${modules}</ul>
        <div class="pillar-caps">${caps}</div>
      </div>`;
  }).join("");

  const performanceLimited = (pillars || []).find((pillar) => pillar.id === "performance_experience")?.hasIncompleteFieldEvidence === true;
  const directAnswer = weak.length
    ? `Readiness is uneven. ${weak[0].label} is the weakest assessed dimension at ${weak[0].score}/100, while stronger dimensions provide a foundation to build on.`
    : available.length
      ? `The assessed readiness dimensions are broadly adequate or strong, with no dimension currently below the Adequate band.${performanceLimited ? " Real-user performance data was not available, so the Performance & Experience result is not a complete real-user readiness conclusion." : ""}`
      : "PRYSM could not produce dimension-level readiness scores from the available evidence.";

  return `<section id="pillars" data-supporting-section="readiness-overview">
    <div id="supporting-detail-orientation" class="supporting-detail-orientation">
      <p class="supporting-detail-kicker">Supporting Detail</p>
      <h2>Evidence &amp; detail behind the report</h2>
      <p>Supporting Detail proves and explains the six primary-page conclusions. Representative evidence is shown first, with deeper evidence available where it helps a consulting decision.</p>
      <nav class="supporting-detail-jumps nav-jump" aria-label="Supporting Detail contents" data-supporting-detail-nav>
        <a href="#pillars">Readiness Overview</a>
        <a href="#foundations">Foundations</a>
        <a href="#content-opportunities-detail">Conversion &amp; Content Evidence</a>
        <a href="#competitor-detail">Competitive &amp; Trust Evidence</a>
        <a href="#technical">Search &amp; Technical Evidence</a>
        <a href="#performance">Performance &amp; Accessibility</a>
        <a href="#cms">Platform &amp; Internal Links</a>
        <a href="#phase2">Evidence &amp; Limitations</a>
      </nav>
    </div>
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Where is the site helping or hurting conversion?</p>
    <p class="muted small">Conversion Readiness Map</p>
    <h2>Where are the problems?</h2>
    <p>${e(directAnswer)}</p>
        <div style="overflow-x:auto;margin:18px 0 22px">
      <svg viewBox="0 0 460 340" role="img" aria-label="Five-axis conversion readiness map" style="width:100%;max-width:720px;display:block;margin:0 auto">
        <polygon points="${polygonFor(100)}" fill="none" stroke="currentColor" opacity=".15"/>
        <polygon points="${polygonFor(80)}" fill="none" stroke="currentColor" opacity=".12"/>
        <polygon points="${polygonFor(60)}" fill="none" stroke="currentColor" opacity=".10"/>
        <polygon points="${polygonFor(40)}" fill="none" stroke="currentColor" opacity=".08"/>
        ${axes}
        ${allAvailable ? `<polygon points="${dataPolygon}" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-width="2"/>` : ""}
      </svg>
    </div>

    <p class="muted small">Bands: Strong 80–100 · Adequate 60–79 · Needs Attention 40–59 · Material Gap below 40. An asterisk marks a dimension with limited evidence. Missing dimensions are never plotted as zero.</p>

    <details class="supporting-detail-disclosure">
      <summary>Readiness dimensions and capability detail</summary>
      <div class="pillar-grid">${cards}</div>
    </details>

    <h3>What is driving weaker areas</h3>
    ${weak.length
      ? `<ul>${weak.map((p) => `<li><strong>${e(p.label)}</strong> — ${e(p.score)}/100 (${e(bandLabel(p.score))}). Review the assessed findings and evidence limitations shown on this page.</li>`).join("")}</ul>`
      : "<p>No assessed dimension is currently below the Adequate band.</p>"}

    <h3>Where the foundation is strong</h3>
    ${strong.length
      ? `<ul>${strong.map((p) => `<li><strong>${e(p.label)}</strong> — ${e(p.score)}/100 (${e(bandLabel(p.score))}).</li>`).join("")}</ul>`
      : "<p>No assessed dimension reached the Adequate band.</p>"}

    <h3>Evidence limitations by dimension</h3>
    <ul class="small">
      ${pillars.map((p) => {
        const unavailableCaps = p.capabilities.filter((c) => c.status !== "AVAILABLE");
        if (!unavailableCaps.length) return "";
        const limitation = p.id === "offer_content"
          ? "Content coverage was partial, so conclusions about page content apply only to the assessed pages."
          : p.id === "performance_experience"
            ? "Real-user performance data was unavailable, so the performance conclusion relies on lab measurements."
            : "Evidence coverage was limited for this dimension.";
        return `<li><strong>${e(p.label)}:</strong> ${e(limitation)}</li>`;
      }).join("")}
    </ul>
  </section>`;
}

function priorityClientCopy(action) {
  const finding = action?.finding || {};
  const ruleId = finding.ruleId || finding.id;
  const title = String(finding.title || "A supported improvement needs attention.");
  const impact = String(finding.businessImpact || "This may create friction for visitors in the reviewed scope.");
  const recommendation = String(finding.recommendation || "Address the issue in the reviewed scope, then confirm the change.");

  if (ruleId === "VAN-PERF-001") {
    return {
      title: "Main content takes too long to appear on mobile.",
      why: "Visitors may have to wait too long before they can use the page.",
      change: "Reduce the time required for the main mobile content to appear, then retest.",
      scope: "Mobile pages reviewed",
      confirm: "Retest the mobile page and confirm the main content appears sooner.",
      uncertainty: "",
    };
  }

  if (ruleId === "VAN-CONTENT-002") {
    return {
      title: "Buyer-question content was not found on the pages we could assess.",
      why: "Visitors may still have common questions before they decide to contact the business.",
      change: "Add clear answers to the common questions prospects ask before taking the next step.",
      scope: "Pages we could assess",
      confirm: "Review the assessed pages and confirm the common buyer questions are answered clearly.",
      uncertainty: "This conclusion applies only to the pages we could assess; other pages remain unknown.",
    };
  }

  if (ruleId === "VAN-TECH-001" || /meta descriptions?/i.test(title)) {
    return {
      title: "Some assessed pages do not have a search-result description.",
      why: "Search-result descriptions help set expectations before someone visits a page.",
      change: "Write a clear, distinct search-result description for each important page.",
      scope: "Some assessed pages",
      confirm: "Review the assessed pages and confirm each important page has a clear search-result description.",
      uncertainty: /unassessed|partial|assessed pages/i.test(`${title} ${impact}`)
        ? "The conclusion is limited to the pages reviewed; unassessed pages remain unknown."
        : "",
    };
  }

  if (ruleId === "VAN-TECH-002" || /heading structure is inconsistent/i.test(title)) {
    return {
      title: "Page headings are inconsistent.",
      why: "Clear headings help visitors understand each page and find the information they need.",
      change: "Use one clear main heading per page followed by a consistent heading structure.",
      scope: "Pages where headings were reviewed",
      confirm: "Review the assessed pages and confirm headings follow a clear, consistent structure.",
      uncertainty: /unassessed|partial|assessed pages/i.test(`${title} ${impact}`)
        ? "The conclusion is limited to the pages reviewed; unassessed pages remain unknown."
        : "",
    };
  }

  if (ruleId === "VAN-TECH-003" || /security headers are incomplete/i.test(title)) {
    return {
      title: "Some basic browser protections were not detected in the website response we tested.",
      why: "These protections help reduce avoidable security risk in the browser.",
      change: "Ask your developer or hosting provider to add the missing browser protections.",
      scope: "Website response tested",
      confirm: "Run the security check again and confirm the protections are present.",
      uncertainty: /unassessed|partial|assessed response|assessed pages/i.test(`${title} ${impact}`)
        ? "This conclusion is limited to the response that was assessed; it does not establish a site-wide condition."
        : "",
    };
  }

  return {
    title: executiveText(title),
    why: executiveText(impact),
    change: executiveText(recommendation),
    scope: Array.isArray(finding.affectedUrls) && finding.affectedUrls.length
      ? "Pages where the issue was detected"
      : "Pages covered by the available evidence",
    confirm: "Repeat the relevant check and confirm the observed condition has improved.",
    uncertainty: /unassessed|partial|not detected|not assessed|unavailable/i.test(`${title} ${impact}`)
      ? "The conclusion is limited to the evidence that was available; unassessed areas remain unknown."
      : "",
  };
}

function blockersSection(model, plan) {
  if (plan.actions.length === 0) {
    return `<section id="blockers" class="card">
      <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">What should you fix first?</p>
      <p class="muted small">Priority Fixes</p>
      <h2>What should you fix first?</h2>
      <p><span class="chip cap-ok">PASS</span> No prioritized action was produced from the available evidence.</p>
    </section>`;
  }

  const primary = plan.actions.slice(0, 5);
  const cards = primary.map((action) => {
    const copy = priorityClientCopy(action);
    const uncertainty = copy.uncertainty
      ? `<div class="priority-field priority-field-uncertainty"><dt>Material uncertainty</dt><dd>${e(copy.uncertainty)}</dd></div>`
      : "";
    return `<article class="priority-action" data-priority-rank="${e(action.rank)}">
      <div class="priority-action-heading">
        <span class="priority-rank" aria-label="Priority ${e(action.rank)}">${e(action.rank)}</span>
        <div>
          ${action.rank === 1 ? '<span class="priority-start">Start here</span>' : ''}
          <h3>${e(copy.title)}</h3>
        </div>
      </div>
      <dl class="priority-action-fields">
        <div class="priority-field priority-field-attention"><dt>What needs attention</dt><dd>${e(copy.title)}</dd></div>
        <div class="priority-field"><dt>Why it matters</dt><dd>${e(copy.why)}</dd></div>
        <div class="priority-field"><dt>What to change</dt><dd>${e(copy.change)}</dd></div>
        <div class="priority-field"><dt>Where it applies</dt><dd>${e(copy.scope)}</dd></div>
        <div class="priority-field"><dt>How to confirm it improved</dt><dd>${e(copy.confirm)}</dd></div>
        ${uncertainty}
      </dl>
    </article>`;
  }).join("");

  return `
  <section id="blockers" class="card">
    <p class="muted small">Priority Fixes</p>
    <h2>What should you fix first?</h2>
    <p>Start with #1 and work down the list. Supporting Detail contains the deeper evidence and technical checks.</p>
    <div class="priority-sequence">${cards}</div>
    <p class="muted small">Supporting Detail retains the complete evidence, technical checks, and any additional observations.</p>
  </section>`;
}

function legacyConversionPathSection(model) {
  const paths = Array.isArray(model.conversionPaths) ? model.conversionPaths : [];

  if (paths.length === 0) {
    return `<section id="paths" class="card">
      <p class="muted small">Conversion Journey</p>
      <h2>Can visitors move easily from interest to action?</h2>
      <p class="conversion-journey-verdict"><span class="chip cap-neutral">UNAVAILABLE</span> The available path evidence is incomplete, so a clear route cannot be confirmed.</p>
      <p class="conversion-journey-limitation">No assessed path stages were available in the persisted evidence. This page does not measure completed conversions or unassessed pages.</p>
    </section>`;
  }

  const primary = paths[0];
  const allBlockers = [...new Set(paths.flatMap((p) => p.blockers || []))];
  const clearCount = paths.filter((p) => p.status === "Clear").length;
  const weakCount = paths.filter((p) => p.status === "Weak").length;
  const unavailableCount = paths.length - clearCount - weakCount;

  const verdict =
    clearCount === paths.length
      ? "The assessed path to action is clear."
      : weakCount > 0
        ? "The assessed path needs attention before it can be described as clear."
        : "The available path evidence is incomplete, so a clear route cannot be confirmed.";

  const clientJourneyLabel = (label) => {
    const text = String(label || "").trim();
    if (/^Browser validation assessed conversion actions on /i.test(text)) return "Pages reviewed";
    if (/^A conversion action was observed on /i.test(text)) return "Visible next step";
    if (/^A visible, interactable(?:,| and) unobstructed action was confirmed on /i.test(text)) return "Clear path toward action";
    const translations = new Map([
      ["Browser validation assessed conversion actions on 6 of 6 selected page(s).", "Pages reviewed"],
      ["A conversion action was observed on 6 assessed page(s).", "Visible next step"],
      ["A visible, interactable, unobstructed action was confirmed on 6 assessed page(s).", "Clear path toward action"],
      ["Entry", "Arrive on the page"],
      ["Service understanding", "Understand the service"],
      ["Trust / proof", "Build confidence"],
      ["Primary CTA", "Choose the next step"],
      ["Conversion destination", "Complete the next step"],
    ]);
    return translations.get(text) || text;
  };

  const flowLabels = (primary.steps || [])
    .map(clientJourneyLabel)
    .filter(Boolean);

  const flowLabelLines = (label) => {
    const words = String(label).trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    for (const word of words) {
      if (current && `${current} ${word}`.length > 22) {
        lines.push(current);
        current = word;
      } else current = current ? `${current} ${word}` : word;
    }
    if (current) lines.push(current);
    return lines.length ? lines : ["—"];
  };

  const stageWidth = flowLabels.length <= 5 ? 180 : 150;
  const stageGap = flowLabels.length <= 5 ? 42 : 24;
  const canvasWidth = Math.max(
    1120,
    40 + flowLabels.length * stageWidth + Math.max(0, flowLabels.length - 1) * stageGap,
  );
  const flowSvg = `
    <div class="conversion-journey-visual">
      <svg viewBox="0 0 ${canvasWidth} 260" role="img" aria-label="Assessed path to action">
        <defs>
          <marker id="pathArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="currentColor"/>
          </marker>
        </defs>
        ${flowLabels.map((label, index) => {
          const x = 20 + index * (stageWidth + stageGap);
          const lines = flowLabelLines(label);
          const startY = 124 - ((lines.length - 1) * 11);
          return `<rect x="${x}" y="70" width="${stageWidth}" height="86" rx="16" class="conversion-journey-stage"/>
            <text x="${x + (stageWidth / 2)}" y="${startY}" text-anchor="middle">${lines.map((line, lineIndex) => `<tspan x="${x + (stageWidth / 2)}" dy="${lineIndex === 0 ? 0 : 24}">${e(line)}</tspan>`).join("")}</text>
            ${index < flowLabels.length - 1 ? `<line x1="${x + stageWidth}" y1="113" x2="${x + stageWidth + stageGap - 10}" y2="113" class="conversion-journey-arrow" marker-end="url(#pathArrow)"/>` : ""}`;
        }).join("")}
      </svg>
    </div>`;

  const workingCopy = clearCount === paths.length
    ? "Visitors on the pages we assessed had a visible next step. No material obstacle was established in the assessed path."
    : weakCount > 0
      ? "The assessed path is visible, but the reported route still needs attention before it can be treated as clear."
      : "The assessed path is only partly evidenced, so the conclusion remains limited.";
  const blockerNote = allBlockers.length
    ? ` The assessed evidence identifies: ${allBlockers.map((blocker) => e(blocker)).join("; ")}.`
    : "";
  const limitation = unavailableCount || paths.length > 0
    ? "This conclusion applies only to the assessed path; it does not measure completed conversions or unassessed pages."
    : "";

  return `
  <section id="paths" class="card">
    <p class="muted small">Conversion Journey</p>
    <h2>Can visitors move easily from interest to action?</h2>
    <p class="conversion-journey-verdict">${e(verdict)}</p>
    ${flowSvg}
    <h3>What is working</h3>
    <p>${workingCopy}${blockerNote}</p>
    ${limitation ? `<p class="conversion-journey-limitation">${e(limitation)}</p>` : ""}
  </section>`;
}

function conversionPathSection(model) {
  const paths = Array.isArray(model.conversionPaths) ? model.conversionPaths : [];
  const trustBand = model.bands?.trust;
  if (paths.length === 0) {
    return `<section id="paths" class="card">
      <p class="muted small">Conversion Journey</p>
      <h2>Can visitors move easily from interest to action?</h2>
      <p class="conversion-journey-verdict"><span class="chip cap-neutral">UNAVAILABLE</span> The available path evidence is incomplete, so a clear route cannot be confirmed.</p>
      <div class="conversion-journey-limitation"><strong>What we could not determine</strong><p>No assessed path stages were available in the persisted evidence. This assessment does not measure completed enquiries or behavior on unassessed pages.</p></div>
    </section>`;
  }

  const allBlockers = [...new Set(paths.flatMap((path) => path.blockers || []))];
  const clearCount = paths.filter((path) => path.status === "Clear").length;
  const weakCount = paths.filter((path) => path.status === "Weak").length;
  const findingIds = new Set((model.findings || []).map((finding) => finding.ruleId || finding.id));
  const verdict = clearCount === paths.length
    ? "The assessed path to action is clear, but there are opportunities to make that journey faster and more reassuring."
    : weakCount > 0
      ? "The assessed path needs attention before it can be described as clear."
      : "The available path evidence is incomplete, so a clear route cannot be confirmed.";

  const journeySteps = [
    ["Reach the key pages", "Visitors can reach the assessed pages used to evaluate the offer."],
    ["See a clear next step", "A visible action was available on the pages assessed."],
    ["Move toward action", "No material route blocker was established in the assessed path."],
  ];
  const journeyVisual = `<div class="conversion-journey-visual" role="img" aria-label="Three-step assessed conversion journey">
    <div class="conversion-journey-steps">${journeySteps.map(([title, description], index) => `<div class="conversion-journey-step">
      <span class="conversion-journey-step-number">${index + 1}</span>
      <h3>${e(title)}</h3>
      <p>${e(description)}</p>
    </div>`).join("")}</div>
  </div>`;

  const workingCopy = clearCount === paths.length
    ? "The assessed pages provide a visible next step. No material path blocker was established. The conversion route itself is a strength to preserve."
    : weakCount > 0
      ? "The assessed path is visible, but the reported route still needs attention before it can be treated as clear."
      : "The assessed path is only partly evidenced, so the conclusion remains limited.";
  const blockerNote = allBlockers.length
    ? `<p class="muted small">The assessed path also records: ${allBlockers.map((blocker) => e(blocker)).join("; ")}.</p>`
    : "";
  const momentumCards = [];
  if (findingIds.has("VAN-PERF-001")) {
    momentumCards.push({
      title: "Mobile loading friction",
      finding: "Main content takes too long to appear on mobile.",
      meaning: "Visitors may experience delay before they can fully engage with the page or reach the next step.",
    });
  }
  if (findingIds.has("VAN-CONTENT-002")) {
    momentumCards.push({
      title: "Decision-support gap",
      finding: "Buyer-question content was not found on the pages we could assess.",
      meaning: "Some visitors may reach the action point while still having unanswered questions.",
      limitation: "This applies only to the pages we could assess; other pages remain unknown.",
    });
  }
  const momentumSection = momentumCards.length
    ? `<h3>Where visitors may lose momentum</h3><div class="conversion-journey-card-grid">${momentumCards.map((card) => `<article class="conversion-journey-detail-card">
      <h4>${e(card.title)}</h4>
      <p><strong>Finding:</strong> ${e(card.finding)}</p>
      <p><strong>Client meaning:</strong> ${e(card.meaning)}</p>
      ${card.limitation ? `<p class="muted small">${e(card.limitation)}</p>` : ""}
    </article>`).join("")}</div>`
    : "";
  const bridgeCards = [];
  if (findingIds.has("VAN-CONTENT-002")) {
    bridgeCards.push({
      title: "Content that answers buyer questions",
      interpretation: "Some visitors may reach the next step while still having unanswered questions. Buyer-question content was not found on the pages we could assess.",
      cta: "See Content Opportunities →",
      target: "#content-ideas",
    });
  }
  if (trustBand) {
    bridgeCards.push({
      title: "Trust that reduces hesitation",
      interpretation: "The assessed site has useful trust signals. The next question is whether that proof appears where buyers need reassurance before acting.",
      cta: "See Trust & Credibility →",
      target: "#trust-eeat",
    });
  }
  if (findingIds.has("VAN-PERF-001")) {
    bridgeCards.push({
      title: "Performance that keeps momentum",
      interpretation: "The route is clear, but slow mobile loading may create friction before visitors fully engage with the next step.",
      cta: "See Priority Fixes →",
      target: "#priority-fixes",
    });
  }
  const journeyBridge = bridgeCards.length
    ? `<h3>What supports this journey?</h3><div class="conversion-journey-bridge-grid">${bridgeCards.map((card) => `<article class="conversion-journey-bridge-card">
      <h4>${e(card.title)}</h4>
      <p>${e(card.interpretation)}</p>
      <a class="conversion-journey-bridge-link" href="${e(card.target)}">${e(card.cta)}</a>
    </article>`).join("")}</div>`
    : "";

  return `<section id="paths" class="card">
    <p class="muted small">Conversion Journey</p>
    <h2>Can visitors move easily from interest to action?</h2>
    <p class="conversion-journey-verdict">${e(verdict)}</p>
    <h3>How the journey works</h3>
    ${journeyVisual}
    <h3>Where the journey is strong</h3>
    <div class="conversion-journey-strength"><p>${e(workingCopy)}</p>${blockerNote}</div>
    ${momentumSection}
    <h3>What this means for conversion</h3>
    <p>The route itself is not the main issue. The stronger opportunity is improving the experience around that route so visitors can reach the next step faster and with fewer unanswered questions.</p>
    <h3>What to improve around the journey</h3>
    <ol class="conversion-journey-actions">
      <li>Reduce the wait before the main mobile content appears.</li>
      <li>Answer common buyer questions before or near the point of action.</li>
      <li>Preserve the existing clear route while making the surrounding decision experience easier.</li>
    </ol>
    <div class="conversion-journey-takeaway"><strong>Conversion takeaway</strong><p>The assessed route is already clear. The best opportunity is not to redesign the path, but to remove friction around it—help mobile visitors engage sooner and answer more of their questions before they are asked to act.</p></div>
    ${journeyBridge}
    <div class="conversion-journey-limitation"><strong>What we could not determine</strong><p>This assessment does not measure completed enquiries, CTA click-through rate, form completion rate, abandonment, scroll depth, or behavior on unassessed pages.</p></div>
  </section>`;
}

function competitorSection(model) {
  const comparisons = model.competitors?.comparisons || [];
  const clientComparisons = comparisons.filter(
    (comparison) => comparison?.status === SOURCE_STATUS.AVAILABLE,
  );

   const opportunityData =
    model.competitors?.opportunities ||
    {};

  const limitations = opportunityData.limitations || [];
  const gaps = opportunityData.gaps || [];
  const qualifiedCandidates = opportunityData.qualifiedCandidates || [];
  const excludedCandidates = opportunityData.excludedCandidates || [];
  const competitorSourceStatus =
    model.sourceStatus?.competitors || SOURCE_STATUS.NOT_APPLICABLE;

  if (clientComparisons.length === 0) {
    const noComparisonState = {
      [SOURCE_STATUS.FAILED]: {
        label: "UNAVAILABLE",
        className: "cap-missing",
        explanation:
          "Competitor evidence collection was attempted but failed. No directly comparable competitor evidence was available, so PRYSM does not make a competitive-positioning claim.",
      },
      [SOURCE_STATUS.NOT_CONNECTED]: {
        label: "UNAVAILABLE",
        className: "cap-neutral",
        explanation:
          "The competitor evidence source was not connected for this audit. PRYSM therefore could not collect directly comparable competitor evidence and does not make a competitive-positioning claim.",
      },
      [SOURCE_STATUS.NOT_APPLICABLE]: {
        label: "NOT APPLICABLE",
        className: "cap-neutral",
        explanation:
          "Competitor analysis was not applicable for this audit, so PRYSM does not make a competitive-positioning claim.",
      },
      [SOURCE_STATUS.BLOCKED]: {
        label: "UNAVAILABLE",
        className: "cap-neutral",
        explanation:
          "Competitor evidence collection was blocked by an access restriction. No directly comparable competitor evidence was available, so PRYSM does not make a competitive-positioning claim.",
      },
      [SOURCE_STATUS.UNAVAILABLE]: {
        label: "UNAVAILABLE",
        className: "cap-neutral",
        explanation:
          "The competitor evidence source returned no usable comparison data for this audit, so PRYSM does not make a competitive-positioning claim.",
      },
      [SOURCE_STATUS.PARTIAL]: {
        label: "PARTIAL",
        className: "cap-partial",
        explanation:
          "Competitor evidence collection was partial, but it did not yield directly comparable competitor evidence. PRYSM therefore withholds a competitive-positioning claim.",
      },
      [SOURCE_STATUS.AVAILABLE]: {
        label: "UNAVAILABLE",
        className: "cap-neutral",
        explanation:
          "Competitor evidence was available, but no directly comparable normalized comparison was produced. PRYSM therefore withholds a competitive-positioning claim.",
      },
    }[competitorSourceStatus] || {
      label: "UNAVAILABLE",
      className: "cap-neutral",
      explanation:
        "No directly comparable competitor evidence was available, so PRYSM does not make a competitive-positioning claim.",
    };

    return `<section id="competitors" class="card">
      <p class="muted small">Competitor Comparison</p>
      <h2>How does your website compare with the competitors buyers are likely to consider?</h2>
      <h3>What the comparison shows</h3>
      <p><span class="chip ${noComparisonState.className}">${e(noComparisonState.label)}</span> ${e(noComparisonState.explanation)}</p>
      <h3>Who was compared</h3>
      <p class="small">No directly comparable named competitor evidence was available for this audit.</p>
      <h3>What this means for the client</h3>
      <p class="small">Use the site's own assessed conversion-readiness evidence for decisions; this comparison does not establish a competitive disadvantage.</p>
      ${limitations.length ? `<p class="small"><strong>Evidence limitation:</strong> ${e(limitations.join(" "))}</p>` : ""}
    </section>
    <section id="competitor-detail" class="card">
      <p class="muted small">Supporting Detail</p>
      <h2>Competitive context</h2>
      <p class="small">The comparison could not be completed from directly comparable evidence.</p>
    </section>`;
  }

    const site = model.evidence?.site || {};
  const trustBand = model.bands?.trust;
  const conversionPaths = Array.isArray(model.conversionPaths)
    ? model.conversionPaths
    : [];

  const clearPathCount = conversionPaths.filter(
    (path) => path?.status === "Clear",
  ).length;

  const weakPathCount = conversionPaths.filter(
    (path) => path?.status === "Weak",
  ).length;

  const governedConversionState =
    conversionPaths.length === 0
      ? "Not Assessed"
      : clearPathCount === conversionPaths.length
        ? "Clear"
        : weakPathCount > 0
          ? "Weak"
          : "Partial";

  const interpretation = interpretationFor(model);
  const ownSite = {
    offerClarity: interpretation.constructs.offerClarity,
    trustProof: interpretation.constructs.trustProof,
    ctaClarity: interpretation.constructs.ctaClarity,
    contentDepth: site.pageCount ? `${site.pageCount} page(s)` : "Not Assessed",
    pathClarity: interpretation.constructs.conversionPathClarity,
  };

  const clientSignal = (key, value) => {
    if (key === "ctaClarity" && value === "No CTA observed") {
      return "No distinct invitation in page text";
    }
    return value;
  };

  const SIGNALS = [
    ["Offer clarity", "offerClarity"],
    ["Trust evidence", "trustProof"],
    ["Service depth", "contentDepth"],
    ["Next-step invitation", "ctaClarity"],
    ["Assessed conversion route", "pathClarity"],
  ];

  const header = clientComparisons
    .map((c) => `<th>${e(c.name || c.url || "Competitor")}</th>`)
    .join("");

  const signalRows = SIGNALS.map(([label, key]) => `
    <tr>
      <td><strong>${e(label)}</strong></td>
      <td>${e(clientSignal(key, ownSite[key]))}</td>
      ${clientComparisons
        .map((c) => `<td>${e(clientSignal(key, c[key] || "Not Assessed"))}</td>`)
        .join("")}
    </tr>`).join("");

  const clientContext = (c) =>
    c.topic || c.note
      ? "Observable conversion-readiness signals were available for this named competitor."
      : "Named competitor included in the supplied comparison set.";

  const sourceRows = clientComparisons.map((c) => `
    <tr>
      <td class="small">${e(c.name || c.url || "")}</td>
      <td class="small">${e(c.url || "")}</td>
      <td class="small">${e(clientContext(c))}</td>
    </tr>`).join("");

  const directAnswer =
    gaps.length
      ? `A qualified comparative difference was observed in ${gaps.length} area${gaps.length === 1 ? "" : "s"}. This is a bounded difference in the named comparison set, not proof of a broader competitive disadvantage.`
      : "The named competitor evidence provides context, but no qualified comparative gap was established.";

  const ownStrengths = SIGNALS.filter(([, key]) => {
    const own = ownSite[key];
    if (own === "Not Assessed") return false;

    return clientComparisons.every(
      (c) => !c[key] || String(c[key]) === String(own),
    );
  });

  const strongerCompetitorAreas = SIGNALS.filter(([, key]) =>
    clientComparisons.some(
      (c) =>
        c[key] &&
        String(c[key]) !== "Not Assessed" &&
        String(c[key]) !== String(ownSite[key]),
    ),
  );

  return `
  <section id="competitors" class="card">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">How does your website compare with the competitors buyers are likely to consider?</p>
    <p class="muted small">Competitor Benchmarking</p>

    <h2>Competitive context</h2>
    <p>${e(directAnswer)}</p>

    <h3>Who was compared and why</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Competitor</th><th>URL</th><th>Status</th><th>Observed context</th></tr></thead>
      <tbody>${sourceRows}</tbody>
    </table></div>
    <p class="muted small">Only supplied or qualified collected competitor evidence is shown. PRYSM does not infer market-wide behavior from this sample.</p>

    <h3>Comparative overview</h3>
    <p class="muted small"><strong>How to read related signals:</strong> The invitation check looks for a distinct next step in the page text. The route check follows the tested path a visitor can use. A clear route can therefore exist even when the page text does not show a distinct invitation.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Material area</th><th>This site</th>${header}</tr></thead>
      <tbody>${signalRows}</tbody>
    </table></div>

    <h3>Where you are already competitive</h3>
    ${ownStrengths.length
      ? `<ul>${ownStrengths.map(([label]) => `<li>${e(label)}</li>`).join("")}</ul>`
      : "<p>No clear comparative strength was established from the normalized signals available in this report.</p>"}

    <h3>Where competitors provide a stronger buying experience</h3>
    ${strongerCompetitorAreas.length
      ? `<ul>${strongerCompetitorAreas.map(([label]) => `<li>${e(label)} — at least one assessed competitor exposes a different or stronger visible signal in this area.</li>`).join("")}</ul>`
      : "<p>No clearly stronger competitor buying signal was established from the assessed comparison.</p>"}

    <h3>Qualified comparative gaps</h3>
    ${gaps.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Competitor behavior</th><th>Your current coverage</th><th>Why it matters</th><th>PRYSM judgment</th></tr></thead>
          <tbody>${gaps.slice(0, 10).map((gap) => `
            <tr>
              <td class="small">${e((gap.observedCompetitorCoverage || []).join(", ") || gap.competitorDomain || gap.competitorPage || "Observed competitor coverage")}</td>
              <td class="small">${e(gap.clientCoverage || "Not Assessed")}</td>
              <td class="small">${e(gap.conversionRelevance || "Material relevance was established by the qualification gate.")}</td>
              <td class="small">${e(gap.recommendation || gap.limitationStatement || "Qualified comparison retained; no standalone recommendation created.")}</td>
            </tr>`).join("")}</tbody>
        </table></div>`
      : "<p>No competitor gap passed the qualification threshold required to appear as a material comparative finding.</p>"}

    ${qualifiedCandidates.length || excludedCandidates.length
      ? `<p class="muted small">${e(qualifiedCandidates.length)} qualified candidate(s) · ${e(excludedCandidates.length)} excluded candidate(s).</p>`
      : ""}

    <h3>Evidence limitations</h3>
    ${limitations.length
      ? `<ul class="small">${limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>`
      : `<p class="small">This comparison covers observable conversion-readiness signals only. It does not claim traffic, rankings, backlinks, market share, domain authority, or causal ranking advantage.</p>`}
  </section>`;
}

function competitorSectionClient(model) {
  const comparisons = model.competitors?.comparisons || [];
  const assessed = comparisons.filter(
    (comparison) => comparison?.status === SOURCE_STATUS.AVAILABLE,
  );
  const opportunityData = model.competitors?.opportunities || {};
  const gaps = opportunityData.gaps || [];
  const limitations = opportunityData.limitations || [];
  const qualifiedCandidates = opportunityData.qualifiedCandidates || [];
  const excludedCandidates = opportunityData.excludedCandidates || [];
  const sourceStatus = model.sourceStatus?.competitors || SOURCE_STATUS.NOT_APPLICABLE;

  const unavailableExplanation = {
    [SOURCE_STATUS.FAILED]: "Competitor evidence collection was attempted but failed, so no directly comparable difference can be concluded.",
    [SOURCE_STATUS.NOT_CONNECTED]: "The competitor evidence source was not connected, so no directly comparable difference can be concluded.",
    [SOURCE_STATUS.BLOCKED]: "Competitor evidence collection was blocked, so no directly comparable difference can be concluded.",
    [SOURCE_STATUS.PARTIAL]: "Competitor evidence collection was partial, so no directly comparable difference can be concluded.",
    [SOURCE_STATUS.NOT_APPLICABLE]: "Competitor analysis was not applicable for this audit, so no directly comparable difference can be concluded.",
  }[sourceStatus] || "No directly comparable named competitor evidence was available, so no competitive difference can be concluded.";

  if (!assessed.length) {
    return `<section id="competitors" class="card">
      <p class="muted small">Competitor Comparison</p>
      <h2>How does your website compare with the competitors buyers are likely to consider?</h2>
      <h3>What the comparison shows</h3>
      <p>${e(unavailableExplanation)}</p>
      <h3>Who was compared</h3>
      <p class="small">No directly comparable named competitor evidence was available for this audit.</p>
      <h3>What this means for the client</h3>
      <p class="small">Use the site's own assessed conversion-readiness evidence for decisions; this comparison does not establish a competitive disadvantage.</p>
      ${limitations.length ? `<p class="small"><strong>Evidence limitation:</strong> ${e(limitations.join(" "))}</p>` : ""}
    </section>
    <section id="competitor-detail" class="card">
      <p class="muted small">Supporting Detail</p>
      <h2>Competitive context</h2>
      <p class="small">${e(unavailableExplanation)}</p>
    </section>`;
  }

  const site = model.evidence?.site || {};
  const interpretation = interpretationFor(model);
  const own = {
    offerClarity: interpretation.constructs.offerClarity,
    trustProof: interpretation.constructs.trustProof,
    ctaClarity: interpretation.constructs.ctaClarity === "No CTA observed" ? "No distinct invitation in page text" : interpretation.constructs.ctaClarity,
    contentDepth: site.pageCount ? `${site.pageCount} page(s)` : "Not Assessed",
    pathClarity: interpretation.constructs.conversionPathClarity,
  };
  const signals = [
    ["Offer clarity", "offerClarity"],
    ["Trust evidence", "trustProof"],
    ["Service depth", "contentDepth"],
    ["Next-step invitation", "ctaClarity"],
    ["Assessed conversion route", "pathClarity"],
  ];
  const comparable = (key, value) => key === "contentDepth" ? "Not directly comparable from available signals" : String(value || "Not Assessed");
  const header = assessed.map((c) => `<th>${e(c.name || c.url || "Competitor")}</th>`).join("");
  const signalRows = signals.map(([label, key]) => `<tr><td><strong>${e(label)}</strong></td><td>${e(comparable(key, own[key]))}</td>${assessed.map((c) => `<td>${e(comparable(key, c[key]))}</td>`).join("")}</tr>`).join("");
  const sourceRows = assessed.map((c) => `<tr><td class="small">${e(c.name || c.url || "")}</td><td class="small">${e(c.url || "")}</td><td class="small">Observable conversion-readiness signals were available for this named competitor.</td></tr>`).join("");
  const directAnswer = gaps.length
    ? `A qualified comparative difference was observed in ${gaps.length} area${gaps.length === 1 ? "" : "s"}. This is a bounded difference in the named comparison set, not proof of a broader competitive disadvantage.`
    : "The named competitor evidence provides context, but no qualified comparative gap was established.";
  const gapList = gaps.length
    ? `<ul>${gaps.slice(0, 10).map((gap) => `<li>${e((gap.observedCompetitorCoverage || []).join(", ") || gap.competitorDomain || gap.competitorPage || "A qualified comparative difference")} — ${e(gap.conversionRelevance || "A bounded decision-support difference was retained by the qualification gate.")}</li>`).join("")}</ul>`
    : "<p>No meaningful difference passed the comparative qualification threshold.</p>";

  return `<section id="competitors" class="card">
    <p class="muted small">Competitor Comparison</p>
    <h2>How does your website compare with the competitors buyers are likely to consider?</h2>
    <p class="competitor-verdict">${e(directAnswer)}</p>
    <h3>Who was compared</h3>
    <div class="table-wrap"><table><thead><tr><th>Competitor</th><th>URL</th><th>Context observed</th></tr></thead><tbody>${sourceRows}</tbody></table></div>
    <p class="muted small">Only the named assessed competitors are shown. This sample does not support a market-wide conclusion.</p>
    <h3>What the comparison shows</h3>
    <p class="small">${e(gaps.length ? "Competitors show different signals in the areas assessed, and any qualified differences are described below as bounded observations rather than broader competitive claims." : "Competitors show different signals in offer clarity, trust, and next-step presentation, but none of those differences was strong enough to qualify as a material competitive gap.")}</p>
    <h3>Where meaningful differences were observed</h3>
    ${gapList}
    <h3>What this means for the client</h3>
    <p class="small">${e(gaps.length ? "Review the qualified differences in Supporting Detail before deciding whether any deserves a site change." : "No qualified comparative gap was established. Use the site's own assessed conversion-readiness evidence as the basis for action.")}</p>
    <p class="small"><strong>Evidence limitation:</strong> This comparison covers only the named competitors and observable conversion-readiness signals. It does not establish traffic, rankings, backlinks, market share, domain authority, or causal performance.</p>
  </section>
  <section id="competitor-detail" class="card" data-supporting-section="competitive-trust-evidence">
    <p class="muted small">Supporting Detail</p>
    <h2>Competitive context</h2>
    <p>${e(directAnswer)}</p>
    <h3>Comparative overview</h3>
    <p class="muted small">Service depth is shown as not directly comparable because the available measures are not equivalent. Other rows use the same signal type across the named set.</p>
    <div class="table-wrap"><table><thead><tr><th>Material area</th><th>This site</th>${header}</tr></thead><tbody>${signalRows}</tbody></table></div>
    <h3>Qualified comparative gaps</h3>
    ${gaps.length ? `<div class="table-wrap"><table><thead><tr><th>Competitor behavior</th><th>Your current coverage</th><th>Why it matters</th><th>PRYSM judgment</th></tr></thead><tbody>${gaps.slice(0, 10).map((gap) => `<tr><td class="small">${e((gap.observedCompetitorCoverage || []).join(", ") || gap.competitorDomain || gap.competitorPage || "Observed competitor coverage")}</td><td class="small">${e(gap.clientCoverage || "Not Assessed")}</td><td class="small">${e(gap.conversionRelevance || "Material relevance was established by the qualification gate.")}</td><td class="small">${e(gap.recommendation || gap.limitationStatement || "Qualified comparison retained; no standalone recommendation created.")}</td></tr>`).join("")}</tbody></table></div>` : "<p>No competitor gap passed the qualification threshold required to appear as a material comparative finding.</p>"}
    ${qualifiedCandidates.length || excludedCandidates.length ? `<p class="muted small">${e(qualifiedCandidates.length)} qualified candidate(s) · ${e(excludedCandidates.length)} excluded candidate(s).</p>` : ""}
    <h3>Evidence limitations</h3>
    ${limitations.length ? `<ul class="small">${limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : `<p class="small">This comparison covers observable conversion-readiness signals only. It does not claim traffic, rankings, backlinks, market share, domain authority, or causal ranking advantage.</p>`}
  </section>`;
}

function meaningfulClientTopic(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length < 3) return false;

  return !/^(?:4\s*0|create|tagged by kindness inc|tbk incubates go fog it)$/i.test(text);
}

function contentOpportunitiesSection(model) {
  const ideas = model.contentIdeas || {};
  const tofu = ideas.tofu || [];
  const mofu = ideas.mofu || [];
  const bofu = ideas.bofu || [];
  const leading = ideas.leading || [];
  const site = model.evidence?.site || {};
  const contentScore =
    model.scores?.contentFunnelDimension ??
    model.scores?.contentDepth ??
    null;

  const coverageState = (count, positive = false) => {
    if (positive || count >= 3) return "Good foundation";
    if (count >= 1) return "Some support";
    return "Limited information";
  };

  const buyerNeeds = [
    [
      "Understand the problem",
      tofu.length,
      false,
      "Awareness-stage questions and educational context.",
    ],
    [
      "Understand the service",
      (site.services || []).length,
      (site.services || []).length > 0,
      "Clear explanation of services or offers.",
    ],
    [
      "Evaluate fit",
      mofu.length,
      false,
      "Comparison, fit, and decision-support content.",
    ],
    [
      "Build trust",
      model.scores?.trustEeatDimension ?? model.scores?.trust,
      (model.scores?.trustEeatDimension ?? model.scores?.trust) >= 60,
      "Proof and reassurance needed before action.",
    ],
    [
      "Compare options",
      mofu.filter((i) =>
        /compar|option|fit/i.test(`${i.idea || ""} ${i.frame || ""}`)
      ).length,
      false,
      "Content that helps a buyer understand alternatives.",
    ],
    [
      "Take action",
      (site.ctas || []).length,
      (site.ctas || []).length > 0,
      "An observed conversion action visitors can take.",
    ],
  ];

  const directAnswer =
    contentScore === null
      ? "PRYSM has limited evidence for judging whether current content answers the full set of buyer questions."
      : contentScore >= 60
        ? `The site has a usable content foundation (${contentScore}/100), but qualified opportunities remain to strengthen buyer questions that are not fully supported.`
        : `Content and funnel coverage is limited at ${contentScore}/100. Buyers are likely to encounter unanswered questions as they move from understanding the problem toward taking action.`;

  const coverageCards = buyerNeeds
    .map(([need, count, positive, meaning]) => {
      const state = coverageState(Number(count) || 0, positive === true);
      return `<article class="content-coverage-card">
        <h4>${e(need)}</h4>
        <p class="content-coverage-state">${e(state)}</p>
        <p class="small">${e(meaning)}</p>
      </article>`;
    })
    .join("");

  const allIdeas = [
    ...tofu.map((i) => ({ ...i, stage: "Awareness" })),
    ...mofu.map((i) => ({ ...i, stage: "Evaluation" })),
    ...bofu.map((i) => ({ ...i, stage: "Decision" })),
  ];

  const clientWhyItMatters = (i) => {
    const idea = String(i.idea || "");
    if (/what is|what are/i.test(idea)) {
      return "Helps an early-stage buyer understand the service before deciding whether it is relevant.";
    }
    if (/signs you may need|do i need|need .*service/i.test(idea)) {
      return "Helps a buyer recognize whether their current situation warrants further investigation.";
    }
    if (/measurable|result|outcome|work/i.test(idea)) {
      return "Addresses uncertainty about whether the service can produce a meaningful result.";
    }
    if (/compare|versus|option|fit/i.test(idea)) {
      return "Helps a buyer compare options and judge which route fits their situation.";
    }
    if (/faq|question|answer/i.test(`${idea} ${i.question || ""}`)) {
      return "Helps answer a buyer question before they decide whether to take the next step.";
    }
    if (/awareness|tofu/i.test(`${i.funnelStage || ""} ${i.stage || ""}`)) {
      return "Helps an early-stage buyer understand whether this topic is relevant before exploring the service.";
    }
    if (/decision|bofu/i.test(`${i.funnelStage || ""} ${i.stage || ""}`)) {
      return "Helps a decision-stage buyer resolve a final question before taking the assessed next step.";
    }
    return "Helps a prospective buyer evaluate the service before taking the next step.";
  };

  const clientJourneyConnection = (i) => {
    const stage = String(i.funnelStage || i.stage || "");
    if (/awareness|tofu/i.test(stage)) {
      return "Link this educational content into the relevant service explanation.";
    }
    if (/consideration|evaluation|mofu/i.test(stage)) {
      return "Link this between service understanding and the assessed next step with comparison, process, or proof support.";
    }
    if (/decision|bofu/i.test(stage)) {
      return "Place this near the assessed conversion action to support a buyer's final question or first step.";
    }
    return "Connect this to the relevant service page and the next-step action used in the assessed journey.";
  };

  const evidenceLabel = (i) =>
    i.evidenceStatus === "AVAILABLE"
      ? "Supported within assessed content"
      : i.evidenceStatus === "PARTIAL"
        ? "Qualified opportunity — partial content coverage"
        : "Qualified opportunity — content evidence unavailable";

  const renderOpportunityCards = (items, startIndex = 0, primary = false) =>
    items
      .map((i, offset) => {
        const index = startIndex + offset;
        const detail = primary ? "" : ` ${e(i.gap || "")}`;
        return `<article class="content-opportunity-card${index === 0 ? " content-opportunity-card-start" : ""}">
          <div class="content-opportunity-card-header">
            ${primary ? `<span class="content-opportunity-rank">${index + 1}</span>` : ""}
            ${index === 0 ? '<span class="content-opportunity-start">Start here</span>' : ""}
          </div>
          <h4>${e(i.idea === "What Is Custom Websites?" ? "What Is a Custom Website?" : (i.idea || "Qualified content opportunity"))}</h4>
          <dl class="content-opportunity-fields">
            <div><dt>Buyer question / need</dt><dd>${e(i.question || "Buyer decision support")}</dd></div>
            <div><dt>Buyer stage</dt><dd>${e(i.funnelStage || i.stage || "Assessed buyer journey")}</dd></div>
            <div><dt>Why it matters</dt><dd>${e(/supports the stated goal/i.test(String(i.whyItMatters || "")) ? clientWhyItMatters(i) : (i.whyItMatters || clientWhyItMatters(i)))}</dd></div>
            <div><dt>Recommended asset</dt><dd>${e(i.recommendedAsset || i.type || "Content asset")}</dd></div>
            <div><dt>Journey connection</dt><dd>${e(clientJourneyConnection(i))}</dd></div>
            <div><dt>Decision-support role</dt><dd>${e(i.frame || i.placement || "Supports buyer decision-making")}</dd></div>
            ${primary ? `<div><dt>Evidence qualification</dt><dd>${e(evidenceLabel(i))}</dd></div>` : `<div class="content-opportunity-uncertainty"><dt>Evidence qualification</dt><dd>${e(evidenceLabel(i))}${detail}</dd></div>`}
          </dl>
        </article>`;
      })
      .join("");

  const primaryIdeas = allIdeas.slice(0, 5);
  const supportingIdeas = allIdeas.slice(5);
  const opportunityCards = renderOpportunityCards(primaryIdeas, 0, true);
  const supportingPreviewCards = renderOpportunityCards(supportingIdeas.slice(0, 2), 5, false);
  const supportingRemainderCards = renderOpportunityCards(supportingIdeas.slice(2), 7, false);

  const coveredTopics = [
    ...new Set([
      ...(site.services || []),
      ...(site.topicKeywords || []),
    ]),
  ].filter(meaningfulClientTopic).slice(0, 12);

  const supportingSignals = coveredTopics.length || leading.length
    ? `<details class="content-supporting-signals">
        <summary>Supporting content signals</summary>
        ${coveredTopics.length ? `<h4>Observed topics</h4><ul>${coveredTopics.map((topic) => `<li>${e(topic)}</li>`).join("")}</ul>` : ""}
        ${leading.length ? `<h4>Additional qualified search intents</h4><div class="table-wrap"><table>
          <thead><tr><th>Query</th><th>Rationale</th><th>Priority</th></tr></thead>
          <tbody>${leading.map((q) => `<tr><td>${e(q.query || "")}</td><td class="small">${e(q.rationale || "")}</td><td>${e(q.priority || "")}</td></tr>`).join("")}</tbody>
        </table></div>` : ""}
      </details>`
    : "";

  return `
  <section id="content-ideas" class="card">
    <p class="muted small">Content Opportunities</p>
    <h2>What content would help buyers move forward?</h2>

    <p class="content-opportunities-verdict">${e(contentScore === null
      ? "The site has a usable content foundation, but the available content-body evidence is partial. The main opportunity is stronger buyer decision support."
      : "The site has a usable content foundation. The main opportunity is stronger buyer decision support, while content-body evidence remains partial.")}</p>

    <h3>What is already helping buyers</h3>
    <div class="content-coverage-grid">${coverageCards}</div>

    <h3>Where decision support is thin</h3>
    <p class="content-opportunities-gap">The assessed content signals identify qualified opportunities to answer buyer questions. This does not establish that unassessed pages lack the same support.</p>

    <h3>What to create or improve first</h3>
    ${opportunityCards
      ? `<div class="content-opportunity-list">${opportunityCards}</div>`
      : `<p><span class="chip cap-ok">PASS</span> No qualified content opportunity was generated from the assessed evidence.</p>`}

    <h3>Evidence limitations</h3>
    <p class="small">Ideas are derived from existing business-context topics and crawl-visible content. Content coverage was partial, so unassessed pages remain unknown. Search demand or competitor coverage may strengthen an opportunity, but neither alone creates a recommendation.</p>
  </section>

  <section id="content-opportunities-detail" class="card" data-supporting-section="conversion-content-evidence">
    <p class="muted small">Supporting Detail</p>
    <h2>Content Opportunity Detail</h2>
    <p class="small">Additional qualified opportunities and supporting content signals remain available here for planning and verification.</p>
    ${supportingIdeas.length
      ? `<p class="small">${e(supportingIdeas.length)} additional qualified opportunit${supportingIdeas.length === 1 ? "y" : "ies"} remain available in Supporting Detail. Two representative examples are shown below; the existing priority order is preserved.</p>
         <div class="content-opportunity-list">${supportingPreviewCards}</div>
         ${supportingRemainderCards ? `<details class="supporting-detail-disclosure"><summary>Show remaining additional opportunities</summary><div class="content-opportunity-list">${supportingRemainderCards}</div></details>` : ""}`
      : `<p class="small">No additional qualified opportunities were generated.</p>`}
    ${supportingSignals}
  </section>`;
}

function cmsPlatformSection(model) {
  const site = model.evidence?.site || {};
  const detected =
    typeof site.platform === "string" &&
    site.platform.trim() &&
    site.platform !== "Unknown"
      ? site.platform
      : null;

  const server = site.pages?.[0]?.responseHeaders?.server;
  const headersAvailable = site._responseHeadersAvailable === true;
  const proprietary = detected
    ? /GoDaddy|Wix|Squarespace|Shopify/i.test(detected)
    : false;

  const migrationRisk = detected
    ? proprietary
      ? "Medium — proprietary platform constraints may limit deeper implementation"
      : "Low to Medium — implementation depends on hosting and theme controls"
    : null;

  const observedRows = [
    `<tr><td>Platform</td><td>${
      detected
        ? e(detected)
        : `<span class="chip cap-neutral">Not verified</span> The crawl did not return a platform signal.`
    }</td></tr>`,
    `<tr><td>Migration risk</td><td>${
      migrationRisk
        ? e(migrationRisk)
        : `<span class="chip cap-neutral">Not assessed</span> Migration risk is not stated because the platform was not verified.`
    }</td></tr>`,
  ].join("");

  const questions = [
    "Can page-level titles, descriptions, and canonical URLs be edited?",
    "Can JSON-LD structured data be added globally and per service page?",
    "Can semantic heading levels be chosen independently of visual styling?",
    "Does the current plan allow dedicated service, FAQ, and policy pages?",
    "Can response headers be configured at the host, CDN, or platform layer?",
    "Can a lead-capture form be embedded on the pages that need it?",
  ];

  return `
  <section id="cms" class="card" data-supporting-section="platform-internal-links">
    <h2>CMS &amp; Platform Constraints</h2>
    <h3>Observed from the crawl</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Signal</th><th>Value</th></tr></thead>
      <tbody>${observedRows}</tbody>
    </table></div>
    <details class="supporting-detail-disclosure"><summary>Show platform implementation questions</summary>
      <h3>Implementation questions</h3>
      <p class="muted small">These are generic questions, not findings about this site. Platform administration access is required to confirm the answers.</p>
      <ul class="small">${questions.map((q) => `<li>${e(q)}</li>`).join("")}</ul>
    </details>
  </section>`;
}

function safeHref(u) {
  try {
    const parsed = new URL(String(u || ""), "https://placeholder.local");
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return e(u);
    }
  } catch {
    /* fall through */
  }
  return "#";
}

const LINK_REASON_LABEL = {
  source_content_supports_related_service_page:
    "Content supports related service",
  informational_content_progresses_to_commercial_page:
    "Info content → commercial",
  consideration_content_progresses_to_conversion_page:
    "Consideration → conversion",
  pages_belong_to_same_topic_hierarchy:
    "Same topic hierarchy",
  source_content_references_target_service:
    "References target service",
  source_content_clarifies_referenced_topic:
    "Clarifies referenced topic",
  high_value_page_is_weakly_linked:
    "High-value page weakly linked",
};

function internalLinksSection(model) {
  const site = model.evidence?.site || {};
  const opp = model.evidence?.internalLinkOpportunities;
  const brokenLinks = site.brokenInternalLinks || [];
  const totalLinks = site.internalLinkCount || 0;
  const opportunities = opp?.opportunities || [];
  const orphans = opp?.orphans || [];
  const limitations = opp?.limitations || [];

  let body = "";

  if (!opp) {
    body = `<p>Not available: internal-link opportunities were not computed for this audit.${
      brokenLinks.length
        ? " Broken links from crawl evidence are shown below."
        : ""
    }</p>`;
  } else if (opportunities.length === 0) {
    body = `<p>No implementation-ready recommendations: no high- or medium-confidence opportunities were identified from crawl evidence.</p>`;
  } else {
    const recommendationSummary = opportunities.length <= 8
      ? `${opportunities.length} additional recommendations are available.`
      : `${opportunities.length} additional recommendations are available; representative examples are shown first.`;
    body = `<h3>Implementation-Ready Recommendations</h3>
<p class="small">${e(recommendationSummary)}</p>
<p class="muted small">High- and medium-confidence recommendations traceable to crawled source and target page content.</p>
<p class="small">Additional recommendations remain available in the deeper evidence layer.</p>
<details class="supporting-detail-disclosure"><summary>Show representative internal-link recommendations</summary><div class="table-wrap"><table>
<thead><tr><th>Source</th><th>Target</th><th>Anchor</th><th>Source context</th><th>Reason</th><th>Stage</th><th>Confidence</th><th>Warning</th></tr></thead>
<tbody>${opportunities
  .slice(0, 8)
  .map(
    (o) => `
  <tr>
    <td class="small"><a href="${safeHref(o.sourceUrl)}">${e(
      (o.sourceUrl || "")
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
        .slice(0, 40),
    )}</a></td>
    <td class="small"><a href="${safeHref(o.targetUrl)}">${e(
      (o.targetUrl || "")
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
        .slice(0, 40),
    )}</a></td>
    <td>${e(o.proposedAnchor || "")}</td>
    <td class="small">${e(o.relevantSurroundingText || "—")}</td>
    <td class="small">${e(
      LINK_REASON_LABEL[o.reasonForLink] || o.reasonForLink || "",
    )}</td>
    <td>${e(o.funnelStage || "")}</td>
    <td><span class="chip ${
      o.confidence === "high" ? "cap-ok" : "cap-partial"
    }">${e(o.confidence || "")}</span></td>
    <td class="small">${
      o.duplicateAnchorWarning
        ? e(o.duplicateAnchorWarning)
        : "—"
    }</td>
  </tr>`,
  )
  .join("")}</tbody>
</table></div></details>`;
  }

  const tracedBroken = brokenLinks.filter(
    (b) =>
      typeof b === "object" &&
      b &&
      b.source &&
      (b.url || b.target),
  );

  const untracedBroken = brokenLinks.filter(
    (b) =>
      !(
        typeof b === "object" &&
        b &&
        b.source
      ),
  );

  const brokenTable = tracedBroken.length
    ? `<h3>Broken Internal Links (${tracedBroken.length} traced)</h3>
<details class="supporting-detail-disclosure"><summary>Show representative broken-link examples</summary><div class="table-wrap"><table>
<thead><tr><th>Source</th><th>Target</th></tr></thead>
<tbody>${tracedBroken
  .slice(0, 10)
  .map(
    (b) =>
      `<tr><td class="small">${e(b.source)}</td><td class="small">${e(
        b.url || b.target,
      )}</td></tr>`,
  )
  .join("")}</tbody>
</table></div></details>`
    : "";

  const untracedNote = untracedBroken.length
    ? `<h3>Broken Internal Links (${untracedBroken.length} untraced)</h3>
<p class="small">${e(
        untracedBroken.length,
      )} broken link destination(s) could not be traced to a source page from the collected evidence — count only, no source implied.</p>`
    : "";

  const orphanBlock =
    orphans.length && opp?.coverage?.crawlComplete !== false
      ? `<h3>Orphan / Weakly Linked Pages (${orphans.length})</h3>
<p class="small">Five representative examples are shown; additional supporting evidence remains available.</p>
<details class="supporting-detail-disclosure"><summary>Show representative orphan-page examples</summary><div class="table-wrap"><table>
<thead><tr><th>URL</th><th>Title</th></tr></thead>
<tbody>${orphans
  .slice(0, 5)
  .map(
    (o) =>
      `<tr><td class="small">${e(
        (o.url || "").slice(0, 60),
      )}</td><td class="small">${e(o.title || "—")}</td></tr>`,
  )
  .join("")}</tbody>
</table></div></details>`
      : opp?.coverage?.crawlComplete === false
        ? `<p class="small">Orphan analysis: crawl coverage is incomplete — definitive orphan claims cannot be made.</p>`
        : "";

  return `
  <section id="internal-links" class="card" data-supporting-section="internal-links">
    <h2>Internal-Link Opportunities</h2>
    <p class="muted small">Summary: ${e(totalLinks)} total internal links, ${e(
      brokenLinks.length,
    )} broken. ${e(
      opp?.coverage?.pagesEvaluated ?? 0,
    )} pages evaluated. ${e(
      opportunities.length,
    )} recommendation(s). Representative examples are shown first; additional supporting evidence remains available.</p>
    ${body}
    ${brokenTable}${untracedNote}
    ${orphanBlock}
    ${
      limitations.length
        ? `<h3>Limitations</h3><ul class="small">${limitations
            .map((l) => `<li>${e(l)}</li>`)
            .join("")}</ul>`
        : ""
    }
  </section>`;
}
function deepEvidenceLayer(model) {
  const findings = (model.findings || [])
    .map(
      (f) => `
      <li>
        <strong>${e(f.ruleId)}</strong> — ${e(f.title)}
        <span class="small">(${e(f.confidence)}, priority ${e(
          f.finalPriority,
        )}, ${
          f.scoreBearing ? "score-bearing" : "non-scored"
        })</span>
        <ul class="small">
          ${(f.evidence || [])
            .map(
              (ev) =>
                `<li>${e(ev.provider)} · ${e(ev.field)} · ${e(
                  ev.observedValue ?? "null",
                )} · ${e(ev.sourceStatus)}</li>`,
            )
            .join("")}
        </ul>
      </li>`,
    )
    .join("");

  const sources = [
    "site",
    "performance",
    "competitors",
    "backlinks",
    "ga4",
    "gsc",
  ]
    .map((key) => {
      const ev = model.evidence?.[key];
      if (!ev) return `<li>${e(key)}: not collected</li>`;
      const status = ev.sourceStatus || "UNKNOWN";
      return `<li>${e(key)}: ${e(status)}${
        ev.collectedAt ? ` (${e(ev.collectedAt)})` : ""
      }</li>`;
    })
    .join("");

  const caps = model.capabilityEvidence?.capabilities || {};
  const capRows = Object.entries(caps)
    .map(
      ([key, c]) =>
        `<tr><td>${e(key)}</td><td><span class="chip ${capabilityStatusClass(
          c.status,
        )}">${e(c.status)}</span></td><td class="small">${e(
          (c.limitations || []).join("; "),
        )}</td><td class="small">${
          c.validated
            ? "validated by " + e(c.validatedBy)
            : "inferred"
        }</td></tr>`,
    )
    .join("");

  const suppressed = (model.suppressedFindingReasons || [])
    .map(
      (r) =>
        `<li>${e(r.ruleId)} suppressed: capability ${e(
          r.capability,
        )} is ${e(r.capabilityStatus)}</li>`,
    )
    .join("");

  const deferredBlock = suppressed.length
    ? `<h3>Deferred &amp; unavailable analysis</h3><ul class="small">${suppressed}</ul>`
    : `<h3>Deferred &amp; unavailable analysis</h3><p class="small">None deferred: all analyses with eligible evidence are rendered above; unavailable sources are shown in Source statuses.</p>`;

  return `
  <section id="evidence" class="card" data-supporting-section="evidence-limitations">
    <h2>Evidence detail</h2>
    <h3>Findings (${e((model.findings || []).length)})</h3>
    <p class="small">The report contains ${e((model.findings || []).length)} assessed finding${(model.findings || []).length === 1 ? "" : "s"}. Material limitations are retained below; detailed mechanics are available on request.</p>
    <details class="supporting-detail-disclosure"><summary>Show detailed findings and source coverage</summary>
    <ul class="findings">${findings}</ul>

    <h3>Source statuses</h3>
    <ul class="small">${sources}</ul>
    </details>

    <h3>Evidence capabilities</h3>
    <details class="supporting-detail-disclosure"><summary>Show raw evidence capability matrix</summary><div class="table-wrap"><table>
      <thead><tr><th>Capability</th><th>Status</th><th>Limitations</th><th>Kind</th></tr></thead>
      <tbody>${capRows}</tbody>
    </table></div></details>

    ${deferredBlock}
  </section>`;
}

function renderViewerNav() {
  const links = (pages, tier) => pages.map(
    (page, index) => `
    <a class="viewer-nav-link viewer-nav-${tier}" href="#${e(
      page.pageId,
    )}" data-viewer-page="${e(page.pageId)}">
      ${tier === "supporting" ? "" : `<span class="viewer-nav-num">${String(index + 1).padStart(2, "0")}</span>`}
      <span>${e(page.title)}</span>
    </a>`,
  ).join("");
  return `${links(REPORT_V2_VIEWER_PAGES.filter((page) => page.tier === "PRIMARY"), "primary")}
    <div class="viewer-supporting-nav" aria-label="Supporting evidence navigation"><div class="viewer-supporting-divider" aria-hidden="true"></div><div class="viewer-supporting-label">Evidence &amp; Detail</div>${links(REPORT_V2_VIEWER_PAGES.filter((page) => page.tier === "SUPPORTING"), "supporting")}</div>`;
}

function pageShell(model, date, pillars, checklist, plan) {
  const business = model.input?.businessName || "Business";
  const domain =
    model.evidence?.site?.domain ||
    model.input?.targetUrl ||
    "";
  const scoringVersion = model.scoringVersion || "";

  const viewerConfig = JSON.stringify(
    REPORT_V2_VIEWER_PAGES.map((page) => ({
      pageId: page.pageId,
      title: page.title,
      tier: page.tier,
      sectionIds: [...page.sectionIds],
    })),
  );

  const browserTitleBusiness = JSON.stringify(String(business));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet">
<title>${e(business)} — Conversion Readiness Report</title>
<style>
:root {
  --navy:#0d1b33;
  --navy2:#122544;
  --ink:#142033;
  --muted:#667085;
  --bg:#f4f7fb;
  --card:#ffffff;
  --line:#dfe5ee;
  --accent:#2d6cdf;
  --accent-soft:#eaf2ff;
  --warn:#b7791f;
  --ok:#16875b;
  --bad:#c2413b;
  --shadow:0 8px 28px rgba(21,31,51,.08);
}

* {
  box-sizing:border-box;
}

html {
  scroll-behavior:smooth;
}

body {
  margin:0;
  min-height:100vh;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  color:var(--ink);
  background:var(--bg);
  line-height:1.55;
}

.mono {
  font-family:'Courier New',ui-monospace,monospace;
}

header.brand {
  position:sticky;
  top:0;
  z-index:20;
  background:#fff;
  color:var(--ink);
  min-height:64px;
  padding:.85rem 1.5rem;
  border-bottom:1px solid var(--line);
  display:flex;
  flex-direction:column;
  justify-content:center;
}

header.brand h1 {
  margin:0;
  font-size:1.35rem;
  line-height:1.2;
  letter-spacing:-.01em;
}

header.brand .sub {
  margin:.25rem 0 0;
  color:var(--muted);
  font-size:.78rem;
}

.report-layout {
  display:grid;
  grid-template-columns:280px minmax(0,1fr);
  grid-template-areas:'sidebar content';
  gap:24px;
  max-width:1600px;
  margin:0 auto;
  padding:24px;
  align-items:start;
}

.viewer-sidebar {
  grid-area:sidebar;
  position:sticky;
  top:88px;
  max-height:calc(100vh - 112px);
  overflow-y:auto;
  background:var(--navy);
  color:#fff;
  border:0;
  border-radius:16px;
  padding:18px;
  box-shadow:var(--shadow);
}

.viewer-sidebar-title {
  margin:4px 8px 12px;
  font-size:.68rem;
  text-transform:uppercase;
  letter-spacing:.12em;
  color:#9eb0cc;
  font-weight:800;
}

.viewer-nav {
  display:flex;
  flex-direction:column;
  gap:5px;
}

.viewer-nav-link {
  display:grid;
  grid-template-columns:26px 1fr;
  gap:10px;
  align-items:start;
  padding:10px 11px;
  border-radius:9px;
  color:#dce5f3;
  text-decoration:none;
  font-size:.8rem;
  line-height:1.25;
}

.viewer-nav-link:hover {
  background:rgba(255,255,255,.08);
  color:#fff;
}

.viewer-nav-link[aria-current='page'] {
  background:#fff;
  color:var(--navy);
  font-weight:800;
}

.viewer-nav-num {
  display:inline-grid;
  place-items:center;
  min-width:22px;
  height:22px;
  border-radius:6px;
  background:rgba(255,255,255,.08);
  font-family:'Courier New',ui-monospace,monospace;
  font-size:.67rem;
  line-height:1;
}

.viewer-nav-link[aria-current='page'] .viewer-nav-num {
  background:var(--accent-soft);
  color:var(--accent);
}

.viewer-content {
  grid-area:content;
  min-width:0;
}
  .viewer-toolbar {
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:1rem;
  background:transparent;
  border:0;
  padding:2px 0 14px;
  margin:0 0 4px;
}

.viewer-toolbar h2 {
  margin:0;
  font-size:1.45rem;
  line-height:1.2;
  letter-spacing:-.02em;
}

.print-page-btn {
  border:1px solid var(--accent);
  border-radius:9px;
  padding:.65rem .9rem;
  background:var(--accent);
  color:#fff;
  font-weight:750;
  cursor:pointer;
  white-space:nowrap;
  box-shadow:0 3px 10px rgba(45,108,223,.18);
}

.print-page-btn:hover {
  filter:brightness(.95);
}

main {
  min-width:0;
}

body.viewer-ready main > section:not(.viewer-active) {
  display:none;
}

body.viewer-ready main > section.viewer-active {
  display:block;
}

body.viewer-ready .narrative-layer [data-viewer-page]:not(.viewer-active) {
  display:none;
}

body.viewer-ready .narrative-layer [data-viewer-page].viewer-active {
  display:block;
}

.card {
  background:var(--card);
  border:1px solid var(--line);
  border-radius:14px;
  padding:18px;
  margin:0 0 18px;
  box-shadow:var(--shadow);
}

main > section:not(.card) {
  background:var(--card);
  border:1px solid var(--line);
  border-radius:14px;
  padding:18px;
  margin:0 0 18px;
  box-shadow:var(--shadow);
}

section > h2 {
  margin:.05rem 0 .8rem;
  font-size:1.05rem;
  border-bottom:1px solid #edf0f5;
  padding-bottom:.62rem;
  letter-spacing:-.01em;
}

section > h3,
.card h3 {
  font-size:.9rem;
  margin:1rem 0 .55rem;
}

.grid-3 {
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:18px;
}

.pillar-grid {
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(190px,1fr));
  gap:14px;
}

.pillar {
  background:var(--card);
  border:1px solid var(--line);
  border-radius:12px;
  padding:15px;
  box-shadow:0 4px 16px rgba(21,31,51,.05);
}

.pillar h3 {
  margin:.1rem 0 .5rem;
  font-size:.9rem;
}

.pillar-score {
  font-size:1.65rem;
  font-weight:800;
  letter-spacing:-.02em;
}

.pillar-score.none {
  font-size:1rem;
  color:var(--muted);
}

.pillar-modules {
  margin:.5rem 0;
  padding-left:1rem;
  font-size:.76rem;
  color:var(--muted);
}

.pillar-caps {
  display:flex;
  flex-wrap:wrap;
  gap:.3rem;
}

.readiness,
.confidence,
.coverage {
  font-size:2rem;
  font-weight:800;
  letter-spacing:-.03em;
}

.readiness-none {
  font-size:1.1rem;
  font-weight:800;
  color:var(--warn);
}

.readiness-max {
  font-size:.92rem;
  color:var(--muted);
  font-weight:500;
}

.chip {
  display:inline-block;
  font-size:.7rem;
  padding:.18rem .5rem;
  border-radius:999px;
  background:#eef2f8;
  color:var(--muted);
  font-weight:700;
}

.band-strong,
.cap-ok {
  background:#e9f8f1;
  color:var(--ok);
}

.band-moderate,
.cap-partial {
  background:#fff4db;
  color:var(--warn);
}

.band-limited {
  background:#feeceb;
  color:var(--bad);
}

.band-weak,
.cap-missing {
  background:#feeceb;
  color:var(--bad);
}

.cap-neutral {
  background:#eef2f8;
  color:var(--muted);
}

.muted {
  color:var(--muted);
}

.small {
  font-size:.76rem;
  color:var(--muted);
}

.table-wrap {
  overflow-x:auto;
  border-radius:10px;
}

table {
  width:100%;
  border-collapse:collapse;
  font-size:.78rem;
  font-family:inherit;
}

th,
td {
  border:0;
  border-bottom:1px solid #edf0f5;
  padding:.62rem .55rem;
  text-align:left;
  vertical-align:top;
}

th {
  background:#f8fafc;
  color:var(--muted);
  font-size:.72rem;
  font-weight:750;
}

tbody tr:last-child td {
  border-bottom:0;
}

a {
  color:var(--accent);
}

ul.findings {
  padding-left:1.1rem;
}

ul.findings > li {
  margin:.5rem 0;
}

.note {
  border:1px solid var(--line);
  border-radius:10px;
  background:#f8fafc;
  padding:12px 14px;
  margin:10px 0;
}

footer {
  text-align:center;
  color:var(--muted);
  font-size:.72rem;
  padding:1rem 1.2rem 1.4rem;
}

@media (max-width:900px) {
  .report-layout {
    grid-template-columns:220px minmax(0,1fr);
    grid-template-areas:'sidebar content';
    gap:14px;
    padding:14px;
  }

  .viewer-sidebar {
    position:sticky;
    top:78px;
    max-height:calc(100vh - 92px);
    overflow-y:auto;
    padding:12px;
    border-radius:12px;
  }

  .viewer-nav {
    flex-direction:column;
    overflow:visible;
  }

  .viewer-nav-link {
    min-width:0;
    padding:9px 8px;
  }

  .viewer-sidebar-title {
    margin-left:6px;
  }

  .grid-3 {
    grid-template-columns:1fr;
  }
}

@media (max-width:720px) {
  .report-layout {
    grid-template-columns:180px minmax(0,1fr);
    gap:10px;
    padding:10px;
  }

  .viewer-sidebar {
    top:76px;
    max-height:calc(100vh - 86px);
    padding:9px;
  }
      .viewer-nav-link {
    grid-template-columns:22px 1fr;
    gap:7px;
    padding:8px 7px;
    font-size:.72rem;
  }

  .viewer-nav-num {
    min-width:20px;
    height:20px;
    font-size:.62rem;
  }

  header.brand {
    padding:.75rem 1rem;
  }

  header.brand h1 {
    font-size:1.05rem;
  }

  header.brand .sub {
    font-size:.68rem;
  }

  .viewer-toolbar {
    align-items:flex-start;
    flex-direction:column;
  }

  .viewer-toolbar h2 {
    font-size:1.15rem;
  }

  .print-page-btn {
    width:100%;
  }

  .card,
  main > section:not(.card) {
    padding:14px;
  }
}

@media print {
.nav-jump, .no-print { display:none !important; }

  body {
    background:#fff;
  }

  header.brand {
    position:static;
    border:0;
    padding:0 0 1rem;
  }

  .report-layout {
    display:block;
    max-width:100%;
    margin:0;
    padding:0;
  }

  .viewer-content,
  main {
    max-width:100%;
    padding:0;
  }

  body.viewer-ready main > section:not(.viewer-active) {
    display:none !important;
  }

  body.viewer-ready main > section.viewer-active { display:block !important; }

  body.viewer-ready .narrative-layer [data-viewer-page]:not(.viewer-active) {
    display:none !important;
  }

  body.viewer-ready .narrative-layer [data-viewer-page].viewer-active {
    display:block !important;
  }

  .card,
  .pillar,
  .priority-action,
  main > section:not(.card) {
    box-shadow:none;
    page-break-inside:avoid;
    break-inside:avoid;
  }
}
</style>
<style data-prysm-theme="brand-v1">
:root {
  --prysm-primary:#3D756B;
  --prysm-dark:#173C36;
  --prysm-deep:#102D29;
  --prysm-mint:#EAF5F1;
  --prysm-mint-2:#F4F9F7;
  --prysm-lime:#D9ED9A;
  --prysm-paper:#FCFDFC;
  --prysm-ink:#17221F;
  --prysm-muted:#64736F;
  --prysm-line:#D9E3DF;
  --prysm-success:#28735F;
  --prysm-warning:#9A7028;
  --prysm-risk:#A94A43;
}

/* Visual theme only.
   Viewer layout, sticky sidebar positioning,
   responsive grid, page switching and print logic
   remain controlled by PRYSM Viewer v2.2.0. */

body {
  font-family:'DM Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  color:var(--prysm-ink);
  background:var(--prysm-paper);
  font-size:18.5px;
  line-height:1.6;
}

header.brand {
  background:#fff;
  border-bottom:1px solid var(--prysm-line);
  padding:20px 32px;
}

header.brand h1 {
  font-family:'Manrope',system-ui,sans-serif;
  font-size:38px;
  font-weight:800;
  line-height:1.10;
  letter-spacing:-0.035em;
  color:var(--prysm-deep);
}

header.brand .sub {
  margin-top:8px;
  color:var(--prysm-muted);
  font-size:12.5px;
  font-weight:600;
  line-height:1.5;
}

.viewer-sidebar {
  background:var(--prysm-deep);
  border:1px solid rgba(255,255,255,.08);
  border-radius:16px;
  box-shadow:0 8px 24px rgba(16,45,41,.08);
}

.viewer-sidebar-title {
  color:#B8CEC7;
  font-family:'DM Sans',sans-serif;
  font-size:12.5px;
  font-weight:700;
  letter-spacing:.14em;
}

.viewer-nav-link {
  color:#DCEAE5;
  font-family:'DM Sans',sans-serif;
  font-weight:500;
  border-radius:10px;
  transition:
    background-color .2s ease,
    color .2s ease;
}

.viewer-nav-link:hover {
  background:rgba(255,255,255,.07);
  color:#fff;
}

.viewer-nav-link[aria-current='page'] {
  background:var(--prysm-mint);
  color:var(--prysm-deep);
  box-shadow:none;
}

.viewer-nav-num {
  background:rgba(255,255,255,.08);
  color:#DCEAE5;
  border-radius:6px;
}

.viewer-nav-link[aria-current='page'] .viewer-nav-num {
  background:#fff;
  color:var(--prysm-primary);
}

.viewer-toolbar {
  padding-top:12px;
  padding-bottom:24px;
}

.viewer-toolbar h2 {
  font-family:'Manrope',system-ui,sans-serif;
  font-size:40px;
  font-weight:700;
  line-height:1.12;
  letter-spacing:-0.035em;
  color:var(--prysm-deep);
}

.print-page-btn {
  font-family:'DM Sans',sans-serif;
  border:1px solid var(--prysm-primary);
  border-radius:999px;
  padding:15px 20px;
  background:var(--prysm-primary);
  color:#fff;
  font-size:13px;
  font-weight:700;
  box-shadow:none;
  transition:
    transform .25s ease,
    background-color .25s ease;
}

.print-page-btn:hover {
  filter:none;
  background:var(--prysm-dark);
  transform:translateY(-1px);
}

.print-page-btn:focus-visible,
.viewer-nav-link:focus-visible {
  outline:3px solid var(--prysm-lime);
  outline-offset:3px;
}

.card,
main > section:not(.card) {
  background:#fff;
  border:1px solid var(--prysm-line);
  border-radius:16px;
  padding:32px;
  box-shadow:0 6px 20px rgba(16,45,41,.045);
}

section > h2,
.card h2 {
  font-family:'Manrope',system-ui,sans-serif;
  font-size:40px;
  font-weight:700;
  line-height:1.12;
  letter-spacing:-0.035em;
  color:var(--prysm-deep);
  border-bottom:1px solid var(--prysm-line);
  padding-bottom:20px;
  margin-bottom:24px;
}

section > h3,
.card h3 {
  font-family:'Manrope',system-ui,sans-serif;
  font-size:32px;
  font-weight:800;
  line-height:1.20;
  letter-spacing:-0.025em;
  color:var(--prysm-deep);
  margin-top:40px;
}

p,
li {
  font-size:18.5px;
  line-height:1.6;
}

.small,
.muted {
  color:var(--prysm-muted);
}

.small {
  font-size:15px;
  line-height:1.55;
}

a {
  color:var(--prysm-primary);
}

.pillar {
  background:var(--prysm-mint-2);
  border:1px solid var(--prysm-line);
  border-radius:14px;
  box-shadow:none;
  padding:24px;
}

.pillar h3 {
  font-family:'Manrope',sans-serif;
  color:var(--prysm-deep);
}

.priority-action {
  background:var(--prysm-mint-2);
  border:1px solid var(--prysm-line);
  border-radius:14px;
  box-shadow:none;
  margin:0 0 18px;
  padding:22px;
  page-break-inside:avoid;
  break-inside:avoid;
}

.priority-action:last-child {
  margin-bottom:0;
}

.priority-action[data-priority-rank="1"] {
  background:var(--prysm-mint);
  border:2px solid var(--prysm-primary);
}

.priority-action-heading {
  align-items:flex-start;
  display:flex;
  gap:14px;
  margin-bottom:18px;
}

.priority-rank {
  align-items:center;
  background:var(--prysm-primary);
  border-radius:999px;
  color:#fff;
  display:inline-flex;
  flex:0 0 38px;
  font-family:'Manrope',system-ui,sans-serif;
  font-size:18px;
  font-weight:800;
  height:38px;
  justify-content:center;
  line-height:1;
  margin-top:2px;
  width:38px;
}

.priority-start {
  color:var(--prysm-primary);
  display:block;
  font-size:12px;
  font-weight:800;
  letter-spacing:.08em;
  margin-bottom:4px;
  text-transform:uppercase;
}

.priority-action h3 {
  color:var(--prysm-deep);
  font-size:22px;
  line-height:1.25;
  margin:0;
}

.priority-action-fields {
  display:grid;
  gap:12px 16px;
  grid-template-columns:repeat(2,minmax(0,1fr));
  margin:0;
}

.priority-field {
  background:rgba(255,255,255,.58);
  border:1px solid var(--prysm-line);
  border-radius:10px;
  padding:13px 15px;
}

.priority-field dt {
  color:var(--prysm-dark);
  font-size:13px;
  font-weight:800;
  letter-spacing:.02em;
  margin:0 0 5px;
}

.priority-field dd {
  color:var(--prysm-ink);
  font-size:16px;
  line-height:1.5;
  margin:0;
}

.priority-field-attention {
  grid-column:1 / -1;
}

.priority-field-uncertainty {
  background:rgba(248,240,220,.72);
  border-color:var(--prysm-warning);
  grid-column:1 / -1;
}

.conversion-journey-verdict {
  background:var(--prysm-mint);
  border:1px solid var(--prysm-primary);
  border-radius:14px;
  color:var(--prysm-deep);
  font-family:'Manrope',system-ui,sans-serif;
  font-size:28px;
  font-weight:800;
  line-height:1.25;
  margin:20px 0 22px;
  padding:20px 22px;
}

.conversion-journey-visual {
  background:var(--prysm-mint-2);
  border:1px solid var(--prysm-line);
  border-radius:14px;
  margin:22px 0 28px;
  overflow:hidden;
  padding:20px 16px;
  page-break-inside:avoid;
  break-inside:avoid;
}

.conversion-journey-visual svg {
  display:block;
  height:auto;
  width:100%;
}

.conversion-journey-stage {
  fill:var(--prysm-mint);
  stroke:var(--prysm-primary);
  stroke-width:2;
}

.conversion-journey-visual text {
  fill:var(--prysm-deep);
  font-family:'DM Sans',sans-serif;
  font-size:18px;
  font-weight:700;
}

.conversion-journey-arrow {
  fill:none;
  stroke:var(--prysm-primary);
  stroke-width:3;
}

.conversion-journey-limitation {
  background:rgba(248,240,220,.72);
  border-left:4px solid var(--prysm-warning);
  color:var(--prysm-muted);
  font-size:15px;
  line-height:1.55;
  padding:12px 16px;
}

.conversion-journey-steps,
.conversion-journey-card-grid {
  display:grid;
  gap:16px;
  grid-template-columns:repeat(3,minmax(0,1fr));
}

.conversion-journey-step,
.conversion-journey-detail-card,
.conversion-journey-strength {
  background:var(--prysm-mint-2);
  border:1px solid var(--prysm-line);
  border-radius:14px;
  padding:18px;
}

.conversion-journey-step {
  min-height:164px;
  position:relative;
}

.conversion-journey-step:nth-child(1) {
  background:var(--prysm-mint-2);
}

.conversion-journey-step:nth-child(2) {
  background:var(--prysm-mint);
  border-color:var(--prysm-primary);
}

.conversion-journey-step:nth-child(3) {
  background:var(--prysm-primary);
  border-color:var(--prysm-deep);
  color:#fff;
}

.conversion-journey-step:not(:last-child)::after {
  background:var(--prysm-primary);
  content:"";
  height:3px;
  position:absolute;
  right:-16px;
  top:50%;
  transform:translateY(-50%);
  width:16px;
}

.conversion-journey-step-number {
  align-items:center;
  background:var(--prysm-primary);
  border-radius:999px;
  color:#fff;
  display:inline-flex;
  font-family:'Manrope',system-ui,sans-serif;
  font-weight:800;
  height:32px;
  justify-content:center;
  width:32px;
}

.conversion-journey-step h3,
.conversion-journey-detail-card h4 {
  color:var(--prysm-deep);
  font-family:'Manrope',system-ui,sans-serif;
  margin:14px 0 6px;
}

.conversion-journey-step:nth-child(3) h3 {
  color:#fff;
}

.conversion-journey-step p,
.conversion-journey-detail-card p,
.conversion-journey-strength p {
  margin:0;
}

.conversion-journey-strength {
  background:var(--prysm-mint);
  border-color:var(--prysm-primary);
}

.conversion-journey-detail-card {
  grid-column:span 1;
}

.conversion-journey-actions {
  margin:0;
  padding-left:1.35rem;
}

.conversion-journey-actions li {
  margin:.55rem 0;
}

.conversion-journey-takeaway {
  background:var(--prysm-mint-2);
  border:1px solid var(--prysm-primary);
  border-left:4px solid var(--prysm-primary);
  border-radius:12px;
  margin:18px 0;
  padding:14px 16px;
}

.conversion-journey-takeaway strong {
  color:var(--prysm-deep);
}

.conversion-journey-takeaway p {
  margin:.35rem 0 0;
}

.content-opportunities-verdict {
  background:var(--prysm-mint);
  border:1px solid var(--prysm-primary);
  border-radius:12px;
  color:var(--prysm-deep);
  font-family:'Manrope',system-ui,sans-serif;
  font-size:20px;
  font-weight:700;
  line-height:1.4;
  padding:16px 18px;
}

.content-coverage-grid {
  display:grid;
  gap:12px;
  grid-template-columns:repeat(3,minmax(0,1fr));
}

.content-coverage-card,
.content-opportunity-card {
  background:var(--prysm-mint-2);
  border:1px solid var(--prysm-line);
  border-radius:12px;
  padding:16px;
}

.content-coverage-card h4,
.content-opportunity-card h4 {
  color:var(--prysm-deep);
  font-family:'Manrope',system-ui,sans-serif;
  margin:0 0 7px;
}

.content-coverage-card p {
  margin:.25rem 0;
}

.content-coverage-state {
  color:var(--prysm-primary);
  font-weight:800;
}

.content-opportunities-gap {
  background:rgba(248,240,220,.72);
  border-left:4px solid var(--prysm-warning);
  padding:12px 16px;
}

.content-opportunity-list {
  display:grid;
  gap:16px;
}

.content-opportunity-card {
  background:#fff;
  page-break-inside:avoid;
  break-inside:avoid;
}

.content-opportunity-card-start {
  border:2px solid var(--prysm-primary);
  box-shadow:0 5px 16px rgba(25,94,87,.12);
}

.content-opportunity-card-header {
  align-items:center;
  display:flex;
  gap:10px;
  margin-bottom:10px;
}

.content-opportunity-rank {
  align-items:center;
  background:var(--prysm-primary);
  border-radius:999px;
  color:#fff;
  display:inline-flex;
  font-weight:800;
  height:30px;
  justify-content:center;
  width:30px;
}

.content-opportunity-start {
  color:var(--prysm-primary);
  font-size:12px;
  font-weight:800;
  letter-spacing:.08em;
  text-transform:uppercase;
}

.content-opportunity-fields {
  display:grid;
  gap:10px 14px;
  grid-template-columns:repeat(2,minmax(0,1fr));
  margin:0;
}

.content-opportunity-fields > div {
  background:var(--prysm-mint-2);
  border:1px solid var(--prysm-line);
  border-radius:9px;
  padding:11px 12px;
}

.content-opportunity-fields dt {
  color:var(--prysm-dark);
  font-size:12px;
  font-weight:800;
  margin-bottom:4px;
}

.content-opportunity-fields dd {
  color:var(--prysm-ink);
  font-size:15px;
  line-height:1.45;
  margin:0;
}

.content-opportunity-uncertainty {
  background:rgba(248,240,220,.72) !important;
  border-color:var(--prysm-warning) !important;
  grid-column:1 / -1;
}

.content-supporting-signals {
  border-top:1px solid var(--prysm-line);
  margin-top:20px;
  padding-top:14px;
}

.content-supporting-signals summary {
  color:var(--prysm-primary);
  cursor:pointer;
  font-weight:800;
}

.content-supporting-signals h4 {
  color:var(--prysm-deep);
  margin:14px 0 6px;
}

.conversion-journey-bridge-grid {
  display:grid;
  gap:16px;
  grid-template-columns:repeat(3,minmax(0,1fr));
}

.conversion-journey-bridge-card {
  background:#fff;
  border:1px solid var(--prysm-line);
  border-radius:12px;
  padding:16px;
}

.conversion-journey-bridge-card h4 {
  color:var(--prysm-deep);
  font-family:'Manrope',system-ui,sans-serif;
  margin:0 0 8px;
}

.conversion-journey-bridge-card p {
  margin:0 0 14px;
}

.conversion-journey-bridge-link {
  color:var(--prysm-primary);
  font-weight:800;
  text-decoration:none;
}

.conversion-journey-bridge-link:hover,
.conversion-journey-bridge-link:focus-visible {
  text-decoration:underline;
}

@media (max-width:720px) {
  .priority-action-fields {
    grid-template-columns:1fr;
  }

  .priority-field-attention,
  .priority-field-uncertainty {
    grid-column:auto;
  }

  .conversion-journey-verdict {
    font-size:22px;
  }

  .conversion-journey-visual {
    padding:12px 8px;
  }

  .conversion-journey-visual text {
    font-size:16px;
  }

  .conversion-journey-steps,
  .conversion-journey-card-grid,
  .conversion-journey-bridge-grid {
    grid-template-columns:1fr;
  }

  .content-coverage-grid,
  .content-opportunity-fields {
    grid-template-columns:1fr;
  }

  .conversion-journey-step,
  .conversion-journey-detail-card,
  .conversion-journey-strength {
    min-height:0;
  }

  .conversion-journey-step:not(:last-child)::after {
    bottom:-16px;
    height:16px;
    left:50%;
    right:auto;
    top:auto;
    transform:translateX(-50%);
    width:3px;
  }
}

@media print {
  .conversion-journey-verdict,
  .conversion-journey-visual,
  .conversion-journey-step,
  .conversion-journey-detail-card,
  .conversion-journey-strength,
  .conversion-journey-takeaway,
  .conversion-journey-bridge-card,
  .content-opportunity-card,
  .conversion-journey-limitation {
    page-break-inside:avoid;
    break-inside:avoid;
  }
}

.pillar-score,
.readiness,
.confidence,
.coverage {
  font-family:'Manrope',system-ui,sans-serif;
  color:var(--prysm-primary);
  font-weight:800;
}

.chip {
  font-family:'DM Sans',sans-serif;
  font-size:12.5px;
  font-weight:700;
  line-height:1.35;
}

.band-strong,
.cap-ok {
  background:#E5F3ED;
  color:var(--prysm-success);
}

.band-moderate,
.cap-partial {
  background:#F8F0DC;
  color:var(--prysm-warning);
}

.band-limited,
.band-weak,
.cap-missing {
  background:#F8E8E6;
  color:var(--prysm-risk);
}

.cap-neutral {
  background:#EEF3F1;
  color:var(--prysm-muted);
}

.note {
  background:var(--prysm-mint-2);
  border:1px solid var(--prysm-line);
  border-radius:14px;
  padding:20px 22px;
}

.table-wrap {
  border:1px solid var(--prysm-line);
  border-radius:14px;
}

table {
  font-family:'DM Sans',sans-serif;
  font-size:15px;
  line-height:1.5;
}

th {
  background:var(--prysm-mint-2);
  color:var(--prysm-dark);
  font-size:12.5px;
  font-weight:700;
  letter-spacing:.02em;
}

th,
td {
  border-bottom:1px solid var(--prysm-line);
  padding:14px 16px;
}

.narrative-card {
  border-color:#C9DCD5;
}

.narrative-eyebrow {
  color:var(--prysm-primary);
  font-family:'DM Sans',sans-serif;
  font-size:15px;
  font-weight:800;
  letter-spacing:.1em;
  text-transform:uppercase;
}

.narrative-field {
  background:var(--prysm-mint-2);
  border-color:var(--prysm-line);
}

footer {
  color:var(--prysm-muted);
  font-family:'DM Sans',sans-serif;
  font-size:12.5px;
}

/* Keep PRYSM's existing responsive LEFT navigation. */

.viewer-supporting-nav {
  margin-top:16px;
  padding-top:16px;
  border-top:1px solid rgba(255,255,255,.22);
}

.viewer-supporting-divider {
  height:1px;
}

.viewer-supporting-label {
  margin:0 8px 8px;
  color:var(--prysm-lime);
  font-family:'DM Sans',sans-serif;
  font-size:11px;
  font-weight:800;
  letter-spacing:.12em;
  text-transform:uppercase;
}

.viewer-nav-supporting {
  grid-template-columns:1fr;
  color:#DCEAE5;
  background:rgba(255,255,255,.04);
}

.viewer-nav-supporting[aria-current='page'] {
  background:var(--prysm-mint-2);
  color:var(--prysm-deep);
}

.supporting-detail-orientation {
  margin:-8px -8px 24px;
  padding:22px 24px;
  border:1px solid var(--prysm-line);
  border-radius:14px;
  background:linear-gradient(135deg,var(--prysm-mint-2),#fff);
}

.supporting-detail-orientation h2 {
  margin:.1rem 0 .5rem;
  border:0;
  padding:0;
}

.supporting-detail-kicker {
  margin:0;
  color:var(--prysm-primary);
  font-size:.72rem;
  font-weight:800;
  letter-spacing:.12em;
  text-transform:uppercase;
}

.supporting-detail-jumps {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:8px;
  margin-top:16px;
}

.supporting-detail-jumps a {
  padding:8px 10px;
  border:1px solid var(--prysm-line);
  border-radius:8px;
  background:#fff;
  color:var(--prysm-dark);
  font-size:.76rem;
  font-weight:700;
  text-decoration:none;
}

.supporting-detail-jumps a:hover,
.supporting-detail-jumps a:focus-visible {
  background:var(--prysm-mint);
  outline:2px solid var(--prysm-lime);
  outline-offset:2px;
}

.supporting-detail-disclosure {
  margin:12px 0;
  border:1px solid var(--prysm-line);
  border-radius:10px;
  background:var(--prysm-mint-2);
}

.supporting-detail-disclosure summary {
  cursor:pointer;
  padding:11px 14px;
  color:var(--prysm-dark);
  font-size:.86rem;
  font-weight:750;
}

.supporting-detail-disclosure > .table-wrap,
.supporting-detail-disclosure > .pillar-grid {
  padding:0 14px 14px;
}

@media (max-width:900px) {
  .supporting-detail-jumps { grid-template-columns:repeat(2,minmax(0,1fr)); }
}

@media (max-width:520px) {
  .supporting-detail-jumps { grid-template-columns:1fr; }
}

@media print {
  .supporting-detail-orientation,
  .supporting-detail-disclosure { break-inside:avoid; page-break-inside:avoid; }
  .supporting-detail-disclosure[open] > summary { display:none; }
  .supporting-detail-disclosure:not([open]) > *:not(summary) { display:none; }
}

@media (max-width:720px) {
  body {
    font-size:15px;
  }

  header.brand h1 {
    font-size:24px;
  }

  .viewer-toolbar h2 {
    font-size:28px;
  }

  section > h2,
  .card h2 {
    font-size:26px;
  }

  section > h3,
  .card h3 {
    font-size:22px;
  }

  p,
  li {
    font-size:15px;
  }

  .card,
  main > section:not(.card) {
    padding:18px;
  }
}

@media print {
  body {
    background:#fff;
    color:#111;
  }

  .card,
  main > section:not(.card),
  .pillar {
    box-shadow:none;
  }
}
</style>
</head>

<body
  data-report-design="${e(REPORT_DESIGN_V2)}"
  data-viewer-version="${e(REPORT_V2_VIEWER_VERSION)}"
>
<header class="brand">
  <h1>${e(business)} — Conversion Readiness Report</h1>
  <p class="sub">${e(domain)} · ${e(date)} · Report design v${e(
    REPORT_DESIGN_V2,
  )} · Viewer v${e(REPORT_V2_VIEWER_VERSION)} · Scoring version ${e(
    scoringVersion,
  )}</p>
</header>

<div class="report-layout">
  <div class="viewer-content">
    <div class="viewer-toolbar no-print">
      <h2 id="viewerPageTitle">Executive Scorecard</h2>
      <button
        type="button"
        class="print-page-btn"
        onclick="window.print()"
        aria-label="Print or save this page as PDF"
      >Print or save this page as PDF</button>
    </div>

    <main id="reportContent" tabindex="-1">
      ${executiveScorecard(model, pillars)}
      ${pillarSection(pillars)}
      ${blockersSection(model, plan)}
      ${foundationSection(checklist)}
      ${conversionPathSection(model)}
      ${contentOpportunitiesSection(model)}
      ${actionPlanSection(plan, checklist)}
      ${competitorSectionClient(model)}
      ${eeatSection(model)}
      ${technicalDetailSection(model)}
      ${headingSection(model)}
      ${schemaSection(model)}
      ${machineReadinessSection(model)}
      ${performanceDetailSection(model)}
      ${accessibilityMobileSection(model)}
      ${cmsPlatformSection(model)}
      ${internalLinksSection(model)}
      ${phase2Section()}
      ${deepEvidenceLayer(model)}
    </main>
  </div>

  <aside class="viewer-sidebar no-print" aria-label="Report sections">
    <p class="viewer-sidebar-title">Report sections</p>
    <nav class="viewer-nav">${renderViewerNav()}</nav>
  </aside>
</div>

<footer>
  Generated by Prysm (Omnipressence) · Report design v${e(
    REPORT_DESIGN_V2,
  )} · Viewer v${e(
    REPORT_V2_VIEWER_VERSION,
  )} · Evidence-grounded conversion-readiness assessment
</footer>

<script>
(() => {
  const pages = ${viewerConfig};
  const fallback = pages[0];
    const businessName = ${browserTitleBusiness};
  const byId = new Map(pages.map((page) => [page.pageId, page]));
  const sectionOwners = new Map(
    pages.flatMap((page) =>
      page.sectionIds.map((sectionId) => [sectionId, page.pageId])
    )
  );
  const allSectionIds = new Set(
    pages.flatMap((page) => page.sectionIds)
  );

  const title = document.getElementById("viewerPageTitle");
  const content = document.getElementById("reportContent");
  const links = Array.from(
    document.querySelectorAll("[data-viewer-page]")
  );
  const navLinks = Array.from(
    document.querySelectorAll("a[data-viewer-page]")
  );
  const narrativeSections = Array.from(
    document.querySelectorAll(
      "#narrative-layer [data-viewer-page]"
    )
  );

  for (const id of allSectionIds) {
    const section = document.getElementById(id);
    if (section) section.classList.add("viewer-section");
  }

  for (const section of narrativeSections) {
    section.classList.add("viewer-section");
  }

  function resolveRoute() {
    const requested = decodeURIComponent(
      (window.location.hash || "").replace(/^#/, "")
    );
    const page = byId.get(requested);
    if (page) return { page, targetId: null };

    const ownerPageId = sectionOwners.get(requested);
    if (ownerPageId) {
      return { page: byId.get(ownerPageId), targetId: requested };
    }

    return { page: fallback, targetId: null };
  }

  function activate(page, options = {}) {
    const focus = options.focus === true;
    document.body.classList.add("viewer-ready");

    const activeIds = new Set(page.sectionIds);

    for (const id of allSectionIds) {
      const section = document.getElementById(id);
      if (section) {
        section.classList.toggle("viewer-active", activeIds.has(id));
      }
    }

    for (const section of narrativeSections) {
      section.classList.toggle(
        "viewer-active",
        section.dataset.viewerPage === page.pageId
      );
    }

    for (const link of links) {
      if (link.dataset.viewerPage === page.pageId) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }

    if (title) title.textContent = page.title;

    document.title =
      page.title + " — " + businessName;

    if (focus && content) {
      content.focus({ preventScroll: true });
    }
  }

  function syncFromHash(options = {}) {
    const route = resolveRoute();
    const page = route.page;

    if (!route.targetId &&
      window.location.hash !==
      "#" + page.pageId
    ) {
      history.replaceState(null, "", "#" + page.pageId);
    }

    activate(page, options);

    if (route.targetId) {
      const target = document.getElementById(route.targetId);
      if (target) {
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  for (const link of navLinks) {
    link.addEventListener("click", (event) => {
      const page = byId.get(
        link.dataset.viewerPage
      );

      if (!page) return;

      event.preventDefault();

      history.pushState(
        null,
        "",
        "#" + page.pageId
      );

      activate(page, { focus: true });

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });
  }

  window.addEventListener(
    "hashchange",
    () => syncFromHash({ focus: true })
  );

  window.addEventListener(
    "popstate",
    () => syncFromHash({ focus: true })
  );

  syncFromHash();
})();
</script>
</body>
</html>`;
}

export function renderReportV2(model, options = {}) {
  const renderModel = clientFacingReportModel(model);

  const generated = renderModel?.generatedAt
    ? new Date(renderModel.generatedAt)
    : new Date(0);

  const date =
    options.date ||
    (Number.isNaN(generated.getTime())
      ? "Unknown date"
      : generated.toISOString().slice(0, 10));

  const pillars = computePillars(renderModel);
  const checklist = buildFoundationChecklist(renderModel);
  const plan = buildActionPlan(renderModel, checklist);

  return pageShell(
    renderModel,
    date,
    pillars,
    checklist,
    plan,
  );
}

export { computePillars };

export default {
  renderReportV2,
  computePillars,
  REPORT_V2_VIEWER_PAGES,
  REPORT_V2_VIEWER_VERSION,
};
import {
  requireClientTruth,
  requireCrossReportInterpretation,
} from "../report-model/cross-report-interpretation.js";

function interpretationFor(model) {
  return model?.crossReportInterpretation?.version === "2.0.0"
    ? requireClientTruth(model)
    : requireCrossReportInterpretation(model);
}

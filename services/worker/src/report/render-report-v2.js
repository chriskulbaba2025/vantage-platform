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
import { ACTION_CLASS, buildActionPlan } from "./action-priority.js";
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
  strengthsSection,
  actionPlanSection,
  phase2Section,
} from "./report-detail-sections.js";

export const REPORT_V2_VIEWER_VERSION = "2.2.0";

export const REPORT_V2_VIEWER_PAGES = Object.freeze([
  Object.freeze({ pageId: "executive-scorecard", title: "Executive Scorecard", sectionIds: Object.freeze(["executive", "strengths"]) }),
  Object.freeze({ pageId: "priority-fixes", title: "Priority Fixes", sectionIds: Object.freeze(["blockers", "foundations", "action-plan"]) }),
  Object.freeze({ pageId: "conversion-paths", title: "Conversion Path Architecture", sectionIds: Object.freeze(["paths"]) }),
  Object.freeze({ pageId: "readiness-map", title: "Conversion Readiness Map", sectionIds: Object.freeze(["pillars"]) }),
  Object.freeze({ pageId: "content-ideas", title: "Topical Map & Qualified Content Opportunities", sectionIds: Object.freeze(["content-ideas"]) }),
  Object.freeze({ pageId: "competitor-benchmark", title: "Competitor Benchmark", sectionIds: Object.freeze(["competitors"]) }),
  Object.freeze({ pageId: "trust-eeat", title: "Trust & E-E-A-T Readiness", sectionIds: Object.freeze(["eeat"]) }),
  Object.freeze({ pageId: "cms-constraints", title: "CMS & Platform Constraints", sectionIds: Object.freeze(["cms"]) }),
  Object.freeze({ pageId: "technical-seo", title: "Technical SEO Hygiene", sectionIds: Object.freeze(["technical"]) }),
  Object.freeze({ pageId: "headings", title: "Heading & Semantic Structure", sectionIds: Object.freeze(["headings"]) }),
  Object.freeze({ pageId: "schema", title: "Schema & Entity Clarity", sectionIds: Object.freeze(["schema", "machine-readiness"]) }),
  Object.freeze({ pageId: "performance", title: "Performance", sectionIds: Object.freeze(["performance"]) }),
  Object.freeze({ pageId: "accessibility-mobile", title: "Accessibility & Mobile Usability Readiness", sectionIds: Object.freeze(["accessibility-mobile"]) }),
  Object.freeze({ pageId: "internal-links", title: "Internal-Link Opportunities", sectionIds: Object.freeze(["internal-links"]) }),
  Object.freeze({ pageId: "evidence-appendix", title: "Evidence Appendix", sectionIds: Object.freeze(["evidence"]) }),
  Object.freeze({ pageId: "deferred", title: "Deferred & Unavailable Analysis", sectionIds: Object.freeze(["phase2"]) }),
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

function executiveScorecard(model, pillars) {
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
    : `<p><span class="chip cap-ok">PASS</span> No material score-bearing finding was produced from the assessed evidence.</p>`;

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

    <h3>What is already working?</h3>
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
        <p class="small"><strong>${e(bandLabel(p.score))}</strong></p>
        <ul class="pillar-modules">${modules}</ul>
        <div class="pillar-caps">${caps}</div>
      </div>`;
  }).join("");

  const directAnswer = weak.length
    ? `Readiness is uneven. ${weak[0].label} is the weakest assessed dimension at ${weak[0].score}/100, while stronger dimensions provide a foundation to build on.`
    : available.length
      ? "The assessed readiness dimensions are broadly adequate or strong, with no dimension currently below the Adequate band."
      : "PRYSM could not produce dimension-level readiness scores from the available evidence.";

  return `<section id="pillars">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Where is the site helping or hurting conversion?</p>
    <p class="muted small">Conversion Readiness Map</p>
    <h2>D. Where are the problems?</h2>
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

    <div class="pillar-grid">${cards}</div>

    <h3>What is driving weaker areas</h3>
    ${weak.length
      ? `<ul>${weak.map((p) => `<li><strong>${e(p.label)}</strong> — ${e(p.score)}/100 (${e(bandLabel(p.score))}). Review the underlying governed findings and capability limitations shown on this page.</li>`).join("")}</ul>`
      : "<p>No assessed dimension is currently below the Adequate band.</p>"}

    <h3>Where the foundation is strong</h3>
    ${strong.length
      ? `<ul>${strong.map((p) => `<li><strong>${e(p.label)}</strong> — ${e(p.score)}/100 (${e(bandLabel(p.score))}).</li>`).join("")}</ul>`
      : "<p>No assessed dimension reached the Adequate band.</p>"}

    <h3>Evidence limitations by dimension</h3>
    <ul class="small">
      ${pillars.map((p) => {
        const unavailableCaps = p.capabilities.filter((c) => c.status !== "AVAILABLE");
        return `<li><strong>${e(p.label)}:</strong> ${
          unavailableCaps.length
            ? e(unavailableCaps.map((c) => `${c.key} ${c.status}`).join("; "))
            : "No capability limitation recorded for the displayed dimension."
        }</li>`;
      }).join("")}
    </ul>
  </section>`;
}

const ACTION_CLASS_LABEL = {
  [ACTION_CLASS.FOUNDATION_BLOCKER]: "Foundation blocker",
  [ACTION_CLASS.HIGH_CONVERSION]: "High conversion impact",
  [ACTION_CLASS.OPTIMIZATION]: "Optimization",
};

function blockersSection(model, plan) {
  if (plan.actions.length === 0) {
    return `<section id="blockers" class="card">
      <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">What should you fix first?</p>
      <p class="muted small">Priority Findings &amp; Recommendations</p>
      <h2>E. What should be fixed first?</h2>
      <p><span class="chip cap-ok">PASS</span> No score-bearing finding produced a prioritized action from the assessed evidence.</p>
    </section>`;
  }

  const primary = plan.actions.slice(0, 5);
  const secondaryCount = Math.max(0, plan.actions.length - primary.length);

  const rows = primary.map((a) => {
    const f = a.finding;
    const classChip = a.actionClass === ACTION_CLASS.FOUNDATION_BLOCKER
      ? `<span class="chip cap-missing">${e(ACTION_CLASS_LABEL[a.actionClass])}</span>`
      : `<span class="chip cap-neutral">${e(ACTION_CLASS_LABEL[a.actionClass] || a.actionClass)}</span>`;

    const evidenceLocation = (f.evidence || [])
      .map((ev) => ev.field || ev.provider)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");

    const verification =
      a.verificationMethod ||
      f.verificationMethod ||
      "Re-run the relevant audit evidence and confirm the observed condition changed.";

    const rankReason = a.actionClass === ACTION_CLASS.FOUNDATION_BLOCKER
      ? "Verified foundation blocker."
      : `${impactCategory(f)} with ${e(f.confidence || "available")} evidence confidence.`;

    return `
      <tr>
        <td>${e(a.rank)}</td>
        <td><strong>${e(f.title)}</strong><br>${classChip}<br><span class="small">${e(f.ruleId || "")}</span></td>
        <td>${e(f.businessImpact || "")}</td>
        <td>${e(f.recommendation || "")}</td>
        <td class="small">${e(evidenceLocation || "Relevant assessed page or evidence source")}</td>
        <td class="small">${e(verification)}</td>
        <td class="small">${e(rankReason)}</td>
      </tr>`;
  }).join("");

  return `
  <section id="blockers" class="card">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">What should you fix first?</p>
    <p class="muted small">Priority Findings &amp; Recommendations</p>
    <h2>E. What should be fixed first?</h2>
    <p>The actions below are the highest-priority changes supported by the assessed evidence. PRYSM limits this page to the five items most important enough to warrant client attention.</p>

    <div class="table-wrap">
      <table class="blockers">
        <thead>
          <tr>
            <th>Priority</th>
            <th>What we found</th>
            <th>Why it matters</th>
            <th>What to do</th>
            <th>Where</th>
            <th>How to verify</th>
            <th>Why this rank</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    ${secondaryCount
      ? `<p class="muted small">${e(secondaryCount)} lower-priority observation${secondaryCount === 1 ? " is" : "s are"} retained elsewhere in the report but intentionally excluded from the primary action list.</p>`
      : `<p class="muted small">No additional lower-priority action was generated beyond the primary list shown here.</p>`}
  </section>`;
}

function conversionPathSection(model) {
  const paths = Array.isArray(model.conversionPaths) ? model.conversionPaths : [];

  if (paths.length === 0) {
    return `<section id="paths" class="card">
      <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Can visitors easily move from interest to action?</p>
      <p class="muted small">Conversion Path Architecture</p>
      <h2>Conversion path architecture</h2>
      <p><span class="chip cap-neutral">UNAVAILABLE</span> No conversion-path evidence was available for this assessment. PRYSM therefore withholds a path-quality conclusion.</p>
    </section>`;
  }

  const primary = paths[0];
  const allBlockers = [...new Set(paths.flatMap((p) => p.blockers || []))];
  const clearCount = paths.filter((p) => p.status === "Clear").length;
  const weakCount = paths.filter((p) => p.status === "Weak").length;
  const unavailableCount = paths.length - clearCount - weakCount;

  const statusFor = (status) =>
    status === "Clear"
      ? "PASS"
      : status === "Weak"
        ? "FINDING"
        : "PARTIAL";

  const statusClass = (status) =>
    status === "Clear"
      ? "cap-ok"
      : status === "Weak"
        ? "cap-partial"
        : "cap-neutral";

  const verdict =
    clearCount === paths.length
      ? "The assessed conversion routes are clear enough for visitors to move from interest toward action."
      : weakCount > 0
        ? `${weakCount} assessed conversion path${weakCount === 1 ? " is" : "s are"} weak enough to create hesitation or uncertainty before action.`
        : "The available path evidence is incomplete, so PRYSM cannot confirm that visitors can move cleanly from interest to action.";

  const steps = primary.steps || [];
  const flowLabels = [
    steps[0] || "Entry",
    steps[1] || "Service understanding",
    steps[2] || "Trust / proof",
    steps[3] || "Primary CTA",
    steps[4] || "Conversion destination",
  ];

  const flowSvg = `
    <div style="overflow-x:auto;margin:18px 0">
          <svg viewBox="0 0 900 150" role="img" aria-label="Primary conversion path" style="width:100%;min-width:720px">
        <defs>
          <marker id="pathArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="currentColor"/>
          </marker>
        </defs>
        ${flowLabels.map((label, index) => {
          const x = 20 + index * 176;
          return `<rect x="${x}" y="42" width="145" height="58" rx="10" fill="none" stroke="currentColor" opacity=".45"/>
            <text x="${x + 72.5}" y="76" text-anchor="middle" font-size="12">${e(String(label).slice(0, 26))}</text>
            ${index < flowLabels.length - 1 ? `<line x1="${x + 145}" y1="71" x2="${x + 170}" y2="71" stroke="currentColor" marker-end="url(#pathArrow)" opacity=".55"/>` : ""}`;
        }).join("")}
      </svg>
    </div>`;

  const pathRows = paths.map((p) => `
    <tr>
      <td><strong>${e(p.name || "Conversion path")}</strong>${p.host ? `<br><span class="small">${e(p.host)}</span>` : ""}</td>
      <td><span class="chip ${statusClass(p.status)}">${e(statusFor(p.status))}</span><br><span class="small">${e(p.status || "Unknown")}</span></td>
      <td class="small">${e((p.steps || []).join(" → ") || "No step sequence available")}</td>
      <td class="small">${e((p.blockers || []).join("; ") || "No material blocker recorded")}</td>
    </tr>`).join("");

  const strengths = paths.filter((p) => p.status === "Clear");

  return `
  <section id="paths" class="card">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Can visitors easily move from interest to action?</p>
    <p class="muted small">Conversion Path Architecture</p>

    <h2>Conversion path architecture</h2>
    <p>${e(verdict)}</p>

    <h3>Primary conversion-path sequence</h3>
    ${flowSvg}

    <h3>Important path status</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Path</th><th>Status</th><th>Observed sequence</th><th>Where it weakens</th></tr></thead>
      <tbody>${pathRows}</tbody>
    </table></div>

    <h3>Where visitors may hesitate</h3>
    ${allBlockers.length
      ? `<ul>${allBlockers.map((b) => `<li>${e(b)}</li>`).join("")}</ul>`
      : "<p>No material hesitation point was recorded in the assessed conversion paths.</p>"}

    <h3>What is working</h3>
    ${strengths.length
      ? `<ul>${strengths.map((p) => `<li><strong>${e(p.name || "Conversion path")}:</strong> the assessed route was classified as Clear.</li>`).join("")}</ul>`
      : "<p>No assessed route was classified as fully Clear.</p>"}

    <h3>Material findings only</h3>
    ${allBlockers.length
      ? `<p>The blocker list above contains the material route weaknesses already carried in the governed conversion-path evidence. PRYSM does not add navigation issues that were not observed.</p>`
      : "<p>No material conversion-path finding was established.</p>"}

    <h3>Limitations</h3>
    <p class="small">${unavailableCount
      ? `${unavailableCount} path${unavailableCount === 1 ? " had" : "s had"} incomplete or non-clear evidence.`
      : "All displayed paths had an explicit governed status."} This page explains the most important routes to action rather than cataloguing every navigation element.</p>
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
      <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">How does your website compare with the competitors buyers are likely to consider?</p>
      <p class="muted small">Competitor Benchmark</p>
      <h2>Competitive context</h2>
      <p><span class="chip ${noComparisonState.className}">${e(noComparisonState.label)}</span> ${e(noComparisonState.explanation)}</p>
      ${limitations.length ? `<h3>Evidence limitations</h3><ul class="small">${limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : ""}
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

  const ownSite = {
    offerClarity: (site.services || []).length
      ? `${(site.services || []).length} service topic(s)`
      : "Not Assessed",
    trustProof:
      trustBand && trustBand !== "Not Assessed"
        ? trustBand
        : "Not Assessed",
    ctaClarity: governedConversionState,
    contentDepth: site.pageCount
      ? `${site.pageCount} page(s)`
      : "Not Assessed",
    pathClarity: governedConversionState,
  };

  const SIGNALS = [
    ["Offer clarity", "offerClarity"],
    ["Trust evidence", "trustProof"],
    ["Service depth", "contentDepth"],
    ["Buyer action clarity", "ctaClarity"],
    ["Conversion path", "pathClarity"],
  ];

  const header = clientComparisons
    .map((c) => `<th>${e(c.name || c.url || "Competitor")}</th>`)
    .join("");

  const signalRows = SIGNALS.map(([label, key]) => `
    <tr>
      <td><strong>${e(label)}</strong></td>
      <td>${e(ownSite[key])}</td>
      ${clientComparisons
        .map((c) => `<td>${e(c[key] || "Not Assessed")}</td>`)
        .join("")}
    </tr>`).join("");

  const sourceRows = clientComparisons.map((c) => `
    <tr>
      <td class="small">${e(c.name || c.url || "")}</td>
      <td class="small">${e(c.url || "")}</td>
      <td class="small">${e(c.status || "AVAILABLE")}</td>
      <td class="small">${e(c.topic || c.note || "Not Assessed")}</td>
    </tr>`).join("");

  const directAnswer =
    gaps.length
      ? `The assessed competitors provide stronger buying support in ${gaps.length} qualified comparative area${gaps.length === 1 ? "" : "s"}. Those differences matter only where PRYSM also has evidence that the client's current coverage is materially weaker.`
      : "The assessed competitor evidence provides context, but no qualified comparative gap was strong enough to become a recommendation on its own.";

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
    <p class="muted small">Competitor Benchmark</p>

    <h2>Competitive context</h2>
    <p>${e(directAnswer)}</p>

    <h3>Who was compared and why</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Competitor</th><th>URL</th><th>Status</th><th>Observed context</th></tr></thead>
      <tbody>${sourceRows}</tbody>
    </table></div>
    <p class="muted small">Only supplied or qualified collected competitor evidence is shown. PRYSM does not infer market-wide behavior from this sample.</p>

    <h3>Comparative overview</h3>
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
    if (positive) return "Adequate";
    if (count >= 3) return "Adequate";
    if (count >= 1) return "Thin";
    return "Limited Evidence";
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
      bofu.length || (site.ctas || []).length,
      (site.ctas || []).length > 0,
      "Decision-stage information and a clear route to action.",
    ],
  ];

  const directAnswer =
    contentScore === null
      ? "PRYSM has limited evidence for judging whether current content answers the full set of buyer questions."
      : contentScore >= 60
        ? `The site has a usable content foundation (${contentScore}/100), but qualified opportunities remain to strengthen buyer questions that are not fully supported.`
        : `Content and funnel coverage is limited at ${contentScore}/100. Buyers are likely to encounter unanswered questions as they move from understanding the problem toward taking action.`;

  const coverageRows = buyerNeeds
    .map(([need, count, positive, meaning]) => {
      const state = coverageState(Number(count) || 0, positive === true);
      return `<tr>
        <td><strong>${e(need)}</strong></td>
        <td>${e(state)}</td>
        <td class="small">${e(meaning)}</td>
      </tr>`;
    })
        .join("");

  const allIdeas = [
    ...tofu.map((i) => ({ ...i, stage: "Awareness" })),
    ...mofu.map((i) => ({ ...i, stage: "Evaluation" })),
    ...bofu.map((i) => ({ ...i, stage: "Decision" })),
  ];

  const opportunityRows = allIdeas
    .map(
      (i) => `<tr>
        <td>${e(i.question || "Buyer question")}</td>
        <td>${e(i.stage)}</td>
        <td>${e(i.frame || "Buyer-question support")}</td>
        <td>${e(i.idea || "")}</td>
        <td class="small">Connect to the most relevant service, proof, or conversion page.</td>
      </tr>`,
    )
    .join("");

  const coveredTopics = [
    ...new Set([
      ...(site.services || []),
      ...(site.topicKeywords || []),
    ]),
  ].slice(0, 12);

  const leadingBlock = leading.length
    ? `<h3>Additional qualified search intents</h3>
       <div class="table-wrap"><table>
         <thead><tr><th>Query</th><th>Rationale</th><th>Priority</th></tr></thead>
         <tbody>${leading
           .map(
             (q) =>
               `<tr><td>${e(q.query || "")}</td><td class="small">${e(q.rationale || "")}</td><td>${e(q.priority || "")}</td></tr>`,
           )
           .join("")}</tbody>
       </table></div>`
    : "";

  return `
  <section id="content-ideas" class="card">
    <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">Does your content answer the questions buyers actually have?</p>
    <p class="muted small">Topical Map &amp; Qualified Content Opportunities</p>
    <h2>Topical Map &amp; Content Opportunities</h2>

    <p>${e(directAnswer)}</p>

    <h3>Buyer-question coverage</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Buyer need</th><th>Coverage state</th><th>What it means</th></tr></thead>
      <tbody>${coverageRows}</tbody>
    </table></div>

    <h3>Material content gaps and qualified opportunities</h3>
    ${
      opportunityRows
        ? `<div class="table-wrap"><table>
          <thead><tr><th>Buyer question</th><th>Current coverage</th><th>Why it matters</th><th>Recommended content</th><th>Where it should connect</th></tr></thead>
          <tbody>${opportunityRows}</tbody>
        </table></div>`
        : `<p><span class="chip cap-ok">PASS</span> No qualified content opportunity was generated from the assessed evidence.</p>`
    }

    <h3>Where content is already doing its job</h3>
    ${
      coveredTopics.length
        ? `<ul>${coveredTopics.map((topic) => `<li>${e(topic)}</li>`).join("")}</ul>`
        : `<p>No crawl-visible topic list was available.</p>`
    }

    ${leadingBlock}

    <h3>Evidence limitations</h3>
    <p class="small">Ideas are derived from existing business-context topics and crawl-visible content carried in the governed model. Search demand or competitor coverage may strengthen an opportunity, but neither alone creates a recommendation.</p>
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
    `<tr><td>Server / delivery</td><td>${
      headersAvailable && server
        ? e(server)
        : `<span class="chip cap-neutral">Not assessed</span> Response headers were not returned by the crawl provider.`
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
  <section id="cms" class="card">
    <h2>CMS &amp; Platform Constraints</h2>
    <h3>Observed from the crawl</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Signal</th><th>Value</th></tr></thead>
      <tbody>${observedRows}</tbody>
    </table></div>
    <h3>Implementation questions — generic verification checklist</h3>
    <p class="muted small">The questions below are a generic checklist, not findings about this site. None of them has been verified: platform administration access is required to confirm the answers.</p>
    <ul class="small">${questions.map((q) => `<li>${e(q)}</li>`).join("")}</ul>
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
    body = `<h3>Implementation-Ready Recommendations (${opportunities.length})</h3>
<p class="muted small">High- and medium-confidence recommendations traceable to crawled source and target page content.</p>
<div class="table-wrap"><table>
<thead><tr><th>Source</th><th>Target</th><th>Anchor</th><th>Source context</th><th>Reason</th><th>Stage</th><th>Confidence</th><th>Warning</th></tr></thead>
<tbody>${opportunities
  .slice(0, 25)
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
</table></div>`;
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
<div class="table-wrap"><table>
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
</table></div>`
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
<div class="table-wrap"><table>
<thead><tr><th>URL</th><th>Title</th></tr></thead>
<tbody>${orphans
  .slice(0, 15)
  .map(
    (o) =>
      `<tr><td class="small">${e(
        (o.url || "").slice(0, 60),
      )}</td><td class="small">${e(o.title || "—")}</td></tr>`,
  )
  .join("")}</tbody>
</table></div>`
      : opp?.coverage?.crawlComplete === false
        ? `<p class="small">Orphan analysis: crawl coverage is incomplete — definitive orphan claims cannot be made.</p>`
        : "";

  return `
  <section id="internal-links" class="card">
    <h2>Internal-Link Opportunities</h2>
    <p class="muted small">Summary: ${e(totalLinks)} total internal links, ${e(
      brokenLinks.length,
    )} broken. ${e(
      opp?.coverage?.pagesEvaluated ?? 0,
    )} pages evaluated. ${e(
      opportunities.length,
    )} recommendation(s).</p>
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
  <section id="evidence" class="card">
    <h2>Evidence detail</h2>
    <h3>Findings (${e((model.findings || []).length)})</h3>
    <ul class="findings">${findings}</ul>

    <h3>Source statuses</h3>
    <ul class="small">${sources}</ul>

    <h3>Evidence capabilities</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Capability</th><th>Status</th><th>Limitations</th><th>Kind</th></tr></thead>
      <tbody>${capRows}</tbody>
    </table></div>

    ${deferredBlock}
  </section>`;
}

function renderViewerNav() {
  return REPORT_V2_VIEWER_PAGES.map(
    (page, index) => `
    <a class="viewer-nav-link" href="#${e(
      page.pageId,
    )}" data-viewer-page="${e(page.pageId)}">
      <span class="viewer-nav-num">${String(index + 1).padStart(
        2,
        "0",
      )}</span>
      <span>${e(page.title)}</span>
    </a>`,
  ).join("");
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

body.viewer-ready .narrative-layer > section:not(.viewer-active) {
  display:none;
}

body.viewer-ready .narrative-layer > section.viewer-active {
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

  body.viewer-ready .narrative-layer > section:not(.viewer-active) {
    display:none !important;
  }

  body.viewer-ready .narrative-layer > section.viewer-active {
    display:block !important;
  }

  .card,
  .pillar,
  main > section:not(.card) {
    box-shadow:none;
    page-break-inside:avoid;
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
      ${competitorSection(model)}
      ${contentOpportunitiesSection(model)}
      ${eeatSection(model)}
      ${technicalDetailSection(model)}
      ${headingSection(model)}
      ${schemaSection(model)}
      ${performanceDetailSection(model)}
      ${accessibilityMobileSection(model)}
      ${machineReadinessSection(model)}
      ${cmsPlatformSection(model)}
      ${internalLinksSection(model)}
      ${strengthsSection(model, checklist)}
      ${actionPlanSection(plan, checklist)}
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
  const allSectionIds = new Set(
    pages.flatMap((page) => page.sectionIds)
  );

  const title = document.getElementById("viewerPageTitle");
  const content = document.getElementById("reportContent");
  const links = Array.from(
    document.querySelectorAll("[data-viewer-page]")
  );
  const narrativeSections = Array.from(
    document.querySelectorAll(
      "#narrative-layer > section[data-viewer-page]"
    )
  );

  for (const id of allSectionIds) {
    const section = document.getElementById(id);
    if (section) section.classList.add("viewer-section");
  }

  for (const section of narrativeSections) {
    section.classList.add("viewer-section");
  }

  function resolvePage() {
    const requested = decodeURIComponent(
      (window.location.hash || "").replace(/^#/, "")
    );
    return byId.get(requested) || fallback;
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
    const page = resolvePage();

    if (
      window.location.hash !==
      "#" + page.pageId
    ) {
      history.replaceState(null, "", "#" + page.pageId);
    }

    activate(page, options);
  }

  for (const link of links) {
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
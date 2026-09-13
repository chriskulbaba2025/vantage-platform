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

function canonicalSolutionContext(model) {
  const canonical = model?.canonicalSolutions;
  if (!canonical || !Array.isArray(canonical.records) || !Array.isArray(canonical.sequence)) {
    return { byId: new Map(), byFindingId: new Map(), ordered: [] };
  }
  const requiredFields = [
    "problem", "whyItMatters", "whatToChange", "howToFix", "siteAnchor",
    "evidenceGrade", "prescriptionMode", "capabilityRequired", "effortBand",
    "dependencies", "implementationCheck", "disposition", "clientProminence",
    "crossPageReferences",
  ];
  const byId = new Map();
  for (const record of canonical.records) {
    if (!record?.solutionId || byId.has(record.solutionId)) {
      throw new Error("Canonical solution ID is invalid or duplicated");
    }
    if (requiredFields.some((field) => !Object.hasOwn(record, field))) {
      throw new Error(`Canonical solution record is missing a required field for rendering: ${record.solutionId}`);
    }
    if (!record.siteAnchor || typeof record.siteAnchor !== "object" ||
      typeof record.siteAnchor.type !== "string" || typeof record.siteAnchor.locator !== "string" ||
      typeof record.siteAnchor.scope !== "string") {
      throw new Error(`Canonical solution site anchor is malformed: ${record.solutionId}`);
    }
    if (!record.implementationCheck || typeof record.implementationCheck.instruction !== "string" ||
      typeof record.implementationCheck.passCondition !== "string") {
      throw new Error(`Canonical solution implementation check is malformed: ${record.solutionId}`);
    }
    if (!Array.isArray(record.capabilityRequired) || !Array.isArray(record.dependencies) ||
      !Array.isArray(record.crossPageReferences)) {
      throw new Error(`Canonical solution arrays are malformed: ${record.solutionId}`);
    }
    for (const reference of record.crossPageReferences) {
      if (!reference?.pageId || !REPORT_V2_VIEWER_PAGES.some((page) => page.pageId === reference.pageId)) {
        throw new Error(`Canonical solution page reference is invalid: ${record.solutionId}`);
      }
    }
    byId.set(record.solutionId, record);
  }
  const byFindingId = new Map();
  for (const record of canonical.records) {
    if (!record?.solutionId || !Array.isArray(record.findingRefs) || !record.findingRefs.length) {
      throw new Error("Canonical solution record is incomplete for solution rendering");
    }
    for (const findingRef of record.findingRefs) {
      if (typeof findingRef !== "string" || byFindingId.has(findingRef)) {
        throw new Error("Canonical solution finding reference is invalid or duplicated");
      }
      byFindingId.set(findingRef, record);
    }
  }
  if (new Set(canonical.sequence).size !== canonical.sequence.length) {
    throw new Error("Canonical solution sequence contains duplicate IDs");
  }
  const ordered = canonical.sequence.map((solutionId) => {
    const record = byId.get(solutionId);
    if (!record) throw new Error(`Canonical solution sequence reference does not resolve: ${solutionId}`);
    return record;
  });
  const findingsById = new Map((model?.findings || []).map((finding) => [finding.findingId, finding]));
  const hierarchyIds = (model?.decisionHierarchy?.orderedFindingIds || [])
    .filter((findingId) => findingsById.get(findingId)?.actionable !== false);
  for (const findingId of hierarchyIds) {
    if (!byFindingId.has(findingId)) {
      throw new Error(`Canonical solution missing for governed hierarchy finding: ${findingId}`);
    }
  }
  return { byId, byFindingId, ordered };
}

function canonicalReference(record, label = "View canonical detail") {
  return `<a class="canonical-solution-reference" href="#priority-fixes" data-solution-id="${e(record.solutionId)}">${e(label)} (${e(record.solutionId)})</a>`;
}

function clientJourneyReference(record, label) {
  return `<a class="canonical-solution-reference" href="#priority-fixes"${record ? ` data-solution-id="${e(record.solutionId)}"` : ""}>${e(label)}</a>`;
}

function clientJourneyStep(pathState, index) {
  const steps = pathState === "clear"
    ? [
        ["Reach the right page", "Visitors can get to the pages that explain the offer."],
        ["See what to do next", "The pages provide a clear next step."],
        ["Move toward action", "We did not find a major problem blocking that path."],
      ]
    : pathState === "weak"
      ? [
          ["Reach the right page", "Visitors can reach the pages reviewed in this audit."],
          ["See what to do next", "A next step is visible, but the route still needs attention."],
          ["Move toward action", "The audit found issues that may slow movement toward action."],
        ]
      : [
          ["Reach the right page", "The pages reviewed in this audit show part of the route."],
          ["See what to do next", "Some next-step evidence is available, but the full route is not known."],
          ["Move toward action", "The audit cannot confirm the full path from the evidence available."],
        ];
  return steps[index];
}

function clientJourneyIssue(issue, solution) {
  if (issue === "performance") {
    return {
      title: "The page can feel slow when someone first arrives.",
      meaning: "The route itself is clear, but slow loading can interrupt the experience before a visitor has seen the main content. That may make the site feel harder to use than it really is.",
      next: "Fix the speed issue listed in Priority Fixes, then test the same page again.",
      reference: clientJourneyReference(solution, "See Priority Fixes"),
    };
  }
  if (issue === "buyer-questions") {
    return {
      title: "Some buyers may still have questions.",
      meaning: "People may understand what the business offers but still need answers before they are ready to contact someone. Questions about cost, process, timing, or what happens next can make people hesitate.",
      next: "Add the most useful answers where visitors are making the decision.",
      reference: `${clientJourneyReference(solution, "See Priority Fixes")} ${clientJourneyReference(solution, "See Content Opportunities")}`,
    };
  }
  return null;
}

function clientJourneyTakeaway(pathState) {
  if (pathState === "clear") {
    return "The basic journey does not need to be rebuilt. The better opportunity is to remove small points of friction so people can move through the site with less hesitation.";
  }
  if (pathState === "weak") {
    return "The journey needs focused improvements before it can move visitors toward action with less friction. Start with the issues called out above and retest the affected pages.";
  }
  return "The available evidence does not show enough of the journey to decide whether it needs a rebuild. Review the missing path evidence before making that decision.";
}

function clientJourneySupport({ findingIds, trustBand, solutions }) {
  const cards = [];
  if (findingIds.has("VAN-CONTENT-002")) {
    cards.push({
      title: "Clear answers",
      meaning: "Clear answers help people feel ready to take the next step.",
      cta: "See Content Opportunities",
      target: "#content-ideas",
      solution: solutions.get("VAN-CONTENT-002"),
    });
  }
  if (trustBand) {
    cards.push({
      title: "Trust signals",
      meaning: "Trust signals help reduce doubt before someone contacts the business.",
      cta: "See Trust & Credibility",
      target: "#trust-eeat",
    });
  }
  if (findingIds.has("VAN-PERF-001")) {
    cards.push({
      title: "Fast pages",
      meaning: "Fast pages help keep people moving without interruption.",
      cta: "See Priority Fixes",
      target: "#priority-fixes",
      solution: solutions.get("VAN-PERF-001"),
    });
  }
  return cards;
}

function executivePriorityKind(record) {
  const key = `${String(record?.ruleId || "")} ${String(record?.failureMode || "")} ${String(record?.problem || "")}`.toUpperCase();
  if (key.includes("VAN-PERF-001") || key.includes("SLOW-LARGEST-CONTENTFUL-PAINT")) return "performance";
  if (key.includes("VAN-CONTENT-002") || key.includes("MISSING-BUYER-DECISION-CONTENT") || key.includes("BUYER DECISION-SUPPORT")) return "buyer-decision";
  if (key.includes("VAN-SCHEMA-001") || key.includes("MISSING-STRUCTURED-DATA")) return "structured-data";
  if (key.includes("PRICING") || key.includes("REASSURANCE") || key.includes("RISK")) return "reassurance";
  if (key.includes("ALTERNATIVE TEXT") || key.includes("ALT TEXT")) return "accessibility";
  return "general";
}

function executivePriorityTitle(record) {
  switch (executivePriorityKind(record)) {
    case "performance":
      return "The main content can take too long to appear.";
    case "buyer-decision":
      return "Some buyers may still have questions.";
    case "structured-data":
      return "Search engines could use clearer information about the business.";
    case "reassurance":
      return "Some visitors may need more pricing or reassurance before they act.";
    case "accessibility":
      return "Some images may not be clear to everyone.";
    default:
      return plainLanguage(record?.problem || "A conversion opportunity remains to be addressed.");
  }
}

function executivePriorityMeaning(record) {
  switch (executivePriorityKind(record)) {
    case "performance":
      return "When the largest part of a page loads slowly, the site can feel less responsive. That can create friction before a visitor has had a chance to explore the page.";
    case "buyer-decision":
      return "When visitors cannot find the answers they need, they may hesitate, keep comparing, or leave without taking the next step.";
    case "structured-data":
      return "Structured data helps search engines and other systems understand what a business does and what a page is about. It does not improve conversions by itself, but it can make the site's information easier to understand.";
    case "reassurance":
      return "When people are deciding whether to contact you, they may want a clearer sense of cost, risk, or what happens next. If that information is missing, they may keep comparing instead of moving forward.";
    case "accessibility":
      return "Images that carry useful information should also have a short text description. Without it, some visitors may miss part of the message.";
    default:
      return plainLanguage(record?.whyItMatters || record?.problem || "This may add friction for visitors deciding what to do next.");
  }
}

function plainLanguage(value) {
  return String(value || "")
    .replace(/the governed assessment indicates that/gi, "The review found that")
    .replace(/the governed site evidence indicates that/gi, "The review found that")
    .replace(/the governed page evidence indicates that/gi, "The review found that")
    .replace(/if the governed [^,]+ remains present,?/gi, "If this issue is still present,")
    .replace(/at the assessed scope/gi, "on the pages reviewed")
    .replace(/in the assessed scope/gi, "on the pages reviewed")
    .replace(/assessed path/gi, "reviewed pages")
    .replace(/decision-support/gi, "buyer information")
    .replace(/decision context/gi, "the information they need")
    .replace(/unresolved/gi, "unanswered")
    .replace(/unanswered buyer questions/gi, "buyer questions without clear answers")
    .replace(/structured data was not detected/gi, "structured data was not found")
    .replace(/explicit entity context may remain incomplete/gi, "search engines may have less context about the business")
    .replace(/governed/gi, "reviewed")
    .replace(/assessed/gi, "reviewed")
    .replace(/material /gi, "")
    .replace(/remediation/gi, "fix");
}

function executivePriorityAction(record) {
  switch (executivePriorityKind(record)) {
    case "reassurance":
      return "Add only pricing or reassurance details the business can support. Put them where visitors are making the decision, explain any limits clearly, and check that the final page says exactly what the business intends.";
    case "buyer-decision":
      return "List the questions buyers ask most often and answer them where they are likely to need them. Keep the answers specific to the offer, then check that they appear on the right page or stage of the journey.";
    case "accessibility":
      return "Add short, accurate descriptions to meaningful images. Leave decorative images without a description, then check the affected pages to make sure the text is in place.";
  }
  const guidance = [record?.whatToChange, record?.howToFix].filter(Boolean).map(plainLanguage).join(" ");
  return guidance || "Address the opportunity and check the same issue again.";
}

function executivePriorityReference(record) {
  return `<a class="canonical-solution-reference" href="#priority-fixes">Priority Fixes</a>`;
}

function executiveNarrative({ readiness, actions, strengths }) {
  if (readiness === null) {
    return "The information reviewed provides a useful starting point, but there isn't enough to produce an overall score.";
  }
  const foundation = strengths.length
    ? "The site already has a solid foundation for conversion."
    : "The information reviewed provides a measured starting point for conversion.";
  const opportunities = actions.length
    ? "The biggest opportunities are the three priorities below."
    : "No priority was established from the information reviewed.";
  return `${foundation} ${opportunities} These changes are about making the visitor journey clearer and easier, not rebuilding the whole site.`;
}

function canonicalSummary(record) {
  return `<strong>${e(record.problem)}</strong><br><span class="small">${e(record.whyItMatters)}</span><br>${e(record.whatToChange)} ${canonicalReference(record)}`;
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

function executiveScorecard(model, pillars, canonical) {
  const readiness = model.scores.conversionReadiness;
  const assessedWeight = Number(model.assessedWeight ?? 0);
  const actions = canonical.ordered.filter((record) => record.clientProminence?.displayAllowed).slice(0, 3);
  const readinessLine = readiness === null
    ? `<div class="readiness-none">${e(model.readinessStatus || "Overall score unavailable")}</div>`
    : `<div class="readiness">${e(readiness)}<span class="readiness-max">/100</span></div><div class="readiness-band">${bandChip(model.bands.conversionReadiness)}</div>`;
  const priorities = actions.length
    ? `<ol class="executive-priorities">${actions.map((record) => {
      return `<li data-solution-id="${e(record.solutionId)}"><h4>${e(executivePriorityTitle(record))}</h4><p>${e(executivePriorityMeaning(record))}</p><p><strong>What to do:</strong> ${e(executivePriorityAction(record))} ${executivePriorityReference(record)}</p></li>`;
    }).join("")}</ol>`
    : `<p>No priority action was generated from the information reviewed.</p>`;
  const strengths = (pillars || [])
    .filter((pillar) => typeof pillar.score === "number" && pillar.score >= 60)
    .slice(0, 5)
    .map((pillar) => `${pillar.label} provides a solid foundation in the pages and signals reviewed.`);
  const coverage = assessedWeight >= 100
    ? `<p><strong>Assessment coverage was complete.</strong> We found enough evidence to support the main conclusions on this page. Areas with limited evidence are identified in Supporting Detail rather than being treated as confirmed problems.</p>`
    : assessedWeight >= 90
      ? `<p>Assessment coverage was nearly complete. We found enough evidence to support the main conclusions on this page. Areas with limited evidence are identified in Supporting Detail rather than being treated as confirmed problems.</p>`
      : `<p>Assessment coverage was limited. Areas with limited evidence are clearly marked.</p>`;
  const uncertainty = readiness === null
    ? "There was not enough information to produce an overall score. The report distinguishes what was reviewed from what remains unknown."
    : model.readinessStatus === "Provisional"
      ? "Some information was unavailable in the pages reviewed, so this overall result is provisional."
      : "No material limitation changes the overall conclusion.";
  return `
  <section id="executive" class="card">
    <h2>How ready is your website to convert visitors?</h2>
    <p class="muted small">Executive Scorecard</p>
    <div class="executive-readiness"><h3>Conversion Readiness</h3>${readinessLine}<p class="muted small">How effectively the site supports a visitor moving toward action.</p></div>
    <p>${e(executiveNarrative({ readiness, actions, strengths }))}</p>
    <h3>What should you improve first?</h3>${priorities}
    <h3>What is already working?</h3>
    ${strengths.length ? `<p>The site is not starting from scratch. The areas below already provide a useful foundation. That means the next changes can focus on removing friction instead of rebuilding the whole conversion journey.</p><ul>${strengths.map((strength) => `<li>${e(strength)}</li>`).join("")}</ul>` : `<p>No supported positive finding was available in the information reviewed.</p>`}
    <h3>Where was the evidence limited?</h3><div class="note"><p>${e(uncertainty)}</p>${coverage}</div>
    <h3>Supporting Detail</h3><p>Go to <strong>Priority Fixes</strong> for the ranked actions and supporting evidence. Use <strong>Supporting Detail</strong> for deeper evidence, technical details, and assessment limits.</p>
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

function page2Kind(record) {
  const key = `${record.problem || ""} ${record.siteAnchor?.locator || ""}`.toLowerCase();
  if (/largest contentful paint|\blcp\b|above-fold/.test(key)) return "performance";
  if (/buyer decision|buyer question|decision-support/.test(key)) return "buyer-decision";
  if (/structured data|schema/.test(key)) return "structured-data";
  if (/meta description|search-result description/.test(key)) return "meta-description";
  if (/heading structure|headings/.test(key)) return "heading-structure";
  if (/pricing|reassurance|risk/.test(key)) return "reassurance";
  if (/alternative text|alt text/.test(key)) return "accessibility";
  return "general";
}

function page2Title(record) {
  return ({ performance: "The main content can take too long to appear.", "buyer-decision": "Some buyers may still have questions.", "structured-data": "Search engines could use clearer information about the business.", "meta-description": "Some pages are missing useful search-result descriptions.", "heading-structure": "Some pages could use a clearer heading structure.", reassurance: "Some visitors may need more pricing or reassurance before they act.", accessibility: "Some images may not be clear to everyone." }[page2Kind(record)] || plainLanguage(record.problem || "A page improvement needs attention."));
}

function page2Found(record) {
  return ({ performance: "The largest part of the page is taking longer than ideal to load. This can make the page feel slow when someone first arrives.", "buyer-decision": "People may not have all the information they need before they are ready to contact the business.", "structured-data": "We did not detect structured data on the pages reviewed.", "meta-description": "Some reviewed pages do not have a meta description.", "heading-structure": "The heading order on some reviewed pages is not consistent.", reassurance: "People may need more information about cost, risk, or what happens next before they contact the business.", accessibility: "Some meaningful images do not have a short text description on the pages reviewed." }[page2Kind(record)] || plainLanguage(record.problem || "The review found an opportunity to improve the page."));
}

function page2Why(record) {
  return ({ performance: "People often decide quickly whether to stay on a page. If the main content takes too long to appear, the site may feel less responsive.", "buyer-decision": "They may want to know how the process works, how long it takes, what it costs, or what happens next. If they cannot find those answers, they may leave and keep looking.", "structured-data": "Structured data helps search engines and other systems understand what the business does and what a page is about. It does not improve conversions by itself.", "meta-description": "A meta description can help explain a page in search results. Without one, the search engine may choose its own text.", "heading-structure": "Clear headings help people scan a page and understand how the information is organized. They can also help search engines understand the page structure.", reassurance: "If visitors cannot find the information they need before contacting the business, they may keep comparing instead of moving forward.", accessibility: "Without a text description, some visitors may miss part of the message in an image." }[page2Kind(record)] || plainLanguage(record.whyItMatters || "This may make it harder for visitors to decide what to do next."));
}

function page2Action(record) {
  return ({ performance: "Start with the largest item near the top of the page. Reduce its file size or loading work if needed. Then check whether scripts, fonts, or other resources are slowing it down. Run the same speed test again after the change.", "buyer-decision": "Write down the questions customers ask most often. Add clear answers to the pages where people are most likely to need them. Keep each answer short and specific to the service.", "structured-data": "Add only structured data that matches the real business and page content. Start with the organization, services, or page types that are clearly supported. Check that the final structured data is valid after it is published.", "meta-description": "Write a short description for each affected page. Explain what the page is about and why someone may want to visit it. Keep it specific to that page and check that it appears in the page metadata.", "heading-structure": "Use one clear main heading for the page. Then organize the sections underneath it in a simple order. Check the final page to make sure the headings make sense from top to bottom.", reassurance: "Add only pricing or reassurance details the business can support. Put them where visitors are making the decision, explain any limits clearly, and check that the final page says exactly what the business intends.", accessibility: "Add short, accurate descriptions to meaningful images. Leave decorative images without a description, then check the affected pages to make sure the text is in place." }[page2Kind(record)] || [record.whatToChange, record.howToFix].filter(Boolean).map(plainLanguage).join(" "));
}

function page2Location(record) {
  const type = String(record.siteAnchor?.type || "").toUpperCase();
  const locator = String(record.siteAnchor?.locator || "");
  const scope = String(record.siteAnchor?.scope || "");
  if (type === "COMPONENT" && /largest-above-fold-asset/i.test(locator)) return "Homepage — the largest item near the top of the page";
  if (type === "PAGE_TEMPLATE" && /buyer-decision-support-template/i.test(locator)) return "Main service and decision pages";
  if (type === "COMPONENT" && /structured-data-block/i.test(locator)) return "Pages where business and service information is published";
  if (type === "URL") return scope ? `The affected page — ${scope}` : "The affected page";
  if (type === "HEADING") return scope ? `The headings on the affected page — ${scope}` : "The headings on the affected page";
  return scope || "Pages covered by the review";
}

function page2Confidence(record) {
  const grade = String(record.evidenceGrade || "").toUpperCase();
  return grade === "SUPPORTED" || grade === "STRONG" ? "Strong evidence" : grade === "PARTIAL" || grade === "CONDITIONAL" ? "Some evidence — confirm before making the change" : "Not enough evidence yet";
}

function page2Roles(record) {
  const capabilities = new Set(record.capabilityRequired || []);
  const roles = { FRONT_END_DEVELOPMENT: "Web developer", HOSTING_PLATFORM_CONFIGURATION: "Hosting support", CONTENT_STRATEGY: "Content writer or strategist", SUBJECT_MATTER_INPUT: "someone who knows the customers well", TECHNICAL_SEO: "SEO specialist", COPY_CONTENT: "Content writer", ACCESSIBILITY: "accessibility specialist", DESIGN_UX: "designer or UX specialist", ANALYTICS: "analytics or marketing specialist" };
  if (capabilities.has("CONTENT_STRATEGY") && capabilities.has("SUBJECT_MATTER_INPUT")) return "Content writer and someone who knows the customers well";
  if (capabilities.has("TECHNICAL_SEO") && capabilities.has("FRONT_END_DEVELOPMENT")) return "SEO specialist or web developer";
  if (capabilities.has("COPY_CONTENT") && capabilities.has("TECHNICAL_SEO")) return "Content writer or SEO specialist";
  const translated = [...capabilities].map((item) => roles[item] || "Web or content specialist");
  return [...new Set(translated)].join(" or ") || "Web or content specialist";
}

function page2Effort(record) {
  return ({ LOW: "Low", MEDIUM: "Medium", HIGH: "High" }[String(record.effortBand || "").toUpperCase()] || "Not specified");
}

function page2Verify(record) {
  return ({ performance: "Run the same speed test again and confirm the main content appears sooner.", "buyer-decision": "Review the relevant pages and confirm the common buyer questions are answered clearly.", "structured-data": "Check the published structured data with a validator and confirm it matches the page content.", "meta-description": "Check the affected pages and confirm each page has a useful description in its metadata.", "heading-structure": "Read the headings from top to bottom and confirm the order is clear and consistent." }[page2Kind(record)] || plainLanguage(record.implementationCheck?.passCondition || "Repeat the relevant check and confirm the issue has improved."));
}

function blockersSection(model, canonical) {
  const primary = canonical.ordered.filter((record) => record.clientProminence?.displayAllowed);
  if (primary.length === 0) {
    return `<section id="blockers" class="card">
      <p style="font-size:1.15rem;font-weight:700;margin-bottom:6px">What should you fix first?</p>
      <p class="muted small">Priority Fixes</p>
      <h2>What should you fix first?</h2>
      <p><span class="chip cap-ok">PASS</span> No prioritized action was produced from the available evidence.</p>
    </section>`;
  }

  const cards = primary.slice(0, 5).map((record, index) => {
    const governedRank = record.sequenceInputs?.governedRank ?? index + 1;
    return `<article class="priority-action" data-priority-rank="${e(governedRank)}" data-solution-id="${e(record.solutionId)}">
      <div class="priority-action-heading">
        <span class="priority-rank" aria-label="Priority ${e(governedRank)}">${e(governedRank)}</span>
        <div>
          ${index === 0 ? '<span class="priority-start">Start here</span>' : ''}
          <h3>${e(page2Title(record))}</h3>
        </div>
      </div>
      <dl class="priority-action-fields">
        <div class="priority-field priority-field-attention"><dt>What we found</dt><dd>${e(page2Found(record))}</dd></div>
        <div class="priority-field priority-field-attention"><dt>Why it matters</dt><dd>${e(page2Why(record))}</dd></div>
        <div class="priority-field priority-field-attention"><dt>What to do</dt><dd>${e(page2Action(record))}</dd></div>
        <div class="priority-field"><dt>Where to look</dt><dd>${e(page2Location(record))}</dd></div>
        <div class="priority-field priority-field-attention"><dt>How to know it worked</dt><dd>${e(page2Verify(record))}</dd></div>
        <div class="priority-field"><dt>Who may need to help</dt><dd>${e(page2Roles(record))}</dd></div>
        <div class="priority-field"><dt>Confidence in this finding</dt><dd>${e(page2Confidence(record))}</dd></div>
        <div class="priority-field"><dt>Effort</dt><dd>${e(page2Effort(record))}</dd></div>
      </dl>
    </article>`;
  }).join("");

  return `
  <section id="blockers" class="card">
    <p class="muted small">Priority Fixes</p>
    <h2>What should you fix first?</h2>
    <p>Start with the first item and work down the list. Each fix below explains what we found, why it matters, what to do next, and how to check the result. Supporting Detail contains the deeper evidence and technical checks.</p>
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

function conversionPathSectionLegacy(model) {
  const canonical = canonicalSolutionContext(model);
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
  const solutionForRule = (ruleId) => {
    const finding = (model.findings || []).find((item) => (item.ruleId || item.id) === ruleId);
    return finding ? canonical.byFindingId.get(finding.findingId) : null;
  };
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
    const solution = solutionForRule("VAN-PERF-001");
    momentumCards.push({
      title: "Mobile loading friction",
      finding: solution?.problem || "A governed performance issue was identified.",
      meaning: solution?.whyItMatters || "The assessed performance evidence needs review.",
      solution,
    });
  }

  if (findingIds.has("VAN-CONTENT-002")) {
    const solution = solutionForRule("VAN-CONTENT-002");
    momentumCards.push({
      title: "Decision-support gap",
      finding: solution?.problem || "A governed content issue was identified.",
      meaning: solution?.whyItMatters || "The assessed content evidence needs review.",
      limitation: "This applies only to the pages we could assess; other pages remain unknown.",
      solution,
    });
  }
  const momentumSection = momentumCards.length
    ? `<h3>Where visitors may lose momentum</h3><div class="conversion-journey-card-grid">${momentumCards.map((card) => `<article class="conversion-journey-detail-card">
      <h4>${e(card.title)}</h4>
      <p><strong>Finding:</strong> ${e(card.finding)}${card.solution ? ` ${canonicalReference(card.solution)}` : ""}</p>
      <p><strong>Client meaning:</strong> ${e(card.meaning)}</p>
      ${card.limitation ? `<p class="muted small">${e(card.limitation)}</p>` : ""}
    </article>`).join("")}</div>`
    : "";
  const bridgeCards = [];
  if (findingIds.has("VAN-CONTENT-002")) {
    const solution = solutionForRule("VAN-CONTENT-002");
    bridgeCards.push({
      title: "Content that answers buyer questions",
      interpretation: solution?.whyItMatters || "The assessed content evidence needs review before a conclusion is drawn.",
      cta: "See Content Opportunities →",
      target: "#content-ideas",
      solution,
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
      solution: solutionForRule("VAN-PERF-001"),
    });
  }
  const journeyBridge = bridgeCards.length
    ? `<h3>What supports this journey?</h3><div class="conversion-journey-bridge-grid">${bridgeCards.map((card) => `<article class="conversion-journey-bridge-card">
      <h4>${e(card.title)}</h4>
       <p>${e(card.interpretation)}${card.solution ? ` ${canonicalReference(card.solution)}` : ""}</p>
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
    <p>The assessed route was evaluated using the available path evidence. Any client remediation that applies to this journey is represented by the linked canonical Priority Fix record.</p>
    <h3>Canonical issues affecting this journey</h3>
    <ol class="conversion-journey-actions">${["VAN-PERF-001", "VAN-CONTENT-002"]
      .map((ruleId) => solutionForRule(ruleId))
      .filter(Boolean)
      .map((record) => `<li>${e(record.whatToChange)} ${canonicalReference(record)}</li>`)
      .join("")}
    </ol>
    <div class="conversion-journey-takeaway"><strong>Conversion takeaway</strong><p>The assessed route is described above using the available evidence. Unassessed behavior and outcomes remain outside this report.</p></div>
    ${journeyBridge}
    <div class="conversion-journey-limitation"><strong>What we could not determine</strong><p>This assessment does not measure completed enquiries, CTA click-through rate, form completion rate, abandonment, scroll depth, or behavior on unassessed pages.</p></div>
  </section>`;
}

function conversionPathSection(model) {
  const canonical = canonicalSolutionContext(model);
  const paths = Array.isArray(model.conversionPaths) ? model.conversionPaths : [];
  const trustBand = model.bands?.trust;
  const limitation = "We can see whether the website gives people a clear path toward action. We cannot tell from this audit how many people clicked a button, completed a form, left a page, or stopped partway through the journey. Those questions need website analytics or other behavior data.";
  if (paths.length === 0) {
    return `<section id="paths" class="card">
      <p class="muted small">Conversion Journey</p>
      <h2>Can visitors move from interest to action?</h2>
      <p class="conversion-journey-verdict">We do not have enough evidence to confirm the full path from interest to action.</p>
      <div class="conversion-journey-limitation"><strong>What we could not determine</strong><p>${e(limitation)}</p></div>
    </section>`;
  }

  const clearCount = paths.filter((path) => path.status === "Clear").length;
  const weakCount = paths.filter((path) => path.status === "Weak").length;
  const pathState = clearCount === paths.length ? "clear" : weakCount > 0 ? "weak" : "limited";
  const findingIds = new Set((model.findings || []).map((finding) => finding.ruleId || finding.id));
  const solutionForRule = (ruleId) => {
    const finding = (model.findings || []).find((item) => (item.ruleId || item.id) === ruleId);
    return finding ? canonical.byFindingId.get(finding.findingId) : null;
  };
  const verdict = pathState === "clear"
    ? "The main path is clear. Visitors can reach the important pages, see a next step, and move toward contacting the business. The biggest opportunities are making the experience faster and answering more questions before people are ready to act."
    : pathState === "weak"
      ? "The path is visible, but some issues may slow visitors before they are ready to act."
      : "The available evidence does not show enough of the journey to confirm a clear route.";
  const journeySteps = [0, 1, 2].map((index) => clientJourneyStep(pathState, index));
  const journeyVisual = `<div class="conversion-journey-visual" role="img" aria-label="Three-step conversion journey">
    <div class="conversion-journey-steps">${journeySteps.map(([title, description], index) => `<div class="conversion-journey-step">
      <span class="conversion-journey-step-number">${index + 1}</span>
      <h3>${e(title)}</h3>
      <p>${e(description)}</p>
    </div>`).join("")}</div>
  </div>`;

  const workingCopy = pathState === "clear"
    ? "Visitors can reach the important pages and find a visible next step. We did not find a major problem blocking that path."
    : pathState === "weak"
      ? "The path is visible, but the issues below may make it harder for visitors to keep moving toward action."
      : "Only part of the journey is shown by the evidence reviewed, so this conclusion is limited.";
  const momentumCards = [];
  if (findingIds.has("VAN-PERF-001")) {
    const issue = clientJourneyIssue("performance", solutionForRule("VAN-PERF-001"));
    if (issue) momentumCards.push(issue);
  }
  if (findingIds.has("VAN-CONTENT-002")) {
    const issue = clientJourneyIssue("buyer-questions", solutionForRule("VAN-CONTENT-002"));
    if (issue) momentumCards.push(issue);
  }
  const momentumSection = momentumCards.length
    ? `<h3>Where visitors may lose momentum</h3><div class="conversion-journey-card-grid">${momentumCards.map((card) => `<article class="conversion-journey-detail-card">
      <h4>${e(card.title)}</h4>
      <p>${e(card.meaning)}</p>
      <p><strong>What to do next:</strong> ${e(card.next)}</p>
      <p>${card.reference}</p>
    </article>`).join("")}</div>`
    : "";
  const solutions = new Map([
    ["VAN-PERF-001", solutionForRule("VAN-PERF-001")],
    ["VAN-CONTENT-002", solutionForRule("VAN-CONTENT-002")],
  ]);
  const bridgeCards = clientJourneySupport({ findingIds, trustBand, solutions });
  const journeyBridge = bridgeCards.length
    ? `<h3>What helps this journey?</h3><div class="conversion-journey-bridge-grid">${bridgeCards.map((card) => `<article class="conversion-journey-bridge-card">
      <h4>${e(card.title)}</h4>
      <p>${e(card.meaning)}</p>
      <a class="conversion-journey-bridge-link" href="${e(card.target)}"${card.solution ? ` data-solution-id="${e(card.solution.solutionId)}"` : ""}>${e(card.cta)}</a>
    </article>`).join("")}</div>`
    : "";

  return `<section id="paths" class="card">
    <p class="muted small">Conversion Journey</p>
    <h2>Can visitors move from interest to action?</h2>
    <p class="conversion-journey-verdict">${e(verdict)}</p>
    <h3>How the journey works</h3>
    ${journeyVisual}
    <h3>Where the journey is strong</h3>
    <div class="conversion-journey-strength"><p>${e(workingCopy)}</p></div>
    ${momentumSection}
    <h3>What this means for conversion</h3>
    <div class="conversion-journey-takeaway"><p>${e(clientJourneyTakeaway(pathState))}</p></div>
    ${journeyBridge}
    <div class="conversion-journey-limitation"><strong>What we could not determine</strong><p>${e(limitation)}</p></div>
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
              <td class="small">${e(gap.limitationStatement || "Qualified comparison retained as evidence context; no standalone client remedy was created.")}</td>
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

function competitorSectionClientLegacy(model) {
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
    <p class="small">${e(gaps.length ? "Qualified comparative differences are retained as evidence context. No client remedy is inferred from competitor observations." : "No qualified comparative gap was established, and no client remedy is inferred from competitor context.")}</p>
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
    ${gaps.length ? `<div class="table-wrap"><table><thead><tr><th>Competitor behavior</th><th>Your current coverage</th><th>Why it matters</th><th>PRYSM judgment</th></tr></thead><tbody>${gaps.slice(0, 10).map((gap) => `<tr><td class="small">${e((gap.observedCompetitorCoverage || []).join(", ") || gap.competitorDomain || gap.competitorPage || "Observed competitor coverage")}</td><td class="small">${e(gap.clientCoverage || "Not Assessed")}</td><td class="small">${e(gap.conversionRelevance || "Material relevance was established by the qualification gate.")}</td><td class="small">${e(gap.limitationStatement || "Qualified comparison retained as evidence context; no standalone client remedy was created.")}</td></tr>`).join("")}</tbody></table></div>` : "<p>No competitor gap passed the qualification threshold required to appear as a material comparative finding.</p>"}
    ${qualifiedCandidates.length || excludedCandidates.length ? `<p class="muted small">${e(qualifiedCandidates.length)} qualified candidate(s) · ${e(excludedCandidates.length)} excluded candidate(s).</p>` : ""}
    <h3>Evidence limitations</h3>
    ${limitations.length ? `<ul class="small">${limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : `<p class="small">This comparison covers observable conversion-readiness signals only. It does not claim traffic, rankings, backlinks, market share, domain authority, or causal ranking advantage.</p>`}
  </section>`;
}

function competitorSectionClientBasic(model) {
  const comparisons = model.competitors?.comparisons || [];
  const assessed = comparisons.filter((comparison) => comparison?.status === SOURCE_STATUS.AVAILABLE);
  const opportunityData = model.competitors?.opportunities || {};
  const gaps = opportunityData.gaps || [];
  const limitations = opportunityData.limitations || [];
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
      <p class="small">Use the site's own evidence for decisions; this comparison does not establish a competitive disadvantage.</p>
      ${limitations.length ? `<p class="small"><strong>What this comparison cannot tell us:</strong> ${e(limitations.join(" "))}</p>` : ""}
    </section>
    <section id="competitor-detail" class="card">
      <p class="muted small">Supporting Detail</p>
      <h2>Competitive context</h2>
      <p class="small">${e(unavailableExplanation)}</p>
    </section>`;
  }

  const sourceRows = assessed.map((comparison) => `<tr><td class="small">${e(comparison.name || comparison.url || "")}</td><td class="small">${e(comparison.url || "")}</td><td class="small">We were able to review visible website signals such as offer clarity, trust, and next-step presentation.</td></tr>`).join("");
  const businessName = model.input?.businessName || model.businessName || "your website";
  const businessSubject = businessName === "your website" ? "Your website" : businessName;
  const competitorNames = assessed.map((comparison) => comparison.name || comparison.url || "the named competitor");
  const competitorLabel = competitorNames.length === 1 ? competitorNames[0] : competitorNames.length === 2 ? `${competitorNames[0]} and ${competitorNames[1]}` : `${competitorNames.slice(0, -1).join(", ")}, and ${competitorNames[competitorNames.length - 1]}`;
  const comparisonAreas = [
    ["offerClarity", "Offer clarity", "How clearly the website explains what the business does and who it is for."],
    ["trustProof", "Trust", "How the website helps a visitor feel confident in the business."],
    ["ctaClarity", "Next step", "How easy it is to understand what to do next."],
    ["pathClarity", "Decision support", "How well the site helps buyers answer questions before taking action."],
  ].filter(([key]) => assessed.some((comparison) => Object.prototype.hasOwnProperty.call(comparison, key))).map(([, label, meaning]) => [label, meaning]);
  const areaList = comparisonAreas.map(([label, meaning]) => `<li><strong>${e(label)}:</strong> ${e(meaning)}</li>`).join("");
  const directAnswer = gaps.length
    ? `We found a meaningful difference in ${gaps.length} area${gaps.length === 1 ? "" : "s"} within the named comparison set. This does not show that one business is better in every way.`
    : `We did not find a strong enough difference to say ${businessName} is clearly behind ${competitorNames.length === 2 ? "either competitor" : "the named competitors"} in the areas reviewed.`;
  const comparisonSummary = gaps.length
    ? "The competitors use different ways to explain their services, build trust, and guide visitors toward action. The specific differences found are shown below."
    : `The competitors use different ways to explain their services, build trust, and guide visitors toward action. We did not find a large enough difference in the areas reviewed to say that ${businessName} has a clear competitive weakness.`;
  const gapList = gaps.length
    ? gaps.slice(0, 10).map((gap) => {
      const heading = (gap.observedCompetitorCoverage || []).join(", ") || gap.competitorDomain || gap.competitorPage || "A difference in the reviewed experience";
      return `<article class="competitor-gap"><h4>${e(heading)}</h4><p><strong>What we found:</strong> ${e(gap.conversionRelevance || "The reviewed competitor showed a different visible experience in this area.")}</p><p><strong>What to review:</strong> Compare this area with the related pages and findings elsewhere in the report.</p></article>`;
    }).join("")
    : "<p>We did not find a difference strong enough to call out as a clear competitive disadvantage.</p>";
  const opening = `We compared ${businessName} with ${competitorLabel} using the website signals available in this audit. We looked at things buyers can see and use, such as how clearly the offer is explained, how trust is built, and how easy it is to find the next step.`;
  const clientTakeaway = gaps.length
    ? "The named competitor difference is a useful point to review, but it does not mean the competitor leads in every area. Use the related findings and Priority Fixes to decide what deserves attention."
    : `${businessSubject} does not appear clearly behind ${competitorNames.length === 2 ? "these two competitors" : "the named competitors"} in the conversion signals we reviewed. That does not mean the websites are equal in every way, and it does not mean ${businessName} leads the market. The useful takeaway is that the biggest opportunities are the specific issues already identified in Priority Fixes, rather than trying to copy competitors simply because they are competitors.`;

  return `<section id="competitors" class="card">
    <p class="muted small">Competitor Comparison</p>
    <h2>How does your website compare with the competitors buyers are likely to consider?</h2>
    <p class="small">${e(opening)}</p>
    <p class="competitor-verdict">${e(directAnswer)}</p>
    <h3>Who was compared</h3>
    <div class="table-wrap"><table><thead><tr><th>Competitor</th><th>URL</th><th>What we could review</th></tr></thead><tbody>${sourceRows}</tbody></table></div>
    <p class="muted small">Only the named competitors reviewed for this audit are shown. This comparison does not support a market-wide conclusion.</p>
    <h3>What we compared</h3>
    <ul class="small">${areaList}</ul>
    <h3>What the comparison shows</h3>
    <p class="small">${e(comparisonSummary)}</p>
    <p class="small">${e(gaps.length ? "The useful next step is to review the specific difference below alongside the related findings in this report." : "That is useful because it means the priority is not to copy a competitor or rebuild the site just to match them. The better approach is to improve the specific issues already identified elsewhere in this report.")}</p>
    <h3>Where meaningful differences were found</h3>
    ${gaps.length ? `<div>${gapList}</div>` : gapList}
    <h3>What this means for the client</h3>
    <p class="small">${e(clientTakeaway)}</p>
    <p class="small"><a href="#priority-fixes">See Priority Fixes</a></p>
    <h3>What this comparison cannot tell us</h3>
    <p class="small">This comparison covers only the named competitors and the website signals we could review. It does not tell us who gets more traffic, ranks higher in search, has more backlinks, has greater market share, or produces better business results. Those questions need other data.</p>
  </section>
  <section id="competitor-detail" class="card" data-supporting-section="competitive-trust-evidence">
    <p class="muted small">Supporting Detail</p>
    <h2>Competitive context</h2>
    <p class="small">${e(directAnswer)}</p>
    <h3>What we compared</h3>
    <ul class="small">${areaList}</ul>
    <h3>What this comparison cannot tell us</h3>
    <p class="small">This comparison covers only the named competitors and the website signals we could review. It does not tell us who gets more traffic, ranks higher in search, has more backlinks, has greater market share, or produces better business results. Those questions need other data.</p>
  </section>`;
}

function competitorSectionClient(model) {
  const comparisons = model.competitors?.comparisons || [];
  const assessed = comparisons.filter((comparison) => comparison?.status === SOURCE_STATUS.AVAILABLE);
  const opportunityData = model.competitors?.opportunities || {};
  const gaps = opportunityData.gaps || [];
  const limitations = opportunityData.limitations || [];
  const sourceStatus = model.sourceStatus?.competitors || SOURCE_STATUS.NOT_APPLICABLE;
  const businessName = model.input?.businessName || model.businessName || "your website";
  const businessSubject = businessName === "your website" ? "Your website" : businessName;
  const unavailableExplanation = {
    [SOURCE_STATUS.FAILED]: "The competitor review could not be completed, so no clear difference can be concluded.",
    [SOURCE_STATUS.NOT_CONNECTED]: "Competitor data was not connected, so no clear difference can be concluded.",
    [SOURCE_STATUS.BLOCKED]: "Competitor data could not be reviewed, so no clear difference can be concluded.",
    [SOURCE_STATUS.PARTIAL]: "Only part of the competitor review was available, so no clear difference can be concluded.",
    [SOURCE_STATUS.NOT_APPLICABLE]: "A competitor review was not part of this audit, so no clear difference can be concluded.",
  }[sourceStatus] || "No usable competitor comparison was available, so no clear difference can be concluded.";
  const dimensionDefinitions = [
    ["offerClarity", "Offer clarity", "How clearly the website explains what the business does and who it is for.", "This helps buyers understand whether the service may fit their needs."],
    ["trustProof", "Trust and proof", "How the website helps a visitor feel confident in the business.", "This may reduce doubt before someone decides what to do next."],
    ["contentDepth", "Service depth", "How much useful detail the website gives about the service.", "This can help buyers decide whether they have enough information to continue."],
    ["ctaClarity", "Next-step clarity", "How easy it is to understand what to do next.", "A clear next step can make the route forward easier to follow."],
    ["pathClarity", "Conversion path", "How clearly the website guides someone toward action.", "A clear route may help buyers move from interest to a decision."],
  ];
  const availableDimensions = dimensionDefinitions.filter(([key]) => assessed.some((comparison) => Object.prototype.hasOwnProperty.call(comparison, key)));
  const interpretation = (() => {
    try { return interpretationFor(model); } catch { return { constructs: {} }; }
  })();
  const site = model.evidence?.site || {};
  const ownValues = {
    offerClarity: interpretation.constructs?.offerClarity,
    trustProof: interpretation.constructs?.trustProof,
    contentDepth: site.pageCount ? `${site.pageCount} page(s) reviewed` : undefined,
    ctaClarity: interpretation.constructs?.ctaClarity,
    pathClarity: interpretation.constructs?.conversionPathClarity,
  };
  const valueText = (value) => {
    const text = String(value ?? "").trim();
    if (!text || /^not assessed|^no .* observed|^unavailable|^unknown/i.test(text)) return "Not enough evidence";
    if (/^(strong|moderate|limited)$/i.test(text)) return `${text} visible signal`;
    return text;
  };
  const normalizedLevel = (value) => {
    const text = String(value ?? "").trim().toLowerCase();
    return ["limited", "moderate", "strong"].includes(text) ? text : null;
  };
  const levelRank = { limited: 1, moderate: 2, strong: 3 };
  const clientCompetitorDisplayName = (comparison) => {
    const supplied = String(comparison.name || "").trim();
    const url = String(comparison.url || "").toLowerCase();
    if (/redrhino|red-rhino\.com/.test(`${supplied.toLowerCase()} ${url}`)) return "RedRhino";
    if (/zoo media|zoomedia\.ca/.test(`${supplied.toLowerCase()} ${url}`)) return "ZOO Media Group";
    if (supplied && supplied.length <= 42) return supplied;
    try { return new URL(comparison.url).hostname.replace(/^www\./i, ""); } catch { return supplied || "Named competitor"; }
  };
  const competitorNames = assessed.map(clientCompetitorDisplayName);
  const competitorLabel = competitorNames.length === 1
    ? competitorNames[0]
    : competitorNames.length === 2
      ? `${competitorNames[0]} and ${competitorNames[1]}`
      : `${competitorNames.slice(0, -1).join(", ")}, and ${competitorNames[competitorNames.length - 1]}`;
  const sourceRows = assessed.map((comparison) => `<tr><td class="small">${e(clientCompetitorDisplayName(comparison))}</td><td class="small">${e(comparison.url || "")}</td><td class="small">We could review how the site explains its offer, builds trust, and guides people toward a next step.</td></tr>`).join("");
  const linkFor = (key) => {
    if (["trustProof"].includes(key)) return '<a href="#eeat">See Trust &amp; Credibility</a>';
    if (["offerClarity", "contentDepth", "pathClarity"].includes(key)) return '<a href="#content-ideas">See Content Opportunities</a>';
    return '<a href="#priority-fixes">See Priority Fixes</a>';
  };
  const rows = availableDimensions.map(([key, label, meaning]) => {
    const competitorCells = assessed.map((comparison) => `<td>${e(valueText(comparison[key]))}</td>`).join("");
    return `<tr><th scope="row">${e(label)}</th><td>${e(valueText(ownValues[key]))}</td>${competitorCells}<td class="small">${e(meaning)}</td></tr>`;
  }).join("");
  const differences = availableDimensions.filter(([key]) => {
    const values = assessed.map((comparison) => normalizedLevel(comparison[key])).filter(Boolean);
    return new Set(values).size > 1;
  }).slice(0, 5);
  const parity = availableDimensions.filter(([key]) => {
    const values = assessed.map((comparison) => normalizedLevel(comparison[key])).filter(Boolean);
    return values.length === assessed.length && values.length > 1 && new Set(values).size === 1;
  }).slice(0, 5);
  const relativeStrengths = availableDimensions.flatMap(([key, label]) => {
    const ownLevel = normalizedLevel(ownValues[key]);
    if (!ownLevel) return [];
    const levels = assessed.map((comparison) => normalizedLevel(comparison[key])).filter(Boolean);
    if (!levels.length || !levels.every((level) => levelRank[ownLevel] >= levelRank[level])) return [];
    return [{ key, label, state: levels.every((level) => levelRank[ownLevel] === levelRank[level]) ? "Similar" : "Stronger" }];
  }).slice(0, 5);
  const competitorAdvantages = availableDimensions.flatMap(([key, label]) => {
    const ownLevel = normalizedLevel(ownValues[key]);
    if (!ownLevel) return [];
    return assessed.filter((comparison) => {
      const level = normalizedLevel(comparison[key]);
      return level && levelRank[level] > levelRank[ownLevel];
    }).map((comparison) => ({ key, label, name: clientCompetitorDisplayName(comparison) }));
  }).slice(0, 5);
  const intro = `We compared ${businessName} with ${competitorLabel} using buyer-facing website signals available in this audit. We looked at how clearly each site explains its offer, builds trust, gives useful detail, and guides people toward action.`;
  const overall = gaps.length
    ? `The comparison shows a meaningful difference in ${gaps.length} area${gaps.length === 1 ? "" : "s"} within this named set. That does not make one site better in every way.`
    : `We did not find a strong enough overall difference to say ${businessName} is clearly behind ${competitorNames.length === 2 ? "either competitor" : "the named competitors"} in the areas reviewed.`;
  const safeGapArea = (gap) => (gap.observedCompetitorCoverage || []).join(", ") || gap.competitorDomain || gap.competitorPage || "A buyer-facing area";
  const gapDifferences = gaps.slice(0, 5).map((gap) => {
    const area = safeGapArea(gap);
    return `<article class="competitor-interpretation"><h4>${e(area)}</h4><h5>What we saw</h5><p>The comparison records a meaningful difference in this buyer-facing area within the named set.</p><h5>Why a buyer may care</h5><p>This may change how easily a buyer can understand the offer, feel reassured, or decide what to do next. The comparison alone does not show the full business effect.</p><h5>What to do with this</h5><p>Review the related pages and findings before deciding whether this deserves action. <a href="#priority-fixes">See Priority Fixes</a></p></article>`;
  }).join("");
  const importantDifferences = differences.length || gaps.length
    ? `${differences.map(([key, label, meaning]) => {
      const observations = assessed.map((comparison, index) => `${competitorNames[index]}: ${valueText(comparison[key])}`).join("; ");
      const verb = label === "Trust and proof" ? "are" : "is";
      const action = key === "trustProof"
        ? "Do not copy a competitor's design. Review what makes the stronger proof easier to see or understand, then compare that with the trust evidence already identified for your own site. Strengthen only the parts that make sense for your business."
        : "Use this as a review point, not a reason to copy surface design.";
      return `<article class="competitor-interpretation"><h4>${e(label)} ${verb} not the same across the named sites</h4><h5>What we saw</h5><p>${e(`The reviewed sites show different visible signals for ${label.toLowerCase()}. ${observations}.`)}</p><h5>Why a buyer may care</h5><p>${e(meaning)} Buyers may need different amounts of explanation or reassurance before they feel ready to continue.</p><h5>What to do with this</h5><p>${e(action)} ${linkFor(key)}.</p></article>`;
    }).join("")}${gapDifferences}`
    : "<p>We did not find enough evidence to explain a clear competitor difference in the supported areas.</p>";
  const trustLevels = normalizedLevel(ownValues.trustProof) ? [normalizedLevel(ownValues.trustProof), ...assessed.map((comparison) => normalizedLevel(comparison.trustProof))] : [];
  const trustPositionSupported = trustLevels.length === assessed.length + 1 && normalizedLevel(ownValues.trustProof) === "moderate" && trustLevels.includes("limited") && trustLevels.includes("strong");
  const holdingOwn = trustPositionSupported
    ? "<p>The current data does not support a broad claim that your site is stronger than the named competitors. The clearest supported comparison is trust and proof, where your site sits between the two competitors reviewed.</p>"
    : relativeStrengths.length
    ? `<ul>${relativeStrengths.map(({ label, state }) => `<li><strong>${e(label)} — ${e(state)}:</strong> The available values do not show a reason to change this area just to match a competitor.</li>`).join("")}</ul>`
    : "<p>We did not find enough evidence to claim a clear advantage for your website relative to the named competitors.</p>";
  const betterExperience = competitorAdvantages.length
    ? `<ul>${competitorAdvantages.map(({ label, name, key }) => `<li><strong>${e(name)} — ${e(label)}:</strong> ${key === "trustProof" ? e("The site shows a stronger visible trust signal in the available comparison. Review how quickly a visitor can find proof, examples, or reassurance there, then compare that with your own Trust & Credibility findings.") : e("The available values show a stronger visible signal in this area. Review the buyer need behind the difference before deciding whether it matters here.")} ${linkFor(key)}</li>`).join("")}</ul>`
    : `<p>We did not find a competitor advantage strong enough to justify changing the site simply to match them. ${gaps.length ? "Review the named difference above before deciding whether it deserves action." : "The available comparison does not prove that a competitor creates a better buying experience overall."}</p>`;
  const standApart = "<p>The comparison does not show a clear market-wide gap, and several areas do not have enough client evidence for a fair side-by-side judgment.</p><p>That still leaves a useful strategic question: where can your site be more helpful to a buyer?</p><p>Use the opportunities already identified in this report—clearer buyer answers, stronger proof, better process information, or an easier next step—to make the buying experience more useful instead of simply matching a competitor. <a href=\"#content-ideas\">See Content Opportunities</a>.</p>";
  const actionItems = gaps.length
    ? `<ol><li><strong>IMPROVE:</strong> Review the supported competitor difference and decide whether it affects an important buyer question. ${linkFor("pathClarity")}</li><li><strong>PROTECT:</strong> Keep the parts of the current buying path that the audit already supports until stronger evidence says they should change. <a href="#paths">See Conversion Journey</a></li><li><strong>DIFFERENTIATE:</strong> Use the content plan to make the client's explanation, proof, or process more useful instead of copying surface design. <a href="#content-ideas">See Content Opportunities</a></li></ol>`
    : `<ol><li><strong>PROTECT:</strong> Keep the parts of the current buying path that the audit already supports. <a href="#paths">See Conversion Journey</a></li><li><strong>IMPROVE:</strong> Address the client's own highest-priority issues instead of rebuilding the site to match a competitor. <a href="#priority-fixes">See Priority Fixes</a></li><li><strong>DIFFERENTIATE:</strong> Make buyer questions, proof, process, or next steps more useful where the report already shows an opportunity. <a href="#content-ideas">See Content Opportunities</a></li><li><strong>IGNORE:</strong> Do not chase differences that were not strong enough to establish a clear disadvantage.</li></ol>`;

  if (!assessed.length) {
    return `<section id="competitors" class="card"><p class="muted small">Competitor Comparison</p><h2>How does your website compare with the competitors buyers may consider?</h2><h3>Competitive position</h3><p>${e(unavailableExplanation)}</p><h3>Who was compared</h3><p class="small">No named competitor could be included from the available comparison data.</p><h3>Side-by-side buyer experience benchmark</h3><p>Not enough evidence.</p><h3>Where your website is holding its own</h3><p>We did not find enough evidence to claim a clear advantage.</p><h3>Where competitors create a better buying experience</h3><p>Not enough evidence.</p><h3>Where there may be room to stand apart</h3><p>Not enough evidence.</p><h3>What this comparison cannot tell us</h3><p>This comparison could not be completed from the available named competitor evidence.</p></section>`;
  }

  return `<section id="competitors" class="card">
    <p class="muted small">Competitor Comparison</p>
    <h2>How does your website compare with the competitors buyers may consider?</h2>
    <h3>Competitive position</h3>
    <p>${e(intro)}</p>
    <p>${e(overall)}</p>
    <p>That does not mean the websites are the same. The useful question is where each site makes the buying experience clearer, easier, or more reassuring.</p>
    <h3>Who was compared</h3>
    <div class="table-wrap"><table><thead><tr><th>Competitor</th><th>URL</th><th>What we could review</th></tr></thead><tbody>${sourceRows}</tbody></table></div>
    <p class="muted small">Only the named competitors reviewed for this audit are shown. This comparison does not support a market-wide conclusion.</p>
    <h3>Side-by-side buyer experience benchmark</h3>
    <div class="table-wrap"><table><thead><tr><th>Area</th><th>Your website</th>${competitorNames.map((name) => `<th>${e(name)}</th>`).join("")}<th>What this means</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small">The table uses descriptions from the available comparison records. It does not assign scores or a market rank.</p>
    <p class="small"><strong>Not enough evidence</strong> does not mean the site performed poorly. It means we do not have enough comparable information to make a fair judgment in that area.</p>
    <h3>Important differences</h3>
    ${importantDifferences}
    <h3>Where your website is holding its own</h3>
    ${holdingOwn}
    <h3>Where competitors create a better buying experience</h3>
    ${betterExperience}
    <h3>Where there may be room to stand apart</h3>
    ${standApart}
    <h3>What should you do because of this comparison?</h3>
    ${actionItems}
    <h3>What not to copy</h3>
    <p>Do not change something simply because a competitor does it differently. Competitor presence is context, not proof. Copy useful buyer-experience principles, not surface design, and prioritize changes supported by your own evidence.</p>
    <h3>What this comparison cannot tell us</h3>
    <p>This comparison covers only the named competitors and the observable website evidence available. It does not establish traffic, search rankings, backlinks, market share, revenue, conversion rate, or business performance unless another authoritative source provides that data.</p>
    ${limitations.length ? `<p class="small"><strong>Review limit:</strong> ${e(limitations.join(" "))}</p>` : ""}
  </section>
  <section id="competitor-detail" class="card" data-supporting-section="competitive-trust-evidence">
    <p class="muted small">Supporting Detail</p><h2>Competitive context</h2>
    <p class="small">${e(overall)}</p>
    <p class="small">The benchmark above keeps the named competitors, available dimensions, and comparison boundaries visible without adding scores or market claims.</p>
  </section>`;
}

function meaningfulClientTopic(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length < 3) return false;

  return !/^(?:4\s*0|create|tagged by kindness inc|tbk incubates go fog it)$/i.test(text);
}

function clientContentOpportunityKind(idea) {
  const text = String(idea || "").toLowerCase();
  if (/what is .*custom website|custom website/.test(text) && !/option|fit|result|measurable|process/.test(text)) return "custom-website";
  if (/signs you may need digital marketing|digital marketing/.test(text)) return "digital-marketing-fit";
  if (/measurable|result|outcome|will this work/.test(text)) return "website-results";
  if (/compare|option|fit/.test(text)) return "website-options";
  if (/process|what happens/.test(text)) return "process";
  return "general";
}

function clientContentOpportunityTitle(idea) {
  switch (clientContentOpportunityKind(idea)) {
    case "custom-website": return "Explain what a custom website is";
    case "digital-marketing-fit": return "Help people decide whether they need digital marketing";
    case "website-results": return "Show what kind of results a custom website may support";
    case "website-options": return "Help buyers compare website options";
    case "process": return "Explain what happens during the process";
    default: return String(idea || "Content idea");
  }
}

function clientContentBuyerQuestion(idea, question) {
  if (clientContentOpportunityKind(idea) === "custom-website") return "What is this, and how is it different from a standard template website?";
  if (clientContentOpportunityKind(idea) === "digital-marketing-fit") return "Does this apply to my business?";
  if (clientContentOpportunityKind(idea) === "website-results") return "Will this actually help my business?";
  if (clientContentOpportunityKind(idea) === "website-options") return "Which option is right for me?";
  if (clientContentOpportunityKind(idea) === "process") return "What happens after I decide to move forward?";
  return String(question || "What do buyers need to know before they decide?");
}

function clientContentWhy(idea, sourceWhy) {
  const kind = clientContentOpportunityKind(idea);
  if (kind === "custom-website") return "People need to understand the service before they can decide whether it is relevant to them. A clear explanation can help visitors understand what “custom” means and whether that level of website work fits their needs.";
  if (kind === "digital-marketing-fit") return "Some visitors may understand what digital marketing is but still not know whether they need help. Showing common signs or situations can help them recognize whether the service is relevant. It gives them a clearer way to think about their own situation.";
  if (kind === "website-results") return "Before investing in a website, buyers often want to understand what improvement could look like. They may need proof, examples, or a clearer explanation of how the website supports business goals. Careful wording can build understanding without promising a result.";
  if (kind === "website-options") return "Buyers may know they need a website but still be unsure what level of service fits their situation. Clear comparison content can help them understand the trade-offs without forcing them to guess. It can also make the next conversation more focused.";
  if (kind === "process") return "Uncertainty about the process can make a service feel harder to buy. People may want to know what they need to provide, what the main steps are, and what happens after they say yes. A clear explanation can make the next step easier to understand.";
  const text = String(sourceWhy || "");
  return /supports the stated goal/i.test(text) || !text.trim()
    ? "This topic may help a buyer understand the service and decide whether it fits their needs. Before creating it, confirm the questions customers ask most often and the information the business can support."
    : text;
}

function clientContentRecommendation(idea, sourceAsset) {
  const kind = clientContentOpportunityKind(idea);
  if (kind === "custom-website") return "Create a simple service explainer or a strong section on the main website service page.";
  if (kind === "digital-marketing-fit") return "Create a practical guide, page section, or checklist explaining situations where digital marketing support may help.";
  if (kind === "website-results") return "Create content that explains the kinds of business outcomes a better website may support.";
  if (kind === "website-options") return "Create comparison or fit guidance. Use the options the business actually offers or competes against.";
  if (kind === "process") return "Create a clear process section or guide using the real steps the business can confirm.";
  return sourceAsset
    ? `Create a ${String(sourceAsset).toLowerCase()} after confirming the questions and information it should cover.`
    : "Create a short guide or page section after confirming the questions buyers ask most often.";
}

function clientContentCoverage(idea) {
  switch (clientContentOpportunityKind(idea)) {
    case "custom-website":
      return ["what a custom website means", "how it differs from a basic template site", "who may benefit from one", "what business problem it is meant to solve", "when a simpler option may be enough"];
    case "digital-marketing-fit":
      return ["common business problems that may lead someone to seek help", "goals the service can support", "signs that the issue may need attention", "questions a business owner should ask before choosing support", "clear limits so the guide does not create fear or pressure"];
    case "website-results":
      return ["the business goals the website is meant to support", "examples or case studies where proof exists", "measurable changes that can be shown clearly", "what a better website may help with and what it cannot guarantee", "a reminder that results depend on the situation and implementation"];
    case "website-options":
      return ["the main website options the business actually offers or competes against", "who each option may suit", "the most important differences between them", "trade-offs a buyer should understand", "questions to ask before choosing"];
    case "process":
      return ["the main stages of the real process", "what the client needs to provide", "what the business handles", "important decision points", "what the client can expect after each confirmed step"];
    default:
      return ["the question buyers are trying to answer", "the information the business can support", "a clear example where one is available", "the next question a buyer may have"];
  }
}

function clientBuyerJourneyStage(stage) {
  const value = String(stage || "").toLowerCase();
  if (/awareness|tofu/.test(value)) return "Early in the journey, when someone is first trying to understand the service.";
  if (/consideration|evaluation|mofu/.test(value)) return "When someone understands the service and is deciding whether it fits their needs.";
  if (/comparison/.test(value)) return "When someone is comparing options or providers.";
  if (/decision|bofu/.test(value)) return "When someone is close to taking the next step and wants reassurance.";
  return "At the point in the journey where this question becomes important.";
}

function clientContentPlacement(idea, placement) {
  const kind = clientContentOpportunityKind(idea);
  if (kind === "custom-website") return "Place the explanation where visitors first learn about custom website services. Link to deeper information only when they need it.";
  if (kind === "digital-marketing-fit") return "Connect the content to the appropriate digital marketing service pages.";
  if (kind === "website-results") return "Connect proof and examples to relevant service pages and trust content.";
  if (kind === "website-options") return "Place the guidance on the main website service page or create a supporting comparison guide linked from it.";
  if (kind === "process") return "Place process guidance close to the relevant service and contact or quote path.";
  return placement
    ? `Use it in the ${String(placement).toLowerCase()} area and connect it to the related service page.`
    : "Place it near the related service explanation and link it to the next step when that location is confirmed.";
}

function clientOpportunityConfidence(status) {
  if (String(status || "").toUpperCase() === "AVAILABLE") return "Strong evidence";
  if (String(status || "").toUpperCase() === "PARTIAL") return "Some evidence — confirm before creating new content";
  return "Not enough evidence yet";
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
    if (count >= 1) return "More information could help";
    return "Limited information";
  };

  const buyerNeeds = [
    [
      "Understand the problem",
      tofu.length,
      false,
      "People can find information that helps them understand the problem or need.",
    ],
    [
      "Understand the service",
      (site.services || []).length,
      (site.services || []).length > 0,
      "Visitors can see what the business offers and begin to understand the service.",
    ],
    [
      "Evaluate fit",
      mofu.length,
      false,
      "Some content helps visitors think about whether the service fits their situation.",
    ],
    [
      "Build trust",
      model.scores?.trustEeatDimension ?? model.scores?.trust,
      (model.scores?.trustEeatDimension ?? model.scores?.trust) >= 60,
      "Trust signals can help visitors feel more confident before they contact the business.",
    ],
    [
      "Compare options",
      mofu.filter((i) =>
        /compar|option|fit/i.test(`${i.idea || ""} ${i.frame || ""}`)
      ).length,
      false,
      "More information could help visitors compare choices and understand which option fits.",
    ],
    [
      "Take action",
      (site.ctas || []).length,
      (site.ctas || []).length > 0,
      "Visitors can find a next step when they are ready to contact the business.",
    ],
  ];

  const directAnswer = "The site already has useful content in several parts of the buyer journey. The biggest opportunity is to answer more of the questions people may have before they are ready to contact the business.";

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

  const legacyClientWhyItMatters = (i) => {
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

  const legacyEvidenceLabel = (i) =>
    i.evidenceStatus === "AVAILABLE"
      ? "Supported within assessed content"
      : i.evidenceStatus === "PARTIAL"
        ? "Qualified opportunity — partial content coverage"
        : "Qualified opportunity — content evidence unavailable";

  const evidenceLabel = (i) => clientOpportunityConfidence(i.evidenceStatus);

  const renderOpportunityCards = (items, startIndex = 0, primary = false) =>
    items
      .map((i, offset) => {
        const index = startIndex + offset;
        const detail = primary ? "" : ` ${e(i.gap || "")}`;
        const title = clientContentOpportunityTitle(i.idea);
        const stage = i.funnelStage || i.stage || "";
        const coverage = clientContentCoverage(i.idea);
        return `<article class="content-opportunity-card${index === 0 ? " content-opportunity-card-start" : ""}">
          <div class="content-opportunity-card-header">
            ${primary ? `<span class="content-opportunity-rank">${index + 1}</span>` : ""}
            ${index === 0 ? '<span class="content-opportunity-start">Start here</span>' : ""}
          </div>
          <h4>${e(title)}</h4>
          <dl class="content-opportunity-fields">
            <div><dt>What buyers are asking</dt><dd>${e(clientContentBuyerQuestion(i.idea, i.question))}</dd></div>
            <div><dt>Why this matters</dt><dd>${e(clientContentWhy(i.idea, i.whyItMatters))}</dd></div>
            <div><dt>What to create</dt><dd>${e(clientContentRecommendation(i.idea, i.recommendedAsset || i.type))}</dd></div>
            <div class="content-opportunity-coverage"><dt>What it should cover</dt><dd><ul>${coverage.map((point) => `<li>${e(point)}</li>`).join("")}</ul></dd></div>
            <div><dt>Where it helps</dt><dd><strong>${e(stage || "Buyer journey")}</strong><br>${e(clientBuyerJourneyStage(stage))}</dd></div>
            <div><dt>How to use it</dt><dd>${e(clientContentPlacement(i.idea, i.placement))}</dd></div>
            ${primary ? `<div><dt>Confidence in this opportunity</dt><dd>${e(evidenceLabel(i))}</dd></div>` : `<div class="content-opportunity-uncertainty"><dt>Confidence in this opportunity</dt><dd>${e(evidenceLabel(i))}${detail}</dd></div>`}
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
        ${leading.length ? `<h4>Additional search topics</h4><div class="table-wrap"><table>
          <thead><tr><th>Query</th><th>Rationale</th><th>Priority</th></tr></thead>
          <tbody>${leading.map((q) => `<tr><td>${e(q.query || "")}</td><td class="small">${e(q.rationale || "")}</td><td>${e(q.priority || "")}</td></tr>`).join("")}</tbody>
        </table></div>` : ""}
      </details>`
    : "";

  return `
  <section id="content-ideas" class="card">
    <p class="muted small">Content Opportunities</p>
    <h2>What content would help buyers move forward?</h2>

    <p class="content-opportunities-verdict">${e(directAnswer)}</p>
    <p>The ideas below are based on the business information and website content we could review. Each opportunity explains what buyers may be asking, why the topic matters, and what useful content could include.</p>

    <h3>What is already helping buyers</h3>
    <div class="content-coverage-grid">${coverageCards}</div>

    <h3>Where more content may help</h3>
    <p class="content-opportunities-gap">The pages reviewed show useful starting points, but some buyer questions may need clearer answers. This does not mean these topics are missing everywhere on the site.</p>

    <h3>Content that could help buyers move forward</h3>
    ${opportunityCards
      ? `<div class="content-opportunity-list">${opportunityCards}</div>`
      : `<p>No content idea was generated from the information reviewed.</p>`}

    <h3>Evidence limitations</h3>
    <p class="small">These ideas come from the business information and website content we could review. Some pages were not fully assessed, so we cannot say these topics are missing everywhere on the site. Search demand or competitor activity may make an idea more useful, but neither is enough on its own to recommend creating new content. Before starting a large piece of content, confirm that the information is not already covered well somewhere else.</p>
  </section>

  <section id="content-opportunities-detail" class="card" data-supporting-section="conversion-content-evidence">
    <p class="muted small">Supporting Detail</p>
    <h2>Content Opportunity Detail</h2>
    <p class="small">Additional content ideas and supporting signals remain available here for planning.</p>
    ${supportingIdeas.length
      ? `<p class="small">${e(supportingIdeas.length)} additional content idea${supportingIdeas.length === 1 ? "" : "s"} remain available in Supporting Detail. Two representative examples are shown below; the existing order is preserved.</p>
         <div class="content-opportunity-list">${supportingPreviewCards}</div>
         ${supportingRemainderCards ? `<details class="supporting-detail-disclosure"><summary>Show remaining additional opportunities</summary><div class="content-opportunity-list">${supportingRemainderCards}</div></details>` : ""}`
      : `<p class="small">No additional content ideas were generated.</p>`}
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
    body = `<p>No qualified internal-link opportunity was identified from crawl evidence.</p>`;
  } else {
    body = `<p class="small">${e(opportunities.length)} internal-link opportunities were identified from crawl evidence. They remain supporting evidence only; no client link-change instruction is rendered here.</p>`;
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

  const orphanShown = Math.min(5, orphans.length);
  const renderOrphanRows = (rows) => rows
    .map((o) => `<tr><td class="small">${e((o.url || "").slice(0, 60))}</td><td class="small">${e(o.title || "—")}</td></tr>`)
    .join("");
  const orphanBlock = orphans.length && opp?.coverage?.crawlComplete !== false
    ? `<h3>Orphan / Weakly Linked Pages (${orphans.length})</h3>
<p class="small">${e(orphans.length)} identified · showing ${e(orphanShown)} examples.</p>
<details class="supporting-detail-disclosure"><summary>Show ${e(orphanShown)} representative orphan-page examples</summary><div class="table-wrap"><table><thead><tr><th>URL</th><th>Title</th></tr></thead><tbody>${renderOrphanRows(orphans.slice(0, 5))}</tbody></table></div>${orphans.length > orphanShown
  ? `<details class="supporting-detail-disclosure"><summary>Show all ${e(orphans.length)} governed orphan pages</summary><div class="table-wrap"><table><thead><tr><th>URL</th><th>Title</th></tr></thead><tbody>${renderOrphanRows(orphans)}</tbody></table></div></details>`
  : ""}</details>`
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
    )} observed opportunity signal(s). The opportunity data is supporting evidence, not a standalone client remedy.</p>
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

function pageShell(model, date, pillars, checklist, canonical) {
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

.content-opportunity-coverage {
  grid-column:1 / -1;
}

.content-opportunity-fields dd ul {
  margin:.15rem 0 0;
  padding-left:1.1rem;
}

.content-opportunity-fields dd li {
  margin:.2rem 0;
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
      ${executiveScorecard(model, pillars, canonical)}
      ${pillarSection(pillars)}
      ${blockersSection(model, canonical)}
      ${foundationSection(checklist)}
      ${conversionPathSection(model)}
      ${contentOpportunitiesSection(model)}
      ${actionPlanSection(canonical, checklist)}
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
  for (const id of allSectionIds) {
    const section = document.getElementById(id);
    if (section) section.classList.add("viewer-section");
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
  const canonical = canonicalSolutionContext(renderModel);

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
  return pageShell(
    renderModel,
    date,
    pillars,
    checklist,
    canonical,
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

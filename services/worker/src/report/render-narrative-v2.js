// PRYSM Narrative v2 — governed browser/PDF narrative rendering bridge.
//
// This module is additive. It does not alter the active report-v2 production
// path. It accepts the exact governed orchestration result, re-validates the
// final WriterOutput, and composes that narrative into the existing report-v2
// HTML while preserving the deterministic evidence/detail layer underneath.

import { NARRATIVE_V2_STATUS } from "../narrative-v2/orchestrator.js";
import { validateWriterOutput } from "../narrative-v2/writer-output.js";
import { renderReportV2 } from "./render-report-v2.js";

export const NARRATIVE_RENDER_VERSION = "1.0.0";

function e(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function atomHtml(atom, { tag = "p", className = "narrative-copy" } = {}) {
  const refs = Array.isArray(atom?.evidenceRefs) ? atom.evidenceRefs.join(" ") : "";
  return `<${tag} class="${e(className)}" data-statement-class="${e(atom?.statementClass || "")}" data-evidence-refs="${e(refs)}">${e(atom?.text || "")}</${tag}>`;
}

function titledAtom(label, atom) {
  return `<div class="narrative-field"><h4>${e(label)}</h4>${atomHtml(atom)}</div>`;
}

// Presentation-only mapping. These existing Writer sections remain unchanged;
// the map only tells the section viewer which governed report page displays
// each narrative card.
const NARRATIVE_VIEWER_PAGE = Object.freeze({
  "narrative-executive": "executive-scorecard",
  "narrative-strengths": "executive-scorecard",
  "narrative-root-cause": "executive-scorecard",
  "narrative-decision": "executive-scorecard",
  "narrative-action-plan": "priority-fixes",
  "narrative-conversion": "conversion-paths",
  "narrative-content": "content-ideas",
  "narrative-funnel": "content-ideas",
  "narrative-competitors": "competitor-benchmark",
  "narrative-eeat": "trust-eeat",
  "narrative-seo": "technical-seo",
  "narrative-technical": "technical-seo",
  "narrative-ai-search": "schema",
  "narrative-performance": "performance",
  "narrative-limitations": "deferred",
});

function sectionCard(id, eyebrow, headline, body) {
  const viewerPage = NARRATIVE_VIEWER_PAGE[id] || "";
  return `<section id="${e(id)}" class="card narrative-card" data-viewer-page="${e(viewerPage)}">
    <div class="narrative-eyebrow">${e(eyebrow)}</div>
    <h2>${e(headline)}</h2>
    ${body}
  </section>`;
}

const STANDARD_FIELDS = Object.freeze({
  conversion: [
    ["whatWorks", "What works"],
    ["constraints", "Constraints"],
    ["businessMeaning", "Business meaning"],
    ["priority", "Priority"],
  ],
  content: [
    ["currentStrength", "Current strength"],
    ["coverageAssessment", "Coverage assessment"],
    ["qualityAssessment", "Quality assessment"],
    ["topicalArchitecture", "Topical architecture"],
    ["importantGaps", "Important gaps"],
    ["businessMeaning", "Business meaning"],
  ],
  seoSerp: [
    ["whatWorks", "What works"],
    ["constraints", "Constraints"],
    ["searchImplication", "Search implication"],
    ["priority", "Priority"],
  ],
  aiSearch: [
    ["answerability", "Answerability"],
    ["entityStrength", "Entity strength"],
    ["citationReadiness", "Citation readiness"],
    ["constraints", "Constraints"],
    ["opportunity", "Opportunity"],
  ],
  eeatTrust: [
    ["experience", "Experience"],
    ["expertise", "Expertise"],
    ["authority", "Authority"],
    ["trust", "Trust"],
    ["proofGaps", "Proof gaps"],
    ["businessMeaning", "Business meaning"],
  ],
  technical: [
    ["assessment", "Assessment"],
    ["materialIssues", "Material issues"],
    ["businessMeaning", "Business meaning"],
  ],
  performanceUx: [
    ["assessment", "Assessment"],
    ["userImpact", "User impact"],
    ["conversionImpact", "Conversion impact"],
  ],
  competitors: [
    ["advantages", "Advantages"],
    ["disadvantages", "Disadvantages"],
    ["marketInterpretation", "Market interpretation"],
    ["differentiatorToProtect", "Differentiator to protect"],
  ],
});

function standardSection(id, eyebrow, value, fieldKey) {
  const fields = STANDARD_FIELDS[fieldKey]
    .map(([key, label]) => titledAtom(label, value[key]))
    .join("");
  return sectionCard(id, eyebrow, value.headline, `<div class="narrative-grid">${fields}</div>`);
}

function executiveConclusionSection(output) {
  return sectionCard(
    "narrative-executive",
    "Executive conclusion",
    output.executiveConclusion.headline,
    atomHtml(output.executiveConclusion.narrative, { className: "narrative-lead" }),
  );
}

function strengthsNarrativeSection(output) {
  const items = output.strengths.map((item) => `<li data-item-id="${e(item.itemId)}"><strong>${e(item.title)}</strong>${atomHtml(item.narrative)}</li>`).join("");
  return sectionCard("narrative-strengths", "What should be preserved", "Verified strengths", `<ul class="narrative-list">${items}</ul>`);
}

function rootCauseNarrativeSection(output) {
  const consequences = output.rootCause.businessConsequences.length
    ? `<h3>Business consequences</h3><div class="narrative-grid">${output.rootCause.businessConsequences.map((item) => `<div class="narrative-field"><h4>${e(item.area)}</h4>${atomHtml(item.narrative)}</div>`).join("")}</div>`
    : "";
  return sectionCard(
    "narrative-root-cause",
    "Root cause",
    output.rootCause.headline,
    `${atomHtml(output.rootCause.narrative, { className: "narrative-lead" })}${consequences}`,
  );
}

const FUNNEL_STAGE_LABEL = Object.freeze({
  awareness: "Awareness",
  consideration: "Consideration",
  decision: "Decision",
});

function funnelNarrativeSection(output) {
  const stages = ["awareness", "consideration", "decision"].map((stage) => {
    const items = output.funnelOpportunities[stage] || [];
    const content = items.length
      ? items.map((item) => `<article class="narrative-opportunity" data-item-id="${e(item.itemId)}">
          ${titledAtom("Concept", item.concept)}
          ${titledAtom("User need", item.userNeed)}
          ${titledAtom("Rationale", item.rationale)}
          ${titledAtom("Business objective", item.businessObjective)}
          ${titledAtom("Next action", item.nextAction)}
        </article>`).join("")
      : `<p class="muted small">No governed opportunity was returned for this funnel stage.</p>`;
    return `<div class="narrative-stage"><h3>${e(FUNNEL_STAGE_LABEL[stage])}</h3>${content}</div>`;
  }).join("");
  return sectionCard("narrative-funnel", "Content funnel", "Funnel opportunities", stages);
}

function limitationsNarrativeSection(output) {
  if (output.limitations.length === 0) {
    return sectionCard("narrative-limitations", "Evidence boundaries", "Limitations", `<p>No narrative limitations were returned beyond the governed evidence states shown in the evidence layer.</p>`);
  }
  const items = output.limitations.map((item) => `<article class="narrative-limitation" data-item-id="${e(item.itemId)}">
      <h3>${e(item.area)} <span class="chip cap-neutral">${e(item.status)}</span></h3>
      ${titledAtom("Client explanation", item.clientExplanation)}
      ${titledAtom("What this means", item.whatThisMeans)}
      ${titledAtom("What this does not mean", item.whatThisDoesNotMean)}
      ${titledAtom("Impact on this report", item.impactOnReport)}
    </article>`).join("");
  return sectionCard("narrative-limitations", "Evidence boundaries", "Limitations", items);
}

function actionPlanNarrativeSection(output) {
  const rows = [...output.actionPlan]
    .sort((a, b) => a.priority - b.priority)
    .map((item) => `<tr data-action-id="${e(item.actionId)}">
      <td>${e(item.priority)}</td>
      <td><strong>${e(item.title)}</strong></td>
      <td>${atomHtml(item.action, { tag: "div" })}</td>
      <td>${atomHtml(item.whyNow, { tag: "div" })}</td>
      <td>${atomHtml(item.expectedBusinessEffect, { tag: "div" })}</td>
      <td>${e(item.effort)}</td>
      <td>${atomHtml(item.verification, { tag: "div" })}</td>
    </tr>`).join("");
  return sectionCard("narrative-action-plan", "Prioritized action", "Action plan", `<div class="table-wrap"><table class="narrative-actions">
      <thead><tr><th>#</th><th>Action</th><th>What to do</th><th>Why now</th><th>Expected effect</th><th>Effort</th><th>Verification</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`);
}

function executiveDecisionSection(output) {
  return sectionCard("narrative-decision", "Executive decision", "Preserve, change, do next", `<div class="narrative-decision-grid">
      ${titledAtom("Preserve", output.executiveDecision.preserve)}
      ${titledAtom("Change", output.executiveDecision.change)}
      ${titledAtom("Do next", output.executiveDecision.doNext)}
    </div>`);
}

export function renderWriterNarrativeLayer(writerOutput, judgeResponse) {
  return `<div id="narrative-layer" class="narrative-layer" data-writer-pass="${e(writerOutput.passNumber)}" data-judge-score="${e(judgeResponse.totalScore)}" data-judge-decision="${e(judgeResponse.decision)}" data-render-version="${e(NARRATIVE_RENDER_VERSION)}">
    ${executiveConclusionSection(writerOutput)}
    ${strengthsNarrativeSection(writerOutput)}
    ${rootCauseNarrativeSection(writerOutput)}
    ${standardSection("narrative-conversion", "Conversion", writerOutput.conversion, "conversion")}
    ${standardSection("narrative-content", "Content and topical architecture", writerOutput.content, "content")}
    ${funnelNarrativeSection(writerOutput)}
    ${standardSection("narrative-seo", "SEO and SERP", writerOutput.seoSerp, "seoSerp")}
    ${standardSection("narrative-ai-search", "AI search readiness", writerOutput.aiSearch, "aiSearch")}
    ${standardSection("narrative-eeat", "E-E-A-T and trust", writerOutput.eeatTrust, "eeatTrust")}
    ${standardSection("narrative-technical", "Technical foundations", writerOutput.technical, "technical")}
    ${standardSection("narrative-performance", "Performance and UX", writerOutput.performanceUx, "performanceUx")}
    ${standardSection("narrative-competitors", "Competitive position", writerOutput.competitors, "competitors")}
    ${limitationsNarrativeSection(writerOutput)}
    ${actionPlanNarrativeSection(writerOutput)}
    ${executiveDecisionSection(writerOutput)}
  </div>`;
}

const NARRATIVE_CSS = `
.narrative-layer { margin: 1rem 0 1.4rem; }
.narrative-card { border-left: 4px solid var(--accent); }
.narrative-eyebrow { color:var(--accent); font-family:Arial, Helvetica, sans-serif; font-size:.72rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
.narrative-lead { font-size:1.08rem; line-height:1.65; }
.narrative-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:.8rem; }
.narrative-field { padding:.65rem .75rem; border:1px solid var(--line); border-radius:6px; background:#fbfcfe; }
.narrative-field h4 { margin:.05rem 0 .3rem; font-family:Arial, Helvetica, sans-serif; font-size:.78rem; color:var(--muted); }
.narrative-copy { margin:.2rem 0; }
.narrative-list { padding-left:1.2rem; }
.narrative-list li { margin:.65rem 0; }
.narrative-stage { margin:.8rem 0 1.1rem; }
.narrative-opportunity, .narrative-limitation { border:1px solid var(--line); border-radius:6px; padding:.8rem; margin:.65rem 0; background:#fbfcfe; }
.narrative-decision-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:.8rem; }
.narrative-actions td .narrative-copy { margin:0; }
@media (max-width:720px) { .narrative-decision-grid { grid-template-columns:1fr; } }
@media print { .narrative-card, .narrative-opportunity, .narrative-limitation { page-break-inside:avoid; } }
`;

function assertGovernedRenderInput({ model, writerInput, orchestrationResult }) {
  const errors = [];
  if (!isObject(model)) errors.push("model is required");
  if (!isObject(writerInput)) errors.push("writerInput is required");
  if (!isObject(orchestrationResult)) errors.push("orchestrationResult is required");
  if (isObject(orchestrationResult) && orchestrationResult.status !== NARRATIVE_V2_STATUS.RELEASE_CANDIDATE) {
    errors.push("orchestrationResult must be RELEASE_CANDIDATE");
  }
  const output = orchestrationResult?.finalWriterOutput;
  const judge = orchestrationResult?.finalJudgeResponse;
  if (!isObject(output)) errors.push("finalWriterOutput is required");
  if (!isObject(judge)) errors.push("finalJudgeResponse is required");
  if (writerInput?.auditId && orchestrationResult?.auditId && writerInput.auditId !== orchestrationResult.auditId) {
    errors.push("writerInput auditId does not match orchestrationResult");
  }
  if (output?.auditId && writerInput?.auditId && output.auditId !== writerInput.auditId) {
    errors.push("finalWriterOutput auditId does not match writerInput");
  }
  if (output?.passNumber !== orchestrationResult?.passCount) {
    errors.push("finalWriterOutput passNumber does not match orchestrationResult.passCount");
  }
  if (judge?.passNumber !== orchestrationResult?.passCount) {
    errors.push("finalJudgeResponse passNumber does not match orchestrationResult.passCount");
  }
  if (judge?.decision !== "PASS") errors.push("finalJudgeResponse must be PASS");
  if (errors.length) throw new Error(`Narrative v2 render input rejected: ${errors.join("; ")}`);

  const validation = validateWriterOutput(output, {
    writerInput,
    expectedPassNumber: orchestrationResult.passCount,
  });
  if (!validation.valid) {
    throw new Error(`Narrative v2 WriterOutput revalidation failed: ${validation.errors.join("; ")}`);
  }
}

/**
 * Render a client-facing browser/PDF report from a governed release candidate.
 *
 * The Writer prose is visible. Evidence IDs and Judge metadata remain present
 * only as non-visible HTML data attributes for audit traceability. The existing
 * deterministic report-v2 evidence/detail sections are preserved unchanged.
 */
export function renderGovernedNarrativeReportV2({ model, writerInput, orchestrationResult, date }) {
  assertGovernedRenderInput({ model, writerInput, orchestrationResult });

  // Freeze the exact validated objects before the rendering boundary. No clone,
  // alias, or reconstruction is introduced between validation and rendering.
  Object.freeze(writerInput);
  Object.freeze(orchestrationResult.finalWriterOutput);
  Object.freeze(orchestrationResult.finalJudgeResponse);

  const baseHtml = renderReportV2(model, { date });
  const mainAnchor = '<main id="reportContent" tabindex="-1">';
  const requiredAnchors = ["</style>", mainAnchor];
  for (const anchor of requiredAnchors) {
    if (!baseHtml.includes(anchor)) throw new Error(`Narrative v2 render anchor missing: ${anchor}`);
  }

  const narrativeHtml = renderWriterNarrativeLayer(
    orchestrationResult.finalWriterOutput,
    orchestrationResult.finalJudgeResponse,
  );

  return baseHtml
    .replace("</style>", `${NARRATIVE_CSS}\n</style>`)
    .replace(mainAnchor, `${mainAnchor}\n${narrativeHtml}`);
}

export default { renderGovernedNarrativeReportV2, renderWriterNarrativeLayer };

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
import { deriveNarrativeStates } from "../report-model/narrative-state.js";
import { CANONICAL_PROBLEM_BY_ID } from "../encyclopedia/registry.js";
import { projectPriorityRemediation } from "./remediation-taxonomy.js";
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

export const REPORT_V2_VIEWER_VERSION = "2.3.1";

export const REPORT_V2_VIEWER_PAGES = Object.freeze([
  Object.freeze({ pageId: "executive-scorecard", title: "Executive Scorecard", tier: "PRIMARY", sectionIds: Object.freeze(["executive"]) }),
  Object.freeze({ pageId: "priority-fixes", title: "Priority Fixes", tier: "PRIMARY", sectionIds: Object.freeze(["blockers"]) }),
  Object.freeze({ pageId: "conversion-paths", title: "Conversion Journey", tier: "PRIMARY", sectionIds: Object.freeze(["paths"]) }),
  Object.freeze({ pageId: "content-ideas", title: "Content Opportunities", tier: "PRIMARY", sectionIds: Object.freeze(["content-ideas"]) }),
  Object.freeze({ pageId: "trust-eeat", title: "Trust & Credibility", tier: "PRIMARY", sectionIds: Object.freeze(["eeat"]) }),
  Object.freeze({ pageId: "competitor-benchmark", title: "Competitor Comparison", tier: "PRIMARY", sectionIds: Object.freeze(["competitors"]) }),
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
  const findings = (model?.findings || [])
    .filter((finding) => finding.ruleId !== "VAN-TECH-003")
    .map((finding) => ({
      ...finding,
      affectedUrls: clientFacingPageUrls(
        model,
        finding.affectedUrls,
      ),
    }));

  const suppressedFindingReasons = (model?.suppressedFindingReasons || [])
    .filter((reason) => reason.ruleId !== "VAN-TECH-003");

  const canonicalSolutions = model?.canonicalSolutions;
  const securityFindingIds = new Set(
    (model?.findings || [])
      .filter((finding) => finding.ruleId === "VAN-TECH-003")
      .map((finding) => finding.findingId),
  );
  const visibleCanonicalRecords = Array.isArray(canonicalSolutions?.records)
    ? canonicalSolutions.records.filter(
        (record) =>
          !record.findingRefs?.some((findingId) =>
            securityFindingIds.has(findingId),
          ),
      )
    : canonicalSolutions?.records;

  return {
    ...model,
    findings,
    decisionHierarchy: model?.decisionHierarchy
      ? {
          ...model.decisionHierarchy,
          orderedFindingIds: (model.decisionHierarchy.orderedFindingIds || [])
            .filter((findingId) => !securityFindingIds.has(findingId)),
          actions: (model.decisionHierarchy.actions || [])
            .filter((action) => !securityFindingIds.has(action.findingId)),
        }
      : model?.decisionHierarchy,
    suppressedFindingReasons,
    canonicalSolutions: canonicalSolutions
      ? {
          ...canonicalSolutions,
          records: visibleCanonicalRecords,
          sequence: Array.isArray(canonicalSolutions.sequence)
            ? canonicalSolutions.sequence.filter((solutionId) =>
                visibleCanonicalRecords?.some(
                  (record) => record.solutionId === solutionId,
                ),
              )
            : canonicalSolutions.sequence,
        }
      : canonicalSolutions,
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
  const encyclopediaFindingIds = model?.encyclopedia?.status === "AVAILABLE"
    ? model.encyclopedia.priorityUnits.flatMap((unit) => unit.findingIds || [])
    : [];
  const encyclopediaOrder = new Map(encyclopediaFindingIds.map((findingId, index) => [findingId, index]));
  const projectedOrder = encyclopediaFindingIds.length
    ? [...ordered].sort((left, right) => {
      const leftRank = Math.min(...(left.findingRefs || []).map((findingId) => encyclopediaOrder.has(findingId) ? encyclopediaOrder.get(findingId) : Number.POSITIVE_INFINITY));
      const rightRank = Math.min(...(right.findingRefs || []).map((findingId) => encyclopediaOrder.has(findingId) ? encyclopediaOrder.get(findingId) : Number.POSITIVE_INFINITY));
      return leftRank - rightRank;
    })
    : ordered;
  const findingsById = new Map((model?.findings || []).map((finding) => [finding.findingId, finding]));
  const hierarchyIds = (model?.decisionHierarchy?.orderedFindingIds || [])
    .filter((findingId) => findingsById.get(findingId)?.actionable !== false);
  for (const findingId of hierarchyIds) {
    if (!byFindingId.has(findingId)) {
      throw new Error(`Canonical solution missing for governed hierarchy finding: ${findingId}`);
    }
  }
  return { byId, byFindingId, ordered: projectedOrder };
}

function acceptedPriorityGroups(model, canonical) {
  const visible = (canonical?.ordered || []).filter(
    (record) => record.clientProminence?.displayAllowed,
  );
  // The Encyclopedia is the authority for client priorities. A missing or
  // unavailable projection cannot promote canonical observations by fallback.
  if (model?.encyclopedia?.status !== "AVAILABLE") return [];

  const byFindingId = new Map();
  for (const record of visible) {
    for (const findingId of record.findingRefs || []) {
      if (!byFindingId.has(findingId)) byFindingId.set(findingId, []);
      byFindingId.get(findingId).push(record);
    }
  }

  return (model.encyclopedia.priorityUnits || [])
    .map((unit) => {
      const records = [...new Set(
        (unit.findingIds || []).flatMap((findingId) => byFindingId.get(findingId) || []),
      )].sort((a, b) =>
        (a.sequenceInputs?.governedRank ?? Number.MAX_SAFE_INTEGER) -
        (b.sequenceInputs?.governedRank ?? Number.MAX_SAFE_INTEGER),
      );
      return { unit, records, primary: records[0] || null };
    })
    .filter((group) => group.primary);
}

function clientDecisionProjection(model, canonical) {
  const groups = acceptedPriorityGroups(model, canonical).map((group) => ({
    ...group,
    remediation: projectPriorityRemediation(group.unit),
  }));
  const acceptedRecords = groups.flatMap((group) => group.records);
  const acceptedIds = new Set(acceptedRecords.map((record) => record.solutionId));
  return {
    groups,
    acceptedRecords,
    acceptedUnits: groups.map((group) => group.unit).filter(Boolean),
    acceptedIds,
    acceptedFindingIds: new Set(groups.flatMap((group) => group.unit?.findingIds || []).filter(Boolean)),
    supportingRecords: (canonical?.ordered || []).filter(
      (record) => record.clientProminence?.displayAllowed && !acceptedIds.has(record.solutionId),
    ),
  };
}

function clientPriorityReason(group) {
  const primary = group?.primary;
  const unit = group?.unit;
  const location = primary ? page2Location(primary) : "the reviewed scope";
  if (unit?.type === "confirmed critical blocker") {
    return `This is first because the reviewed evidence shows a current blocker at ${location}.`;
  }
  if (unit?.type === "accepted friction cluster" && group.records.length > 1) {
    return `These ${group.records.length} related issues are grouped because they affect the same buyer decision or action in the reviewed evidence.`;
  }
  return `This is a priority because the reviewed evidence shows an important issue at ${location}.`;
}

function priorityGroupTitle(group) {
  if (!group?.primary) return "A reviewed priority needs attention.";
  if (group?.unit?.type === "accepted friction cluster" && group.records.length > 1) {
    return "Several related issues are affecting the same buyer step.";
  }
  return page2Title(group.primary);
}

function priorityGroupMeaning(group) {
  if (!group?.primary) return "The reviewed evidence supports addressing this priority.";
  if (group?.unit?.type === "accepted friction cluster" && group.records.length > 1) {
    return `The review linked ${group.records.length} evidence-backed issues at the same buyer decision or action. Treat them as one priority, not separate reasons to inflate the problem count.`;
  }
  return page2Why(group.primary);
}

function priorityRemediationMarkup(remediation) {
  if (remediation?.status !== "SUPPORTED") {
    return `<p class="remediation-unavailable">${e(remediation?.message || "Common remediation options are not yet available for this finding. Review the supporting evidence before deciding how to correct it.")}</p>`;
  }
  const options = remediation.options.map((option) => `
    <div class="common-remediation-option">
      <h4>${e(option.title)}</h4>
      <p>${e(option.detail)}</p>
    </div>`).join("");
  return `<p class="remediation-disclaimer">${e(remediation.disclaimer)}</p><div class="common-remediation-options">${options}</div>`;
}

function clientFrictionStateLabel(state) {
  const value = String(state || "NOT_ENOUGH_EVIDENCE").toUpperCase();
  if (value === "FRICTION") return "Needs attention";
  if (value === "WATCH") return "Worth checking";
  if (value === "CLEAR") return "No material friction found";
  return "Not enough evidence";
}

function clientStatusLabel(status) {
  const value = String(status || "UNKNOWN").toUpperCase();
  if (value === "AVAILABLE") return "Reviewed";
  if (value === "PARTIAL") return "Partly reviewed";
  if (value === "UNAVAILABLE") return "Not available";
  if (value === "NOT_COLLECTED") return "Not collected";
  if (value === "NOT_CONNECTED") return "Not connected";
  if (value === "NOT_APPLICABLE") return "Not applicable";
  if (value === "FAILED" || value === "BLOCKED") return "Could not be reviewed";
  return "Unknown";
}

function canonicalReference(record, label = "View canonical detail") {
  return `<a class="canonical-solution-reference" href="#priority-fixes" data-solution-id="${e(record.solutionId)}">${e(label)}</a>`;
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

function projectClientStatusText(html) {
  const protectedBlocks = [];
  const masked = html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, (block) => {
    const marker = `\uE000${protectedBlocks.length}\uE001`;
    protectedBlocks.push(block);
    return marker;
  });
  const projected = masked.replace(/>([^<]+)</g, (_match, text) => `>${text
    .replace(/\bNOT_AVAILABLE\b/g, "not available")
    .replace(/\bNOT_COLLECTED\b/g, "not collected")
    .replace(/\bNOT_CONNECTED\b/g, "not connected")
    .replace(/\bNOT_APPLICABLE\b/g, "not applicable")
    .replace(/\bUNAVAILABLE\b/g, "Not available")
    .replace(/\bAVAILABLE\b/g, "Reviewed")
    .replace(/\bPARTIAL\b/g, "Partly reviewed")
    .replace(/\bNOT ASSESSED\b/g, "Not assessed")}<`);
  return projected.replace(/\uE000(\d+)\uE001/g, (_match, index) => protectedBlocks[Number(index)]);
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

function canonicalSummary(record) {
  return `<strong>${e(record.problem)}</strong><br><span class="small">${e(record.whyItMatters)}</span><br>${e(record.whatToChange)} ${canonicalReference(record)}`;
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

function narrativeBlock(pageState) {
  return `<div class="narrative-state" data-narrative-state="${e(pageState.state)}"><p>${e(clientCopy(pageState.message))}</p><p class="small"><strong>Next step:</strong> ${e(clientCopy(pageState.boundedAction))}</p>${pageState.limitations.length ? `<p class="small"><strong>What this does not establish:</strong> ${e(clientCopy(pageState.limitations.join(" ")))}</p>` : ""}</div>`;
}

function clientCopy(value) {
  return String(value ?? "")
    .replace(/the explicitly governed change/gi, "the specified change")
    .replace(/the governed buyer decision or audit judgment/gi, "a buyer decision")
    .replace(/\bgoverned\b/gi, "reviewed")
    .replace(/\bcanonical\b/gi, "recorded");
}

function capabilityStatus(model, key) {
  const value = model?.capabilityEvidence?.capabilities?.[key]?.status;
  return typeof value === "string" ? value : "UNKNOWN";
}

function clientEncyclopediaEffect(value) {
  const raw = String(value || "No plain-language effect is available for this projection.");
  const match = raw.match(/^(.+?) may make the governed buyer decision or audit judgment harder, without proving business-outcome causation\.?$/i);
  return match
    ? `${match[1]} may make it harder for a buyer to decide what to do next; this does not establish a business outcome.`
    : clientCopy(raw);
}

function publicEvidenceAreaLabel(key) {
  return clientCapabilityLabel(key);
}

function executiveClientSummary(pageState) {
  return `<div class="narrative-state" data-narrative-state="${e(pageState.state)}"><p>${e(clientCopy(pageState.message))}</p><p class="small"><strong>Next step:</strong> ${e(clientCopy(pageState.boundedAction))}</p></div>`;
}

function evidenceLimitList(model) {
  const capabilities = model?.capabilityEvidence?.capabilities || {};
  const limits = Object.entries(capabilities)
    .filter(([, value]) => value?.status !== "AVAILABLE")
    .map(([key, value]) => ({
      label: publicEvidenceAreaLabel(key),
      status: clientEvidenceStatus(value?.status),
      notes: Array.isArray(value?.limitations) ? value.limitations.filter((note) => !/security headers?|response headers?|technical\.headers/i.test(String(note))) : [],
    }));
  if (!limits.length) return "<p>No capability limitation was recorded for the evidence represented in this report model.</p>";
  return `<ul class="evidence-limit-list">${limits.map(({ label, status, notes }) => `<li><strong>${e(label)} — ${e(status)}.</strong>${notes.length ? ` ${e(notes.join(" "))}` : " The available evidence does not establish a condition beyond this status."}</li>`).join("")}</ul>`;
}

function executiveScorecard(model, pillars, checklist, decisionProjection, pageState, narrativeStates) {
  const readiness = model.scores.conversionReadiness;
  const priorityGroups = decisionProjection.groups;
  const actions = priorityGroups.map((group) => group.primary);
  const numericScoreVisible = pageState.state !== "INSUFFICIENT_EVIDENCE" && model.showNumericScore !== false && typeof readiness === "number";
  const readinessLine = !numericScoreVisible
    ? `<div class="readiness-none">${e(pageState.state === "INSUFFICIENT_EVIDENCE" ? "Insufficient Evidence for Overall Score" : model.readinessStatus || "Overall score unavailable")}</div>`
    : `<div class="readiness">${e(readiness)}<span class="readiness-max">/100</span></div><div class="readiness-band">${bandChip(model.bands.conversionReadiness)}</div>`;
  const priorities = priorityGroups.length
    ? `<p>${e(priorityGroups.length)} accepted client ${priorityGroups.length === 1 ? "priority is" : "priorities are"} available. <a href="#priority-fixes">Priority Fixes</a> contains the authoritative actions and their order.</p>`
    : `<p>No accepted client priority is available from the current Encyclopedia projection.</p>`;
  const siteEvidenceStatus = String(model.evidence?.site?.sourceStatus || model.sourceStatus?.site || "UNKNOWN").toUpperCase();
  const strengths = (["AVAILABLE", "PARTIAL"].includes(siteEvidenceStatus) ? checklist || [] : [])
    .filter((item) => item.status === "PASS" && item.assessed === true)
    .slice(0, 5)
    .map((item) => item.detail || `${item.label} was confirmed in the assessed scope.`);
  const scoreDrivers = (pillars || []).map((pillar) => `<li><strong>${e(pillar.label)}:</strong> ${typeof pillar.score === "number" ? `${e(pillar.score)}/100` : "Not assessed"}${pillar.capabilities?.length ? ` <span class="small">Evidence: ${pillar.capabilities.map((item) => `${e(clientCapabilityLabel(item.key))} ${e(clientEvidenceStatus(item.status))}`).join("; ")}</span>` : ""}</li>`).join("");
  const holding = pageState.state === "INSUFFICIENT_EVIDENCE"
    ? "The available evidence is not sufficient to identify a dependable overall constraint. Review the evidence limits below."
    : actions.length
      ? `The reviewed priority findings are detailed in <a href="#priority-fixes">Priority Fixes</a>.`
      : "No material issue was established for this decision area in the reviewed findings.";
  const keepItems = strengths.length ? strengths.map((item) => `<li>${e(item)}</li>`).join("") : "<li>No assessed strength was available to state from the current model.</li>";
  return `
  <section id="executive" class="card primary-page-card executive-page">
    <h2>How ready is your website to convert visitors?</h2>
    <p class="muted small">Executive Scorecard</p>
    <div class="executive-readiness"><h3>Conversion Readiness</h3>${readinessLine}<p class="muted small">How effectively the site supports a visitor moving toward action.</p></div>
    ${executiveClientSummary(pageState)}
    <h3>${numericScoreVisible ? `Why is the score ${e(readiness)}?` : "Why is no score shown?"}</h3>
    <p>The score display below uses the existing assessed dimension outputs. It does not add a new score or treat unavailable dimensions as zero.</p>
    <ul class="executive-score-drivers">${scoreDrivers}</ul>
    <h3>What is already working? What is helping the site?</h3>
    ${strengths.length ? `<ul>${keepItems}</ul>` : "<p>No assessed strength was available to state from the current model.</p>"}
    <h3>What is holding the site back?</h3>
    <p>${pageState.state === "STRONG" ? "The supporting evidence does not establish a material condition requiring a corrective lead." : pageState.state === "INSUFFICIENT_EVIDENCE" ? "The available evidence does not establish one broad site-wide constraint. Any accepted item-level priorities are listed separately in Priority Fixes." : "The following items come from reviewed priority findings; they remain within their assessed scope."}</p>
    ${holding}
    <h3>Accepted priorities</h3>${priorities}
    <h3>Next step &amp; limits</h3>
    <p>${e(pageState.boundedAction)} <a href="#priority-fixes">Review Priority Fixes</a> for evidence-backed actions and <a href="#supporting-detail">Supporting Detail</a> for evidence and scope.</p>
    <h4>Important</h4>
    <p>Scores describe the assessed evidence. They do not establish conversion, revenue, or site-wide performance outcomes.</p>
    <h4>Where was the evidence limited?</h4>
    <h4>What we could not confirm</h4><p>This assessment is not whole-site complete; it reflects the reviewed pages and available evidence.</p>${evidenceLimitList(model)}
  </section>`;
}

function pillarSection(pillars, model, narrativeStates) {
  const available = (pillars || []).filter((p) => typeof p.score === "number");
  const weak = available.filter((p) => p.score < 60).sort((a, b) => a.score - b.score);
  const strong = available.filter((p) => {
    if (p.score < 60) return false;
    if (p.id !== "technical_health") return true;
    return !(p.subWeightTotal > 0 && p.subWeightAssessed < p.subWeightTotal);
  }).sort((a, b) => b.score - a.score);

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
    const technicalCoverageLimited =
      p.id === "technical_health" &&
      p.subWeightTotal > 0 &&
      p.subWeightAssessed < p.subWeightTotal;
    const scoreHtml = p.score === null
      ? `<div class="pillar-score none">Not Assessed</div>`
      : technicalCoverageLimited
        ? `<div class="pillar-score">${e(p.score)}/100 on assessed technical checks</div>`
        : `<div class="pillar-score">${e(p.score)}<span class="readiness-max">/100</span></div>`;
    const modules = p.modules
      .map((m) => `<li>${e(clientModuleLabel(m.moduleId))}: ${m.score === null ? "Not assessed" : e(m.score)} (weight ${e(m.weight)})</li>`)
      .join("");
    const caps = p.capabilities
      .map((c) => `<span class="chip ${capabilityStatusClass(c.status)}">${e(clientCapabilityLabel(c.key))}: ${e(clientEvidenceStatus(c.status))}</span>`)
      .join(" ");
    const coverageNote =
      p.id === "technical_health" &&
      p.subWeightTotal > 0 &&
      p.subWeightAssessed < p.subWeightTotal
        ? `Based on ${p.subWeightAssessed} of ${p.subWeightTotal} technical points assessed.`
        : "";
    return `
      <div class="pillar">
        <h3>${e(p.label)}</h3>
        ${scoreHtml}
        ${coverageNote ? `<p class="small">${e(coverageNote)}</p>` : ""}
        ${technicalCoverageLimited
          ? `<p class="small"><strong>Technical checks reviewed were strong, but coverage was limited.</strong></p>`
          : `<p class="small"><strong>${e(bandLabel(p.score))}</strong>${p.hasIncompleteFieldEvidence ? " · Real-user performance data was not available, so this result reflects lab measurements and is not a complete real-user readiness conclusion." : ""}</p>`}
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

  const overview = supportingOverviewSectionInner(model, pillars, narrativeStates["supporting-detail"], narrativeStates);
  return `<section id="pillars" data-supporting-section="readiness-overview">
    ${overview}
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
  return ["CONFIRMED", "SUPPORTED", "STRONG"].includes(grade) ? "Strong evidence" : grade === "PARTIAL" || grade === "CONDITIONAL" ? "Some evidence — confirm before making the change" : "Not enough evidence yet";
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

function blockersSection(model, decisionProjection, pageState) {
  const groups = decisionProjection.groups;
  const mainGroups = groups;
  const cards = groups.map((group, index) => {
    const record = group.primary;
    // Visible ranks describe this filtered client list, not pre-filter source
    // positions. Gaps can remain in the governed source sequence after
    // lower-visibility records are intentionally omitted.
    const displayRank = index + 1;
    const supporting = group.records.slice(1);
    return `<article class="priority-action" data-priority-rank="${e(displayRank)}" data-solution-id="${e(record.solutionId)}" data-priority-unit-type="${e(group.unit?.type || "legacy")}">
      <div class="priority-action-heading">
        <span class="priority-rank" aria-label="Priority ${e(displayRank)}">${e(displayRank)}</span>
        <div>
          ${index === 0 ? '<span class="priority-start">Start here</span>' : ''}
          <h3>${e(priorityGroupTitle(group))}</h3>
        </div>
      </div>
      <dl class="priority-action-fields">
        <div class="priority-field priority-field-attention"><dt>What we know</dt><dd>${e(group.records.length > 1 ? `The review linked ${group.records.length} separate evidence-backed issues at the same buyer decision or action.` : page2Found(record))}${supporting.length ? `<ul>${supporting.slice(0, 3).map((item) => `<li>${e(page2Title(item))}</li>`).join("")}</ul>` : ""}</dd></div>
        <div class="priority-field priority-field-attention"><dt>Why this is a priority</dt><dd>${e(clientPriorityReason(group))}</dd></div>
        <div class="priority-field priority-field-attention"><dt>Why it matters</dt><dd>${e(priorityGroupMeaning(group))}</dd></div>
        <div class="priority-field priority-field-attention"><dt>Three common fixes to consider</dt><dd>${priorityRemediationMarkup(group.remediation)}</dd></div>
        <div class="priority-field"><dt>Where to look</dt><dd>${e(page2Location(record))}</dd></div>
        <div class="priority-field priority-field-attention"><dt>How to know it worked</dt><dd>${e(group.records.length > 1 ? "Repeat each related verification check and confirm every included issue has improved." : page2Verify(record))}</dd></div>
        <div class="priority-field"><dt>Who may need to help</dt><dd>${e([...new Set(group.records.map((item) => page2Roles(item)))].join(" and "))}</dd></div>
        <div class="priority-field"><dt>Confidence in this finding</dt><dd>${e(group.records.every((item) => page2Confidence(item) === "Strong evidence") ? "Strong evidence" : "Some evidence — confirm before making the change")}</dd></div>
        <div class="priority-field"><dt>Effort</dt><dd>${e([...new Set(group.records.map((item) => page2Effort(item)))].join(" / "))}</dd></div>
      </dl>
    </article>`;
  }).join("");
  const mainFindingIds = new Set(mainGroups.flatMap((group) => group.records).flatMap((record) => record.findingRefs || []));
  const priorityUnits = model.encyclopedia?.status === "AVAILABLE" ? (model.encyclopedia.priorityUnits || []) : [];
  const checks = priorityUnits
    .filter((unit) => (unit.findingIds || []).some((id) => mainFindingIds.has(id)))
    .flatMap((unit) => {
      const problem = CANONICAL_PROBLEM_BY_ID[unit.canonicalProblemId];
      return (problem?.firstDiagnosticChecks || []).slice(0, 3).map((check, index) => `<li data-encyclopedia-problem="${e(unit.canonicalProblemId)}" data-diagnostic-check="${index + 1}"><strong>Check ${index + 1}:</strong> ${e(check)}</li>`);
    });
  const evidenceGuardrail = pageState.limitations.length
    ? `<ul>${pageState.limitations.map((limit) => `<li>${e(limit)}</li>`).join("")}</ul>`
    : "<p>Each action is limited to the finding evidence and scope shown on its card. A diagnostic check is not a confirmed cause.</p>";

  return `
  <section id="blockers" class="card primary-page-card action-page">
    <p class="muted small">Priority Fixes</p>
    <h2>What should you fix first?</h2>
    ${narrativeBlock(pageState)}
    <h3>Start here</h3>
    <p>${mainGroups.length ? `Start with the first item and work down the list. Each priority below explains what we found, why it matters, common options a team may consider, and how to check the result. Supporting Detail contains the deeper evidence and technical checks. Begin with ${e(priorityGroupTitle(mainGroups[0]))}. The report shows only the ${e(mainGroups.length)} accepted primary priorit${mainGroups.length === 1 ? "y" : "ies"} for this audit.` : "No primary fix is established from the available reviewed evidence. Do not add a problem to fill the page."}</p>
    <div class="priority-sequence">${cards}</div>
    <h3>Check these first</h3>
    <p class="small">These checks help investigate a condition; they do not establish its cause.</p>
    ${checks.length ? `<ul class="priority-diagnostic-checks">${checks.join("")}</ul>` : `<p>${pageState.state === "INSUFFICIENT_EVIDENCE" ? "Not enough evidence is available to prioritize diagnostic checks." : "No Encyclopedia priority unit with first diagnostic checks is linked to these primary actions."}</p>`}
    <div class="small"><strong>Evidence limits:</strong>${evidenceGuardrail}</div>
  </section>`;
}



function conversionPathSection(model, decisionProjection, pageState) {
  const paths = Array.isArray(model.conversionPaths) ? model.conversionPaths : [];
  const conversionEvidence = model.recoveredAuditData?.conversionValidation;
  const conversionEvidenceNote = conversionEvidence
    ? `<div class="conversion-journey-evidence"><strong>Browser path evidence:</strong> ${e(conversionEvidence.status)} across ${e(conversionEvidence.pageCount)} assessed page(s). ${e((conversionEvidence.screenshots || []).length)} supporting screenshots are retained with the audit evidence.</div>`
    : "";
  const trustBand = model.bands?.trust;
  const limitation = "We can see whether the website gives people a clear path toward action. We cannot tell from this audit how many people clicked a button, completed a form, left a page, or stopped partway through the journey. Those questions need website analytics or other behavior data.";
  const site = model.evidence?.site || {};
  const journeyStages = [
    { title: "Reach the right page", status: clientStatusLabel(site.sourceStatus), evidence: Array.isArray(site.pages) && site.pages.length ? `${site.pages.length} reviewed page record(s) support the site-entry context.` : "No page-level entry evidence is available in the current report model." },
    { title: "Understand enough to continue", status: `${clientStatusLabel(capabilityStatus(model, "offer.clarity"))} / ${clientStatusLabel(capabilityStatus(model, "content.body"))}`, evidence: "Offer and page-content evidence are shown here only to describe what was reviewed. They do not prove that every buyer has enough information." },
    { title: "Take the next step", status: `${clientStatusLabel(capabilityStatus(model, "conversion.cta"))} / ${clientStatusLabel(capabilityStatus(model, "conversion.form"))} / ${clientStatusLabel(capabilityStatus(model, "conversion.path"))}`, evidence: paths.length ? paths.map((path) => `${path.name || "Recorded path"}: ${path.status || "Unknown"}.`).join(" ") : "No reviewed conversion-path record is available." },
  ];
  const journeyStageCards = journeyStages.map((stage, index) => `<article class="conversion-journey-step" data-journey-stage="${index + 1}"><span class="conversion-journey-step-number">${index + 1}</span><h3>${e(stage.title)}</h3><p><strong>Status:</strong> ${e(stage.status)}</p><p><strong>Evidence seen:</strong> ${e(stage.evidence)}</p></article>`).join("");
  const encyclopediaUnits = decisionProjection.acceptedUnits;
  const journeyFrictionCards = encyclopediaUnits.filter((unit) => {
    const problem = CANONICAL_PROBLEM_BY_ID[unit.canonicalProblemId];
    if (unit.frictionState !== "FRICTION" || !problem ||
      !["Direct conversion friction", "Conversion influence"].includes(problem.primaryClassification)) return false;
    // A journey stage label alone is not a relationship. Require a validated
    // buyer decision or conversion action carried through the accepted unit.
    return Boolean(unit.conversionAction || unit.buyerDecisionQuestion);
  }).slice(0, 3).map((unit) => {
    const problem = CANONICAL_PROBLEM_BY_ID[unit.canonicalProblemId];
    const statuses = [...new Set((unit.evidence || []).map((record) => record.sourceStatus || "UNKNOWN"))];
    return `<article class="conversion-journey-detail-card" data-encyclopedia-problem="${e(unit.canonicalProblemId || "NOT_AVAILABLE")}"><h4>${e(unit.title || problem?.name || "Reviewed friction")}</h4><p><strong>Status:</strong> ${e(clientFrictionStateLabel(unit.frictionState))}</p><p><strong>Evidence:</strong> ${e(statuses.map(clientStatusLabel).join(", ") || "Unknown")}</p><p><strong>Why it may matter:</strong> ${e(clientEncyclopediaEffect(problem?.whyItMayMatter))}</p><p><strong>Check first:</strong> ${e(problem?.firstDiagnosticChecks?.[0] || "Confirm the recorded condition and scope before deciding what to change.")}</p><p class="small">This is a diagnostic view; it does not establish cause, abandonment, or a business outcome.</p></article>`;
  }).join("");
  const frictionBlock = journeyFrictionCards.length
    ? `<div class="conversion-journey-card-grid">${journeyFrictionCards}</div>`
    : `<p>${model.encyclopedia?.status === "AVAILABLE" ? "No accepted priority has a supported relationship to visitor-path friction in the reviewed evidence." : "The Encyclopedia projection is NOT_AVAILABLE; no friction conclusion is added here."}</p>`;
  const journeyVerdict = journeyFrictionCards.length
    ? "Accepted priority evidence includes a supported relationship to visitor-path friction. Priority Fixes contains the corrective action and order."
    : "The reviewed path records may include weak checks, but they are not independently accepted as visitor-friction priorities. This section presents evidence and limits only; use Priority Fixes for corrective work.";
  const journeyLimitations = pageState.limitations.length
    ? `<ul>${pageState.limitations.map((item) => `<li>${e(item)}</li>`).join("")}</ul>`
    : "<p>No additional journey limitation was recorded in the report model.</p>";
  const clearPaths = paths.filter((path) => path.status === "Clear");
  const keepMarkup = clearPaths.length
    ? `<ul>${clearPaths.map((path) => `<li><strong>${e(path.name || "Reviewed path")}:</strong> a Clear path status was recorded for this item. This describes the reviewed check, not the behavior of every visitor.</li>`).join("")}</ul>`
    : "<p>No path element is presented as a strength without a retained Clear path record.</p>";
  const analyticsStatus = model.evidence?.ga4?.sourceStatus || model.evidence?.ga4?.status || "NOT_COLLECTED";
  const measureMarkup = `<p>Analytics evidence: <strong>${e(clientStatusLabel(analyticsStatus))}</strong>. ${["AVAILABLE", "PARTIAL"].includes(String(analyticsStatus).toUpperCase()) ? "Only metrics and coverage represented in that evidence can be stated." : "Clicks, form completion, abandonment, and conversion outcomes cannot be confirmed from this audit."}</p>`;
  const priorityReference = decisionProjection.groups.length
    ? `<p>For corrective work, follow the accepted sequence in <a href="#priority-fixes">Priority Fixes</a>. This page explains the visitor-path evidence and does not set action order.</p>`
    : `<p>No accepted corrective priority is available. This page does not add work to the sequence.</p>`;
  if (paths.length === 0) {
    return `<section id="paths" class="card" data-narrative-state="${e(pageState.state)}">
      <p class="muted small">Conversion Journey</p>
      <p class="conversion-definition"><strong>Two different questions:</strong> offer clarity asks, “Do I understand what you sell and why I should care?” Conversion-path clarity asks, “Once I want to act, can I see how to proceed?”</p>
      <h2>Can visitors move from interest to action?</h2>
      <p class="conversion-journey-verdict">${e(journeyVerdict)}</p>
      <h3>How the journey works</h3><div class="conversion-journey-steps">${journeyStageCards}</div>
      <h3>Where can visitors lose momentum?</h3>${frictionBlock}
      <h3>What should you keep?</h3><p>No clear path record is available to identify a journey element to preserve.</p>
      <h3>What should you measure next?</h3>${measureMarkup}
      <h3>What cannot yet be measured?</h3><p>${e(limitation)}</p>
      <h3>Evidence and limits</h3>${journeyLimitations}${priorityReference}
      ${conversionEvidenceNote}
    </section>`;
  }

  const verdict = journeyVerdict;

  return `<section id="paths" class="card primary-page-card journey-page" data-narrative-state="${e(pageState.state)}">
    <p class="muted small">Conversion Journey</p>
    <p class="conversion-definition"><strong>Two different questions:</strong> offer clarity asks, “Do I understand what you sell and why I should care?” Conversion-path clarity asks, “Once I want to act, can I see how to proceed?”</p>
    <h2>Can visitors move from interest to action?</h2>
    <p class="conversion-journey-verdict">${e(clientCopy(verdict))}</p>
    <h3>How the journey works</h3>
    <div class="conversion-journey-visual" aria-label="Three assessed conversion journey stages"><div class="conversion-journey-steps">${journeyStageCards}</div></div>
    <h3>Where can visitors lose momentum?</h3>${frictionBlock}
    <h3>What should you keep?</h3><div class="conversion-journey-strength">${keepMarkup}</div>
    <h3>What should you measure next?</h3>${measureMarkup}
    <h3>What cannot yet be measured?</h3><p>${e(limitation)}</p>
    <h3>Evidence and limits</h3>${journeyLimitations}${priorityReference}
    ${conversionEvidenceNote}
  </section>`;
}




function competitorSectionClient(model, pageState) {
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
    contentDepth: interpretation.constructs?.contentDepth,
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
        ? "The comparison describes visible proof differences; it does not establish a missing trust signal on your site."
        : "The comparison is context for this area and does not establish a client-side defect.";
    return `<article class="competitor-interpretation"><h4>${e(label)} ${verb} not the same across the named sites</h4><h5>What we saw</h5><p>${e(`The reviewed sites show different visible signals for ${label.toLowerCase()}. ${observations}.`)}</p><h5>Why a buyer may care</h5><p>${e(meaning)} Buyers may need different amounts of explanation or reassurance before they feel ready to continue.</p><h5>How to interpret it</h5><p>${e(action)} ${linkFor(key)}. A competitor difference is context only unless separate own-site evidence establishes a priority.</p></article>`;
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
    ? `<ul>${competitorAdvantages.map(({ label, name, key }) => `<li><strong>${e(name)} — ${e(label)}:</strong> ${key === "trustProof" ? e("This comparison shows a stronger visible trust signal there; it does not establish that a trust signal is missing from your site.") : e("The available values show a stronger visible signal in this area, but do not establish a need to change your site.")} ${linkFor(key)}</li>`).join("")}</ul>`
    : `<p>We did not find a competitor advantage strong enough to justify changing the site simply to match them. ${gaps.length ? "Review the named difference above before deciding whether it deserves action." : "The available comparison does not prove that a competitor creates a better buying experience overall."}</p>`;
  const standApart = "<p>The comparison does not show a clear market-wide gap, and several areas do not have enough client evidence for a fair side-by-side judgment.</p><p>That still leaves a useful strategic question: where can your site be more helpful to a buyer?</p><p>Use the opportunities already identified in this report—clearer buyer answers, stronger proof, better process information, or an easier next step—to make the buying experience more useful instead of simply matching a competitor. <a href=\"#content-ideas\">See Content Opportunities</a>.</p>";
  const actionItems = `<p class="competitor-action-framework">Competitor differences are context only and do not create client priorities. Check any relevant own-site evidence against <a href="#priority-fixes">Priority Fixes</a>; separately recorded planning ideas remain in <a href="#content-ideas">Content Opportunities</a>.</p>`;

  if (!assessed.length) {
    return `<section id="competitors" class="card primary-page-card">
      <p class="muted small">Competitor Comparison</p><h2>How does your website compare with the competitors buyers may consider?</h2>${narrativeBlock(pageState)}
      <h3>Who was compared?</h3><p>${e(unavailableExplanation)} Named competitor scope is NOT_AVAILABLE.</p>
      <h3>Where are the meaningful differences?</h3><p>NOT_AVAILABLE — comparable evidence is insufficient.</p>
      <h3>What is worth learning from?</h3><h4>Where your website is holding its own</h4><p>NOT_AVAILABLE — no relative strength is inferred from missing comparisons.</p><h4>Where competitors show stronger signals</h4><p>NOT_AVAILABLE — no competitor advantage is inferred from missing comparisons.</p>
      <h3>What should you do because of this comparison?</h3>${actionItems}
      <h3>What not to copy</h3><h3>What should you avoid?</h3><p>Do not copy competitor behavior or infer a client defect from missing comparisons.</p>
      <h3>What this comparison cannot tell us</h3><h3>What can this comparison confirm?</h3><p>The comparison can confirm only its recorded source status and the absence of usable named comparisons. It cannot establish rankings, traffic, market share, revenue, or conversion outcomes.</p>
      <h3>Next step</h3><p>${e(pageState.boundedAction)}</p>
    </section>`;
  }

  return `<section id="competitors" class="card">
    <p class="muted small">Competitor Comparison</p>
    <h2>How does your website compare with the competitors buyers may consider?</h2>
    ${narrativeBlock(pageState)}
    <h3>Competitive position</h3>
    <p>${e(intro)}</p>
    <p>${e(overall)}</p>
    <p>That does not mean the websites are the same. The useful question is where each site makes the buying experience clearer, easier, or more reassuring.</p>
    <h3>Who was compared?</h3>
    <div class="table-wrap"><table><thead><tr><th>Competitor</th><th>URL</th><th>What we could review</th></tr></thead><tbody>${sourceRows}</tbody></table></div>
    <p class="muted small">Only the named competitors reviewed for this audit are shown. This comparison does not support a market-wide conclusion.</p>
    <h3>Side-by-side buyer experience benchmark</h3>
    <div class="table-wrap"><table><thead><tr><th>Area</th><th>Your website</th>${competitorNames.map((name) => `<th>${e(name)}</th>`).join("")}<th>What this means</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small">The table uses descriptions from the available comparison records. It does not assign scores or a market rank.</p>
    <p class="small"><strong>Not enough evidence</strong> does not mean the site performed poorly. It means we do not have enough comparable information to make a fair judgment in that area.</p>
    <h3>Where are the meaningful differences?</h3>
    <h4>Important differences</h4>
    ${importantDifferences}
    <h3>What is worth learning from?</h3>
    <h4>Where your website is holding its own</h4>${holdingOwn}
    <h4>Where competitors show stronger signals</h4>${betterExperience}
    <h4>Where there may be room to stand apart</h4>${standApart}
    <h4>Trust and proof differ across the sites</h4>${differences.some(([key]) => key === "trustProof") ? "A difference in the named comparison is descriptive context. It does not establish a client trust defect." : "NOT_AVAILABLE — the comparison does not establish a trust and proof difference."}
    <h4>Conversion-path comparison</h4>${relativeStrengths.some(({ key }) => key === "pathClarity") ? "The recorded comparable values support this bounded relative strength." : "NOT_AVAILABLE — a relative conversion-path strength is not established by comparable values."}
    <h3>What should you do because of this comparison?</h3>
    ${actionItems}
    <h3>What not to copy</h3>
    <h3>What should you avoid?</h3>
    <p>Do not change something simply because a competitor does it differently. Competitor presence is context, not proof. Copy useful buyer-experience principles, not surface design, and prioritize changes supported by your own evidence.</p>
    <h3>What this comparison cannot tell us</h3>
    <h3>What can this comparison confirm?</h3>
    <p>This comparison covers only the named competitors and the observable website evidence available. It does not establish traffic, search rankings, backlinks, market share, revenue, conversion rate, or business performance unless another authoritative source provides that data.</p>
    <h3>Next step</h3><p>${e(pageState.boundedAction)} <a href="#priority-fixes">See Priority Fixes</a> to review supported work.</p>
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
  if (/^[\d\s._-]+$/.test(text)) return false;
  if (/^(home|menu|search|login|logout|create|apply|contact)$/i.test(text)) return false;
  if (/^tagged by\b/i.test(text) || /^apply to work at\b/i.test(text)) return false;
  return true;
}

function clientContentOpportunityTitle(idea) {
  const raw = String(idea?.idea || idea?.topic || idea || "Content opportunity").trim();
  const title = raw.replace(/[?.!]+$/, "");
  const normalizeTopic = (value) => value.replace(/\bwebsites\b/gi, "website").replace(/\s+/g, " ").toLowerCase();
  const from = (pattern, build) => {
    const match = title.match(pattern);
    return match ? build(match) : null;
  };
  const withArticle = (value) => /\bwebsite$/.test(value) ? `a ${value}` : value;
  return from(/^what is (.+)$/i, (m) => `Explain what ${withArticle(normalizeTopic(m[1]))} is`)
    || from(/^signs you may need (.+)$/i, (m) => `Help people decide whether they need ${normalizeTopic(m[1])}`)
    || from(/^can (.+?) produce measurable change$/i, (m) => `Show what kind of results ${withArticle(normalizeTopic(m[1]))} may support`)
    || from(/^(.+?): options and fit$/i, (m) => `Help buyers compare ${normalizeTopic(m[1])} options`)
    || from(/^what happens in (.+)$/i, (m) => `Explain what happens during ${normalizeTopic(m[1])}`)
    || title;
}

function clientContentBuyerQuestion(idea) {
  return String(idea?.question || "NOT_AVAILABLE — no buyer question was recorded for this opportunity.");
}

function clientContentWhy(idea) {
  return String(idea?.whyItMatters || "NOT_AVAILABLE — no rationale was recorded for this opportunity.");
}

function clientContentRecommendation(idea) {
  return String(idea?.recommendedAsset || idea?.type || "NOT_AVAILABLE — the content format was not specified.");
}

function clientContentCoverage(idea) {
  const question = clientContentBuyerQuestion(idea);
  const title = clientContentOpportunityTitle(idea);
  return [
    `Address the recorded buyer question: ${question}`,
    `Explain the topic represented by this opportunity: ${title}`,
    "Use examples or proof only when the business can substantiate them.",
    "Add a next step only where the existing service and conversion path support it.",
  ];
}

function clientBuyerJourneyStage(stage) {
  if (!stage) return "NOT_AVAILABLE — no funnel stage was recorded.";
  const value = String(stage).toLowerCase();
  if (/awareness|tofu/.test(value)) return "Planning stage: help a reader understand the topic and decide whether it is relevant.";
  if (/consideration|evaluation|mofu/.test(value)) return "Planning stage: help a reader compare fit and understand available options.";
  if (/decision|bofu/.test(value)) return "Planning stage: help a reader resolve remaining questions before choosing a next step.";
  return `Planning stage recorded as ${String(stage)}; confirm its role in the buyer journey.`;
}

function clientContentPlacement(idea) {
  return idea?.placement
    ? `Suggested placement: ${String(idea.placement)}. Confirm the destination against the reviewed service and page scope.`
    : "NOT_AVAILABLE — confirm placement after reviewing the related service page.";
}

function clientOpportunityConfidence(status) {
  const value = String(status || "UNKNOWN").toUpperCase();
  if (value === "PARTIAL") return "Some evidence — confirm before creating new content.";
  if (value === "UNAVAILABLE") return "Not enough evidence to establish confidence.";
  if (value === "UNKNOWN") return "Confidence was not recorded.";
  if (value === "NOT_APPLICABLE") return "This evidence does not apply.";
  return clientStatusLabel(value);
}
function contentOpportunitiesSection(model, pageState) {
  const ideas = model.contentIdeas || {};
  const tofu = ideas.tofu || [];
  const mofu = ideas.mofu || [];
  const bofu = ideas.bofu || [];
  const leading = ideas.leading || [];
  const site = model.evidence?.site || {};
  const allIdeas = [
    ...tofu.map((i) => ({ ...i, planningStage: i.funnelStage || i.stage || "TOFU" })),
    ...mofu.map((i) => ({ ...i, planningStage: i.funnelStage || i.stage || "MOFU" })),
    ...bofu.map((i) => ({ ...i, planningStage: i.funnelStage || i.stage || "BOFU" })),
  ];

  const evidenceLabel = (i) => clientOpportunityConfidence(i.evidenceStatus);

  const renderOpportunityCards = (items, startIndex = 0, primary = false) =>
    items
      .map((i, offset) => {
        const index = startIndex + offset;
        const detail = primary ? "" : ` ${e(i.gap || "")}`;
        const title = clientContentOpportunityTitle(i);
        const stage = i.planningStage || i.funnelStage || i.stage || "";
        const coverage = clientContentCoverage(i);
        return `<article class="content-opportunity-card${index === 0 ? " content-opportunity-card-start" : ""}">
          <div class="content-opportunity-card-header">
            ${primary ? `<span class="content-opportunity-rank">${index + 1}</span>` : ""}
            ${index === 0 ? '<span class="content-opportunity-start">Start here</span>' : ""}
          </div>
          <h4>${e(title)}</h4>
          <dl class="content-opportunity-fields">
            <div><dt>What buyers are asking / Buyer question</dt><dd>${e(clientContentBuyerQuestion(i))}</dd></div>
            <div><dt>Why this matters / Why it may matter</dt><dd>${e(clientContentWhy(i))}</dd></div>
            <div><dt>What to create</dt><dd>${e(clientContentRecommendation(i))}</dd></div>
            <div class="content-opportunity-coverage"><dt>What it should cover</dt><dd><ul>${coverage.map((point) => `<li>${e(point)}</li>`).join("")}</ul></dd></div>
            <div><dt>Where it helps</dt><dd>${e(stage || "Buyer journey")} — ${e(clientBuyerJourneyStage(stage))}</dd></div>
            <div><dt>How to use it / Placement guidance</dt><dd>${e(clientContentPlacement(i))}</dd></div>
            ${primary ? `<div><dt>Confidence in this opportunity</dt><dd>${e(evidenceLabel(i))}</dd></div>` : `<div class="content-opportunity-uncertainty"><dt>Confidence in this opportunity</dt><dd>${e(evidenceLabel(i))}${detail}</dd></div>`}
          </dl>
        </article>`;
      })
      .join("");

  const priorityRank = (value) => ({ H: 0, HIGH: 0, M: 1, MEDIUM: 1, L: 2, LOW: 2 }[String(value || "").toUpperCase()] ?? 3);
  const rankedIdeas = allIdeas.map((idea, sourceOrder) => ({ ...idea, sourceOrder })).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sourceOrder - b.sourceOrder);
  const primaryIdeas = rankedIdeas.slice(0, 5);
  const supportingIdeas = rankedIdeas.slice(5);
  const strongestIdea = primaryIdeas.slice(0, 1);
  const additionalIdeas = primaryIdeas.slice(1);
  const strongestCard = renderOpportunityCards(strongestIdea, 0, true);
  const additionalCards = renderOpportunityCards(additionalIdeas, 1, true);
  const supportingPreviewCards = renderOpportunityCards(supportingIdeas.slice(0, 2), 5, false);
  const supportingRemainderCards = renderOpportunityCards(supportingIdeas.slice(2), 7, false);

  const coveredTopics = [
    ...new Set([
      ...(site.services || []),
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

  const bodyCapability = model.capabilityEvidence?.capabilities?.["content.body"];
  const coverage = bodyCapability?.coverage || {};
  const contentStrengths = `<p><strong>Content evidence status:</strong> ${e(clientEvidenceStatus(bodyCapability?.status))}${coverage.requested !== null && coverage.requested !== undefined ? ` — ${e(coverage.completed ?? "UNKNOWN")} of ${e(coverage.requested)} requested page bodies returned.` : ""}</p>${coveredTopics.length ? `<p>Observed service/topic labels in the reviewed evidence:</p><ul>${coveredTopics.map((topic) => `<li>${e(topic)}</li>`).join("")}</ul>` : `<p>NOT_AVAILABLE — no service or topic labels are available to list from the current model.</p>`}<p class="small">These observations do not establish complete site coverage or prove that unobserved content is absent.</p>`;
  const funnelPlan = [
    ["Awareness", tofu],
    ["Evaluation", mofu],
    ["Decision", bofu],
  ].map(([label, items]) => `<li><strong>${e(label)}:</strong> ${items.length ? items.map((idea) => e(clientContentOpportunityTitle(idea))).join("; ") : "NOT_AVAILABLE — no opportunity is recorded for this stage."}</li>`).join("");
  const hubTitle = strongestIdea[0] ? clientContentOpportunityTitle(strongestIdea[0]) : null;
  const hubSpokePlan = hubTitle
    ? `<p><strong>Possible hub, based on the highest-ranked recorded opportunity:</strong> ${e(hubTitle)}.</p><p><strong>Possible supporting spokes:</strong> ${additionalIdeas.length ? additionalIdeas.map((idea) => e(clientContentOpportunityTitle(idea))).join("; ") : "NOT_AVAILABLE — no additional recorded opportunity."}</p><p class="small">This is a planning relationship only; it does not describe the site's current information architecture.</p>`
    : "<p>NOT_AVAILABLE — the model contains no content opportunity from which to outline a hub-and-spoke plan.</p>";
  const additionalOpportunityMarkup = additionalCards
    ? `<div class="content-opportunity-list">${additionalCards}</div>`
    : "<p>No additional ranked content opportunity is available.</p>";

  return `
  <section id="content-ideas" class="card primary-page-card content-page" data-narrative-state="${e(pageState.state)}">
    <p class="muted small">Content Opportunities</p>
    <h2>What content would help buyers move forward?</h2>
    <p class="content-opportunities-verdict">${e(clientCopy(pageState.message))}</p>
    <p>Content opportunities are qualified planning inputs. They do not prove that a topic or answer is missing from the site.</p>

    <h3>Where is content already helping? <span class="muted small">What is already helping buyers?</span></h3>
    <div class="content-coverage-grid">${contentStrengths}</div>

    <h3>Where more content may help</h3>
    <p class="muted small">Content that could help buyers move forward is shown as a ranked planning opportunity; it is not proof of missing site content.</p>
    <h3>Start with the strongest opportunity</h3>
    ${strongestCard ? `<div class="content-opportunity-list">${strongestCard}</div>` : `<p>NOT_AVAILABLE — no content opportunity is available to rank.</p>`}

    <h3>Other useful opportunities</h3>
    ${additionalOpportunityMarkup}

    <h3>How should these ideas work together?</h3>
    <h4>Build one clear hub</h4>${hubSpokePlan}
    <h4>Connect supporting spokes</h4><p>Use links between a central topic and related guides only after the relationship and destination are confirmed for the site's actual services.</p>
    <h3>Turn one useful idea into a larger content system</h3>
    <ul class="content-funnel-architecture">${funnelPlan}</ul>
    <p class="small">Funnel architecture is planning guidance based on the recorded opportunity stages, not observed site structure.</p>

    <h3>What does good content planning look like?</h3>
    <h4>Every piece should have a job.</h4>
    <p>Plan → Create → Adapt → Distribute → Measure. Keep each step tied to a recorded buyer question, supported information, an appropriate destination, and a measurement source that is actually available.</p>
    <h3>Before you create anything</h3>
    <p>Confirm the existing page coverage and business-approved facts first. An unavailable or partial content response is not proof that the information is missing.</p>

    <h3>Evidence limitations</h3>
    <p class="small"><strong>Content evidence status:</strong> ${e(clientEvidenceStatus(bodyCapability?.status))}. Search demand and competitor content may inform planning, but cannot establish a client content failure.</p>
    <h3>Optional support</h3>
    <div class="optional-support"><strong>Omnipressence support is optional and separate from the audit findings.</strong><p>Support may include funnel planning, hub-and-spoke content development, distribution planning, and analytics review when those services are separately requested. This does not change the evidence or conclusions in this report.</p></div>
    <h3>Next step</h3><p>${e(pageState.boundedAction)}</p>
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
  ? `<details class="supporting-detail-disclosure"><summary>Show all ${e(orphans.length)} pages identified as weakly linked</summary><div class="table-wrap"><table><thead><tr><th>URL</th><th>Title</th></tr></thead><tbody>${renderOrphanRows(orphans)}</tbody></table></div></details>`
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
function clientEvidenceLabel(field) {
  const labels = {
    meta_description: "Meta description",
    h1_missing: "Missing main heading",
    h1_multiple: "Multiple main headings",
    "trust.faq": "FAQ content",
  };
  return labels[field] || "Evidence item";
}

function clientEvidenceValue(value) {
  if (value === null || value === undefined || value === "null") return "Not available";
  if (value === false) return "Not detected";
  if (value === true) return "Detected";
  return String(value);
}

function clientEvidenceStatus(status) {
  const value = String(status || "UNKNOWN").toUpperCase();
  return clientStatusLabel(value);
}

function clientCapabilityLabel(key) {
  const labels = {
    "content.body": "Page content",
    "offer.clarity": "Offer clarity",
    "trust.proof": "Trust and proof",
    "conversion.cta": "Call to action",
    "conversion.form": "Contact form",
    "conversion.path": "Conversion path",
    "technical.indexability": "Search indexing",
    "technical.redirects": "Redirects",
    "technical.resources": "Page resources",
    "schema.structured_data": "Structured data",
    "performance.lab": "Page speed checks",
    "performance.field": "Real-user performance data",
  };
  return labels[key] || String(key || "Evidence area")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clientModuleLabel(key) {
  const labels = {
    offer_clarity: "Offer clarity",
    content_depth: "Content depth",
    funnel_coverage: "Buyer-journey coverage",
    trust_signals: "Trust signals",
    risk_reduction: "Risk reduction",
    conversion_paths: "Conversion paths",
    technical_hygiene: "Technical checks",
    performance: "Page performance",
  };
  return labels[key] || String(key || "Report area")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function clientSourceLabel(key) {
  return {
    site: "Website crawl",
    performance: "Page performance",
    competitors: "Competitor review",
    backlinks: "Backlink review",
    ga4: "Website analytics",
    gsc: "Search data",
  }[key] || "Other evidence";
}

function clientFindingEvidenceSummary(confidence) {
  const value = String(confidence || "").toLowerCase();
  if (value === "supported") return "Evidence supports this finding.";
  if (value === "partial" || value === "qualified") return "The evidence is partial.";
  if (value === "unavailable" || value === "unknown") return "The evidence is limited.";
  return "The finding is based on the evidence reviewed.";
}

function clientNarrativePageLabel(pageId) {
  return ({
    "executive-scorecard": "Executive Scorecard",
    "priority-fixes": "Priority Fixes",
    "conversion-journey": "Conversion Journey",
    "content-opportunities": "Content Opportunities",
    "trust-credibility": "Trust & Credibility",
    "competitor-comparison": "Competitor Comparison",
    "supporting-detail": "Supporting Detail",
  })[pageId] || "Report page";
}

function clientNarrativeScope(record) {
  return clientCopy(record.reviewedScope)
    .replace(/the reviewed findings and recorded action scope/gi, "Priority findings and related actions")
    .replace(/capabilityEvidence\.capabilities/gi, "Assessed capability evidence");
}

function clientNarrativeEvidenceReferences(references) {
  const publicLabels = [...new Set((references || []).map((reference) => {
    const value = String(reference || "");
    if (/capabilityEvidence|^capabilities/i.test(value)) return "Assessed capability evidence";
    if (/decisionHierarchy|^findings/i.test(value)) return "Priority finding evidence";
    if (/conversionPath/i.test(value)) return "Conversion-path evidence";
    if (/buyerQuestion|contentIdeas/i.test(value)) return "Content planning evidence";
    if (/trustProof/i.test(value)) return "Trust evidence";
    if (/competitors/i.test(value)) return "Named competitor context";
    if (/evidenceScope|sourceStatus/i.test(value)) return "Evidence coverage";
    return "Supporting evidence";
  }))];
  return publicLabels.join(", ") || "Supporting evidence";
}

function clientLimitationText(value) {
  return String(value || "")
    .replace(/dataforseo_onpage/gi, "the page review")
    .replace(/playwright-conversion-path/gi, "the conversion-path check")
    .replace(/\binferred\b/gi, "based on the available evidence");
}

function recoveredAuditDataSection(model) {
  const data = model.recoveredAuditData;
  if (!data) return "";
  const normalizedRows = (data.normalizedSources || [])
    .map((source) => `<tr><td>${e(clientSourceLabel(source.source))}</td><td>${e(clientEvidenceStatus(source.status))}</td><td>${e(source.coverage?.completed ?? "—")}/${e(source.coverage?.requested ?? "—")}</td><td>${e((source.limitations || []).join("; ") || "No additional limitation recorded")}</td></tr>`)
    .join("");
  const screenshots = data.conversionValidation?.screenshots || [];
  return `<h3>Assessment records</h3>
    <p class="small">PRYSM used ${e(data.artifactCount)} verified audit records in this assessment. Supporting technical records remain available for verification.</p>
    <details class="supporting-detail-disclosure"><summary>Show technical traceability</summary>
      <div class="table-wrap"><table><thead><tr><th>Recovered input</th><th>Status</th><th>Disposition</th><th>Assessment note</th></tr></thead><tbody>
        <tr><td>Conversion-path validation</td><td>${e(clientEvidenceStatus(data.conversionValidation?.status))}</td><td>Included in report</td><td>${e(`${data.conversionValidation?.pageCount || 0} assessed page(s); ${screenshots.length} reviewed screenshot(s) retained as supporting evidence.`)}</td></tr>
        <tr><td>Evidence envelope</td><td>Recorded</td><td>Included in report</td><td>${e(`${data.evidenceEnvelope?.sourceCount || 0} source group(s) and ${data.evidenceEnvelope?.artifactReferenceCount || 0} artifact reference(s) retained in the report model.`)}</td></tr>
        <tr><td>Saved report record</td><td>Recorded</td><td>Supporting record</td><td>Retained to verify the saved report identity and versions.</td></tr>
        <tr><td>Report version record</td><td>Recorded</td><td>Supporting record</td><td>Retained to verify which report version and status were rendered.</td></tr>
        <tr><td>Narrative review</td><td>${e(clientEvidenceStatus(data.narrativeGate?.finalJudgeDecision))}</td><td>Supporting review</td><td>Retained to verify that the accepted narrative review completed; deterministic audit facts remain the source for scores and findings.</td></tr>
      </tbody></table></div>
      <h4>Normalized source coverage</h4>
      <div class="table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th>Coverage</th><th>Limits</th></tr></thead><tbody>${normalizedRows}</tbody></table></div>
      <p class="small">The saved package, report version record, and narrative review are supporting verification records. They do not replace the frozen score and finding evidence.</p>
    </details>`;
}

function deepEvidenceLayer(model, decisionProjection, pageState) {
  const acceptedFindingIds = decisionProjection.acceptedFindingIds;
  const findings = (model.findings || [])
    .map((f) => `
      <li>
        <strong>${e(f.title)}</strong>
        <span class="small">${acceptedFindingIds.has(f.findingId) ? "Accepted current priority" : "Supporting observation; not an accepted priority"}</span>
        <span class="small">${e(clientFindingEvidenceSummary(f.confidence))}</span>
        <ul class="small">
          ${(f.evidence || []).map((ev) =>
            `<li>${e(clientEvidenceLabel(ev.field))}: ${e(clientEvidenceValue(ev.observedValue))} (${e(clientEvidenceStatus(ev.sourceStatus))})</li>`,
          ).join("")}
        </ul>
      </li>`)
    .join("");

  const sources = ["site", "performance", "competitors", "backlinks", "ga4", "gsc"]
    .map((key) => {
      const ev = model.evidence?.[key];
      const status = ev?.sourceStatus || model.sourceStatus?.[key] || "NOT_COLLECTED";
      return `<li>${e(clientSourceLabel(key))}: ${e(clientEvidenceStatus(status))}${ev?.collectedAt ? ` (${e(ev.collectedAt)})` : ""}</li>`;
    })
    .join("");

  const caps = model.capabilityEvidence?.capabilities || {};
  const capRows = Object.entries(caps)
    .filter(([key]) => key !== "technical.headers")
    .map(([key, c]) =>
      `<tr><td>${e(clientCapabilityLabel(key))}</td><td><span class="chip ${capabilityStatusClass(c.status)}">${e(clientEvidenceStatus(c.status))}</span></td><td class="small">${e(clientLimitationText((c.limitations || []).join("; ")))}</td><td class="small">${c.validated ? "Direct check" : "Based on the available evidence"}</td></tr>`,
    )
    .join("");

  const suppressed = (model.suppressedFindingReasons || [])
    .map((reason) => `<li>This check was not completed because the required evidence was ${e(clientEvidenceStatus(reason.capabilityStatus))}.</li>`)
    .join("");
  const deferredBlock = suppressed.length
    ? `<h3>Deferred &amp; unavailable analysis</h3><ul class="small">${suppressed}</ul>`
    : `<h3>Deferred &amp; unavailable analysis</h3><p class="small">None deferred: all analyses with eligible evidence are rendered above; unavailable sources are shown in Source statuses.</p>`;

  const recoveredData = recoveredAuditDataSection(model);

  return `
  <section id="evidence" class="card" data-supporting-section="evidence-limitations">
    <h2>Evidence detail</h2>
    ${narrativeBlock(pageState)}
      <h3>Findings (${e((model.findings || []).length)})</h3>
    <p class="small">Each finding below is identified as an accepted current priority or supporting observation. Supporting observations remain visible and do not become required client work unless accepted in Priority Fixes. Material limitations are retained with the evidence.</p>
    <details class="supporting-detail-disclosure"><summary>Show detailed findings and source coverage</summary>
    <ul class="findings">${findings}</ul>
    <h3>Source statuses</h3>
    <ul class="small">${sources}</ul>
    </details>
    <h3>Evidence capabilities</h3>
    <details class="supporting-detail-disclosure"><summary>Show evidence coverage detail</summary><div class="table-wrap"><table>
      <thead><tr><th>Evidence area</th><th>Status</th><th>Limits</th><th>How it was checked</th></tr></thead>
      <tbody>${capRows}</tbody>
    </table></div></details>
    ${recoveredData}
    ${deferredBlock}
  </section>`;
}

function supportingOverviewSectionInner(model, pillars, pageState, narrativeStates) {
  const capabilities = model.capabilityEvidence?.capabilities || {};
  const completenessRows = Object.entries(capabilities).map(([key, item]) => `<tr><th scope="row">${e(publicEvidenceAreaLabel(key))}</th><td>${e(clientEvidenceStatus(item.status))}</td><td>${e(item.coverage?.completed ?? "NOT_AVAILABLE")}${item.coverage?.requested !== null && item.coverage?.requested !== undefined ? ` / ${e(item.coverage.requested)}` : ""}</td><td>${e((item.limitations || []).filter((note) => !/security headers?|response headers?|technical\.headers/i.test(String(note))).join(" ") || "No further client-facing limitation is available for this evidence area.")}</td></tr>`).join("");
  const readinessRows = (pillars || []).map((pillar) => `<tr><th scope="row">${e(pillar.label)}</th><td>${typeof pillar.score === "number" ? `${e(pillar.score)}/100` : "Not assessed"}</td><td>${pillar.capabilities.map((item) => `${e(clientCapabilityLabel(item.key))}: ${e(clientEvidenceStatus(item.status))}`).join("; ")}</td></tr>`).join("");
  const findings = (model.findings || []).filter((finding) => finding.scoreBearing === true || finding.actionable === true);
  const findingMarkup = findings.length
    ? `<ul>${findings.map((finding) => `<li><strong>${e(finding.title || finding.ruleId || "Reviewed finding")}.</strong> ${e(finding.severity || "Unknown")} · ${e(clientFindingEvidenceSummary(finding.confidence))} · evidence ${e([...(new Set((finding.evidence || []).map((item) => clientEvidenceStatus(item.sourceStatus))))].join(", ") || "Unknown")}; scope ${e((finding.affectedUrls || []).join(", ") || "No recorded page scope")}.</li>`).join("")}</ul>`
    : "<p>No material finding is available from the current report model.</p>";
  const performanceMarkup = `<p>Page speed check evidence: <strong>${e(clientEvidenceStatus(capabilityStatus(model, "performance.lab")))}</strong>. Real-user field data: <strong>${e(clientEvidenceStatus(capabilityStatus(model, "performance.field")))}</strong>.</p><p>Lab measurements describe the tested conditions. They are not real-user field performance.</p>`;
  const sources = ["site", "performance", "competitors", "backlinks", "ga4", "gsc"].map((key) => `<li><strong>${e(clientSourceLabel(key))}:</strong> ${e(clientEvidenceStatus(model.evidence?.[key]?.sourceStatus || model.evidence?.[key]?.status || model.sourceStatus?.[key] || "NOT_COLLECTED"))}</li>`).join("");
  const trace = Object.values(narrativeStates || {}).map((record) => `<tr data-narrative-page="${e(record.pageId)}"><th scope="row">${e(clientNarrativePageLabel(record.pageId))}</th><td>${e(record.state === "STRONG" ? "Supported" : record.state === "MIDDLE" ? "Mixed / bounded" : record.state === "WEAK" ? "Needs attention" : "Not enough evidence")}</td><td>${e(clientEvidenceStatus(record.evidenceSufficiency))}</td><td>${e(clientNarrativeScope(record))}</td><td>${e(clientNarrativeEvidenceReferences(record.evidenceRefs))}</td><td>${e(clientCopy(record.limitations.join(" ") || "No additional limitation recorded."))}</td></tr>`).join("");
  const available = Object.values(capabilities).filter((item) => item.status === "AVAILABLE").length;
  const total = Object.keys(capabilities).length;
  return `<div class="supporting-detail-summary" data-supporting-section="evidence-limitations">
    <p class="supporting-detail-kicker">Supporting Detail</p><h2>What evidence sits behind the report?</h2>
    ${narrativeBlock(pageState)}
    <h3>How complete was the evidence?</h3><p>${e(available)} of ${e(total)} recorded evidence areas were fully reviewed. The table preserves each original status and coverage; it does not treat missing evidence as a site failure.</p><div class="table-wrap"><table><thead><tr><th>Evidence area</th><th>Status</th><th>Coverage</th><th>Limit</th></tr></thead><tbody>${completenessRows}</tbody></table></div>
    <h3>What drove the readiness score?</h3><div class="table-wrap"><table><thead><tr><th>Dimension</th><th>Existing score output</th><th>Evidence status</th></tr></thead><tbody>${readinessRows}</tbody></table></div>
    <h3>What material findings were established?</h3>${findingMarkup}
    <h3>What did the performance evidence show?</h3>${performanceMarkup}
    <h3>Where was evidence limited?</h3>${evidenceLimitList(model)}
    <h3>What source evidence was available?</h3><ul>${sources}</ul>
    <h3>How does this evidence support the report?</h3><div class="table-wrap"><table><thead><tr><th>Conclusion</th><th>State</th><th>Sufficiency</th><th>Reviewed scope</th><th>Evidence references</th><th>Coverage limit</th></tr></thead><tbody>${trace}</tbody></table></div>
    <h3>Next step</h3><p>${e(pageState.boundedAction)}</p>
  </div>`;
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

function pageShell(model, date, pillars, checklist, canonical, decisionProjection, narrativeStates) {
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

  .priority-sequence { display:block; }

  .card:not(.primary-page-card),
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

.remediation-disclaimer {
  color:var(--prysm-muted);
  font-size:14px;
  margin:0 0 10px;
}

.common-remediation-options {
  display:grid;
  gap:8px;
}

.common-remediation-option {
  background:rgba(255,255,255,.72);
  border:1px solid var(--prysm-line);
  border-radius:8px;
  padding:10px 12px;
}

.common-remediation-option h4 {
  color:var(--prysm-dark);
  font-size:15px;
  line-height:1.35;
  margin:0 0 3px;
}

.common-remediation-option p,
.remediation-unavailable {
  color:var(--prysm-ink);
  font-size:15px;
  line-height:1.45;
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

/* Keep the client answer prominent and supporting evidence quiet. */
.primary-page-card {
  padding:36px;
}

.executive-page > .muted.small:first-of-type {
  margin:0 0 10px;
  color:var(--prysm-primary);
  font-size:12px;
  font-weight:800;
  letter-spacing:.12em;
  line-height:1.3;
  text-transform:uppercase;
}

.primary-page-card > h2 {
  max-width:24ch;
}

.executive-page {
  border-top:6px solid var(--prysm-primary);
  background:linear-gradient(180deg,#fff 0%,var(--prysm-mint-2) 100%);
}

.executive-page > h2 {
  max-width:18ch;
  font-size:48px;
  border-bottom:0;
  margin-bottom:14px;
  padding-bottom:0;
}

.executive-readiness {
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  align-items:end;
  gap:8px 24px;
  margin:24px 0 28px;
  padding:24px 26px;
  border:1px solid var(--prysm-primary);
  border-radius:16px;
  background:var(--prysm-mint);
}

.executive-readiness h3 {
  grid-column:1 / -1;
  margin:0;
  color:var(--prysm-dark);
  font-size:14px;
  letter-spacing:.1em;
  text-transform:uppercase;
}

.executive-readiness .readiness,
.executive-readiness .readiness-none {
  font-size:clamp(48px,7vw,76px);
  line-height:.95;
}

.executive-readiness .readiness-band {
  justify-self:end;
  align-self:center;
}

.executive-readiness > .small {
  grid-column:1 / -1;
  margin:0;
}

.executive-priorities {
  display:grid;
  gap:12px;
  margin:0;
  padding:0;
  list-style:none;
  counter-reset:executive-priority;
}

.executive-priorities li {
  counter-increment:executive-priority;
  position:relative;
  margin:0;
  padding:18px 20px 18px 58px;
  border:1px solid var(--prysm-line);
  border-radius:12px;
  background:#fff;
}

.executive-priorities li::before {
  content:counter(executive-priority);
  position:absolute;
  top:18px;
  left:18px;
  display:grid;
  width:28px;
  height:28px;
  place-items:center;
  border-radius:50%;
  background:var(--prysm-primary);
  color:#fff;
  font-family:'Manrope',system-ui,sans-serif;
  font-size:14px;
  font-weight:800;
}

.executive-priorities h4 {
  margin:0 0 5px;
  color:var(--prysm-deep);
  font-family:'Manrope',system-ui,sans-serif;
  font-size:19px;
  line-height:1.3;
}

.executive-priorities p {
  margin:5px 0 0;
  font-size:16px;
}

.action-page .priority-sequence {
  display:grid;
  gap:18px;
}

.journey-page .conversion-journey-verdict,
.content-page .content-opportunities-verdict {
  max-width:52ch;
}

.journey-page .conversion-journey-verdict {
  font-size:clamp(24px,3vw,34px);
}

.supporting-detail-orientation {
  border-left:4px solid var(--prysm-primary);
}

.supporting-detail-disclosure {
  background:#fff;
}

.supporting-detail-disclosure summary {
  min-height:44px;
  display:flex;
  align-items:center;
}

details[open] > summary {
  border-bottom:1px solid var(--prysm-line);
}

@media (max-width:720px) {
  .report-layout {
    grid-template-columns:minmax(0,1fr);
    grid-template-areas:'sidebar' 'content';
    gap:12px;
    padding:10px;
  }

  .viewer-sidebar {
    position:sticky;
    top:0;
    max-height:none;
    padding:10px;
    border-radius:12px;
  }

  .viewer-sidebar-title {
    margin:2px 6px 8px;
  }

  .viewer-nav {
    flex-direction:row;
    align-items:center;
    gap:6px;
    overflow-x:auto;
    padding-bottom:2px;
    scrollbar-width:thin;
  }

  .viewer-nav-link {
    flex:0 0 auto;
    min-width:max-content;
  }

  .viewer-supporting-nav {
    display:flex;
    align-items:center;
    flex:0 0 auto;
    gap:8px;
    margin:0;
    padding:0 0 0 8px;
    border:0;
  }

  .viewer-supporting-divider {
    display:none;
  }

  .viewer-supporting-label {
    margin:0;
    white-space:nowrap;
  }

  .primary-page-card {
    padding:22px 18px;
  }

  .executive-page > h2 {
    font-size:32px;
  }

  .executive-readiness {
    grid-template-columns:1fr;
    padding:18px;
  }

  .executive-readiness .readiness-band {
    justify-self:start;
  }

  .executive-priorities li {
    padding-left:52px;
  }
}

@media print {
  .primary-page-card {
    padding:0;
    border-top-width:3px;
    background:#fff;
  }

  .executive-readiness,
  .executive-priorities li,
  .supporting-detail-orientation {
    background:#fff;
    box-shadow:none;
  }

  .executive-readiness {
    border-color:#777;
  }

  .executive-page > h2 {
    font-size:32px;
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
  .conversion-journey-limitation {
    page-break-inside:avoid;
    break-inside:avoid;
  }
}

@media print {
  .action-page .priority-sequence { display:block; }
  .action-page .priority-action {
    margin:0 0 8px;
    padding:10px;
    page-break-inside:auto;
    break-inside:auto;
  }
  .action-page .priority-action-heading { gap:8px; margin-bottom:8px; }
  .action-page .priority-rank { flex-basis:28px; height:28px; width:28px; }
  .action-page .priority-action h3 { font-size:17px; }
  .action-page .priority-action-fields { gap:6px 8px; }
  .action-page .priority-field { padding:7px 9px; page-break-inside:avoid; break-inside:avoid; }
  .action-page .priority-field dt { font-size:10px; margin-bottom:2px; }
  .action-page .priority-field dd { font-size:12px; line-height:1.28; }
  .action-page .remediation-disclaimer { font-size:11px; margin-bottom:5px; }
  .action-page .common-remediation-options { gap:4px; }
  .action-page .common-remediation-option { padding:6px 8px; }
  .action-page .common-remediation-option h4 { font-size:12px; margin-bottom:2px; }
  .action-page .common-remediation-option p,
  .action-page .remediation-unavailable { font-size:12px; line-height:1.28; }
  .action-page .priority-diagnostic-checks {
    columns:2;
    column-gap:18px;
    font-size:10px;
    line-height:1.25;
    padding-left:18px;
  }
  .action-page .priority-diagnostic-checks li { break-inside:avoid; margin-bottom:3px; }
  .action-page .priority-diagnostic-checks .small { font-size:9px; }
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

  /* The selected report page may span several printed sheets. Let the active
     view fragment across sheets instead of moving its heading to an orphaned
     page under the general card keep-together rule above. */
  body.viewer-ready main > section.viewer-active {
    page-break-inside:auto !important;
    break-inside:auto !important;
  }

/* Keep the final bounded next-step note with the Content Opportunities page. */
  .content-page > h3 {
    margin-top:12px !important;
  }

  .content-page > p {
    margin-block:0.55em !important;
  }

  /* Footer metadata repeats the report header and can become a standalone
     final sheet after a long selected view. Keep it in the screen viewer. */
  body.viewer-ready > footer {
    display:none !important;
  }

  .card,
  main > section:not(.card),
  .pillar {
    box-shadow:none;
  }

  .table-wrap {
    overflow:visible !important;
    max-width:100% !important;
  }

  table {
    width:100% !important;
    table-layout:fixed;
    font-size:10px;
  }

  th, td {
    overflow-wrap:anywhere;
    word-break:break-word;
    padding:8px 6px;
  }

  .content-opportunity-card,
  .priority-action,
  .competitor-interpretation {
    break-inside:auto;
    page-break-inside:auto;
  }

  h2, h3, h4, h5 {
    break-after:avoid-page;
    page-break-after:avoid;
  }

  .content-opportunity-fields,
  .priority-action-fields {
    grid-template-columns:1fr 1fr;
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
      ${executiveScorecard(model, pillars, checklist, decisionProjection, narrativeStates["executive-scorecard"], narrativeStates)}
      ${pillarSection(pillars, model, narrativeStates)}
      ${blockersSection(model, decisionProjection, narrativeStates["priority-fixes"])}
      ${foundationSection(checklist)}
      ${conversionPathSection(model, decisionProjection, narrativeStates["conversion-journey"])}
      ${contentOpportunitiesSection(model, narrativeStates["content-opportunities"])}
      ${actionPlanSection(decisionProjection)}
      ${eeatSection(model, decisionProjection, narrativeStates["trust-credibility"])}
      ${competitorSectionClient(model, narrativeStates["competitor-comparison"])}
      ${technicalDetailSection(model)}
      ${headingSection(model)}
      ${schemaSection(model)}
      ${machineReadinessSection(model)}
      ${performanceDetailSection(model)}
      ${accessibilityMobileSection(model)}
      ${cmsPlatformSection(model)}
      ${internalLinksSection(model)}
      ${phase2Section()}
      ${deepEvidenceLayer(model, decisionProjection, narrativeStates["supporting-detail"])}
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
  const decisionProjection = clientDecisionProjection(renderModel, canonical);

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
  const narrativeStates = deriveNarrativeStates(renderModel);
  return projectClientStatusText(pageShell(
    renderModel,
    date,
    pillars,
    checklist,
    canonical,
    decisionProjection,
    narrativeStates,
  ));
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

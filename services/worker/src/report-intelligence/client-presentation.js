/**
 * Deterministic client-presentation contract.
 *
 * This is the single presentation authority between immutable report evidence /
 * scoring and the seven-page renderer. It may rank, qualify, reconcile, and
 * suppress client-facing presentation, but it may not mutate evidence truth,
 * measurements, scores, source states, or provenance.
 */

import {
  buildSemanticLedger,
  normalizeUrl,
} from "./semantic-ledger.js";
import {
  CONVERSION_INFLUENCE,
  CONVERSION_INFLUENCE_RANK,
  conversionInfluenceOf,
} from "../report/action-priority.js";

export const CLIENT_PRESENTATION_VERSION = "1.0.0";

const LEAD_CONFIDENCE = new Set([
  "deterministic",
  "strongly_supported",
  "supported",
]);

const JOURNEY_INFLUENCE = new Set([
  CONVERSION_INFLUENCE.CONVERSION_PATH_ACTION,
  CONVERSION_INFLUENCE.TRUST_PROOF,
  CONVERSION_INFLUENCE.OFFER_AUDIENCE_CLARITY,
  CONVERSION_INFLUENCE.FRICTION_EXPERIENCE,
  CONVERSION_INFLUENCE.BUYER_DECISION_SUPPORT,
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finite(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isLeadEligible(finding) {
  return LEAD_CONFIDENCE.has(String(finding?.confidence || "").toLowerCase());
}

function normalizedFindingUrls(finding) {
  return [...new Set(
    (Array.isArray(finding?.affectedUrls) ? finding.affectedUrls : [])
      .map(normalizeUrl)
      .filter(Boolean),
  )];
}

function findingVerification(finding) {
  const explicit = text(finding?.verificationMethod);
  if (explicit) return explicit;
  const title = text(finding?.title);
  if (/largest contentful paint|\blcp\b|main content.*appear/i.test(title)) {
    return "Run the same page-speed check again and confirm the main content appears sooner.";
  }
  if (/structured data|schema/i.test(title)) {
    return "Validate the published structured data and confirm it matches the page content.";
  }
  if (/meta description|search-result description/i.test(title)) {
    return "Check the affected pages and confirm each page has a useful search-result description.";
  }
  if (/heading/i.test(title)) {
    return "Read the page headings from top to bottom and confirm the structure is clear and consistent.";
  }
  if (/pricing|cost|reassurance/i.test(title)) {
    return "Review the affected decision page and confirm the supported pricing or reassurance information is clear before contact.";
  }
  return "Repeat the same evidence check and confirm the recorded condition has improved.";
}

function contentKey(stage, topic) {
  return `${String(stage || "").toLowerCase()}::${text(topic).toLowerCase()}`;
}

function interpretationConstructs(model) {
  return model?.crossReportInterpretation?.constructs || {};
}

function assessedBodyCount(site) {
  return (Array.isArray(site?.pages) ? site.pages : []).filter((page) => text(page?.bodyText)).length;
}

function ownSiteCompetitorValues(model, ledger) {
  const constructs = interpretationConstructs(model);
  const site = model?.evidence?.site || {};
  const contentStatus = ledger?.concepts?.contentCoverage?.status;
  const proofObserved = ledger?.concepts?.trustProof?.observed === true;

  const offerClarity =
    text(constructs.offerClarity) && !/^not assessed$/i.test(text(constructs.offerClarity))
      ? constructs.offerClarity
      : Array.isArray(site?.services) && site.services.length
        ? "Observed service scope"
        : "Not Assessed";

  const trustProof =
    text(constructs.trustProof) && !/^not assessed$/i.test(text(constructs.trustProof))
      ? constructs.trustProof
      : proofObserved
        ? "Observed proof"
        : "Not Assessed";

  const contentDepth =
    text(constructs.contentDepth) && !/^not assessed$/i.test(text(constructs.contentDepth))
      ? constructs.contentDepth
      : ["AVAILABLE", "PARTIAL"].includes(contentStatus) && assessedBodyCount(site) > 0
        ? `${assessedBodyCount(site)} reviewed page(s)`
        : "Not Assessed";

  return Object.freeze({
    offerClarity,
    trustProof,
    contentDepth,
    ctaClarity: constructs.ctaClarity || "Not Assessed",
    pathClarity: constructs.conversionPathClarity || "Not Assessed",
  });
}

function pricingConflict(model) {
  const sitePricing = model?.evidence?.site?.trust?.pricing === true;
  if (!sitePricing) return null;
  const finding = (model?.findings || []).find((item) => {
    const corpus = [
      item?.title,
      item?.businessImpact,
      item?.recommendation,
    ].map(text).join(" ");
    return /pricing|investment|cost/i.test(corpus) &&
      /absent|missing|unclear|reassurance|before they act|before contact/i.test(corpus);
  });
  if (!finding) return null;
  return Object.freeze({
    findingId: finding.findingId || null,
    message:
      "Pricing or investment context was observed somewhere in the assessed content, while a scoped priority finding says buyers may still lack enough pricing or reassurance at a decision point. Treat this as a scope or placement issue, not a whole-site absence.",
  });
}

function conversionPathQualification(model) {
  const weak = (Array.isArray(model?.conversionPaths) ? model.conversionPaths : [])
    .filter((path) => String(path?.status || "").toLowerCase() === "weak");
  const moduleScore = model?.moduleScores?.conversion_paths?.score;
  if (!weak.length || !Number.isFinite(moduleScore) || moduleScore < 80) return null;
  return Object.freeze({
    message:
      "The composite Conversion Path score is strong across its assessed inputs, but the reviewed primary path includes a Weak path record. Read the score as mixed evidence rather than a claim that every route to action is strong.",
    weakPathNames: weak.map((path) => path?.name || "Reviewed conversion path"),
  });
}

export function buildClientPresentation(model = {}) {
  const ledger = model?.semanticLedger || buildSemanticLedger({
    scoreSet: model,
    findings: model?.findings || [],
    decisionEvidence: model?.evidence || {},
    contentIdeas: model?.contentIdeas,
  });

  const findings = Array.isArray(model?.findings) ? model.findings : [];
  const priority = findings
    .filter((finding) => finding?.scoreBearing === true && finding?.actionable !== false)
    .map((finding) => {
      const influence = conversionInfluenceOf(finding);
      return Object.freeze({
        findingId: finding.findingId || "",
        ruleId: finding.ruleId || "",
        influence,
        influenceRank: CONVERSION_INFLUENCE_RANK[influence] ?? 99,
        leadEligible: isLeadEligible(finding),
        finalPriority: finite(finding.finalPriority),
        verification: findingVerification(finding),
        normalizedUrls: normalizedFindingUrls(finding),
      });
    })
    .sort((left, right) => {
      if (left.leadEligible !== right.leadEligible) return left.leadEligible ? -1 : 1;
      if (left.influenceRank !== right.influenceRank) return left.influenceRank - right.influenceRank;
      if (left.finalPriority !== right.finalPriority) return right.finalPriority - left.finalPriority;
      return left.ruleId.localeCompare(right.ruleId);
    });

  const journeyFindingIds = priority
    .filter((row) => row.leadEligible && JOURNEY_INFLUENCE.has(row.influence))
    .map((row) => row.findingId)
    .filter(Boolean);

  const contentOpportunities = (ledger?.contentOpportunities || []).map((row) =>
    Object.freeze({
      ...row,
      key: contentKey(row.stage, row.topic),
      urls: (row.urls || []).map(normalizeUrl).filter(Boolean),
    }),
  );

  const trustProof = ledger?.concepts?.trustProof || {
    observed: false,
    forms: [],
    qualifier: null,
  };

  return Object.freeze({
    version: CLIENT_PRESENTATION_VERSION,
    evidenceAuthority: ledger?.evidenceAuthority || "DETERMINISTIC_EVIDENCE_ENGINE",
    priority: Object.freeze({
      orderedFindingIds: Object.freeze(priority.map((row) => row.findingId).filter(Boolean)),
      rows: Object.freeze(priority),
    }),
    journey: Object.freeze({
      findingIds: Object.freeze(journeyFindingIds),
    }),
    content: Object.freeze({
      opportunities: Object.freeze(contentOpportunities),
      byKey: Object.freeze(Object.fromEntries(contentOpportunities.map((row) => [row.key, row]))),
    }),
    trust: Object.freeze({
      proofForms: Object.freeze([...(trustProof.forms || [])]),
      proofObserved: trustProof.observed === true,
      qualifier: trustProof.qualifier || null,
      pricingConflict: pricingConflict(model),
    }),
    competitor: Object.freeze({
      ownValues: ownSiteCompetitorValues(model, ledger),
    }),
    scoreQualifications: Object.freeze({
      conversionPath: conversionPathQualification(model),
    }),
    normalizedUrlsByFindingId: Object.freeze(Object.fromEntries(
      priority.map((row) => [row.findingId, row.normalizedUrls]),
    )),
    verificationByFindingId: Object.freeze(Object.fromEntries(
      priority.map((row) => [row.findingId, row.verification]),
    )),
    ledger,
  });
}

export function presentationContentKey(stage, topic) {
  return contentKey(stage, topic);
}

export default {
  CLIENT_PRESENTATION_VERSION,
  buildClientPresentation,
  presentationContentKey,
};

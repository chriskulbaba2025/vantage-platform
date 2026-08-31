/**
 * PRYSM-V2-REPORT-DEPTH-01 — conversion-first action classification.
 *
 * Section E must answer "what should this business actually fix first to
 * improve conversion?", not "which technical defect has the largest abstract
 * score". This module derives, at RENDER TIME, a deterministic action class,
 * Conversion-First v4.2 influence domain, and implementation group for each
 * governed finding.
 *
 * GOVERNANCE
 *  - `finding.schema.json` is frozen with `additionalProperties: false`, so
 *    nothing here is persisted onto a finding. Every value is derived from
 *    existing governed fields (ruleId, dimension, module, confidence,
 *    scoreBearing, finalPriority, severity, implementationEffort).
 *  - No evidence is invented. Classification does not upgrade unknown,
 *    partial, or insufficient evidence into a confirmed claim.
 *  - Classification never changes a score. Ordering changes; scores do not.
 */

/** Deterministic action classes, most urgent first. */
export const ACTION_CLASS = Object.freeze({
  FOUNDATION_BLOCKER: "FOUNDATION_BLOCKER",
  HIGH_CONVERSION: "HIGH_CONVERSION",
  OPTIMIZATION: "OPTIMIZATION",
});

/** Client-facing implementation groups. */
export const ACTION_GROUP = Object.freeze({
  DO_NOW: "DO NOW",
  DO_NEXT: "DO NEXT",
  LATER: "LATER / OPTIMIZE",
});

/**
 * Shared derived Conversion-First v4.2 client-influence contract.
 *
 * This is deliberately separate from canonical finding priority and scoring.
 * It is a render-time decision view that downstream report/narrative consumers
 * can reuse without mutating the persisted FindingSet.
 *
 * For action ranking, the v4.2 action-ordering rule is:
 * direct conversion path/action -> trust/proof -> offer/audience clarity ->
 * friction/experience -> buyer decision support -> acquisition/discoverability
 * -> technical causes/resilience.
 *
 * Proven foundation blockers still override this order.
 */
export const CONVERSION_INFLUENCE = Object.freeze({
  CONVERSION_PATH_ACTION: "conversion_path_action",
  TRUST_PROOF: "trust_proof",
  OFFER_AUDIENCE_CLARITY: "offer_audience_clarity",
  FRICTION_EXPERIENCE: "friction_experience",
  BUYER_DECISION_SUPPORT: "buyer_question_decision_support",
  ACQUISITION_DISCOVERABILITY: "acquisition_discoverability",
  TECHNICAL_CAUSES_RESILIENCE: "technical_causes_resilience",
  OTHER: "other",
});

export const CONVERSION_INFLUENCE_RANK = Object.freeze({
  [CONVERSION_INFLUENCE.CONVERSION_PATH_ACTION]: 0,
  [CONVERSION_INFLUENCE.TRUST_PROOF]: 1,
  [CONVERSION_INFLUENCE.OFFER_AUDIENCE_CLARITY]: 2,
  [CONVERSION_INFLUENCE.FRICTION_EXPERIENCE]: 3,
  [CONVERSION_INFLUENCE.BUYER_DECISION_SUPPORT]: 4,
  [CONVERSION_INFLUENCE.ACQUISITION_DISCOVERABILITY]: 5,
  [CONVERSION_INFLUENCE.TECHNICAL_CAUSES_RESILIENCE]: 6,
  [CONVERSION_INFLUENCE.OTHER]: 7,
});

/**
 * Governed foundation domains. A rule appears here only when a finding it
 * produces is, by construction, proof that the site cannot complete or
 * measure its primary conversion, cannot be discovered, cannot render, or
 * cannot be transacted with safely.
 *
 * This is NOT a blanket severity list: membership alone is insufficient.
 * The confidence floor below must also be met, and the finding must be
 * score-bearing.
 */
export const FOUNDATION_RULE_DOMAINS = Object.freeze({
  "VAN-PATH-001": "conversion_completion",
});

/** Confidence floor for the foundation class. */
const FOUNDATION_CONFIDENCE = Object.freeze([
  "deterministic",
  "strongly_supported",
]);

/**
 * Minimum confidence allowed to lead the client-facing hierarchy.
 *
 * Directional evidence remains visible but cannot outrank a supported finding
 * merely because it belongs to a higher business-impact domain.
 */
const CLIENT_LEAD_CONFIDENCE = Object.freeze([
  "deterministic",
  "strongly_supported",
  "supported",
]);

/** Final-priority floor for high-conversion work. */
const HIGH_CONVERSION_FLOOR = 55;

/** Final-priority floor for optimization work that still earns "Do Next". */
const DO_NEXT_FLOOR = 40;

/** Efforts that are practical enough to start immediately. */
const PRACTICAL_EFFORT = Object.freeze(["L", "M"]);

function effortOf(finding) {
  return finding?.implementationEffort || finding?.effort || "M";
}

function priorityOf(finding) {
  const value = finding?.finalPriority;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasLeadConfidence(finding) {
  return CLIENT_LEAD_CONFIDENCE.includes(finding?.confidence);
}

/**
 * Determine the shared client-facing Conversion-First influence domain from
 * governed finding identity.
 *
 * Matching order is intentional:
 *  - direct path/action rules are separated from offer clarity even though
 *    both can live in the conversion_pathways scoring dimension;
 *  - GSC/SEO/SERP/schema identities are acquisition/discoverability even when
 *    their scoring module lives under content;
 *  - buyer-question/content findings remain decision-support findings rather
 *    than being collapsed into generic acquisition;
 *  - technical hygiene is last unless separately proven foundational.
 */
export function conversionInfluenceOf(finding) {
  const ruleId = String(finding?.ruleId || "").toUpperCase();
  const dimension = String(finding?.dimension || "").toLowerCase();
  const module = String(finding?.module || "").toLowerCase();

  if (
    ruleId.startsWith("VAN-PATH-") ||
    ruleId.startsWith("VAN-CONV-") ||
    module === "conversion_paths"
  ) {
    return CONVERSION_INFLUENCE.CONVERSION_PATH_ACTION;
  }

  if (
    ruleId.startsWith("VAN-TRUST-") ||
    ruleId.startsWith("VAN-EEAT-") ||
    dimension === "trust_eeat" ||
    module === "trust_signals" ||
    module === "risk_reduction" ||
    module.includes("trust") ||
    module.includes("eeat")
  ) {
    return CONVERSION_INFLUENCE.TRUST_PROOF;
  }

  if (
    ruleId.startsWith("VAN-OFFER-") ||
    ruleId.startsWith("VAN-AUDIENCE-") ||
    module === "offer_clarity" ||
    module.includes("offer") ||
    module.includes("audience")
  ) {
    return CONVERSION_INFLUENCE.OFFER_AUDIENCE_CLARITY;
  }

  if (
    ruleId.startsWith("VAN-PERF-") ||
    ruleId.startsWith("VAN-UX-") ||
    ruleId.startsWith("VAN-A11Y-") ||
    module === "performance" ||
    module.includes("usability") ||
    module.includes("accessibility")
  ) {
    return CONVERSION_INFLUENCE.FRICTION_EXPERIENCE;
  }

  if (
    ruleId.startsWith("VAN-SEO-") ||
    ruleId.startsWith("VAN-SERP-") ||
    ruleId.startsWith("VAN-GSC-") ||
    ruleId.startsWith("VAN-SCHEMA-") ||
    dimension.includes("search") ||
    dimension.includes("schema") ||
    dimension.includes("entity") ||
    module.includes("search") ||
    module.includes("serp") ||
    module.includes("schema") ||
    module.includes("ai_readiness")
  ) {
    return CONVERSION_INFLUENCE.ACQUISITION_DISCOVERABILITY;
  }

  if (
    ruleId.startsWith("VAN-CONTENT-") ||
    dimension === "content_funnel" ||
    module === "content_depth" ||
    module === "funnel_coverage" ||
    module.includes("content") ||
    module.includes("funnel")
  ) {
    return CONVERSION_INFLUENCE.BUYER_DECISION_SUPPORT;
  }

  if (
    ruleId.startsWith("VAN-TECH-") ||
    dimension.includes("technical") ||
    module.includes("technical")
  ) {
    return CONVERSION_INFLUENCE.TECHNICAL_CAUSES_RESILIENCE;
  }

  return CONVERSION_INFLUENCE.OTHER;
}

function isConversionLeadingInfluence(influence) {
  return (
    influence !== CONVERSION_INFLUENCE.TECHNICAL_CAUSES_RESILIENCE &&
    influence !== CONVERSION_INFLUENCE.OTHER
  );
}

/**
 * Classify a single governed finding.
 *
 * @param {object} finding — governed finding (finding.schema.json shape)
 * @param {Set<string>|Array<string>} [foundationRuleIds] — additional rule IDs
 *        proven foundational by the First Things First checklist.
 * @returns {{
 *   actionClass: string,
 *   foundationDomain: string|null,
 *   conversionInfluence: string,
 *   conversionInfluenceRank: number,
 *   group: string
 * }}
 */
export function classifyFinding(finding, foundationRuleIds = []) {
  const linked =
    foundationRuleIds instanceof Set
      ? foundationRuleIds
      : new Set(foundationRuleIds || []);

  const scoreBearing = finding?.scoreBearing === true;
  const confidence = finding?.confidence;
  const confidentEnough = FOUNDATION_CONFIDENCE.includes(confidence);
  const domain = FOUNDATION_RULE_DOMAINS[finding?.ruleId] ?? null;
  const inFoundationScope =
    domain !== null || linked.has(finding?.ruleId);

  const conversionInfluence = conversionInfluenceOf(finding);
  const conversionInfluenceRank =
    CONVERSION_INFLUENCE_RANK[conversionInfluence];

  let actionClass;
  let foundationDomain = null;

  if (scoreBearing && confidentEnough && inFoundationScope) {
    actionClass = ACTION_CLASS.FOUNDATION_BLOCKER;
    foundationDomain = domain ?? "first_things_first";
  } else if (
    scoreBearing &&
    hasLeadConfidence(finding) &&
    isConversionLeadingInfluence(conversionInfluence) &&
    priorityOf(finding) >= HIGH_CONVERSION_FLOOR
  ) {
    actionClass = ACTION_CLASS.HIGH_CONVERSION;
  } else {
    actionClass = ACTION_CLASS.OPTIMIZATION;
  }

  return {
    actionClass,
    foundationDomain,
    conversionInfluence,
    conversionInfluenceRank,
    group: groupFor(actionClass, finding),
  };
}

/** Deterministic implementation grouping. */
function groupFor(actionClass, finding) {
  if (actionClass === ACTION_CLASS.FOUNDATION_BLOCKER) {
    return ACTION_GROUP.DO_NOW;
  }

  if (actionClass === ACTION_CLASS.HIGH_CONVERSION) {
    const confident = FOUNDATION_CONFIDENCE.includes(finding?.confidence);
    const practical = PRACTICAL_EFFORT.includes(effortOf(finding));

    return confident && practical
      ? ACTION_GROUP.DO_NOW
      : ACTION_GROUP.DO_NEXT;
  }

  return priorityOf(finding) >= DO_NEXT_FLOOR
    ? ACTION_GROUP.DO_NEXT
    : ACTION_GROUP.LATER;
}

const CLASS_RANK = Object.freeze({
  [ACTION_CLASS.FOUNDATION_BLOCKER]: 0,
  [ACTION_CLASS.HIGH_CONVERSION]: 1,
  [ACTION_CLASS.OPTIMIZATION]: 2,
});

/**
 * Build the ordered, grouped client action plan from the governed model.
 *
 * Ranking contract:
 *
 * 1. Proven foundation blockers.
 * 2. Direct conversion path / action.
 * 3. Trust / proof.
 * 4. Offer / audience clarity.
 * 5. Friction / experience.
 * 6. Buyer-question / decision support.
 * 7. Acquisition / discoverability.
 * 8. Technical causes / resilience.
 * 9. Other.
 *
 * Evidence confidence is a lead-eligibility gate, not a ranking tier:
 * supported, strongly-supported, and deterministic findings may all lead,
 * while directional evidence remains visible but cannot displace them.
 * Among lead-eligible findings, conversion influence determines business-impact
 * class before action class and numeric finalPriority resolve comparable work.
 *
 * @param {object} model — scored audit model
 * @param {Array<object>} [checklist] — First Things First items
 * @returns {{actions: Array<object>, groups: object, foundationRuleIds: Array<string>}}
 */
export function buildActionPlan(model, checklist = []) {
  const foundationRuleIds = new Set();

  for (const item of checklist || []) {
    if (item?.status !== "ACTION_REQUIRED") continue;
    if (item?.foundational !== true || item?.assessed !== true) continue;

    for (const ruleId of item.linkedRuleIds || []) {
      foundationRuleIds.add(ruleId);
    }
  }

  const actions = (model?.findings || [])
    .filter((finding) => finding?.scoreBearing === true)
    .map((finding) => {
      const {
        actionClass,
        foundationDomain,
        conversionInfluence,
        conversionInfluenceRank,
        group,
      } = classifyFinding(finding, foundationRuleIds);

      return {
        finding,
        actionClass,
        foundationDomain,
        conversionInfluence,
        conversionInfluenceRank,
        group,
        priority: priorityOf(finding),
        effort: effortOf(finding),
        verificationMethod: finding.verificationMethod || "",
      };
    })
    .sort((a, b) => {
      const aFoundation =
        a.actionClass === ACTION_CLASS.FOUNDATION_BLOCKER;
      const bFoundation =
        b.actionClass === ACTION_CLASS.FOUNDATION_BLOCKER;

      if (aFoundation !== bFoundation) {
        return aFoundation ? -1 : 1;
      }

                 const aLeadEligible = hasLeadConfidence(a.finding);
      const bLeadEligible = hasLeadConfidence(b.finding);

      if (aLeadEligible !== bLeadEligible) {
        return aLeadEligible ? -1 : 1;
      }

      const byInfluence =
        a.conversionInfluenceRank - b.conversionInfluenceRank;

      if (byInfluence !== 0) return byInfluence;

      const byClass =
        CLASS_RANK[a.actionClass] - CLASS_RANK[b.actionClass];

      if (byClass !== 0) return byClass;

      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }

      return String(a.finding.ruleId).localeCompare(
        String(b.finding.ruleId),
      );
    })
    .map((action, index) => ({
      ...action,
      rank: index + 1,
    }));

  const groups = {
    [ACTION_GROUP.DO_NOW]: actions.filter(
      (action) => action.group === ACTION_GROUP.DO_NOW,
    ),
    [ACTION_GROUP.DO_NEXT]: actions.filter(
      (action) => action.group === ACTION_GROUP.DO_NEXT,
    ),
    [ACTION_GROUP.LATER]: actions.filter(
      (action) => action.group === ACTION_GROUP.LATER,
    ),
  };

  return {
    actions,
    groups,
    foundationRuleIds: [...foundationRuleIds],
  };
}

export default {
  ACTION_CLASS,
  ACTION_GROUP,
  CONVERSION_INFLUENCE,
  CONVERSION_INFLUENCE_RANK,
  FOUNDATION_RULE_DOMAINS,
  conversionInfluenceOf,
  classifyFinding,
  buildActionPlan,
};

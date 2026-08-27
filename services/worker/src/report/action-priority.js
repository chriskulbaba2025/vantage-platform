/**
 * PRYSM-V2-REPORT-DEPTH-01 — conversion-first action classification.
 *
 * Section E must answer "what should this business actually fix first to
 * improve conversion?", not "which technical defect has the largest abstract
 * score". This module derives, at RENDER TIME, a deterministic action class
 * and implementation group for each governed finding.
 *
 * GOVERNANCE
 *  - `finding.schema.json` is frozen with `additionalProperties: false`, so
 *    nothing here is persisted onto a finding. Every value is derived from
 *    existing governed fields (ruleId, dimension, module, confidence,
 *    scoreBearing, finalPriority, severity, implementationEffort).
 *  - No evidence is invented. A finding only exists when its capability was
 *    available and its evidence was collected, so classification cannot
 *    manufacture a claim.
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
 * Client-facing decision order.
 *
 * This is deliberately separate from score priority. A technically severe
 * hygiene issue must not outrank a materially relevant conversion, trust, or
 * user-experience issue merely because its numeric finding priority is higher.
 */
const IMPACT_DOMAIN = Object.freeze({
  CONVERSION: "conversion",
  TRUST: "trust",
  PERFORMANCE_UX: "performance_ux",
  ACQUISITION: "acquisition",
  TECHNICAL: "technical",
  OTHER: "other",
});

const IMPACT_DOMAIN_RANK = Object.freeze({
  [IMPACT_DOMAIN.CONVERSION]: 0,
  [IMPACT_DOMAIN.TRUST]: 1,
  [IMPACT_DOMAIN.PERFORMANCE_UX]: 2,
  [IMPACT_DOMAIN.ACQUISITION]: 3,
  [IMPACT_DOMAIN.TECHNICAL]: 4,
  [IMPACT_DOMAIN.OTHER]: 5,
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

/**
 * Confidence floor for the foundation class.
 */
const FOUNDATION_CONFIDENCE = Object.freeze([
  "deterministic",
  "strongly_supported",
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

/**
 * Determine the client-facing impact domain from governed finding identity.
 *
 * Matching order is intentional. Performance findings may live inside a
 * broader technical dimension, so performance/UX is detected before generic
 * technical classification.
 */
function impactDomainOf(finding) {
  const ruleId = String(finding?.ruleId || "").toUpperCase();
  const dimension = String(finding?.dimension || "").toLowerCase();
  const module = String(finding?.module || "").toLowerCase();

  if (
    ruleId.startsWith("VAN-PATH-") ||
    ruleId.startsWith("VAN-CONV-") ||
    dimension.includes("conversion") ||
    module.includes("conversion")
  ) {
    return IMPACT_DOMAIN.CONVERSION;
  }

  if (
    ruleId.startsWith("VAN-TRUST-") ||
    ruleId.startsWith("VAN-EEAT-") ||
    dimension.includes("trust") ||
    dimension.includes("authority") ||
    module.includes("trust") ||
    module.includes("eeat")
  ) {
    return IMPACT_DOMAIN.TRUST;
  }

  if (
    ruleId.startsWith("VAN-PERF-") ||
    ruleId.startsWith("VAN-UX-") ||
    ruleId.startsWith("VAN-A11Y-") ||
    module.includes("performance") ||
    module.includes("usability") ||
    module.includes("accessibility")
  ) {
    return IMPACT_DOMAIN.PERFORMANCE_UX;
  }

  if (
    ruleId.startsWith("VAN-SEO-") ||
    ruleId.startsWith("VAN-SERP-") ||
    ruleId.startsWith("VAN-CONTENT-") ||
    dimension.includes("search") ||
    module.includes("search") ||
    module.includes("serp") ||
    module.includes("content")
  ) {
    return IMPACT_DOMAIN.ACQUISITION;
  }

  if (
    ruleId.startsWith("VAN-TECH-") ||
    dimension.includes("technical") ||
    module.includes("technical")
  ) {
    return IMPACT_DOMAIN.TECHNICAL;
  }

  return IMPACT_DOMAIN.OTHER;
}

function isConversionFacingDomain(domain) {
  return (
    domain === IMPACT_DOMAIN.CONVERSION ||
    domain === IMPACT_DOMAIN.TRUST ||
    domain === IMPACT_DOMAIN.PERFORMANCE_UX
  );
}

/**
 * Classify a single governed finding.
 *
 * @param {object} finding — governed finding (finding.schema.json shape)
 * @param {Set<string>|Array<string>} [foundationRuleIds] — additional rule IDs
 *        proven foundational by the First Things First checklist.
 * @returns {{actionClass: string, foundationDomain: string|null, group: string}}
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

  const impactDomain = impactDomainOf(finding);

  let actionClass;
  let foundationDomain = null;

  if (scoreBearing && confidentEnough && inFoundationScope) {
    actionClass = ACTION_CLASS.FOUNDATION_BLOCKER;
    foundationDomain = domain ?? "first_things_first";
  } else if (
    isConversionFacingDomain(impactDomain) &&
    priorityOf(finding) >= HIGH_CONVERSION_FLOOR
  ) {
    actionClass = ACTION_CLASS.HIGH_CONVERSION;
  } else {
    actionClass = ACTION_CLASS.OPTIMIZATION;
  }

  return {
    actionClass,
    foundationDomain,
    group: groupFor(actionClass, finding),
  };
}

/**
 * Deterministic implementation grouping.
 */
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
 * 2. Conversion.
 * 3. Trust.
 * 4. Performance / UX.
 * 5. Acquisition / SEO.
 * 6. Technical hygiene.
 * 7. Other.
 *
 * Numeric finalPriority ranks findings only inside the same client-impact
 * domain. It can no longer promote a technical hygiene item above a more
 * material conversion-facing category.
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
        group,
      } = classifyFinding(finding, foundationRuleIds);

      return {
        finding,
        actionClass,
        foundationDomain,
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

      const aPriorityConfidence = FOUNDATION_CONFIDENCE.includes(
        a.finding?.confidence,
      );
      const bPriorityConfidence = FOUNDATION_CONFIDENCE.includes(
        b.finding?.confidence,
      );

      if (aPriorityConfidence !== bPriorityConfidence) {
        return aPriorityConfidence ? -1 : 1;
      }

      const byDomain =
        IMPACT_DOMAIN_RANK[impactDomainOf(a.finding)] -
        IMPACT_DOMAIN_RANK[impactDomainOf(b.finding)];

      if (byDomain !== 0) return byDomain;

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
  FOUNDATION_RULE_DOMAINS,
  classifyFinding,
  buildActionPlan,
};

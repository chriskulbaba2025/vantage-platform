/**
 * PRYSM-V2-REPORT-DEPTH-01 — conversion-first action classification.
 *
 * Section E must answer "what should this business actually fix first to
 * improve conversion?", not "which technical defect has the largest abstract
 * score".  This module derives, at RENDER TIME, a deterministic action class
 * and implementation group for each governed finding.
 *
 * GOVERNANCE
 *  - `finding.schema.json` is frozen with `additionalProperties: false`, so
 *    nothing here is persisted onto a finding.  Every value is derived from
 *    existing governed fields (ruleId, confidence, scoreBearing,
 *    finalPriority, severity, implementationEffort).
 *  - No evidence is invented.  A finding only exists when its capability was
 *    available and its evidence was collected, so classification cannot
 *    manufacture a claim.
 *  - Classification never changes a score.  Ordering changes; scores do not.
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
 * Governed foundation domains.  A rule appears here only when a finding it
 * produces is, by construction, proof that the site cannot complete or
 * measure its primary conversion, cannot be discovered, cannot render, or
 * cannot be transacted with safely.
 *
 * This is NOT a blanket severity list: membership alone is insufficient.
 * The confidence floor below must also be met, and the finding must be
 * score-bearing — so an unproven or weakly-evidenced item can never be
 * promoted ahead of a strongly-evidenced one by classification alone.
 */
export const FOUNDATION_RULE_DOMAINS = Object.freeze({
  // Browser-validated obstruction of the primary conversion action.
  "VAN-PATH-001": "conversion_completion",
});

/**
 * Confidence floor for the foundation class (modifier >= 0.90).  A
 * `supported` or `directional` finding in a foundation domain is ranked on
 * its merits, never promoted.
 */
const FOUNDATION_CONFIDENCE = Object.freeze(["deterministic", "strongly_supported"]);

/** Final-priority floor for the high-conversion class. */
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
 * Classify a single governed finding.
 *
 * @param {object} finding — governed finding (finding.schema.json shape)
 * @param {Set<string>|Array<string>} [foundationRuleIds] — additional rule IDs
 *        proven foundational by the First Things First checklist (C2 linkage).
 * @returns {{actionClass: string, foundationDomain: string|null, group: string}}
 */
export function classifyFinding(finding, foundationRuleIds = []) {
  const linked = foundationRuleIds instanceof Set
    ? foundationRuleIds
    : new Set(foundationRuleIds || []);

  const scoreBearing = finding?.scoreBearing === true;
  const confidence = finding?.confidence;
  const confidentEnough = FOUNDATION_CONFIDENCE.includes(confidence);
  const domain = FOUNDATION_RULE_DOMAINS[finding?.ruleId] ?? null;
  const inFoundationScope = domain !== null || linked.has(finding?.ruleId);

  let actionClass;
  let foundationDomain = null;

  if (scoreBearing && confidentEnough && inFoundationScope) {
    actionClass = ACTION_CLASS.FOUNDATION_BLOCKER;
    foundationDomain = domain ?? "first_things_first";
  } else if (priorityOf(finding) >= HIGH_CONVERSION_FLOOR) {
    actionClass = ACTION_CLASS.HIGH_CONVERSION;
  } else {
    actionClass = ACTION_CLASS.OPTIMIZATION;
  }

  return { actionClass, foundationDomain, group: groupFor(actionClass, finding) };
}

/**
 * Deterministic implementation grouping.
 *
 * Low effort ALONE never promotes work to "Do Now" — the finding must first
 * qualify as a foundation blocker or a high-conversion item.
 */
function groupFor(actionClass, finding) {
  if (actionClass === ACTION_CLASS.FOUNDATION_BLOCKER) return ACTION_GROUP.DO_NOW;

  if (actionClass === ACTION_CLASS.HIGH_CONVERSION) {
    const confident = FOUNDATION_CONFIDENCE.includes(finding?.confidence);
    const practical = PRACTICAL_EFFORT.includes(effortOf(finding));
    return confident && practical ? ACTION_GROUP.DO_NOW : ACTION_GROUP.DO_NEXT;
  }

  return priorityOf(finding) >= DO_NEXT_FLOOR ? ACTION_GROUP.DO_NEXT : ACTION_GROUP.LATER;
}

const CLASS_RANK = Object.freeze({
  [ACTION_CLASS.FOUNDATION_BLOCKER]: 0,
  [ACTION_CLASS.HIGH_CONVERSION]: 1,
  [ACTION_CLASS.OPTIMIZATION]: 2,
});

/**
 * Build the ordered, grouped client action plan from the governed model.
 *
 * Only score-bearing findings are eligible: findings whose evidence was
 * insufficient are non-score-bearing by construction and never appear.
 *
 * @param {object} model — scored audit model (scoreAudit output)
 * @param {Array<object>} [checklist] — First Things First items (C2 linkage)
 * @returns {{actions: Array<object>, groups: object, foundationRuleIds: Array<string>}}
 */
export function buildActionPlan(model, checklist = []) {
  // C2 linkage: a checklist item that is ACTION REQUIRED on proven evidence
  // AND is conversion/discovery/measurement critical makes the governed
  // finding(s) it references eligible for the foundation class.  One finding
  // is referenced from several views — never duplicated into new findings.
  const foundationRuleIds = new Set();
  for (const item of checklist || []) {
    if (item?.status !== "ACTION_REQUIRED") continue;
    if (item?.foundational !== true || item?.assessed !== true) continue;
    for (const ruleId of item.linkedRuleIds || []) foundationRuleIds.add(ruleId);
  }

  const actions = (model?.findings || [])
    .filter((f) => f?.scoreBearing === true)
    .map((finding) => {
      const { actionClass, foundationDomain, group } = classifyFinding(finding, foundationRuleIds);
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
      const byClass = CLASS_RANK[a.actionClass] - CLASS_RANK[b.actionClass];
      if (byClass !== 0) return byClass;
      if (b.priority !== a.priority) return b.priority - a.priority;
      // Stable, deterministic tie-break — never dependent on input order.
      return String(a.finding.ruleId).localeCompare(String(b.finding.ruleId));
    })
    .map((action, index) => ({ ...action, rank: index + 1 }));

  const groups = {
    [ACTION_GROUP.DO_NOW]: actions.filter((a) => a.group === ACTION_GROUP.DO_NOW),
    [ACTION_GROUP.DO_NEXT]: actions.filter((a) => a.group === ACTION_GROUP.DO_NEXT),
    [ACTION_GROUP.LATER]: actions.filter((a) => a.group === ACTION_GROUP.LATER),
  };

  return { actions, groups, foundationRuleIds: [...foundationRuleIds] };
}

export default { ACTION_CLASS, ACTION_GROUP, FOUNDATION_RULE_DOMAINS, classifyFinding, buildActionPlan };

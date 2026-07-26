/**
 * Human Review Gate — PRD v3.0 §18, §20
 *
 * Provides the canonical review record, checklist validation, override
 * recording, and lifecycle state machine for the Principal Auditor review
 * and approval workflow.
 *
 * Every audit begins as "draft".  The report cannot be delivered until
 * status is "approved" (§18).
 */

// ---------------------------------------------------------------------------
// Lifecycle statuses
// ---------------------------------------------------------------------------

export const LIFECYCLE_STATUS = Object.freeze({
  DRAFT:    "draft",
  REVIEWED: "reviewed",
  APPROVED: "approved",
});

/** Valid transitions (simple DAG). */
const VALID_TRANSITIONS = Object.freeze({
  [LIFECYCLE_STATUS.DRAFT]:    [LIFECYCLE_STATUS.REVIEWED, LIFECYCLE_STATUS.APPROVED],
  [LIFECYCLE_STATUS.REVIEWED]: [LIFECYCLE_STATUS.APPROVED],
  [LIFECYCLE_STATUS.APPROVED]: [], // terminal
});

// ---------------------------------------------------------------------------
// PRD §18 checklist items
// ---------------------------------------------------------------------------

/**
 * Every checklist item maps to a specific PRD §18 requirement.
 *
 * Each item records:
 *  - id:        stable identifier for automated checks
 *  - label:     human-readable description
 *  - reviewed:  whether the auditor marked it as reviewed
 *  - note:      optional auditor note
 *  - reviewedAt: ISO-8601 timestamp
 */
export const REVIEW_CHECKLIST_ITEMS = Object.freeze([
  { id: "source_failures",      label: "Source failures and partial coverage" },
  { id: "top_ten_findings",     label: "Top ten findings" },
  { id: "high_severity",        label: "All high-severity findings" },
  { id: "competitor_selections",label: "Competitor selections" },
  { id: "root_cause",           label: "Root-cause statement" },
  { id: "score_eligibility",    label: "Score eligibility" },
  { id: "limitations",          label: "Limitations" },
  { id: "causal_language",      label: "Unsupported causal language" },
  { id: "implementation_feasibility", label: "Implementation feasibility" },
]);

const CHECKLIST_IDS = new Set(REVIEW_CHECKLIST_ITEMS.map((i) => i.id));

// ---------------------------------------------------------------------------
// Canonical review record builder
// ---------------------------------------------------------------------------

/**
 * Build a canonical review record.
 *
 * Returns { valid, record, errors }.
 * - valid:   boolean
 * - record:  the review record (null if invalid)
 * - errors:  array of human-readable error strings
 */
export function buildReviewRecord(fields) {
  const errors = [];

  if (!fields || typeof fields !== "object") {
    return { valid: false, record: null, errors: ["Review payload must be an object"] };
  }

  const reviewer = String(fields.reviewer || "").trim();
  if (!reviewer) errors.push("reviewer is required");

  const checklist = Array.isArray(fields.checklist) ? fields.checklist : [];

  // Validate that every required checklist item is present
  const seen = new Set();
  const validatedChecklist = [];

  for (const item of checklist) {
    if (!item || typeof item !== "object") {
      errors.push("Each checklist entry must be an object");
      continue;
    }
    const id = String(item.id || "").trim();
    if (!id) {
      errors.push("Each checklist entry requires an id");
      continue;
    }
    if (!CHECKLIST_IDS.has(id)) {
      errors.push(`Unknown checklist item "${id}"`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`Duplicate checklist item "${id}"`);
      continue;
    }
    seen.add(id);

    validatedChecklist.push({
      id,
      label: REVIEW_CHECKLIST_ITEMS.find((c) => c.id === id)?.label || id,
      reviewed: Boolean(item.reviewed),
      note: String(item.note || "").trim() || null,
      reviewedAt: item.reviewedAt || new Date().toISOString(),
    });
  }

  // Require all checklist items
  const missing = REVIEW_CHECKLIST_ITEMS
    .map((c) => c.id)
    .filter((id) => !seen.has(id));

  if (missing.length) {
    errors.push(
      `Incomplete checklist — missing: ${missing.join(", ")}`,
    );
  }

  const overrides = Array.isArray(fields.overrides) ? fields.overrides : [];
  const validatedOverrides = [];
  for (const ov of overrides) {
    const errs = _validateOverride(ov);
    if (errs.length) {
      errors.push(...errs.map((e) => `Override validation: ${e}`));
    } else {
      validatedOverrides.push(_buildOverrideRecord(ov, reviewer));
    }
  }

  if (errors.length) {
    return { valid: false, record: null, errors };
  }

  const now = new Date().toISOString();

  const record = {
    runId: fields.runId || null,
    status: LIFECYCLE_STATUS.REVIEWED,
    reviewer,
    reviewedAt: fields.reviewedAt || now,
    checklist: validatedChecklist,
    findingsReviewed: fields.findingsReviewed ?? null,
    overrides: validatedOverrides,
    notes: String(fields.notes || "").trim() || null,
    limitationsAccepted: Boolean(fields.limitationsAccepted),
    createdAt: now,
  };

  return { valid: true, record, errors: [] };
}

// ---------------------------------------------------------------------------
// Override validation and recording (PRD §20)
// ---------------------------------------------------------------------------

const REQUIRED_OVERRIDE_FIELDS = [
  "user",
  "timestamp",
  "reason",
  "previousValue",
  "replacementValue",
];

function _validateOverride(ov) {
  const errors = [];
  if (!ov || typeof ov !== "object") {
    return ["Override must be an object"];
  }
  for (const field of REQUIRED_OVERRIDE_FIELDS) {
    if (ov[field] === undefined || ov[field] === null) {
      // "replacementValue" and "previousValue" may be falsy (0, "", false)
      if (field === "replacementValue" || field === "previousValue") {
        if (ov[field] === undefined) {
          errors.push(`Override requires "${field}"`);
        }
      } else if (field === "timestamp") {
        if (!ov.timestamp) errors.push(`Override requires "${field}"`);
      } else {
        errors.push(`Override requires "${field}"`);
      }
    }
  }
  if (ov.reason !== undefined && ov.reason !== null && String(ov.reason).trim().length === 0) {
    errors.push("Override reason must not be empty");
  }
  return errors;
}

function _buildOverrideRecord(ov, reviewer) {
  return {
    user: ov.user || reviewer,
    timestamp: ov.timestamp || new Date().toISOString(),
    reason: String(ov.reason || "").trim(),
    previousValue: ov.previousValue,
    replacementValue: ov.replacementValue,
    field: ov.field || ov.targetPath || null,
  };
}

/**
 * Append overrides to an existing review record (append-only).
 * Returns { valid, record, errors } with the merged record.
 */
export function appendOverrides(existingReview, newOverrides, reviewer) {
  const errors = [];
  const validated = [];

  for (const ov of newOverrides) {
    const errs = _validateOverride(ov);
    if (errs.length) {
      errors.push(...errs.map((e) => `Override validation: ${e}`));
    } else {
      validated.push(_buildOverrideRecord(ov, reviewer));
    }
  }

  if (errors.length) {
    return { valid: false, record: null, errors };
  }

  const existing = Array.isArray(existingReview?.overrides)
    ? existingReview.overrides
    : [];

  return {
    valid: true,
    record: {
      ...existingReview,
      overrides: [...existing, ...validated],
    },
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Validate a lifecycle transition.
 * Returns { valid, errors }.
 */
export function validateTransition(fromStatus, toStatus) {
  if (!fromStatus || !toStatus) {
    return {
      valid: false,
      errors: [`Both fromStatus and toStatus are required (got from="${fromStatus}", to="${toStatus}")`],
    };
  }

  const allowed = VALID_TRANSITIONS[fromStatus];
  if (!allowed) {
    return {
      valid: false,
      errors: [`Unknown status "${fromStatus}"`],
    };
  }

  if (!allowed.includes(toStatus)) {
    return {
      valid: false,
      errors: [
        `Invalid transition: "${fromStatus}" → "${toStatus}". ` +
        `Allowed: ${allowed.join(", ") || "none (terminal)"}`,
      ],
    };
  }

  return { valid: true, errors: [] };
}

/**
 * Check if a review record is complete (all checklist items reviewed).
 */
export function isReviewComplete(reviewRecord) {
  if (!reviewRecord || !Array.isArray(reviewRecord.checklist)) return false;
  return reviewRecord.checklist.every((item) => item.reviewed);
}

/**
 * Build an approval record.
 *
 * Requires:
 *  - existing complete review
 *  - approver identity
 *
 * Returns { valid, record, errors }.
 */
export function buildApprovalRecord(runId, reviewRecord, approver, opts = {}) {
  const errors = [];

  if (!reviewRecord) {
    errors.push("A complete review is required before approval");
  } else if (!isReviewComplete(reviewRecord)) {
    errors.push("Approval rejected — review checklist is incomplete");
  }

  const approverId = String(approver || "").trim();
  if (!approverId) {
    errors.push("Approver identity is required");
  }

  if (errors.length) {
    return { valid: false, record: null, errors };
  }

  return {
    valid: true,
    record: {
      runId,
      approver: approverId,
      approvedAt: opts.approvedAt || new Date().toISOString(),
      reviewRef: {
        reviewer: reviewRecord.reviewer,
        reviewedAt: reviewRecord.reviewedAt,
        checklistCount: reviewRecord.checklist.length,
        overrideCount: (reviewRecord.overrides || []).length,
      },
      notes: String(opts.notes || "").trim() || null,
      overrides: reviewRecord.overrides || [],
    },
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Competitor decision validation (Task 9 — PRD §12)
// ---------------------------------------------------------------------------

const VALID_COMPETITOR_DECISIONS = new Set(["approved", "rejected"]);

/**
 * Validate competitor decision payload submitted with the review.
 *
 * Rules:
 *  - decisions array may be omitted entirely (no competitor review performed)
 *  - each entry requires candidateUrl, decision, and a non-empty reason
 *  - decision must be "approved" or "rejected"
 *  - duplicate candidate URLs are rejected
 *  - candidate URLs must match known qualified candidates (when known set provided)
 *
 * @param {Array} decisions          Raw decisions from review payload
 * @param {Set}   [knownCandidateUrls] Optional set of allowed candidate URLs
 * @returns {{ valid: boolean, records: Array, errors: string[] }}
 */
export function validateCompetitorDecisions(decisions, knownCandidateUrls = null) {
  const errors = [];
  const records = [];

  if (!Array.isArray(decisions) || decisions.length === 0) {
    return { valid: true, records: [], errors: [] };
  }

  const seen = new Set();

  for (const d of decisions) {
    if (!d || typeof d !== "object") {
      errors.push("Each competitor decision must be an object");
      continue;
    }

    const candidateUrl = String(d.candidateUrl || "").trim();
    if (!candidateUrl) {
      errors.push("Competitor decision requires candidateUrl");
      continue;
    }

    if (seen.has(candidateUrl)) {
      errors.push(`Duplicate competitor decision for "${candidateUrl}"`);
      continue;
    }
    seen.add(candidateUrl);

    const decision = String(d.decision || "").trim().toLowerCase();
    if (!VALID_COMPETITOR_DECISIONS.has(decision)) {
      errors.push(`Competitor decision "${decision}" must be "approved" or "rejected" (candidate: ${candidateUrl})`);
      continue;
    }

    const reason = String(d.reason || "").trim();
    if (!reason) {
      errors.push(`Competitor decision requires a non-empty reason (candidate: ${candidateUrl})`);
      continue;
    }

    // Validate against known candidates when provided
    if (knownCandidateUrls && !knownCandidateUrls.has(candidateUrl)) {
      errors.push(`Unknown or excluded candidate "${candidateUrl}" — cannot approve or reject`);
      continue;
    }

    records.push({
      candidateUrl,
      decision,
      reason,
    });
  }

  if (errors.length) {
    return { valid: false, records: [], errors };
  }

  return { valid: true, records, errors: [] };
}

/**
 * Build override records for competitor decisions.
 * Uses the existing append-only override contract.
 *
 * @param {Array}  decisions  Validated decision records
 * @param {string} reviewer   Reviewer identity
 * @returns {Array} override records
 */
export function buildCompetitorOverrides(decisions, reviewer) {
  const now = new Date().toISOString();
  return decisions.map((d) => ({
    user: reviewer,
    timestamp: now,
    reason: d.reason,
    previousValue: "pending",
    replacementValue: d.decision,
    field: `competitor:${d.candidateUrl}`,
  }));
}

// ---------------------------------------------------------------------------
// Review checklist factory (empty template)
// ---------------------------------------------------------------------------

/**
 * Return an empty checklist with all PRD §18 items unreviewed.
 */
export function emptyChecklist() {
  return REVIEW_CHECKLIST_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    reviewed: false,
    note: null,
    reviewedAt: null,
  }));
}

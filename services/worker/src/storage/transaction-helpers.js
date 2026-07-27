/**
 * Shared transaction validation helpers used by both local and S3 stores.
 */

import { createHash, randomUUID } from "node:crypto";

/** Generate a unique transaction ID. */
export function createTransactionId() {
  return `txn-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

/** SHA-256 hash of a string. */
export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

/** Normalize nullable values for comparison. */
export function nil(v) {
  return (v === undefined || v === null) ? null : v;
}

/**
 * Verify the committed review record agrees with the lifecycle review
 * across all relevant fields.  Returns true when they agree.
 */
export function committedReviewAgreesWithLifecycle(parsedReview, lc) {
  if (!lc.review) return true; // no lifecycle review to compare against — pass

  if (parsedReview.reviewer !== lc.review.reviewer) return false;
  if (parsedReview.reviewedAt !== lc.review.reviewedAt) return false;
  if (nil(parsedReview.notes) !== nil(lc.review.notes)) return false;
  if (!!parsedReview.limitationsAccepted !== !!lc.review.limitationsAccepted) return false;
  if (nil(parsedReview.findingsReviewed) !== nil(lc.review.findingsReviewed)) return false;

  // Checklist: same IDs and reviewed values
  const txChecklist = (parsedReview.checklist || []).map((c) => `${c.id}:${c.reviewed}`).sort().join(",");
  const lcChecklist = (lc.review.checklist || []).map((c) => `${c.id}:${c.reviewed}`).sort().join(",");
  if (txChecklist !== lcChecklist) return false;

  // Overrides: review's overrides must all exist unchanged in lifecycle
  return overridesContainCurrentReview(parsedReview.overrides || [], lc.overrides || []);
}

/**
 * Verify that every override in the current review still exists unchanged
 * in the lifecycle's accumulated override history.  Prior lifecycle
 * overrides from earlier transactions are allowed.
 */
export function overridesContainCurrentReview(reviewOverrides, lcOverrides) {
  for (const ro of reviewOverrides) {
    const found = lcOverrides.some((lo) =>
      lo.user === ro.user &&
      lo.timestamp === ro.timestamp &&
      lo.reason === ro.reason &&
      lo.field === ro.field &&
      lo.previousValue === ro.previousValue &&
      lo.replacementValue === ro.replacementValue,
    );
    if (!found) return false;
  }
  return true;
}

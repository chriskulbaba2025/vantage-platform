/**
 * Backlink Classifier
 *
 * Assigns every normalized backlink record to one of four buckets:
 *   good | bad | worth_pursuing | ignore
 *
 * Follows the deterministic classification rules defined in
 * VANTAGE_BACKLINK_ADAPTER_PRD_V0_1 §7–§10.
 *
 * Sets bucket, evidenceClass, and rationale on each record.
 * Classification is deterministic and reviewable — no ML, no
 * probabilistic weighting beyond the confidence model.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIDENCE_BANDS = {
  HIGH: { min: 0.85, label: "high confidence" },
  MODERATE: { min: 0.7, label: "moderate confidence" },
  LIMITED: { min: 0.5, label: "limited confidence" },
  DIRECTIONAL: { min: 0, label: "directional only" },
};

const EVIDENCE_CLASSES = {
  STRONGLY_SUPPORTED: "strongly_supported",
  SUPPORTED: "supported",
  DIRECTIONAL: "directional",
  INSUFFICIENT_EVIDENCE: "insufficient_evidence",
};

// ---------------------------------------------------------------------------
// Rule predicates
// ---------------------------------------------------------------------------

/**
 * A backlink is "good" when it passes all four quality gates.
 *
 * PRD §9.1:
 *   backlinkQualityScore >= 75
 *   AND spamScore <= 30
 *   AND relevanceScore >= 18
 *   AND placementScore >= 18
 */
function isGood(record) {
  return (
    record.backlinkQualityScore >= 75 &&
    (record.spamScore == null || record.spamScore <= 30) &&
    record.relevanceScore >= 18 &&
    record.placementScore >= 18
  );
}

/**
 * A backlink is "bad" when it triggers any red-flag rule.
 *
 * PRD §9.2:
 *   spamScore >= 61
 *   OR relevanceScore = 0
 *   OR placementScore = 0
 *   OR anchor text pattern = spammy
 */
function isBad(record) {
  const flags = [];

  if (record.spamScore != null && record.spamScore >= 61) {
    flags.push("high spam score");
  }
  if (record.relevanceScore === 0) {
    flags.push("irrelevant topic");
  }
  if (record.placementScore === 0) {
    flags.push("low-quality placement");
  }
  if (record._isSpammyAnchor) {
    flags.push("spammy anchor text");
  }

  return { isBad: flags.length > 0, flags };
}

/**
 * A backlink is "worth pursuing" when it overlaps with competitor
 * backlinks and the client does not yet have a link from that domain.
 *
 * PRD §9.3:
 *   competitorOverlapCount >= 1
 *   AND clientHasLinkFromDomain = false
 *   AND spamScore <= 30
 *   AND relevanceScore >= 18
 *   AND placementScore >= 18
 */
function isWorthPursuing(record) {
  return (
    record.competitorOverlapCount >= 1 &&
    record.clientHasLinkFromDomain === false &&
    (record.spamScore == null || record.spamScore <= 30) &&
    record.relevanceScore >= 18 &&
    record.placementScore >= 18
  );
}

/**
 * A record should be ignored when:
 *   - It is a duplicate
 *   - OR it is too incomplete to classify safely
 *   - OR it does not meet good, bad, or worth_pursuing rules
 *
 * PRD §7 (internal "ignore" bucket), Build Prompt §Classifier requirements.
 */
function shouldIgnore(record) {
  return (
    record._isDuplicate === true ||
    (record._missingFields && record._missingFields.length >= 6) ||
    record.backlinkQualityScore == null
  );
}

// ---------------------------------------------------------------------------
// Evidence class assignment
// ---------------------------------------------------------------------------

/**
 * Determine evidenceClass based on how strongly the classification is
 * supported.
 *
 * - strongly_supported: multiple confirming signals or high confidence
 * - supported: classification rule matched at standard threshold
 * - directional: borderline score, or single weak signal
 * - insufficient_evidence: too little data to classify meaningfully
 */
function assignEvidenceClass(record, bucket, badFlags) {
  const confidence = record.classificationConfidence;

  switch (bucket) {
    case "good": {
      if (confidence >= 0.85 && record.backlinkQualityScore >= 85) {
        return EVIDENCE_CLASSES.STRONGLY_SUPPORTED;
      }
      if (confidence >= 0.7) {
        return EVIDENCE_CLASSES.SUPPORTED;
      }
      return EVIDENCE_CLASSES.DIRECTIONAL;
    }

    case "bad": {
      // Two or more bad flags = strongly supported
      if (badFlags && badFlags.length >= 2) {
        return EVIDENCE_CLASSES.STRONGLY_SUPPORTED;
      }
      if (confidence >= 0.7) {
        return EVIDENCE_CLASSES.SUPPORTED;
      }
      return EVIDENCE_CLASSES.DIRECTIONAL;
    }

    case "worth_pursuing": {
      // Two or more competitor overlap = stronger signal
      if (record.competitorOverlapCount >= 2 && confidence >= 0.8) {
        return EVIDENCE_CLASSES.STRONGLY_SUPPORTED;
      }
      if (confidence >= 0.7) {
        return EVIDENCE_CLASSES.SUPPORTED;
      }
      return EVIDENCE_CLASSES.DIRECTIONAL;
    }

    case "ignore": {
      return EVIDENCE_CLASSES.INSUFFICIENT_EVIDENCE;
    }

    default: {
      return EVIDENCE_CLASSES.INSUFFICIENT_EVIDENCE;
    }
  }
}

// ---------------------------------------------------------------------------
// Rationale builder
// ---------------------------------------------------------------------------

/**
 * Build a human-readable rationale string for the classification.
 */
function buildRationale(record, bucket, badFlags) {
  const parts = [];

  if (record._isDuplicate) {
    parts.push("duplicate record — same referring page and target URL");
    return parts.join(" ");
  }

  if (record._missingFields && record._missingFields.length >= 6) {
    parts.push(
      `too incomplete for classification (${record._missingFields.length} fields missing)`,
    );
    return parts.join(" ");
  }

  // Add factor score summary
  parts.push(
    `Q=${record.backlinkQualityScore}/100`,
    `(R:${record.relevanceScore} A:${record.authorityScore} P:${record.placementScore} S:${record.spamSafetyScore})`,
  );

  switch (bucket) {
    case "good": {
      parts.push("— passes all quality gates.");
      break;
    }
    case "bad": {
      if (badFlags && badFlags.length > 0) {
        parts.push(`— red flags: ${badFlags.join(", ")}.`);
      }
      break;
    }
    case "worth_pursuing": {
      parts.push(
        `— overlaps with ${record.competitorOverlapCount} competitor(s), client lacks link.`,
      );
      break;
    }
    case "ignore": {
      parts.push(
        "— does not meet good, bad, or worth_pursuing thresholds.",
      );
      break;
    }
  }

  // Add confidence note
  if (record._spamScoreMissing) {
    parts.push("Spam score missing; manual review required.");
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a single normalized backlink record into a bucket.
 *
 * Mutates the record in place: sets bucket, evidenceClass, and updates
 * rationale. Returns the record for chaining.
 *
 * @param {object} record - Normalized backlink record.
 * @returns {object} The classified record (same reference, mutated).
 */
export function classifyBacklink(record) {
  // Check ignore conditions first
  if (shouldIgnore(record)) {
    record.bucket = "ignore";
    record.evidenceClass =
      EVIDENCE_CLASSES.INSUFFICIENT_EVIDENCE;
    record.rationale = buildRationale(record, "ignore");
    return record;
  }

  // Check bad (red flags take priority)
  const badResult = isBad(record);
  if (badResult.isBad) {
    record.bucket = "bad";
    record.evidenceClass = assignEvidenceClass(
      record,
      "bad",
      badResult.flags,
    );
    record.rationale = buildRationale(
      record,
      "bad",
      badResult.flags,
    );
    return record;
  }

  // Check worth pursuing (check before good — opportunity detection is
  // more actionable than confirming existing links)
  if (isWorthPursuing(record)) {
    record.bucket = "worth_pursuing";
    record.evidenceClass = assignEvidenceClass(
      record,
      "worth_pursuing",
    );
    record.rationale = buildRationale(
      record,
      "worth_pursuing",
    );
    return record;
  }

  // Check good
  if (isGood(record)) {
    record.bucket = "good";
    record.evidenceClass = assignEvidenceClass(record, "good");
    record.rationale = buildRationale(record, "good");
    return record;
  }

  // Fall through — ignore
  record.bucket = "ignore";
  record.evidenceClass =
    EVIDENCE_CLASSES.INSUFFICIENT_EVIDENCE;
  record.rationale = buildRationale(record, "ignore");
  return record;
}

/**
 * Classify an array of normalized backlink records.
 *
 * Each record is classified independently. Records are mutated in place.
 *
 * @param {Array<object>} records - Array of normalized backlink records.
 * @returns {Array<object>} The classified records (same references, mutated).
 */
export function classifyBacklinks(records) {
  for (const record of records) {
    classifyBacklink(record);
  }
  return records;
}

export default {
  classifyBacklink,
  classifyBacklinks,
};

/**
 * Backlink Normalizer
 *
 * Transforms raw DataForSEO backlink records into the normalized Vantage
 * backlink evidence format. Computes factor scores for each record.
 *
 * Tolerates missing fields — missing fields reduce confidence rather than
 * crashing. Every normalized record includes all required PRD fields.
 */

// ---------------------------------------------------------------------------
// Topic / relevance keyword sets (Phase 1 — deterministic keyword matching)
// ---------------------------------------------------------------------------

/**
 * Topic cluster keywords. These represent the consulting / professional
 * services domain of the target. In later phases this could be replaced
 * with an ML classifier or configurable topic model.
 */
const TOPIC_KEYWORDS = [
  "consulting", "consultant", "consultancy",
  "strategy", "strategic", "strategist",
  "enterprise", "enterprise-grade",
  "digital", "digital transformation",
  "business", "business services",
  "service", "service provider", "services",
  "agency", "agencies",
  "professional", "professional services",
  "management", "management consulting",
  "advisor", "advisory",
  "solution", "solutions",
  "technology", "tech",
  "operations", "operational",
  "growth", "scaling",
  "transformation",
  "implementation",
  "optimization",
  "analytics",
  "marketing",
  "branding",
  "innovation",
  "leadership",
  "executive",
  "B2B", "b2b",
];

/**
 * Spammy anchor text patterns that indicate manipulative linking.
 */
const SPAMMY_ANCHOR_PATTERNS = [
  /\bbuy\b.*\bcheap\b/i,
  /\bcheap\b.*\bbuy\b/i,
  /\bbest price\b/i,
  /\bdiscount\b/i,
  /\bclick here\b/i,
  /\bvisit us\b/i,
  /\bclick now\b/i,
  /\bfree\b.*\btrial\b/i,
  /\bsex\b/i,
  /\bcasino\b/i,
  /\bpoker\b/i,
  /\bgambling\b/i,
  /\bviagra\b/i,
  /\bpharma\b/i,
  /\bpayday\b/i,
  /\bloan\b/i,
  /\bxxx\b/i,
  /\badult\b/i,
  /\bporn\b/i,
];

/**
 * Irrelevant-domain topic indicators. Domains matching these patterns are
 * unlikely to be relevant to a professional services firm.
 */
const IRRELEVANT_DOMAIN_PATTERNS = [
  /casino/i, /poker/i, /gambling/i, /bet/i,
  /pharma/i, /pills/i, /drugs/i,
  /adult/i, /porn/i, /xxx/i, /sex/i,
  /payday/i, /loan/i,
];

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/**
 * Compute relevance score (0–25) from anchor text, page title, and URL.
 *
 * Uses deterministic keyword matching for Phase 1.
 * Returns { score, confidence }.
 */
function computeRelevanceScore(record) {
  const anchor = (record.anchor || "").toLowerCase();
  const title = (record.page_from_title || "").toLowerCase();
  const pageUrl = (record.page_from || "").toLowerCase();
  const domainFrom = (record.domain_from || "").toLowerCase();

  // Check for obvious irrelevance first
  const isIrrelevantDomain = IRRELEVANT_DOMAIN_PATTERNS.some((p) =>
    p.test(domainFrom),
  );
  if (isIrrelevantDomain) {
    return { score: 0, confidence: 0.9 };
  }

  // Count keyword matches across anchor, title, URL
  let matchCount = 0;
  const searchText = [anchor, title, pageUrl].join(" ");

  for (const kw of TOPIC_KEYWORDS) {
    if (searchText.includes(kw.toLowerCase())) {
      matchCount++;
    }
  }

  // Score based on match density
  if (matchCount >= 4) {
    return { score: 25, confidence: 0.85 };
  }
  if (matchCount >= 2) {
    return { score: 18, confidence: 0.7 };
  }
  if (matchCount >= 1) {
    return { score: 10, confidence: 0.5 };
  }

  // No keyword matches — could still be relevant from domain context
  // but we can't infer it from available text
  if (!anchor && !title) {
    return { score: 0, confidence: 0.2 };
  }

  return { score: 0, confidence: 0.3 };
}

/**
 * Compute authority score (0–25) from domain and page rank signals.
 */
function computeAuthorityScore(record) {
  const domainRank = record.domain_from_rank;
  const pageRank = record.page_from_rank;

  // Missing ranks
  if (domainRank == null && pageRank == null) {
    return { score: 0, confidence: 0.1 };
  }

  // Use the best available rank signal
  const rank = domainRank != null ? domainRank : pageRank;

  // Lower rank number = stronger authority
  if (rank <= 1000) {
    return { score: 25, confidence: 0.9 };
  }
  if (rank <= 10000) {
    return { score: 18, confidence: 0.8 };
  }
  if (rank <= 100000) {
    return { score: 10, confidence: 0.7 };
  }
  if (rank <= 500000) {
    return { score: 5, confidence: 0.6 };
  }

  return { score: 0, confidence: 0.5 };
}

/**
 * Compute placement score (0–25) from semantic location and link metadata.
 */
function computePlacementScore(record) {
  const location = (record.semantic_location || "").toLowerCase();
  const linkType = record.link_type || "anchor";
  const linkAttrs = record.link_attributes || [];
  const externalLinks = record.external_links_count;

  // Footer / sidebar / widget — lowest quality placements
  if (
    location === "footer" ||
    location === "sidebar" ||
    location === "widget"
  ) {
    return { score: 0, confidence: 0.95 };
  }

  // Sitewide link (typically footer/sidebar patterns)
  const isNofollow = linkAttrs.includes("nofollow");

  // Article / main content
  if (location === "article" || location === "section") {
    if (isNofollow) {
      // Editorial but nofollow — still useful but reduced
      return { score: 18, confidence: 0.75 };
    }
    return { score: 25, confidence: 0.85 };
  }

  // Resource page or contextual list (inferred from moderate external links)
  if (externalLinks != null && externalLinks <= 30 && externalLinks > 0) {
    return { score: 18, confidence: 0.6 };
  }

  // Generic directory or unclear placement
  if (
    location === "directory" ||
    location === "bio" ||
    location === "author"
  ) {
    return { score: 10, confidence: 0.6 };
  }

  // Unknown location — try to infer
  if (!location || location === "unknown") {
    // High external link count suggests low-quality placement
    if (externalLinks != null && externalLinks > 100) {
      return { score: 5, confidence: 0.3 };
    }
    if (isNofollow) {
      return { score: 10, confidence: 0.3 };
    }
    return { score: 15, confidence: 0.25 };
  }

  return { score: 15, confidence: 0.3 };
}

/**
 * Compute spam safety score (0–25) from DataForSEO spam_score.
 */
function computeSpamSafetyScore(record) {
  const spamScore = record.spam_score;

  // Spam score missing
  if (spamScore == null) {
    return { score: 10, confidence: 0.2, missing: true };
  }

  if (spamScore <= 30) {
    return { score: 25, confidence: 0.85 };
  }
  if (spamScore <= 60) {
    return { score: 10, confidence: 0.75 };
  }

  // 61–100
  return { score: 0, confidence: 0.9 };
}

/**
 * Detect spammy anchor text patterns.
 * Returns true if the anchor text looks manipulative.
 */
function isSpammyAnchor(anchorText) {
  if (!anchorText) return false;
  return SPAMMY_ANCHOR_PATTERNS.some((p) => p.test(anchorText));
}

// ---------------------------------------------------------------------------
// Missing-field tracking
// ---------------------------------------------------------------------------

/**
 * Collect fields that are missing or null in the raw record.
 */
function collectMissingFields(record) {
  const required = [
    "page_from",
    "domain_from",
    "page_to",
    "anchor",
    "semantic_location",
    "link_type",
    "domain_from_rank",
    "page_from_rank",
    "spam_score",
    "first_seen",
    "last_seen",
    "external_links_count",
  ];

  return required.filter(
    (f) => record[f] == null || record[f] === "",
  );
}

// ---------------------------------------------------------------------------
// Confidence computation
// ---------------------------------------------------------------------------

/**
 * Compute overall classification confidence (0–1).
 *
 * Weighted from factor confidences plus source completeness.
 */
function computeConfidence(
  relevanceConf,
  authorityConf,
  placementConf,
  spamConf,
  missingFields,
  competitorOverlapCount,
) {
  // Source completeness: fewer missing fields = higher confidence
  const totalRelevant = 12;
  const available = totalRelevant - missingFields.length;
  const sourceCompleteness = Math.max(0, available / totalRelevant);

  // Competitor overlap confidence: higher overlap = more confident about opportunity
  let competitorConf = 0.5;
  if (competitorOverlapCount >= 2) competitorConf = 0.85;
  else if (competitorOverlapCount === 1) competitorConf = 0.65;
  else if (competitorOverlapCount === 0) competitorConf = 0.5;

  const confidence =
    sourceCompleteness * 0.25 +
    relevanceConf * 0.25 +
    spamConf * 0.2 +
    placementConf * 0.2 +
    competitorConf * 0.1;

  return Math.min(1, Math.max(0, Math.round(confidence * 100) / 100));
}

/**
 * Map a numeric confidence value to a band label.
 */
function confidenceBand(confidence) {
  if (confidence >= 0.85) return "high confidence";
  if (confidence >= 0.7) return "moderate confidence";
  if (confidence >= 0.5) return "limited confidence";
  return "directional only";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize a single raw backlink record into the Vantage format.
 *
 * @param {object} raw - Raw DataForSEO backlink record.
 * @param {object} context - Additional context.
 * @param {string} context.targetDomain - The target domain being audited.
 * @returns {object} Normalized backlink record per PRD §11.2.
 */
export function normalizeBacklink(raw, context = {}) {
  const targetDomain = context.targetDomain || "";

  // Factor scores with confidence
  const relevance = computeRelevanceScore(raw);
  const authority = computeAuthorityScore(raw);
  const placement = computePlacementScore(raw);
  const spam = computeSpamSafetyScore(raw);

  const backlinkQualityScore =
    relevance.score + authority.score + placement.score + spam.score;

  const missingFields = collectMissingFields(raw);

  const hasCompetitors =
    context.competitorDomains && context.competitorDomains.length > 0;

  const competitorOverlapCount = hasCompetitors
    ? (raw.competitor_overlap_count != null
        ? raw.competitor_overlap_count
        : 0)
    : 0;

  const classificationConfidence = computeConfidence(
    relevance.confidence,
    authority.confidence,
    placement.confidence,
    spam.confidence,
    missingFields,
    competitorOverlapCount,
  );

  // Build rationale based on scores and missing data
  const rationaleParts = [];
  if (spam.missing) rationaleParts.push("spam score missing");
  if (missingFields.length > 0) {
    rationaleParts.push(`${missingFields.length} field(s) missing`);
  }
  if (relevance.score >= 18) rationaleParts.push("relevant topic match");
  if (authority.score >= 18) rationaleParts.push("strong authority signal");
  if (placement.score >= 18) rationaleParts.push("editorial placement");
  if (spam.score >= 25) rationaleParts.push("low spam risk");
  if (competitorOverlapCount >= 1) {
    rationaleParts.push(
      `present in ${competitorOverlapCount} competitor(s)`,
    );
  }

  const anchors = (raw.link_attributes || []).join(",");

  return {
    source: "dataforseo",
    targetDomain,
    referringDomain: raw.domain_from || null,
    referringPageUrl: raw.page_from || null,
    targetUrl: raw.page_to || null,
    anchorText: raw.anchor || null,
    linkType: raw.link_type || "anchor",
    linkAttributes: raw.link_attributes || [],
    semanticLocation: raw.semantic_location || null,
    firstSeen: raw.first_seen || null,
    lastSeen: raw.last_seen || null,
    isLost: raw.is_lost || false,
    linksCount: raw.links_count != null ? raw.links_count : 0,
    externalLinksCount:
      raw.external_links_count != null ? raw.external_links_count : 0,
    domainRank: raw.domain_from_rank != null ? raw.domain_from_rank : null,
    pageRank: raw.page_from_rank != null ? raw.page_from_rank : null,
    spamScore: raw.spam_score != null ? raw.spam_score : null,
    targetSpamScore:
      raw.target_spam_score != null ? raw.target_spam_score : null,
    competitorOverlapCount,
    clientHasLinkFromDomain:
      raw.client_has_link_from_domain != null
        ? raw.client_has_link_from_domain
        : false,

    // Factor scores
    relevanceScore: relevance.score,
    authorityScore: authority.score,
    placementScore: placement.score,
    spamSafetyScore: spam.score,
    backlinkQualityScore,

    // Classification fields set by classifier (initialized as null)
    bucket: null,
    classificationConfidence,
    evidenceClass: null,
    rationale: rationaleParts.length > 0
      ? rationaleParts.join("; ") + "."
      : "automated classification based on available signals.",

    // Metadata for downstream consumers
    _missingFields: missingFields,
    _spamScoreMissing: spam.missing || false,
    _isSpammyAnchor: isSpammyAnchor(raw.anchor),
  };
}

/**
 * Normalize an array of raw backlink records.
 *
 * Deduplication: records with the same referringPageUrl and targetUrl
 * are collapsed; only the first occurrence is kept.
 *
 * @param {Array<object>} rawBacklinks - Raw DataForSEO backlink records.
 * @param {object} context - Additional context.
 * @returns {Array<object>} Array of normalized backlink records.
 */
export function normalizeBacklinks(rawBacklinks, context = {}) {
  const seen = new Set();
  const normalized = [];

  for (const raw of rawBacklinks) {
    const key = `${raw.page_from || ""}::${raw.page_to || ""}`;

    if (seen.has(key)) {
      // Mark duplicate for ignore classification
      const dup = normalizeBacklink(raw, context);
      dup._isDuplicate = true;
      normalized.push(dup);
      continue;
    }

    seen.add(key);
    normalized.push(normalizeBacklink(raw, context));
  }

  return normalized;
}

export default {
  normalizeBacklink,
  normalizeBacklinks,
};

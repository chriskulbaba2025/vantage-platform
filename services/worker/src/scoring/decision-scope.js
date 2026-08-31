/**
 * PRYSM interpretation-integrity decision scope.
 *
 * Canonical crawl evidence remains untouched.
 *
 * This module creates a read-only scoring/reporting view that excludes
 * clearly non-commercial utility/infrastructure pages from page-level
 * site conclusions.
 *
 * Utility pages can remain in canonical evidence and evidence appendices,
 * but they must not distort commercial page counts, content averages,
 * metadata findings, heading findings, or page-order interpretation.
 */

const UTILITY_PATH_PATTERNS = Object.freeze([
  /^\/cdn-cgi(?:\/|$)/i,
  /^\/privacy(?:[-/]|$)/i,
  /^\/accessibility(?:[-/]|$)/i,
  /^\/terms(?:[-/]|$)/i,
  /^\/cookie(?:[-/]|$)/i,
  /^\/legal(?:[-/]|$)/i,
  /^\/sitemap(?:[-./]|$)/i,
  /^\/wp-admin(?:\/|$)/i,
  /^\/wp-login(?:\.php)?(?:\/|$)/i,
  /^\/search(?:\/|$)/i,
  /^\/404(?:\/|$)/i,
  /^\/page-not-found(?:\/|$)/i,
  /^\/feed(?:\/|$)/i,
  /^\/rss(?:\/|$)/i,
]);

function pageUrl(page) {
  return (
    page?.crawledUrl ||
    page?.url ||
    page?.finalUrl ||
    ""
  );
}

function pathnameOf(value) {
  try {
    return new URL(value).pathname || "/";
  } catch {
    return "";
  }
}

export function isUtilityDecisionPage(page) {
  const path = pathnameOf(pageUrl(page));

  if (!path) return false;

  return UTILITY_PATH_PATTERNS.some(
    (pattern) => pattern.test(path),
  );
}

function finiteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

function wordsForPage(page) {
  if (finiteNumber(page?.words)) {
    return page.words;
  }

  if (finiteNumber(page?.wordCount)) {
    return page.wordCount;
  }

  return null;
}

function descriptionForPage(page) {
  if (
    typeof page?.description === "string"
  ) {
    return page.description;
  }

  if (
    typeof page?.metaDescription === "string"
  ) {
    return page.metaDescription;
  }

  return null;
}

function canonicalForPage(page) {
  if (
    Object.prototype.hasOwnProperty.call(
      page || {},
      "canonical",
    )
  ) {
    return page.canonical;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      page || {},
      "canonicalUrl",
    )
  ) {
    return page.canonicalUrl;
  }

  return undefined;
}

/**
 * Build the site object used only for scoring/report interpretation.
 *
 * The input object is never mutated.
 */
export function scopeSiteForDecision(site) {
  if (
    !site ||
    !Array.isArray(site.pages) ||
    site.pages.length === 0
  ) {
    return site;
  }

    const decisionPages = site.pages.filter(
    (page) => !isUtilityDecisionPage(page),
  );

  const imageMetricsFor =
    (pages) => {
      const sourceImages =
        site.pages.flatMap(
          (page) =>
            Array.isArray(
              page?.images,
            )
              ? page.images
              : [],
        );

      const pageEvidenceReconciles =
        finiteNumber(
          site.imageCount,
        ) &&
        site.imageCount >= 0 &&
        sourceImages.length ===
          site.imageCount;

      if (!pageEvidenceReconciles) {
        return {
          imageCount: null,
          imagesMissingAlt: null,
          imagesMissingDimensions:
            null,
        };
      }

      const images =
        pages.flatMap(
          (page) =>
            Array.isArray(
              page?.images,
            )
              ? page.images
              : [],
        );

      return {
        imageCount:
          images.length,

        imagesMissingAlt:
          images.filter(
            (image) =>
              !String(
                image?.alt || "",
              ).trim(),
          ).length,

        imagesMissingDimensions:
          images.filter(
            (image) =>
              !image?.width ||
              !image?.height,
          ).length,
      };
    };

  const imageNumerators = [
    site.imagesMissingAlt,
    site.imagesMissingDimensions,
  ].filter(finiteNumber);

  const imageDenominatorInvalid =
    imageNumerators.some(
      (value) =>
        !finiteNumber(
          site.imageCount,
        ) ||
        site.imageCount < 0 ||
        value < 0 ||
        value >
          site.imageCount,
    );

  // Nothing classified as utility: preserve the object unless
  // an impossible image numerator/denominator pair must be neutralized.
  if (
    decisionPages.length ===
    site.pages.length
  ) {
    if (
      !imageDenominatorInvalid
    ) {
      return site;
    }

    return {
      ...site,
      ...imageMetricsFor(
        site.pages,
      ),
    };
  }

  // Conservative fail-safe. If every discovered page is utility-like,
  // do not fabricate an empty commercial site here.
  if (
    decisionPages.length === 0
  ) {
    return imageDenominatorInvalid
      ? {
          ...site,
          ...imageMetricsFor(
            site.pages,
          ),
        }
      : site;
  }

  const scoped = {
    ...site,
    ...imageMetricsFor(
      decisionPages,
    ),
    pages: decisionPages,
    pageCount:
      decisionPages.length,
  };

  // ── Content depth ──────────────────────────────────────────────────

  const wordCounts = decisionPages
    .map(wordsForPage)
    .filter(finiteNumber);

  if (wordCounts.length > 0) {
    scoped.totalWords = wordCounts.reduce(
      (sum, value) => sum + value,
      0,
    );

    scoped.averageWords = Math.round(
      scoped.totalWords / wordCounts.length,
    );
  }

  // ── Page metadata ──────────────────────────────────────────────────

  const titlesAvailable = decisionPages.every(
    (page) =>
      typeof page?.title === "string",
  );

  if (titlesAvailable) {
    scoped.missingTitles = decisionPages.filter(
      (page) =>
        !String(page.title || "").trim(),
    ).length;
  }

  const descriptions = decisionPages.map(
    descriptionForPage,
  );

  if (
    descriptions.every(
      (value) => value !== null,
    )
  ) {
    scoped.missingDescriptions =
      descriptions.filter(
        (value) =>
          !String(value || "").trim(),
      ).length;
  }

  const canonicals = decisionPages.map(
    canonicalForPage,
  );

  if (
    canonicals.every(
      (value) => value !== undefined,
    )
  ) {
    scoped.missingCanonicals =
      canonicals.filter(
        (value) => !value,
      ).length;
  }

  // ── Heading structure ──────────────────────────────────────────────

  const headingsAvailable =
    decisionPages.every(
      (page) =>
        page?.headings &&
        Array.isArray(page.headings.h1),
    );

  if (headingsAvailable) {
    scoped.h1Missing =
      decisionPages.filter(
        (page) =>
          page.headings.h1.length === 0,
      ).length;

    scoped.h1Multiple =
      decisionPages.filter(
        (page) =>
          page.headings.h1.length > 1,
      ).length;
  }

  return scoped;
}

export default {
  isUtilityDecisionPage,
  scopeSiteForDecision,
};

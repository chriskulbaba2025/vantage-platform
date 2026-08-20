/**
 * PRYSM Narrative v2 — source-native to canonical field lineage registry.
 *
 * The provider payload is strict. This registry preserves exact provider
 * terminology while keeping the governed PRYSM domain model provider-neutral.
 * The adapter normalization boundary is the ONLY place where alternate source
 * fields may be resolved. Downstream consumers must use canonicalField exactly
 * and must never guess aliases.
 */

export const LINEAGE_TRANSFORMATION = Object.freeze({
  IDENTITY: "identity",
  DERIVED: "derived",
  BOUNDED_NORMALIZATION: "bounded-normalization",
});

function dfsEntry({ source, sourceField, canonicalField, transformation = LINEAGE_TRANSFORMATION.IDENTITY, legacySourceFields = [] }) {
  return Object.freeze({
    source,
    provider: "dataforseo",
    sourceField,
    canonicalField,
    transformation,
    legacySourceFields: Object.freeze([...legacySourceFields]),
  });
}

const dfsOnPage = (sourceField, canonicalField, transformation = LINEAGE_TRANSFORMATION.IDENTITY, legacySourceFields = []) =>
  dfsEntry({ source: "dataforseo-onpage", sourceField, canonicalField, transformation, legacySourceFields });

const dfsSerp = (sourceField, canonicalField, transformation = LINEAGE_TRANSFORMATION.IDENTITY, legacySourceFields = []) =>
  dfsEntry({ source: "dataforseo-serp", sourceField, canonicalField, transformation, legacySourceFields });

const dfsBacklinks = (sourceField, canonicalField, transformation = LINEAGE_TRANSFORMATION.IDENTITY, legacySourceFields = []) =>
  dfsEntry({ source: "backlinks", sourceField, canonicalField, transformation, legacySourceFields });

/**
 * Exact DataForSEO On-Page field paths verified against the production adapter.
 *
 * `legacySourceFields` records compatibility fallbacks that already exist at
 * the adapter boundary. They are NOT valid downstream aliases.
 */
export const DATAFORSEO_ONPAGE_LINEAGE = Object.freeze([
  dfsOnPage("url", "site.pages[].crawledUrl"),
  dfsOnPage("location", "site.pages[].finalUrl", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["url"]),
  dfsOnPage("status_code", "site.pages[].statusCode"),
  dfsOnPage("meta.robots", "site.pages[].robotsDirectives", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["meta.follow"]),
  dfsOnPage("meta.canonical", "site.pages[].canonicalUrl", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["canonical"]),
  dfsOnPage("meta.title", "site.pages[].title"),
  dfsOnPage("meta.description", "site.pages[].metaDescription"),
  dfsOnPage("meta.htags.h1", "site.pages[].headings.h1"),
  dfsOnPage("meta.htags.h2", "site.pages[].headings.h2"),
  dfsOnPage("meta.htags.h3", "site.pages[].headings.h3"),
  dfsOnPage("meta.htags.h4", "site.pages[].headings.h4"),
  dfsOnPage("meta.htags.h5", "site.pages[].headings.h5"),
  dfsOnPage("meta.htags.h6", "site.pages[].headings.h6"),
  dfsOnPage("meta.content.plain_text_word_count", "site.pages[].wordCount", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["meta.word_count", "content.word_count"]),
  dfsOnPage("meta.internal_links_count", "site.pages[].internalInlinks"),
  dfsOnPage("meta.external_links_count", "site.pages[].externalOutlinks"),
  dfsOnPage("meta.images_count", "site.pages[].imageCount"),
  dfsOnPage("meta.images_size", "site.pages[].imagesSizeBytes"),
  dfsOnPage("checks.has_micromarkup", "site.pages[].hasMicrodata", LINEAGE_TRANSFORMATION.DERIVED),
  dfsOnPage("checks.from_sitemap", "site.pages[].sitemapMembership", LINEAGE_TRANSFORMATION.DERIVED),
  dfsOnPage("click_depth", "site.pages[].crawlDepth", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["crawl_depth"]),
  dfsOnPage("fetch_timing.duration_time", "site.pages[].responseTimeMs", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["page_timing.duration_time"]),
  dfsOnPage("size", "site.pages[].pageSizeBytes"),
]);

/**
 * Site aggregate fields are deterministic reductions of registered page-level
 * evidence. Their sourceField names point to the exact DataForSEO observations
 * that supply the aggregate.
 */
export const DATAFORSEO_ONPAGE_AGGREGATE_LINEAGE = Object.freeze([
  dfsOnPage("meta.title", "site.missingTitles", LINEAGE_TRANSFORMATION.DERIVED),
  dfsOnPage("meta.description", "site.missingDescriptions", LINEAGE_TRANSFORMATION.DERIVED),
  dfsOnPage("meta.canonical", "site.missingCanonicals", LINEAGE_TRANSFORMATION.DERIVED),
  dfsOnPage("meta.htags.h1", "site.h1Missing", LINEAGE_TRANSFORMATION.DERIVED),
  dfsOnPage("meta.htags.h1", "site.h1Multiple", LINEAGE_TRANSFORMATION.DERIVED),
  dfsOnPage("meta.content.plain_text_word_count", "site.totalWords", LINEAGE_TRANSFORMATION.DERIVED),
  dfsOnPage("meta.content.plain_text_word_count", "site.averageWords", LINEAGE_TRANSFORMATION.DERIVED),
  dfsOnPage("meta.images_count", "site.imageCount", LINEAGE_TRANSFORMATION.DERIVED),
  dfsOnPage("meta.internal_links_count", "site.internalLinkCount", LINEAGE_TRANSFORMATION.DERIVED),
]);

/**
 * Exact DataForSEO SERP fields used by the production SERP client before its
 * single normalization boundary. `rank_group` is a source fallback for
 * `rank_absolute`; it is not a downstream alias.
 */
export const DATAFORSEO_SERP_LINEAGE = Object.freeze([
  dfsSerp("url", "competitors[].url"),
  dfsSerp("domain", "competitors[].domain"),
  dfsSerp("title", "competitors[].evidence.title"),
  dfsSerp("rank_absolute", "competitors[].evidence.position", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["rank_group"]),
  dfsSerp("featured_snippet", "competitors[].evidence.serpFeatures", LINEAGE_TRANSFORMATION.DERIVED),
]);

/**
 * Exact DataForSEO Backlinks fields used by the production backlink provider.
 * Record-level aliases listed here are provider fallbacks resolved only inside
 * normalize(); summary fields retain DataForSEO's snake_case terminology in
 * sourceField and one stable PRYSM canonical destination.
 */
export const DATAFORSEO_BACKLINKS_LINEAGE = Object.freeze([
  dfsBacklinks("domain_from", "backlinks.records[].referringDomain"),
  dfsBacklinks("page_from", "backlinks.records[].referringPageUrl"),
  dfsBacklinks("page_to", "backlinks.records[].targetUrl"),
  dfsBacklinks("anchor", "backlinks.records[].anchorText"),
  dfsBacklinks("semantic_location", "backlinks.records[].semanticLocation"),
  dfsBacklinks("domain_from_rank", "backlinks.records[].domainRank", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["rank"]),
  dfsBacklinks("backlinks_spam_score", "backlinks.records[].spamScore", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["spam_score"]),
  dfsBacklinks("rank", "backlinks.authoritySummary.rank"),
  dfsBacklinks("backlinks", "backlinks.authoritySummary.backlinks"),
  dfsBacklinks("referring_domains", "backlinks.authoritySummary.referringDomains"),
  dfsBacklinks("referring_pages", "backlinks.authoritySummary.referringPages"),
  dfsBacklinks("backlinks_spam_score", "backlinks.authoritySummary.backlinksSpamScore"),
  dfsBacklinks("target_spam_score", "backlinks.authoritySummary.targetSpamScore"),
]);

export const SOURCE_FIELD_LINEAGE = Object.freeze([
  ...DATAFORSEO_ONPAGE_LINEAGE,
  ...DATAFORSEO_ONPAGE_AGGREGATE_LINEAGE,
  ...DATAFORSEO_SERP_LINEAGE,
  ...DATAFORSEO_BACKLINKS_LINEAGE,
]);

const byCanonical = new Map(SOURCE_FIELD_LINEAGE.map((entry) => [entry.canonicalField, entry]));
const bySource = new Map(SOURCE_FIELD_LINEAGE.map((entry) => [`${entry.source}:${entry.sourceField}:${entry.canonicalField}`, entry]));

export function getLineageByCanonicalField(canonicalField) {
  return byCanonical.get(canonicalField) || null;
}

export function resolveRegisteredLineage({ source, sourceField, canonicalField }) {
  return bySource.get(`${source}:${sourceField}:${canonicalField}`) || null;
}

export function assertRegisteredCanonicalField(canonicalField) {
  const entry = getLineageByCanonicalField(canonicalField);
  if (!entry) throw new Error(`Unregistered canonical field: ${canonicalField}`);
  return entry;
}

export function assertRegisteredLineage(ref) {
  const entry = resolveRegisteredLineage(ref || {});
  if (!entry) {
    throw new Error(
      `Unregistered source lineage: ${ref?.source || ""}:${ref?.sourceField || ""}->${ref?.canonicalField || ""}`,
    );
  }
  return entry;
}

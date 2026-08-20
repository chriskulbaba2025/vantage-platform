/**
 * PRYSM Narrative v2 — source-native to canonical field lineage registry.
 *
 * The provider payload is strict.  This registry preserves exact provider
 * terminology while keeping the governed PRYSM domain model provider-neutral.
 * The adapter normalization boundary is the ONLY place where alternate source
 * fields may be resolved.  Downstream consumers must use canonicalField
 * exactly and must never guess aliases.
 */

export const LINEAGE_TRANSFORMATION = Object.freeze({
  IDENTITY: "identity",
  DERIVED: "derived",
  BOUNDED_NORMALIZATION: "bounded-normalization",
});

const dfs = (sourceField, canonicalField, transformation = LINEAGE_TRANSFORMATION.IDENTITY, legacySourceFields = []) =>
  Object.freeze({
    source: "dataforseo-onpage",
    provider: "dataforseo",
    sourceField,
    canonicalField,
    transformation,
    legacySourceFields: Object.freeze([...legacySourceFields]),
  });

/**
 * Exact DataForSEO On-Page field paths verified against the production adapter.
 *
 * `legacySourceFields` records compatibility fallbacks that already exist at
 * the adapter boundary.  They are NOT valid downstream aliases.
 */
export const DATAFORSEO_ONPAGE_LINEAGE = Object.freeze([
  dfs("url", "site.pages[].crawledUrl"),
  dfs("location", "site.pages[].finalUrl", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["url"]),
  dfs("status_code", "site.pages[].statusCode"),
  dfs("meta.robots", "site.pages[].robotsDirectives", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["meta.follow"]),
  dfs("meta.canonical", "site.pages[].canonicalUrl", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["canonical"]),
  dfs("meta.title", "site.pages[].title"),
  dfs("meta.description", "site.pages[].metaDescription"),
  dfs("meta.htags.h1", "site.pages[].headings.h1"),
  dfs("meta.htags.h2", "site.pages[].headings.h2"),
  dfs("meta.htags.h3", "site.pages[].headings.h3"),
  dfs("meta.htags.h4", "site.pages[].headings.h4"),
  dfs("meta.htags.h5", "site.pages[].headings.h5"),
  dfs("meta.htags.h6", "site.pages[].headings.h6"),
  dfs("meta.content.plain_text_word_count", "site.pages[].wordCount", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["meta.word_count", "content.word_count"]),
  dfs("meta.internal_links_count", "site.pages[].internalInlinks"),
  dfs("meta.external_links_count", "site.pages[].externalOutlinks"),
  dfs("meta.images_count", "site.pages[].imageCount"),
  dfs("meta.images_size", "site.pages[].imagesSizeBytes"),
  dfs("checks.has_micromarkup", "site.pages[].hasMicrodata", LINEAGE_TRANSFORMATION.DERIVED),
  dfs("checks.from_sitemap", "site.pages[].sitemapMembership", LINEAGE_TRANSFORMATION.DERIVED),
  dfs("click_depth", "site.pages[].crawlDepth", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["crawl_depth"]),
  dfs("fetch_timing.duration_time", "site.pages[].responseTimeMs", LINEAGE_TRANSFORMATION.BOUNDED_NORMALIZATION, ["page_timing.duration_time"]),
  dfs("size", "site.pages[].pageSizeBytes"),
]);

/**
 * Site aggregate fields are deterministic reductions of registered page-level
 * evidence.  Their sourceField names intentionally point to the exact
 * DataForSEO field that supplies the underlying observations.
 */
export const DATAFORSEO_ONPAGE_AGGREGATE_LINEAGE = Object.freeze([
  dfs("meta.title", "site.missingTitles", LINEAGE_TRANSFORMATION.DERIVED),
  dfs("meta.description", "site.missingDescriptions", LINEAGE_TRANSFORMATION.DERIVED),
  dfs("meta.canonical", "site.missingCanonicals", LINEAGE_TRANSFORMATION.DERIVED),
  dfs("meta.htags.h1", "site.h1Missing", LINEAGE_TRANSFORMATION.DERIVED),
  dfs("meta.htags.h1", "site.h1Multiple", LINEAGE_TRANSFORMATION.DERIVED),
  dfs("meta.content.plain_text_word_count", "site.totalWords", LINEAGE_TRANSFORMATION.DERIVED),
  dfs("meta.content.plain_text_word_count", "site.averageWords", LINEAGE_TRANSFORMATION.DERIVED),
  dfs("meta.images_count", "site.imageCount", LINEAGE_TRANSFORMATION.DERIVED),
  dfs("meta.internal_links_count", "site.internalLinkCount", LINEAGE_TRANSFORMATION.DERIVED),
]);

export const SOURCE_FIELD_LINEAGE = Object.freeze([
  ...DATAFORSEO_ONPAGE_LINEAGE,
  ...DATAFORSEO_ONPAGE_AGGREGATE_LINEAGE,
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

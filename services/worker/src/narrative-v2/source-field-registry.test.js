import test from "node:test";
import assert from "node:assert/strict";

import {
  DATAFORSEO_ONPAGE_LINEAGE,
  DATAFORSEO_SERP_LINEAGE,
  DATAFORSEO_BACKLINKS_LINEAGE,
  SOURCE_FIELD_LINEAGE,
  getLineageByCanonicalField,
  resolveRegisteredLineage,
  assertRegisteredCanonicalField,
  assertRegisteredLineage,
} from "./source-field-registry.js";

test("LINEAGE-DFS-01: registered DataForSEO On-Page paths retain exact provider terminology", () => {
  const canonical = getLineageByCanonicalField("site.pages[].canonicalUrl");
  assert.equal(canonical.source, "dataforseo-onpage");
  assert.equal(canonical.provider, "dataforseo");
  assert.equal(canonical.sourceField, "meta.canonical");

  const description = getLineageByCanonicalField("site.pages[].metaDescription");
  assert.equal(description.sourceField, "meta.description");

  const h1 = getLineageByCanonicalField("site.pages[].headings.h1");
  assert.equal(h1.sourceField, "meta.htags.h1");

  const status = getLineageByCanonicalField("site.pages[].statusCode");
  assert.equal(status.sourceField, "status_code");
});

test("LINEAGE-DFS-02: compatibility fallbacks are recorded but are not downstream aliases", () => {
  const canonical = getLineageByCanonicalField("site.pages[].canonicalUrl");
  assert.deepEqual(canonical.legacySourceFields, ["canonical"]);

  assert.equal(
    resolveRegisteredLineage({
      source: "dataforseo-onpage",
      sourceField: "canonical",
      canonicalField: "site.pages[].canonicalUrl",
    }),
    null,
  );
});

test("LINEAGE-DFS-03: unknown canonical names fail closed", () => {
  assert.throws(
    () => assertRegisteredCanonicalField("site.pages[].canonical"),
    /Unregistered canonical field/,
  );
  assert.throws(
    () => assertRegisteredCanonicalField("site.missingCanonicalTags"),
    /Unregistered canonical field/,
  );
});

test("LINEAGE-DFS-04: unknown source-to-canonical tuples fail closed", () => {
  assert.throws(
    () => assertRegisteredLineage({
      source: "dataforseo-onpage",
      sourceField: "meta_description",
      canonicalField: "site.pages[].metaDescription",
    }),
    /Unregistered source lineage/,
  );
});

test("LINEAGE-DFS-05: no duplicate canonical registrations exist", () => {
  const fields = SOURCE_FIELD_LINEAGE.map((entry) => entry.canonicalField);
  assert.equal(new Set(fields).size, fields.length);
});

test("LINEAGE-DFS-06: core On-Page technical fields required by report interpretation are registered", () => {
  const required = [
    "site.pages[].title",
    "site.pages[].metaDescription",
    "site.pages[].canonicalUrl",
    "site.pages[].headings.h1",
    "site.pages[].wordCount",
    "site.pages[].internalInlinks",
    "site.pages[].externalOutlinks",
    "site.pages[].imageCount",
    "site.pages[].imagesSizeBytes",
    "site.pages[].hasMicrodata",
    "site.pages[].sitemapMembership",
    "site.pages[].crawlDepth",
    "site.pages[].responseTimeMs",
    "site.pages[].pageSizeBytes",
    "site.missingTitles",
    "site.missingDescriptions",
    "site.missingCanonicals",
    "site.h1Missing",
    "site.h1Multiple",
  ];

  for (const field of required) {
    assert.ok(getLineageByCanonicalField(field), `missing lineage for ${field}`);
  }

  assert.ok(DATAFORSEO_ONPAGE_LINEAGE.length >= 20);
});

test("LINEAGE-DFS-07: SERP lineage uses exact DataForSEO response names", () => {
  assert.equal(getLineageByCanonicalField("competitors[].url").sourceField, "url");
  assert.equal(getLineageByCanonicalField("competitors[].domain").sourceField, "domain");
  assert.equal(getLineageByCanonicalField("competitors[].evidence.title").sourceField, "title");

  const position = getLineageByCanonicalField("competitors[].evidence.position");
  assert.equal(position.source, "dataforseo-serp");
  assert.equal(position.sourceField, "rank_absolute");
  assert.deepEqual(position.legacySourceFields, ["rank_group"]);

  assert.ok(DATAFORSEO_SERP_LINEAGE.length >= 5);
});

test("LINEAGE-DFS-08: SERP rank fallback is not accepted as a downstream alias", () => {
  assert.equal(
    resolveRegisteredLineage({
      source: "dataforseo-serp",
      sourceField: "rank_group",
      canonicalField: "competitors[].evidence.position",
    }),
    null,
  );
});

test("LINEAGE-DFS-09: backlink lineage uses exact DataForSEO record and summary names", () => {
  assert.equal(getLineageByCanonicalField("backlinks.records[].referringDomain").sourceField, "domain_from");
  assert.equal(getLineageByCanonicalField("backlinks.records[].referringPageUrl").sourceField, "page_from");
  assert.equal(getLineageByCanonicalField("backlinks.records[].targetUrl").sourceField, "page_to");
  assert.equal(getLineageByCanonicalField("backlinks.records[].anchorText").sourceField, "anchor");
  assert.equal(getLineageByCanonicalField("backlinks.authoritySummary.referringDomains").sourceField, "referring_domains");
  assert.equal(getLineageByCanonicalField("backlinks.authoritySummary.targetSpamScore").sourceField, "target_spam_score");

  const rank = getLineageByCanonicalField("backlinks.records[].domainRank");
  assert.equal(rank.sourceField, "domain_from_rank");
  assert.deepEqual(rank.legacySourceFields, ["rank"]);

  assert.ok(DATAFORSEO_BACKLINKS_LINEAGE.length >= 10);
});

test("LINEAGE-DFS-10: backlink fallback fields are adapter-only and fail as downstream references", () => {
  assert.equal(
    resolveRegisteredLineage({
      source: "backlinks",
      sourceField: "spam_score",
      canonicalField: "backlinks.records[].spamScore",
    }),
    null,
  );
});

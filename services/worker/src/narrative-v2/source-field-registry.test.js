import test from "node:test";
import assert from "node:assert/strict";

import {
  DATAFORSEO_ONPAGE_LINEAGE,
  SOURCE_FIELD_LINEAGE,
  getLineageByCanonicalField,
  resolveRegisteredLineage,
  assertRegisteredCanonicalField,
  assertRegisteredLineage,
} from "./source-field-registry.js";

test("LINEAGE-DFS-01: registered DataForSEO paths retain exact provider terminology", () => {
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

test("LINEAGE-DFS-06: core technical fields required by report interpretation are registered", () => {
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

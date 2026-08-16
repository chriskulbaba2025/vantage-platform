import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSourceExecutionIdentity } from "./audit-orchestrator.js";

// PRYSM-NEXT-01 WP-B-11 — source execution identity must include the new
// deep-acquisition options so config changes produce a new execution key.

const BASE_REQUEST = {
  auditId: "11111111-1111-4111-8111-111111111111",
  targetUrl: "https://example.com",
  language: "en-CA",
  market: "Toronto",
  services: ["Consulting"],
  competitors: [],
  crawl: {},
};

test("identical requests produce identical source execution keys", () => {
  const a = buildSourceExecutionIdentity({ auditRequest: BASE_REQUEST, source: "dataforseo-onpage", adapterVersion: "1.1.0" });
  const b = buildSourceExecutionIdentity({ auditRequest: BASE_REQUEST, source: "dataforseo-onpage", adapterVersion: "1.1.0" });
  assert.equal(a.sourceExecutionKey, b.sourceExecutionKey);
  assert.equal(a.configHash, b.configHash);
});

test("changing enableContentParsing changes the source execution key", () => {
  const base = buildSourceExecutionIdentity({ auditRequest: BASE_REQUEST, source: "dataforseo-onpage", adapterVersion: "1.1.0" });
  const changed = buildSourceExecutionIdentity({
    auditRequest: { ...BASE_REQUEST, crawl: { enableContentParsing: false } },
    source: "dataforseo-onpage",
    adapterVersion: "1.1.0",
  });
  assert.notEqual(base.sourceExecutionKey, changed.sourceExecutionKey);
});

test("changing validateMicromarkup changes the source execution key", () => {
  const base = buildSourceExecutionIdentity({ auditRequest: BASE_REQUEST, source: "dataforseo-onpage", adapterVersion: "1.1.0" });
  const changed = buildSourceExecutionIdentity({
    auditRequest: { ...BASE_REQUEST, crawl: { validateMicromarkup: false } },
    source: "dataforseo-onpage",
    adapterVersion: "1.1.0",
  });
  assert.notEqual(base.sourceExecutionKey, changed.sourceExecutionKey);
});

test("changing page limits changes the source execution key", () => {
  const base = buildSourceExecutionIdentity({ auditRequest: BASE_REQUEST, source: "dataforseo-onpage", adapterVersion: "1.1.0" });
  const changed = buildSourceExecutionIdentity({
    auditRequest: { ...BASE_REQUEST, crawl: { contentParsingPageLimit: 5, redirectChainsPageLimit: 5, nonIndexableLimit: 5, resourcesPageLimit: 5 } },
    source: "dataforseo-onpage",
    adapterVersion: "1.1.0",
  });
  assert.notEqual(base.sourceExecutionKey, changed.sourceExecutionKey);
});

test("key is stable across object key insertion order (stable stringify)", () => {
  const a = buildSourceExecutionIdentity({ auditRequest: BASE_REQUEST, source: "dataforseo-onpage", adapterVersion: "1.1.0" });
  const reordered = {
    ...BASE_REQUEST,
    crawl: { resourcesPageLimit: 10, enableContentParsing: true },
  };
  const b = buildSourceExecutionIdentity({ auditRequest: reordered, source: "dataforseo-onpage", adapterVersion: "1.1.0" });
  assert.equal(a.sourceExecutionKey, b.sourceExecutionKey);
});

test("adapter version participates in the key", () => {
  const a = buildSourceExecutionIdentity({ auditRequest: BASE_REQUEST, source: "dataforseo-onpage", adapterVersion: "1.0.0" });
  const b = buildSourceExecutionIdentity({ auditRequest: BASE_REQUEST, source: "dataforseo-onpage", adapterVersion: "1.1.0" });
  assert.notEqual(a.sourceExecutionKey, b.sourceExecutionKey);
});

test("PRYSM-NEXT-01 WP-E: path-validation options participate in the key", () => {
  const base = buildSourceExecutionIdentity({ auditRequest: BASE_REQUEST, source: "dataforseo-onpage", adapterVersion: "1.1.0" });
  const changed = buildSourceExecutionIdentity({
    auditRequest: { ...BASE_REQUEST, crawl: { pathValidationEnabled: false, pathValidationPageLimit: 2 } },
    source: "dataforseo-onpage",
    adapterVersion: "1.1.0",
  });
  assert.notEqual(base.sourceExecutionKey, changed.sourceExecutionKey);
});

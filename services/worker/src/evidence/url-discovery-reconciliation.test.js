import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeDiscoveryUrl, reconcileUrlDiscovery, URL_DISCOVERY_PROVENANCE } from "./url-discovery-reconciliation.js";

test("canonicalizes aliases without collapsing query policy or origin", () => {
  assert.equal(canonicalizeDiscoveryUrl("HTTPS://Example.com/a//?b=2&a=1#frag"), "https://example.com/a?a=1&b=2");
  assert.equal(canonicalizeDiscoveryUrl("https://other.example/x", "https://example.com/"), "https://other.example/x");
});

test("merges provenance and preserves redirect/canonical observations", () => {
  const result = reconcileUrlDiscovery({
    targetUrl: "https://example.com/",
    sources: {
      XML_SITEMAP: ["https://example.com/services/"],
      INTERNAL_LINK: [{ url: "https://example.com/services", canonicalUrl: "https://example.com/services/" }],
      DATAFORSEO: [{ url: "https://example.com/old", redirectTo: "https://example.com/services" }],
    },
  });
  const service = result.inventory.find((item) => item.url === "https://example.com/services");
  assert.deepEqual(service.provenance, ["INTERNAL_LINK", "XML_SITEMAP"]);
  assert.deepEqual(service.canonicalUrls, ["https://example.com/services"]);
  assert.equal(result.status, "AVAILABLE");
});

test("missing discovery is unknown/incomplete, never a negative URL conclusion", () => {
  const result = reconcileUrlDiscovery({
    targetUrl: "https://example.com/",
    sources: { XML_SITEMAP: null, LLMS_TXT: [] },
    sourceStatuses: { XML_SITEMAP: "UNAVAILABLE", LLMS_TXT: "UNAVAILABLE" },
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.coverageState, "INCOMPLETE");
  assert.equal(result.inventory.length, 0);
  assert.match(result.suspiciousCoverage.reasons.join(" "), /no usable discovery source/i);
});

test("provider partial coverage escalates without claiming absent pages", () => {
  const result = reconcileUrlDiscovery({
    targetUrl: "https://example.com/",
    sources: {
      XML_SITEMAP: Array.from({ length: 12 }, (_, i) => `https://example.com/page-${i}`),
      DATAFORSEO: ["https://example.com/"],
    },
    providerCoverage: { completed: 1 },
  });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.suspiciousCoverage.present, true);
  assert.equal(result.suspiciousCoverage.escalation, "BOUNDED_STRUCTURAL_BROWSER_DISCOVERY");
  assert.equal(result.inventory.length, 13);
});

test("competitor or cross-origin URLs do not enter the client inventory", () => {
  const result = reconcileUrlDiscovery({
    targetUrl: "https://example.com/",
    sources: { [URL_DISCOVERY_PROVENANCE.INTERNAL_LINK]: ["https://example.com/a", "https://competitor.example/b"] },
  });
  assert.deepEqual(result.inventory.map((item) => item.url), ["https://example.com/a"]);
});

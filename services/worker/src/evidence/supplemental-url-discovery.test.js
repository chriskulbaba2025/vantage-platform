import test from "node:test";
import assert from "node:assert/strict";
import { discoverSupplementalUrlSources } from "./supplemental-url-discovery.js";
import { discoverSitemapFootprint } from "./sitemap-footprint.js";

function response(text, status = 200) {
  return new Response(text, { status, headers: { "content-type": "text/html" } });
}

test("supplemental discovery preserves llms and HTML-sitemap provenance", async () => {
  const calls = [];
  const result = await discoverSupplementalUrlSources("https://example.com/", {
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/llms.txt")) return response("# Links\n- [Pricing](https://example.com/pricing)");
      if (url.endsWith("/sitemap.html")) return response('<a href="/services">Services</a><a href="https://other.test/no">No</a>');
      return response("", 404);
    },
  });
  assert.equal(result.statuses.LLMS_TXT, "AVAILABLE");
  assert.equal(result.statuses.HTML_SITEMAP, "AVAILABLE");
  assert.deepEqual(result.sources.LLMS_TXT.map((item) => item.url), ["https://example.com/pricing"]);
  assert.deepEqual(result.sources.HTML_SITEMAP.map((item) => item.url), ["https://example.com/services"]);
  assert.equal(calls.length, 4);
});

test("missing supplemental sources remain unavailable and bounded", async () => {
  let calls = 0;
  const result = await discoverSupplementalUrlSources("https://example.com/", {
    maxSources: 2,
    fetchImpl: async () => { calls += 1; return response("", 404); },
  });
  assert.equal(calls, 2);
  assert.equal(result.statuses.LLMS_TXT, "NOT_APPLICABLE");
  assert.equal(result.statuses.HTML_SITEMAP, "NOT_APPLICABLE");
  assert.deepEqual(result.sources, {});
});

test("expected absence of supporting sources does not degrade complete sitemap coverage", async () => {
  const result = await discoverSitemapFootprint("https://example.com/", {
    fetchImpl: async (url) => {
      if (url.endsWith("/robots.txt")) return response("", 404);
      if (url.endsWith("/sitemap.xml")) return response("<urlset><url><loc>https://example.com/</loc></url></urlset>");
      if (url.endsWith("/sitemap_index.xml")) return response("", 404);
      return response("", 404);
    },
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.urlInventory.sourceStatuses.LLMS_TXT, "NOT_APPLICABLE");
  assert.equal(result.urlInventory.coverageState, "SUFFICIENT");
});

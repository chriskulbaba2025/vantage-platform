import test from "node:test";
import assert from "node:assert/strict";

import {
  FOOTPRINT_STATUS,
  clusterSitemapUrls,
  discoverSitemapFootprint,
  selectPriorityUrls,
} from "./sitemap-footprint.js";

function makeResponse(body = "", status = 200, contentType = "application/xml") {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

function makeFetch(routes) {
  const calls = [];

  const fetchImpl = async (input) => {
    const url = String(input);
    calls.push(url);

    const route = routes[url];
    if (!route) return makeResponse("", 404, "text/plain");

    return makeResponse(
      route.body ?? "",
      route.status ?? 200,
      route.contentType ?? "application/xml",
    );
  };

  return { fetchImpl, calls };
}

test("recursively discovers sitemap indexes, filters cross-origin URLs, and deduplicates deterministically", async () => {
  const { fetchImpl, calls } = makeFetch({
    "https://example.com/robots.txt": {
      body: "Sitemap: https://example.com/root.xml",
      contentType: "text/plain",
    },
    "https://example.com/root.xml": {
      body: `
        <sitemapindex>
          <sitemap><loc>https://example.com/child-a.xml</loc></sitemap>
          <sitemap><loc>https://example.com/nested/index.xml</loc></sitemap>
        </sitemapindex>
      `,
    },
    "https://example.com/child-a.xml": {
      body: `
        <urlset>
          <url><loc>https://example.com/</loc></url>
          <url><loc>https://example.com/about/</loc></url>
          <url><loc>https://external.example/not-ours</loc></url>
        </urlset>
      `,
    },
    "https://example.com/nested/index.xml": {
      body: `
        <sitemapindex>
          <sitemap><loc>https://example.com/child-b.xml</loc></sitemap>
        </sitemapindex>
      `,
    },
    "https://example.com/child-b.xml": {
      body: `
        <urlset>
          <url><loc>https://example.com/contact/</loc></url>
          <url><loc>https://example.com/services/coaching?b=2&amp;a=1</loc></url>
          <url><loc>https://example.com/services/coaching?a=1&amp;b=2</loc></url>
        </urlset>
      `,
    },
  });

  const result = await discoverSitemapFootprint("https://example.com", {
    fetchImpl,
  });

  assert.equal(result.status, FOOTPRINT_STATUS.AVAILABLE);
  assert.equal(result.retainedUrlCount, 4);
  assert.equal(result.sitemapDocumentCount, 4);
  assert.equal(result.coverage.parsedSitemapDocumentCount, 4);
  assert.equal(result.coverage.skippedExternalPageUrlCount, 1);
  assert.equal(result.coverage.duplicateUrlCount, 1);
  assert.equal(result.capped, false);
  assert.equal(result.incomplete, false);

  assert.ok(calls.includes("https://example.com/root.xml"));
  assert.ok(calls.includes("https://example.com/child-a.xml"));
  assert.ok(calls.includes("https://example.com/nested/index.xml"));
  assert.ok(calls.includes("https://example.com/child-b.xml"));

  assert.ok(
    result.priorityUrls.includes(
      "https://example.com/services/coaching?a=1&b=2",
    ),
  );
  assert.ok(
    result.priorityUrls.every(
      (url) => new URL(url).origin === "https://example.com",
    ),
  );
});

test("reports sitemap-document and retained-URL caps instead of hiding incomplete coverage", async () => {
  const documentCapFetch = makeFetch({
    "https://example.com/robots.txt": {
      body: "Sitemap: https://example.com/root.xml",
      contentType: "text/plain",
    },
    "https://example.com/root.xml": {
      body: `
        <sitemapindex>
          <sitemap><loc>https://example.com/a.xml</loc></sitemap>
          <sitemap><loc>https://example.com/b.xml</loc></sitemap>
          <sitemap><loc>https://example.com/c.xml</loc></sitemap>
        </sitemapindex>
      `,
    },
    "https://example.com/a.xml": {
      body: `
        <urlset>
          <url><loc>https://example.com/a</loc></url>
        </urlset>
      `,
    },
  });

  const documentCapped = await discoverSitemapFootprint("https://example.com", {
    fetchImpl: documentCapFetch.fetchImpl,
    maxSitemapDocuments: 2,
  });

  assert.equal(documentCapped.status, FOOTPRINT_STATUS.PARTIAL);
  assert.equal(documentCapped.capped, true);
  assert.equal(documentCapped.incomplete, true);
  assert.equal(documentCapped.coverage.cappedByDocuments, true);
  assert.equal(documentCapped.sitemapDocumentCount, 2);
  assert.match(
    documentCapped.limitations.join(" "),
    /document cap/i,
  );

  const urlCapFetch = makeFetch({
    "https://example.com/robots.txt": {
      status: 404,
      contentType: "text/plain",
    },
    "https://example.com/sitemap.xml": {
      body: `
        <urlset>
          <url><loc>https://example.com/one</loc></url>
          <url><loc>https://example.com/two</loc></url>
          <url><loc>https://example.com/three</loc></url>
          <url><loc>https://example.com/four</loc></url>
          <url><loc>https://example.com/five</loc></url>
        </urlset>
      `,
    },
  });

  const urlCapped = await discoverSitemapFootprint("https://example.com", {
    fetchImpl: urlCapFetch.fetchImpl,
    maxRetainedUrls: 3,
  });

  assert.equal(urlCapped.status, FOOTPRINT_STATUS.PARTIAL);
  assert.equal(urlCapped.retainedUrlCount, 3);
  assert.equal(urlCapped.capped, true);
  assert.equal(urlCapped.incomplete, true);
  assert.equal(urlCapped.coverage.cappedByUrls, true);
  assert.match(
    urlCapped.limitations.join(" "),
    /URL retention cap/i,
  );
});

test("clusters repeated structural URL families deterministically without treating a small ordinary site as material", () => {
  const locationUrls = Array.from(
    { length: 20 },
    (_, index) => `https://example.com/locations/city-${String(index + 1).padStart(2, "0")}`,
  );

  const first = clusterSitemapUrls(locationUrls);
  const second = clusterSitemapUrls([...locationUrls].reverse());

  assert.deepEqual(first, second);

  const locationCluster = first.find(
    (cluster) => cluster.pattern === "/locations/{segment}",
  );

  assert.ok(locationCluster);
  assert.equal(locationCluster.discoveredUrlCount, 20);
  assert.equal(locationCluster.requiresRepresentativeAssessment, true);
  assert.ok(locationCluster.reasonCodes.includes("VARIABLE_SIBLING_FAMILY"));
  assert.ok(locationCluster.reasonCodes.includes("LARGE_REPEATED_FAMILY"));
  assert.ok(locationCluster.representativeUrls.length <= 3);

  const ordinarySite = clusterSitemapUrls([
    "https://example.com/",
    "https://example.com/about",
    "https://example.com/contact",
    "https://example.com/services",
    "https://example.com/pricing",
  ]);

  assert.equal(
    ordinarySite.some((cluster) => cluster.requiresRepresentativeAssessment),
    false,
  );
});

test("representative selection is deterministic, business-aware, cluster-aware, and bounded to 20 URLs", () => {
  const locationUrls = Array.from(
    { length: 30 },
    (_, index) => `https://example.com/locations/city-${String(index + 1).padStart(2, "0")}`,
  );

  const urls = [
    "https://example.com/",
    "https://example.com/about",
    "https://example.com/contact",
    "https://example.com/pricing",
    "https://example.com/services",
    "https://example.com/services/executive-coaching",
    "https://example.com/case-studies",
    ...locationUrls,
  ];

  const clusters = clusterSitemapUrls(urls);

  const first = selectPriorityUrls(
    "https://example.com",
    urls,
    clusters,
    { services: ["Executive Coaching"] },
  );

  const second = selectPriorityUrls(
    "https://example.com",
    [...urls].reverse(),
    [...clusters].reverse(),
    { services: ["Executive Coaching"] },
  );

  assert.deepEqual(first, second);
  assert.ok(first.length <= 20);
  assert.equal(first[0], "https://example.com/");
  assert.ok(first.includes("https://example.com/contact"));
  assert.ok(first.includes("https://example.com/pricing"));
  assert.ok(first.includes("https://example.com/services/executive-coaching"));

  const locationCluster = clusters.find(
    (cluster) => cluster.pattern === "/locations/{segment}",
  );

  assert.ok(locationCluster);
  assert.ok(
    locationCluster.representativeUrls.some((url) => first.includes(url)),
  );
});

test("fails soft when no usable sitemap exists and does not infer absence of programmatic SEO", async () => {
  const { fetchImpl } = makeFetch({
    "https://example.com/robots.txt": {
      status: 404,
      contentType: "text/plain",
    },
    "https://example.com/sitemap.xml": {
      status: 404,
    },
    "https://example.com/sitemap_index.xml": {
      status: 404,
    },
  });

  const result = await discoverSitemapFootprint("https://example.com", {
    fetchImpl,
  });

  assert.equal(result.status, FOOTPRINT_STATUS.UNAVAILABLE);
  assert.equal(result.retainedUrlCount, 0);
  assert.equal(result.incomplete, true);
  assert.equal(result.coverage.usableSitemap, false);
  assert.deepEqual(result.priorityUrls, ["https://example.com/"]);
  assert.match(
    result.limitations.join(" "),
    /does not prove absence of programmatic SEO/i,
  );
});
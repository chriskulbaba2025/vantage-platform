import test from "node:test";
import assert from "node:assert/strict";
import { crawlSite } from "./site-crawler.js";

function mockFetch(url) {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin" });
  if (url.endsWith("/robots.txt")) return Promise.resolve(new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } }));
  if (url.endsWith("/sitemap.xml")) return Promise.resolve(new Response('<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/coaching</loc></url></urlset>', { status: 200, headers: { "content-type": "application/xml" } }));
  if (url.endsWith("/sitemap_index.xml")) return Promise.resolve(new Response("", { status: 404 }));
  const html = url.includes("coaching")
    ? '<!doctype html><html lang="en-CA"><head><title>Coaching</title><meta name="description" content="Coaching support"><link rel="canonical" href="https://example.com/coaching"><script type="application/ld+json">{"@type":"Service"}</script></head><body><h1>Stress Recovery Coaching</h1><p>Certified coaching with 25 years experience. Pricing starts at $100.</p><a href="/contact">Book a call</a></body></html>'
    : '<!doctype html><html lang="en-CA"><head><title>Example Wellness</title><meta name="description" content="Stress recovery"><link rel="canonical" href="https://example.com/"><meta name="generator" content="GoDaddy Website Builder 8.0"></head><body><h1>Stress Recovery</h1><h2>Coaching Services</h2><p>Client testimonials and frequently asked questions. Privacy policy.</p><a href="/coaching">Learn more</a><form action="/contact"><input name="email"><button>Book now</button></form><img src="/hero.jpg" alt="Coach speaking" width="800" height="600"></body></html>';
  return Promise.resolve(new Response(html, { status: 200, headers }));
}

test("crawlSite captures page, trust, schema, CTA, platform, and technical evidence", async () => {
  const evidence = await crawlSite("https://example.com", { fetchImpl: mockFetch, browserMode: "never", maxPages: 5 });
  assert.ok(evidence.pageCount >= 2);
  assert.equal(evidence.platform, "GoDaddy Website Builder");
  assert.equal(evidence.missingDescriptions, 0);
  assert.equal(evidence.imagesMissingAlt, 0);
  assert.equal(evidence.trust.testimonials, true);
  assert.equal(evidence.trust.credentials, true);
  assert.equal(evidence.trust.faq, true);
  assert.equal(evidence.trust.pricing, true);
  assert.ok(evidence.schemaTypes.includes("Service"));
  assert.ok(evidence.ctas.some((cta) => /book/i.test(cta.text)));
  assert.equal(evidence.securityHeaders.xContentTypeOptions, true);
});

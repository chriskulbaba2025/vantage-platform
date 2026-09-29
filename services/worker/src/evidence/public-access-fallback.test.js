import test from "node:test";
import assert from "node:assert/strict";
import { isPrimaryAccessBlocked, collectPublicAccessFallback } from "./public-access-fallback.js";

const primary403 = {
  source: "dataforseo-onpage",
  sourceStatus: "FAILED",
  limitations: ["DataForSEO On-Page execution failed: HTTP 403 Forbidden"],
};

function fetchFixture(url) {
  const u = new URL(url);
  if (u.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /private/\n");
  if (u.pathname === "/sitemap.xml") return new Response("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"><url><loc>https://public.test/</loc></url></urlset>", { headers: { "content-type": "application/xml" } });
  if (u.pathname === "/private/") return new Response("<html><title>Private</title><body>Private</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  return new Response("<html><head><title>Public service</title></head><body><h1>Public service</h1><a href=\"/contact/\">Contact us</a><h2>Website development</h2></body></html>", { status: 200, headers: { "content-type": "text/html" } });
}

test("public fallback is selected only for an evidenced provider access block", () => {
  assert.equal(isPrimaryAccessBlocked(primary403), true);
  assert.equal(isPrimaryAccessBlocked({ ...primary403, limitations: ["timeout"] }), false);
  assert.equal(isPrimaryAccessBlocked({ sourceStatus: "FAILED", pageCount: 0, limitations: ["provider returned no pages"] }), true);
});

test("provider 403 plus public HTML yields governed fallback provenance", async () => {
  const result = await collectPublicAccessFallback({ targetUrl: "https://public.test/", primary: primary403, options: { maxPages: 2, browserMode: "never", fetchImpl: fetchFixture } });
  assert.equal(result.sourceStatus, "AVAILABLE");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.primaryStatus, "FAILED");
  assert.ok(result.pages.length > 0);
  assert.equal(result._contentEvidenceAvailable, true);
  assert.ok(result.pages.every((page) => page.url.startsWith("https://public.test/")));
});

test("undetailed zero-page failure is probed only during governed recovery", async () => {
  const primary = { sourceStatus: "FAILED", pageCount: 0, limitations: ["provider returned no pages"] };
  const noRecovery = await collectPublicAccessFallback({ targetUrl: "https://public.test/", primary, options: { maxPages: 2, browserMode: "never", fetchImpl: fetchFixture } });
  assert.equal(noRecovery, null);
  const recovery = await collectPublicAccessFallback({ targetUrl: "https://public.test/", primary, options: { maxPages: 2, browserMode: "never", allowUndetailedProbe: true, fetchImpl: fetchFixture } });
  assert.equal(recovery.sourceStatus, "AVAILABLE");
});

test("robots-denied targets remain insufficient", async () => {
  const result = await collectPublicAccessFallback({ targetUrl: "https://public.test/private/", primary: primary403, options: { maxPages: 2, browserMode: "never", fetchImpl: fetchFixture } });
  assert.equal(result, null);
});

test("challenge pages are not accepted as first-party evidence", async () => {
  const fetchChallenge = async (url) => new Response(url.endsWith("robots.txt") ? "User-agent: *\nDisallow:\n" : "<html><title>Checking your browser</title><body>Checking your browser before accessing this site</body></html>", { status: 200, headers: { "content-type": url.endsWith("robots.txt") ? "text/plain" : "text/html" } });
  const result = await collectPublicAccessFallback({ targetUrl: "https://challenge.test/", primary: primary403, options: { maxPages: 1, browserMode: "never", fetchImpl: fetchChallenge } });
  assert.equal(result, null);
});

test("empty challenge responses are not accepted as site pages", async () => {
  const fetchChallenge = async (url) => new Response(url.endsWith("robots.txt") ? "User-agent: *\nDisallow:\n" : "", {
    status: 202,
    headers: { "content-type": "text/html", "sg-captcha": "challenge" },
  });
  const result = await collectPublicAccessFallback({ targetUrl: "https://challenge.test/", primary: primary403, options: { maxPages: 1, browserMode: "never", fetchImpl: fetchChallenge } });
  assert.equal(result, null);
});

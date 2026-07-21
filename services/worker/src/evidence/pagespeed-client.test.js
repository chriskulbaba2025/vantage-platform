import test from "node:test";
import assert from "node:assert/strict";
import { collectPerformance, normalizeLighthouse } from "./pagespeed-client.js";

const lhr = {
  categories: {
    performance: { score: 0.71 }, accessibility: { score: 0.9 },
    "best-practices": { score: 0.96 }, seo: { score: 0.83 },
  },
  audits: {
    "first-contentful-paint": { numericValue: 1200 },
    "largest-contentful-paint": { numericValue: 2600 },
    "cumulative-layout-shift": { numericValue: 0.05 },
    "total-blocking-time": { numericValue: 120 },
    "unused-javascript": { id: "unused-javascript", title: "Reduce unused JavaScript", numericValue: 900, details: { type: "opportunity" } },
  },
};

test("normalizeLighthouse produces stable score and metric contract", () => {
  const result = normalizeLighthouse(lhr, "test", "mobile");
  assert.equal(result.scores.performance, 71);
  assert.equal(result.metrics.lcpMs, 2600);
  assert.equal(result.opportunities[0].id, "unused-javascript");
});

test("collectPerformance falls back when PageSpeed is unavailable", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("pagespeedonline")) return new Response("quota", { status: 429 });
    return new Response("not found", { status: 404 });
  };
  const localRunner = async (_url, strategy) => normalizeLighthouse(lhr, "lighthouse-cli-fallback", strategy);
  const result = await collectPerformance("https://example.com", { fetchImpl, localRunner, disableCache: true });
  assert.equal(result.status, "complete");
  assert.equal(result.mobile.source, "lighthouse-cli-fallback");
  assert.equal(result.desktop.scores.seo, 83);
  assert.equal(result.fieldData.phone.status, "not_configured");
});

test("collectPerformance marks status failed when both PageSpeed and Lighthouse are unavailable", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("pagespeedonline")) return new Response("quota", { status: 429 });
    return new Response("not found", { status: 404 });
  };
  const localRunner = async () => { throw new Error("Lighthouse crashed"); };
  const result = await collectPerformance("https://example.com", { fetchImpl, localRunner, disableCache: true });
  assert.equal(result.status, "failed");
  assert.equal(result.mobile.status, "failed");
  assert.equal(result.desktop.status, "failed");
  assert.equal(result.mobile.source, "unavailable");
  assert.equal(result.desktop.source, "unavailable");
  assert.deepEqual(result.mobile.scores, {});
  assert.ok(result.limitations.length >= 4, "Expected at least 4 limitation messages (2 PSI + 2 LH failures)");
});

test("collectPerformance produces complete status with valid PageSpeed result", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("pagespeedonline")) {
      return new Response(JSON.stringify({ lighthouseResult: lhr }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
  const result = await collectPerformance("https://example.com", { fetchImpl, disableCache: true });
  assert.equal(result.status, "complete");
  assert.equal(result.mobile.source, "pagespeed-insights");
  assert.equal(result.mobile.scores.performance, 71);
});

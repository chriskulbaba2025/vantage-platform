import test from "node:test";
import assert from "node:assert/strict";
import { collectPerformance, normalizeLighthouse } from "./pagespeed-client.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

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
  assert.equal(result.status, SOURCE_STATUS.AVAILABLE);
});

test("collectPerformance falls back when PageSpeed is unavailable", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("pagespeedonline")) return new Response("quota", { status: 429 });
    return new Response("not found", { status: 404 });
  };
  const localRunner = async (_url, strategy) => normalizeLighthouse(lhr, "lighthouse-cli-fallback", strategy);
  const result = await collectPerformance("https://example.com", { fetchImpl, localRunner, disableCache: true });
  assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
  assert.equal(result.mobile.source, "lighthouse-cli-fallback");
  assert.equal(result.desktop.scores.seo, 83);
  assert.equal(result.fieldData.phone.status, SOURCE_STATUS.NOT_CONNECTED);
  assert.ok(result._sourceStatus);
  assert.equal(result.evidenceVersion, "1.0.0");
});

test("collectPerformance marks status failed when both PageSpeed and Lighthouse are unavailable", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("pagespeedonline")) return new Response("quota", { status: 429 });
    return new Response("not found", { status: 404 });
  };
  const localRunner = async () => { throw new Error("Lighthouse crashed"); };
  const result = await collectPerformance("https://example.com", { fetchImpl, localRunner, disableCache: true });
  assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
  assert.equal(result.mobile.status, SOURCE_STATUS.FAILED);
  assert.equal(result.desktop.status, SOURCE_STATUS.FAILED);
  assert.equal(result.mobile.source, "unavailable");
  assert.equal(result.desktop.source, "unavailable");
  assert.deepEqual(result.mobile.scores, {});
  assert.ok(result.limitations.length >= 4, "Expected at least 4 limitation messages (2 PSI + 2 LH failures)");
  assert.ok(result._sourceStatus);
  assert.equal(result._sourceStatus.errorCategory, "rate_limit");
});

test("collectPerformance produces complete status with valid PageSpeed result", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("pagespeedonline")) {
      return new Response(JSON.stringify({ lighthouseResult: lhr }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
  const result = await collectPerformance("https://example.com", { fetchImpl, disableCache: true });
  assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
  assert.equal(result.mobile.source, "pagespeed-insights");
  assert.equal(result.mobile.scores.performance, 71);
  assert.equal(result.coverage.completed, 2);
});

test("collectPerformance marks status partial when only one strategy succeeds", async () => {
  let callCount = 0;
  const fetchImpl = async (url) => {
    callCount++;
    if (String(url).includes("pagespeedonline")) {
      // First call (mobile) succeeds, second call (desktop) fails with 429.
      if (callCount === 1) {
        return new Response(JSON.stringify({ lighthouseResult: lhr }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("quota", { status: 429 });
    }
    return new Response("not found", { status: 404 });
  };
  // Mock localRunner: succeeds for mobile, throws for desktop.
  let runnerCallCount = 0;
  const localRunner = async (url, strategy) => {
    runnerCallCount++;
    if (strategy === "mobile") return normalizeLighthouse(lhr, "lighthouse-cli-fallback", strategy);
    throw new Error("Lighthouse desktop crashed");
  };
  const result = await collectPerformance("https://example.com", { fetchImpl, localRunner, disableCache: true });
  assert.equal(result.sourceStatus, SOURCE_STATUS.PARTIAL);
  assert.equal(result.coverage.completed, 1);
  assert.equal(result.coverage.failed, 1);
  // Only desktop triggered fallback (mobile succeeded via PSI).
  assert.ok(runnerCallCount >= 1, "Expected localRunner to be called at least once for desktop fallback");
});

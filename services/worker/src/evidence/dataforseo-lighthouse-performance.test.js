import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "./pagespeed-client.js";

function lighthouseResult() {
  return {
    categories: {
      performance: { score: 0.91 },
      accessibility: { score: 0.95 },
      "best-practices": { score: 0.96 },
      seo: { score: 0.98 },
    },
    audits: {
      "first-contentful-paint": { numericValue: 800 },
      "largest-contentful-paint": { numericValue: 1400 },
      "cumulative-layout-shift": { numericValue: 0.03 },
      "total-blocking-time": { numericValue: 50 },
      "speed-index": { numericValue: 900 },
    },
    finalDisplayedUrl: "https://example.com/",
  };
}

test("performance adapter uses DataForSEO Lighthouse for mobile and desktop", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks: [{
        id: "lighthouse-task",
        status_code: 20000,
        status_message: "Ok.",
        cost: 0.005,
        result: [lighthouseResult()],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const out = await execute({
    auditRequest: {
      targetUrl: "https://example.com/",
      performance: {
        dataForSeoLogin: "test-login",
        dataForSeoPassword: "test-password",
        fetchImpl,
      },
    },
    source: "pagespeed",
    executionId: "e1",
    sourceExecutionKey: "k1",
    attempt: 1,
  });

  assert.equal(out.sourceResult.status, "AVAILABLE");
  assert.equal(out.sourceResult.provider, "dataforseo-lighthouse");
  assert.equal(out.sourceResult.adapterVersion, "1.2.0");
  assert.equal(out.sourceResult.evidence.intendedProvider, "dataforseo-lighthouse");
  assert.equal(out.sourceResult.evidence.mobile.scores.performance, 91);
  assert.equal(out.sourceResult.evidence.desktop.scores.performance, 91);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url === "https://api.dataforseo.com/v3/on_page/lighthouse/live/json"));
  assert.ok(calls.every((call) => call.init.method === "POST"));

  const payloads = calls.map((call) => JSON.parse(call.init.body)[0]);
  assert.equal(payloads[0].for_mobile, true);
  assert.equal(payloads[1].for_mobile, false);
  assert.deepEqual(payloads[0].categories, ["performance", "accessibility", "best_practices", "seo"]);
});


test("Lighthouse diagnostic screenshots use durable auditId, never transient executionId", async () => {
  const auditId = "11111111-1111-4111-8111-111111111111";
  const executionId = "22222222-2222-4222-8222-222222222222";
  const clientId = "example-com-example";
  const artifactRoot = await mkdtemp(join(tmpdir(), "prysm-lighthouse-id-"));
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(180, 1),
    Buffer.from([0xff, 0xd9]),
  ]).toString("base64");

  const fetchImpl = async () => new Response(JSON.stringify({
    status_code: 20000,
    status_message: "Ok.",
    tasks: [{
      id: "lighthouse-task",
      status_code: 20000,
      status_message: "Ok.",
      cost: 0.005,
      result: [{
        ...lighthouseResult(),
        audits: {
          ...lighthouseResult().audits,
          "final-screenshot": { details: { data: `data:image/jpeg;base64,${jpeg}` } },
        },
      }],
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    await execute({
      auditRequest: {
        auditId,
        clientId,
        targetUrl: "https://example.com/",
        performance: {
          dataForSeoLogin: "test-login",
          dataForSeoPassword: "test-password",
          fetchImpl,
          artifactRoot,
        },
      },
      source: "pagespeed",
      executionId,
      sourceExecutionKey: "source-key",
      attempt: 1,
    });

    const auditScreenshotDir = join(
      artifactRoot,
      "reports",
      clientId,
      auditId,
      "evidence",
      "screenshots",
    );
    const files = await readdir(auditScreenshotDir);
    assert.ok(files.some((name) => name.endsWith(".jpg")), "audit-scoped Lighthouse screenshot persisted");

    await assert.rejects(
      readdir(join(artifactRoot, "reports", clientId, executionId, "evidence", "screenshots")),
      /ENOENT/,
      "transient executionId must not become screenshot runId",
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { execute } from "./pagespeed-client.js";

test("PageSpeed universal execution carries governed screenshot identity", async () => {
  const previous = process.env.DATAFORSEO_LOGIN;
  const previousPassword = process.env.DATAFORSEO_PASSWORD;
  delete process.env.DATAFORSEO_LOGIN;
  delete process.env.DATAFORSEO_PASSWORD;
  try {
    const result = await execute({
      auditRequest: {
        auditId: "11111111-2222-4333-8444-555555555555",
        clientId: "example-client",
        targetUrl: "https://example.com",
        performance: {
          fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
          localRunner: async () => ({ status: "FAILED", strategy: "mobile", scores: {}, metrics: {}, screenshot: null }),
        },
      },
      source: "pagespeed",
      executionId: "source-execution-1",
      sourceExecutionKey: "pagespeed:source-execution-1",
      attempt: 1,
    });
    assert.equal(result.sourceResult.source, "pagespeed");
    assert.ok(["FAILED", "PARTIAL", "AVAILABLE"].includes(result.sourceResult.status));
  } finally {
    if (previous === undefined) delete process.env.DATAFORSEO_LOGIN;
    else process.env.DATAFORSEO_LOGIN = previous;
    if (previousPassword === undefined) delete process.env.DATAFORSEO_PASSWORD;
    else process.env.DATAFORSEO_PASSWORD = previousPassword;
  }
});

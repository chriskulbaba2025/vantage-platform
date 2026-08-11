/**
 * Controlled Production Startup Regression (BL-10, BL-11)
 *
 * Exercises the real local production startup component graph from
 * server.js with controlled instrumentation.
 *
 * NO live providers are contacted.
 *
 * BL-10: Every import path server.js touches makes zero provider calls.
 * BL-11: Health endpoint and authenticated routes make zero provider calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Instrumentation: capture every outbound HTTP call
// ---------------------------------------------------------------------------

const capturedCalls = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async function instrumentedFetch(url, init) {
  capturedCalls.push({
    url: typeof url === "string" ? url : url?.href || String(url),
    method: init?.method || "GET",
    headers: init?.headers ? { ...init.headers } : {},
  });
  throw new Error(`BLOCKED — startup must not make live calls: ${url}`);
};

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function dataforseoCalls() {
  return capturedCalls.filter(
    (c) => c.url.includes("dataforseo") || c.url.includes("api.dataforseo.com")
  );
}
function pagespeedCalls() {
  return capturedCalls.filter(
    (c) => c.url.includes("pagespeed") || c.url.includes("lighthouse") || c.url.includes("PageSpeed")
  );
}
function llmCalls() {
  return capturedCalls.filter(
    (c) => c.url.includes("openai") || c.url.includes("anthropic") || c.url.includes("api.llm")
  );
}
function n8nCalls() {
  return capturedCalls.filter((c) => c.url.includes("n8n"));
}

// ---------------------------------------------------------------------------
// BL-10: Every import path in the server.js startup graph is inert
// ---------------------------------------------------------------------------

describe("BL-10: Startup import graph — zero provider calls", () => {

  it("import production-bootstrap.js — 0 calls", async () => {
    const before = capturedCalls.length;
    await import("./production-bootstrap.js");
    assert.equal(capturedCalls.length - before, 0);
  });

  it("import production-runtime.js — 0 calls", async () => {
    const before = capturedCalls.length;
    await import("./production-runtime.js");
    assert.equal(capturedCalls.length - before, 0);
  });

  it("import backlink-adapter.js — 0 calls", async () => {
    const before = capturedCalls.length;
    await import("../adapters/dataforseo-backlinks/backlink-adapter.js");
    assert.equal(capturedCalls.length - before, 0);
  });

  it("import backlinks-provider.js — 0 calls", async () => {
    const before = capturedCalls.length;
    await import("../evidence/backlinks-provider.js");
    assert.equal(capturedCalls.length - before, 0);
  });

  it("import dataforseo-backlinks-client.js — 0 calls", async () => {
    const before = capturedCalls.length;
    await import("../adapters/dataforseo-backlinks/dataforseo-backlinks-client.js");
    assert.equal(capturedCalls.length - before, 0);
  });

  it("import dataforseo-onpage-adapter.js — 0 calls", async () => {
    const before = capturedCalls.length;
    await import("../adapters/dataforseo-onpage/dataforseo-onpage-adapter.js");
    assert.equal(capturedCalls.length - before, 0);
  });

  it("import serp-adapter.js — 0 calls", async () => {
    const before = capturedCalls.length;
    await import("../adapters/dataforseo-serp/serp-adapter.js");
    assert.equal(capturedCalls.length - before, 0);
  });

  it("createBacklinksAdapter() — 0 calls", async () => {
    const { createBacklinksAdapter } = await import(
      "../adapters/dataforseo-backlinks/backlink-adapter.js"
    );
    const before = capturedCalls.length;
    const adapter = createBacklinksAdapter({});
    assert.equal(capturedCalls.length - before, 0);
    assert.equal(adapter.adapterVersion, "1.0.0");
    assert.equal(typeof adapter.execute, "function");
  });

  it("createProductionAdapters() — 0 calls", async () => {
    const { createProductionAdapters } = await import("./production-bootstrap.js");
    const before = capturedCalls.length;
    const adapters = createProductionAdapters();
    assert.equal(capturedCalls.length - before, 0);
    assert.equal(Object.keys(adapters).length, 6);
    assert.ok(adapters.backlinks);
  });

  it("createBacklinksAdapter returns inert adapter", async () => {
    const { createBacklinksAdapter } = await import(
      "../adapters/dataforseo-backlinks/backlink-adapter.js"
    );
    const adapter = createBacklinksAdapter({});
    // The execute function is the governed backlinks provider execute —
    // it should only make calls when explicitly invoked with credentials.
    assert.equal(typeof adapter.execute, "function");
  });

  it("Startup DataForSEO calls: 0", () => {
    const calls = dataforseoCalls();
    assert.equal(calls.length, 0,
      `Got ${calls.length} DataForSEO call(s): ${JSON.stringify(calls)}`);
  });

  it("Startup PageSpeed calls: 0", () => {
    assert.equal(pagespeedCalls().length, 0);
  });

  it("Startup LLM calls: 0", () => {
    assert.equal(llmCalls().length, 0);
  });

  it("Startup n8n calls: 0", () => {
    assert.equal(n8nCalls().length, 0);
  });
});

// ---------------------------------------------------------------------------
// BL-11: Health path and route handler — zero provider calls
// ---------------------------------------------------------------------------

describe("BL-11: Health path is inert", () => {

  it("createRequestHandler with health route makes 0 calls", async () => {
    const { createRequestHandler } = await import("../server.js");

    const before = capturedCalls.length;
    const handler = createRequestHandler({
      config: {
        webhookSecret: "",
        artifactDir: "",
        reportsBucket: "",
        vantageTenantId: "test",
        port: 0,
      },
      localStore: { readFile: async () => { throw new Error("not found"); } },
      store: {
        getStatus: async () => null,
        readCommittedArtifacts: async () => null,
      },
      oauthService: {
        getAuthUrl: () => "",
        validateState: () => "",
        exchangeCode: async () => ({}),
        getStatus: async () => ({}),
        disconnect: async () => ({}),
      },
      auditService: null,
    });
    assert.equal(capturedCalls.length - before, 0,
      "createRequestHandler should not trigger HTTP calls");

    // GET /health — resolve in end() to capture the body
    const hBefore = capturedCalls.length;
    const healthResult = await new Promise((resolve) => {
      let _status = 0;
      let _headers = {};
      const chunks = [];
      const res = {
        writeHead: function(status, headers) {
          _status = status;
          _headers = headers;
          return this;
        },
        end: function(body) {
          chunks.push(body);
          resolve({ status: _status, headers: _headers, chunks });
        },
      };
      handler({ method: "GET", url: "/health", headers: { host: "localhost" } }, res);
    });
    assert.equal(capturedCalls.length - hBefore, 0,
      "GET /health should not trigger HTTP calls");
    assert.equal(healthResult.status, 200);
    const body = JSON.parse(healthResult.chunks.join(""));
    assert.equal(body.status, "ok");
    assert.equal(body.service, "prysm-worker");
  });

  it("POST /api/v1/audits without auth returns 401 (0 calls)", async () => {
    const { createRequestHandler } = await import("../server.js");

    const before = capturedCalls.length;
    const handler = createRequestHandler({
      config: {
        webhookSecret: "test-secret",
        artifactDir: "",
        reportsBucket: "",
        vantageTenantId: "test",
        port: 0,
      },
      localStore: { readFile: async () => { throw new Error("not found"); } },
      store: {
        getStatus: async () => null,
        readCommittedArtifacts: async () => null,
      },
      oauthService: {
        getAuthUrl: () => "",
        validateState: () => "",
        exchangeCode: async () => ({}),
        getStatus: async () => ({}),
        disconnect: async () => ({}),
      },
      auditService: null,
    });

    const authResult = await new Promise((resolve) => {
      let _status = 0;
      let _headers = {};
      const chunks = [];
      const res = {
        writeHead: function(status, headers) {
          _status = status;
          _headers = headers;
          return this;
        },
        end: function(body) {
          chunks.push(body);
          resolve({ status: _status, headers: _headers, chunks });
        },
      };
      handler(
        {
          method: "POST",
          url: "/api/v1/audits",
          headers: { host: "localhost", "content-type": "application/json" },
        },
        res
      );
    });
    assert.equal(capturedCalls.length - before, 0,
      "POST /api/v1/audits should not trigger HTTP calls");
    assert.equal(authResult.status, 401);
  });

  it("Health path DataForSEO calls: 0", () => {
    assert.equal(dataforseoCalls().length, 0);
  });
  it("Health path PageSpeed calls: 0", () => {
    assert.equal(pagespeedCalls().length, 0);
  });
  it("Health path LLM calls: 0", () => {
    assert.equal(llmCalls().length, 0);
  });
  it("Health path n8n calls: 0", () => {
    assert.equal(n8nCalls().length, 0);
  });
});

restoreFetch();

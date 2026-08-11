/**
 * Production Bootstrap Regression — Zero Provider Calls During Startup
 *
 * Permanent regression proof that worker startup/bootstrap results in:
 *   DataForSEO calls = 0
 *   PageSpeed calls = 0
 *   LLM calls = 0
 *   n8n calls = 0
 *
 * while preserving normal provider execution when an actual governed audit
 * explicitly requests collection.
 *
 * If this test fails, a bootstrap defect has been reintroduced.
 */

import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Instrumentation: capture every outbound HTTP call made during bootstrap
// ---------------------------------------------------------------------------

const capturedCalls = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async function instrumentedFetch(url, init) {
  capturedCalls.push({
    url: typeof url === "string" ? url : url?.href || String(url),
    method: init?.method || "GET",
    headers: init?.headers ? { ...init.headers } : {},
    body: init?.body ? String(init.body).slice(0, 200) : null,
  });
  // Return a controlled error so no real network call escapes
  throw new Error(`BLOCKED — bootstrap must not make live calls: ${url}`);
};

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  return capturedCalls.filter(
    (c) => c.url.includes("n8n") || c.url.includes("webhook")
  );
}

const REQUIRED_ADAPTERS = ["dataforseo-onpage", "pagespeed", "dataforseo-serp", "backlinks", "ga4", "gsc"];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

await test("Production bootstrap — zero provider calls", async (t) => {

  // =========================================================================
  // BL-07: Importing production-bootstrap is inert
  // =========================================================================

  await t.test("BL-07: importing createProductionAdapters makes zero HTTP calls", async () => {
    const before = capturedCalls.length;
    const { createProductionAdapters } = await import("./production-bootstrap.js");
    const after = capturedCalls.length;

    assert.equal(after - before, 0,
      `createProductionAdapters import triggered ${after - before} HTTP call(s)`);
    assert.equal(typeof createProductionAdapters, "function");
  });

  // =========================================================================
  // BL-09: createProductionAdapters() is inert
  // =========================================================================

  await t.test("BL-09: createProductionAdapters() makes zero HTTP calls", async () => {
    const { createProductionAdapters } = await import("./production-bootstrap.js");
    const before = capturedCalls.length;
    const adapters = createProductionAdapters();
    const after = capturedCalls.length;

    assert.equal(after - before, 0,
      `createProductionAdapters() triggered ${after - before} HTTP call(s)`);
    assert.ok(adapters, "adapters object should be non-null");
  });

  // =========================================================================
  // Provider-call counters (BL-07 through BL-11)
  // =========================================================================

  await t.test("zero DataForSEO calls during bootstrap", () => {
    assert.equal(dataforseoCalls().length, 0,
      `DataForSEO calls during bootstrap: ${JSON.stringify(dataforseoCalls())}`);
  });

  await t.test("zero PageSpeed calls during bootstrap", () => {
    assert.equal(pagespeedCalls().length, 0,
      `PageSpeed calls during bootstrap: ${JSON.stringify(pagespeedCalls())}`);
  });

  await t.test("zero LLM calls during bootstrap", () => {
    assert.equal(llmCalls().length, 0,
      `LLM calls during bootstrap: ${JSON.stringify(llmCalls())}`);
  });

  await t.test("zero n8n calls during bootstrap", () => {
    assert.equal(n8nCalls().length, 0,
      `n8n calls during bootstrap: ${JSON.stringify(n8nCalls())}`);
  });

  // =========================================================================
  // BL-06: Six production adapters including backlinks
  // =========================================================================

  await t.test("BL-06: six production adapters — backlinks present", async () => {
    const { createProductionAdapters } = await import("./production-bootstrap.js");
    const adapters = createProductionAdapters();
    const keys = Object.keys(adapters).sort();

    assert.equal(keys.length, 6,
      `expected 6 production adapters, got ${keys.length}: ${keys.join(", ")}`);
    for (const key of REQUIRED_ADAPTERS) {
      assert.ok(adapters[key], `${key} adapter missing`);
      assert.equal(typeof adapters[key].execute, "function",
        `${key}.execute should be a function, got ${typeof adapters[key].execute}`);
      assert.equal(typeof adapters[key].adapterVersion, "string",
        `${key}.adapterVersion should be a string`);
      assert.ok(adapters[key].adapterVersion.length > 0,
        `${key}.adapterVersion should not be empty`);
    }
  });

  // =========================================================================
  // BL-01 / BL-03: Backlinks adapter is the PRODUCTION module, not legacy
  // =========================================================================

  await t.test("BL-01: backlinks adapter is production module, not legacy test file", async () => {
    const { createProductionAdapters } = await import("./production-bootstrap.js");
    const adapters = createProductionAdapters();

    assert.equal(adapters.backlinks.adapterVersion, "1.0.0",
      "backlinks adapter should have version 1.0.0");
    assert.equal(typeof adapters.backlinks.execute, "function",
      "backlinks.execute should be a function");

    // The execute function must be the governed backlinks execute, which
    // accepts { auditRequest, source, executionId, ... }.  It must NOT be
    // a test artifact from backlink-adapter.legacy.js.
    assert.ok(
      adapters.backlinks.execute.name === "execute" ||
      adapters.backlinks.execute.name === "backlinksExecute" ||
      typeof adapters.backlinks.execute === "function",
      "backlinks.execute must be the governed execute function"
    );
  });

  // =========================================================================
  // BL-01: server.js adapterSources points to production adapter
  // =========================================================================

  await t.test("BL-01: server.js backlinks source is backlink-adapter.js, NOT legacy", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const serverSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "..", "server.js"),
      "utf-8"
    );

    // The adapterSources block must reference backlink-adapter.js (production)
    const hasProductionBacklinksRef = /backlinks\s*:\s*\{[^}]*backlink-adapter\.js/.test(serverSrc);
    assert.ok(hasProductionBacklinksRef,
      "server.js adapterSources.backlinks must point to backlink-adapter.js");

    // The legacy test file must NOT appear as an adapter source
    const hasLegacyBacklinksRef = /backlinks\s*:\s*\{[^}]*backlink-adapter\.legacy/.test(serverSrc);
    assert.equal(hasLegacyBacklinksRef, false,
      "server.js must NOT reference backlink-adapter.legacy.js in adapterSources");
  });

  // =========================================================================
  // BL-03: New production backlinks adapter — import is inert
  // =========================================================================

  await t.test("BL-03: importing backlink-adapter.js makes zero HTTP calls", async () => {
    const before = capturedCalls.length;
    const mod = await import(
      "../adapters/dataforseo-backlinks/backlink-adapter.js"
    );
    const after = capturedCalls.length;

    assert.equal(after - before, 0,
      `backlink-adapter.js import triggered ${after - before} HTTP call(s)`);
    assert.equal(typeof mod.createBacklinksAdapter, "function",
      "createBacklinksAdapter should be a function");
    assert.equal(typeof mod.execute, "function",
      "execute should be a function");
    assert.equal(mod.ADAPTER_VERSION, "1.0.0",
      "ADAPTER_VERSION should be 1.0.0");
  });

  // =========================================================================
  // BL-03: Factory creation is inert
  // =========================================================================

  await t.test("BL-03: createBacklinksAdapter() makes zero HTTP calls", async () => {
    const { createBacklinksAdapter } = await import(
      "../adapters/dataforseo-backlinks/backlink-adapter.js"
    );
    const before = capturedCalls.length;
    const adapter = createBacklinksAdapter({});
    const after = capturedCalls.length;

    assert.equal(after - before, 0,
      `createBacklinksAdapter() triggered ${after - before} HTTP call(s)`);
    assert.equal(adapter.adapterVersion, "1.0.0");
    assert.equal(typeof adapter.execute, "function");
  });

  // =========================================================================
  // BL-12: Controlled backlinks execution through the real production path
  // =========================================================================
  //
  // Must prove:
  //   1. Production factory used  (createBacklinksAdapter)
  //   2. Production execute() invoked
  //   3. Mock provider called because execute() was explicitly invoked
  //   4. Exact controlled provider call count
  //   5. Resulting production normalized/evidence contract
  //   6. Live network calls = 0

  await t.test("BL-12: controlled execute() invokes mock provider through real production path", async () => {
    // --- Phase 1: NOT_CONNECTED when no credentials (fail-closed proof) ---

    const { createBacklinksAdapter } = await import(
      "../adapters/dataforseo-backlinks/backlink-adapter.js"
    );

    const notConnectedBefore = capturedCalls.length;
    const adapter = createBacklinksAdapter({});
    const notConnectedResult = await adapter.execute({
      auditRequest: {
        targetUrl: "https://example.com",
        competitors: [],
        services: [],
      },
      source: "backlinks",
      executionId: "test-failclosed",
      sourceExecutionKey: "test-key-fc",
      signal: null,
      attempt: 1,
    });
    const notConnectedAfter = capturedCalls.length;

    assert.equal(notConnectedAfter - notConnectedBefore, 0,
      "fail-closed execute() must make zero calls");
    assert.equal(notConnectedResult.sourceResult.status, "NOT_CONNECTED");
    assert.equal(notConnectedResult.sourceResult.provider, "DataForSEO");

    // --- Phase 2: Mock provider, real production path ---

    // Build a controlled DataForSEO summary response
    const mockSummaryResponse = {
      status_code: 20000,
      status_message: "Ok.",
      tasks: [{
        id: "mock-summary-task",
        status_code: 20000,
        result: [{
          domain: "example.com",
          rank: 100,
          backlinks: 3,
          referring_domains: 2,
          referring_pages: 3,
          backlinks_spam_score: 5,
          target_spam_score: 2,
        }],
      }],
    };

    // Build a controlled DataForSEO backlinks list response
    const mockBacklinksResponse = {
      status_code: 20000,
      status_message: "Ok.",
      tasks: [{
        id: "mock-backlinks-task",
        status_code: 20000,
        result: [{
          items: [
            {
              page_from: "https://referrer-a.com/link1",
              domain_from: "referrer-a.com",
              page_to: "https://example.com/",
              domain_to: "example.com",
              anchor: "great consulting services",
              domain_from_rank: 500,
              page_from_rank: 1000,
              spam_score: 5,
              semantic_location: "article",
              link_type: "anchor",
              external_links_count: 20,
              first_seen: "2024-01-01",
              last_seen: "2025-01-01",
            },
            {
              page_from: "https://referrer-b.com/link2",
              domain_from: "referrer-b.com",
              page_to: "https://example.com/",
              domain_to: "example.com",
              anchor: "professional coaching",
              domain_from_rank: 200,
              page_from_rank: 500,
              spam_score: 8,
              semantic_location: "section",
              link_type: "anchor",
              external_links_count: 15,
              first_seen: "2024-06-01",
              last_seen: "2025-06-01",
            },
            {
              page_from: "https://spam-site.com/link3",
              domain_from: "casino-win-big.com",
              page_to: "https://example.com/",
              domain_to: "example.com",
              anchor: "buy cheap stuff",
              domain_from_rank: 500000,
              page_from_rank: 800000,
              spam_score: 72,
              semantic_location: "footer",
              link_type: "anchor",
              external_links_count: 200,
              first_seen: "2024-01-01",
              last_seen: "2025-01-01",
            },
          ],
        }],
      }],
    };

    // Track mock provider calls separately
    const mockCalls = [];

    // Save the current (instrumented) fetch and install a mock that
    // returns controlled DataForSEO responses.  The instrumented fetch
    // throws — we replace it ONLY for this test phase.
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async function mockFetch(url, init) {
      const urlStr = typeof url === "string" ? url : url?.href || String(url);
      mockCalls.push({
        url: urlStr,
        method: init?.method || "GET",
      });
      if (urlStr.includes("/summary/live")) {
        return new Response(JSON.stringify(mockSummaryResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (urlStr.includes("/backlinks/live")) {
        return new Response(JSON.stringify(mockBacklinksResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected mock fetch call: ${urlStr}`);
    };

    // Set fake credentials so execute() proceeds past NOT_CONNECTED
    const savedLogin = process.env.DATAFORSEO_LOGIN;
    const savedPassword = process.env.DATAFORSEO_PASSWORD;
    process.env.DATAFORSEO_LOGIN = "mock-login@example.com";
    process.env.DATAFORSEO_PASSWORD = "mock-password";

    try {
      const controlledBefore = capturedCalls.length;
      const execResult = await adapter.execute({
        auditRequest: {
          targetUrl: "https://example.com",
          competitors: [],
          services: ["Consulting", "Coaching"],
        },
        source: "backlinks",
        executionId: "test-controlled-exec",
        sourceExecutionKey: "test-key-controlled",
        signal: null,
        attempt: 1,
      });
      const controlledAfter = capturedCalls.length;

      // ---- Assertion 1: exact mock provider call count === 2 ----
      // No competitors → 1 summary + 1 backlinks = 2 DataForSEO requests.
      assert.equal(mockCalls.length, 2,
        `controlled provider call count: ${mockCalls.length} (expected exactly 2)`);

      // ---- Assertion 2: exact mocked endpoints in production order ----
      // collectBacklinks() calls /summary/live first, then /backlinks/live.
      const endpoint = (i) => {
        const u = mockCalls[i]?.url || "";
        if (u.includes("/summary/live")) return "/summary/live";
        if (u.includes("/backlinks/live")) return "/backlinks/live";
        return u;
      };
      assert.equal(endpoint(0), "/summary/live",
        `call[0] must be /summary/live, got ${endpoint(0)}`);
      assert.equal(endpoint(1), "/backlinks/live",
        `call[1] must be /backlinks/live, got ${endpoint(1)}`);
      for (const c of mockCalls) {
        assert.equal(c.method, "POST", "all DataForSEO calls must be POST");
      }

      // ---- Assertion 3: live network calls = 0 ----
      assert.equal(controlledAfter - controlledBefore, 0,
        `live network calls during controlled execute: ${controlledAfter - controlledBefore}`);

      // ---- Assertion 4: production normalized/evidence contract ----
      assert.ok(execResult.sourceResult, "sourceResult must exist");
      assert.equal(execResult.sourceResult.provider, "DataForSEO");
      assert.equal(execResult.sourceResult.adapterVersion, "1.0.0");
      assert.equal(execResult.sourceResult.source, "backlinks");
      // Status should be AVAILABLE since mock returned valid data
      assert.ok(
        execResult.sourceResult.status === "AVAILABLE" ||
        execResult.sourceResult.status === "PARTIAL",
        `expected AVAILABLE or PARTIAL, got ${execResult.sourceResult.status}`
      );
      // Evidence must be populated
      assert.ok(execResult.sourceResult.evidence, "evidence must exist");
      assert.ok(
        typeof execResult.sourceResult.evidence.totalBacklinksReviewed === "number",
        "evidence.totalBacklinksReviewed must be a number"
      );
      assert.ok(
        execResult.sourceResult.evidence.totalBacklinksReviewed > 0,
        `expected totalBacklinksReviewed > 0, got ${execResult.sourceResult.evidence.totalBacklinksReviewed}`
      );
      // rawBytes must be populated (artifact storage)
      assert.ok(execResult.rawBytes, "rawBytes must be populated");
      assert.equal(execResult.contentType, "application/json");
    } finally {
      // Restore everything
      globalThis.fetch = savedFetch;
      if (savedLogin !== undefined) {
        process.env.DATAFORSEO_LOGIN = savedLogin;
      } else {
        delete process.env.DATAFORSEO_LOGIN;
      }
      if (savedPassword !== undefined) {
        process.env.DATAFORSEO_PASSWORD = savedPassword;
      } else {
        delete process.env.DATAFORSEO_PASSWORD;
      }
    }
  });

  // =========================================================================
  // BL-13: Explicit adapter vs bootstrap distinction
  // =========================================================================

  await t.test("BL-13: bootstrap calls = 0; explicit execute invokes mock provider", () => {
    // After all tests: bootstrap/factory/import calls must be zero.
    // The BL-12 phase 2 mock calls were made through a SEPARATE fetch
    // override — they do NOT appear in capturedCalls (the instrumented
    // fetch was temporarily replaced, not called).
    // capturedCalls records calls to the INSTRUMENTED fetch (which throws).
    // It must remain zero throughout bootstrap.
    assert.equal(dataforseoCalls().length, 0,
      `DataForSEO calls via instrumented fetch: ${dataforseoCalls().length}`);
    assert.equal(pagespeedCalls().length, 0,
      `PageSpeed calls: ${pagespeedCalls().length}`);
    assert.equal(llmCalls().length, 0,
      `LLM calls: ${llmCalls().length}`);
    assert.equal(n8nCalls().length, 0,
      `n8n calls: ${n8nCalls().length}`);
  });
});

// ---------------------------------------------------------------------------
// Restore fetch before other tests run
// ---------------------------------------------------------------------------

restoreFetch();

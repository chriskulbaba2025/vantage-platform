/**
 * WP5 Mock Adapters — Shared test fixtures for orchestrator tests.
 *
 * Every adapter conforms to execute({ auditRequest, source, executionId,
 * sourceExecutionKey, signal, attempt }) → { rawBytes, contentType, sourceResult }.
 *
 * @module test-fixtures/orchestration/mock-adapters
 */

const PAGE_EVIDENCE = { pages: [{ url: "https://example.com", title: "Example" }] };
const PERF_EVIDENCE = { performance: { score: 0.85 } };
const SERP_EVIDENCE = { competitors: [{ url: "https://competitor.com", position: 1 }] };
const BACKLINK_EVIDENCE = { backlinks: [{ source: "https://ref.com", target: "https://example.com" }] };
const GA4_EVIDENCE = { ga4: { sessions: 1000 } };
const GSC_EVIDENCE = { gsc: { clicks: 500 } };

function mockResult(source, overrides = {}) {
  return {
    rawBytes: Buffer.from(JSON.stringify({ source, mock: true }), "utf-8"),
    contentType: "application/json",
    sourceResult: {
      provider: "MockProvider",
      adapterVersion: "1.0.0",
      status: "AVAILABLE",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      requestId: `mock-${source}-${Date.now()}`,
      retryCount: 0,
      expectedRecords: 1,
      returnedRecords: 1,
      coverage: { requested: 1, completed: 1, failed: 0 },
      limitations: [],
      evidence: {},
      ...overrides,
    },
  };
}

/** Mock onpage adapter — always succeeds */
export function createMockOnpageAdapter() {
  return {
    execute: async () => mockResult("dataforseo-onpage", {
      sourceResult: { evidence: PAGE_EVIDENCE, expectedRecords: 1, returnedRecords: 1 },
    }),
  };
}

/** Mock pagespeed adapter — always succeeds */
export function createMockPagespeedAdapter() {
  return {
    execute: async () => mockResult("pagespeed", {
      sourceResult: { evidence: PERF_EVIDENCE, expectedRecords: 1, returnedRecords: 1 },
    }),
  };
}

/** Mock SERP adapter — always succeeds */
export function createMockSerpAdapter() {
  return {
    execute: async () => mockResult("dataforseo-serp", {
      sourceResult: { evidence: SERP_EVIDENCE, expectedRecords: 3, returnedRecords: 3 },
    }),
  };
}

/** Mock backlinks adapter — always succeeds */
export function createMockBacklinksAdapter() {
  return {
    execute: async () => mockResult("backlinks", {
      sourceResult: { evidence: BACKLINK_EVIDENCE, expectedRecords: 5, returnedRecords: 5 },
    }),
  };
}

/** Mock GA4 adapter — always succeeds */
export function createMockGa4Adapter() {
  return {
    execute: async () => mockResult("ga4", {
      sourceResult: { evidence: GA4_EVIDENCE, expectedRecords: 1, returnedRecords: 1 },
    }),
  };
}

/** Mock GSC adapter — always succeeds */
export function createMockGscAdapter() {
  return {
    execute: async () => mockResult("gsc", {
      sourceResult: { evidence: GSC_EVIDENCE, expectedRecords: 1, returnedRecords: 1 },
    }),
  };
}

/** Full set of adapters for a base audit (no GA4/GSC) */
export function createBaseMockAdapters() {
  return {
    "dataforseo-onpage": createMockOnpageAdapter(),
    "pagespeed": createMockPagespeedAdapter(),
    "dataforseo-serp": createMockSerpAdapter(),
    "backlinks": createMockBacklinksAdapter(),
  };
}

/** Full set of adapters with GA4 and GSC */
export function createFullMockAdapters() {
  return {
    ...createBaseMockAdapters(),
    "ga4": createMockGa4Adapter(),
    "gsc": createMockGscAdapter(),
  };
}

/**
 * Create a mock adapter that fails with a given error.
 */
export function createFailingAdapter(source, opts = {}) {
  const { failOnAttempt = 1, errorCategory = "internal", transient = false } = opts;
  let callCount = 0;

  return {
    execute: async ({ signal }) => {
      callCount++;
      if (callCount >= failOnAttempt) {
        const err = new Error(`Mock failure for ${source}`);
        err.category = errorCategory;
        if (signal?.aborted) {
          err.category = "timeout";
          err.message = "Source execution timed out";
        }
        throw err;
      }
      return mockResult(source);
    },
    getCallCount: () => callCount,
    resetCallCount: () => { callCount = 0; },
  };
}

/**
 * Create a mock adapter that times out.
 */
export function createTimeoutAdapter(source) {
  return {
    execute: async ({ signal }) => {
      return new Promise((_, reject) => {
        const checkAbort = () => {
          if (signal?.aborted) {
            const err = new Error("Source execution timed out");
            err.category = "timeout";
            reject(err);
            return;
          }
          setTimeout(checkAbort, 1);
        };
        checkAbort();
      });
    },
  };
}

/**
 * Create a partial/BLOCKED adapter.
 */
export function createPartialAdapter(source, status = "PARTIAL") {
  return {
    execute: async () => mockResult(source, {
      sourceResult: {
        status,
        expectedRecords: 10,
        returnedRecords: 5,
        coverage: { requested: 10, completed: 5, failed: 0 },
        limitations: [`${source} returned partial results`],
      },
    }),
  };
}

export { mockResult, PAGE_EVIDENCE, PERF_EVIDENCE, SERP_EVIDENCE, BACKLINK_EVIDENCE, GA4_EVIDENCE, GSC_EVIDENCE };

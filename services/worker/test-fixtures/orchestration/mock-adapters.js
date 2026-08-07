/**
 * WP5 Mock Adapters — Shared test fixtures for orchestrator tests.
 *
 * Every adapter conforms to:
 *   adapterVersion: "x.y.z"
 *   execute({ auditRequest, source, executionId, sourceExecutionKey, signal, attempt })
 *     → { rawBytes, contentType, sourceResult }
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
  const base = {
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
    },
  };

  if (overrides.sourceResult) {
    base.sourceResult = { ...base.sourceResult, ...overrides.sourceResult };
  }
  if (overrides.rawBytes !== undefined) base.rawBytes = overrides.rawBytes;
  if (overrides.contentType !== undefined) base.contentType = overrides.contentType;

  return base;
}

/** Mock onpage adapter — always succeeds */
export function createMockOnpageAdapter() {
  return {
    adapterVersion: "1.0.0",
    execute: async () => mockResult("dataforseo-onpage", {
      sourceResult: { evidence: PAGE_EVIDENCE, expectedRecords: 1, returnedRecords: 1 },
    }),
  };
}

/** Mock pagespeed adapter — always succeeds */
export function createMockPagespeedAdapter() {
  return {
    adapterVersion: "1.0.0",
    execute: async () => mockResult("pagespeed", {
      sourceResult: { evidence: PERF_EVIDENCE, expectedRecords: 1, returnedRecords: 1 },
    }),
  };
}

/** Mock SERP adapter — always succeeds */
export function createMockSerpAdapter() {
  return {
    adapterVersion: "1.0.0",
    execute: async () => mockResult("dataforseo-serp", {
      sourceResult: { evidence: SERP_EVIDENCE, expectedRecords: 3, returnedRecords: 3 },
    }),
  };
}

/** Mock backlinks adapter — always succeeds */
export function createMockBacklinksAdapter() {
  return {
    adapterVersion: "1.0.0",
    execute: async () => mockResult("backlinks", {
      sourceResult: { evidence: BACKLINK_EVIDENCE, expectedRecords: 5, returnedRecords: 5 },
    }),
  };
}

/** Mock GA4 adapter — always succeeds */
export function createMockGa4Adapter() {
  return {
    adapterVersion: "1.0.0",
    execute: async () => mockResult("ga4", {
      sourceResult: { evidence: GA4_EVIDENCE, expectedRecords: 1, returnedRecords: 1 },
    }),
  };
}

/** Mock GSC adapter — always succeeds */
export function createMockGscAdapter() {
  return {
    adapterVersion: "1.0.0",
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
 * Create a wrapped adapter that tracks calls.
 */
export function createTrackingAdapter(source, inner) {
  let callCount = 0;
  let lastArgs = null;
  return {
    adapterVersion: inner.adapterVersion || "1.0.0",
    execute: async (args) => {
      callCount++;
      lastArgs = args;
      return inner.execute(args);
    },
    getCallCount: () => callCount,
    getLastArgs: () => lastArgs,
    resetCallCount: () => { callCount = 0; lastArgs = null; },
  };
}

/**
 * Create a mock adapter that fails with a given error.
 */
export function createFailingAdapter(source, opts = {}) {
  const { failOnAttempt = 1, errorCategory = "internal", transient = false } = opts;
  let callCount = 0;

  return {
    adapterVersion: "1.0.0",
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
    adapterVersion: "1.0.0",
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
    adapterVersion: "1.0.0",
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

// ---------------------------------------------------------------------------
// WP5-CLOSE-ADP-01: Adapters without adapterVersion
// ---------------------------------------------------------------------------

/** Adapter with no adapterVersion property at all */
export function createMissingVersionAdapter(source) {
  return {
    // Intentionally no adapterVersion
    execute: async () => mockResult(source),
    getCallCount: () => 0,
  };
}

/** Adapter with empty adapterVersion */
export function createEmptyVersionAdapter(source) {
  return {
    adapterVersion: "",
    execute: async () => mockResult(source),
    getCallCount: () => 0,
  };
}

// ---------------------------------------------------------------------------
// WP5-CLOSE-ADP-02: Key-capturing adapter
// ---------------------------------------------------------------------------

/** Adapter that captures its received sourceExecutionKey */
export function createKeyCapturingAdapter(source, version = "1.0.0") {
  let receivedKey = null;
  let callCount = 0;
  return {
    adapterVersion: version,
    execute: async (args) => {
      callCount++;
      receivedKey = args.sourceExecutionKey;
      return mockResult(source);
    },
    getReceivedKey: () => receivedKey,
    getCallCount: () => callCount,
  };
}

// ---------------------------------------------------------------------------
// WP5-CLOSE-ADP-03: Version-mismatching adapter
// ---------------------------------------------------------------------------

/** Adapter registered with one version but returning a different one */
export function createVersionMismatchAdapter(source, registeredVersion, returnedVersion) {
  return {
    adapterVersion: registeredVersion,
    execute: async () => mockResult(source, {
      sourceResult: { adapterVersion: returnedVersion },
    }),
  };
}

// ---------------------------------------------------------------------------
// WP5-CLOSE-STAT-01: Controlled-status adapters
// ---------------------------------------------------------------------------

const STATUS_RESULTS = {
  AVAILABLE: {},
  PARTIAL: { expectedRecords: 10, returnedRecords: 5, coverage: { requested: 10, completed: 5, failed: 5 }, limitations: ["partial data"] },
  FAILED: { errorCategory: "internal" },
  BLOCKED: { errorCategory: "auth", limitations: ["Access blocked"] },
  UNAVAILABLE: { errorCategory: "no_data", limitations: ["No data returned"] },
  NOT_CONNECTED: { errorCategory: "auth", limitations: ["Not connected"] },
  NOT_APPLICABLE: { limitations: ["Not applicable"] },
};

export function createStatusAdapter(source, status) {
  const overrides = STATUS_RESULTS[status] || {};
  return {
    adapterVersion: "1.0.0",
    execute: async () => mockResult(source, {
      sourceResult: { status, ...overrides, evidence: status === "AVAILABLE" ? { some: "data" } : {} },
    }),
  };
}

export { mockResult, PAGE_EVIDENCE, PERF_EVIDENCE, SERP_EVIDENCE, BACKLINK_EVIDENCE, GA4_EVIDENCE, GSC_EVIDENCE };

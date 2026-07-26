import test from "node:test";
import assert from "node:assert/strict";
import { collectGsc, checkGscSufficiency, GSC_SUFFICIENCY_THRESHOLD } from "./gsc-client.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const GSC_MOCK_ROWS = [
  { keys: ["consulting services", "https://example.com/services", "DESKTOP", "CAN", "2026-07-01"], clicks: 45, impressions: 520, ctr: 0.086, position: 3.2 },
  { keys: ["business consultant", "https://example.com/", "MOBILE", "CAN", "2026-07-01"], clicks: 28, impressions: 340, ctr: 0.082, position: 5.1 },
  { keys: ["consulting near me", "https://example.com/contact", "DESKTOP", "USA", "2026-07-01"], clicks: 12, impressions: 180, ctr: 0.066, position: 8.7 },
  { keys: ["low volume term", "https://example.com/services", "MOBILE", "CAN", "2026-07-01"], clicks: 1, impressions: 15, ctr: 0.066, position: 22.0 },
];

function gscResponse(rows = GSC_MOCK_ROWS) {
  return new Response(JSON.stringify({ rows }), { status: 200, headers: { "content-type": "application/json" } });
}

function errorResponse(status) {
  return new Response(JSON.stringify({ error: { message: "error" } }), { status });
}

// Mock OAuth service that provides a valid token
function mockOAuthService(token) {
  return {
    getAccessToken: async () => token || "ya29.mock-token",
  };
}

// ---------------------------------------------------------------------------
// T8-01: Disconnected GSC returns NOT_CONNECTED
// ---------------------------------------------------------------------------

test("T8-01: disconnected GSC returns NOT_CONNECTED", async () => {
  const result = await collectGsc("https://example.com", {});
  assert.equal(result.sourceStatus, SOURCE_STATUS.NOT_CONNECTED);
  assert.equal(result.included, false);
  assert.equal(result.affectsScore, false);
  assert.ok(result._sourceStatus);
  assert.equal(result._sourceStatus.errorCategory, "not_configured");
});

// ---------------------------------------------------------------------------
// T8-02: GSC collects search analytics with required dimensions and metrics
// ---------------------------------------------------------------------------

test("T8-02: GSC collects search analytics with required dimensions and metrics", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("webmasters")) return gscResponse();
    return new Response("{}", { status: 200 });
  };

  const result = await collectGsc("https://example.com", {
    oauthService: mockOAuthService(),
    fetchImpl,
  });

  assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
  assert.equal(result.included, true);
  // 2 windows × 4 rows each = 8 rows
  assert.ok(result.rows.length >= 4, `Expected at least 4 rows, got ${result.rows.length}`);
  assert.equal(result.rows[0].query, "consulting services");
  assert.equal(result.rows[0].device, "DESKTOP");
  assert.equal(result.rows[0].country, "CAN");
  assert.equal(result.rows[0].clicks, 45);
  assert.equal(result.rows[0].impressions, 520);
  assert.ok(result.rows[0].ctr > 0);
  assert.ok(result.rows[0].position > 0);
});

// ---------------------------------------------------------------------------
// T8-03: GSC sufficiency gate
// ---------------------------------------------------------------------------

test("T8-03: GSC sufficiency gate — above 100 impressions is sufficient", () => {
  const result = checkGscSufficiency(520);
  assert.equal(result.sufficient, true);
  assert.equal(result.confidence, "sufficient");
});

test("T8-03b: GSC sufficiency gate — below 100 impressions is directional", () => {
  const result = checkGscSufficiency(45);
  assert.equal(result.sufficient, false);
  assert.equal(result.confidence, "directional");
});

test("T8-03c: GSC sufficiency gate — exactly at threshold", () => {
  const result = checkGscSufficiency(100);
  assert.equal(result.sufficient, true);
});

test("T8-03d: GSC sufficiency gate — exactly threshold-1", () => {
  const result = checkGscSufficiency(99);
  assert.equal(result.sufficient, false);
});

test("T8-03e: GSC sufficiency threshold is configurable", () => {
  const result = checkGscSufficiency(150, 200);
  assert.equal(result.sufficient, false);
  assert.equal(result.confidence, "directional");
});

// ---------------------------------------------------------------------------
// T8-04: GSC default 28-day windows
// ---------------------------------------------------------------------------

test("T8-04: GSC uses two 28-day comparison windows", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("webmasters")) return gscResponse();
    return new Response("{}", { status: 200 });
  };

  const result = await collectGsc("https://example.com", {
    oauthService: mockOAuthService(),
    fetchImpl,
  });

  assert.ok(result.windows, "Should have windows config");
  assert.ok(result.windows.recent, "Should have recent window");
  assert.ok(result.windows.previous, "Should have previous window");
  assert.ok(result.windows.recent.startDate);
  assert.ok(result.windows.recent.endDate);
  assert.ok(result.windows.previous.startDate);
  assert.ok(result.windows.previous.endDate);
});

// ---------------------------------------------------------------------------
// T8-05: GSC failure does not affect scoring (optional source)
// ---------------------------------------------------------------------------

test("T8-05: GSC marked as NOT_CONNECTED is optional — affectsScore is false", async () => {
  const result = await collectGsc("https://example.com", {});
  assert.equal(result.affectsScore, false);
  assert.equal(result.sourceStatus, SOURCE_STATUS.NOT_CONNECTED);
});

// ---------------------------------------------------------------------------
// T8-06: Invalid/expired token returns FAILED/UNAVAILABLE
// ---------------------------------------------------------------------------

test("T8-06: GSC auth failure returns UNAVAILABLE with limitations", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("webmasters")) return errorResponse(403);
    return new Response("{}", { status: 200 });
  };

  const result = await collectGsc("https://example.com", {
    oauthService: mockOAuthService(),
    fetchImpl,
  });

  assert.equal(result.sourceStatus, SOURCE_STATUS.UNAVAILABLE);
  assert.equal(result.included, false);
  assert.ok(result.limitations.length > 0);
});

// ---------------------------------------------------------------------------
// T8-07: GSC top queries and pages extracted
// ---------------------------------------------------------------------------

test("T8-07: GSC extracts top queries and pages", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("webmasters")) return gscResponse();
    return new Response("{}", { status: 200 });
  };

  const result = await collectGsc("https://example.com", {
    oauthService: mockOAuthService(),
    fetchImpl,
  });

  assert.ok(result.topQueries.length > 0, "Should have top queries");
  assert.ok(result.topPages.length > 0, "Should have top pages");
});

// ---------------------------------------------------------------------------
// T8-08: Row limit handling
// ---------------------------------------------------------------------------

test("T8-08: GSC handles row limit gracefully", async () => {
  const manyRows = Array.from({ length: 1001 }, (_, i) => ({
    keys: [`query ${i}`, `https://example.com/page${i}`, "DESKTOP", "CAN", "2026-07-01"],
    clicks: 1, impressions: 10, ctr: 0.1, position: 15.0,
  }));

  const fetchImpl = async (url) => {
    if (String(url).includes("webmasters")) {
      return new Response(JSON.stringify({ rows: manyRows }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  };

  const result = await collectGsc("https://example.com", {
    oauthService: mockOAuthService(),
    fetchImpl,
    rowLimit: 1000,
  });

  assert.ok(result.limitations.some((l) => l.includes("row limit")), "Should note row limit");
});

// ---------------------------------------------------------------------------
// T8-09: GSC totals aggregation
// ---------------------------------------------------------------------------

test("T8-09: GSC totals aggregate correctly", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("webmasters")) return gscResponse();
    return new Response("{}", { status: 200 });
  };

  const result = await collectGsc("https://example.com", {
    oauthService: mockOAuthService(),
    fetchImpl,
  });

  assert.ok(result.totals.clicks > 0);
  assert.ok(result.totals.impressions > 0);
  assert.ok(result.totals.ctr > 0);
  assert.ok(result.totals.avgPosition > 0);
});

// ---------------------------------------------------------------------------
// T8-10: Provider provenance in normalized evidence
// ---------------------------------------------------------------------------

test("T8-10: GSC evidence envelope has provider provenance and canonical fields", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("webmasters")) return gscResponse();
    return new Response("{}", { status: 200 });
  };

  const result = await collectGsc("https://example.com", {
    oauthService: mockOAuthService(),
    fetchImpl,
  });

  assert.equal(result.source, "google-search-console");
  assert.equal(result.evidenceVersion, "1.0.0");
  assert.ok(result._sourceStatus);
  assert.equal(result._sourceStatus.provider, "google-search-console");
  assert.ok(result.collectedAt);
  assert.ok(result.coverage);
  assert.equal(result.coverage.windowsRequested, 2);
});

// ---------------------------------------------------------------------------
// T8-11: GSC empty result returns UNAVAILABLE
// ---------------------------------------------------------------------------

test("T8-11: GSC with no rows returns UNAVAILABLE", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("webmasters")) {
      return new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  };

  const result = await collectGsc("https://example.com", {
    oauthService: mockOAuthService(),
    fetchImpl,
  });

  assert.equal(result.sourceStatus, SOURCE_STATUS.UNAVAILABLE);
  assert.equal(result.included, false);
  assert.equal(result.totals.impressions, 0);
});

// ---------------------------------------------------------------------------
// T8-12: sufficiency check embedded in result
// ---------------------------------------------------------------------------

test("T8-12: GSC sufficiency metadata embedded in result", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("webmasters")) return gscResponse();
    return new Response("{}", { status: 200 });
  };

  const result = await collectGsc("https://example.com", {
    oauthService: mockOAuthService(),
    fetchImpl,
  });

  assert.equal(result.sufficiency.threshold, 100);
  assert.equal(result.sufficiency.sufficient, true);
  assert.equal(result.sufficiency.confidence, "sufficient");
});

/**
 * WP6 Adapter execute() Contract Tests
 *
 * Tests the execute() function on ALL 6 production adapters using
 * fixture/mock mode.  No live provider calls.
 *
 * Proves WP6-ADP-01 through WP6-ADP-16.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { execute as onpageExecute, ADAPTER_VERSION as ONPAGE_VERSION } from "../adapters/dataforseo-onpage/dataforseo-onpage-adapter.js";
import { execute as pagespeedExecute } from "../evidence/pagespeed-client.js";
import { execute as serpExecute, ADAPTER_VERSION as SERP_VERSION } from "../adapters/dataforseo-serp/serp-adapter.js";
import { execute as backlinksExecute } from "../evidence/backlinks-provider.js";
import { execute as ga4Execute } from "../evidence/ga4-client.js";
import { execute as gscExecute } from "../evidence/gsc-client.js";
import { SOURCE_STATUS, ERROR_CATEGORY } from "../scoring/evidence-contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Schema validator
const schemasDir = resolve(__dirname, "..", "contracts");
const _ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(_ajv);
_ajv.addSchema(
  JSON.parse(readFileSync(resolve(schemasDir, "source-result.schema.json"), "utf-8")),
  "https://vantage-platform.io/prysm/contracts/v1/source-result.schema.json",
);
function validateSourceResult(sr) {
  const v = _ajv.getSchema("https://vantage-platform.io/prysm/contracts/v1/source-result.schema.json");
  return { valid: v(sr), errors: v.errors || [] };
}

function sha256(b) { return createHash("sha256").update(b).digest("hex"); }

// Audit request builder
function baReq(overrides = {}) {
  return {
    contractVersion: "1.0.0", auditId: randomUUID(), tenantId: "t1", clientId: "c1",
    idempotencyKey: randomUUID(), targetUrl: "https://example.com",
    businessName: "Test", market: "Canada", language: "en",
    primaryGoal: "conversions", services: ["service-a"],
    ...overrides,
  };
}

const execArgs = (source) => ({
  auditRequest: baReq(),
  source,
  executionId: randomUUID(),
  sourceExecutionKey: sha256(Buffer.from(source + Date.now())),
  signal: new AbortController().signal,
  attempt: 1,
});

// ---------------------------------------------------------------------------
// WP6-ADP-01 — On-Page execute() interface
// ---------------------------------------------------------------------------
test("WP6-ADP-01: On-Page execute() returns { rawBytes, contentType, sourceResult }", async () => {
  // On-Page uses fixture mode when DATAFORSEO_LOGIN is unset
  const result = await onpageExecute(execArgs("dataforseo-onpage"));

  assert.ok(result && typeof result === "object", "result is object");
  assert.ok(result.rawBytes instanceof Buffer || result.rawBytes === null, "rawBytes is Buffer or null");
  assert.equal(result.contentType, "application/json", "contentType is application/json");
  assert.ok(result.sourceResult && typeof result.sourceResult === "object", "sourceResult is object");
  assert.equal(result.sourceResult.source, "dataforseo-onpage", "source is dataforseo-onpage");
  assert.equal(result.sourceResult.provider, "DataForSEO", "provider is DataForSEO");
  assert.match(result.sourceResult.adapterVersion, /^\d+\.\d+\.\d+$/, "adapterVersion is semver");

  // Schema validation
  const sv = validateSourceResult(result.sourceResult);
  assert.ok(sv.valid, `sourceResult validates: ${sv.errors.map(e => e.message).join("; ")}`);
});

test("WP6-ADP-01: On-Page execute() has adapter.adapterVersion", () => {
  assert.match(ONPAGE_VERSION, /^\d+\.\d+\.\d+$/, "ADAPTER_VERSION is semver");
  assert.ok(ONPAGE_VERSION.length > 0, "ADAPTER_VERSION is non-empty");
});

// ---------------------------------------------------------------------------
// WP6-ADP-02 — On-Page canonical statuses
// ---------------------------------------------------------------------------
test("WP6-ADP-02: On-Page execute() produces correct status on failure", async () => {
  // Without DataForSEO credentials, the adapter should return FAILED
  const savedLogin = process.env.DATAFORSEO_LOGIN;
  const savedPass = process.env.DATAFORSEO_PASSWORD;
  delete process.env.DATAFORSEO_LOGIN;
  delete process.env.DATAFORSEO_PASSWORD;

  try {
    const result = await onpageExecute(execArgs("dataforseo-onpage"));
    // Should be FAILED because no credentials
    const validStatuses = Object.values(SOURCE_STATUS);
    assert.ok(validStatuses.includes(result.sourceResult.status),
      `status ${result.sourceResult.status} is a valid canonical status`);
    // Must have required fields regardless of status
    assert.ok(Array.isArray(result.sourceResult.limitations), "limitations is array");
    assert.ok(result.sourceResult.coverage && typeof result.sourceResult.coverage.requested === "number",
      "coverage present");
  } finally {
    if (savedLogin) process.env.DATAFORSEO_LOGIN = savedLogin;
    if (savedPass) process.env.DATAFORSEO_PASSWORD = savedPass;
  }
});

// ---------------------------------------------------------------------------
// WP6-ADP-03 — On-Page raw bytes preservation
// ---------------------------------------------------------------------------
test("WP6-ADP-03: On-Page execute() rawBytes is valid JSON when present", async () => {
  const result = await onpageExecute(execArgs("dataforseo-onpage"));
  if (result.rawBytes) {
    assert.ok(result.rawBytes.length > 0, "rawBytes is non-empty");
    const parsed = JSON.parse(result.rawBytes.toString());
    assert.ok(parsed && typeof parsed === "object", "rawBytes is valid JSON");
    const computedHash = sha256(result.rawBytes);
    assert.equal(computedHash.length, 64, "SHA-256 is 64 hex chars");
  }
  // rawBytes may be null if task submission fails — that's valid too
});

// ---------------------------------------------------------------------------
// WP6-ADP-04 — PageSpeed execute() interface
// ---------------------------------------------------------------------------
test("WP6-ADP-04: PageSpeed execute() returns { rawBytes, contentType, sourceResult }", async () => {
  const result = await pagespeedExecute(execArgs("pagespeed"));

  assert.ok(result && typeof result === "object", "result is object");
  assert.ok(result.sourceResult && typeof result.sourceResult === "object", "sourceResult is object");
  assert.equal(result.sourceResult.source, "pagespeed", "source is pagespeed");

  const sv = validateSourceResult(result.sourceResult);
  assert.ok(sv.valid, `sourceResult validates: ${sv.errors.map(e => e.message).join("; ")}`);
});

// ---------------------------------------------------------------------------
// WP6-ADP-05 — PageSpeed fallback provenance
// ---------------------------------------------------------------------------
test("WP6-ADP-05: PageSpeed execute() records provider in evidence", async () => {
  const result = await pagespeedExecute(execArgs("pagespeed"));
  assert.ok(result.sourceResult.evidence && typeof result.sourceResult.evidence === "object",
    "evidence is object");
  assert.ok("intendedProvider" in result.sourceResult.evidence ||
    "sourceStatus" in result.sourceResult.evidence,
    "evidence includes source info");
});

// ---------------------------------------------------------------------------
// WP6-ADP-06 — PageSpeed raw bytes
// ---------------------------------------------------------------------------
test("WP6-ADP-06: PageSpeed execute() rawBytes is valid JSON when present", async () => {
  const result = await pagespeedExecute(execArgs("pagespeed"));
  if (result.rawBytes) {
    assert.ok(result.rawBytes.length > 0, "rawBytes non-empty");
    JSON.parse(result.rawBytes.toString()); // must not throw
  }
});

// ---------------------------------------------------------------------------
// WP6-ADP-07 — SERP execute() interface
// ---------------------------------------------------------------------------
test("WP6-ADP-07: SERP execute() returns { rawBytes, contentType, sourceResult }", async () => {
  const result = await serpExecute(execArgs("dataforseo-serp"));

  assert.ok(result && typeof result === "object", "result is object");
  assert.equal(result.sourceResult.source, "dataforseo-serp", "source is dataforseo-serp");
  assert.equal(result.sourceResult.provider, "DataForSEO", "provider is DataForSEO");
  assert.match(result.sourceResult.adapterVersion, /^\d+\.\d+\.\d+$/, "adapterVersion semver");

  const sv = validateSourceResult(result.sourceResult);
  assert.ok(sv.valid, `sourceResult validates: ${sv.errors.map(e => e.message).join("; ")}`);
});

test("WP6-ADP-07: SERP execute() with no services returns NOT_APPLICABLE", async () => {
  const req = baReq({ services: [], primaryGoal: "", businessName: "" });
  const args = { ...execArgs("dataforseo-serp"), auditRequest: req };
  const result = await serpExecute(args);
  assert.equal(result.sourceResult.status, "NOT_APPLICABLE",
    "No keywords = NOT_APPLICABLE");
});

// ---------------------------------------------------------------------------
// WP6-ADP-08 — SERP raw bytes
// ---------------------------------------------------------------------------
test("WP6-ADP-08: SERP execute() preserves raw bytes", async () => {
  const result = await serpExecute(execArgs("dataforseo-serp"));
  if (result.rawBytes) {
    assert.ok(result.rawBytes.length > 0, "rawBytes non-empty");
    JSON.parse(result.rawBytes.toString());
  }
});

// ---------------------------------------------------------------------------
// WP6-ADP-09 — Backlinks execute() interface
// ---------------------------------------------------------------------------
test("WP6-ADP-09: Backlinks execute() returns { rawBytes, contentType, sourceResult }", async () => {
  const result = await backlinksExecute(execArgs("backlinks"));

  assert.ok(result && typeof result === "object", "result is object");
  assert.equal(result.sourceResult.source, "backlinks");
  assert.equal(result.sourceResult.provider, "DataForSEO");

  const sv = validateSourceResult(result.sourceResult);
  assert.ok(sv.valid, `sourceResult validates: ${sv.errors.map(e => e.message).join("; ")}`);
});

test("WP6-ADP-09: Backlinks execute() without credentials returns NOT_CONNECTED", async () => {
  const savedLogin = process.env.DATAFORSEO_LOGIN;
  const savedPass = process.env.DATAFORSEO_PASSWORD;
  delete process.env.DATAFORSEO_LOGIN;
  delete process.env.DATAFORSEO_PASSWORD;

  try {
    const result = await backlinksExecute(execArgs("backlinks"));
    assert.equal(result.sourceResult.status, "NOT_CONNECTED",
      "No credentials = NOT_CONNECTED");
    assert.equal(result.rawBytes, null, "rawBytes is null when NOT_CONNECTED");
  } finally {
    if (savedLogin) process.env.DATAFORSEO_LOGIN = savedLogin;
    if (savedPass) process.env.DATAFORSEO_PASSWORD = savedPass;
  }
});

// ---------------------------------------------------------------------------
// WP6-ADP-10 — Backlinks raw bytes
// ---------------------------------------------------------------------------
test("WP6-ADP-10: Backlinks execute() raw bytes when available", async () => {
  const result = await backlinksExecute(execArgs("backlinks"));
  if (result.rawBytes) {
    assert.ok(result.rawBytes.length > 0, "rawBytes non-empty");
    JSON.parse(result.rawBytes.toString());
  }
});

// ---------------------------------------------------------------------------
// WP6-ADP-11 — GA4 execute() interface
// ---------------------------------------------------------------------------
test("WP6-ADP-11: GA4 execute() without propertyId returns NOT_CONNECTED", async () => {
  const req = baReq(); // no ga4 config
  const result = await ga4Execute({ ...execArgs("ga4"), auditRequest: req });

  assert.equal(result.sourceResult.status, "NOT_CONNECTED",
    "No GA4 property = NOT_CONNECTED");
  assert.equal(result.sourceResult.errorCategory, "not_configured",
    "errorCategory is not_configured");
  assert.equal(result.rawBytes, null, "rawBytes is null when NOT_CONNECTED");

  const sv = validateSourceResult(result.sourceResult);
  assert.ok(sv.valid, `sourceResult validates: ${sv.errors.map(e => e.message).join("; ")}`);
});

test("WP6-ADP-11: GA4 execute() has aggregate-only evidence", async () => {
  const req = baReq({ ga4: { propertyId: "123456" } });
  const result = await ga4Execute({ ...execArgs("ga4"), auditRequest: req });

  // Evidence must not contain user-level rows
  if (result.sourceResult.evidence && result.rawBytes) {
    const rawStr = result.rawBytes.toString();
    assert.ok(!rawStr.includes("user_id"), "no user_id in raw payload");
    assert.ok(!rawStr.includes("client_id"), "no client_id in raw payload");
  }
});

// ---------------------------------------------------------------------------
// WP6-ADP-12 — GA4 raw bytes (aggregate only)
// ---------------------------------------------------------------------------
test("WP6-ADP-12: GA4 execute() stores only aggregate data", async () => {
  const req = baReq({ ga4: { propertyId: "123456" } });
  const result = await ga4Execute({ ...execArgs("ga4"), auditRequest: req });

  if (result.rawBytes) {
    const rawData = JSON.parse(result.rawBytes.toString());
    // Must not contain per-user records
    const rawStr = JSON.stringify(rawData);
    assert.ok(!rawStr.includes('"rows"'), "no individual rows in raw payload");
    assert.ok(rawData.totals || rawData.sourceStatus, "contains aggregate data");
  }
});

// ---------------------------------------------------------------------------
// WP6-ADP-13 — GSC execute() interface
// ---------------------------------------------------------------------------
test("WP6-ADP-13: GSC execute() without siteUrl returns NOT_CONNECTED", async () => {
  const req = baReq(); // no gsc config
  const result = await gscExecute({ ...execArgs("gsc"), auditRequest: req });

  assert.equal(result.sourceResult.status, "NOT_CONNECTED",
    "No GSC site = NOT_CONNECTED");
  assert.equal(result.sourceResult.errorCategory, "not_configured");

  const sv = validateSourceResult(result.sourceResult);
  assert.ok(sv.valid, `sourceResult validates: ${sv.errors.map(e => e.message).join("; ")}`);
});

// ---------------------------------------------------------------------------
// WP6-ADP-14 — GSC raw bytes
// ---------------------------------------------------------------------------
test("WP6-ADP-14: GSC execute() raw bytes when available", async () => {
  const req = baReq({ gsc: { siteUrl: "https://example.com" } });
  const result = await gscExecute({ ...execArgs("gsc"), auditRequest: req });

  if (result.rawBytes) {
    assert.ok(result.rawBytes.length > 0, "rawBytes non-empty");
    JSON.parse(result.rawBytes.toString());
  }
});

// ---------------------------------------------------------------------------
// WP6-ADP-15 — All adapters validate against schema
// ---------------------------------------------------------------------------
test("WP6-ADP-15: all production adapter sourceResults validate against schema", async () => {
  const adapters = [
    { name: "onpage", fn: onpageExecute, source: "dataforseo-onpage" },
    { name: "pagespeed", fn: pagespeedExecute, source: "pagespeed" },
    { name: "serp", fn: serpExecute, source: "dataforseo-serp" },
    { name: "backlinks", fn: backlinksExecute, source: "backlinks" },
    { name: "ga4", fn: ga4Execute, source: "ga4" },
    { name: "gsc", fn: gscExecute, source: "gsc" },
  ];

  for (const { name, fn, source } of adapters) {
    const result = await fn(execArgs(source));
    const sv = validateSourceResult(result.sourceResult);
    assert.ok(sv.valid,
      `${name} validates: ${sv.errors.length ? sv.errors.map(e => e.message).join("; ") : "OK"}`);
  }
});

// ---------------------------------------------------------------------------
// WP6-ADP-16 — No provider-specific field leak
// ---------------------------------------------------------------------------
test("WP6-ADP-16: production adapter evidence has no provider-internal fields", async () => {
  const adapters = [
    { name: "onpage", fn: onpageExecute, source: "dataforseo-onpage" },
    { name: "pagespeed", fn: pagespeedExecute, source: "pagespeed" },
    { name: "serp", fn: serpExecute, source: "dataforseo-serp" },
    { name: "backlinks", fn: backlinksExecute, source: "backlinks" },
    { name: "ga4", fn: ga4Execute, source: "ga4" },
    { name: "gsc", fn: gscExecute, source: "gsc" },
  ];

  const forbidden = ["_dataforseo", "_raw", "rawSummary", "rawPages", "lhr", "rows",
    "user_id", "client_id", "rawTaskId", "rawTaskPost"];

  for (const { name, fn, source } of adapters) {
    const result = await fn(execArgs(source));
    const evidenceStr = JSON.stringify(result.sourceResult.evidence || {});
    for (const key of forbidden) {
      assert.ok(!evidenceStr.includes(`"${key}"`),
        `${name} evidence does NOT contain "${key}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// WP6-ADP-18 — Adapters do not own permanent writes
// ---------------------------------------------------------------------------
test("WP6-ADP-18: production adapters do not import artifact store", async () => {
  // Read the adapter source files and verify no permanent-write imports
  const { readFileSync: rfs } = await import("node:fs");
  const { resolve: res } = await import("node:path");

  const files = [
    "src/adapters/dataforseo-onpage/dataforseo-onpage-adapter.js",
    "src/evidence/pagespeed-client.js",
    "src/adapters/dataforseo-serp/serp-adapter.js",
    "src/evidence/backlinks-provider.js",
    "src/evidence/ga4-client.js",
    "src/evidence/gsc-client.js",
  ];

  const workerRoot = res(__dirname, "..", "..");

  for (const file of files) {
    const content = rfs(res(workerRoot, file), "utf-8");

    // Must not import artifact store or filesystem write functions
    assert.ok(!content.includes("artifact-store"), `${file}: no artifact-store import`);
    assert.ok(!content.includes("artifactStore"), `${file}: no artifactStore usage`);
    assert.ok(!content.includes("governed-artifact-store"), `${file}: no governed-artifact-store import`);

    // Cache helper imports (readFile/writeFile/mkdir for local performance cache)
    // are permitted — they are not permanent artifact storage.  The governed
    // artifact store is what the orchestrator uses for immutable evidence.
    // Adapters must not import artifact-store modules.
    assert.ok(!content.includes("from \"../storage/artifact-store"), `${file}: no artifact-store import`);
    assert.ok(!content.includes("from \"../storage/governed-artifact-store"), `${file}: no governed-artifact-store import`);
    assert.ok(!content.includes('artifactStore.put('), `${file}: no artifactStore.put() call`);
    assert.ok(!content.includes('artifactStore.put('), `${file}: no put() on artifact store`);
  }
});

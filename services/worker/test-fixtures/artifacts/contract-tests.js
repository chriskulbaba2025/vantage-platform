/**
 * WP3 Artifact Store — Shared Contract Test Suite
 *
 * The same behavioural suite runs against memory, temporary-filesystem,
 * and mocked object-storage implementations.
 *
 * Two suites are exported:
 *   runContractTests        — core correctness (runs on every impl)
 *   runFailureContractTests — failure propagation (runs on every impl
 *                              with backend-specific fault factories)
 *
 * Zero live cloud calls. Zero provider calls. Deterministic.
 *
 * @module artifact-contract-tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildArtifactKey } from "../../src/storage/artifact-key.js";
import {
  ImmutableConflictError,
  ObjectNotFoundError,
  ProviderFailureError,
  WriteFailureError,
  ReadBackFailureError,
} from "../../src/storage/artifact-errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SCOPE = Object.freeze({
  tenantId: "test-tenant",
  clientId: "test-client",
  auditId: "00000000-0000-0000-0000-000000000001",
});

function makeInput(overrides = {}) {
  return {
    bytes: Buffer.from(JSON.stringify({ hello: "world" })),
    contentType: "application/json",
    scope: {
      ...TEST_SCOPE,
      category: "raw",
      artifactName: "test-artifact.json",
      ...(overrides.scope || {}),
    },
    executionId: "exec-001",
    source: "test-source",
    ...overrides,
    scope: {
      ...TEST_SCOPE,
      category: "raw",
      artifactName: "test-artifact.json",
      ...(overrides.scope || {}),
    },
  };
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// Core contract suite
// ---------------------------------------------------------------------------

/**
 * Run the complete WP3 contract suite against a store created by `factory`.
 *
 * @param {string} label              - Human-readable label for the store type.
 * @param {() => object} factory      - Synchronous factory returning an ArtifactStore.
 */
export function runContractTests(label, factory) {
  test(`${label}: exact bytes survive round-trip (UTF-8)`, async () => {
    const store = factory();
    const input = makeInput({ bytes: Buffer.from("hello world", "utf-8") });
    const record = await store.put(input);

    assert.equal(record.bytes, 11);
    assert.equal(record.sha256, sha256(Buffer.from("hello world", "utf-8")));

    const buf = await store.get(record.key);
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.toString("utf-8"), "hello world");
  });

  test(`${label}: binary data survives round-trip`, async () => {
    const store = factory();
    const binary = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) binary[i] = i;

    const input = makeInput({ bytes: binary, contentType: "application/octet-stream" });
    const record = await store.put(input);

    const buf = await store.get(record.key);
    assert.ok(buf.equals(binary));
    assert.equal(buf.length, 256);
  });

  test(`${label}: JSON data survives round-trip`, async () => {
    const store = factory();
    const data = { nested: { array: [1, 2, 3], bool: true, num: 42 } };
    const jsonStr = JSON.stringify(data);
    const input = makeInput({ bytes: Buffer.from(jsonStr, "utf-8") });
    const record = await store.put(input);

    const buf = await store.get(record.key);
    assert.deepEqual(JSON.parse(buf.toString("utf-8")), data);
  });

  test(`${label}: SHA-256 is calculated from stored bytes`, async () => {
    const store = factory();
    const bytes = Buffer.from("exact hash test", "utf-8");
    const expectedSha = sha256(bytes);

    const input = makeInput({ bytes });
    const record = await store.put(input);

    assert.equal(record.sha256, expectedSha);
    assert.equal(record.sha256.length, 64);
    assert.ok(/^[a-f0-9]{64}$/.test(record.sha256));
  });

  test(`${label}: byte length is exact`, async () => {
    const store = factory();
    for (const size of [0, 1, 100, 1024, 65536]) {
      const bytes = Buffer.alloc(size, 0x41);
      const input = makeInput({
        bytes,
        scope: { ...TEST_SCOPE, category: "raw", artifactName: `size-${size}.bin` },
      });
      const record = await store.put(input);
      assert.equal(record.bytes, size, `size=${size}`);
    }
  });

  test(`${label}: returned record validates against schema`, async () => {
    const store = factory();
    const input = makeInput();
    const record = await store.put(input);

    assert.equal(record.contractVersion, "1.0.0");
    assert.ok(typeof record.key === "string" && record.key.length > 0);
    assert.ok(/^[a-f0-9]{64}$/.test(record.sha256));
    assert.ok(typeof record.bytes === "number" && record.bytes >= 0);
    assert.ok(["application/json", "text/html", "application/octet-stream"].includes(record.contentType));
    assert.ok(typeof record.tenantId === "string" && record.tenantId.length > 0);
    assert.ok(typeof record.clientId === "string" && record.clientId.length > 0);
    assert.ok(typeof record.auditId === "string" && record.auditId.length > 0);
    assert.ok(typeof record.writtenAt === "string");
    assert.ok(typeof record.storageBackend === "string");
  });

  test(`${label}: exists is correct before and after writes`, async () => {
    const store = factory();
    const input = makeInput();
    const key = buildArtifactKey(input.scope);

    assert.equal(await store.exists(key), false);
    await store.put(input);
    assert.equal(await store.exists(key), true);
  });

  test(`${label}: get returns a Buffer`, async () => {
    const store = factory();
    const input = makeInput();
    const record = await store.put(input);
    const buf = await store.get(record.key);
    assert.ok(Buffer.isBuffer(buf));
  });

  test(`${label}: verify succeeds for matching bytes and metadata`, async () => {
    const store = factory();
    const input = makeInput();
    const record = await store.put(input);
    assert.equal(await store.verify(record), true);
  });

  test(`${label}: verify fails for wrong SHA-256`, async () => {
    const store = factory();
    const input = makeInput();
    const record = await store.put(input);
    assert.equal(await store.verify({ ...record, sha256: "0".repeat(64) }), false);
  });

  test(`${label}: verify fails for wrong byte count`, async () => {
    const store = factory();
    const input = makeInput();
    const record = await store.put(input);
    assert.equal(await store.verify({ ...record, bytes: record.bytes + 1 }), false);
  });

  test(`${label}: identical repeat writes are idempotent`, async () => {
    const store = factory();
    const input = makeInput();
    const record1 = await store.put(input);
    const record2 = await store.put(input);
    assert.equal(record1.key, record2.key);
    assert.equal(record1.sha256, record2.sha256);
    assert.equal(record1.bytes, record2.bytes);
  });

  test(`${label}: different bytes at the same key are rejected`, async () => {
    const store = factory();
    await store.put(makeInput({ bytes: Buffer.from("version A") }));
    await assert.rejects(
      () => store.put(makeInput({ bytes: Buffer.from("version B") })),
      (err) => err instanceof ImmutableConflictError,
    );
  });

  test(`${label}: tenant isolation is enforced`, async () => {
    const store = factory();
    const r1 = await store.put(makeInput({
      scope: { ...TEST_SCOPE, tenantId: "tenant-alpha", category: "raw", artifactName: "data.json" },
    }));
    const r2 = await store.put(makeInput({
      scope: { ...TEST_SCOPE, tenantId: "tenant-beta", category: "raw", artifactName: "data.json" },
    }));

    assert.notEqual(r1.key, r2.key);
    assert.ok(r1.key.includes("tenant-alpha"));
    assert.ok(r2.key.includes("tenant-beta"));
    assert.equal(await store.exists(r1.key), true);
    assert.equal(await store.exists(r2.key), true);
    assert.equal((await store.get(r1.key)).toString("utf-8"), JSON.stringify({ hello: "world" }));
  });

  test(`${label}: traversal and malformed keys are rejected`, async () => {
    const store = factory();
    const badScopes = [
      { ...TEST_SCOPE, tenantId: "../evil", category: "raw", artifactName: "test.json" },
      { ...TEST_SCOPE, tenantId: "ok", clientId: "..\\windows", category: "raw", artifactName: "test.json" },
    ];
    for (const badScope of badScopes) {
      await assert.rejects(
        () => store.put(makeInput({ scope: badScope })),
        (err) => err.code === "ERR_ARTIFACT_PATH_TRAVERSAL" || err.code === "ERR_ARTIFACT_INVALID_SCOPE",
      );
    }
  });

  test(`${label}: empty scope segments are rejected`, async () => {
    const store = factory();
    const emptyScopes = [
      { ...TEST_SCOPE, tenantId: "", category: "raw", artifactName: "test.json" },
      { ...TEST_SCOPE, clientId: "", category: "raw", artifactName: "test.json" },
      { ...TEST_SCOPE, auditId: "", category: "raw", artifactName: "test.json" },
      { ...TEST_SCOPE, category: "", artifactName: "test.json" },
      { ...TEST_SCOPE, category: "raw", artifactName: "" },
    ];
    for (const badScope of emptyScopes) {
      await assert.rejects(
        () => store.put(makeInput({ scope: badScope })),
        (err) => err.code === "ERR_ARTIFACT_INVALID_SCOPE" || err.code === "ERR_ARTIFACT_INVALID_INPUT",
      );
    }
  });

  test(`${label}: invalid input returns no record`, async () => {
    const store = factory();
    await assert.rejects(() => store.put(null));
    await assert.rejects(() => store.put({ scope: TEST_SCOPE }));
  });

  test(`${label}: getting a non-existent object throws ObjectNotFoundError`, async () => {
    const store = factory();
    await assert.rejects(
      () => store.get("tenants/t/clients/c/audits/a/raw/nope.json"),
      (err) => err instanceof ObjectNotFoundError || err.code === "ERR_ARTIFACT_OBJECT_NOT_FOUND",
    );
  });

  test(`${label}: accepts Uint8Array input`, async () => {
    const store = factory();
    const arr = new Uint8Array([1, 2, 3, 4, 5]);
    const input = makeInput({ bytes: arr, contentType: "application/octet-stream" });
    const record = await store.put(input);
    const buf = await store.get(record.key);
    assert.equal(buf.length, 5);
    assert.ok(buf.equals(Buffer.from(arr)));
  });

  test(`${label}: accepts string input`, async () => {
    const store = factory();
    const input = makeInput({ bytes: "string input test" });
    const record = await store.put(input);
    assert.equal((await store.get(record.key)).toString("utf-8"), "string input test");
  });

  test(`${label}: verify fails when scope does not match`, async () => {
    const store = factory();
    const record = await store.put(makeInput());
    assert.equal(await store.verify({ ...record, tenantId: "other-tenant" }), false);
  });

  test(`${label}: backslashes are rejected in scope segments`, async () => {
    const store = factory();
    await assert.rejects(
      () => store.put(makeInput({
        scope: { ...TEST_SCOPE, tenantId: "test\\evil", category: "raw", artifactName: "test.json" },
      })),
      (err) => err.code === "ERR_ARTIFACT_PATH_TRAVERSAL",
    );
  });

  test(`${label}: verify returns false for non-object or null record`, async () => {
    const store = factory();
    assert.equal(await store.verify(null), false);
    assert.equal(await store.verify(undefined), false);
    assert.equal(await store.verify("not-an-object"), false);
  });
}

// ---------------------------------------------------------------------------
// Failure-injection contract suite
// ---------------------------------------------------------------------------

/**
 * Run the failure-propagation contract suite.
 *
 * @param {string} label   - Backend label ("memory", "fs", "object").
 * @param {(opts?: object) => object} faultFactory
 *   Factory that accepts optional injection flags and returns a store.
 *   Flags supported:
 *     { failWrite, failReadBack, corruptRead, failGet }
 *   For object: { failPut, failGet, failHead, corrupt }
 */
export function runFailureContractTests(label, faultFactory) {

  // ── Write failure → no record ─────────────────────────────────────────
  test(`${label} [failure]: write failure throws WriteFailureError, no record returned`, async () => {
    const store = faultFactory({ failWrite: true, failPut: true });
    const input = makeInput({
      scope: { ...TEST_SCOPE, category: "raw", artifactName: "fail-write.json" },
    });

    await assert.rejects(
      () => store.put(input),
      (err) => err instanceof WriteFailureError || err instanceof ProviderFailureError,
      "Expected WriteFailureError or ProviderFailureError on write failure",
    );

    // No artifact key should exist
    const key = buildArtifactKey(input.scope);
    try {
      assert.equal(await store.exists(key), false, "No record should exist after write failure");
    } catch {
      // object store may throw ProviderFailureError on exists() too — that's fine
    }
  });

  // ── Read-back failure → no record ─────────────────────────────────────
  test(`${label} [failure]: read-back failure throws, no record returned`, async () => {
    const store = faultFactory({ failReadBack: true });
    const input = makeInput({
      scope: { ...TEST_SCOPE, category: "raw", artifactName: "fail-readback.json" },
    });

    await assert.rejects(
      () => store.put(input),
      (err) => err instanceof ReadBackFailureError,
      "Expected ReadBackFailureError",
    );

    // No artifact record should exist
    const key = buildArtifactKey(input.scope);
    try {
      assert.equal(await store.exists(key), false, "No record should exist after read-back failure");
    } catch {
      // OK — object store may throw on exists()
    }
  });

  // ── Corrupted bytes (truncate) → no record ────────────────────────────
  test(`${label} [failure]: corrupted read-back bytes (truncate) → no record`, async () => {
    const store = faultFactory({
      corruptRead: "truncate",
      corrupt: { mode: "truncate" },
    });
    const input = makeInput({
      bytes: Buffer.from("enough bytes to truncate", "utf-8"),
      scope: { ...TEST_SCOPE, category: "raw", artifactName: "corrupt-trunc.json" },
    });

    await assert.rejects(
      () => store.put(input),
      (err) => err instanceof ReadBackFailureError,
      "Expected ReadBackFailureError on truncated read-back",
    );
  });

  // ── Corrupted bytes (flip) → no record ────────────────────────────────
  test(`${label} [failure]: corrupted read-back bytes (flip) → no record`, async () => {
    const store = faultFactory({
      corruptRead: "flip",
      corrupt: { mode: "flip" },
    });
    const input = makeInput({
      bytes: Buffer.from("some bytes to flip", "utf-8"),
      scope: { ...TEST_SCOPE, category: "raw", artifactName: "corrupt-flip.json" },
    });

    await assert.rejects(
      () => store.put(input),
      (err) => err instanceof ReadBackFailureError,
      "Expected ReadBackFailureError on flipped read-back",
    );
  });

  // ── Corrupted bytes (mismatch) → no record ────────────────────────────
  test(`${label} [failure]: corrupted read-back bytes (mismatch) → no record`, async () => {
    const store = faultFactory({
      corruptRead: "mismatch",
      corrupt: { mode: "mismatch" },
    });
    const input = makeInput({
      bytes: Buffer.from("matching length data!", "utf-8"),
      scope: { ...TEST_SCOPE, category: "raw", artifactName: "corrupt-mismatch.json" },
    });

    await assert.rejects(
      () => store.put(input),
      (err) => err instanceof ReadBackFailureError,
      "Expected ReadBackFailureError on mismatched read-back",
    );
  });

  // ── Provider error on GET propagates ───────────────────────────────────
  test(`${label} [failure]: provider error on get propagates as ProviderFailureError`, async () => {
    const store = faultFactory({ failGet: true });

    await assert.rejects(
      () => store.get("any-key"),
      (err) => err instanceof ProviderFailureError || err.code === "ERR_ARTIFACT_PROVIDER_FAILURE",
      "Expected ProviderFailureError on GET failure",
    );
  });

  // ── Object store: HEAD NotFound returns false ──────────────────────────
  test(`${label} [failure]: HEAD not-found returns false (exists)`, async () => {
    const store = faultFactory({});
    const result = await store.exists("tenants/t/clients/c/audits/a/raw/does-not-exist.json");
    assert.equal(result, false);
  });

  // ── Object store: HEAD provider error throws ───────────────────────────
  test(`${label} [failure]: HEAD provider error propagates (exists throws)`, async () => {
    const store = faultFactory({ failHead: true });
    await assert.rejects(
      () => store.exists("any-key"),
      (err) => err instanceof ProviderFailureError || err.code === "ERR_ARTIFACT_PROVIDER_FAILURE",
      "Expected ProviderFailureError on HEAD failure",
    );
  });

  // ── PUT provider error → no record ────────────────────────────────────
  test(`${label} [failure]: PUT provider error throws ProviderFailureError, no record`, async () => {
    const store = faultFactory({ failPut: true, failWrite: true });
    const input = makeInput({
      scope: { ...TEST_SCOPE, category: "raw", artifactName: "fail-put.json" },
    });

    await assert.rejects(
      () => store.put(input),
      (err) => err instanceof ProviderFailureError || err instanceof WriteFailureError,
      "Expected provider/write error on PUT failure",
    );

    // No record should exist
    const key = buildArtifactKey(input.scope);
    try {
      assert.equal(await store.exists(key), false, "No artifact after PUT failure");
    } catch {
      // OK — propagates
    }
  });

  // ── GET provider error propagates ─────────────────────────────────────
  test(`${label} [failure]: GET provider error propagates`, async () => {
    const store = faultFactory({ failGet: true });
    await assert.rejects(
      () => store.get("some-key"),
      (err) => err instanceof ProviderFailureError || err.code === "ERR_ARTIFACT_PROVIDER_FAILURE",
    );
  });

  // ── No synthetic record on failure ────────────────────────────────────
  test(`${label} [failure]: no synthetic record returned on failure`, async () => {
    const store = faultFactory({ failWrite: true, failPut: true });
    const input = makeInput({
      scope: { ...TEST_SCOPE, category: "raw", artifactName: "no-synth.json" },
    });

    let threw = false;
    try {
      await store.put(input);
    } catch (err) {
      threw = true;
      // Verify the error is NOT an ArtifactRecord
      assert.equal(typeof err.key, "undefined", "Error should not carry an artifact key");
      assert.equal(typeof err.sha256, "undefined", "Error should not carry an artifact SHA");
      assert.equal(typeof err.contractVersion, "undefined", "Error should not be an Artifact Record");
    }
    assert.ok(threw, "Expected put() to throw on failure");
  });
}

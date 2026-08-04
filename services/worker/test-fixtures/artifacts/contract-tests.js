/**
 * WP3 Artifact Store — Shared Contract Test Suite
 *
 * The same behavioural suite runs against memory, temporary-filesystem,
 * and mocked object-storage implementations.
 *
 * Every test uses a fresh store factory provided by the caller.
 * Zero live cloud calls. Zero provider calls. Deterministic.
 *
 * @module artifact-contract-tests
 *
 * Usage:
 *   import { runContractTests } from "../../test-fixtures/artifacts/contract-tests.js";
 *   import { createMemoryArtifactStore } from "../../src/storage/memory-artifact-store.js";
 *
 *   // In a test file:
 *   runContractTests("memory", () => createMemoryArtifactStore());
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildArtifactKey } from "../../src/storage/artifact-key.js";
import {
  ImmutableConflictError,
  ObjectNotFoundError,
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
// Suite runner
// ---------------------------------------------------------------------------

/**
 * Run the complete WP3 contract suite against a store created by `factory`.
 *
 * @param {string} label              - Human-readable label for the store type.
 * @param {() => object} factory      - Synchronous factory returning an ArtifactStore.
 * @param {object} [opts]
 * @param {boolean} [opts.skipSlow]   - Skip teardown-heavy tests.
 */
export function runContractTests(label, factory, opts = {}) {
  // ── Round-trip: text ──────────────────────────────────────────────────
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

  // ── Round-trip: binary ────────────────────────────────────────────────
  test(`${label}: binary data survives round-trip`, async () => {
    const store = factory();
    const binary = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) binary[i] = i;

    const input = makeInput({
      bytes: binary,
      contentType: "application/octet-stream",
    });
    const record = await store.put(input);

    const buf = await store.get(record.key);
    assert.ok(buf.equals(binary));
    assert.equal(buf.length, 256);
  });

  // ── Round-trip: JSON ──────────────────────────────────────────────────
  test(`${label}: JSON data survives round-trip`, async () => {
    const store = factory();
    const data = { nested: { array: [1, 2, 3], bool: true, num: 42 } };
    const jsonStr = JSON.stringify(data);
    const input = makeInput({ bytes: Buffer.from(jsonStr, "utf-8") });
    const record = await store.put(input);

    const buf = await store.get(record.key);
    assert.deepEqual(JSON.parse(buf.toString("utf-8")), data);
  });

  // ── Exact SHA-256 ─────────────────────────────────────────────────────
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

  // ── Exact byte length ─────────────────────────────────────────────────
  test(`${label}: byte length is exact`, async () => {
    const store = factory();
    for (const size of [0, 1, 100, 1024, 65536]) {
      const bytes = Buffer.alloc(size, 0x41);
      const input = makeInput({
        bytes,
        scope: {
          ...TEST_SCOPE,
          category: "raw",
          artifactName: `size-${size}.bin`,
        },
      });
      const record = await store.put(input);
      assert.equal(record.bytes, size, `size=${size}`);
    }
  });

  // ── Artifact Record schema validation ─────────────────────────────────
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

  // ── exists before and after ───────────────────────────────────────────
  test(`${label}: exists is correct before and after writes`, async () => {
    const store = factory();
    const input = makeInput();
    const key = buildArtifactKey(input.scope);

    assert.equal(await store.exists(key), false);
    await store.put(input);
    assert.equal(await store.exists(key), true);
  });

  // ── get returns Buffer ────────────────────────────────────────────────
  test(`${label}: get returns a Buffer`, async () => {
    const store = factory();
    const input = makeInput();
    const record = await store.put(input);
    const buf = await store.get(record.key);

    assert.ok(Buffer.isBuffer(buf));
  });

  // ── verify succeeds for matching bytes ────────────────────────────────
  test(`${label}: verify succeeds for matching bytes and metadata`, async () => {
    const store = factory();
    const input = makeInput();
    const record = await store.put(input);

    const verified = await store.verify(record);
    assert.equal(verified, true);
  });

  // ── verify fails for wrong SHA ────────────────────────────────────────
  test(`${label}: verify fails for wrong SHA-256`, async () => {
    const store = factory();
    const input = makeInput();
    const record = await store.put(input);

    const tampered = { ...record, sha256: "0".repeat(64) };
    const verified = await store.verify(tampered);
    assert.equal(verified, false);
  });

  // ── verify fails for wrong bytes ──────────────────────────────────────
  test(`${label}: verify fails for wrong byte count`, async () => {
    const store = factory();
    const input = makeInput();
    const record = await store.put(input);

    const tampered = { ...record, bytes: record.bytes + 1 };
    const verified = await store.verify(tampered);
    assert.equal(verified, false);
  });

  // ── Idempotent repeat writes ──────────────────────────────────────────
  test(`${label}: identical repeat writes are idempotent`, async () => {
    const store = factory();
    const input = makeInput();
    const record1 = await store.put(input);
    const record2 = await store.put(input);

    assert.equal(record1.key, record2.key);
    assert.equal(record1.sha256, record2.sha256);
    assert.equal(record1.bytes, record2.bytes);
  });

  // ── Immutable-write conflict ──────────────────────────────────────────
  test(`${label}: different bytes at the same key are rejected`, async () => {
    const store = factory();
    const input1 = makeInput({ bytes: Buffer.from("version A") });
    const input2 = makeInput({ bytes: Buffer.from("version B") });

    await store.put(input1);
    await assert.rejects(
      () => store.put(input2),
      (err) => err instanceof ImmutableConflictError,
    );
  });

  // ── Tenant isolation ──────────────────────────────────────────────────
  test(`${label}: tenant isolation is enforced`, async () => {
    const store = factory();
    const tenant1 = makeInput({
      scope: { ...TEST_SCOPE, tenantId: "tenant-alpha", category: "raw", artifactName: "data.json" },
    });
    const tenant2 = makeInput({
      scope: { ...TEST_SCOPE, tenantId: "tenant-beta", category: "raw", artifactName: "data.json" },
    });

    const r1 = await store.put(tenant1);
    const r2 = await store.put(tenant2);

    assert.notEqual(r1.key, r2.key);
    assert.ok(r1.key.includes("tenant-alpha"));
    assert.ok(r2.key.includes("tenant-beta"));

    // Each tenant can only see their own artifacts
    assert.equal(await store.exists(r1.key), true);
    assert.equal(await store.exists(r2.key), true);

    const buf1 = await store.get(r1.key);
    assert.equal(buf1.toString("utf-8"), JSON.stringify({ hello: "world" }));
  });

  // ── Traversal rejection ───────────────────────────────────────────────
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
        `Expected traversal rejection for scope: ${JSON.stringify(badScope)}`,
      );
    }
  });

  // ── Empty scope rejection ─────────────────────────────────────────────
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
        `Expected rejection for empty scope: ${JSON.stringify(badScope)}`,
      );
    }
  });

  // ── Failed writes return no record ────────────────────────────────────
  test(`${label}: invalid input returns no record`, async () => {
    const store = factory();

    // null input
    await assert.rejects(() => store.put(null));
    // missing bytes
    await assert.rejects(() => store.put({ scope: TEST_SCOPE }));
  });

  // ── Object not found ──────────────────────────────────────────────────
  test(`${label}: getting a non-existent object throws ObjectNotFoundError`, async () => {
    const store = factory();
    await assert.rejects(
      () => store.get("tenants/t/clients/c/audits/a/raw/nope.json"),
      (err) => err instanceof ObjectNotFoundError || err.code === "ERR_ARTIFACT_OBJECT_NOT_FOUND",
    );
  });

  // ── Uint8Array input accepted ─────────────────────────────────────────
  test(`${label}: accepts Uint8Array input`, async () => {
    const store = factory();
    const arr = new Uint8Array([1, 2, 3, 4, 5]);
    const input = makeInput({ bytes: arr, contentType: "application/octet-stream" });
    const record = await store.put(input);
    const buf = await store.get(record.key);
    assert.equal(buf.length, 5);
    assert.ok(buf.equals(Buffer.from(arr)));
  });

  // ── String input accepted ─────────────────────────────────────────────
  test(`${label}: accepts string input`, async () => {
    const store = factory();
    const input = makeInput({ bytes: "string input test" });
    const record = await store.put(input);
    const buf = await store.get(record.key);
    assert.equal(buf.toString("utf-8"), "string input test");
  });

  // ── verify fails for wrong tenant ─────────────────────────────────────
  test(`${label}: verify fails when scope does not match`, async () => {
    const store = factory();
    const input = makeInput();
    const record = await store.put(input);

    const tampered = { ...record, tenantId: "other-tenant" };
    assert.equal(await store.verify(tampered), false);
  });

  // ── Backslash rejection in keys ───────────────────────────────────────
  test(`${label}: backslashes are rejected in scope segments`, async () => {
    const store = factory();
    await assert.rejects(
      () => store.put(makeInput({
        scope: { ...TEST_SCOPE, tenantId: "test\\evil", category: "raw", artifactName: "test.json" },
      })),
      (err) => err.code === "ERR_ARTIFACT_PATH_TRAVERSAL",
    );
  });

  // ── verify with non-object record ─────────────────────────────────────
  test(`${label}: verify returns false for non-object or null record`, async () => {
    const store = factory();
    assert.equal(await store.verify(null), false);
    assert.equal(await store.verify(undefined), false);
    assert.equal(await store.verify("not-an-object"), false);
  });
}

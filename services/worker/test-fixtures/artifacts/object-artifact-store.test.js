/**
 * WP3 Object Artifact Store — Contract Tests (Mocked)
 *
 * Runs the full governed contract suite + failure-injection suite against
 * the object-storage implementation using a mock client and mock AWS
 * command constructors.
 *
 * Also includes production-shaped S3 binary stream tests that verify
 * exact-byte preservation through every AWS SDK Body shape.
 *
 * Zero live cloud calls. Zero provider calls. Deterministic.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runContractTests, runFailureContractTests } from "./contract-tests.js";
import { createObjectArtifactStore } from "../../src/storage/object-artifact-store.js";

// ---------------------------------------------------------------------------
// Mock AWS command constructors
//
// These produce objects whose shape matches the real @aws-sdk/client-s3
// commands.  The mock client inspects the `name` property (set by the
// real SDK) or the constructor identity to dispatch.
// ---------------------------------------------------------------------------

class MockPutObjectCommand {
  static name = "PutObjectCommand";
  constructor(input) {
    this._name = "PutObjectCommand";
    this.input = input;
    this.Bucket = input.Bucket;
    this.Key = input.Key;
    this.Body = input.Body;
    this.ContentType = input.ContentType;
  }
}

class MockGetObjectCommand {
  static name = "GetObjectCommand";
  constructor(input) {
    this._name = "GetObjectCommand";
    this.input = input;
    this.Bucket = input.Bucket;
    this.Key = input.Key;
  }
}

class MockHeadObjectCommand {
  static name = "HeadObjectCommand";
  constructor(input) {
    this._name = "HeadObjectCommand";
    this.input = input;
    this.Bucket = input.Bucket;
    this.Key = input.Key;
  }
}

const MOCK_COMMANDS = {
  PutObjectCommand: MockPutObjectCommand,
  GetObjectCommand: MockGetObjectCommand,
  HeadObjectCommand: MockHeadObjectCommand,
};

// ---------------------------------------------------------------------------
// Mock S3 client factory
// ---------------------------------------------------------------------------

/**
 * Create a mock S3 client backed by an in-memory Map.
 *
 * Dispatches on `command._name` (matching real AWS SDK Command names).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.failPut]   - If true, PUT throws a service error.
 * @param {boolean} [opts.failGet]   - If true, GET throws a service error.
 * @param {boolean} [opts.failHead]  - If true, HEAD throws a service error.
 * @param {object}  [opts.corrupt]   - If set, GET returns corrupted data.
 */
function createMockS3Client(opts = {}) {
  const store = new Map();

  return {
    store, // exposed for test assertions

    async send(command) {
      const cmd = command._name || command.constructor?.name || "";

      // Service-level failure injection
      if (opts.failHead && cmd === "HeadObjectCommand") {
        const err = new Error("Service Unavailable");
        err.name = "ServiceUnavailable";
        err.Code = "ServiceUnavailable";
        err.$metadata = { httpStatusCode: 503 };
        throw err;
      }

      if (opts.failGet && cmd === "GetObjectCommand") {
        const err = new Error("Internal Server Error");
        err.name = "InternalError";
        err.Code = "InternalError";
        err.$metadata = { httpStatusCode: 500 };
        throw err;
      }

      if (opts.failPut && cmd === "PutObjectCommand") {
        const err = new Error("Access Denied");
        err.name = "AccessDenied";
        err.Code = "AccessDenied";
        err.$metadata = { httpStatusCode: 403 };
        throw err;
      }

      switch (cmd) {
        case "PutObjectCommand": {
          const body = Buffer.isBuffer(command.Body)
            ? command.Body
            : Buffer.from(command.Body || "", "utf-8");
          store.set(command.Key, {
            body,
            contentType: command.ContentType || "application/octet-stream",
          });
          return {};
        }

        case "GetObjectCommand": {
          const obj = store.get(command.Key);
          if (!obj) {
            const err = new Error("NoSuchKey");
            err.name = "NoSuchKey";
            err.Code = "NoSuchKey";
            throw err;
          }
          let body = Buffer.from(obj.body);
          // Byte corruption injection — corrupts ALL reads when active
          if (opts.corrupt) {
            if (opts.corrupt.mode === "truncate") {
              body = body.subarray(0, Math.max(0, body.length - 1));
            } else if (opts.corrupt.mode === "flip") {
              body = Buffer.from(body);
              if (body.length > 0) body[0] = body[0] ^ 0xff;
            } else if (opts.corrupt.mode === "mismatch") {
              body = Buffer.alloc(body.length, 0xff);
            }
          }
          return {
            Body: body,
            ContentType: obj.contentType,
          };
        }

        case "HeadObjectCommand": {
          const obj = store.get(command.Key);
          if (!obj) {
            const err = new Error("NotFound");
            err.name = "NotFound";
            err.Code = "NotFound";
            err.$metadata = { httpStatusCode: 404 };
            throw err;
          }
          return { ContentType: obj.contentType, ContentLength: obj.body.length };
        }

        default:
          throw new Error(`Unknown mock command: ${cmd}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

// Standard contract suite — each test gets a fresh client+store
runContractTests("object (mocked)", () =>
  createObjectArtifactStore({
    client: createMockS3Client(),
    bucket: "test-bucket",
    commands: MOCK_COMMANDS,
  }),
);

// Failure-injection suite — run against object storage
runFailureContractTests("object", (opts = {}) => {
  const mockClient = createMockS3Client({
    failPut: opts.failPut || opts.failWrite,
    failGet: opts.failGet || opts.failReadBack, // read-back failure = GET failure
    failHead: opts.failHead,
    corrupt: opts.corrupt,
  });
  // Expose the internal store for tests that need to pre-populate data
  const store = createObjectArtifactStore({
    client: mockClient,
    bucket: "test-bucket",
    commands: MOCK_COMMANDS,
  });
  store._mockClient = mockClient;
  return store;
});

// =========================================================================
// Production-shaped S3 binary stream tests
//
// These tests verify that readResponseBody() always prefers binary-exact
// methods over text-based methods, even when the AWS SDK v3 response Body
// exposes both transformToByteArray() and transformToString().
// =========================================================================

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const TEST_SCOPE = Object.freeze({
  tenantId: "stream-tenant",
  clientId: "stream-client",
  auditId: "00000000-0000-0000-0000-00000000ffff",
});

// -----------------------------------------------------------------------
// Mock Body that exposes BOTH transformToByteArray AND transformToString
// with binary bytes that are NOT valid UTF-8.
// -----------------------------------------------------------------------

const BINARY_BYTES = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41, 0xc3, 0x28]);

function createDualMethodBody(rawBytes, callLog) {
  return {
    // transformToByteArray — binary-exact, MUST be called
    async transformToByteArray() {
      callLog.push("transformToByteArray");
      return new Uint8Array(rawBytes);
    },
    // transformToString — MUST NOT be called for binary data
    async transformToString(_encoding) {
      callLog.push("transformToString");
      // If called, it would mangle the bytes through UTF-8
      return Buffer.from(rawBytes).toString("utf-8");
    },
  };
}

// -----------------------------------------------------------------------
// test: dual-method body — transformToByteArray preferred
// -----------------------------------------------------------------------

test("object [production-shape]: dual Body — transformToByteArray called, transformToString NOT called", async () => {
  const callLog = [];

  const mockClient = {
    store: new Map(),
    async send(command) {
      if (command._name === "PutObjectCommand") {
        this.store.set(command.Key, command.Body);
        return {};
      }
      if (command._name === "GetObjectCommand") {
        const stored = this.store.get(command.Key);
        if (!stored) {
          const err = new Error("NoSuchKey"); err.name = "NoSuchKey"; err.Code = "NoSuchKey"; throw err;
        }
        return { Body: createDualMethodBody(stored, callLog) };
      }
      if (command._name === "HeadObjectCommand") {
        if (!this.store.has(command.Key)) {
          const err = new Error("NotFound"); err.name = "NotFound"; err.Code = "NotFound";
          err.$metadata = { httpStatusCode: 404 }; throw err;
        }
        return {};
      }
      throw new Error(`Unknown: ${command._name}`);
    },
  };

  const store = createObjectArtifactStore({
    client: mockClient,
    bucket: "test-bucket",
    commands: MOCK_COMMANDS,
  });

  // PUT binary bytes
  const expectedSha = sha256(BINARY_BYTES);
  const record = await store.put({
    bytes: BINARY_BYTES,
    contentType: "application/octet-stream",
    scope: { ...TEST_SCOPE, category: "raw", artifactName: "binary.bin" },
  });

  // Assert record metadata is correct
  assert.equal(record.bytes, BINARY_BYTES.length, "record.bytes must match");
  assert.equal(record.sha256, expectedSha, "record.sha256 must match computed SHA");
  assert.equal(record.contentType, "application/octet-stream");

  // GET — must return identical bytes
  const retrieved = await store.get(record.key);
  assert.ok(Buffer.isBuffer(retrieved), "get must return a Buffer");
  assert.ok(retrieved.equals(BINARY_BYTES), "retrieved bytes must be identical to input");
  assert.equal(retrieved.length, BINARY_BYTES.length);

  // SHA-256 of retrieved bytes must match
  const retrievedSha = sha256(retrieved);
  assert.equal(retrievedSha, expectedSha, "SHA-256 of retrieved bytes must match");

  // verify() must return true
  const verified = await store.verify(record);
  assert.equal(verified, true, "verify(record) must return true");

  // transformToByteArray was called, transformToString was NOT
  assert.ok(callLog.includes("transformToByteArray"), "transformToByteArray must be called");
  assert.ok(!callLog.includes("transformToString"), "transformToString must NOT be called");
});

// -----------------------------------------------------------------------
// test: async iterable (Node stream) Body
// -----------------------------------------------------------------------

test("object [production-shape]: async iterable stream Body preserves exact bytes", async () => {
  const mockClient = {
    store: new Map(),
    async send(command) {
      if (command._name === "PutObjectCommand") {
        this.store.set(command.Key, command.Body);
        return {};
      }
      if (command._name === "GetObjectCommand") {
        const stored = this.store.get(command.Key);
        if (!stored) {
          const err = new Error("NoSuchKey"); err.name = "NoSuchKey"; err.Code = "NoSuchKey"; throw err;
        }
        // Return an async iterable (simulates Node Readable stream)
        return {
          Body: {
            [Symbol.asyncIterator]() {
              let i = 0;
              const buf = stored;
              const chunkSize = 3;
              return {
                async next() {
                  if (i >= buf.length) return { done: true };
                  const end = Math.min(i + chunkSize, buf.length);
                  const chunk = buf.subarray(i, end);
                  i = end;
                  return { value: chunk, done: false };
                },
              };
            },
          },
        };
      }
      if (command._name === "HeadObjectCommand") {
        if (!this.store.has(command.Key)) {
          const err = new Error("NotFound"); err.name = "NotFound"; err.Code = "NotFound";
          err.$metadata = { httpStatusCode: 404 }; throw err;
        }
        return {};
      }
      throw new Error(`Unknown: ${command._name}`);
    },
  };

  const store = createObjectArtifactStore({
    client: mockClient,
    bucket: "test-bucket",
    commands: MOCK_COMMANDS,
  });

  const expectedSha = sha256(BINARY_BYTES);
  const record = await store.put({
    bytes: BINARY_BYTES,
    contentType: "application/octet-stream",
    scope: { ...TEST_SCOPE, category: "raw", artifactName: "stream.bin" },
  });

  const retrieved = await store.get(record.key);
  assert.ok(retrieved.equals(BINARY_BYTES), "stream-retrieved bytes must be identical");
  assert.equal(sha256(retrieved), expectedSha, "stream SHA must match");
  assert.equal(await store.verify(record), true, "verify must pass for stream body");
});

// -----------------------------------------------------------------------
// test: Buffer Body (most common production shape)
// -----------------------------------------------------------------------

test("object [production-shape]: Buffer Body preserves exact binary bytes", async () => {
  const mockClient = {
    store: new Map(),
    async send(command) {
      if (command._name === "PutObjectCommand") {
        this.store.set(command.Key, command.Body);
        return {};
      }
      if (command._name === "GetObjectCommand") {
        const stored = this.store.get(command.Key);
        if (!stored) {
          const err = new Error("NoSuchKey"); err.name = "NoSuchKey"; err.Code = "NoSuchKey"; throw err;
        }
        return { Body: Buffer.from(stored) };
      }
      if (command._name === "HeadObjectCommand") {
        if (!this.store.has(command.Key)) {
          const err = new Error("NotFound"); err.name = "NotFound"; err.Code = "NotFound";
          err.$metadata = { httpStatusCode: 404 }; throw err;
        }
        return {};
      }
      throw new Error(`Unknown: ${command._name}`);
    },
  };

  const store = createObjectArtifactStore({
    client: mockClient,
    bucket: "test-bucket",
    commands: MOCK_COMMANDS,
  });

  const expectedSha = sha256(BINARY_BYTES);
  const record = await store.put({
    bytes: BINARY_BYTES,
    contentType: "application/octet-stream",
    scope: { ...TEST_SCOPE, category: "raw", artifactName: "buf.bin" },
  });

  const retrieved = await store.get(record.key);
  assert.ok(retrieved.equals(BINARY_BYTES), "Buffer-retrieved bytes must be identical");
  assert.equal(sha256(retrieved), expectedSha);
  assert.equal(await store.verify(record), true);
});

// -----------------------------------------------------------------------
// test: Uint8Array Body
// -----------------------------------------------------------------------

test("object [production-shape]: Uint8Array Body preserves exact binary bytes", async () => {
  const mockClient = {
    store: new Map(),
    async send(command) {
      if (command._name === "PutObjectCommand") {
        this.store.set(command.Key, command.Body);
        return {};
      }
      if (command._name === "GetObjectCommand") {
        const stored = this.store.get(command.Key);
        if (!stored) {
          const err = new Error("NoSuchKey"); err.name = "NoSuchKey"; err.Code = "NoSuchKey"; throw err;
        }
        return { Body: new Uint8Array(stored) };
      }
      if (command._name === "HeadObjectCommand") {
        if (!this.store.has(command.Key)) {
          const err = new Error("NotFound"); err.name = "NotFound"; err.Code = "NotFound";
          err.$metadata = { httpStatusCode: 404 }; throw err;
        }
        return {};
      }
      throw new Error(`Unknown: ${command._name}`);
    },
  };

  const store = createObjectArtifactStore({
    client: mockClient,
    bucket: "test-bucket",
    commands: MOCK_COMMANDS,
  });

  const expectedSha = sha256(BINARY_BYTES);
  const record = await store.put({
    bytes: BINARY_BYTES,
    contentType: "application/octet-stream",
    scope: { ...TEST_SCOPE, category: "raw", artifactName: "u8.bin" },
  });

  const retrieved = await store.get(record.key);
  assert.ok(retrieved.equals(BINARY_BYTES), "Uint8Array-retrieved bytes must be identical");
  assert.equal(sha256(retrieved), expectedSha);
  assert.equal(await store.verify(record), true);
});

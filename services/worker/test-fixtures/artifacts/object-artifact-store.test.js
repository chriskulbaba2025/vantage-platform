/**
 * WP3 Object Artifact Store — Contract Tests (Mocked)
 *
 * Runs the full governed contract suite + failure-injection suite against
 * the object-storage implementation using a mock client and mock AWS
 * command constructors.
 *
 * Zero live cloud calls. Zero provider calls. Deterministic.
 */

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

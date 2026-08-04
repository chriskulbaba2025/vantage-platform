/**
 * WP3 Object Artifact Store — Contract Tests (Mocked)
 *
 * Runs the full governed contract suite against the object-storage
 * implementation using a mock client with in-memory storage.
 *
 * Zero live cloud calls. Zero provider calls. Deterministic.
 */

import { runContractTests } from "./contract-tests.js";
import { createObjectArtifactStore } from "../../src/storage/object-artifact-store.js";

/**
 * Create a mock S3-compatible client backed by an in-memory Map.
 */
function createMockS3Client() {
  const store = new Map();

  return {
    async send(command) {
      const cmd = command._command;
      const { Bucket, Key } = command;

      switch (cmd) {
        case "PutObject": {
          const body = Buffer.isBuffer(command.Body)
            ? command.Body
            : Buffer.from(command.Body || "", "utf-8");
          store.set(Key, {
            body,
            contentType: command.ContentType || "application/octet-stream",
          });
          return {};
        }

        case "GetObject": {
          const obj = store.get(Key);
          if (!obj) {
            const err = new Error("NoSuchKey");
            err.name = "NoSuchKey";
            err.Code = "NoSuchKey";
            throw err;
          }
          return {
            Body: Buffer.from(obj.body),
            ContentType: obj.contentType,
          };
        }

        case "HeadObject": {
          const obj = store.get(Key);
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

// Each test suite gets a fresh mock client for isolation
runContractTests("object (mocked)", () =>
  createObjectArtifactStore({
    client: createMockS3Client(),
    bucket: "test-bucket",
  }),
);

/**
 * Object Artifact Store — Mockable Object-Storage Implementation
 *
 * Stores artifacts via an injected client that exposes a `send(command)`
 * method compatible with @aws-sdk/client-s3. The store does not import
 * the AWS SDK directly — the caller injects the client.
 *
 * For tests, pass a mock client with in-memory storage. Normal CI
 * makes zero live cloud calls.
 *
 * Implements the governed put/get/exists/verify interface with
 * exact-byte SHA-256 verification and mandatory read-back.
 *
 * @module object-artifact-store
 */

import { createHash } from "node:crypto";
import { buildArtifactKey } from "./artifact-key.js";
import { validateArtifactRecord } from "./artifact-record-validator.js";
import {
  InvalidInputError,
  ImmutableConflictError,
  ObjectNotFoundError,
  ProviderFailureError,
  ReadBackFailureError,
} from "./artifact-errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === "string") return Buffer.from(input, "utf-8");
  throw new InvalidInputError(
    `input must be Buffer, Uint8Array, or string, got ${typeof input}`,
    { inputType: typeof input },
  );
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an object-storage-backed Artifact Store.
 *
 * @param {object} opts
 * @param {object} opts.client  - Object with async `send(command)` method.
 * @param {string} opts.bucket  - Storage bucket/container name.
 * @returns {import("./governed-artifact-store.js").ArtifactStore}
 */
export function createObjectArtifactStore(opts = {}) {
  const client = opts.client;
  const bucket = opts.bucket || "";

  if (!client) {
    throw new Error("object-artifact-store requires a client");
  }
  if (!bucket) {
    throw new Error("object-artifact-store requires a bucket name");
  }

  /**
   * Send a PutObject command through the client.
   */
  async function sendPut(key, body, contentType) {
    try {
      await client.send({
        _command: "PutObject",
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      });
    } catch (err) {
      throw new ProviderFailureError(
        `Storage provider error on PUT: ${err.message}`,
        { command: "PutObject", cause: err.message },
      );
    }
  }

  /**
   * Check whether the given key exists.  Returns false for NotFound/NoSuchKey;
   * throws ProviderFailureError on real provider errors.
   */
  async function checkExists(key) {
    try {
      await client.send({
        _command: "HeadObject",
        Bucket: bucket,
        Key: key,
      });
      return true;
    } catch (err) {
      if (
        err.name === "NotFound" ||
        err.Code === "NotFound" ||
        err.name === "NoSuchKey" ||
        err.Code === "NoSuchKey" ||
        (err.$metadata?.httpStatusCode === 404) ||
        (err.message && (err.message.includes("NotFound") || err.message.includes("NoSuchKey")))
      ) {
        return false;
      }
      throw new ProviderFailureError(
        `Storage provider error on HEAD: ${err.message}`,
        { command: "HeadObject", cause: err.message },
      );
    }
  }

  /**
   * Return exact bytes from the object store.
   * Throws ObjectNotFoundError on NoSuchKey; ProviderFailureError on real errors.
   */
  async function getObject(key) {
    try {
      const result = await client.send({
        _command: "GetObject",
        Bucket: bucket,
        Key: key,
      });
      return await readResponseBody(result);
    } catch (err) {
      if (
        err.name === "NoSuchKey" ||
        err.Code === "NoSuchKey" ||
        (err.message && err.message.includes("NoSuchKey"))
      ) {
        throw new ObjectNotFoundError(`Object not found: "${key}"`, { key });
      }
      throw new ProviderFailureError(
        `Storage provider error on GET: ${err.message}`,
        { command: "GetObject", cause: err.message },
      );
    }
  }

  // ── Public interface ──────────────────────────────────────────────────

  async function put(input) {
    if (!input || typeof input !== "object") {
      throw new InvalidInputError("put requires an input object");
    }

    const buf = toBuffer(input.bytes);
    const key = buildArtifactKey(input.scope);
    const computedSha = sha256(buf);
    const byteLength = buf.length;
    const now = new Date().toISOString();

    // Check immutable-write conflict
    const keyExists = await checkExists(key);
    if (keyExists) {
      try {
        const existingBuf = await getObject(key);
        const existingSha = sha256(existingBuf);
        if (existingSha === computedSha && existingBuf.length === byteLength) {
          const record = buildRecord(input, key, computedSha, byteLength, now);
          validateArtifactRecord(record);
          return record;
        }
        throw new ImmutableConflictError(
          `Key "${key}" already exists with different bytes`,
          {
            key,
            existingSha256: existingSha,
            existingBytes: existingBuf.length,
            newSha256: computedSha,
            newBytes: byteLength,
          },
        );
      } catch (err) {
        if (err instanceof ImmutableConflictError) throw err;
        if (err instanceof ObjectNotFoundError) {
          // Race: existed during HEAD, gone during GET — proceed
        } else {
          throw err;
        }
      }
    }

    // Write
    await sendPut(key, buf, input.contentType || "application/octet-stream");

    // Mandatory read-back verification
    let storedBytes;
    try {
      storedBytes = await getObject(key);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        throw new ReadBackFailureError(
          "Failed to read back artifact after write: object not found",
          { key },
        );
      }
      throw new ReadBackFailureError(
        `Failed to read back artifact after write: ${err.message}`,
        { key, cause: err.message },
      );
    }

    if (storedBytes.length !== byteLength) {
      throw new ReadBackFailureError(
        `Read-back byte count mismatch: expected ${byteLength}, got ${storedBytes.length}`,
        { key, expected: byteLength, got: storedBytes.length },
      );
    }

    if (!storedBytes.equals(buf)) {
      throw new ReadBackFailureError("Read-back byte mismatch after write", { key });
    }

    const readBackSha = sha256(storedBytes);
    if (readBackSha !== computedSha) {
      throw new ReadBackFailureError(
        `Read-back SHA mismatch: expected ${computedSha}, got ${readBackSha}`,
        { key, expectedSha: computedSha, gotSha: readBackSha },
      );
    }

    const record = buildRecord(input, key, computedSha, byteLength, now);
    validateArtifactRecord(record);
    return record;
  }

  async function get(key) {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidInputError("key is required");
    }
    return getObject(key);
  }

  async function exists(key) {
    if (typeof key !== "string" || key.length === 0) return false;
    try {
      return await checkExists(key);
    } catch {
      return false;
    }
  }

  async function verify(record) {
    if (!record || typeof record !== "object") return false;
    if (!record.key) return false;

    try {
      const storedBytes = await getObject(record.key);
      const recomputed = sha256(storedBytes);
      if (recomputed !== record.sha256) return false;
      if (storedBytes.length !== record.bytes) return false;

      const { parseArtifactKey } = await import("./artifact-key.js");
      const parsed = parseArtifactKey(record.key);
      if (parsed.tenantId !== record.tenantId) return false;
      if (parsed.clientId !== record.clientId) return false;
      if (parsed.auditId !== record.auditId) return false;

      return true;
    } catch {
      return false;
    }
  }

  return { put, get, exists, verify };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function buildRecord(input, key, computedSha, byteLength, now) {
  const record = {
    contractVersion: "1.0.0",
    key,
    sha256: computedSha,
    bytes: byteLength,
    contentType: input.contentType || "application/octet-stream",
    tenantId: input.scope.tenantId,
    clientId: input.scope.clientId,
    auditId: input.scope.auditId,
    executionId: input.executionId || undefined,
    source: input.source || undefined,
    writtenAt: now,
    verifiedAt: now,
    storageBackend: "s3",
    metadata: input.metadata || undefined,
  };

  for (const k of Object.keys(record)) {
    if (record[k] === undefined) delete record[k];
  }

  return record;
}

/**
 * Read body bytes from a GetObject-style response.
 */
async function readResponseBody(response) {
  if (!response || !response.Body) return Buffer.alloc(0);

  const body = response.Body;

  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf-8");

  if (typeof body.transformToString === "function") {
    const str = await body.transformToString("utf-8");
    return Buffer.from(str, "utf-8");
  }

  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }

  if (typeof body.on === "function") {
    const chunks = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  return Buffer.from(String(body), "utf-8");
}

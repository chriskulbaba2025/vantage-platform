/**
 * Object Artifact Store — Mockable Object-Storage Implementation
 *
 * Stores artifacts via an injected S3 client and injected AWS SDK command
 * constructors.  The store does NOT import @aws-sdk/client-s3 directly —
 * the caller injects both the client and the command classes.
 *
 * Production wiring:
 *   import { S3Client } from "@aws-sdk/client-s3";
 *   import { PutObjectCommand, GetObjectCommand, HeadObjectCommand }
 *     from "@aws-sdk/client-s3";
 *   const store = createObjectArtifactStore({
 *     client: new S3Client({ region: "ca-central-1" }),
 *     bucket:  "my-bucket",
 *     commands: { PutObjectCommand, GetObjectCommand, HeadObjectCommand },
 *   });
 *
 * Test wiring (zero live calls):
 *   const store = createObjectArtifactStore({
 *     client: createMockS3Client(),
 *     bucket:  "test-bucket",
 *     commands: createMockAwsCommands(),
 *   });
 *
 * Every command sent to `client.send()` is a real AWS Command instance
 * (or a formally defined mock that satisfies the same instanceof checks).
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

/**
 * Build a canonical S3 key prefix from the tenant scope.
 * Used when a base prefix is supplied.
 */
function buildS3Prefix(base, scope) {
  if (!base) return "";
  const clean = base.replace(/^\/+|\/+$/g, "");
  return clean ? `${clean}/` : "";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @typedef {object} AwsCommands
 * @property {Function} PutObjectCommand  - Constructor for PutObjectCommand.
 * @property {Function} GetObjectCommand  - Constructor for GetObjectCommand.
 * @property {Function} HeadObjectCommand - Constructor for HeadObjectCommand.
 */

/**
 * Create an object-storage-backed Artifact Store.
 *
 * @param {object} opts
 * @param {object} opts.client   - S3 client with async `send(command)`.
 * @param {string} opts.bucket   - S3 bucket name.
 * @param {AwsCommands} opts.commands - AWS SDK command constructors (or mocks).
 * @param {string} [opts.prefix] - Optional S3 key prefix.
 * @returns {import("./governed-artifact-store.js").ArtifactStore}
 */
export function createObjectArtifactStore(opts = {}) {
  const client = opts.client;
  const bucket = opts.bucket || "";
  const { PutObjectCommand, GetObjectCommand, HeadObjectCommand } = opts.commands || {};
  const prefix = opts.prefix || "";

  if (!client) {
    throw new Error("object-artifact-store requires a client");
  }
  if (!bucket) {
    throw new Error("object-artifact-store requires a bucket name");
  }
  if (!PutObjectCommand || !GetObjectCommand || !HeadObjectCommand) {
    throw new Error(
      "object-artifact-store requires commands: { PutObjectCommand, GetObjectCommand, HeadObjectCommand }",
    );
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Build the full S3 object key, optionally prefixed.
   */
  function s3Key(artifactKey) {
    return prefix ? `${buildS3Prefix(prefix)}${artifactKey}` : artifactKey;
  }

  /**
   * Send a PutObject command.  Returns nothing on success; throws
   * ProviderFailureError on any client error (no synthetic record).
   */
  async function sendPut(key, body, contentType) {
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    try {
      await client.send(cmd);
    } catch (err) {
      throw new ProviderFailureError(
        `Storage provider error on PUT: ${err.message}`,
        { command: "PutObject", cause: err.message },
      );
    }
  }

  /**
   * HEAD check.  Returns true when the object exists, false for
   * NotFound / NoSuchKey.  Propagates ProviderFailureError for
   * auth errors, timeouts, service errors, and unknown failures.
   */
  async function checkExists(key) {
    const cmd = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    try {
      await client.send(cmd);
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
      // Auth error, timeout, service error, etc. — propagate
      throw new ProviderFailureError(
        `Storage provider error on HEAD: ${err.message}`,
        { command: "HeadObject", cause: err.message },
      );
    }
  }

  /**
   * GET an object.  Returns Buffer on success, ObjectNotFoundError
   * on NoSuchKey, ProviderFailureError on all other errors.
   */
  async function getObject(key) {
    const cmd = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    try {
      const result = await client.send(cmd);
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

  // ------------------------------------------------------------------
  // Public interface
  // ------------------------------------------------------------------

  async function put(input) {
    if (!input || typeof input !== "object") {
      throw new InvalidInputError("put requires an input object");
    }

    const buf = toBuffer(input.bytes);
    const artifactKey = buildArtifactKey(input.scope);
    const storageKey = s3Key(artifactKey);
    const computedSha = sha256(buf);
    const byteLength = buf.length;
    const now = new Date().toISOString();

    // Check immutable-write conflict
    let keyExists = false;
    try {
      keyExists = await checkExists(storageKey);
    } catch (err) {
      // ProviderFailureError from HEAD — propagate, no record returned
      throw err;
    }

    if (keyExists) {
      try {
        const existingBuf = await getObject(storageKey);
        const existingSha = sha256(existingBuf);
        if (existingSha === computedSha && existingBuf.length === byteLength) {
          const record = buildRecord(input, artifactKey, computedSha, byteLength, now);
          validateArtifactRecord(record);
          return record;
        }
        throw new ImmutableConflictError(
          `Key "${artifactKey}" already exists with different bytes`,
          {
            key: artifactKey,
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
          throw err; // ProviderFailureError — propagate, no record
        }
      }
    }

    // Write — any error propagates as ProviderFailureError, no record
    await sendPut(storageKey, buf, input.contentType || "application/octet-stream");

    // Mandatory read-back verification
    let storedBytes;
    try {
      storedBytes = await getObject(storageKey);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        throw new ReadBackFailureError(
          "Failed to read back artifact after write: object not found",
          { key: artifactKey },
        );
      }
      // Wrap provider errors so the caller gets ReadBackFailureError
      // from a failed post-write verification.
      throw new ReadBackFailureError(
        `Failed to read back artifact after write: ${err.message}`,
        { key: artifactKey, cause: err.message },
      );
    }

    if (storedBytes.length !== byteLength) {
      throw new ReadBackFailureError(
        `Read-back byte count mismatch: expected ${byteLength}, got ${storedBytes.length}`,
        { key: artifactKey, expected: byteLength, got: storedBytes.length },
      );
    }

    if (!storedBytes.equals(buf)) {
      throw new ReadBackFailureError("Read-back byte mismatch after write", { key: artifactKey });
    }

    const readBackSha = sha256(storedBytes);
    if (readBackSha !== computedSha) {
      throw new ReadBackFailureError(
        `Read-back SHA mismatch: expected ${computedSha}, got ${readBackSha}`,
        { key: artifactKey, expectedSha: computedSha, gotSha: readBackSha },
      );
    }

    const record = buildRecord(input, artifactKey, computedSha, byteLength, now);
    validateArtifactRecord(record);
    return record;
  }

  async function get(key) {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidInputError("key is required");
    }
    return getObject(s3Key(key));
  }

  /**
   * Check whether an object exists.  Returns false only for confirmed
   * NotFound / NoSuchKey.  Propagates ProviderFailureError for auth
   * errors, timeouts, service errors, and unknown client failures.
   */
  async function exists(key) {
    if (typeof key !== "string" || key.length === 0) return false;
    return checkExists(s3Key(key));
  }

  async function verify(record) {
    if (!record || typeof record !== "object") return false;
    if (!record.key) return false;

    try {
      const storedBytes = await getObject(s3Key(record.key));
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

function buildRecord(input, artifactKey, computedSha, byteLength, now) {
  const record = {
    contractVersion: "1.0.0",
    key: artifactKey,
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
 *
 * Priority order (exact binary preservation):
 *   1. Buffer                    — already raw bytes
 *   2. Uint8Array                — raw bytes, zero-copy
 *   3. transformToByteArray()    — AWS SDK v3 native binary method
 *   4. Node / async-iterable stream — collect Buffer chunks
 *   5. string                    — already a string (treat as UTF-8)
 *   6. transformToString()       — LAST resort text fallback;
 *                                  may corrupt binary data
 *
 * transformToByteArray() is ALWAYS preferred over transformToString()
 * because the latter re-encodes through UTF-8 and will mangle any byte
 * sequence that is not valid UTF-8.
 */
async function readResponseBody(response) {
  if (!response || !response.Body) return Buffer.alloc(0);

  const body = response.Body;

  // 1. Already a Buffer — zero-copy
  if (Buffer.isBuffer(body)) return body;

  // 2. Uint8Array — zero-copy
  if (body instanceof Uint8Array) return Buffer.from(body);

  // 3. AWS SDK v3 transformToByteArray — binary-exact
  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }

  // 4. Node / async-iterable stream — collect raw chunks
  if (typeof body.on === "function" || typeof body[Symbol.asyncIterator] === "function") {
    const chunks = [];
    for await (const chunk of body) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      } else if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk, "utf-8"));
      } else {
        chunks.push(Buffer.from(String(chunk), "utf-8"));
      }
    }
    return Buffer.concat(chunks);
  }

  // 5. Plain string
  if (typeof body === "string") return Buffer.from(body, "utf-8");

  // 6. transformToString — LAST resort text fallback
  if (typeof body.transformToString === "function") {
    const str = await body.transformToString("utf-8");
    return Buffer.from(str, "utf-8");
  }

  // Ultimate fallback
  return Buffer.from(String(body), "utf-8");
}

/**
 * Memory Artifact Store — In-Memory Implementation
 *
 * Stores artifacts in a Map. Used for unit tests, contract tests,
 * and deterministic replay. No filesystem or network.
 *
 * Implements the governed put/get/exists/verify interface with
 * exact-byte SHA-256 verification and mandatory read-back.
 *
 * @module memory-artifact-store
 */

import { createHash } from "node:crypto";
import { buildArtifactKey } from "./artifact-key.js";
import { validateArtifactRecord } from "./artifact-record-validator.js";
import {
  InvalidInputError,
  ImmutableConflictError,
  ObjectNotFoundError,
} from "./artifact-errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize input bytes to a Buffer.
 *
 * @param {Buffer|Uint8Array|string} input
 * @returns {Buffer}
 */
function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === "string") return Buffer.from(input, "utf-8");
  throw new InvalidInputError(
    `input must be Buffer, Uint8Array, or string, got ${typeof input}`,
    { inputType: typeof input },
  );
}

/**
 * Compute SHA-256 of a Buffer, returned as lowercase hex.
 *
 * @param {Buffer} buf
 * @returns {string}
 */
function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a memory-backed Artifact Store.
 *
 * Every stored object is held in a Map keyed by the governed object key.
 * All operations are synchronous or async-safe.
 *
 * @returns {import("./governed-artifact-store.js").ArtifactStore}
 */
export function createMemoryArtifactStore() {
  /** @type {Map<string, { bytes: Buffer, record: object }>} */
  const store = new Map();

  /**
   * Persist exact bytes and return a validated Artifact Record.
   *
   * @param {object} input
   * @param {Buffer|Uint8Array|string} input.bytes       - Exact bytes to store.
   * @param {string} input.contentType                   - MIME type.
   * @param {object} input.scope                         - Tenant/client/audit scope.
   * @param {string} input.scope.tenantId
   * @param {string} input.scope.clientId
   * @param {string} input.scope.auditId
   * @param {string} input.scope.category
   * @param {string} input.scope.artifactName
   * @param {object} [input.metadata]                    - Optional metadata.
   * @returns {Promise<object>} Validated Artifact Record.
   */
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
    const existing = store.get(key);
    if (existing) {
      if (existing.record.sha256 === computedSha && existing.record.bytes === byteLength) {
        // Idempotent — return existing verified record
        return { ...existing.record, verifiedAt: now };
      }
      throw new ImmutableConflictError(
        `Key "${key}" already exists with different bytes`,
        {
          key,
          existingSha256: existing.record.sha256,
          existingBytes: existing.record.bytes,
          newSha256: computedSha,
          newBytes: byteLength,
        },
      );
    }

    // Build record
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
      storageBackend: "memory",
      metadata: input.metadata || undefined,
    };

    // Validate against WP2 schema
    validateArtifactRecord(record);

    // Store first
    store.set(key, { bytes: buf, record });

    // Mandatory read-back verification
    const storedBytes = store.get(key)?.bytes;
    if (!storedBytes || storedBytes.length !== byteLength) {
      store.delete(key);
      throw new Error("Read-back verification failed: stored bytes missing after put");
    }
    if (!storedBytes.equals(buf)) {
      store.delete(key);
      throw new Error("Read-back verification failed: byte mismatch after put");
    }

    return record;
  }

  /**
   * Return exact bytes as Buffer.
   *
   * @param {string} key - Governed object key.
   * @returns {Promise<Buffer>}
   * @throws {ObjectNotFoundError}
   */
  async function get(key) {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidInputError("key is required");
    }

    const entry = store.get(key);
    if (!entry) {
      throw new ObjectNotFoundError(`Object not found: "${key}"`, { key });
    }

    return Buffer.from(entry.bytes);
  }

  /**
   * Check whether an object exists at the given key.
   *
   * @param {string} key - Governed object key.
   * @returns {Promise<boolean>}
   */
  async function exists(key) {
    if (typeof key !== "string" || key.length === 0) return false;
    return store.has(key);
  }

  /**
   * Read back and verify key, bytes, SHA-256, and scope.
   *
   * @param {object} record - Artifact Record to verify.
   * @returns {Promise<boolean>} True when all verifications pass.
   */
  async function verify(record) {
    if (!record || typeof record !== "object") {
      return false;
    }
    if (!record.key) return false;

    try {
      const entry = store.get(record.key);
      if (!entry) return false;

      const recomputed = sha256(entry.bytes);
      if (recomputed !== record.sha256) return false;
      if (entry.bytes.length !== record.bytes) return false;

      // Verify scope from key
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

  /**
   * Clear all stored artifacts (for test teardown only).
   */
  function _clear() {
    store.clear();
  }

  return {
    put,
    get,
    exists,
    verify,
    _clear,
  };
}

export default { createMemoryArtifactStore };

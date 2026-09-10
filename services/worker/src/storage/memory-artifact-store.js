/**
 * Memory Artifact Store — In-Memory Implementation
 *
 * Stores artifacts in a Map. Used for unit tests, contract tests,
 * and deterministic replay. No filesystem or network.
 *
 * Implements the governed put/get/exists/verify interface with
 * exact-byte SHA-256 verification and mandatory read-back.
 *
 * Failure injection:
 *   Pass `inject` options to simulate write/read/corruption failures.
 *   All fields are optional and default to no injection.
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
  WriteFailureError,
  ReadBackFailureError,
  ProviderFailureError,
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
 * @typedef {object} MemoryInjectOptions
 * @property {boolean} [failWrite]    - Simulate a write failure.
 * @property {boolean} [failReadBack] - Simulate a read-back failure after write.
 * @property {"truncate"|"flip"|"mismatch"} [corruptRead] - Corrupt bytes on read-back.
 * @property {boolean} [failGet]      - Simulate a provider error on get.
 * @property {boolean} [failHead]     - Simulate a provider error on exists (HEAD).
 */

/**
 * Create a memory-backed Artifact Store.
 *
 * @param {MemoryInjectOptions} [inject] - Optional failure injection.
 * @returns {import("./governed-artifact-store.js").ArtifactStore}
 */
export function createMemoryArtifactStore(inject = {}) {
  /** @type {Map<string, { bytes: Buffer, record: object }>} */
  const store = new Map();

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

    // Failure injection: write failure
    if (inject.failWrite) {
      throw new WriteFailureError("Injected write failure", { key });
    }

    // Store
    store.set(key, { bytes: buf, record });

    // Failure injection: read-back failure
    if (inject.failReadBack) {
      store.delete(key); // clean up
      throw new ReadBackFailureError("Injected read-back failure", { key });
    }

    // Mandatory read-back verification
    let storedBytes = store.get(key)?.bytes;
    if (!storedBytes) {
      store.delete(key);
      throw new ReadBackFailureError("Read-back verification failed: stored bytes missing after put", { key });
    }

    // Failure injection: corrupt on read-back
    if (inject.corruptRead === "truncate") {
      storedBytes = storedBytes.subarray(0, storedBytes.length - 1);
    } else if (inject.corruptRead === "flip") {
      storedBytes = Buffer.from(storedBytes);
      storedBytes[0] = storedBytes[0] ^ 0xff;
    } else if (inject.corruptRead === "mismatch") {
      // Return a buffer with different contents but same length
      storedBytes = Buffer.alloc(storedBytes.length, 0xff);
    }

    if (storedBytes.length !== byteLength) {
      store.delete(key);
      throw new ReadBackFailureError(
        `Read-back byte count mismatch: expected ${byteLength}, got ${storedBytes.length}`,
        { key, expected: byteLength, got: storedBytes.length },
      );
    }

    if (!storedBytes.equals(buf)) {
      store.delete(key);
      throw new ReadBackFailureError("Read-back byte mismatch after write", { key });
    }

    return record;
  }

  async function get(key) {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidInputError("key is required");
    }

    // Failure injection: provider error on get
    if (inject.failGet) {
      throw new ProviderFailureError("Injected provider error on GET", {
        command: "GetObject",
        cause: "injected failure",
      });
    }

    const entry = store.get(key);
    if (!entry) {
      throw new ObjectNotFoundError(`Object not found: "${key}"`, { key });
    }

    return Buffer.from(entry.bytes);
  }

  async function exists(key) {
    if (typeof key !== "string" || key.length === 0) return false;
    if (inject.failHead) {
      throw new ProviderFailureError("Injected provider error on HEAD", {
        command: "HeadObject", cause: "injected failure",
      });
    }
    return store.has(key);
  }

  async function verify(record) {
    if (!record || typeof record !== "object") return false;
    if (!record.key) return false;

    try {
      const entry = store.get(record.key);
      if (!entry) return false;

      const recomputed = sha256(entry.bytes);
      if (recomputed !== record.sha256) return false;
      if (entry.bytes.length !== record.bytes) return false;

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

  function _clear() {
    store.clear();
  }

  return { put, get, exists, verify, _clear };
}

export default { createMemoryArtifactStore };

/**
 * Filesystem Artifact Store — Temporary-Filesystem Implementation
 *
 * Stores artifacts in a configurable base directory. Designed for
 * local integration tests — each test creates its own temporary
 * directory via `os.tmpdir()` or a caller-supplied path.
 *
 * Implements the governed put/get/exists/verify interface with
 * exact-byte SHA-256 verification and mandatory read-back.
 *
 * @module fs-artifact-store
 */

import { mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, sep } from "node:path";
import { buildArtifactKey } from "./artifact-key.js";
import { validateArtifactRecord } from "./artifact-record-validator.js";
import {
  InvalidInputError,
  ImmutableConflictError,
  ObjectNotFoundError,
  PathTraversalError,
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

/**
 * Resolve a governed key to a safe filesystem path under baseDir.
 */
function keyToPath(baseDir, key) {
  if (key.includes("..")) throw new PathTraversalError(`key contains traversal: "${key}"`, { key });
  if (key.includes("\\")) throw new PathTraversalError(`key contains backslash: "${key}"`, { key });
  if (key.startsWith("/")) throw new PathTraversalError(`key is absolute: "${key}"`, { key });

  const normalized = key.replace(/\//g, "/");
  const fullPath = resolve(baseDir, normalized);

  const resolvedBase = resolve(baseDir);
  if (!fullPath.startsWith(resolvedBase + sep) && fullPath !== resolvedBase) {
    throw new PathTraversalError(
      `Resolved path escapes base directory: "${key}" → "${fullPath}"`,
      { key, fullPath, baseDir: resolvedBase },
    );
  }

  return fullPath;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @typedef {object} FsInjectOptions
 * @property {boolean} [failWrite]    - Simulate a write failure.
 * @property {boolean} [failReadBack] - Simulate a read-back failure after write.
 * @property {"truncate"|"flip"|"mismatch"} [corruptRead] - Corrupt bytes on read-back.
 * @property {boolean} [failGet]      - Simulate a provider error on get.
 * @property {boolean} [failHead]     - Simulate a provider error on exists.
 */

/**
 * Create a filesystem-backed Artifact Store.
 *
 * @param {object} [opts]
 * @param {string} opts.baseDir - Base directory for storage. Required.
 * @param {FsInjectOptions} [opts.inject] - Optional failure injection for tests.
 * @returns {import("./governed-artifact-store.js").ArtifactStore}
 */
export function createFsArtifactStore(opts = {}) {
  const baseDir = resolve(opts.baseDir || "artifacts/local");
  const inject = opts.inject || {};

  /**
   * Persist exact bytes to disk, verify, and return a validated record.
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

    const filePath = keyToPath(baseDir, key);

    // Check immutable-write conflict
    try {
      await access(filePath);
      // File exists — read it
      const existingBuf = await readFile(filePath);
      const existingSha = sha256(existingBuf);
      if (existingSha === computedSha && existingBuf.length === byteLength) {
        // Idempotent return
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
      // File does not exist — proceed with write
      if (err.code !== "ENOENT" && !(err instanceof Error && err.message.includes("ENOENT"))) {
        // It's not a "file not found" error — rethrow
        if (err.code !== undefined && err.code !== "ENOENT") throw err;
      }
    }

    // Failure injection: write failure
    if (inject.failWrite) {
      throw new WriteFailureError("Injected write failure", { key });
    }

    // Write to disk
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, buf);
    } catch (writeErr) {
      throw new WriteFailureError(
        `Failed to write artifact: ${writeErr.message}`,
        { key, filePath, cause: writeErr.message },
      );
    }

    // Failure injection: read-back failure
    if (inject.failReadBack) {
      throw new ReadBackFailureError("Injected read-back failure", { key });
    }

    // Mandatory read-back verification
    let storedBytes;
    try {
      storedBytes = await readFile(filePath);
    } catch (readErr) {
      throw new ReadBackFailureError(
        `Failed to read back artifact after write: ${readErr.message}`,
        { key, filePath, cause: readErr.message },
      );
    }

    // Failure injection: corrupt on read-back
    if (inject.corruptRead === "truncate") {
      storedBytes = storedBytes.subarray(0, storedBytes.length - 1);
    } else if (inject.corruptRead === "flip") {
      storedBytes = Buffer.from(storedBytes);
      storedBytes[0] = storedBytes[0] ^ 0xff;
    } else if (inject.corruptRead === "mismatch") {
      storedBytes = Buffer.alloc(storedBytes.length, 0xff);
    }

    if (storedBytes.length !== byteLength) {
      throw new ReadBackFailureError(
        `Read-back byte count mismatch: expected ${byteLength}, got ${storedBytes.length}`,
        { key, expected: byteLength, got: storedBytes.length },
      );
    }

    if (!storedBytes.equals(buf)) {
      throw new ReadBackFailureError(
        "Read-back byte mismatch after write",
        { key },
      );
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

  /**
   * Return exact bytes as Buffer.
   */
  async function get(key) {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidInputError("key is required");
    }

    if (inject.failGet) {
      throw new ProviderFailureError("Injected provider error on GET", {
        command: "GetObject", cause: "injected failure",
      });
    }

    const filePath = keyToPath(baseDir, key);

    try {
      return await readFile(filePath);
    } catch (err) {
      if (err.code === "ENOENT") {
        throw new ObjectNotFoundError(`Object not found: "${key}"`, { key });
      }
      throw err;
    }
  }

  /**
   * Check whether an object exists at the given key.
   */
  async function exists(key) {
    if (typeof key !== "string" || key.length === 0) return false;
    if (inject.failHead) {
      throw new ProviderFailureError("Injected provider error on HEAD", {
        command: "HeadObject", cause: "injected failure",
      });
    }
    try {
      const filePath = keyToPath(baseDir, key);
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read back and verify key, bytes, SHA-256, and scope.
   */
  async function verify(record) {
    if (!record || typeof record !== "object") return false;
    if (!record.key) return false;

    try {
      const filePath = keyToPath(baseDir, record.key);
      const storedBytes = await readFile(filePath);
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

  /**
   * Remove the entire base directory (for test teardown only).
   */
  async function _destroy() {
    try {
      await rm(baseDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  return {
    put,
    get,
    exists,
    verify,
    _destroy,
  };
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
    storageBackend: "local",
    metadata: input.metadata || undefined,
  };

  // Strip undefined fields for clean JSON/schema compliance
  for (const k of Object.keys(record)) {
    if (record[k] === undefined) delete record[k];
  }

  return record;
}

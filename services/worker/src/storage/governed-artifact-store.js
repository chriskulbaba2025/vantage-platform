/**
 * Governed Artifact Store — Canonical Interface and Factory
 *
 * This is the authoritative WP3 Artifact Store entry point for new
 * governed code. It exports the interface contract (JSDoc typedef),
 * factory functions for all three implementations, and the key
 * builder for scope-constrained object naming.
 *
 * ## Interface
 *
 * ```js
 * / ** @type {ArtifactStore} * /
 * const store = createGovernedArtifactStore({ type: "memory" });
 *
 * const record = await store.put({
 *   bytes: Buffer.from('{"ok":true}'),
 *   contentType: "application/json",
 *   scope: { tenantId: "t1", clientId: "c1", auditId: "uuid", category: "raw", artifactName: "result.json" },
 * });
 *
 * const buf = await store.get(record.key);
 * const found = await store.exists(record.key);           // true
 * const verified = await store.verify(record);            // true
 * ```
 *
 * @module governed-artifact-store
 */

import { createMemoryArtifactStore } from "./memory-artifact-store.js";
import { createFsArtifactStore } from "./fs-artifact-store.js";
import { createObjectArtifactStore } from "./object-artifact-store.js";
import { buildArtifactKey } from "./artifact-key.js";

// ---------------------------------------------------------------------------
// JSDoc interface contract
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ArtifactScope
 * @property {string} tenantId     - Owning tenant.
 * @property {string} clientId     - Owning client.
 * @property {string} auditId      - Owning audit (UUID).
 * @property {string} category     - Artifact category.
 * @property {string} artifactName - Unique artifact name within category.
 */

/**
 * @typedef {object} PutArtifactInput
 * @property {Buffer|Uint8Array|string} bytes  - Exact bytes to store.
 * @property {string} contentType              - MIME type.
 * @property {ArtifactScope} scope             - Tenant/client/audit scope.
 * @property {string} [executionId]            - Optional execution identifier.
 * @property {string} [source]                 - Optional source key.
 * @property {object} [metadata]               - Optional metadata.
 */

/**
 * @typedef {object} ArtifactRecord
 * @property {string} contractVersion - Always "1.0.0".
 * @property {string} key             - Immutable governed object key.
 * @property {string} sha256          - Lowercase hex SHA-256 of stored bytes.
 * @property {number} bytes           - Exact byte count.
 * @property {string} contentType     - MIME type.
 * @property {string} tenantId        - Owning tenant.
 * @property {string} clientId        - Owning client.
 * @property {string} auditId         - Owning audit UUID.
 * @property {string} [executionId]   - Execution identifier.
 * @property {string} [source]        - Source key.
 * @property {string} writtenAt       - ISO-8601 write timestamp.
 * @property {string} verifiedAt      - ISO-8601 last verification timestamp.
 * @property {"memory"|"local"|"s3"} storageBackend - Storage backend.
 * @property {object} [metadata]      - Optional metadata.
 */

/**
 * @typedef {object} ArtifactStore
 *
 * @property {(input: PutArtifactInput) => Promise<ArtifactRecord>} put
 *   Persist exact bytes and return a validated Artifact Record.
 *   Verifies bytes and SHA-256 on read-back before returning.
 *
 * @property {(key: string) => Promise<Buffer>} get
 *   Return exact bytes as Buffer.
 *
 * @property {(key: string) => Promise<boolean>} exists
 *   Check whether an object exists at the given key.
 *
 * @property {(record: ArtifactRecord) => Promise<boolean>} verify
 *   Read back and verify key, bytes, SHA-256, and scope.
 */

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a governed Artifact Store instance.
 *
 * @param {object} opts
 * @param {"memory"|"fs"|"object"} opts.type   - Backend type.
 * @param {string} [opts.baseDir]              - Filesystem base directory (fs only).
 * @param {object} [opts.client]               - Object-storage client (object only).
 * @param {string} [opts.bucket]               - Object-storage bucket (object only).
 * @param {object} [opts.commands]             - AWS SDK command constructors (object only).
 * @param {string} [opts.prefix]               - S3 key prefix (object only).
 * @returns {ArtifactStore}
 */
export function createGovernedArtifactStore(opts = {}) {
  const type = opts.type || "memory";

  switch (type) {
    case "memory":
      return createMemoryArtifactStore();
    case "fs":
      return createFsArtifactStore({ baseDir: opts.baseDir });
    case "object":
      return createObjectArtifactStore({
        client: opts.client,
        bucket: opts.bucket,
        commands: opts.commands,
        prefix: opts.prefix,
      });
    default:
      throw new Error(`Unknown artifact store type: ${type}. Use "memory", "fs", or "object".`);
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  createMemoryArtifactStore,
  createFsArtifactStore,
  createObjectArtifactStore,
  buildArtifactKey,
};

export {
  ArtifactStoreError,
  InvalidInputError,
  InvalidScopeError,
  PathTraversalError,
  WriteFailureError,
  ReadBackFailureError,
  ByteMismatchError,
  ShaMismatchError,
  ImmutableConflictError,
  ObjectNotFoundError,
  ProviderFailureError,
  SchemaValidationError,
  ARTIFACT_ERROR_CODES,
} from "./artifact-errors.js";

export { validateArtifactRecord, checkArtifactRecord } from "./artifact-record-validator.js";
export { buildArtifactKey as buildKey, parseArtifactKey, keyBelongsToTenant } from "./artifact-key.js";

export default { createGovernedArtifactStore };

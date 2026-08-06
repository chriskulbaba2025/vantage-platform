/**
 * WP5 Artifact Recovery — Immutable recovery-manifest persistence and verification.
 *
 * Uses existing WP3 governed exports only. Does not instantiate an Artifact
 * Store or modify lifecycle state.
 *
 * @module orchestration/artifact-recovery
 */

import { createHash } from "node:crypto";
import { buildArtifactKey, parseArtifactKey } from "../storage/artifact-key.js";
import { validateArtifactRecord } from "../storage/artifact-record-validator.js";

// ---------------------------------------------------------------------------
// Manifest keys
// ---------------------------------------------------------------------------

export function buildSourceCheckpointManifestKey(scope, source) {
  return buildArtifactKey({
    tenantId: scope.tenantId,
    clientId: scope.clientId,
    auditId: scope.auditId,
    category: "manifests",
    artifactName: `source-checkpoint-${source}.json`,
  });
}

export function buildCanonicalRecordManifestKey(scope) {
  return buildArtifactKey({
    tenantId: scope.tenantId,
    clientId: scope.clientId,
    auditId: scope.auditId,
    category: "manifests",
    artifactName: "canonical-evidence-record.json",
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function verifyRecordBytes(store, record) {
  return store.verify(record);
}

// ---------------------------------------------------------------------------
// Persist source checkpoint manifest
// ---------------------------------------------------------------------------

/**
 * Persist and verify a source checkpoint manifest.
 *
 * @param {object} opts
 * @param {object} opts.store — governed Artifact Store
 * @param {object} opts.scope — { tenantId, clientId, auditId }
 * @param {string} opts.source
 * @param {string} opts.sourceExecutionKey
 * @param {string} opts.completedAt
 * @param {object} opts.normalizedRecord — complete Artifact Record from store.put()
 * @param {object|null} opts.rawRecord — complete Artifact Record or null
 * @returns {Promise<object>} the manifest record from store.put()
 */
export async function persistSourceCheckpointManifest({
  store, scope, source, sourceExecutionKey, completedAt,
  normalizedRecord, rawRecord,
}) {
  const key = buildSourceCheckpointManifestKey(scope, source);

  const manifest = {
    contractVersion: "1.0.0",
    auditId: scope.auditId,
    tenantId: scope.tenantId,
    clientId: scope.clientId,
    source,
    completed: true,
    sourceExecutionKey,
    completedAt,
    normalizedArtifact: normalizedRecord,
  };
  if (rawRecord) {
    manifest.rawArtifact = rawRecord;
  }

  const bytes = Buffer.from(JSON.stringify(manifest), "utf-8");
  const record = await store.put({
    bytes,
    contentType: "application/json",
    scope: { ...scope, category: "manifests", artifactName: `source-checkpoint-${source}.json` },
    source,
  });

  // Read-back and verify
  const readBack = await store.get(record.key);
  if (!readBack || readBack.length !== bytes.length) {
    throw new Error(`Source checkpoint manifest byte mismatch for ${source}`);
  }
  if (record.sha256 !== sha256(bytes)) {
    throw new Error(`Source checkpoint manifest SHA mismatch for ${source}`);
  }
  if (!(await store.verify(record))) {
    throw new Error(`Source checkpoint manifest verification failed for ${source}`);
  }

  return record;
}

// ---------------------------------------------------------------------------
// Load and verify source checkpoint manifest
// ---------------------------------------------------------------------------

/**
 * Load and fully verify a source checkpoint manifest.
 * Returns the manifest content and the validated source result on success.
 * Throws on any verification failure.
 *
 * @param {object} opts
 * @param {object} opts.store
 * @param {object} opts.scope — { tenantId, clientId, auditId }
 * @param {string} opts.source
 * @param {function} opts.validateContract — (schemaId, obj) => { valid, errors }
 * @returns {Promise<{ manifest: object, sourceResult: object, rawRecord: object|null, normalizedRecord: object }>}
 */
export async function loadAndVerifySourceCheckpointManifest({
  store, scope, source, validateContract,
}) {
  const key = buildSourceCheckpointManifestKey(scope, source);
  const exists = await store.exists(key);
  if (!exists) return null;

  // 1. Load manifest bytes
  const manifestBytes = await store.get(key);
  if (!manifestBytes || manifestBytes.length === 0) {
    throw new Error(`Source checkpoint manifest is empty for ${source}`);
  }

  // 2. Parse manifest
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf-8"));
  } catch {
    throw new Error(`Source checkpoint manifest is not valid JSON for ${source}`);
  }

  // 3. Validate manifest structure
  if (manifest.contractVersion !== "1.0.0") throw new Error(`Source checkpoint contractVersion mismatch for ${source}`);
  if (manifest.auditId !== scope.auditId) throw new Error(`Source checkpoint auditId mismatch for ${source}`);
  if (manifest.tenantId !== scope.tenantId) throw new Error(`Source checkpoint tenantId mismatch for ${source}`);
  if (manifest.clientId !== scope.clientId) throw new Error(`Source checkpoint clientId mismatch for ${source}`);
  if (manifest.source !== source) throw new Error(`Source checkpoint source mismatch: expected ${source}, got ${manifest.source}`);
  if (manifest.completed !== true) throw new Error(`Source checkpoint not marked completed for ${source}`);
  if (!manifest.sourceExecutionKey) throw new Error(`Source checkpoint missing sourceExecutionKey for ${source}`);

  // 4. Verify normalized Artifact Record
  const normalizedRecord = manifest.normalizedArtifact;
  if (!normalizedRecord || !normalizedRecord.key) {
    throw new Error(`Source checkpoint missing normalizedArtifact for ${source}`);
  }

  // Validate record structure
  const normValid = validateArtifactRecord(normalizedRecord);
  if (!normValid) throw new Error(`Source checkpoint normalized artifact record invalid for ${source}`);

  // Parse key to verify category and tenant scope
  const parsedNorm = parseArtifactKey(normalizedRecord.key);
  if (parsedNorm.category !== "normalized") throw new Error(`Source checkpoint normalized key not in normalized category for ${source}`);
  if (parsedNorm.artifactName !== `${source}.json`) throw new Error(`Source checkpoint normalized artifact name mismatch for ${source}`);
  if (parsedNorm.tenantId !== scope.tenantId || parsedNorm.clientId !== scope.clientId || parsedNorm.auditId !== scope.auditId) {
    throw new Error(`Source checkpoint normalized artifact cross-tenant for ${source}`);
  }

  // Verify record through Artifact Store
  if (!(await verifyRecordBytes(store, normalizedRecord))) {
    throw new Error(`Source checkpoint normalized artifact verification failed for ${source}`);
  }

  // Load and verify normalized bytes
  const normalizedBytes = await store.get(normalizedRecord.key);
  if (!normalizedBytes || normalizedBytes.length !== normalizedRecord.bytes) {
    throw new Error(`Source checkpoint normalized byte count mismatch for ${source}`);
  }
  if (sha256(normalizedBytes) !== normalizedRecord.sha256) {
    throw new Error(`Source checkpoint normalized SHA mismatch for ${source}`);
  }

  // Parse and validate normalized source result
  let sourceResult;
  try {
    sourceResult = JSON.parse(normalizedBytes.toString("utf-8"));
  } catch {
    throw new Error(`Source checkpoint normalized artifact not valid JSON for ${source}`);
  }

  // Validate against source-result schema
  const { valid, errors } = validateContract(
    "https://vantage-platform.io/prysm/contracts/v1/source-result.schema.json",
    sourceResult,
  );
  if (!valid) {
    throw new Error(`Source checkpoint source result schema invalid for ${source}: ${(errors || []).map(e => e.message || e).join("; ")}`);
  }
  if (sourceResult.source !== source) {
    throw new Error(`Source checkpoint source result source mismatch: expected ${source}, got ${sourceResult.source}`);
  }

  // 5. Verify raw Artifact Record if present
  let rawRecord = null;
  if (manifest.rawArtifact) {
    rawRecord = manifest.rawArtifact;
    if (!rawRecord.key) throw new Error(`Source checkpoint rawArtifact missing key for ${source}`);

    const parsedRaw = parseArtifactKey(rawRecord.key);
    if (parsedRaw.category !== "raw") throw new Error(`Source checkpoint raw key not in raw category for ${source}`);
    if (parsedRaw.tenantId !== scope.tenantId || parsedRaw.clientId !== scope.clientId || parsedRaw.auditId !== scope.auditId) {
      throw new Error(`Source checkpoint raw artifact cross-tenant for ${source}`);
    }

    if (!(await verifyRecordBytes(store, rawRecord))) {
      throw new Error(`Source checkpoint raw artifact verification failed for ${source}`);
    }

    const rawBytes = await store.get(rawRecord.key);
    if (!rawBytes || rawBytes.length !== rawRecord.bytes) {
      throw new Error(`Source checkpoint raw byte count mismatch for ${source}`);
    }
    if (sha256(rawBytes) !== rawRecord.sha256) {
      throw new Error(`Source checkpoint raw SHA mismatch for ${source}`);
    }
  }

  return { manifest, sourceResult, rawRecord, normalizedRecord };
}

// ---------------------------------------------------------------------------
// Persist canonical record manifest
// ---------------------------------------------------------------------------

/**
 * Persist and verify the canonical evidence record manifest.
 *
 * @param {object} opts
 * @param {object} opts.store
 * @param {object} opts.scope
 * @param {string} opts.createdAt
 * @param {object} opts.canonicalRecord — complete Artifact Record from store.put() for canonical evidence
 * @returns {Promise<object>} the manifest record
 */
export async function persistCanonicalRecordManifest({
  store, scope, createdAt, canonicalRecord,
}) {
  const manifest = {
    contractVersion: "1.0.0",
    auditId: scope.auditId,
    tenantId: scope.tenantId,
    clientId: scope.clientId,
    createdAt,
    canonicalArtifact: canonicalRecord,
  };

  const bytes = Buffer.from(JSON.stringify(manifest), "utf-8");
  const record = await store.put({
    bytes,
    contentType: "application/json",
    scope: { ...scope, category: "manifests", artifactName: "canonical-evidence-record.json" },
  });

  // Read-back and verify
  const readBack = await store.get(record.key);
  if (!readBack || readBack.length !== bytes.length) {
    throw new Error("Canonical record manifest byte mismatch");
  }
  if (record.sha256 !== sha256(bytes)) {
    throw new Error("Canonical record manifest SHA mismatch");
  }
  if (!(await store.verify(record))) {
    throw new Error("Canonical record manifest verification failed");
  }

  return record;
}

// ---------------------------------------------------------------------------
// Load and verify canonical record manifest
// ---------------------------------------------------------------------------

/**
 * Load and fully verify the canonical evidence record manifest.
 *
 * @param {object} opts
 * @param {object} opts.store
 * @param {object} opts.scope
 * @param {function} opts.validateContract
 * @returns {Promise<{ manifest: object, canonicalArtifact: object, evidence: object }>}
 */
export async function loadAndVerifyCanonicalRecordManifest({
  store, scope, validateContract,
}) {
  const key = buildCanonicalRecordManifestKey(scope);
  const exists = await store.exists(key);
  if (!exists) {
    throw new Error("Canonical record manifest not found");
  }

  const manifestBytes = await store.get(key);
  if (!manifestBytes || manifestBytes.length === 0) {
    throw new Error("Canonical record manifest is empty");
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf-8"));
  } catch {
    throw new Error("Canonical record manifest is not valid JSON");
  }

  if (manifest.contractVersion !== "1.0.0") throw new Error("Canonical record manifest contractVersion mismatch");
  if (manifest.auditId !== scope.auditId) throw new Error("Canonical record manifest auditId mismatch");
  if (manifest.tenantId !== scope.tenantId) throw new Error("Canonical record manifest tenantId mismatch");
  if (manifest.clientId !== scope.clientId) throw new Error("Canonical record manifest clientId mismatch");

  const canonicalArtifact = manifest.canonicalArtifact;
  if (!canonicalArtifact || !canonicalArtifact.key) {
    throw new Error("Canonical record manifest missing canonicalArtifact");
  }

  // Validate record
  if (!validateArtifactRecord(canonicalArtifact)) {
    throw new Error("Canonical record manifest artifact record invalid");
  }

  // Verify key scope
  const parsed = parseArtifactKey(canonicalArtifact.key);
  if (parsed.category !== "canonical") throw new Error("Canonical artifact key not in canonical category");
  if (parsed.artifactName !== "evidence.json") throw new Error("Canonical artifact name mismatch");
  if (parsed.tenantId !== scope.tenantId || parsed.clientId !== scope.clientId || parsed.auditId !== scope.auditId) {
    throw new Error("Canonical artifact cross-tenant");
  }

  // Verify through Artifact Store
  if (!(await verifyRecordBytes(store, canonicalArtifact))) {
    throw new Error("Canonical artifact verification failed");
  }

  // Load and verify bytes
  const evidenceBytes = await store.get(canonicalArtifact.key);
  if (!evidenceBytes || evidenceBytes.length !== canonicalArtifact.bytes) {
    throw new Error("Canonical artifact byte count mismatch");
  }
  if (sha256(evidenceBytes) !== canonicalArtifact.sha256) {
    throw new Error("Canonical artifact SHA mismatch");
  }
  if (canonicalArtifact.contentType !== "application/json") {
    throw new Error("Canonical artifact content type mismatch");
  }

  // Parse and validate canonical evidence
  let evidence;
  try {
    evidence = JSON.parse(evidenceBytes.toString("utf-8"));
  } catch {
    throw new Error("Canonical artifact not valid JSON");
  }

  const { valid, errors } = validateContract(
    "https://vantage-platform.io/prysm/contracts/v1/canonical-evidence.schema.json",
    evidence,
  );
  if (!valid) {
    throw new Error(`Canonical evidence schema invalid: ${(errors || []).map(e => e.message || e).join("; ")}`);
  }
  if (evidence.auditId !== scope.auditId) {
    throw new Error("Canonical evidence auditId mismatch");
  }

  return { manifest, canonicalArtifact, evidence };
}

export default {
  buildSourceCheckpointManifestKey,
  buildCanonicalRecordManifestKey,
  persistSourceCheckpointManifest,
  loadAndVerifySourceCheckpointManifest,
  persistCanonicalRecordManifest,
  loadAndVerifyCanonicalRecordManifest,
};

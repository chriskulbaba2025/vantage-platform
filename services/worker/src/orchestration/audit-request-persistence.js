/**
 * C9 — Durable complete AuditRequest persistence.
 *
 * The complete normalized AuditRequest is persisted as a canonical artifact
 * before background execution begins.  Recovery loads the persisted request
 * verbatim — it never reconstructs missing values with defaults.
 *
 * @module orchestration/audit-request-persistence
 */

import { createHash } from "node:crypto";
import { buildArtifactKey } from "../storage/artifact-key.js";

const AUDIT_REQUEST_SCHEMA = "https://vantage-platform.io/prysm/contracts/v1/audit-request.schema.json";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Canonical artifact key for the durable AuditRequest. */
export function auditRequestArtifactKey({ tenantId, clientId, auditId }) {
  return buildArtifactKey({
    tenantId, clientId, auditId,
    category: "canonical",
    artifactName: "audit-request.json",
  });
}

/**
 * Persist the complete normalized AuditRequest durably.
 *
 * @param {object} opts
 * @param {object} opts.store — governed artifact store
 * @param {object} opts.auditRequest — complete normalized request
 * @param {Function} [opts.validateContract]
 * @returns {Promise<object>} artifact record
 */
export async function persistAuditRequest({ store, auditRequest, validateContract }) {
  if (validateContract) {
    const v = validateContract(AUDIT_REQUEST_SCHEMA, auditRequest);
    if (!v || !v.valid) {
      throw new Error(`AuditRequest validation failed before persistence: ${JSON.stringify((v?.errors || []).slice(0, 5))}`);
    }
  }

  const bytes = Buffer.from(JSON.stringify(auditRequest), "utf-8");
  const record = await store.put({
    bytes,
    contentType: "application/json",
    scope: {
      tenantId: auditRequest.tenantId,
      clientId: auditRequest.clientId,
      auditId: auditRequest.auditId,
      category: "canonical",
      artifactName: "audit-request.json",
    },
  });

  // Read-back verification
  const stored = await store.get(record.key);
  if (!stored || stored.length !== bytes.length) {
    throw new Error("AuditRequest read-back byte mismatch");
  }
  if (record.sha256 !== sha256(bytes)) {
    throw new Error("AuditRequest SHA-256 mismatch");
  }

  return record;
}

/**
 * Load the persisted complete AuditRequest.
 * Returns null when no persisted request exists — callers decide
 * fail-closed policy (reconstruction is prohibited).
 *
 * @param {object} opts
 * @param {object} opts.store — governed artifact store
 * @param {{ tenantId: string, clientId: string, auditId: string }} opts.scope
 * @param {Function} [opts.validateContract]
 * @returns {Promise<object|null>}
 */
export async function loadAuditRequest({ store, scope, validateContract }) {
  const key = auditRequestArtifactKey(scope);
  if (typeof store.exists === "function" && !(await store.exists(key))) return null;
  const bytes = await store.get(key);
  if (!bytes) return null;

  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));

  if (validateContract) {
    const v = validateContract(AUDIT_REQUEST_SCHEMA, parsed);
    if (!v || !v.valid) {
      throw new Error(`Persisted AuditRequest validation failed: ${JSON.stringify((v?.errors || []).slice(0, 5))}`);
    }
  }

  return parsed;
}

export default { persistAuditRequest, loadAuditRequest, auditRequestArtifactKey };

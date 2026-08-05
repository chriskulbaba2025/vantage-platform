/**
 * Postgres Lifecycle Repository
 *
 * Uses explicit BEGIN/COMMIT/ROLLBACK, parameterized SQL,
 * transition-request fingerprints, and tenant-scoped uniqueness.
 *
 * @module lifecycle/postgres-repository
 */

import {
  RepositoryFailureError, DuplicateAuditError, AuditNotFoundError,
  ConcurrencyConflictError, TenantIsolationError,
  TransitionIdempotencyConflictError,
} from "./lifecycle-errors.js";

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const SQL = {
  insertAuditMeta: `
    INSERT INTO prysm.lifecycle_audits (audit_id, tenant_id, client_id, created_at)
    VALUES ($1,$2,$3,$4)
  `,
  insertIdempotency: `
    INSERT INTO prysm.lifecycle_idempotency (tenant_id, idempotency_key, audit_id, client_id, created_at)
    VALUES ($1,$2,$3,$4,$5)
  `,
  loadIdempotencyConflict: `
    SELECT audit_id, tenant_id, client_id FROM prysm.lifecycle_idempotency
    WHERE tenant_id = $1 AND idempotency_key = $2
  `,
  loadIdempotencyExact: `
    SELECT audit_id, tenant_id, client_id FROM prysm.lifecycle_idempotency
    WHERE tenant_id = $1 AND idempotency_key = $2 AND audit_id = $3
  `,
  insertEvent: `
    INSERT INTO prysm.lifecycle_events
      (event_id, audit_id, tenant_id, client_id, sequence,
       prior_state, next_state, timestamp, actor, reason,
       execution_id, code_version, artifact_key, transition_idempotency_key, request_fingerprint)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `,
  insertTransitionKey: `
    INSERT INTO prysm.lifecycle_transition_keys
      (audit_id, transition_idempotency_key, event_id, request_fingerprint)
    VALUES ($1,$2,$3,$4)
  `,
  loadEvents: `
    SELECT * FROM prysm.lifecycle_events
    WHERE audit_id = $1 ORDER BY sequence ASC
  `,
  loadTransitionKey: `
    SELECT e.*, tk.request_fingerprint
    FROM prysm.lifecycle_transition_keys tk
    JOIN prysm.lifecycle_events e ON e.event_id = tk.event_id
    WHERE tk.audit_id = $1 AND tk.transition_idempotency_key = $2
  `,
  loadAuditMeta: `
    SELECT tenant_id, client_id FROM prysm.lifecycle_audits WHERE audit_id = $1
  `,
  lockAudit: `
    SELECT tenant_id, client_id FROM prysm.lifecycle_audits WHERE audit_id = $1 FOR UPDATE
  `,
  latestEvent: `
    SELECT next_state, sequence FROM prysm.lifecycle_events
    WHERE audit_id = $1 ORDER BY sequence DESC LIMIT 1
  `,
  // Real UPDATE proof
  updateAuditClient: `
    UPDATE prysm.lifecycle_audits SET client_id = $1 WHERE audit_id = $2
  `,
};

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToEvent(row) {
  return Object.freeze({
    eventId:       row.event_id,
    auditId:       row.audit_id,
    tenantId:      row.tenant_id,
    clientId:      row.client_id,
    sequence:      typeof row.sequence === "string" ? parseInt(row.sequence, 10) : row.sequence,
    priorState:    row.prior_state,
    nextState:     row.next_state,
    timestamp:     row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp),
    actor:         row.actor,
    reason:        row.reason,
    executionId:   row.execution_id || null,
    codeVersion:   row.code_version,
    artifactKey:   row.artifact_key || null,
    transitionIdempotencyKey: row.transition_idempotency_key || null,
    _fingerprint:  row.request_fingerprint || null,
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPostgresLifecycleRepository({ pool }) {
  if (!pool) throw new Error("postgres-lifecycle-repository requires a pool");

  async function runMigration(sql) {
    const statements = sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const stmt of statements) { await pool.query(stmt); }
  }

  async function withTransaction(fn) {
    const client = typeof pool.connect === "function" ? await pool.connect() : pool;
    const hasTx = typeof client.query === "function";
    const exec = hasTx ? client : pool;
    try {
      if (hasTx) await exec.query("BEGIN");
      const result = await fn(exec);
      if (hasTx) await exec.query("COMMIT");
      return result;
    } catch (err) {
      if (hasTx) { try { await exec.query("ROLLBACK"); } catch {} }
      throw err;
    } finally {
      if (hasTx && typeof client.release === "function") {
        try { client.release(); } catch {}
      }
    }
  }

  // ------------------------------------------------------------------
  // createAudit — concurrent-idempotent transaction
  // ------------------------------------------------------------------

  async function createAudit({ auditId, tenantId, clientId, idempotencyKey, event }) {
    try {
      return await withTransaction(async (db) => {
        // Check if idempotency key already exists
        const existing = await db.query(SQL.loadIdempotencyConflict, [tenantId, idempotencyKey]);
        if (existing.rows.length > 0) {
          const row = existing.rows[0];
          if (row.audit_id === auditId && row.tenant_id === tenantId && row.client_id === clientId) {
            return true; // idempotent — all data matches
          }
          throw new DuplicateAuditError({
            tenantId, idempotencyKey,
            existingAuditId: row.audit_id, newAuditId: auditId,
          });
        }

        // Check auditId collision
        const auditCheck = await db.query(SQL.loadAuditMeta, [auditId]);
        if (auditCheck.rows.length > 0) {
          throw new DuplicateAuditError({ auditId, reason: "auditId already exists" });
        }

        const now = new Date().toISOString();
        await db.query(SQL.insertAuditMeta, [auditId, tenantId, clientId, now]);
        await db.query(SQL.insertIdempotency, [tenantId, idempotencyKey, auditId, clientId, now]);
        await db.query(SQL.insertEvent, [
          event.eventId, event.auditId, event.tenantId, event.clientId,
          event.sequence, event.priorState, event.nextState,
          event.timestamp, event.actor, event.reason,
          event.executionId, event.codeVersion, event.artifactKey,
          event.transitionIdempotencyKey, null, // no fingerprint for creation
        ]);
        return false; // newly created
      });
    } catch (err) {
      if (err instanceof DuplicateAuditError) throw err;
      if (err.code === "23505" || (err.message && err.message.includes("duplicate"))) {
        // Reread to determine idempotent vs conflict
        const chk = await pool.query(SQL.loadIdempotencyExact, [tenantId, idempotencyKey, auditId]);
        if (chk.rows.length > 0) return true; // idempotent
        throw new DuplicateAuditError({ auditId, idempotencyKey });
      }
      throw new RepositoryFailureError(`Failed to create audit: ${err.message}`, { auditId });
    }
  }

  // ------------------------------------------------------------------
  // loadEvents
  // ------------------------------------------------------------------

  async function loadEvents(auditId, tenantId) {
    const metaResult = await pool.query(SQL.loadAuditMeta, [auditId]);
    if (metaResult.rows.length === 0) return [];
    if (metaResult.rows[0].tenant_id !== tenantId) {
      throw new TenantIsolationError({ auditId, tenantId });
    }
    const result = await pool.query(SQL.loadEvents, [auditId]);
    return result.rows.map(rowToEvent);
  }

  // ------------------------------------------------------------------
  // loadByIdempotencyKey
  // ------------------------------------------------------------------

  async function loadByIdempotencyKey(tenantId, idempotencyKey) {
    const result = await pool.query(SQL.loadIdempotencyConflict, [tenantId, idempotencyKey]);
    if (result.rows.length === 0) return null;
    return {
      auditId: result.rows[0].audit_id,
      idempotencyKey,
      tenantId: result.rows[0].tenant_id,
      clientId: result.rows[0].client_id,
    };
  }

  // ------------------------------------------------------------------
  // loadByTransitionKey
  // ------------------------------------------------------------------

  async function loadByTransitionKey(auditId, transitionIdempotencyKey) {
    const result = await pool.query(SQL.loadTransitionKey, [auditId, transitionIdempotencyKey]);
    if (result.rows.length === 0) return null;
    return rowToEvent(result.rows[0]);
  }

  // ------------------------------------------------------------------
  // appendEventAtomic
  // ------------------------------------------------------------------

  async function appendEventAtomic({ event, expectedState, expectedVersion }) {
    await withTransaction(async (db) => {
      const lockResult = await db.query(SQL.lockAudit, [event.auditId]);
      if (lockResult.rows.length === 0) {
        throw new AuditNotFoundError(event.auditId);
      }

      // Check transition idempotency
      const existingTk = await db.query(SQL.loadTransitionKey, [
        event.auditId, event.transitionIdempotencyKey,
      ]);
      if (existingTk.rows.length > 0) {
        const row = existingTk.rows[0];
        if (row.request_fingerprint === event._fingerprint &&
            row.next_state === event.nextState) {
          return; // idempotent
        }
        throw new TransitionIdempotencyConflictError(event.auditId, event.transitionIdempotencyKey, {
          existingNextState: row.next_state,
          existingFingerprint: row.request_fingerprint,
          requestedNextState: event.nextState,
          requestedFingerprint: event._fingerprint,
        });
      }

      // Concurrency
      const latestResult = await db.query(SQL.latestEvent, [event.auditId]);
      const currentVersion = latestResult.rows.length > 0 ? latestResult.rows[0].sequence + 1 : 0;
      const currentState = latestResult.rows.length > 0 ? latestResult.rows[0].next_state : null;

      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        throw new ConcurrencyConflictError(event.auditId, { expectedVersion, actualVersion: currentVersion });
      }
      if (expectedState !== undefined && expectedState !== currentState) {
        throw new ConcurrencyConflictError(event.auditId, { expectedState, actualState: currentState });
      }

      await db.query(SQL.insertEvent, [
        event.eventId, event.auditId, event.tenantId, event.clientId,
        event.sequence, event.priorState, event.nextState,
        event.timestamp, event.actor, event.reason,
        event.executionId, event.codeVersion, event.artifactKey,
        event.transitionIdempotencyKey, event._fingerprint,
      ]);

      await db.query(SQL.insertTransitionKey, [
        event.auditId, event.transitionIdempotencyKey, event.eventId, event._fingerprint,
      ]);
    });
  }

  // ------------------------------------------------------------------
  // executeUpdate — real UPDATE proof
  // ------------------------------------------------------------------

  async function executeUpdate(auditId, newClientId) {
    const result = await pool.query(SQL.updateAuditClient, [newClientId, auditId]);
    return result;
  }

  return {
    createAudit, loadEvents, loadByIdempotencyKey,
    loadByTransitionKey, appendEventAtomic,
    runMigration, executeUpdate,
  };
}

export default { createPostgresLifecycleRepository };

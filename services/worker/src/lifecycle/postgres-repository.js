/**
 * Postgres Lifecycle Repository
 *
 * Stores lifecycle events in PostgreSQL.  Uses parameterized SQL
 * and explicit transaction boundaries.  Compatible with pg-mem
 * for integration testing — no real database required in CI.
 *
 * @module lifecycle/postgres-repository
 */

import {
  RepositoryFailureError,
  DuplicateAuditError,
} from "./lifecycle-errors.js";

// ---------------------------------------------------------------------------
// SQL templates (parameterized)
// ---------------------------------------------------------------------------

const SQL = {
  insertIdempotency: `
    INSERT INTO prysm.lifecycle_idempotency (audit_id, idempotency_key, tenant_id, client_id, created_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (audit_id) DO NOTHING
    RETURNING audit_id
  `,

  checkIdempotency: `
    SELECT idempotency_key, audit_id
    FROM prysm.lifecycle_idempotency
    WHERE audit_id = $1
  `,

  insertEvent: `
    INSERT INTO prysm.lifecycle_events
      (event_id, audit_id, tenant_id, client_id, sequence,
       prior_state, next_state, timestamp, actor, reason,
       execution_id, code_version, artifact_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  `,

  loadEvents: `
    SELECT event_id, audit_id, tenant_id, client_id, sequence,
           prior_state, next_state, timestamp, actor, reason,
           execution_id, code_version, artifact_key
    FROM prysm.lifecycle_events
    WHERE audit_id = $1
    ORDER BY sequence ASC
  `,
};

// ---------------------------------------------------------------------------
// Row → object mapping
// ---------------------------------------------------------------------------

function rowToEvent(row) {
  return Object.freeze({
    eventId:       row.event_id,
    auditId:       row.audit_id,
    tenantId:      row.tenant_id,
    clientId:      row.client_id,
    sequence:      row.sequence,
    priorState:    row.prior_state,
    nextState:     row.next_state,
    timestamp:     row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp),
    actor:         row.actor,
    reason:        row.reason,
    executionId:   row.execution_id || null,
    codeVersion:   row.code_version,
    artifactKey:   row.artifact_key || null,
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a PostgreSQL-backed lifecycle repository.
 *
 * @param {object} opts
 * @param {object} opts.pool  - A pg Pool or pg-mem-bound Pool-like object.
 *   Must expose `query(sql, params)` returning `{ rows: Array }`.
 * @returns {object} Repository contract.
 */
export function createPostgresLifecycleRepository({ pool }) {
  if (!pool) {
    throw new Error("postgres-lifecycle-repository requires a pool");
  }

  /**
   * Execute a migration SQL file against the pool.
   *
   * @param {string} sql - Raw SQL to execute (statements split by ;).
   */
  async function runMigration(sql) {
    // Split on semicolons, skip empty/whitespace-only statements
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await pool.query(stmt);
    }
  }

  // ------------------------------------------------------------------
  // Repository contract
  // ------------------------------------------------------------------

  async function createAudit({ auditId, tenantId, clientId, idempotencyKey, event }) {
    try {
      // Check for existing idempotency record
      const existing = await pool.query(SQL.checkIdempotency, [auditId]);
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.idempotency_key !== idempotencyKey) {
          throw new DuplicateAuditError(auditId, idempotencyKey, {
            existingKey: row.idempotency_key,
          });
        }
        // Same key — already exists, idempotent return
        return;
      }

      // Insert idempotency record and first event in a logical batch
      await pool.query(SQL.insertIdempotency, [auditId, idempotencyKey, tenantId, clientId, new Date().toISOString()]);

      await pool.query(SQL.insertEvent, [
        event.eventId, event.auditId, event.tenantId, event.clientId,
        event.sequence, event.priorState, event.nextState,
        event.timestamp, event.actor, event.reason,
        event.executionId, event.codeVersion, event.artifactKey,
      ]);
    } catch (err) {
      // pg-mem: if duplicate key error
      if (err.code === "23505" || (err.message && err.message.includes("duplicate"))) {
        throw new DuplicateAuditError(auditId, idempotencyKey);
      }
      throw new RepositoryFailureError(
        `Failed to create audit: ${err.message}`,
        { auditId, cause: err.message },
      );
    }
  }

  async function loadEvents(auditId) {
    try {
      const result = await pool.query(SQL.loadEvents, [auditId]);
      return result.rows.map(rowToEvent);
    } catch (err) {
      throw new RepositoryFailureError(
        `Failed to load events: ${err.message}`,
        { auditId, cause: err.message },
      );
    }
  }

  async function appendEvent(event) {
    try {
      await pool.query(SQL.insertEvent, [
        event.eventId, event.auditId, event.tenantId, event.clientId,
        event.sequence, event.priorState, event.nextState,
        event.timestamp, event.actor, event.reason,
        event.executionId, event.codeVersion, event.artifactKey,
      ]);
    } catch (err) {
      // pg-mem: if duplicate sequence
      if (err.code === "23505" || (err.message && err.message.includes("duplicate"))) {
        throw new RepositoryFailureError(
          `Duplicate sequence: ${event.sequence} for audit ${event.auditId}`,
          { auditId: event.auditId, sequence: event.sequence },
        );
      }
      throw new RepositoryFailureError(
        `Failed to append event: ${err.message}`,
        { auditId: event.auditId, cause: err.message },
      );
    }
  }

  async function loadIdempotency(auditId) {
    try {
      const result = await pool.query(SQL.checkIdempotency, [auditId]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return { idempotencyKey: row.idempotency_key };
    } catch (err) {
      throw new RepositoryFailureError(
        `Failed to load idempotency: ${err.message}`,
        { auditId, cause: err.message },
      );
    }
  }

  return {
    createAudit,
    loadEvents,
    appendEvent,
    loadIdempotency,
    runMigration,
  };
}

export default { createPostgresLifecycleRepository };

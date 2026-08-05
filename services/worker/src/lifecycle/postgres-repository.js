/**
 * Postgres Lifecycle Repository
 *
 * Uses explicit BEGIN/COMMIT/ROLLBACK transactions, parameterized SQL,
 * and tenant-scoped uniqueness constraints.
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
  // Audit creation — two inserts in one transaction
  insertAuditMeta: `
    INSERT INTO prysm.lifecycle_audits (audit_id, tenant_id, client_id, created_at)
    VALUES ($1,$2,$3,$4)
  `,
  insertIdempotency: `
    INSERT INTO prysm.lifecycle_idempotency (tenant_id, idempotency_key, audit_id, client_id, created_at)
    VALUES ($1,$2,$3,$4,$5)
  `,
  insertEvent: `
    INSERT INTO prysm.lifecycle_events
      (event_id, audit_id, tenant_id, client_id, sequence,
       prior_state, next_state, timestamp, actor, reason,
       execution_id, code_version, artifact_key, transition_idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `,
  insertTransitionKey: `
    INSERT INTO prysm.lifecycle_transition_keys (audit_id, transition_idempotency_key, event_id)
    VALUES ($1,$2,$3)
  `,
  loadEvents: `
    SELECT * FROM prysm.lifecycle_events
    WHERE audit_id = $1 ORDER BY sequence ASC
  `,
  loadIdempotency: `
    SELECT tenant_id, idempotency_key, audit_id
    FROM prysm.lifecycle_idempotency
    WHERE tenant_id = $1 AND idempotency_key = $2
  `,
  loadTransitionKey: `
    SELECT e.* FROM prysm.lifecycle_transition_keys tk
    JOIN prysm.lifecycle_events e ON e.event_id = tk.event_id
    WHERE tk.audit_id = $1 AND tk.transition_idempotency_key = $2
  `,
  loadAuditMeta: `
    SELECT tenant_id, client_id FROM prysm.lifecycle_audits WHERE audit_id = $1
  `,

  // Concurrency: lock audit metadata row
  lockAudit: `
    SELECT tenant_id, client_id FROM prysm.lifecycle_audits WHERE audit_id = $1 FOR UPDATE
  `,

  // Get latest state for concurrency check
  latestEvent: `
    SELECT next_state, sequence FROM prysm.lifecycle_events
    WHERE audit_id = $1 ORDER BY sequence DESC LIMIT 1
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
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPostgresLifecycleRepository({ pool }) {
  if (!pool) throw new Error("postgres-lifecycle-repository requires a pool");

  /**
   * Run migration SQL.
   */
  async function runMigration(sql) {
    const statements = sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const stmt of statements) {
      await pool.query(stmt);
    }
  }

  /**
   * Begin a transaction, run `fn(client)`, commit or rollback.
   */
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
      if (hasTx) {
        try { await exec.query("ROLLBACK"); } catch { /* best effort */ }
      }
      throw err;
    } finally {
      if (hasTx && typeof client.release === "function") {
        try { client.release(); } catch { /* best effort */ }
      }
    }
  }

  // ------------------------------------------------------------------
  // createAudit — atomic transaction
  // ------------------------------------------------------------------

  async function createAudit({ auditId, tenantId, clientId, idempotencyKey, event }) {
    try {
      await withTransaction(async (db) => {
        // Check tenant-scoped idempotency
        const idemResult = await db.query(SQL.loadIdempotency, [tenantId, idempotencyKey]);
        if (idemResult.rows.length > 0) {
          const row = idemResult.rows[0];
          if (row.audit_id === auditId) return; // idempotent
          throw new DuplicateAuditError({
            tenantId, idempotencyKey,
            existingAuditId: row.audit_id, newAuditId: auditId,
          });
        }

        // Check auditId not already claimed
        const auditResult = await db.query(SQL.loadAuditMeta, [auditId]);
        if (auditResult.rows.length > 0) {
          throw new DuplicateAuditError({ auditId, reason: "auditId already exists" });
        }

        const now = new Date().toISOString();

        // Insert both rows atomically
        await db.query(SQL.insertAuditMeta, [auditId, tenantId, clientId, now]);
        await db.query(SQL.insertIdempotency, [tenantId, idempotencyKey, auditId, clientId, now]);
        await db.query(SQL.insertEvent, [
          event.eventId, event.auditId, event.tenantId, event.clientId,
          event.sequence, event.priorState, event.nextState,
          event.timestamp, event.actor, event.reason,
          event.executionId, event.codeVersion, event.artifactKey,
          event.transitionIdempotencyKey,
        ]);
      });
    } catch (err) {
      if (err instanceof DuplicateAuditError) throw err;
      if (err.code === "23505" || (err.message && err.message.includes("duplicate"))) {
        throw new DuplicateAuditError({ auditId, idempotencyKey });
      }
      throw new RepositoryFailureError(`Failed to create audit: ${err.message}`, { auditId });
    }
  }

  // ------------------------------------------------------------------
  // loadEvents — tenant scoped
  // ------------------------------------------------------------------

  async function loadEvents(auditId, tenantId) {
    try {
      const metaResult = await pool.query(SQL.loadAuditMeta, [auditId]);
      if (metaResult.rows.length === 0) return [];
      if (metaResult.rows[0].tenant_id !== tenantId) {
        throw new TenantIsolationError({ auditId, tenantId });
      }
      const result = await pool.query(SQL.loadEvents, [auditId]);
      return result.rows.map(rowToEvent);
    } catch (err) {
      if (err instanceof TenantIsolationError) throw err;
      throw new RepositoryFailureError(`Failed to load events: ${err.message}`, { auditId });
    }
  }

  // ------------------------------------------------------------------
  // loadByIdempotencyKey
  // ------------------------------------------------------------------

  async function loadByIdempotencyKey(tenantId, idempotencyKey) {
    const result = await pool.query(SQL.loadIdempotency, [tenantId, idempotencyKey]);
    if (result.rows.length === 0) return null;
    return {
      auditId: result.rows[0].audit_id,
      idempotencyKey: result.rows[0].idempotency_key,
      tenantId: result.rows[0].tenant_id,
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
  // appendEventAtomic — with transaction, lock, concurrency check
  // ------------------------------------------------------------------

  async function appendEventAtomic({ event, expectedState, expectedVersion }) {
    await withTransaction(async (db) => {
      // Lock audit row
      const lockResult = await db.query(SQL.lockAudit, [event.auditId]);
      if (lockResult.rows.length === 0) {
        throw new AuditNotFoundError(event.auditId);
      }

      // Check transition idempotency
      const existingTk = await db.query(SQL.loadTransitionKey, [
        event.auditId, event.transitionIdempotencyKey,
      ]);
      if (existingTk.rows.length > 0) {
        const e = rowToEvent(existingTk.rows[0]);
        if (e.nextState === event.nextState && e.sequence === event.sequence) {
          return; // idempotent
        }
        throw new TransitionIdempotencyConflictError(event.auditId, event.transitionIdempotencyKey, {
          existingNextState: e.nextState, requestedNextState: event.nextState,
        });
      }

      // Concurrency: check current state/version under lock
      const latestResult = await db.query(SQL.latestEvent, [event.auditId]);
      const currentVersion = latestResult.rows.length > 0 ? latestResult.rows[0].sequence + 1 : 0;
      const currentState = latestResult.rows.length > 0 ? latestResult.rows[0].next_state : null;

      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        throw new ConcurrencyConflictError(event.auditId, {
          expectedVersion, actualVersion: currentVersion,
        });
      }
      if (expectedState !== undefined && expectedState !== currentState) {
        throw new ConcurrencyConflictError(event.auditId, {
          expectedState, actualState: currentState,
        });
      }

      // Insert event + transition key
      await db.query(SQL.insertEvent, [
        event.eventId, event.auditId, event.tenantId, event.clientId,
        event.sequence, event.priorState, event.nextState,
        event.timestamp, event.actor, event.reason,
        event.executionId, event.codeVersion, event.artifactKey,
        event.transitionIdempotencyKey,
      ]);

      await db.query(SQL.insertTransitionKey, [
        event.auditId, event.transitionIdempotencyKey, event.eventId,
      ]);
    });
  }

  return {
    createAudit, loadEvents, loadByIdempotencyKey,
    loadByTransitionKey, appendEventAtomic, runMigration,
  };
}

export default { createPostgresLifecycleRepository };

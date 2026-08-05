/**
 * Memory Lifecycle Repository
 *
 * Implements the full repository contract with tenant isolation,
 * transition idempotency, and optimistic concurrency enforcement.
 *
 * @module lifecycle/memory-repository
 */

import {
  RepositoryFailureError, ConcurrencyConflictError,
  DuplicateAuditError, AuditNotFoundError, TenantIsolationError,
  TransitionIdempotencyConflictError,
} from "./lifecycle-errors.js";

export function createMemoryLifecycleRepository() {
  /** @type {Map<string, Array<object>>} auditId → events */
  const eventsStore = new Map();

  /** @type {Map<string, { auditId: string, idempotencyKey: string, tenantId: string }>} tenantId:idempotencyKey → record */
  const idempotencyStore = new Map();

  /** @type {Map<string, object>} auditId:transitionIdempotencyKey → event */
  const transitionKeyStore = new Map();

  /** @type {Map<string, { tenantId: string, clientId: string }>} auditId → audit metadata */
  const auditMeta = new Map();

  function idemKey(tenantId, idempotencyKey) {
    return `${tenantId}::${idempotencyKey}`;
  }

  function transKey(auditId, transitionIdempotencyKey) {
    return `${auditId}::${transitionIdempotencyKey}`;
  }

  // ------------------------------------------------------------------
  // createAudit — atomic
  // ------------------------------------------------------------------

  async function createAudit({ auditId, tenantId, clientId, idempotencyKey, event }) {
    // Check tenant-scoped idempotency
    const ik = idemKey(tenantId, idempotencyKey);
    const existing = idempotencyStore.get(ik);
    if (existing) {
      if (existing.auditId === auditId) return; // idempotent
      throw new DuplicateAuditError({ tenantId, idempotencyKey, existingAuditId: existing.auditId, newAuditId: auditId });
    }

    // Check auditId not already claimed
    if (auditMeta.has(auditId)) {
      throw new DuplicateAuditError({ auditId, reason: "auditId already exists with different idempotency key" });
    }

    // Atomic: both or neither
    idempotencyStore.set(ik, { auditId, idempotencyKey, tenantId });
    auditMeta.set(auditId, { tenantId, clientId });
    eventsStore.set(auditId, [event]);
  }

  // ------------------------------------------------------------------
  // loadEvents — tenant scoped
  // ------------------------------------------------------------------

  async function loadEvents(auditId, tenantId) {
    const meta = auditMeta.get(auditId);
    if (!meta) return [];
    if (meta.tenantId !== tenantId) {
      throw new TenantIsolationError({ auditId, tenantId });
    }
    return [...(eventsStore.get(auditId) || [])];
  }

  // ------------------------------------------------------------------
  // loadByIdempotencyKey
  // ------------------------------------------------------------------

  async function loadByIdempotencyKey(tenantId, idempotencyKey) {
    if (!idempotencyKey) return null;
    return idempotencyStore.get(idemKey(tenantId, idempotencyKey)) || null;
  }

  // ------------------------------------------------------------------
  // loadByTransitionKey
  // ------------------------------------------------------------------

  async function loadByTransitionKey(auditId, transitionIdempotencyKey) {
    return transitionKeyStore.get(transKey(auditId, transitionIdempotencyKey)) || null;
  }

  // ------------------------------------------------------------------
  // appendEventAtomic — concurrency enforcement
  // ------------------------------------------------------------------

  async function appendEventAtomic({ event, expectedState, expectedVersion }) {
    const meta = auditMeta.get(event.auditId);
    if (!meta) throw new AuditNotFoundError(event.auditId);

    const events = eventsStore.get(event.auditId) || [];

    // Transaction idempotency
    const tk = transKey(event.auditId, event.transitionIdempotencyKey);
    const existing = transitionKeyStore.get(tk);
    if (existing) {
      if (existing.nextState === event.nextState && existing.sequence === event.sequence) {
        return; // idempotent replay
      }
      throw new TransitionIdempotencyConflictError(event.auditId, event.transitionIdempotencyKey, {
        existingNextState: existing.nextState,
        requestedNextState: event.nextState,
      });
    }

    // Optimistic concurrency
    const currentVersion = events.length;
    const currentState = events.length > 0 ? events[events.length - 1].nextState : null;

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

    if (event.sequence !== currentVersion) {
      throw new RepositoryFailureError(
        `Sequence mismatch: expected ${currentVersion}, got ${event.sequence}`
      );
    }

    // Append event and record transition key
    events.push(event);
    transitionKeyStore.set(tk, event);
  }

  function _clear() {
    eventsStore.clear();
    idempotencyStore.clear();
    transitionKeyStore.clear();
    auditMeta.clear();
  }

  return {
    createAudit, loadEvents, loadByIdempotencyKey,
    loadByTransitionKey, appendEventAtomic, _clear,
  };
}

export default { createMemoryLifecycleRepository };

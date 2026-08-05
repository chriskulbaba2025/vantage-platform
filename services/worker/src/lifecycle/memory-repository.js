/**
 * Memory Lifecycle Repository
 * @module lifecycle/memory-repository
 */

import {
  RepositoryFailureError, ConcurrencyConflictError,
  DuplicateAuditError, AuditNotFoundError, TenantIsolationError,
  TransitionIdempotencyConflictError,
} from "./lifecycle-errors.js";

export function createMemoryLifecycleRepository() {
  const eventsStore = new Map();
  const idempotencyStore = new Map();
  const transitionKeyStore = new Map();
  const auditMeta = new Map();

  function idemKey(tenantId, ik) { return `${tenantId}::${ik}`; }
  function transKey(auditId, tik) { return `${auditId}::${tik}`; }

  // ------------------------------------------------------------------
  // createAudit — concurrent-idempotent
  // ------------------------------------------------------------------

  async function createAudit({ auditId, tenantId, clientId, idempotencyKey, event }) {
    const ik = idemKey(tenantId, idempotencyKey);

    const existing = idempotencyStore.get(ik);
    if (existing) {
      if (existing.auditId === auditId &&
          existing.tenantId === tenantId &&
          existing.clientId === clientId) {
        return true; // idempotent
      }
      throw new DuplicateAuditError({
        tenantId, idempotencyKey,
        existingAuditId: existing.auditId, newAuditId: auditId,
      });
    }

    // Check auditId collision with different idempotency key
    if (auditMeta.has(auditId)) {
      throw new DuplicateAuditError({
        auditId,
        reason: "auditId already exists with different idempotency key",
      });
    }

    // Atomic: all or nothing
    idempotencyStore.set(ik, { auditId, idempotencyKey, tenantId, clientId });
    auditMeta.set(auditId, { tenantId, clientId });
    eventsStore.set(auditId, [event]);
    return false; // newly created
  }

  // ------------------------------------------------------------------
  // loadEvents
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
    return idempotencyStore.get(idemKey(tenantId, idempotencyKey)) || null;
  }

  // ------------------------------------------------------------------
  // loadByTransitionKey — returns event with _fingerprint
  // ------------------------------------------------------------------

  async function loadByTransitionKey(auditId, transitionIdempotencyKey) {
    return transitionKeyStore.get(transKey(auditId, transitionIdempotencyKey)) || null;
  }

  // ------------------------------------------------------------------
  // appendEventAtomic
  // ------------------------------------------------------------------

  async function appendEventAtomic({ event, expectedState, expectedVersion }) {
    const meta = auditMeta.get(event.auditId);
    if (!meta) throw new AuditNotFoundError(event.auditId);

    const events = eventsStore.get(event.auditId) || [];

    // Check transition idempotency
    const tk = transKey(event.auditId, event.transitionIdempotencyKey);
    const existingTk = transitionKeyStore.get(tk);
    if (existingTk) {
      if (existingTk._fingerprint === event._fingerprint &&
          existingTk.nextState === event.nextState) {
        return; // idempotent
      }
      throw new TransitionIdempotencyConflictError(event.auditId, event.transitionIdempotencyKey, {
        existingNextState: existingTk.nextState,
        existingFingerprint: existingTk._fingerprint,
        requestedNextState: event.nextState,
        requestedFingerprint: event._fingerprint,
      });
    }

    // Concurrency check
    const currentVersion = events.length;
    const currentState = events.length > 0 ? events[events.length - 1].nextState : null;

    if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
      throw new ConcurrencyConflictError(event.auditId, { expectedVersion, actualVersion: currentVersion });
    }
    if (expectedState !== undefined && expectedState !== currentState) {
      throw new ConcurrencyConflictError(event.auditId, { expectedState, actualState: currentState });
    }
    if (event.sequence !== currentVersion) {
      throw new RepositoryFailureError(`Sequence mismatch: expected ${currentVersion}, got ${event.sequence}`);
    }

    // Store fingerprint on event before freezing
    const storedEvent = { ...event, _fingerprint: event._fingerprint };
    events.push(Object.freeze(storedEvent));

    // Record transition key with fingerprint
    transitionKeyStore.set(tk, Object.freeze({
      eventId: event.eventId, auditId: event.auditId,
      nextState: event.nextState, sequence: event.sequence,
      tenantId: event.tenantId,
      _fingerprint: event._fingerprint,
    }));
  }

  function _clear() {
    eventsStore.clear(); idempotencyStore.clear();
    transitionKeyStore.clear(); auditMeta.clear();
  }

  return {
    createAudit, loadEvents, loadByIdempotencyKey,
    loadByTransitionKey, appendEventAtomic, _clear,
  };
}

export default { createMemoryLifecycleRepository };

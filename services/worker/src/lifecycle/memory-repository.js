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

  async function createAudit({ auditId, tenantId, clientId, idempotencyKey, event }) {
    const ik = idemKey(tenantId, idempotencyKey);
    const existing = idempotencyStore.get(ik);
    if (existing) {
      if (existing.auditId === auditId && existing.tenantId === tenantId &&
          existing.clientId === clientId) return true;
      throw new DuplicateAuditError({ tenantId, idempotencyKey, existingAuditId: existing.auditId });
    }
    if (auditMeta.has(auditId)) {
      throw new DuplicateAuditError({ auditId, reason: "auditId already exists with different idempotency key" });
    }
    // Store event WITHOUT fingerprint (it's not on the event object)
    const cleanEvent = { ...event };
    delete cleanEvent._fingerprint;
    idempotencyStore.set(ik, { auditId, idempotencyKey, tenantId, clientId });
    auditMeta.set(auditId, { tenantId, clientId });
    eventsStore.set(auditId, [Object.freeze(cleanEvent)]);
    return false;
  }

  async function loadEvents(auditId, tenantId) {
    const meta = auditMeta.get(auditId);
    if (!meta) return [];
    if (meta.tenantId !== tenantId) throw new TenantIsolationError({ auditId, tenantId });
    return [...(eventsStore.get(auditId) || [])];
  }

  async function loadByIdempotencyKey(tenantId, idempotencyKey) {
    return idempotencyStore.get(idemKey(tenantId, idempotencyKey)) || null;
  }

  async function loadByTransitionKey(auditId, transitionIdempotencyKey) {
    return transitionKeyStore.get(transKey(auditId, transitionIdempotencyKey)) || null;
  }

  async function appendEventAtomic({ event, fingerprint, expectedState, expectedVersion }) {
    const meta = auditMeta.get(event.auditId);
    if (!meta) throw new AuditNotFoundError(event.auditId);
    const events = eventsStore.get(event.auditId) || [];

    // Check transition idempotency
    const tk = transKey(event.auditId, event.transitionIdempotencyKey);
    const existingTk = transitionKeyStore.get(tk);
    if (existingTk) {
      if (existingTk._fingerprint === fingerprint &&
          existingTk.nextState === event.nextState) return;
      throw new TransitionIdempotencyConflictError(event.auditId, event.transitionIdempotencyKey, {
        existingNextState: existingTk.nextState,
        existingFingerprint: existingTk._fingerprint,
        requestedFingerprint: fingerprint,
      });
    }

    // Concurrency
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

    // Strip fingerprint from event before storing
    const cleanEvent = { ...event };
    delete cleanEvent._fingerprint;
    events.push(Object.freeze(cleanEvent));

    // Store transition key with fingerprint (NOT on event)
    transitionKeyStore.set(tk, Object.freeze({
      eventId: event.eventId, auditId: event.auditId,
      nextState: event.nextState, sequence: event.sequence,
      tenantId: event.tenantId,
      priorState: event.priorState,
      _fingerprint: fingerprint,
    }));
  }

  function _clear() {
    eventsStore.clear(); idempotencyStore.clear();
    transitionKeyStore.clear(); auditMeta.clear();
  }

  // WP11: tenant-scoped audit history (memory stub)
  function listByTenant(tenantId) {
    const results = [];
    for (const [auditId, meta] of auditMeta) {
      if (meta.tenantId !== tenantId) continue;
      const evts = eventsStore.get(auditId) || [];
      const latest = evts.length > 0 ? evts[evts.length - 1] : null;
      results.push({
        audit_id: auditId,
        client_id: meta.clientId || "",
        business_name: meta.businessName || "",
        target_url: meta.targetUrl || "",
        created_at: meta.createdAt || (evts.length > 0 ? evts[0].timestamp : null),
        latest_state: latest ? latest.nextState : "created",
        updated_at: latest ? latest.timestamp : null,
      });
    }
    // Newest first
    results.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return results;
  }

  return { createAudit, loadEvents, loadByIdempotencyKey, loadByTransitionKey, appendEventAtomic, _clear, listByTenant };
}

export default { createMemoryLifecycleRepository };

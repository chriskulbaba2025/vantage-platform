/**
 * Local-only file-backed lifecycle repository.
 *
 * This is selected only by the explicit PRYSM local persistence composition
 * path. Production continues to use the PostgreSQL repository.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  RepositoryFailureError, ConcurrencyConflictError,
  DuplicateAuditError, AuditNotFoundError, TenantIsolationError,
  TransitionIdempotencyConflictError,
} from "./lifecycle-errors.js";

function idemKey(tenantId, idempotencyKey) {
  return `${tenantId}::${idempotencyKey}`;
}

function transKey(auditId, transitionIdempotencyKey) {
  return `${auditId}::${transitionIdempotencyKey}`;
}

function cleanEvent(event) {
  const result = { ...event };
  delete result._fingerprint;
  return result;
}

function emptyState() {
  return { audits: {}, idempotency: {}, transitions: {}, events: {} };
}

function normalizeState(value) {
  if (!value || typeof value !== "object") return emptyState();
  return {
    audits: value.audits && typeof value.audits === "object" ? value.audits : {},
    idempotency: value.idempotency && typeof value.idempotency === "object" ? value.idempotency : {},
    transitions: value.transitions && typeof value.transitions === "object" ? value.transitions : {},
    events: value.events && typeof value.events === "object" ? value.events : {},
  };
}

export function createFileLifecycleRepository({ filePath }) {
  if (!filePath) throw new Error("file-lifecycle-repository requires filePath");
  const statePath = resolve(filePath);
  let state;
  let loadPromise;
  let writeChain = Promise.resolve();

  async function ensureLoaded() {
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          state = normalizeState(JSON.parse(await readFile(statePath, "utf8")));
        } catch (err) {
          if (err.code !== "ENOENT") throw new RepositoryFailureError(`Failed to load local lifecycle state: ${err.message}`);
          state = emptyState();
          await persist();
        }
      })();
    }
    await loadPromise;
  }

  async function persist() {
    const content = JSON.stringify(state, null, 2);
    writeChain = writeChain.then(async () => {
      await mkdir(dirname(statePath), { recursive: true });
      const tempPath = `${statePath}.tmp.${process.pid}.${Date.now()}`;
      await writeFile(tempPath, content, "utf8");
      await rename(tempPath, statePath);
    });
    return writeChain;
  }

  async function createAudit({ auditId, tenantId, clientId, idempotencyKey, event }) {
    await ensureLoaded();
    const key = idemKey(tenantId, idempotencyKey);
    const existing = state.idempotency[key];
    if (existing) {
      if (existing.auditId === auditId && existing.tenantId === tenantId && existing.clientId === clientId) return true;
      throw new DuplicateAuditError({ tenantId, idempotencyKey, existingAuditId: existing.auditId });
    }
    if (state.audits[auditId]) throw new DuplicateAuditError({ auditId, reason: "auditId already exists with different idempotency key" });

    const eventToStore = cleanEvent(event);
    state.audits[auditId] = {
      tenantId,
      clientId,
      businessName: "",
      targetUrl: "",
      createdAt: event.timestamp || new Date().toISOString(),
    };
    state.idempotency[key] = { auditId, idempotencyKey, tenantId, clientId };
    state.events[auditId] = [eventToStore];
    await persist();
    return false;
  }

  async function loadEvents(auditId, tenantId) {
    await ensureLoaded();
    const meta = state.audits[auditId];
    if (!meta) return [];
    if (meta.tenantId !== tenantId) throw new TenantIsolationError({ auditId, tenantId });
    return (state.events[auditId] || []).map((event) => ({ ...event }));
  }

  async function loadByIdempotencyKey(tenantId, idempotencyKey) {
    await ensureLoaded();
    return state.idempotency[idemKey(tenantId, idempotencyKey)] || null;
  }

  async function loadByTransitionKey(auditId, transitionIdempotencyKey) {
    await ensureLoaded();
    return state.transitions[transKey(auditId, transitionIdempotencyKey)] || null;
  }

  async function appendEventAtomic({ event, fingerprint, expectedState, expectedVersion }) {
    await ensureLoaded();
    const meta = state.audits[event.auditId];
    if (!meta) throw new AuditNotFoundError(event.auditId);
    const events = state.events[event.auditId] || [];
    const transitionKey = transKey(event.auditId, event.transitionIdempotencyKey);
    const existing = state.transitions[transitionKey];
    if (existing) {
      if (existing._fingerprint === fingerprint && existing.nextState === event.nextState) return;
      throw new TransitionIdempotencyConflictError(event.auditId, event.transitionIdempotencyKey, {
        existingNextState: existing.nextState,
        existingFingerprint: existing._fingerprint,
        requestedFingerprint: fingerprint,
      });
    }

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

    state.events[event.auditId] = [...events, cleanEvent(event)];
    state.transitions[transitionKey] = {
      eventId: event.eventId,
      auditId: event.auditId,
      nextState: event.nextState,
      sequence: event.sequence,
      tenantId: event.tenantId,
      priorState: event.priorState,
      _fingerprint: fingerprint,
    };
    await persist();
  }

  async function updateAuditMetadata(auditId, tenantId, { businessName = "", targetUrl = "" } = {}) {
    await ensureLoaded();
    const meta = state.audits[auditId];
    if (!meta) throw new AuditNotFoundError(auditId);
    if (meta.tenantId !== tenantId) throw new TenantIsolationError({ auditId, tenantId });
    meta.businessName = businessName;
    meta.targetUrl = targetUrl;
    await persist();
    return true;
  }

  async function getAuditMetadata(auditId, tenantId) {
    await ensureLoaded();
    const meta = state.audits[auditId];
    if (!meta || meta.tenantId !== tenantId) return null;
    return {
      audit_id: auditId,
      tenant_id: meta.tenantId,
      client_id: meta.clientId,
      business_name: meta.businessName || "",
      target_url: meta.targetUrl || "",
      created_at: meta.createdAt,
    };
  }

  async function listByTenant(tenantId, limit = 50, offset = 0) {
    await ensureLoaded();
    return Object.entries(state.audits)
      .filter(([, meta]) => meta.tenantId === tenantId)
      .sort(([, a], [, b]) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(offset, offset + limit)
      .map(([auditId, meta]) => {
        const events = state.events[auditId] || [];
        const latest = events[events.length - 1];
        return {
          audit_id: auditId,
          client_id: meta.clientId || "",
          business_name: meta.businessName || "",
          target_url: meta.targetUrl || "",
          created_at: meta.createdAt,
          latest_state: latest?.nextState || "created",
          updated_at: latest?.timestamp || meta.createdAt,
        };
      });
  }

  async function findAuditTenant(auditId) {
    await ensureLoaded();
    return state.audits[auditId]?.tenantId || null;
  }

  return {
    createAudit,
    loadEvents,
    loadByIdempotencyKey,
    loadByTransitionKey,
    appendEventAtomic,
    updateAuditMetadata,
    getAuditMetadata,
    listByTenant,
    findAuditTenant,
  };
}

export default { createFileLifecycleRepository };

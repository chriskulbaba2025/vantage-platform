/**
 * Memory Lifecycle Repository — In-Memory Implementation
 *
 * Stores lifecycle events in Maps. Used for unit tests and contract
 * tests.  All operations are synchronous-safe.
 *
 * Implements the full repository contract required by LifecycleService.
 *
 * @module lifecycle/memory-repository
 */

import { RepositoryFailureError } from "./lifecycle-errors.js";

/**
 * Create a memory-backed lifecycle repository.
 *
 * @returns {object} Repository contract.
 */
export function createMemoryLifecycleRepository() {
  /** @type {Map<string, Array<object>>} auditId → events */
  const eventsStore = new Map();

  /** @type {Map<string, { idempotencyKey: string }>} auditId → idem record */
  const idempotencyStore = new Map();

  /**
   * Atomically create a new audit lifecycle.
   */
  async function createAudit({ auditId, tenantId, clientId, idempotencyKey, event }) {
    // Check for duplicate idempotency key
    const existingIdem = idempotencyStore.get(auditId);
    if (existingIdem) {
      if (existingIdem.idempotencyKey !== idempotencyKey) {
        throw new RepositoryFailureError(
          `Duplicate: auditId ${auditId} already exists with different idempotency key`,
        );
      }
      // Already exists with same key — no-op
      return;
    }

    idempotencyStore.set(auditId, { idempotencyKey });
    eventsStore.set(auditId, [event]);
  }

  /**
   * Load all events for an audit in sequence order.
   */
  async function loadEvents(auditId) {
    const events = eventsStore.get(auditId);
    if (!events) return [];
    // Return a defensive copy
    return [...events];
  }

  /**
   * Append a single event to the audit's event log.
   */
  async function appendEvent(event) {
    const events = eventsStore.get(event.auditId);
    if (!events) {
      throw new RepositoryFailureError(`Audit not found: ${event.auditId}`);
    }

    // Verify sequence continuity
    const expectedSeq = events.length;
    if (event.sequence !== expectedSeq) {
      throw new RepositoryFailureError(
        `Sequence mismatch: expected ${expectedSeq}, got ${event.sequence}`,
        { expectedSeq, actualSeq: event.sequence },
      );
    }

    events.push(event);
  }

  /**
   * Load the idempotency record for an audit.
   */
  async function loadIdempotency(auditId) {
    return idempotencyStore.get(auditId) || null;
  }

  /**
   * Clear all data (for test teardown only).
   */
  function _clear() {
    eventsStore.clear();
    idempotencyStore.clear();
  }

  return {
    createAudit,
    loadEvents,
    appendEvent,
    loadIdempotency,
    _clear,
  };
}

export default { createMemoryLifecycleRepository };

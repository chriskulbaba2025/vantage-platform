/**
 * Lifecycle Service — Canonical state-machine boundary.
 *
 * Every audit lifecycle is governed by this service.  It enforces:
 *   - Idempotent audit creation by idempotencyKey
 *   - Transition validation against the authoritative transition map
 *   - Optimistic concurrency (expectedState + expectedVersion)
 *   - Append-only event recording with guaranteed ordering
 *   - Deterministic current-state projection from the event log
 *
 * The service delegates persistence to an injected repository.
 *
 * @module lifecycle/lifecycle-service
 */

import {
  isKnownState,
  isValidTransition,
  LIFECYCLE_STATE,
} from "./state-enum.js";
import {
  createLifecycleEvent,
  createAuditCreatedEvent,
} from "./lifecycle-events.js";
import {
  AuditNotFoundError,
  DuplicateAuditError,
  InvalidTransitionError,
  ConcurrencyConflictError,
  InvalidLifecycleInputError,
} from "./lifecycle-errors.js";

// ---------------------------------------------------------------------------
// LifecycleService
// ---------------------------------------------------------------------------

/**
 * Create a lifecycle service backed by `repository`.
 *
 * The repository must implement:
 *   createAudit({ auditId, tenantId, clientId, idempotencyKey, event }): Promise<void>
 *   loadEvents(auditId): Promise<Array<object>>
 *   appendEvent(event): Promise<void>
 *   loadIdempotency(auditId): Promise<{ idempotencyKey: string }|null>
 *
 * @param {object} repository
 * @returns {object} Lifecycle service.
 */
export function createLifecycleService(repository) {
  // ------------------------------------------------------------------
  // Internal: project current state from event sequence
  // ------------------------------------------------------------------

  /**
   * Project the current lifecycle state from an ordered event list.
   *
   * The current state is the `nextState` of the last event.
   * The version is the event count (number of events).
   *
   * @param {Array<object>} events
   * @returns {{ state: string, version: number, auditId: string, tenantId: string, clientId: string }}
   */
  function projectState(events) {
    if (!events || events.length === 0) return null;
    const last = events[events.length - 1];
    return {
      auditId: last.auditId,
      tenantId: last.tenantId,
      clientId: last.clientId,
      state: last.nextState,
      version: events.length,
      lastEvent: last.eventId,
      lastTransitionedAt: last.timestamp,
    };
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Create a new audit lifecycle.  Idempotent by idempotencyKey.
   *
   * @param {object} input
   * @param {string} input.auditId        - UUID for the audit.
   * @param {string} input.tenantId       - Owning tenant.
   * @param {string} input.clientId       - Owning client.
   * @param {string} input.idempotencyKey - Client-supplied idempotency key.
   * @returns {Promise<object>} Current lifecycle state projection.
   */
  async function create({ auditId, tenantId, clientId, idempotencyKey }) {
    if (!auditId) throw new InvalidLifecycleInputError("auditId is required");
    if (!tenantId) throw new InvalidLifecycleInputError("tenantId is required");
    if (!clientId) throw new InvalidLifecycleInputError("clientId is required");
    if (!idempotencyKey) throw new InvalidLifecycleInputError("idempotencyKey is required");

    // Check for existing idempotency key
    const idemRecord = await repository.loadIdempotency(auditId);
    if (idemRecord) {
      if (idemRecord.idempotencyKey !== idempotencyKey) {
        throw new DuplicateAuditError(auditId, idempotencyKey, {
          existingKey: idemRecord.idempotencyKey,
        });
      }
      // Same key — idempotent return
      const events = await repository.loadEvents(auditId);
      return projectState(events);
    }

    // Create the initial event
    const event = createAuditCreatedEvent({ auditId, tenantId, clientId });

    // Persist atomically
    await repository.createAudit({ auditId, tenantId, clientId, idempotencyKey, event });

    return projectState([event]);
  }

  /**
   * Transition an audit to a new state.
   *
   * Enforces:
   *   - Audit existence
   *   - Transition validity
   *   - expectedState optimistic concurrency
   *   - expectedVersion optimistic concurrency
   *
   * @param {object} input
   * @param {string} input.auditId
   * @param {string} input.toState         - Target state.
   * @param {string} [input.expectedState] - Optional: fail if current state differs.
   * @param {number} [input.expectedVersion] - Optional: fail if version differs.
   * @param {string} [input.actor]
   * @param {string} [input.reason]
   * @param {string} [input.executionId]
   * @param {string} [input.artifactKey]
   * @returns {Promise<object>} Updated lifecycle state projection.
   */
  async function transition({
    auditId,
    toState,
    expectedState,
    expectedVersion,
    actor,
    reason,
    executionId,
    artifactKey,
  }) {
    if (!auditId) throw new InvalidLifecycleInputError("auditId is required");
    if (!isKnownState(toState)) {
      throw new InvalidLifecycleInputError(`Unknown target state: "${toState}"`, { toState });
    }

    // Load current state
    const events = await repository.loadEvents(auditId);
    if (!events || events.length === 0) {
      throw new AuditNotFoundError(auditId);
    }

    const current = projectState(events);

    // ── Optimistic concurrency checks ──────────────────────────────────
    if (expectedState !== undefined && expectedState !== null) {
      if (current.state !== expectedState) {
        throw new ConcurrencyConflictError(auditId, {
          expectedState,
          actualState: current.state,
          expectedVersion,
          actualVersion: current.version,
        });
      }
    }

    if (expectedVersion !== undefined && expectedVersion !== null) {
      if (current.version !== expectedVersion) {
        throw new ConcurrencyConflictError(auditId, {
          expectedVersion,
          actualVersion: current.version,
          expectedState,
          actualState: current.state,
        });
      }
    }

    // ── Transition validation ──────────────────────────────────────────
    if (!isValidTransition(current.state, toState)) {
      throw new InvalidTransitionError(auditId, current.state, toState);
    }

    // ── Create and persist event ───────────────────────────────────────
    const event = createLifecycleEvent({
      auditId: current.auditId,
      tenantId: current.tenantId,
      clientId: current.clientId,
      sequence: current.version, // next sequence
      priorState: current.state,
      nextState: toState,
      actor,
      reason,
      executionId,
      artifactKey,
    });

    await repository.appendEvent(event);

    return projectState([...events, event]);
  }

  /**
   * Return the current lifecycle state projection.
   *
   * @param {string} auditId
   * @returns {Promise<object|null>} State projection, or null if not found.
   */
  async function currentState(auditId) {
    const events = await repository.loadEvents(auditId);
    return projectState(events);
  }

  /**
   * Return the full event history for an audit.
   *
   * @param {string} auditId
   * @returns {Promise<Array<object>>} Chronologically ordered events.
   */
  async function history(auditId) {
    return repository.loadEvents(auditId);
  }

  return {
    create,
    transition,
    currentState,
    history,
  };
}

export default { createLifecycleService };

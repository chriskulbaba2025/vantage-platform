/**
 * Lifecycle Service — Canonical state-machine boundary.
 *
 * Enforces:
 *   - Tenant-scoped idempotent audit creation
 *   - Transition validation against the authoritative transition map
 *   - Transition idempotency (replay protection)
 *   - Optimistic concurrency (expectedState + expectedVersion)
 *   - Tenant isolation on every read and write
 *   - Append-only event recording
 *   - Deterministic current-state projection
 *
 * @module lifecycle/lifecycle-service
 */

import { isKnownState, isValidTransition, LIFECYCLE_STATE } from "./state-enum.js";
import { createLifecycleEvent, createAuditCreatedEvent } from "./lifecycle-events.js";
import {
  AuditNotFoundError, DuplicateAuditError, InvalidTransitionError,
  ConcurrencyConflictError, InvalidLifecycleInputError,
  TransitionIdempotencyConflictError, TenantIsolationError,
} from "./lifecycle-errors.js";

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

function projectState(events) {
  if (!events || events.length === 0) return null;
  const last = events[events.length - 1];
  return {
    auditId: last.auditId, tenantId: last.tenantId, clientId: last.clientId,
    state: last.nextState, version: events.length,
    lastEvent: last.eventId, lastTransitionedAt: last.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {object} repository — see memory/postgres implementations for contract.
 * @returns {object} Lifecycle service.
 */
export function createLifecycleService(repository) {

  // ------------------------------------------------------------------
  // create
  // ------------------------------------------------------------------

  async function create({ auditId, tenantId, clientId, idempotencyKey }) {
    if (!auditId) throw new InvalidLifecycleInputError("auditId is required");
    if (!tenantId) throw new InvalidLifecycleInputError("tenantId is required");
    if (!clientId) throw new InvalidLifecycleInputError("clientId is required");
    if (!idempotencyKey) throw new InvalidLifecycleInputError("idempotencyKey is required");

    const existing = await repository.loadByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) {
      if (existing.auditId === auditId) {
        // Same tenant + same key + same auditId → idempotent
        const events = await repository.loadEvents(auditId, tenantId);
        return projectState(events);
      }
      // Same tenant + same key + different auditId → conflict
      throw new DuplicateAuditError({
        tenantId, idempotencyKey, existingAuditId: existing.auditId, newAuditId: auditId,
      });
    }

    // Also check that no other idempotency key exists for this auditId
    const auditExisting = await repository.loadByIdempotencyKey(tenantId, null);
    // We need a way to check audit-level.  The repository handles this.
    const event = createAuditCreatedEvent({ auditId, tenantId, clientId });
    await repository.createAudit({ auditId, tenantId, clientId, idempotencyKey, event });
    return projectState([event]);
  }

  // ------------------------------------------------------------------
  // transition
  // ------------------------------------------------------------------

  async function transition({
    auditId, tenantId, toState,
    expectedState, expectedVersion,
    transitionIdempotencyKey,
    actor, reason, executionId, artifactKey,
  }) {
    if (!auditId) throw new InvalidLifecycleInputError("auditId is required");
    if (!tenantId) throw new InvalidLifecycleInputError("tenantId is required");
    if (!isKnownState(toState)) throw new InvalidLifecycleInputError(`Unknown target state: "${toState}"`);
    if (!transitionIdempotencyKey) throw new InvalidLifecycleInputError("transitionIdempotencyKey is required");

    // Check transition idempotency first
    const existingTransitionEvent = await repository.loadByTransitionKey(auditId, transitionIdempotencyKey);
    if (existingTransitionEvent) {
      // Replay — verify the existing event matches
      if (existingTransitionEvent.nextState === toState &&
          existingTransitionEvent.tenantId === tenantId) {
        const events = await repository.loadEvents(auditId, tenantId);
        return projectState(events);
      }
      throw new TransitionIdempotencyConflictError(auditId, transitionIdempotencyKey, {
        existingNextState: existingTransitionEvent.nextState,
        requestedToState: toState,
      });
    }

    // Load current state with tenant check
    const events = await repository.loadEvents(auditId, tenantId);
    if (!events || events.length === 0) {
      throw new AuditNotFoundError(auditId);
    }

    const current = projectState(events);

    // Verify tenant ownership
    if (current.tenantId !== tenantId) {
      throw new TenantIsolationError({ auditId, tenantId });
    }

    // Optimistic concurrency: delegate to repository transaction
    const event = createLifecycleEvent({
      auditId: current.auditId, tenantId: current.tenantId, clientId: current.clientId,
      sequence: current.version,
      priorState: current.state, nextState: toState,
      actor, reason, executionId, artifactKey,
      transitionIdempotencyKey,
    });

    // Validate transition
    if (!isValidTransition(current.state, toState)) {
      throw new InvalidTransitionError(auditId, current.state, toState);
    }

    // Atomic append with concurrency guard
    await repository.appendEventAtomic({
      event,
      expectedState: expectedState !== undefined ? expectedState : current.state,
      expectedVersion: expectedVersion !== undefined ? expectedVersion : current.version,
    });

    const updatedEvents = await repository.loadEvents(auditId, tenantId);
    return projectState(updatedEvents);
  }

  // ------------------------------------------------------------------
  // currentState / history
  // ------------------------------------------------------------------

  async function currentState(auditId, tenantId) {
    if (!auditId || !tenantId) throw new InvalidLifecycleInputError("auditId and tenantId are required");
    const events = await repository.loadEvents(auditId, tenantId);
    return projectState(events);
  }

  async function history(auditId, tenantId) {
    if (!auditId || !tenantId) throw new InvalidLifecycleInputError("auditId and tenantId are required");
    return repository.loadEvents(auditId, tenantId);
  }

  return { create, transition, currentState, history };
}

export default { createLifecycleService };

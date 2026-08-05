/**
 * Lifecycle Service — Canonical state-machine boundary.
 * @module lifecycle/lifecycle-service
 */

import { createHash } from "node:crypto";
import { isKnownState, isValidTransition } from "./state-enum.js";
import { createLifecycleEvent, createAuditCreatedEvent } from "./lifecycle-events.js";
import {
  AuditNotFoundError, DuplicateAuditError, InvalidTransitionError,
  ConcurrencyConflictError, InvalidLifecycleInputError,
  TransitionIdempotencyConflictError, TenantIsolationError,
} from "./lifecycle-errors.js";

// ---------------------------------------------------------------------------
// Transition-request fingerprint (includes actual prior state)
// ---------------------------------------------------------------------------

function transitionFingerprint(params) {
  const canonical = {
    auditId:        params.auditId,
    tenantId:       params.tenantId,
    priorState:     params.priorState,
    toState:        params.toState,
    actor:          params.actor || "system",
    reason:         params.reason || "",
    executionId:    params.executionId ?? null,
    artifactKey:    params.artifactKey ?? null,
    expectedState:  params.expectedState ?? null,
    expectedVersion: params.expectedVersion ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// ---------------------------------------------------------------------------
// Projection — produces schema-valid current-state output
// ---------------------------------------------------------------------------

function projectState(events) {
  if (!events || events.length === 0) return null;
  const last = events[events.length - 1];
  const proj = {
    contractVersion: "1.0.0",
    auditId:     last.auditId,
    tenantId:    last.tenantId,
    clientId:    last.clientId,
    state:       last.nextState,
    version:     events.length,
    lastTransitionedAt: last.timestamp,
  };
  if (last.eventId) proj.lastEvent = last.eventId;
  return proj;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLifecycleService(repository) {

  async function create({ auditId, tenantId, clientId, idempotencyKey }) {
    if (!auditId) throw new InvalidLifecycleInputError("auditId is required");
    if (!tenantId) throw new InvalidLifecycleInputError("tenantId is required");
    if (!clientId) throw new InvalidLifecycleInputError("clientId is required");
    if (!idempotencyKey) throw new InvalidLifecycleInputError("idempotencyKey is required");

    const event = createAuditCreatedEvent({ auditId, tenantId, clientId });
    await repository.createAudit({ auditId, tenantId, clientId, idempotencyKey, event });
    const events = await repository.loadEvents(auditId, tenantId);
    return projectState(events);
  }

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

    // STEP 1: Load events with tenant check FIRST
    const events = await repository.loadEvents(auditId, tenantId);
    if (!events || events.length === 0) throw new AuditNotFoundError(auditId);

    const current = projectState(events);
    if (current.tenantId !== tenantId) {
      throw new TenantIsolationError({ auditId, tenantId });
    }

    // STEP 2: Build fingerprint with actual prior/current state
    const fingerprint = transitionFingerprint({
      auditId, tenantId,
      priorState: current.state,
      toState,
      actor, reason, executionId, artifactKey,
      expectedState, expectedVersion,
    });

    // STEP 3: Check transition idempotency BEFORE validation
    const existingTk = await repository.loadByTransitionKey(auditId, transitionIdempotencyKey);
    if (existingTk) {
      // Reconstruct the fingerprint using the ORIGINAL priorState from the
      // stored transition event, not the current projected state.  After a
      // successful transition the current state has changed, so building the
      // fingerprint from current.state would produce a different hash.
      const replayFingerprint = transitionFingerprint({
        auditId, tenantId,
        priorState: existingTk.priorState,
        toState,
        actor, reason, executionId, artifactKey,
        expectedState, expectedVersion,
      });

      if (existingTk._fingerprint === replayFingerprint &&
          existingTk.nextState === toState &&
          existingTk.tenantId === tenantId) {
        return projectState(events);
      }
      throw new TransitionIdempotencyConflictError(auditId, transitionIdempotencyKey, {
        existingNextState: existingTk.nextState,
        existingFingerprint: existingTk._fingerprint,
        requestedToState: toState,
        requestedFingerprint: replayFingerprint,
      });
    }

    // STEP 3.5: Check optimistic-concurrency guards BEFORE validation.
    // A serialized stale request (expectedState/expectedVersion no longer
    // match the current projection) must return ConcurrencyConflictError
    // rather than InvalidTransitionError.
    if (expectedState !== undefined && expectedState !== current.state) {
      throw new ConcurrencyConflictError(auditId, { expectedState, actualState: current.state });
    }
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new ConcurrencyConflictError(auditId, { expectedVersion, actualVersion: current.version });
    }

    // STEP 4: Validate transition
    if (!isValidTransition(current.state, toState)) {
      throw new InvalidTransitionError(auditId, current.state, toState);
    }

    // STEP 5: Build event (no fingerprint on public event)
    const event = createLifecycleEvent({
      auditId: current.auditId, tenantId: current.tenantId, clientId: current.clientId,
      sequence: current.version,
      priorState: current.state, nextState: toState,
      actor, reason, executionId, artifactKey,
      transitionIdempotencyKey,
    });

    // STEP 6: Atomic append with concurrency guard + fingerprint
    await repository.appendEventAtomic({
      event,
      fingerprint,
      expectedState: expectedState !== undefined ? expectedState : current.state,
      expectedVersion: expectedVersion !== undefined ? expectedVersion : current.version,
    });

    const updatedEvents = await repository.loadEvents(auditId, tenantId);
    return projectState(updatedEvents);
  }

  async function currentState(auditId, tenantId) {
    if (!auditId || !tenantId) throw new InvalidLifecycleInputError("auditId and tenantId are required");
    return projectState(await repository.loadEvents(auditId, tenantId));
  }

  async function history(auditId, tenantId) {
    if (!auditId || !tenantId) throw new InvalidLifecycleInputError("auditId and tenantId are required");
    return repository.loadEvents(auditId, tenantId);
  }

  return { create, transition, currentState, history };
}

export default { createLifecycleService };

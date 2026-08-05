/**
 * Lifecycle Events — Append-only event factory and validation.
 *
 * Every state-machine transition produces one immutable lifecycle event.
 * Events are the source of truth; current-state is a deterministic
 * projection of the event sequence.
 *
 * @module lifecycle/lifecycle-events
 */

import { randomUUID } from "node:crypto";
import {
  InvalidLifecycleInputError,
} from "./lifecycle-errors.js";
import { isKnownState } from "./state-enum.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PRYSM_CODE_VERSION = "4.0.0";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a lifecycle event.
 *
 * All fields are validated.  The event is a frozen, plain-data object —
 * no methods, no references.  Suitable for serialization and storage.
 *
 * @param {object} params
 * @param {string} params.auditId       - Owning audit UUID.
 * @param {string} params.tenantId      - Owning tenant.
 * @param {string} params.clientId      - Owning client.
 * @param {number} params.sequence      - Monotonic sequence number within audit.
 * @param {string} params.priorState    - State before transition.
 * @param {string} params.nextState     - State after transition.
 * @param {string} [params.actor]       - "system" or auditor identity.
 * @param {string} [params.reason]      - Human-readable reason.
 * @param {string} [params.executionId] - Optional execution identifier.
 * @param {string} [params.artifactKey] - Optional relevant artifact key.
 * @returns {object} A frozen lifecycle event.
 */
export function createLifecycleEvent({
  auditId,
  tenantId,
  clientId,
  sequence,
  priorState,
  nextState,
  actor = "system",
  reason = "",
  executionId,
  artifactKey,
}) {
  // ── Validation ───────────────────────────────────────────────────────
  if (!auditId || typeof auditId !== "string") {
    throw new InvalidLifecycleInputError("auditId is required and must be a non-empty string", { auditId });
  }
  if (!tenantId || typeof tenantId !== "string") {
    throw new InvalidLifecycleInputError("tenantId is required and must be a non-empty string", { tenantId });
  }
  if (!clientId || typeof clientId !== "string") {
    throw new InvalidLifecycleInputError("clientId is required and must be a non-empty string", { clientId });
  }
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new InvalidLifecycleInputError("sequence must be a non-negative integer", { sequence });
  }
  if (!isKnownState(priorState)) {
    throw new InvalidLifecycleInputError(`priorState is not a known lifecycle state: "${priorState}"`, { priorState });
  }
  if (!isKnownState(nextState)) {
    throw new InvalidLifecycleInputError(`nextState is not a known lifecycle state: "${nextState}"`, { nextState });
  }

  return Object.freeze({
    eventId: randomUUID(),
    auditId,
    tenantId,
    clientId,
    sequence,
    priorState,
    nextState,
    timestamp: new Date().toISOString(),
    actor: actor || "system",
    reason: reason || "",
    executionId: executionId || null,
    codeVersion: PRYSM_CODE_VERSION,
    artifactKey: artifactKey || null,
  });
}

/**
 * Create the initial "audit created" event (sequence 0).
 *
 * The priorState for the creation event is the same as nextState
 * (the audit starts at CREATED).
 *
 * @param {object} params
 * @param {string} params.auditId
 * @param {string} params.tenantId
 * @param {string} params.clientId
 * @returns {object}
 */
export function createAuditCreatedEvent({ auditId, tenantId, clientId }) {
  return createLifecycleEvent({
    auditId,
    tenantId,
    clientId,
    sequence: 0,
    priorState: "created",
    nextState: "created",
    actor: "system",
    reason: "Audit created",
  });
}

export default {
  createLifecycleEvent,
  createAuditCreatedEvent,
  PRYSM_CODE_VERSION,
};

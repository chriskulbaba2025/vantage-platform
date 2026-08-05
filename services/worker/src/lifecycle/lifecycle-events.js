/**
 * Lifecycle Events — Append-only event factory.
 * @module lifecycle/lifecycle-events
 */

import { randomUUID } from "node:crypto";
import { InvalidLifecycleInputError } from "./lifecycle-errors.js";
import { isKnownState } from "./state-enum.js";

export const PRYSM_CODE_VERSION = "4.0.0";

/**
 * Create a lifecycle event.
 *
 * Absent optional fields (executionId, artifactKey, transitionIdempotencyKey)
 * are omitted from the returned object rather than set to null.
 *
 * No internal persistence-only metadata (e.g. request fingerprints) is
 * exposed on the public event.
 *
 * @param {object} params
 * @returns {object} A frozen lifecycle event.
 */
export function createLifecycleEvent({
  auditId, tenantId, clientId, sequence,
  priorState, nextState,
  actor = "system", reason = "",
  executionId,
  artifactKey,
  transitionIdempotencyKey,
}) {
  if (!auditId || typeof auditId !== "string") throw new InvalidLifecycleInputError("auditId is required");
  if (!tenantId || typeof tenantId !== "string") throw new InvalidLifecycleInputError("tenantId is required");
  if (!clientId || typeof clientId !== "string") throw new InvalidLifecycleInputError("clientId is required");
  if (!Number.isInteger(sequence) || sequence < 0) throw new InvalidLifecycleInputError("sequence must be non-negative integer");
  if (!isKnownState(priorState)) throw new InvalidLifecycleInputError(`Unknown priorState: "${priorState}"`);
  if (!isKnownState(nextState)) throw new InvalidLifecycleInputError(`Unknown nextState: "${nextState}"`);

  const event = {
    contractVersion: "1.0.0",
    eventId: randomUUID(),
    auditId, tenantId, clientId, sequence,
    priorState, nextState,
    timestamp: new Date().toISOString(),
    actor: actor || "system",
    reason: reason || "",
    codeVersion: PRYSM_CODE_VERSION,
  };

  // Omit absent optional fields entirely
  if (executionId != null) event.executionId = executionId;
  if (artifactKey != null) event.artifactKey = artifactKey;
  if (transitionIdempotencyKey != null) event.transitionIdempotencyKey = transitionIdempotencyKey;

  return Object.freeze(event);
}

/**
 * Create the initial "audit created" event (sequence 0).
 */
export function createAuditCreatedEvent({ auditId, tenantId, clientId }) {
  return createLifecycleEvent({
    auditId, tenantId, clientId,
    sequence: 0,
    priorState: "created",
    nextState: "created",
    actor: "system",
    reason: "Audit created",
  });
}

export default { createLifecycleEvent, createAuditCreatedEvent, PRYSM_CODE_VERSION };

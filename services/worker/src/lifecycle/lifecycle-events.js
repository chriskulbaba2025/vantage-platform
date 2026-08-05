/**
 * Lifecycle Events — Append-only event factory and validation.
 * @module lifecycle/lifecycle-events
 */

import { randomUUID } from "node:crypto";
import { InvalidLifecycleInputError } from "./lifecycle-errors.js";
import { isKnownState } from "./state-enum.js";

export const PRYSM_CODE_VERSION = "4.0.0";

/**
 * Create a lifecycle event.
 *
 * @param {object} params
 * @param {string} params.auditId
 * @param {string} params.tenantId
 * @param {string} params.clientId
 * @param {number} params.sequence
 * @param {string} params.priorState
 * @param {string} params.nextState
 * @param {string} [params.actor="system"]
 * @param {string} [params.reason=""]
 * @param {string} [params.executionId]
 * @param {string} [params.artifactKey]
 * @param {string} [params.transitionIdempotencyKey] - Required for all non-creation events.
 * @returns {object} A frozen lifecycle event.
 */
export function createLifecycleEvent({
  auditId, tenantId, clientId, sequence,
  priorState, nextState,
  actor = "system", reason = "",
  executionId, artifactKey,
  transitionIdempotencyKey,
}) {
  if (!auditId || typeof auditId !== "string") throw new InvalidLifecycleInputError("auditId is required");
  if (!tenantId || typeof tenantId !== "string") throw new InvalidLifecycleInputError("tenantId is required");
  if (!clientId || typeof clientId !== "string") throw new InvalidLifecycleInputError("clientId is required");
  if (!Number.isInteger(sequence) || sequence < 0) throw new InvalidLifecycleInputError("sequence must be non-negative integer");
  if (!isKnownState(priorState)) throw new InvalidLifecycleInputError(`Unknown priorState: "${priorState}"`);
  if (!isKnownState(nextState)) throw new InvalidLifecycleInputError(`Unknown nextState: "${nextState}"`);

  return Object.freeze({
    eventId: randomUUID(),
    auditId, tenantId, clientId, sequence,
    priorState, nextState,
    timestamp: new Date().toISOString(),
    actor: actor || "system",
    reason: reason || "",
    executionId: executionId || null,
    codeVersion: PRYSM_CODE_VERSION,
    artifactKey: artifactKey || null,
    transitionIdempotencyKey: transitionIdempotencyKey || null,
  });
}

/**
 * Create the initial "audit created" event (sequence 0).
 * Creation events do not have a transitionIdempotencyKey.
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

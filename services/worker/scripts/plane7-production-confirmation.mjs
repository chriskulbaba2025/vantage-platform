/**
 * PRYSM Plane 7 production-confirmation harness contract.
 *
 * This module is deliberately fail-closed. It records the path a future
 * confirmation will exercise, but does not create an audit by itself.
 * Network execution must be supplied by a separately authorized caller after
 * assertProductionConfirmationPreflight() passes.
 */

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

export const PRODUCTION_PATHS = Object.freeze({
  BROWSER_PRINCIPAL_PATH: "BROWSER_PRINCIPAL_PATH",
  INTERNAL_SECRET_PATH: "INTERNAL_SECRET_PATH",
});

export const REQUIRED_AUTH_MODES = Object.freeze({
  SESSION_PRINCIPAL: "SESSION_PRINCIPAL",
  INTERNAL_SECRET: "INTERNAL_SECRET",
});

const SAFE_HEADER_NAMES = Object.freeze([
  "x-prysm-principal",
  "x-prysm-tenant",
  "x-vantage-secret",
]);

const SECRET_HEADER_NAMES = new Set(["x-vantage-secret", "x-prysm-principal"]);

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function safeHeaderPresence(headers = {}) {
  const source = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value]),
  );
  return Object.fromEntries(SAFE_HEADER_NAMES.map((name) => [name, Boolean(source[name])]));
}

function assertNoRawSecrets(value, path = "evidence") {
  if (typeof value === "string") {
    if (/bearer\s|sk-[a-z0-9]|-----begin|x-vantage-secret\s*:/i.test(value)) {
      throw new Error(`raw secret/token-like value is not permitted in ${path}`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (!/safeHeaderPresence(?:\.|$)/i.test(path) && /token|secret|authorization|cookie/i.test(key)) {
      throw new Error(`secret-bearing field ${path}.${key} is not permitted`);
    }
    assertNoRawSecrets(child, `${path}.${key}`);
  }
}

export function computeTimeoutBudget({ sourcePolicies = [], retryAttempts = 1, observationStartedAt, now }) {
  if (!Array.isArray(sourcePolicies) || sourcePolicies.length === 0) {
    throw new Error("at least one configured source policy is required");
  }
  const policies = sourcePolicies.map((policy, index) => {
    const timeoutMs = Number(policy.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`sourcePolicies[${index}].timeoutMs is invalid`);
    const attempts = Number(policy.maxAttempts ?? retryAttempts);
    if (!Number.isInteger(attempts) || attempts < 1) throw new Error(`sourcePolicies[${index}].maxAttempts is invalid`);
    return Object.freeze({ source: nonEmpty(String(policy.source || ""), `sourcePolicies[${index}].source`), timeoutMs, maxAttempts: attempts });
  });
  const thresholdMs = policies.reduce((sum, policy) => sum + policy.timeoutMs * policy.maxAttempts, 0);
  const started = Date.parse(nonEmpty(observationStartedAt, "observationStartedAt"));
  if (!Number.isFinite(started)) throw new Error("observationStartedAt must be an ISO timestamp");
  const current = now === undefined ? Date.now() : Number(now);
  if (!Number.isFinite(current)) throw new Error("now must be a timestamp");
  return Object.freeze({
    policies,
    thresholdMs,
    observationStartedAt: new Date(started).toISOString(),
    elapsedMs: Math.max(0, current - started),
  });
}

export function classifyCollectionObservation({ currentState, elapsedMs, timeoutBudgetMs, directTerminationEvidence = false, terminalFailureEvidence = false }) {
  const elapsed = Number(elapsedMs);
  const budget = Number(timeoutBudgetMs);
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error("elapsedMs must be non-negative");
  if (!Number.isFinite(budget) || budget <= 0) throw new Error("timeoutBudgetMs must be positive");
  const directStop = Boolean(directTerminationEvidence || terminalFailureEvidence);
  const thresholdReached = elapsed >= budget;
  const stalled = directStop || (currentState === "collecting" && thresholdReached);
  return Object.freeze({
    currentState: currentState || null,
    elapsedMs: elapsed,
    governedTimeCeilingMs: budget,
    stallThresholdReached: thresholdReached ? "YES" : "NO",
    classification: stalled ? "STALLED" : "NOT_STALLED",
    basis: directStop ? "DIRECT_TERMINATION_OR_FAILURE" : thresholdReached ? "GOVERNED_TIMEOUT_EXCEEDED" : "WITHIN_GOVERNED_WINDOW",
  });
}

export function assertProductionConfirmationPreflight({
  candidateSha,
  expectedCandidateSha,
  intendedPath,
  actualPath,
  entryPoint,
  authMode,
  expectedTenantResolutionMechanism,
  productionPathEquivalence,
  headers,
}) {
  nonEmpty(candidateSha, "candidateSha");
  if (expectedCandidateSha && candidateSha !== expectedCandidateSha) throw new Error("candidate identity mismatch");
  if (!Object.values(PRODUCTION_PATHS).includes(intendedPath)) throw new Error("intended production path is unresolved");
  if (!Object.values(PRODUCTION_PATHS).includes(actualPath)) throw new Error("actual production path is unresolved");
  if (intendedPath !== actualPath) throw new Error("actual path differs from intended path");
  if (!entryPoint || typeof entryPoint !== "object") throw new Error("actual entry point is unresolved");
  nonEmpty(entryPoint.url, "entryPoint.url");
  nonEmpty(entryPoint.method, "entryPoint.method");
  nonEmpty(entryPoint.route, "entryPoint.route");
  nonEmpty(entryPoint.environment, "entryPoint.environment");
  if (!Object.values(REQUIRED_AUTH_MODES).includes(authMode)) throw new Error("authentication mode is unresolved");
  nonEmpty(expectedTenantResolutionMechanism, "expectedTenantResolutionMechanism");
  if (productionPathEquivalence !== "PASS") throw new Error("production-path equivalence is not proven");
  const presence = safeHeaderPresence(headers);
  if (authMode === REQUIRED_AUTH_MODES.SESSION_PRINCIPAL && !presence["x-prysm-principal"]) {
    throw new Error("session/principal path requires x-prysm-principal evidence");
  }
  if (authMode === REQUIRED_AUTH_MODES.INTERNAL_SECRET && !presence["x-vantage-secret"]) {
    throw new Error("internal-secret path requires x-vantage-secret evidence");
  }
  if (intendedPath === PRODUCTION_PATHS.BROWSER_PRINCIPAL_PATH && authMode !== REQUIRED_AUTH_MODES.SESSION_PRINCIPAL) {
    throw new Error("browser path cannot execute as internal secret auth");
  }
  if (intendedPath === PRODUCTION_PATHS.INTERNAL_SECRET_PATH && authMode !== REQUIRED_AUTH_MODES.INTERNAL_SECRET) {
    throw new Error("internal path requires internal secret auth");
  }
  return Object.freeze({ safeHeaderPresence: presence });
}

export function buildImmutableEvidenceRecord({
  candidateSha,
  deploymentIdentities,
  timestamp,
  intendedPath,
  actualPath,
  authMode,
  headers,
  principalPresent,
  principalSubject,
  requestedTenant,
  resolvedTenant,
  clientId,
  auditId,
  executionId,
  lifecycleObservations,
  timeoutBudget,
  terminalResult,
  artifactReferences,
}) {
  const record = {
    schemaVersion: "plane7-production-confirmation-evidence.v1",
    candidateSha: nonEmpty(candidateSha, "candidateSha"),
    deploymentIdentities: deploymentIdentities || {},
    timestamp: nonEmpty(timestamp, "timestamp"),
    intendedPath: nonEmpty(intendedPath, "intendedPath"),
    actualPath: nonEmpty(actualPath, "actualPath"),
    authMode: nonEmpty(authMode, "authMode"),
    safeHeaderPresence: safeHeaderPresence(headers),
    principalPresent: Boolean(principalPresent),
    principalSubject: principalSubject || null,
    requestedTenant: requestedTenant || null,
    resolvedTenant: resolvedTenant || null,
    clientId: clientId || null,
    auditId: auditId || null,
    executionId: executionId || null,
    lifecycleObservations: Array.isArray(lifecycleObservations) ? lifecycleObservations : [],
    timeoutBudget: timeoutBudget || null,
    terminalResult: terminalResult || null,
    artifactReferences: Array.isArray(artifactReferences) ? artifactReferences : [],
  };
  assertNoRawSecrets(record);
  const canonical = JSON.stringify(record);
  return Object.freeze({ ...record, evidenceSha256: createHash("sha256").update(canonical).digest("hex") });
}

export function assertEvidenceComplete(record) {
  if (!record || record.schemaVersion !== "plane7-production-confirmation-evidence.v1") throw new Error("invalid Plane 7 evidence record");
  if (!record.auditId || !record.executionId) throw new Error("immutable audit/execution identity evidence is required");
  if (!Array.isArray(record.lifecycleObservations) || record.lifecycleObservations.length === 0) throw new Error("immutable lifecycle evidence is required");
  if (!record.terminalResult || typeof record.terminalResult !== "object") throw new Error("immutable terminal result evidence is required");
  if (!Array.isArray(record.artifactReferences) || !record.artifactReferences.some((ref) => String(ref).endsWith("audit-request.json"))) {
    throw new Error("immutable persisted AuditRequest evidence is required");
  }
  return record;
}

export async function writeImmutableEvidenceRecord(filePath, record) {
  assertEvidenceComplete(record);
  assertNoRawSecrets(record);
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return filePath;
}

export { SAFE_HEADER_NAMES, safeHeaderPresence };

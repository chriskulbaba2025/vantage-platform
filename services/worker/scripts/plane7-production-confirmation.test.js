import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_PATHS,
  REQUIRED_AUTH_MODES,
  assertEvidenceComplete,
  assertProductionConfirmationPreflight,
  buildImmutableEvidenceRecord,
  classifyCollectionObservation,
  computeTimeoutBudget,
} from "./plane7-production-confirmation.mjs";

const SHA = "e82f7f1d8ce4ef082a7fc22a72ade8d5755e1065";
const entryPoint = { url: "https://example.test/api/audits", method: "POST", route: "/api/audits", environment: "staging" };

function browserPreflight(overrides = {}) {
  return {
    candidateSha: SHA,
    expectedCandidateSha: SHA,
    intendedPath: PRODUCTION_PATHS.BROWSER_PRINCIPAL_PATH,
    actualPath: PRODUCTION_PATHS.BROWSER_PRINCIPAL_PATH,
    entryPoint,
    authMode: REQUIRED_AUTH_MODES.SESSION_PRINCIPAL,
    expectedTenantResolutionMechanism: "membership-resolved tenant",
    productionPathEquivalence: "PASS",
    headers: { "x-prysm-principal": "present", "x-prysm-tenant": "present" },
    ...overrides,
  };
}

test("PLANE7-A/B: browser confirmation cannot silently execute as secret-only auth", () => {
  assert.throws(() => assertProductionConfirmationPreflight(browserPreflight({
    actualPath: PRODUCTION_PATHS.INTERNAL_SECRET_PATH,
    authMode: REQUIRED_AUTH_MODES.INTERNAL_SECRET,
    headers: { "x-vantage-secret": "present" },
  })), /actual path differs|browser path/);
  assert.throws(() => assertProductionConfirmationPreflight(browserPreflight({
    actualPath: PRODUCTION_PATHS.BROWSER_PRINCIPAL_PATH,
    authMode: REQUIRED_AUTH_MODES.INTERNAL_SECRET,
    headers: { "x-vantage-secret": "present" },
  })), /browser path/);
});

test("PLANE7-C: missing auth-mode evidence blocks preflight", () => {
  assert.throws(() => assertProductionConfirmationPreflight(browserPreflight({ authMode: undefined })), /authentication mode/);
});

test("PLANE7-D/E/H: immutable record requires safe evidence and never stores raw secrets", () => {
  const record = buildImmutableEvidenceRecord({
    candidateSha: SHA,
    deploymentIdentities: { githubSha: SHA, railwaySha: "railway-revision" },
    timestamp: "2026-09-13T17:00:00.000Z",
    intendedPath: PRODUCTION_PATHS.BROWSER_PRINCIPAL_PATH,
    actualPath: PRODUCTION_PATHS.BROWSER_PRINCIPAL_PATH,
    authMode: REQUIRED_AUTH_MODES.SESSION_PRINCIPAL,
    headers: { "x-prysm-principal": "present", "x-prysm-tenant": "present", "x-vantage-secret": "present" },
    principalPresent: true,
    principalSubject: "cognito-sub-safe",
    requestedTenant: "omnipressence",
    resolvedTenant: "omnipressence",
    clientId: "client-safe",
    auditId: "audit-safe",
    executionId: "execution-safe",
    lifecycleObservations: [{ state: "collecting", version: 3, observedAt: "2026-09-13T17:05:00.000Z" }],
    timeoutBudget: { thresholdMs: 1800000, elapsedMs: 900000 },
    terminalResult: { state: "collecting", classification: "NOT_STALLED" },
    artifactReferences: ["tenants/omnipressence/clients/client-safe/audits/audit-safe/canonical/audit-request.json"],
  });
  assert.equal(record.safeHeaderPresence["x-vantage-secret"], true);
  assert.equal(record.auditId, "audit-safe");
  assert.match(record.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => buildImmutableEvidenceRecord({ candidateSha: SHA, timestamp: "now", intendedPath: "x", actualPath: "x", authMode: "x", deploymentIdentities: { token: "raw" } }), /secret-bearing field/);
  assert.throws(() => assertEvidenceComplete({ schemaVersion: "plane7-production-confirmation-evidence.v1" }), /audit\/execution identity/);
  assert.throws(() => assertEvidenceComplete({ ...record, artifactReferences: [] }), /AuditRequest evidence/);
});

test("PLANE7-F/G: fifteen minutes within a greater governed budget is not STALLED", () => {
  const budget = computeTimeoutBudget({
    sourcePolicies: [{ source: "dataforseo-onpage", timeoutMs: 1800000, maxAttempts: 1 }],
    observationStartedAt: "2026-09-13T17:00:00.000Z",
    now: Date.parse("2026-09-13T17:15:00.000Z"),
  });
  assert.equal(budget.thresholdMs, 1800000);
  const result = classifyCollectionObservation({ currentState: "collecting", elapsedMs: 900000, timeoutBudgetMs: budget.thresholdMs });
  assert.equal(result.classification, "NOT_STALLED");
  assert.equal(result.stallThresholdReached, "NO");
  assert.equal(classifyCollectionObservation({ currentState: "collecting", elapsedMs: 1800000, timeoutBudgetMs: budget.thresholdMs }).classification, "STALLED");
  assert.equal(classifyCollectionObservation({ currentState: "collecting", elapsedMs: 1, timeoutBudgetMs: budget.thresholdMs, directTerminationEvidence: true }).classification, "STALLED");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createFsArtifactStore } from "../storage/fs-artifact-store.js";
import {
  createNarrativeV2LiveBinding,
} from "./live-binding.js";

const AUDIT_ID = "88888888-8888-4888-8888-888888888888";
const SCOPE = {
  tenantId: "transport-test-tenant",
  clientId: "transport-test-client",
  auditId: AUDIT_ID,
  executionId: "transport-test-execution",
};

function env() {
  return {
    PRYSM_NARRATIVE_V2_ENABLED: "true",
    PRYSM_LLM_MODE: "live",
    PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL: "https://llm.example.test/v1/chat/completions",
    PRYSM_NARRATIVE_V2_API_KEY: "secret-that-must-not-persist",
    PRYSM_NARRATIVE_V2_WRITER_MODEL: "writer-test",
    PRYSM_NARRATIVE_V2_JUDGE_MODEL: "judge-test",
    PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS: "500000",
    PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_NARRATIVE_V2_TIMEOUT_MS: "5000",
    PRYSM_LLM_SOFT_BUDGET_USD: "0.50",
    PRYSM_LLM_HARD_BUDGET_USD: "2.00",
    PRYSM_LLM_DAILY_HARD_BUDGET_USD: "10.00",
    PRYSM_LLM_DAILY_SPEND_USD: "0",
    PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON: JSON.stringify({
      "writer-test": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
      "judge-test": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
    }),
  };
}

function input() {
  return {
    contractVersion: "1.0.0",
    writerInputVersion: "1.0.0",
    auditId: AUDIT_ID,
    scoreGovernance: { sourceDependencies: { offsite: "UNAVAILABLE" } },
    referenceIndex: { "finding:F-001": { kind: "finding", path: "findings.F-001" } },
  };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function atom(text, statementClass = "INTERPRETATION") {
  return { text, statementClass, evidenceRefs: ["finding:F-001"] };
}

function validWriterOutput(passNumber = 1) {
  const interpret = (label) => atom(`${label} is tied to the governed finding.`);
  const opportunity = (label) => atom(label, "OPPORTUNITY");
  const standard = (headline, fields) => ({ headline, ...fields });
  return {
    contractVersion: "1.0.0", writerOutputVersion: "1.0.0", auditId: AUDIT_ID,
    passNumber, modelId: "writer-test", promptVersion: "2.3.0", generatedAt: "2026-09-09T00:00:00.000Z",
    executiveConclusion: { headline: "A governed conclusion", narrative: interpret("Conclusion") },
    strengths: [{ itemId: "STR-01", title: "Strength", narrative: interpret("Strength") }],
    rootCause: { headline: "A governed root cause", narrative: interpret("Root cause"), businessConsequences: [{ area: "Conversion", narrative: interpret("Consequence") }] },
    conversion: standard("Conversion", { whatWorks: interpret("Works"), constraints: interpret("Constraint"), businessMeaning: interpret("Meaning"), priority: interpret("Priority") }),
    content: standard("Content", { currentStrength: interpret("Strength"), coverageAssessment: interpret("Coverage"), qualityAssessment: interpret("Quality"), topicalArchitecture: interpret("Architecture"), importantGaps: interpret("Gaps"), businessMeaning: interpret("Meaning") }),
    funnelOpportunities: { awareness: [{ itemId: "FUN-01", concept: opportunity("A governed concept"), userNeed: opportunity("A governed need"), rationale: opportunity("A governed rationale"), businessObjective: opportunity("A governed objective"), nextAction: opportunity("A governed next action") }], consideration: [], decision: [] },
    seoSerp: standard("SEO", { whatWorks: interpret("Works"), constraints: interpret("Constraint"), searchImplication: interpret("Implication"), priority: interpret("Priority") }),
    aiSearch: standard("AI", { answerability: interpret("Answerability"), entityStrength: interpret("Entity"), citationReadiness: interpret("Citation"), constraints: interpret("Constraint"), opportunity: opportunity("A governed opportunity") }),
    eeatTrust: standard("Trust", { experience: interpret("Experience"), expertise: interpret("Expertise"), authority: interpret("Authority"), trust: interpret("Trust"), proofGaps: interpret("Gaps"), businessMeaning: interpret("Meaning") }),
    technical: standard("Technical", { assessment: interpret("Assessment"), materialIssues: interpret("Issues"), businessMeaning: interpret("Meaning") }),
    performanceUx: standard("Performance", { assessment: interpret("Assessment"), userImpact: interpret("Impact"), conversionImpact: interpret("Conversion impact") }),
    competitors: standard("Competitors", { advantages: interpret("Advantages"), disadvantages: interpret("Disadvantages"), marketInterpretation: interpret("Interpretation"), differentiatorToProtect: interpret("Differentiator") }),
    limitations: [],
    actionPlan: [{ actionId: "ACT-01", priority: 1, title: "Governed action", action: opportunity("A governed action"), whyNow: opportunity("A governed reason"), expectedBusinessEffect: opportunity("A bounded effect"), effort: "M", verification: opportunity("A governed verification") }],
    executiveDecision: { preserve: interpret("Preserve"), change: interpret("Change"), doNext: opportunity("A governed next step") },
  };
}

function responseFor(payload) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }) };
}

async function putJson(store, artifactName, value) {
  await store.put({
    bytes: Buffer.from(JSON.stringify(value), "utf8"),
    contentType: "application/json",
    scope: { ...SCOPE, category: "report-v2", artifactName },
  });
}

function livePrefix() {
  return `tenants/${SCOPE.tenantId}/clients/${SCOPE.clientId}/audits/${SCOPE.auditId}/report-v2/narrative-v2/live-usage`;
}

test("TRANSPORT-RECOVERY-01: uncertain fetch preserves sanitized transport outcome and native cause", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "prysm-transport-recovery-"));
  const artifactStore = createFsArtifactStore({ baseDir });
  const cause = Object.assign(new Error("socket reset with secret-that-must-not-persist"), {
    code: "ECONNRESET",
    syscall: "write",
    hostname: "llm.example.test",
    port: 443,
  });
  const binding = createNarrativeV2LiveBinding({
    env: env(),
    artifactStore,
    requireDurableStore: true,
    clock: { now: () => "2026-09-09T00:00:00.000Z" },
    fetchImpl: async () => { throw cause; },
  });
  binding.registerAuditScope(SCOPE);
  await assert.rejects(
    () => binding.writerExecutor({ prompt: "governed prompt", passNumber: 1, writerInput: input() }),
    (error) => error.cause === cause && /fetch failed/.test(error.message),
  );
  const prefix = `tenants/${SCOPE.tenantId}/clients/${SCOPE.clientId}/audits/${SCOPE.auditId}/report-v2/narrative-v2/live-usage`;
  const record = JSON.parse(await readFile(join(baseDir, `${prefix}/call-01-transport.json`), "utf8"));
  assert.equal(record.state, "TRANSPORT_OUTCOME_UNCERTAIN");
  assert.equal(record.causeCode, "ECONNRESET");
  assert.equal(record.port, 443);
  assert.equal(JSON.stringify(record).includes("secret-that-must-not-persist"), false);
});

test("TRANSPORT-RECOVERY-02: memory-only live release fails closed before paid invocation", () => {
  assert.throws(
    () => createNarrativeV2LiveBinding({
      env: env(),
      artifactStore: createMemoryArtifactStore(),
      requireDurableStore: true,
      fetchImpl: async () => { throw new Error("must not call"); },
    }),
    /durable artifact store/i,
  );
});

test("TRANSPORT-RECOVERY-03: explicit same-pass recovery authorization is exposed", () => {
  const binding = createNarrativeV2LiveBinding({
    env: env(),
    artifactStore: createFsArtifactStore({ baseDir: "C:/tmp/prysm-transport-recovery-placeholder" }),
    requireDurableStore: true,
  });
  assert.equal(typeof binding.authorizeTransportRecovery, "function");
});

test("TRANSPORT-RECOVERY-04: concrete DNS failure is pre-transmission and never retries", async () => {
  const artifactStore = createMemoryArtifactStore();
  let calls = 0;
  const binding = createNarrativeV2LiveBinding({
    env: env(), artifactStore,
    clock: { now: () => "2026-09-09T00:00:00.000Z" },
    fetchImpl: async () => {
      calls += 1;
      throw Object.assign(new Error("dns detail"), { code: "ENOTFOUND", syscall: "getaddrinfo", hostname: "llm.example.test" });
    },
  });
  binding.registerAuditScope(SCOPE);
  const request = { prompt: "dns prompt", passNumber: 1, writerInput: input() };
  await assert.rejects(() => binding.writerExecutor(request), /fetch failed/);
  await assert.rejects(() => binding.writerExecutor(request), /already reserved/);
  assert.equal(calls, 1);
  const record = JSON.parse(Buffer.from(await artifactStore.get(`${livePrefix()}/call-01-transport.json`)).toString("utf8"));
  assert.equal(record.state, "TRANSPORT_FAILED_PRE_TRANSMISSION");
  assert.equal(record.causeCode, "ENOTFOUND");
});

test("TRANSPORT-RECOVERY-05: timeout remains uncertain and is persisted without a retry", async () => {
  const artifactStore = createMemoryArtifactStore();
  const binding = createNarrativeV2LiveBinding({
    env: env(), artifactStore,
    fetchImpl: async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); },
  });
  binding.registerAuditScope(SCOPE);
  await assert.rejects(() => binding.writerExecutor({ prompt: "timeout prompt", passNumber: 1, writerInput: input() }), /timeout/);
  const record = JSON.parse(Buffer.from(await artifactStore.get(`${livePrefix()}/call-01-transport.json`)).toString("utf8"));
  assert.equal(record.state, "TRANSPORT_OUTCOME_UNCERTAIN");
  assert.equal(record.timeoutClassification, "ABORT_TIMEOUT");
});

test("TRANSPORT-RECOVERY-06: returned HTTP failure persists response and is not transport uncertainty", async () => {
  const artifactStore = createMemoryArtifactStore();
  const binding = createNarrativeV2LiveBinding({
    env: env(), artifactStore,
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: "server" }) }),
  });
  binding.registerAuditScope(SCOPE);
  await assert.rejects(() => binding.writerExecutor({ prompt: "http prompt", passNumber: 1, writerInput: input() }), /HTTP 500/);
  const result = JSON.parse(Buffer.from(await artifactStore.get(`${livePrefix()}/call-01-result.json`)).toString("utf8"));
  assert.equal(result.state, "RETURNED_PROVIDER_FAILURE");
  assert.equal(result.responseStatus, 500);
  assert.deepEqual(JSON.parse(Buffer.from(await artifactStore.get(`${livePrefix()}/call-01-response.json`)).toString("utf8")), { error: "server" });
});

test("TRANSPORT-RECOVERY-07: malformed returned JSON is retained as post-response local failure", async () => {
  const artifactStore = createMemoryArtifactStore();
  const binding = createNarrativeV2LiveBinding({
    env: env(), artifactStore,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{ malformed" }),
  });
  binding.registerAuditScope(SCOPE);
  await assert.rejects(() => binding.writerExecutor({ prompt: "malformed prompt", passNumber: 1, writerInput: input() }), /not JSON/);
  const result = JSON.parse(Buffer.from(await artifactStore.get(`${livePrefix()}/call-01-result.json`)).toString("utf8"));
  assert.equal(result.state, "POST_RESPONSE_LOCAL_FAILURE");
  const response = JSON.parse(Buffer.from(await artifactStore.get(`${livePrefix()}/call-01-response.json`)).toString("utf8"));
  assert.equal(response.rawBody, "{ malformed");
});

test("TRANSPORT-RECOVERY-08: durable restart sees uncertain reservation and rejects ordinary same-pass call", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "prysm-transport-restart-"));
  const storeA = createFsArtifactStore({ baseDir });
  const fail = async () => { throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); };
  const bindingA = createNarrativeV2LiveBinding({ env: env(), artifactStore: storeA, requireDurableStore: true, fetchImpl: fail });
  bindingA.registerAuditScope(SCOPE);
  await assert.rejects(() => bindingA.writerExecutor({ prompt: "restart prompt", passNumber: 1, writerInput: input() }), /fetch failed/);
  const storeB = createFsArtifactStore({ baseDir });
  const bindingB = createNarrativeV2LiveBinding({ env: env(), artifactStore: storeB, requireDurableStore: true, fetchImpl: async () => { throw new Error("must not call"); } });
  bindingB.registerAuditScope(SCOPE);
  await assert.rejects(() => bindingB.writerExecutor({ prompt: "restart prompt", passNumber: 1, writerInput: input() }), /already reserved/);
});

test("TRANSPORT-RECOVERY-09: one authorized Writer pass-2 recovery uses a new call number and exact lineage", async () => {
  const artifactStore = createMemoryArtifactStore();
  const binding = createNarrativeV2LiveBinding({ env: env(), artifactStore, fetchImpl: async () => responseFor(validWriterOutput(2)) });
  binding.registerAuditScope(SCOPE);
  const recoveryPrompt = "writer recovery prompt";
  const previousJudge = { decision: "REVISE", revisionDirective: { required: true, mode: "TARGETED", fieldsToRewrite: ["funnelOpportunities.awareness"], fieldsLocked: [], defectIds: [] } };
  const writerHash = hash(JSON.stringify(input()));
  const reservation = (callNumber, role, passNumber, modelId, promptSha256) => ({
    contractVersion: "1.0.0", bindingVersion: "1.0.0", reservationId: `reservation-${callNumber}`,
    auditId: AUDIT_ID, executionId: SCOPE.executionId, callNumber, role, passNumber, modelId,
    promptSha256, writerInputSha256: writerHash, judgeRevisionSha256: hash(JSON.stringify(previousJudge)),
    estimatedCost: 0.01, reservedAt: "2026-09-09T00:00:00.000Z", status: "RESERVED",
  });
  await putJson(artifactStore, "narrative-v2/live-usage/call-01-reservation.json", reservation(1, "writer", 1, "writer-test", hash("writer one")));
  await putJson(artifactStore, "narrative-v2/live-usage/call-01-result.json", { validationResult: "PASS", state: "CALL_COMPLETED" });
  await putJson(artifactStore, "narrative-v2/live-usage/call-02-reservation.json", reservation(2, "judge", 1, "judge-test", hash("judge one")));
  await putJson(artifactStore, "narrative-v2/live-usage/call-02-result.json", { validationResult: "PASS", state: "CALL_COMPLETED" });
  await putJson(artifactStore, "narrative-v2/live-usage/call-03-reservation.json", reservation(3, "writer", 2, "writer-test", hash(recoveryPrompt)));
  const transport = { state: "TRANSPORT_OUTCOME_UNCERTAIN", callNumber: 3, reservationId: "reservation-3" };
  await putJson(artifactStore, "narrative-v2/live-usage/call-03-transport.json", transport);
  const auth = await binding.authorizeTransportRecovery({
    auditId: AUDIT_ID, executionId: SCOPE.executionId, role: "writer", passNumber: 2,
    originalReservationId: "reservation-3", originalCallNumber: 3,
    originalRequestSha256: hash(recoveryPrompt), originalModelId: "writer-test",
    originalWriterInputSha256: writerHash, judgeRevisionSha256: hash(JSON.stringify(previousJudge)),
    uncertaintyReason: "ambiguous socket reset", humanAuthorizationId: "human-auth-1",
    humanAuthorizationReference: "ticket-1", humanAuthorizationIdentity: "Chris",
    authorizedAt: "2026-09-09T00:00:00.000Z",
  });
  let calls = 0;
  const recoveredBinding = createNarrativeV2LiveBinding({ env: env(), artifactStore, fetchImpl: async () => { calls += 1; return responseFor(validWriterOutput(2)); } });
  recoveredBinding.registerAuditScope(SCOPE);
  const output = await recoveredBinding.writerExecutor({
    prompt: recoveryPrompt, passNumber: 2, writerInput: input(), previousOutput: validWriterOutput(1),
    judgeResponse: previousJudge, recoveryAuthorization: auth,
  });
  assert.equal(output.passNumber, 2);
  assert.equal(calls, 1);
  const recovered = JSON.parse(Buffer.from(await artifactStore.get(`${livePrefix()}/call-04-result.json`)).toString("utf8"));
  assert.equal(recovered.state, "RECOVERY_COMPLETED");
  const recoveryReservation = JSON.parse(Buffer.from(await artifactStore.get(`${livePrefix()}/call-04-reservation.json`)).toString("utf8"));
  assert.equal(recoveryReservation.recoveryOfReservationId, "reservation-3");
  await assert.rejects(() => binding.authorizeTransportRecovery({
    auditId: AUDIT_ID, executionId: SCOPE.executionId, role: "writer", passNumber: 2,
    originalReservationId: "reservation-3", originalCallNumber: 3,
    originalRequestSha256: hash(recoveryPrompt), originalModelId: "writer-test", originalWriterInputSha256: writerHash,
    judgeRevisionSha256: hash(JSON.stringify(previousJudge)), uncertaintyReason: "ambiguous socket reset",
    humanAuthorizationId: "human-auth-2", humanAuthorizationReference: "ticket-2", humanAuthorizationIdentity: "Chris", authorizedAt: "2026-09-09T00:00:00.000Z",
  }), /already authorized/);
});

async function seedUncertainPassTwo(store, overrides = {}) {
  const prompt = overrides.prompt || "recovery prompt";
  const writerHash = hash(JSON.stringify(input()));
  const judgeHash = hash(JSON.stringify(overrides.judge || null));
  await putJson(store, "narrative-v2/live-usage/call-01-reservation.json", {
    contractVersion: "1.0.0", bindingVersion: "1.0.0", reservationId: "original-reservation",
    auditId: AUDIT_ID, executionId: SCOPE.executionId, callNumber: 1, role: "writer", passNumber: 2,
    modelId: "writer-test", promptSha256: hash(prompt), writerInputSha256: writerHash,
    judgeRevisionSha256: judgeHash, estimatedCost: 0.01, reservedAt: "2026-09-09T00:00:00.000Z", status: "RESERVED",
    ...(overrides.reservation || {}),
  });
  await putJson(store, "narrative-v2/live-usage/call-01-transport.json", {
    contractVersion: "1.0.0", bindingVersion: "1.0.0", auditId: AUDIT_ID,
    executionId: SCOPE.executionId, role: "writer", passNumber: 2, callNumber: 1,
    reservationId: "original-reservation", requestSha256: hash(prompt), modelId: "writer-test",
    state: "TRANSPORT_OUTCOME_UNCERTAIN", uncertaintyReason: "socket reset", occurredAt: "2026-09-09T00:00:00.000Z",
  });
  return { prompt, writerHash, judgeHash };
}

function forgedRecovery({ prompt, writerHash, judgeHash, ...overrides }) {
  return {
    contractVersion: "1.0.0", bindingVersion: "1.0.0", authorizationId: "forged-auth",
    auditId: AUDIT_ID, executionId: SCOPE.executionId, role: "writer", passNumber: 2,
    originalReservationId: "original-reservation", originalCallNumber: 1,
    originalRequestSha256: hash(prompt), originalModelId: "writer-test", originalWriterInputSha256: writerHash,
    judgeRevisionSha256: judgeHash, uncertaintyReason: "socket reset",
    authorizedRecoveryAction: "REISSUE_SAME_PASS_AFTER_HUMAN_AUTHORIZATION", maxAdditionalCallCount: 1,
    state: "RECOVERY_AUTHORIZED", ...overrides,
  };
}

test("TRANSPORT-RECOVERY-10: forged recovery authorization without durable artifact is rejected before fetch", async () => {
  const store = createMemoryArtifactStore();
  const binding = createNarrativeV2LiveBinding({ env: env(), artifactStore: store, fetchImpl: async () => { throw new Error("must not call"); } });
  binding.registerAuditScope(SCOPE);
  const seeded = await seedUncertainPassTwo(store);
  await assert.rejects(() => binding.writerExecutor({
    prompt: seeded.prompt, passNumber: 2, writerInput: input(), previousOutput: validWriterOutput(1),
    judgeResponse: null, recoveryAuthorization: forgedRecovery(seeded),
  }), /authorization/i);
});

test("TRANSPORT-RECOVERY-11: recovery execution identity and tampered authorization are rejected", async () => {
  const store = createMemoryArtifactStore();
  const binding = createNarrativeV2LiveBinding({ env: env(), artifactStore: store, fetchImpl: async () => { throw new Error("must not call"); } });
  binding.registerAuditScope(SCOPE);
  const seeded = await seedUncertainPassTwo(store);
  const forged = forgedRecovery(seeded, { executionId: "other-execution" });
  await assert.rejects(() => binding.writerExecutor({
    prompt: seeded.prompt, passNumber: 2, writerInput: input(), previousOutput: validWriterOutput(1),
    judgeResponse: null, recoveryAuthorization: forged,
  }), /authorization|execution|lineage/i);
});

test("TRANSPORT-RECOVERY-11A: persisted authorization hash tampering is rejected", async () => {
  const store = createMemoryArtifactStore();
  const binding = createNarrativeV2LiveBinding({ env: env(), artifactStore: store, fetchImpl: async () => { throw new Error("must not call"); } });
  binding.registerAuditScope(SCOPE);
  const seeded = await seedUncertainPassTwo(store);
  const authorization = await binding.authorizeTransportRecovery({
    auditId: AUDIT_ID, executionId: SCOPE.executionId, role: "writer", passNumber: 2,
    originalReservationId: "original-reservation", originalCallNumber: 1,
    originalRequestSha256: hash(seeded.prompt), originalModelId: "writer-test", originalWriterInputSha256: seeded.writerHash,
    judgeRevisionSha256: seeded.judgeHash, uncertaintyReason: "socket reset",
    humanAuthorizationId: "auth-hash-test", humanAuthorizationReference: "ticket-hash",
    humanAuthorizationIdentity: "Chris", authorizedAt: "2026-09-09T00:00:00.000Z",
  });
  await assert.rejects(() => binding.writerExecutor({
    prompt: seeded.prompt, passNumber: 2, writerInput: input(), previousOutput: validWriterOutput(1),
    judgeResponse: null, recoveryAuthorization: { ...authorization, authorizationSha256: "0".repeat(64) },
  }), /authorization|lineage/i);
});

test("TRANSPORT-RECOVERY-12: mutable memory durability metadata cannot claim live-release durability", () => {
  const memory = createMemoryArtifactStore();
  const spoofed = { ...memory, storageBackend: "local" };
  assert.throws(() => createNarrativeV2LiveBinding({ env: env(), artifactStore: spoofed, requireDurableStore: true }), /durable artifact store/i);
});

test("TRANSPORT-RECOVERY-13: persisted returned response can resume without fetch after restart", async () => {
  const store = createMemoryArtifactStore();
  const payload = validWriterOutput(1);
  const prompt = "persisted response prompt";
  await putJson(store, "narrative-v2/live-usage/call-01-reservation.json", {
    auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1", callNumber: 1, role: "writer", passNumber: 1,
    modelId: "writer-test", promptSha256: hash(prompt), writerInputSha256: hash(JSON.stringify(input())), judgeRevisionSha256: hash(JSON.stringify(null)), estimatedCost: 0.01,
  });
  await putJson(store, "narrative-v2/live-usage/call-01-response.json", payload);
  const responseSha256 = hash(JSON.stringify(payload, null, 2));
  await putJson(store, "narrative-v2/live-usage/call-01-response-state.json", {
    state: "RESPONSE_RETURNED", auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1", callNumber: 1,
    role: "writer", passNumber: 1, modelId: "writer-test", requestSha256: hash(prompt), responseSha256,
  });
  await putJson(store, "narrative-v2/live-usage/call-01-response-meta.json", {
    state: "RESPONSE_RETURNED", auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1", callNumber: 1,
    role: "writer", passNumber: 1, modelId: "writer-test", requestSha256: hash(prompt),
    responseSha256, responseContentSha256: responseSha256,
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  });
  const binding = createNarrativeV2LiveBinding({ env: env(), artifactStore: store, fetchImpl: async () => { throw new Error("must not call"); } });
  binding.registerAuditScope(SCOPE);
  const output = await binding.writerExecutor({ prompt, passNumber: 1, writerInput: input() });
  assert.equal(output.passNumber, 1);
  const result = JSON.parse(Buffer.from(await store.get(`${livePrefix()}/call-01-recovered-result.json`)).toString("utf8"));
  assert.equal(result.validationResult, "PASS");
});

test("TRANSPORT-RECOVERY-14: completed result can resume exactly without fetch", async () => {
  const store = createMemoryArtifactStore();
  const payload = validWriterOutput(1);
  const prompt = "completed result prompt";
  await putJson(store, "narrative-v2/live-usage/call-01-reservation.json", {
    auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1", callNumber: 1, role: "writer", passNumber: 1,
    modelId: "writer-test", promptSha256: hash(prompt), writerInputSha256: hash(JSON.stringify(input())), judgeRevisionSha256: hash(JSON.stringify(null)), estimatedCost: 0.01,
  });
  await putJson(store, "narrative-v2/live-usage/call-01-response.json", payload);
  const responseSha256 = hash(JSON.stringify(payload, null, 2));
  await putJson(store, "narrative-v2/live-usage/call-01-response-state.json", {
    state: "RESPONSE_RETURNED", auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1", callNumber: 1,
    role: "writer", passNumber: 1, modelId: "writer-test", requestSha256: hash(prompt), responseSha256,
  });
  await putJson(store, "narrative-v2/live-usage/call-01-response-meta.json", {
    state: "RESPONSE_RETURNED", auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1", callNumber: 1,
    role: "writer", passNumber: 1, modelId: "writer-test", requestSha256: hash(prompt),
    responseSha256, responseContentSha256: responseSha256,
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  });
  await putJson(store, "narrative-v2/live-usage/call-01-result.json", {
    validationResult: "PASS", auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1", callNumber: 1, modelId: "writer-test", role: "writer", passNumber: 1, responseSha256,
  });
  const binding = createNarrativeV2LiveBinding({ env: env(), artifactStore: store, fetchImpl: async () => { throw new Error("must not call"); } });
  binding.registerAuditScope(SCOPE);
  const output = await binding.writerExecutor({ prompt, passNumber: 1, writerInput: input() });
  assert.equal(output.passNumber, payload.passNumber);
  assert.equal(output.funnelOpportunities.awareness[0].itemId, "FUN-A-01");
});

test("TRANSPORT-RECOVERY-15: post-response local failure resumes the returned response without fetch", async () => {
  const store = createMemoryArtifactStore();
  const payload = validWriterOutput(1);
  const prompt = "post-response restart prompt";
  const responseSha256 = hash(JSON.stringify(payload, null, 2));
  await putJson(store, "narrative-v2/live-usage/call-01-reservation.json", {
    auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1", callNumber: 1, role: "writer", passNumber: 1,
    modelId: "writer-test", promptSha256: hash(prompt), writerInputSha256: hash(JSON.stringify(input())),
    judgeRevisionSha256: hash(JSON.stringify(null)), estimatedCost: 0.01,
  });
  await putJson(store, "narrative-v2/live-usage/call-01-response.json", payload);
  await putJson(store, "narrative-v2/live-usage/call-01-response-state.json", {
    state: "RESPONSE_RETURNED", auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1",
    callNumber: 1, role: "writer", passNumber: 1, modelId: "writer-test", requestSha256: hash(prompt),
    responseSha256,
  });
  await putJson(store, "narrative-v2/live-usage/call-01-response-meta.json", {
    state: "POST_RESPONSE_LOCAL_FAILURE", auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1",
    callNumber: 1, role: "writer", passNumber: 1, modelId: "writer-test", requestSha256: hash(prompt),
    responseSha256, responseContentSha256: responseSha256,
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  });
  await putJson(store, "narrative-v2/live-usage/call-01-result.json", {
    validationResult: "FAIL", state: "POST_RESPONSE_LOCAL_FAILURE", role: "writer", passNumber: 1,
  });
  let fetchCalls = 0;
  const binding = createNarrativeV2LiveBinding({ env: env(), artifactStore: store, fetchImpl: async () => { fetchCalls += 1; throw new Error("must not call"); } });
  binding.registerAuditScope(SCOPE);
  const output = await binding.writerExecutor({ prompt, passNumber: 1, writerInput: input() });
  assert.equal(output.passNumber, 1);
  assert.equal(fetchCalls, 0);
  const recovered = JSON.parse(Buffer.from(await store.get(`${livePrefix()}/call-01-recovered-result.json`)).toString("utf8"));
  assert.equal(recovered.validationResult, "PASS");
  await assert.rejects(() => store.get(`${livePrefix()}/call-02-reservation.json`));
});

test("TRANSPORT-RECOVERY-16: persisted response bytes must match the durable digest before resume", async () => {
  const store = createMemoryArtifactStore();
  const payload = validWriterOutput(1);
  const tampered = { ...payload, executiveConclusion: { ...payload.executiveConclusion, headline: "tampered response" } };
  const prompt = "digest restart prompt";
  const responseSha256 = hash(JSON.stringify(payload, null, 2));
  await putJson(store, "narrative-v2/live-usage/call-01-reservation.json", {
    auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1", callNumber: 1, role: "writer", passNumber: 1,
    modelId: "writer-test", promptSha256: hash(prompt), writerInputSha256: hash(JSON.stringify(input())),
    judgeRevisionSha256: hash(JSON.stringify(null)), estimatedCost: 0.01,
  });
  await putJson(store, "narrative-v2/live-usage/call-01-response.json", tampered);
  await putJson(store, "narrative-v2/live-usage/call-01-response-state.json", { state: "RESPONSE_RETURNED", auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1", callNumber: 1, role: "writer", passNumber: 1, modelId: "writer-test", requestSha256: hash(prompt), responseSha256 });
  await putJson(store, "narrative-v2/live-usage/call-01-response-meta.json", { state: "RESPONSE_RETURNED", auditId: AUDIT_ID, executionId: SCOPE.executionId, reservationId: "reservation-1", callNumber: 1, role: "writer", passNumber: 1, modelId: "writer-test", requestSha256: hash(prompt), responseSha256, responseContentSha256: responseSha256, usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 } });
  let fetchCalls = 0;
  const binding = createNarrativeV2LiveBinding({ env: env(), artifactStore: store, fetchImpl: async () => { fetchCalls += 1; throw new Error("must not call"); } });
  binding.registerAuditScope(SCOPE);
  await assert.rejects(() => binding.writerExecutor({ prompt, passNumber: 1, writerInput: input() }), /digest|identity|persisted/i);
  assert.equal(fetchCalls, 0);
});

test("TRANSPORT-RECOVERY-17: persisted response scope must match the active execution", async () => {
  const store = createMemoryArtifactStore();
  const payload = validWriterOutput(1);
  const prompt = "scope restart prompt";
  const responseSha256 = hash(JSON.stringify(payload, null, 2));
  await putJson(store, "narrative-v2/live-usage/call-01-reservation.json", { auditId: AUDIT_ID, executionId: SCOPE.executionId, callNumber: 1, role: "writer", passNumber: 1, modelId: "writer-test", promptSha256: hash(prompt), writerInputSha256: hash(JSON.stringify(input())), judgeRevisionSha256: hash(JSON.stringify(null)), estimatedCost: 0.01 });
  await putJson(store, "narrative-v2/live-usage/call-01-response.json", payload);
  await putJson(store, "narrative-v2/live-usage/call-01-response-state.json", { state: "RESPONSE_RETURNED", auditId: AUDIT_ID, executionId: "other-execution", reservationId: "reservation-1", callNumber: 1, role: "writer", passNumber: 1, modelId: "writer-test", requestSha256: hash(prompt), responseSha256 });
  await putJson(store, "narrative-v2/live-usage/call-01-response-meta.json", { state: "RESPONSE_RETURNED", auditId: AUDIT_ID, executionId: "other-execution", reservationId: "reservation-1", callNumber: 1, role: "writer", passNumber: 1, modelId: "writer-test", requestSha256: hash(prompt), responseSha256, responseContentSha256: responseSha256, usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 } });
  let fetchCalls = 0;
  const binding = createNarrativeV2LiveBinding({ env: env(), artifactStore: store, fetchImpl: async () => { fetchCalls += 1; throw new Error("must not call"); } });
  binding.registerAuditScope(SCOPE);
  await assert.rejects(() => binding.writerExecutor({ prompt, passNumber: 1, writerInput: input() }), /identity|execution|scope|persisted/i);
  assert.equal(fetchCalls, 0);
});

/**
 * PRYSM Narrative v2 — bounded live Writer/Judge execution binding.
 *
 * Provider/model agnostic: uses an injected or global fetch implementation
 * against an explicitly configured OpenAI-compatible chat-completions URL.
 * No SDK is required and no model name is hardcoded.
 *
 * Governance:
 * - disabled by default;
 * - live mode must be explicit;
 * - exactly four automatic model calls maximum per audit:
 *   Writer 1 -> Judge 1 -> Writer 2 -> Judge 2;
 * - Pass 2 Writer is authorized only by a validated Judge 1 REVISE decision;
 * - one final Writer 3 -> Judge 3 round is permitted only after explicit
 *   human authorization and a validated Judge 2 targeted REVISE decision;
 * - six total model calls is the absolute governed ceiling;
 * - no network retry, fourth Writer pass, repair loop, model escalation, or hidden fallback;
 * - deterministic token/cost preflight before every call;
 * - immutable reservation is persisted BEFORE a paid call so restart/recovery
 *   cannot silently repeat an uncertain paid attempt;
 * - same-runtime duplicate reservations are blocked synchronously before the
 *   first asynchronous artifact read; durable reservations then block
 *   sequential/restart duplicates;
 * - each reservation has a unique claim ID so a conflicting durable claim is
 *   distinguishable from an idempotent same-byte write;
 * - usage/result ledger is persisted after every returned response;
 * - exact parsed provider JSON is persisted before normalization/validation;
 * - completed-call budget accounting reconciles reservation estimates to
 *   returned actual cost before another paid call may be reserved;
 * - missing/invalid provider usage fails closed rather than recording $0 cost;
 * - Writer/Judge outputs are normalized only for deterministic structural
 *   metadata, then validated at the executor boundary and again by the
 *   governed Narrative v2 orchestrator.
 *
 * The governed object store is not a cross-process atomic lock. This binding
 * therefore does not authorize concurrent multi-worker live execution.
 */

import { createHash, randomUUID } from "node:crypto";

import { runCostPreflight } from "../narrative/cost-preflight.js";
import { createUsageLedgerEntry } from "../narrative/usage-ledger.js";
import {
  WRITER_PROMPT_VERSION,
  validateWriterOutput,
} from "./writer-output.js";
import {
  JUDGE_DECISION,
  JUDGE_PROMPT_VERSION,
  validateJudgeResponse,
} from "./judge-contract.js";
import { buildWriterStructuredResponseFormat } from "./writer-structured-output.js";
import { buildJudgeStructuredResponseFormat } from "./judge-structured-output.js";
import {
  normalizeWriterModelOutput,
  normalizeJudgeModelOutput,
} from "./model-output-normalization.js";
import { isDurableFsArtifactStore } from "../storage/fs-artifact-store.js";
import { isDurableObjectArtifactStore } from "../storage/object-artifact-store.js";

export const NARRATIVE_V2_LIVE_BINDING_VERSION = "1.0.0";
export const NARRATIVE_V2_LIVE_MAX_CALLS = 4;
export const NARRATIVE_V2_LIVE_MAX_TOTAL_CALLS = 6;
export const NARRATIVE_V2_LIVE_MAX_AUTOMATIC_PASSES = 2;
export const NARRATIVE_V2_LIVE_MODE = "live";

const DEFAULT_TIMEOUT_MS = 120_000;
const RESERVATION_PREFIX = "narrative-v2/live-usage";

export const NARRATIVE_V2_CALL_STATE = Object.freeze({
  RESERVED: "RESERVED",
  RESPONSE_RETURNED: "RESPONSE_RETURNED",
  CALL_COMPLETED: "CALL_COMPLETED",
  TRANSPORT_FAILED_PRE_TRANSMISSION: "TRANSPORT_FAILED_PRE_TRANSMISSION",
  TRANSPORT_OUTCOME_UNCERTAIN: "TRANSPORT_OUTCOME_UNCERTAIN",
  RETURNED_PROVIDER_FAILURE: "RETURNED_PROVIDER_FAILURE",
  POST_RESPONSE_LOCAL_FAILURE: "POST_RESPONSE_LOCAL_FAILURE",
  RECOVERY_AUTHORIZED: "RECOVERY_AUTHORIZED",
  RECOVERY_COMPLETED: "RECOVERY_COMPLETED",
  RECOVERY_FAILED: "RECOVERY_FAILED",
});

export const NARRATIVE_V2_RECOVERY_ACTION =
  "REISSUE_SAME_PASS_AFTER_HUMAN_AUTHORIZATION";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function objectSha256(value) {
  return sha256(JSON.stringify(value));
}

function transportName(callNumber) {
  return `${RESERVATION_PREFIX}/call-${String(callNumber).padStart(2, "0")}-transport.json`;
}

function recoveryName(authorizationId) {
  const safeId = String(authorizationId || "").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${RESERVATION_PREFIX}/recovery-${safeId}.json`;
}

function isConcretePreTransmissionError(error) {
  const cause = error?.cause || error;
  return cause?.code === "ENOTFOUND" && cause?.syscall === "getaddrinfo";
}

function sanitizedTransportFields(error) {
  const cause = error?.cause || error;
  const safe = {};
  const fields = ["name", "message", "code", "errno", "syscall", "hostname", "port", "address"];
  for (const field of fields) {
    const value = field === "name" ? error?.name || cause?.name : cause?.[field];
    if (value !== undefined && value !== null) {
      const key = field === "name" ? "errorName" : field === "message" ? "errorMessage" : field === "code" ? "causeCode" : field;
      if (key === "errorMessage") continue;
      safe[key] = typeof value === "string" ? value.slice(0, 240) : value;
    }
  }
  if (error?.name === "AbortError" || cause?.name === "AbortError") {
    safe.timeoutClassification = "ABORT_TIMEOUT";
  }
  return safe;
}

function parsePositiveNumber(
  raw,
  label,
  { allowZero = false, integer = false } = {},
) {
  const value = Number(raw);

  if (
    !Number.isFinite(value) ||
    (allowZero ? value < 0 : value <= 0) ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      `${label} must be ${
        allowZero ? "a non-negative" : "a positive"
      }${integer ? " integer" : " number"}`,
    );
  }

  return value;
}

function requiredString(value, label) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    throw new Error(`${label} is required`);
  }

  return normalized;
}

function parsePriceTable(raw, writerModel, judgeModel) {
  let parsed;

  try {
    parsed = JSON.parse(
      requiredString(
        raw,
        "PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON",
      ),
    );
  } catch (err) {
    throw new Error(
      `PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON must be valid JSON: ${err.message}`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON must be an object keyed by model ID",
    );
  }

  const out = {};

  for (const modelId of new Set([writerModel, judgeModel])) {
    const rec = parsed[modelId];

    if (!rec || typeof rec !== "object") {
      throw new Error(`Price table missing model: ${modelId}`);
    }

    out[modelId] = Object.freeze({
      inputPricePer1K: parsePositiveNumber(
        rec.inputPricePer1K,
        `${modelId}.inputPricePer1K`,
        { allowZero: true },
      ),
      outputPricePer1K: parsePositiveNumber(
        rec.outputPricePer1K,
        `${modelId}.outputPricePer1K`,
        { allowZero: true },
      ),
    });
  }

  return Object.freeze(out);
}

export function loadNarrativeV2LiveConfig(env = process.env) {
  const enabled =
    String(
      env.PRYSM_NARRATIVE_V2_ENABLED || "",
    ).toLowerCase() === "true";

  if (!enabled) {
    return Object.freeze({ enabled: false });
  }

  if (
    env.PRYSM_LLM_MODE !== NARRATIVE_V2_LIVE_MODE
  ) {
    throw new Error(
      "PRYSM_NARRATIVE_V2_ENABLED=true requires PRYSM_LLM_MODE=live",
    );
  }

  const writerModel = requiredString(
    env.PRYSM_NARRATIVE_V2_WRITER_MODEL,
    "PRYSM_NARRATIVE_V2_WRITER_MODEL",
  );

  const judgeModel = requiredString(
    env.PRYSM_NARRATIVE_V2_JUDGE_MODEL,
    "PRYSM_NARRATIVE_V2_JUDGE_MODEL",
  );

  const config = {
    enabled: true,

    chatCompletionsUrl: requiredString(
      env.PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL,
      "PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL",
    ),

    apiKey: requiredString(
      env.PRYSM_NARRATIVE_V2_API_KEY,
      "PRYSM_NARRATIVE_V2_API_KEY",
    ),

    writerModel,
    judgeModel,

    maxInputTokens: parsePositiveNumber(
      env.PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS,
      "PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS",
      { integer: true },
    ),

    writerMaxOutputTokens: parsePositiveNumber(
      env.PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS,
      "PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS",
      { integer: true },
    ),

    judgeMaxOutputTokens: parsePositiveNumber(
      env.PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS,
      "PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS",
      { integer: true },
    ),

    timeoutMs: env.PRYSM_NARRATIVE_V2_TIMEOUT_MS
      ? parsePositiveNumber(
          env.PRYSM_NARRATIVE_V2_TIMEOUT_MS,
          "PRYSM_NARRATIVE_V2_TIMEOUT_MS",
          { integer: true },
        )
      : DEFAULT_TIMEOUT_MS,

    softBudgetUsd: parsePositiveNumber(
      env.PRYSM_LLM_SOFT_BUDGET_USD,
      "PRYSM_LLM_SOFT_BUDGET_USD",
      { allowZero: true },
    ),

    hardBudgetUsd: parsePositiveNumber(
      env.PRYSM_LLM_HARD_BUDGET_USD,
      "PRYSM_LLM_HARD_BUDGET_USD",
    ),

    dailyHardBudgetUsd: parsePositiveNumber(
      env.PRYSM_LLM_DAILY_HARD_BUDGET_USD,
      "PRYSM_LLM_DAILY_HARD_BUDGET_USD",
    ),

    dailySpendUsd: env.PRYSM_LLM_DAILY_SPEND_USD
      ? parsePositiveNumber(
          env.PRYSM_LLM_DAILY_SPEND_USD,
          "PRYSM_LLM_DAILY_SPEND_USD",
          { allowZero: true },
        )
      : 0,

    priceTable: null,
  };

  if (
    config.softBudgetUsd > config.hardBudgetUsd
  ) {
    throw new Error(
      "PRYSM_LLM_SOFT_BUDGET_USD cannot exceed PRYSM_LLM_HARD_BUDGET_USD",
    );
  }

  if (
    config.hardBudgetUsd >
    config.dailyHardBudgetUsd
  ) {
    throw new Error(
      "PRYSM_LLM_HARD_BUDGET_USD cannot exceed PRYSM_LLM_DAILY_HARD_BUDGET_USD",
    );
  }

  try {
    const url = new URL(
      config.chatCompletionsUrl,
    );

    if (url.protocol !== "https:") {
      throw new Error("URL must use https");
    }
  } catch (err) {
    throw new Error(
      `PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL is invalid: ${err.message}`,
    );
  }

  config.priceTable = parsePriceTable(
    env.PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON,
    writerModel,
    judgeModel,
  );

  return Object.freeze(config);
}

function reservationName(callNumber) {
  return `${RESERVATION_PREFIX}/call-${String(
    callNumber,
  ).padStart(2, "0")}-reservation.json`;
}

function responseName(callNumber) {
  return `${RESERVATION_PREFIX}/call-${String(
    callNumber,
  ).padStart(2, "0")}-response.json`;
}

function responseStateName(callNumber) {
  return `${RESERVATION_PREFIX}/call-${String(callNumber).padStart(2, "0")}-response-state.json`;
}

function responseMetaName(callNumber) {
  return `${RESERVATION_PREFIX}/call-${String(callNumber).padStart(2, "0")}-response-meta.json`;
}

function resultName(callNumber) {
  return `${RESERVATION_PREFIX}/call-${String(
    callNumber,
  ).padStart(2, "0")}-result.json`;
}

function scopeWithName(scope, artifactName) {
  return {
    tenantId: scope.tenantId,
    clientId: scope.clientId,
    auditId: scope.auditId,
    category: "report-v2",
    artifactName,
  };
}

async function readJsonByName(
  artifactStore,
  scope,
  artifactName,
) {
  const key =
    `tenants/${scope.tenantId}` +
    `/clients/${scope.clientId}` +
    `/audits/${scope.auditId}` +
    `/report-v2/${artifactName}`;

  let bytes;

  try {
    bytes = await artifactStore.get(key);
  } catch {
    return null;
  }

  if (!bytes) {
    return null;
  }

  return JSON.parse(
    Buffer.from(bytes).toString("utf8"),
  );
}

async function persistJson(
  artifactStore,
  scope,
  artifactName,
  value,
) {
  const bytes = Buffer.from(
    JSON.stringify(value, null, 2),
    "utf8",
  );

  const record = await artifactStore.put({
    bytes,
    contentType: "application/json",
    scope: scopeWithName(
      scope,
      artifactName,
    ),
  });

  const stored = await artifactStore.get(
    record.key,
  );

  if (
    !stored ||
    stored.length !== bytes.length ||
    sha256(stored) !== record.sha256
  ) {
    throw new Error(
      `Narrative v2 live ledger verification failed: ${artifactName}`,
    );
  }

  if (
    typeof artifactStore.verify ===
      "function" &&
    !(await artifactStore.verify(record))
  ) {
    throw new Error(
      `Narrative v2 live ledger store verification failed: ${artifactName}`,
    );
  }

  return record;
}

function estimateActualCost(usage, price) {
  return (
    Math.round(
      (
        (usage.inputTokens / 1000) *
          price.inputPricePer1K +
        (usage.outputTokens / 1000) *
          price.outputPricePer1K
      ) *
        1e8,
    ) / 1e8
  );
}

function extractUsage(body) {
  const usage = body?.usage;

  if (
    !usage ||
    typeof usage !== "object" ||
    Array.isArray(usage)
  ) {
    throw new Error(
      "Narrative v2 provider response missing governed token usage",
    );
  }

  const inputRaw =
    usage.prompt_tokens ??
    usage.input_tokens;

  const outputRaw =
    usage.completion_tokens ??
    usage.output_tokens;

  const cachedRaw =
    usage.prompt_tokens_details
      ?.cached_tokens ??
    usage.cached_input_tokens ??
    0;

  const inputTokens = Number(inputRaw);
  const outputTokens = Number(outputRaw);
  const cachedInputTokens =
    Number(cachedRaw);

  if (
    !Number.isFinite(inputTokens) ||
    inputTokens <= 0 ||
    !Number.isInteger(inputTokens)
  ) {
    throw new Error(
      "Narrative v2 provider response has invalid input token usage",
    );
  }

  if (
    !Number.isFinite(outputTokens) ||
    outputTokens < 0 ||
    !Number.isInteger(outputTokens)
  ) {
    throw new Error(
      "Narrative v2 provider response has invalid output token usage",
    );
  }

  if (
    !Number.isFinite(cachedInputTokens) ||
    cachedInputTokens < 0 ||
    !Number.isInteger(cachedInputTokens) ||
    cachedInputTokens > inputTokens
  ) {
    throw new Error(
      "Narrative v2 provider response has invalid cached-input token usage",
    );
  }

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
  };
}

function extractContent(body) {
  const content =
    body?.choices?.[0]?.message?.content;

  if (
    typeof content !== "string" ||
    !content.trim()
  ) {
    throw new Error(
      "Model response did not contain choices[0].message.content",
    );
  }

  return content.trim();
}

function judgePrompt({
  passNumber,
  writerInput,
  writerOutput,
  judgeContract,
}) {
  return [
    "You are the Prysm governed Narrative v2 Judge.",
    "Evaluate the WriterOutput against the exact WriterInput and frozen Judge contract below.",
    "Do not rewrite prose. Do not invent evidence, facts, findings, URLs, scores, or source states.",
    "Independently challenge every factual, causal, root-cause, commercial, conversion, revenue, traffic, ranking, engagement, abandonment, or business-impact claim in the WriterOutput.",
    "A claim is supported only when the cited governed evidence directly supports that level of certainty.",
    "Do not treat correlation, technical condition, missing evidence, PARTIAL evidence, UNKNOWN evidence, or an upstream interpretation as proof of a downstream business outcome.",
    "If the Writer states or implies an outcome more strongly than the governed evidence supports, record an UNSUPPORTED_FACT hard-gate violation and fail evidenceFidelity.",
    "Inferred implications must remain explicitly bounded as risks, possibilities, or opportunities unless the governed evidence directly observes the stated outcome.",
    "The Judge must independently compare WriterOutput claims with WriterInput evidence; do not accept a claim merely because it already appears in an upstream finding, score, root-cause summary, or business-impact field.",
    "When WriterInput.deterministicAnalysis.conversionInfluence is present, evaluate whether the Writer follows that governed Conversion-First hierarchy. rubric.conversionInterpretation.evidenceRefs MUST include the exact reference ID analysis:conversionInfluence.",
    "UNKNOWN, UNAVAILABLE, PARTIAL, or not-deeply-parsed evidence must never be interpreted as ABSENT, MISSING, FALSE, ZERO, or fully assessed. PARTIAL content evidence supports only not-detected-in-the-available-assessment language, with the partial-coverage qualification preserved.",
    "Do not treat a content-detection gap as an established AI-search limitation unless WriterInput directly assesses and supports that AI-search condition. Otherwise require opportunity language.",
    "Partial or directional competitor evidence does not establish a present differentiator, advantage, disadvantage, market position, or superiority; require opportunity language unless the cited evidence directly establishes it.",
    "A visible form, CTA, enquiry route, or conversion-path condition is not a confirmed conversion, lead, enquiry, or customer outcome; reject unsupported certainty and require observed-path or bounded-opportunity wording.",
    "Before issuing REVISE, perform the evidence-fidelity check across every WriterOutput section and report all material evidence-fidelity defects found in that pass. A field containing an unresolved material defect must not be treated as locked or clean for a subsequent targeted revision.",
    "Return ONLY one JSON object matching JudgeResponse contractVersion 1.0.0.",
    "The decision must follow the supplied deterministic thresholds. No markdown or code fences.",
    `PASS_NUMBER=${passNumber}`,
    `JUDGE_CONTRACT=${JSON.stringify(
      judgeContract,
    )}`,
    `WRITER_INPUT=${JSON.stringify(
      writerInput,
    )}`,
    `WRITER_OUTPUT=${JSON.stringify(
      writerOutput,
    )}`,
  ].join("\n");
}

function safeProviderError(status) {
  const err = new Error(
    `Narrative v2 model request failed with HTTP ${status}`,
  );

  err.code =
    "NARRATIVE_V2_PROVIDER_HTTP_ERROR";

  err.statusCode = status;

  return err;
}

export function createNarrativeV2LiveBinding({
  env = process.env,
  fetchImpl = globalThis.fetch,
  artifactStore,
  requireDurableStore = false,
  clock = {
    now: () => new Date().toISOString(),
  },
} = {}) {
  const config =
    loadNarrativeV2LiveConfig(env);

  if (!config.enabled) {
    return Object.freeze({
      enabled: false,
      registerAuditScope: () => {},
    });
  }

  if (typeof fetchImpl !== "function") {
    throw new Error(
      "Narrative v2 live binding requires fetch",
    );
  }

  if (!artifactStore) {
    throw new Error(
      "Narrative v2 live binding requires artifactStore",
    );
  }

  if (
    requireDurableStore &&
    !(isDurableFsArtifactStore(artifactStore) || isDurableObjectArtifactStore(artifactStore))
  ) {
    throw new Error(
      "Narrative v2 live release requires a durable artifact store",
    );
  }

  const scopes = new Map();
  const finalPassAuthorizations =
    new Map();
  const inFlightReservationClaims =
    new Set();

  const processDaily = {
    date: clock.now().slice(0, 10),
    reservedUsd: config.dailySpendUsd,
  };

  function registerAuditScope({
    tenantId,
    clientId,
    auditId,
    executionId,
  }) {
    if (
      !tenantId ||
      !clientId ||
      !auditId
    ) {
      throw new Error(
        "Narrative v2 audit scope requires tenantId, clientId, and auditId",
      );
    }

    scopes.set(
      auditId,
      Object.freeze({
        tenantId,
        clientId,
        auditId,
        executionId:
          executionId ||
          `${auditId}:narrative-v2`,
      }),
    );
  }

  async function persistTransportOutcome({
    scope,
    reservation,
    error,
    state,
    uncertaintyReason,
    responseStatus = null,
    responseSha256 = null,
  }) {
    const record = Object.freeze({
      contractVersion: "1.0.0",
      bindingVersion: NARRATIVE_V2_LIVE_BINDING_VERSION,
      auditId: scope.auditId,
      executionId: scope.executionId,
      role: reservation.role,
      passNumber: reservation.passNumber,
      callNumber: reservation.callNumber,
      reservationId: reservation.reservationId,
      requestSha256: reservation.promptSha256,
      modelId: reservation.modelId,
      state,
      uncertaintyReason,
      ...sanitizedTransportFields(error),
      ...(responseStatus !== null ? { responseStatus } : {}),
      ...(responseSha256 ? { responseSha256 } : {}),
      occurredAt: clock.now(),
    });
    await persistJson(artifactStore, scope, transportName(reservation.callNumber), record);
    return record;
  }

  function resolveScope(auditId) {
    const scope = scopes.get(auditId);

    if (!scope) {
      throw new Error(
        `Narrative v2 live scope not registered for audit ${auditId}`,
      );
    }

    return scope;
  }

  function authorizeFinalPass({
    auditId,
    authorizationId,
  }) {
    resolveScope(auditId);

    const normalizedAuthorizationId =
      String(
        authorizationId || "",
      ).trim();

    if (!normalizedAuthorizationId) {
      throw new Error(
        "Narrative v2 final-pass authorizationId is required",
      );
    }

    if (
      finalPassAuthorizations.has(
        auditId,
      )
    ) {
      throw new Error(
        `Narrative v2 final pass already authorized for audit ${auditId}`,
      );
    }

    const authorization =
      Object.freeze({
        auditId,
        authorizationId:
          normalizedAuthorizationId,
        authorizedAt: clock.now(),
      });

    finalPassAuthorizations.set(
      auditId,
      authorization,
    );

    return authorization;
  }

  async function existingReservations(
    scope,
  ) {
    const rows = [];

    for (
      let i = 1;
      i <=
      NARRATIVE_V2_LIVE_MAX_TOTAL_CALLS;
      i += 1
    ) {
      const reservation =
        await readJsonByName(
          artifactStore,
          scope,
          reservationName(i),
        );

      if (reservation) {
        rows.push(reservation);
      }
    }

    return rows;
  }

  async function completedAuditSpend(
    scope,
    existing,
  ) {
    let total = 0;

    for (const reservation of existing) {
      const result =
        await readJsonByName(
          artifactStore,
          scope,
          resultName(
            reservation.callNumber,
          ),
        );

      const actualCost = Number(
        result?.actualCost,
      );

      if (
        Number.isFinite(actualCost) &&
        actualCost >= 0
      ) {
        total += actualCost;
      } else {
        total += Number(
          reservation.estimatedCost || 0,
        );
      }
    }

    return total;
  }

  async function requireValidatedResult(
    scope,
    reservation,
    label,
  ) {
    const result =
      await readJsonByName(
        artifactStore,
        scope,
        resultName(
          reservation.callNumber,
        ),
      );

    if (
      !result ||
      result.validationResult !== "PASS"
    ) {
      throw new Error(
        `Narrative v2 live ${label} requires a validated prior result ledger`,
      );
    }
  }

  async function authorizeTransportRecovery({
    auditId,
    executionId,
    role,
    passNumber,
    originalReservationId,
    originalCallNumber,
    originalRequestSha256,
    originalModelId,
    originalWriterInputSha256,
    judgeRevisionSha256 = null,
    uncertaintyReason,
    transportFailureSha256,
    humanAuthorizationId,
    humanAuthorizationReference,
    humanAuthorizationIdentity,
    authorizedAt,
  }) {
    const scope = resolveScope(auditId);
    if (role !== "writer" || passNumber !== 2) {
      throw new Error("Narrative v2 recovery permits only Writer pass 2");
    }
    const existing = await existingReservations(scope);
    const original = existing.find((entry) =>
      entry.reservationId === originalReservationId &&
      entry.callNumber === originalCallNumber,
    );
    if (!original) throw new Error("Narrative v2 recovery original reservation not found");
    if (original.role !== role || original.passNumber !== passNumber) {
      throw new Error("Narrative v2 recovery role/pass mismatch");
    }
    if (original.promptSha256 !== originalRequestSha256 || original.modelId !== originalModelId) {
      throw new Error("Narrative v2 recovery request/model identity mismatch");
    }
    if (
      executionId !== scope.executionId ||
      original.executionId !== scope.executionId ||
      original.auditId !== scope.auditId
    ) {
      throw new Error("Narrative v2 recovery execution identity mismatch");
    }
    if (!originalWriterInputSha256) {
      throw new Error("Narrative v2 recovery requires WriterInput identity");
    }
    const transport = await readJsonByName(artifactStore, scope, transportName(original.callNumber));
    if (!transport || transport.state !== NARRATIVE_V2_CALL_STATE.TRANSPORT_OUTCOME_UNCERTAIN) {
      throw new Error("Narrative v2 recovery requires an uncertain transport outcome");
    }
    if (transportFailureSha256 && objectSha256(transport) !== transportFailureSha256) {
      throw new Error("Narrative v2 recovery transport record hash mismatch");
    }
    if (existing.some((entry) => entry.recoveryOfReservationId === originalReservationId)) {
      throw new Error("Narrative v2 recovery already authorized for original reservation");
    }
    const normalizedId = String(humanAuthorizationId || "").trim();
    if (!normalizedId || !humanAuthorizationReference || !humanAuthorizationIdentity || !authorizedAt) {
      throw new Error("Narrative v2 recovery requires explicit human authorization fields");
    }
    const authorization = Object.freeze({
      contractVersion: "1.0.0",
      bindingVersion: NARRATIVE_V2_LIVE_BINDING_VERSION,
      authorizationId: normalizedId,
      auditId,
      executionId,
      role,
      passNumber,
      originalReservationId,
      originalCallNumber,
      originalRequestSha256,
      originalModelId,
      originalWriterInputSha256,
      judgeRevisionSha256,
      uncertaintyReason,
      transportFailureSha256: transportFailureSha256 || objectSha256(transport),
      humanAuthorizationReference,
      humanAuthorizationIdentity,
      authorizedAt,
      authorizedRecoveryAction: NARRATIVE_V2_RECOVERY_ACTION,
      maxAdditionalCallCount: 1,
      relationship: "recovery-of-original-reservation",
      conservativeCostTreatment: "original-reservation-estimate-retained",
      state: NARRATIVE_V2_CALL_STATE.RECOVERY_AUTHORIZED,
    });
    const authorizationRecord = {
      ...authorization,
      authorizationSha256: objectSha256(authorization),
    };
    await persistJson(artifactStore, scope, recoveryName(normalizedId), authorizationRecord);
    return Object.freeze(authorizationRecord);
  }

  async function reserveCall({
    scope,
    role,
    modelId,
    prompt,
    maxOutputTokens,
    passNumber,
    previousJudgeResponse = null,
    recoveryAuthorization = null,
    writerInputSha256 = null,
  }) {
    const inFlightKey =
      `${scope.auditId}:${role}:${passNumber}`;

    if (
      inFlightReservationClaims.has(
        inFlightKey,
      )
    ) {
      throw new Error(
        `Narrative v2 paid ${role} pass ${passNumber} is already being reserved in this runtime; refusing concurrent duplicate call`,
      );
    }

    inFlightReservationClaims.add(
      inFlightKey,
    );

    try {
      const existing =
        await existingReservations(scope);

      if (
        passNumber <=
          NARRATIVE_V2_LIVE_MAX_AUTOMATIC_PASSES &&
        existing.length >=
          NARRATIVE_V2_LIVE_MAX_CALLS
      ) {
        throw new Error(
          `Narrative v2 live call cap reached (${NARRATIVE_V2_LIVE_MAX_CALLS})`,
        );
      }

      if (
        existing.length >=
        NARRATIVE_V2_LIVE_MAX_TOTAL_CALLS
      ) {
        throw new Error(
          `Narrative v2 live total call cap reached (${NARRATIVE_V2_LIVE_MAX_TOTAL_CALLS})`,
        );
      }

      if (
        !recoveryAuthorization &&
        existing.some(
          (entry) =>
            entry.role === role &&
            entry.passNumber ===
              passNumber,
        )
      ) {
        throw new Error(
          `Narrative v2 paid ${role} pass ${passNumber} already reserved; refusing duplicate call`,
        );
      }

      let finalPassAuthorization = null;

      if (recoveryAuthorization) {
        const recovery = recoveryAuthorization;
        const durableAuthorization = recovery.authorizationId
          ? await readJsonByName(
              artifactStore,
              scope,
              recoveryName(recovery.authorizationId),
            )
          : null;
        const durableAuthorizationHash = durableAuthorization
          ? objectSha256(
              Object.fromEntries(
                Object.entries(durableAuthorization).filter(
                  ([key]) => key !== "authorizationSha256",
                ),
              ),
            )
          : null;
        const original = existing.find((entry) =>
          entry.reservationId === recovery.originalReservationId &&
          entry.callNumber === recovery.originalCallNumber,
        );
        const transport = original
          ? await readJsonByName(artifactStore, scope, transportName(original.callNumber))
          : null;
        const validRecovery =
          recovery.state === NARRATIVE_V2_CALL_STATE.RECOVERY_AUTHORIZED &&
          recovery.authorizedRecoveryAction === NARRATIVE_V2_RECOVERY_ACTION &&
          recovery.maxAdditionalCallCount === 1 &&
          recovery.auditId === scope.auditId &&
          recovery.executionId === scope.executionId &&
          recovery.role === role &&
          recovery.passNumber === passNumber &&
          original &&
          transport?.state === NARRATIVE_V2_CALL_STATE.TRANSPORT_OUTCOME_UNCERTAIN &&
          existing.filter((entry) => entry.recoveryOfReservationId === recovery.originalReservationId).length === 0 &&
          recovery.originalModelId === modelId &&
          recovery.originalRequestSha256 === sha256(prompt) &&
          recovery.originalWriterInputSha256 === writerInputSha256 &&
          recovery.judgeRevisionSha256 === objectSha256(previousJudgeResponse || null);
        const authenticatedRecovery =
          validRecovery &&
          durableAuthorization &&
          durableAuthorization.authorizationSha256 === durableAuthorizationHash &&
          durableAuthorization.authorizationSha256 === recovery.authorizationSha256 &&
          durableAuthorization.authorizationId === recovery.authorizationId &&
          durableAuthorization.auditId === scope.auditId &&
          durableAuthorization.executionId === scope.executionId &&
          durableAuthorization.originalReservationId === recovery.originalReservationId;
        if (!authenticatedRecovery) {
          throw new Error("Narrative v2 recovery authorization identity or lineage mismatch");
        }
      } else if (
        role === "writer" &&
        passNumber === 1
      ) {
        if (existing.length !== 0) {
          throw new Error(
            "Narrative v2 live sequence requires Writer pass 1 as call 1",
          );
        }
      } else if (
        role === "judge" &&
        passNumber === 1
      ) {
        if (
          existing.length !== 1 ||
          existing[0].role !==
            "writer" ||
          existing[0].passNumber !== 1
        ) {
          throw new Error(
            "Narrative v2 live sequence requires Judge pass 1 as call 2 after Writer pass 1",
          );
        }

        await requireValidatedResult(
          scope,
          existing[0],
          "Judge pass 1",
        );
      } else if (
        role === "writer" &&
        passNumber === 2
      ) {
        const ordered =
          existing.length === 2 &&
          existing[0].role ===
            "writer" &&
          existing[0].passNumber === 1 &&
          existing[1].role ===
            "judge" &&
          existing[1].passNumber === 1;

        if (!ordered) {
          throw new Error(
            "Narrative v2 live sequence requires Writer pass 2 as call 3 after Writer 1 and Judge 1",
          );
        }

        await requireValidatedResult(
          scope,
          existing[1],
          "Writer pass 2",
        );

        if (
          previousJudgeResponse?.decision !==
            JUDGE_DECISION.REVISE ||
          previousJudgeResponse
            ?.revisionDirective
            ?.required !== true ||
          previousJudgeResponse
            ?.revisionDirective?.mode !==
            "TARGETED"
        ) {
          throw new Error(
            `Narrative v2 live call cap reached (${NARRATIVE_V2_LIVE_MAX_CALLS}); Judge pass 1 did not authorize Writer pass 2`,
          );
        }
      } else if (
        role === "judge" &&
        passNumber === 2
      ) {
        const ordered =
          existing.length === 3 &&
          existing[0].role ===
            "writer" &&
          existing[0].passNumber === 1 &&
          existing[1].role ===
            "judge" &&
          existing[1].passNumber === 1 &&
          existing[2].role ===
            "writer" &&
          existing[2].passNumber === 2;

        if (!ordered) {
          throw new Error(
            "Narrative v2 live sequence requires Judge pass 2 as call 4 after Writer 2",
          );
        }

        await requireValidatedResult(
          scope,
          existing[2],
          "Judge pass 2",
        );
      } else if (
        role === "writer" &&
        passNumber === 3
      ) {
        const ordered =
          existing.length === 4 &&
          existing[0].role ===
            "writer" &&
          existing[0].passNumber === 1 &&
          existing[1].role ===
            "judge" &&
          existing[1].passNumber === 1 &&
          existing[2].role ===
            "writer" &&
          existing[2].passNumber === 2 &&
          existing[3].role ===
            "judge" &&
          existing[3].passNumber === 2;

        if (!ordered) {
          throw new Error(
            "Narrative v2 final continuation requires completed Writer/Judge passes 1 and 2 before Writer pass 3",
          );
        }

        await requireValidatedResult(
          scope,
          existing[3],
          "Writer pass 3",
        );

        finalPassAuthorization =
          finalPassAuthorizations.get(
            scope.auditId,
          ) || null;

        if (!finalPassAuthorization) {
          throw new Error(
            "Narrative v2 Writer pass 3 requires explicit human final-pass authorization",
          );
        }

        if (
          previousJudgeResponse?.decision !==
            JUDGE_DECISION.REVISE ||
          previousJudgeResponse
            ?.revisionDirective
            ?.required !== true ||
          previousJudgeResponse
            ?.revisionDirective?.mode !==
            "TARGETED"
        ) {
          throw new Error(
            "Narrative v2 Writer pass 3 requires the validated Judge pass 2 targeted REVISE directive",
          );
        }
      } else if (
        role === "judge" &&
        passNumber === 3
      ) {
        const ordered =
          existing.length === 5 &&
          existing[0].role ===
            "writer" &&
          existing[0].passNumber === 1 &&
          existing[1].role ===
            "judge" &&
          existing[1].passNumber === 1 &&
          existing[2].role ===
            "writer" &&
          existing[2].passNumber === 2 &&
          existing[3].role ===
            "judge" &&
          existing[3].passNumber === 2 &&
          existing[4].role ===
            "writer" &&
          existing[4].passNumber === 3;

        if (!ordered) {
          throw new Error(
            "Narrative v2 final continuation requires Writer pass 3 as call 5 before Judge pass 3",
          );
        }

        await requireValidatedResult(
          scope,
          existing[4],
          "Judge pass 3",
        );

        finalPassAuthorization =
          finalPassAuthorizations.get(
            scope.auditId,
          ) || null;

        if (!finalPassAuthorization) {
          throw new Error(
            "Narrative v2 Judge pass 3 requires explicit human final-pass authorization",
          );
        }
      } else {
        throw new Error(
          `Narrative v2 live sequence permits only governed Writer/Judge passes 1 through 3; refusing ${role} pass ${passNumber}`,
        );
      }

      const modelPrice =
        config.priceTable[modelId];

      const committedSpend =
        await completedAuditSpend(
          scope,
          existing,
        );

      const remainingAuditBudget =
        Math.max(
          0,
          config.hardBudgetUsd -
            committedSpend,
        );

      const now = clock.now();
      const day = now.slice(0, 10);

      if (processDaily.date !== day) {
        processDaily.date = day;
        processDaily.reservedUsd =
          config.dailySpendUsd;
      }

      const preflight =
        runCostPreflight({
          reportPackage: { prompt },

          priceTable: modelPrice,

          budget: {
            softBudgetUsd:
              config.softBudgetUsd,
            hardBudgetUsd:
              remainingAuditBudget,
            dailyHardBudgetUsd:
              config.dailyHardBudgetUsd,
            dailySpendUsd:
              processDaily.reservedUsd,
          },

          modelConfig: {
            maxInputTokens:
              config.maxInputTokens,
            maxOutputTokens,
          },
        });

      if (!preflight.allowed) {
        throw new Error(
          `Narrative v2 cost preflight rejected ${role}: ${preflight.reason}`,
        );
      }

      const callNumber =
        existing.length + 1;

      const reservation =
        Object.freeze({
          contractVersion: "1.0.0",

          bindingVersion:
            NARRATIVE_V2_LIVE_BINDING_VERSION,

          reservationId: randomUUID(),

          auditId: scope.auditId,

          executionId:
            scope.executionId,

          callNumber,

          role,

          passNumber,

          modelId,

          ...(recoveryAuthorization
            ? {
                recoveryOfReservationId: recoveryAuthorization.originalReservationId,
                recoveryAuthorizationId: recoveryAuthorization.authorizationId,
              }
            : {}),

          ...(writerInputSha256 ? { writerInputSha256 } : {}),

          judgeRevisionSha256: objectSha256(previousJudgeResponse || null),

          promptSha256:
            sha256(prompt),

          estimatedInputTokens:
            preflight.estimate
              .inputTokens,

          maxOutputTokens,

          estimatedCost:
            preflight.estimate
              .maxCostUsd,

          reservedAt: now,

          status:
            NARRATIVE_V2_CALL_STATE.RESERVED,
        });

      await persistJson(
        artifactStore,
        scope,
        reservationName(callNumber),
        reservation,
      );

      processDaily.reservedUsd +=
        reservation.estimatedCost;

      return {
        callNumber,
        reservation,
        modelPrice,
      };
    } finally {
      inFlightReservationClaims.delete(
        inFlightKey,
      );
    }
  }

  async function persistReturnedFailure({
    scope,
    callNumber,
    reservation,
    role,
    passNumber,
    modelId,
    errorCode,
    responseStatus = null,
    responseSha256 = null,
    state = NARRATIVE_V2_CALL_STATE.POST_RESPONSE_LOCAL_FAILURE,
  }) {
    const record = Object.freeze({
      contractVersion: "1.0.0",

      bindingVersion:
        NARRATIVE_V2_LIVE_BINDING_VERSION,

      auditId: scope.auditId,

      executionId:
        scope.executionId,

      callNumber,

      role,

      passNumber,

      modelId,

      estimatedCost:
        reservation.estimatedCost,

      actualCost: null,

      validationResult: "FAIL",

      state,

      status:
        "RETURNED_RESPONSE_FAILED_CLOSED",

      errorCode,

      responseStatus,

      responseSha256,

      timestamp: clock.now(),
    });

    await persistJson(
      artifactStore,
      scope,
      resultName(callNumber),
      record,
    );
  }

  async function invoke({
    scope,
    role,
    modelId,
    prompt,
    maxOutputTokens,
    passNumber,
    validate,
    responseFormat,
    normalize = (value) => value,
    previousJudgeResponse = null,
    recoveryAuthorization = null,
    writerInputSha256 = null,
    writerInput = null,
  }) {
    // A final-pass restart may occur after Writer3 returned and validated
    // successfully but before Judge3 could be reserved. Reuse that exact
    // governed Writer3 result only when the model and prompt hash match.
    // No other pass or role is replayed through this recovery path.
    if (!recoveryAuthorization) {
      const existing = await existingReservations(scope);
      const prior = existing.find(
        (entry) => entry.role === role && entry.passNumber === passNumber,
      );
      if (prior) {
        const response = await readJsonByName(
          artifactStore,
          scope,
          responseName(prior.callNumber),
        );
        const responseMeta = await readJsonByName(
          artifactStore,
          scope,
          responseMetaName(prior.callNumber),
        );
        const responseState = await readJsonByName(
          artifactStore,
          scope,
          responseStateName(prior.callNumber),
        );
        const result = await readJsonByName(
          artifactStore,
          scope,
          resultName(prior.callNumber),
        );
        if (result?.validationResult === "FAIL") {
          throw new Error(
            `Narrative v2 paid ${role} pass ${passNumber} already reserved with a persisted failed result; refusing duplicate call`,
          );
        }
        if (responseMeta || responseState || result) {
          return resumePersistedCall({
            auditId: scope.auditId,
            callNumber: prior.callNumber,
            role,
            passNumber,
            modelId,
            promptSha256: sha256(prompt),
            writerInput,
            writerInputSha256,
            previousJudgeResponse,
            normalize,
            validate,
          });
        }
      }
    }

    if (
      role === "writer" &&
      passNumber === 3
    ) {
      const existing =
        await existingReservations(scope);

      const priorWriter =
        existing.find(
          (entry) =>
            entry.role === "writer" &&
            entry.passNumber === 3,
        ) || null;

      if (priorWriter) {
        if (
          priorWriter.modelId !== modelId ||
          priorWriter.promptSha256 !==
            sha256(prompt)
        ) {
          throw new Error(
            "Narrative v2 persisted Writer pass 3 does not match the current governed continuation",
          );
        }

        const [
          priorResult,
          priorResponse,
        ] = await Promise.all([
          readJsonByName(
            artifactStore,
            scope,
            resultName(
              priorWriter.callNumber,
            ),
          ),
          readJsonByName(
            artifactStore,
            scope,
            responseName(
              priorWriter.callNumber,
            ),
          ),
        ]);

        if (
          !priorResult ||
          priorResult.validationResult !==
            "PASS" ||
          !priorResponse
        ) {
          throw new Error(
            "Narrative v2 persisted Writer pass 3 is not a complete validated recovery artifact",
          );
        }

        const parsed =
          normalize(priorResponse);

        const validation =
          validate(parsed);

        const metadataValid =
          parsed?.modelId === modelId;

        if (
          !validation.valid ||
          !metadataValid
        ) {
          throw new Error(
            `Narrative v2 persisted Writer pass 3 failed recovery validation: ${[
              ...(validation.errors || []),
              ...(!metadataValid
                ? [
                    `modelId must equal configured Writer model ${modelId}`,
                  ]
                : []),
            ].join("; ")}`,
          );
        }

        return parsed;
      }
    }

    const {
      callNumber,
      reservation,
      modelPrice,
    } = await reserveCall({
      scope,
      role,
      modelId,
      prompt,
      maxOutputTokens,
      passNumber,
      previousJudgeResponse,
      recoveryAuthorization,
      writerInputSha256,
    });

    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      config.timeoutMs,
    );

    let response;

    try {
      response = await fetchImpl(
        config.chatCompletionsUrl,
        {
          method: "POST",

          headers: {
            authorization:
              `Bearer ${config.apiKey}`,
            "content-type":
              "application/json",
          },

          body: JSON.stringify({
            model: modelId,

            reasoning_effort: "medium",

            max_completion_tokens:
              maxOutputTokens,

            ...(responseFormat
              ? {
                  response_format:
                    responseFormat,
                }
              : {}),

            messages: [
              {
                role: "system",

                content:
                  `Return only valid JSON. Do not use markdown code fences. Use exactly ${JSON.stringify(
                    modelId,
                  )} as ${
                    role === "writer"
                      ? "modelId"
                      : "judgeModelId"
                  }.`,
              },

              {
                role: "user",
                content: prompt,
              },
            ],
          }),

          signal: controller.signal,
        },
      );
    } catch (err) {
      const transportError = Object.assign(new Error(
        `Narrative v2 ${role} request failed after paid-call reservation: ${
          err.name === "AbortError"
            ? "timeout"
            : "fetch failed"
        }`,
      ), { cause: err });
      await persistTransportOutcome({
        scope,
        reservation,
        error: err,
        state: isConcretePreTransmissionError(err)
          ? NARRATIVE_V2_CALL_STATE.TRANSPORT_FAILED_PRE_TRANSMISSION
          : NARRATIVE_V2_CALL_STATE.TRANSPORT_OUTCOME_UNCERTAIN,
        uncertaintyReason: isConcretePreTransmissionError(err)
          ? "concrete DNS lookup failure before request transmission"
          : "transport exception did not prove whether provider received the request",
      });
      if (recoveryAuthorization) {
        await persistReturnedFailure({
          scope,
          callNumber: reservation.callNumber,
          reservation,
          role,
          passNumber,
          modelId,
          errorCode: "RECOVERY_TRANSPORT_FAILED",
          state: NARRATIVE_V2_CALL_STATE.RECOVERY_FAILED,
        });
      }
      throw transportError;
    } finally {
      clearTimeout(timeout);
    }

    let body;
    let responseDigest = null;

    try {
      if (typeof response.text === "function") {
        const rawText = await response.text();
        responseDigest = sha256(rawText);
        await persistJson(artifactStore, scope, responseStateName(callNumber), {
          state: NARRATIVE_V2_CALL_STATE.RESPONSE_RETURNED,
          callNumber,
          role,
          passNumber,
          modelId,
          responseSha256: responseDigest,
          responseStatus: response.status || 200,
        });
        try {
          body = JSON.parse(rawText);
        } catch {
          await persistJson(artifactStore, scope, responseName(callNumber), { rawBody: rawText, status: response.status || 200 });
          await persistReturnedFailure({
            scope, callNumber, reservation, role, passNumber, modelId,
            errorCode: "PROVIDER_RESPONSE_NOT_JSON",
            responseStatus: response.status || 200,
            responseSha256: responseDigest,
            state: NARRATIVE_V2_CALL_STATE.POST_RESPONSE_LOCAL_FAILURE,
          });
          throw new Error(`Narrative v2 ${role} response was not JSON`);
        }
      } else {
        body = await response.json();
        responseDigest = sha256(JSON.stringify(body));
        await persistJson(artifactStore, scope, responseStateName(callNumber), {
          state: NARRATIVE_V2_CALL_STATE.RESPONSE_RETURNED,
          callNumber,
          role,
          passNumber,
          modelId,
          responseSha256: responseDigest,
          responseStatus: response.status || 200,
        });
      }
    } catch (err) {
      if (/response was not JSON/.test(err.message || "")) throw err;
      await persistReturnedFailure({
        scope,
        callNumber,
        reservation,
        role,
        passNumber,
        modelId,
        errorCode:
          "PROVIDER_RESPONSE_NOT_JSON",
        responseStatus:
          response.status || 200,
        responseSha256: responseDigest,
        state: NARRATIVE_V2_CALL_STATE.POST_RESPONSE_LOCAL_FAILURE,
      });

      throw new Error(
        `Narrative v2 ${role} response was not JSON`,
      );
    }

    if (!response?.ok) {
      await persistJson(artifactStore, scope, responseName(callNumber), body);
      await persistReturnedFailure({
        scope, callNumber, reservation, role, passNumber, modelId,
        errorCode: "PROVIDER_HTTP_ERROR",
        responseStatus: response?.status || 0,
        responseSha256: responseDigest,
        state: NARRATIVE_V2_CALL_STATE.RETURNED_PROVIDER_FAILURE,
      });
      throw safeProviderError(response?.status || 0);
    }

    let content;

    try {
      content = extractContent(body);
    } catch (err) {
      await persistJson(artifactStore, scope, responseName(callNumber), body);
      await persistReturnedFailure({
        scope,
        callNumber,
        reservation,
        role,
        passNumber,
        modelId,
        errorCode:
          "PROVIDER_CONTENT_MISSING",
        responseStatus:
          response.status || 200,
      });

      throw err;
    }

    let rawParsed;

    try {
      rawParsed = JSON.parse(content);
    } catch {
      await persistJson(artifactStore, scope, responseName(callNumber), body);
      await persistReturnedFailure({
        scope,
        callNumber,
        reservation,
        role,
        passNumber,
        modelId,
        errorCode:
          "PROVIDER_CONTENT_NOT_JSON",
        responseStatus:
          response.status || 200,
        responseSha256:
          sha256(content),
      });

      throw new Error(
        `Narrative v2 ${role} content was not a JSON object`,
      );
    }

    // Preserve the exact parsed governed model response for existing
    // restart/recovery consumers. The outer provider envelope is retained
    // for returned-failure paths above.
    await persistJson(artifactStore, scope, responseName(callNumber), rawParsed);

    const parsed = normalize(rawParsed);

    let usage;

    try {
      usage = extractUsage(body);
    } catch (err) {
      await persistReturnedFailure({
        scope,
        callNumber,
        reservation,
        role,
        passNumber,
        modelId,
        errorCode:
          "PROVIDER_USAGE_INVALID",
        responseStatus:
          response.status || 200,
        responseSha256:
          sha256(content),
      });

      throw err;
    }

    const validation =
      validate(parsed);

    const metadataErrors = [];

    if (
      role === "writer" &&
      parsed?.modelId !== modelId
    ) {
      metadataErrors.push(
        `modelId must equal configured Writer model ${modelId}`,
      );
    }

    if (
      role === "judge" &&
      parsed?.judgeModelId !== modelId
    ) {
      metadataErrors.push(
        `judgeModelId must equal configured Judge model ${modelId}`,
      );
    }

    const combinedValidation = {
      valid:
        validation.valid &&
        metadataErrors.length === 0,

      errors: [
        ...(validation.errors || []),
        ...metadataErrors,
      ],
    };

    const actualCost =
      estimateActualCost(
        usage,
        modelPrice,
      );

    await persistJson(artifactStore, scope, responseMetaName(callNumber), {
      state: NARRATIVE_V2_CALL_STATE.RESPONSE_RETURNED,
      responseSha256: responseDigest,
      responseContentSha256: sha256(content),
      usage,
    });

    processDaily.reservedUsd =
      Math.max(
        0,
        processDaily.reservedUsd -
          reservation.estimatedCost +
          actualCost,
      );

    const ledger =
      createUsageLedgerEntry({
        auditId: scope.auditId,

        executionId:
          scope.executionId,

        workflowVersion:
          NARRATIVE_V2_LIVE_BINDING_VERSION,

        nodeId:
          `narrative-v2-${role}`,

        mode:
          NARRATIVE_V2_LIVE_MODE,

        modelId,

        promptVersion:
          role === "writer"
            ? parsed?.promptVersion ||
              WRITER_PROMPT_VERSION
            : parsed?.judgePromptVersion ||
              JUDGE_PROMPT_VERSION,

        inputTokens:
          usage.inputTokens,

        outputTokens:
          usage.outputTokens,

        cachedInputTokens:
          usage.cachedInputTokens,

        estimatedCost:
          reservation.estimatedCost,

        actualCost,

        retryNumber: 0,

        cacheHit: false,

        validationResult:
          combinedValidation.valid
            ? "PASS"
            : "FAIL",

        timestamp: clock.now(),
      });

    const resultRecord =
      Object.freeze({
        ...ledger,

        bindingVersion:
          NARRATIVE_V2_LIVE_BINDING_VERSION,

        callNumber,

        role,

        passNumber,

        state: recoveryAuthorization
          ? NARRATIVE_V2_CALL_STATE.RECOVERY_COMPLETED
          : NARRATIVE_V2_CALL_STATE.CALL_COMPLETED,

        responseSha256:
          sha256(content),

        validationErrors:
          combinedValidation.valid
            ? []
            : combinedValidation.errors,
      });

    await persistJson(
      artifactStore,
      scope,
      resultName(callNumber),
      resultRecord,
    );

    if (!combinedValidation.valid) {
      throw new Error(
        `Narrative v2 ${role} validation failed: ${combinedValidation.errors.join(
          "; ",
        )}`,
      );
    }

    return parsed;
  }

  async function resumePersistedCall({
    auditId,
    callNumber,
    role,
    passNumber,
    modelId,
    promptSha256,
    writerInput,
    writerInputSha256 = null,
    previousJudgeResponse = null,
    normalize,
    validate,
  }) {
    const scope = resolveScope(auditId);
    const reservation = await readJsonByName(
      artifactStore,
      scope,
      reservationName(callNumber),
    );
    if (
      !reservation ||
      reservation.auditId !== scope.auditId ||
      reservation.executionId !== scope.executionId ||
      reservation.role !== role ||
      reservation.passNumber !== passNumber ||
      reservation.modelId !== modelId ||
      reservation.promptSha256 !== promptSha256 ||
      (writerInputSha256 && reservation.writerInputSha256 !== writerInputSha256) ||
      (writerInput && reservation.writerInputSha256 !== objectSha256(writerInput)) ||
      reservation.judgeRevisionSha256 !== objectSha256(previousJudgeResponse || null)
    ) {
      throw new Error("Narrative v2 persisted call identity mismatch");
    }

    const response = await readJsonByName(
      artifactStore,
      scope,
      responseName(callNumber),
    );
    const responseMeta = await readJsonByName(
      artifactStore,
      scope,
      responseMetaName(callNumber),
    );
    const result = await readJsonByName(
      artifactStore,
      scope,
      resultName(callNumber),
    );
    if (!response || !responseMeta) {
      throw new Error("Narrative v2 persisted response is unavailable for deterministic resume");
    }
    if (result?.validationResult === "PASS") {
      if (
        result.role !== role ||
        result.passNumber !== passNumber ||
        result.responseSha256 !== responseMeta.responseContentSha256
      ) {
        throw new Error("Narrative v2 persisted result identity mismatch");
      }
    }

    const parsed = normalize(response);
    const validation = validate(parsed);
    const metadataErrors = [];
    if (role === "writer" && parsed?.modelId !== modelId) {
      metadataErrors.push(`modelId must equal configured Writer model ${modelId}`);
    }
    if (role === "judge" && parsed?.judgeModelId !== modelId) {
      metadataErrors.push(`judgeModelId must equal configured Judge model ${modelId}`);
    }
    if (!validation.valid || metadataErrors.length > 0) {
      throw new Error(`Narrative v2 persisted ${role} resume validation failed: ${[
        ...(validation.errors || []),
        ...metadataErrors,
      ].join("; ")}`);
    }
    const usage = responseMeta.usage;
    if (!usage || !Number.isFinite(Number(usage.inputTokens)) || !Number.isFinite(Number(usage.outputTokens))) {
      throw new Error("Narrative v2 persisted response usage is unavailable for deterministic resume");
    }
    if (result?.validationResult === "PASS") return parsed;

    const modelPrice = config.priceTable[modelId];
    const actualCost = estimateActualCost(usage, modelPrice);
    const ledger = createUsageLedgerEntry({
      auditId: scope.auditId,
      executionId: scope.executionId,
      workflowVersion: NARRATIVE_V2_LIVE_BINDING_VERSION,
      nodeId: `narrative-v2-${role}`,
      mode: NARRATIVE_V2_LIVE_MODE,
      modelId,
      promptVersion: role === "writer" ? parsed.promptVersion || WRITER_PROMPT_VERSION : parsed.judgePromptVersion || JUDGE_PROMPT_VERSION,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      estimatedCost: reservation.estimatedCost,
      actualCost,
      retryNumber: 0,
      cacheHit: false,
      validationResult: "PASS",
      timestamp: clock.now(),
    });
    await persistJson(artifactStore, scope, resultName(callNumber), {
      ...ledger,
      bindingVersion: NARRATIVE_V2_LIVE_BINDING_VERSION,
      callNumber,
      role,
      passNumber,
      state: NARRATIVE_V2_CALL_STATE.CALL_COMPLETED,
      responseSha256: responseMeta.responseContentSha256,
      validationErrors: [],
    });
    return parsed;
  }

  async function writerExecutor(
    request,
  ) {
    const scope = resolveScope(
      request.writerInput.auditId,
    );

    return invoke({
      scope,

      role: "writer",

      modelId: config.writerModel,

      prompt: request.prompt,

      maxOutputTokens:
        config.writerMaxOutputTokens,

      passNumber:
        request.passNumber,

      previousJudgeResponse:
        request.judgeResponse || null,

      recoveryAuthorization:
        request.recoveryAuthorization || null,

      writerInputSha256:
        objectSha256(request.writerInput),

      writerInput: request.writerInput,

      responseFormat:
        buildWriterStructuredResponseFormat(
          {
            writerInput:
              request.writerInput,

            passNumber:
              request.passNumber,

            modelId:
              config.writerModel,
          },
        ),

      normalize:
        normalizeWriterModelOutput,

      validate: (output) =>
        validateWriterOutput(output, {
          writerInput:
            request.writerInput,

          expectedPassNumber:
            request.passNumber,

          ...(request.passNumber > 1
            ? {
                previousOutput:
                  request.previousOutput,

                revisionDirective:
                  request.judgeResponse
                    ?.revisionDirective,
              }
            : {}),
        }),
    });
  }

  async function judgeExecutor(
    request,
  ) {
    const scope = resolveScope(
      request.writerInput.auditId,
    );

    const prompt =
      judgePrompt(request);

    return invoke({
      scope,

      role: "judge",

      modelId: config.judgeModel,

      prompt,

      maxOutputTokens:
        config.judgeMaxOutputTokens,

      passNumber:
        request.passNumber,

      writerInputSha256:
        objectSha256(request.writerInput),

      writerInput: request.writerInput,

      responseFormat:
        buildJudgeStructuredResponseFormat(
          {
            writerInput:
              request.writerInput,

            passNumber:
              request.passNumber,

            modelId:
              config.judgeModel,
          },
        ),

      normalize:
        normalizeJudgeModelOutput,

      validate: (output) =>
        validateJudgeResponse(output, {
          writerInput:
            request.writerInput,

          expectedPassNumber:
            request.passNumber,
        }),
    });
  }

  Object.defineProperty(
    writerExecutor,
    "maxAutomaticPasses",
    {
      value:
        NARRATIVE_V2_LIVE_MAX_AUTOMATIC_PASSES,

      writable: false,

      configurable: false,

      enumerable: false,
    },
  );

  return Object.freeze({
    enabled: true,

    writerExecutor,

    judgeExecutor,

    registerAuditScope,

    resumePersistedCall,

    authorizeTransportRecovery,

    authorizeFinalPass,

    config: Object.freeze({
      writerModel:
        config.writerModel,

      judgeModel:
        config.judgeModel,

      maxInputTokens:
        config.maxInputTokens,

      writerMaxOutputTokens:
        config.writerMaxOutputTokens,

      judgeMaxOutputTokens:
        config.judgeMaxOutputTokens,

      hardBudgetUsd:
        config.hardBudgetUsd,

      dailyHardBudgetUsd:
        config.dailyHardBudgetUsd,

      maxCallsPerAudit:
        NARRATIVE_V2_LIVE_MAX_CALLS,

      maxTotalCallsPerAudit:
        NARRATIVE_V2_LIVE_MAX_TOTAL_CALLS,

      maxAutomaticPasses:
        NARRATIVE_V2_LIVE_MAX_AUTOMATIC_PASSES,
    }),
  });
}

export default {
  createNarrativeV2LiveBinding,
  loadNarrativeV2LiveConfig,
};

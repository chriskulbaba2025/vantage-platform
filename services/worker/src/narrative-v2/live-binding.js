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
 * - exactly two model calls maximum per audit (Writer then Judge);
 * - no network retry, repair loop, model escalation, or hidden fallback;
 * - deterministic token/cost preflight before every call;
 * - immutable reservation is persisted BEFORE a paid call so restart/recovery
 *   cannot silently repeat an uncertain paid attempt;
 * - usage/result ledger is persisted after every returned response;
 * - Writer/Judge outputs are validated at the executor boundary and again by
 *   the governed Narrative v2 orchestrator.
 */

import { createHash } from "node:crypto";

import { runCostPreflight } from "../narrative/cost-preflight.js";
import { createUsageLedgerEntry } from "../narrative/usage-ledger.js";
import { validateWriterOutput } from "./writer-output.js";
import { validateJudgeResponse } from "./judge-contract.js";

export const NARRATIVE_V2_LIVE_BINDING_VERSION = "1.0.0";
export const NARRATIVE_V2_LIVE_MAX_CALLS = 2;
export const NARRATIVE_V2_LIVE_MODE = "live";

const DEFAULT_TIMEOUT_MS = 120_000;
const RESERVATION_PREFIX = "narrative-v2/live-usage";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parsePositiveNumber(raw, label, { allowZero = false, integer = false } = {}) {
  const value = Number(raw);
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0) || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be ${allowZero ? "a non-negative" : "a positive"}${integer ? " integer" : " number"}`);
  }
  return value;
}

function requiredString(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function parsePriceTable(raw, writerModel, judgeModel) {
  let parsed;
  try {
    parsed = JSON.parse(requiredString(raw, "PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON"));
  } catch (err) {
    throw new Error(`PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON must be valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON must be an object keyed by model ID");
  }
  const out = {};
  for (const modelId of new Set([writerModel, judgeModel])) {
    const rec = parsed[modelId];
    if (!rec || typeof rec !== "object") throw new Error(`Price table missing model: ${modelId}`);
    out[modelId] = Object.freeze({
      inputPricePer1K: parsePositiveNumber(rec.inputPricePer1K, `${modelId}.inputPricePer1K`, { allowZero: true }),
      outputPricePer1K: parsePositiveNumber(rec.outputPricePer1K, `${modelId}.outputPricePer1K`, { allowZero: true }),
    });
  }
  return Object.freeze(out);
}

export function loadNarrativeV2LiveConfig(env = process.env) {
  const enabled = String(env.PRYSM_NARRATIVE_V2_ENABLED || "").toLowerCase() === "true";
  if (!enabled) return Object.freeze({ enabled: false });

  if (env.PRYSM_LLM_MODE !== NARRATIVE_V2_LIVE_MODE) {
    throw new Error("PRYSM_NARRATIVE_V2_ENABLED=true requires PRYSM_LLM_MODE=live");
  }

  const writerModel = requiredString(env.PRYSM_NARRATIVE_V2_WRITER_MODEL, "PRYSM_NARRATIVE_V2_WRITER_MODEL");
  const judgeModel = requiredString(env.PRYSM_NARRATIVE_V2_JUDGE_MODEL, "PRYSM_NARRATIVE_V2_JUDGE_MODEL");
  const config = {
    enabled: true,
    chatCompletionsUrl: requiredString(env.PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL, "PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL"),
    apiKey: requiredString(env.PRYSM_NARRATIVE_V2_API_KEY, "PRYSM_NARRATIVE_V2_API_KEY"),
    writerModel,
    judgeModel,
    maxInputTokens: parsePositiveNumber(env.PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS, "PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS", { integer: true }),
    writerMaxOutputTokens: parsePositiveNumber(env.PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS, "PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS", { integer: true }),
    judgeMaxOutputTokens: parsePositiveNumber(env.PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS, "PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS", { integer: true }),
    timeoutMs: env.PRYSM_NARRATIVE_V2_TIMEOUT_MS
      ? parsePositiveNumber(env.PRYSM_NARRATIVE_V2_TIMEOUT_MS, "PRYSM_NARRATIVE_V2_TIMEOUT_MS", { integer: true })
      : DEFAULT_TIMEOUT_MS,
    softBudgetUsd: parsePositiveNumber(env.PRYSM_LLM_SOFT_BUDGET_USD, "PRYSM_LLM_SOFT_BUDGET_USD", { allowZero: true }),
    hardBudgetUsd: parsePositiveNumber(env.PRYSM_LLM_HARD_BUDGET_USD, "PRYSM_LLM_HARD_BUDGET_USD"),
    dailyHardBudgetUsd: parsePositiveNumber(env.PRYSM_LLM_DAILY_HARD_BUDGET_USD, "PRYSM_LLM_DAILY_HARD_BUDGET_USD"),
    dailySpendUsd: env.PRYSM_LLM_DAILY_SPEND_USD
      ? parsePositiveNumber(env.PRYSM_LLM_DAILY_SPEND_USD, "PRYSM_LLM_DAILY_SPEND_USD", { allowZero: true })
      : 0,
    priceTable: null,
  };
  if (config.softBudgetUsd > config.hardBudgetUsd) {
    throw new Error("PRYSM_LLM_SOFT_BUDGET_USD cannot exceed PRYSM_LLM_HARD_BUDGET_USD");
  }
  if (config.hardBudgetUsd > config.dailyHardBudgetUsd) {
    throw new Error("PRYSM_LLM_HARD_BUDGET_USD cannot exceed PRYSM_LLM_DAILY_HARD_BUDGET_USD");
  }
  try {
    const url = new URL(config.chatCompletionsUrl);
    if (url.protocol !== "https:") throw new Error("URL must use https");
  } catch (err) {
    throw new Error(`PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL is invalid: ${err.message}`);
  }
  config.priceTable = parsePriceTable(env.PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON, writerModel, judgeModel);
  return Object.freeze(config);
}

function reservationName(callNumber) {
  return `${RESERVATION_PREFIX}/call-${String(callNumber).padStart(2, "0")}-reservation.json`;
}
function resultName(callNumber) {
  return `${RESERVATION_PREFIX}/call-${String(callNumber).padStart(2, "0")}-result.json`;
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

async function readJsonByName(artifactStore, scope, artifactName) {
  const key = `tenants/${scope.tenantId}/clients/${scope.clientId}/audits/${scope.auditId}/report-v2/${artifactName}`;
  let bytes;
  try { bytes = await artifactStore.get(key); } catch { return null; }
  if (!bytes) return null;
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

async function persistJson(artifactStore, scope, artifactName, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  const record = await artifactStore.put({
    bytes,
    contentType: "application/json",
    scope: scopeWithName(scope, artifactName),
  });
  const stored = await artifactStore.get(record.key);
  if (!stored || stored.length !== bytes.length || sha256(stored) !== record.sha256) {
    throw new Error(`Narrative v2 live ledger verification failed: ${artifactName}`);
  }
  if (typeof artifactStore.verify === "function" && !(await artifactStore.verify(record))) {
    throw new Error(`Narrative v2 live ledger store verification failed: ${artifactName}`);
  }
  return record;
}

function estimateActualCost(usage, price) {
  const input = Number(usage?.inputTokens || 0);
  const output = Number(usage?.outputTokens || 0);
  return Math.round((((input / 1000) * price.inputPricePer1K) + ((output / 1000) * price.outputPricePer1K)) * 1e8) / 1e8;
}

function extractUsage(body) {
  const usage = body?.usage || {};
  return {
    inputTokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
    outputTokens: Number(usage.completion_tokens || usage.output_tokens || 0),
    cachedInputTokens: Number(usage.prompt_tokens_details?.cached_tokens || usage.cached_input_tokens || 0),
  };
}

function extractContent(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Model response did not contain choices[0].message.content");
  }
  return content.trim();
}

function judgePrompt({ passNumber, writerInput, writerOutput, judgeContract }) {
  return [
    "You are the Prysm governed Narrative v2 Judge.",
    "Evaluate the WriterOutput against the exact WriterInput and frozen Judge contract below.",
    "Do not rewrite prose. Do not invent evidence, facts, findings, URLs, scores, or source states.",
    "Return ONLY one JSON object matching JudgeResponse contractVersion 1.0.0.",
    "The decision must follow the supplied deterministic thresholds. No markdown or code fences.",
    `PASS_NUMBER=${passNumber}`,
    `JUDGE_CONTRACT=${JSON.stringify(judgeContract)}`,
    `WRITER_INPUT=${JSON.stringify(writerInput)}`,
    `WRITER_OUTPUT=${JSON.stringify(writerOutput)}`,
  ].join("\n");
}

function safeProviderError(status) {
  const err = new Error(`Narrative v2 model request failed with HTTP ${status}`);
  err.code = "NARRATIVE_V2_PROVIDER_HTTP_ERROR";
  err.statusCode = status;
  return err;
}

export function createNarrativeV2LiveBinding({
  env = process.env,
  fetchImpl = globalThis.fetch,
  artifactStore,
  clock = { now: () => new Date().toISOString() },
} = {}) {
  const config = loadNarrativeV2LiveConfig(env);
  if (!config.enabled) {
    return Object.freeze({ enabled: false, registerAuditScope: () => {} });
  }
  if (typeof fetchImpl !== "function") throw new Error("Narrative v2 live binding requires fetch");
  if (!artifactStore) throw new Error("Narrative v2 live binding requires artifactStore");

  const scopes = new Map();
  const processDaily = { date: clock.now().slice(0, 10), reservedUsd: config.dailySpendUsd };

  function registerAuditScope({ tenantId, clientId, auditId, executionId }) {
    if (!tenantId || !clientId || !auditId) throw new Error("Narrative v2 audit scope requires tenantId, clientId, and auditId");
    scopes.set(auditId, Object.freeze({ tenantId, clientId, auditId, executionId: executionId || `${auditId}:narrative-v2` }));
  }

  function resolveScope(auditId) {
    const scope = scopes.get(auditId);
    if (!scope) throw new Error(`Narrative v2 live scope not registered for audit ${auditId}`);
    return scope;
  }

  async function existingReservations(scope) {
    const rows = [];
    for (let i = 1; i <= NARRATIVE_V2_LIVE_MAX_CALLS; i += 1) {
      const reservation = await readJsonByName(artifactStore, scope, reservationName(i));
      if (reservation) rows.push(reservation);
    }
    return rows;
  }

  async function reserveCall({ scope, role, modelId, prompt, maxOutputTokens, passNumber }) {
    const existing = await existingReservations(scope);
    if (existing.length >= NARRATIVE_V2_LIVE_MAX_CALLS) {
      throw new Error(`Narrative v2 live call cap reached (${NARRATIVE_V2_LIVE_MAX_CALLS})`);
    }
    if (existing.some((entry) => entry.role === role && entry.passNumber === passNumber)) {
      throw new Error(`Narrative v2 paid ${role} pass ${passNumber} already reserved; refusing duplicate call`);
    }

    const modelPrice = config.priceTable[modelId];
    const alreadyReserved = existing.reduce((sum, entry) => sum + Number(entry.estimatedCost || 0), 0);
    const remainingAuditBudget = Math.max(0, config.hardBudgetUsd - alreadyReserved);
    const now = clock.now();
    const day = now.slice(0, 10);
    if (processDaily.date !== day) {
      processDaily.date = day;
      processDaily.reservedUsd = config.dailySpendUsd;
    }

    const preflight = runCostPreflight({
      reportPackage: { prompt },
      priceTable: modelPrice,
      budget: {
        softBudgetUsd: config.softBudgetUsd,
        hardBudgetUsd: remainingAuditBudget,
        dailyHardBudgetUsd: config.dailyHardBudgetUsd,
        dailySpendUsd: processDaily.reservedUsd,
      },
      modelConfig: { maxInputTokens: config.maxInputTokens, maxOutputTokens },
    });
    if (!preflight.allowed) throw new Error(`Narrative v2 cost preflight rejected ${role}: ${preflight.reason}`);

    const callNumber = existing.length + 1;
    const reservation = Object.freeze({
      contractVersion: "1.0.0",
      bindingVersion: NARRATIVE_V2_LIVE_BINDING_VERSION,
      auditId: scope.auditId,
      executionId: scope.executionId,
      callNumber,
      role,
      passNumber,
      modelId,
      promptSha256: sha256(prompt),
      estimatedInputTokens: preflight.estimate.inputTokens,
      maxOutputTokens,
      estimatedCost: preflight.estimate.maxCostUsd,
      reservedAt: now,
      status: "RESERVED_BEFORE_CALL",
    });
    await persistJson(artifactStore, scope, reservationName(callNumber), reservation);
    processDaily.reservedUsd += reservation.estimatedCost;
    return { callNumber, reservation, modelPrice };
  }

  async function invoke({ scope, role, modelId, prompt, maxOutputTokens, passNumber, validate }) {
    const { callNumber, reservation, modelPrice } = await reserveCall({ scope, role, modelId, prompt, maxOutputTokens, passNumber });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await fetchImpl(config.chatCompletionsUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          temperature: 0,
          max_tokens: maxOutputTokens,
          messages: [
            { role: "system", content: "Return only valid JSON. Do not use markdown code fences." },
            { role: "user", content: prompt },
          ],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(`Narrative v2 ${role} request failed after paid-call reservation: ${err.name === "AbortError" ? "timeout" : err.message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response?.ok) throw safeProviderError(response?.status || 0);
    let body;
    try { body = await response.json(); } catch { throw new Error(`Narrative v2 ${role} response was not JSON`); }
    const content = extractContent(body);
    let parsed;
    try { parsed = JSON.parse(content); } catch { throw new Error(`Narrative v2 ${role} content was not a JSON object`); }

    const validation = validate(parsed);
    const usage = extractUsage(body);
    const actualCost = estimateActualCost(usage, modelPrice);
    const ledger = createUsageLedgerEntry({
      auditId: scope.auditId,
      executionId: scope.executionId,
      workflowVersion: NARRATIVE_V2_LIVE_BINDING_VERSION,
      nodeId: `narrative-v2-${role}`,
      mode: NARRATIVE_V2_LIVE_MODE,
      modelId,
      promptVersion: role === "writer" ? parsed?.promptVersion || "2.0.0" : parsed?.judgePromptVersion || "2.0.0",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      estimatedCost: reservation.estimatedCost,
      actualCost,
      retryNumber: 0,
      cacheHit: false,
      validationResult: validation.valid ? "PASS" : "FAIL",
      timestamp: clock.now(),
    });
    const resultRecord = Object.freeze({
      ...ledger,
      bindingVersion: NARRATIVE_V2_LIVE_BINDING_VERSION,
      callNumber,
      role,
      passNumber,
      responseSha256: sha256(content),
      validationErrors: validation.valid ? [] : validation.errors,
    });
    await persistJson(artifactStore, scope, resultName(callNumber), resultRecord);

    if (!validation.valid) {
      throw new Error(`Narrative v2 ${role} validation failed: ${validation.errors.join("; ")}`);
    }
    return parsed;
  }

  async function writerExecutor(request) {
    const scope = resolveScope(request.writerInput.auditId);
    return invoke({
      scope,
      role: "writer",
      modelId: config.writerModel,
      prompt: request.prompt,
      maxOutputTokens: config.writerMaxOutputTokens,
      passNumber: request.passNumber,
      validate: (output) => validateWriterOutput(output, {
        writerInput: request.writerInput,
        expectedPassNumber: request.passNumber,
        ...(request.passNumber > 1 ? {
          previousOutput: request.previousOutput,
          revisionDirective: request.judgeResponse?.revisionDirective,
        } : {}),
      }),
    });
  }

  async function judgeExecutor(request) {
    const scope = resolveScope(request.writerInput.auditId);
    const prompt = judgePrompt(request);
    return invoke({
      scope,
      role: "judge",
      modelId: config.judgeModel,
      prompt,
      maxOutputTokens: config.judgeMaxOutputTokens,
      passNumber: request.passNumber,
      validate: (output) => validateJudgeResponse(output, {
        writerInput: request.writerInput,
        expectedPassNumber: request.passNumber,
      }),
    });
  }

  return Object.freeze({
    enabled: true,
    writerExecutor,
    judgeExecutor,
    registerAuditScope,
    config: Object.freeze({
      writerModel: config.writerModel,
      judgeModel: config.judgeModel,
      maxInputTokens: config.maxInputTokens,
      writerMaxOutputTokens: config.writerMaxOutputTokens,
      judgeMaxOutputTokens: config.judgeMaxOutputTokens,
      hardBudgetUsd: config.hardBudgetUsd,
      dailyHardBudgetUsd: config.dailyHardBudgetUsd,
      maxCallsPerAudit: NARRATIVE_V2_LIVE_MAX_CALLS,
    }),
  });
}

export default { createNarrativeV2LiveBinding, loadNarrativeV2LiveConfig };

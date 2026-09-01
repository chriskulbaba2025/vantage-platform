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

export const NARRATIVE_V2_LIVE_BINDING_VERSION = "1.0.0";
export const NARRATIVE_V2_LIVE_MAX_CALLS = 4;
export const NARRATIVE_V2_LIVE_MAX_TOTAL_CALLS = 6;
export const NARRATIVE_V2_LIVE_MAX_AUTOMATIC_PASSES = 2;
export const NARRATIVE_V2_LIVE_MODE = "live";

const DEFAULT_TIMEOUT_MS = 120_000;
const RESERVATION_PREFIX = "narrative-v2/live-usage";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

  async function reserveCall({
    scope,
    role,
    modelId,
    prompt,
    maxOutputTokens,
    passNumber,
    previousJudgeResponse = null,
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

      if (
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
            "RESERVED_BEFORE_CALL",
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
  }) {
    // A final-pass restart may occur after Writer3 returned and validated
    // successfully but before Judge3 could be reserved. Reuse that exact
    // governed Writer3 result only when the model and prompt hash match.
    // No other pass or role is replayed through this recovery path.
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
      throw new Error(
        `Narrative v2 ${role} request failed after paid-call reservation: ${
          err.name === "AbortError"
            ? "timeout"
            : err.message
        }`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response?.ok) {
      await persistReturnedFailure({
        scope,
        callNumber,
        reservation,
        role,
        passNumber,
        modelId,
        errorCode:
          "PROVIDER_HTTP_ERROR",
        responseStatus:
          response?.status || 0,
      });

      throw safeProviderError(
        response?.status || 0,
      );
    }

    let body;

    try {
      body = await response.json();
    } catch {
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
      });

      throw new Error(
        `Narrative v2 ${role} response was not JSON`,
      );
    }

    let content;

    try {
      content = extractContent(body);
    } catch (err) {
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

    // Preserve the exact parsed provider response before any deterministic
    // structural normalization. This closes the prior forensic blind spot.
    await persistJson(
      artifactStore,
      scope,
      responseName(callNumber),
      rawParsed,
    );

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

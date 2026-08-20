// PRYSM Narrative v2 — governed three-pass orchestration controller.
//
// This controller is intentionally model/provider agnostic. It owns only the
// deterministic sequencing boundary between the governed Writer and Judge:
// Writer -> Writer validation -> Judge -> Judge validation -> targeted rewrite
// -> final gate. Production lifecycle, persistence, renderer and model wiring
// remain outside this module until separately authorized.

import {
  HARD_GATE_CODES,
  JUDGE_CONTRACT_VERSION,
  JUDGE_DECISION,
  MAX_NARRATIVE_PASSES,
  MIN_DIMENSION_RATIO,
  NARRATIVE_PASS_SCORE,
  NEXT_ACTION,
  RUBRIC,
  nextActionForJudge,
  validateJudgeResponse,
} from "./judge-contract.js";
import { WRITER_INPUT_VERSION } from "./writer-input.js";
import { validateWriterOutput } from "./writer-output.js";
import { buildWriterPrompt } from "./writer-prompt.js";

export const NARRATIVE_V2_ORCHESTRATION_VERSION = "1.0.0";

export const NARRATIVE_V2_STATUS = Object.freeze({
  RELEASE_CANDIDATE: NEXT_ACTION.RELEASE_CANDIDATE,
  HUMAN_REVIEW_REQUIRED: JUDGE_DECISION.HUMAN_REVIEW_REQUIRED,
});

export const NARRATIVE_V2_ERROR = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  WRITER_PROMPT_FAILED: "WRITER_PROMPT_FAILED",
  WRITER_EXECUTION_FAILED: "WRITER_EXECUTION_FAILED",
  WRITER_OUTPUT_INVALID: "WRITER_OUTPUT_INVALID",
  JUDGE_EXECUTION_FAILED: "JUDGE_EXECUTION_FAILED",
  JUDGE_RESPONSE_INVALID: "JUDGE_RESPONSE_INVALID",
  INVALID_NEXT_ACTION: "INVALID_NEXT_ACTION",
});

export const JUDGE_RUNTIME_CONTRACT = Object.freeze({
  contractVersion: JUDGE_CONTRACT_VERSION,
  maxNarrativePasses: MAX_NARRATIVE_PASSES,
  narrativePassScore: NARRATIVE_PASS_SCORE,
  minimumDimensionRatio: MIN_DIMENSION_RATIO,
  rubric: RUBRIC,
  hardGateCodes: HARD_GATE_CODES,
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export class NarrativeV2OrchestrationError extends Error {
  constructor(code, message, { passNumber, stage, validationErrors, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "NarrativeV2OrchestrationError";
    this.code = code;
    if (passNumber !== undefined) this.passNumber = passNumber;
    if (stage) this.stage = stage;
    if (Array.isArray(validationErrors)) {
      this.validationErrors = Object.freeze([...validationErrors]);
    }
  }
}

function assertControllerInputs({ writerInput, writerExecutor, judgeExecutor }) {
  const errors = [];
  if (!isObject(writerInput)) errors.push("writerInput must be an object");
  if (isObject(writerInput) && writerInput.contractVersion !== "1.0.0") {
    errors.push("writerInput.contractVersion must equal 1.0.0");
  }
  if (isObject(writerInput) && writerInput.writerInputVersion !== WRITER_INPUT_VERSION) {
    errors.push(`writerInput.writerInputVersion must equal ${WRITER_INPUT_VERSION}`);
  }
  if (isObject(writerInput) && !nonEmptyString(writerInput.auditId)) errors.push("writerInput.auditId is required");
  if (isObject(writerInput) && !isObject(writerInput.referenceIndex)) errors.push("writerInput.referenceIndex is required");
  if (typeof writerExecutor !== "function") errors.push("writerExecutor must be a function");
  if (typeof judgeExecutor !== "function") errors.push("judgeExecutor must be a function");

  if (errors.length) {
    throw new NarrativeV2OrchestrationError(
      NARRATIVE_V2_ERROR.INVALID_INPUT,
      `Narrative v2 orchestration input rejected: ${errors.join("; ")}`,
      { stage: "INPUT", validationErrors: errors },
    );
  }
}

function buildTerminalResult({ writerInput, status, passNumber, writerOutput, judgeResponse, history }) {
  return deepFreeze({
    contractVersion: "1.0.0",
    orchestrationVersion: NARRATIVE_V2_ORCHESTRATION_VERSION,
    auditId: writerInput.auditId,
    status,
    passCount: passNumber,
    finalWriterOutput: writerOutput,
    finalJudgeResponse: judgeResponse,
    passes: Object.freeze([...history]),
  });
}

/**
 * Run the governed Writer/Judge narrative v2 loop.
 *
 * The controller does not call a provider or model directly. `writerExecutor`
 * and `judgeExecutor` are injected execution seams. Tests use deterministic
 * controlled executors; future production wiring may place a governed model
 * client below those seams without changing the orchestration contract.
 *
 * @param {object} options
 * @param {object} options.writerInput governed WriterInput packet
 * @param {function} options.writerExecutor async ({ prompt, passNumber, writerInput, previousOutput?, judgeResponse? }) => WriterOutput
 * @param {function} options.judgeExecutor async ({ passNumber, writerInput, writerOutput, judgeContract }) => JudgeResponse
 * @returns {Promise<object>} terminal governed orchestration result
 */
export async function runNarrativeV2Orchestration({
  writerInput,
  writerExecutor,
  judgeExecutor,
}) {
  assertControllerInputs({ writerInput, writerExecutor, judgeExecutor });

  // Freeze the exact governed input once. Every pass consumes this same object.
  const governedWriterInput = deepFreeze(writerInput);
  const history = [];
  let previousOutput;
  let previousJudgeResponse;

  for (let passNumber = 1; passNumber <= MAX_NARRATIVE_PASSES; passNumber += 1) {
    let prompt;
    try {
      prompt = buildWriterPrompt({
        writerInput: governedWriterInput,
        passNumber,
        ...(passNumber > 1
          ? {
              previousOutput,
              judgeResponse: previousJudgeResponse,
            }
          : {}),
      });
    } catch (cause) {
      throw new NarrativeV2OrchestrationError(
        NARRATIVE_V2_ERROR.WRITER_PROMPT_FAILED,
        `Writer prompt construction failed on pass ${passNumber}: ${cause.message}`,
        { passNumber, stage: "WRITER_PROMPT", cause },
      );
    }

    let candidateWriterOutput;
    try {
      const writerRequest = deepFreeze({
        prompt,
        passNumber,
        writerInput: governedWriterInput,
        ...(passNumber > 1
          ? {
              previousOutput,
              judgeResponse: previousJudgeResponse,
            }
          : {}),
      });
      candidateWriterOutput = await writerExecutor(writerRequest);
    } catch (cause) {
      throw new NarrativeV2OrchestrationError(
        NARRATIVE_V2_ERROR.WRITER_EXECUTION_FAILED,
        `Writer execution failed on pass ${passNumber}: ${cause.message}`,
        { passNumber, stage: "WRITER_EXECUTION", cause },
      );
    }

    const writerValidation = validateWriterOutput(candidateWriterOutput, {
      writerInput: governedWriterInput,
      expectedPassNumber: passNumber,
      ...(passNumber > 1
        ? {
            previousOutput,
            revisionDirective: previousJudgeResponse.revisionDirective,
          }
        : {}),
    });

    if (!writerValidation.valid) {
      throw new NarrativeV2OrchestrationError(
        NARRATIVE_V2_ERROR.WRITER_OUTPUT_INVALID,
        `Writer output validation failed on pass ${passNumber}: ${writerValidation.errors.join("; ")}`,
        {
          passNumber,
          stage: "WRITER_VALIDATION",
          validationErrors: writerValidation.errors,
        },
      );
    }

    // Single validated-object rule: the same validated object is frozen and
    // handed to the Judge; no reconstruction happens between boundaries.
    const writerOutput = deepFreeze(candidateWriterOutput);

    let candidateJudgeResponse;
    try {
      const judgeRequest = deepFreeze({
        passNumber,
        writerInput: governedWriterInput,
        writerOutput,
        judgeContract: JUDGE_RUNTIME_CONTRACT,
      });
      candidateJudgeResponse = await judgeExecutor(judgeRequest);
    } catch (cause) {
      throw new NarrativeV2OrchestrationError(
        NARRATIVE_V2_ERROR.JUDGE_EXECUTION_FAILED,
        `Judge execution failed on pass ${passNumber}: ${cause.message}`,
        { passNumber, stage: "JUDGE_EXECUTION", cause },
      );
    }

    const judgeValidation = validateJudgeResponse(candidateJudgeResponse, {
      writerInput: governedWriterInput,
      expectedPassNumber: passNumber,
    });

    if (!judgeValidation.valid) {
      throw new NarrativeV2OrchestrationError(
        NARRATIVE_V2_ERROR.JUDGE_RESPONSE_INVALID,
        `Judge response validation failed on pass ${passNumber}: ${judgeValidation.errors.join("; ")}`,
        {
          passNumber,
          stage: "JUDGE_VALIDATION",
          validationErrors: judgeValidation.errors,
        },
      );
    }

    const judgeResponse = deepFreeze(candidateJudgeResponse);
    const passRecord = deepFreeze({ passNumber, writerOutput, judgeResponse });
    history.push(passRecord);

    const nextAction = nextActionForJudge(judgeResponse);

    if (nextAction === NEXT_ACTION.RELEASE_CANDIDATE) {
      return buildTerminalResult({
        writerInput: governedWriterInput,
        status: NARRATIVE_V2_STATUS.RELEASE_CANDIDATE,
        passNumber,
        writerOutput,
        judgeResponse,
        history,
      });
    }

    if (nextAction === NEXT_ACTION.HUMAN_REVIEW) {
      return buildTerminalResult({
        writerInput: governedWriterInput,
        status: NARRATIVE_V2_STATUS.HUMAN_REVIEW_REQUIRED,
        passNumber,
        writerOutput,
        judgeResponse,
        history,
      });
    }

    if (nextAction !== NEXT_ACTION.WRITE_NEXT_PASS || judgeResponse.decision !== JUDGE_DECISION.REVISE) {
      throw new NarrativeV2OrchestrationError(
        NARRATIVE_V2_ERROR.INVALID_NEXT_ACTION,
        `Governed next action is invalid on pass ${passNumber}: ${String(nextAction)}`,
        { passNumber, stage: "NEXT_ACTION" },
      );
    }

    // A valid Pass 3 Judge response can never authorize another write because
    // deriveJudgeDecision() converts every non-passing Pass 3 into human review.
    if (passNumber >= MAX_NARRATIVE_PASSES) {
      throw new NarrativeV2OrchestrationError(
        NARRATIVE_V2_ERROR.INVALID_NEXT_ACTION,
        "Pass 3 cannot authorize an automatic Pass 4",
        { passNumber, stage: "NEXT_ACTION" },
      );
    }

    previousOutput = writerOutput;
    previousJudgeResponse = judgeResponse;
  }

  throw new NarrativeV2OrchestrationError(
    NARRATIVE_V2_ERROR.INVALID_NEXT_ACTION,
    "Narrative v2 orchestration exhausted without a governed terminal state",
    { stage: "NEXT_ACTION" },
  );
}

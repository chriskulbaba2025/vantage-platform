// PRYSM Narrative v2 — governed validation bridge for canonical report rendering.
//
// Writer/Judge outputs are validated at this boundary for the existing
// orchestration contract, but are intentionally not serialized into the client
// report artifact. Client remediation is owned by the deterministic report-v2
// renderer and its canonical solution records.

import { NARRATIVE_V2_STATUS } from "../narrative-v2/orchestrator.js";
import { validateWriterOutput } from "../narrative-v2/writer-output.js";
import { renderReportV2 } from "./render-report-v2.js";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertGovernedRenderInput({ model, writerInput, orchestrationResult }) {
  const errors = [];

  if (!isObject(model)) errors.push("model is required");
  if (!isObject(writerInput)) errors.push("writerInput is required");
  if (!isObject(orchestrationResult)) errors.push("orchestrationResult is required");

  if (isObject(orchestrationResult) && orchestrationResult.status !== NARRATIVE_V2_STATUS.RELEASE_CANDIDATE) {
    errors.push("orchestrationResult must be RELEASE_CANDIDATE");
  }

  const output = orchestrationResult?.finalWriterOutput;
  const judge = orchestrationResult?.finalJudgeResponse;

  if (!isObject(output)) errors.push("finalWriterOutput is required");
  if (!isObject(judge)) errors.push("finalJudgeResponse is required");

  if (writerInput?.auditId && orchestrationResult?.auditId && writerInput.auditId !== orchestrationResult.auditId) {
    errors.push("writerInput auditId does not match orchestrationResult");
  }

  if (output?.auditId && writerInput?.auditId && output.auditId !== writerInput.auditId) {
    errors.push("finalWriterOutput auditId does not match writerInput");
  }

  if (output?.passNumber !== orchestrationResult?.passCount) {
    errors.push("finalWriterOutput passNumber does not match orchestrationResult.passCount");
  }

  if (judge?.passNumber !== orchestrationResult?.passCount) {
    errors.push("finalJudgeResponse passNumber does not match orchestrationResult.passCount");
  }

  if (judge?.decision !== "PASS") errors.push("finalJudgeResponse must be PASS");

  if (errors.length) {
    throw new Error(`Narrative v2 render input rejected: ${errors.join("; ")}`);
  }

  const previousPass = orchestrationResult.passCount > 1
    ? orchestrationResult.passes?.[orchestrationResult.passCount - 2]
    : null;

  const validation = validateWriterOutput(output, {
    writerInput,
    expectedPassNumber: orchestrationResult.passCount,
    ...(previousPass ? {
      previousOutput: previousPass.writerOutput,
      revisionDirective: previousPass.judgeResponse?.revisionDirective,
    } : {}),
  });

  if (!validation.valid) {
    throw new Error(`Narrative v2 WriterOutput revalidation failed: ${validation.errors.join("; ")}`);
  }
}

/**
 * Render a client-facing report from a governed release candidate.
 *
 * Writer/Judge results are validated above for the existing orchestration
 * boundary, then deliberately excluded from the client artifact. The
 * deterministic report-v2 renderer is the sole client remediation boundary.
 */
export function renderGovernedNarrativeReportV2({ model, writerInput, orchestrationResult, date }) {
  assertGovernedRenderInput({ model, writerInput, orchestrationResult });

  // Preserve the existing validation-boundary immutability guarantees.
  Object.freeze(writerInput);
  Object.freeze(orchestrationResult.finalWriterOutput);
  Object.freeze(orchestrationResult.finalJudgeResponse);

  return renderReportV2(model, { date });
}

export default {
  renderGovernedNarrativeReportV2,
};

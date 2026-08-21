import test from "node:test";
import assert from "node:assert/strict";

import { buildWriterPrompt } from "./writer-prompt.js";

const writerInput = Object.freeze({
  contractVersion: "1.0.0",
  writerInputVersion: "1.0.0",
  auditId: "11111111-1111-4111-8111-111111111111",
  scoreGovernance: {
    sourceDependencies: { backlinks: "FAILED" },
  },
  referenceIndex: {
    "source:backlinks": {
      kind: "source-status",
      path: "scoreGovernance.sourceDependencies.backlinks",
    },
  },
});

function assertLimitationGroundingRule(prompt) {
  assert.match(prompt, /For every limitations\[\] item/);
  assert.match(prompt, /status MUST exactly equal one governed source or capability status/);
  assert.match(prompt, /clientExplanation, whatThisMeans, and whatThisDoesNotMean/);
  assert.match(prompt, /kind source-status or capability/);
  assert.match(prompt, /resolves to that same status/);
  assert.match(prompt, /Finding-only references do not ground limitation status/);
}

test("WRITER-PROMPT-04: limitation status grounding contract is explicit on initial and revision prompts", () => {
  const initialPrompt = buildWriterPrompt({ writerInput, passNumber: 1 });
  assertLimitationGroundingRule(initialPrompt);

  const revisionPrompt = buildWriterPrompt({
    writerInput,
    passNumber: 2,
    previousOutput: {},
    judgeResponse: {
      decision: "REVISE",
      defects: [],
      revisionDirective: {
        required: true,
        mode: "TARGETED",
        fieldsToRewrite: ["limitations"],
        fieldsLocked: [],
        defectIds: [],
      },
    },
  });
  assertLimitationGroundingRule(revisionPrompt);
});

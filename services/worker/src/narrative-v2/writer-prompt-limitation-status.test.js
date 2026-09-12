import test from "node:test";
import assert from "node:assert/strict";

import { buildWriterPrompt } from "./writer-prompt.js";

const writerInput = Object.freeze({
  contractVersion: "1.0.0",
  writerInputVersion: "1.2.0",
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

function assertConversionPathAuthorityRule(prompt) {
  assert.doesNotMatch(prompt, /path clarity measures completion of that invitation/);
  assert.match(prompt, /CTA clarity assesses the observed invitation/);
  assert.match(prompt, /conversion-path clarity assesses the observed route from that invitation toward the next step/);
  assert.match(prompt, /Path clarity does not establish that visitors completed the action or converted/);
  assert.match(prompt, /A visible form, CTA, enquiry route, or conversion-path condition is not a confirmed conversion/);
  assert.ok(prompt.indexOf("8d.") < prompt.indexOf("11a."));
}

test("WRITER-PROMPT-05: conversion-path clarity cannot be read as measured completion", () => {
  const initialPrompt = buildWriterPrompt({ writerInput, passNumber: 1 });
  assertConversionPathAuthorityRule(initialPrompt);

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
        fieldsToRewrite: ["conversion"],
        fieldsLocked: [],
        defectIds: [],
      },
    },
  });
  assertConversionPathAuthorityRule(revisionPrompt);
});

test("WRITER-PROMPT-06: performance implications remain bounded in decision labels", () => {
  const prompt = buildWriterPrompt({ writerInput, passNumber: 1 });
  assert.match(prompt, /name the measured technical condition/);
  assert.match(prompt, /MUST NOT upgrade that metric into an established user condition anywhere/);
});

test("WRITER-PROMPT-07: semantic class prevents metric-to-effect and route-to-usability upgrades", () => {
  const prompt = buildWriterPrompt({ writerInput, passNumber: 1 });
  assert.match(prompt, /every similar headline, title, label, summary, or body field/);
  assert.match(prompt, /performance friction condition/);
  assert.match(prompt, /A clear, visible, or interactable route is an observed route only/);
  assert.match(prompt, /usable foundation/);
  assert.match(prompt, /direct evidence measures usability or outcomes/);
});

import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createNarrativeV2LiveBinding } from "./live-binding.js";
import {
  buildWriterStructuredOutputSchema,
  buildWriterStructuredResponseFormat,
} from "./writer-structured-output.js";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";

function writerInput() {
  return {
    contractVersion: "1.0.0",
    writerInputVersion: "1.0.0",
    auditId: AUDIT_ID,
    findings: [{ findingId: "F-001", title: "Verified finding" }],
    scoreGovernance: {
      sourceDependencies: {
        website: "AVAILABLE",
        backlinks: "FAILED",
      },
    },
    capabilityContext: {
      capabilities: {
        competitors: {
          capability: "competitors",
          status: "PARTIAL",
        },
      },
    },
    referenceIndex: {
      "finding:F-001": { kind: "finding", path: "findings.0" },
      "source:website": { kind: "source-status", path: "scoreGovernance.sourceDependencies.website" },
      "source:backlinks": { kind: "source-status", path: "scoreGovernance.sourceDependencies.backlinks" },
      "capability:competitors": { kind: "capability", path: "capabilityContext.capabilities.competitors" },
    },
  };
}

function baseEnv() {
  return {
    PRYSM_NARRATIVE_V2_ENABLED: "true",
    PRYSM_LLM_MODE: "live",
    PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL: "https://llm.example.test/v1/chat/completions",
    PRYSM_NARRATIVE_V2_API_KEY: "test-secret-never-log",
    PRYSM_NARRATIVE_V2_WRITER_MODEL: "writer-structured",
    PRYSM_NARRATIVE_V2_JUDGE_MODEL: "judge-structured",
    PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS: "500000",
    PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_NARRATIVE_V2_TIMEOUT_MS: "5000",
    PRYSM_LLM_SOFT_BUDGET_USD: "0.20",
    PRYSM_LLM_HARD_BUDGET_USD: "0.50",
    PRYSM_LLM_DAILY_HARD_BUDGET_USD: "5.00",
    PRYSM_LLM_DAILY_SPEND_USD: "0",
    PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON: JSON.stringify({
      "writer-structured": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
      "judge-structured": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
    }),
  };
}

test("WRITER-STRUCT-01: schema fixes deterministic statement classes and metadata", () => {
  const schema = buildWriterStructuredOutputSchema({
    writerInput: writerInput(),
    passNumber: 1,
    modelId: "gpt-5.6-terra",
  });

  assert.deepEqual(schema.properties.contractVersion.enum, ["1.0.0"]);
  assert.deepEqual(schema.properties.auditId.enum, [AUDIT_ID]);
  assert.deepEqual(schema.properties.passNumber.enum, [1]);
  assert.deepEqual(schema.properties.modelId.enum, ["gpt-5.6-terra"]);
  assert.deepEqual(schema.properties.promptVersion.enum, ["2.0.0"]);
  assert.deepEqual(
    schema.properties.conversion.properties.priority.properties.statementClass.enum,
    ["INTERPRETATION"],
  );
  assert.deepEqual(
    schema.properties.aiSearch.properties.opportunity.properties.statementClass.enum,
    ["OPPORTUNITY"],
  );
  assert.equal(schema.additionalProperties, false);
});

test("WRITER-STRUCT-02: limitation status branches bind evidence refs to the same governed status", () => {
  const schema = buildWriterStructuredOutputSchema({
    writerInput: writerInput(),
    passNumber: 1,
    modelId: "gpt-5.6-terra",
  });

  const branches = schema.properties.limitations.items.anyOf;
  assert.equal(Array.isArray(branches), true);
  const failed = branches.find((branch) => branch.properties.status.enum[0] === "FAILED");
  const partial = branches.find((branch) => branch.properties.status.enum[0] === "PARTIAL");
  assert.deepEqual(failed.properties.clientExplanation.properties.evidenceRefs.items.enum, ["source:backlinks"]);
  assert.deepEqual(failed.properties.whatThisMeans.properties.evidenceRefs.items.enum, ["source:backlinks"]);
  assert.deepEqual(partial.properties.whatThisDoesNotMean.properties.evidenceRefs.items.enum, ["capability:competitors"]);
});

test("WRITER-STRUCT-03: live Writer request sends OpenAI strict json_schema response_format", async () => {
  const artifactStore = createMemoryArtifactStore();
  let requestBody;
  const binding = createNarrativeV2LiveBinding({
    env: baseEnv(),
    artifactStore,
    clock: { now: () => "2026-08-21T03:45:00.000Z" },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });
  binding.registerAuditScope({
    tenantId: "tenant-structured",
    clientId: "client-structured",
    auditId: AUDIT_ID,
    executionId: "execution-structured",
  });

  await assert.rejects(
    () => binding.writerExecutor({
      prompt: "writer governed prompt",
      passNumber: 1,
      writerInput: writerInput(),
    }),
    /HTTP 503/,
  );

  assert.equal(requestBody.response_format.type, "json_schema");
  assert.equal(requestBody.response_format.json_schema.strict, true);
  assert.equal(requestBody.response_format.json_schema.name, "prysm_narrative_v2_writer_output");
  assert.deepEqual(
    requestBody.response_format.json_schema.schema.properties.conversion.properties.priority.properties.statementClass.enum,
    ["INTERPRETATION"],
  );
  assert.equal("response_format" in requestBody, true);
});

test("WRITER-STRUCT-04: response format wrapper is deterministic", () => {
  const args = { writerInput: writerInput(), passNumber: 1, modelId: "gpt-5.6-terra" };
  assert.deepEqual(buildWriterStructuredResponseFormat(args), buildWriterStructuredResponseFormat(args));
});

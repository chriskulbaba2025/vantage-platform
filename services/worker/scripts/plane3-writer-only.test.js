import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  APPROVED_INPUTS,
  EXPECTED_CANDIDATE_SHA,
  runWriterOnlySample,
  resolveApprovedInput,
} from "./plane3-writer-only.mjs";
import {
  buildControlledWriterOutput,
} from "./current-replay-controlled-narrative.js";
import {
  createNarrativeV2LiveBinding,
} from "../src/narrative-v2/live-binding.js";
import {
  createFsArtifactStore,
} from "../src/storage/fs-artifact-store.js";

const TBK = "9714c206-8ed3-4686-8fe2-ceeca0ca0f82";
const REBOOT = "97d6b2c7-03b9-4530-8ea7-16557502c638";

const config = {
  writerModel: "mock-writer",
  hardBudgetUsd: 5,
  dailyHardBudgetUsd: 30,
};

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "plane3-writer-only-test-"));
}

function mockBindingFactory({ calls, judgeCalls, output = null } = {}) {
  return ({ artifactStore, requireDurableStore }) => {
    assert.equal(requireDurableStore, true);
    assert.ok(artifactStore);
    return {
      enabled: true,
      config,
      registerAuditScope() {},
      writerExecutor: async ({ writerInput, passNumber }) => {
        calls?.push({ writerInput, passNumber });
        return output || buildControlledWriterOutput({ writerInput, passNumber });
      },
      judgeExecutor: async () => {
        judgeCalls?.push(true);
      },
    };
  };
}

test("PLANE3-01: only the two explicitly approved frozen inputs resolve", async () => {
  assert.deepEqual(Object.keys(APPROVED_INPUTS).sort(), [TBK, REBOOT].sort());
  const tbk = await resolveApprovedInput({ auditId: TBK });
  const reboot = await resolveApprovedInput({ auditId: REBOOT });
  assert.equal(tbk.writerInput.auditId, TBK);
  assert.equal(reboot.writerInput.auditId, REBOOT);
  await assert.rejects(
    resolveApprovedInput({ auditId: "00000000-0000-4000-8000-000000000000" }),
    /unapproved audit ID/,
  );
});

test("PLANE3-02: each sample uses the existing Writer seam, never Judge, and records governed metadata", async () => {
  const root = await tempRoot();
  const calls = [];
  const judgeCalls = [];
  const result = await runWriterOnlySample({
    auditId: TBK,
    ledgerRoot: root,
    candidateSha: EXPECTED_CANDIDATE_SHA,
    bindingFactory: mockBindingFactory({ calls, judgeCalls }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].passNumber, 1);
  assert.equal(judgeCalls.length, 0);
  assert.equal(result.manifest.validationResult, "PASS");
  assert.equal(result.manifest.finalStatus, "WRITER_VALIDATED");
  assert.equal(result.manifest.writerPromptVersion, "2.3.0");
  assert.equal(result.manifest.writerOutputVersion, "1.0.0");
  assert.equal(result.manifest.modelCalls, 1);
  assert.equal(result.manifest.judgeCalls, 0);
  assert.equal(result.manifest.providerRecollection, "NONE");
  assert.equal(result.manifest.evidenceRescore, "NO");
  const persisted = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.equal(persisted.executionId, result.manifest.executionId);
  assert.equal(persisted.ledgerDurability, "FILESYSTEM");
});

test("PLANE3-03: executions receive distinct identities and isolated ledgers", async () => {
  const root = await tempRoot();
  const first = await runWriterOnlySample({
    auditId: TBK,
    ledgerRoot: root,
    bindingFactory: mockBindingFactory(),
  });
  const second = await runWriterOnlySample({
    auditId: TBK,
    ledgerRoot: root,
    bindingFactory: mockBindingFactory(),
  });
  assert.notEqual(first.manifest.executionId, second.manifest.executionId);
  assert.notEqual(first.manifest.ledgerPath, second.manifest.ledgerPath);
});

test("PLANE3-04: historical fixture paths cannot be used as a ledger", async () => {
  await assert.rejects(
    runWriterOnlySample({
      auditId: TBK,
      ledgerRoot: join(process.cwd(), "test-fixtures"),
      bindingFactory: mockBindingFactory(),
    }),
    /must be outside/,
  );
});

test("PLANE3-05: Writer validation failure is a governed failure and does not invoke Judge", async () => {
  const root = await tempRoot();
  const calls = [];
  const result = await runWriterOnlySample({
    auditId: REBOOT,
    ledgerRoot: root,
    calls,
    bindingFactory: mockBindingFactory({ calls, output: {} }),
  });
  assert.equal(calls.length, 1);
  assert.equal(result.manifest.validationResult, "FAIL");
  assert.equal(result.manifest.finalStatus, "WRITER_VALIDATION_FAILED");
  assert.ok(result.manifest.validationErrors.length > 0);
  assert.equal(result.manifest.judgeCalls, 0);
});

test("PLANE3-06: the real binding owns cost preflight and rejects before fetch under budget failure", async () => {
  const root = await tempRoot();
  let fetchCalls = 0;
  const env = {
    PRYSM_NARRATIVE_V2_ENABLED: "true",
    PRYSM_LLM_MODE: "live",
    PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL: "https://llm.example.test/v1/chat/completions",
    PRYSM_NARRATIVE_V2_API_KEY: "test-only-secret",
    PRYSM_NARRATIVE_V2_WRITER_MODEL: "writer-test",
    PRYSM_NARRATIVE_V2_JUDGE_MODEL: "judge-test",
    PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS: "1",
    PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS: "1",
    PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS: "1",
    PRYSM_LLM_SOFT_BUDGET_USD: "0",
    PRYSM_LLM_HARD_BUDGET_USD: "0.000001",
    PRYSM_LLM_DAILY_HARD_BUDGET_USD: "0.000001",
    PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON: JSON.stringify({
      "writer-test": { inputPricePer1K: 1, outputPricePer1K: 1 },
      "judge-test": { inputPricePer1K: 1, outputPricePer1K: 1 },
    }),
  };
  const result = await runWriterOnlySample({
    auditId: TBK,
    env,
    ledgerRoot: root,
    bindingFactory: (options) => createNarrativeV2LiveBinding({
      ...options,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("fetch must not be reached");
      },
    }),
  });
  assert.equal(fetchCalls, 0);
  assert.equal(result.manifest.validationResult, "FAIL");
  assert.match(result.manifest.error, /cost preflight rejected/);
});

test("PLANE3-07: the harness source has no provider recollection or rescore path", async () => {
  const source = await readFile(new URL("./plane3-writer-only.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /dataforseo|pagespeed|backlinks|crawl|scoreAudit|runAudit/iu);
  assert.match(source, /writerExecutor/);
  assert.doesNotMatch(source, /judgeExecutor\(/);
});

test("PLANE3-08: live production binding requires a durable store while tests may use mocked seams", async () => {
  const root = await tempRoot();
  const input = await resolveApprovedInput({ auditId: TBK });
  const env = {
    PRYSM_NARRATIVE_V2_ENABLED: "true",
    PRYSM_LLM_MODE: "live",
    PRYSM_NARRATIVE_V2_CHAT_COMPLETIONS_URL: "https://llm.example.test/v1/chat/completions",
    PRYSM_NARRATIVE_V2_API_KEY: "test-only-secret",
    PRYSM_NARRATIVE_V2_WRITER_MODEL: "writer-test",
    PRYSM_NARRATIVE_V2_JUDGE_MODEL: "judge-test",
    PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS: "500000",
    PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS: "10000",
    PRYSM_LLM_SOFT_BUDGET_USD: "0.5",
    PRYSM_LLM_HARD_BUDGET_USD: "2",
    PRYSM_LLM_DAILY_HARD_BUDGET_USD: "10",
    PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON: JSON.stringify({
      "writer-test": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
      "judge-test": { inputPricePer1K: 0.001, outputPricePer1K: 0.002 },
    }),
  };
  assert.ok(input.writerInput.auditId);
  assert.throws(
    () => createNarrativeV2LiveBinding({
      env,
      artifactStore: { put() {}, get() {}, exists() {}, verify() {} },
      requireDurableStore: true,
      fetchImpl: async () => {},
    }),
    /requires a durable artifact store/,
  );
  const store = createFsArtifactStore({ baseDir: root });
  assert.ok(createNarrativeV2LiveBinding({
    env,
    artifactStore: store,
    requireDurableStore: true,
    fetchImpl: async () => {},
  }).enabled);
});

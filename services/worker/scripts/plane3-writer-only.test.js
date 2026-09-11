import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  APPROVED_INPUTS,
  AUTHORIZED_TOOLING_OVERLAY_PATHS,
  SEMANTIC_APPLICATION_BASE_SHA,
  runWriterOnlySample,
  resolveApprovedInput,
  verifyRuntimeIdentity,
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

const config = {
  writerModel: "mock-writer",
  hardBudgetUsd: 5,
  dailyHardBudgetUsd: 30,
};

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "plane3-writer-only-test-"));
}

const testRuntimeIdentity = async () => ({
  semanticApplicationBaseSha: SEMANTIC_APPLICATION_BASE_SHA,
  toolingHeadSha: "test-tooling-head",
  worktreeClean: true,
  boundedOverlayVerified: true,
  changedPaths: [...AUTHORIZED_TOOLING_OVERLAY_PATHS],
});

async function runSampleForTest(options) {
  return runWriterOnlySample({ ...options, identityVerifier: testRuntimeIdentity });
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

function fakeGit({ head = "tooling-head", changedPaths = AUTHORIZED_TOOLING_OVERLAY_PATHS, dirty = "", ancestor = true, root = process.cwd() } = {}) {
  return async (args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { stdout: root };
    if (args[0] === "rev-parse" && args[1] === "--verify") return { stdout: `${SEMANTIC_APPLICATION_BASE_SHA}\n` };
    if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: `${head}\n` };
    if (args[0] === "status") return { stdout: dirty };
    if (args[0] === "merge-base") {
      if (!ancestor) throw new Error("not an ancestor");
      return { stdout: "" };
    }
    if (args[0] === "diff") return { stdout: `${changedPaths.join("\n")}\n` };
    throw new Error(`Unexpected fake git command: ${args.join(" ")}`);
  };
}

test("PLANE3-ID: semantic base and tooling HEAD are separate, and bounded overlay is accepted", async () => {
  const identity = await verifyRuntimeIdentity({
    repositoryRootOverride: process.cwd(),
    runGitCommand: fakeGit({ head: "61303af4d7d567c2d77eb61379b98dff6f1974aa" }),
  });
  assert.equal(identity.semanticApplicationBaseSha, SEMANTIC_APPLICATION_BASE_SHA);
  assert.equal(identity.toolingHeadSha, "61303af4d7d567c2d77eb61379b98dff6f1974aa");
  assert.notEqual(identity.semanticApplicationBaseSha, identity.toolingHeadSha);
  assert.equal(identity.boundedOverlayVerified, true);
  assert.deepEqual(identity.changedPaths, AUTHORIZED_TOOLING_OVERLAY_PATHS);
});

test("PLANE3-ID: the exact published semantic base is accepted with no overlay", async () => {
  const identity = await verifyRuntimeIdentity({
    repositoryRootOverride: process.cwd(),
    runGitCommand: fakeGit({ head: SEMANTIC_APPLICATION_BASE_SHA, changedPaths: [] }),
  });
  assert.equal(SEMANTIC_APPLICATION_BASE_SHA, "d7ce3cfe69d5ada8f6d4541c8a9603f17e932a97");
  assert.equal(identity.semanticApplicationBaseSha, "d7ce3cfe69d5ada8f6d4541c8a9603f17e932a97");
  assert.equal(identity.toolingHeadSha, "d7ce3cfe69d5ada8f6d4541c8a9603f17e932a97");
  assert.deepEqual(identity.changedPaths, []);
  assert.equal(identity.boundedOverlayVerified, true);
});

test("PLANE3-ID: semantic application source changes above the base fail closed", async () => {
  await assert.rejects(
    verifyRuntimeIdentity({
      repositoryRootOverride: process.cwd(),
      runGitCommand: fakeGit({ changedPaths: ["services/worker/src/narrative-v2/writer-output.js"] }),
    }),
    /unauthorized paths/,
  );
  await assert.rejects(
    verifyRuntimeIdentity({
      repositoryRootOverride: process.cwd(),
      runGitCommand: fakeGit({ changedPaths: ["services/worker/src/narrative-v2/writer-output.test.js"] }),
    }),
    /unauthorized paths/,
  );
});

test("PLANE3-ID: unbounded, dirty, non-ancestor, and wrong-root overlays fail closed", async () => {
  await assert.rejects(
    verifyRuntimeIdentity({
      repositoryRootOverride: process.cwd(),
      runGitCommand: fakeGit({ changedPaths: [...AUTHORIZED_TOOLING_OVERLAY_PATHS, "services/worker/src/index.js"] }),
    }),
    /unauthorized paths/,
  );
  await assert.rejects(
    verifyRuntimeIdentity({ repositoryRootOverride: process.cwd(), runGitCommand: fakeGit({ dirty: " M file.js" }) }),
    /clean worktree/,
  );
  await assert.rejects(
    verifyRuntimeIdentity({ repositoryRootOverride: process.cwd(), runGitCommand: fakeGit({ ancestor: false }) }),
    /not a descendant/,
  );
  await assert.rejects(
    verifyRuntimeIdentity({ repositoryRootOverride: process.cwd(), runGitCommand: fakeGit({ root: "C:\\other-repository" }) }),
    /repository root identity/,
  );
});

test("PLANE3-ID: executable path uses shared verifier and has no direct HEAD-equals-base comparison", async () => {
  const source = await readFile(new URL("./plane3-writer-only.mjs", import.meta.url), "utf8");
  assert.match(source, /verifyRuntimeIdentity/);
  assert.doesNotMatch(source, /currentCandidateSha/);
  assert.doesNotMatch(source, /candidateSha !==/);
});

test("PLANE3-01: only the two explicitly approved frozen inputs resolve", async () => {
  assert.deepEqual(Object.keys(APPROVED_INPUTS), [TBK]);
  const tbk = await resolveApprovedInput({ auditId: TBK });
  assert.equal(tbk.writerInput.auditId, TBK);
  await assert.rejects(
    resolveApprovedInput({ auditId: "97d6b2c7-03b9-4530-8ea7-16557502c638" }),
    /unapproved audit ID/,
  );
});

test("PLANE3-02: each sample uses the existing Writer seam, never Judge, and records governed metadata", async () => {
  const root = await tempRoot();
  const calls = [];
  const judgeCalls = [];
  const result = await runSampleForTest({
    auditId: TBK,
    ledgerRoot: root,
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
  const first = await runSampleForTest({
    auditId: TBK,
    ledgerRoot: root,
    bindingFactory: mockBindingFactory(),
  });
  const second = await runSampleForTest({
    auditId: TBK,
    ledgerRoot: root,
    bindingFactory: mockBindingFactory(),
  });
  assert.notEqual(first.manifest.executionId, second.manifest.executionId);
  assert.notEqual(first.manifest.ledgerPath, second.manifest.ledgerPath);
});

test("PLANE3-04: historical fixture paths cannot be used as a ledger", async () => {
  await assert.rejects(
    runSampleForTest({
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
  const result = await runSampleForTest({
    auditId: TBK,
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

async function copyCurrentTbkFixture(root) {
  const workerFixture = join(root, "services", "worker", "test-fixtures", "plane3-current-uat", "tbk-9714c206");
  const workerRequest = join(root, "services", "worker", "test-fixtures", "report-replay-offline", "audit-9714c206-8ed3-4686-8fe2-ceeca0ca0f82-current", "governed", "canonical");
  await mkdir(workerFixture, { recursive: true });
  await mkdir(workerRequest, { recursive: true });
  const sourceFixture = join(process.cwd(), "test-fixtures", "plane3-current-uat", "tbk-9714c206");
  const sourceRequest = join(process.cwd(), "test-fixtures", "report-replay-offline", "audit-9714c206-8ed3-4686-8fe2-ceeca0ca0f82-current", "governed", "canonical", "audit-request.json");
  for (const name of ["scores.json", "findings.json", "writer-input.json", "derivation-manifest.json"]) {
    await cp(join(sourceFixture, name), join(workerFixture, name));
  }
  await cp(sourceRequest, join(workerRequest, "audit-request.json"));
  return workerFixture;
}

test("PLANE3-UAT: current TBK fixture is accepted with bounded authority and current versions", async () => {
  const selected = await resolveApprovedInput({ auditId: TBK });
  assert.equal(selected.writerInput.writerInputVersion, "1.2.0");
  assert.equal(selected.scoreSet.contractVersion, "2.0.0");
  assert.equal(selected.manifest.ga4CommercialOutcomeAuthority, "PAUSED");
  assert.equal(selected.manifest.rootCauseRuleId, "VAN-CONTENT-002");
  assert.ok(selected.writerInput.findings.every((finding) => finding.businessImpactContext?.basis === "INFERRED"));
});

test("PLANE3-UAT: stale, malformed, missing, mismatched, and altered current fixtures fail closed", async () => {
  const cases = [
    ["stale WriterInput version", (fixture) => fixture("writer-input.json", (value) => ({ ...value, writerInputVersion: "1.0.0" }))],
    ["legacy WriterInput 1.1 version", (fixture) => fixture("writer-input.json", (value) => ({ ...value, writerInputVersion: "1.1.0" }))],
    ["wrong WriterInput hash", (fixture) => fixture("derivation-manifest.json", (value) => ({ ...value, derivativeHashes: { ...value.derivativeHashes, "writer-input.json": "0".repeat(64) } }))],
    ["wrong audit ID", (fixture) => fixture("derivation-manifest.json", (value) => ({ ...value, auditId: "00000000-0000-4000-8000-000000000000" }))],
    ["altered scores", (fixture) => fixture("scores.json", (value) => ({ ...value, overallScore: 0 }))],
    ["altered findings", (fixture) => fixture("findings.json", (value) => value.slice(0, -1))],
    ["missing manifest", (fixture) => fixture.removeManifest()],
  ];
  for (const [label, mutate] of cases) {
    const root = await tempRoot();
    const fixtureRoot = await copyCurrentTbkFixture(root);
    const fixture = async (name, transform) => {
      const file = join(fixtureRoot, name);
      const value = JSON.parse(await readFile(file, "utf8"));
      await writeFile(file, `${JSON.stringify(transform(value), null, 2)}\n`, "utf8");
    };
    fixture.removeManifest = async () => { await (await import("node:fs/promises")).unlink(join(fixtureRoot, "derivation-manifest.json")); };
    await mutate(fixture, fixtureRoot);
    await assert.rejects(resolveApprovedInput({ auditId: TBK, appRoot: root }), undefined, label);
  }
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
  const result = await runSampleForTest({
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

test("PLANE3-ID: mock manifest records the exact published semantic candidate", async () => {
  const root = await tempRoot();
  const exactBaseIdentity = async () => ({
    semanticApplicationBaseSha: "d7ce3cfe69d5ada8f6d4541c8a9603f17e932a97",
    toolingHeadSha: "d7ce3cfe69d5ada8f6d4541c8a9603f17e932a97",
    worktreeClean: true,
    boundedOverlayVerified: true,
    changedPaths: [],
  });
  const result = await runWriterOnlySample({
    auditId: TBK,
    ledgerRoot: root,
    identityVerifier: exactBaseIdentity,
    bindingFactory: mockBindingFactory(),
  });
  assert.equal(result.manifest.candidateSha, "d7ce3cfe69d5ada8f6d4541c8a9603f17e932a97");
  assert.equal(result.manifest.semanticApplicationBaseSha, "d7ce3cfe69d5ada8f6d4541c8a9603f17e932a97");
  assert.equal(result.manifest.toolingHeadSha, "d7ce3cfe69d5ada8f6d4541c8a9603f17e932a97");
  assert.deepEqual(result.manifest.changedPaths, []);
});

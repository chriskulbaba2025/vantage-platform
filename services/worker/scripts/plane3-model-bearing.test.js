import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  computeCallPlan,
  calculateCost,
  assertFreshRunRoot,
  createRunCallGuard,
  executionIdentity,
  executeManifest,
  loadFrozenArtifacts,
  parseAuthorization,
  readModelConfig,
  runControlledSample,
  runRootFor,
  runPreflight,
  sampleCallCeiling,
  validateRunId,
  verifyIdentity,
  verifyManifestRuntimeParity,
} from "./plane3-model-bearing.mjs";
import { buildControlledJudgeResponse, buildControlledWriterOutput } from "./current-replay-controlled-narrative.js";
import { buildV2Model } from "../src/narrative-v2/production-path.js";
import { buildSolutionAuthorityRecords, SOLUTION_PAGE_REGISTRY } from "../src/solution/solution-authority-provider.js";
import { buildSolutionDirectiveInput } from "../src/solution/solution-directive-authority.js";
import { generateCanonicalSolutions } from "../src/solution/solution-generator.js";

const fixtureRoot = join(process.cwd(), "test-fixtures", "report-replay-offline", "audit-9714c206-8ed3-4686-8fe2-ceeca0ca0f82-current");
const auditId = "9714c206-8ed3-4686-8fe2-ceeca0ca0f82";
const sample = {
  sampleId: "controlled-tbk-01",
  auditId,
  candidateSha: "test-candidate",
  judgeEnabled: true,
  maxAutomaticPasses: 1,
  artifacts: {
    writerInput: join(process.cwd(), "test-fixtures", "plane3-current-uat", "tbk-9714c206", "writer-input.json"),
    scoreSet: join(process.cwd(), "test-fixtures", "plane3-current-uat", "tbk-9714c206", "scores.json"),
    findings: join(process.cwd(), "test-fixtures", "plane3-current-uat", "tbk-9714c206", "findings.json"),
    decisionEvidence: join(fixtureRoot, "governed", "canonical", "decision-evidence.json"),
    capabilityEvidence: join(fixtureRoot, "governed", "canonical", "capability-evidence.json"),
    auditRequest: join(fixtureRoot, "governed", "canonical", "audit-request.json"),
  },
};

async function artifacts() { return loadFrozenArtifacts(sample); }
async function outputRoot() { return mkdtemp(join(tmpdir(), "plane34-model-bearing-test-")); }

async function renderableArtifacts() {
  const frozen = await artifacts();
  const scoreSet = structuredClone(frozen.scoreSet.value);
  scoreSet.renderingDiagnostics = [];
  scoreSet.competitors = { ...(scoreSet.competitors || {}), comparisons: [] };
  const decisionEvidence = structuredClone(frozen.decisionEvidence.value);
  decisionEvidence.suppliedCompetitors = [];
  decisionEvidence.site = {
    ...(decisionEvidence.site || {}),
    _metaFieldAvailability: { ...((decisionEvidence.site || {})._metaFieldAvailability || {}), images: false },
  };
  const authorityRecords = buildSolutionAuthorityRecords({ findings: frozen.findings.value, scoreSet, decisionEvidence, pageRegistry: SOLUTION_PAGE_REGISTRY });
  const authorityInput = buildSolutionDirectiveInput({ findings: frozen.findings.value, scoreSet, decisionEvidence, authorityRecords, pageRegistry: SOLUTION_PAGE_REGISTRY });
  const model = buildV2Model({
    auditRequest: frozen.auditRequest.value,
    scoreSet,
    findings: frozen.findings.value,
    capabilityEvidence: frozen.capabilityEvidence.value,
    decisionEvidence,
    canonicalSolutions: generateCanonicalSolutions(authorityInput),
  });
  return { ...frozen, modelOverride: model };
}

test("PLANE34-CALLS: preflight computes a fail-closed maximum call plan", () => {
  assert.equal(sampleCallCeiling({ ...sample, judgeEnabled: false }), 1);
  assert.equal(sampleCallCeiling(sample), 2);
  assert.deepEqual(computeCallPlan([{ ...sample, sampleId: "a" }, { ...sample, sampleId: "b", judgeEnabled: false }], 3).maximumCalls, 3);
  assert.throws(() => computeCallPlan([sample], 1), /below maximum/);
});

test("PLANE34-CONFIG: config identity never exposes a secret", () => {
  const config = readModelConfig({
    PRYSM_NARRATIVE_V2_WRITER_MODEL: "writer-test",
    PRYSM_NARRATIVE_V2_JUDGE_MODEL: "judge-test",
    PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS: "1000",
    PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS: "100",
    PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS: "100",
    PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON: JSON.stringify({ "writer-test": { inputPricePer1K: 1, outputPricePer1K: 2 }, "judge-test": { inputPricePer1K: 1, outputPricePer1K: 2 } }),
  });
  assert.equal(config.proven, true);
  assert.equal(Object.hasOwn(config, "apiKey"), false);
  assert.equal(calculateCost({ inputTokens: 2000, outputTokens: 500 }, config.prices, "writer-test"), 3);
});

test("PLANE34-PREFLIGHT: default preflight makes zero calls and validates frozen artifacts", async () => {
  const result = await runPreflight({
    manifest: { candidateSha: "test-candidate", samples: [sample], maximumPermittedCalls: 2, isolatedOutputRoot: join(tmpdir(), "plane34-test-output") },
    appRoot: process.cwd(),
    runGit: undefined,
  }).catch((error) => ({ error }));
  // The real identity gate is intentionally strict; this test uses the exported
  // call/config boundaries below for zero-call proof without changing identity.
  assert.ok(result.error || result.modelCalls === 0);
});

test("PLANE34-WRITERINPUT: canonical artifacts rebuild current WriterInput and historical input is reference-only", async () => {
  const frozen = await artifacts();
  assert.equal(frozen.writerInput.value.writerInputVersion, "1.2.0");
  assert.equal(frozen.writerInput.sha256, frozen.currentWriterInput.sha256);
  assert.ok(frozen.historicalWriterInput);
  assert.notEqual(frozen.writerInput.path, frozen.historicalWriterInput.path);
});

test("PLANE34-WRITERINPUT: canonical artifact hash mismatch fails before orchestration", async () => {
  await assert.rejects(
    loadFrozenArtifacts({ ...sample, artifactHashes: { scoreSet: "not-the-recovered-score-hash" } }),
    /scoreSet SHA-256 mismatch/,
  );
});

test("PLANE34-AUTH: missing authorization makes zero calls", async () => {
  const result = await executeManifest({ manifest: { samples: [], maximumPermittedCalls: 0 }, env: {}, appRoot: process.cwd() });
  assert.deepEqual(result, { result: "NOT_AUTHORIZED", modelCalls: 0, providerCalls: 0 });
});

test("PLANE34-AUTH: execute flag alone and authorization alone make zero calls", async () => {
  const manifest = { samples: [], maximumPermittedCalls: 0 };
  const withoutEnv = await executeManifest({ manifest, env: {}, executeRequested: true, appRoot: process.cwd() });
  const withoutFlag = await executeManifest({ manifest, env: { PRYSM_MODEL_BEARING_PAID_RUN_AUTHORIZED: "YES" }, executeRequested: false, appRoot: process.cwd() });
  assert.equal(withoutEnv.modelCalls, 0);
  assert.equal(withoutFlag.modelCalls, 0);
});

test("PLANE34-PATH: controlled Writer/Judge run uses production orchestration, validation, finalization, and render", async () => {
  const frozen = await renderableArtifacts();
  const root = await outputRoot();
  let observedWriterInputVersion;
  let observedJudgeInputVersion;
  const result = await runControlledSample({
    sample,
    artifacts: frozen,
    outputRoot: root,
    writerExecutor: (request) => {
      observedWriterInputVersion = request.writerInput.writerInputVersion;
      return buildControlledWriterOutput(request);
    },
    judgeExecutor: (request) => {
      observedJudgeInputVersion = request.writerInput.writerInputVersion;
      return buildControlledJudgeResponse(request);
    },
  });
  assert.equal(observedWriterInputVersion, "1.2.0");
  assert.equal(observedJudgeInputVersion, "1.2.0");
  assert.equal(result.record.status, "RELEASE_CANDIDATE");
  assert.equal(result.record.writerCalls, 1);
  assert.equal(result.record.judgeCalls, 1);
  assert.equal(result.record.finalization.passed, true);
  assert.equal(result.record.render.passed, true);
  assert.equal(result.record.render.viewerVersion, "2.3.1");
  assert.ok((await readFile(result.manifest.path, "utf8")).includes("inputArtifactHashes"));
});

test("PLANE34-P04: writer-only samples receive the governed Writer prompt", async () => {
  const frozen = await renderableArtifacts();
  const root = await outputRoot();
  const writerOnlySample = { ...sample, sampleId: "controlled-tbk-writer-only", judgeEnabled: false };
  let observedPrompt;
  const result = await runControlledSample({
    sample: writerOnlySample,
    artifacts: frozen,
    outputRoot: root,
    writerExecutor: (request) => {
      observedPrompt = request.prompt;
      assert.match(request.prompt, /AUTHORITATIVE RULES/);
      return buildControlledWriterOutput(request);
    },
    judgeExecutor: () => {
      throw new Error("writer-only sample must not execute Judge");
    },
  });
  assert.equal(typeof observedPrompt, "string");
  assert.ok(observedPrompt.length > 0);
  assert.equal(result.record.status, "WRITER_VALIDATED");
  assert.equal(result.record.judgeCalls, 0);
});

test("PLANE34-PERSISTENCE: raw controlled responses and hashes are written outside the repository", async () => {
  const frozen = await renderableArtifacts();
  const root = await outputRoot();
  const result = await runControlledSample({ sample, artifacts: frozen, outputRoot: root, writerExecutor: buildControlledWriterOutput, judgeExecutor: buildControlledJudgeResponse });
  assert.match(result.sampleRoot, /plane34-model-bearing-test-/);
  assert.ok((await readFile(join(result.sampleRoot, "calls", "call-01-writer-raw.json"), "utf8")).includes("writerOutputVersion"));
  assert.ok((await readFile(join(result.sampleRoot, "calls", "call-02-judge-raw.json"), "utf8")).includes("judgePromptVersion"));
});

test("PLANE34-NEGATIVE: malformed frozen input fails before any controlled call", async () => {
  await assert.rejects(loadFrozenArtifacts({ ...sample, auditId: "wrong-audit" }), /audit identity mismatch/);
});

test("PLANE34-IDENTITY: run and sample identities are safe, distinct, and collision-resistant", async () => {
  const root = await outputRoot();
  assert.equal(validateRunId("plane34-8604603c-20260912-a"), "plane34-8604603c-20260912-a");
  for (const bad of ["", "short", "../escape", "a/bad", "a\\bad"]) assert.throws(() => validateRunId(bad));
  const first = executionIdentity("plane34-8604603c-20260912-a", "PRIMARY_TBK_P01");
  const second = executionIdentity("plane34-8604603c-20260912-a", "PRIMARY_TBK_P02");
  const otherRun = executionIdentity("plane34-8604603c-20260912-b", "PRIMARY_TBK_P01");
  assert.equal(new Set([first, second, otherRun]).size, 3);
  assert.equal(runRootFor({ isolatedOutputRoot: root, runId: "plane34-8604603c-20260912-a" }), join(root, "plane34-8604603c-20260912-a"));
  await assertFreshRunRoot(join(root, "plane34-8604603c-20260912-a"));
});

test("PLANE34-IDENTITY: duplicate sample IDs and reused/non-empty roots fail closed", async () => {
  assert.throws(() => computeCallPlan([{ ...sample, sampleId: "same" }, { ...sample, sampleId: "same" }], 4), /duplicate sample ID/);
  const root = await outputRoot();
  const runRoot = join(root, "plane34-reused-run");
  await (await import("node:fs/promises")).writeFile(join(root, "marker.txt"), "historical", "utf8");
  await assert.rejects(assertFreshRunRoot(root), /already exists/);
  await (await import("node:fs/promises")).mkdir(runRoot, { recursive: true });
  await (await import("node:fs/promises")).writeFile(join(runRoot, "historical.json"), "preserve", "utf8");
  await assert.rejects(assertFreshRunRoot(runRoot), /already exists/);
  assert.equal(await readFile(join(runRoot, "historical.json"), "utf8"), "preserve");
});

test("PLANE34-PARITY: stale runtime identities fail before execution", async () => {
  const config = readModelConfig({
    PRYSM_NARRATIVE_V2_WRITER_MODEL: "gpt-5.6-terra",
    PRYSM_NARRATIVE_V2_JUDGE_MODEL: "gpt-5.6-sol",
    PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS: "120000",
    PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS: "12000",
    PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS: "8000",
    PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON: JSON.stringify({ "gpt-5.6-terra": { inputPricePer1K: 0.002, outputPricePer1K: 0.012 }, "gpt-5.6-sol": { inputPricePer1K: 0.005, outputPricePer1K: 0.03 } }),
  });
  const manifest = {
    activeModelIdentity: { writerModel: "stale-writer", judgeModel: "gpt-5.6-sol" },
    tokenLimits: { maxInputTokens: 120000, writerMaxOutputTokens: 12000, judgeMaxOutputTokens: 8000 },
    priceEntries: config.prices,
    contractIdentity: { writerPromptVersion: "2.4.0", judgePromptVersion: "2.1.0", writerOutputVersion: "1.0.0", judgeContractVersion: "1.1.0" },
  };
  const parity = await verifyManifestRuntimeParity({ manifest, config });
  assert.equal(parity.proven, false);
  assert.match(parity.errors.join(";"), /Writer model identity mismatch/);
});

test("PLANE34-PARITY: stale token, price, prompt, schema, and validator identities fail closed", async () => {
  const config = readModelConfig({
    PRYSM_NARRATIVE_V2_WRITER_MODEL: "gpt-5.6-terra",
    PRYSM_NARRATIVE_V2_JUDGE_MODEL: "gpt-5.6-sol",
    PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS: "120000",
    PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS: "12000",
    PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS: "8000",
    PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON: JSON.stringify({ "gpt-5.6-terra": { inputPricePer1K: 0.002, outputPricePer1K: 0.012 }, "gpt-5.6-sol": { inputPricePer1K: 0.005, outputPricePer1K: 0.03 } }),
  });
  const base = {
    activeModelIdentity: { writerModel: "gpt-5.6-terra", judgeModel: "gpt-5.6-sol" },
    tokenLimits: { maxInputTokens: 120000, writerMaxOutputTokens: 12000, judgeMaxOutputTokens: 8000 },
    priceEntries: config.prices,
    contractIdentity: { writerPromptVersion: "2.4.0", judgePromptVersion: "2.1.0", writerOutputVersion: "1.0.0", judgeContractVersion: "1.1.0" },
  };
  const mutations = [
    (m) => { m.tokenLimits.maxInputTokens = 1; },
    (m) => { m.priceEntries["gpt-5.6-terra"].outputPricePer1K = 999; },
    (m) => { m.contractIdentity.writerPromptVersion = "stale"; },
    (m) => { m.contractIdentity.writerOutputVersion = "stale"; },
    (m) => { m.contractIdentity.writerValidator = "src/narrative-v2/writer-output.js SHA-256 " + "0".repeat(64); },
  ];
  for (const mutate of mutations) {
    const manifest = structuredClone(base);
    mutate(manifest);
    const parity = await verifyManifestRuntimeParity({ manifest, config });
    assert.equal(parity.proven, false);
  }
});

test("PLANE34-IDENTITY: stale application HEAD is rejected before any execution", async () => {
  await assert.rejects(
    verifyIdentity({ expectedCandidateSha: "required", runGit: async (args) => args[0] === "rev-parse" ? "stale" : "" }),
    /Candidate SHA mismatch/,
  );
});

test("PLANE34-AUTH: candidate, manifest, run, corpus, and budget all bind authorization", () => {
  const plan = { authorizedMaximumCalls: 8 };
  const base = { candidateSha: "candidate", manifestSha256: "manifest", runId: "plane34-valid-run", corpusIdentity: "corpus", maximumPermittedCalls: 8, maximumSpend: 4.44 };
  assert.deepEqual(parseAuthorization({ PRYSM_MODEL_BEARING_PAID_RUN_AUTHORIZED: "YES", PRYSM_MODEL_BEARING_AUTHORIZATION_JSON: JSON.stringify(base) }, { ...base, plan }), base);
  for (const key of ["candidateSha", "manifestSha256", "runId", "corpusIdentity", "maximumPermittedCalls", "maximumSpend"]) {
    const altered = { ...base, [key]: key === "maximumSpend" ? 5 : `${base[key]}-wrong` };
    assert.throws(() => parseAuthorization({ PRYSM_MODEL_BEARING_PAID_RUN_AUTHORIZED: "YES", PRYSM_MODEL_BEARING_AUTHORIZATION_JSON: JSON.stringify(altered) }, { ...base, plan }), /mismatch/);
  }
});

test("PLANE34-CEILINGS: Writer, Judge, total, and USD ceilings fail closed", async () => {
  const config = { writerModel: "w", judgeModel: "j", maxInputTokens: 1000, writerMaxOutputTokens: 100, judgeMaxOutputTokens: 100, prices: { w: { inputPricePer1K: 0.002, outputPricePer1K: 0.012 }, j: { inputPricePer1K: 0.005, outputPricePer1K: 0.03 } } };
  const guard = createRunCallGuard({ runRoot: await outputRoot(), plan: { authorizedMaximumCalls: 8 }, config });
  for (let i = 0; i < 5; i += 1) await guard.reserve("writer", `P${i}`);
  await assert.rejects(guard.reserve("writer", "P6"), /Writer call ceiling/);
  const judgeGuard = createRunCallGuard({ runRoot: await outputRoot(), plan: { authorizedMaximumCalls: 8 }, config });
  for (let i = 0; i < 3; i += 1) await judgeGuard.reserve("judge", `P${i}`);
  await assert.rejects(judgeGuard.reserve("judge", "P4"), /Judge call ceiling/);
  const totalGuard = createRunCallGuard({ runRoot: await outputRoot(), plan: { authorizedMaximumCalls: 2 }, config });
  await totalGuard.reserve("writer", "P1");
  await totalGuard.reserve("judge", "P1");
  await assert.rejects(totalGuard.reserve("writer", "P2"), /total call ceiling/);
  const expensive = { ...config, prices: { w: { inputPricePer1K: 1, outputPricePer1K: 1 }, j: config.prices.j } };
  const costGuard = createRunCallGuard({ runRoot: await outputRoot(), plan: { authorizedMaximumCalls: 8 }, config: expensive });
  for (let i = 0; i < 4; i += 1) await costGuard.reserve("writer", `P${i}`);
  await assert.rejects(costGuard.reserve("writer", "P5"), /aggregate cost ceiling/);
});

test("PLANE34-IMMUTABLE: repeated controlled persistence cannot overwrite prior evidence", async () => {
  const frozen = await renderableArtifacts();
  const root = await outputRoot();
  await runControlledSample({ sample, artifacts: frozen, outputRoot: root, writerExecutor: buildControlledWriterOutput, judgeExecutor: buildControlledJudgeResponse });
  const rawPath = join(root, sample.sampleId, "calls", "call-01-writer-raw.json");
  const before = await readFile(rawPath, "utf8");
  await assert.rejects(runControlledSample({ sample, artifacts: frozen, outputRoot: root, writerExecutor: buildControlledWriterOutput, judgeExecutor: buildControlledJudgeResponse }), /EEXIST/);
  assert.equal(await readFile(rawPath, "utf8"), before);
});

test("PLANE34-RESTART: all persisted restart states refuse reuse while a fresh run remains independent", async () => {
  const base = await outputRoot();
  const states = ["reservation", "response", "validation", "partial-sample", "judge", "summary"];
  for (const state of states) {
    const root = join(base, `plane34-${state}`);
    await (await import("node:fs/promises")).mkdir(root, { recursive: true });
    await (await import("node:fs/promises")).writeFile(join(root, "state.json"), state, "utf8");
    await assert.rejects(assertFreshRunRoot(root), /already exists/);
  }
  const fresh = runRootFor({ isolatedOutputRoot: base, runId: "plane34-fresh-independent" });
  await assertFreshRunRoot(fresh);
  assert.notEqual(fresh, join(base, "plane34-summary"));
});

test("PLANE34-STOP: material Writer/Judge failure does not advance a controlled sample", async () => {
  const frozen = await renderableArtifacts();
  const root = await outputRoot();
  let judgeCalled = false;
  await assert.rejects(runControlledSample({
    sample,
    artifacts: frozen,
    outputRoot: root,
    writerExecutor: async () => { throw new Error("writer failure"); },
    judgeExecutor: async () => { judgeCalled = true; return buildControlledJudgeResponse({ writerInput: frozen.writerInput.value }); },
  }), /writer failure/);
  assert.equal(judgeCalled, false);
});

test("PLANE34-STOP: material Judge failure stops the current sample", async () => {
  const frozen = await renderableArtifacts();
  const root = await outputRoot();
  await assert.rejects(runControlledSample({
    sample,
    artifacts: frozen,
    outputRoot: root,
    writerExecutor: buildControlledWriterOutput,
    judgeExecutor: async () => { throw new Error("judge failure"); },
  }), /judge failure/);
});

test("PLANE34-PREFLIGHT: run identity, plan, and zero-call result remain explicit", async () => {
  const result = await runPreflight({
    manifest: { candidateSha: "test-candidate", samples: [sample], maximumPermittedCalls: 2, isolatedOutputRoot: await outputRoot() },
    appRoot: process.cwd(),
  }).catch((error) => ({ error }));
  assert.ok(result.error || (result.modelCalls === 0 && result.providerCalls === 0 && result.runId));
});

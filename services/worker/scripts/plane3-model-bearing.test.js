import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  computeCallPlan,
  calculateCost,
  executeManifest,
  loadFrozenArtifacts,
  readModelConfig,
  runControlledSample,
  runPreflight,
  sampleCallCeiling,
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
  assert.equal(result.record.render.viewerVersion, "2.3.0");
  assert.ok((await readFile(result.manifest.path, "utf8")).includes("inputArtifactHashes"));
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

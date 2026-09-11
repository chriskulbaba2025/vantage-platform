import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { createNarrativeV2LiveBinding } from "../src/narrative-v2/live-binding.js";
import { createFsArtifactStore } from "../src/storage/fs-artifact-store.js";
import {
  NARRATIVE_V2_STATUS,
  runNarrativeV2Orchestration,
} from "../src/narrative-v2/orchestrator.js";
import {
  JUDGE_CONTRACT_VERSION,
  JUDGE_PROMPT_VERSION,
  validateJudgeResponse,
} from "../src/narrative-v2/judge-contract.js";
import {
  WRITER_OUTPUT_VERSION,
  WRITER_PROMPT_VERSION,
  validateWriterOutput,
} from "../src/narrative-v2/writer-output.js";
import { buildV2Model } from "../src/narrative-v2/production-path.js";
import { renderGovernedNarrativeReportV2 } from "../src/report/render-narrative-v2.js";
import { REPORT_V2_VIEWER_VERSION } from "../src/report/render-report-v2.js";
import { runFinalizationGate } from "../src/scoring/report-finalization-gate.js";
import {
  buildSolutionAuthorityRecords,
  SOLUTION_PAGE_REGISTRY,
} from "../src/solution/solution-authority-provider.js";
import { buildSolutionDirectiveInput } from "../src/solution/solution-directive-authority.js";
import { generateCanonicalSolutions } from "../src/solution/solution-generator.js";

const execFileAsync = promisify(execFile);
const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(workerRoot, "..", "..");

export const HARNESS_VERSION = "1.0.0";
export const REQUIRED_AUTHORIZATION = "YES";
export const PRIMARY_AUDIT_ID = "4b0b3568-19e5-4bff-a4e8-20b23f401f5e";
export const DEFAULT_OUTPUT_ROOT = join(tmpdir(), "PRYSM-model-bearing", "plane34");
export const DEFAULT_CANDIDATE_SHA = "c7087990250d2280b80921c88c26926a5c9b184a";
export const MAX_LIVE_CALLS_PER_SAMPLE = 6;
export const MAX_AUTOMATIC_PASSES = 2;

const MODEL_ENV_NAMES = Object.freeze([
  "PRYSM_NARRATIVE_V2_WRITER_MODEL",
  "PRYSM_NARRATIVE_V2_JUDGE_MODEL",
  "PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS",
  "PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS",
  "PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS",
  "PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel));
}

function assertOutside(candidate, parent, label) {
  if (inside(candidate, parent)) throw new Error(`${label} must be outside ${parent}`);
}

async function git(args, root = repositoryRoot) {
  const result = await execFileAsync("git", ["-C", root, ...args]);
  return result.stdout.trim();
}

export async function verifyIdentity({
  expectedCandidateSha = DEFAULT_CANDIDATE_SHA,
  appRoot = repositoryRoot,
  runGit = (args) => git(args, appRoot),
} = {}) {
  const head = await runGit(["rev-parse", "HEAD"]);
  if (head !== expectedCandidateSha) throw new Error(`Candidate SHA mismatch: expected ${expectedCandidateSha}, got ${head}`);
  const status = await runGit(["status", "--porcelain", "--untracked-files=all"]);
  if (status) throw new Error("Model-bearing harness requires a clean application worktree");
  return Object.freeze({ candidateSha: head, worktreeClean: true });
}

export function readModelConfig(env = process.env, { requireLive = false } = {}) {
  const missing = MODEL_ENV_NAMES.filter((name) => !String(env[name] || "").trim());
  const writerModel = String(env.PRYSM_NARRATIVE_V2_WRITER_MODEL || "").trim();
  const judgeModel = String(env.PRYSM_NARRATIVE_V2_JUDGE_MODEL || "").trim();
  const enabled = env.PRYSM_NARRATIVE_V2_ENABLED === "true" && env.PRYSM_LLM_MODE === "live";
  let prices = null;
  let priceError = null;
  if (env.PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON) {
    try {
      prices = JSON.parse(env.PRYSM_NARRATIVE_V2_PRICE_TABLE_JSON);
    } catch (error) {
      priceError = error.message;
    }
  }
  if (requireLive && (!enabled || missing.length || priceError)) {
    throw new Error(`Live model configuration unavailable: enabled=${enabled}; missing=${missing.join(",")}; priceError=${priceError || "none"}`);
  }
  return Object.freeze({
    proven: missing.length === 0 && !priceError,
    liveEnabled: enabled,
    missing,
    priceError,
    writerModel: writerModel || null,
    judgeModel: judgeModel || null,
    maxInputTokens: Number(env.PRYSM_NARRATIVE_V2_MAX_INPUT_TOKENS) || null,
    writerMaxOutputTokens: Number(env.PRYSM_NARRATIVE_V2_WRITER_MAX_OUTPUT_TOKENS) || null,
    judgeMaxOutputTokens: Number(env.PRYSM_NARRATIVE_V2_JUDGE_MAX_OUTPUT_TOKENS) || null,
    prices,
    promptVersions: { writer: WRITER_PROMPT_VERSION, judge: JUDGE_PROMPT_VERSION },
    contractVersions: { writerOutput: "1.0.0", judge: JUDGE_CONTRACT_VERSION },
    schemaIdentities: {
      writer: "buildWriterStructuredOutputSchema/buildWriterStructuredResponseFormat",
      judge: "buildJudgeStructuredOutputSchema/buildJudgeStructuredResponseFormat",
    },
  });
}

export function sampleCallCeiling(sample) {
  if (!sample || typeof sample !== "object") throw new Error("sample is required");
  const passes = Number.isInteger(sample.maxAutomaticPasses) ? sample.maxAutomaticPasses : 1;
  if (passes < 1 || passes > MAX_AUTOMATIC_PASSES) throw new Error("maxAutomaticPasses must be 1 or 2");
  return sample.judgeEnabled ? Math.min(MAX_LIVE_CALLS_PER_SAMPLE, passes * 2) : 1;
}

export function calculateCost(usage, prices, modelId) {
  return costForUsage(usage, prices, modelId);
}

export function computeCallPlan(samples, authorizedMaximumCalls) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error("run manifest must contain samples");
  const entries = samples.map((sample) => ({
    sampleId: sample.sampleId,
    auditId: sample.auditId,
    writerCalls: 1,
    judgeCalls: sample.judgeEnabled ? Math.max(1, sample.maxAutomaticPasses || 1) : 0,
    maximumCalls: sampleCallCeiling(sample),
  }));
  const maximumCalls = entries.reduce((sum, entry) => sum + entry.maximumCalls, 0);
  if (!Number.isInteger(authorizedMaximumCalls) || authorizedMaximumCalls < maximumCalls) {
    throw new Error(`Manifest authorization ceiling ${authorizedMaximumCalls} is below maximum possible calls ${maximumCalls}`);
  }
  return Object.freeze({
    entries,
    writerCalls: entries.reduce((sum, entry) => sum + entry.writerCalls, 0),
    judgeCalls: entries.reduce((sum, entry) => sum + entry.judgeCalls, 0),
    maximumCalls,
    authorizedMaximumCalls,
  });
}

async function readJsonArtifact(path) {
  const bytes = await readFile(path);
  return { path, bytes, value: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes), bytes: bytes.length };
}

export async function loadFrozenArtifacts(sample, { appRoot = repositoryRoot } = {}) {
  const paths = sample.artifacts || {};
  const required = ["writerInput", "scoreSet", "findings", "decisionEvidence", "capabilityEvidence", "auditRequest"];
  for (const name of required) {
    if (!paths[name]) throw new Error(`${sample.sampleId || "sample"} missing artifact path: ${name}`);
    if (!isAbsolute(paths[name])) paths[name] = resolve(appRoot, paths[name]);
    await access(paths[name]);
  }
  const artifacts = {};
  for (const name of required) artifacts[name] = await readJsonArtifact(paths[name]);
  if (artifacts.writerInput.value.auditId !== sample.auditId || artifacts.auditRequest.value.auditId !== sample.auditId) {
    throw new Error(`${sample.sampleId} audit identity mismatch`);
  }
  const expected = sample.artifactHashes || {};
  for (const name of required) {
    if (expected[name] && expected[name] !== artifacts[name].sha256) throw new Error(`${sample.sampleId} ${name} SHA-256 mismatch`);
  }
  return Object.freeze({ ...artifacts, hashes: Object.fromEntries(required.map((name) => [name, artifacts[name].sha256])) });
}

function canonicalSolutions(inputs) {
  const authorityRecords = buildSolutionAuthorityRecords({
    findings: inputs.findings.value,
    scoreSet: inputs.scoreSet.value,
    decisionEvidence: inputs.decisionEvidence.value,
    pageRegistry: SOLUTION_PAGE_REGISTRY,
  });
  const authorityInput = buildSolutionDirectiveInput({
    findings: inputs.findings.value,
    scoreSet: inputs.scoreSet.value,
    decisionEvidence: inputs.decisionEvidence.value,
    authorityRecords,
    pageRegistry: SOLUTION_PAGE_REGISTRY,
  });
  return generateCanonicalSolutions(authorityInput);
}

function costForUsage(usage, prices, modelId) {
  const price = prices?.[modelId];
  if (!price || !usage) return null;
  return ((Number(usage.inputTokens || 0) / 1000) * Number(price.inputPricePer1K || 0))
    + ((Number(usage.outputTokens || 0) / 1000) * Number(price.outputPricePer1K || 0));
}

async function persistJson(root, name, value) {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true });
  const bytes = jsonBytes(value);
  await writeFile(path, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

async function buildAndRender({ artifacts, orchestration }) {
  const inputs = {
    scoreSet: artifacts.scoreSet,
    findings: artifacts.findings,
    decisionEvidence: artifacts.decisionEvidence,
    capabilityEvidence: artifacts.capabilityEvidence,
  };
  const model = artifacts.modelOverride || buildV2Model({
    auditRequest: artifacts.auditRequest.value,
    scoreSet: artifacts.scoreSet.value,
    findings: artifacts.findings.value,
    capabilityEvidence: artifacts.capabilityEvidence.value,
    decisionEvidence: artifacts.decisionEvidence.value,
    canonicalSolutions: canonicalSolutions(inputs),
  });
  const finalizationEvidence = model.evidence || artifacts.decisionEvidence.value;
  const finalizationFindings = model.findings || artifacts.findings.value;
  const gate = runFinalizationGate({ ...model, findings: finalizationFindings }, finalizationEvidence);
  if (!gate.passed) throw new Error(`Finalization failed: ${gate.errors.map((error) => error.message).join("; ")}`);
  const html = renderGovernedNarrativeReportV2({ model, writerInput: artifacts.writerInput.value, orchestrationResult: orchestration });
  if (!/^<!doctype html>/i.test(html) || !html.includes('<main id="reportContent" tabindex="-1">') || !html.includes(`data-viewer-version="${REPORT_V2_VIEWER_VERSION}"`)) {
    throw new Error(`Renderer did not produce governed Viewer v${REPORT_V2_VIEWER_VERSION} HTML`);
  }
  return { finalization: { passed: true, errors: [] }, render: { passed: true, viewerVersion: REPORT_V2_VIEWER_VERSION, bytes: Buffer.byteLength(html), sha256: sha256(Buffer.from(html)) } };
}

export async function runControlledSample({ sample, artifacts, outputRoot, writerExecutor, judgeExecutor }) {
  const sampleRoot = resolve(outputRoot, sample.sampleId);
  assertOutside(sampleRoot, repositoryRoot, "model-bearing output");
  await mkdir(sampleRoot, { recursive: true });
  let writerCalls = 0;
  let judgeCalls = 0;
  const responseArtifacts = [];
  const wrappedWriter = async (request) => {
    writerCalls += 1;
    const output = await writerExecutor(request);
    responseArtifacts.push(await persistJson(sampleRoot, `calls/call-${String(writerCalls).padStart(2, "0")}-writer-raw.json`, output));
    return output;
  };
  const wrappedJudge = async (request) => {
    judgeCalls += 1;
    const output = await judgeExecutor(request);
    responseArtifacts.push(await persistJson(sampleRoot, `calls/call-${String(writerCalls + judgeCalls).padStart(2, "0")}-judge-raw.json`, output));
    return output;
  };
  if (sample.judgeEnabled === false) {
    const output = await wrappedWriter({ writerInput: artifacts.writerInput.value, passNumber: 1 });
    const validation = validateWriterOutput(output, { writerInput: artifacts.writerInput.value, expectedPassNumber: 1 });
    const record = {
      harnessVersion: HARNESS_VERSION,
      candidateSha: sample.candidateSha,
      sampleId: sample.sampleId,
      auditId: sample.auditId,
      inputArtifactHashes: artifacts.hashes,
      responseArtifacts,
      writerPromptVersion: WRITER_PROMPT_VERSION,
      writerOutputVersion: WRITER_OUTPUT_VERSION,
      writerCalls,
      judgeCalls: 0,
      status: validation.valid ? "WRITER_VALIDATED" : "WRITER_VALIDATION_FAILED",
      passCount: 1,
      validation: { writer: validation.valid ? "PASS" : "FAIL", errors: validation.errors || [] },
      finalization: null,
      render: null,
      usage: null,
      calculatedCost: null,
    };
    const manifest = await persistJson(sampleRoot, "sample-manifest.json", record);
    if (!validation.valid) throw new Error(`Writer validation failed: ${validation.errors.join("; ")}`);
    return Object.freeze({ record, manifest, orchestration: null, sampleRoot });
  }
  let orchestration;
  try {
    orchestration = await runNarrativeV2Orchestration({
      writerInput: artifacts.writerInput.value,
      writerExecutor: wrappedWriter,
      judgeExecutor: wrappedJudge,
      maxAutomaticPasses: sample.maxAutomaticPasses || 1,
    });
  } catch (error) {
    await persistJson(sampleRoot, "validation/orchestration-error.json", {
      message: error.message,
      code: error.code || null,
      stage: error.stage || null,
      passNumber: error.passNumber || null,
      validationErrors: error.validationErrors || [],
      writerCalls,
      judgeCalls,
      responseArtifacts,
    });
    throw error;
  }
  const rendered = await buildAndRender({ artifacts, orchestration });
  const record = {
    harnessVersion: HARNESS_VERSION,
    candidateSha: sample.candidateSha,
    sampleId: sample.sampleId,
    auditId: sample.auditId,
    inputArtifactHashes: artifacts.hashes,
    responseArtifacts,
    writerPromptVersion: WRITER_PROMPT_VERSION,
    writerOutputVersion: WRITER_OUTPUT_VERSION,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    judgeContractVersion: JUDGE_CONTRACT_VERSION,
    writerCalls,
    judgeCalls,
    status: orchestration.status,
    passCount: orchestration.passCount,
    validation: { writer: "production orchestrator", judge: "production orchestrator" },
    finalization: rendered.finalization,
    render: rendered.render,
    usage: null,
    calculatedCost: null,
  };
  const manifest = await persistJson(sampleRoot, "sample-manifest.json", record);
  return Object.freeze({ record, manifest, orchestration, sampleRoot });
}

export async function runPreflight({ manifest, env = process.env, appRoot = repositoryRoot } = {}) {
  const identity = await verifyIdentity({ expectedCandidateSha: manifest.candidateSha, appRoot });
  const config = readModelConfig(env);
  const plan = computeCallPlan(manifest.samples, manifest.maximumPermittedCalls);
  const artifacts = {};
  const errors = [];
  for (const sample of manifest.samples) {
    try {
      if (sample.candidateSha !== manifest.candidateSha) throw new Error("sample candidate SHA differs from manifest candidate SHA");
      artifacts[sample.sampleId] = await loadFrozenArtifacts(sample, { appRoot });
    }
    catch (error) { errors.push(`${sample.sampleId}: ${error.message}`); }
  }
  if (!manifest.isolatedOutputRoot || inside(manifest.isolatedOutputRoot, appRoot)) errors.push("isolatedOutputRoot must be outside the application repository");
  return Object.freeze({
    result: errors.length ? "BLOCKED" : "READY",
    identity,
    config,
    plan,
    artifactSamples: Object.keys(artifacts),
    errors,
    modelCalls: 0,
    providerCalls: 0,
  });
}

export async function executeManifest({ manifest, env = process.env, appRoot = repositoryRoot, clientsBySample = null, executeRequested = process.argv.includes("--execute") } = {}) {
  if (executeRequested !== true || env.PRYSM_MODEL_BEARING_PAID_RUN_AUTHORIZED !== REQUIRED_AUTHORIZATION) {
    return { result: "NOT_AUTHORIZED", modelCalls: 0, providerCalls: 0 };
  }
  const identity = await verifyIdentity({ expectedCandidateSha: manifest.candidateSha, appRoot });
  const config = readModelConfig(env, { requireLive: true });
  const plan = computeCallPlan(manifest.samples, manifest.maximumPermittedCalls);
  const root = resolve(manifest.isolatedOutputRoot);
  assertOutside(root, appRoot, "model-bearing execution output");
  await mkdir(root, { recursive: true });
  const results = [];
  let calls = 0;
  for (const sample of manifest.samples) {
    if (sample.candidateSha !== identity.candidateSha) throw new Error(`${sample.sampleId} candidate SHA differs from verified HEAD`);
    const artifacts = await loadFrozenArtifacts(sample, { appRoot });
    const ledger = resolve(root, sample.sampleId);
    const artifactStore = createFsArtifactStore({ baseDir: ledger });
    const binding = clientsBySample?.[sample.sampleId] || createNarrativeV2LiveBinding({ env, artifactStore, requireDurableStore: true });
    if (!binding?.enabled || typeof binding.writerExecutor !== "function" || typeof binding.judgeExecutor !== "function") {
      throw new Error("Production execution requires enabled Writer and Judge executors");
    }
    const auditRequest = artifacts.auditRequest.value;
    binding.registerAuditScope({
      tenantId: auditRequest.tenantId,
      clientId: auditRequest.clientId,
      auditId: sample.auditId,
      executionId: `plane34-${sample.sampleId}`,
    });
    const result = await runControlledSample({
      sample: { ...sample, candidateSha: identity.candidateSha },
      artifacts,
      outputRoot: root,
      writerExecutor: binding.writerExecutor,
      judgeExecutor: binding.judgeExecutor,
    });
    results.push(result.record);
    calls += result.record.writerCalls + result.record.judgeCalls;
    if (calls > plan.authorizedMaximumCalls) throw new Error("Execution exceeded manifest call authorization");
    void ledger;
  }
  return { result: "EXECUTED", identity, config: { ...config, apiKey: undefined }, plan, results, modelCalls: calls, providerCalls: calls };
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) args.set(argv[index], argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const manifestPath = args.get("--manifest");
  if (!manifestPath) throw new Error("Usage: node scripts/plane3-model-bearing.mjs --manifest <path> [--execute]");
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  const result = args.has("--execute") ? await executeManifest({ manifest, executeRequested: true }) : await runPreflight({ manifest });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

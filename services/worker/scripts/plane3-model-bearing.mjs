import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { createNarrativeV2LiveBinding } from "../src/narrative-v2/live-binding.js";
import { createFsArtifactStore } from "../src/storage/fs-artifact-store.js";
import { createProductionContractValidator } from "../src/application/production-bootstrap.js";
import { loadAndValidateDecisionEvidence } from "../src/evidence/decision-evidence.js";
import { loadAndValidateCapabilityEvidence } from "../src/evidence/capability-evidence.js";
import { assertCurrentScoreSet } from "../src/scoring/current-score-set.js";
import { buildArtifactKey } from "../src/storage/artifact-key.js";
import { buildWriterInput, WRITER_INPUT_VERSION } from "../src/narrative-v2/writer-input.js";
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
import { buildWriterPrompt } from "../src/narrative-v2/writer-prompt.js";
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
export const MAX_WRITER_CALLS = 5;
export const MAX_JUDGE_CALLS = 3;
export const MAX_TOTAL_CALLS = 8;
export const MAX_TOTAL_SPEND_USD = 4.44;
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
export const EXPECTED_PRIMARY_WRITER_INPUT_SHA256 = "5313c1929a5bfca31d8ed7e92ade706d378c426b3dddab22d37778ea69eef7e2";

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

export function validateRunId(runId) {
  const value = String(runId || "").trim();
  if (!RUN_ID_PATTERN.test(value)) {
    throw new Error("runId must be 8-128 characters of letters, numbers, dot, underscore, or hyphen");
  }
  return value;
}

export function executionIdentity(runId, sampleId) {
  const normalizedRunId = validateRunId(runId);
  const normalizedSampleId = String(sampleId || "").trim();
  if (!normalizedSampleId || normalizedSampleId.includes("/") || normalizedSampleId.includes("\\") || normalizedSampleId === "." || normalizedSampleId === "..") {
    throw new Error("sampleId must be a safe non-empty path segment");
  }
  return `${normalizedRunId}-${normalizedSampleId}`;
}

export function runRootFor({ isolatedOutputRoot, runId, appRoot = repositoryRoot }) {
  const root = resolve(isolatedOutputRoot, validateRunId(runId));
  assertOutside(root, appRoot, "model-bearing execution output");
  return root;
}

async function pathExists(path) {
  try { await access(path); return true; } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function assertFreshRunRoot(root) {
  if (await pathExists(root)) {
    const entries = await readdir(root);
    throw new Error(`run root already exists or was previously used: ${root}${entries.length ? " (non-empty)" : " (empty but reserved)"}`);
  }
  return true;
}

async function claimFreshRunRoot(root) {
  await assertFreshRunRoot(root);
  await mkdir(dirname(root), { recursive: true });
  try {
    await mkdir(root);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`run root was claimed concurrently: ${root}`);
    throw error;
  }
}

function manifestCorpusIdentity(manifest) {
  const corpus = (manifest.samples || []).map((sample) => ({
    sampleId: sample.sampleId,
    auditId: sample.auditId,
    artifactHashes: sample.artifactHashes || {},
    expectedCurrentWriterInputSha256: sample.expectedCurrentWriterInputSha256 || null,
  }));
  return sha256(jsonBytes(corpus));
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
  const sampleIds = new Set();
  const entries = samples.map((sample) => ({
    sampleId: (() => {
      const id = String(sample?.sampleId || "").trim();
      if (!id || id.includes("/") || id.includes("\\") || id === "." || id === "..") throw new Error("sample IDs must be unique safe path segments");
      if (sampleIds.has(id)) throw new Error(`duplicate sample ID: ${id}`);
      sampleIds.add(id);
      return id;
    })(),
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

export function validateManifestPlan(manifest, plan) {
  const errors = [];
  if (manifest.status && manifest.status !== "READY_FOR_PAID_AUTHORIZATION") errors.push("manifest is not READY_FOR_PAID_AUTHORIZATION");
  if (Number(manifest.maximumPermittedCalls) !== MAX_TOTAL_CALLS) errors.push("manifest maximumPermittedCalls must equal 8");
  if (Number(manifest.modelCallCeilings?.plannedMaximumCalls) !== plan.maximumCalls) errors.push("manifest plannedMaximumCalls does not match computed plan");
  if (Number(manifest.conservativeMaximumSpend) > MAX_TOTAL_SPEND_USD) errors.push("manifest conservative spend exceeds USD 4.44");
  if (plan.writerCalls > MAX_WRITER_CALLS || plan.judgeCalls > MAX_JUDGE_CALLS || plan.maximumCalls > MAX_TOTAL_CALLS) errors.push("manifest call plan exceeds governed Plane 3 ceilings");
  return Object.freeze(errors);
}

function expectedIdentityHash(identity) {
  const match = String(identity || "").match(/SHA-256\s+([a-f0-9]{64})/i);
  return match ? match[1].toLowerCase() : null;
}

async function sourceContractIdentities() {
  const files = {
    writerValidator: join(workerRoot, "src", "narrative-v2", "writer-output.js"),
    judgeValidator: join(workerRoot, "src", "narrative-v2", "judge-contract.js"),
    writerStructuredSchema: join(workerRoot, "src", "narrative-v2", "writer-structured-output.js"),
    judgeStructuredSchema: join(workerRoot, "src", "narrative-v2", "judge-structured-output.js"),
  };
  const hashes = {};
  for (const [name, path] of Object.entries(files)) hashes[name] = sha256(await readFile(path));
  return hashes;
}

export async function verifyManifestRuntimeParity({ manifest, config, appRoot = repositoryRoot } = {}) {
  const errors = [];
  if (!config?.proven) return { proven: false, errors: ["runtime model configuration is unavailable"] };
  const active = manifest.activeModelIdentity || {};
  const limits = manifest.tokenLimits || {};
  const prices = manifest.priceEntries || {};
  if (active.writerModel !== config.writerModel) errors.push("Writer model identity mismatch");
  if (active.judgeModel !== config.judgeModel) errors.push("Judge model identity mismatch");
  if (Number(limits.maxInputTokens) !== Number(config.maxInputTokens)) errors.push("max input token identity mismatch");
  if (Number(limits.writerMaxOutputTokens) !== Number(config.writerMaxOutputTokens)) errors.push("Writer max output token identity mismatch");
  if (Number(limits.judgeMaxOutputTokens) !== Number(config.judgeMaxOutputTokens)) errors.push("Judge max output token identity mismatch");
  for (const model of [config.writerModel, config.judgeModel]) {
    const expected = prices[model];
    const actual = config.prices?.[model];
    if (!expected || !actual || Number(expected.inputPricePer1K) !== Number(actual.inputPricePer1K) || Number(expected.outputPricePer1K) !== Number(actual.outputPricePer1K)) {
      errors.push(`${model} price identity mismatch`);
    }
  }
  const contract = manifest.contractIdentity || {};
  if (contract.writerPromptVersion && contract.writerPromptVersion !== config.promptVersions.writer) errors.push("Writer prompt identity mismatch");
  if (contract.judgePromptVersion && contract.judgePromptVersion !== config.promptVersions.judge) errors.push("Judge prompt identity mismatch");
  if (contract.writerOutputVersion && contract.writerOutputVersion !== config.contractVersions.writerOutput) errors.push("Writer contract identity mismatch");
  if (contract.judgeContractVersion && contract.judgeContractVersion !== config.contractVersions.judge) errors.push("Judge contract identity mismatch");
  const hashes = await sourceContractIdentities(appRoot);
  const hashPairs = [
    ["writerValidator", contract.writerValidator],
    ["judgeValidator", contract.judgeValidator],
    ["writerStructuredSchema", contract.writerStructuredSchema],
    ["judgeStructuredSchema", contract.judgeStructuredSchema],
  ];
  for (const [name, expectedIdentity] of hashPairs) {
    const expected = expectedIdentityHash(expectedIdentity);
    if (expected && expected !== hashes[name]) errors.push(`${name} identity mismatch`);
  }
  return Object.freeze({ proven: errors.length === 0, errors, hashes });
}

async function readJsonArtifact(path) {
  const bytes = await readFile(path);
  return { path, bytes, value: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes), bytes: bytes.length };
}

export async function loadFrozenArtifacts(sample, { appRoot = repositoryRoot } = {}) {
  const paths = sample.artifacts || {};
  const required = ["scoreSet", "findings", "decisionEvidence", "capabilityEvidence", "auditRequest"];
  for (const name of required) {
    if (!paths[name]) throw new Error(`${sample.sampleId || "sample"} missing artifact path: ${name}`);
    if (!isAbsolute(paths[name])) paths[name] = resolve(appRoot, paths[name]);
    await access(paths[name]);
  }
  const artifacts = {};
  for (const name of required) artifacts[name] = await readJsonArtifact(paths[name]);
  const historicalPath = paths.historicalWriterInput || paths.writerInput;
  if (historicalPath) {
    const resolvedHistoricalPath = isAbsolute(historicalPath) ? historicalPath : resolve(appRoot, historicalPath);
    await access(resolvedHistoricalPath);
    artifacts.historicalWriterInput = await readJsonArtifact(resolvedHistoricalPath);
  }
  if (artifacts.auditRequest.value.auditId !== sample.auditId) {
    throw new Error(`${sample.sampleId} audit identity mismatch`);
  }
  const expected = sample.artifactHashes || {};
  for (const name of required) {
    if (expected[name] && expected[name] !== artifacts[name].sha256) throw new Error(`${sample.sampleId} ${name} SHA-256 mismatch`);
  }

  if (sample.historicalWriterInputSha256 && artifacts.historicalWriterInput?.sha256 !== sample.historicalWriterInputSha256) {
    throw new Error(`${sample.sampleId} historical WriterInput SHA-256 mismatch`);
  }

  const scope = {
    tenantId: artifacts.auditRequest.value.tenantId,
    clientId: artifacts.auditRequest.value.clientId,
    auditId: artifacts.auditRequest.value.auditId,
  };
  const canonicalFiles = new Map([
    [buildArtifactKey({ ...scope, category: "canonical", artifactName: "decision-evidence.json" }), artifacts.decisionEvidence.path],
    [buildArtifactKey({ ...scope, category: "canonical", artifactName: "capability-evidence.json" }), artifacts.capabilityEvidence.path],
    [buildArtifactKey({ ...scope, category: "canonical", artifactName: "scores.json" }), artifacts.scoreSet.path],
    [buildArtifactKey({ ...scope, category: "canonical", artifactName: "findings.json" }), artifacts.findings.path],
  ]);
  const canonicalStore = { get: async (key) => canonicalFiles.has(key) ? readFile(canonicalFiles.get(key)) : null };
  const validateContract = createProductionContractValidator();
  const decisionEvidence = await loadAndValidateDecisionEvidence({ store: canonicalStore, scope, validateContract });
  const capabilityEvidence = await loadAndValidateCapabilityEvidence({ store: canonicalStore, scope, validateContract });
  assertCurrentScoreSet(artifacts.scoreSet.value, { validateContract });
  const findings = Array.isArray(artifacts.findings.value) ? artifacts.findings.value : (artifacts.findings.value?.findings || []);
  const currentWriterInput = buildWriterInput({
    auditId: scope.auditId,
    auditRequest: artifacts.auditRequest.value,
    scoreSet: artifacts.scoreSet.value,
    findings,
    capabilityEvidence,
    decisionEvidence,
  });
  if (currentWriterInput.writerInputVersion !== WRITER_INPUT_VERSION) {
    throw new Error(`${sample.sampleId} current WriterInput version mismatch: expected ${WRITER_INPUT_VERSION}`);
  }
  const currentWriterInputBytes = Buffer.from(`${JSON.stringify(currentWriterInput, null, 2)}\n`, "utf8");
  const currentWriterInputArtifact = {
    path: null,
    bytes: currentWriterInputBytes.length,
    value: currentWriterInput,
    sha256: sha256(currentWriterInputBytes),
  };
  const expectedCurrentSha = sample.expectedCurrentWriterInputSha256;
  if (expectedCurrentSha && currentWriterInputArtifact.sha256 !== expectedCurrentSha) {
    throw new Error(`${sample.sampleId} current WriterInput SHA-256 mismatch: expected ${expectedCurrentSha}, got ${currentWriterInputArtifact.sha256}`);
  }
  const hashes = Object.fromEntries(required.map((name) => [name, artifacts[name].sha256]));
  hashes.writerInput = currentWriterInputArtifact.sha256;
  if (artifacts.historicalWriterInput) hashes.historicalWriterInput = artifacts.historicalWriterInput.sha256;
  return Object.freeze({
    ...artifacts,
    writerInput: currentWriterInputArtifact,
    currentWriterInput: currentWriterInputArtifact,
    decisionEvidence: { ...artifacts.decisionEvidence, value: decisionEvidence },
    capabilityEvidence: { ...artifacts.capabilityEvidence, value: capabilityEvidence },
    findings: { ...artifacts.findings, value: findings },
    hashes,
  });
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
  await writeFile(path, bytes, { flag: "wx" });
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

async function findPersistedResult(root, role) {
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = await findPersistedResult(path, role);
      if (found) return found;
    } else if (/call-\d+-result\.json$/i.test(entry.name)) {
      const bytes = await readFile(path);
      const value = JSON.parse(bytes.toString("utf8"));
      if (!role || value.role === role) return { value, sha256: sha256(bytes), path };
    }
  }
  return null;
}

function usageFrom(value) {
  const usage = value?.usage || value?.tokenUsage || value?.usageMetadata || null;
  if (!usage) return null;
  const inputTokens = Number(usage.inputTokens ?? usage.promptTokens ?? usage.input_tokens);
  const outputTokens = Number(usage.outputTokens ?? usage.completionTokens ?? usage.output_tokens);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  return { inputTokens, outputTokens };
}

function maxCostForRole(role, config) {
  const modelId = role === "writer" ? config.writerModel : config.judgeModel;
  const outputTokens = role === "writer" ? config.writerMaxOutputTokens : config.judgeMaxOutputTokens;
  return costForUsage({ inputTokens: config.maxInputTokens, outputTokens }, config.prices, modelId);
}

export function createRunCallGuard({ runRoot, plan, config, maximumSpend = MAX_TOTAL_SPEND_USD }) {
  const state = { writerCalls: 0, judgeCalls: 0, totalCalls: 0, cumulativeCost: 0, nextEvent: 1 };
  const reserve = async (role, sampleId) => {
    const projected = maxCostForRole(role, config);
    const writer = state.writerCalls + (role === "writer" ? 1 : 0);
    const judge = state.judgeCalls + (role === "judge" ? 1 : 0);
    if (writer > MAX_WRITER_CALLS) throw new Error("Plane 3 Writer call ceiling exceeded");
    if (judge > MAX_JUDGE_CALLS) throw new Error("Plane 3 Judge call ceiling exceeded");
    if (state.totalCalls + 1 > MAX_TOTAL_CALLS || state.totalCalls + 1 > plan.authorizedMaximumCalls) throw new Error("Plane 3 total call ceiling exceeded");
    if (state.cumulativeCost + projected > Number(maximumSpend)) throw new Error("Plane 3 aggregate cost ceiling exceeded");
    const eventId = String(state.nextEvent++).padStart(2, "0");
    await persistJson(runRoot, `ledger/reservation-${eventId}.json`, {
      eventId, state: "RESERVED", role, sampleId, projectedCost: projected,
      writerCalls: writer, judgeCalls: judge, totalCalls: state.totalCalls + 1,
      cumulativeProjectedCost: state.cumulativeCost + projected,
    });
    state.writerCalls = writer;
    state.judgeCalls = judge;
    state.totalCalls += 1;
    state.cumulativeCost += projected;
    return { eventId, projected };
  };
  const complete = async ({ reservation, role, sampleId, sampleRoot, output, error = null }) => {
    const persisted = sampleRoot ? await findPersistedResult(sampleRoot, role) : null;
    const usage = usageFrom(persisted?.value) || usageFrom(output);
    const calculatedCost = usage ? costForUsage(usage, config.prices, role === "writer" ? config.writerModel : config.judgeModel) : null;
    const actualCost = Number.isFinite(Number(persisted?.value?.actualCost)) ? Number(persisted.value.actualCost) : (calculatedCost ?? reservation.projected);
    await persistJson(runRoot, `ledger/completion-${reservation.eventId}.json`, {
      eventId: reservation.eventId, state: error ? "FAILED" : "COMPLETED", role, sampleId,
      usage, actualCost, calculatedCost, persistedResultSha256: persisted?.sha256 || null,
      projectedCost: reservation.projected, cumulativeReservedCost: state.cumulativeCost,
      error: error?.message || null,
    });
    return actualCost;
  };
  return Object.freeze({ state, reserve, complete });
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

export async function runControlledSample({ sample, artifacts, outputRoot, writerExecutor, judgeExecutor, callGuard = null }) {
  const sampleRoot = resolve(outputRoot, sample.sampleId);
  assertOutside(sampleRoot, repositoryRoot, "model-bearing output");
  await mkdir(sampleRoot, { recursive: true });
  let writerCalls = 0;
  let judgeCalls = 0;
  const responseArtifacts = [];
  const wrappedWriter = async (request) => {
    writerCalls += 1;
    const reservation = callGuard ? await callGuard.reserve("writer", sample.sampleId) : null;
    try {
      const output = await writerExecutor(request);
      responseArtifacts.push(await persistJson(sampleRoot, `calls/call-${String(writerCalls).padStart(2, "0")}-writer-raw.json`, output));
      if (callGuard) await callGuard.complete({ reservation, role: "writer", sampleId: sample.sampleId, sampleRoot, output });
      return output;
    } catch (error) {
      if (callGuard) await callGuard.complete({ reservation, role: "writer", sampleId: sample.sampleId, sampleRoot, output: null, error });
      throw error;
    }
  };
  const wrappedJudge = async (request) => {
    judgeCalls += 1;
    const reservation = callGuard ? await callGuard.reserve("judge", sample.sampleId) : null;
    try {
      const output = await judgeExecutor(request);
      responseArtifacts.push(await persistJson(sampleRoot, `calls/call-${String(writerCalls + judgeCalls).padStart(2, "0")}-judge-raw.json`, output));
      if (callGuard) await callGuard.complete({ reservation, role: "judge", sampleId: sample.sampleId, sampleRoot, output });
      return output;
    } catch (error) {
      if (callGuard) await callGuard.complete({ reservation, role: "judge", sampleId: sample.sampleId, sampleRoot, output: null, error });
      throw error;
    }
  };
  if (sample.judgeEnabled === false) {
    const output = await wrappedWriter({
      writerInput: artifacts.writerInput.value,
      passNumber: 1,
      prompt: buildWriterPrompt({
        writerInput: artifacts.writerInput.value,
        passNumber: 1,
      }),
    });
    const validation = validateWriterOutput(output, { writerInput: artifacts.writerInput.value, expectedPassNumber: 1 });
    const record = {
      harnessVersion: HARNESS_VERSION,
      candidateSha: sample.candidateSha,
      sampleId: sample.sampleId,
      auditId: sample.auditId,
      inputArtifactHashes: artifacts.hashes,
      writerInputVersion: artifacts.writerInput.value.writerInputVersion,
      writerInputSha256: artifacts.writerInput.sha256,
      historicalWriterInputSha256: artifacts.historicalWriterInput?.sha256 || null,
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
    writerInputVersion: artifacts.writerInput.value.writerInputVersion,
    writerInputSha256: artifacts.writerInput.sha256,
    historicalWriterInputSha256: artifacts.historicalWriterInput?.sha256 || null,
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

export async function runPreflight({ manifest, env = process.env, appRoot = repositoryRoot, runId = null } = {}) {
  const identity = await verifyIdentity({ expectedCandidateSha: manifest.candidateSha, appRoot });
  const config = readModelConfig(env);
  const plan = computeCallPlan(manifest.samples, manifest.maximumPermittedCalls);
  const manifestPlanErrors = validateManifestPlan(manifest, plan);
  const plannedRunId = validateRunId(runId || `preflight-${identity.candidateSha.slice(0, 12)}-${Date.now()}`);
  const plannedRoot = runRootFor({ isolatedOutputRoot: manifest.isolatedOutputRoot, runId: plannedRunId, appRoot });
  const artifacts = {};
  const errors = [...manifestPlanErrors];
  for (const sample of manifest.samples) {
    try {
      if (sample.candidateSha !== manifest.candidateSha) throw new Error("sample candidate SHA differs from manifest candidate SHA");
      artifacts[sample.sampleId] = await loadFrozenArtifacts(sample, { appRoot });
    }
    catch (error) { errors.push(`${sample.sampleId}: ${error.message}`); }
  }
  if (!manifest.isolatedOutputRoot || inside(manifest.isolatedOutputRoot, appRoot)) errors.push("isolatedOutputRoot must be outside the application repository");
  let runtimeParity = { proven: false, errors: ["runtime model configuration is unavailable"] };
  if (config.proven) runtimeParity = await verifyManifestRuntimeParity({ manifest, config, appRoot });
  if (await pathExists(plannedRoot)) errors.push("preflight run namespace is not fresh");
  return Object.freeze({
    result: errors.length ? "BLOCKED" : "READY",
    identity,
    config,
    plan,
    runId: plannedRunId,
    runRoot: plannedRoot,
    runtimeParity,
    artifactSamples: Object.keys(artifacts),
    errors,
    modelCalls: 0,
    providerCalls: 0,
  });
}

export function parseAuthorization(env, { candidateSha, manifestSha256, runId, corpusIdentity, plan }) {
  if (env.PRYSM_MODEL_BEARING_PAID_RUN_AUTHORIZED !== REQUIRED_AUTHORIZATION) return false;
  let authorization;
  try { authorization = JSON.parse(String(env.PRYSM_MODEL_BEARING_AUTHORIZATION_JSON || "")); }
  catch { throw new Error("paid authorization must include a valid PRYSM_MODEL_BEARING_AUTHORIZATION_JSON payload"); }
  const matches = authorization.candidateSha === candidateSha
    && authorization.manifestSha256 === manifestSha256
    && authorization.runId === runId
    && authorization.corpusIdentity === corpusIdentity
    && Number(authorization.maximumPermittedCalls) === Number(plan.authorizedMaximumCalls)
    && Number(authorization.maximumSpend) === MAX_TOTAL_SPEND_USD;
  if (!matches) throw new Error("paid authorization identity or budget mismatch");
  return Object.freeze({ ...authorization });
}

export async function executeManifest({ manifest, manifestSha256 = sha256(jsonBytes(manifest)), env = process.env, appRoot = repositoryRoot, clientsBySample = null, executeRequested = process.argv.includes("--execute"), runId = null } = {}) {
  if (executeRequested !== true || env.PRYSM_MODEL_BEARING_PAID_RUN_AUTHORIZED !== REQUIRED_AUTHORIZATION) {
    return { result: "NOT_AUTHORIZED", modelCalls: 0, providerCalls: 0 };
  }
  const normalizedRunId = validateRunId(runId);
  const identity = await verifyIdentity({ expectedCandidateSha: manifest.candidateSha, appRoot });
  const config = readModelConfig(env, { requireLive: true });
  const runtimeParity = await verifyManifestRuntimeParity({ manifest, config, appRoot });
  if (!runtimeParity.proven) throw new Error(`Manifest/runtime identity mismatch: ${runtimeParity.errors.join("; ")}`);
  const plan = computeCallPlan(manifest.samples, manifest.maximumPermittedCalls);
  const manifestPlanErrors = validateManifestPlan(manifest, plan);
  if (manifestPlanErrors.length) throw new Error(`Manifest plan invalid: ${manifestPlanErrors.join("; ")}`);
  const corpusIdentity = manifestCorpusIdentity(manifest);
  const authorization = parseAuthorization(env, {
    candidateSha: identity.candidateSha,
    manifestSha256,
    runId: normalizedRunId,
    corpusIdentity,
    plan,
  });
  const root = runRootFor({ isolatedOutputRoot: manifest.isolatedOutputRoot, runId: normalizedRunId, appRoot });
  await claimFreshRunRoot(root);
  await persistJson(root, "run-manifest.json", {
    harnessVersion: HARNESS_VERSION,
    runId: normalizedRunId,
    candidateSha: identity.candidateSha,
    manifestSha256,
    corpusIdentity,
    plan,
    maximumSpend: MAX_TOTAL_SPEND_USD,
    runtimeParity,
    authorization: { candidateSha: authorization.candidateSha, manifestSha256: authorization.manifestSha256, runId: authorization.runId },
    samples: manifest.samples.map((sample) => ({ sampleId: sample.sampleId, auditId: sample.auditId, executionId: executionIdentity(normalizedRunId, sample.sampleId) })),
  });
  const results = [];
  const callGuard = createRunCallGuard({ runRoot: root, plan, config, maximumSpend: MAX_TOTAL_SPEND_USD });
  let failure = null;
  try {
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
        executionId: executionIdentity(normalizedRunId, sample.sampleId),
      });
      const result = await runControlledSample({
        sample: { ...sample, candidateSha: identity.candidateSha },
        artifacts,
        outputRoot: root,
        writerExecutor: binding.writerExecutor,
        judgeExecutor: binding.judgeExecutor,
        callGuard,
      });
      results.push(result.record);
    }
  } catch (error) {
    failure = error;
  }
  const summary = {
    harnessVersion: HARNESS_VERSION,
    runId: normalizedRunId,
    candidateSha: identity.candidateSha,
    manifestSha256,
    corpusIdentity,
    plan,
    calls: callGuard.state,
    results,
    result: failure ? "FAILED" : "EXECUTED",
    error: failure ? { message: failure.message, name: failure.name } : null,
  };
  await persistJson(root, "run-summary.json", summary);
  if (failure) throw failure;
  return { result: "EXECUTED", identity, config: { ...config, apiKey: undefined }, runtimeParity, authorization: { runId: authorization.runId }, runId: normalizedRunId, runRoot: root, plan, results, modelCalls: callGuard.state.totalCalls, providerCalls: callGuard.state.totalCalls, actualCost: callGuard.state.cumulativeCost };
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
  const manifestBytes = await readFile(resolve(manifestPath));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const result = args.has("--execute")
    ? await executeManifest({ manifest, manifestSha256: sha256(manifestBytes), runId: args.get("--run-id"), executeRequested: true })
    : await runPreflight({ manifest, runId: args.get("--run-id") });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

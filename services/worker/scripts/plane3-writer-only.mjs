import {
  access,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import {
  createFsArtifactStore,
} from "../src/storage/fs-artifact-store.js";
import {
  buildArtifactKey,
} from "../src/storage/artifact-key.js";
import {
  createNarrativeV2LiveBinding,
} from "../src/narrative-v2/live-binding.js";
import {
  validateWriterOutput,
} from "../src/narrative-v2/writer-output.js";
import {
  WRITER_OUTPUT_VERSION,
  WRITER_PROMPT_VERSION,
} from "../src/narrative-v2/writer-output.js";
import { buildWriterPrompt } from "../src/narrative-v2/writer-prompt.js";

const execFileAsync = promisify(execFile);

export const PLANE3_HARNESS_VERSION = "1.0.0";
export const SEMANTIC_APPLICATION_BASE_SHA = "52eadcc5a8f6bd3a99da7155d0af86ae261a14ab";
export const AUTHORIZED_TOOLING_OVERLAY_PATHS = Object.freeze([
  "services/worker/scripts/plane3-writer-only.mjs",
  "services/worker/scripts/plane3-writer-only.test.js",
]);

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(workerRoot, "..", "..");
const historicalArtifactRoots = [
  resolve(workerRoot, "test-fixtures"),
];

export const APPROVED_INPUTS = Object.freeze({
  "9714c206-8ed3-4686-8fe2-ceeca0ca0f82": Object.freeze({
    sampleType: "PRIMARY_TBK",
    writerInputPath: "test-fixtures/report-replay-offline/audit-9714c206-8ed3-4686-8fe2-ceeca0ca0f82-current/governed/report-v2/narrative-v2/writer-input.json",
    auditRequestPath: "test-fixtures/report-replay-offline/audit-9714c206-8ed3-4686-8fe2-ceeca0ca0f82-current/governed/canonical/audit-request.json",
  }),
  "97d6b2c7-03b9-4530-8ea7-16557502c638": Object.freeze({
    sampleType: "ADDITIONAL_REBOOT",
    writerInputPath: "test-fixtures/report-replay/audit-97d6b2c7/governed/report-v2/narrative-v2/writer-input.json",
    auditRequestPath: "test-fixtures/report-replay/audit-97d6b2c7/governed/canonical/audit-request.json",
  }),
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${requirementSeparator()}`) && !isAbsolute(rel));
}

function requirementSeparator() {
  return "\\";
}

function assertOutside(candidate, parent, label) {
  if (inside(candidate, parent)) {
    throw new Error(`${label} must be outside ${parent}`);
  }
}

async function runGit(args, root = repositoryRoot) {
  return execFileAsync("git", ["-C", root, ...args]);
}

export async function verifyRuntimeIdentity({
  repositoryRootOverride = repositoryRoot,
  runGitCommand = (args) => runGit(args, repositoryRootOverride),
} = {}) {
  const expectedRoot = resolve(repositoryRootOverride);
  const { stdout: actualRootOutput } = await runGitCommand(["rev-parse", "--show-toplevel"]);
  const actualRoot = resolve(actualRootOutput.trim());
  if (actualRoot !== expectedRoot) {
    throw new Error("Plane 3 harness repository root identity mismatch");
  }

  const { stdout: semanticBaseOutput } = await runGitCommand([
    "rev-parse",
    "--verify",
    `${SEMANTIC_APPLICATION_BASE_SHA}^{commit}`,
  ]);
  const semanticApplicationBaseSha = semanticBaseOutput.trim();
  if (semanticApplicationBaseSha !== SEMANTIC_APPLICATION_BASE_SHA) {
    throw new Error("Plane 3 harness semantic application base is invalid");
  }

  const { stdout: toolingHeadOutput } = await runGitCommand(["rev-parse", "HEAD"]);
  const toolingHeadSha = toolingHeadOutput.trim();
  const { stdout: statusOutput } = await runGitCommand([
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  const worktreeClean = statusOutput.trim() === "";
  if (!worktreeClean) {
    throw new Error("Plane 3 harness requires a clean worktree");
  }

  try {
    await runGitCommand(["merge-base", "--is-ancestor", semanticApplicationBaseSha, toolingHeadSha]);
  } catch {
    throw new Error("Plane 3 harness tooling HEAD is not a descendant of the semantic application base");
  }

  const { stdout: changedPathsOutput } = await runGitCommand([
    "diff",
    "--name-only",
    semanticApplicationBaseSha,
    toolingHeadSha,
  ]);
  const changedPaths = changedPathsOutput.split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
  const unboundedPaths = changedPaths.filter((path) => !AUTHORIZED_TOOLING_OVERLAY_PATHS.includes(path));
  if (unboundedPaths.length > 0) {
    throw new Error(`Plane 3 harness tooling overlay contains unauthorized paths: ${unboundedPaths.join(", ")}`);
  }

  return Object.freeze({
    semanticApplicationBaseSha,
    toolingHeadSha,
    worktreeClean,
    boundedOverlayVerified: true,
    changedPaths,
  });
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readPersistedResult(store, scope) {
  const key = buildArtifactKey({
    ...scope,
    category: "report",
    artifactName: "report-v2/narrative-v2/live-usage/call-01-result.json",
  });
  try {
    return JSON.parse((await store.get(key)).toString("utf8"));
  } catch {
    return null;
  }
}

function parseAuditId(argv) {
  if (argv.length !== 2 || argv[0] !== "--audit-id" || !argv[1]) {
    throw new Error("Usage: node scripts/plane3-writer-only.mjs --audit-id <approved-audit-id>");
  }
  return argv[1];
}

export async function resolveApprovedInput({ auditId, appRoot = repositoryRoot }) {
  const approved = APPROVED_INPUTS[auditId];
  if (!approved) {
    throw new Error(`Plane 3 Writer-only harness rejects unapproved audit ID: ${auditId}`);
  }
  const inputPath = resolve(appRoot, "services", "worker", approved.writerInputPath);
  const requestPath = resolve(appRoot, "services", "worker", approved.auditRequestPath);
  if (!inside(inputPath, appRoot) || !inside(requestPath, appRoot)) {
    throw new Error("Approved input path escaped the application repository");
  }
  await access(inputPath);
  await access(requestPath);
  const [writerInput, auditRequest] = await Promise.all([
    loadJson(inputPath),
    loadJson(requestPath),
  ]);
  if (writerInput.auditId !== auditId || auditRequest.auditId !== auditId) {
    throw new Error("Approved WriterInput and AuditRequest identity mismatch");
  }
  return Object.freeze({
    ...approved,
    auditId,
    inputPath,
    requestPath,
    writerInput,
    auditRequest,
  });
}

export async function createIsolatedLedger({ auditId, root = join(tmpdir(), "prysm-plane3-writer-only") }) {
  const resolvedRoot = resolve(root);
  assertOutside(resolvedRoot, repositoryRoot, "Plane 3 ledger root");
  for (const historicalRoot of historicalArtifactRoots) {
    assertOutside(resolvedRoot, historicalRoot, "Plane 3 ledger root");
  }
  await import("node:fs/promises").then(({ mkdir }) => mkdir(resolvedRoot, { recursive: true }));
  const ledgerPath = await mkdtemp(join(resolvedRoot, `sample-${auditId.slice(0, 8)}-`));
  assertOutside(ledgerPath, repositoryRoot, "Plane 3 ledger");
  return ledgerPath;
}

export async function runWriterOnlySample({
  auditId,
  env = process.env,
  appRoot = repositoryRoot,
  ledgerRoot,
  executionIdFactory = (id) => `plane3-writer-only-${id}-${cryptoRandomId()}`,
  storeFactory = createFsArtifactStore,
  bindingFactory = createNarrativeV2LiveBinding,
  identityVerifier = verifyRuntimeIdentity,
}) {
  const runtimeIdentity = await identityVerifier({ repositoryRootOverride: appRoot });
  const selected = await resolveApprovedInput({ auditId, appRoot });
  const executionId = executionIdFactory(auditId);
  if (typeof executionId !== "string" || executionId.length < 16) {
    throw new Error("Plane 3 harness requires an isolated execution identity");
  }
  const ledgerPath = await createIsolatedLedger({ auditId, root: ledgerRoot });
  const artifactStore = storeFactory({ baseDir: ledgerPath });
  const binding = bindingFactory({
    env,
    artifactStore,
    requireDurableStore: true,
  });
  if (!binding?.enabled) throw new Error("Narrative v2 live binding is disabled");
  if (typeof binding.writerExecutor !== "function") throw new Error("Narrative v2 Writer executor is unavailable");
  if (typeof binding.judgeExecutor === "function" && binding.judgeExecutor === binding.writerExecutor) {
    throw new Error("Writer-only harness cannot alias Judge executor");
  }
  const config = binding.config || {};
  for (const [name, value] of [["writerModel", config.writerModel], ["hardBudgetUsd", config.hardBudgetUsd], ["dailyHardBudgetUsd", config.dailyHardBudgetUsd]]) {
    if (value === undefined || value === null || value === "") throw new Error(`Required governance metadata unavailable: ${name}`);
  }
  binding.registerAuditScope({
    tenantId: selected.auditRequest.tenantId,
    clientId: selected.auditRequest.clientId,
    auditId,
    executionId,
  });
  const writerInputSha256 = sha256(JSON.stringify(selected.writerInput));
  const startedAt = new Date().toISOString();
  let output;
  let validation;
  let error = null;
  try {
    output = await binding.writerExecutor({
      prompt: buildWriterPrompt({
        writerInput: selected.writerInput,
        passNumber: 1,
      }),
      writerInput: selected.writerInput,
      passNumber: 1,
    });
    validation = validateWriterOutput(output, {
      writerInput: selected.writerInput,
      expectedPassNumber: 1,
    });
    if (!validation.valid) throw new Error(`Writer validation failed: ${(validation.errors || []).join("; ")}`);
  } catch (err) {
    error = err;
    validation = validation || { valid: false, errors: [err.message] };
  }
  const persistedResult = await readPersistedResult(artifactStore, {
    tenantId: selected.auditRequest.tenantId,
    clientId: selected.auditRequest.clientId,
    auditId,
  });
  const manifest = {
    contractVersion: "1.0.0",
    harnessVersion: PLANE3_HARNESS_VERSION,
    candidateSha: runtimeIdentity.semanticApplicationBaseSha,
    semanticApplicationBaseSha: runtimeIdentity.semanticApplicationBaseSha,
    toolingHeadSha: runtimeIdentity.toolingHeadSha,
    worktreeClean: runtimeIdentity.worktreeClean,
    boundedOverlayVerified: runtimeIdentity.boundedOverlayVerified,
    changedPaths: runtimeIdentity.changedPaths,
    auditId,
    sampleType: selected.sampleType,
    executionId,
    ledgerPath,
    ledgerDurability: "FILESYSTEM",
    writerModelId: config.writerModel,
    writerPromptVersion: WRITER_PROMPT_VERSION,
    writerOutputVersion: WRITER_OUTPUT_VERSION,
    validator: "validateWriterOutput",
    passNumber: 1,
    writerInputSha256,
    writerOutputSha256: output ? sha256(JSON.stringify(output)) : null,
    responseSha256: persistedResult?.responseSha256 || null,
    validationResult: validation.valid ? "PASS" : "FAIL",
    validationErrors: validation.errors || [],
    inputTokens: persistedResult?.inputTokens ?? null,
    outputTokens: persistedResult?.outputTokens ?? null,
    cachedInputTokens: persistedResult?.cachedInputTokens ?? null,
    estimatedCost: persistedResult?.estimatedCost ?? null,
    actualCost: persistedResult?.actualCost ?? null,
    modelCalls: 1,
    judgeCalls: 0,
    providerRecollection: "NONE",
    evidenceRescore: "NO",
    startedAt,
    completedAt: new Date().toISOString(),
    finalStatus: validation.valid ? "WRITER_VALIDATED" : "WRITER_VALIDATION_FAILED",
  };
  if (error) manifest.error = error.message;
  const manifestPath = join(ledgerPath, "plane3-sample-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return Object.freeze({ manifest, manifestPath, output, binding, selected });
}

function cryptoRandomId() {
  return randomUUID();
}

export async function main(argv = process.argv.slice(2)) {
  const auditId = parseAuditId(argv);
  const result = await runWriterOnlySample({ auditId });
  console.log(JSON.stringify({
    RESULT: result.manifest.finalStatus,
    AUDIT_ID: result.manifest.auditId,
    EXECUTION_ID: result.manifest.executionId,
    LEDGER: result.manifest.ledgerPath,
    MANIFEST: result.manifestPath,
    WRITER_MODEL: result.manifest.writerModelId,
    VALIDATION: result.manifest.validationResult,
    MODEL_CALLS: result.manifest.modelCalls,
    JUDGE_CALLS: result.manifest.judgeCalls,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

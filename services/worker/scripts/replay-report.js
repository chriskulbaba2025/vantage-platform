#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKER_ROOT = resolve(__dirname, "..");
const CONTRACTS_DIR = resolve(WORKER_ROOT, "src", "contracts");
const DEFAULT_FIXTURE_ROOT = resolve(
  WORKER_ROOT,
  "test-fixtures",
  "report-replay",
);
const LEGACY_COMPAT_MODE = process.argv.includes("--legacy-compat");
const SCHEMA_BASE = "https://vantage-platform.io/prysm/contracts/v1/";

const REQUIRED_ARTIFACTS = Object.freeze({
  auditRequest: "governed/canonical/audit-request.json",
  capabilityEvidence: "governed/canonical/capability-evidence.json",
  decisionEvidence: "governed/canonical/decision-evidence.json",
  findings: "governed/canonical/findings.json",
  scores: "governed/canonical/scores.json",
  writerInput: "governed/report-v2/narrative-v2/writer-input.json",
  orchestration: "governed/report-v2/narrative-v2/orchestration.json",
});

const OPTIONAL_ARTIFACTS = Object.freeze({
  finalPassOrchestration:
    "governed/report-v2/narrative-v2/orchestration-final-pass.json",
  governedHtml: "governed/report-v2/pages/index.html",
  publishedHtml: "published/index.html",
});

const SCHEMA_FILES = Object.freeze([
  "audit-request.schema.json",
  "source-result.schema.json",
  "canonical-evidence.schema.json",
  "capability-evidence.schema.json",
  "conversion-path-validation.schema.json",
  "decision-evidence.schema.json",
  "finding.schema.json",
  "score.schema.json",
  "report-content.schema.json",
  "narrative-response.schema.json",
  "report-view-model.schema.json",
  "report-manifest.schema.json",
  "artifact-record.schema.json",
  "lifecycle-event.schema.json",
  "lifecycle-state.schema.json",
]);

function installOfflineGuard() {
  globalThis.fetch = async () => {
    throw new Error(
      "PRYSM offline replay blocked an attempted network request",
    );
  };
}

installOfflineGuard();

const [
  { runFinalizationGate },
  { renderGovernedNarrativeReportV2 },
  { SOURCE_STATUS, isValidSourceStatus },
  { REPORT_V2_VIEWER_VERSION },
  { validateJudgeResponse },
  { hydrateCurrentReportModel },
] = await Promise.all([
  import("../src/scoring/report-finalization-gate.js"),
  import("../src/report/render-narrative-v2.js"),
  import("../src/scoring/evidence-contracts.js"),
  import("../src/report/render-report-v2.js"),
  import("../src/narrative-v2/judge-contract.js"),
  import("../src/report-model/current-model.js"),
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`${label} could not be read: ${error.message}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function readOptionalJson(path, label) {
  if (!(await pathExists(path))) return null;
  return readJson(path, label);
}

async function createContractValidator() {
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
  });
  addFormats(ajv);

  for (const fileName of SCHEMA_FILES) {
    const schemaPath = resolve(CONTRACTS_DIR, fileName);
    const schema = await readJson(schemaPath, `Schema ${fileName}`);

    ajv.addSchema(
      schema,
      `${SCHEMA_BASE}${fileName}`,
    );
  }

  return function validateContract(schemaId, value) {
    const validator = ajv.getSchema(schemaId);

    if (!validator) {
      return {
        valid: false,
        errors: [
          {
            message: `Schema not loaded: ${schemaId}`,
          },
        ],
      };
    }

    const valid = validator(value);

    return {
      valid,
      errors: validator.errors || [],
    };
  };
}

function formatValidationErrors(errors) {
  return (errors || [])
    .slice(0, 5)
    .map((error) => {
      const location =
        error.instancePath ||
        error.schemaPath ||
        "input";

      return `${location}: ${error.message || "invalid"}`;
    })
    .join("; ");
}

function assertSchema(
  validateContract,
  schemaFile,
  value,
  label,
) {
  const result = validateContract(
    `${SCHEMA_BASE}${schemaFile}`,
    value,
  );

  if (!result.valid) {
    throw new Error(
      `${label} schema validation failed: ${formatValidationErrors(
        result.errors,
      )}`,
    );
  }
}

function normalizeFindings(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (Array.isArray(raw?.findings)) {
    return raw.findings;
  }

  throw new Error(
    "findings.json must contain an array of findings",
  );
}

async function isFixtureDirectory(directory) {
  return pathExists(
    resolve(
      directory,
      REQUIRED_ARTIFACTS.auditRequest,
    ),
  );
}

async function discoverFixtureDirectories(inputPath) {
  const root = resolve(inputPath);

  if (await isFixtureDirectory(root)) {
    return [root];
  }

  let entries;

  try {
    entries = await readdir(root, {
      withFileTypes: true,
    });
  } catch (error) {
    throw new Error(
      `Replay input could not be read: ${error.message}`,
    );
  }

  const directories = [];

  for (
    const entry of entries
      .filter((item) => item.isDirectory())
      .sort((a, b) =>
        a.name.localeCompare(b.name),
      )
  ) {
    const candidate = resolve(
      root,
      entry.name,
    );

    if (await isFixtureDirectory(candidate)) {
      directories.push(candidate);
    }
  }

  if (directories.length === 0) {
    throw new Error(
      `No replay fixtures found under ${root}. Expected audit directories containing ${REQUIRED_ARTIFACTS.auditRequest}`,
    );
  }

  return directories;
}

async function loadFixture(directory) {
  const paths = Object.fromEntries(
    Object.entries(REQUIRED_ARTIFACTS).map(
      ([key, value]) => [
        key,
        resolve(directory, value),
      ],
    ),
  );

  for (
    const [key, path] of Object.entries(paths)
  ) {
    if (!(await pathExists(path))) {
      throw new Error(
        `Required replay artifact missing: ${REQUIRED_ARTIFACTS[key]}`,
      );
    }
  }

  const [
    auditRequest,
    capabilityEvidence,
    decisionEvidence,
    findingsRaw,
    scoreSet,
    writerInput,
    baseOrchestration,
  ] = await Promise.all([
    readJson(
      paths.auditRequest,
      "audit-request.json",
    ),
    readJson(
      paths.capabilityEvidence,
      "capability-evidence.json",
    ),
    readJson(
      paths.decisionEvidence,
      "decision-evidence.json",
    ),
    readJson(
      paths.findings,
      "findings.json",
    ),
    readJson(
      paths.scores,
      "scores.json",
    ),
    readJson(
      paths.writerInput,
      "writer-input.json",
    ),
    readJson(
      paths.orchestration,
      "orchestration.json",
    ),
  ]);

  const finalPassPath = resolve(
    directory,
    OPTIONAL_ARTIFACTS.finalPassOrchestration,
  );

  const finalPassOrchestration =
    await readOptionalJson(
      finalPassPath,
      "orchestration-final-pass.json",
    );

  return {
    auditRequest,
    capabilityEvidence,
    decisionEvidence,
    findings: normalizeFindings(findingsRaw),
    scoreSet,
    writerInput,
    orchestrationResult:
      finalPassOrchestration ||
      baseOrchestration,
  };
}

function assertIdentity(inputs) {
  const auditId =
    inputs.auditRequest?.auditId;

  if (
    typeof auditId !== "string" ||
    auditId.length === 0
  ) {
    throw new Error(
      "audit-request.json does not contain a valid auditId",
    );
  }

  const identities = [
    [
      "capability-evidence.json",
      inputs.capabilityEvidence?.auditId,
    ],
    [
      "writer-input.json",
      inputs.writerInput?.auditId,
    ],
    [
      "orchestration.json",
      inputs.orchestrationResult?.auditId,
    ],
    [
      "final WriterOutput",
      inputs.orchestrationResult
        ?.finalWriterOutput?.auditId,
    ],
  ];

  for (
    const [label, candidate] of identities
  ) {
    if (candidate !== auditId) {
      throw new Error(
        `${label} auditId mismatch: expected ${auditId}, got ${String(
          candidate,
        )}`,
      );
    }
  }
}

function assertReplayContracts(
  inputs,
  validateContract,
) {
  assertSchema(
    validateContract,
    "audit-request.schema.json",
    inputs.auditRequest,
    "AuditRequest",
  );

  assertSchema(
    validateContract,
    "decision-evidence.schema.json",
    inputs.decisionEvidence,
    "DecisionEvidence",
  );

  assertSchema(
    validateContract,
    "capability-evidence.schema.json",
    inputs.capabilityEvidence,
    "CapabilityEvidence",
  );

  assertSchema(
    validateContract,
    "score.schema.json",
    inputs.scoreSet,
    "ScoreSet",
  );

  if (inputs.scoreSet.contractVersion !== "2.0.0") {
    throw new Error(
      `Current replay requires ScoreSet contract 2.0.0; got ${String(inputs.scoreSet.contractVersion || "missing")}. Historical artifacts are compatibility-only`,
    );
  }

  if (!inputs.scoreSet.rootCauseRuleId || !inputs.scoreSet.decisionHierarchy) {
    throw new Error(
      "Current replay requires persisted current root-cause identity and decision hierarchy",
    );
  }

  for (
    let index = 0;
    index < inputs.findings.length;
    index += 1
  ) {
    assertSchema(
      validateContract,
      "finding.schema.json",
      inputs.findings[index],
      `Finding ${index + 1}`,
    );
  }

  assertIdentity(inputs);

  if (
    inputs.auditRequest.report
      ?.designVersion !== "2.0.0"
  ) {
    throw new Error(
      "Replay requires persisted report designVersion 2.0.0",
    );
  }

  if (
    inputs.auditRequest.report
      ?.narrativeVersion !== "2.0.0"
  ) {
    throw new Error(
      "Replay requires persisted narrativeVersion 2.0.0",
    );
  }

  const orchestration =
    inputs.orchestrationResult;

  if (
    orchestration?.status !==
    "RELEASE_CANDIDATE"
  ) {
    throw new Error(
      `Replay requires a persisted RELEASE_CANDIDATE; got ${String(
        orchestration?.status,
      )}`,
    );
  }

  if (
    !Number.isInteger(
      orchestration?.passCount,
    ) ||
    orchestration.passCount < 1 ||
    orchestration.passCount > 3
  ) {
    throw new Error(
      "Replay orchestration passCount must be an integer from 1 to 3",
    );
  }

  if (
    !Array.isArray(
      orchestration?.passes,
    ) ||
    orchestration.passes.length <
      orchestration.passCount
  ) {
    throw new Error(
      `Replay requires ${orchestration.passCount} persisted orchestration pass record(s)`,
    );
  }

  if (
    orchestration.finalJudgeResponse
      ?.decision !== "PASS"
  ) {
    throw new Error(
      "Replay requires a persisted final Judge PASS decision",
    );
  }

  const judgeValidation =
    validateJudgeResponse(
      orchestration.finalJudgeResponse,
      {
        writerInput: inputs.writerInput,
        expectedPassNumber:
          orchestration.passCount,
      },
    );

if (!judgeValidation.valid) {
  // Historical governed Narrative v2 fixtures may contain a Judge PASS
  // produced under the prior 1.0.0 / 2.0.0 Judge contract pair.
  //
  // Offline replay may accept that historical provenance only when the
  // CURRENT validator reports version mismatches and no other defect.
  // Production validation remains unchanged.
  const historicalJudge =
    orchestration.finalJudgeResponse
      ?.contractVersion === "1.0.0" &&
    orchestration.finalJudgeResponse
      ?.judgePromptVersion === "2.0.0";

  const nonVersionErrors =
    judgeValidation.errors.filter(
      (error) =>
        !/^contractVersion must equal \d+\.\d+\.\d+$/.test(
          error,
        ) &&
        !/^judgePromptVersion must equal \d+\.\d+\.\d+$/.test(
          error,
        ),
    );

  if (
    !LEGACY_COMPAT_MODE && historicalJudge
  ) {
    throw new Error(
      "Historical JudgeResponse contract 1.0.0/2.0.0 is compatibility-only; rerun with --legacy-compat and do not count this replay as current release proof",
    );
  }

  if (
    !historicalJudge ||
    nonVersionErrors.length > 0
  ) {
    throw new Error(
      `Persisted final JudgeResponse is invalid: ${judgeValidation.errors.join(
        "; ",
      )}`,
    );
  }
}
}

function resolveCompetitorSourceStatus(
  decisionEvidence,
) {
  const canonicalStatus =
    decisionEvidence?.sourceStatus
      ?.competitors;

  if (
    isValidSourceStatus(canonicalStatus)
  ) {
    return canonicalStatus;
  }

  const legacyStatus =
    Array.isArray(
      decisionEvidence?.competitors,
    ) &&
    decisionEvidence.competitors.length > 0
      ? decisionEvidence.competitors[0]
          ?.status
      : null;

  return isValidSourceStatus(
    legacyStatus,
  )
    ? legacyStatus
    : SOURCE_STATUS.NOT_APPLICABLE;
}

function buildV2Model({
  auditRequest,
  scoreSet,
  findings,
  capabilityEvidence,
  decisionEvidence,
}) {
  const current = hydrateCurrentReportModel({
    scoreSet,
    findings,
    decisionEvidence,
    capabilityEvidence,
  });

  return {
    ...current,

    sourceStatus: {
      competitors:
        resolveCompetitorSourceStatus(
          decisionEvidence,
        ),
    },

    input: {
      businessName:
        auditRequest.businessName || "",

      targetUrl:
        decisionEvidence.site?.targetUrl ||
        auditRequest.targetUrl,
    },

    conversionPaths:
      scoreSet.conversionPaths || [],

    readinessMap:
      scoreSet.readinessMap || [],

    contentIdeas:
      scoreSet.contentIdeas || {
        tofu: [],
        mofu: [],
        bofu: [],
        leading: [],
      },

    competitors:
      scoreSet.competitors || {
        comparisons: [],

        opportunities: {
          topics: [],
          qualifiedCandidates: [],
          excludedCandidates: [],
          gaps: [],
          allGaps: [],
          sources: {},
          limitations: [],
        },
      },
  };
}

async function loadSavedHtml(
  fixtureDirectory,
) {
  for (
    const artifact of [
      OPTIONAL_ARTIFACTS.governedHtml,
      OPTIONAL_ARTIFACTS.publishedHtml,
    ]
  ) {
    const path = resolve(
      fixtureDirectory,
      artifact,
    );

    if (await pathExists(path)) {
      return {
        path,
        bytes: await readFile(path),
      };
    }
  }

  return null;
}

function safeDirectoryName(value) {
  return String(value).replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );
}

async function replayFixture({
  fixtureDirectory,
  outputRoot,
  validateContract,
}) {
  const inputs = await loadFixture(
    fixtureDirectory,
  );

  assertReplayContracts(
    inputs,
    validateContract,
  );

  const model = buildV2Model({
    auditRequest: inputs.auditRequest,
    scoreSet: inputs.scoreSet,
    findings: inputs.findings,
    capabilityEvidence:
      inputs.capabilityEvidence,
    decisionEvidence:
      inputs.decisionEvidence,
  });

  const gate = runFinalizationGate(
    {
      ...model,
      findings: inputs.findings,
    },
    inputs.decisionEvidence,
  );

  if (!gate.passed) {
    const message = (
      gate.errors || []
    )
      .map(
        (error) => error.message,
      )
      .join("; ");

    throw new Error(
      `Finalization gate failed: ${message}`,
    );
  }

  const html =
    renderGovernedNarrativeReportV2({
      model,
      writerInput:
        inputs.writerInput,
      orchestrationResult:
        inputs.orchestrationResult,
    });

  if (
    !/^<!doctype html>/i.test(html) ||
    !html.includes(
      'id="narrative-layer"',
    ) ||
    !html.includes(
      `data-viewer-version="${REPORT_V2_VIEWER_VERSION}"`,
    )
  ) {
    throw new Error(
      `Renderer did not produce governed Viewer v${REPORT_V2_VIEWER_VERSION} HTML`,
    );
  }

  const auditId =
    inputs.auditRequest.auditId;

  const auditOutputDirectory =
    resolve(
      outputRoot,
      safeDirectoryName(auditId),
    );

  await mkdir(
    auditOutputDirectory,
    {
      recursive: true,
    },
  );

  const outputHtmlPath = resolve(
    auditOutputDirectory,
    "index.html",
  );

  const replayBytes =
    Buffer.from(html, "utf8");

  await writeFile(
    outputHtmlPath,
    replayBytes,
  );

  const savedHtml =
    await loadSavedHtml(
      fixtureDirectory,
    );

  const replaySha256 =
    sha256(replayBytes);

  const savedHtmlSha256 =
    savedHtml
      ? sha256(savedHtml.bytes)
      : null;

  const summary = {
    auditId,

    fixtureDirectory,

    viewerVersion:
      REPORT_V2_VIEWER_VERSION,

    scoringVersion:
      inputs.scoreSet
        .scoringVersion || null,

    generatedAt:
      inputs.scoreSet.generatedAt ||
      null,

    findingCount:
      inputs.findings.length,

    narrativePassCount:
      inputs.orchestrationResult
        .passCount,

    replaySha256,

    savedHtmlPath:
      savedHtml?.path || null,

    savedHtmlSha256,

    matchesSavedHtml:
      savedHtmlSha256 === null
        ? null
        : savedHtmlSha256 ===
          replaySha256,

    outputHtmlPath,
  };

  await writeFile(
    resolve(
      auditOutputDirectory,
      "replay-summary.json",
    ),
    `${JSON.stringify(
      summary,
      null,
      2,
    )}\n`,
    "utf8",
  );

  return summary;
}

function baselineLabel(summary) {
  if (
    summary.matchesSavedHtml === true
  ) {
    return "MATCH";
  }

  if (
    summary.matchesSavedHtml === false
  ) {
    return "DIFF";
  }

  return "NO_SAVED_HTML";
}

async function main() {
  const inputArgument = process.argv.slice(2).find((arg) => arg !== "--legacy-compat");
  if (process.argv.slice(2).filter((arg) => arg !== "--legacy-compat").length > 1) {
    throw new Error(
      "Usage: node scripts/replay-report.js [fixture-directory-or-report-replay-root]",
    );
  }

  const inputPath =
    inputArgument
      ? resolve(
          process.cwd(),
          inputArgument,
        )
      : DEFAULT_FIXTURE_ROOT;

  const fixtureDirectories =
    await discoverFixtureDirectories(
      inputPath,
    );

  const validateContract =
    await createContractValidator();

  const outputRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "prysm-report-replay-",
      ),
    );

  const successes = [];
  const failures = [];

  console.log(
    "PRYSM offline report replay",
  );

  console.log(
    `Input: ${inputPath}`,
  );

  console.log(
    `Fixtures: ${fixtureDirectories.length}`,
  );

  console.log(
    `Output: ${outputRoot}`,
  );

  for (
    const fixtureDirectory of
      fixtureDirectories
  ) {
    try {
      const summary =
        await replayFixture({
          fixtureDirectory,
          outputRoot,
          validateContract,
        });

      successes.push(summary);

      console.log(
        `PASS ${summary.auditId} | viewer ${summary.viewerVersion} | findings ${summary.findingCount} | baseline ${baselineLabel(
          summary,
        )} | sha256 ${summary.replaySha256.slice(
          0,
          12,
        )}`,
      );

      console.log(
        `  ${summary.outputHtmlPath}`,
      );
    } catch (error) {
      const failure = {
        fixture:
          relative(
            inputPath,
            fixtureDirectory,
          ) ||
          basename(
            fixtureDirectory,
          ),

        message:
          error.message,
      };

      failures.push(failure);

      console.error(
        `FAIL ${failure.fixture} | ${failure.message}`,
      );
    }
  }

  console.log(
    `Replay result: ${successes.length}/${fixtureDirectories.length} PASS`,
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `Replay failed: ${error.message}`,
    );

    process.exitCode = 1;
  });
}

export { buildV2Model };

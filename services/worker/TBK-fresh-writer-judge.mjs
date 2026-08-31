import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";

import {
  resolve,
  join,
} from "node:path";

import {
  createFsArtifactStore,
} from "./src/storage/fs-artifact-store.js";

import {
  createNarrativeV2LiveBinding,
} from "./src/narrative-v2/live-binding.js";

import {
  runNarrativeV2Orchestration,
} from "./src/narrative-v2/orchestrator.js";

const fixture = resolve(
  "./test-fixtures/report-replay-offline/audit-9714c206-8ed3-4686-8fe2-ceeca0ca0f82-current",
);

const narrativeDir = join(
  fixture,
  "governed",
  "report-v2",
  "narrative-v2",
);

const writerInput = JSON.parse(
  await readFile(
    join(narrativeDir, "writer-input.json"),
    "utf8",
  ),
);

const auditRequest = JSON.parse(
  await readFile(
    join(
      fixture,
      "governed",
      "canonical",
      "audit-request.json",
    ),
    "utf8",
  ),
);

if (
  !auditRequest.tenantId ||
  !auditRequest.clientId
) {
  throw new Error(
    "Frozen audit request is missing tenantId or clientId.",
  );
}

const ledgerDir = join(
  narrativeDir,
  "fresh-live-ledger",
);

await mkdir(
  ledgerDir,
  { recursive: true },
);

const artifactStore =
  createFsArtifactStore({
    baseDir: ledgerDir,
  });

const binding =
  createNarrativeV2LiveBinding({
    env: process.env,
    artifactStore,
  });

if (!binding.enabled) {
  throw new Error(
    "Narrative v2 live binding is disabled.",
  );
}

binding.registerAuditScope({
  tenantId: auditRequest.tenantId,
  clientId: auditRequest.clientId,
  auditId: writerInput.auditId,
  executionId:
    `tbk-fresh-narrative-${Date.now()}`,
});

console.log(
  "=== TBK FRESH WRITER/JUDGE ===",
);

console.log(
  `AUDIT_ID=${writerInput.auditId}`,
);

console.log(
  `WRITER_MODEL=${process.env.PRYSM_NARRATIVE_V2_WRITER_MODEL}`,
);

console.log(
  `JUDGE_MODEL=${process.env.PRYSM_NARRATIVE_V2_JUDGE_MODEL}`,
);

const result =
  await runNarrativeV2Orchestration({
    writerInput,
    writerExecutor:
      binding.writerExecutor,
    judgeExecutor:
      binding.judgeExecutor,
  });

const outputPath = join(
  narrativeDir,
  "orchestration-refresh.json",
);

await writeFile(
  outputPath,
  JSON.stringify(result, null, 2) + "\n",
  "utf8",
);

console.log(
  `STATUS=${result.status}`,
);

console.log(
  `PASS_COUNT=${result.passCount}`,
);

console.log(
  `JUDGE_DECISION=${result.finalJudgeResponse?.decision ?? "NONE"}`,
);

console.log(
  `JUDGE_SCORE=${result.finalJudgeResponse?.totalScore ?? "NONE"}`,
);

console.log(
  `DEFECT_COUNT=${result.finalJudgeResponse?.defects?.length ?? 0}`,
);

for (
  const defect of
    result.finalJudgeResponse?.defects ?? []
) {
  console.log(
    `DEFECT=${defect.defectId} | ${defect.criterion} | ${defect.problem}`,
  );
}

console.log(
  `OUTPUT=${outputPath}`,
);

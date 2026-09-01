/**
 * Deterministic, zero-cost PRYSM Whole-App Tranche Gate.
 *
 * The production acceptance harness exercises the assembled lifecycle with
 * controlled transports. The application-path suite proves the current
 * Narrative v2 composition is included in the same release surface.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const node = process.execPath;
const replayFixture = mkdtempSync(resolve(tmpdir(), "prysm-whole-app-current-replay-"));
const gateEnv = { ...process.env, PRYSM_CURRENT_REPLAY_EXPORT_DIR: replayFixture };
const commands = [
  ["scripts/acceptance-prysm.js", "assembled production composition"],
  ["--test", "src/narrative-v2/writer-input.test.js", "persisted hierarchy WriterInput parity"],
  ["--test", "src/application/narrative-v2-production-path.test.js", "current Narrative v2 production path"],
  ["--test", "scripts/replay-report.test.js", "current replay canonical hydration"],
  ["--test", "scripts/replay-report-cli.test.js", "replay CLI historical compatibility boundary"],
  ["--test", "src/report-model/current-consumer-parity.test.js", "base, Narrative v2, and replay current-model parity"],
];

try {
for (const args of commands) {
  const label = args.at(-1);
  const commandArgs = args[0] === "--test" ? args.slice(0, -1) : args.slice(0, -1);
  process.stdout.write(`\n[WHOLE-APP] ${label}\n`);
  execFileSync(node, commandArgs, { stdio: "inherit", env: args[0] === "scripts/acceptance-prysm.js" ? gateEnv : { ...process.env, PRYSM_CURRENT_REPLAY_FIXTURE: replayFixture } });
}
process.stdout.write("\n[WHOLE-APP] current replay CLI from production-composed artifacts\n");
execFileSync(node, ["scripts/replay-report.js", replayFixture], { stdio: "inherit", env: process.env });
} finally {
  rmSync(replayFixture, { recursive: true, force: true });
}

process.stdout.write("\nPRYSM WHOLE-APP TRANCHE GATE: PASS\n");
process.stdout.write("Covered branch IDs: P-B01,P-B02,P-B03,P-B04,P-B05,P-B06,P-B07,P-B08,P-B09,P-B10,P-B11,P-B12,P-B13\n");

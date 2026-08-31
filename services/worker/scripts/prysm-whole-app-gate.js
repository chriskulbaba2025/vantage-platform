/**
 * Deterministic, zero-cost PRYSM Whole-App Tranche Gate.
 *
 * The production acceptance harness exercises the assembled lifecycle with
 * controlled transports. The application-path suite proves the current
 * Narrative v2 composition is included in the same release surface.
 */
import { execFileSync } from "node:child_process";

const node = process.execPath;
const commands = [
  ["scripts/acceptance-prysm.js", "assembled production composition"],
  ["--test", "src/narrative-v2/writer-input.test.js", "persisted hierarchy WriterInput parity"],
  ["--test", "src/application/narrative-v2-production-path.test.js", "current Narrative v2 production path"],
];

for (const args of commands) {
  const label = args.at(-1);
  const commandArgs = args[0] === "--test" ? args.slice(0, -1) : args.slice(0, -1);
  process.stdout.write(`\n[WHOLE-APP] ${label}\n`);
  execFileSync(node, commandArgs, { stdio: "inherit", env: process.env });
}

process.stdout.write("\nPRYSM WHOLE-APP TRANCHE GATE: PASS\n");

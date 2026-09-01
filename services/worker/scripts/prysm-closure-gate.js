/**
 * Authoritative local PRYSM closure gate.
 *
 * Keep the release surface explicit. In particular, do not rely on a glob
 * that can silently omit src/application or the current whole-app proof.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const node = process.execPath;
const required = [
  "src/application/*.test.js",
  "src/narrative-v2/*.test.js",
  "src/contracts/validator.test.js",
  "src/report/verify-template.js",
  "scripts/prysm-whole-app-gate.js",
];
for (const path of required) {
  if (!existsSync(path.replace("/*.test.js", "")) && !existsSync(path)) {
    throw new Error(`PRYSM closure surface missing: ${path}`);
  }
}

const commands = [
  [["--test", "src/evidence/*.test.js", "src/scoring/*.test.js", "src/report/*.test.js", "src/audit/*.test.js", "src/storage/*.test.js", "src/adapters/**/*.test.js", "src/auth/*.test.js", "src/n8n/*.test.js", "src/utils/*.test.js"], "worker regression families"],
  // production-bootstrap.test.js temporarily instruments globalThis.fetch;
  // serialize this family so sibling production-path files cannot race that
  // process-local proof harness and create false provider-call failures.
  [["--test", "--test-concurrency=1", "src/application/*.test.js"], "application production-path tests"],
  [["--test", "src/narrative-v2/*.test.js"], "Narrative v2 tests"],
  [["--test", "src/contracts/validator.test.js"], "schema and contract tests"],
  [["--test", "test-fixtures/artifacts/memory-artifact-store.test.js", "test-fixtures/artifacts/fs-artifact-store.test.js", "test-fixtures/artifacts/object-artifact-store.test.js"], "artifact tests"],
  [["--test", "test-fixtures/lifecycle/memory-repository.test.js", "test-fixtures/lifecycle/postgres-repository.test.js"], "lifecycle tests"],
  [["scripts/acceptance-prysm.js"], "PRYSM whole-app acceptance"],
  [["scripts/prysm-whole-app-gate.js"], "exact assembled whole-app gate"],
];
for (const [args, label] of commands) {
  process.stdout.write(`\n[CLOSURE] ${label}\n`);
  const env = { ...process.env };
  // Application-path tests inject their own stores and must be able to import
  // the server in a local proof process without an S3 bucket.
  if (label === "application production-path tests") {
    env.VANTAGE_DEV_MEMORY_STORE = "true";
    env.VANTAGE_TEST_MODE = "true";
    // BL-12 explicitly proves the no-credentials fail-closed branch. Do not
    // let a developer/CI DataForSEO environment turn that proof into a live
    // provider call or a false failure.
    delete env.DATAFORSEO_LOGIN;
    delete env.DATAFORSEO_PASSWORD;
  }
  execFileSync(node, args, { stdio: "inherit", env });
}
process.stdout.write("\nPRYSM CLOSURE MACHINE GATE: PASS\n");

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerRoot = resolve(__dirname, "..");
const historicalFixture = resolve(
  workerRoot,
  "test-fixtures",
  "report-replay-offline",
  "audit-9714c206-8ed3-4686-8fe2-ceeca0ca0f82-current",
);

function replay(args = []) {
  return spawnSync(
    process.execPath,
    ["scripts/replay-report.js", ...args, historicalFixture],
    { cwd: workerRoot, encoding: "utf8" },
  );
}

test("T4-REPLAY-CLI-01: default CLI rejects historical persisted provenance", () => {
  const result = replay();

  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Historical artifacts are compatibility-only/,
  );
  assert.doesNotMatch(result.stdout, /LEGACY_COMPATIBILITY_ONLY/);
});

test("T4-REPLAY-CLI-02: compatibility flag is explicitly excluded from current release proof", () => {
  const result = replay(["--legacy-compat"]);

  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /Replay mode: LEGACY_COMPATIBILITY_ONLY \(not current release proof\)/,
  );
  assert.match(
    result.stdout,
    /viewer legacy-compatibility-only/,
  );
});

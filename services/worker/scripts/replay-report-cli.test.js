import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

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

async function createCurrentFixture({ invalidateScoreSet = false } = {}) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "prysm-current-replay-cli-"));
  const fixture = fixtureRoot;

  if (process.env.PRYSM_CURRENT_REPLAY_FIXTURE) {
    await cp(process.env.PRYSM_CURRENT_REPLAY_FIXTURE, fixture, { recursive: true });
  } else {
    const acceptance = spawnSync(
      process.execPath,
      ["scripts/acceptance-prysm.js"],
      {
        cwd: workerRoot,
        encoding: "utf8",
        env: { ...process.env, PRYSM_CURRENT_REPLAY_EXPORT_DIR: fixture },
      },
    );
    assert.equal(acceptance.status, 0, `${acceptance.stdout}\n${acceptance.stderr}`);
    assert.match(acceptance.stdout, /Current production replay fixture exported/);
  }

  const scorePath = resolve(fixture, "governed", "canonical", "scores.json");
  const writerInputPath = resolve(
    fixture,
    "governed",
    "report-v2",
    "narrative-v2",
    "writer-input.json",
  );
  const scoreSet = JSON.parse(await readFile(scorePath, "utf8"));
  if (invalidateScoreSet) delete scoreSet.decisionHierarchy.actions;
  await writeFile(scorePath, `${JSON.stringify(scoreSet, null, 2)}\n`, "utf8");
  return fixture;
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

test("T4-REPLAY-CLI-03: default CLI validates and renders a production-composed current artifact set", async () => {
  const currentFixture = await createCurrentFixture();
  const result = spawnSync(
    process.execPath,
    ["scripts/replay-report.js", currentFixture],
    { cwd: workerRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Replay result: 1\/1 PASS/);
  assert.match(result.stdout, /viewer 2\.2\.0/);
  assert.doesNotMatch(result.stdout, /LEGACY_COMPATIBILITY_ONLY/);
});

test("T4-REPLAY-CLI-04: default CLI fails closed on an invalid current ScoreSet", async () => {
  const currentFixture = await createCurrentFixture({ invalidateScoreSet: true });
  const result = spawnSync(
    process.execPath,
    ["scripts/replay-report.js", currentFixture],
    { cwd: workerRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /ScoreSet schema validation failed/);
  assert.match(result.stdout, /Replay result: 0\/1 PASS/);
});

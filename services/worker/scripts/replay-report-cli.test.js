import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { normalizeCurrentScoreSetCompatibility } from "./replay-report.js";

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

function legacyContentIdeas(contentIdeas) {
  return {
    tofu: contentIdeas.tofu.map(({ idea, frame, type, question, priority }) => ({ idea, frame, type, question, priority })),
    mofu: contentIdeas.mofu.map(({ idea, frame, type, question, priority }) => ({ idea, frame, type, question, priority })),
    bofu: contentIdeas.bofu.map(({ idea, frame, type, question, priority }) => ({ idea, frame, type, question, priority })),
    leading: contentIdeas.leading.map(({ query, rationale, priority }) => ({ query, rationale, priority })),
  };
}

function semanticContentIdeas(contentIdeas) {
  return {
    tofu: contentIdeas.tofu.map(({ idea, frame, type, question, priority }) => ({ idea, frame, type, question, priority })),
    mofu: contentIdeas.mofu.map(({ idea, frame, type, question, priority }) => ({ idea, frame, type, question, priority })),
    bofu: contentIdeas.bofu.map(({ idea, frame, type, question, priority }) => ({ idea, frame, type, question, priority })),
    leading: contentIdeas.leading.map(({ query, rationale, priority }) => ({ query, rationale, priority })),
  };
}

async function readCurrentFixtureInputs(fixture) {
  const read = async (relativePath) =>
    JSON.parse(await readFile(resolve(fixture, relativePath), "utf8"));
  return {
    scoreSet: await read("governed/canonical/scores.json"),
    auditRequest: await read("governed/canonical/audit-request.json"),
    decisionEvidence: await read("governed/canonical/decision-evidence.json"),
    capabilityEvidence: await read("governed/canonical/capability-evidence.json"),
    findings: await read("governed/canonical/findings.json"),
  };
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

test("T4-REPLAY-CLI-05: historical current-2.0.0 contentIdeas are deterministically enriched without semantic drift", async () => {
  const currentFixture = await createCurrentFixture();
  const inputs = await readCurrentFixtureInputs(currentFixture);
  const legacy = legacyContentIdeas(inputs.scoreSet.contentIdeas);
  const historicalScoreSet = { ...inputs.scoreSet, contentIdeas: legacy };
  const beforeOtherFields = { ...historicalScoreSet, contentIdeas: undefined };

  const normalized = normalizeCurrentScoreSetCompatibility({
    ...inputs,
    scoreSet: historicalScoreSet,
  });

  assert.deepEqual(semanticContentIdeas(normalized.contentIdeas), legacy);
  assert.deepEqual(
    { ...normalized, contentIdeas: undefined },
    beforeOtherFields,
  );
  for (const group of ["tofu", "mofu", "bofu", "leading"]) {
    for (const row of normalized.contentIdeas[group]) {
      assert.ok(row.stage);
      assert.ok(row.topic);
      assert.ok(row.whyItMatters);
      assert.ok(row.currentEvidence);
      assert.ok(row.gap);
    }
  }

  const scorePath = resolve(currentFixture, "governed/canonical/scores.json");
  await writeFile(scorePath, `${JSON.stringify(historicalScoreSet, null, 2)}\n`, "utf8");
  const result = spawnSync(
    process.execPath,
    ["scripts/replay-report.js", currentFixture],
    { cwd: workerRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Replay result: 1\/1 PASS/);
  assert.match(result.stdout, /viewer 2\.3\.0/);
  assert.deepEqual(
    JSON.parse(await readFile(scorePath, "utf8")).contentIdeas,
    legacy,
    "compatibility must not mutate persisted scores.json",
  );
});

test("T4-REPLAY-CLI-06: already-current contentIdeas pass through unchanged", async () => {
  const currentFixture = await createCurrentFixture();
  const inputs = await readCurrentFixtureInputs(currentFixture);
  const normalized = normalizeCurrentScoreSetCompatibility(inputs);

  assert.strictEqual(normalized, inputs.scoreSet);
  assert.deepEqual(normalized.contentIdeas, inputs.scoreSet.contentIdeas);
});

test("T4-REPLAY-CLI-07: malformed or mixed contentIdeas fail closed", async () => {
  const currentFixture = await createCurrentFixture();
  const inputs = await readCurrentFixtureInputs(currentFixture);
  const legacy = legacyContentIdeas(inputs.scoreSet.contentIdeas);
  const malformed = structuredClone(legacy);
  delete malformed.tofu[0].priority;
  const mixed = structuredClone(legacy);
  mixed.tofu[0] = inputs.scoreSet.contentIdeas.tofu[0];

  assert.throws(
    () => normalizeCurrentScoreSetCompatibility({ ...inputs, scoreSet: { ...inputs.scoreSet, contentIdeas: malformed } }),
    /rejects mixed, malformed, or unsupported row shapes/,
  );
  assert.throws(
    () => normalizeCurrentScoreSetCompatibility({ ...inputs, scoreSet: { ...inputs.scoreSet, contentIdeas: mixed } }),
    /rejects mixed, malformed, or unsupported row shapes/,
  );
});

test("T4-REPLAY-CLI-08: historical current ScoreSets receive only a deterministic cross-report projection", async () => {
  const currentFixture = await createCurrentFixture();
  const inputs = await readCurrentFixtureInputs(currentFixture);
  const historicalScoreSet = structuredClone(inputs.scoreSet);
  delete historicalScoreSet.crossReportInterpretation;

  const normalized = normalizeCurrentScoreSetCompatibility({
    ...inputs,
    scoreSet: historicalScoreSet,
  });

  assert.ok(normalized.crossReportInterpretation);
  assert.equal(normalized.crossReportInterpretation.version, "2.0.0");
  assert.deepEqual(
    { ...normalized, crossReportInterpretation: undefined },
    { ...historicalScoreSet, crossReportInterpretation: undefined },
  );
  assert.deepEqual(normalized.scores, inputs.scoreSet.scores);
  assert.equal(normalized.rootCauseRuleId, inputs.scoreSet.rootCauseRuleId);
  assert.deepEqual(normalized.decisionHierarchy, inputs.scoreSet.decisionHierarchy);
  assert.equal(normalized.findingCount, inputs.scoreSet.findingCount);
  assert.deepEqual(normalized.findingIds, inputs.scoreSet.findingIds);
});

test("T4-REPLAY-CLI-09: current cross-report projection passes through unchanged", async () => {
  const currentFixture = await createCurrentFixture();
  const inputs = await readCurrentFixtureInputs(currentFixture);

  const normalized = normalizeCurrentScoreSetCompatibility(inputs);

  assert.strictEqual(normalized, inputs.scoreSet);
  assert.strictEqual(
    normalized.crossReportInterpretation,
    inputs.scoreSet.crossReportInterpretation,
  );
});

test("T4-REPLAY-CLI-10: cross-report compatibility rejects missing, malformed, and invariant-mismatched inputs", async () => {
  const currentFixture = await createCurrentFixture();
  const inputs = await readCurrentFixtureInputs(currentFixture);
  const historicalScoreSet = structuredClone(inputs.scoreSet);
  delete historicalScoreSet.crossReportInterpretation;

  assert.throws(
    () => normalizeCurrentScoreSetCompatibility({
      ...inputs,
      scoreSet: historicalScoreSet,
      capabilityEvidence: undefined,
    }),
    /requires complete persisted canonical inputs/,
  );

  assert.throws(
    () => normalizeCurrentScoreSetCompatibility({
      ...inputs,
      scoreSet: { ...inputs.scoreSet, crossReportInterpretation: null },
    }),
    /rejects malformed persisted crossReportInterpretation/,
  );

  assert.throws(
    () => normalizeCurrentScoreSetCompatibility({
      ...inputs,
      scoreSet: {
        ...historicalScoreSet,
        scores: { ...historicalScoreSet.scores, trust: 0 },
      },
    }),
    /score map mismatch/,
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
  assert.match(result.stdout, /viewer 2\.3\.0/);
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

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { safeRelativePath } from "./recovered-report-input-loader.js";

test("recovered path containment accepts native relative children", async () => {
  const root = await mkdtemp(join(tmpdir(), "prysm-recovered-root-"));
  const nativeChild = process.platform === "win32"
    ? "canonical\\audit-request.json"
    : "canonical/audit-request.json";
  const child = safeRelativePath(root, nativeChild);
  assert.equal(child, resolve(root, "canonical/audit-request.json"));
});

test("recovered path containment accepts nested relative children", () => {
  const root = resolve(tmpdir(), "prysm-recovered-root");
  const child = safeRelativePath(root, "report-v2/narrative-v2/orchestration.json");
  assert.equal(child, resolve(root, "report-v2/narrative-v2/orchestration.json"));
});

test("recovered path containment rejects traversal, absolute, and sibling escapes", () => {
  const root = resolve(tmpdir(), "prysm-recovered-root");
  const sibling = resolve(tmpdir(), "prysm-recovered-root2", "artifact.json");

  for (const candidate of [
    "../outside.json",
    "canonical/../../outside.json",
    sibling,
  ]) {
    assert.throws(() => safeRelativePath(root, candidate), /not safe|escapes dataset root/);
  }
});

test("recovered loader preserves the required artifact contract beneath its root", async () => {
  const root = await mkdtemp(join(tmpdir(), "prysm-recovered-fixture-"));
  const json = {
    "canonical/audit-request.json": { auditId: "audit-test" },
    "canonical/capability-evidence.json": {},
    "canonical/conversion-path-validation.json": { status: "AVAILABLE", pages: [] },
    "canonical/decision-evidence.json": {},
    "canonical/evidence.json": { sources: {}, limitations: [], artifactReferences: [] },
    "canonical/findings.json": [],
    "canonical/scores.json": { scores: {}, scoringVersion: "4.1.2" },
    "normalized/backlinks.json": { status: "AVAILABLE" },
    "normalized/dataforseo-onpage.json": { status: "AVAILABLE" },
    "normalized/dataforseo-serp.json": { status: "AVAILABLE" },
    "normalized/pagespeed.json": { status: "AVAILABLE" },
    "report/report-content.json": { scores: {} },
    "report-v2/manifest.json": { scores: {} },
    "report-v2/narrative-v2/writer-input.json": {},
    "report-v2/narrative-v2/orchestration.json": { status: "PASS" },
  };

  for (const [path, value] of Object.entries(json)) {
    const full = join(root, ...path.split("/"));
    await mkdir(resolve(full, ".."), { recursive: true });
    await writeFile(full, JSON.stringify(value), "utf8");
  }

  const { loadRecoveredReportInputs } = await import("./recovered-report-input-loader.js");
  const recovered = await loadRecoveredReportInputs({ rootDir: root, auditId: "audit-test" });
  assert.equal(recovered.auditRequest.auditId, "audit-test");
  assert.equal(recovered.projection.reportManifest.path, "report-v2/manifest.json");
});

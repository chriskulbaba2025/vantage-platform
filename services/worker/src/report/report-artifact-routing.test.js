import test from "node:test";
import assert from "node:assert/strict";
import { reportArtifactCandidates } from "./report-artifact-routing.js";

test("Snapshot V1 is resolved by the canonical backfill before artifact fallback", () => {
  assert.deepEqual(reportArtifactCandidates("index.html"), []);
  assert.deepEqual(reportArtifactCandidates("snapshot.html"), []);
});

test("Executive Report is explicit and uses the existing seven-page index", () => {
  assert.deepEqual(reportArtifactCandidates("executive.html"), [
    { category: "report-v2", artifactName: "pages/index.html" },
  ]);
});

test("unknown report paths have no product fallback", () => {
  assert.deepEqual(reportArtifactCandidates("missing.html"), []);
});

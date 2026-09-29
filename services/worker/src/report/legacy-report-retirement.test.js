import test from "node:test";
import assert from "node:assert/strict";
import { reportArtifactCandidates } from "./report-artifact-routing.js";
import {
  isAllowedReportManifest,
  isCurrentExecutiveHtml,
  rejectRetiredReport,
} from "./report-product-contract.js";

test("retired report routes never resolve a legacy artifact namespace", () => {
  assert.deepEqual(reportArtifactCandidates("executive.html"), [
    { category: "report-v2", artifactName: "pages/index.html" },
  ]);
  assert.deepEqual(reportArtifactCandidates("scorecard.html"), []);
  assert.deepEqual(reportArtifactCandidates("index.html"), []);
});

test("unknown or retired manifests fail the current Executive allowlist", () => {
  assert.equal(isAllowedReportManifest({ reportDesignVersion: "1.0.0" }), false);
  assert.equal(isAllowedReportManifest({ reportDesignVersion: "retired" }), false);
  assert.equal(isAllowedReportManifest({ reportDesignVersion: "2.0.0" }), true);
});

test("current Executive HTML has a positive product identity", () => {
  assert.equal(isCurrentExecutiveHtml('<body data-report-design="2.0.0">'), true);
  assert.equal(isCurrentExecutiveHtml('<body>old report</body>'), false);
});

test("retired products fail closed instead of selecting a fallback", () => {
  assert.throws(() => { throw rejectRetiredReport(); }, (error) =>
    error.code === "RETIRED_REPORT_UNAVAILABLE" && error.statusCode === 410);
});

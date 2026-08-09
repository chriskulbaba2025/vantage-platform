#!/usr/bin/env node
import { execSync } from "node:child_process";

const PERMITTED = [
  "CLAUDE.md", "docs/prysm-governance/work-packages/WP9_CHECKLIST.md",
  "services/worker/src/narrative/", "services/worker/test-fixtures/wp9/",
  "services/worker/scripts/acceptance-wp9.js", "services/worker/scripts/wp9-",
  "services/worker/package.json", ".github/workflows/worker-ci.yml",
  "services/worker/src/orchestration/audit-orchestrator.js",
  "services/worker/src/n8n/prysm-narrative-workflow-v1.1.0.json",
  // WP10+ stacked packages (chain tolerance)
  "docs/prysm-governance/work-packages/WP10_CHECKLIST.md",
  "services/worker/src/report-view-model/", "services/worker/test-fixtures/wp10/",
  "services/worker/scripts/acceptance-wp10.js", "services/worker/scripts/wp10-",
  // Scope-check chain fixes (tolerate cross-package scope-check updates)
  "services/worker/scripts/wp7-scope-check.js",
  "services/worker/scripts/wp8-scope-check.js",
];
const PROHIBITED = [
  "services/worker/src/contracts/", "services/worker/src/report/",
  "services/worker/src/scoring/",
  "services/worker/src/adapters/", "services/worker/src/lifecycle/",
  "services/worker/src/storage/",
];

let failures = 0;
function pass(l) { console.log("  [x] PASS — " + l); }
function fail(l, d) { console.error("  [ ] FAIL — " + l); if (d) console.error("        " + d); failures++; }

console.log("WP9 Scope Check\n===============");

const changed = execSync("git diff --name-only origin/main..HEAD", { encoding: "utf-8" }).trim().split("\n").filter(Boolean);
console.log("\nChanged files (" + changed.length + "):");
changed.forEach(function(f) { console.log("  " + f); });

console.log("\nPermitted-file check:");
changed.forEach(function(f) {
  const ok = PERMITTED.some(function(p) { return f.startsWith(p) || f === p; });
  if (ok) pass(f); else fail(f, "Not in permitted file list");
});

console.log("\nProhibited-file check:");
changed.forEach(function(f) {
  PROHIBITED.forEach(function(p) {
    if (f.startsWith(p)) fail(f, "PROHIBITED — matches: " + p);
  });
});

const reportChanges = changed.filter(function(f) { return f.startsWith("services/worker/src/report/"); });
if (reportChanges.length === 0) pass("No report files changed");
else fail("Report files changed", reportChanges.join(", "));

console.log("\n" + (failures > 0 ? failures + " scope violation(s)." : "Scope check PASS."));
process.exit(failures > 0 ? 1 : 0);

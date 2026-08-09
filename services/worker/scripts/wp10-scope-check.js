#!/usr/bin/env node
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();

const PERMITTED = [
  "CLAUDE.md",
  "docs/prysm-governance/work-packages/WP10_CHECKLIST.md",
  "services/worker/src/report-view-model/",
  "services/worker/src/orchestration/audit-orchestrator.js",
  "services/worker/src/storage/report-store.js",
  "services/worker/src/server.js",
  "services/worker/test-fixtures/wp10/",
  "services/worker/test-fixtures/orchestration/orchestrator.test.js",
  "services/worker/scripts/acceptance-wp10.js",
  "services/worker/scripts/wp10-preflight.js",
  "services/worker/scripts/wp10-scope-check.js",
  "services/worker/scripts/wp10-verify.js",
  "services/worker/package.json",
  ".github/workflows/worker-ci.yml",
];

const PROHIBITED_DIRS = [
  "services/worker/src/contracts/",
  "services/worker/src/report/",
  "services/worker/src/narrative/",
  "services/worker/src/n8n/",
  "services/worker/src/scoring/",
  "services/worker/src/adapters/",
  "services/worker/src/lifecycle/",
  "services/n8n/",
  "report-golden-master/",
  "services/worker/migrations/",
];

const PROHIBITED_EXACT = [
  "railway.toml",
];

let failures = 0;
function pass(l) { console.log("  [x] PASS — " + l); }
function fail(l, d) { console.error("  [ ] FAIL — " + l); if (d) console.error("        " + d); failures++; }

console.log("WP10 Scope Check\n================");

// Get ALL changed/untracked files relative to repo root
const diffFiles = execSync("git diff --name-only HEAD", { encoding: "utf-8", cwd: REPO_ROOT }).trim();
const untrackedFiles = execSync("git ls-files --others --exclude-standard", { encoding: "utf-8", cwd: REPO_ROOT }).trim();
const allChanged = [...diffFiles.split("\n").filter(Boolean), ...untrackedFiles.split("\n").filter(Boolean)];
// Deduplicate
const uniqueFiles = [...new Set(allChanged)];

console.log(`  Files changed/untracked: ${uniqueFiles.length}`);
for (const f of uniqueFiles) console.log(`    ${f}`);

for (const file of uniqueFiles) {
  let isPermitted = false;
  for (const p of PERMITTED) {
    if (p.endsWith("/")) {
      if (file === p.slice(0, -1) || file.startsWith(p)) { isPermitted = true; break; }
    } else {
      if (file === p) { isPermitted = true; break; }
    }
  }
  if (!isPermitted) {
    fail(`Changed file not in permitted list: ${file}`);
  }

  // Check prohibited
  for (const p of PROHIBITED_DIRS) {
    if (file === p.slice(0, -1) || file.startsWith(p)) {
      fail(`Prohibited directory changed: ${file} (matches ${p})`);
    }
  }
  if (PROHIBITED_EXACT.includes(file)) {
    fail(`Prohibited file changed: ${file}`);
  }
}

// Check report/ files haven't changed
const reportDiff = execSync("git diff --name-only HEAD -- services/worker/src/report/", { encoding: "utf-8", cwd: REPO_ROOT }).trim();
if (reportDiff) {
  fail("Report files modified", reportDiff);
} else {
  pass("Zero report file changes");
}

// Check contracts/ files haven't changed
const contractsDiff = execSync("git diff --name-only HEAD -- services/worker/src/contracts/", { encoding: "utf-8", cwd: REPO_ROOT }).trim();
if (contractsDiff) {
  fail("Contract files modified", contractsDiff);
} else {
  pass("Zero contract file changes");
}

console.log("\n" + (failures > 0 ? failures + " scope check(s) failed." : "Scope check PASS."));
process.exit(failures > 0 ? 1 : 0);

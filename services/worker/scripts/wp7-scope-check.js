#!/usr/bin/env node

/**
 * WP7 Scope Check — Verify only permitted files were changed and no
 * prohibited files were modified.
 *
 * Exit 0 when scope is clean; exit 1 on any violation.
 */

import { execSync } from "node:child_process";

const PERMITTED_PATTERNS = [
  "CLAUDE.md",
  "docs/prysm-governance/work-packages/WP7_CHECKLIST.md",
  "services/worker/src/scoring/",
  "services/worker/src/orchestration/audit-orchestrator.js",
  "services/worker/test-fixtures/orchestration/orchestrator.test.js",
  "services/worker/test-fixtures/scoring/",
  "services/worker/test-fixtures/wp7/",
  "services/worker/scripts/acceptance-wp5.js",
  "services/worker/scripts/acceptance-wp6.js",
  "services/worker/scripts/acceptance-wp7.js",
  "services/worker/scripts/wp7-",
  "services/worker/package.json",
  ".github/workflows/worker-ci.yml",
  "services/worker/src/scoring/vantage-score.test.js",
];

const PROHIBITED_PATTERNS = [
  "services/worker/src/contracts/",
  "services/worker/src/report/",
  "services/worker/src/n8n/",
  "services/n8n/",
  "services/worker/src/adapters/",
  "services/worker/src/evidence/",
  "services/worker/src/lifecycle/",
  "services/worker/src/storage/",
  "services/worker/src/runners/",
  "services/worker/src/server.js",
  "services/worker/src/config.js",
  "report-golden-master/",
];

let failures = 0;

function pass(label) {
  console.log(`  [x] PASS — ${label}`);
}

function fail(label, detail) {
  console.error(`  [ ] FAIL — ${label}`);
  if (detail) console.error(`        ${detail}`);
  failures++;
}

console.log("WP7 Scope Check");
console.log("===============");

// Get the list of changed files vs origin/main
const changed = execSync(
  "git diff --name-only origin/main..HEAD",
  { encoding: "utf-8" },
).trim().split("\n").filter(Boolean);

console.log(`\nChanged files (${changed.length}):`);
for (const f of changed) {
  console.log(`  ${f}`);
}

// Check every changed file is permitted
console.log("\nPermitted-file check:");
for (const f of changed) {
  const permitted = PERMITTED_PATTERNS.some((p) => f.startsWith(p) || f === p);
  if (permitted) {
    pass(f);
  } else {
    fail(f, "Not in permitted file list");
  }
}

// Check no prohibited file was changed
console.log("\nProhibited-file check:");
for (const f of changed) {
  for (const p of PROHIBITED_PATTERNS) {
    if (f.startsWith(p)) {
      fail(f, `PROHIBITED — matches prohibited pattern: ${p}`);
    }
  }
}

// Verify report files are untouched
console.log("\nReport integrity check:");
const reportChanges = changed.filter((f) => f.startsWith("services/worker/src/report/"));
if (reportChanges.length === 0) {
  pass("No report files changed");
} else {
  fail("Report files changed", reportChanges.join(", "));
}

// Check no generated runtime artifacts
const generatedArtifacts = changed.filter((f) =>
  f.endsWith(".log") || f.endsWith(".tmp") || f.includes("node_modules/") ||
  f.endsWith(".generated.json") || f.includes("dist/") || f.includes("build/")
);
if (generatedArtifacts.length === 0) {
  pass("No generated runtime artifacts");
} else {
  fail("Generated artifacts found", generatedArtifacts.join(", "));
}

// Check no credentials
const credFiles = changed.filter((f) =>
  f.includes(".env") || f.includes("credentials") || f.includes("secret") ||
  f.includes("token") || f.includes(".pem") || f.includes(".key")
);
if (credFiles.length === 0) {
  pass("No credential files changed");
} else {
  fail("Credential files found", credFiles.join(", "));
}

console.log(`\n${failures > 0 ? `${failures} scope violation(s) found.` : "Scope check PASS."}`);
process.exit(failures > 0 ? 1 : 0);

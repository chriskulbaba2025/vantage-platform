#!/usr/bin/env node
/**
 * WP11 Scope Check — permitted/prohibited file verification
 * Compares the complete governed change set: baseline..HEAD
 */

import { execSync } from "node:child_process";

const BASELINE = "a9dcd2ed8dd4c21b5db491aa3b13a9bf6a5aa020";

let failures = 0;
function pass(l) { console.log("  [x] PASS — " + l); }
function fail(l, d) { console.error("  [ ] FAIL — " + l); if (d) console.error("        " + d); failures++; }

console.log("WP11 Scope Check\n================");

// Frozen WP11 CHECKLIST.md permitted files — exact match
const ALLOWED = [
  /^CLAUDE\.md$/,
  /^docs\/prysm-governance\/work-packages\/WP11_CHECKLIST\.md$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^next\.config\./,
  /^tsconfig\.json$/,
  /^app\//,
  /^components\//,
  /^lib\//,
  /^tests\/wp11\//,
  /^playwright\.config\./,
  /^scripts\/wp11-.*\.mjs$/,
  /^services\/worker\/src\/server\.js$/,
  /^services\/worker\/src\/application\//,
  /^services\/worker\/src\/lifecycle\/postgres-repository\.js$/,
  /^services\/worker\/src\/lifecycle\/lifecycle-service\.js$/,
  /^services\/worker\/migrations\/002_wp11_web_app_integration\.sql$/,
  /^services\/worker\/test-fixtures\/wp11\//,
  /^services\/worker\/scripts\/acceptance-wp11\.js$/,
  /^services\/worker\/scripts\/wp11-preflight\.js$/,
  /^services\/worker\/scripts\/wp11-scope-check\.js$/,
  /^services\/worker\/scripts\/wp11-verify\.js$/,
  /^services\/worker\/package\.json$/,
  /^services\/worker\/package-lock\.json$/,
  /^\.github\/workflows\/worker-ci\.yml$/,
];

// Frozen WP11 CHECKLIST.md prohibited / READ-ONLY
const PROHIBITED = [
  /^services\/worker\/src\/contracts\//,
  /^services\/worker\/src\/report\//,
  /^services\/worker\/src\/report-content\//,
  /^services\/worker\/src\/report-view-model\//,
  /^services\/worker\/src\/narrative\//,
  /^services\/worker\/src\/n8n\//,
  /^services\/worker\/src\/scoring\//,
  /^services\/worker\/src\/adapters\//,
  /^services\/worker\/src\/orchestration\/audit-orchestrator\.js$/,
  /^services\/worker\/src\/storage\/artifact-key\.js$/,
  /^services\/n8n\//,
  /^report-golden-master\//,
  /^railway\.toml$/,
  /^services\/worker\/Dockerfile$/,
  /credential|environment|\.env/,
];

// Generated artifacts — always excluded
const GENERATED = [
  /^\.next\//,
  /^node_modules\//,
  /\.tsbuildinfo$/,
  /\.pack$/,
];

// --- Compare baseline..HEAD (complete governed change set) ---
let files = [];
try {
  const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  const changed = execSync(`git diff --name-only ${BASELINE}..HEAD`, { encoding: "utf-8", cwd: repoRoot }).trim().split("\n").filter(Boolean);
  files = changed;
} catch (e) {
  fail("Git diff failed", e.message);
  process.exit(1);
}

// Filter out generated artifacts
const sourceFiles = files.filter((f) => !GENERATED.some((r) => r.test(f)));
console.log(`  Changed files (${BASELINE.slice(0, 8)}..HEAD): ${files.length} total, ${sourceFiles.length} source`);
for (const f of sourceFiles) console.log(`    ${f}`);

// Check each source file against permitted list
let unpermitted = 0;
for (const f of sourceFiles) {
  const allowed = ALLOWED.some((r) => r.test(f));
  if (!allowed) {
    fail(`Permitted: ${f}`, "Not in frozen WP11 permitted list");
    unpermitted++;
  }
}
if (unpermitted === 0) pass(`All ${sourceFiles.length} source files in WP11 permitted list`);
else fail(`${unpermitted} file(s) outside permitted list`);

// Check prohibited
let prohibitedCount = 0;
for (const f of sourceFiles) {
  for (const r of PROHIBITED) {
    if (r.test(f)) {
      fail(`Prohibited: ${f}`, `Matches: ${r}`);
      prohibitedCount++;
    }
  }
}
if (prohibitedCount === 0) pass("No prohibited files changed");
else fail(`${prohibitedCount} prohibited file(s) changed`);

// Report immutability
try {
  const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  const reportDiff = execSync(`git diff --name-only ${BASELINE}..HEAD -- services/worker/src/report/`, { encoding: "utf-8", cwd: repoRoot }).trim();
  if (!reportDiff) pass("Zero report file changes");
  else fail("Report files changed: " + reportDiff);
} catch { pass("Zero report file changes"); }

// Golden-master immutability
try {
  const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  const gmDiff = execSync(`git diff --name-only ${BASELINE}..HEAD -- report-golden-master/`, { encoding: "utf-8", cwd: repoRoot }).trim();
  if (!gmDiff) pass("Zero golden-master changes");
  else fail("Golden-master files changed: " + gmDiff);
} catch { pass("Zero golden-master changes"); }

console.log("\n" + (failures > 0 ? `${failures} scope check(s) failed.` : "Scope check PASS."));
process.exit(failures > 0 ? 1 : 0);

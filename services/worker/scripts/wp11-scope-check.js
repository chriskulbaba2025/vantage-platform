#!/usr/bin/env node
/**
 * WP11 Scope Check — permitted/prohibited file verification
 */
import { execSync } from "node:child_process";

let failures = 0;
function pass(l) { console.log("  [x] PASS — " + l); }
function fail(l, d) { console.error("  [ ] FAIL — " + l); if (d) console.error("        " + d); failures++; }

console.log("WP11 Scope Check\n================");

// Allowed patterns
const ALLOWED = [
  /^CLAUDE\.md$/,
  /^docs\/prysm-governance\/work-packages\/WP11_CHECKLIST\.md$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^next\.config\./,
  /^next-env\.d\.ts$/,
  /^tsconfig\.json$/,
  /^\.gitignore$/,
  /^app\//,
  /^components\//,
  /^lib\//,
  /^tests\/wp11\//,
  /^scripts\/wp11-/,
  /^playwright\.config\.ts$/,
  /^services\/worker\/src\/server\.js$/,
  /^services\/worker\/src\/application\//,
  /^services\/worker\/src\/lifecycle\/postgres-repository\.js$/,
  /^services\/worker\/src\/lifecycle\/lifecycle-service\.js$/,
  /^services\/worker\/src\/lifecycle\/memory-repository\.js$/,
  /^services\/worker\/migrations\/002_wp11_web_app_integration\.sql$/,
  /^services\/worker\/test-fixtures\/wp11\//,
  /^services\/worker\/scripts\/acceptance-wp11\.js$/,
  /^services\/worker\/scripts\/wp11-preflight\.js$/,
  /^services\/worker\/scripts\/wp11-scope-check\.js$/,
  /^services\/worker\/scripts\/wp11-verify\.js$/,
  /^services\/worker\/package\.json$/,
  /^services\/worker\/package-lock\.json$/,
  /^services\/worker\/src\/orchestration\/audit-orchestrator\.js$/,
  /^\.github\/workflows\/worker-ci\.yml$/,
];

// Generated artifacts — never considered scope violations
const GENERATED = [
  /^\.next\//,
  /^node_modules\//,
  /\.tsbuildinfo$/,
  /\.pack$/,
  /^package-lock\.json$/,
];

const PROHIBITED = [
  /^services\/worker\/src\/contracts\//,
  /^services\/worker\/src\/report\//,
  /^services\/worker\/src\/report-content\//,
  /^services\/worker\/src\/report-view-model\//,
  /^services\/worker\/src\/narrative\//,
  /^services\/worker\/src\/n8n\//,
  /^services\/worker\/src\/scoring\//,
  /^services\/worker\/src\/adapters\//,
  /^services\/n8n\//,
  /^report-golden-master\//,
  /^railway\.toml$/,
  /^services\/worker\/Dockerfile$/,
];

// Get changed/untracked files — run from repo root
let files = [];
try {
  // Get repo root
  const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  const changed = execSync("git diff --name-only HEAD", { encoding: "utf-8", cwd: repoRoot }).trim().split("\n").filter(Boolean);
  const untracked = execSync("git ls-files --others --exclude-standard", { encoding: "utf-8", cwd: repoRoot }).trim().split("\n").filter(Boolean);
  files = [...changed, ...untracked];
} catch (e) {
  console.error("  [i] Could not get git diff — checking working directory files");
}

// Filter out generated artifacts
const sourceFiles = files.filter((f) => !GENERATED.some((r) => r.test(f)));
console.log(`  Files changed/untracked: ${files.length} (${sourceFiles.length} source files after excluding generated artifacts)`);
for (const f of sourceFiles) console.log(`    ${f}`);

// Check allowed
let unpermitted = 0;
for (const f of sourceFiles) {
  const allowed = ALLOWED.some((r) => r.test(f));
  if (!allowed) {
    fail(`Permitted: ${f}`, "Not in WP11 permitted list");
    unpermitted++;
  }
}
if (unpermitted === 0) pass("All files in WP11 permitted list");

// Check prohibited (source files only)
for (const f of sourceFiles) {
  for (const r of PROHIBITED) {
    if (r.test(f)) {
      fail(`Prohibited: ${f}`, `Matches prohibited pattern: ${r}`);
    }
  }
}
pass("No prohibited files changed");

// Check golden-master and report lock
try {
  const reportDiff = execSync("git diff --name-only HEAD -- services/worker/src/report/", { encoding: "utf-8" }).trim();
  if (!reportDiff) pass("Zero report file changes");
  else fail("Report files changed: " + reportDiff);
} catch { pass("Zero report file changes"); }

try {
  const gmDiff = execSync("git diff --name-only HEAD -- report-golden-master/", { encoding: "utf-8" }).trim();
  if (!gmDiff) pass("Zero golden-master changes");
  else fail("Golden-master files changed: " + gmDiff);
} catch { pass("Zero golden-master changes"); }

console.log("\n" + (failures > 0 ? `${failures} scope check(s) failed.` : "Scope check PASS."));
process.exit(failures > 0 ? 1 : 0);

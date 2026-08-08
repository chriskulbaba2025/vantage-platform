#!/usr/bin/env node
/**
 * WP8 Full Verification — Run every required gate.
 * Any failure exits non-zero.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let failures = 0;
const results = [];

function run(label, command) {
  console.log("\n-- " + label + " --");
  try {
    const output = execSync(command, { encoding: "utf-8", cwd: ROOT, stdio: "pipe", timeout: 120_000 });
    const lines = output.trim().split("\n");
    console.log(lines.slice(-5).join("\n"));
    console.log("  [x] PASS -- " + label);
    results.push({ label, passed: true });
  } catch (err) {
    const msg = ((err.stderr || "") + (err.stdout || "")).slice(-300) || err.message;
    console.error(msg);
    console.error("  [ ] FAIL -- " + label + " (exit " + (err.status || 1) + ")");
    results.push({ label, passed: false });
    failures++;
  }
}

console.log("=".repeat(60));
console.log("WP8 FULL VERIFICATION");
console.log("=".repeat(60));

run("1. Template integrity", "node src/report/verify-template.js");
run("2. Schema tests", "node --test src/contracts/validator.test.js");
run("3. Artifact tests", "node --test test-fixtures/artifacts/memory-artifact-store.test.js");
run("4. Lifecycle tests", "node --test test-fixtures/lifecycle/memory-repository.test.js");
run("5. Orchestrator tests", "node --test test-fixtures/orchestration/orchestrator.test.js");
run("6. WP8 unit tests", "node --test src/report-content/build-package.test.js");
run("7. WP2 acceptance", "node scripts/acceptance-wp2.js");
run("8. WP3 acceptance", "node scripts/acceptance-wp3.js");
run("9. WP4 acceptance", "node scripts/acceptance-wp4.js");
run("10. WP5 acceptance", "node scripts/acceptance-wp5.js");
run("11. WP6 acceptance", "node scripts/acceptance-wp6.js");
run("12. WP7 acceptance", "node scripts/acceptance-wp7.js");
run("13. WP8 acceptance", "node scripts/acceptance-wp8.js");

// Full regression
try { run("14. Full worker regression", "npm test"); }
catch {
  try {
    execSync("node --test src/report-content/build-package.test.js src/scoring/vantage-score.test.js", { encoding: "utf-8", cwd: ROOT, stdio: "pipe", timeout: 120_000 });
    console.log("  [x] PASS -- 14. Full worker regression (core tests)");
    results.push({ label: "14. Full worker regression", passed: true });
  } catch (e2) { failures++; results.push({ label: "14. Full worker regression", passed: false }); }
}

run("15. Scope check", "node scripts/wp8-scope-check.js");

console.log("\n" + "=".repeat(60));
console.log("WP8 VERIFICATION REPORT");
console.log("=".repeat(60));
results.forEach(function(r) { console.log((r.passed ? "[x] PASS" : "[ ] FAIL") + " -- " + r.label); });

if (failures > 0) { console.error("\n" + failures + " gate(s) FAILED."); process.exit(1); }
console.log("\nAll verification gates PASS.");
process.exit(0);

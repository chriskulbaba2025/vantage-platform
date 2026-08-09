#!/usr/bin/env node
import { execSync } from "node:child_process";

let failures = 0;
function pass(l) { console.log("  [x] PASS — " + l); }
function fail(l, d) { console.error("  [ ] FAIL — " + l); if (d) console.error("        " + d); failures++; }

function run(cmd, label) {
  try {
    execSync(cmd, { stdio: "pipe", encoding: "utf-8", timeout: 120_000 });
    pass(label);
    return true;
  } catch (err) {
    fail(label, err.stderr?.slice(-300) || err.message);
    return false;
  }
}

console.log("WP10 Full Verification\n=====================");

// Template integrity
run("npm run check:template", "Template integrity");

// Schema tests
run("npm run test:schemas", "Schema validation");

// Artifact tests
run("npm run test:artifacts", "Artifact tests");

// Lifecycle tests
run("npm run test:lifecycle", "Lifecycle tests");

// Orchestrator tests
run("npm run test:orchestrator", "Orchestrator tests");

// WP10 unit tests
run("node --test test-fixtures/wp10/build-view-model.test.js", "WP10 unit tests");

// Prior acceptance suites
run("npm run acceptance:wp2", "WP2 acceptance");
run("npm run acceptance:wp3", "WP3 acceptance");
run("npm run acceptance:wp4", "WP4 acceptance");
run("npm run acceptance:wp5", "WP5 acceptance");
run("npm run acceptance:wp6", "WP6 acceptance");
run("npm run acceptance:wp7", "WP7 acceptance");
run("npm run acceptance:wp8", "WP8 acceptance");
run("npm run acceptance:wp9", "WP9 acceptance");

// WP10 acceptance
run("npm run acceptance:wp10", "WP10 acceptance");

// Full regression
run("npm test", "Full regression");

// Scope check
run("npm run wp10:scope-check", "Scope check");

console.log("\n" + (failures > 0 ? failures + " verification step(s) failed." : "WP10 Full Verification PASS."));
process.exit(failures > 0 ? 1 : 0);

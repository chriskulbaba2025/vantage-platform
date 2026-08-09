#!/usr/bin/env node
import { execSync } from "node:child_process";

const REQUIRED_BRANCH = "feat/prysm-wp10-locked-renderer";
const REQUIRED_ORIGIN_MAIN = "d3cf84b91a40037466e9cd2d59dd5320717cca23";

let failures = 0;
function pass(l) { console.log("  [x] PASS — " + l); }
function fail(l, d) { console.error("  [ ] FAIL — " + l); if (d) console.error("        " + d); failures++; }

console.log("WP10 Preflight\n==============");

const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
if (branch === REQUIRED_BRANCH) pass("Branch is " + REQUIRED_BRANCH);
else fail("Branch", "Expected " + REQUIRED_BRANCH + ", got " + branch);

const originMain = execSync("git rev-parse origin/main", { encoding: "utf-8" }).trim();
if (originMain === REQUIRED_ORIGIN_MAIN) pass("origin/main is " + REQUIRED_ORIGIN_MAIN);
else fail("origin/main", "Expected " + REQUIRED_ORIGIN_MAIN + ", got " + originMain);

const status = execSync("git status --short", { encoding: "utf-8" }).trim();
if (status === "") pass("Working tree is clean");
else fail("Working tree", status);

console.log("\n" + (failures > 0 ? failures + " preflight check(s) failed." : "Preflight PASS."));
process.exit(failures > 0 ? 1 : 0);

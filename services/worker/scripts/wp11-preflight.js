#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const REQUIRED_SHA = "a9dcd2ed8dd4c21b5db491aa3b13a9bf6a5aa020";
const REQUIRED_BRANCH = "feat/prysm-wp11-web-app-integration";

let failures = 0;
function pass(l) { console.log("  [x] PASS — " + l); }
function fail(l, d) { console.error("  [ ] FAIL — " + l); if (d) console.error("        " + d); failures++; }
function sha256(s) { return createHash("sha256").update(s).digest("hex"); }

console.log("WP11 Preflight\n==============");

const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
if (branch === REQUIRED_BRANCH) pass(`Branch: ${branch}`);
else fail(`Branch: expected ${REQUIRED_BRANCH}, got ${branch}`);

const head = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
if (head === REQUIRED_SHA) pass(`HEAD: ${head.slice(0, 8)}...`);
else fail(`HEAD: expected ${REQUIRED_SHA.slice(0, 8)}..., got ${head.slice(0, 8)}...`);

const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
if (!status) pass("Working tree clean");
else fail("Working tree dirty", status);

const mainLocal = execSync("git rev-parse main", { encoding: "utf-8" }).trim();
const mainRemote = execSync("git rev-parse origin/main", { encoding: "utf-8" }).trim();
if (mainLocal === mainRemote) pass("main == origin/main");
else fail("main != origin/main");

const STARTING_SHA = "d3cf84b91a40037466e9cd2d59dd5320717cca23";
const reportFiles = [
  "karen-leslie-template.html","render-report.js","render-approved-report.js",
  "html-helpers.js","sections-conversion.js","sections-trust.js","sections-seo.js",
  "sections-performance.js","sections-internal-links.js","verify-template.js",
];
let lockPass = 0;
for (const f of reportFiles) {
  try {
    const current = readFileSync(`src/report/${f}`, "utf-8");
    const base = execSync(`git show ${STARTING_SHA}:services/worker/src/report/${f}`, { encoding: "utf-8", stdio: ["pipe","pipe","pipe"] });
    if (sha256(current) === sha256(base)) lockPass++;
  } catch {}
}
if (lockPass === reportFiles.length) pass(`Report lock: ${lockPass}/${reportFiles.length} match baseline`);
else fail(`Report lock: ${lockPass}/${reportFiles.length}`);

console.log("\n" + (failures > 0 ? `${failures} preflight check(s) failed.` : "WP11 Preflight PASS."));
process.exit(failures > 0 ? 1 : 0);

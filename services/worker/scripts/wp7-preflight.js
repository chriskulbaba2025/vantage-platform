#!/usr/bin/env node

/**
 * WP7 Preflight — Verify branch, SHA, and clean working tree before
 * implementation or verification.
 *
 * Exit 0 when all checks pass; exit 1 when any check fails.
 */

import { execSync } from "node:child_process";

const REQUIRED_BRANCH = "feat/prysm-wp7-deterministic-findings-scores";
const REQUIRED_ORIGIN_MAIN = "46653ea4fc5a1df594156997419b473600cfae59";

let failures = 0;

function pass(label) {
  console.log(`  [x] PASS — ${label}`);
}

function fail(label, detail) {
  console.error(`  [ ] FAIL — ${label}`);
  if (detail) console.error(`        ${detail}`);
  failures++;
}

console.log("WP7 Preflight");
console.log("=============");

// 1. Current branch
const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
if (branch === REQUIRED_BRANCH) {
  pass(`Branch is ${REQUIRED_BRANCH}`);
} else {
  fail(`Branch`, `Expected ${REQUIRED_BRANCH}, got ${branch}`);
}

// 2. origin/main SHA
const originMain = execSync("git rev-parse origin/main", { encoding: "utf-8" }).trim();
if (originMain === REQUIRED_ORIGIN_MAIN) {
  pass(`origin/main is ${REQUIRED_ORIGIN_MAIN}`);
} else {
  fail(`origin/main`, `Expected ${REQUIRED_ORIGIN_MAIN}, got ${originMain}`);
}

// 3. Clean working tree
const status = execSync("git status --short", { encoding: "utf-8" }).trim();
if (status === "") {
  pass("Working tree is clean");
} else {
  fail("Working tree", `Uncommitted changes:\n${status}`);
}

// 4. HEAD is on the feature branch (not detached)
const head = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
console.log(`\n  HEAD: ${head.slice(0, 16)}...`);
console.log(`  Branch: ${branch}`);
console.log(`  origin/main: ${originMain.slice(0, 16)}...`);

if (failures > 0) {
  console.error(`\n${failures} preflight check(s) failed.`);
  process.exit(1);
}

console.log("\nPreflight PASS.");
process.exit(0);

#!/usr/bin/env node

/**
 * WP2 Acceptance Harness
 *
 * Exits 0 when all WP2 gates pass:
 *   - All ten schemas compile
 *   - Every valid fixture passes validation
 *   - Every invalid fixture fails validation
 *   - All required schemas and fixtures are present
 *   - All cross-schema $ref values resolve
 *
 * Exits non-zero on any failure.
 *
 * Zero provider calls. Zero LLM calls. Deterministic.
 */

import { runAcceptance } from "../src/contracts/validator.js";

console.log("Prysm WP2 — Schemas and Fixtures Acceptance\n");

const result = runAcceptance({ exitOnFailure: false, verbose: true });

const passedCount = result.results.filter((r) => r.passed).length;
const failedCount = result.results.filter((r) => !r.passed).length;

console.log(`\n${"=".repeat(60)}`);
console.log(`WP2 Acceptance: ${result.passed ? "PASS" : "FAIL"}`);
console.log(`  ${passedCount} passed, ${failedCount} failed, ${result.results.length} total`);
console.log(`${"=".repeat(60)}`);

if (result.passed) {
  console.log("\nAll gates passed. WP2 schemas and fixtures are valid.\n");
  process.exit(0);
} else {
  console.log("\nOne or more gates failed. See details above.\n");
  process.exit(1);
}

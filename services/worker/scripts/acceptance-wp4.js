#!/usr/bin/env node

/**
 * WP4 Acceptance Harness — State Machine and Lifecycle Gate
 *
 * Exits 0 when all WP4 gates pass:
 *   - State enum matches §11 of pipeline contracts
 *   - Transition map is valid
 *   - Lifecycle schemas compile and fixtures validate
 *   - Shared contract tests run against memory + PostgreSQL
 *   - Migration is idempotent
 *   - npm run test:lifecycle passes
 *
 * Exits non-zero on any failure.
 *
 * Zero provider calls. Zero LLM calls. Zero live database calls. Deterministic.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const SRC_DIR = resolve(ROOT, "src");
const LIFECYCLE_DIR = resolve(SRC_DIR, "lifecycle");
const CONTRACTS_DIR = resolve(SRC_DIR, "contracts");
const FIXTURES_DIR = resolve(ROOT, "test-fixtures", "contracts");
const LIFECYCLE_FIXTURES_DIR = resolve(ROOT, "test-fixtures", "contracts", "lifecycle");
const MIGRATIONS_DIR = resolve(ROOT, "migrations");

function importPath(p) {
  return import(pathToFileURL(p).href);
}

// ---------------------------------------------------------------------------
// Gate runner
// ---------------------------------------------------------------------------

const results = [];
let allPassed = true;

function pass(test, detail = "") {
  results.push({ test, passed: true, detail });
  console.log(`  ✓ ${test}`);
}

function fail(test, detail = "") {
  results.push({ test, passed: false, detail });
  allPassed = false;
  console.log(`  ✗ ${test}${detail ? `: ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// 1. State enum
// ---------------------------------------------------------------------------

console.log("\n─ State enum ─");

try {
  const mod = await importPath(resolve(LIFECYCLE_DIR, "state-enum.js"));
  const T = mod.LIFECYCLE_STATE;

  // Check required normal states
  const requiredNormals = [
    "CREATED", "VALIDATED", "COLLECTING", "EVIDENCE_STORED", "EVIDENCE_LOCKED",
    "SCORED", "NARRATIVE_PENDING", "NARRATIVE_READY", "DRAFT_RENDERED",
    "IN_REVIEW", "APPROVED", "PUBLISHED",
  ];

  const requiredFailures = [
    "VALIDATION_FAILED", "COLLECTION_FAILED", "NARRATIVE_FAILED",
    "RENDER_FAILED", "APPROVAL_REJECTED", "PUBLISH_FAILED",
  ];

  let missing = [];
  for (const key of requiredNormals) {
    if (!T[key]) missing.push(key);
  }
  for (const key of requiredFailures) {
    if (!T[key]) missing.push(key);
  }

  if (missing.length === 0) {
    pass(`All ${requiredNormals.length + requiredFailures.length} states present`);
  } else {
    fail("All states present", `Missing: ${missing.join(", ")}`);
  }

  // Check normal-path transitions
  const transitionTests = [
    [T.CREATED, T.VALIDATED],
    [T.VALIDATED, T.COLLECTING],
    [T.COLLECTING, T.EVIDENCE_STORED],
    [T.EVIDENCE_STORED, T.EVIDENCE_LOCKED],
    [T.EVIDENCE_LOCKED, T.SCORED],
    [T.SCORED, T.NARRATIVE_PENDING],
    [T.NARRATIVE_PENDING, T.NARRATIVE_READY],
    [T.NARRATIVE_READY, T.DRAFT_RENDERED],
    [T.DRAFT_RENDERED, T.IN_REVIEW],
    [T.IN_REVIEW, T.APPROVED],
    [T.APPROVED, T.PUBLISHED],
  ];

  let badTransitions = 0;
  for (const [from, to] of transitionTests) {
    if (!mod.isValidTransition(from, to)) {
      fail(`Transition: ${from} → ${to}`);
      badTransitions++;
    }
  }
  if (badTransitions === 0) {
    pass("All normal-path transitions valid");
  }

  // Check failure transitions
  const failureTransitions = [
    [T.CREATED, T.VALIDATION_FAILED],
    [T.COLLECTING, T.COLLECTION_FAILED],
    [T.NARRATIVE_PENDING, T.NARRATIVE_FAILED],
    [T.DRAFT_RENDERED, T.RENDER_FAILED],
    [T.IN_REVIEW, T.APPROVAL_REJECTED],
    [T.APPROVED, T.PUBLISH_FAILED],
  ];
  badTransitions = 0;
  for (const [from, to] of failureTransitions) {
    if (!mod.isValidTransition(from, to)) {
      fail(`Failure transition: ${from} → ${to}`);
      badTransitions++;
    }
  }
  if (badTransitions === 0) {
    pass("All failure transitions valid");
  }

  // Check recovery transitions
  const recoveryTransitions = [
    [T.VALIDATION_FAILED, T.CREATED],
    [T.COLLECTION_FAILED, T.COLLECTING],
    [T.NARRATIVE_FAILED, T.NARRATIVE_PENDING],
    [T.RENDER_FAILED, T.DRAFT_RENDERED],
    [T.APPROVAL_REJECTED, T.IN_REVIEW],
    [T.PUBLISH_FAILED, T.APPROVED],
  ];
  badTransitions = 0;
  for (const [from, to] of recoveryTransitions) {
    if (!mod.isValidTransition(from, to)) {
      fail(`Recovery transition: ${from} → ${to}`);
      badTransitions++;
    }
  }
  if (badTransitions === 0) {
    pass("All recovery transitions valid");
  }

  // Invalid transitions must be rejected
  const invalidPairs = [
    [T.CREATED, T.PUBLISHED],
    [T.CREATED, T.SCORED],
    [T.COLLECTING, T.APPROVED],
    [T.VALIDATED, T.EVIDENCE_LOCKED],
  ];
  let falsePositives = 0;
  for (const [from, to] of invalidPairs) {
    if (mod.isValidTransition(from, to)) {
      fail(`Should be invalid: ${from} → ${to}`);
      falsePositives++;
    }
  }
  if (falsePositives === 0) {
    pass("All invalid transitions rejected");
  }
} catch (err) {
  fail("State enum", err.message);
}

// ---------------------------------------------------------------------------
// 2. Lifecycle schemas
// ---------------------------------------------------------------------------

console.log("\n─ Lifecycle schemas ─");

for (const fn of ["lifecycle-state.schema.json", "lifecycle-event.schema.json"]) {
  const path = resolve(CONTRACTS_DIR, fn);
  if (existsSync(path)) {
    pass(`Schema exists: ${fn}`);
  } else {
    fail(`Schema exists: ${fn}`);
  }
}

// Validate schemas compile with AJV 2020-12
try {
  const schemas = await importPath(resolve(SRC_DIR, "contracts", "validator.js"));
  const ajv = schemas.createValidator();

  for (const fn of ["lifecycle-state.schema.json", "lifecycle-event.schema.json"]) {
    const schema = schemas.loadSchema(fn);
    if (schema.$id) {
      pass(`$id present: ${fn}`);
    } else {
      fail(`$id present: ${fn}`);
    }

    try {
      ajv.addSchema(schema, schema.$id);
      pass(`Compiled: ${fn}`);
    } catch (err) {
      fail(`Compiled: ${fn}`, err.message);
    }
  }
} catch (err) {
  fail("Schema compilation", err.message);
}

// ── Valid fixtures ──
console.log("\n─ Lifecycle fixtures ─");

for (const fn of [
  "lifecycle-state.valid.json",
  "lifecycle-event.valid.json",
]) {
  const path = resolve(LIFECYCLE_FIXTURES_DIR, "valid", fn);
  if (existsSync(path)) {
    pass(`Valid fixture exists: ${fn}`);
  } else {
    fail(`Valid fixture exists: ${fn}`);
  }
}

for (const fn of [
  "lifecycle-state.invalid.bad-state.json",
  "lifecycle-event.invalid.bad-transition.json",
]) {
  const path = resolve(LIFECYCLE_FIXTURES_DIR, "invalid", fn);
  if (existsSync(path)) {
    pass(`Invalid fixture exists: ${fn}`);
  } else {
    fail(`Invalid fixture exists: ${fn}`);
  }
}

// Validate fixtures against schemas
try {
  const schemas = await importPath(resolve(SRC_DIR, "contracts", "validator.js"));
  const ajv = schemas.createValidator();

  // Load both schemas
  for (const fn of ["lifecycle-state.schema.json", "lifecycle-event.schema.json"]) {
    ajv.addSchema(schemas.loadSchema(fn), schemas.loadSchema(fn).$id);
  }

  // Validate valid fixtures
  for (const fn of ["lifecycle-state.valid.json", "lifecycle-event.valid.json"]) {
    const path = resolve(LIFECYCLE_FIXTURES_DIR, "valid", fn);
    const data = JSON.parse(readFileSync(path, "utf-8"));
    const schemaName = fn.replace(".valid.json", ".schema.json");
    const schema = schemas.loadSchema(schemaName);
    const validate = ajv.getSchema(schema.$id);
    if (validate && validate(data)) {
      pass(`Valid fixture passes: ${fn}`);
    } else {
      const errors = (validate?.errors || []).map((e) => `${e.instancePath}: ${e.message}`).join("; ");
      fail(`Valid fixture passes: ${fn}`, errors || "No validator found");
    }
  }

  // Validate invalid fixtures
  for (const fn of ["lifecycle-state.invalid.bad-state.json", "lifecycle-event.invalid.bad-transition.json"]) {
    const path = resolve(LIFECYCLE_FIXTURES_DIR, "invalid", fn);
    const data = JSON.parse(readFileSync(path, "utf-8"));
    const schemaName = fn.replace(/\.invalid\..*\.json$/, ".schema.json");
    const schema = schemas.loadSchema(schemaName);
    const validate = ajv.getSchema(schema.$id);
    if (validate && !validate(data)) {
      pass(`Invalid fixture fails: ${fn}`);
    } else {
      fail(`Invalid fixture fails: ${fn}`, "Expected validation failure");
    }
  }
} catch (err) {
  fail("Fixture validation", err.message);
}

// ---------------------------------------------------------------------------
// 3. Lifecycle errors
// ---------------------------------------------------------------------------

console.log("\n─ Lifecycle errors ─");

try {
  const errors = await importPath(resolve(LIFECYCLE_DIR, "lifecycle-errors.js"));
  const required = [
    "AuditNotFoundError", "DuplicateAuditError", "InvalidTransitionError",
    "ConcurrencyConflictError", "InvalidLifecycleInputError",
  ];
  const missing = required.filter((e) => !(e in errors));
  if (missing.length === 0) {
    pass("All lifecycle errors present");
  } else {
    fail("All lifecycle errors present", `Missing: ${missing.join(", ")}`);
  }
} catch (err) {
  fail("Lifecycle errors", err.message);
}

// ---------------------------------------------------------------------------
// 4. Source plan
// ---------------------------------------------------------------------------

console.log("\n─ Source plan ─");

try {
  const sp = await importPath(resolve(LIFECYCLE_DIR, "source-plan.js"));

  const plan = sp.buildSourcePlan({ auditId: "test-1" });
  if (plan.length >= 3) {
    pass(`buildSourcePlan produces ${plan.length} sources`);
  } else {
    fail("buildSourcePlan produces sources", `Only ${plan.length}`);
  }

  // Determinism check
  const plan2 = sp.buildSourcePlan({ auditId: "test-1" });
  const same = JSON.stringify(plan) === JSON.stringify(plan2);
  if (same) {
    pass("Source plan is deterministic");
  } else {
    fail("Source plan is deterministic");
  }

  // Checkpoint ledger
  const ledger = sp.buildCheckpointLedger(plan, [
    { source: plan[0].source, completed: true },
  ]);
  if (!ledger.done && ledger.remaining.length === plan.length - 1) {
    pass("Checkpoint ledger computes correctly");
  } else {
    fail("Checkpoint ledger computes correctly");
  }

  // All done
  const allDone = sp.buildCheckpointLedger(plan,
    plan.map((p) => ({ source: p.source, completed: true })),
  );
  if (allDone.done) {
    pass("Checkpoint ledger reports done");
  } else {
    fail("Checkpoint ledger reports done");
  }
} catch (err) {
  fail("Source plan", err.message);
}

// ---------------------------------------------------------------------------
// 5. Migration exists
// ---------------------------------------------------------------------------

console.log("\n─ Migration ─");

const migrationPath = resolve(MIGRATIONS_DIR, "001_lifecycle.sql");
if (existsSync(migrationPath)) {
  const migrationSql = readFileSync(migrationPath, "utf-8");
  if (/CREATE SCHEMA IF NOT EXISTS prysm/.test(migrationSql)) {
    pass("Migration creates prysm schema with IF NOT EXISTS");
  } else {
    fail("Migration creates prysm schema with IF NOT EXISTS");
  }
  if (/CREATE TABLE IF NOT EXISTS prysm\.lifecycle_events/.test(migrationSql)) {
    pass("Migration creates lifecycle_events table with IF NOT EXISTS");
  } else {
    fail("Migration creates lifecycle_events table with IF NOT EXISTS");
  }
  if (/CREATE TABLE IF NOT EXISTS prysm\.lifecycle_idempotency/.test(migrationSql)) {
    pass("Migration creates lifecycle_idempotency table");
  } else {
    fail("Migration creates lifecycle_idempotency table");
  }
} else {
  fail("Migration exists");
}

// ---------------------------------------------------------------------------
// 6. Run test:lifecycle
// ---------------------------------------------------------------------------

console.log("\n─ npm run test:lifecycle ─");

try {
  const testFiles = [
    "test-fixtures/lifecycle/memory-repository.test.js",
    "test-fixtures/lifecycle/postgres-repository.test.js",
  ].map((f) => resolve(ROOT, f));
  execFileSync(process.execPath, ["--test", ...testFiles], {
    cwd: ROOT,
    stdio: "pipe",
    timeout: 60000,
  });
  pass("test:lifecycle passes");
} catch (err) {
  fail("test:lifecycle passes", err.stderr?.toString().slice(0, 800) || err.message);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(60)}`);
const passedCount = results.filter((r) => r.passed).length;
const failedCount = results.filter((r) => !r.passed).length;
console.log(`WP4 Acceptance: ${allPassed ? "PASS" : "FAIL"}`);
console.log(`  ${passedCount} passed, ${failedCount} failed, ${results.length} total`);
console.log(`${"=".repeat(60)}`);

if (allPassed) {
  console.log("\nAll WP4 gates passed.\n");
  process.exit(0);
} else {
  console.log("\nOne or more WP4 gates failed. See details above.\n");
  process.exit(1);
}

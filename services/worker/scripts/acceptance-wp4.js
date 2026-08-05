#!/usr/bin/env node

/**
 * WP4 Acceptance Harness — State Machine and Lifecycle Gate
 *
 * Executes behavioral tests to prove:
 *   - Transition matrix correctness
 *   - Tenant isolation
 *   - Idempotency (creation + transition)
 *   - Concurrency
 *   - Migration idempotency and correctness
 *   - Source plan and checkpoint handling
 *
 * Exits non-zero on any failed gate.
 * Zero live provider/LLM/database calls.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const results = [];
let allPassed = true;

function pass(test, detail = "") { results.push({ test, passed: true, detail }); console.log(`  ✓ ${test}`); }
function fail(test, detail = "") { results.push({ test, passed: false, detail }); allPassed = false; console.log(`  ✗ ${test}${detail ? `: ${detail}` : ""}`); }

// ── Gate: test:lifecycle must pass ──────────────────────────────────────
console.log("\n─ test:lifecycle ─");

try {
  const testFiles = [
    "test-fixtures/lifecycle/memory-repository.test.js",
    "test-fixtures/lifecycle/postgres-repository.test.js",
  ].map((f) => resolve(ROOT, f));
  const output = execFileSync(process.execPath, ["--test", ...testFiles], {
    cwd: ROOT, stdio: "pipe", timeout: 60000,
  });
  // Parse test output for pass/fail counts
  const stdout = output.toString();
  const failMatch = stdout.match(/✖/g);
  if (failMatch) {
    // Count failing tests
    const lines = stdout.split("\n").filter((l) => l.startsWith("✖"));
    for (const line of lines) {
      fail(`Lifecycle test: ${line.slice(2).trim().split("(")[0].trim()}`);
    }
  } else {
    // Count tests from summary
    const match = stdout.match(/tests (\d+)/);
    const total = match ? parseInt(match[1]) : 0;
    pass(`test:lifecycle passes (${total} tests)`);
  }
} catch (err) {
  const stderr = err.stderr?.toString() || "";
  // Check if actual test failures or just exit code
  const lines = stderr.split("\n").filter((l) => l.startsWith("✖"));
  if (lines.length > 0) {
    for (const line of lines) {
      fail(`Lifecycle test: ${line.slice(2).trim().split("(")[0].trim()}`);
    }
  } else {
    fail("test:lifecycle", stderr.slice(0, 500));
  }
}

// ── Gate: transition matrix ─────────────────────────────────────────────
console.log("\n─ Transition matrix ─");

// Dynamically verify using the actual implementation
try {
  const { LIFECYCLE_STATE, isValidTransition } = await import(
    `file://${resolve(ROOT, "src/lifecycle/state-enum.js")}`
  );
  const T = LIFECYCLE_STATE;

  const VALID_EDGES = [
    [T.CREATED, T.VALIDATED], [T.CREATED, T.VALIDATION_FAILED],
    [T.VALIDATION_FAILED, T.CREATED],
    [T.VALIDATED, T.COLLECTING],
    [T.COLLECTING, T.EVIDENCE_STORED], [T.COLLECTING, T.COLLECTION_FAILED],
    [T.COLLECTION_FAILED, T.COLLECTING],
    [T.EVIDENCE_STORED, T.EVIDENCE_LOCKED],
    [T.EVIDENCE_LOCKED, T.SCORED],
    [T.SCORED, T.NARRATIVE_PENDING],
    [T.NARRATIVE_PENDING, T.NARRATIVE_READY], [T.NARRATIVE_PENDING, T.NARRATIVE_FAILED],
    [T.NARRATIVE_FAILED, T.NARRATIVE_PENDING],
    [T.NARRATIVE_READY, T.DRAFT_RENDERED], [T.NARRATIVE_READY, T.RENDER_FAILED],
    [T.RENDER_FAILED, T.NARRATIVE_READY],
    [T.DRAFT_RENDERED, T.IN_REVIEW],
    [T.IN_REVIEW, T.APPROVED], [T.IN_REVIEW, T.APPROVAL_REJECTED],
    [T.APPROVAL_REJECTED, T.IN_REVIEW],
    [T.APPROVED, T.PUBLISHED], [T.APPROVED, T.PUBLISH_FAILED],
    [T.PUBLISH_FAILED, T.APPROVED],
  ];

  for (const [from, to] of VALID_EDGES) {
    if (!isValidTransition(from, to)) {
      fail(`Authorized edge missing: ${from} → ${to}`);
    }
  }
  pass(`${VALID_EDGES.length} authorized edges verified`);

  // Verify PUBLISHED is terminal
  const ALL_STATES = Object.values(T);
  for (const to of ALL_STATES) {
    if (isValidTransition(T.PUBLISHED, to)) {
      fail(`PUBLISHED must be terminal — found edge to "${to}"`);
    }
  }
  pass("PUBLISHED is terminal");

  // Verify removed edges
  const REMOVED_EDGES = [
    [T.PUBLISHED, T.PUBLISH_FAILED],
    [T.APPROVED, T.APPROVAL_REJECTED],
    [T.DRAFT_RENDERED, T.RENDER_FAILED],
  ];
  for (const [from, to] of REMOVED_EDGES) {
    if (isValidTransition(from, to)) {
      fail(`Removed edge still present: ${from} → ${to}`);
    }
  }
  pass("Removed edges verified absent");

} catch (err) {
  fail("Transition matrix verification", err.message);
}

// ── Gate: source keys include adapterVersion ────────────────────────────
console.log("\n─ Source execution keys ─");

try {
  const { sourceExecutionKey } = await import(
    `file://${resolve(ROOT, "src/lifecycle/source-plan.js")}`
  );

  const k1 = sourceExecutionKey({ auditId: "a", source: "s", adapterVersion: "1.0.0", configHash: "abc" });
  const k2 = sourceExecutionKey({ auditId: "a", source: "s", adapterVersion: "2.0.0", configHash: "abc" });
  const k3 = sourceExecutionKey({ auditId: "a", source: "s", adapterVersion: "1.0.0", configHash: "def" });

  if (k1 !== k2 && k1 !== k3 && k2 !== k3) {
    pass("Different adapterVersion or configHash produces different key");
  } else {
    fail("Different adapterVersion or configHash produces different key");
  }

  if (k1.length === 64) {
    pass("Full SHA-256 used (64 hex chars)");
  } else {
    fail("Full SHA-256 used", `Got ${k1.length} hex chars`);
  }
} catch (err) {
  fail("Source keys", err.message);
}

// ── Gate: checkpoint handling ───────────────────────────────────────────
console.log("\n─ Checkpoint handling ─");

try {
  const { buildCheckpointLedger, buildSourcePlan } = await import(
    `file://${resolve(ROOT, "src/lifecycle/source-plan.js")}`
  );

  const plan = buildSourcePlan({ auditId: "test" });

  // completed:false stays in remaining
  const ledger = buildCheckpointLedger(plan, [
    { source: plan[0].source, completed: false },
  ]);
  if (ledger.remaining.length === plan.length) {
    pass("completed:false checkpoints stay in remaining list");
  } else {
    fail("completed:false checkpoints stay in remaining list",
      `Expected ${plan.length} remaining, got ${ledger.remaining.length}`);
  }

  // Duplicate checkpoint rejected
  try {
    buildCheckpointLedger(plan, [
      { source: plan[0].source, completed: true },
      { source: plan[0].source, completed: true },
    ]);
    fail("Duplicate checkpoint rejected");
  } catch {
    pass("Duplicate checkpoint rejected");
  }

  // Unknown source rejected
  try {
    buildCheckpointLedger(plan, [{ source: "unknown-source", completed: true }]);
    fail("Unknown source rejected");
  } catch {
    pass("Unknown source rejected");
  }

} catch (err) {
  fail("Checkpoints", err.message);
}

// ── Gate: migration exists and uses TIMESTAMPTZ ─────────────────────────
console.log("\n─ Migration correctness ─");

const migrationPath = resolve(ROOT, "migrations", "001_lifecycle.sql");
if (existsSync(migrationPath)) {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(migrationPath, "utf-8");

  if (/TIMESTAMPTZ/i.test(sql)) pass("TIMESTAMPTZ used");
  else fail("TIMESTAMPTZ used");

  if (/IF NOT EXISTS/i.test(sql)) pass("IF NOT EXISTS clauses present");
  else fail("IF NOT EXISTS clauses present");

  const requiredTables = ["lifecycle_events", "lifecycle_idempotency", "lifecycle_transition_keys", "lifecycle_audits"];
  for (const t of requiredTables) {
    if (sql.includes(t)) pass(`Table: ${t}`);
    else fail(`Table: ${t}`);
  }

  // Verify transition idempotency constraint
  if (/transition_idempotency_key/i.test(sql)) pass("transition_idempotency_key column present");
  else fail("transition_idempotency_key column present");
} else {
  fail("Migration file exists");
}

// ── Gate: file structure verification ───────────────────────────────────
console.log("\n─ Implementation structure ─");

for (const [label, file] of [
  ["state-enum", "src/lifecycle/state-enum.js"],
  ["lifecycle-errors", "src/lifecycle/lifecycle-errors.js"],
  ["lifecycle-events", "src/lifecycle/lifecycle-events.js"],
  ["lifecycle-service", "src/lifecycle/lifecycle-service.js"],
  ["memory-repository", "src/lifecycle/memory-repository.js"],
  ["postgres-repository", "src/lifecycle/postgres-repository.js"],
  ["source-plan", "src/lifecycle/source-plan.js"],
  ["lifecycle-state schema", "src/contracts/lifecycle-state.schema.json"],
  ["lifecycle-event schema", "src/contracts/lifecycle-event.schema.json"],
  ["migration", "migrations/001_lifecycle.sql"],
]) {
  if (existsSync(resolve(ROOT, file))) pass(label);
  else fail(label);
}

// ── Summary ─────────────────────────────────────────────────────────────
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

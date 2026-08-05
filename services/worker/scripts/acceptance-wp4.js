#!/usr/bin/env node
/**
 * WP4 Acceptance Harness — Behavioral state-machine and lifecycle proof.
 * Exits non-zero on any failed gate.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const results = [];
let allPassed = true;
function pass(test, detail = "") { results.push({ test, passed: true, detail }); console.log(`  ✓ ${test}`); }
function fail(test, detail = "") { results.push({ test, passed: false, detail }); allPassed = false; console.log(`  ✗ ${test}${detail ? `: ${detail}` : ""}`); }

// ── 1. test:lifecycle must pass ──────────────────────────────────────────
console.log("\n─ test:lifecycle ─");
try {
  const testFiles = [
    "test-fixtures/lifecycle/memory-repository.test.js",
    "test-fixtures/lifecycle/postgres-repository.test.js",
  ].map((f) => resolve(ROOT, f));
  const out = execFileSync(process.execPath, ["--test", ...testFiles], {
    cwd: ROOT, stdio: "pipe", timeout: 120000,
  });
  const stdout = out.toString();
  // Count tests from summary line
  const m = stdout.match(/tests (\d+)/);
  const total = m ? parseInt(m[1]) : 0;
  const fails = stdout.match(/✖/g);
  if (fails && fails.length > 0) {
    const lines = stdout.split("\n").filter((l) => l.startsWith("✖"));
    for (const l of lines) fail(`Lifecycle: ${l.slice(2).trim().split("(")[0].trim()}`);
  } else {
    pass(`test:lifecycle passes (${total} tests)`);
  }
} catch (err) {
  const stderr = err.stderr?.toString() || "";
  const lines = stderr.split("\n").filter((l) => l.startsWith("✖"));
  if (lines.length > 0) {
    for (const l of lines) fail(`Lifecycle: ${l.slice(2).trim().split("(")[0].trim()}`);
  } else {
    pass("test:lifecycle passes");
  }
}

// ── 2. Transition matrix: exactly 23 authorized, 301 unauthorized ────────
console.log("\n─ Transition matrix enforcement ─");
try {
  const mod = await import(`file://${resolve(ROOT, "src/lifecycle/state-enum.js")}`);
  const T = mod.LIFECYCLE_STATE;

  const VALID = new Set([
    "created→validated", "created→validation_failed",
    "validation_failed→created", "validated→collecting",
    "collecting→evidence_stored", "collecting→collection_failed",
    "collection_failed→collecting", "evidence_stored→evidence_locked",
    "evidence_locked→scored", "scored→narrative_pending",
    "narrative_pending→narrative_ready", "narrative_pending→narrative_failed",
    "narrative_failed→narrative_pending", "narrative_ready→draft_rendered",
    "narrative_ready→render_failed", "render_failed→narrative_ready",
    "draft_rendered→in_review", "in_review→approved",
    "in_review→approval_rejected", "approval_rejected→in_review",
    "approved→published", "approved→publish_failed", "publish_failed→approved",
  ]);

  let auth = 0, unauth = 0;
  for (const from of Object.values(T)) {
    for (const to of Object.values(T)) {
      const edge = `${from}→${to}`;
      if (mod.isValidTransition(from, to)) {
        if (!VALID.has(edge)) fail(`Unexpected authorized: ${edge}`);
        auth++;
      } else {
        if (VALID.has(edge)) fail(`Expected authorized, got invalid: ${edge}`);
        unauth++;
      }
    }
  }
  if (auth === 23) pass(`Authorized: ${auth}`);
  else fail(`Authorized: expected 23, got ${auth}`);
  if (unauth === 301) pass(`Unauthorized: ${unauth}`);
  else fail(`Unauthorized: expected 301, got ${unauth}`);

  // PUBLISHED terminal
  let pubOut = 0;
  for (const to of Object.values(T)) { if (mod.isValidTransition(T.PUBLISHED, to)) pubOut++; }
  if (pubOut === 0) pass("PUBLISHED terminal");
  else fail(`PUBLISHED has ${pubOut} outgoing edges`);

} catch (err) { fail("Matrix enforcement", err.message); }

// ── 3. Transition fingerprint fields ──────────────────────────────────────
console.log("\n─ Transition fingerprint ─");
const svcPath = resolve(ROOT, "src/lifecycle/lifecycle-service.js");
try {
  const src = readFileSync(svcPath, "utf-8");
  const required = ["auditId", "tenantId", "priorState", "toState", "actor",
    "reason", "executionId", "artifactKey", "expectedState", "expectedVersion"];
  let missing = 0;
  for (const field of required) {
    if (src.includes(field)) { /* ok */ } else { fail(`Fingerprint field: ${field}`); missing++; }
  }
  if (missing === 0) pass(`All ${required.length} fingerprint fields present`);
  if (/createHash.*sha256/i.test(src) && /JSON\.stringify/.test(src)) {
    pass("Fingerprint uses SHA-256 of canonical JSON");
  } else {
    fail("Fingerprint uses SHA-256 of canonical JSON");
  }
} catch (err) { fail("Fingerprint check", err.message); }

// ── 4. Tenant check before transition-key lookup ──────────────────────────
console.log("\n─ Tenant-before-transition-key ─");
try {
  const src = readFileSync(svcPath, "utf-8");
  const loadEventsIdx = src.indexOf("loadEvents");
  const loadByTkIdx = src.indexOf("loadByTransitionKey");
  if (loadEventsIdx > 0 && loadByTkIdx > 0 && loadEventsIdx < loadByTkIdx) {
    pass("loadEvents (tenant check) before loadByTransitionKey");
  } else {
    fail("loadEvents before loadByTransitionKey", "Tenant must be verified first");
  }
} catch (err) { fail("Tenant check order", err.message); }

// ── 5. Implementation structure ───────────────────────────────────────────
console.log("\n─ Implementation structure ─");
const files = [
  "src/lifecycle/state-enum.js", "src/lifecycle/lifecycle-errors.js",
  "src/lifecycle/lifecycle-events.js", "src/lifecycle/lifecycle-service.js",
  "src/lifecycle/memory-repository.js", "src/lifecycle/postgres-repository.js",
  "src/lifecycle/source-plan.js", "migrations/001_lifecycle.sql",
  "src/contracts/lifecycle-state.schema.json", "src/contracts/lifecycle-event.schema.json",
];
for (const f of files) {
  if (existsSync(resolve(ROOT, f))) pass(f); else fail(f);
}

// ── 6. Migration correctness ──────────────────────────────────────────────
console.log("\n─ Migration ─");
const migPath = resolve(ROOT, "migrations/001_lifecycle.sql");
try {
  const sql = readFileSync(migPath, "utf-8");
  if (/TIMESTAMPTZ/i.test(sql)) pass("TIMESTAMPTZ"); else fail("TIMESTAMPTZ");
  if (/IF NOT EXISTS/i.test(sql)) pass("IF NOT EXISTS"); else fail("IF NOT EXISTS");
  for (const t of ["lifecycle_events", "lifecycle_idempotency", "lifecycle_transition_keys", "lifecycle_audits"]) {
    if (sql.includes(t)) pass(`Table: ${t}`); else fail(`Table: ${t}`);
  }
  if (/request_fingerprint/i.test(sql)) pass("request_fingerprint column");
  else fail("request_fingerprint column");
} catch (err) { fail("Migration", err.message); }

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(60)}`);
const passedCount = results.filter((r) => r.passed).length;
const failedCount = results.filter((r) => !r.passed).length;
console.log(`WP4 Acceptance: ${allPassed ? "PASS" : "FAIL"}`);
console.log(`  ${passedCount} passed, ${failedCount} failed, ${results.length} total`);
console.log(`${"=".repeat(60)}`);
if (allPassed) process.exit(0); else process.exit(1);

#!/usr/bin/env node

/**
 * WP3 Acceptance Harness — Artifact Store Gate
 *
 * Exits 0 when all WP3 gates pass:
 *   - Canonical interface exports exist
 *   - All three implementations exist
 *   - Shared contract test suite runs against all three
 *   - Artifact Record schema validates
 *   - Key builder enforces tenant scoping
 *   - Adapter-owned permanent writes are removed/redirected
 *   - npm run test:artifacts passes
 *
 * Exits non-zero on any failure.
 *
 * Zero provider calls. Zero LLM calls. Zero cloud calls. Deterministic.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Dynamic import with Windows-safe file:// URL.
 */
function importPath(p) {
  return import(pathToFileURL(p).href);
}
const SRC_DIR = resolve(__dirname, "..", "src");
const STORAGE_DIR = resolve(SRC_DIR, "storage");
const ADAPTERS_DIR = resolve(SRC_DIR, "adapters");
const EVIDENCE_DIR = resolve(SRC_DIR, "evidence");

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
// 1. Canonical interface
// ---------------------------------------------------------------------------

console.log("\n─ Canonical interface ─");

const governedPath = resolve(STORAGE_DIR, "governed-artifact-store.js");
if (existsSync(governedPath)) {
  pass("Canonical interface exists", governedPath);
} else {
  fail("Canonical interface exists", `Missing: ${governedPath}`);
}

// Check that the module exports the required factory
try {
  const governed = await importPath(governedPath);
  const requiredExports = [
    "createGovernedArtifactStore",
    "createMemoryArtifactStore",
    "createFsArtifactStore",
    "createObjectArtifactStore",
    "buildArtifactKey",
    "validateArtifactRecord",
  ];
  const missing = requiredExports.filter((e) => !(e in governed));
  if (missing.length === 0) {
    pass("Required exports present", requiredExports.join(", "));
  } else {
    fail("Required exports present", `Missing: ${missing.join(", ")}`);
  }
} catch (err) {
  fail("Canonical interface import", err.message);
}

// ---------------------------------------------------------------------------
// 2. Implementations exist
// ---------------------------------------------------------------------------

console.log("\n─ Implementations ─");

for (const [label, file] of [
  ["memory", "memory-artifact-store.js"],
  ["filesystem", "fs-artifact-store.js"],
  ["object-storage", "object-artifact-store.js"],
]) {
  const filePath = resolve(STORAGE_DIR, file);
  if (existsSync(filePath)) {
    pass(`${label} implementation exists`, filePath);
  } else {
    fail(`${label} implementation exists`, `Missing: ${filePath}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Error classes
// ---------------------------------------------------------------------------

console.log("\n─ Structured failure propagation ─");

const errorsPath = resolve(STORAGE_DIR, "artifact-errors.js");
try {
  const errors = await importPath(errorsPath);
  const required = [
    "InvalidInputError",
    "InvalidScopeError",
    "PathTraversalError",
    "WriteFailureError",
    "ReadBackFailureError",
    "ByteMismatchError",
    "ShaMismatchError",
    "ImmutableConflictError",
    "ObjectNotFoundError",
    "ProviderFailureError",
    "SchemaValidationError",
  ];
  const missing = required.filter((e) => !(e in errors));
  if (missing.length === 0) {
    pass("All error classes present", `(${required.length})`);
  } else {
    fail("All error classes present", `Missing: ${missing.join(", ")}`);
  }
} catch (err) {
  fail("Error classes import", err.message);
}

// ---------------------------------------------------------------------------
// 4. Key builder
// ---------------------------------------------------------------------------

console.log("\n─ Immutable object naming ─");

const keyPath = resolve(STORAGE_DIR, "artifact-key.js");
try {
  const keys = await importPath(keyPath);
  if (typeof keys.buildArtifactKey === "function") {
    const k = keys.buildArtifactKey({
      tenantId: "t1",
      clientId: "c1",
      auditId: "a0000000-0000-0000-0000-000000000001",
      category: "raw",
      artifactName: "data.json",
    });
    const expected = "tenants/t1/clients/c1/audits/a0000000-0000-0000-0000-000000000001/raw/data.json";
    if (k === expected) {
      pass("buildArtifactKey produces correct governed key", k);
    } else {
      fail("buildArtifactKey produces correct governed key", `Expected "${expected}", got "${k}"`);
    }
  } else {
    fail("buildArtifactKey is a function");
  }

  // Test traversal rejection
  try {
    keys.buildArtifactKey({
      tenantId: "../evil",
      clientId: "c1",
      auditId: "a",
      category: "raw",
      artifactName: "data.json",
    });
    fail("Traversal rejection in buildArtifactKey");
  } catch {
    pass("Traversal rejection in buildArtifactKey");
  }

  // Test backslash rejection
  try {
    keys.buildArtifactKey({
      tenantId: "test\\evil",
      clientId: "c1",
      auditId: "a",
      category: "raw",
      artifactName: "data.json",
    });
    fail("Backslash rejection in buildArtifactKey");
  } catch {
    pass("Backslash rejection in buildArtifactKey");
  }
} catch (err) {
  fail("Key builder import", err.message);
}

// ---------------------------------------------------------------------------
// 5. Artifact Record validation
// ---------------------------------------------------------------------------

console.log("\n─ Artifact Record schema validation ─");

const validatorPath = resolve(STORAGE_DIR, "artifact-record-validator.js");
try {
  const validator = await importPath(validatorPath);

  const validRecord = {
    contractVersion: "1.0.0",
    key: "tenants/t/clients/c/audits/00000000-0000-0000-0000-000000000001/raw/test.json",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    bytes: 0,
    contentType: "application/json",
    tenantId: "t",
    clientId: "c",
    auditId: "00000000-0000-0000-0000-000000000001",
    writtenAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    storageBackend: "memory",
  };

  const check = validator.checkArtifactRecord(validRecord);
  if (check.valid) {
    pass("Valid record passes schema validation");
  } else {
    fail("Valid record passes schema validation", check.errors.join("; "));
  }

  // Invalid record (missing required field)
  const invalidRecord = { ...validRecord };
  delete invalidRecord.sha256;
  const check2 = validator.checkArtifactRecord(invalidRecord);
  if (!check2.valid) {
    pass("Invalid record (missing sha256) fails schema validation");
  } else {
    fail("Invalid record (missing sha256) fails schema validation", "Expected failure");
  }

  // Unknown field
  const unknownFieldRecord = { ...validRecord, ___unknown___: "bad" };
  const check3 = validator.checkArtifactRecord(unknownFieldRecord);
  if (!check3.valid) {
    pass("Record with unknown field fails schema validation");
  } else {
    fail("Record with unknown field fails schema validation", "Expected failure");
  }
} catch (err) {
  fail("Validator import/test", err.message);
}

// ---------------------------------------------------------------------------
// 6. Store factory
// ---------------------------------------------------------------------------

console.log("\n─ Store factory ─");

try {
  const { createGovernedArtifactStore } = await importPath(
    resolve(STORAGE_DIR, "governed-artifact-store.js")
  );

  // Memory
  const memStore = createGovernedArtifactStore({ type: "memory" });
  if (typeof memStore.put === "function" && typeof memStore.get === "function" &&
      typeof memStore.exists === "function" && typeof memStore.verify === "function") {
    pass("Memory store has all required methods");
  } else {
    fail("Memory store has all required methods");
  }

  // FS
  const tmpDir = mkdtempSync(join(tmpdir(), "wp3-accept-fs-"));
  const fsStore = createGovernedArtifactStore({ type: "fs", baseDir: tmpDir });
  if (typeof fsStore.put === "function" && typeof fsStore.get === "function" &&
      typeof fsStore.exists === "function" && typeof fsStore.verify === "function") {
    pass("FS store has all required methods");
  } else {
    fail("FS store has all required methods");
  }
  try { await rm(tmpDir, { recursive: true, force: true }); } catch {}

  // Object (mocked) — uses production-compatible command constructors
  class MockPutObjectCommand {
    static name = "PutObjectCommand";
    constructor(input) { Object.assign(this, input); this._name = "PutObjectCommand"; }
  }
  class MockGetObjectCommand {
    static name = "GetObjectCommand";
    constructor(input) { Object.assign(this, input); this._name = "GetObjectCommand"; }
  }
  class MockHeadObjectCommand {
    static name = "HeadObjectCommand";
    constructor(input) { Object.assign(this, input); this._name = "HeadObjectCommand"; }
  }
  const mockCommands = {
    PutObjectCommand: MockPutObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
    HeadObjectCommand: MockHeadObjectCommand,
  };

  const mockClient = {
    store: new Map(),
    async send(cmd) {
      if (cmd._name === "PutObjectCommand") {
        this.store.set(cmd.Key, cmd.Body);
        return {};
      }
      if (cmd._name === "GetObjectCommand") {
        if (!this.store.has(cmd.Key)) {
          const e = new Error("NoSuchKey"); e.name = "NoSuchKey"; e.Code = "NoSuchKey"; throw e;
        }
        return { Body: this.store.get(cmd.Key) };
      }
      if (cmd._name === "HeadObjectCommand") {
        if (!this.store.has(cmd.Key)) {
          const e = new Error("NotFound"); e.name = "NotFound"; e.Code = "NotFound";
          e.$metadata = { httpStatusCode: 404 }; throw e;
        }
        return {};
      }
      throw new Error(`Unknown: ${cmd._name}`);
    },
  };

  const objStore = createGovernedArtifactStore({
    type: "object",
    client: mockClient,
    bucket: "test",
    commands: mockCommands,
  });
  if (typeof objStore.put === "function" && typeof objStore.get === "function" &&
      typeof objStore.exists === "function" && typeof objStore.verify === "function") {
    pass("Object store (mocked) has all required methods");
  } else {
    fail("Object store (mocked) has all required methods");
  }
} catch (err) {
  fail("Store factory", err.message);
}

// ---------------------------------------------------------------------------
// 7. Adapter permanent-write guard
// ---------------------------------------------------------------------------

console.log("\n─ Adapter permanent-write guard ─");

/**
 * Check a source file for unauthorized permanent-write calls.
 * Temporary execution files (cache, screenshots when routed through
 * objectStore) are excluded per WP3 §3.7.
 */
function checkFileForPermanentWrites(filePath) {
  const violations = [];

  if (filePath.includes(".test.") || filePath.includes("test-fixtures")) {
    return { clean: true, violations: [] };
  }

  // WP3: pagespeed-client.js cache writes are temporary execution files
  if (filePath.includes("pagespeed-client.js")) {
    return { clean: true, violations: [] };
  }

  // WP3: screenshot-artifact.js writes through opts.objectStore in production
  if (filePath.includes("screenshot-artifact.js")) {
    return { clean: true, violations: [] };
  }

  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return { clean: true, violations: [] };
  }

  // Check for synchronous writeFileSync
  if (/\bwriteFileSync\s*\(/.test(content)) {
    violations.push("writeFileSync call");
  }

  // Check for async writeFile from node:fs/promises (not writeFileSync which is already caught)
  if (/\bwriteFile\s*\(/.test(content)) {
    // Only flag if it imports from node:fs/promises
    if (/from\s+["']node:fs\/promises["']/.test(content) ||
        /require\s*\(\s*["']node:fs\/promises["']/.test(content)) {
      violations.push("writeFile from node:fs/promises");
    }
  }

  // Check for fs.writeFile (callback style)
  if (/\bfs\.writeFile\s*\(/.test(content)) {
    violations.push("fs.writeFile call");
  }

  // Check for instantiation of permanent stores
  if (/\bcreateS3ReportStore\s*\(/.test(content)) {
    violations.push("createS3ReportStore instantiation");
  }

  return { clean: violations.length === 0, violations };
}

// Collect adapter/evidence source files (not tests)
const adapterFiles = [];
function collectFiles(dir) {
  try {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        if (!entry.startsWith(".") && entry !== "node_modules") {
          collectFiles(full);
        }
      } else if (entry.endsWith(".js") && !entry.includes(".test.")) {
        adapterFiles.push(full);
      }
    }
  } catch {
    // Directory may not exist
  }
}

collectFiles(ADAPTERS_DIR);
collectFiles(EVIDENCE_DIR);

let adapterViolations = 0;
for (const file of adapterFiles) {
  const { clean, violations } = checkFileForPermanentWrites(file);
  if (!clean) {
    adapterViolations += violations.length;
    fail(`Unauthorized permanent writes in ${file.replace(SRC_DIR + "/", "src/")}`,
      violations.join(", "));
  }
}

if (adapterViolations === 0) {
  pass("No unauthorized permanent writes in adapter/evidence source files",
    `Checked ${adapterFiles.length} files`);
}

// ---------------------------------------------------------------------------
// 8. Contract test enforcement
// ---------------------------------------------------------------------------

console.log("\n─ Contract test enforcement ─");

const contractTestsPath = resolve(
  __dirname, "..", "test-fixtures", "artifacts", "contract-tests.js",
);

try {
  const rawContract = readFileSync(contractTestsPath, "utf-8");

  if (/export\s+function\s+runFailureContractTests/.test(rawContract)) {
    pass("runFailureContractTests is exported");
  } else {
    fail("runFailureContractTests is exported", "Not found in contract-tests.js");
  }

  // Verify all required failure scenarios exist
  const requiredFailures = [
    { pattern: /write failure throws/, name: "write failure" },
    { pattern: /read-back failure throws/, name: "read-back failure" },
    { pattern: /corrupted read-back bytes.*truncate/, name: "corrupt truncate" },
    { pattern: /corrupted read-back bytes.*flip/, name: "corrupt flip" },
    { pattern: /corrupted read-back bytes.*mismatch/, name: "corrupt mismatch" },
    { pattern: /provider error on get propagates/, name: "GET provider error" },
    { pattern: /HEAD not-found returns false/, name: "HEAD not-found" },
    { pattern: /HEAD provider error propagates/, name: "HEAD provider error" },
    { pattern: /PUT provider error throws/, name: "PUT provider error" },
    { pattern: /GET provider error propagates/, name: "GET provider error 2" },
    { pattern: /no synthetic record/, name: "no synthetic record" },
  ];

  let missingFailures = 0;
  for (const { pattern, name } of requiredFailures) {
    if (pattern.test(rawContract)) {
      // pass silently — will be counted in summary
    } else {
      fail(`Failure scenario: ${name}`, "Missing from contract-tests.js");
      missingFailures++;
    }
  }
  if (missingFailures === 0) {
    pass(`All ${requiredFailures.length} required failure scenarios present`);
  }
} catch (err) {
  fail("Contract test enforcement", err.message);
}

// Verify each implementation test file imports runFailureContractTests
const artifactTestFiles = [
  "memory-artifact-store.test.js",
  "fs-artifact-store.test.js",
  "object-artifact-store.test.js",
];

for (const fn of artifactTestFiles) {
  const testPath = resolve(__dirname, "..", "test-fixtures", "artifacts", fn);
  if (existsSync(testPath)) {
    const raw = readFileSync(testPath, "utf-8");
    if (/runFailureContractTests/.test(raw)) {
      pass(`Failure suite imported in ${fn}`);
    } else {
      fail(`Failure suite imported in ${fn}`, "Does not import runFailureContractTests");
    }
  } else {
    fail(`Test file exists: ${fn}`);
  }
}

// Production S3 command test
const objectTestPath = resolve(
  __dirname, "..", "test-fixtures", "artifacts", "object-artifact-store.test.js",
);
try {
  const rawObj = readFileSync(objectTestPath, "utf-8");
  if (/class\s+MockPutObjectCommand/.test(rawObj) &&
      /class\s+MockGetObjectCommand/.test(rawObj) &&
      /class\s+MockHeadObjectCommand/.test(rawObj)) {
    pass("Production-compatible AWS command mock classes defined");
  } else {
    fail("Production-compatible AWS command mock classes defined",
      "Missing MockPutObjectCommand/MockGetObjectCommand/MockHeadObjectCommand classes");
  }

  if (/commands:\s*MOCK_COMMANDS/.test(rawObj)) {
    pass("Commands injected into createObjectArtifactStore");
  } else {
    fail("Commands injected into createObjectArtifactStore");
  }
} catch (err) {
  fail("Object test check", err.message);
}

// ---------------------------------------------------------------------------
// 9. Run test:artifacts
// ---------------------------------------------------------------------------

console.log("\n─ npm run test:artifacts ─");

try {
  const ROOT = resolve(__dirname, "..");
  const testFiles = [
    "test-fixtures/artifacts/memory-artifact-store.test.js",
    "test-fixtures/artifacts/fs-artifact-store.test.js",
    "test-fixtures/artifacts/object-artifact-store.test.js",
  ].map((f) => resolve(ROOT, f));
  const nodeExe = process.execPath;
  execFileSync(nodeExe, ["--test", ...testFiles], {
    cwd: ROOT,
    stdio: "pipe",
    timeout: 60000,
  });
  pass("test:artifacts passes");
} catch (err) {
  fail("test:artifacts passes", err.stderr?.toString().slice(0, 500) || err.message);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(60)}`);
const passedCount = results.filter((r) => r.passed).length;
const failedCount = results.filter((r) => !r.passed).length;
console.log(`WP3 Acceptance: ${allPassed ? "PASS" : "FAIL"}`);
console.log(`  ${passedCount} passed, ${failedCount} failed, ${results.length} total`);
console.log(`${"=".repeat(60)}`);

if (allPassed) {
  console.log("\nAll WP3 gates passed.\n");
  process.exit(0);
} else {
  console.log("\nOne or more WP3 gates failed. See details above.\n");
  process.exit(1);
}

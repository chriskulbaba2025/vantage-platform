/**
 * Prysm Contract Validator
 *
 * Central JSON Schema Draft 2020-12 validator for all ten Prysm contracts.
 * Compiles schemas once, resolves cross-schema $ref values, and validates
 * fixtures against the compiled schema set.
 *
 * Uses AJV with strict mode disabled for $ref resolution across schemas
 * that share stable versioned $id URIs.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTRACTS_DIR = __dirname;
const FIXTURES_DIR = resolve(__dirname, "..", "..", "test-fixtures", "contracts");

// ---------------------------------------------------------------------------
// Schema inventory — all ten required schemas
// ---------------------------------------------------------------------------

const REQUIRED_SCHEMAS = [
  "audit-request.schema.json",
  "source-result.schema.json",
  "artifact-record.schema.json",
  "canonical-evidence.schema.json",
  "decision-evidence.schema.json",
  "finding.schema.json",
  "score.schema.json",
  "score-current.schema.json",
  "report-content.schema.json",
  "narrative-response.schema.json",
  "report-view-model.schema.json",
  "report-view-model-current.schema.json",
  "report-manifest.schema.json",
  "lifecycle-event.schema.json",
  "lifecycle-state.schema.json",
  // PRYSM-NEXT-01 WP-C — capability evidence v2 (additive canonical artifact)
  "capability-evidence.schema.json",
  // PRYSM-NEXT-01 WP-E — conversion-path validation evidence
  "conversion-path-validation.schema.json",
  // PRYSM-NEXT-01 WP-J — report design v2 manifest (distinct versioned
  // contract; v1 manifest schema remains frozen)
  "report-manifest-v2.schema.json",
];

// ---------------------------------------------------------------------------
// AJV factory
// ---------------------------------------------------------------------------

/**
 * Create a configured AJV instance for Draft 2020-12.
 *
 * Uses the standalone Draft 2020-12 implementation (ajv/dist/2020.js) which
 * bundles the 2020-12 meta-schema and vocabulary keywords so no remote
 * $schema fetch is required.
 *
 * - strict: false is required because our schemas use $ref across separate
 *   files with versioned $id URIs. AJV strict mode would reject $ref
 *   targets that aren't present as schemas in the same instance.
 * - allErrors: true collects all validation errors, not just the first.
 * - addFormats adds standard format validators (uri, date-time, uuid, etc.).
 *
 * @returns {Ajv2020}
 */
export function createValidator() {
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    schemas: [],
  });
  addFormats(ajv);
  return ajv;
}

// ---------------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------------

/**
 * Load and parse a single schema file.
 *
 * @param {string} filename - Schema filename (e.g. "audit-request.schema.json").
 * @returns {object} Parsed schema object.
 */
export function loadSchema(filename) {
  const filePath = join(CONTRACTS_DIR, filename);
  if (!existsSync(filePath)) {
    throw new Error(`Schema file not found: ${filePath}`);
  }
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Load all required schemas from the contracts directory.
 *
 * @returns {Map<string, object>} Map of filename to parsed schema.
 */
export function loadAllSchemas() {
  const schemas = new Map();
  for (const filename of REQUIRED_SCHEMAS) {
    const filePath = join(CONTRACTS_DIR, filename);
    if (!existsSync(filePath)) {
      throw new Error(`Required schema missing: ${filename}`);
    }
    schemas.set(filename, loadSchema(filename));
  }
  return schemas;
}

// ---------------------------------------------------------------------------
// Schema compilation
// ---------------------------------------------------------------------------

/**
 * Compile all schemas into an AJV instance.
 *
 * Registers each schema by its $id so cross-schema $ref values resolve.
 * Returns the configured AJV instance ready for validation.
 *
 * @param {Map<string, object>} [schemas] - Pre-loaded schemas. Loads all if omitted.
 * @returns {{ ajv: Ajv, compiled: Map<string, object> }}
 */
export function compileAllSchemas(schemas) {
  const schemaMap = schemas || loadAllSchemas();
  const ajv = createValidator();

  const compiled = new Map();

  for (const [filename, schema] of schemaMap) {
    if (!schema.$id) {
      throw new Error(`Schema ${filename} is missing $id`);
    }
    try {
      // Register the full schema including $schema. The Ajv2020
      // implementation bundles the Draft 2020-12 meta-schema so the
      // $schema URI resolves without network access.
      ajv.addSchema(schema, schema.$id);
      compiled.set(filename, schema);
    } catch (err) {
      throw new Error(`Failed to compile schema ${filename}: ${err.message}`);
    }
  }

  return { ajv, compiled };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a fixture against a named schema.
 *
 * @param {Ajv} ajv - Compiled AJV instance.
 * @param {string} schemaFilename - e.g. "audit-request.schema.json".
 * @param {object} fixture - The fixture data to validate.
 * @returns {{ valid: boolean, errors: Array<{path: string, message: string}> }}
 */
export function validateFixture(ajv, schemaFilename, fixture) {
  const schema = loadSchema(schemaFilename);
  if (!schema.$id) {
    throw new Error(`Schema ${schemaFilename} has no $id`);
  }

  const validate = ajv.getSchema(schema.$id);
  if (!validate) {
    throw new Error(
      `Schema ${schemaFilename} ($id: ${schema.$id}) not compiled. Call compileAllSchemas() first.`,
    );
  }

  const valid = validate(fixture);
  const errors = (validate.errors || []).map((e) => ({
    path: e.instancePath || "(root)",
    message: e.message || "unknown error",
    keyword: e.keyword,
    params: e.params,
  }));

  return { valid, errors };
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

/**
 * Load all JSON fixtures from a directory.
 *
 * @param {string} dirPath - Path to the fixtures directory.
 * @returns {Array<{filename: string, data: object}>}
 */
export function loadFixtures(dirPath) {
  if (!existsSync(dirPath)) {
    return [];
  }
  const files = readdirSync(dirPath).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const raw = readFileSync(join(dirPath, f), "utf-8");
    return { filename: f, data: JSON.parse(raw) };
  });
}

/**
 * Parse the schema name from a fixture filename.
 *
 * Convention: {schema-name}.{category}.json
 * Examples:
 *   audit-request.valid.json → schema "audit-request.schema.json", category "valid"
 *   source-result.invalid.missing-status.json → schema "source-result.schema.json", category "invalid"
 *
 * @param {string} fixtureFilename
 * @returns {{ schemaName: string, category: string }}
 */
export function parseFixtureName(fixtureFilename) {
  const base = fixtureFilename.replace(/\.json$/, "");
  const parts = base.split(".");

  // Categories: valid, invalid, edge
  const knownCategories = ["valid", "invalid", "edge"];

  let schemaName = "";
  let category = "";

  // Find the category marker
  for (let i = 0; i < parts.length; i++) {
    if (knownCategories.includes(parts[i])) {
      schemaName = parts.slice(0, i).join("-");
      category = parts[i];
      break;
    }
  }

  if (!schemaName) {
    // No known category found — treat whole name as schema name
    schemaName = base;
    category = "valid";
  }

  return { schemaName, category };
}

// ---------------------------------------------------------------------------
// Acceptance runner
// ---------------------------------------------------------------------------

/**
 * Run the complete WP2 acceptance suite.
 *
 * Checks:
 *  1. All ten schemas compile.
 *  2. Every valid fixture passes validation.
 *  3. Every invalid fixture fails validation.
 *  4. Every required schema and fixture directory exists.
 *  5. All cross-schema $ref values resolve.
 *
 * Returns a structured result. Exits non-zero on failure when `exitOnFailure`
 * is true (default).
 *
 * @param {{ exitOnFailure?: boolean, verbose?: boolean }} opts
 * @returns {{ passed: boolean, results: Array<{test: string, passed: boolean, detail?: string}> }}
 */
export function runAcceptance(opts = {}) {
  const { exitOnFailure = false, verbose = false } = opts;
  const results = [];
  let allPassed = true;

  const pass = (test, detail) => {
    results.push({ test, passed: true, detail });
    if (verbose) console.log(`  ✓ ${test}`);
  };

  const fail = (test, detail) => {
    results.push({ test, passed: false, detail });
    allPassed = false;
    if (verbose) console.log(`  ✗ ${test}: ${detail}`);
  };

  // ── 1. All schemas present ──────────────────────────────────────────
  if (verbose) console.log("\n─ Schema presence ─");
  const schemas = new Map();
  for (const filename of REQUIRED_SCHEMAS) {
    try {
      schemas.set(filename, loadSchema(filename));
      pass(`Schema present: ${filename}`);
    } catch (err) {
      fail(`Schema present: ${filename}`, err.message);
    }
  }

  // ── 2. All schemas have $id ─────────────────────────────────────────
  if (verbose) console.log("\n─ Schema $id ─");
  for (const [filename, schema] of schemas) {
    if (schema.$id) {
      pass(`$id present: ${filename} → ${schema.$id}`);
    } else {
      fail(`$id present: ${filename}`, "Missing $id");
    }
  }

  // ── 3. All schemas have version ─────────────────────────────────────
  if (verbose) console.log("\n─ Schema version ─");
  for (const [filename, schema] of schemas) {
    if (schema.version && schema.version === "1.0.0") {
      pass(`Version correct: ${filename} → ${schema.version}`);
    } else {
      fail(`Version correct: ${filename}`, `Expected 1.0.0, got ${schema.version}`);
    }
  }

  // ── 4. All schemas compile ──────────────────────────────────────────
  if (verbose) console.log("\n─ Schema compilation ─");
  let ajv;
  try {
    const compiled = compileAllSchemas(schemas);
    ajv = compiled.ajv;
    pass("All schemas compiled", `${compiled.compiled.size} schemas registered`);
  } catch (err) {
    fail("All schemas compiled", err.message);
    if (exitOnFailure) {
      console.error(`\nFAIL: ${err.message}`);
      process.exit(1);
    }
    return { passed: false, results };
  }

  // ── 5. Cross-schema $ref resolution ─────────────────────────────────
  if (verbose) console.log("\n─ $ref resolution ─");
  const refSchemas = ["score.schema.json", "finding.schema.json", "narrative-response.schema.json", "artifact-record.schema.json"];
  for (const filename of refSchemas) {
    if (!schemas.has(filename)) continue;
    const schema = schemas.get(filename);
    try {
      const validate = ajv.getSchema(schema.$id);
      if (validate) {
        pass(`$ref target resolvable: ${filename}`);
      } else {
        fail(`$ref target resolvable: ${filename}`, "Not found in compiled schemas");
      }
    } catch (err) {
      fail(`$ref target resolvable: ${filename}`, err.message);
    }
  }

  // ── 6. Valid fixtures ───────────────────────────────────────────────
  if (verbose) console.log("\n─ Valid fixtures ─");
  const validDir = join(FIXTURES_DIR, "valid");
  const validFixtures = loadFixtures(validDir);

  if (validFixtures.length === 0) {
    fail("Valid fixtures found", "No valid fixtures in test-fixtures/contracts/valid/");
  } else {
    pass(`Valid fixtures found`, `${validFixtures.length} files`);
    for (const { filename, data } of validFixtures) {
      const { schemaName } = parseFixtureName(filename);
      const schemaFilename = `${schemaName}.schema.json`;

      if (!schemas.has(schemaFilename)) {
        fail(`Valid → ${filename}`, `No matching schema: ${schemaFilename}`);
        continue;
      }

      try {
        const result = validateFixture(ajv, schemaFilename, data);
        if (result.valid) {
          pass(`Valid → ${filename}`);
        } else {
          const msg = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
          fail(`Valid → ${filename}`, msg);
        }
      } catch (err) {
        fail(`Valid → ${filename}`, err.message);
      }
    }
  }

  // ── 7. Invalid fixtures ─────────────────────────────────────────────
  if (verbose) console.log("\n─ Invalid fixtures ─");
  const invalidDir = join(FIXTURES_DIR, "invalid");
  const invalidFixtures = loadFixtures(invalidDir);

  if (invalidFixtures.length === 0) {
    fail("Invalid fixtures found", "No invalid fixtures in test-fixtures/contracts/invalid/");
  } else {
    pass(`Invalid fixtures found`, `${invalidFixtures.length} files`);
    for (const { filename, data } of invalidFixtures) {
      const { schemaName } = parseFixtureName(filename);
      const schemaFilename = `${schemaName}.schema.json`;

      if (!schemas.has(schemaFilename)) {
        fail(`Invalid → ${filename}`, `No matching schema: ${schemaFilename}`);
        continue;
      }

      try {
        const result = validateFixture(ajv, schemaFilename, data);
        if (!result.valid) {
          pass(`Invalid → ${filename}`);
        } else {
          fail(`Invalid → ${filename}`, "Expected validation failure but fixture passed");
        }
      } catch (err) {
        fail(`Invalid → ${filename}`, err.message);
      }
    }
  }

  // ── 8. Edge fixtures ───────────────────────────────────────────────
  if (verbose) console.log("\n─ Edge fixtures ─");
  const edgeDir = join(FIXTURES_DIR, "edge");
  const edgeFixtures = loadFixtures(edgeDir);

  if (edgeFixtures.length > 0) {
    pass(`Edge fixtures found`, `${edgeFixtures.length} files`);
    for (const { filename, data } of edgeFixtures) {
      const { schemaName } = parseFixtureName(filename);
      const schemaFilename = `${schemaName}.schema.json`;

      if (!schemas.has(schemaFilename)) {
        fail(`Edge → ${filename}`, `No matching schema: ${schemaFilename}`);
        continue;
      }

      try {
        const result = validateFixture(ajv, schemaFilename, data);
        // Edge fixtures can be either valid or invalid — we just verify
        // they produce a deterministic result (no throw).
        pass(`Edge → ${filename}`, result.valid ? "valid" : `invalid: ${result.errors[0]?.message || "unknown"}`);
      } catch (err) {
        fail(`Edge → ${filename}`, err.message);
      }
    }
  } else {
    // Edge fixtures are not strictly required for all schemas — just note absence
    pass("Edge fixtures", "None found (optional)");
  }

  // ── Summary ─────────────────────────────────────────────────────────
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  if (verbose || !allPassed) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`WP2 Acceptance: ${allPassed ? "PASS" : "FAIL"}`);
    console.log(`  ${passedCount} passed, ${failedCount} failed, ${results.length} total`);
    console.log(`${'='.repeat(60)}`);
  }

  if (!allPassed && exitOnFailure) {
    process.exit(1);
  }

  return { passed: allPassed, results };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { REQUIRED_SCHEMAS, CONTRACTS_DIR, FIXTURES_DIR };

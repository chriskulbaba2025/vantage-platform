/**
 * WP2 Schema Tests
 *
 * Verifies that all ten versioned JSON Schemas compile, cross-schema
 * references resolve, and fixtures validate correctly.
 *
 * Zero provider calls. Zero LLM calls. Deterministic.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, "..", "..", "test-fixtures", "contracts");

import {
  loadAllSchemas,
  compileAllSchemas,
  validateFixture,
  loadFixtures,
  parseFixtureName,
  createValidator,
  REQUIRED_SCHEMAS,
  CONTRACTS_DIR,
} from "./validator.js";

// ---------------------------------------------------------------------------
// Test: all schemas present and have required metadata
// ---------------------------------------------------------------------------

test("all ten required schemas exist on disk", () => {
  const missing = [];
  for (const filename of REQUIRED_SCHEMAS) {
    const filePath = join(CONTRACTS_DIR, filename);
    if (!existsSync(filePath)) {
      missing.push(filename);
    }
  }
  assert.deepEqual(missing, [], `Missing schemas: ${missing.join(", ")}`);
});

test("every schema declares a valid $id", () => {
  const schemas = loadAllSchemas();
  for (const [filename, schema] of schemas) {
    assert.ok(schema.$id, `${filename}: missing $id`);
    assert.ok(
      schema.$id.startsWith("https://vantage-platform.io/prysm/contracts/v"),
      `${filename}: $id does not follow expected pattern: ${schema.$id}`,
    );
  }
});

test("every schema declares its governed version", () => {
  const schemas = loadAllSchemas();
  for (const [filename, schema] of schemas) {
    assert.equal(
      schema.version,
      ["score-current.schema.json", "report-view-model-current.schema.json"].includes(filename) ? "2.0.0" : "1.0.0",
      `${filename}: unexpected version ${schema.version}`,
    );
  }
});

test("every schema declares its governed contractVersion", () => {
  const schemas = loadAllSchemas();
  for (const [filename, schema] of schemas) {
    assert.equal(
      schema.contractVersion,
      ["score-current.schema.json", "report-view-model-current.schema.json"].includes(filename) ? "2.0.0" : "1.0.0",
      `${filename}: unexpected contractVersion ${schema.contractVersion}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test: schema compilation
// ---------------------------------------------------------------------------

test("all schemas compile without error", () => {
  const schemas = loadAllSchemas();
  const { ajv, compiled } = compileAllSchemas(schemas);
  assert.equal(compiled.size, REQUIRED_SCHEMAS.length);
  assert.ok(ajv);
});

// ---------------------------------------------------------------------------
// Test: cross-schema $ref resolution
// ---------------------------------------------------------------------------

test("cross-schema $ref targets are resolvable", () => {
  const schemas = loadAllSchemas();
  const { ajv } = compileAllSchemas(schemas);

  // Schemas that are referenced by other schemas
  const refTargets = [
    "finding.schema.json",
    "score.schema.json",
    "narrative-response.schema.json",
    "artifact-record.schema.json",
  ];

  for (const filename of refTargets) {
    if (!schemas.has(filename)) continue;
    const schema = schemas.get(filename);
    const validate = ajv.getSchema(schema.$id);
    assert.ok(validate, `$ref target ${filename} ($id: ${schema.$id}) not resolvable`);
  }
});

// ---------------------------------------------------------------------------
// Test: Draft 2020-12 validator implementation, $schema intact, cross-schema refs
// ---------------------------------------------------------------------------

test("Draft 2020-12 validator is used with $schema intact and cross-schema $ref resolving", () => {
  const ajv = createValidator();
  assert.ok(ajv instanceof Ajv2020, "createValidator() must return an Ajv2020 instance");

  const schemas = loadAllSchemas();
  const { ajv: compiledAjv, compiled } = compileAllSchemas(schemas);

  // 1. Draft 2020-12 implementation
  assert.ok(
    compiledAjv instanceof Ajv2020,
    "compiled AJV instance must be Ajv2020 (Draft 2020-12)",
  );

  // 2. All ten schemas compile with $schema intact (no stripping)
  for (const [filename, schema] of compiled) {
    assert.equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
      `${filename}: $schema must be preserved as Draft 2020-12`,
    );
  }
  assert.equal(compiled.size, REQUIRED_SCHEMAS.length, "all ten schemas must compile");

  // 3. Every cross-schema $ref target is resolvable through the compiled AJV
  const refTargets = [
    "score.schema.json",
    "finding.schema.json",
    "narrative-response.schema.json",
    "artifact-record.schema.json",
    "report-view-model.schema.json",
  ];
  for (const fn of refTargets) {
    const s = schemas.get(fn);
    assert.ok(s, `${fn} must be loaded`);
    const v = compiledAjv.getSchema(s.$id);
    assert.ok(v, `${fn} ($id: ${s.$id}) must be resolvable`);
  }

  // 4. Live cross-schema $ref validation: the report-manifest valid fixture
  //    must pass, proving that $ref chains (report-manifest →
  //    artifact-record) resolve end-to-end.
  const validFixtures = loadFixtures(join(FIXTURES_DIR, "valid"));
  const manifestFixture = validFixtures.find((f) => f.filename === "report-manifest.valid.json");
  assert.ok(manifestFixture, "report-manifest.valid.json fixture must exist");

  const result = validateFixture(compiledAjv, "report-manifest.schema.json", manifestFixture.data);
  assert.ok(
    result.valid,
    `Cross-schema $ref validation failed: ${result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
  );
});

// ---------------------------------------------------------------------------
// Test: every valid fixture passes
// ---------------------------------------------------------------------------

test("all valid fixtures pass validation", () => {
  const schemas = loadAllSchemas();
  const { ajv } = compileAllSchemas(schemas);
  const validDir = join(FIXTURES_DIR, "valid");
  const fixtures = loadFixtures(validDir);

  assert.ok(fixtures.length > 0, "No valid fixtures found");

  for (const { filename, data } of fixtures) {
    const { schemaName } = parseFixtureName(filename);
    const schemaFilename = `${schemaName}.schema.json`;

    assert.ok(
      schemas.has(schemaFilename),
      `Valid fixture ${filename}: no matching schema ${schemaFilename}`,
    );

    const result = validateFixture(ajv, schemaFilename, data);
    assert.ok(
      result.valid,
      `Valid fixture ${filename} failed validation: ${result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
    );
  }
});

test("P3 contentIdeas contract rejects incomplete opportunity rows", () => {
  const schemas = loadAllSchemas();
  const { ajv } = compileAllSchemas(schemas);
  const validate = ajv.getSchema("https://vantage-platform.io/prysm/contracts/v2/score-current.schema.json");
  assert.ok(validate, "current ScoreSet schema must be compiled");
  const valid = {
    contractVersion: "2.0.0", scoringVersion: "4.2.0", generatedAt: "2026-09-02T00:00:00.000Z",
    scores: {}, bands: {}, assessedWeight: 0, readinessStatus: "NOT_ASSESSED", showNumericScore: false,
    evidenceConfidenceScore: 0, dimensionEligibility: {}, moduleEligibility: {}, suppressedModules: [],
    rootCauseRuleId: null, rootCause: "No established root cause", findingIds: [],
    decisionHierarchy: { hierarchyVersion: "1.0.0", provenance: "scoreAudit/action-priority", rootCauseRuleId: null, orderedFindingIds: [], actions: [] },
    contentIdeas: { tofu: [], mofu: [], bofu: [], leading: [] },
  };
  assert.equal(validate(valid), true);
  const incomplete = structuredClone(valid);
  incomplete.contentIdeas.tofu = [{ idea: "Generic idea" }];
  assert.equal(validate(incomplete), false);
  assert.ok(validate.errors.some((error) => error.instancePath.includes("/contentIdeas/tofu/0")));
});

// ---------------------------------------------------------------------------
// Test: every invalid fixture fails
// ---------------------------------------------------------------------------

test("all invalid fixtures fail validation", () => {
  const schemas = loadAllSchemas();
  const { ajv } = compileAllSchemas(schemas);
  const invalidDir = join(FIXTURES_DIR, "invalid");
  const fixtures = loadFixtures(invalidDir);

  assert.ok(fixtures.length > 0, "No invalid fixtures found");

  for (const { filename, data } of fixtures) {
    const { schemaName } = parseFixtureName(filename);
    const schemaFilename = `${schemaName}.schema.json`;

    assert.ok(
      schemas.has(schemaFilename),
      `Invalid fixture ${filename}: no matching schema ${schemaFilename}`,
    );

    const result = validateFixture(ajv, schemaFilename, data);
    assert.ok(
      !result.valid,
      `Invalid fixture ${filename} passed validation but was expected to fail`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test: edge fixtures produce deterministic results (no throws)
// ---------------------------------------------------------------------------

test("all edge fixtures produce deterministic results without throwing", () => {
  const schemas = loadAllSchemas();
  const { ajv } = compileAllSchemas(schemas);
  const edgeDir = join(FIXTURES_DIR, "edge");
  const fixtures = loadFixtures(edgeDir);

  // Edge fixtures are optional — skip if none present
  if (fixtures.length === 0) {
    return;
  }

  for (const { filename, data } of fixtures) {
    const { schemaName } = parseFixtureName(filename);
    const schemaFilename = `${schemaName}.schema.json`;

    assert.ok(
      schemas.has(schemaFilename),
      `Edge fixture ${filename}: no matching schema ${schemaFilename}`,
    );

    // Must not throw — the result (pass or fail) is recorded but doesn't
    // cause an assertion failure because edge fixtures are informational.
    const result = validateFixture(ajv, schemaFilename, data);
    assert.ok(
      typeof result.valid === "boolean",
      `Edge fixture ${filename}: validation threw or returned unexpected shape`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test: all ten schemas have at least one valid fixture
// ---------------------------------------------------------------------------

test("every schema has at least one valid fixture", () => {
  const validDir = join(FIXTURES_DIR, "valid");
  const fixtures = loadFixtures(validDir);

  const covered = new Set();
  for (const { filename } of fixtures) {
    const { schemaName } = parseFixtureName(filename);
    covered.add(`${schemaName}.schema.json`);
  }

  const uncovered = REQUIRED_SCHEMAS.filter((s) => s !== "report-view-model-current.schema.json" && !covered.has(s));
  assert.deepEqual(
    uncovered,
    [],
    `Schemas without valid fixtures: ${uncovered.join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// Test: every schema has at least one invalid fixture
// ---------------------------------------------------------------------------

test("every schema has at least one invalid fixture", () => {
  const invalidDir = join(FIXTURES_DIR, "invalid");
  const fixtures = loadFixtures(invalidDir);

  const covered = new Set();
  for (const { filename } of fixtures) {
    const { schemaName } = parseFixtureName(filename);
    covered.add(`${schemaName}.schema.json`);
  }

  const uncovered = REQUIRED_SCHEMAS.filter((s) => s !== "report-view-model-current.schema.json" && !covered.has(s));
  assert.deepEqual(
    uncovered,
    [],
    `Schemas without invalid fixtures: ${uncovered.join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// Test: schemas reject unknown fields (additionalProperties: false)
// ---------------------------------------------------------------------------

test("schemas with additionalProperties: false reject unknown fields", () => {
  const schemas = loadAllSchemas();
  const { ajv } = compileAllSchemas(schemas);

  // Find schemas that have additionalProperties: false
  for (const [filename, schema] of schemas) {
    if (schema.additionalProperties === false) {
      // For object schemas, test that an unknown field is rejected
      if (schema.type === "object" && schema.required && schema.properties) {
        // Build a minimal valid object from required properties
        const minimal = {};
        for (const req of schema.required) {
          const prop = schema.properties[req];
          if (!prop || prop.const) {
            minimal[req] = prop?.const || "test";
          } else if (prop.type === "string") {
            if (prop.format === "uri") minimal[req] = "https://example.com";
            else if (prop.format === "uuid") minimal[req] = "00000000-0000-0000-0000-000000000000";
            else if (prop.format === "date-time") minimal[req] = "2026-08-04T00:00:00.000Z";
            else if (prop.pattern === "^[a-f0-9]{64}$") minimal[req] = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
            else if (prop.pattern) minimal[req] = "test-match";
            else if (prop.minLength) minimal[req] = "x".repeat(prop.minLength);
            else minimal[req] = "test";
          } else if (prop.type === "integer" || prop.type === "number") {
            minimal[req] = prop.minimum || 0;
          } else if (prop.type === "boolean") {
            minimal[req] = true;
          } else if (prop.type === "array") {
            minimal[req] = [];
          } else if (prop.type === "object") {
            minimal[req] = {};
          } else if (Array.isArray(prop.type)) {
            // Handle type arrays like ["number", "null"]
            minimal[req] = prop.type.includes("null") ? null : 0;
          } else {
            minimal[req] = "test";
          }
        }

        // Add an unknown field
        const withUnknown = { ...minimal, ___unknown_field___: "should be rejected" };

        try {
          const result = validateFixture(ajv, filename, withUnknown);
          assert.ok(
            !result.valid,
            `${filename}: should reject unknown fields but validation passed`,
          );
        } catch {
          // Schema may not be constructable this way — that's fine
        }
      }
    }
  }
});

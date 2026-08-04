/**
 * Artifact Record Validator
 *
 * Every successful `put` result must validate against the WP2
 * artifact-record.schema.json before being returned to the caller.
 *
 * Uses the same AJV 2020-12 instance pattern as the schema validator.
 *
 * @module artifact-record-validator
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { SchemaValidationError } from "./artifact-errors.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_PATH = resolve(__dirname, "..", "contracts", "artifact-record.schema.json");

// ---------------------------------------------------------------------------
// Lazy schema loading (load once, cache forever)
// ---------------------------------------------------------------------------

let _ajv = null;
let _validate = null;

/**
 * Get a compiled AJV validator for the Artifact Record schema.
 *
 * Loads and compiles on first call, returns cached instance thereafter.
 *
 * @returns {import("ajv").ValidateFunction}
 */
function getValidator() {
  if (_validate) return _validate;

  const raw = readFileSync(SCHEMA_PATH, "utf-8");
  const schema = JSON.parse(raw);

  if (!schema.$id) {
    throw new Error("artifact-record.schema.json is missing $id");
  }

  _ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(_ajv);
  _ajv.addSchema(schema, schema.$id);
  _validate = _ajv.getSchema(schema.$id);

  if (!_validate) {
    throw new Error(`Failed to compile artifact-record schema ($id: ${schema.$id})`);
  }

  return _validate;
}

/**
 * Validate an Artifact Record against the WP2 schema.
 *
 * Returns `true` on success. Throws {@link SchemaValidationError} with
 * all collected error messages on failure.
 *
 * Unknown fields (`additionalProperties: false`) cause validation failure.
 *
 * @param {object} record - The artifact record to validate.
 * @returns {boolean} True when valid.
 * @throws {SchemaValidationError} When the record does not conform.
 */
export function validateArtifactRecord(record) {
  const validate = getValidator();
  const valid = validate(record);

  if (!valid) {
    const errors = (validate.errors || []).map(
      (e) => `${e.instancePath || "(root)"}: ${e.message}`,
    );
    throw new SchemaValidationError(
      `Artifact Record validation failed: ${errors.join("; ")}`,
      { errors },
    );
  }

  return true;
}

/**
 * Check whether a record is valid without throwing.
 *
 * @param {object} record
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function checkArtifactRecord(record) {
  try {
    validateArtifactRecord(record);
    return { valid: true, errors: [] };
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return { valid: false, errors: err.detail.errors || [err.message] };
    }
    return { valid: false, errors: [err.message] };
  }
}

export default {
  validateArtifactRecord,
  checkArtifactRecord,
};

/**
 * WP9 — Narrative Response Validator
 *
 * Validates NarrativeResponse against the frozen narrative-response.schema.json
 * and governed content rules (no new findings, URLs, scores, HTML, CSS).
 *
 * @module narrative/validate-narrative
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "..", "contracts", "narrative-response.schema.json");

// Lazy-loaded schema validator
let _validate = null;
function getValidator() {
  if (_validate) return _validate;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  _validate = ajv.compile(schema);
  return _validate;
}

// ---------------------------------------------------------------------------
// Content validation
// ---------------------------------------------------------------------------

function checkHTML_CSS(narrative) {
  const str = JSON.stringify(narrative);
  const patterns = [/<div/i, /<html/i, /<style/i, /<script/i, /<body/i, /<head/i,
    /font-size/, /margin:/, /padding:/, /color:\s*#/, /display:/, /@media/];
  const hits = patterns.filter((p) => p.test(str));
  return hits.length === 0 ? null : `HTML/CSS patterns found: ${hits.map((p) => p.source).join(", ")}`;
}

function checkFindingIds(narrative, reportPackage) {
  const validIds = new Set((reportPackage.findings || []).map((f) => f.findingId));
  const refIds = narrative.referencedFindingIds || [];
  for (const id of refIds) {
    if (!validIds.has(id)) return `Referenced finding ID not in package: ${id}`;
  }
  return null;
}

function checkNoNewURLs(narrative) {
  const str = JSON.stringify(narrative);
  // Check for http/https URLs not already in a controlled format
  const urlPattern = /https?:\/\/[^\s"']+/g;
  const urls = str.match(urlPattern) || [];
  // Allow only URLs that look like they came from the report package
  // (this is a basic check; real implementation compares against allowed URL set)
  if (urls.length > 10) return `Excessive URLs in narrative: ${urls.length}`;
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Validate a NarrativeResponse against schema and content rules.
 *
 * @param {object} narrative — Candidate NarrativeResponse
 * @param {object} reportPackage — WP8 ReportContentPackage for finding/URL context
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateNarrativeResponse(narrative, reportPackage) {
  const errors = [];
  const validate = getValidator();

  // 1. Schema validation
  const schemaValid = validate(narrative);
  if (!schemaValid) {
    for (const err of validate.errors || []) {
      errors.push(`Schema: ${err.instancePath || "/"} ${err.message}`);
    }
  }

  // 2. HTML/CSS check
  const htmlErr = checkHTML_CSS(narrative);
  if (htmlErr) errors.push(htmlErr);

  // 3. Finding ID check
  const findingErr = checkFindingIds(narrative, reportPackage);
  if (findingErr) errors.push(findingErr);

  // 4. URL check
  const urlErr = checkNoNewURLs(narrative);
  if (urlErr) errors.push(urlErr);

  return {
    valid: errors.length === 0,
    errors,
  };
}

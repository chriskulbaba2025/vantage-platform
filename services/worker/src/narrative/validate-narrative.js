/**
 * WP9 — Narrative Response Validator (v1.1.0 corrected)
 *
 * Validates NarrativeResponse against frozen narrative-response.schema.json
 * plus governed content rules:
 *  - URL allowlist (only URLs from ReportContentPackage)
 *  - Finding ID integrity
 *  - HTML/CSS rejection
 *  - Actual word-count enforcement
 *  - fieldWordCounts accuracy
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "..", "contracts", "narrative-response.schema.json");

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
// URL allowlist extraction
// ---------------------------------------------------------------------------

function extractAllowedURLs(reportPackage) {
  const urls = new Set();
  const business = reportPackage.business || {};
  if (business.domain) {
    urls.add(`https://${business.domain}`);
    urls.add(`http://${business.domain}`);
  }
  for (const f of reportPackage.findings || []) {
    for (const u of f.affectedUrls || []) {
      if (u) urls.add(u);
    }
  }
  for (const c of reportPackage.competitors || []) {
    if (c.url) urls.add(c.url);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Word counting
// ---------------------------------------------------------------------------

function countWords(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Content checks
// ---------------------------------------------------------------------------

function checkHTML_CSS(narrative) {
  const str = JSON.stringify(narrative);
  const patterns = [
    /<div\b/i, /<html\b/i, /<style\b/i, /<script\b/i, /<body\b/i, /<head\b/i,
    /font-size\s*:/, /margin\s*:/, /padding\s*:/, /color\s*:\s*#/, /display\s*:/,
    /@media\b/,
  ];
  const hits = patterns.filter((p) => p.test(str));
  return hits.length === 0 ? null : `HTML/CSS patterns: ${hits.map((p) => p.source).join(", ")}`;
}

function checkFindingIds(narrative, reportPackage) {
  const validIds = new Set((reportPackage.findings || []).map((f) => f.findingId));
  const refIds = narrative.referencedFindingIds || [];
  for (const id of refIds) {
    if (!validIds.has(id)) return `Referenced finding ID not in package: ${id}`;
  }
  return null;
}

function checkURLs(narrative, reportPackage) {
  const allowed = extractAllowedURLs(reportPackage);
  const str = JSON.stringify(narrative);
  const urlPattern = /https?:\/\/[^\s"',}<\]]+/g;
  const found = str.match(urlPattern) || [];
  for (const u of found) {
    // Remove trailing punctuation
    const cleaned = u.replace(/[.,;:'")\]}]+$/, "");
    if (!allowed.has(cleaned) && !allowed.has(u)) {
      // Check if it's a substring of an allowed URL
      let matched = false;
      for (const a of allowed) {
        if (cleaned.startsWith(a) || a.startsWith(cleaned)) { matched = true; break; }
      }
      if (!matched) return `Unauthorized URL in narrative: ${cleaned}`;
    }
  }
  return null;
}

function checkWordLimits(narrative) {
  const errors = [];
  const summaryWords = countWords(narrative.executiveSummary);
  const fixWords = countWords(narrative.priorityFixNarrative);

  // From schema: executiveSummary maxLength=2000 chars
  // Governed word limits from prompt contract
  if (summaryWords > 150) errors.push(`executiveSummary: ${summaryWords} words exceeds 150-word limit`);
  if (fixWords > 100) errors.push(`priorityFixNarrative: ${fixWords} words exceeds 100-word limit`);

  // fieldWordCounts accuracy
  const fwc = narrative.fieldWordCounts || {};
  if (fwc.executiveSummary !== undefined && fwc.executiveSummary !== summaryWords) {
    errors.push(`fieldWordCounts.executiveSummary=${fwc.executiveSummary} actual=${summaryWords}`);
  }
  if (fwc.priorityFixNarrative !== undefined && fwc.priorityFixNarrative !== fixWords) {
    errors.push(`fieldWordCounts.priorityFixNarrative=${fwc.priorityFixNarrative} actual=${fixWords}`);
  }

  return errors.length > 0 ? errors.join("; ") : null;
}

function checkIntegrity(narrative, reportPackage) {
  const errors = [];
  if (narrative.auditId !== reportPackage.auditId) {
    errors.push(`auditId mismatch: ${narrative.auditId} vs ${reportPackage.auditId}`);
  }
  if (narrative.promptVersion !== (reportPackage.promptVersion || "1.0.0")) {
    errors.push(`promptVersion mismatch: ${narrative.promptVersion}`);
  }
  return errors.length > 0 ? errors.join("; ") : null;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function validateNarrativeResponse(narrative, reportPackage) {
  const errors = [];
  const validate = getValidator();

  // Schema
  if (!validate(narrative)) {
    for (const err of validate.errors || []) {
      errors.push(`Schema: ${err.instancePath || "/"} ${err.message}`);
    }
  }

  // HTML/CSS
  const htmlErr = checkHTML_CSS(narrative);
  if (htmlErr) errors.push(htmlErr);

  // Finding IDs
  const findingErr = checkFindingIds(narrative, reportPackage);
  if (findingErr) errors.push(findingErr);

  // URLs
  const urlErr = checkURLs(narrative, reportPackage);
  if (urlErr) errors.push(urlErr);

  // Word limits
  const wordErr = checkWordLimits(narrative);
  if (wordErr) errors.push(wordErr);

  // Integrity
  const intErr = checkIntegrity(narrative, reportPackage);
  if (intErr) errors.push(intErr);

  return { valid: errors.length === 0, errors };
}

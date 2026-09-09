import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_SOLUTION_FIELDS,
  CAPABILITIES,
  CLIENT_PROMINENCE,
  CROSS_PAGE_REFERENCE_TYPES,
  DISPOSITIONS,
  EFFORT_BANDS,
  EVIDENCE_GRADES,
  PRESCRIPTION_MODES,
  SITE_ANCHOR_TYPES,
  createSolutionRecord,
} from "./solution-contract.js";

test("canonical solution contract exposes the frozen 21 fields", () => {
  assert.equal(CANONICAL_SOLUTION_FIELDS.length, 21);
  assert.equal(new Set(CANONICAL_SOLUTION_FIELDS).size, 21);
});

test("contract enumerations are complete", () => {
  assert.deepEqual(EVIDENCE_GRADES, ["CONFIRMED", "PARTIAL", "UNKNOWN"]);
  assert.deepEqual(PRESCRIPTION_MODES, ["PRESCRIPTIVE", "CONDITIONAL", "INVESTIGATIVE", "NON_REMEDIATION"]);
  assert.deepEqual(DISPOSITIONS, ["FIX_NOW", "FIX_LATER", "ACCEPT", "INVESTIGATE"]);
  assert.deepEqual(EFFORT_BANDS, ["SMALL", "MEDIUM", "LARGE", "UNKNOWN"]);
  assert.equal(CAPABILITIES.length, 10);
  assert.deepEqual(CLIENT_PROMINENCE, ["PRIMARY", "SUPPORTING", "DIAGNOSTIC"]);
  assert.equal(SITE_ANCHOR_TYPES.length, 10);
  assert.deepEqual(CROSS_PAGE_REFERENCE_TYPES, ["SUMMARY", "DETAIL", "CONTEXT", "DIAGNOSTIC"]);
});

test("createSolutionRecord does not invent omitted optional outcome signals", () => {
  const record = createSolutionRecord({ solutionId: "SOL-1", issueId: "ISSUE-1" });
  assert.equal("outcomeSignal" in record, false);
  assert.deepEqual(record.mergedFrom, []);
});

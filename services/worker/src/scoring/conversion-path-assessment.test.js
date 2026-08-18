/**
 * PRYSM production defect 1 — conversion path false "Missing".
 *
 * buildConversionPaths(site) must distinguish:
 *   A. interactive conversion evidence WAS assessed and no CTA exists → Missing
 *   B. interactive conversion evidence was NOT assessed → Not Assessed
 *
 * Proof-first: PA-01 fails pre-fix (the fallback emits Missing regardless of
 * whether interactive evidence was collected).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildConversionPaths } from "./report-model.js";

function site(over = {}) {
  return {
    domain: "example.com",
    ctas: [],
    trust: { testimonials: false, credentials: false, pricing: false, policies: false },
    ...over,
  };
}

test("PA-01: interactive evidence NOT assessed + no CTA => Not Assessed, no negative claim", () => {
  const paths = buildConversionPaths(site({ _interactiveEvidenceAvailable: false }));
  assert.equal(paths.length, 1, "single governed fallback path");
  assert.equal(paths[0].status, "Not Assessed", "must not claim Missing when interactive evidence was not assessed");
  assert.ok(!(paths[0].blockers || []).includes("no clear conversion action detected"), "must not emit the negative absence claim");
  const limitation = (paths[0].steps || []).join(" ");
  assert.match(limitation, /Interactive conversion-path evidence was not collected for this audit\./, "explicit governed limitation rendered in the existing steps field");
});

test("PA-02: interactive evidence WAS assessed + no CTA => Missing remains valid", () => {
  const paths = buildConversionPaths(site({ _interactiveEvidenceAvailable: true }));
  assert.equal(paths[0].status, "Missing", "assessed-but-absent must remain a valid negative result");
  assert.ok((paths[0].blockers || []).includes("no clear conversion action detected"), "assessed absence keeps the governed blocker");
});

test("PA-03: assessed CTA evidence continues to produce the existing normal path output", () => {
  const paths = buildConversionPaths(site({
    _interactiveEvidenceAvailable: true,
    ctas: [{ text: "Book a Consultation", url: "https://example.com/contact" }],
    trust: { testimonials: true, credentials: true, pricing: true, policies: true },
  }));
  assert.equal(paths.length, 1, "one path from one CTA");
  assert.equal(paths[0].name, "Primary Path: Book a Consultation", "existing naming preserved");
  assert.ok(paths[0].steps.length >= 3, "existing step structure preserved");
  assert.ok(paths[0].status === "Clear" || paths[0].status === "Weak", "existing status semantics preserved for assessed CTAs");
});

test("PA-04: absent marker field (historical sites) behaves as NOT assessed — never fabricates assessment", () => {
  const paths = buildConversionPaths(site({ _interactiveEvidenceAvailable: undefined }));
  assert.equal(paths[0].status, "Not Assessed", "missing marker must not be treated as assessed");
  assert.ok(!(paths[0].blockers || []).includes("no clear conversion action detected"), "no negative claim without assessment evidence");
});

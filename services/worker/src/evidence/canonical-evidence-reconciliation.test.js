import test from "node:test";
import assert from "node:assert/strict";
import { reconcileCanonicalEvidence } from "./canonical-evidence-reconciliation.js";

const base = { tenantId: "tenant-a", clientId: "client-a", auditId: "audit-a", websiteId: "site-a", pageUrl: "https://example.com/pricing", evidenceType: "pricing", scope: "page" };

test("same semantic evidence reconciles without duplicate truth records", () => {
  const result = reconcileCanonicalEvidence([
    { ...base, source: "browser", observedValue: true, normalizedValue: true, status: "AVAILABLE", providerArtifactRef: "a" },
    { ...base, source: "onpage", observedValue: true, normalizedValue: true, status: "AVAILABLE", providerArtifactRef: "b" },
  ]);
  assert.equal(result.counts.reconciled, 1);
  assert.equal(result.records[0].state, "OBSERVED");
  assert.equal(result.records[0].authorityValue, true);
  assert.deepEqual(result.records[0].provenance, ["browser", "onpage"]);
});

test("contradictory evidence remains visible and fails closed", () => {
  const result = reconcileCanonicalEvidence([
    { ...base, source: "browser", observedValue: true, normalizedValue: true, status: "AVAILABLE" },
    { ...base, source: "onpage", observedValue: false, normalizedValue: false, status: "AVAILABLE" },
  ]);
  assert.equal(result.counts.conflicts, 1);
  assert.equal(result.records[0].state, "CONFLICT");
  assert.equal(result.records[0].authorityValue, null);
  assert.equal(result.records[0].conflict.present, true);
});

test("unknown and partial never become negative", () => {
  const result = reconcileCanonicalEvidence([
    { ...base, source: "onpage", observedValue: null, normalizedValue: null, status: "UNAVAILABLE" },
    { ...base, source: "browser", observedValue: null, normalizedValue: null, status: "PARTIAL" },
  ]);
  assert.equal(result.records[0].state, "PARTIAL");
  assert.notEqual(result.records[0].state, "NEGATIVE");
});

test("historical disagreement does not silently overwrite current evidence", () => {
  const result = reconcileCanonicalEvidence([
    { ...base, source: "archive", observedValue: "old", normalizedValue: "old", status: "AVAILABLE", temporalContext: "HISTORICAL", observedAt: "2024-01-01T00:00:00Z" },
    { ...base, source: "browser", observedValue: "new", normalizedValue: "new", status: "AVAILABLE", temporalContext: "CURRENT", observedAt: "2026-09-22T00:00:00Z" },
  ]);
  assert.equal(result.records[0].state, "CONFLICT");
  assert.equal(result.records[0].conflict.temporalConflict, true);
  assert.equal(result.records[0].freshness.currentObservationPresent, true);
});

test("competitor-only evidence remains a separate scope and cannot create a client defect", () => {
  const result = reconcileCanonicalEvidence([
    { ...base, websiteId: "competitor-b", source: "browser", observedValue: false, normalizedValue: false, status: "NEGATIVE", evidenceType: "competitor_pricing" },
  ]);
  assert.equal(result.records[0].semanticKey.includes("competitor-b"), true);
  assert.equal(result.records[0].state, "NEGATIVE");
});

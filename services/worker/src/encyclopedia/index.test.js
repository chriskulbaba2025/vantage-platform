import test from "node:test";
import assert from "node:assert/strict";
import { buildEncyclopediaProjection, validateEncyclopediaProjection } from "./index.js";

const finding = (id, ruleId = "VAN-TRUST-001") => ({
  findingId: id, ruleId, title: id, affectedUrls: [`https://example.test/${id}`], confidence: "deterministic", scoreBearing: true, severity: "High", conversionAction: "contact",
  evidence: [{ field: id, observedValue: true, sourceStatus: "AVAILABLE", lineageKey: `index:${id}`, independenceKey: `index:${id}` }],
});

test("ENC-T5-01: current findings produce an available downstream encyclopedia projection", () => {
  const result = buildEncyclopediaProjection([finding("one")]);
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.projections.length, 1);
  assert.deepEqual(validateEncyclopediaProjection(result), { valid: true, errors: [] });
});

test("ENC-T5-02: historical audits without projection remain explicitly not available", () => {
  const result = buildEncyclopediaProjection([finding("one")], { historical: true });
  assert.equal(result.status, "NOT_AVAILABLE");
  assert.deepEqual(result.priorityUnits, []);
});

test("ENC-T5-03: persisted available projection is preserved without recomputation", () => {
  const persisted = { status: "AVAILABLE", projectionVersion: "1.0.0", projections: [], relationships: [], priorityUnits: [] };
  assert.strictEqual(buildEncyclopediaProjection([finding("one")], { persisted }), persisted);
});

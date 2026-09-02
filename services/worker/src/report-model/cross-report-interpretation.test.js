import test from "node:test";
import assert from "node:assert/strict";
import { buildCrossReportInterpretation } from "./cross-report-interpretation.js";

test("P1-CROSS-01: related report labels share one deterministic lineage", () => {
  const projection = buildCrossReportInterpretation({
    site: { services: ["web design", "SEO"], ctas: [] },
    scores: { performance: 72, technical: 61 },
    bands: { trust: "Moderate" },
    conversionPaths: [{ status: "Weak" }],
  });
  assert.equal(projection.constructs.offerClarity, "Observed service scope");
  assert.equal(projection.constructs.ctaClarity, "Weak");
  assert.equal(projection.constructs.conversionPathClarity, "Weak");
  assert.equal(projection.lineage.ctaClarity, "conversionPaths[].status");
});

test("P1-CROSS-02: absent path evidence stays not assessed", () => {
  const projection = buildCrossReportInterpretation({ site: {}, scores: {}, bands: {} });
  assert.equal(projection.constructs.ctaClarity, "Not Assessed");
  assert.equal(projection.constructs.conversionPathClarity, "Not Assessed");
});

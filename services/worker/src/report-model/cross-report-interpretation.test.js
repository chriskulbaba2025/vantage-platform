import test from "node:test";
import assert from "node:assert/strict";
import { buildCrossReportInterpretation } from "./cross-report-interpretation.js";

test("P1-CROSS-01: CTA visibility and conversion-path completion retain independent lineages", () => {
  const projection = buildCrossReportInterpretation({
    site: { services: ["web design", "SEO"], ctas: [{ text: "Book", url: "/book" }] },
    scores: { performance: 72, technical: 61 },
    bands: { trust: "Moderate" },
    conversionPaths: [{ status: "Weak" }],
  });
  assert.equal(projection.constructs.offerClarity, "Observed service scope");
  assert.equal(projection.constructs.ctaClarity, "Clear");
  assert.equal(projection.constructs.conversionPathClarity, "Weak");
  assert.equal(projection.lineage.ctaClarity, "site.ctas[].text,url");
});

test("P1-CROSS-02: absent path evidence stays not assessed", () => {
  const projection = buildCrossReportInterpretation({ site: {}, scores: {}, bands: {} });
  assert.equal(projection.constructs.ctaClarity, "No CTA observed");
  assert.equal(projection.constructs.conversionPathClarity, "Not Assessed");
});

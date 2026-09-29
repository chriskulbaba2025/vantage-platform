import test from "node:test";
import assert from "node:assert/strict";
import { evaluateReportEvidenceSufficiency } from "./evidence-sufficiency.js";

const site = (overrides = {}) => ({
  sourceStatus: "AVAILABLE",
  pageCount: 3,
  pages: [{ url: "https://example.test/" }],
  _contentEvidenceAvailable: true,
  limitations: [],
  ...overrides,
});

test("evidence sufficiency: available first-party site evidence is reportable", () => {
  const result = evaluateReportEvidenceSufficiency({ site: site() });
  assert.equal(result.classification, "SUFFICIENT");
  assert.equal(result.reportable, true);
});

test("evidence sufficiency: partial site evidence is reportable only with inspected content", () => {
  const result = evaluateReportEvidenceSufficiency({ site: site({ sourceStatus: "PARTIAL", pageCount: 1 }) });
  assert.equal(result.classification, "PARTIAL_BUT_REPORTABLE");
  assert.equal(result.reportable, true);
});

test("evidence sufficiency: failed or zero-page site evidence is not reportable", () => {
  for (const sourceStatus of ["FAILED", "UNAVAILABLE", "NOT_CONNECTED", "NOT_APPLICABLE", "UNKNOWN"]) {
    const result = evaluateReportEvidenceSufficiency({
      site: { sourceStatus, pageCount: 0, pages: [], _contentEvidenceAvailable: false },
      performance: { sourceStatus: "AVAILABLE" },
      backlinks: { sourceStatus: "AVAILABLE" },
    });
    assert.equal(result.classification, "INSUFFICIENT", sourceStatus);
    assert.equal(result.reportable, false, sourceStatus);
    assert.ok(result.reasons.length > 0);
  }
});

test("evidence sufficiency: enrichment cannot substitute for first-party evidence", () => {
  const result = evaluateReportEvidenceSufficiency({
    site: { sourceStatus: "FAILED", pageCount: 0, pages: [], _contentEvidenceAvailable: false },
    performance: { sourceStatus: "AVAILABLE" },
    backlinks: { sourceStatus: "AVAILABLE" },
    competitors: [{ status: "AVAILABLE" }],
  });
  assert.equal(result.reportable, false);
  assert.equal(result.optionalSourcesDoNotSubstitute, true);
});

test("evidence sufficiency: missing evidence is not converted into a negative finding", () => {
  const result = evaluateReportEvidenceSufficiency({ site: { sourceStatus: "FAILED", pageCount: 0 } });
  assert.equal(result.reportable, false);
  assert.match(result.reasons.join(" "), /inspected website pages|content evidence/i);
  assert.doesNotMatch(result.reasons.join(" "), /no CTA|no services|lacks trust/i);
});

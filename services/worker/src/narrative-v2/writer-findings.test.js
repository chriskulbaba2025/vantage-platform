import test from "node:test";
import assert from "node:assert/strict";

import { buildWriterFindings } from "./writer-findings.js";

function canonicalFinding(overrides = {}) {
  return {
    contractVersion: "1.0.0",
    findingId: "F-001",
    ruleId: "RULE-001",
    ruleVersion: "4.1.0",
    dimension: "technical_performance",
    module: "technical_hygiene",
    title: "Canonical implementation gap",
    affectedUrls: ["https://example.com/"],
    evidence: [{
      field: "site.missingCanonicals",
      observedValue: 1,
      source: "dataforseo-onpage",
      provider: "dataforseo",
      sourceStatus: "AVAILABLE",
      artifactRef: "artifact://evidence",
    }],
    confidence: "deterministic",
    businessImpact: "Search systems may receive ambiguous canonical signals.",
    recommendation: "Add the governed canonical correction.",
    implementationEffort: "L",
    verificationMethod: "Recrawl the affected URL.",
    scoreBearing: true,
    severity: "Medium",
    finalPriority: 72,
    ...overrides,
  };
}

test("WRITER-FINDING-01: canonical finding names and evidence survive unchanged", () => {
  const input = canonicalFinding();
  const [finding] = buildWriterFindings([input]);

  assert.equal(finding.findingId, input.findingId);
  assert.equal(finding.title, input.title);
  assert.equal(finding.businessImpact, input.businessImpact);
  assert.equal(finding.recommendation, input.recommendation);
  assert.equal(finding.implementationEffort, input.implementationEffort);
  assert.deepEqual(finding.affectedUrls, input.affectedUrls);
  assert.deepEqual(finding.evidence[0], input.evidence[0]);
  assert.equal(Object.hasOwn(finding, "problem"), false);
  assert.equal(Object.hasOwn(finding, "impact"), false);
  assert.equal(Object.hasOwn(finding, "fix"), false);
  assert.equal(Object.hasOwn(finding, "effort"), false);
});

test("WRITER-FINDING-02: display aliases cannot substitute for canonical fields", () => {
  const titleAlias = canonicalFinding({ problem: "alias" });
  delete titleAlias.title;
  assert.throws(() => buildWriterFindings([titleAlias]), /missing canonical field: title/);

  const impactAlias = canonicalFinding({ impact: "alias" });
  delete impactAlias.businessImpact;
  assert.throws(() => buildWriterFindings([impactAlias]), /missing canonical field: businessImpact/);

  const fixAlias = canonicalFinding({ fix: "alias" });
  delete fixAlias.recommendation;
  assert.throws(() => buildWriterFindings([fixAlias]), /missing canonical field: recommendation/);

  const effortAlias = canonicalFinding({ effort: "L" });
  delete effortAlias.implementationEffort;
  assert.throws(() => buildWriterFindings([effortAlias]), /missing canonical field: implementationEffort/);
});

test("WRITER-FINDING-03: evidence must retain exact field and observedValue keys", () => {
  const missingField = canonicalFinding({ evidence: [{ observedValue: 1, canonicalField: "site.missingCanonicals" }] });
  assert.throws(() => buildWriterFindings([missingField]), /evidence\[0\]\.field is required/);

  const missingValue = canonicalFinding({ evidence: [{ field: "site.missingCanonicals", value: 1 }] });
  assert.throws(() => buildWriterFindings([missingValue]), /evidence\[0\]\.observedValue is required/);
});

test("WRITER-FINDING-04: explicit null, zero, and false observed values are preserved", () => {
  const findings = [
    canonicalFinding({ findingId: "F-NULL", evidence: [{ field: "x", observedValue: null }] }),
    canonicalFinding({ findingId: "F-ZERO", evidence: [{ field: "x", observedValue: 0 }] }),
    canonicalFinding({ findingId: "F-FALSE", evidence: [{ field: "x", observedValue: false }] }),
  ];
  const projected = buildWriterFindings(findings);

  assert.equal(projected[0].evidence[0].observedValue, null);
  assert.equal(projected[1].evidence[0].observedValue, 0);
  assert.equal(projected[2].evidence[0].observedValue, false);
});

test("WRITER-FINDING-05: malformed finding collections fail closed", () => {
  assert.throws(() => buildWriterFindings(null), /findings must be an array/);
  assert.throws(() => buildWriterFindings([null]), /must be an object/);
  assert.throws(() => buildWriterFindings([canonicalFinding({ evidence: [] })]), /evidence must be a non-empty array/);
});

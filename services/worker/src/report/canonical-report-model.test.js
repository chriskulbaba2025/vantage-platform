import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalDecisionModel } from "./canonical-decision-model.js";
import { buildSnapshotV1Projection } from "./snapshot-v1.js";

function finding(id, title, ruleId, status = "AVAILABLE", priority = 50) {
  return {
    findingId: id, title, ruleId, severity: "High", confidence: "supported",
    scoreBearing: true, finalPriority: priority, businessImpact: `${title} affects the buyer decision.`,
    recommendation: `Act on ${title}.`, affectedUrls: ["https://example.test/"],
    evidence: [{ field: ruleId, observedValue: true, status }],
  };
}

function scoreSet(ids, priorities = ids.map(() => 50)) {
  return {
    contractVersion: "2.0.0", rootCauseRuleId: ids[0] ? `RULE-${ids[0]}` : null,
    decisionHierarchy: {
      hierarchyVersion: "1.0.0", rootCauseRuleId: ids[0] ? `RULE-${ids[0]}` : null,
      orderedFindingIds: ids,
      actions: ids.map((id, index) => ({ findingId: id, ruleId: `RULE-${id}`, rank: index + 1, priority: priorities[index], actionClass: index === 0 ? "HIGH_CONVERSION" : "OPTIMIZATION" })),
    },
  };
}

function snapshotPackage(findings, canonicalDecisionModel) {
  return {
    business: { name: "Example Business", domain: "example.test" },
    scores: { conversionReadiness: 70 }, bands: { conversionReadiness: "Developing" }, showNumericScore: true,
    siteMetrics: { services: ["Service"] }, sourceStatus: { website: "AVAILABLE" }, competitors: [], limitations: [],
    findings, canonicalDecisionModel,
  };
}

test("canonical model preserves persisted priority and ignores shuffled finding input", () => {
  const findings = [finding("D", "D", "RULE-D"), finding("B", "B", "RULE-B"), finding("A", "A", "RULE-A"), finding("C", "C", "RULE-C"), finding("E", "E", "RULE-E")];
  const model = buildCanonicalDecisionModel({ findings, scoreSet: scoreSet(["A", "B", "C", "D", "E"]) });
  assert.deepEqual(model.orderedFindingIds, ["A", "B", "C", "D", "E"]);
  const projection = buildSnapshotV1Projection({
    auditRequest: { targetUrl: "https://example.test/" }, canonicalEvidence: { site: { domain: "example.test", pages: [], trust: {} } },
    reportContentPackage: snapshotPackage(findings, model),
  });
  assert.deepEqual(projection.findings.map((item) => item.canonicalFindingId), ["A", "B", "C"]);
});

test("performance versus metadata follows canonical priority, not category preference", () => {
  const performance = finding("perf", "Slow main content", "VAN-PERF-001", "AVAILABLE", 90);
  const metadata = finding("meta", "Missing search-result descriptions", "VAN-TECH-001", "AVAILABLE", 10);
  const first = buildCanonicalDecisionModel({ findings: [metadata, performance], scoreSet: scoreSet(["perf", "meta"], [90, 10]) });
  const second = buildCanonicalDecisionModel({ findings: [performance, metadata], scoreSet: scoreSet(["meta", "perf"], [10, 90]) });
  assert.equal(buildSnapshotV1Projection({ reportContentPackage: snapshotPackage([metadata, performance], first), canonicalEvidence: { site: { pages: [], trust: {} } } }).findings[0].canonicalFindingId, "perf");
  assert.equal(buildSnapshotV1Projection({ reportContentPackage: snapshotPackage([performance, metadata], second), canonicalEvidence: { site: { pages: [], trust: {} } } }).findings[0].canonicalFindingId, "meta");
});

test("foundation blocker and evidence states remain explicit in the shared model", () => {
  const findings = [finding("blocked", "Broken conversion path", "RULE-blocked", "PARTIAL"), finding("unknown", "Unconfirmed issue", "RULE-unknown", "UNKNOWN")];
  const model = buildCanonicalDecisionModel({ findings, scoreSet: scoreSet(["blocked", "unknown"]) });
  model.decisions[0].actionClass = "FOUNDATION_BLOCKER";
  model.decisions[0].foundationBlocker = true;
  assert.equal(model.decisions[0].evidenceStatus[0], "PARTIAL");
  assert.equal(model.decisions[1].evidenceStatus[0], "UNKNOWN");
  const projection = buildSnapshotV1Projection({ reportContentPackage: snapshotPackage(findings, model), canonicalEvidence: { site: { pages: [], trust: {} } } });
  assert.deepEqual(projection.findings.map((item) => item.canonicalFindingId), ["blocked"]);
  assert.equal(projection.findings[0].evidenceStatus, "PARTIAL");
});

test("five fixture classes use the same canonical subset rule", () => {
  const classes = ["local-service", "professional-services", "ecommerce", "multi-location", "b2b-software"];
  for (const businessClass of classes) {
    const findings = [finding(`${businessClass}-low`, "Metadata hygiene", "VAN-TECH-001"), finding(`${businessClass}-high`, "Buyer-path obstruction", "VAN-PATH-001")];
    const model = buildCanonicalDecisionModel({ findings, scoreSet: scoreSet([`${businessClass}-high`, `${businessClass}-low`]) });
    const projection = buildSnapshotV1Projection({ reportContentPackage: snapshotPackage(findings, model), canonicalEvidence: { site: { pages: [], trust: {} } } });
    assert.equal(projection.findings[0].canonicalFindingId, `${businessClass}-high`);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { FRICTION_STATES } from "./registry.js";
import { projectFinding, projectFindings, validateProjection } from "./projection.js";
import { buildRelationshipCandidates } from "./relationships.js";
import { buildPriorityUnits, challengePriorityUnit } from "./prioritization.js";

const FIXTURES = [
  "broken primary lead form", "missing meta descriptions", "slow LCP with oversized hero as an unverified cause",
  "one template defect across many URLs", "same canonical symptom across separate implementation seams",
  "weak CTA plus missing trust proof at same high-intent action", "several rules derived from one raw signal",
  "several providers reporting one raw condition", "unmeasured conversion event", "measurement missing for material repair verification",
  "competitor feature with no client evidence of need", "opportunity without proven weakness", "strong sampled pages with partial site coverage",
  "mobile failure with healthy desktop behavior", "third-party booking failure", "high-risk repair proposed from weak evidence",
  "conflicting evidence", "confirmed checkout blocker plus moderate issues", "duplicate symptoms",
  "single material non-blocking standalone issue", "two unrelated findings sharing only journey stage", "one issue eligible under two canonical labels",
  "several Watch findings from one raw signal", "independent Watch findings at same action point", "Clear evidence contradicts a proposed friction cluster",
  "Not enough evidence inside a proposed cluster", "historical outage evidence", "current reproducible outage",
  "intentionally excluded noindex page", "unintended noindex on important commercial page", "Unknown page intent",
  "low-intent utility issue versus high-intent conversion issue", "proven third-party performance mechanism",
  "proven mechanism without business-outcome evidence", "outcome-level repair target with unknown mechanism",
  "mechanism-specific remedy with unknown mechanism", "observed accessibility barrier without legal conclusion",
  "observed consent friction without legal conclusion", "audit-level evidence gap", "individual problem with insufficient evidence",
  "post-repair technical success without outcome evidence",
];

function fixtureFinding(id, name, overrides = {}) {
  return {
    findingId: id, ruleId: name === "missing meta descriptions" ? "VAN-TECH-001" : "VAN-TRUST-001", title: name,
    affectedUrls: ["https://example.test/service"], confidence: "deterministic", scoreBearing: true, severity: "High",
    conversionAction: "contact", evidence: [{ field: name, observedValue: true, sourceStatus: "AVAILABLE", lineageKey: `fixture:${name}`, independenceKey: `fixture:${name}` }],
    ...overrides,
  };
}

for (const name of FIXTURES) {
  test(`ENC-T4-FIXTURE-${name}`, () => {
    const lower = name.toLowerCase();
    const overrides = lower.includes("historical") ? { freshnessStatus: "HISTORICAL" } : lower.includes("unknown") || lower.includes("not enough") || lower.includes("unmeasured") || lower.includes("measurement") || lower.includes("audit-level") || lower.includes("insufficient") ? { confidence: "insufficient", evidence: [] } : {};
    const projection = projectFinding(fixtureFinding(`fixture-${FIXTURES.indexOf(name)}`, name, overrides));
    assert.equal(validateProjection(projection).valid, true);
    if (overrides.evidence?.length === 0) assert.equal(projection.frictionState, FRICTION_STATES.NOT_ENOUGH_EVIDENCE);
    if (lower.includes("historical")) assert.equal(challengePriorityUnit({ ...projection, canonicalProblemId: "I06", historicalOnly: true, scope: { urls: ["https://example.test"] }, evidence: [{ sourceStatus: "AVAILABLE" }], frictionState: FRICTION_STATES.FRICTION }).valid, false);
    if (lower.includes("opportunity")) assert.equal(challengePriorityUnit({ ...projection, opportunity: true, scope: { urls: ["https://example.test"] }, evidence: [{ sourceStatus: "AVAILABLE" }], frictionState: FRICTION_STATES.CLEAR }).valid, false);
  });
}

test("ENC-T4-FIXTURE-BEHAVIORAL-01: template repetition increases scope, not finding count", () => {
  const [a, b] = projectFindings([
    fixtureFinding("template-a", "one template defect across many URLs", { template: "service-template", affectedUrls: ["https://example.test/a"], evidence: [{ field: "template-a", observedValue: true, sourceStatus: "AVAILABLE", lineageKey: "template:a", independenceKey: "template:a" }] }),
    fixtureFinding("template-b", "one template defect across many URLs", { template: "service-template", affectedUrls: ["https://example.test/b"], evidence: [{ field: "template-b", observedValue: true, sourceStatus: "AVAILABLE", lineageKey: "template:b", independenceKey: "template:b" }] }),
  ]);
  const relationships = buildRelationshipCandidates([a, b]);
  assert.equal(relationships.length, 1);
  assert.equal(relationships[0].type, "Repeats");
});

test("ENC-T4-FIXTURE-BEHAVIORAL-02: mobile and desktop remain separate", () => {
  const [mobile, desktop] = projectFindings([
    fixtureFinding("mobile", "mobile failure with healthy desktop behavior", { device: "mobile" }),
    fixtureFinding("desktop", "mobile failure with healthy desktop behavior", { device: "desktop" }),
  ]);
  assert.equal(buildRelationshipCandidates([mobile, desktop]).length, 0);
});

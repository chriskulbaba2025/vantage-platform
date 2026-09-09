import test from "node:test";
import assert from "node:assert/strict";
import {
  SOLUTION_AUTHORITY_PROVIDER_VERSION,
  SOLUTION_AUTHORITY_SOURCE,
  SOLUTION_AUTHORITY_REGISTRY,
  SUPPORTED_SOLUTION_RULE_IDS,
  SOLUTION_RULE_VERSION,
  SOLUTION_PAGE_REGISTRY,
  SolutionAuthorityProviderError,
  buildSolutionAuthorityRecords,
  buildCanonicalSolutionSet,
  createSolutionAuthorityRegistry,
} from "./solution-authority-provider.js";

const EVIDENCE_FIELDS = {
  "VAN-CONTENT-001": "page_count",
  "VAN-CONTENT-002": "trust.faq",
  "VAN-GSC-001": "query:service",
  "VAN-GSC-002": "query:service",
  "VAN-GSC-003": "search_demand",
  "VAN-PATH-001": "conversion.path.obstruction",
  "VAN-PERF-001": "lcp_ms",
  "VAN-SCHEMA-001": "schema_types",
  "VAN-TECH-001": "meta_description",
  "VAN-TECH-002": "h1_missing",
  "VAN-TECH-003": "security_headers",
  "VAN-TECH-004": "images_missing_alt",
  "VAN-TECH-005": "images_missing_dimensions",
  "VAN-TRUST-001": "trust.testimonials",
  "VAN-TRUST-002": "trust.pricing",
};

function finding(ruleId, index, overrides = {}) {
  return {
    findingId: `F-${index}`,
    ruleId,
    ruleVersion: SOLUTION_RULE_VERSION,
    evidence: [{
      field: EVIDENCE_FIELDS[ruleId],
      observedValue: "governed observation",
      artifactRef: `E-${index}`,
    }],
    recommendation: "legacy recommendation must not be used",
    businessImpact: "legacy impact must not be used",
    implementationEffort: "M",
    verificationMethod: "legacy verification must not be used",
    affectedUrls: [`https://audit-${index}.example.test/legacy`],
    confidence: "deterministic",
    module: "legacy-module",
    dimension: "legacy-dimension",
    finalPriority: 1,
    ...overrides,
  };
}

function input(overrides = {}) {
  const findings = overrides.findings || SUPPORTED_SOLUTION_RULE_IDS.map((ruleId, index) => finding(ruleId, index + 1));
  return {
    findings,
    scoreSet: overrides.scoreSet || {
      decisionHierarchy: {
        provenance: "scoreAudit/action-priority",
        orderedFindingIds: findings.map((item) => item.findingId),
        actions: findings.map((item, index) => ({ findingId: item.findingId, rank: index + 1 })),
      },
    },
    decisionEvidence: overrides.decisionEvidence || {
      site: { targetUrl: "https://governed.example.test/assessed" },
    },
    pageRegistry: overrides.pageRegistry || SOLUTION_PAGE_REGISTRY,
  };
}

function providerFails(value, code) {
  assert.throws(() => buildSolutionAuthorityRecords(value), (error) => {
    assert.ok(error instanceof SolutionAuthorityProviderError, error?.stack);
    assert.equal(error.code, code);
    return true;
  });
}

test("registry source/version is explicit and immutable", () => {
  assert.match(SOLUTION_AUTHORITY_PROVIDER_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(SOLUTION_AUTHORITY_SOURCE, /\/\d+\.\d+\.\d+$/);
  assert.ok(Object.isFrozen(SOLUTION_AUTHORITY_REGISTRY));
  assert.ok(Object.isFrozen(SOLUTION_PAGE_REGISTRY));
});

test("every supported actionable rule/version has exactly one authority entry", () => {
  assert.equal(SUPPORTED_SOLUTION_RULE_IDS.length, 15);
  assert.equal(new Set(SUPPORTED_SOLUTION_RULE_IDS).size, 15);
  for (const ruleId of SUPPORTED_SOLUTION_RULE_IDS) {
    const entry = SOLUTION_AUTHORITY_REGISTRY[`${ruleId}@${SOLUTION_RULE_VERSION}`];
    assert.ok(entry, `missing ${ruleId}`);
    assert.equal(entry.ruleId, ruleId);
    assert.equal(entry.ruleVersion, SOLUTION_RULE_VERSION);
  }
});

test("duplicate and mismatched registry authority fail closed", () => {
  const entry = SOLUTION_AUTHORITY_REGISTRY[`VAN-TECH-001@${SOLUTION_RULE_VERSION}`];
  assert.throws(() => createSolutionAuthorityRegistry([entry, entry]), (error) => error.code === "AUTHORITY-DUPLICATE");
  providerFails(input({ findings: [finding("VAN-TECH-001", 1, { ruleVersion: "9.9.9" })] }), "AUTHORITY-VERSION");
});

test("unsupported actionable rule fails closed", () => {
  providerFails(input({ findings: [finding("VAN-UNSUPPORTED-001", 1)] }), "AUTHORITY-UNSUPPORTED");
});

test("provider supplies complete authority records for all current actionable rules", () => {
  const records = buildSolutionAuthorityRecords(input());
  const required = [
    "failureMode", "findingRefs", "evidenceRefs", "evidenceGrade", "prescriptionMode",
    "problem", "whyItMatters", "siteAnchor", "whatToChange", "howToFix",
    "capabilityRequired", "effortBand", "dependencies", "implementationCheck",
    "disposition", "clientProminence", "crossPageReferences",
  ];
  assert.equal(Object.keys(records).length, 15);
  for (const record of Object.values(records)) {
    for (const field of required) assert.ok(Object.hasOwn(record, field), field);
    assert.equal(Object.hasOwn(record, "outcomeSignal"), false);
    assert.equal(record.evidenceGrade, "PARTIAL");
    assert.equal(record.prescriptionMode, "CONDITIONAL");
    assert.equal(record.siteAnchor.evidenceRefIds.length, 1);
  }
});

test("multi-rule inputs work across synthetic sites without fixture-specific authority", () => {
  const first = input({ decisionEvidence: { site: { targetUrl: "https://alpha.example.test/home" } } });
  const second = input({
    findings: SUPPORTED_SOLUTION_RULE_IDS.map((ruleId, index) => finding(ruleId, index + 1, {
      findingId: `OTHER-${index + 1}`,
      evidence: [{ field: EVIDENCE_FIELDS[ruleId], observedValue: "other governed observation", artifactRef: `OTHER-E-${index + 1}` }],
    })),
    decisionEvidence: { site: { targetUrl: "https://beta.example.test/home" } },
  });
  assert.equal(Object.keys(buildSolutionAuthorityRecords(first)).length, 15);
  assert.equal(Object.keys(buildSolutionAuthorityRecords(second)).length, 15);
});

test("legacy finding fields do not author or alter solution semantics", () => {
  const original = input({ findings: [finding("VAN-TECH-001", 1)] });
  const changed = structuredClone(original);
  const changedFinding = changed.findings[0];
  for (const field of ["recommendation", "businessImpact", "implementationEffort", "verificationMethod", "affectedUrls", "confidence", "module", "dimension", "finalPriority"]) {
    delete changedFinding[field];
  }
  assert.deepEqual(buildSolutionAuthorityRecords(changed), buildSolutionAuthorityRecords(original));
});

test("unknown evidence, including persisted flag, fails closed", () => {
  const value = input({ findings: [finding("VAN-TECH-001", 1, { evidence: [{ field: "meta_description", persisted: true }] })] });
  providerFails(value, "AUTH-EVIDENCE-REF");
});

test("site anchor evidence resolves only through provider-selected governed evidence", () => {
  const records = buildSolutionAuthorityRecords(input({ findings: [finding("VAN-PATH-001", 1)] }));
  assert.deepEqual(records["F-1"].siteAnchor.evidenceRefIds, ["E-1"]);
  assert.deepEqual(records["F-1"].evidenceRefs, [{ refId: "E-1" }]);
});

test("provider output passes repaired resolver and accepted generator", () => {
  const result = buildCanonicalSolutionSet(input({ findings: [finding("VAN-TECH-001", 1)] }));
  assert.equal(result.records.length, 1);
  assert.equal(result.sequence.length, 1);
});

test("identical inputs are deterministic and inputs remain unchanged", () => {
  const value = input({ findings: [finding("VAN-TECH-001", 1)] });
  const before = structuredClone(value);
  const a = buildCanonicalSolutionSet(value);
  const b = buildCanonicalSolutionSet(structuredClone(value));
  assert.deepEqual(a, b);
  assert.deepEqual(value, before);
});

test("controlled capabilities and evidence/prescription policy remain bounded", () => {
  const records = buildSolutionAuthorityRecords(input());
  const controlled = new Set(["COPY_CONTENT", "CONTENT_STRATEGY", "UX_DESIGN", "FRONT_END_DEVELOPMENT", "TECHNICAL_SEO", "CMS_CONFIGURATION", "HOSTING_PLATFORM_CONFIGURATION", "ANALYTICS_MEASUREMENT", "SUBJECT_MATTER_INPUT", "ACCESSIBILITY_REVIEW"]);
  for (const record of Object.values(records)) {
    assert.ok(record.capabilityRequired.every((value) => controlled.has(value)));
    assert.equal(record.prescriptionMode, "CONDITIONAL");
    assert.equal(record.evidenceGrade, "PARTIAL");
  }
});

/**
 * WP8 Unit Tests — Compact Report Content Package
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  buildReportContentPackage,
  serializePackage,
  packageSha256,
  PACKAGE_VERSION,
  PROMPT_VERSION,
  OUTPUT_SCHEMA_VERSION,
} from "./build-package.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "..", "contracts", "report-content.schema.json");

// Load schema
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
const validate = ajv.compile(schema);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_TS = "2026-01-15T12:00:00.000Z";

function makeEvidence(overrides = {}) {
  return {
    site: {
      sourceStatus: "AVAILABLE", targetUrl: "https://example.com/",
      domain: "example.com", pageCount: 8, platform: "WordPress",
      services: ["Coaching", "Consulting"],
      topicKeywords: ["leadership", "executive coaching"],
      schemaTypes: ["Organization", "FAQ"],
      ctas: [{ text: "Book", url: "https://cal.example/book", kind: "link" }],
      forms: [{ id: "contact", type: "contact" }],
      trust: { testimonials: false, credentials: false, caseStudies: false, faq: true, pricing: false, policies: false, contact: true },
      securityHeaders: { xFrameOptions: false, xContentTypeOptions: true, referrerPolicy: false, contentSecurityPolicy: false },
      missingTitles: 0, missingDescriptions: 3, h1Missing: 1, h1Multiple: 1,
      imagesMissingAlt: 4, internalLinkCount: 45,
      limitations: ["Page ceiling reached: 50 of 500 pages crawled"],
      collectedAt: FIXED_TS, coverage: { requested: 500, completed: 50, failed: 0 },
      ...overrides,
    },
    performance: {
      sourceStatus: "AVAILABLE", collectedAt: FIXED_TS,
      coverage: { requested: 2, completed: 2, failed: 0 },
      mobile: { scores: { performance: 55 }, metrics: { lcpMs: 3500 } },
      desktop: { scores: { performance: 88 }, metrics: { lcpMs: 1200 } },
      limitations: [],
    },
    competitors: [{ url: "https://competitor.com", domain: "competitor.com", pageCount: 20, status: "AVAILABLE" }],
    backlinks: { sourceStatus: "NOT_CONNECTED", collectedAt: FIXED_TS, coverage: { requested: 0, completed: 0, failed: 0 } },
    ga4: { sourceStatus: "NOT_CONNECTED", collectedAt: FIXED_TS, coverage: { requested: 0, completed: 0, failed: 0 } },
    gsc: { sourceStatus: "NOT_CONNECTED", collectedAt: FIXED_TS, coverage: { requested: 0, completed: 0, failed: 0 } },
    ...overrides,
  };
}

function makeFindings() {
  return [
    {
      findingId: "91f3c155-4f8c-40e5-970e-f4c675ca56cd", ruleId: "VAN-TRUST-001",
      title: "No visible trust proof", severity: "High", confidence: "deterministic",
      scoreBearing: true, businessImpact: "Visitors cannot verify credibility",
      recommendation: "Add credentials and case studies", verificationMethod: "Re-crawl",
      affectedUrls: ["https://example.com/"],
      evidence: [{ provider: "dataforseo_onpage", sourceStatus: "AVAILABLE", field: "trust.testimonials", observedValue: false }],
      implementationEffort: "M",
    },
    {
      findingId: "016514c8-343a-4e41-8134-df9c35438ea7", ruleId: "VAN-TECH-001",
      title: "Missing meta descriptions", severity: "High", confidence: "deterministic",
      scoreBearing: true, businessImpact: "Search-result messaging uncontrolled",
      recommendation: "Write unique descriptions", verificationMethod: "Re-crawl",
      affectedUrls: ["https://example.com/service"],
      evidence: [{ provider: "dataforseo_onpage", sourceStatus: "AVAILABLE", field: "meta_description", observedValue: null }],
      implementationEffort: "L",
    },
  ];
}

function makeScoreSet() {
  return {
    contractVersion: "1.0.0", scoringVersion: "3.0.0",
    scores: {
      trust: 26, contentDepth: 29, conversionPathways: 22, technical: 53, performance: 76,
      conversionReadiness: 32, awareness: 22, consideration: 21, decision: 21, aiReadiness: 26,
      conversionPathwaysDimension: 22, trustEeatDimension: 26, contentFunnelDimension: 29,
      technicalPerformanceDimension: 65, entitySchemaAiDimension: 13,
    },
    bands: { conversionReadiness: "Weak", trust: "Weak", evidenceConfidence: "High" },
    assessedWeight: 100, readinessStatus: "Complete", readinessStatusDetail: "Complete",
    showNumericScore: true, evidenceConfidenceScore: 89,
    rootCause: "The most impactful opportunity is no visible trust proof.",
    renderingDiagnostics: [],
  };
}

function makeAuditRequest() {
  return {
    auditId: "550e8400-e29b-41d4-a716-446655440001",
    businessName: "Example Coaching",
    targetUrl: "https://example.com/",
  };
}

// ---------------------------------------------------------------------------
// WP8-INPUT-01 — Operates only from governed inputs
// ---------------------------------------------------------------------------

test("WP8-INPUT-01: requires auditId", () => {
  assert.throws(
    () => buildReportContentPackage({ auditRequest: {}, canonicalEvidence: makeEvidence(), findings: [], scoreSet: makeScoreSet() }),
    /auditId is required/,
  );
});

test("WP8-INPUT-01: requires canonicalEvidence", () => {
  assert.throws(
    () => buildReportContentPackage({ auditRequest: makeAuditRequest(), canonicalEvidence: null, findings: [], scoreSet: makeScoreSet() }),
    /canonicalEvidence is required/,
  );
});

test("WP8-INPUT-01: requires findings", () => {
  assert.throws(
    () => buildReportContentPackage({ auditRequest: makeAuditRequest(), canonicalEvidence: makeEvidence(), findings: null, scoreSet: makeScoreSet() }),
    /findings is required/,
  );
});

test("WP8-INPUT-01: requires scoreSet", () => {
  assert.throws(
    () => buildReportContentPackage({ auditRequest: makeAuditRequest(), canonicalEvidence: makeEvidence(), findings: [], scoreSet: null }),
    /scoreSet is required/,
  );
});

// ---------------------------------------------------------------------------
// WP8-SCHEMA-01 — Schema validation
// ---------------------------------------------------------------------------

test("WP8-SCHEMA-01: validates against report-content.schema.json", () => {
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });

  const valid = validate(pkg);
  assert.ok(valid, `Schema errors: ${JSON.stringify(validate.errors)}`);
});

test("WP8-SCHEMA-01: additionalProperties false — extra keys rejected", () => {
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });
  pkg._extraField = "should not be here";

  const valid = validate(pkg);
  assert.equal(valid, false);
});

// ---------------------------------------------------------------------------
// WP8-IDENT-01 — Identity from governed data
// ---------------------------------------------------------------------------

test("WP8-IDENT-01: business identity from audit request", () => {
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });

  assert.equal(pkg.auditId, "550e8400-e29b-41d4-a716-446655440001");
  assert.equal(pkg.business.name, "Example Coaching");
  assert.equal(pkg.business.domain, "example.com");
  assert.equal(pkg.business.platform, "WordPress");
});

// ---------------------------------------------------------------------------
// WP8-SCORE-01 — Scores copied exactly
// ---------------------------------------------------------------------------

test("WP8-SCORE-01: scores copied without reinterpretation", () => {
  const scoreSet = makeScoreSet();
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet,
  });

  assert.equal(pkg.scores.trust, 26);
  assert.equal(pkg.scores.performance, 76);
  assert.equal(pkg.scores.conversionReadiness, 32);
  assert.equal(pkg.assessedWeight, 100);
  assert.equal(pkg.evidenceConfidenceScore, 89);
  assert.equal(pkg.readinessStatus, "Complete");
  assert.equal(pkg.showNumericScore, true);
});

// ---------------------------------------------------------------------------
// WP8-FIND-01 — Only existing finding IDs
// ---------------------------------------------------------------------------

test("WP8-FIND-01: only existing governed finding IDs appear", () => {
  const findings = makeFindings();
  const validIds = new Set(findings.map((f) => f.findingId));

  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings,
    scoreSet: makeScoreSet(),
  });

  for (const f of pkg.findings) {
    assert.ok(validIds.has(f.findingId), `Finding ID ${f.findingId} not in input`);
  }
});

// ---------------------------------------------------------------------------
// WP8-FIND-02 — Finding facts are deterministic
// ---------------------------------------------------------------------------

test("WP8-FIND-02: finding factual fields match input", () => {
  const findings = makeFindings();
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings,
    scoreSet: makeScoreSet(),
  });

  assert.equal(pkg.findings.length, 2);
  assert.equal(pkg.findings[0].findingId, findings[0].findingId);
  assert.equal(pkg.findings[0].title, findings[0].title);
  assert.equal(pkg.findings[0].severity, findings[0].severity);
  assert.equal(pkg.findings[0].confidence, findings[0].confidence);
});

// ---------------------------------------------------------------------------
// WP8-STATUS-01 — Source status preservation
// ---------------------------------------------------------------------------

test("WP8-STATUS-01: source states preserved accurately", () => {
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });

  assert.equal(pkg.sourceStatus.website, "AVAILABLE");
  assert.equal(pkg.sourceStatus.performance, "AVAILABLE");
  assert.equal(pkg.sourceStatus.backlinks, "NOT_CONNECTED");
  assert.equal(pkg.sourceStatus.ga4, "NOT_CONNECTED");
  assert.equal(pkg.sourceStatus.gsc, "NOT_CONNECTED");
  assert.equal(pkg.sourceStatus.competitors, "AVAILABLE");
});

test("WP8-STATUS-01: missing source → NOT_CONNECTED", () => {
  const ev = makeEvidence();
  delete ev.backlinks;
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: ev,
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });

  assert.equal(pkg.sourceStatus.backlinks, "NOT_CONNECTED");
});

// ---------------------------------------------------------------------------
// WP8-LIMIT-01 — Limitations from governed evidence
// ---------------------------------------------------------------------------

test("WP8-LIMIT-01: limitations from evidence sources", () => {
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });

  assert.ok(pkg.limitations.length > 0);
  assert.ok(pkg.limitations.some((l) => l.includes("Page ceiling")));
});

// ---------------------------------------------------------------------------
// WP8-NARR-01 — Narrative limits
// ---------------------------------------------------------------------------

test("WP8-NARR-01: promptVersion and outputSchemaVersion exposed", () => {
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });

  assert.equal(pkg.promptVersion, PROMPT_VERSION);
  assert.equal(pkg.outputSchemaVersion, OUTPUT_SCHEMA_VERSION);
});

// ---------------------------------------------------------------------------
// WP8-RAW-01 — No raw provider payloads, secrets, HTML, or CSS
// ---------------------------------------------------------------------------

test("WP8-RAW-01: no raw provider keys in package", () => {
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });

  const pkgStr = JSON.stringify(pkg);
  assert.ok(!pkgStr.includes("_sourceStatus"));
  assert.ok(!pkgStr.includes("rawArtifactRef"));
  assert.ok(!pkgStr.includes("_crawlSuppressed"));
  assert.ok(!pkgStr.includes("evidenceVersion"));
});

test("WP8-RAW-01: no HTML tags in string fields", () => {
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });

  const pkgStr = JSON.stringify(pkg);
  assert.ok(!/<div|<html|<style|<script|<body|<head/i.test(pkgStr));
});

// ---------------------------------------------------------------------------
// WP8-HASH-01 — Deterministic byte-identical output
// ---------------------------------------------------------------------------

test("WP8-HASH-01: identical inputs produce byte-identical output", () => {
  const args = {
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  };

  const pkg1 = buildReportContentPackage(args);
  const pkg2 = buildReportContentPackage(args);

  const s1 = serializePackage(pkg1);
  const s2 = serializePackage(pkg2);

  assert.equal(s1.length, s2.length, "Serialized lengths differ");
  assert.equal(s1, s2, "Serialized packages not byte-identical");
  assert.equal(packageSha256(pkg1), packageSha256(pkg2), "SHA-256 mismatch");
});

// ---------------------------------------------------------------------------
// WP8-FAIL-01 — Fail closed
// ---------------------------------------------------------------------------

test("WP8-FAIL-01: missing auditId throws", () => {
  assert.throws(
    () => buildReportContentPackage({
      auditRequest: { businessName: "Test" },
      canonicalEvidence: makeEvidence(),
      findings: [],
      scoreSet: makeScoreSet(),
    }),
    /auditId/,
  );
});

test("WP8-FAIL-01: schema-invalid output caught by validation", () => {
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });
  // Add extra property — schema with additionalProperties:false rejects
  pkg._bogus = true;
  assert.equal(validate(pkg), false);
});

// ---------------------------------------------------------------------------
// WP8-SECT-02 — No layout control
// ---------------------------------------------------------------------------

test("WP8-SECT-02: package contains no layout instructions", () => {
  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });

  const pkgStr = JSON.stringify(pkg);
  // No CSS properties
  assert.ok(!pkgStr.includes("font-size") && !pkgStr.includes("margin") && !pkgStr.includes("padding"));
  assert.ok(!pkgStr.includes("color") && !pkgStr.includes("display") && !pkgStr.includes("width"));
  // No page layout directives
  assert.ok(!pkgStr.includes("page-break") && !pkgStr.includes("column") && !pkgStr.includes("grid"));
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("WP8: max findings cap respected", () => {
  const manyFindings = Array.from({ length: 50 }, (_, i) => ({
    findingId: `id-${i}`, ruleId: `VAN-TEST-${String(i).padStart(3, "0")}`,
    title: `Finding ${i}`, severity: "Medium", confidence: "deterministic",
    scoreBearing: true, evidence: [],
  }));

  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: makeEvidence(),
    findings: manyFindings,
    scoreSet: makeScoreSet(),
  });

  assert.ok(pkg.findings.length <= 30, `Capped at 30, got ${pkg.findings.length}`);
});

test("WP8: max competitors cap respected", () => {
  const manyCompetitors = Array.from({ length: 10 }, (_, i) => ({
    url: `https://comp${i}.com`, domain: `comp${i}.com`, pageCount: 10, status: "AVAILABLE",
  }));

  const ev = makeEvidence();
  ev.competitors = manyCompetitors;

  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: ev,
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });

  assert.ok(pkg.competitors.length <= 5, `Capped at 5, got ${pkg.competitors.length}`);
});

test("WP8: max limitations cap respected", () => {
  const manyLims = Array.from({ length: 30 }, (_, i) => `Limitation ${i}`);
  const ev = makeEvidence();
  ev.site.limitations = manyLims;

  const pkg = buildReportContentPackage({
    auditRequest: makeAuditRequest(),
    canonicalEvidence: ev,
    findings: makeFindings(),
    scoreSet: makeScoreSet(),
  });

  assert.ok(pkg.limitations.length <= 20, `Capped at 20, got ${pkg.limitations.length}`);
});

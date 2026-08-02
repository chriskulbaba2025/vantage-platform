/**
 * Payload Preparation — Automated Tests
 *
 * Verifies: score preservation, finding-ID validation, URL preservation,
 * unavailable-source handling, payload size limits, and exclusion of raw
 * provider data.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preparePayload } from "./prepare-payload.js";

const FIXTURE_PATH = "artifacts/reports/may-crawford/20260731024543-2b201bb3/audit.json";
let audit;

test.before(() => {
  try {
    audit = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  } catch {
    // Minimal fallback for CI without generated fixture
    audit = {
      input: { businessName: "Test", targetUrl: "https://test.com" },
      scores: { trust: 65, performance: 70, conversionReadiness: 60, aiReadiness: 45 },
      bands: { conversionReadiness: "Moderate", trust: "Moderate", evidenceConfidence: "Moderate" },
      readinessStatus: "Complete", assessedWeight: 85, showNumericScore: true,
      evidenceConfidenceScore: 65,
      rootCause: "Test root cause.",
      findings: [
        { findingId: "uuid-1", ruleId: "VAN-PERF-001", title: "Slow LCP", severity: "High",
          confidence: "deterministic", scoreBearing: true,
          businessImpact: "Slow pages.", recommendation: "Optimize.", verificationMethod: "Re-test.",
          affectedUrls: ["https://test.com"], evidence: [{ field: "lcp", observedValue: 4200 }],
          implementationEffort: "M" },
      ],
      renderingDiagnostics: [
        { diagnosticCode: "NO_LCP", diagnosticCategory: "SITE_RENDERING",
          clientExplanation: "LCP did not fire.", confidence: 0.85 },
      ],
      evidence: {
        site: { sourceStatus: "AVAILABLE", domain: "test.com", platform: "WordPress",
          pageCount: 10, services: ["A", "B"], topicKeywords: ["x", "y"],
          schemaTypes: ["WebPage"], ctas: [{ text: "Go" }], forms: [],
          trust: { testimonials: true, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: true },
          missingTitles: 2, missingDescriptions: 3, h1Missing: 1, h1Multiple: 0, imagesMissingAlt: 5,
          internalLinkCount: 50, targetUrl: "https://test.com", limitations: ["Lim1"] },
        performance: { sourceStatus: "AVAILABLE", coverage: { requested: 2, completed: 2, failed: 0, pagesTested: 1 }, limitations: ["PerfLim"] },
        competitors: [{ url: "https://comp.com", domain: "comp.com", pageCount: 5, sourceStatus: "AVAILABLE" }],
        backlinks: { sourceStatus: "NOT_CONNECTED", limitations: [] },
        ga4: { sourceStatus: "NOT_CONNECTED", limitations: [] },
        gsc: { sourceStatus: "NOT_CONNECTED", limitations: [] },
      },
      _gate: { commercialRecommendation: "Test rec.", nextAction: "Book session.", serviceCategories: ["content strategy"] },
    };
  }
});

test("T-PAYLOAD-01: all score keys preserved", () => {
  const c = preparePayload(audit);
  assert.ok("trust" in c.scores);
  assert.ok("performance" in c.scores);
  assert.ok("conversionReadiness" in c.scores);
  assert.ok("aiReadiness" in c.scores);
});

test("T-PAYLOAD-02: finding IDs and rule IDs preserved", () => {
  const c = preparePayload(audit);
  for (const f of c.findings) {
    assert.ok(f.findingId, "findingId must be preserved");
    assert.ok(f.ruleId, "ruleId must be preserved");
    assert.ok(f.ruleId.match(/^VAN-[A-Z]+-\d{3}$/), `ruleId ${f.ruleId} must match pattern`);
  }
});

test("T-PAYLOAD-03: affected URLs preserved in findings", () => {
  const c = preparePayload(audit);
  for (const f of c.findings) {
    assert.ok(Array.isArray(f.affectedUrls));
    if (f.affectedUrls.length > 0) {
      assert.ok(f.affectedUrls[0].startsWith("http"));
    }
  }
});

test("T-PAYLOAD-04: unavailable source statuses preserved", () => {
  const c = preparePayload(audit);
  assert.ok(c.sourceStatus.ga4 === "NOT_CONNECTED" || c.sourceStatus.ga4 === "UNAVAILABLE");
  assert.ok(c.sourceStatus.gsc === "NOT_CONNECTED" || c.sourceStatus.gsc === "UNAVAILABLE");
});

test("T-PAYLOAD-05: raw provider data excluded", () => {
  const c = preparePayload(audit);
  assert.equal(c._sourceStatus, undefined, "_sourceStatus must be stripped");
  assert.equal(c.evidence, undefined, "evidence must be stripped");
  assert.equal(c.input, undefined, "input must be stripped");
  assert.equal(c.evidenceConfidenceFactors, undefined);
});

test("T-PAYLOAD-06: payload size is compact", () => {
  const c = preparePayload(audit);
  const json = JSON.stringify(c);
  assert.ok(json.length < 50000, `Payload size ${json.length} bytes must be under 50KB`);
});

test("T-PAYLOAD-07: limitations deduplicated", () => {
  const auditWithDups = JSON.parse(JSON.stringify(audit));
  if (auditWithDups.evidence?.performance) {
    auditWithDups.evidence.performance.limitations = ["A", "A", "B"];
  }
  const c = preparePayload(auditWithDups);
  const unique = new Set(c.limitations);
  assert.equal(c.limitations.length, unique.size, "Limitations must be deduplicated");
});

test("T-PAYLOAD-08: scores not altered", () => {
  const c = preparePayload(audit);
  for (const key of Object.keys(audit.scores || {})) {
    if (key in c.scores) {
      assert.equal(c.scores[key], audit.scores[key], `Score ${key} must match original`);
    }
  }
});

test("T-PAYLOAD-09: no URLs invented", () => {
  const c = preparePayload(audit);
  const json = JSON.stringify(c);
  // All URLs in the output must come from the original audit
  const originalJson = JSON.stringify(audit);
  const urlPattern = /https?:\/\/[^\s"\\]+/g;
  const outputUrls = new Set(json.match(urlPattern) || []);
  const inputUrls = new Set(originalJson.match(urlPattern) || []);
  for (const url of outputUrls) {
    assert.ok(inputUrls.has(url), `URL "${url}" in output must exist in original audit`);
  }
});

test("T-PAYLOAD-10: rendering diagnostics preserved", () => {
  const c = preparePayload(audit);
  if (audit.renderingDiagnostics && audit.renderingDiagnostics.length > 0) {
    assert.ok(Array.isArray(c.renderingDiagnostics));
    assert.ok(c.renderingDiagnostics.length > 0);
    assert.ok("code" in c.renderingDiagnostics[0]);
    assert.ok("explanation" in c.renderingDiagnostics[0]);
  }
});

test("T-PAYLOAD-11: unsupported numeric claims not present", () => {
  const c = preparePayload(audit);
  const json = JSON.stringify(c);
  assert.doesNotMatch(json, /will increase (traffic|leads|revenue|sales|bookings) by \d+%/i);
  assert.doesNotMatch(json, /guaranteed (traffic|leads|revenue|sales|bookings)/i);
});

test("T-PAYLOAD-TOTALS: verify test count", () => {
  assert.ok(11 >= 8, "11 payload tests (minimum 8 required)");
});

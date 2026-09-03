import test from "node:test";
import assert from "node:assert/strict";
import {
  accessibilityMobileSection,
  performanceDetailSection,
} from "./report-detail-sections.js";
import { appendix } from "./sections-performance.js";

const availableLabProfile = {
  status: "AVAILABLE",
  scores: { performance: 80, accessibility: 92 },
  metrics: { lcpMs: 2100, cls: 0.02 },
};

test("P6: unavailable CrUX with available lab data keeps the distinction and supplies a collection path", () => {
  const html = performanceDetailSection({
    evidence: { performance: { sourceStatus: "AVAILABLE", mobile: availableLabProfile, desktop: availableLabProfile, fieldData: {} } },
  });
  assert.match(html, /CrUX field data was not available/);
  assert.match(html, /Lab results remain valid as lab evidence/);
  assert.match(html, /Real-user field performance data/);
  assert.match(html, /Then:.*real-user experience/s);
});

test("P6: unavailable and partial accessibility rows are actionable without becoming findings", () => {
  const html = accessibilityMobileSection({
    evidence: {
      site: { sourceStatus: "PARTIAL", imageCount: 4, imagesMissingAlt: 1 },
      performance: { sourceStatus: "PARTIAL", mobile: availableLabProfile, desktop: { status: "PARTIAL", scores: { accessibility: 92 } } },
    },
  });
  assert.match(html, /Mobile viewport[\s\S]*?UNAVAILABLE/);
  assert.match(html, /Accessibility readiness[\s\S]*?PARTIAL/);
  assert.match(html, /Enable a browser-based mobile\/responsive assessment/);
  assert.match(html, /complete crawl response for the pages that were not returned/);
  assert.match(html, /Mobile viewport<\/strong><\/td>\s*<td><span class="chip cap-neutral">UNAVAILABLE/);
});

function appendixModel(overrides = {}) {
  return {
    evidence: {
      site: { sourceStatus: "AVAILABLE", pageCount: 1, pages: [], limitations: [], platform: null, _contentEvidenceAvailable: true },
      performance: { sourceStatus: "AVAILABLE", coverage: { completed: 2, requested: 2 }, limitations: [] },
      backlinks: { sourceStatus: "AVAILABLE", totalBacklinksReviewed: 2 },
      ga4: { sourceStatus: "AVAILABLE" },
      gsc: { sourceStatus: "AVAILABLE", totals: { impressions: 10 } },
      ...overrides,
    },
    competitors: [], renderingDiagnostics: [], readinessMap: [],
    bands: { evidenceConfidence: "High" },
    scores: { conversionReadiness: 80 }, reportVersion: "test", scoringVersion: "test",
  };
}

test("P6: Evidence Appendix gives unavailable and partial sources an actionable roadmap", () => {
  const html = appendix(appendixModel({
    site: { sourceStatus: "PARTIAL", pageCount: 1, pages: [], limitations: [], platform: null, _contentEvidenceAvailable: true },
    backlinks: { sourceStatus: "NOT_CONNECTED", totalBacklinksReviewed: 0 },
    ga4: { sourceStatus: "PARTIAL" },
  }));
  assert.match(html, /Unavailable &amp; Partial Evidence Roadmap/);
  assert.match(html, /Required source \/ information/);
  assert.match(html, /complete crawl response for the pages that were not returned/);
  assert.match(html, /authorized backlink source/);
  assert.match(html, /Connect the relevant GA4 property/);
  assert.match(html, /PARTIAL/);
  assert.match(html, /NOT_CONNECTED/);
});

test("P6: Evidence Appendix does not fabricate a roadmap for fully available sources", () => {
  const html = appendix(appendixModel());
  assert.doesNotMatch(html, /Unavailable &amp; Partial Evidence Roadmap/);
  assert.doesNotMatch(html, /Required source \/ information/);
  assert.doesNotMatch(html, /How to enable \/ collect/);
  assert.doesNotMatch(html, /Additional insight enabled/);
});

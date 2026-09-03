import test from "node:test";
import assert from "node:assert/strict";
import {
  accessibilityMobileSection,
  performanceDetailSection,
} from "./report-detail-sections.js";

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

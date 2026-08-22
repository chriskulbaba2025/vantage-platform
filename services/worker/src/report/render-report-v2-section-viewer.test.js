import test from "node:test";
import assert from "node:assert/strict";

import { scoreAudit } from "../scoring/vantage-score.js";
import {
  renderReportV2,
  REPORT_V2_VIEWER_PAGES,
  REPORT_V2_VIEWER_VERSION,
} from "./render-report-v2.js";

const FIXED_TS = "2026-01-15T12:00:00.000Z";
const INPUT = {
  targetUrl: "https://x.com",
  businessName: "Example Business",
  competitors: [],
  services: ["Coaching"],
  primaryGoal: "Book consultations",
};

function evidence() {
  return {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: {
      sourceStatus: "AVAILABLE",
      targetUrl: "https://x.com/",
      domain: "x.com",
      pageCount: 2,
      pages: [{ title: "Home", headings: { h1: ["Home"], h2: [], h3: [], h4: [] }, responseHeaders: {} }],
      services: ["Coaching"],
      topicKeywords: ["coaching support"],
      ctas: [{ text: "Book", url: "https://x.com/book", kind: "link" }],
      externalCtas: [],
      forms: [{ action: "/submit" }],
      schemaTypes: ["Organization"],
      microdataTypes: [],
      socialLinks: [],
      trust: {
        testimonials: false,
        credentials: true,
        caseStudies: false,
        faq: false,
        pricing: false,
        policies: true,
        contact: true,
      },
      securityHeaders: {
        xFrameOptions: true,
        xContentTypeOptions: true,
        referrerPolicy: true,
        contentSecurityPolicy: true,
      },
      totalWords: 800,
      averageWords: 400,
      missingTitles: 0,
      missingDescriptions: 0,
      missingCanonicals: 0,
      h1Missing: 0,
      h1Multiple: 0,
      imageCount: 2,
      imagesMissingAlt: 1,
      internalLinkCount: 2,
      brokenInternalLinks: [],
      statusCounts: {},
      limitations: [],
      collectedAt: FIXED_TS,
      coverage: { requested: 2, completed: 2, failed: 0 },
      _contentEvidenceAvailable: true,
      _responseHeadersAvailable: true,
      _metaFieldAvailability: {
        titles: true,
        descriptions: true,
        canonicals: true,
        headings: true,
      },
    },
    performance: {
      sourceStatus: "AVAILABLE",
      provider: "pagespeed-insights",
      mobile: {
        status: "AVAILABLE",
        source: "psi",
        scores: { performance: 60 },
        metrics: {},
      },
      desktop: {
        status: "AVAILABLE",
        source: "psi",
        scores: { performance: 90 },
        metrics: {},
      },
      fieldData: {},
      limitations: [],
      collectedAt: FIXED_TS,
      coverage: { requested: 2, completed: 2, failed: 0 },
    },
    competitors: null,
    backlinks: null,
    ga4: null,
    gsc: null,
  };
}

function model() {
  return scoreAudit(INPUT, evidence());
}

const EXPECTED_PAGES = [
  "Executive Scorecard",
  "Priority Fixes",
  "Conversion Path Architecture",
  "Conversion Readiness Map",
  "Topical Map & Qualified Content Opportunities",
  "Competitor Benchmark",
  "Trust & E-E-A-T Readiness",
  "CMS & Platform Constraints",
  "Technical SEO Hygiene",
  "Heading & Semantic Structure",
  "Schema & Entity Clarity",
  "Performance",
  "Accessibility & Mobile Usability Readiness",
  "Internal-Link Opportunities",
  "Evidence Appendix",
  "Deferred & Unavailable Analysis",
];

const EXPECTED_SECTION_IDS = [
  "executive",
  "strengths",
  "blockers",
  "foundations",
  "action-plan",
  "paths",
  "pillars",
  "content-ideas",
  "competitors",
  "eeat",
  "cms",
  "technical",
  "headings",
  "schema",
  "machine-readiness",
  "performance",
  "accessibility-mobile",
  "internal-links",
  "evidence",
  "phase2",
];

test("PRYSM-V2-SECTION-VIEWER-02: viewer is versioned and has exactly 16 governed pages", () => {
  assert.equal(REPORT_V2_VIEWER_VERSION, "2.2.0");
  assert.equal(REPORT_V2_VIEWER_PAGES.length, 16);
  assert.deepEqual(
    REPORT_V2_VIEWER_PAGES.map((page) => page.title),
    EXPECTED_PAGES,
  );
});

test("PRYSM-V2-SECTION-VIEWER-02: every existing top-level report section is assigned once", () => {
  const sectionIds = REPORT_V2_VIEWER_PAGES.flatMap(
    (page) => [...page.sectionIds],
  );

  assert.equal(sectionIds.length, EXPECTED_SECTION_IDS.length);

  assert.equal(
    new Set(sectionIds).size,
    sectionIds.length,
    "no report section may be assigned to two viewer pages",
  );

  assert.deepEqual(
    [...sectionIds].sort(),
    [...EXPECTED_SECTION_IDS].sort(),
  );
});

test("PRYSM-V2-SECTION-VIEWER-02: accessibility and mobile usability is a standalone governed page", () => {
  const page = REPORT_V2_VIEWER_PAGES.find(
    (item) => item.pageId === "accessibility-mobile",
  );

  assert.deepEqual(page, {
    pageId: "accessibility-mobile",
    title: "Accessibility & Mobile Usability Readiness",
    sectionIds: ["accessibility-mobile"],
  });
});
test("PRYSM-V2-SECTION-VIEWER-02: rendered report has left sticky navigation and one link per page", () => {
  const html = renderReportV2(model());

  assert.equal(
    (html.match(/data-viewer-page=/g) || []).length,
    16,
  );

  assert.match(
    html,
    /class="viewer-sidebar no-print" aria-label="Report sections"/,
  );

  assert.match(
    html,
    /\.viewer-sidebar \{[^}]*position:sticky;[^}]*overflow-y:auto;/,
  );

  assert.match(
    html,
    /grid-template-columns:280px minmax\(0,1fr\)/,
  );

  assert.match(
    html,
    /viewer-nav-link\[aria-current='page'\]/,
  );
});

test("PRYSM-V2-SECTION-VIEWER-02: hash navigation is deterministic and invalid hashes fall back safely", () => {
  const html = renderReportV2(model());

  assert.match(
    html,
    /const fallback = pages\[0\]/,
  );

  assert.match(
    html,
    /return byId\.get\(requested\) \|\| fallback/,
  );

  assert.match(
    html,
    /history\.replaceState\(null, "", "#" \+ page\.pageId\)/,
  );

  assert.match(
    html,
    /link\.setAttribute\("aria-current", "page"\)/,
  );

  assert.match(
    html,
    /classList\.toggle\("viewer-active", activeIds\.has\(id\)\)/,
  );
});

test("PRYSM-V2-SECTION-VIEWER-02: current page has browser print/PDF control and print isolation", () => {
  const html = renderReportV2(model());

  assert.match(
    html,
    />Print or save this page as PDF<\/button>/,
  );

  assert.match(
    html,
    /onclick="window\.print\(\)"/,
  );

  assert.match(
    html,
    /body\.viewer-ready main > section:not\(\.viewer-active\)/,
  );

  assert.match(
    html,
    /body\.viewer-ready main > section\.viewer-active \{ display:block !important; \}/,
  );

  assert.match(
    html,
    /\.nav-jump, \.no-print \{ display:none !important; \}/,
  );
});

test("PRYSM-V2-SECTION-VIEWER-02: viewer remains accessible and keeps navigation on the left", () => {
  const html = renderReportV2(model());

  assert.match(
    html,
    /<main id="reportContent" tabindex="-1">/,
  );

  assert.match(
    html,
    /aria-label="Print or save this page as PDF"/,
  );

  assert.match(
    html,
    /@media \(max-width:\s*900px\)/,
  );

  assert.match(
    html,
    /grid-template-columns:220px minmax\(0,1fr\)/,
  );

  assert.match(
    html,
    /\.viewer-nav \{\s*flex-direction:column;\s*overflow:visible;/,
  );
});

test("PRYSM-V2-SECTION-VIEWER-02: all governed section content remains in the single artifact", () => {
  const html = renderReportV2(model());

  for (const sectionId of EXPECTED_SECTION_IDS) {
    assert.ok(
      html.includes(`id="${sectionId}"`),
      `section ${sectionId} remains rendered`,
    );
  }

  assert.match(
    html,
    /data-report-design="2\.0\.0"/,
  );

  assert.match(
    html,
    /data-viewer-version="2\.2\.0"/,
  );
});

test("PRYSM-V2-SECTION-VIEWER-02: identical inputs still render byte-identically", () => {
  const m = model();

  assert.equal(
    renderReportV2(m),
    renderReportV2(m),
  );
});
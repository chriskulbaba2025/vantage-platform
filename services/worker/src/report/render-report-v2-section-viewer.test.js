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

const EXPECTED_PRIMARY_PAGES = [
  "Executive Scorecard", "Priority Fixes", "Conversion Journey",
  "Content Opportunities", "Competitor Comparison", "Trust & Credibility",
];

const EXPECTED_SUPPORTING_PAGES = [
  "Supporting Detail",
];

const EXPECTED_SECTION_IDS = [
  "executive",
  "blockers",
  "foundations",
  "action-plan",
  "paths",
  "pillars",
  "content-ideas",
  "content-opportunities-detail",
  "competitor-detail",
  "eeat-detail",
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

test("PRYSM-V2-SECTION-VIEWER-03: viewer keeps six peer destinations and one supporting destination", () => {
  assert.equal(REPORT_V2_VIEWER_VERSION, "2.3.0");
  assert.equal(REPORT_V2_VIEWER_PAGES.length, 7);
  assert.deepEqual(
    REPORT_V2_VIEWER_PAGES.filter((page) => page.tier === "PRIMARY").map((page) => page.title),
    EXPECTED_PRIMARY_PAGES,
  );
  assert.deepEqual(
    REPORT_V2_VIEWER_PAGES.filter((page) => page.tier === "SUPPORTING").map((page) => page.title),
    EXPECTED_SUPPORTING_PAGES,
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

test("PRYSM-V2-SECTION-VIEWER-03: supporting detail contains technical and evidence sections", () => {
  const page = REPORT_V2_VIEWER_PAGES.find(
    (item) => item.pageId === "supporting-detail",
  );

  assert.deepEqual(page, {
    pageId: "supporting-detail",
    title: "Supporting Detail",
    tier: "SUPPORTING",
    sectionIds: [
      "pillars",
      "foundations",
      "action-plan",
      "content-opportunities-detail",
      "competitor-detail",
      "eeat-detail",
      "performance",
      "accessibility-mobile",
      "cms",
      "technical",
      "headings",
      "schema",
      "machine-readiness",
      "internal-links",
      "evidence",
      "phase2",
    ],
  });
});

test("S02: Priority Fixes owns only the authoritative blockers sequence", () => {
  const priority = REPORT_V2_VIEWER_PAGES.find((item) => item.pageId === "priority-fixes");
  const supporting = REPORT_V2_VIEWER_PAGES.find((item) => item.pageId === "supporting-detail");
  assert.deepEqual(priority.sectionIds, ["blockers"]);
  assert.ok(supporting.sectionIds.includes("foundations"));
  assert.ok(supporting.sectionIds.includes("action-plan"));
});
test("PRYSM-V2-SECTION-VIEWER-03: rendered report has six peer links and one reachable subordinate link", () => {
  const html = renderReportV2(model());

  assert.equal(
    (html.match(/class="viewer-nav-link viewer-nav-primary"/g) || []).length,
    6,
  );
  assert.equal((html.match(/class="viewer-nav-link viewer-nav-supporting"/g) || []).length, 1);
  assert.match(html, />Supporting Detail<\/span>/);
  for (const page of REPORT_V2_VIEWER_PAGES) assert.match(html, new RegExp(`data-viewer-page="${page.pageId}"`));

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

test("SUPPORTING-DETAIL-IA-01: Supporting Detail has a subordinate treatment and grouped local navigation", () => {
  const html = renderReportV2(model());

  assert.match(html, /class="viewer-supporting-nav"/);
  assert.match(html, /data-supporting-detail-nav/);
  assert.match(html, /Readiness Overview/);
  assert.match(html, /Foundations/);
  assert.match(html, /Conversion &amp; Content Evidence/);
  assert.match(html, /Competitive &amp; Trust Evidence/);
  assert.match(html, /Search &amp; Technical Evidence/);
  assert.match(html, /Performance &amp; Accessibility/);
  assert.match(html, /Platform &amp; Internal Links/);
  assert.match(html, /Evidence &amp; Limitations/);
  assert.match(html, /id="supporting-detail-orientation"/);
  assert.doesNotMatch(html, />07<|Page 7/i);
});

test("PRYSM-V2-SECTION-VIEWER-02: hash navigation is deterministic and invalid hashes fall back safely", () => {
  const html = renderReportV2(model());

  assert.match(
    html,
    /const fallback = pages\[0\]/,
  );

  assert.match(
    html,
    /const ownerPageId = sectionOwners\.get\(requested\)/,
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

test("SUPPORTING-DETAIL-NAV-01: all local Supporting Detail hashes stay on Supporting Detail", () => {
  const html = renderReportV2(model());
  const targets = [
    "pillars",
    "foundations",
    "content-opportunities-detail",
    "competitor-detail",
    "technical",
    "performance",
    "cms",
    "phase2",
  ];

  for (const target of targets) {
    assert.match(html, new RegExp(`href="#${target}"`));
    assert.match(html, new RegExp(`"${target}"`));
  }

  assert.match(html, /const sectionOwners = new Map\(/);
  assert.match(html, /const ownerPageId = sectionOwners\.get\(requested\)/);
  assert.match(html, /return \{ page: byId\.get\(ownerPageId\), targetId: requested \}/);
  assert.match(html, /if \(!route\.targetId &&/);
  assert.match(html, /target\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.doesNotMatch(html, /route\.targetId[\s\S]{0,300}#executive-scorecard/);
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
    /data-viewer-version="2\.3\.0"/,
  );
});

test("PRYSM-V2-SECTION-VIEWER-02: identical inputs still render byte-identically", () => {
  const m = model();

  assert.equal(
    renderReportV2(m),
    renderReportV2(m),
  );
});

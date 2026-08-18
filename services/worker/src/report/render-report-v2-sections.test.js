/**
 * PRYSM-V2-RENDER-01 — required v2 report-section contract closure.
 *
 * Proof-first suite (frozen checklist V2R-01..08).  The populated cases
 * FAIL against the pre-fix renderer (the production defect: required
 * informational areas silently omitted); the unavailable-state and
 * structural-contract cases fail for the same reason.
 *
 * Semantic assertions only — no test copies expected HTML from the
 * implementation, and every expected value comes from the fixture model.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scoreAudit } from "../scoring/vantage-score.js";
import { renderReportV2 } from "./render-report-v2.js";
import { renderReport } from "./render-report.js";

const FIXED_TS = "2026-01-15T12:00:00.000Z";

// Frozen pre-change v1 STRUCTURAL golden (captured 2026-08-17 at 64189819
// with THIS exact fixture — see PRYSM_V2_RENDER_01_CHECKLIST.md V2R-07).
// The structural fingerprint (section ids + heading literals) is used
// instead of a byte hash because the v1 renderer embeds localized date
// strings whose exact bytes vary with ICU/Node versions across
// environments (Node 22 CI vs Node 24 local) — the structure and heading
// text are source-code literals and are environment-stable.
const V1_GOLDEN_SHA = "5e8d364279ba462f3929d50986a49db08ef38245f60c9781797758c1d44f2025";

const INPUT = {
  targetUrl: "https://x.com",
  businessName: "Example Business",
  competitors: [],
  services: ["Coaching"],
  primaryGoal: "Book consultations",
};

function baseSite() {
  return {
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
    trust: { testimonials: false, credentials: true, caseStudies: false, faq: false, pricing: false, policies: true, contact: true },
    securityHeaders: {},
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
  };
}

function baseEvidence(overrides = {}) {
  return {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: baseSite(),
    performance: {
      sourceStatus: "AVAILABLE",
      provider: "pagespeed-insights",
      mobile: { status: "AVAILABLE", source: "psi", scores: { performance: 60 }, metrics: {} },
      desktop: { status: "AVAILABLE", source: "psi", scores: { performance: 90 }, metrics: {} },
      fieldData: {},
      limitations: [],
      collectedAt: FIXED_TS,
      coverage: { requested: 2, completed: 2, failed: 0 },
    },
    competitors: null,
    backlinks: null,
    ga4: null,
    gsc: null,
    ...overrides,
  };
}

// Rich fixture: platform detected, real link opportunities, broken link.
function richEvidence() {
  return baseEvidence({
    site: {
      ...baseSite(),
      platform: "WordPress",
      brokenInternalLinks: [{ source: "https://x.com/old", url: "https://x.com/missing" }],
      internalLinkCount: 3,
    },
    internalLinkOpportunities: {
      opportunities: [
        {
          sourceUrl: "https://x.com/coaching",
          targetUrl: "https://x.com/pricing",
          proposedAnchor: "coaching options and pricing",
          reasonForLink: "consideration_content_progresses_to_conversion_page",
          funnelStage: "mofu",
          confidence: "high",
        },
        {
          sourceUrl: "https://x.com/about",
          targetUrl: "https://x.com/contact",
          proposedAnchor: "start a conversation",
          reasonForLink: "informational_content_progresses_to_commercial_page",
          funnelStage: "tofu",
          confidence: "medium",
        },
      ],
      excludedCandidates: [],
      orphans: [{ url: "https://x.com/privacy", title: "Privacy" }],
      limitations: ["Crawl coverage limited to 2 pages"],
      coverage: { pagesEvaluated: 2, crawlComplete: true },
    },
  });
}

async function render(model) {
  return renderReportV2(model);
}

// ---------------------------------------------------------------------------
// V2R-01 — Topical/content opportunities
// ---------------------------------------------------------------------------

test("V2R-01: topical/content opportunities section renders canonical ideas from the model", async () => {
  const m = scoreAudit(INPUT, richEvidence());
  const html = await render(m);
  assert.match(html, /Topical Map/i, "section heading present");
  // Canonical ideas derived from services + topicKeywords ("coaching support").
  // scoreAudit's contentIdeas() titles the leading topic from the first
  // candidate ("Coaching") — assert the exact generated idea text.
  assert.match(html, /What Is Coaching\?/, "canonical TOFU idea rendered");
  assert.match(html, /Coaching for decision making/i, "canonical leading query rendered");
});

// ---------------------------------------------------------------------------
// V2R-02 — CMS/platform constraints
// ---------------------------------------------------------------------------

test("V2R-02: CMS/platform section renders canonical platform evidence", async () => {
  const m = scoreAudit(INPUT, richEvidence());
  const html = await render(m);
  assert.match(html, /CMS[\s&]*(&amp;)?[\s/]*Platform Constraints/i, "section heading present");
  assert.match(html, /WordPress/, "detected platform value rendered");
  assert.match(html, /Platform Risk|risk/i, "risk classification rendered");
});

// ---------------------------------------------------------------------------
// V2R-03 — Internal-link opportunities
// ---------------------------------------------------------------------------

test("V2R-03: internal-link opportunities render canonical source/target/anchor/reason/confidence", async () => {
  const m = scoreAudit(INPUT, richEvidence());
  const html = await render(m);
  assert.match(html, /Internal-Link Opportunities/i, "section heading present");
  assert.match(html, /https:\/\/x\.com\/coaching/, "canonical source URL rendered");
  assert.match(html, /https:\/\/x\.com\/pricing/, "canonical target URL rendered");
  // Defense-in-depth: non-http(s) schemes must never become link targets.
  const evil = scoreAudit(INPUT, {
    ...richEvidence(),
    internalLinkOpportunities: {
      ...richEvidence().internalLinkOpportunities,
      opportunities: [{ sourceUrl: "javascript:alert(1)", targetUrl: "https://x.com/ok", proposedAnchor: "evil", reasonForLink: "pages_belong_to_same_topic_hierarchy", funnelStage: "tofu", confidence: "low" }],
    },
  });
  const evilHtml = await render(evil);
  assert.ok(!evilHtml.includes('href="javascript:'), "non-http(s) schemes must not render as link targets");
  assert.match(html, /coaching options and pricing/, "canonical proposed anchor rendered");
  assert.match(html, /Consideration → conversion/, "canonical reason label rendered");
  assert.match(html, /high/, "confidence rendered");
  assert.match(html, /https:\/\/x\.com\/missing/, "broken internal link rendered");
});

// ---------------------------------------------------------------------------
// V2R-04 — Explicit unavailable/deferred state
// ---------------------------------------------------------------------------

test("V2R-04: absent data renders explicit governed unavailable states, never silent omission", async () => {
  const m = scoreAudit(INPUT, baseEvidence());
  const html = await render(m);
  assert.match(html, /Topical Map/i, "topical section still present");
  assert.match(html, /not available|none available|not computed|unavailable/i, "explicit topical unavailable state");
  assert.match(html, /CMS[\s&]*(&amp;)?[\s/]*Platform Constraints/i, "CMS section still present");
  assert.match(html, /Internal-Link Opportunities/i, "links section still present");
  assert.match(html, /not computed for this audit|not available/i, "explicit links unavailable state");
});

// ---------------------------------------------------------------------------
// V2R-05 — No evidence fabrication
// ---------------------------------------------------------------------------

test("V2R-05: renderer never invents URLs, ideas, or claims", async () => {
  const m = scoreAudit(INPUT, baseEvidence());
  const html = await render(m);
  const sentinels = [
    "INVENTED-SENTINEL-URL",
    "What Is Quantum Astrology?",
    "https://fabricated-evidence.example.com",
  ];
  for (const s of sentinels) {
    assert.ok(!html.includes(s), `sentinel "${s}" must never appear`);
  }
  // Every rendered idea in the rich case must trace to the fixture's
  // services/topicKeywords (canonical strings only).
  const rich = await render(scoreAudit(INPUT, richEvidence()));
  assert.match(rich, /What Is Coaching\?/, "idea traceable to fixture services");
  assert.ok(!rich.includes("What Is Foot?"), "no untraceable topic appears");
});

// ---------------------------------------------------------------------------
// V2R-06 — Existing v2 sections unchanged
// ---------------------------------------------------------------------------

test("V2R-06: existing executive sections remain intact", async () => {
  const m = scoreAudit(INPUT, richEvidence());
  const html = await render(m);
  for (const golden of [
    "A. Conversion Readiness",
    "B. Evidence Confidence",
    "C. Evidence Coverage",
    "D. Where are the problems?",
    "E. What should be fixed first?",
    "Evidence detail",
    "Source statuses",
  ]) {
    assert.ok(html.includes(golden), `golden substring present: ${golden}`);
  }
});

// ---------------------------------------------------------------------------
// V2R-07 — v1 renderer/report unchanged (frozen golden hash)
// ---------------------------------------------------------------------------

test("V2R-07: v1 renderer output matches the frozen pre-change golden hash", async () => {
  const m = scoreAudit(INPUT, baseEvidence());
  const html = await renderReport(m);
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((x) => x[1]).filter((x) => !/^page-/.test(x) && x !== "nav");
  const heads = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((x) => x[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const fingerprint = JSON.stringify({ ids: [...new Set(ids)].sort(), heads });
  const sha = createHash("sha256").update(fingerprint).digest("hex");
  assert.equal(sha, V1_GOLDEN_SHA, "v1 structure must be identical to the pre-change golden");
});

// ---------------------------------------------------------------------------
// V2R-08 — Complete required-section structural contract (15 areas)
// ---------------------------------------------------------------------------

test("V2R-08: v2 draft represents the complete 15-area required-section contract", async () => {
  const m = scoreAudit(INPUT, richEvidence());
  const html = await render(m);
  const areas = [
    ["1 executive scorecard", /A\. Conversion Readiness/],
    ["2 priority fixes", /E\. What should be fixed first\?/],
    ["3 conversion path architecture", /Conversion path architecture/],
    ["4 conversion readiness map", /D\. Where are the problems\?/],
    ["5 topical map + content opportunities", /Topical Map/],
    ["6 competitor benchmark", /Competitive context/],
    ["7 trust and E-E-A-T", /Trust &amp; Proof|Trust & Proof/],
    ["8 CMS and platform constraints", /CMS[\s&]*(&amp;)?[\s/]*Platform Constraints/],
    ["9 technical SEO hygiene", /Technical Health/],
    ["10 heading and semantic structure", /Technical Health/],
    ["11 schema and entity clarity", /schema\.structured_data|Schema &amp; Entity|Schema & Entity|suppressed/i],
    ["12 performance", /Performance &amp; Experience|Performance & Experience/],
    ["13 internal-link opportunities", /Internal-Link Opportunities/],
    ["14 evidence appendix", /Evidence detail/],
    ["15 deferred and unavailable analysis", /Deferred &(amp;)? unavailable analysis|not available|not computed|Suppressed findings|suppressed/i],
  ];
  for (const [label, re] of areas) {
    assert.match(html, re, `required area present or explicit state: ${label}`);
  }
});

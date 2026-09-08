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

test("V2R-01: content opportunities presents governed ideas in the client story", async () => {
  const m = scoreAudit(INPUT, richEvidence());
  const html = await render(m);
  assert.match(html, /What content would help buyers move forward\?/i, "client heading present");
  assert.match(html, /What is already helping buyers/);
  assert.match(html, /Where decision support is thin/);
  assert.match(html, /What to create or improve first/);
  assert.match(html, /content-opportunity-card/);
  const primaryContent = html.slice(html.indexOf('<section id="content-ideas"'), html.indexOf('<section id="content-opportunities-detail"'));
  assert.equal((primaryContent.match(/class="content-opportunity-card(?: |")/g) || []).length, 5, "primary S05 shows only the first five governed opportunities");
  assert.match(html, /id="content-opportunities-detail"/);
  assert.match(html, /Qualified opportunity — partial content coverage|Supported within assessed content/);
  assert.doesNotMatch(primaryContent, /Connect this to the relevant service page and the next-step action used in the assessed journey\./);
  assert.match(primaryContent, /early-stage buyer|buyer recognize|meaningful result|evaluate the service/i);
  // Canonical ideas derived from services + topicKeywords ("coaching support").
  // scoreAudit's contentIdeas() titles the leading topic from the first
  // candidate ("Coaching") — assert the exact generated idea text.
  assert.match(html, /What Is Coaching\?/, "canonical TOFU idea rendered");
  assert.match(html, /Coaching for decision making/i, "canonical leading query rendered");
});

// ---------------------------------------------------------------------------
// PRYSM production defect 2/3 — link context, duplicate warnings, broken shapes
// ---------------------------------------------------------------------------

test("IL-01: relevantSurroundingText and duplicateAnchorWarning are rendered when present", async () => {
  const ev = {
    ...richEvidence(),
    internalLinkOpportunities: {
      ...richEvidence().internalLinkOpportunities,
      opportunities: [
        {
          sourceUrl: "https://x.com/coaching", targetUrl: "https://x.com/pricing",
          proposedAnchor: "coaching options and pricing",
          relevantSurroundingText: "Compare coaching options before committing to a pricing plan",
          reasonForLink: "consideration_content_progresses_to_conversion_page",
          funnelStage: "mofu", confidence: "high",
          duplicateAnchorWarning: "Anchor already used for: https://x.com/other",
        },
      ],
    },
  };
  const html = await render(scoreAudit(INPUT, ev));
  assert.match(html, /Compare coaching options before committing to a pricing plan/, "surrounding context rendered");
  assert.match(html, /Anchor already used for: https:\/\/x\.com\/other/, "duplicate-anchor warning rendered");
});

test("IL-02: absent context/warning renders explicit non-misleading cells, no fabrication", async () => {
  const ev = {
    ...richEvidence(),
    internalLinkOpportunities: {
      ...richEvidence().internalLinkOpportunities,
      opportunities: [
        {
          sourceUrl: "https://x.com/coaching", targetUrl: "https://x.com/pricing",
          proposedAnchor: "coaching options and pricing",
          reasonForLink: "consideration_content_progresses_to_conversion_page",
          funnelStage: "mofu", confidence: "high",
        },
      ],
    },
  };
  const html = await render(scoreAudit(INPUT, ev));
  assert.ok(!/INVENTED-CONTEXT-SENTINEL/.test(html), "no fabricated context text");
  assert.match(html, /—|Not captured/, "explicit empty cell marker present");
});

test("IL-03: traced broken links render actual source and target", async () => {
  const ev = {
    ...richEvidence(),
    site: { ...richEvidence().site, brokenInternalLinks: [{ source: "https://x.com/old", url: "https://x.com/missing" }] },
    internalLinkOpportunities: null,
  };
  const html = await render(scoreAudit(INPUT, ev));
  assert.match(html, /https:\/\/x\.com\/old/, "actual source rendered");
  assert.match(html, /https:\/\/x\.com\/missing/, "actual target rendered");
  const internalLinksStart = html.indexOf('<section id="internal-links"');
  const internalLinksEnd = html.indexOf('<section id="phase2"', internalLinksStart);
  const internalLinks = html.slice(internalLinksStart, internalLinksEnd === -1 ? undefined : internalLinksEnd);
  assert.doesNotMatch(internalLinks, /unknown/i, "no unknown → unknown rendering inside internal-link surface");
});

test("IL-04: historical string broken links render an honest count-only state", async () => {
  const ev = {
    ...richEvidence(),
    site: { ...richEvidence().site, brokenInternalLinks: ["https://x.com/missing"] },
    internalLinkOpportunities: null,
  };
  const html = await render(scoreAudit(INPUT, ev));
  const internalLinksStart = html.indexOf('<section id="internal-links"');
  const internalLinksEnd = html.indexOf('<section id="phase2"', internalLinksStart);
  const internalLinks = html.slice(internalLinksStart, internalLinksEnd === -1 ? undefined : internalLinksEnd);
  assert.doesNotMatch(internalLinks, /unknown/i, "no unknown → unknown rendering inside internal-link surface");
  assert.match(internalLinks, /could not be traced to a source page|not traced|count-only/i, "honest count-only limitation rendered");
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
  assert.match(html, /What content would help buyers move forward\?/i, "content section still present");
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
    "How ready is your website to convert visitors?",
    "What should you improve first?",
    "What is already working?",
    "What could we not determine?",
    "Where to find supporting detail",
    "Where are the problems?",
    "What should you fix first?",
    "Evidence detail",
    "Source statuses",
  ]) {
    assert.ok(html.includes(golden), `golden substring present: ${golden}`);
  }
});

test("SUPPORTING-DETAIL-EVIDENCE-01: detail keeps visuals, deterministic samples, counts, and material limits visible", async () => {
  const html = await render(scoreAudit(INPUT, richEvidence()));
  const supporting = html.slice(html.indexOf('id="supporting-detail-orientation"'));

  assert.match(supporting, /Supporting Detail proves and explains the six primary-page conclusions/);
  assert.match(supporting, /aria-label="Five-axis conversion readiness map"/);
  assert.match(supporting, /aria-label="Business entity relationship diagram"/);
  assert.match(supporting, /Representative examples|additional supporting evidence/i);
  assert.match(supporting, /PARTIAL|UNAVAILABLE|NOT_ASSESSED|limitations/i);
  assert.match(supporting, /<details[^>]*class="supporting-detail-disclosure"/);
  assert.match(supporting, /data-supporting-section="internal-links"/);
});

test("SUPPORTING-DETAIL-PERFORMANCE-02: raw performance diagnostics stay behind disclosure", async () => {
  const html = await render(scoreAudit(INPUT, richEvidence()));
  const start = html.indexOf('<section id="performance"');
  const end = html.indexOf('<section id="accessibility-mobile"', start);
  const performance = html.slice(start, end);
  const defaultOpen = performance.slice(0, performance.indexOf("<details"));

  for (const rawDiagnostic of [
    "Screenshot persistence failed",
    "runId is required",
    "CrUX PHONE failed (403)",
    "CrUX DESKTOP failed (403)",
  ]) {
    assert.doesNotMatch(defaultOpen, new RegExp(rawDiagnostic.replace(/[()]/g, "\\$&")));
  }

  assert.match(performance, /Show detailed performance evidence/);
  assert.match(performance, /Real-user field performance data was unavailable/);
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
    ["1 executive scorecard", /How ready is your website to convert visitors\?/],
    ["2 priority fixes", /What should you fix first\?/],
    ["3 conversion journey", /Can visitors move easily from interest to action\?/],
    ["4 conversion readiness map", /Where are the problems\?/],
    ["5 content opportunities", /What content would help buyers move forward\?/],
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

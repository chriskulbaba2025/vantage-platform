import test from "node:test";
import assert from "node:assert/strict";
import { generateInternalLinkOpportunities, isUtility, isGenAnchor, alreadyLinksTo, sourceAnchor, relationship, funnelStage, confidence, norm } from "./internal-link-opportunity.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

const SITE = {
  domain: "example.com", pageCount: 7, internalLinkCount: 12, brokenInternalLinks: [], services: ["Consulting", "Coaching", "Web Design"],
  coverage: { completed: 7, requested: 7 },
  pages: [
    { url: "https://example.com/", title: "Home — Example", status: 200, headings: { h1: ["Example Consulting"], h2: ["Our Services", "Business Consulting", "Web Design Services"], h3: [] }, links: [{ url: "https://example.com/services/consulting", text: "Consulting" }], words: 500 },
    { url: "https://example.com/services/consulting", title: "Consulting Services", status: 200, headings: { h1: ["Business Consulting"], h2: ["Strategy", "Coaching Integration"], h3: [] }, links: [{ url: "https://example.com/contact", text: "Book a Consultation" }], words: 800 },
    { url: "https://example.com/services/web-design", title: "Custom Web Design", status: 200, headings: { h1: ["Custom Web Design"], h2: [], h3: [] }, links: [], words: 600 },
    { url: "https://example.com/contact", title: "Contact Us", status: 200, headings: { h1: ["Get in Touch"], h2: [], h3: [] }, links: [], words: 200 },
    { url: "https://example.com/blog/consulting-trends", title: "Consulting Trends", status: 200, headings: { h1: ["Consulting Trends"], h2: ["AI in Consulting", "Remote Strategy"], h3: [] }, links: [{ url: "https://example.com/services/consulting", text: "Our Services" }], words: 1200 },
    { url: "https://example.com/privacy", title: "Privacy Policy", status: 200, headings: { h1: ["Privacy Policy"], h2: [], h3: [] }, links: [], words: 100 },
    { url: "https://example.com/services/coaching", title: "Leadership Coaching", status: 200, headings: { h1: ["Leadership Coaching"], h2: ["Executive Coaching", "Team Coaching"], h3: [] }, links: [], words: 700 },
  ],
};
const INPUT = { targetUrl: "https://example.com", businessName: "Example" };

// ── T10-01: verbatim source anchor for every client-facing recommendation ──
test("T10-01: every client-facing anchor exists verbatim in source page headings", () => {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  assert.ok(r.opportunities.length > 0, "Should have client-facing recommendations");
  for (const o of r.opportunities) {
    const src = SITE.pages.find((p) => p.url === o.sourceUrl);
    const allH = [...(src.headings?.h1 || []), ...(src.headings?.h2 || []), ...(src.headings?.h3 || [])];
    assert.ok(allH.includes(o.proposedAnchor), `Anchor "${o.proposedAnchor}" not in source ${o.sourceUrl}: ${allH.join(" | ")}`);
  }
});

// ── T10-02: awareness→consideration (blog→service) ──
test("T10-02: blog page → service target = consideration", () => {
  // Blog NOT already linked to the service it's about
  const site = {
    domain: "x.com", pageCount: 3, services: ["Consulting"], coverage: { completed: 3, requested: 3 },
    pages: [
      { url: "https://x.com/blog/consulting-tips", title: "Consulting Tips", status: 200, headings: { h1: ["Top Consulting Tips"], h2: ["Business Consulting"], h3: [] }, links: [], words: 600 },
      { url: "https://x.com/services/consulting", title: "Business Consulting", status: 200, headings: { h1: ["Business Consulting"], h2: [], h3: [] }, links: [], words: 300 },
      { url: "https://x.com/contact", title: "Contact", status: 200, headings: { h1: ["Get in Touch"], h2: [], h3: [] }, links: [], words: 100 },
    ],
  };
  const r = generateInternalLinkOpportunities(site, { targetUrl: "https://x.com" });
  const blogToSvc = r.allOpportunities.find((o) =>
    o.sourceUrl.includes("/blog/") && o.targetUrl.includes("/services/consulting"),
  );
  assert.ok(blogToSvc, "Blog should link to related service");
  assert.equal(blogToSvc.funnelStage, "consideration");
});

// ── T10-03: consideration→conversion-support (service→contact with target-specific anchor) ──
test("T10-03: service page → contact target with matching anchor = conversion-support", () => {
  // Service page heading mentions "Consulting" and contact heading also mentions it
  const site = {
    domain: "x.com", pageCount: 3, services: ["Consulting"], coverage: { completed: 3, requested: 3 },
    pages: [
      { url: "https://x.com/services/consulting", title: "Consulting Services", status: 200, headings: { h1: ["Business Consulting"], h2: [], h3: [] }, links: [], words: 400 },
      { url: "https://x.com/contact", title: "Contact", status: 200, headings: { h1: ["Consulting Contact"], h2: [], h3: [] }, links: [], words: 200 },
      { url: "https://x.com/", title: "Home", status: 200, headings: { h1: ["Home"], h2: [], h3: [] }, links: [], words: 100 },
    ],
  };
  const r = generateInternalLinkOpportunities(site, { targetUrl: "https://x.com" });
  const svcToContact = r.allOpportunities.find((o) =>
    o.sourceUrl.includes("/services/") && o.targetUrl.includes("/contact"),
  );
  assert.ok(svcToContact, "Service page should recommend linking to contact");
  assert.equal(svcToContact.funnelStage, "conversion-support");
});

// ── T10-05: orphan with complete coverage ──
test("T10-05: orphan detected when crawl coverage is complete", () => {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  const coaching = r.orphans.find((o) => o.url.includes("coaching"));
  assert.ok(coaching, "Coaching page (0 inlinks) should be orphan");
  assert.equal(coaching.incomingLinks, 0);
});

// ── T10-06: already-linked excluded ──
test("T10-06: already-linked pair excluded with reason already_linked", () => {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  const ex = r.excludedCandidates.find((e) => e.reason === "already_linked");
  assert.ok(ex, "Should have already_linked exclusions");
});

// ── T10-07: self-link excluded ──
test("T10-07: self-link excluded with reason self_link", () => {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  const self = r.excludedCandidates.filter((e) => e.reason === "self_link");
  assert.ok(self.length > 0, "Should have self_link exclusions");
});

// ── T10-08: generic_topic_mention excluded ──
test("T10-08: single shared word produces generic_topic_mention exclusion", () => {
  // Two non-blog pages share exactly 1 meaningful word → generic_topic_mention
  const single = {
    domain: "x.com", pageCount: 3, services: ["HVAC"], coverage: { completed: 3, requested: 3 },
    pages: [
      { url: "https://x.com/services/heating", title: "Heating Services", status: 200, headings: { h1: ["Professional Heating"], h2: ["Installation Expertise"], h3: [] }, links: [], words: 300 },
      { url: "https://x.com/services/cooling", title: "Cooling Services", status: 200, headings: { h1: ["Professional Cooling"], h2: [], h3: [] }, links: [], words: 200 },
      { url: "https://x.com/", title: "Home", status: 200, headings: { h1: ["Welcome"], h2: [], h3: [] }, links: [], words: 100 },
    ],
  };
  const r = generateInternalLinkOpportunities(single, { targetUrl: "https://x.com" });
  // "Professional Heating" vs "Professional Cooling" → shared word "Professional" (1 word) → generic_topic_mention
  // (both pages mention "Professional" but the service "HVAC" doesn't match either URL)
  const gtm = r.excludedCandidates.filter((e) => e.reason === "generic_topic_mention");
  assert.ok(gtm.length > 0, `Expected generic_topic_mention, got reasons: ${[...new Set(r.excludedCandidates.map((e) => e.reason))].join(", ")}`);
});

// ── T10-09: page exclusion reasons ──
test("T10-09: failed page excluded with reason failed", () => {
  const s = { ...SITE, pages: [...SITE.pages, { url: "https://x.com/broken", title: "Broken", status: 500, headings: { h1: ["Error"], h2: [], h3: [] }, links: [], words: 10 }], pageCount: 8, coverage: { completed: 8, requested: 8 } };
  const r = generateInternalLinkOpportunities(s, { targetUrl: "https://x.com" });
  const ep = r.excludedPages.filter((e) => e.reason === "failed");
  assert.ok(ep.length > 0, "Failed page should be in excludedPages with reason failed");
});

test("T10-09b: blocked page excluded with reason blocked", () => {
  const s = { ...SITE, pages: [...SITE.pages, { url: "https://x.com/blocked", title: "Blocked", status: 403, headings: { h1: ["Forbidden"], h2: [], h3: [] }, links: [], words: 10 }], pageCount: 8, coverage: { completed: 8, requested: 8 } };
  const r = generateInternalLinkOpportunities(s, { targetUrl: "https://x.com" });
  const blocked = r.excludedPages.filter((e) => e.reason === "blocked");
  assert.ok(blocked.length > 0, "Blocked page should have reason blocked");
});

test("T10-09c: redirected page excluded with reason redirected", () => {
  const s = { ...SITE, pages: [...SITE.pages, { url: "https://x.com/old", title: "Old", status: 301, headings: { h1: ["Redirect"], h2: [], h3: [] }, links: [], words: 10 }], pageCount: 8, coverage: { completed: 8, requested: 8 } };
  const r = generateInternalLinkOpportunities(s, { targetUrl: "https://x.com" });
  const redir = r.excludedPages.filter((e) => e.reason === "redirected");
  assert.ok(redir.length > 0, "Redirected page should have reason redirected");
});

test("T10-09d: external page excluded with reason external", () => {
  const s = { ...SITE, pages: [...SITE.pages, { url: "https://other.com/page", title: "Ext", status: 200, headings: { h1: ["External"], h2: [], h3: [] }, links: [], words: 100 }], pageCount: 8, coverage: { completed: 8, requested: 8 } };
  const r = generateInternalLinkOpportunities(s, { targetUrl: "https://x.com" });
  const ext = r.excludedPages.filter((e) => e.reason === "external");
  assert.ok(ext.length > 0, "External page should have reason external");
});

test("T10-09e: utility page excluded with reason utility_page", () => {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  const util = r.excludedPages.filter((e) => e.reason === "utility_page");
  assert.ok(util.length > 0, "Utility/privacy page should have reason utility_page");
});

// ── T10-11: duplicate anchor ──
test("T10-11: duplicate anchor detected when same anchor targets different pages", () => {
  // Two pages use the same H2 "Consulting" → one targets consulting page, the other targets contact
  const s = { domain: "x.com", pageCount: 4, services: ["Consulting"], coverage: { completed: 4, requested: 4 },
    pages: [
      { url: "https://x.com/", title: "Home", status: 200, headings: { h1: ["Welcome"], h2: ["Consulting"], h3: [] }, links: [], words: 300 },
      { url: "https://x.com/services/consulting", title: "Business Consulting", status: 200, headings: { h1: ["Business Consulting"], h2: [], h3: [] }, links: [], words: 200 },
      { url: "https://x.com/about", title: "About Us", status: 200, headings: { h1: ["About"], h2: ["Consulting"], h3: [] }, links: [], words: 200 },
      { url: "https://x.com/contact", title: "Consulting Contact", status: 200, headings: { h1: ["Consulting Contact"], h2: [], h3: [] }, links: [], words: 100 },
    ],
  };
  const r = generateInternalLinkOpportunities(s, { targetUrl: "https://x.com" });
  // Home → consulting (anchor: "Consulting"), About → consulting (anchor: "Consulting") → both same target = no collision
  // Home → contact (anchor: "Consulting"), About → contact (anchor: "Consulting") → different from above = collision
  const warned = r.opportunities.filter((o) => o.duplicateAnchorWarning);
  assert.ok(warned.length > 0 || r.duplicateAnchorWarnings.length > 0,
    `Expected collision with ${r.opportunities.length} opps, ${warned.length} warned, ${r.duplicateAnchorWarnings.length} top-level`);
});

// ── T10-12: no low-confidence in client-facing ──
test("T10-12: low-confidence excluded from client-facing opportunities", () => {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  for (const o of r.opportunities)
    assert.notEqual(o.confidence, "low", "Client-facing must not include low-confidence");
});

// ── T10-13: incomplete crawl → PARTIAL, no orphans ──
test("T10-13: incomplete crawl sets PARTIAL with no orphans and limitation", () => {
  const partial = { ...SITE, pageCount: 25, coverage: { completed: 7, requested: 25 } };
  const r = generateInternalLinkOpportunities(partial, INPUT);
  assert.equal(r.sourceStatus, SOURCE_STATUS.PARTIAL, "sourceStatus must be PARTIAL");
  assert.equal(r.status, SOURCE_STATUS.PARTIAL, "status must be PARTIAL");
  assert.equal(r.coverage.crawlComplete, false, "crawlComplete must be false");
  assert.equal(r.orphans.length, 0, "No orphans when coverage incomplete");
  assert.ok(r.limitations.some((l) => /incomplete/i.test(l)), "Must have incomplete limitation");
});

// ── T10-14: deterministic ordering ──
test("T10-14: same output regardless of input page order", () => {
  const r1 = generateInternalLinkOpportunities(SITE, INPUT);
  const r2 = generateInternalLinkOpportunities({ ...SITE, pages: [...SITE.pages].reverse() }, INPUT);
  assert.deepStrictEqual(
    r1.opportunities.map((o) => `${norm(o.sourceUrl)}|${norm(o.targetUrl)}`),
    r2.opportunities.map((o) => `${norm(o.sourceUrl)}|${norm(o.targetUrl)}`),
  );
});

// ── T10-15: canonical envelope fields ──
test("T10-15: envelope includes excludedPages with reasons", () => {
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  assert.ok(Array.isArray(r.excludedPages), "Must have excludedPages array");
  assert.ok(r.excludedPages.length > 0, "Must have excluded pages");
  for (const ep of r.excludedPages) {
    assert.ok(ep.url, "Each excluded page must have url");
    assert.ok(ep.reason, "Each excluded page must have reason");
  }
  assert.equal(r.evidenceVersion, "1.0.0");
  assert.ok(r._sourceStatus);
  assert.ok(r.collectedAt);
});

// ── T10-16: insufficient pages → PARTIAL ──
test("T10-16: fewer than 2 valid pages returns PARTIAL with limitation", () => {
  const tiny = { ...SITE, pages: [SITE.pages[0]], pageCount: 1, coverage: { completed: 1, requested: 1 } };
  const r = generateInternalLinkOpportunities(tiny, INPUT);
  assert.equal(r.sourceStatus, SOURCE_STATUS.PARTIAL);
  assert.equal(r.opportunities.length, 0);
});

// ── T10-17: synchronous — no live calls ──
test("T10-17: synchronous — under 50ms", () => {
  const t = Date.now();
  generateInternalLinkOpportunities(SITE, INPUT);
  assert.ok(Date.now() - t < 50);
});

// ── T10-18: target-specific anchor: blog with "Consulting" H2 targets consulting page ──
test("T10-18: target-specific anchor matches target page service", () => {
  const blogPage = SITE.pages.find((p) => p.url.includes("/blog/"));
  const consultingPage = SITE.pages.find((p) => p.url.includes("/services/consulting"));
  const anchor = sourceAnchor(blogPage, consultingPage, SITE.services);
  // Blog H1 is "Consulting Trends", H2 includes "AI in Consulting" → "Consulting" service should match
  assert.ok(anchor, "Blog should have a target-specific anchor for consulting page");
  const blogH = [...(blogPage.headings?.h1 || []), ...(blogPage.headings?.h2 || []), ...(blogPage.headings?.h3 || [])];
  assert.ok(blogH.includes(anchor), `Anchor "${anchor}" must exist in source headings`);
});

// ── T10-19: article must not link to unrelated service ──
test("T10-19: consulting article excludes coaching recommendation without target-specific evidence", () => {
  // Article about consulting trends should not recommend coaching just because it's a service
  const r = generateInternalLinkOpportunities(SITE, INPUT);
  // Blog already links to consulting, and its headings mention "Consulting" not "Coaching"
  // So it should only link to consulting-related targets, not coaching
  const blogToCoaching = r.allOpportunities.find((o) =>
    o.sourceUrl.includes("/blog/") && o.targetUrl.includes("/coaching"),
  );
  // Blog H2 is "AI in Consulting", "Remote Strategy" — no "Coaching" mention → no recommendation
  assert.equal(blogToCoaching, undefined, "Blog should not link to coaching without target-specific evidence");
});

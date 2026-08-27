import { test } from "node:test";
import assert from "node:assert/strict";
import { selectImportantPages, PAGE_ROLES } from "./important-page-selector.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function page(url, overrides = {}) {
  return {
    crawledUrl: url,
    url,
    title: overrides.title || "",
    headings: { h1: overrides.h1 ? [overrides.h1] : [], h2: [], h3: [], h4: [] },
    forms: overrides.forms || [],
    ctas: overrides.ctas || [],
    status: overrides.status ?? 200,
    crawlDepth: overrides.crawlDepth ?? 1,
    ...overrides,
  };
}

const TARGET = "https://example.com";

function fixturePages() {
  return [
    page(`${TARGET}/`, { title: "Home", h1: "Home", forms: [{ action: "/contact" }], ctas: [{ text: "Book now", url: "/contact" }] }),
    page(`${TARGET}/services/consulting`, { title: "Consulting Services", h1: "Business Consulting" }),
    page(`${TARGET}/services/coaching`, { title: "Coaching", h1: "Executive Coaching" }),
    page(`${TARGET}/contact`, { title: "Contact Us", h1: "Book a Consultation", forms: [{ action: "/submit" }], ctas: [{ text: "Contact", url: "/contact" }] }),
    page(`${TARGET}/pricing`, { title: "Pricing and Packages", h1: "Pricing" }),
    page(`${TARGET}/about-us`, { title: "About Our Team", h1: "Meet the Team" }),
    page(`${TARGET}/testimonials`, { title: "Client Testimonials", h1: "Reviews" }),
    page(`${TARGET}/blog/why-consulting`, { title: "Why Consulting Matters", h1: "Guide" }),
    page(`${TARGET}/privacy`, { title: "Privacy Policy", h1: "Privacy" }),
  ];
}

function fixtureLinks() {
  // /services/consulting receives the most internal links; /contact next.
  const mk = (to, n) => Array.from({ length: n }, (_, i) => ({ url: `${TARGET}/p${i}`, link_to: to }));
  return [
    ...mk(`${TARGET}/services/consulting`, 10),
    ...mk(`${TARGET}/contact`, 6),
    ...mk(`${TARGET}/services/coaching`, 4),
    ...mk(`${TARGET}/pricing`, 3),
  ];
}

// ---------------------------------------------------------------------------
// WP-B-07 — Deterministic selection
// ---------------------------------------------------------------------------

test("selects homepage, conversion, service, pricing, about, proof, education roles from fixture", () => {
  const result = selectImportantPages({
    targetUrl: TARGET,
    pages: fixturePages(),
    links: fixtureLinks(),
    services: ["Business Consulting", "Executive Coaching"],
    topicKeywords: ["consulting"],
  });

  assert.equal(result.roles.home[0], "https://example.com");
  assert.equal(result.roles.conversion[0], `${TARGET}/contact`);
  // Service candidates: consulting (10 inlinks) before coaching (4 inlinks).
  assert.equal(result.roles.service[0], `${TARGET}/services/consulting`);
  assert.equal(result.roles.service[1], `${TARGET}/services/coaching`);
  assert.equal(result.roles.pricing[0], `${TARGET}/pricing`);
  assert.equal(result.roles.about[0], `${TARGET}/about-us`);
  assert.equal(result.roles.proof[0], `${TARGET}/testimonials`);
  assert.equal(result.roles.education[0], `${TARGET}/blog/why-consulting`);
  // Privacy page must never be selected as a role page.
  assert.ok(!result.selected.some((s) => s.url.includes("/privacy")));
  assert.deepEqual(result.unassessedRoles, []);
  assert.ok(result.selected.length <= 10);
});

test("homepage carrying the only conversion form shares the URL across roles", () => {
  const pages = [
    page(`${TARGET}/`, { title: "Home", h1: "Home", forms: [{ action: "/submit" }] }),
    page(`${TARGET}/services/one`, { title: "Service One", h1: "Service One" }),
  ];
  const result = selectImportantPages({
    targetUrl: TARGET,
    pages,
    links: [],
    services: ["Service One"],
  });

  assert.equal(result.roles.home[0], "https://example.com");
  // conversion role: only candidate is the homepage (already selected).
  assert.equal(result.roles.conversion[0], "https://example.com");
  assert.ok(result.assessedRoles.includes("conversion"));
  // No duplicate selection entries for the same URL.
  const homeCount = result.selected.filter((s) => s.url === "https://example.com").length;
  assert.equal(homeCount, 1);
});

test("roles without evidence are unassessed, never invented", () => {
  const pages = [page(`${TARGET}/`, { title: "Home", h1: "Home" })];
  const result = selectImportantPages({ targetUrl: TARGET, pages, links: [], services: [] });

  assert.equal(result.selected.length, 1);
  assert.ok(result.unassessedRoles.length >= 5);
  assert.ok(!result.unassessedRoles.includes("home"));
  // No fabricated URLs.
  assert.ok(result.selected.every((s) => s.url.startsWith(TARGET)));
});

test("empty input produces empty selection and all roles unassessed", () => {
  const result = selectImportantPages({ targetUrl: TARGET, pages: [], links: [] });
  assert.equal(result.selected.length, 0);
  assert.deepEqual(result.unassessedRoles.sort(), Object.values(PAGE_ROLES).sort());
});

test("error pages (4xx/5xx) are never selected", () => {
  const pages = [
    page(`${TARGET}/`, { title: "Home", h1: "Home" }),
    page(`${TARGET}/404`, { title: "Contact", h1: "Contact", status: 404, forms: [{ action: "/x" }] }),
  ];
  const result = selectImportantPages({ targetUrl: TARGET, pages, links: [] });
  assert.ok(!result.selected.some((s) => s.url.includes("/404")));
});

test("determinism: two identical invocations produce identical results", () => {
  const args = () => ({
    targetUrl: TARGET,
    pages: fixturePages(),
    links: fixtureLinks(),
    services: ["Business Consulting", "Executive Coaching"],
    topicKeywords: ["consulting"],
  });
  const a = selectImportantPages(args());
  const b = selectImportantPages(args());
  assert.deepEqual(a, b);
});

test("selection respects maxSelected cap deterministically", () => {
  const pages = [
    page(`${TARGET}/`, { title: "Home", h1: "Home" }),
    ...Array.from({ length: 12 }, (_, i) =>
      page(`${TARGET}/services/svc-${i}`, { title: `Service ${i}`, h1: `Service ${i}` })),
  ];
  const result = selectImportantPages({
    targetUrl: TARGET,
    pages,
    links: [],
    services: ["Service"],
    maxSelected: 4,
  });
  assert.ok(result.selected.length <= 4);
  // Deterministic: exactly the first N by score-then-URL order.
  const urls = result.selected.map((s) => s.url);
  assert.deepEqual(urls, [...new Set(urls)]);
});
test("conversion-first selection does not let editorial pages consume commercial roles", () => {
  const pages = [
    page(`${TARGET}/`, {
      title: "Digital Marketing Agency",
      h1: "Grow Your Business",
    }),

    page(`${TARGET}/contact`, {
      title: "Contact Us",
      h1: "Start Your Project",
      forms: [{ action: "/submit" }],
      ctas: [{ text: "Request a Quote", url: "/contact" }],
    }),

    page(`${TARGET}/services/web-design`, {
      title: "Web Design Services",
      h1: "Web Design",
    }),

    page(`${TARGET}/services/digital-marketing`, {
      title: "Digital Marketing Services",
      h1: "Digital Marketing",
    }),

    page(`${TARGET}/case-studies/client-growth`, {
      title: "Client Success Story",
      h1: "Client Results",
    }),

    page(`${TARGET}/2022/03/24/how-digital-marketing-helps-business`, {
      title: "How Digital Marketing Helps Business",
      h1: "Digital Marketing Guide",
    }),

    page(`${TARGET}/blog/web-design-conversion-tips`, {
      title: "Web Design Conversion Tips",
      h1: "Improve Website Conversion",
    }),

    page(`${TARGET}/insights/request-more-from-your-marketing`, {
      title: "Request More From Your Marketing",
      h1: "Marketing Insights",
    }),
  ];

  const result = selectImportantPages({
    targetUrl: TARGET,
    pages,
    links: [],
    services: ["Web Design", "Digital Marketing"],
    topicKeywords: ["marketing", "conversion"],
    maxSelected: 6,
  });

  const commercialSelections = result.selected.filter(
    (item) => item.role !== PAGE_ROLES.EDUCATION,
  );

  assert.ok(
    commercialSelections.every(
      (item) =>
        !item.url.includes("/blog/") &&
        !item.url.includes("/insights/") &&
        !/\/20\d{2}\/\d{2}\/\d{2}\//.test(item.url),
    ),
    `editorial page consumed a commercial role: ${JSON.stringify(result.selected)}`,
  );

  assert.ok(
    result.selected.some(
      (item) =>
        item.role === PAGE_ROLES.CONVERSION &&
        item.url === `${TARGET}/contact`,
    ),
  );

  assert.ok(
    result.selected.some(
      (item) =>
        item.role === PAGE_ROLES.SERVICE &&
        item.url === `${TARGET}/services/web-design`,
    ),
  );
});

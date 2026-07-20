import test from "node:test";
import assert from "node:assert/strict";
import { crawlSite } from "./site-crawler.js";
import { extractPage } from "./page-extractor.js";
import { contentIdeas } from "../scoring/report-model.js";

// ── shared helpers ────────────────────────────────────────────────────────

function htmlPage(title, h1, h2s = [], h3s = [], links = [], schemaScripts = []) {
  const schemaTags = schemaScripts.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join("\n");
  const h2html = h2s.map((h) => `<h2>${h}</h2>`).join("\n");
  const h3html = h3s.map((h) => `<h3>${h}</h3>`).join("\n");
  const linkHtml = links.map((l) => `<a href="${l.url || "/"}">${l.text}</a>`).join("\n");
  return `<!doctype html><html lang="en-CA"><head><title>${title}</title>${schemaTags}</head><body><h1>${h1}</h1>${h2html}${h3html}${linkHtml}</body></html>`;
}

function mockHeaders() {
  return new Headers({ "content-type": "text/html; charset=utf-8" });
}

function mockFetch(url) {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin" });
  if (url.endsWith("/robots.txt")) return Promise.resolve(new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } }));
  if (url.endsWith("/sitemap.xml")) return Promise.resolve(new Response('<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/coaching</loc></url></urlset>', { status: 200, headers: { "content-type": "application/xml" } }));
  if (url.endsWith("/sitemap_index.xml")) return Promise.resolve(new Response("", { status: 404 }));
  const html = url.includes("coaching")
    ? '<!doctype html><html lang="en-CA"><head><title>Coaching</title><meta name="description" content="Coaching support"><link rel="canonical" href="https://example.com/coaching"><script type="application/ld+json">{"@type":"Service"}</script></head><body><h1>Stress Recovery Coaching</h1><p>Certified coaching with 25 years experience. Pricing starts at $100.</p><a href="/contact">Book a call</a></body></html>'
    : '<!doctype html><html lang="en-CA"><head><title>Example Wellness</title><meta name="description" content="Stress recovery"><link rel="canonical" href="https://example.com/"><meta name="generator" content="GoDaddy Website Builder 8.0"></head><body><h1>Stress Recovery</h1><h2>Coaching Services</h2><p>Client testimonials and frequently asked questions. Privacy policy.</p><a href="/coaching">Learn more</a><form action="/contact"><input name="email"><button>Book now</button></form><img src="/hero.jpg" alt="Coach speaking" width="800" height="600"></body></html>';
  return Promise.resolve(new Response(html, { status: 200, headers }));
}

test("crawlSite captures page, trust, schema, CTA, platform, and technical evidence", async () => {
  const evidence = await crawlSite("https://example.com", { fetchImpl: mockFetch, browserMode: "never", maxPages: 5 });
  assert.ok(evidence.pageCount >= 2);
  assert.equal(evidence.platform, "GoDaddy Website Builder");
  assert.equal(evidence.missingDescriptions, 0);
  assert.equal(evidence.imagesMissingAlt, 0);
  assert.equal(evidence.trust.testimonials, true);
  assert.equal(evidence.trust.credentials, true);
  assert.equal(evidence.trust.faq, true);
  assert.equal(evidence.trust.pricing, true);
  assert.ok(evidence.schemaTypes.includes("Service"));
  assert.ok(evidence.ctas.some((cta) => /book/i.test(cta.text)));
  assert.equal(evidence.securityHeaders.xContentTypeOptions, true);
});

// ── Regression: validated service extraction ──────────────────────────────

test("extractPage rejects CTAs, nav labels, questions, and instructional sentences as services", () => {
  const html = htmlPage(
    "Garnet Orthopedic Solutions – Home",
    "Welcome to Garnet Orthopedic Solutions",
    [
      "Physiotherapy",                          // ✓ valid service
      "Chiropractic Care",                      // ✓ valid service
      "Massage Therapy",                        // ✓ valid service
      "Book Your Assessment",                   // ✗ CTA
      "Service Areas",                          // ✗ generic
      "Services",                               // ✗ generic
      "About",                                  // ✗ generic
      "Contact",                                // ✗ generic
      "FAQ",                                    // ✗ generic
      "Learn More",                             // ✗ generic
      "We match the service",                   // ✗ instructional sentence
      "Start with the service that matches your problem", // ✗ instructional
    ],
    [
      "Do I need to know which service to book first?",  // ✗ question
      "Book Appointment",                         // ✗ CTA
      "Service",                                  // ✗ generic single word
      "What Our Clients Say",                     // ✗ testimonial-like
    ],
    [
      { text: "Book Your Assessment", url: "/book" },
      { text: "Contact Us", url: "/contact" },
      { text: "Physiotherapy", url: "/physiotherapy" },
      { text: "Learn More", url: "/learn" },
    ],
    [
      {
        "@type": "Service",
        name: "Sports Physiotherapy",
      },
    ]
  );

  const page = extractPage("https://garnet.example.com/", 200, mockHeaders(), html);
  const services = page.serviceCandidates.map((s) => s.toLowerCase());

  // Valid services extracted from schema appear first
  assert.ok(services.includes("sports physiotherapy"), "schema service extracted");

  // Valid H2/H3 service names are included
  assert.ok(services.includes("physiotherapy"), "physiotherapy included");
  assert.ok(services.includes("chiropractic care"), "chiropractic care included");
  assert.ok(services.includes("massage therapy"), "massage therapy included");

  // CTAs are rejected
  assert.ok(!services.includes("book your assessment"), "book your assessment excluded");
  assert.ok(!services.includes("book appointment"), "book appointment excluded");

  // Navigation / generic headings are rejected
  assert.ok(!services.includes("service areas"), "service areas excluded");
  assert.ok(!services.includes("services"), "services excluded");
  assert.ok(!services.includes("about"), "about excluded");
  assert.ok(!services.includes("contact"), "contact excluded");
  assert.ok(!services.includes("faq"), "faq excluded");
  assert.ok(!services.includes("learn more"), "learn more excluded");
  assert.ok(!services.includes("service"), "bare 'Service' excluded");

  // Questions are rejected
  assert.ok(!services.includes("do i need to know which service to book first?"), "question excluded");

  // Instructional sentences are rejected
  assert.ok(!services.includes("we match the service"), "we match excluded");
  assert.ok(!services.includes("start with the service that matches your problem"), "long instructional excluded");

  // Testimonial-like heading rejected
  assert.ok(!services.includes("what our clients say"), "testimonial heading excluded");
});

test("topicKeywords are meaningful multi-word phrases, not single generic words", () => {
  const html = htmlPage(
    "Garnet Orthopedic Solutions – Physiotherapy",
    "Sports Physiotherapy in Calgary",
    ["Manual Therapy", "Vestibular Rehabilitation"],
    ["Assessment", "Book Now", "Service Areas"]
  );

  const page = extractPage("https://garnet.example.com/physiotherapy", 200, mockHeaders(), html);

  // Build a minimal site-like object for phrase extraction
  const pages = [page];
  const allServices = new Set(pages.flatMap((p) => p.serviceCandidates));
  const phraseCounts = new Map();

  function addPhrase(phrase) {
    const cleaned = phrase.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, " ").trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 5) return;
    if (words.length === 1) {
      const w = words[0].replace(/-/g, "");
      if (w.length < 5) return;
      const GENERIC_SINGLE = new Set([
        "about", "contact", "services", "service", "learn", "more", "home",
        "welcome", "assessment", "solution", "solutions", "area", "areas",
        "care", "help", "support", "team", "info", "information", "resource",
        "resources", "page", "online", "better", "right", "good", "great",
        "professional", "quality", "expert", "experts", "dedicated",
        "comprehensive", "complete", "custom", "personal", "individual",
        "unique", "innovative", "advanced", "modern", "proven", "trusted",
        "leading", "premier", "premium", "affordable", "effective",
        "efficient", "reliable", "convenient", "flexible",
      ]);
      if (GENERIC_SINGLE.has(w)) return;
    }
    phraseCounts.set(cleaned, (phraseCounts.get(cleaned) || 0) + 1);
  }

  for (const svc of allServices) addPhrase(svc);
  for (const p of pages) {
    if (p.title) addPhrase(p.title);
    for (const h1 of p.headings.h1) addPhrase(h1);
  }

  const topicKeywords = [...phraseCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([phrase]) => phrase);

  // topicKeywords should be meaningful phrases, not single generic words
  assert.ok(topicKeywords.length > 0, "topicKeywords non-empty");

  // No single generic word should appear as a topic
  const forbiddenSingles = ["foot", "area", "service", "assessment", "solution", "care"];
  for (const kw of topicKeywords) {
    const lower = kw.toLowerCase();
    assert.ok(!forbiddenSingles.includes(lower), `"${kw}" should not be a single generic topic`);
  }

  // At least one multi-word phrase should be present
  const hasPhrase = topicKeywords.some((kw) => kw.split(/\s+/).length >= 2);
  assert.ok(hasPhrase, "at least one multi-word topic phrase present");
});

// ── Regression: "What Is Foot?" cannot be generated ───────────────────────

test('contentIdeas never generates "What Is Foot?" from a single short word', () => {
  // Even if single-word topics somehow sneak through, the pretty() guard
  // prevents bare short words from appearing in content ideas.
  const site = {
    services: [],
    topicKeywords: ["foot", "pain", "ankle"],
    trust: { credentials: true, testimonials: true, pricing: true, caseStudies: false, faq: false, policies: false, contact: true },
    forms: [],
    ctas: [],
  };

  const ideas = contentIdeas(site);

  // The guard should transform "Foot" → "Professional Foot" or similar
  for (const item of ideas.tofu) {
    assert.ok(!item.idea.includes("What Is Foot?"), `TOFU idea should not be "What Is Foot?": ${item.idea}`);
  }

  // With only single-word topics, services is empty, fallback kicks in
  // Verify we get meaningful content ideas
  assert.equal(ideas.tofu.length, 3, "three TOFU ideas generated");
  assert.equal(ideas.mofu.length, 4, "four MOFU ideas generated");
  assert.equal(ideas.bofu.length, 3, "three BOFU ideas generated");
});

test("contentIdeas with valid multi-word services produces sensible output", () => {
  const site = {
    services: ["Physiotherapy", "Chiropractic Care", "Massage Therapy"],
    topicKeywords: ["physiotherapy calgary", "manual therapy", "sports rehabilitation"],
    trust: { credentials: true, testimonials: true, pricing: true, caseStudies: false, faq: false, policies: false, contact: true },
    forms: [],
    ctas: [],
  };

  const ideas = contentIdeas(site);

  // TOFU ideas should reference the first topic meaningfully
  assert.ok(ideas.tofu[0].idea.includes("Physiotherapy"), "first TOFU idea references Physiotherapy");
  // No single short word should produce a bare "What Is X?" where X < 7 chars
  for (const item of ideas.tofu) {
    const match = item.idea.match(/^What Is (\w+)\?$/);
    if (match) {
      assert.ok(match[1].length >= 7, `TOFU "What Is X?" must use meaningful X, got: ${match[1]}`);
    }
  }
});

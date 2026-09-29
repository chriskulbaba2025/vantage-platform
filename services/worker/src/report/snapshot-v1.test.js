import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshotV1Projection, renderSnapshotV1 } from "./snapshot-v1.js";

function pkg(overrides = {}) {
  const findings = [
      { findingId: "finding-a", title: "Clarify emergency next steps", severity: "High", affectedUrls: ["https://acme.example/"], businessImpact: "Visitors may hesitate before contacting the team.", recommendation: "Place the emergency contact step beside the service summary.", evidence: [{ field: "cta", observedValue: "Contact", status: "AVAILABLE" }] },
      { findingId: "finding-b", title: "Add service proof", severity: "Medium", affectedUrls: ["https://acme.example/services"], businessImpact: "Proof is harder to verify.", recommendation: "Add a short result or credential where supported.", evidence: [{ field: "trust.testimonials", observedValue: false, status: "AVAILABLE" }] },
      { findingId: "finding-c", title: "Improve page context", severity: "Low", affectedUrls: ["https://acme.example/about"], businessImpact: "The page context is less clear.", recommendation: "Use a more specific page heading.", evidence: [{ field: "h1", observedValue: null, status: "AVAILABLE" }] },
      { findingId: "finding-d", title: "This fourth finding must not render", severity: "High", evidence: [{ field: "x", observedValue: true, status: "AVAILABLE" }] },
    ];
  return {
    business: { name: "Acme Plumbing", domain: "acme.example" },
    scores: { conversionReadiness: 72 }, bands: { conversionReadiness: "Ready" }, showNumericScore: true,
    siteMetrics: { services: ["Emergency Plumbing", "Drain Repair", "Water Heaters"] },
    sourceStatus: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE" },
    competitors: [{ domain: "competitor.example", url: "https://competitor.example/", status: "AVAILABLE" }],
    limitations: [], findings,
    canonicalDecisionModel: { version: "1.0.0", source: "persisted-score-set", orderedFindingIds: findings.slice(0, 3).map((finding) => finding.findingId), decisions: findings.slice(0, 3).map((finding, index) => ({ findingId: finding.findingId, rank: index + 1, title: finding.title, severity: finding.severity, scoreBearing: true, evidence: finding.evidence, businessImpact: finding.businessImpact, recommendation: finding.recommendation })) },
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return { site: { domain: "acme.example", targetUrl: "https://acme.example/", collectedAt: "2026-09-27T00:00:00.000Z", services: ["Emergency Plumbing", "Drain Repair", "Water Heaters"], ctas: [{ text: "Request an estimate", url: "https://acme.example/contact" }], forms: [{ action: "https://acme.example/contact" }], trust: { contact: true, testimonials: true, credentials: true, faq: false }, pages: [], brandIdentity: { logo: { url: "https://acme.example/logo.svg", sourceUrl: "https://acme.example/", sourceType: "header-logo", assetType: "SVG", firstParty: true, verified: true } }, ...overrides } };
}

test("Snapshot V1 projects a verified logo and preserves the complete one-page structure", () => {
  const projection = buildSnapshotV1Projection({ auditRequest: { businessName: "Acme Plumbing", targetUrl: "https://acme.example/" }, canonicalEvidence: evidence(), reportContentPackage: pkg(), reviewDate: "2026-09-27", ctaConfig: { ctaUrl: "https://omnipressence.com/book" } });
  const html = renderSnapshotV1(projection);
  assert.equal(projection.brand.logo.verified, true);
  assert.match(html, /Acme Plumbing logo/);
  assert.equal((html.match(/class="page"/g) || []).length, 1);
  assert.match(html, /7-page review of customer journey, trust, content gaps, competitors, site barriers, and prioritized fixes/);
  assert.match(html, /Omnipressence/);
  assert.match(html, /\/brand\/omnipresence\/brad-grant-headshot\.jpeg/);
  assert.doesNotMatch(html, /Downloads|brad pic\.jpeg/);
  assert.doesNotMatch(html, /Omnipresence/);
  assert.doesNotMatch(html, /\$\s?\d/);
  assert.equal((html.match(/class="finding"/g) || []).length, 3);
  assert.doesNotMatch(html, /This fourth finding/);
  assert.doesNotMatch(html, /href="#/);
});

test("white information panel is a generic three-part governed content block", () => {
  const projection = buildSnapshotV1Projection({
    auditRequest: { businessName: "Northstar Services", targetUrl: "https://northstar.example/" },
    canonicalEvidence: evidence({ domain: "northstar.example" }),
    reportContentPackage: pkg({
      business: { name: "Northstar Services", domain: "northstar.example" },
      limitations: ["Performance is PARTIAL", "Analytics are NOT_CONNECTED"],
      competitors: [],
    }),
  });
  const html = renderSnapshotV1(projection);
  assert.match(html, /What we reviewed/);
  assert.match(html, /What we could not see/);
  assert.match(html, /What the Executive Audit adds/);
  assert.match(html, /Northstar Services: main website pages, service descriptions, trust signals/);
  assert.match(html, /analytics, CRM results, or customer behaviour/);
  assert.match(html, /When part of the picture is missing/);
  assert.match(html, /full 7-page PRYSM Executive Audit goes deeper/);
  assert.doesNotMatch(html, /Reboot Business Coaching|rebootbusinesscoaching\.com/);
  assert.doesNotMatch(html, /\$\s?\d/);
  assert.equal((html.match(/class="page"/g) || []).length, 1);
  assert.equal((html.match(/class="cred-section"/g) || []).length, 3);
});

test("unverified, broken, and missing logos use only the business-name fallback", () => {
  const unverified = buildSnapshotV1Projection({ auditRequest: { businessName: "Acme Plumbing", targetUrl: "https://acme.example/" }, canonicalEvidence: evidence({ brandIdentity: { logo: { url: "https://other.example/logo.svg", verified: false } } }), reportContentPackage: pkg() });
  const html = renderSnapshotV1(unverified);
  assert.match(html, /class="logo-fallback"[^>]*>Acme Plumbing/);
  assert.doesNotMatch(html, /other\.example\/logo/);
  const missing = buildSnapshotV1Projection({ auditRequest: { businessName: "No Logo Co", targetUrl: "https://none.example/" }, canonicalEvidence: { site: { domain: "none.example", pages: [] } }, reportContentPackage: pkg({ business: { name: "No Logo Co", domain: "none.example" }, findings: [] }) });
  assert.match(renderSnapshotV1(missing), /class="logo-fallback"[^>]*>No Logo Co/);
});

test("truth semantics and optional blocks remain fail-closed", () => {
  const projection = buildSnapshotV1Projection({ auditRequest: { businessName: "Partial Co", targetUrl: "https://partial.example/" }, canonicalEvidence: { site: { domain: "partial.example", pages: [], trust: {}, brandIdentity: { logo: null } } }, reportContentPackage: pkg({ business: { name: "Partial Co", domain: "partial.example" }, scores: { conversionReadiness: null }, bands: {}, competitors: [], limitations: ["Performance is NOT_CONNECTED", "Booking evidence is UNKNOWN"], findings: [] }) });
  const html = renderSnapshotV1(projection);
  assert.equal(projection.score, null);
  assert.equal(projection.competitor, null);
  assert.match(html, /not assessed/);
  assert.match(html, /Some parts of this review were limited/);
  assert.doesNotMatch(html, /NOT_CONNECTED|not connected/i);
  assert.doesNotMatch(html, /top competitor/i);
});

test("three materially different frozen-style fixtures keep identity and assets isolated", () => {
  const fixtures = [
    { name: "Maple Home Services", domain: "maple.example", logo: "https://maple.example/logo.svg", type: "local service" },
    { name: "Northstar Consumer", domain: "northstar.example", logo: "https://northstar.example/brand.png", type: "national consumer" },
    { name: "Vector Systems", domain: "vector.example", logo: null, type: "B2B software" },
  ];
  const html = fixtures.map((fixture) => {
    const projection = buildSnapshotV1Projection({ auditRequest: { businessName: fixture.name, targetUrl: `https://${fixture.domain}/` }, canonicalEvidence: { site: { domain: fixture.domain, pages: [], brandIdentity: fixture.logo ? { logo: { url: fixture.logo, sourceUrl: `https://${fixture.domain}/`, sourceType: "structured-data", assetType: "IMAGE", likelyLogo: true } } : { logo: null } } }, reportContentPackage: pkg({ business: { name: fixture.name, domain: fixture.domain }, findings: [] }) });
    const output = renderSnapshotV1(projection);
    assert.match(output, new RegExp(fixture.name));
    if (fixture.logo) assert.match(output, new RegExp(fixture.domain + "\\/(logo|brand)"));
    else assert.match(output, new RegExp(`class=\\"logo-fallback\\"[^>]*>${fixture.name}`));
    assert.doesNotMatch(output, /Acme Plumbing|acme\.example/);
    return { type: fixture.type, name: fixture.name, verifiedLogo: Boolean(projection.brand.logo?.verified) };
  });
  assert.deepEqual(html.map((item) => item.verifiedLogo), [true, true, false]);
});

test("approved presentation binds score detail and CTA only when governed inputs exist", () => {
  const projection = buildSnapshotV1Projection({
    auditRequest: { businessName: "Binding Co", targetUrl: "https://binding.example/" },
    canonicalEvidence: evidence({ ctas: [] }),
    reportContentPackage: pkg({
      business: { name: "Binding Co", domain: "binding.example" },
      scores: { conversionReadiness: 81, trust: 77, contentDepth: 69, conversionPathways: 88 },
      findings: [], competitors: [], siteMetrics: { services: [] },
    }),
    ctaConfig: { ctaUrl: "https://calendly.com/brad-omnipresence/30min" },
  });
  const html = renderSnapshotV1(projection);
  assert.match(html, /<b>77<\/b><span>Trust<\/span>/);
  assert.match(html, /https:\/\/calendly\.com\/brad-omnipresence\/30min/);
  assert.doesNotMatch(html, /\$\s?\d/);

  const unavailable = buildSnapshotV1Projection({
    auditRequest: { businessName: "No CTA Co", targetUrl: "https://no-cta.example/" },
    canonicalEvidence: evidence({ ctas: [] }),
    reportContentPackage: pkg({ business: { name: "No CTA Co", domain: "no-cta.example" }, findings: [], competitors: [] }),
  });
  assert.match(renderSnapshotV1(unavailable), /Walkthrough link unavailable/);
});

test("V8 contract markers are complete, deterministic, and fixture-independent", () => {
  const projection = buildSnapshotV1Projection({
    auditRequest: { businessName: "North Star Services", targetUrl: "https://northstar.example/" },
    canonicalEvidence: { site: { domain: "northstar.example", services: ["Consulting"], ctas: [{ text: "Book" }], pages: [], trust: { contact: true } } },
    reportContentPackage: pkg({ business: { name: "North Star Services", domain: "northstar.example" }, findings: [] }),
    ctaConfig: {},
  });
  const html = renderSnapshotV1(projection);
  for (const marker of [
    "Your quick read", "What we found", "The 0 biggest conversion opportunities", "One fix you can use now",
    "What is already helping", "Keep these strengths", "Brad Grant", "Omnipressence",
    "The Snapshot is the quick view", "The PRYSM Executive Audit shows the full conversion story.",
    "Your full PRYSM Executive Audit goes beyond this Snapshot", "Locked preview", "Customer journey",
    "Trust gaps", "Competitor gaps", "Content opportunities", "Priority roadmap", "What we reviewed",
    "Executive Audit adds",
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);
  assert.equal((html.match(/class="page"/g) || []).length, 1);
  assert.match(html, /@media\(max-width:820px\)/);
  assert.match(html, /@media print/);
  assert.doesNotMatch(html, /\$\s?\d|\bprice\s*:/i);
  assert.doesNotMatch(html, /Downloads|brad pic\.jpeg/);
});

test("lead-magnet client projection translates technical evidence and locks readability, brand, and CTA contracts", () => {
  const findings = [
    { findingId: "performance", title: "Largest Contentful Paint is slow", severity: "High", affectedUrls: ["https://plain.example/"], businessImpact: "Slow pages can make visitors leave before they act.", recommendation: "Improve LCP and remove render-blocking resources.", evidence: [{ field: "lcp_ms", observedValue: 7697.8751, status: "AVAILABLE" }] },
    { findingId: "questions", title: "FAQ missing", severity: "Medium", affectedUrls: ["https://plain.example/faq"], businessImpact: "Buyers may leave with questions still unanswered.", recommendation: "Add FAQ content and FAQPage schema.", evidence: [{ field: "trust.faq", observedValue: false, status: "AVAILABLE" }] },
    { findingId: "context", title: "Structured data limited", severity: "Low", affectedUrls: ["https://plain.example/"], businessImpact: "Search engines have less context about the business.", recommendation: "Add LocalBusiness and Service structured data.", evidence: [{ field: "schema_types", observedValue: [], status: "AVAILABLE" }] },
  ];
  const projection = buildSnapshotV1Projection({
    auditRequest: { businessName: "Plain Business", targetUrl: "https://plain.example/" },
    canonicalEvidence: evidence({ domain: "plain.example", ctas: [{ text: "Book a call", url: "https://plain.example/book" }] }),
    reportContentPackage: pkg({
      business: { name: "Plain Business", domain: "plain.example" },
      findings,
      limitations: ["Analytics are NOT_CONNECTED"],
      canonicalDecisionModel: { version: "1.0.0", orderedFindingIds: findings.map((item) => item.findingId), decisions: findings.map((finding, index) => ({ findingId: finding.findingId, rank: index + 1, title: finding.title, severity: finding.severity, scoreBearing: true, evidence: finding.evidence, businessImpact: finding.businessImpact, recommendation: finding.recommendation })) },
    }),
    ctaConfig: { ctaUrl: "https://wrong.example/booking" },
  });
  const html = renderSnapshotV1(projection);
  const visible = html.replace(/<[^>]*>/g, " ");
  assert.match(visible, /main mobile content takes about 7\.7 seconds to appear/);
  assert.match(visible, /clear FAQ section answering common buyer questions/);
  assert.match(visible, /limited extra information about this business/);
  assert.match(visible, /Your site gives visitors several ways to take the next step/);
  assert.doesNotMatch(visible, /lcp_ms|trust\.faq|schema_types|governed|persisted|directly observed|evidence-state|sitemap|programmatic SEO/i);
  assert.match(visible, /What we reviewed/);
  assert.match(visible, /What we could not see/);
  assert.match(visible, /What the Executive Audit adds/);
  assert.match(visible, /7-page PRYSM Executive Audit/);
  assert.match(visible, /Omnipressence/);
  assert.doesNotMatch(visible, /Omnipresence/);
  const bookingHrefs = [...html.matchAll(/href="([^"]*calendly\.com[^"]*)"/g)].map((match) => match[1]);
  assert.ok(bookingHrefs.length >= 2);
  assert.ok(bookingHrefs.every((href) => href === "https://calendly.com/brad-omnipresence/30min"));
  assert.match(html, /\.page\{margin:12px auto 18px\}/);
  assert.match(html, /\.readout p\{font-size:17px\}/);
  assert.match(html, /\.cred p\{font-size:15px/);
  assert.match(html, /@media print/);
  assert.equal((html.match(/class="page"/g) || []).length, 1);
  assert.doesNotMatch(html, /\$\s?\d/);
  assert.doesNotMatch(html, /Reboot Business Coaching|rebootbusinesscoaching\.com/);
});

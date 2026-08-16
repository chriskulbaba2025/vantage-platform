#!/usr/bin/env node
/**
 * PRYSM-NEXT-01 WP-K — Calibration Harness.
 *
 * Ten deterministic fixture sites exercise the REAL scoring v4.1 path and
 * prove expected ranking/assessment behaviour plus crawl-evidence
 * convergence.  Zero live provider calls (pure model fixtures).
 *
 * Fixtures:
 *   1. strong-conversion-ready     — rich everything
 *   2. weak-thin-content           — 1 thin page, no trust/schema
 *   3. strong-content-broken-path  — rich content/trust, no forms/CTAs
 *   4. technically-strong-weak-offer — perfect meta/schema/perf, no offer/trust content
 *   5. js-heavy                    — DFS metadata-only crawl (content UNAVAILABLE)
 *   6. partial-provider-failure    — crawl OK, performance FAILED
 *   7. schema-rich                 — many schema/microdata types
 *   8. no-schema                   — content available, zero schema
 *   9. multi-service               — six dedicated service pages
 *  10. very-small                  — single minimal page
 */

import { scoreAudit } from "../src/scoring/vantage-score.js";
import { SOURCE_STATUS } from "../src/scoring/evidence-contracts.js";

const FIXED_TS = "2026-01-15T12:00:00.000Z";
const INPUT = { targetUrl: "https://cal.example.com", businessName: "Calibration Co", competitors: [] };

function page(url, { title, h1, forms = [], ctas = [], status = 200 } = {}) {
  return { crawledUrl: url, url, title, headings: { h1: [h1], h2: [], h3: [], h4: [] }, forms, ctas, status };
}

function site(overrides = {}) {
  return {
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    targetUrl: "https://cal.example.com/",
    domain: "cal.example.com",
    pageCount: overrides.pageCount ?? 2,
    pages: overrides.pages || [],
    services: overrides.services || [],
    topicKeywords: overrides.topicKeywords || [],
    ctas: overrides.ctas || [],
    externalCtas: [],
    forms: overrides.forms || [],
    schemaTypes: overrides.schemaTypes || [],
    microdataTypes: overrides.microdataTypes || [],
    socialLinks: overrides.socialLinks || [],
    trust: overrides.trust || { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: false },
    securityHeaders: overrides.securityHeaders || { xFrameOptions: false, xContentTypeOptions: false, referrerPolicy: false, contentSecurityPolicy: false },
    totalWords: overrides.totalWords ?? 0,
    averageWords: overrides.averageWords ?? 0,
    missingTitles: overrides.missingTitles ?? 0,
    missingDescriptions: overrides.missingDescriptions ?? 0,
    missingCanonicals: overrides.missingCanonicals ?? 0,
    h1Missing: overrides.h1Missing ?? 0,
    h1Multiple: overrides.h1Multiple ?? 0,
    imageCount: overrides.imageCount ?? 0,
    imagesMissingAlt: overrides.imagesMissingAlt ?? 0,
    internalLinkCount: overrides.internalLinkCount ?? 0,
    brokenInternalLinks: [],
    statusCounts: {},
    limitations: overrides.limitations || [],
    collectedAt: FIXED_TS,
    coverage: overrides.coverage || { requested: 2, completed: 2, failed: 0 },
    _contentEvidenceAvailable: overrides._contentEvidenceAvailable,
    _responseHeadersAvailable: overrides._responseHeadersAvailable,
    acquisition: overrides.acquisition,
    contentParsing: overrides.contentParsing,
    redirectChains: overrides.redirectChains,
    nonIndexablePages: overrides.nonIndexablePages,
    pageResources: overrides.pageResources,
    platform: overrides.platform || "WordPress",
  };
}

function perf(overrides = {}) {
  return {
    sourceStatus: overrides.sourceStatus ?? SOURCE_STATUS.AVAILABLE,
    provider: "pagespeed-insights",
    mobile: { status: overrides.sourceStatus ?? SOURCE_STATUS.AVAILABLE, source: "psi", scores: { performance: overrides.mobile ?? 85 }, metrics: {} },
    desktop: { status: overrides.sourceStatus ?? SOURCE_STATUS.AVAILABLE, source: "psi", scores: { performance: overrides.desktop ?? 90 }, metrics: {} },
    fieldData: overrides.fieldData || {},
    limitations: overrides.perfLimitations || [],
    collectedAt: FIXED_TS,
    coverage: overrides.coverage || { requested: 2, completed: 2, failed: 0 },
  };
}

function evidenceOf(siteOverrides, perfOverrides) {
  return {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: siteOverrides === null ? null : site(siteOverrides || {}),
    performance: perfOverrides === null ? null : perf(perfOverrides || {}),
    competitors: null, backlinks: null, ga4: null, gsc: null,
  };
}

const GOOD_TRUST = { testimonials: true, credentials: true, caseStudies: true, faq: true, pricing: true, policies: true, contact: true };
const GOOD_HEADERS = { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: true };
const FULL_ACQ = {
  contentParsing: { requested: 3, completed: 3, failed: 0 },
  redirectChains: { requested: 3, completed: 3, failed: 0 },
  nonIndexable: { requested: 1000, completed: 0, failed: 0 },
  resources: { requested: 3, completed: 3, failed: 0 },
  microdata: { requested: 1, completed: 1, failed: 0 },
};

const fixtures = {
  "strong-conversion-ready": evidenceOf({
    pageCount: 6,
    pages: [
      page("https://cal.example.com/", { title: "Home", h1: "Home", ctas: [{ text: "Book Now", url: "https://cal.example.com/book" }] }),
      page("https://cal.example.com/services/coaching", { title: "Coaching Services", h1: "Business Coaching" }),
      page("https://cal.example.com/contact", { title: "Contact Us", h1: "Book a Consultation", forms: [{ action: "/submit" }], ctas: [{ text: "Book Now", url: "https://cal.example.com/book" }] }),
      page("https://cal.example.com/pricing", { title: "Pricing", h1: "Pricing and Packages" }),
      page("https://cal.example.com/testimonials", { title: "Client Testimonials", h1: "Reviews" }),
      page("https://cal.example.com/blog/guide", { title: "Guide to Coaching", h1: "Coaching Guide" }),
    ],
    services: ["Coaching", "Workshops"],
    topicKeywords: ["business coaching", "executive coaching", "leadership development"],
    ctas: [{ text: "Book Now", url: "https://cal.example.com/book" }],
    forms: [{ action: "/submit" }],
    schemaTypes: ["Organization", "LocalBusiness", "Service"],
    socialLinks: [{ url: "https://linkedin.com/co" }],
    trust: GOOD_TRUST,
    securityHeaders: GOOD_HEADERS,
    totalWords: 2400, averageWords: 400,
    imageCount: 4, imagesMissingAlt: 0,
    internalLinkCount: 10,
    _contentEvidenceAvailable: true, _responseHeadersAvailable: true,
    acquisition: FULL_ACQ,
    contentParsing: [
      { url: "https://cal.example.com/", wordCount: 400, mainContentChars: 2400, hasMainContent: true, sentimentScore: null },
      { url: "https://cal.example.com/contact", wordCount: 150, mainContentChars: 800, hasMainContent: true, sentimentScore: null },
    ],
    redirectChains: [],
    nonIndexablePages: [],
    pageResources: [{ url: "https://cal.example.com/", totalResources: 10, brokenResources: 0 }],
  }, { mobile: 88, desktop: 92 }),

  "weak-thin-content": evidenceOf({
    pageCount: 1,
    pages: [page("https://cal.example.com/", { title: "Home", h1: "Home" })],
    services: [],
    topicKeywords: [],
    totalWords: 60, averageWords: 60,
    _contentEvidenceAvailable: true, _responseHeadersAvailable: true,
  }, { mobile: 70, desktop: 75 }),

  "strong-content-broken-path": evidenceOf({
    pageCount: 5,
    pages: [
      page("https://cal.example.com/", { title: "Home", h1: "Home" }),
      page("https://cal.example.com/services/coaching", { title: "Coaching Services", h1: "Business Coaching" }),
      page("https://cal.example.com/testimonials", { title: "Testimonials", h1: "Reviews" }),
      page("https://cal.example.com/blog/guide", { title: "Guide", h1: "Coaching Guide" }),
    ],
    services: ["Coaching"],
    topicKeywords: ["business coaching"],
    ctas: [],
    forms: [],
    schemaTypes: ["Organization"],
    trust: GOOD_TRUST,
    securityHeaders: GOOD_HEADERS,
    totalWords: 2000, averageWords: 500,
    _contentEvidenceAvailable: true, _responseHeadersAvailable: true,
  }, { mobile: 85, desktop: 90 }),

  "technically-strong-weak-offer": evidenceOf({
    pageCount: 6,
    pages: [
      page("https://cal.example.com/", { title: "Home", h1: "Home" }),
      page("https://cal.example.com/about", { title: "About", h1: "About Us" }),
      page("https://cal.example.com/blog/1", { title: "Blog 1", h1: "Blog" }),
    ],
    services: [],
    topicKeywords: ["industry trends"],
    schemaTypes: ["Organization", "LocalBusiness", "Service", "FAQPage"],
    trust: { testimonials: false, credentials: false, caseStudies: false, faq: true, pricing: false, policies: true, contact: false },
    securityHeaders: GOOD_HEADERS,
    totalWords: 1200, averageWords: 400,
    imageCount: 2, imagesMissingAlt: 0,
    _contentEvidenceAvailable: true, _responseHeadersAvailable: true,
  }, { mobile: 92, desktop: 95 }),

  "js-heavy": evidenceOf({
    sourceStatus: SOURCE_STATUS.PARTIAL,
    pageCount: 4,
    pages: [
      page("https://cal.example.com/", { title: "Home", h1: "Home" }),
      page("https://cal.example.com/services", { title: "Services", h1: "Services" }),
    ],
    limitations: ["JavaScript content may be partially missing on some pages"],
    _contentEvidenceAvailable: false, _responseHeadersAvailable: false,
    acquisition: {
      contentParsing: { requested: 3, completed: 0, failed: 3 },
      redirectChains: { requested: 3, completed: 0, failed: 3 },
      nonIndexable: { requested: 1000, completed: 0, failed: 1000 },
      resources: { requested: 3, completed: 0, failed: 3 },
      microdata: { requested: 1, completed: 0, failed: 1 },
    },
  }, { mobile: 80, desktop: 85 }),

  "partial-provider-failure": evidenceOf({
    pageCount: 5,
    pages: [
      page("https://cal.example.com/", { title: "Home", h1: "Home", forms: [{ action: "/submit" }] }),
      page("https://cal.example.com/services/coaching", { title: "Coaching Services", h1: "Business Coaching" }),
    ],
    services: ["Coaching"],
    topicKeywords: ["business coaching"],
    ctas: [{ text: "Contact", url: "https://cal.example.com/contact" }],
    forms: [{ action: "/submit" }],
    schemaTypes: ["Organization"],
    trust: GOOD_TRUST,
    securityHeaders: GOOD_HEADERS,
    totalWords: 1500, averageWords: 300,
    _contentEvidenceAvailable: true, _responseHeadersAvailable: true,
  }, { sourceStatus: SOURCE_STATUS.FAILED, status: SOURCE_STATUS.FAILED, perfLimitations: ["both providers failed"] }),

  "schema-rich": evidenceOf({
    pageCount: 4,
    pages: [
      page("https://cal.example.com/", { title: "Home", h1: "Home" }),
      page("https://cal.example.com/services/coaching", { title: "Coaching Services", h1: "Business Coaching" }),
    ],
    services: ["Coaching"],
    schemaTypes: ["Organization", "LocalBusiness", "Service", "FAQPage", "BreadcrumbList", "Product"],
    microdataTypes: ["LocalBusiness", "Product"],
    trust: { ...GOOD_TRUST, faq: true },
    totalWords: 800, averageWords: 200,
    _contentEvidenceAvailable: true, _responseHeadersAvailable: true,
    acquisition: { microdata: { requested: 1, completed: 1, failed: 0 } },
  }, { mobile: 80, desktop: 85 }),

  "no-schema": evidenceOf({
    pageCount: 3,
    pages: [
      page("https://cal.example.com/", { title: "Home", h1: "Home" }),
      page("https://cal.example.com/services/coaching", { title: "Coaching Services", h1: "Business Coaching" }),
    ],
    services: ["Coaching"],
    schemaTypes: [],
    microdataTypes: [],
    trust: GOOD_TRUST,
    totalWords: 900, averageWords: 300,
    _contentEvidenceAvailable: true, _responseHeadersAvailable: true,
  }, { mobile: 80, desktop: 85 }),

  "multi-service": evidenceOf({
    pageCount: 8,
    pages: [
      page("https://cal.example.com/", { title: "Home", h1: "Home" }),
      ...["coaching", "workshops", "facilitation", "training", "consulting", "mediation"].map((s, i) =>
        page(`https://cal.example.com/services/${s}`, { title: `${s} Services`, h1: s }),
      ),
    ],
    services: ["Coaching", "Workshops", "Facilitation", "Training", "Consulting", "Mediation"],
    topicKeywords: ["coaching", "workshops", "facilitation", "training"],
    ctas: [{ text: "Enquire", url: "https://cal.example.com/contact" }],
    forms: [{ action: "/submit" }],
    schemaTypes: ["Organization"],
    trust: GOOD_TRUST,
    securityHeaders: GOOD_HEADERS,
    totalWords: 3200, averageWords: 400,
    _contentEvidenceAvailable: true, _responseHeadersAvailable: true,
  }, { mobile: 82, desktop: 88 }),

  "very-small": evidenceOf({
    pageCount: 1,
    pages: [page("https://cal.example.com/", { title: "Home", h1: "Home" })],
    services: [],
    topicKeywords: [],
    totalWords: 120, averageWords: 120,
    _contentEvidenceAvailable: true, _responseHeadersAvailable: true,
  }, { mobile: 60, desktop: 65 }),
};

// ---------------------------------------------------------------------------
// Behavioural expectations (deterministic outcomes of the REAL scoring path)
// ---------------------------------------------------------------------------
let pass = 0;
let fail = 0;
function check(cond, label, detail) { if (cond) { pass += 1; console.log(`  [x] ${label}`); } else { fail += 1; console.log(`  [ ] ${label}${detail ? ` — ${detail}` : ""}`); } }

console.log("\nPRYSM-NEXT-01 WP-K — Calibration Harness\n");

const results = {};
for (const [name, ev] of Object.entries(fixtures)) {
  const model = scoreAudit(INPUT, ev);
  results[name] = model;
  console.log(`${name}: readiness=${model.scores.conversionReadiness} status=${model.readinessStatus} assessed=${model.assessedWeight}% confidence=${model.evidenceConfidenceScore} findings=${model.findings.length}`);
}

const R = (n) => results[n];

// Ranking expectations
check(R("strong-conversion-ready").scores.conversionReadiness > R("weak-thin-content").scores.conversionReadiness, "strong ranks above weak-thin");
check(R("strong-conversion-ready").scores.conversionReadiness > R("strong-content-broken-path").scores.conversionReadiness, "strong ranks above broken-path (CTA/forms matter)");
check(R("strong-conversion-ready").scores.conversionReadiness >= R("technically-strong-weak-offer").scores.conversionReadiness, "strong >= technically-strong-weak-offer");
check(R("technically-strong-weak-offer").scores.conversionReadiness > R("weak-thin-content").scores.conversionReadiness, "technically-strong ranks above weak-thin");
check(R("schema-rich").scores.entitySchemaAiDimension >= R("no-schema").scores.entitySchemaAiDimension, "schema-rich entity dimension >= no-schema");
check(R("multi-service").scores.contentFunnelDimension > R("weak-thin-content").scores.contentFunnelDimension, "multi-service content dimension > weak-thin");

// State expectations
check(R("js-heavy").scores.conversionReadiness === null, "js-heavy (content UNAVAILABLE) suppresses the overall numeric score");
check(R("js-heavy").readinessStatus.includes("Insufficient"), "js-heavy labelled Insufficient Evidence");
check(R("js-heavy").moduleEligibility.trust_signals === false, "js-heavy suppresses trust module (unknown ≠ absent)");
check(R("partial-provider-failure").moduleEligibility.performance === false, "performance FAILED suppresses the performance module");
check(R("partial-provider-failure").assessedWeight === 90, "partial-provider-failure assessed weight = 90 (performance 10% suppressed)", `got ${R("partial-provider-failure").assessedWeight}`);
check(R("partial-provider-failure").readinessStatus === "Complete", "90% assessed → Complete label");
check(R("strong-conversion-ready").assessedWeight === 100, "strong fixture assesses 100% of intended weight");

// Capability transparency
check(R("strong-conversion-ready").capabilityEvidence.summary.assessed >= 10, "strong fixture: ≥10 capabilities assessed (convergence)", `got ${R("strong-conversion-ready").capabilityEvidence.summary.assessed}`);
check(R("js-heavy").capabilityEvidence.summary.assessed < 10, "js-heavy: reduced capability assessment");
const jsCaps = R("js-heavy").capabilityEvidence.capabilities;
check(jsCaps["trust.proof"].status === "UNAVAILABLE", "js-heavy: trust.proof UNAVAILABLE (never false-absent)");

// Findings honesty
const noSchemaRules = new Set(R("no-schema").findings.map((f) => f.ruleId));
check(noSchemaRules.has("VAN-SCHEMA-001"), "no-schema emits the schema finding (confirmed absence)");
const jsRules = new Set(R("js-heavy").findings.map((f) => f.ruleId));
check(!jsRules.has("VAN-TRUST-001") && !jsRules.has("VAN-SCHEMA-001"), "js-heavy emits no trust/schema false-positives");

// Determinism + repeatability
const again = scoreAudit(INPUT, fixtures["strong-conversion-ready"]);
check(JSON.stringify(again) === JSON.stringify(R("strong-conversion-ready")), "strong fixture scores deterministically");

// Convergence report
console.log("\n— Convergence (crawl evidence vs assessed capabilities) —");
for (const name of Object.keys(results)) {
  const m = results[name];
  const caps = m.capabilityEvidence?.capabilities || {};
  const available = Object.values(caps).filter((c) => c.status === "AVAILABLE").length;
  const partial = Object.values(caps).filter((c) => c.status === "PARTIAL").length;
  console.log(`  ${name.padEnd(30)} pages=${String(m.evidence.site?.pageCount ?? 0).padStart(3)} capabilities A=${available} P=${partial}`);
}

console.log(`\nWP-K Calibration: ${pass} PASS, ${fail} FAIL\n`);
process.exit(fail > 0 ? 1 : 0);

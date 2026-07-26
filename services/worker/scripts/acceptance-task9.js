#!/usr/bin/env node

/**
 * Task 9 — Competitor Opportunity Layer Acceptance Harness
 *
 * Runs the competitor opportunity collector against mock data covering:
 *   - User-supplied competitors without SERP
 *   - Qualification gate behaviour
 *   - Gap rule behaviour
 *   - Exclusion behaviour
 *   - Approval gating
 *   - Failure isolation
 *
 * Usage:
 *   npm run acceptance:task9
 */

import { collectCompetitorOpportunities, qualifyCandidate, qualifyGap } from "../src/evidence/competitor-opportunity-layer.js";
import { SOURCE_STATUS } from "../src/scoring/evidence-contracts.js";

const NOW = new Date().toISOString();

const SITE = {
  sourceStatus: SOURCE_STATUS.AVAILABLE,
  services: ["Consulting", "Coaching", "Web Design"],
  topicKeywords: ["business consulting", "leadership coaching", "custom web design"],
  pages: [{ title: "Home" }],
  pageCount: 12,
};

const INPUT = {
  targetUrl: "https://example-consulting.example",
  businessName: "Example Consulting",
  location: "Vancouver, British Columbia, Canada",
  language: "en-CA",
  competitors: ["https://competitor-1.example", "https://competitor-2.example"],
};

const SUPPLIED = [
  {
    url: "https://competitor-1.example",
    status: SOURCE_STATUS.AVAILABLE,
    evidence: {
      services: ["Consulting", "Coaching"],
      pageCount: 15,
      trust: { credentials: true, testimonials: true },
      schemaTypes: ["Service", "Organization"],
      ctas: [{ text: "Book Consultation", url: "https://competitor-1.example/book" }],
      forms: [{ action: "/contact" }],
    },
  },
  {
    url: "https://competitor-2.example",
    status: SOURCE_STATUS.AVAILABLE,
    evidence: {
      services: ["Web Design"],
      pageCount: 8,
      trust: { credentials: true },
      schemaTypes: ["Service"],
    },
  },
];

console.log("\n=== Task 9 Acceptance Harness ===");
console.log(`Started: ${NOW}\n`);

let pass = true;
const scenarios = [];

// Scenario 1: qualification gate
try {
  const candidate = {
    candidateUrl: "https://competitor.example/services/consulting",
    domain: "competitor.example",
    topic: "business consulting",
    discoverySource: "dataforseo-serp",
    geographicContext: "Vancouver, British Columbia",
    pageType: "service",
  };
  const result = qualifyCandidate(candidate, {
    location: "Vancouver",
    services: ["Consulting"],
    topicKeywords: ["business consulting"],
  });
  const ok = result.passed === true;
  scenarios.push({ name: "Qualification gate — passes", ok });
  if (!ok) { console.log("  FAIL: qualification gate"); pass = false; }
} catch (e) { console.log(`  FAIL: qualification gate threw: ${e.message}`); pass = false; }

// Scenario 2: directory exclusion
try {
  const result = qualifyCandidate(
    { candidateUrl: "https://yellowpages.example/biz", pageType: "directory", topic: "consulting" },
    { services: ["Consulting"] },
  );
  const ok = result.passed === false;
  scenarios.push({ name: "Directory exclusion", ok });
  if (!ok) { console.log("  FAIL: directory not excluded"); pass = false; }
} catch (e) { console.log(`  FAIL: directory exclusion threw: ${e.message}`); pass = false; }

// Scenario 3: gap rule
try {
  const result = qualifyGap(
    "consulting",
    { candidateUrl: "https://comp.example", domain: "comp.example", topic: "consulting", pageType: "service", hasSchema: ["rich_snippet"] },
    ["consulting"],
    ["Consulting services page"],
  );
  const ok = result.passed === true;
  scenarios.push({ name: "Gap rule — passes 6 checks", ok });
  if (!ok) { console.log("  FAIL: gap rule"); pass = false; }
} catch (e) { console.log(`  FAIL: gap rule threw: ${e.message}`); pass = false; }

// Scenario 4: collector with supplied only (no SERP)
try {
  const result = await collectCompetitorOpportunities(SITE, INPUT, {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: SUPPLIED,
    auditorApprovals: {
      "https://competitor-1.example": "approved",
      "https://competitor-2.example": "approved",
    },
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  const ok = result.candidates.totalSupplied >= 2 && result.sourceStatus === SOURCE_STATUS.AVAILABLE;
  scenarios.push({ name: "Collector — supplied only", ok });
  if (!ok) { console.log(`  FAIL: collector supplied only — status=${result.sourceStatus} supplied=${result.candidates.totalSupplied}`); pass = false; }
} catch (e) { console.log(`  FAIL: collector threw: ${e.message}`); pass = false; }

// Scenario 5: pending competitors filtered
try {
  const result = await collectCompetitorOpportunities(SITE, INPUT, {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: SUPPLIED,
    auditorApprovals: { "https://competitor-1.example": "pending" },
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  const ok = result.gaps.length === 0;
  scenarios.push({ name: "Pending competitors — no gaps", ok });
  if (!ok) { console.log("  FAIL: pending competitors produced gaps"); pass = false; }
} catch (e) { console.log(`  FAIL: pending threw: ${e.message}`); pass = false; }

// Scenario 6: failure isolation
try {
  const result = await collectCompetitorOpportunities(SITE, INPUT, {
    dataforseoLogin: "test-login",
    dataforseoPassword: "test-pass",
    suppliedCompetitors: SUPPLIED,
    fetchImpl: async (url) => {
      if (String(url).includes("dataforseo.com")) return new Response("error", { status: 503 });
      return new Response("{}", { status: 200 });
    },
  });
  const ok = result.candidates.totalSupplied >= 2 && result.limitations.some((l) => l.includes("SERP"));
  scenarios.push({ name: "SERP failure — supplied still works", ok });
  if (!ok) { console.log("  FAIL: SERP failure isolation"); pass = false; }
} catch (e) { console.log(`  FAIL: isolation threw: ${e.message}`); pass = false; }

// Scenario 7: canonical envelope
try {
  const result = await collectCompetitorOpportunities(SITE, INPUT, {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: SUPPLIED,
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  const ok = result.evidenceVersion === "1.0.0" && result._sourceStatus !== undefined;
  scenarios.push({ name: "Canonical evidence envelope", ok });
  if (!ok) { console.log("  FAIL: canonical envelope"); pass = false; }
} catch (e) { console.log(`  FAIL: envelope threw: ${e.message}`); pass = false; }

// Summary
console.log("");
for (const s of scenarios) {
  console.log(`  ${s.ok ? "✓" : "✗"} ${s.name}`);
}

const passed = scenarios.filter((s) => s.ok).length;
console.log(`\n=== Acceptance: ${pass ? "PASS" : "FAIL"} ===`);
console.log(`${passed}/${scenarios.length} scenarios passed`);
console.log(`Completed: ${new Date().toISOString()}\n`);

process.exit(pass ? 0 : 1);

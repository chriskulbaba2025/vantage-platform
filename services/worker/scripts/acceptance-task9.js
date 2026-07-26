#!/usr/bin/env node

/**
 * Task 9 — Competitor Opportunity Layer Acceptance Harness (v2)
 *
 * Covers the full production workflow:
 *   audit creation → pending candidates → auditor review → persisted updates → client-facing gaps → approval gate
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit, submitReview, approveAudit } from "../src/audit/run-audit.js";
import { createLocalReportStore } from "../src/storage/report-store.js";
import {
  qualifyCandidate, qualifyGap, collectCompetitorOpportunities,
} from "../src/evidence/competitor-opportunity-layer.js";
import {
  validateCompetitorDecisions, buildCompetitorOverrides,
} from "../src/audit/review-gate.js";
import { SOURCE_STATUS } from "../src/scoring/evidence-contracts.js";

const NOW = new Date().toISOString();
let pass = true;
const scenarios = [];

console.log("\n=== Task 9 Acceptance Harness ===");
console.log(`Started: ${NOW}\n`);

// ---------------------------------------------------------------------------
// Scenario 1: Qualification gate
// ---------------------------------------------------------------------------
try {
  const result = qualifyCandidate(
    { candidateUrl: "https://c.example/services", domain: "c.example", topic: "consulting", pageType: "service", geographicContext: "Toronto", discoverySource: "dataforseo-serp" },
    { location: "Toronto", services: ["Consulting"], topicKeywords: ["consulting"] },
  );
  const ok = result.passed === true;
  scenarios.push({ name: "Qualification gate — passes all 5 checks", ok });
  if (!ok) { console.log("  FAIL: qualification gate"); pass = false; }
} catch (e) { console.log(`  FAIL: qualification gate — ${e.message}`); pass = false; }

// ---------------------------------------------------------------------------
// Scenario 2: Directory exclusion
// ---------------------------------------------------------------------------
try {
  const result = qualifyCandidate(
    { candidateUrl: "https://directory.example/biz", pageType: "directory", topic: "consulting" },
    { services: ["Consulting"] },
  );
  const ok = result.passed === false;
  scenarios.push({ name: "Directory exclusion", ok });
  if (!ok) { console.log("  FAIL: directory not excluded"); pass = false; }
} catch (e) { console.log(`  FAIL: directory exclusion — ${e.message}`); pass = false; }

// ---------------------------------------------------------------------------
// Scenario 3: Gap rule
// ---------------------------------------------------------------------------
try {
  const result = qualifyGap(
    "consulting",
    { candidateUrl: "https://c.example", domain: "c.example", topic: "consulting", pageType: "service", hasSchema: ["rich_snippet"] },
    ["consulting"],
    ["Services page"],
  );
  const ok = result.passed === true;
  scenarios.push({ name: "Gap rule — passes all 6 checks", ok });
  if (!ok) { console.log("  FAIL: gap rule"); pass = false; }
} catch (e) { console.log(`  FAIL: gap rule — ${e.message}`); pass = false; }

// ---------------------------------------------------------------------------
// Scenario 4: Decision validation
// ---------------------------------------------------------------------------
try {
  const known = new Set(["https://c1.example/page"]);
  const decisions = [
    { candidateUrl: "https://c1.example/page", decision: "approved", reason: "Direct competitor" },
  ];
  const { valid } = validateCompetitorDecisions(decisions, known);
  const ok = valid === true;
  scenarios.push({ name: "Decision validation — valid inputs", ok });
  if (!ok) { console.log("  FAIL: decision validation rejected valid input"); pass = false; }
} catch (e) { console.log(`  FAIL: decision validation — ${e.message}`); pass = false; }

try {
  const known = new Set(["https://c1.example/page"]);
  const { valid, errors } = validateCompetitorDecisions(
    [{ candidateUrl: "https://unknown.example", decision: "approved", reason: "x" }],
    known,
  );
  const ok = valid === false && errors.some((e) => e.includes("Unknown"));
  scenarios.push({ name: "Decision validation — rejects unknown", ok });
  if (!ok) { console.log("  FAIL: unknown candidate not rejected"); pass = false; }
} catch (e) { console.log(`  FAIL: decision validation — ${e.message}`); pass = false; }

// ---------------------------------------------------------------------------
// Scenario 5: Full production workflow
// ---------------------------------------------------------------------------
try {
  const dir = await mkdtemp(join(tmpdir(), "vantage-accept-task9-"));
  const store = createLocalReportStore({ baseDir: dir });

  const SITE = {
    evidenceVersion: "1.0.0", source: "dataforseo-onpage", sourceStatus: SOURCE_STATUS.AVAILABLE,
    targetUrl: "https://example.com/", domain: "example.com", pageCount: 12, totalWords: 2000,
    averageWords: 500, missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
    h1Missing: 0, h1Multiple: 0, imageCount: 5, imagesMissingAlt: 0, imagesMissingDimensions: 0,
    schemaTypes: ["Organization", "Service"], forms: [], ctas: [{ text: "Book", url: "https://example.com/book" }],
    externalCtas: [], socialLinks: [], internalLinkCount: 5, brokenInternalLinks: [], platform: "WordPress",
    services: ["Consulting", "Coaching"], topicKeywords: ["business consulting"],
    securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: false },
    trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true },
    limitations: [], pages: [{ title: "Home", language: "en-CA", headings: { h1: ["Example"], h2: [], h3: [], h4: [] }, responseHeaders: {} }],
    collectedAt: NOW, coverage: { requested: 12, completed: 12, failed: 0 }, rawArtifactRef: "dfs://task",
    _sourceStatus: { provider: "dataforseo-onpage", adapterVersion: "1.0.0", startedAt: NOW, completedAt: NOW, requestId: "task", retryCount: 0, returnedRecordCount: 12, expectedRecordCount: 12, errorCategory: null, limitation: null, rawArtifactRef: "dfs://task" },
  };

  const PERF = {
    evidenceVersion: "1.0.0", source: "pagespeed-insights", sourceStatus: SOURCE_STATUS.AVAILABLE, status: SOURCE_STATUS.AVAILABLE,
    intendedProvider: "pagespeed-insights", fallbackUsed: false,
    mobile: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", strategy: "mobile", dataType: "lab", isLabData: true, isFieldData: false, fallbackUsed: false, scores: { performance: 75, accessibility: 88, bestPractices: 94, seo: 82 }, metrics: { fcpMs: 1000, lcpMs: 2200 }, opportunities: [] },
    desktop: { status: SOURCE_STATUS.AVAILABLE, source: "pagespeed-insights", strategy: "desktop", dataType: "lab", isLabData: true, isFieldData: false, fallbackUsed: false, scores: { performance: 92, accessibility: 90, bestPractices: 96, seo: 85 }, metrics: { fcpMs: 500, lcpMs: 900 }, opportunities: [] },
    fieldData: { phone: { status: SOURCE_STATUS.NOT_CONNECTED }, desktop: { status: SOURCE_STATUS.NOT_CONNECTED } },
    limitations: [], collectedAt: NOW, coverage: { requested: 2, completed: 2, failed: 0 },
    _sourceStatus: { provider: "pagespeed-insights", intendedProvider: "pagespeed-insights", adapterVersion: "1.0.0", startedAt: null, completedAt: NOW, requestId: null, retryCount: 0, returnedRecordCount: 2, expectedRecordCount: 2, errorCategory: null, limitation: null, rawArtifactRef: null },
  };

  const NC = { evidenceVersion: "1.0.0", source: "none", sourceStatus: SOURCE_STATUS.NOT_CONNECTED, status: SOURCE_STATUS.NOT_CONNECTED, collectedAt: NOW, coverage: { requested: 0, completed: 0, failed: 0 },
    _sourceStatus: { provider: "none", adapterVersion: "1.0.0", startedAt: null, completedAt: NOW, requestId: null, retryCount: 0, returnedRecordCount: 0, expectedRecordCount: null, errorCategory: "not_configured", limitation: null, rawArtifactRef: null } };

  const COMPETITORS = [{
    url: "https://competitor.example/services/consulting", status: SOURCE_STATUS.AVAILABLE,
    evidence: { services: ["Consulting"], pageCount: 10, trust: { testimonials: true, credentials: true, caseStudies: false, faq: true, pricing: true, policies: true, contact: true }, schemaTypes: ["Service"], ctas: [{ text: "Book", url: "https://c.example/book", kind: "link" }], forms: [], domain: "competitor.example", socialLinks: [], topicKeywords: [], pages: [{ title: "Comp", headings: { h1: ["Consulting"], h2: [], h3: [], h4: [] }, responseHeaders: {} }], platform: "WordPress" },
  }];

  function cfg() { return { maxPages: 5, browserMode: "never", pagespeedApiKey: "", cruxApiKey: "", dataforseoLogin: "", dataforseoPassword: "", ga4PropertyId: "", googleServiceAccountJson: "", reportsBucket: "", artifactDir: dir, publicReportBaseUrl: "", awsRegion: "ca-central-1", reportsPrefix: "vantage/reports", onpageMaxPages: 500, onpageJsRendering: false, onpageBrowserRendering: false, onpagePollTimeoutMs: 600000, onpagePollIntervalMs: 10000, onpageIncludePatterns: [], onpageExcludePatterns: [], googleClientId: "", googleClientSecret: "", googleRedirectUri: "", vantageEncryptionKey: "" }; }

  // Step 1: Create audit
  const audit = await runAudit(
    { targetUrl: "https://example.com", businessName: "Example", location: "Toronto, Ontario", competitors: ["https://competitor.example/services/consulting"] },
    { config: cfg(), crawlSite: async () => SITE, crawlCompetitors: async () => COMPETITORS, collectPerformance: async () => PERF, collectBacklinks: async () => NC, collectGa4: async () => NC, collectGsc: async () => NC, store, runId: "accept-task9" },
  );

  const opp1 = audit.model.evidence?.competitorOpportunities;
  const candidates1 = opp1?.candidates?.qualified || [];
  const ok1 = candidates1.length > 0 && candidates1.every((c) => (c.approvalStatus || "pending") === "pending");
  scenarios.push({ name: "Step 1 — pending candidates created", ok: ok1 });
  if (!ok1) { console.log(`  FAIL: step 1 — ${candidates1.length} candidates, all pending=${ok1}`); pass = false; }

  // Step 2: Submit review with approval decisions
  const qualifiedUrls = candidates1.map((c) => c.candidateUrl);
  await submitReview(store, audit.slug, audit.runId, {
    reviewer: "auditor@example.com",
    checklist: [
      { id: "source_failures", reviewed: true }, { id: "top_ten_findings", reviewed: true },
      { id: "high_severity", reviewed: true }, { id: "competitor_selections", reviewed: true },
      { id: "root_cause", reviewed: true }, { id: "score_eligibility", reviewed: true },
      { id: "limitations", reviewed: true }, { id: "causal_language", reviewed: true },
      { id: "implementation_feasibility", reviewed: true },
    ],
    competitorDecisions: qualifiedUrls.map((url) => ({ candidateUrl: url, decision: "approved", reason: "Direct competitor" })),
    limitationsAccepted: true,
  });

  // Step 3: Verify persisted evidence
  const evidenceRaw = await store.readFile(`${audit.slug}/${audit.runId}/evidence.json`);
  const evidence = JSON.parse(evidenceRaw.toString("utf8"));
  const opp2 = evidence.competitorOpportunities;
  const ok2 = (opp2?.candidates?.qualified || []).every((c) => c.approvalStatus === "approved");
  scenarios.push({ name: "Step 2 — evidence updated after review", ok: ok2 });
  if (!ok2) { console.log("  FAIL: step 2 — evidence not updated"); pass = false; }

  const ok3 = (opp2?.gaps || []).length > 0;
  scenarios.push({ name: "Step 3 — client-facing gaps created", ok: ok3 });
  if (!ok3) { console.log("  FAIL: step 3 — no gaps generated"); pass = false; }

  // Step 4: Approve (using updated model from evidence)
  const modelRaw = await store.readFile(`${audit.slug}/${audit.runId}/audit.json`);
  const updatedModel = JSON.parse(modelRaw.toString("utf8"));

  try {
    const approved = await approveAudit(store, audit.slug, audit.runId, "approver@example.com", { model: updatedModel });
    scenarios.push({ name: "Step 4 — approval succeeds with approved gaps", ok: true });
  } catch (e) {
    scenarios.push({ name: "Step 4 — approval succeeds with approved gaps", ok: false });
    console.log(`  FAIL: step 4 — approval threw: ${e.message}`);
    pass = false;
  }

  await rm(dir, { recursive: true, force: true });
} catch (e) {
  console.log(`  FAIL: production workflow — ${e.message}`);
  pass = false;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("");
for (const s of scenarios) {
  console.log(`  ${s.ok ? "✓" : "✗"} ${s.name}`);
}
const passed = scenarios.filter((s) => s.ok).length;
console.log(`\n=== Acceptance: ${pass ? "PASS" : "FAIL"} ===`);
console.log(`${passed}/${scenarios.length} scenarios passed`);
console.log(`Completed: ${new Date().toISOString()}\n`);
process.exit(pass ? 0 : 1);

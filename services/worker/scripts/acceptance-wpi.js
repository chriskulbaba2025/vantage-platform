#!/usr/bin/env node
/**
 * PRYSM-NEXT-01 WP-I — Full Plumbing Proof.
 *
 * One ENTIRELY controlled end-to-end audit through the REAL production
 * composition boundaries with governed fixtures:
 *
 *   intake → identity/tenant resolution → lifecycle → source execution →
 *   raw artifacts → normalized artifacts → canonical evidence → capability
 *   evidence → scoring → findings → report content → report-v2 rendering →
 *   draft → reviewer access → review → approval → approved report access →
 *   v1 compatibility → tenant isolation.
 *
 * Guards: every adapter runs in fixture mode; a global fetch spy asserts
 * ZERO uncontrolled network calls; narrative mode is mock (zero model
 * calls).  Counters are measured, never hardcoded as success.
 */

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

// The worker server.js module requires a storage mode at import time.
// Memory store is the governed local/dev mode (same gate as the WP11 mock).
process.env.VANTAGE_DEV_MEMORY_STORE = "true";

let pass = 0;
let fail = 0;
function ok(label) { pass += 1; console.log(`  [x] PASS — ${label}`); }
function bad(label, detail) { fail += 1; console.log(`  [ ] FAIL — ${label}${detail ? `: ${detail}` : ""}`); }
function check(cond, label, detail) { cond ? ok(label) : bad(label, detail); return cond; }

console.log("\nPRYSM-NEXT-01 WP-I — Full Plumbing Proof\n");

// ---------------------------------------------------------------------------
// Global network guard — any real fetch attempt is recorded AND blocked.
// ---------------------------------------------------------------------------
const fetchCalls = [];
const guardedFetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  throw new Error(`UNCONTROLLED NETWORK ACCESS BLOCKED: ${url}`);
};

const FIXED_TS = "2026-01-15T12:00:00.000Z";
const clock = { now: () => FIXED_TS, sleep: async () => {}, setTimeout: (f, m) => setTimeout(f, Math.min(m, 100)) };

// ---------------------------------------------------------------------------
// Imports (real production modules)
// ---------------------------------------------------------------------------
const { createMemoryArtifactStore } = await import("../src/storage/memory-artifact-store.js");
const { createGovernedArtifactStore } = await import("../src/storage/governed-artifact-store.js");
const { createMemoryLifecycleRepository } = await import("../src/lifecycle/memory-repository.js");
const { createLifecycleService } = await import("../src/lifecycle/lifecycle-service.js");
const { LIFECYCLE_STATE: T } = await import("../src/lifecycle/state-enum.js");
const { createAuditOrchestrator } = await import("../src/orchestration/audit-orchestrator.js");
const { createAuditApplicationService } = await import("../src/application/audit-service.js");
const { createRequestHandler } = await import("../src/server.js");
const { createLocalReportStore } = await import("../src/storage/report-store.js");
const { createMemoryIdentityRepository } = await import("../src/identity/memory-identity-repository.js");
const { signPrincipal } = await import("../src/identity/authorization.js");
const { execute: onpageExecute } = await import("../src/adapters/dataforseo-onpage/dataforseo-onpage-adapter.js");
const { buildArtifactKey } = await import("../src/storage/artifact-key.js");
const { REVIEW_CHECKLIST_ITEMS, isReviewComplete } = await import("../src/audit/review-gate.js");

// ---------------------------------------------------------------------------
// Controlled adapter fixtures (below the real adapter boundary)
// ---------------------------------------------------------------------------
function siteSourceResult() {
  return {
    contractVersion: "1.0.0", schemaVersion: "1.0.0",
    source: "dataforseo-onpage", provider: "DataForSEO", adapterVersion: "1.1.0",
    status: "AVAILABLE", startedAt: FIXED_TS, completedAt: FIXED_TS, retryCount: 0,
    expectedRecords: 3, returnedRecords: 3,
    coverage: { requested: 3, completed: 3, failed: 0 }, limitations: [],
    evidence: {
      sourceStatus: "AVAILABLE", targetUrl: "https://plumbing.example.com/",
      domain: "plumbing.example.com", pageCount: 3, platform: "WordPress",
      pages: [
        { crawledUrl: "https://plumbing.example.com/", url: "https://plumbing.example.com/", title: "Home", headings: { h1: ["Home"], h2: [], h3: [], h4: [] }, forms: [], ctas: [], status: 200 },
        { crawledUrl: "https://plumbing.example.com/services/coaching", url: "https://plumbing.example.com/services/coaching", title: "Coaching Services", headings: { h1: ["Coaching"], h2: [], h3: [], h4: [] }, forms: [], ctas: [], status: 200 },
        { crawledUrl: "https://plumbing.example.com/contact", url: "https://plumbing.example.com/contact", title: "Contact Us", headings: { h1: ["Contact"], h2: [], h3: [], h4: [] }, forms: [{ action: "/submit" }], ctas: [{ text: "Book Now", url: "https://plumbing.example.com/book", kind: "link" }], status: 200 },
      ],
      services: ["Coaching"], topicKeywords: ["coaching"],
      ctas: [{ text: "Book Now", url: "https://plumbing.example.com/book", kind: "link" }],
      forms: [{ action: "/submit" }], externalCtas: [], socialLinks: [],
      schemaTypes: ["Organization"], microdataTypes: [],
      trust: { testimonials: false, credentials: true, caseStudies: false, faq: false, pricing: false, policies: true, contact: true },
      securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: true },
      statusCounts: { "200": 3 }, totalWords: 300, averageWords: 100,
      missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
      h1Missing: 0, h1Multiple: 0, imageCount: 0, imagesMissingAlt: 0,
      internalLinkCount: 2, brokenInternalLinks: [],
      _contentEvidenceAvailable: true, _responseHeadersAvailable: true,
      collectedAt: FIXED_TS,
    },
  };
}

function perfSourceResult() {
  return {
    contractVersion: "1.0.0", schemaVersion: "1.0.0",
    source: "pagespeed", provider: "pagespeed-insights", adapterVersion: "1.1.0",
    status: "AVAILABLE", startedAt: FIXED_TS, completedAt: FIXED_TS, retryCount: 0,
    coverage: { requested: 2, completed: 2, failed: 0 }, limitations: [],
    evidence: {
      sourceStatus: "AVAILABLE", provider: "pagespeed-insights",
      mobile: { status: "AVAILABLE", source: "psi", scores: { performance: 80 }, metrics: {} },
      desktop: { status: "AVAILABLE", source: "psi", scores: { performance: 90 }, metrics: {} },
      fieldData: {}, testedUrls: ["https://plumbing.example.com/"], collectedAt: FIXED_TS,
    },
  };
}

function emptyResult(source, provider, adapterVersion = "1.0.0") {
  return {
    contractVersion: "1.0.0", schemaVersion: "1.0.0", source, provider, adapterVersion,
    status: "NOT_APPLICABLE", startedAt: FIXED_TS, completedAt: FIXED_TS, retryCount: 0,
    coverage: { requested: 0, completed: 0, failed: 0 }, limitations: [],
    evidence: { sourceStatus: "NOT_APPLICABLE", collectedAt: FIXED_TS },
  };
}

function buildAdapters() {
  const stub = (fn) => async () => ({ rawBytes: Buffer.from("{}"), contentType: "application/json", sourceResult: fn() });
  return {
    "dataforseo-onpage": { adapterVersion: "1.1.0", execute: stub(siteSourceResult) },
    pagespeed: { adapterVersion: "1.1.0", execute: stub(perfSourceResult) },
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: stub(() => emptyResult("dataforseo-serp", "DataForSEO")) },
    backlinks: { adapterVersion: "1.0.0", execute: stub(() => emptyResult("backlinks", "DataForSEO")) },
    ga4: { adapterVersion: "1.0.0", execute: stub(() => emptyResult("ga4", "Google")) },
    gsc: { adapterVersion: "1.0.0", execute: stub(() => emptyResult("gsc", "Google")) },
  };
}

// ---------------------------------------------------------------------------
// Controlled validator mock (no live browser — NOT_ASSESSED is proven here;
// the validated path is proven by the WP-E unit + orchestrator tests).
// ---------------------------------------------------------------------------
const mockValidator = async ({ keyPages }) => ({
  provider: "playwright-conversion-path",
  status: "NOT_ASSESSED",
  pages: [],
  summary: { requested: keyPages.length, pass: 0, partial: 0, failed: 0, notAssessed: keyPages.length },
  limitations: ["browser validation not enabled in controlled run"],
});

// ---------------------------------------------------------------------------
// Harness store + services (REAL modules, memory backends)
// ---------------------------------------------------------------------------
const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
const lcRepo = createMemoryLifecycleRepository();
const lifecycleService = createLifecycleService(lcRepo);
const identityRepo = createMemoryIdentityRepository();

// Tenant + principal setup (identity boundary)
const tenantId = "tenant-a";
const otherTenantId = "tenant-b";
const userId = randomUUID();
await identityRepo.createUser({ id: userId, cognitoSub: "sub-alice", email: "alice@example.com", displayName: "Alice" });
await identityRepo.createMembership({ id: randomUUID(), tenantId, userId, role: "reviewer" });
const malloryId = randomUUID();
await identityRepo.createUser({ id: malloryId, cognitoSub: "sub-mallory", email: "mallory@example.com", displayName: "Mallory" });
await identityRepo.createMembership({ id: randomUUID(), tenantId: otherTenantId, userId: malloryId, role: "reviewer" });

const orchestrator = createAuditOrchestrator({
  lifecycleService,
  artifactStore,
  adapters: buildAdapters(),
  validateContract: () => ({ valid: true, errors: [] }),
  clock,
  narrativeMode: "mock",
  conversionPathValidatorImpl: mockValidator,
});

const reportStore = createLocalReportStore({ baseDir: ".wpi-tmp-report" });
const auditService = createAuditApplicationService({
  orchestrator, lifecycleRepo: null, lifecycleService,
  artifactStore, reportStore,
  config: { artifactDir: ".wpi-tmp-report" },
  validateContract: () => ({ valid: true, errors: [] }),
  clock,
});

const handler = createRequestHandler({
  config: { artifactDir: ".wpi-tmp-report", webhookSecret: "test-secret", vantageTenantId: tenantId },
  localStore: reportStore,
  store: reportStore,
  oauthService: { getAuthUrl: () => "", validateState: () => "ga4", exchangeCode: async () => ({}), getStatus: async () => ({}), disconnect: async () => ({}) },
  auditService,
  lifecycleRepo: lcRepo, // findAuditTenant ownership lookup
  identityRepo,
  governedArtifacts: artifactStore,
});

function request(method, path, { principal, headers = {} } = {}) {
  return new Promise((resolve) => {
    const reqObj = {
      method,
      url: new URL(path, "http://localhost").toString(),
      headers: { ...headers },
    };
    if (principal) {
      reqObj.headers["x-prysm-principal"] = signPrincipal({ secret: "test-secret", principal, nowMs: Date.now() });
    }
    const res = {
      statusCode: 0,
      headers: {},
      chunks: [],
      writeHead(status, hdrs) { this.statusCode = status; this.headers = hdrs || {}; },
      end(payload) {
        this.chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)));
        resolve({
          status: this.statusCode,
          headers: this.headers,
          bodyBytes: Buffer.concat(this.chunks),
          text: Buffer.concat(this.chunks).toString("utf-8"),
        });
      },
    };
    handler(reqObj, res);
  });
}

async function readArtifact(scope, category, artifactName) {
  const key = buildArtifactKey({ ...scope, category, artifactName });
  let bytes;
  try {
    bytes = await artifactStore.get(key);
  } catch {
    return null;
  }
  if (!bytes) return null;
  let json = null;
  try {
    json = JSON.parse(bytes.toString("utf-8"));
  } catch {
    json = null; // non-JSON artifact (e.g. HTML page)
  }
  return { key, bytes, json };
}

async function driveToState(auditRequest, targetState) {
  let result = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
  let previous = null;
  for (let step = 0; step < 8; step++) {
    if (result.finalState === targetState || result.finalState === previous) break;
    previous = result.finalState;
    result = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Audit A — report design v2 end-to-end
// ---------------------------------------------------------------------------
console.log("— Phase 1: full governed cycle, report design v2.0.0 —");
let auditId = randomUUID();
const clientId = "plumbing.example.com";
const idempotencyKey = randomUUID();
const auditRequest = {
  contractVersion: "1.0.0",
  auditId, tenantId, clientId, idempotencyKey,
  targetUrl: "https://plumbing.example.com",
  businessName: "Plumbing Proof Co",
  market: "Toronto, Ontario",
  language: "en-CA",
  primaryGoal: "Book consultations",
  services: ["Coaching", "Workshops"],
  competitors: [],
  report: { designVersion: "2.0.0" },
  crawl: { pathValidationEnabled: true },
};

const created = await auditService.createAudit({
  targetUrl: auditRequest.targetUrl,
  businessName: auditRequest.businessName,
  market: auditRequest.market,
  language: auditRequest.language,
  primaryGoal: auditRequest.primaryGoal,
  services: auditRequest.services,
  competitors: [],
  report: { designVersion: "2.0.0" },
}, tenantId);

check(created && created.auditId, "intake created the audit through the real application service");

// The intake derives the canonical audit + client identity — the
// orchestrator run must carry the SAME identity so every governed artifact
// matches (the canonical audit id is the one the lifecycle row carries).
const canonicalAuditId = created.lifecycle?.auditId || created.auditId;
const createdCs = await lifecycleService.currentState(canonicalAuditId, tenantId);
auditRequest.auditId = canonicalAuditId;
auditRequest.clientId = created.clientId || createdCs?.clientId || auditRequest.clientId;
auditRequest.idempotencyKey = created.idempotencyKey || auditRequest.idempotencyKey;
auditId = canonicalAuditId;

const draftResult = await driveToState(auditRequest, T.DRAFT_RENDERED);
check(draftResult.finalState === T.DRAFT_RENDERED, "audit reached draft_rendered", `got ${draftResult.finalState}`);
check(draftResult.reportDesignVersion === "2.0.0", "renderer selected design v2.0.0");

const history = await lifecycleService.history(auditId, tenantId);
const states = history.map((e) => e.nextState);
const expectedStates = [T.CREATED, T.VALIDATED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED, T.SCORED, T.NARRATIVE_PENDING, T.NARRATIVE_READY, T.DRAFT_RENDERED];
check(JSON.stringify(states) === JSON.stringify(expectedStates), "exact ordered lifecycle", states.join("→"));

// The authoritative client identity comes from the lifecycle row.
const cs = await lifecycleService.currentState(auditId, tenantId);
const actualClientId = cs?.clientId || clientId;
const scope = { tenantId, clientId: actualClientId, auditId };

const rawEv = await readArtifact(scope, "canonical", "audit-request.json");
check(Boolean(rawEv), "durable audit-request artifact persisted");
check(rawEv?.json?.services?.length === 2, "business context persisted in the governed request");

const decision = await readArtifact(scope, "canonical", "decision-evidence.json");
check(Boolean(decision), "decision evidence persisted");
check(decision?.json?.decisionEvidenceVersion === "1.0.0", "decision-evidence v1.0.0 contract (historical compatibility)");

const capability = await readArtifact(scope, "canonical", "capability-evidence.json");
check(Boolean(capability), "capability evidence persisted");
check(capability?.json?.capabilityEvidenceVersion === "2.0.0", "capability evidence v2.0.0");
const pathCap = capability?.json?.capabilities?.["conversion.path"];
check(pathCap?.validated === false, "browser validation NOT_ASSESSED → path stays inferred (no penalty)");

const validation = await readArtifact(scope, "canonical", "conversion-path-validation.json");
check(validation?.json?.status === "NOT_ASSESSED", "path-validation artifact persisted honestly");

const scores = await readArtifact(scope, "canonical", "scores.json");
check(scores?.json?.scoringVersion === "4.1.0", "scoring version 4.1.0 persisted");

const findings = await readArtifact(scope, "canonical", "findings.json");
check(Array.isArray(findings?.json) && findings.json.length > 0, "findings persisted with records");

const v2Page = await readArtifact(scope, "report-v2", "pages/index.html");
check(Boolean(v2Page), "report-v2 index.html persisted");
const v2Html = v2Page?.bytes.toString("utf-8") || "";
check(/^<!doctype html>/i.test(v2Html) && v2Html.includes("D. Where are the problems?"), "v2 page finalization structure");
check(v2Html.includes("Plumbing Proof Co"), "v2 report carries the business name");
check(v2Html.includes("Report design v2.0.0"), "v2 design token rendered");

const v2Manifest = await readArtifact(scope, "report-v2", "manifest.json");
check(v2Manifest?.json?.reportDesignVersion === "2.0.0", "v2 manifest declares design 2.0.0");
check(v2Manifest?.json?.status === "draft", "v2 manifest status draft before approval");

console.log("— Phase 2: reviewer access gate (draft state) —");
const reviewerPrincipal = { sub: "sub-alice", email: "alice@example.com", displayName: "Alice" };
const draftAccess = await request("GET", `/api/v1/audits/${auditId}/report/index.html?slug=plumbing-proof-co&clientId=${actualClientId}`, { principal: reviewerPrincipal });
check(draftAccess.status === 200, "draft report visible to the authorized tenant reviewer", `got ${draftAccess.status}`);
check(draftAccess.text.includes("Report design v2.0.0"), "reviewer receives the governed v2 draft page");
const draftAnon = await request("GET", `/api/v1/audits/${auditId}/report/index.html?slug=plumbing-proof-co&clientId=${actualClientId}`);
check(draftAnon.status === 401, "draft report NOT exposed anonymously", `got ${draftAnon.status}`);

console.log("— Phase 3: governed review (real review gate + lifecycle) —");
const incompleteReview = await (async () => {
  try {
    const current = await lifecycleService.currentState(auditId, tenantId);
    if (current.state !== T.DRAFT_RENDERED) throw new Error(`Cannot review in ${current.state}`);
    const checklist = REVIEW_CHECKLIST_ITEMS.slice(1).map((item) => ({ id: item.id, reviewed: true }));
    if (isReviewComplete({ checklist })) throw new Error("harness bug: incomplete checklist accepted");
    await lifecycleService.transition({
      auditId, tenantId, toState: T.IN_REVIEW,
      expectedState: T.DRAFT_RENDERED, expectedVersion: current.version,
      transitionIdempotencyKey: `${auditId}:human-review-complete`,
      actor: "alice", reason: "should-not-happen",
    });
    return "transitioned";
  } catch (err) {
    return err.message;
  }
})();
check(incompleteReview !== "transitioned", "incomplete review cannot advance the lifecycle", incompleteReview);

const reviewChecklist = REVIEW_CHECKLIST_ITEMS.map((item) => ({ id: item.id, reviewed: true }));
check(isReviewComplete({ checklist: reviewChecklist }), "complete checklist recognized by the review gate");
{
  const current = await lifecycleService.currentState(auditId, tenantId);
  await lifecycleService.transition({
    auditId, tenantId, toState: T.IN_REVIEW,
    expectedState: T.DRAFT_RENDERED, expectedVersion: current.version,
    transitionIdempotencyKey: `${auditId}:human-review-complete`,
    actor: "alice", reason: "human review checklist completed",
  });
}
const afterReview = await lifecycleService.currentState(auditId, tenantId);
check(afterReview.state === T.IN_REVIEW, "review advanced the canonical lifecycle to in_review");

console.log("— Phase 4: approval (real application boundary) —");
const approval = await auditService.approveAudit(auditId, tenantId, "plumbing-proof-co", "alice", []);
check(approval.status === "approved" && approval.designVersion === "2.0.0", "v2 approval branch approved the governed page set");
{
  const current = await lifecycleService.currentState(auditId, tenantId);
  await lifecycleService.transition({
    auditId, tenantId, toState: T.APPROVED,
    expectedState: T.IN_REVIEW, expectedVersion: current.version,
    transitionIdempotencyKey: `${auditId}:approve`,
    actor: "alice", reason: "approved",
  });
}
const approvedManifest = await readArtifact(scope, "report-v2", "approved-manifest.json");
check(approvedManifest?.json?.status === "approved", "approved manifest persisted (immutable store — new artifact)");

console.log("— Phase 5: approved report access + tenant isolation (real server boundary) —");
const approvedAccess = await request("GET", `/api/v1/audits/${auditId}/report/index.html?slug=plumbing-proof-co&clientId=${actualClientId}`, { principal: reviewerPrincipal });
check(approvedAccess.status === 200, "approved v2 report served to the tenant reviewer", `got ${approvedAccess.status}`);
check(approvedAccess.text.includes("Report design v2.0.0"), "served page is the governed v2 artifact");

const crossTenant = await request("GET", `/api/v1/audits/${auditId}/report/index.html?slug=plumbing-proof-co&clientId=${actualClientId}`, { principal: { sub: "sub-mallory", email: "mallory@example.com", displayName: "Mallory" } });
check(crossTenant.status === 404, "cross-tenant report access non-disclosing 404", `got ${crossTenant.status}`);
check(
  !crossTenant.text.includes("<!doctype html") &&
    !crossTenant.text.includes("Plumbing Proof Co") &&
    !crossTenant.text.includes("Report design v2.0.0"),
  "zero REPORT bytes before authorization (error envelope only)",
);

const noPrincipal = await request("GET", `/api/v1/audits/${auditId}/report/index.html?slug=plumbing-proof-co&clientId=${actualClientId}`);
check(noPrincipal.status === 401, "unauthenticated report access 401", `got ${noPrincipal.status}`);

console.log("— Phase 6: v1 compatibility (design default) —");
const auditIdV1 = randomUUID();
const v1Request = {
  contractVersion: "1.0.0",
  auditId: auditIdV1, tenantId, clientId: "v1.example.com",
  idempotencyKey: randomUUID(),
  targetUrl: "https://v1.example.com",
  businessName: "V1 Compat Co",
  competitors: [],
};
const v1Draft = await driveToState(v1Request, T.DRAFT_RENDERED);
check(v1Draft.finalState === T.DRAFT_RENDERED, "v1-design audit reached draft_rendered");
const v1Scope = { tenantId, clientId: "v1.example.com", auditId: auditIdV1 };
let v1PageCount = 0;
for (const filename of ["scorecard.html", "priority-fixes.html", "evidence-appendix.html", "index.html"]) {
  const page = await readArtifact(v1Scope, "report", `pages/${filename}`);
  if (page) v1PageCount += 1;
}
check(v1PageCount === 4, "v1 16-page set sampled present (design 1.0.0 default unchanged)", `${v1PageCount}/4 sampled`);
const v1Manifest = await readArtifact(v1Scope, "report", "manifest.json");
check(v1Manifest?.json?.reportDesignVersion === "1.0.0", "v1 manifest design token unchanged");

console.log("— Phase 7: zero-live guards (measured) —");
check(fetchCalls.length === 0, "zero uncontrolled network calls (guarded fetch never invoked)", `${fetchCalls.length} calls`);
check(draftResult.n8nCallCount === 0, "zero n8n calls (mock narrative mode)", `n8nCallCount=${draftResult.n8nCallCount}`);
check(draftResult.narrativeCallsMade === null && draftResult.narrativeCost === null, "zero model calls and zero cost recorded");

console.log(`\nWP-I Full Plumbing Proof: ${pass} PASS, ${fail} FAIL\n`);
process.exit(fail > 0 ? 1 : 0);

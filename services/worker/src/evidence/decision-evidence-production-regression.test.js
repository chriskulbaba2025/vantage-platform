/**
 * DE-16 — PERMANENT REGRESSION for the production render failure:
 * "scorecard: Cannot read properties of undefined (reading 'domain')".
 *
 * The real DataForSEO On-Page production adapter, fed a controlled provider
 * fixture, must produce a DecisionEvidence model in which
 *
 *   site.domain / site.pages / site.services / site.trust
 *   site.platform / site.schemaTypes
 *
 * are defined from the real adapter's normalized output.  The evidence must
 * validate against the executable decision-evidence schema and then drive
 * the REAL production orchestrator + REAL renderer to all required approved
 * pages.
 *
 * This test FAILS if the legacy canonical-envelope-to-renderer behaviour is
 * reintroduced (the renderer would receive the metadata envelope and crash
 * exactly as the production defect did).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { execute as onpageExecute } from "../adapters/dataforseo-onpage/dataforseo-onpage-adapter.js";
import { execute as pagespeedExecute } from "./pagespeed-client.js";
import { execute as serpExecute } from "../adapters/dataforseo-serp/serp-adapter.js";
import { execute as backlinksExecute } from "./backlinks-provider.js";
import { buildDecisionEvidence, loadAndValidateDecisionEvidence } from "./decision-evidence.js";
import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { createLifecycleService } from "../lifecycle/lifecycle-service.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createGovernedArtifactStore, buildArtifactKey } from "../storage/governed-artifact-store.js";
import { createAuditOrchestrator } from "../orchestration/audit-orchestrator.js";
import { LIFECYCLE_STATE } from "../lifecycle/state-enum.js";
import { REQUIRED_APPROVED_PAGE_FILENAMES } from "../storage/report-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const T = LIFECYCLE_STATE;

// Real contract validator over ALL production schemas.
const schemasDir = resolve(__dirname, "..", "contracts");
const _ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(_ajv);
[
  "artifact-record.schema.json", "audit-request.schema.json",
  "canonical-evidence.schema.json", "capability-evidence.schema.json",
  "conversion-path-validation.schema.json",
  "decision-evidence.schema.json",
  "finding.schema.json", "lifecycle-event.schema.json", "lifecycle-state.schema.json",
  "narrative-response.schema.json", "report-content.schema.json",
  "report-manifest.schema.json", "report-view-model.schema.json",
  "score.schema.json", "source-result.schema.json",
].forEach((f) => {
  _ajv.addSchema(JSON.parse(readFileSync(resolve(schemasDir, f), "utf-8")), `https://vantage-platform.io/prysm/contracts/v1/${f}`);
});
function validateContract(sid, obj) {
  const v = _ajv.getSchema(sid);
  if (!v) return { valid: false, errors: [{ message: `Schema not loaded: ${sid}` }] };
  const valid = v(obj);
  return { valid, errors: v.errors || [] };
}

// ---------------------------------------------------------------------------
// Controlled provider RESPONSES (below the real adapter layer)
// ---------------------------------------------------------------------------

const SENTINEL = {
  domain: "proof.example.com",
  pageTitle: "Canonical Evidence Proof",
  service: "Governed Evidence Service",
  platform: "ProofCMS",
  schemaType: "ProfessionalService",
};

// DataForSEO On-Page fixture (production fixture mode of the REAL adapter)
const onpageFixtures = {
  taskPost: { taskId: "proof-task-regression" },
  pollTask: { status: "ready" },
  summary: {
    crawl_status: { pages_crawled: 3, max_crawl_pages: 10 },
    domain_info: { checks: {} },
    page_metrics: { links_internal: 6, checks: {} },
  },
  pages: {
    total_count: 3,
    items: [{
      url: `https://${SENTINEL.domain}`,
      status_code: 200,
      meta: {
        title: SENTINEL.pageTitle,
        description: "A governed evidence proof page.",
        h1: [SENTINEL.pageTitle],
        h2: [SENTINEL.service],
        word_count: 300,
        content_language: "en",
        generator: SENTINEL.platform,
        structured_data_types: [SENTINEL.schemaType, "WebSite"],
        plain_text: `${SENTINEL.service} by a certified team. Client testimonials, case studies, FAQ, pricing, and a privacy policy. Contact us.`,
      },
      microdata: { types: [{ type: "Service", name: SENTINEL.service }] },
      checks: {},
    }],
  },
  links: { items: [], total_count: 0 },
  duplicate_tags: { items: [] },
  duplicate_content: { items: [] },
  microdata: { items: [] },
};

const pagespeedFetchImpl = async (url) => {
  const urlStr = String(url);
  if (urlStr.includes("pagespeedonline")) {
    const mobile = /strategy=mobile/.test(urlStr);
    const perf = mobile ? 73 : 88;
    return new Response(JSON.stringify({
      lighthouseResult: {
        categories: { performance: { score: perf / 100 }, accessibility: { score: 0.92 }, "best-practices": { score: 0.85 }, seo: { score: 0.9 } },
        audits: {
          "first-contentful-paint": { numericValue: mobile ? 1200 : 600 },
          "largest-contentful-paint": { numericValue: mobile ? 1800 : 900 },
          "cumulative-layout-shift": { numericValue: 0.05 },
          "total-blocking-time": { numericValue: 100 },
        },
        finalUrl: `https://${SENTINEL.domain}`,
      },
      loadingExperience: {},
    }), { status: 200 });
  }
  return new Response("not found", { status: 404 });
};

// ---------------------------------------------------------------------------
// DE-16: the named permanent regression
// ---------------------------------------------------------------------------

test("DE-16: real On-Page adapter → complete DecisionEvidence → all approved pages render", async () => {
  // Controlled credentials (transport is fully controlled — zero network).
  process.env.DATAFORSEO_LOGIN = "controlled-user";
  process.env.DATAFORSEO_PASSWORD = "controlled-pass";
  try {
    const auditId = randomUUID();
    const tenantId = "t1";
    const clientId = "proof.example.com-prysm-production-proof";
    const executionId = randomUUID();

    const auditRequest = {
      contractVersion: "1.0.0",
      auditId,
      tenantId,
      clientId,
      idempotencyKey: randomUUID(),
      targetUrl: `https://${SENTINEL.domain}`,
      businessName: "Prysm Production Proof",
      market: "Toronto, Ontario, Canada",
      language: "en-CA",
      primaryGoal: "conversion",
      services: [SENTINEL.service],
      competitors: [`https://competitor-proof.example.net`],
      ga4: { propertyId: "400123456" },
      gsc: { siteUrl: `https://${SENTINEL.domain}` },
      crawl: { fixtures: onpageFixtures, maxPages: 10 },
      performance: { fetchImpl: pagespeedFetchImpl },
    };

    const execArgs = {
      auditRequest,
      executionId,
      sourceExecutionKey: randomUUID(),
      signal: new AbortController().signal,
      attempt: 1,
    };

    // ── 1. REAL production adapters with controlled responses ──
    const onpageResult = await onpageExecute({ ...execArgs, source: "dataforseo-onpage" });
    const perfResult = await pagespeedExecute({ ...execArgs, source: "pagespeed" });
    const serpResult = await serpExecute({ ...execArgs, source: "dataforseo-serp" });
    const backlinksResult = await backlinksExecute({ ...execArgs, source: "backlinks" });

    assert.equal(onpageResult.sourceResult.status, "AVAILABLE", "real onpage adapter collected the fixture");
    assert.ok(onpageResult.sourceResult.evidence.domain === SENTINEL.domain, "adapter evidence carries domain sentinel");
    assert.ok(onpageResult.sourceResult.evidence.services?.includes(SENTINEL.service), "adapter evidence carries service sentinel");

    // ── 2. ONE hydration boundary: buildDecisionEvidence ──
    const { evidence, errors } = buildDecisionEvidence({
      allSourceResults: [
        { source: "dataforseo-onpage", sourceResult: onpageResult.sourceResult },
        { source: "pagespeed", sourceResult: perfResult.sourceResult },
        { source: "dataforseo-serp", sourceResult: serpResult.sourceResult },
        { source: "backlinks", sourceResult: backlinksResult.sourceResult },
      ],
      suppliedCompetitors: auditRequest.competitors || [],
      validateContract,
    });
    assert.equal(errors.length, 0, `no hydration errors: ${errors.join("; ")}`);

    // DE-16 core assertion: the six structural fields are DEFINED from the
    // real adapter's controlled provider response.
    assert.equal(evidence.site?.domain, SENTINEL.domain, "site.domain defined from real adapter output");
    assert.ok(Array.isArray(evidence.site?.pages) && evidence.site.pages.length >= 1, "site.pages defined from real adapter output");
    assert.ok(evidence.site?.services?.includes(SENTINEL.service), "site.services defined from real adapter output");
    assert.equal(evidence.site?.trust?.credentials, true, "site.trust defined from real adapter output");
    assert.equal(evidence.site?.platform, SENTINEL.platform, "site.platform defined from real adapter output");
    assert.ok(evidence.site?.schemaTypes?.includes(SENTINEL.schemaType), "site.schemaTypes defined from real adapter output");

    // ── 3. Executable schema validation ──
    const sv = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/decision-evidence.schema.json",
      evidence,
    );
    assert.equal(sv.valid, true, `decision evidence validates: ${JSON.stringify(sv.errors?.slice(0, 3))}`);

    // ── 4. Real production orchestration + REAL renderer ──
    const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
    const lifecycleService = createLifecycleService(createMemoryLifecycleRepository());
    const realAdapters = {
      "dataforseo-onpage": { adapterVersion: "1.3.0", execute: async (a) => onpageExecute(a) },
      pagespeed: { adapterVersion: "1.1.0", execute: async (a) => pagespeedExecute(a) },
      "dataforseo-serp": { adapterVersion: "1.0.0", execute: async (a) => serpExecute(a) },
      backlinks: { adapterVersion: "1.0.0", execute: async (a) => backlinksExecute(a) },
      ga4: { adapterVersion: "1.0.0", execute: async (a) => (await import("./ga4-client.js")).execute(a) },
      gsc: { adapterVersion: "1.0.0", execute: async (a) => (await import("./gsc-client.js")).execute(a) },
    };

    const orchestrator = createAuditOrchestrator({
      lifecycleService,
      artifactStore,
      adapters: realAdapters,
      validateContract,
      clock: { now: () => "2026-01-01T00:00:00.000Z", sleep: async () => {}, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 100)) },
      narrativeMode: "mock",
    });

    let result = await orchestrator.execute(auditRequest, { executionId });
    let previous = null;
    for (let step = 0; step < 6; step++) {
      if (result.finalState === T.DRAFT_RENDERED || result.finalState === previous) break;
      previous = result.finalState;
      result = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
    }
    assert.equal(result.finalState, T.DRAFT_RENDERED, `production path reached draft_rendered (got ${result.finalState})`);

    // ── 5. All approved report pages rendered (authoritative definition) ──
    let renderedPages = 0;
    let sentinelInHtml = false;
    for (const filename of REQUIRED_APPROVED_PAGE_FILENAMES) {
      const pageKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/pages/${filename}`;
      if (await artifactStore.exists(pageKey)) {
        renderedPages++;
        const html = Buffer.from(await artifactStore.get(pageKey)).toString("utf8");
        if (html.includes(SENTINEL.domain)) sentinelInHtml = true;
      }
    }
    assert.equal(renderedPages, REQUIRED_APPROVED_PAGE_FILENAMES.length,
      `all ${REQUIRED_APPROVED_PAGE_FILENAMES.length} approved pages rendered (got ${renderedPages})`);
    assert.equal(sentinelInHtml, true, "sentinel domain present in rendered HTML");

    // ── 6. Persisted decision evidence: load + validate (same contract) ──
    const loaded = await loadAndValidateDecisionEvidence({
      store: artifactStore,
      scope: { tenantId, clientId, auditId },
      validateContract,
    });
    assert.equal(loaded.site.domain, SENTINEL.domain, "persisted decision evidence round-trips the sentinel");
  } finally {
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
  }
});

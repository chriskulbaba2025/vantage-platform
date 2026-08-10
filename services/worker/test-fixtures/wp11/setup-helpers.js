/**
 * WP11 Test Fixture Setup Helpers
 *
 * Prepares the full governed artifact chain so the orchestrator can
 * complete a full CREATED → DRAFT_RENDERED lifecycle.
 *
 * Also provides a test-only listByTenant wrapper for memory repositories
 * so the production memory-repository.js remains unmodified.
 */

import { randomUUID, createHash } from "node:crypto";

function sha256(input) { return createHash("sha256").update(input).digest("hex"); }

/**
 * Wrap a memory lifecycle repository to provide listByTenant for testing.
 * Does NOT modify the production memory-repository.js file.
 */
export function addListByTenantToRepo(lifecycleRepo) {
  // Access internal state through the repo's _clear method to detect if this
  // is a memory repo. If it has _clear, we can instrument it.
  if (typeof lifecycleRepo._clear !== "function") {
    // Not a memory repo — listByTenant should come from the real impl
    return lifecycleRepo;
  }

  // Create a proxy that adds listByTenant using the repo's internal state
  // accessed through the loadEvents tenant-scoping pattern
  const wrapped = Object.create(lifecycleRepo);

  // Store audit metadata during createAudit for later retrieval
  const auditMeta = new Map();

  wrapped.listByTenant = async function (tenantId) {
    const results = [];
    for (const [auditId, meta] of auditMeta) {
      if (meta.tenantId !== tenantId) continue;
      try {
        const events = await lifecycleRepo.loadEvents(auditId, tenantId);
        const latest = events.length > 0 ? events[events.length - 1] : null;
        results.push({
          audit_id: auditId,
          client_id: meta.clientId || "",
          business_name: meta.businessName || "",
          target_url: meta.targetUrl || "",
          created_at: meta.createdAt || (events.length > 0 ? events[0].timestamp : null),
          latest_state: latest ? latest.nextState : "created",
          updated_at: latest ? latest.timestamp : null,
        });
      } catch { /* skip audits that fail tenant isolation */ }
    }
    results.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return results;
  };

  // Hook createAudit to capture metadata
  const origCreate = lifecycleRepo.createAudit.bind(lifecycleRepo);
  wrapped.createAudit = async function (opts) {
    auditMeta.set(opts.auditId, {
      tenantId: opts.tenantId,
      clientId: opts.clientId,
      createdAt: opts.event?.timestamp || new Date().toISOString(),
      businessName: opts.businessName || "",
      targetUrl: opts.targetUrl || "",
    });
    return origCreate(opts);
  };

  return wrapped;
}

/**
 * Seed all required artifacts so the orchestrator can complete the full
 * governed path: collection → evidence → scoring → narrative → rendering.
 */
export async function seedGovernedArtifacts({
  artifactStore, lifecycle, lifecycleRepo, validateContract,
  auditId, tenantId, clientId, targetUrl, businessName,
}) {
  const T = (await import("../../src/lifecycle/state-enum.js")).LIFECYCLE_STATE;
  const { buildArtifactKey } = await import("../../src/storage/artifact-key.js");

  // 1. Create lifecycle
  try {
    await lifecycle.create({ auditId, tenantId, clientId, idempotencyKey: randomUUID() });
  } catch (e) {
    if (e.code !== "ERR_LIFECYCLE_DUPLICATE_AUDIT") throw e;
  }

  // 2. Seed canonical evidence (minimal)
  const canonicalEvidence = {
    contractVersion: "1.0.0", evidenceVersion: "1.0.0",
    auditId,
    normalizedRequest: { targetUrl, businessName, market: "", language: "en-CA", primaryGoal: "", services: [], competitors: [] },
    sources: {
      website: { source: "dataforseo-onpage", status: "AVAILABLE", provider: "mock", adapterVersion: "1.0.0", collectedAt: new Date().toISOString() },
      performance: { source: "pagespeed", status: "AVAILABLE", provider: "mock", adapterVersion: "1.0.0", collectedAt: new Date().toISOString() },
      competitors: { source: "dataforseo-serp", status: "NOT_APPLICABLE", provider: "mock", adapterVersion: "1.0.0" },
      backlinks: { source: "backlinks", status: "NOT_CONNECTED", provider: "mock", adapterVersion: "1.0.0" },
      ga4: { source: "ga4", status: "NOT_CONNECTED", provider: "mock", adapterVersion: "1.0.0" },
      gsc: { source: "gsc", status: "NOT_CONNECTED", provider: "mock", adapterVersion: "1.0.0" },
    },
    limitations: [],
    artifactReferences: [],
    adapterVersions: { "dataforseo-onpage": "1.0.0", pagespeed: "1.0.0", "dataforseo-serp": "1.0.0", backlinks: "1.0.0", ga4: "1.0.0", gsc: "1.0.0" },
    createdAt: new Date().toISOString(),
  };

  const evidenceBytes = Buffer.from(JSON.stringify(canonicalEvidence), "utf-8");
  const evidenceKey = buildArtifactKey({ tenantId, clientId, auditId, category: "canonical", artifactName: "evidence.json" });
  await artifactStore.put({ bytes: evidenceBytes, contentType: "application/json", scope: { tenantId, clientId, auditId, category: "canonical", artifactName: "evidence.json" } });

  // 3. Seed scores
  const scores = {
    contractVersion: "1.0.0", scoringVersion: "3.0.0", generatedAt: new Date().toISOString(),
    scores: { trust: 50, contentDepth: 50, conversionPathways: 50, technical: 50, performance: 50, conversionReadiness: 50 },
    bands: { conversionReadiness: "Moderate" },
    assessedWeight: 75, readinessStatus: "Provisional", showNumericScore: true, evidenceConfidenceScore: 70,
    rootCause: "", findings: [], dimensionEligibility: {}, moduleEligibility: {}, suppressedModules: [],
    evidence: {},
  };
  const scoresBytes = Buffer.from(JSON.stringify(scores), "utf-8");
  const scoresKey = buildArtifactKey({ tenantId, clientId, auditId, category: "canonical", artifactName: "scores.json" });
  await artifactStore.put({ bytes: scoresBytes, contentType: "application/json", scope: { tenantId, clientId, auditId, category: "canonical", artifactName: "scores.json" } });

  // 4. Seed findings
  const findings = [];
  const findingsBytes = Buffer.from(JSON.stringify(findings), "utf-8");
  await artifactStore.put({ bytes: findingsBytes, contentType: "application/json", scope: { tenantId, clientId, auditId, category: "canonical", artifactName: "findings.json" } });

  // 5. Seed report-content package (WP8)
  const reportPackage = {
    contractVersion: "1.0.0", auditId,
    business: { name: businessName, domain: (() => { try { return new URL(targetUrl).hostname; } catch { return targetUrl; } })(), platform: "Unknown" },
    siteMetrics: { services: [] },
    sourceStatus: { website: "AVAILABLE", performance: "AVAILABLE", competitors: "NOT_APPLICABLE", backlinks: "NOT_CONNECTED", ga4: "NOT_CONNECTED", gsc: "NOT_CONNECTED" },
    limitations: [], competitors: [],
    assessedWeight: 75, readinessStatus: "Provisional", showNumericScore: true, evidenceConfidenceScore: 70,
    rootCause: "", scoringVersion: "3.0.0",
  };
  const pkgBytes = Buffer.from(JSON.stringify(reportPackage), "utf-8");
  await artifactStore.put({ bytes: pkgBytes, contentType: "application/json", scope: { tenantId, clientId, auditId, category: "report", artifactName: "report-content.json" } });

  // 6. Seed narrative response (WP9)
  const narrative = {
    contractVersion: "1.0.0", schemaVersion: "1.0.0", auditId, modelId: "prysm-wp9-mock",
    narrativeVersion: "1.0.0", generatedAt: new Date().toISOString(),
    executiveSummary: "Test executive summary.",
    priorityFixesNarrative: "Test priority fixes.",
    conversionPathNarrative: "Test conversion path.",
    readinessMapNarrative: "Test readiness map.",
    contentIdeasNarrative: "Test content ideas.",
    competitorBenchmarkNarrative: "Test competitor benchmark.",
    trustEeatNarrative: "Test trust EEAT.",
    cmsConstraintsNarrative: "Test CMS constraints.",
    technicalSeoNarrative: "Test technical SEO.",
    headingsNarrative: "Test headings.",
    schemaNarrative: "Test schema.",
    performanceNarrative: "Test performance.",
    internalLinksNarrative: "Test internal links.",
    evidenceAppendixNarrative: "Test evidence appendix.",
    deferredAnalysisNarrative: "Test deferred analysis.",
    limitations: [],
  };
  const narrBytes = Buffer.from(JSON.stringify(narrative), "utf-8");
  await artifactStore.put({ bytes: narrBytes, contentType: "application/json", scope: { tenantId, clientId, auditId, category: "report", artifactName: "narrative.json" } });

  // 7. Transition lifecycle through full path
  const executionId = randomUUID();
  const orderedStates = [
    T.VALIDATED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED,
    T.SCORED, T.NARRATIVE_PENDING, T.NARRATIVE_READY, T.DRAFT_RENDERED,
  ];
  for (const state of orderedStates) {
    await lifecycle.transition({
      auditId, tenantId, toState: state,
      transitionIdempotencyKey: `${auditId}:${state}:${executionId}`,
    });
  }

  return { auditId, tenantId, clientId, executionId };
}

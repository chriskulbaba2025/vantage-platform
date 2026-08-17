/**
 * Prysm governed production runtime.
 *
 * This is the single production composition boundary used by server.js and
 * the production-runtime acceptance harness.
 */

import { randomUUID } from "node:crypto";
import { createAuditOrchestrator } from "../orchestration/audit-orchestrator.js";
import { validateNarrativeConfiguration } from "../narrative/narrative-configuration.js";
import { persistAuditRequest, loadAuditRequest } from "../orchestration/audit-request-persistence.js";
import { createAuditApplicationService } from "./audit-service.js";
import { createLifecycleService } from "../lifecycle/lifecycle-service.js";
import { LIFECYCLE_STATE } from "../lifecycle/state-enum.js";
import { REQUIRED_APPROVED_PAGE_FILENAMES } from "../storage/report-store.js";
import {
  createProductionAdapters,
  createProductionContractValidator,
} from "./production-bootstrap.js";

const T = LIFECYCLE_STATE;
const AUDIT_REQUEST_SCHEMA = "https://vantage-platform.io/prysm/contracts/v1/audit-request.schema.json";
const FAILURE_STATES = new Set([
  T.VALIDATION_FAILED,
  T.COLLECTION_FAILED,
  T.NARRATIVE_FAILED,
  T.RENDER_FAILED,
  T.APPROVAL_REJECTED,
  T.PUBLISH_FAILED,
]);

function normalizeUrl(raw) {
  let value = String(raw || "").trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try { return new URL(value).href; } catch { return value; }
}

function deriveBusinessName(targetUrl, supplied) {
  const explicit = String(supplied || "").trim();
  if (explicit) return explicit;
  try {
    const host = new URL(normalizeUrl(targetUrl)).hostname.replace(/^www\./i, "");
    return host.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  } catch {
    return "Website Audit";
  }
}

function slugify(value) {
  return String(value || "audit")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function buildClientId(targetUrl, businessName) {
  const normalized = normalizeUrl(targetUrl);
  const host = (() => { try { return new URL(normalized).hostname; } catch { return normalized; } })();
  const safeHost = host.replace(/[^a-zA-Z0-9.-]/g, "-");
  const safeBusiness = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${safeHost}-${safeBusiness}`;
}

function injectedAdaptersAreValid(adapters) {
  const keys = ["dataforseo-onpage", "pagespeed", "dataforseo-serp", "backlinks", "ga4", "gsc"];
  return Boolean(adapters) && keys.every((key) =>
    adapters[key] &&
    typeof adapters[key].execute === "function" &&
    typeof adapters[key].adapterVersion === "string" &&
    adapters[key].adapterVersion.length > 0
  );
}

function resolveValidator(injected) {
  if (typeof injected === "function") {
    try {
      const probe = injected(AUDIT_REQUEST_SCHEMA, {});
      if (probe && typeof probe.valid === "boolean") return injected;
    } catch {
      // Broken/uncompiled production validator: fall through to the compiled one.
    }
  }
  return createProductionContractValidator();
}

async function loadAuditMetadata(lifecycleRepo, auditId, tenantId) {
  if (typeof lifecycleRepo.getAuditMetadata === "function") {
    return lifecycleRepo.getAuditMetadata(auditId, tenantId);
  }
  if (typeof lifecycleRepo.listByTenant === "function") {
    const rows = await lifecycleRepo.listByTenant(tenantId, 100, 0);
    return rows.find((row) => (row.audit_id || row.auditId) === auditId) || null;
  }
  return null;
}

/** Construct the governed production runtime. */
export function createProductionRuntime({
  config,
  adapters,
  validateContract,
  artifactStore,
  lifecycleRepo,
  reportStore,
  narrative,
}) {
  if (!lifecycleRepo) {
    throw new Error("PRODUCTION STARTUP FAILED: lifecycleRepo is required (DATABASE_URL not configured?)");
  }
  if (!artifactStore) {
    throw new Error("PRODUCTION STARTUP FAILED: artifactStore is required");
  }
  if (!reportStore) {
    throw new Error("PRODUCTION STARTUP FAILED: reportStore is required");
  }

  const lifecycleService = createLifecycleService(lifecycleRepo);
  const runtimeAdapters = injectedAdaptersAreValid(adapters) ? adapters : createProductionAdapters();
  const runtimeValidateContract = resolveValidator(validateContract);

  // Resolve narrative mode from environment/config.
  // MOCK = development/CI, REPLAY = staging/deterministic replay, LIVE = production.
  const narrativeMode = config.narrativeMode || (process.env.PRYSM_LLM_MODE === "live" ? "live" : process.env.PRYSM_LLM_MODE === "replay" ? "replay" : "mock");

  // PRYSM-CLOSE-08: validate narrative mode dependencies at configuration
  // time.  A missing dependency fails startup BEFORE any audit executes.
  const narrativeDeps = narrative || {};
  const narrativeValidation = validateNarrativeConfiguration({
    mode: narrativeMode,
    cacheStore: narrativeDeps.cacheStore,
    modelClient: narrativeDeps.modelClient,
    budget: narrativeDeps.budget,
    priceTable: narrativeDeps.priceTable,
    modelConfig: narrativeDeps.modelConfig,
  });
  if (!narrativeValidation.valid) {
    throw new Error(
      "PRODUCTION STARTUP FAILED: " + narrativeValidation.errors.join(" "),
    );
  }

  const orchestrator = createAuditOrchestrator({
    lifecycleService,
    artifactStore,
    adapters: runtimeAdapters,
    validateContract: runtimeValidateContract,
    clock: {
      now: () => new Date().toISOString(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
    },
    narrativeMode,
    narrativeDependencies: {
      cacheStore: narrativeDeps.cacheStore,
      modelClient: narrativeDeps.modelClient,
      budget: narrativeDeps.budget,
      priceTable: narrativeDeps.priceTable,
      modelConfig: narrativeDeps.modelConfig,
    },
    retryPolicyResolver: (source) => {
      // PRYSM-CLOSE-12: source-specific governed timeouts, each configurable.
      //   on-page crawls can take minutes (polling DataForSEO)
      //   PageSpeed/Lighthouse typically completes in 30-60s
      //   API-based adapters (SERP, backlinks, GA4, GSC) complete faster
      const sourceTimeouts = {
        "dataforseo-onpage": config.onpagePollTimeoutMs || 600_000,
        "pagespeed":          config.pagespeedTimeoutMs || 120_000,
        "dataforseo-serp":    config.serpTimeoutMs || 60_000,
        "backlinks":          config.backlinksTimeoutMs || 60_000,
        "ga4":                config.ga4TimeoutMs || 60_000,
        "gsc":                config.gscTimeoutMs || 60_000,
      };
      return {
        timeoutMs: sourceTimeouts[source] || 60_000,
        maxAttempts: 3,
        retryable: (err) => {
          // Must match the hard-timeout category from executeWithRetry
          if (err?.category === "timeout") return true;
          if (err?.category === "network" && err?.statusCode >= 500) return true;
          if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ECONNREFUSED" || err?.code === "ENOTFOUND") return true;
          return false;
        },
        delayMs: (attempt) => Math.min(1000 * Math.pow(2, attempt), 30_000),
      };
    },
  });

  const baseAuditService = createAuditApplicationService({
    orchestrator,
    lifecycleRepo,
    lifecycleService,
    artifactStore,
    reportStore,
    config,
    validateContract: runtimeValidateContract,
  });

  async function runAuditToReviewableDraft({ auditRequest, executionId, slug }) {
    let result = await orchestrator.execute(auditRequest, { executionId });
    let previousState = null;

    for (let step = 0; step < 4; step++) {
      if (result.finalState === T.DRAFT_RENDERED || FAILURE_STATES.has(result.finalState)) break;
      if (result.finalState === previousState) break;
      previousState = result.finalState;
      result = await orchestrator.execute(auditRequest, { executionId });
    }

    // WP10 stores the immutable client pages in the governed Artifact Store.
    // The report store owns only the human-review lifecycle, so initialise its
    // draft record once the governed draft exists. This does not alter the
    // governed report-page bytes.
    if (result.finalState === T.DRAFT_RENDERED && typeof reportStore.writeReport === "function") {
      const indexHtml = result.renderedPages instanceof Map
        ? (result.renderedPages.get("index.html") || "")
        : "";
      await reportStore.writeReport({
        slug,
        runId: auditRequest.auditId,
        model: { evidence: {} },
        manifest: {
          auditId: auditRequest.auditId,
          lifecycleStatus: T.DRAFT_RENDERED,
          governedManifestKey: result.manifestKey || null,
        },
        html: indexHtml,
        includeIndexHtml: Boolean(indexHtml),
      });
    }

    return result;
  }

  /**
   * Start one real audit without holding a Vercel request open for provider,
   * narrative, and render work. Railway continues the governed job while the
   * browser polls canonical lifecycle status.
   */
  async function createAudit(input, tenantId) {
    const targetUrl = normalizeUrl(input.targetUrl);
    const businessName = deriveBusinessName(targetUrl, input.businessName);
    const auditId = randomUUID();
    const clientId = buildClientId(targetUrl, businessName);
    const idempotencyKey = `web:${auditId}`;
    const executionId = randomUUID();
    const slug = slugify(businessName);

    const auditRequest = {
      contractVersion: "1.0.0",
      auditId,
      tenantId,
      clientId,
      idempotencyKey,
      targetUrl,
      businessName,
      market: input.market || "",
      language: input.language || "en-CA",
      primaryGoal: input.primaryGoal || "",
      services: input.services || [],
      competitors: input.competitors || [],
    };
    if (input.ga4?.propertyId) auditRequest.ga4 = { propertyId: String(input.ga4.propertyId).replace(/\D/g, "") };
    if (input.gsc?.siteUrl) auditRequest.gsc = { siteUrl: String(input.gsc.siteUrl).trim() };

    // Governed optional configuration pass-through (schema-validated):
    // crawl overrides, performance configuration, SERP/backlinks config,
    // and controlled-dependency seams below the production adapter layer.
    if (input.crawl && typeof input.crawl === "object") {
      auditRequest.crawl = { ...(auditRequest.crawl || {}), ...input.crawl };
    }
    if (input.performance && typeof input.performance === "object") {
      auditRequest.performance = input.performance;
    }
    if (input.serp && typeof input.serp === "object") {
      auditRequest.serp = input.serp;
    }
    if (input.backlinks && typeof input.backlinks === "object") {
      auditRequest.backlinks = input.backlinks;
    }
    if (input.ga4 && typeof input.ga4 === "object") {
      if (auditRequest.ga4) {
        if (input.ga4.oauthService) auditRequest.ga4.oauthService = input.ga4.oauthService;
        if (input.ga4.fetchImpl) auditRequest.ga4.fetchImpl = input.ga4.fetchImpl;
        if (input.ga4.serviceAccountJson) auditRequest.ga4.serviceAccountJson = input.ga4.serviceAccountJson;
      }
    }
    if (input.gsc && typeof input.gsc === "object") {
      if (auditRequest.gsc) {
        if (input.gsc.oauthService) auditRequest.gsc.oauthService = input.gsc.oauthService;
        if (input.gsc.fetchImpl) auditRequest.gsc.fetchImpl = input.gsc.fetchImpl;
        if (input.gsc.serviceAccountJson) auditRequest.gsc.serviceAccountJson = input.gsc.serviceAccountJson;
        if (input.gsc.sufficiencyThreshold != null) auditRequest.gsc.sufficiencyThreshold = input.gsc.sufficiencyThreshold;
      }
    }

    const validation = runtimeValidateContract(AUDIT_REQUEST_SCHEMA, auditRequest);
    if (!validation.valid) {
      const err = new Error("Audit request validation failed");
      err.statusCode = 422;
      err.errors = validation.errors;
      throw err;
    }

    // Persist the audit identity before returning the HTTP response. The
    // orchestrator reuses the same idempotency identity when background work
    // starts, so this is safe and restart-observable.
    await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey });
    if (typeof lifecycleRepo.updateAuditMetadata === "function") {
      await lifecycleRepo.updateAuditMetadata(auditId, tenantId, { businessName, targetUrl });
    }

    // PRYSM-CLOSE-09: persist the complete normalized AuditRequest durably.
    await persistAuditRequest({
      store: artifactStore,
      auditRequest,
      validateContract: runtimeValidateContract,
    });

    Promise.resolve()
      .then(() => runAuditToReviewableDraft({ auditRequest, executionId, slug }))
      .catch((error) => {
        console.error(`Audit ${auditId} background execution failed:`, error);
      });

    return {
      auditId,
      tenantId,
      clientId,
      executionId,
      finalState: T.CREATED,
      slug,
      backgroundStarted: true,
    };
  }

  const RESUMABLE_STATES = new Set([T.SCORED, T.NARRATIVE_PENDING, T.NARRATIVE_READY]);

  async function resumeAudit(auditId, tenantId) {
    const meta = await loadAuditMetadata(lifecycleRepo, auditId, tenantId).catch(() => null);
    if (!meta) return null;
    const current = await lifecycleService.currentState(auditId, tenantId);
    if (!current || !RESUMABLE_STATES.has(current.state)) return current?.state || null;

    const businessName = meta.business_name || meta.businessName || "";
    const clientId = meta.client_id || meta.clientId || current.clientId || "";
    const executionId = randomUUID();

    // PRYSM-CLOSE-09: load the complete persisted AuditRequest.  Recovery
    // never reconstructs missing values with defaults — the persisted record
    // is the only source for the resumed execution.
    const auditRequest = await loadAuditRequest({
      store: artifactStore,
      scope: { tenantId, clientId, auditId },
      validateContract: runtimeValidateContract,
    });
    if (!auditRequest) {
      throw new Error(
        `Cannot resume audit ${auditId}: persisted AuditRequest not found (durable record required)`,
      );
    }

    let result = await orchestrator.execute(auditRequest, { executionId });
    let previousState = null;
    for (let step = 0; step < 4; step++) {
      if (result.finalState === T.DRAFT_RENDERED || FAILURE_STATES.has(result.finalState)) break;
      if (result.finalState === previousState) break;
      previousState = result.finalState;
      result = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
    }

    // Surface WP8/narrative errors in the resume response
    const error = result.wp8Error || null;

    // If draft rendered, ensure report store is initialized
    if (result.finalState === T.DRAFT_RENDERED && typeof reportStore.writeReport === "function") {
      const slug = slugify(businessName);
      try {
        const existing = await reportStore.getStatus(slug, auditId).catch(() => null);
        if (!existing || existing.status !== "draft_rendered") {
          await reportStore.writeReport({
            slug,
            runId: auditId,
            model: { evidence: {} },
            manifest: { auditId, lifecycleStatus: T.DRAFT_RENDERED, governedManifestKey: null },
            html: "",
            includeIndexHtml: false,
          });
        }
      } catch { /* best-effort sync */ }
    }

    return { finalState: result.finalState, error };
  }

  /**
   * PRYSM-CLOSE-10: reclaim audits stranded by process interruption.
   *
   * The durable work record is the persisted lifecycle state (PostgreSQL),
   * the persisted complete AuditRequest (C9), and the governed artifacts
   * (S3).  An audit left in an active state after a process restart is
   * reclaimed here and driven forward from its exact persisted state.
   *
   * Execution is state-driven and idempotent — completed transitions are
   * never repeated, paid provider work is never duplicated, and already
   * rendered audits are left untouched.
   *
   * @param {string} tenantId
   * @returns {Promise<Array<{ auditId: string, finalState: string }>>}
   */
  const STRANDED_ACTIVE_STATES = new Set([
    T.CREATED, T.VALIDATED, T.COLLECTING, T.COLLECTION_FAILED,
    T.EVIDENCE_STORED, T.EVIDENCE_LOCKED, T.SCORED,
    T.NARRATIVE_PENDING, T.NARRATIVE_FAILED, T.NARRATIVE_READY,
    T.RENDER_FAILED,
  ]);

  async function recoverStrandedAudits(tenantId) {
    if (typeof lifecycleRepo.listByTenant !== "function") {
      return Object.freeze([]);
    }
    const rows = await lifecycleRepo.listByTenant(tenantId, 100, 0);
    const recovered = [];

    for (const row of rows) {
      const auditId = row.audit_id;
      const current = await lifecycleService.currentState(auditId, tenantId).catch(() => null);
      if (!current || !STRANDED_ACTIVE_STATES.has(current.state)) continue;

      const clientId = current.clientId || row.client_id || "";
      const auditRequest = await loadAuditRequest({
        store: artifactStore,
        scope: { tenantId, clientId, auditId },
        validateContract: runtimeValidateContract,
      }).catch(() => null);

      if (!auditRequest) {
        // Cannot reclaim without the durable request record — fail closed.
        console.error(`[recoverStrandedAudits] audit ${auditId} stranded at ${current.state} but persisted AuditRequest missing`);
        recovered.push(Object.freeze({ auditId, finalState: current.state, recovered: false }));
        continue;
      }

      let result = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
      let previousState = null;
      for (let step = 0; step < 8; step++) {
        if (result.finalState === T.DRAFT_RENDERED || FAILURE_STATES.has(result.finalState)) break;
        if (result.finalState === previousState) break;
        previousState = result.finalState;
        result = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
      }
      recovered.push(Object.freeze({ auditId, finalState: result.finalState, recovered: true }));
    }

    return Object.freeze(recovered);
  }

  async function getAuditStatus(auditId, tenantId) {
    const status = await baseAuditService.getAuditStatus(auditId, tenantId);
    if (!status) return null;
    const current = await lifecycleService.currentState(auditId, tenantId);
    const meta = await loadAuditMetadata(lifecycleRepo, auditId, tenantId).catch(() => null);
    const businessName = meta?.business_name || meta?.businessName || "";
    const targetUrl = meta?.target_url || meta?.targetUrl || "";

    return {
      ...status,
      clientId: current?.clientId || meta?.client_id || meta?.clientId || "",
      businessName,
      targetUrl,
      slug: slugify(businessName || targetUrl || auditId),
    };
  }

  async function submitReview(auditId, tenantId, slug, reviewer, checklist) {
    const current = await lifecycleService.currentState(auditId, tenantId);
    if (!current) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });
    if (current.state !== T.DRAFT_RENDERED && current.state !== T.IN_REVIEW) {
      throw Object.assign(new Error(`Cannot review audit in ${current.state} state`), { statusCode: 409 });
    }

    const result = await baseAuditService.submitReview(auditId, tenantId, slug, reviewer, checklist);
    if (current.state === T.DRAFT_RENDERED) {
      await lifecycleService.transition({
        auditId,
        tenantId,
        toState: T.IN_REVIEW,
        expectedState: T.DRAFT_RENDERED,
        expectedVersion: current.version,
        transitionIdempotencyKey: `${auditId}:human-review-complete`,
        actor: reviewer,
        reason: "human review checklist completed",
      });
    }
    // Preserve the report-store compatibility status (`reviewed`) while the
    // canonical PostgreSQL lifecycle is `in_review`.
    return result;
  }

  async function approveAudit(auditId, tenantId, slug, approver, pages) {
    const current = await lifecycleService.currentState(auditId, tenantId);
    if (!current) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });
    if (current.state !== T.IN_REVIEW && current.state !== T.APPROVED) {
      throw Object.assign(new Error(`Cannot approve audit in ${current.state} state`), { statusCode: 409 });
    }

    let governedPages = pages;
    if (!(governedPages instanceof Map)) {
      // PRYSM-NEXT-ACTIVATION defect C — report-design v2 audits have a v2
      // artifact contract (report-v2/), NOT the locked v1 16-page set.
      // Detect the design version first; the base approval branch then
      // validates the correct artifact contract.  Historical v1 approval
      // behaviour (16-page preload + 422 on missing pages) is unchanged.
      const v2ManifestKey = `tenants/${tenantId}/clients/${current.clientId}/audits/${auditId}/report-v2/manifest.json`;
      let v2ManifestBytes = null;
      try {
        v2ManifestBytes = await artifactStore.get(v2ManifestKey);
      } catch {
        v2ManifestBytes = null;
      }
      if (v2ManifestBytes && v2ManifestBytes.length > 0) {
        governedPages = new Map();
      } else {
        governedPages = new Map();
        for (const filename of REQUIRED_APPROVED_PAGE_FILENAMES) {
          const key = `tenants/${tenantId}/clients/${current.clientId}/audits/${auditId}/report/pages/${filename}`;
          let bytes = null;
          try {
            bytes = await artifactStore.get(key);
          } catch {
            bytes = null; // store implementations differ on missing-key semantics
          }
          if (!bytes) throw Object.assign(new Error(`Draft report page missing: ${filename}`), { statusCode: 422 });
          governedPages.set(filename, Buffer.from(bytes).toString("utf8"));
        }
      }
    }

    const result = await baseAuditService.approveAudit(auditId, tenantId, slug, approver, governedPages);
    if (current.state === T.IN_REVIEW) {
      await lifecycleService.transition({
        auditId,
        tenantId,
        toState: T.APPROVED,
        expectedState: T.IN_REVIEW,
        expectedVersion: current.version,
        transitionIdempotencyKey: `${auditId}:human-approval-complete`,
        actor: approver,
        reason: "human approval completed",
      });
    }
    return { ...result, status: T.APPROVED };
  }

  /**
   * PRYSM-CLOSE-14: publish an approved report through the real production
   * publication path: APPROVED → report-store publication (verified
   * artifacts) → PUBLISHED.  On any failure the canonical lifecycle goes
   * to PUBLISH_FAILED — no partial publication.
   */
  async function publishAudit(auditId, tenantId, slug) {
    const current = await lifecycleService.currentState(auditId, tenantId);
    if (!current) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });

    if (current.state === T.PUBLISHED) {
      // Idempotent — publication already completed
      const lifecycle = await reportStore.getStatus(slug, auditId).catch(() => null);
      return {
        auditId,
        tenantId,
        status: T.PUBLISHED,
        publishedAt: lifecycle?.publishedAt || null,
        artifacts: lifecycle?.artifacts?.final || [],
      };
    }

    if (current.state !== T.APPROVED) {
      throw Object.assign(
        new Error(`Cannot publish audit in ${current.state} state`),
        { statusCode: 409, lifecycleStatus: current.state },
      );
    }

    let published;
    try {
      published = await reportStore.publishReport(slug, auditId);
    } catch (publishErr) {
      try {
        await lifecycleService.transition({
          auditId,
          tenantId,
          toState: T.PUBLISH_FAILED,
          transitionIdempotencyKey: `${auditId}:publication-failed:${publishErr.code || "error"}`,
          reason: `publication failed: ${publishErr.message}`.slice(0, 300),
        });
      } catch { /* already transitioned */ }
      throw publishErr;
    }

    await lifecycleService.transition({
      auditId,
      tenantId,
      toState: T.PUBLISHED,
      transitionIdempotencyKey: `${auditId}:publication-complete`,
      actor: "system",
      reason: "report published",
    });

    return {
      auditId,
      tenantId,
      status: T.PUBLISHED,
      publishedAt: published.publishedAt,
      publication: published.publication || null,
      artifacts: published.artifacts?.final || [],
    };
  }

  /**
   * PRYSM-CLOSE-14: client-facing published report retrieval.
   * ONLY the PUBLISHED lifecycle state is served — draft/review/approved
   * states are never exposed through this path.
   */
  async function getPublishedReportPage(auditId, tenantId, slug, filename) {
    const current = await lifecycleService.currentState(auditId, tenantId);
    if (!current) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });
    if (current.state !== T.PUBLISHED) {
      throw Object.assign(
        new Error("Report not published"),
        { statusCode: 403, code: "REPORT_NOT_PUBLISHED", lifecycleStatus: current.state },
      );
    }

    // Validate filename against published artifacts
    if (!REQUIRED_APPROVED_PAGE_FILENAMES.includes(filename)) {
      const err = new Error("Page not found in published report");
      err.statusCode = 404;
      throw err;
    }

    // Publication record must exist with status published.  Read the raw
    // lifecycle (which carries publishedAt) when the store exposes it.
    let publishedAt = null;
    if (typeof reportStore._readLifecycle === "function") {
      const raw = await reportStore._readLifecycle(slug, auditId).catch(() => null);
      if (!raw || raw.status !== "published") {
        throw Object.assign(
          new Error("Report publication record missing"),
          { statusCode: 404, code: "REPORT_NOT_PUBLISHED" },
        );
      }
      publishedAt = raw.publishedAt || null;
    } else {
      const lifecycle = await reportStore.getStatus(slug, auditId).catch(() => null);
      if (lifecycle?.status !== "published") {
        throw Object.assign(
          new Error("Report publication record missing"),
          { statusCode: 404, code: "REPORT_NOT_PUBLISHED" },
        );
      }
    }

    const artifactKey = `tenants/${tenantId}/clients/${current.clientId}/audits/${auditId}/report/pages/${filename}`;
    const bytes = await artifactStore.get(artifactKey);
    if (!bytes) {
      const err = new Error("Report file not found");
      err.statusCode = 404;
      throw err;
    }

    return {
      filename,
      bytes,
      contentType: "text/html; charset=utf-8",
      lifecycleStatus: T.PUBLISHED,
      publishedAt,
    };
  }

  const auditService = Object.freeze({
    ...baseAuditService,
    createAudit,
    getAuditStatus,
    submitReview,
    approveAudit,
    resumeAudit,
    publishAudit,
    getPublishedReportPage,
  });

  return Object.freeze({
    auditService,
    orchestrator,
    lifecycleService,
    artifactStore,
    reportStore,
    adapters: runtimeAdapters,
    validateContract: runtimeValidateContract,
    recoverStrandedAudits,
  });
}

export default { createProductionRuntime };

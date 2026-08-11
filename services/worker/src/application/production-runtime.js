/**
 * Prysm governed production runtime.
 *
 * This is the single production composition boundary used by server.js and
 * the production-runtime acceptance harness.
 */

import { randomUUID } from "node:crypto";
import { createAuditOrchestrator } from "../orchestration/audit-orchestrator.js";
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
    retryPolicyResolver: () => ({
      timeoutMs: config.onpagePollTimeoutMs || 600_000,
      maxAttempts: 3,
      retryable: (err) => {
        if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ENOTFOUND") return true;
        if (err?.statusCode && err.statusCode >= 500 && err.statusCode < 600) return true;
        return false;
      },
      delayMs: (attempt) => Math.min(1000 * Math.pow(2, attempt), 30_000),
    }),
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
    const targetUrl = meta.target_url || meta.targetUrl || "";
    const clientId = meta.client_id || meta.clientId || current.clientId || "";
    const executionId = randomUUID();
    const auditRequest = {
      contractVersion: "1.0.0",
      auditId,
      tenantId,
      clientId,
      idempotencyKey: `${auditId}:resume:${Date.now()}`,
      targetUrl: targetUrl || "https://unknown",
      businessName,
      market: "",
      language: "en-CA",
      primaryGoal: "",
      services: [],
      competitors: [],
    };

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
      governedPages = new Map();
      for (const filename of REQUIRED_APPROVED_PAGE_FILENAMES) {
        const key = `tenants/${tenantId}/clients/${current.clientId}/audits/${auditId}/report/pages/${filename}`;
        const bytes = await artifactStore.get(key);
        if (!bytes) throw Object.assign(new Error(`Draft report page missing: ${filename}`), { statusCode: 422 });
        governedPages.set(filename, Buffer.from(bytes).toString("utf8"));
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

  const auditService = Object.freeze({
    ...baseAuditService,
    createAudit,
    getAuditStatus,
    submitReview,
    approveAudit,
    resumeAudit,
  });

  return Object.freeze({
    auditService,
    orchestrator,
    lifecycleService,
    artifactStore,
    reportStore,
    adapters: runtimeAdapters,
    validateContract: runtimeValidateContract,
  });
}

export default { createProductionRuntime };

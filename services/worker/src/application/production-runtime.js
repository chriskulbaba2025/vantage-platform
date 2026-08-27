/**
 * Prysm governed production runtime.
 *
 * This is the single production composition boundary used by server.js and
 * the production-runtime acceptance harness.
 */

import { randomUUID } from "node:crypto";
import { createAuditOrchestrator } from "../orchestration/audit-orchestrator.js";
import {
  createNarrativeV2ProductionPath,
  renderNarrativeV2UatFromPersistedArtifacts,
} from "../narrative-v2/production-path.js";
import { createNarrativeV2LiveBinding } from "../narrative-v2/live-binding.js";
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
  narrativeV2,
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

  // PRYSM-NARRATIVE-V2-LIVE-01 — when no test/controlled Narrative v2
  // executors are injected, compose the explicit env-driven live binding.
  // It is disabled by default and performs no network action at startup.
  const automaticNarrativeV2 = narrativeV2 === undefined
    ? createNarrativeV2LiveBinding({ artifactStore })
    : null;
  const narrativeV2Deps = narrativeV2 ?? automaticNarrativeV2 ?? {};
  const narrativeV2Enabled = narrativeV2Deps.enabled === true;

  if (narrativeV2Enabled && (
    typeof narrativeV2Deps.writerExecutor !== "function" ||
    typeof narrativeV2Deps.judgeExecutor !== "function"
  )) {
    throw new Error(
      "PRODUCTION STARTUP FAILED: Narrative v2 requires writerExecutor and judgeExecutor when enabled",
    );
  }

  // Resolve the legacy WP9 narrative mode. When the automatic Narrative v2
  // live binding is explicitly enabled and no legacy narrative client is
  // supplied, keep WP9 in MOCK mode. This prevents the v2 live switch from
  // accidentally activating legacy narrative calls. A deliberately injected
  // legacy narrative client still follows PRYSM_LLM_MODE as before.
  const configuredNarrativeMode = config.narrativeMode || (process.env.PRYSM_LLM_MODE === "live" ? "live" : process.env.PRYSM_LLM_MODE === "replay" ? "replay" : "mock");
  const narrativeMode = automaticNarrativeV2?.enabled === true && !narrative
    ? "mock"
    : configuredNarrativeMode;

  // PRYSM-CLOSE-08: validate legacy narrative mode dependencies at
  // configuration time. Missing dependencies fail startup before an audit.
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

  const runtimeClock = {
    now: () => new Date().toISOString(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  };

  // Keep the proven base orchestrator unchanged. Narrative v2 is composed as
  // an additive wrapper at the production boundary and delegates every
  // non-v2 request/state directly to this base instance.
  const baseOrchestrator = createAuditOrchestrator({
    lifecycleService,
    artifactStore,
    adapters: runtimeAdapters,
    validateContract: runtimeValidateContract,
    clock: runtimeClock,
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
        // On-Page has a 30-minute provider poll budget inside the adapter
        // and a separate 60-minute whole-source orchestration safety ceiling.
        "dataforseo-onpage": 3_600_000,
        "pagespeed":          config.pagespeedTimeoutMs || 120_000,
        "dataforseo-serp":    config.serpTimeoutMs || 1_800_000,
        "backlinks":          config.backlinksTimeoutMs || 60_000,
        "ga4":                config.ga4TimeoutMs || 60_000,
        "gsc":                config.gscTimeoutMs || 60_000,
      };

      return {
        timeoutMs: sourceTimeouts[source] || 60_000,
        maxAttempts:
          source === "dataforseo-serp" ||
          source === "dataforseo-onpage"
            ? 1
            : 3,
        retryable: (err) => {
          if (err?.category === "timeout") return true;
          if (err?.category === "network" && err?.statusCode >= 500) return true;
          if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ECONNREFUSED" || err?.code === "ENOTFOUND") return true;
          return false;
        },
        delayMs: (attempt) => Math.min(1000 * Math.pow(2, attempt), 30_000),
      };
    },
  });

  const orchestrator = createNarrativeV2ProductionPath({
    baseOrchestrator,
    lifecycleService,
    artifactStore,
    validateContract: runtimeValidateContract,
    enabled: narrativeV2Enabled,
    writerExecutor: narrativeV2Deps.writerExecutor,
    judgeExecutor: narrativeV2Deps.judgeExecutor,
    authorizeFinalPass: narrativeV2Deps.authorizeFinalPass,
    clock: runtimeClock,
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

  async function createAudit(input, tenantId) {
    const targetUrl = normalizeUrl(input.targetUrl);
    const businessName = deriveBusinessName(targetUrl, input.businessName);
    const auditId = randomUUID();
    const clientId = buildClientId(targetUrl, businessName);
    const idempotencyKey = `web:${auditId}`;
    const executionId = randomUUID();
    const slug = slugify(businessName);

    const requestedNarrativeV2 = input.report?.narrativeVersion === "2.0.0";
    if (requestedNarrativeV2 && !narrativeV2Enabled) {
      throw Object.assign(
        new Error("Narrative v2 was requested but the production runtime capability is disabled"),
        { statusCode: 409, code: "NARRATIVE_V2_DISABLED" },
      );
    }
    if (requestedNarrativeV2 && input.report?.designVersion !== "2.0.0") {
      throw Object.assign(
        new Error("Narrative v2 requires report design 2.0.0"),
        { statusCode: 422, code: "NARRATIVE_V2_REQUIRES_REPORT_V2" },
      );
    }

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
    if (input.report && typeof input.report === "object") {
      auditRequest.report = {
        designVersion:
          input.report.designVersion === "2.0.0" ? "2.0.0" : "1.0.0",
        narrativeVersion: requestedNarrativeV2 ? "2.0.0" : "1.0.0",
      };
    }

    auditRequest.crawl =
      input.crawl && typeof input.crawl === "object" ? { ...input.crawl } : {};

    // Normal production audits browser-validate conversion paths unless the
    // intake explicitly disables the browser or the environment kill-switch
    // forces it off.
    if (process.env.PRYSM_DISABLE_LIVE_BROWSER) {
      auditRequest.crawl.pathValidationLiveBrowser = false;
    } else if (auditRequest.crawl.pathValidationLiveBrowser === undefined) {
      auditRequest.crawl.pathValidationLiveBrowser = true;
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

    // Register audit scope before any background narrative execution. This
    // scope is used only for immutable usage/cost records; it is never added
    // to the Writer/Judge model payload.
    if (typeof narrativeV2Deps.registerAuditScope === "function") {
      narrativeV2Deps.registerAuditScope({ tenantId, clientId, auditId, executionId });
    }

    await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey });
    if (typeof lifecycleRepo.updateAuditMetadata === "function") {
      await lifecycleRepo.updateAuditMetadata(auditId, tenantId, { businessName, targetUrl });
    }

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

    if (typeof narrativeV2Deps.registerAuditScope === "function") {
      narrativeV2Deps.registerAuditScope({ tenantId, clientId, auditId, executionId });
    }

    let result = await orchestrator.execute(auditRequest, { executionId });
    let previousState = null;
    for (let step = 0; step < 4; step++) {
      if (result.finalState === T.DRAFT_RENDERED || FAILURE_STATES.has(result.finalState)) break;
      if (result.finalState === previousState) break;
      previousState = result.finalState;
      result = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
    }

    const error = result.wp8Error || result.narrativeV2Error || null;

    if (result.finalState === T.DRAFT_RENDERED && typeof reportStore.writeReport === "function") {
      const slug = slugify(businessName);
      try {
        const existing = await reportStore.getStatus(slug, auditId).catch(() => null);
        if (!existing || existing.status !== "draft_rendered") {
          await reportStore.writeReport({
            slug,
            runId: auditId,
            model: { evidence: {} },
            manifest: { auditId, lifecycleStatus: T.DRAFT_RENDERED, governedManifestKey: result.manifestKey || null },
            html: result.renderedPages instanceof Map ? (result.renderedPages.get("index.html") || "") : "",
            includeIndexHtml: result.renderedPages instanceof Map && Boolean(result.renderedPages.get("index.html")),
          });
        }
      } catch { /* best-effort sync */ }
    }

    return { finalState: result.finalState, error };
  }

  async function getNarrativeV2HumanReview(auditId, tenantId) {
    const meta = await loadAuditMetadata(lifecycleRepo, auditId, tenantId).catch(() => null);
    if (!meta) {
      throw Object.assign(
        new Error("Audit not found"),
        { statusCode: 404 },
      );
    }

    const current = await lifecycleService.currentState(auditId, tenantId).catch(() => null);
    if (!current) {
      throw Object.assign(
        new Error("Audit not found"),
        { statusCode: 404 },
      );
    }

    const clientId =
      current.clientId ||
      meta.client_id ||
      meta.clientId ||
      "";

    if (!clientId) {
      throw Object.assign(
        new Error("Audit client scope not found"),
        { statusCode: 404 },
      );
    }

    const auditRequest = await loadAuditRequest({
      store: artifactStore,
      scope: { tenantId, clientId, auditId },
      validateContract: runtimeValidateContract,
    });

    if (!auditRequest) {
      throw Object.assign(
        new Error("Persisted AuditRequest not found"),
        { statusCode: 404 },
      );
    }

    if (typeof orchestrator.getNarrativeV2HumanReview !== "function") {
      throw Object.assign(
        new Error("Narrative v2 human-review continuation is unavailable"),
        { statusCode: 409, code: "NARRATIVE_V2_HUMAN_REVIEW_UNAVAILABLE" },
      );
    }

    return orchestrator.getNarrativeV2HumanReview(auditRequest);
  }

  async function continueNarrativeV2FinalPass(
    auditId,
    tenantId,
    authorizationId,
  ) {
    const normalizedAuthorizationId = String(authorizationId || "").trim();
    if (!normalizedAuthorizationId) {
      throw Object.assign(
        new Error("Explicit final-pass authorization is required"),
        { statusCode: 422, code: "NARRATIVE_V2_FINAL_PASS_AUTHORIZATION_REQUIRED" },
      );
    }

    const meta = await loadAuditMetadata(lifecycleRepo, auditId, tenantId).catch(() => null);
    if (!meta) {
      throw Object.assign(
        new Error("Audit not found"),
        { statusCode: 404 },
      );
    }

    const current = await lifecycleService.currentState(auditId, tenantId).catch(() => null);
    if (!current) {
      throw Object.assign(
        new Error("Audit not found"),
        { statusCode: 404 },
      );
    }

    if (current.state !== T.NARRATIVE_FAILED) {
      throw Object.assign(
        new Error(`Cannot authorize Narrative v2 final pass from ${current.state} state`),
        {
          statusCode: 409,
          code: "NARRATIVE_V2_FINAL_PASS_INVALID_STATE",
          lifecycleStatus: current.state,
        },
      );
    }

    const businessName = meta.business_name || meta.businessName || "";
    const clientId =
      current.clientId ||
      meta.client_id ||
      meta.clientId ||
      "";

    if (!clientId) {
      throw Object.assign(
        new Error("Audit client scope not found"),
        { statusCode: 404 },
      );
    }

    const auditRequest = await loadAuditRequest({
      store: artifactStore,
      scope: { tenantId, clientId, auditId },
      validateContract: runtimeValidateContract,
    });

    if (!auditRequest) {
      throw Object.assign(
        new Error("Persisted AuditRequest not found"),
        { statusCode: 404 },
      );
    }

    if (typeof orchestrator.continueNarrativeV2FinalPass !== "function") {
      throw Object.assign(
        new Error("Narrative v2 final-pass continuation is unavailable"),
        { statusCode: 409, code: "NARRATIVE_V2_FINAL_PASS_UNAVAILABLE" },
      );
    }

    const executionId = randomUUID();

    if (typeof narrativeV2Deps.registerAuditScope === "function") {
      narrativeV2Deps.registerAuditScope({
        tenantId,
        clientId,
        auditId,
        executionId,
      });
    }

    let result = await orchestrator.continueNarrativeV2FinalPass(
      auditRequest,
      {
        executionId,
        authorizationId: normalizedAuthorizationId,
      },
    );

    if (result.finalState === T.NARRATIVE_READY) {
      result = await orchestrator.execute(
        auditRequest,
        { executionId: randomUUID() },
      );
    }

    const error = result.wp8Error || result.narrativeV2Error || null;

    if (
      result.finalState === T.DRAFT_RENDERED &&
      typeof reportStore.writeReport === "function"
    ) {
      const slug = slugify(businessName);

      try {
        const existing = await reportStore.getStatus(slug, auditId).catch(() => null);

        if (!existing || existing.status !== "draft_rendered") {
          const indexHtml = result.renderedPages instanceof Map
            ? (result.renderedPages.get("index.html") || "")
            : "";

          await reportStore.writeReport({
            slug,
            runId: auditId,
            model: { evidence: {} },
            manifest: {
              auditId,
              lifecycleStatus: T.DRAFT_RENDERED,
              governedManifestKey: result.manifestKey || null,
            },
            html: indexHtml,
            includeIndexHtml: Boolean(indexHtml),
          });
        }
      } catch {
        /* best-effort sync */
      }
    }

    return {
      finalState: result.finalState,
      error,
    };
  }

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
        console.error(`[recoverStrandedAudits] audit ${auditId} stranded at ${current.state} but persisted AuditRequest missing`);
        recovered.push(Object.freeze({ auditId, finalState: current.state, recovered: false }));
        continue;
      }

      const recoveryExecutionId = randomUUID();
      if (typeof narrativeV2Deps.registerAuditScope === "function") {
        narrativeV2Deps.registerAuditScope({ tenantId, clientId, auditId, executionId: recoveryExecutionId });
      }

      let result = await orchestrator.execute(auditRequest, { executionId: recoveryExecutionId });
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
  async function getNarrativeV2UatRender(auditId, tenantId) {
    const meta = await loadAuditMetadata(lifecycleRepo, auditId, tenantId).catch(() => null);

    if (!meta) {
      throw Object.assign(
        new Error("Audit not found"),
        { statusCode: 404 },
      );
    }

    const current = await lifecycleService.currentState(auditId, tenantId).catch(() => null);
    const clientId =
      current?.clientId ||
      meta.client_id ||
      meta.clientId ||
      "";

    if (!clientId) {
      throw Object.assign(
        new Error("Audit client scope not found"),
        { statusCode: 404 },
      );
    }

    const auditRequest = await loadAuditRequest({
      store: artifactStore,
      scope: { tenantId, clientId, auditId },
      validateContract: runtimeValidateContract,
    });

    if (!auditRequest) {
      throw Object.assign(
        new Error("Persisted AuditRequest not found"),
        { statusCode: 404 },
      );
    }

    return renderNarrativeV2UatFromPersistedArtifacts({
      auditRequest,
      artifactStore,
      validateContract: runtimeValidateContract,
    });
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
            bytes = null;
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

  async function publishAudit(auditId, tenantId, slug) {
    const current = await lifecycleService.currentState(auditId, tenantId);
    if (!current) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });

    if (current.state === T.PUBLISHED) {
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

  async function getPublishedReportPage(auditId, tenantId, slug, filename) {
    const current = await lifecycleService.currentState(auditId, tenantId);
    if (!current) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });
    if (current.state !== T.PUBLISHED) {
      throw Object.assign(
        new Error("Report not published"),
        { statusCode: 403, code: "REPORT_NOT_PUBLISHED", lifecycleStatus: current.state },
      );
    }

    if (!REQUIRED_APPROVED_PAGE_FILENAMES.includes(filename)) {
      const err = new Error("Page not found in published report");
      err.statusCode = 404;
      throw err;
    }

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
    getNarrativeV2UatRender,
    getNarrativeV2HumanReview,
    continueNarrativeV2FinalPass,
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
    narrativeV2Enabled,
    narrativeV2Config: narrativeV2Deps.config || null,
    recoverStrandedAudits,
  });
}

export default { createProductionRuntime };

/**
 * WP11 Governed Audit Application Service
 *
 * The single server-side boundary between the web application and the
 * WP4-WP10 governed stack.  Every web-initiated audit operation flows
 * through this service — never through legacy runAudit().
 *
 * @module application/audit-service
 */

import { randomUUID } from "node:crypto";
import { buildArtifactKey } from "../storage/artifact-key.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {object} opts.orchestrator — governed AuditOrchestrator (WP5-WP10)
 * @param {object} opts.lifecycleRepo — lifecycle repository (PostgreSQL/memory)
 * @param {object} opts.artifactStore — governed artifact store
 * @param {object} opts.reportStore — report store for approval/publication/viewing
 * @param {object} opts.config — worker configuration
 * @param {Function} [opts.validateContract] — schema validator
 * @param {object} [opts.clock] — injectable clock
 */
export function createAuditApplicationService({
  orchestrator,
  lifecycleRepo,
  lifecycleService,
  artifactStore,
  reportStore,
  config,
  validateContract,
  clock,
}) {
  // lifecycleService is required — must be injected by the application wiring
  if (!lifecycleService) {
    throw new Error("lifecycleService is required for AuditApplicationService");
  }
  const c = clock || {
    now: () => new Date().toISOString(),
  };

  // -------------------------------------------------------------------
  // Audit creation — governed path (never legacy runAudit)
  // -------------------------------------------------------------------

  /**
   * Create and execute a new audit through the governed orchestrator.
   *
   * @param {object} input — web-form input
   * @param {string} input.targetUrl
   * @param {string} input.businessName
   * @param {string} [input.market]
   * @param {string} [input.language]
   * @param {string} [input.primaryGoal]
   * @param {string[]} [input.services]
   * @param {string[]} [input.competitors]
   * @param {object} [input.ga4]
   * @param {object} [input.gsc]
   * @param {string} tenantId — injected server-side
   * @returns {Promise<object>} execution summary
   */
  async function createAudit(input, tenantId) {
    // Build governed AuditRequest
    const auditId = randomUUID();
    const clientId = buildClientId(input.targetUrl, input.businessName);
    const idempotencyKey = buildIdempotencyKey(input.targetUrl, input.businessName, tenantId);

    const auditRequest = {
      contractVersion: "1.0.0",
      auditId,
      tenantId,
      clientId,
      idempotencyKey,
      targetUrl: normalizeUrl(input.targetUrl),
      businessName: input.businessName.trim(),
      market: input.market || "",
      language: input.language || "en-CA",
      primaryGoal: input.primaryGoal || "",
      services: input.services || [],
      competitors: input.competitors || [],
    };

    // Attach optional analytics
    if (input.ga4?.propertyId) {
      auditRequest.ga4 = { propertyId: String(input.ga4.propertyId).replace(/\D/g, "") };
    }
    if (input.gsc?.siteUrl) {
      auditRequest.gsc = { siteUrl: input.gsc.siteUrl.trim() };
    }

    // Governed optional configuration pass-through (schema-validated):
    // crawl overrides, performance configuration, SERP/backlinks config,
    // and controlled-dependency seams (oauthService/fetchImpl) that sit
    // BELOW the production adapter layer.
    if (input.crawl && typeof input.crawl === "object") {
      auditRequest.crawl = { ...(auditRequest.crawl || {}), ...input.crawl };
      // PRYSM-NEXT-01 WP-E — production default: live browser validation ON
      // unless the intake explicitly disables it or the env kill-switch is
      // set.  Controlled requests (tests) bypass this service — zero live
      // browsers in governed suites.
      if (auditRequest.crawl.pathValidationLiveBrowser === undefined) {
        auditRequest.crawl.pathValidationLiveBrowser =
          process.env.PRYSM_DISABLE_LIVE_BROWSER ? false : true;
      }
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
      if (input.ga4.oauthService) auditRequest.ga4.oauthService = input.ga4.oauthService;
      if (input.ga4.fetchImpl) auditRequest.ga4.fetchImpl = input.ga4.fetchImpl;
      if (input.ga4.serviceAccountJson) auditRequest.ga4.serviceAccountJson = input.ga4.serviceAccountJson;
    }
    if (input.gsc && typeof input.gsc === "object") {
      if (input.gsc.oauthService) auditRequest.gsc.oauthService = input.gsc.oauthService;
      if (input.gsc.fetchImpl) auditRequest.gsc.fetchImpl = input.gsc.fetchImpl;
      if (input.gsc.serviceAccountJson) auditRequest.gsc.serviceAccountJson = input.gsc.serviceAccountJson;
      if (input.gsc.sufficiencyThreshold != null) auditRequest.gsc.sufficiencyThreshold = input.gsc.sufficiencyThreshold;
    }

    // Validate schema
    if (validateContract) {
      const v = validateContract(
        "https://vantage-platform.io/prysm/contracts/v1/audit-request.schema.json",
        auditRequest,
      );
      if (!v.valid) {
        const err = new Error("Audit request validation failed");
        err.statusCode = 422;
        err.errors = v.errors;
        throw err;
      }
    }

    // PRYSM-CLOSE-09: persist the complete normalized AuditRequest durably
    // before background execution.  Recovery loads this record verbatim —
    // missing values are never reconstructed with defaults.
    const { persistAuditRequest } = await import("../orchestration/audit-request-persistence.js");
    await persistAuditRequest({
      store: artifactStore,
      auditRequest,
      validateContract,
    });

    // Execute through the governed orchestrator (never legacy runAudit)
    const executionId = randomUUID();
    const result = await orchestrator.execute(auditRequest, { executionId });

    return {
      auditId,
      tenantId,
      clientId,
      executionId,
      finalState: result.finalState,
      slug: slugify(input.businessName),
      lifecycle: result,
    };
  }

  // -------------------------------------------------------------------
  // Audit status — from lifecycle repository
  // -------------------------------------------------------------------

  /**
   * Return the exact canonical lifecycle state for an audit.
   */
  async function getAuditStatus(auditId, tenantId) {
    const state = await lifecycleService.currentState(auditId, tenantId);
    if (!state) return null;

    const history = await lifecycleService.history(auditId, tenantId);
    const events = history || [];

    // Get source statuses from the most recent EVIDENCE_LOCKED event
    const evidenceLockedEvent = [...events].reverse().find(
      (e) => e.nextState === "evidence_locked",
    );

    return {
      auditId,
      tenantId,
      state: state.state,
      version: state.version,
      createdAt: events[0]?.timestamp || null,
      updatedAt: events[events.length - 1]?.timestamp || null,
      lifecycle: events.map((e) => ({
        from: e.previousState,
        to: e.nextState,
        at: e.timestamp,
        reason: e.reason || null,
      })),
      sourceStatus: evidenceLockedEvent?.sourceStatus || null,
    };
  }

  // -------------------------------------------------------------------
  // Tenant-scoped audit history — from PostgreSQL
  // -------------------------------------------------------------------

  /**
   * Return tenant-scoped audit history, newest first.
   * Reads from PostgreSQL via the lifecycle repository.
   */
  async function listAudits(tenantId) {
    if (typeof lifecycleRepo.listByTenant !== "function") {
      // Fallback for memory repository: scan all audits
      // In production this MUST be PostgreSQL-backed
      throw new Error(
        "listByTenant not available — history requires PostgreSQL lifecycle repository",
      );
    }

    const rows = await lifecycleRepo.listByTenant(tenantId);
    return rows.map((row) => ({
      auditId: row.audit_id || row.auditId,
      clientId: row.client_id || row.clientId,
      businessName: row.business_name || row.businessName,
      targetUrl: row.target_url || row.targetUrl,
      createdAt: row.created_at || row.createdAt,
      latestState: row.latest_state || row.latestState || row.status,
      updatedAt: row.updated_at || row.updatedAt,
    }));
  }

  // -------------------------------------------------------------------
  // Review submission
  // -------------------------------------------------------------------

  /**
   * Submit a governed review for a DRAFT_RENDERED audit.
   * Uses the existing report-store review path.
   */
  async function submitReview(auditId, tenantId, slug, reviewer, checklist) {
    // Validate checklist completeness
    const allReviewed = checklist.every((item) => item.reviewed === true);
    if (!allReviewed) {
      const err = new Error("Review rejected — checklist is incomplete");
      err.statusCode = 422;
      throw err;
    }

    const reviewRecord = {
      reviewer,
      reviewedAt: c.now(),
      checklist,
      findingsReviewed: true,
      limitationsAccepted: true,
    };

    // Use report store for lifecycle-managed review
    const updated = await reportStore.writeReview(slug, auditId, reviewRecord);

    return {
      auditId,
      tenantId,
      status: updated.status,
      review: updated.review,
    };
  }

  // -------------------------------------------------------------------
  // Approval submission
  // -------------------------------------------------------------------

  /**
   * Approve a fully reviewed audit.
   * Uses the existing report-store approval path.
   */
  async function approveAudit(auditId, tenantId, slug, approver, pages) {
    const approvalRecord = {
      approver,
      approvedAt: c.now(),
      reviewRef: { reviewedAt: c.now() },
    };

    // PRYSM-NEXT-01 WP-I — report-design v2 approval branch: the governed
    // v2 page set (report-v2/pages/index.html) must exist; approval updates
    // the governed manifest to status approved.  The report-access route's
    // state gate then exposes the same page bytes to approved viewers.
    try {
      const current = await lifecycleService.currentState(auditId, tenantId);
      const clientId = current?.clientId || "";
      if (clientId) {
        const v2ManifestKey = buildArtifactKey({
          tenantId, clientId, auditId,
          category: "report-v2", artifactName: "manifest.json",
        });
        let manifestBytes = null;
        try {
          manifestBytes = await artifactStore.get(v2ManifestKey);
        } catch {
          manifestBytes = null;
        }
        if (manifestBytes && manifestBytes.length > 0) {
          const pageKey = buildArtifactKey({
            tenantId, clientId, auditId,
            category: "report-v2", artifactName: "pages/index.html",
          });
          let pageBytes = null;
          try {
            pageBytes = await artifactStore.get(pageKey);
          } catch {
            pageBytes = null;
          }
          if (!pageBytes || pageBytes.length === 0) {
            const err = new Error("Report v2 approval failed: rendered page missing");
            err.statusCode = 500;
            throw err;
          }
          const manifest = JSON.parse(manifestBytes.toString("utf-8"));
          const approvedManifest = { ...manifest, status: "approved", approval: approvalRecord };
          const bytes = Buffer.from(JSON.stringify(approvedManifest, null, 2), "utf-8");
          // The governed store is immutable — approval is recorded as a NEW
          // artifact (approved-manifest.json); the draft manifest is never
          // overwritten.  Report exposure is controlled by the lifecycle
          // state gate, not by mutating the draft artifact.
          const record = await artifactStore.put({
            bytes, contentType: "application/json",
            scope: { tenantId, clientId, auditId, category: "report-v2", artifactName: "approved-manifest.json" },
          });
          return {
            auditId,
            tenantId,
            status: "approved",
            designVersion: "2.0.0",
            approval: approvalRecord,
            artifacts: [{ filename: "index.html", manifestKey: record.key }],
          };
        }
      }
    } catch (err) {
      if (err && err.statusCode) throw err;
      // Non-status errors fall through to the v1 path.
    }

    // Use report store for lifecycle-managed approval with page validation
    const updated = await reportStore.writeApprovedPages(
      slug,
      auditId,
      approvalRecord,
      pages,
    );

    return {
      auditId,
      tenantId,
      status: updated.status,
      approval: updated.approval,
      artifacts: updated.artifacts,
    };
  }

  // -------------------------------------------------------------------
  // Report page retrieval — from governed artifact store
  // -------------------------------------------------------------------

  /**
   * Retrieve a report page from the governed artifact store.
   * Serves draft pages for draft_rendered and in_review (reviewer access).
   * Serves approved pages for approved and published (client access).
   */
  async function getReportPage(tenantId, clientId, auditId, filename, slug) {
    // Check lifecycle state via lifecycle repo (canonical)
    let currentState;
    try {
      const current = await lifecycleService.currentState(auditId, tenantId);
      currentState = current?.state;
    } catch {
      // Fallback to report store
      try {
        const rpt = await reportStore.getStatus(slug, auditId);
        currentState = rpt?.status;
      } catch {
        currentState = null;
      }
    }

    if (!currentState) {
      const err = new Error("Audit not found");
      err.statusCode = 404;
      throw err;
    }

    const READABLE_STATES = new Set(["draft_rendered", "in_review", "approved", "published"]);
    if (!READABLE_STATES.has(currentState)) {
      const err = new Error("Report not available");
      err.statusCode = 403;
      err.code = "REPORT_NOT_APPROVED";
      err.lifecycleStatus = currentState;
      throw err;
    }

    // For approved/published, validate against the artifact manifest.
    // For draft states, read directly from artifact store (no manifest yet).
    const DRAFT_STATES = new Set(["draft_rendered", "in_review"]);
    let lifecycleRecord = null;
    try { lifecycleRecord = await reportStore.getStatus(slug, auditId); } catch { /* fall through */ }
    if (!DRAFT_STATES.has(currentState)) {
      const finalArtifacts = lifecycleRecord?.artifacts?.final || [];
      if (!finalArtifacts.includes(filename)) {
        const err = new Error("Page not found in approved report");
        err.statusCode = 404;
        throw err;
      }
    }

    // Read from governed artifact store
    const artifactKey = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/report/pages/${filename}`;
    let bytes;
    try {
      bytes = await artifactStore.get(artifactKey);
    } catch {
      // Fallback to report store local read
      try {
        const relative = `${slug}/${auditId}/${filename}`;
        bytes = await reportStore.readFile(relative);
      } catch {
        const err = new Error("Report file not found");
        err.statusCode = 404;
        throw err;
      }
    }

    return {
      filename,
      bytes,
      contentType: filename.endsWith(".html") ? "text/html; charset=utf-8" : "application/json",
      lifecycleStatus: lifecycleRecord?.status || currentState,
    };
  }

  return Object.freeze({
    createAudit,
    getAuditStatus,
    listAudits,
    submitReview,
    approveAudit,
    getReportPage,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeUrl(raw) {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function buildClientId(targetUrl, businessName) {
  // Stable client identity from normalized target + business
  // Must use artifact-safe characters only (no ::, spaces, special chars)
  const normalized = normalizeUrl(targetUrl);
  const host = (() => { try { return new URL(normalized).hostname; } catch { return normalized; } })();
  const safeHost = host.replace(/[^a-zA-Z0-9.-]/g, "-");
  const safeBusiness = businessName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${safeHost}-${safeBusiness}`;
}

function buildIdempotencyKey(targetUrl, businessName, tenantId) {
  // Stable key: same input → same key, preventing duplicate audits
  return `${tenantId}:${buildClientId(targetUrl, businessName)}`;
}

function slugify(value) {
  return String(value || "audit")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export default { createAuditApplicationService };

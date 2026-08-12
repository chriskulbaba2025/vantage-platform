import { createServer } from "node:http";
import { extname } from "node:path";
import { runAudit, submitReview, approveAudit, getAuditStatus } from "./audit/run-audit.js";
import { loadConfig } from "./config.js";
import { createLocalReportStore, createReportStore } from "./storage/report-store.js";
import { LIFECYCLE_STATUS } from "./audit/review-gate.js";
import { createTokenStore } from "./auth/token-store.js";
import { createOAuthService } from "./auth/oauth-service.js";

// =============================================================================
// Request handler factory — injectable for testing
// =============================================================================

/**
 * Create the production request handler with explicit dependencies.
 *
 * Every dependency is injected so acceptance tests can supply test doubles
 * while the production startup path passes the real configuration.
 */
export function createRequestHandler({
  config,
  localStore,
  store,
  oauthService,
  runAuditFn,
  submitReviewFn,
  approveAuditFn,
  auditService,
}) {
  const _runAudit = runAuditFn || runAudit;
  const _submitReview = submitReviewFn || submitReview;
  const _approveAudit = approveAuditFn || approveAudit;
  const contentType = (path) => ({ ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8" }[extname(path)] || "application/octet-stream");

  function send(res, status, body, type = "application/json; charset=utf-8") {
    const payload = type.startsWith("application/json") ? JSON.stringify(body) : body;
    res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
    res.end(payload);
  }

  function authorized(req) {
    if (!config.webhookSecret) return true;
    const provided = req.headers["x-vantage-secret"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    return provided === config.webhookSecret;
  }

  async function readJson(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 1024 * 1024) throw new Error("Request body exceeds 1 MB");
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  }

  function parseAuditPath(pathname) {
    const m = pathname.match(/^\/audits\/([^/]+)(\/(review|approve))?$/);
    if (!m) return null;
    return { runId: decodeURIComponent(m[1]), action: m[3] || null };
  }

  function parseReportPath(pathname) {
    const m = pathname.match(/^\/reports\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!m) return null;
    return { slug: decodeURIComponent(m[1]), runId: decodeURIComponent(m[2]), rest: m[3] || "/index.html" };
  }

  return async function requestListener(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { status: "ok", service: "prysm-worker", version: "0.2.0" });
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,authorization,x-vantage-secret,x-reviewer-identity",
        });
        return res.end();
      }

      if (req.method === "POST" && url.pathname === "/audits") {
        if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
        const input = await readJson(req);
        const result = await _runAudit(input, { config, oauthService });
        return send(res, 201, {
          status: result.status, lifecycleStatus: result.lifecycleStatus,
          runId: result.runId, slug: result.slug,
          reportUrl: result.storage.reportUrl,
          reportPath: result.storage.indexPath || result.storage.indexKey,
          scores: result.model.scores, evidence: result.manifest.sources,
        });
      }

      const auditPath = parseAuditPath(url.pathname);

      if (req.method === "GET" && auditPath && !auditPath.action) {
        if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
        let statusResult = null;
        let slug = url.searchParams.get("slug") || "";
        if (config.reportsBucket) {
          if (!slug) return send(res, 422, { error: "Slug query parameter is required for S3-backed audit status", code: "SLUG_REQUIRED", hint: "GET /audits/:runId?slug=<audit-slug>" });
          try { const st = await store.getStatus(slug, auditPath.runId); if (st) statusResult = { ...st, slug }; } catch {}
        } else {
          if (slug) { try { const st = await store.getStatus(slug, auditPath.runId); if (st) statusResult = { ...st, slug }; } catch {} }
          if (!statusResult) {
            const { readdir } = await import("node:fs/promises");
            try {
              const slugs = await readdir(config.artifactDir);
              for (const s of slugs) {
                try { const st = await store.getStatus(s, auditPath.runId); if (st) { statusResult = { ...st, slug: s }; break; } } catch {}
              }
            } catch {}
          }
        }
        if (!statusResult) return send(res, 404, { error: "Audit not found", runId: auditPath.runId });
        if (statusResult) {
          try {
            const committed = await store.readCommittedArtifacts(statusResult.slug, auditPath.runId);
            if (committed) {
              const opp = committed.evidence?.competitorOpportunities;
              if (opp) {
                statusResult.competitorReview = {
                  topics: opp.topics || [],
                  candidates: (opp.candidates?.qualified || []).map((c) => ({ candidateUrl: c.candidateUrl, domain: c.domain, topic: c.topic, discoverySource: c.discoverySource, pageType: c.pageType, qualificationResults: c.qualificationResults, approvalStatus: c.approvalStatus || "pending", position: c.position })),
                  excludedCandidates: (opp.candidates?.excluded || []).slice(0, 20).map((c) => ({ candidateUrl: c.candidateUrl, domain: c.domain, exclusionReason: c.exclusionReason })),
                  gaps: (opp.allGaps || []).map((g) => ({ clientTopic: g.clientTopic, competitorPage: g.competitorPage, approvalStatus: g.approvalStatus || "pending", gapPassed: g.gapPassed, confidence: g.confidence })),
                  sources: opp.sources, limitations: opp.limitations || [], activeTxId: committed.txId || null,
                };
              }
            }
          } catch {}
        }
        return send(res, 200, statusResult);
      }

      if (req.method === "POST" && auditPath && auditPath.action === "review") {
        if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
        const payload = await readJson(req);
        const reviewer = payload.reviewer || req.headers["x-reviewer-identity"] || "";
        if (!reviewer) return send(res, 422, { error: "Reviewer identity is required" });
        payload.reviewer = reviewer;
        const { runId } = auditPath;
        let slug = payload.slug;
        if (!slug && !config.reportsBucket) {
          const { readdir } = await import("node:fs/promises");
          try { const slugs = await readdir(config.artifactDir); for (const s of slugs) { try { const st = await store.getStatus(s, runId); if (st) { slug = s; break; } } catch {} } } catch {}
        }
        if (!slug) return send(res, 404, { error: "Audit not found — supply slug in payload or ensure local storage is in use", runId });
        try {
          const updated = await _submitReview(store, slug, runId, payload);
          const status = await store.getStatus(slug, runId);
          return send(res, 200, { status: "reviewed", lifecycle: updated, summary: status });
        } catch (err) {
          return send(res, err.statusCode || 500, { error: err.message, details: err.errors || null });
        }
      }

      if (req.method === "POST" && auditPath && auditPath.action === "approve") {
        if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
        const payload = await readJson(req);
        const approver = payload.approver || req.headers["x-reviewer-identity"] || "";
        if (!approver) return send(res, 422, { error: "Approver identity is required" });
        const { runId } = auditPath;
        let slug = payload.slug;
        if (!slug && !config.reportsBucket) {
          const { readdir } = await import("node:fs/promises");
          try { const slugs = await readdir(config.artifactDir); for (const s of slugs) { try { const st = await store.getStatus(s, runId); if (st) { slug = s; break; } } catch {} } } catch {}
        }
        if (!slug) return send(res, 404, { error: "Audit not found — supply slug in payload or ensure local storage is in use", runId });
        try {
          const result = await _approveAudit(store, slug, runId, approver, { notes: payload.notes });
          const status = await store.getStatus(slug, runId);
          return send(res, 200, { status: "approved", lifecycle: result.lifecycle, summary: status, pageCount: result.pageCount, pdf: "browser-print-only" });
        } catch (err) {
          return send(res, err.statusCode || 500, { error: err.message, details: err.errors || null });
        }
      }

      if (req.method === "GET" && url.pathname.startsWith("/reports/")) {
        const parsed = parseReportPath(url.pathname);
        if (!parsed) return send(res, 404, { error: "Invalid report path" });
        const { slug, runId, rest } = parsed;
        if (rest.includes("..") || rest.includes("//") || rest.includes("\\")) {
          return send(res, 400, { error: "Invalid report path" });
        }
        const requestedFile = rest.replace(/^\//, "");
        if (!/^[a-z0-9_-]+\.(html|json)$/i.test(requestedFile)) {
          return send(res, 400, { error: "Invalid report file name" });
        }
        let lifecycle = null;
        try { lifecycle = await store.getStatus(slug, runId); } catch {}
        const LEGACY_READABLE = new Set(["draft", "reviewed", "approved", "published"]);
        if (!lifecycle || !LEGACY_READABLE.has(lifecycle.status)) {
          return send(res, 403, { error: "Report not available", code: "REPORT_NOT_APPROVED", message: "This report has not been approved for delivery.", status: lifecycle?.status || "unknown" });
        }
        const finalArtifacts = lifecycle.artifacts?.final || [];
        if (!finalArtifacts.includes(requestedFile)) {
          return send(res, 404, { error: "Page not found in approved report", code: "PAGE_NOT_FOUND" });
        }
        if (!config.reportsBucket) {
          const relative = `${slug}/${runId}/${requestedFile}`;
          try {
            const file = await localStore.readFile(relative);
            return send(res, 200, file, contentType(requestedFile));
          } catch {
            return send(res, 404, { error: "Report file not found" });
          }
        }
        return send(res, 404, { error: "S3 report serving not available via this endpoint" });
      }

      if (req.method === "POST" && url.pathname.startsWith("/connect/")) {
        if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
        const provider = url.pathname.replace("/connect/", "");
        if (!["ga4", "gsc"].includes(provider)) return send(res, 400, { error: "Unknown provider. Use /connect/ga4 or /connect/gsc" });
        try {
          const authUrl = oauthService.getAuthUrl(provider === "ga4" ? "google-analytics-4" : "google-search-console");
          return send(res, 200, { provider, authUrl });
        } catch (err) { return send(res, 500, { error: err.message }); }
      }

      if (req.method === "GET" && url.pathname === "/oauth/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code) return send(res, 400, { error: "Missing authorization code" });
        let provider;
        try { provider = oauthService.validateState(state); } catch (err) { return send(res, 400, { error: err.message }); }
        try {
          const result = await oauthService.exchangeCode(code, provider);
          return send(res, 200, { status: "connected", provider: result.provider, scope: result.scope, expiresAt: result.expiresAt });
        } catch (err) { return send(res, 500, { error: err.message }); }
      }

      if (req.method === "GET" && url.pathname.startsWith("/connection/")) {
        if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
        const providerRaw = url.pathname.replace("/connection/", "");
        const provider = providerRaw === "ga4" ? "google-analytics-4" : providerRaw === "gsc" ? "google-search-console" : null;
        if (!provider) return send(res, 400, { error: "Unknown provider. Use /connection/ga4 or /connection/gsc" });
        return send(res, 200, await oauthService.getStatus(provider));
      }

      if (req.method === "POST" && url.pathname.startsWith("/disconnect/")) {
        if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
        const providerRaw = url.pathname.replace("/disconnect/", "");
        const provider = providerRaw === "ga4" ? "google-analytics-4" : providerRaw === "gsc" ? "google-search-console" : null;
        if (!provider) return send(res, 400, { error: "Unknown provider. Use /disconnect/ga4 or /disconnect/gsc" });
        return send(res, 200, await oauthService.disconnect(provider));
      }

      // -----------------------------------------------------------------------
      // WP11 Governed API v1 — web application integration
      // -----------------------------------------------------------------------

      // POST /api/v1/audits — create and execute a governed audit
      if (req.method === "POST" && url.pathname === "/api/v1/audits") {
        if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
        if (!auditService) return send(res, 501, { error: "WP11 audit service not configured" });
        try {
          const input = await readJson(req);
          const tenantId = config.vantageTenantId || "default";
          const result = await auditService.createAudit(input, tenantId);
          return send(res, 201, result);
        } catch (err) {
          return send(res, err.statusCode || 500, { error: err.message, errors: err.errors || null });
        }
      }

      // GET /api/v1/audits — tenant-scoped audit history
      if (req.method === "GET" && url.pathname === "/api/v1/audits") {
        if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
        if (!auditService) return send(res, 501, { error: "WP11 audit service not configured" });
        try {
          const tenantId = config.vantageTenantId || "default";
          const audits = await auditService.listAudits(tenantId);
          return send(res, 200, audits);
        } catch (err) {
          return send(res, err.statusCode || 500, { error: err.message });
        }
      }

      // GET /api/v1/audits/:auditId — audit status
      const wp11AuditMatch = url.pathname.match(/^\/api\/v1\/audits\/([a-f0-9-]{36})(\/review|\/approve|\/resume|\/report\/(.+))?$/);
      if (wp11AuditMatch) {
        const auditId = wp11AuditMatch[1];
        const subPath = wp11AuditMatch[2] || "";

        // GET /api/v1/audits/:auditId
        if (req.method === "GET" && !subPath) {
          if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
          if (!auditService) return send(res, 501, { error: "WP11 audit service not configured" });
          try {
            const tenantId = config.vantageTenantId || "default";
            const status = await auditService.getAuditStatus(auditId, tenantId);
            if (!status) return send(res, 404, { error: "Audit not found" });
            return send(res, 200, status);
          } catch (err) {
            return send(res, err.statusCode || 500, { error: err.message });
          }
        }

        // POST /api/v1/audits/:auditId/resume — recover stuck audits
        if (req.method === "POST" && subPath === "/resume") {
          if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
          if (!auditService || typeof auditService.resumeAudit !== "function") {
            return send(res, 501, { error: "WP11 resume not configured" });
          }
          try {
            const tenantId = config.vantageTenantId || "default";
            const result = await auditService.resumeAudit(auditId, tenantId);
            // Log diagnostics internally; return safe client response
            if (result.error) {
              console.error(`Audit ${auditId} resume stalled: ${result.error}`);
            }
            const { error: _, ...safeResult } = result;
            return send(res, 200, { auditId, resumed: true, ...safeResult });
          } catch (err) {
            console.error(`Audit ${auditId} resume failed:`, err.message);
            // Never expose internal diagnostics to the client
            return send(res, err.statusCode || 500, {
              error: "Audit recovery could not complete. The audit may need to be restarted.",
            });
          }
        }

        // POST /api/v1/audits/:auditId/review
        if (req.method === "POST" && subPath === "/review") {
          if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
          if (!auditService) return send(res, 501, { error: "WP11 audit service not configured" });
          try {
            const payload = await readJson(req);
            const reviewer = payload.reviewer || req.headers["x-reviewer-identity"] || "";
            if (!reviewer) return send(res, 422, { error: "Reviewer identity is required" });
            const tenantId = config.vantageTenantId || "default";
            const slug = payload.slug;
            if (!slug) return send(res, 422, { error: "Slug is required" });
            const result = await auditService.submitReview(auditId, tenantId, slug, reviewer, payload.checklist);
            return send(res, 200, result);
          } catch (err) {
            return send(res, err.statusCode || 500, { error: err.message });
          }
        }

        // POST /api/v1/audits/:auditId/approve
        if (req.method === "POST" && subPath === "/approve") {
          if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
          if (!auditService) return send(res, 501, { error: "WP11 audit service not configured" });
          try {
            const payload = await readJson(req);
            const approver = payload.approver || req.headers["x-reviewer-identity"] || "";
            if (!approver) return send(res, 422, { error: "Approver identity is required" });
            const tenantId = config.vantageTenantId || "default";
            const slug = payload.slug;
            if (!slug) return send(res, 422, { error: "Slug is required" });
            // Build pages map from payload (for acceptance testing)
            let pages = null;
            if (payload.pages && typeof payload.pages === "object") {
              pages = new Map(Object.entries(payload.pages));
            }
            const result = await auditService.approveAudit(auditId, tenantId, slug, approver, pages);
            return send(res, 200, result);
          } catch (err) {
            return send(res, err.statusCode || 500, { error: err.message });
          }
        }

        // GET /api/v1/audits/:auditId/report/:filename
        if (req.method === "GET" && subPath.startsWith("/report/")) {
          if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
          const filename = wp11AuditMatch[3];
          if (!filename || filename.includes("..") || filename.includes("//") || filename.includes("\\")) {
            return send(res, 400, { error: "Invalid report path" });
          }
          if (!/^[a-z0-9_-]+\.(html|json)$/i.test(filename)) {
            return send(res, 400, { error: "Invalid report file name" });
          }
          if (!auditService) return send(res, 501, { error: "WP11 audit service not configured" });
          try {
            const tenantId = config.vantageTenantId || "default";
            const slug = url.searchParams.get("slug") || "";
            if (!slug) return send(res, 422, { error: "Slug query parameter is required" });
            const clientId = url.searchParams.get("clientId") || "";
            const result = await auditService.getReportPage(tenantId, clientId, auditId, filename, slug);
            const ct = result.contentType || "text/html; charset=utf-8";
            const payload = result.bytes;
            res.writeHead(200, { "content-type": ct, "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
            return res.end(payload);
          } catch (err) {
            if (err.statusCode === 403) {
              return send(res, 403, { error: err.message, code: err.code || "REPORT_NOT_APPROVED", lifecycleStatus: err.lifecycleStatus || "unknown" });
            }
            return send(res, err.statusCode || 500, { error: err.message });
          }
        }
      }

      return send(res, 404, { error: "Not found" });
    } catch (error) {
      console.error(error);
      return send(res, 500, { error: error.message });
    }
  };
}

// =============================================================================
// Production startup — WP12 governed runtime
// =============================================================================

import { createProductionRuntime } from "./application/production-runtime.js";
import { createPostgresLifecycleRepository } from "./lifecycle/postgres-repository.js";
import { createGovernedArtifactStore, buildKey as buildArtifactKey } from "./storage/governed-artifact-store.js";

const config = loadConfig();
const localStore = createLocalReportStore({ baseDir: config.artifactDir, publicBaseUrl: config.publicReportBaseUrl });
const store = createReportStore(config);

const tokenStore = createTokenStore({
  encryptionKey: config.vantageEncryptionKey,
  storageDir: config.artifactDir ? `${config.artifactDir}/tokens` : null,
});

const oauthService = createOAuthService({
  clientId: config.googleClientId,
  clientSecret: config.googleClientSecret,
  redirectUri: config.googleRedirectUri,
  tokenStore,
});

// --- WP12: Construct governed production runtime ---

// Schema validator (lazy import — avoids circular deps)
let validateContract = () => ({ valid: true, errors: [] });
try {
  const { createValidator } = await import("./contracts/validator.js");
  const v = createValidator();
  validateContract = (schemaId, obj) => v.validate(schemaId, obj);
} catch {
  console.warn("Schema validator not available — using pass-through");
}

// Adapters — canonical production composition (zero provider calls during bootstrap)
import { createProductionAdapters } from "./application/production-bootstrap.js";
const adapters = createProductionAdapters();
console.log(`Production adapters loaded: ${Object.keys(adapters).join(", ")}`);

// Artifact store — governed persistence boundary.
//
// Production MUST use durable S3 storage.  In-memory storage silently loses
// all canonical evidence, findings, scores, report-content packages, and
// rendered pages across deploys/restarts.  There is no safe fallback.
//
// Development-only: set VANTAGE_DEV_MEMORY_STORE=true to use the in-memory
// artifact store.  This MUST NOT be set in production.
const PRODUCTION_ARTIFACT_STORE_REQUIRED = (
  "VANTAGE PRODUCTION — persistent S3 artifact storage is required. " +
  "Set VANTAGE_REPORTS_BUCKET and AWS_REGION. " +
  "For local development only, set VANTAGE_DEV_MEMORY_STORE=true."
);

let artifactStore;
if (process.env.VANTAGE_DEV_MEMORY_STORE === "true") {
  if (process.env.NODE_ENV === "production") {
    throw new Error("VANTAGE_DEV_MEMORY_STORE is not allowed in production");
  }
  const { createMemoryArtifactStore } = await import("./storage/memory-artifact-store.js");
  artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  console.warn("DEVELOPMENT: using in-memory artifact store (NOT for production)");
} else if (!config.reportsBucket) {
  throw new Error(`VANTAGE_REPORTS_BUCKET is required. ${PRODUCTION_ARTIFACT_STORE_REQUIRED}`);
} else {
  try {
    const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const s3Client = new S3Client({ region: config.awsRegion });
    artifactStore = createGovernedArtifactStore({
      type: "object",
      client: s3Client,
      bucket: config.reportsBucket,
      prefix: config.reportsPrefix,
      commands: { PutObjectCommand, GetObjectCommand, HeadObjectCommand },
    });
    console.log(`Artifact store: S3 bucket=${config.reportsBucket} region=${config.awsRegion} prefix=${config.reportsPrefix}`);
    // Prove connectivity at startup — fail closed if unreachable
    try {
      const probeKey = buildArtifactKey({ tenantId: "_startup", clientId: "_probe", auditId: "00000000-0000-0000-0000-000000000000", category: "_startup", artifactName: "probe.json" });
      await artifactStore.exists(probeKey);
      console.log("Artifact store connectivity verified");
    } catch (probeErr) {
      throw new Error(`Artifact store connectivity check failed: ${probeErr.message}. ${PRODUCTION_ARTIFACT_STORE_REQUIRED}`);
    }
  } catch (e) {
    throw new Error(`Production artifact store initialization failed: ${e.message}. ${PRODUCTION_ARTIFACT_STORE_REQUIRED}`);
  }
}

// Lifecycle repository (PostgreSQL when DATABASE_URL is set)
let lifecycleRepo;
let auditService = null;

if (config.databaseUrl) {
  try {
    const pg = await import("pg");
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
    });

    // Verify connectivity
    await pool.query("SELECT 1");
    console.log("PostgreSQL connected");

    lifecycleRepo = createPostgresLifecycleRepository({ pool });

    // Run migrations to ensure schema exists
    if (typeof lifecycleRepo.runMigration === "function") {
      try { await lifecycleRepo.runMigration(); } catch (e) { console.warn("Migration note:", e.message); }
    }
  } catch (e) {
    console.error("PostgreSQL connection failed:", e.message);
    console.error("Worker starting without database — history, review, and approval will be unavailable");
  }
}

// Fallback to memory repo when no DATABASE_URL (development only)
if (!lifecycleRepo) {
  console.warn("No DATABASE_URL configured — using in-memory lifecycle repository (NOT for production)");
  const { createMemoryLifecycleRepository } = await import("./lifecycle/memory-repository.js");
  lifecycleRepo = createMemoryLifecycleRepository();
}

// Construct the full governed production runtime
if (lifecycleRepo && artifactStore) {
  try {
    const runtime = createProductionRuntime({
      config,
      adapters,
      validateContract,
      artifactStore,
      lifecycleRepo,
      reportStore: store,
    });
    auditService = runtime.auditService;
    console.log("WP12 production runtime initialized — governed API v1 available");
  } catch (e) {
    console.error("Production runtime initialization failed:", e.message);
  }
}

const requestListener = createRequestHandler({
  config,
  localStore,
  store,
  oauthService,
  auditService,
});

const server = createServer(requestListener);
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Prysm worker listening on :${config.port}`);
});

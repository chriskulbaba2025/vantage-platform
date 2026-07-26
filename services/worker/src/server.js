import { createServer } from "node:http";
import { extname } from "node:path";
import { runAudit, submitReview, approveAudit, getAuditStatus } from "./audit/run-audit.js";
import { loadConfig } from "./config.js";
import { createLocalReportStore, createReportStore } from "./storage/report-store.js";
import { LIFECYCLE_STATUS } from "./audit/review-gate.js";

const config = loadConfig();
const localStore = createLocalReportStore({ baseDir: config.artifactDir, publicBaseUrl: config.publicReportBaseUrl });
const store = createReportStore(config);
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

// ---------------------------------------------------------------------------
// Route helper: parse /audits/:runId paths
// ---------------------------------------------------------------------------

function parseAuditPath(pathname) {
  const m = pathname.match(/^\/audits\/([^/]+)(\/(review|approve))?$/);
  if (!m) return null;
  return { runId: decodeURIComponent(m[1]), action: m[3] || null };
}

// ---------------------------------------------------------------------------
// Helper: extract slug+runId from report URL or from audit lookup
// ---------------------------------------------------------------------------

function parseReportPath(pathname) {
  // /reports/<slug>/<runId>/...
  const m = pathname.match(/^\/reports\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  return { slug: decodeURIComponent(m[1]), runId: decodeURIComponent(m[2]), rest: m[3] || "/index.html" };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    // ── Health ────────────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { status: "ok", service: "vantage-worker", version: "0.2.0" });
    }

    // ── CORS preflight ─────────────────────────────────────────────────
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization,x-vantage-secret,x-reviewer-identity",
      });
      return res.end();
    }

    // ── Create audit ───────────────────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/audits") {
      if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
      const input = await readJson(req);
      const result = await runAudit(input, { config });
      return send(res, 201, {
        status: result.status,
        lifecycleStatus: result.lifecycleStatus,
        runId: result.runId,
        slug: result.slug,
        reportUrl: result.storage.reportUrl,
        reportPath: result.storage.indexPath || result.storage.indexKey,
        scores: result.model.scores,
        evidence: result.manifest.sources,
      });
    }

    // ── Audit status ───────────────────────────────────────────────────
    const auditPath = parseAuditPath(url.pathname);

    if (req.method === "GET" && auditPath && !auditPath.action) {
      if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });

      // Look up audit by runId — we need slug.  Try local store first.
      // The store expects both slug and runId.  We derive slug from the
      // runId by scanning the artifacts directory (local only).
      let statusResult = null;
      if (!config.reportsBucket) {
        // For local store we can scan for the runId
        const { readdir } = await import("node:fs/promises");
        try {
          const slugs = await readdir(config.artifactDir);
          for (const slug of slugs) {
            try {
              const st = await store.getStatus(slug, auditPath.runId);
              if (st) {
                statusResult = { ...st, slug };
                break;
              }
            } catch { /* skip */ }
          }
        } catch { /* dir may not exist */ }
      }

      if (!statusResult) {
        return send(res, 404, { error: "Audit not found", runId: auditPath.runId });
      }

      return send(res, 200, statusResult);
    }

    // ── Submit review ──────────────────────────────────────────────────
    if (req.method === "POST" && auditPath && auditPath.action === "review") {
      if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });

      const payload = await readJson(req);

      // Require reviewer identity
      const reviewer = payload.reviewer || req.headers["x-reviewer-identity"] || "";
      if (!reviewer) {
        return send(res, 422, { error: "Reviewer identity is required" });
      }
      payload.reviewer = reviewer;

      const { runId } = auditPath;

      // Find slug
      let slug = payload.slug;
      if (!slug && !config.reportsBucket) {
        const { readdir } = await import("node:fs/promises");
        try {
          const slugs = await readdir(config.artifactDir);
          for (const s of slugs) {
            try {
              const st = await store.getStatus(s, runId);
              if (st) { slug = s; break; }
            } catch { /* skip */ }
          }
        } catch { /* dir may not exist */ }
      }

      if (!slug) {
        return send(res, 404, { error: "Audit not found — supply slug in payload or ensure local storage is in use", runId });
      }

      try {
        const updated = await submitReview(store, slug, runId, payload);
        const status = await store.getStatus(slug, runId);
        return send(res, 200, { status: "reviewed", lifecycle: updated, summary: status });
      } catch (err) {
        return send(res, err.statusCode || 500, { error: err.message, details: err.errors || null });
      }
    }

    // ── Approve audit ──────────────────────────────────────────────────
    if (req.method === "POST" && auditPath && auditPath.action === "approve") {
      if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });

      const payload = await readJson(req);

      // Require approver identity
      const approver = payload.approver || req.headers["x-reviewer-identity"] || "";
      if (!approver) {
        return send(res, 422, { error: "Approver identity is required" });
      }

      const { runId } = auditPath;

      // Find slug
      let slug = payload.slug;
      if (!slug && !config.reportsBucket) {
        const { readdir } = await import("node:fs/promises");
        try {
          const slugs = await readdir(config.artifactDir);
          for (const s of slugs) {
            try {
              const st = await store.getStatus(s, runId);
              if (st) { slug = s; break; }
            } catch { /* skip */ }
          }
        } catch { /* dir may not exist */ }
      }

      if (!slug) {
        return send(res, 404, { error: "Audit not found — supply slug in payload or ensure local storage is in use", runId });
      }

      // Attempt to read the audit model for final rendering
      let model = null;
      try {
        if (!config.reportsBucket) {
          const auditRaw = await store.readFile(`${slug}/${runId}/audit.json`);
          model = JSON.parse(auditRaw.toString("utf8"));
        }
      } catch { /* model not available */ }

      try {
        if (!model) {
          return send(res, 422, { error: "Audit model is required for approval — audit.json could not be read" });
        }

        const result = await approveAudit(store, slug, runId, approver, {
          notes: payload.notes,
          model,
        });
        const status = await store.getStatus(slug, runId);

        return send(res, 200, {
          status: "approved",
          lifecycle: result.lifecycle,
          summary: status,
          pageCount: result.pageCount,
          pdf: "browser-print-only",
        });
      } catch (err) {
        return send(res, err.statusCode || 500, { error: err.message, details: err.errors || null });
      }
    }

    // ── Report delivery (gated) ────────────────────────────────────────
    if (req.method === "GET" && url.pathname.startsWith("/reports/")) {
      const parsed = parseReportPath(url.pathname);
      if (!parsed) {
        return send(res, 404, { error: "Invalid report path" });
      }

      const { slug, runId, rest } = parsed;

      // Path traversal guard
      if (rest.includes("..") || rest.includes("//") || rest.includes("\\")) {
        return send(res, 400, { error: "Invalid report path" });
      }

      // Validate the requested file is a known page name
      const requestedFile = rest.replace(/^\//, "");
      const validPagePattern = /^[a-z0-9_-]+\.(html|json)$/i;
      if (!validPagePattern.test(requestedFile)) {
        return send(res, 400, { error: "Invalid report file name" });
      }

      // Delivery gate: only approved reports are served as final
      let lifecycle = null;
      try {
        lifecycle = await store.getStatus(slug, runId);
      } catch { /* not found */ }

      // Only APPROVED reports may be served as final
      if (!lifecycle || lifecycle.status !== LIFECYCLE_STATUS.APPROVED) {
        return send(res, 403, {
          error: "Report not available",
          code: "REPORT_NOT_APPROVED",
          message: "This report has not been approved for delivery.",
          status: lifecycle?.status || "unknown",
        });
      }

      // Validate the requested page is in the approved artifacts
      const finalArtifacts = lifecycle.artifacts?.final || [];
      if (!finalArtifacts.includes(requestedFile)) {
        return send(res, 404, {
          error: "Page not found in approved report",
          code: "PAGE_NOT_FOUND",
        });
      }

      // Serve from local store
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

    // ── Fallback ───────────────────────────────────────────────────────
    return send(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: error.message });
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Vantage worker listening on :${config.port}`);
});

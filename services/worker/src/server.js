import { createServer } from "node:http";
import { extname } from "node:path";
import { runAudit } from "./audit/run-audit.js";
import { loadConfig } from "./config.js";
import { createLocalReportStore } from "./storage/report-store.js";

const config = loadConfig();
const localStore = createLocalReportStore({ baseDir: config.artifactDir, publicBaseUrl: config.publicReportBaseUrl });
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok", service: "vantage-worker", version: "0.2.0" });
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,authorization,x-vantage-secret" });
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/audits") {
      if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
      const input = await readJson(req);
      const result = await runAudit(input, { config });
      return send(res, 201, {
        status: result.status,
        runId: result.runId,
        slug: result.slug,
        reportUrl: result.storage.reportUrl,
        reportPath: result.storage.indexPath || result.storage.indexKey,
        scores: result.model.scores,
        evidence: result.manifest.sources,
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/reports/") && !config.reportsBucket) {
      const relative = decodeURIComponent(url.pathname.slice("/reports/".length));
      try {
        const file = await localStore.readFile(relative);
        return send(res, 200, file, contentType(relative));
      } catch {
        return send(res, 404, { error: "Report file not found" });
      }
    }
    return send(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: error.message });
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Vantage worker listening on :${config.port}`);
});

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, normalize, sep } from "node:path";
import { slugify } from "../utils.js";

function safeSegment(value) {
  const segment = slugify(value);
  if (!segment || segment.includes("..") || segment.includes("/") || segment.includes("\\")) throw new Error(`Invalid artifact path segment: ${value}`);
  return segment;
}

function reportFiles(payload) {
  return [
    { name: "index.html", body: payload.html, contentType: "text/html; charset=utf-8" },
    { name: "audit.json", body: JSON.stringify(payload.model, null, 2), contentType: "application/json" },
    { name: "evidence.json", body: JSON.stringify(payload.model.evidence, null, 2), contentType: "application/json" },
    { name: "manifest.json", body: JSON.stringify(payload.manifest, null, 2), contentType: "application/json" },
  ];
}

export function createLocalReportStore(options = {}) {
  const baseDir = resolve(options.baseDir || "artifacts/reports");
  const publicBaseUrl = (options.publicBaseUrl || "").replace(/\/$/, "");
  return {
    type: "local",
    async writeReport(payload) {
      const slug = safeSegment(payload.slug);
      const runId = safeSegment(payload.runId);
      const dir = resolve(baseDir, slug, runId);
      if (!(dir === baseDir || dir.startsWith(baseDir + sep))) throw new Error("Report output escaped base directory");
      await mkdir(dir, { recursive: true });
      for (const file of reportFiles(payload)) await writeFile(join(dir, file.name), file.body, "utf8");
      const relativePath = `${slug}/${runId}/index.html`;
      return {
        type: "local",
        directory: dir,
        indexPath: join(dir, "index.html"),
        reportUrl: publicBaseUrl ? `${publicBaseUrl}/reports/${relativePath}` : null,
        relativePath,
      };
    },
    async readFile(relativePath) {
      const full = resolve(baseDir, normalize(relativePath));
      if (!(full === baseDir || full.startsWith(baseDir + sep))) throw new Error("Requested report path escaped base directory");
      return readFile(full);
    },
  };
}

export function createS3ReportStore(options = {}) {
  if (!options.bucket) throw new Error("S3 report store requires bucket");
  let client = options.client || null;
  let commands = null;
  async function aws() {
    if (!commands) commands = await import("@aws-sdk/client-s3");
    if (!client) client = new commands.S3Client({ region: options.region || "ca-central-1" });
    return commands;
  }
  const bucket = options.bucket;
  const prefix = String(options.prefix || "vantage/reports").replace(/^\/+|\/+$/g, "");
  const publicBaseUrl = (options.publicBaseUrl || "").replace(/\/$/, "");
  return {
    type: "s3",
    async writeReport(payload) {
      const slug = safeSegment(payload.slug);
      const runId = safeSegment(payload.runId);
      const baseKey = `${prefix}/${slug}/${runId}`;
      for (const file of reportFiles(payload)) {
        const { PutObjectCommand } = await aws();
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: `${baseKey}/${file.name}`,
          Body: file.body,
          ContentType: file.contentType,
          CacheControl: file.name === "index.html" ? "no-cache" : "private, max-age=3600",
        }));
      }
      return {
        type: "s3",
        bucket,
        baseKey,
        indexKey: `${baseKey}/index.html`,
        reportUrl: publicBaseUrl ? `${publicBaseUrl}/${slug}/${runId}/index.html` : null,
      };
    },
    async readFile(key) {
      const { GetObjectCommand } = await aws();
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await response.Body.transformToByteArray());
    },
  };
}

export function createReportStore(config, overrides = {}) {
  if (config.reportsBucket) {
    return createS3ReportStore({
      bucket: config.reportsBucket,
      region: config.awsRegion,
      prefix: config.reportsPrefix,
      publicBaseUrl: config.publicReportBaseUrl,
      client: overrides.s3Client,
    });
  }
  return createLocalReportStore({ baseDir: config.artifactDir, publicBaseUrl: config.publicReportBaseUrl });
}

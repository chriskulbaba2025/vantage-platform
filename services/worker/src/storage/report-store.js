import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join, normalize, sep, dirname } from "node:path";
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

// ---------------------------------------------------------------------------
// Local store with lifecycle persistence
// ---------------------------------------------------------------------------

export function createLocalReportStore(options = {}) {
  const baseDir = resolve(options.baseDir || "artifacts/reports");
  const publicBaseUrl = (options.publicBaseUrl || "").replace(/\/$/, "");

  function reportDir(slug, runId) {
    return resolve(baseDir, safeSegment(slug), safeSegment(runId));
  }

  function lifecyclePath(slug, runId) {
    return join(reportDir(slug, runId), "lifecycle.json");
  }

  // Atomic write: write to temp, then rename (POSIX rename is atomic)
  async function atomicWrite(path, content) {
    const tmp = path + ".tmp." + Date.now();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tmp, content, "utf8");
    await rename(tmp, path);
  }

  async function readLifecycle(slug, runId) {
    try {
      const raw = await readFile(lifecyclePath(slug, runId), "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function writeLifecycle(slug, runId, data) {
    await atomicWrite(lifecyclePath(slug, runId), JSON.stringify(data, null, 2));
  }

  /** Initialise lifecycle on first write. */
  async function initLifecycle(slug, runId) {
    const existing = await readLifecycle(slug, runId);
    if (existing) return existing;
    const initial = {
      runId,
      slug,
      status: "draft",
      createdAt: new Date().toISOString(),
      review: null,
      approval: null,
      overrides: [],
      artifacts: {
        draft: ["index.html", "audit.json", "evidence.json", "manifest.json"],
        final: null, // populated on approval
      },
      limitations: [],
    };
    await writeLifecycle(slug, runId, initial);
    return initial;
  }

  return {
    type: "local",

    // ── Report persistence (unchanged) ────────────────────────────────
    async writeReport(payload) {
      const slug = safeSegment(payload.slug);
      const runId = safeSegment(payload.runId);
      const dir = reportDir(slug, runId);
      if (!(dir === baseDir || dir.startsWith(baseDir + sep))) throw new Error("Report output escaped base directory");
      await mkdir(dir, { recursive: true });
      for (const file of reportFiles(payload)) await writeFile(join(dir, file.name), file.body, "utf8");

      // Init draft lifecycle
      await initLifecycle(slug, runId);

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

    /** Atomically persist updated evidence and model for an existing audit. */
    async writeEvidenceAndModel(slug, runId, evidence, model) {
      const dir = reportDir(slug, runId);
      if (!(dir === baseDir || dir.startsWith(baseDir + sep))) throw new Error("Report output escaped base directory");
      await mkdir(dir, { recursive: true });

      // Write evidence and model atomically (temp → rename)
      await atomicWrite(join(dir, "evidence.json"), JSON.stringify(evidence, null, 2));
      await atomicWrite(join(dir, "audit.json"), JSON.stringify(model, null, 2));
    },

    // ── Lifecycle operations ──────────────────────────────────────────

    /** Get full lifecycle state for an audit. */
    async getStatus(slug, runId) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) return null;

      // Determine review completion
      const reviewComplete = lc.review
        ? lc.review.checklist?.every((item) => item.reviewed) ?? false
        : false;

      return {
        runId: lc.runId,
        slug: lc.slug,
        status: lc.status,
        reviewComplete,
        reviewer: lc.review?.reviewer ?? null,
        reviewedAt: lc.review?.reviewedAt ?? null,
        approver: lc.approval?.approver ?? null,
        approvedAt: lc.approval?.approvedAt ?? null,
        artifacts: lc.artifacts ?? { draft: [], final: null },
        limitations: lc.limitations ?? [],
        overrides: lc.overrides ?? [],
      };
    },

    /** Persist a review record. Rejects if audit is not in draft or reviewed state. */
    async writeReview(slug, runId, reviewRecord) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });

      // Allow review in draft or already-reviewed state (re-review)
      if (lc.status !== "draft" && lc.status !== "reviewed") {
        throw Object.assign(
          new Error(`Cannot review audit in "${lc.status}" status`),
          { statusCode: 409 },
        );
      }

      // Always append overrides from review rather than replacing
      const existingOverrides = Array.isArray(lc.overrides) ? lc.overrides : [];
      const newOverrides = Array.isArray(reviewRecord.overrides)
        ? reviewRecord.overrides
        : [];

      const updated = {
        ...lc,
        status: "reviewed",
        review: {
          reviewer: reviewRecord.reviewer,
          reviewedAt: reviewRecord.reviewedAt,
          checklist: reviewRecord.checklist,
          findingsReviewed: reviewRecord.findingsReviewed ?? null,
          notes: reviewRecord.notes ?? null,
          limitationsAccepted: reviewRecord.limitationsAccepted ?? false,
        },
        overrides: [...existingOverrides, ...newOverrides],
        updatedAt: new Date().toISOString(),
      };

      await writeLifecycle(slug, runId, updated);
      return updated;
    },

    /** Persist approval. Rejects if review is incomplete or status is wrong. */
    async writeApproval(slug, runId, approvalRecord) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });

      if (lc.status === "approved") {
        // Idempotent — return existing approval
        return lc;
      }

      if (lc.status !== "reviewed" && lc.status !== "draft") {
        throw Object.assign(
          new Error(`Cannot approve audit in "${lc.status}" status`),
          { statusCode: 409 },
        );
      }

      // Ensure review is complete
      const reviewComplete = lc.review?.checklist?.every((item) => item.reviewed) ?? false;
      if (!reviewComplete) {
        throw Object.assign(
          new Error("Approval rejected — review checklist is incomplete"),
          { statusCode: 422 },
        );
      }

      const updated = {
        ...lc,
        status: "approved",
        approval: {
          approver: approvalRecord.approver,
          approvedAt: approvalRecord.approvedAt,
          reviewRef: approvalRecord.reviewRef,
          notes: approvalRecord.notes ?? null,
          overrides: approvalRecord.overrides ?? [],
        },
        artifacts: {
          ...(lc.artifacts || { draft: [] }),
          final: ["index.html", "audit.json", "evidence.json", "manifest.json"],
        },
        updatedAt: new Date().toISOString(),
      };

      await writeLifecycle(slug, runId, updated);
      return updated;
    },

    /** Record a limitation (e.g. PDF failure). Append-only. */
    async addLimitation(slug, runId, limitation) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });
      const updated = {
        ...lc,
        limitations: [...(lc.limitations || []), String(limitation)],
        updatedAt: new Date().toISOString(),
      };
      await writeLifecycle(slug, runId, updated);
      return updated;
    },

    /**
     * Write approved multi-page report atomically.
     *
     * All pages must be written successfully. If any write fails, previously
     * written pages are removed and the lifecycle is NOT updated to approved.
     *
     * @param {string} slug
     * @param {string} runId
     * @param {object} approvalRecord — built by buildApprovalRecord
     * @param {Map<string,string>} pages — filename → full HTML content
     * @returns {object} updated lifecycle
     */
    async writeApprovedPages(slug, runId, approvalRecord, pages) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });

      if (lc.status === "approved") {
        // Idempotent — return existing
        return lc;
      }

      if (lc.status !== "reviewed" && lc.status !== "draft") {
        throw Object.assign(
          new Error(`Cannot approve audit in "${lc.status}" status`),
          { statusCode: 409 },
        );
      }

      const reviewComplete = lc.review?.checklist?.every((item) => item.reviewed) ?? false;
      if (!reviewComplete) {
        throw Object.assign(
          new Error("Approval rejected — review checklist is incomplete"),
          { statusCode: 422 },
        );
      }

      // Validate pages is non-empty
      if (!pages || !(pages instanceof Map) || pages.size === 0) {
        throw Object.assign(
          new Error("Approval requires at least one approved page"),
          { statusCode: 422 },
        );
      }

      const dir = reportDir(slug, runId);
      const pageFilenames = [];

      // Write all pages. On first failure, clean up and throw.
      try {
        for (const [filename, content] of pages) {
          // Path traversal guard
          if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
            throw new Error(`Invalid page filename: ${filename}`);
          }
          await writeFile(join(dir, filename), content, "utf8");
          pageFilenames.push(filename);
        }
      } catch (writeErr) {
        // Best-effort cleanup of any pages we already wrote
        const { unlink } = await import("node:fs/promises");
        for (const fn of pageFilenames) {
          try { await unlink(join(dir, fn)); } catch { /* best effort */ }
        }
        throw Object.assign(
          new Error(`Approved page write failed: ${writeErr.message}`),
          { statusCode: 500 },
        );
      }

      // All pages written — update lifecycle
      const updated = {
        ...lc,
        status: "approved",
        approval: {
          approver: approvalRecord.approver,
          approvedAt: approvalRecord.approvedAt,
          reviewRef: approvalRecord.reviewRef,
          notes: approvalRecord.notes ?? null,
          overrides: approvalRecord.overrides ?? [],
        },
        artifacts: {
          ...(lc.artifacts || { draft: [] }),
          final: pageFilenames,
        },
        updatedAt: new Date().toISOString(),
      };

      await writeLifecycle(slug, runId, updated);
      return updated;
    },

    /** Read raw lifecycle record (for internal use). */
    async _readLifecycle(slug, runId) {
      return readLifecycle(slug, runId);
    },
  };
}

// ---------------------------------------------------------------------------
// S3 store with lifecycle persistence
// ---------------------------------------------------------------------------

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

  function lifecycleKey(slug, runId) {
    return `${prefix}/${safeSegment(slug)}/${safeSegment(runId)}/lifecycle.json`;
  }

  async function readLifecycle(slug, runId) {
    try {
      const { GetObjectCommand } = await aws();
      const response = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: lifecycleKey(slug, runId),
      }));
      const raw = await response.Body.transformToString("utf8");
      return JSON.parse(raw);
    } catch (err) {
      if (err.name === "NoSuchKey") return null;
      throw err;
    }
  }

  async function writeLifecycle(slug, runId, data, ifMatchStatus) {
    const { PutObjectCommand } = await aws();
    const key = lifecycleKey(slug, runId);

    // Simple optimistic concurrency: re-read and check status
    if (ifMatchStatus) {
      const current = await readLifecycle(slug, runId);
      if (current && current.status !== ifMatchStatus) {
        throw Object.assign(
          new Error(`Concurrent modification detected — expected "${ifMatchStatus}", got "${current.status}"`),
          { statusCode: 409 },
        );
      }
    }

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: "application/json",
      CacheControl: "no-cache",
    }));
  }

  async function initLifecycle(slug, runId) {
    const existing = await readLifecycle(slug, runId);
    if (existing) return existing;
    const initial = {
      runId,
      slug,
      status: "draft",
      createdAt: new Date().toISOString(),
      review: null,
      approval: null,
      overrides: [],
      artifacts: { draft: ["index.html", "audit.json", "evidence.json", "manifest.json"], final: null },
      limitations: [],
    };
    await writeLifecycle(slug, runId, initial);
    return initial;
  }

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
      await initLifecycle(slug, runId);
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

    async getStatus(slug, runId) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) return null;
      const reviewComplete = lc.review
        ? lc.review.checklist?.every((item) => item.reviewed) ?? false
        : false;
      return {
        runId: lc.runId,
        slug: lc.slug,
        status: lc.status,
        reviewComplete,
        reviewer: lc.review?.reviewer ?? null,
        reviewedAt: lc.review?.reviewedAt ?? null,
        approver: lc.approval?.approver ?? null,
        approvedAt: lc.approval?.approvedAt ?? null,
        artifacts: lc.artifacts ?? { draft: [], final: null },
        limitations: lc.limitations ?? [],
        overrides: lc.overrides ?? [],
      };
    },

    /** Atomically persist updated evidence and model (S3). */
    async writeEvidenceAndModel(slug, runId, _evidence, _model) {
      // S3 path: re-upload evidence.json + audit.json
      const s3Client = resolvedS3Client;
      if (!s3Client || !reportsBucket) {
        throw new Error("S3 client or bucket not configured for evidence/model persistence");
      }
      const evidenceKey = `${reportsPrefix}/${slug}/${runId}/evidence.json`;
      const auditKey = `${reportsPrefix}/${slug}/${runId}/audit.json`;
      await Promise.all([
        s3Client.send(new (await import("@aws-sdk/client-s3")).PutObjectCommand({ Bucket: reportsBucket, Key: evidenceKey, Body: JSON.stringify(_evidence, null, 2), ContentType: "application/json; charset=utf-8" })),
        s3Client.send(new (await import("@aws-sdk/client-s3")).PutObjectCommand({ Bucket: reportsBucket, Key: auditKey, Body: JSON.stringify(_model, null, 2), ContentType: "application/json; charset=utf-8" })),
      ]);
    },

    async writeReview(slug, runId, reviewRecord) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });
      if (lc.status !== "draft" && lc.status !== "reviewed") {
        throw Object.assign(new Error(`Cannot review audit in "${lc.status}" status`), { statusCode: 409 });
      }
      const existingOverrides = Array.isArray(lc.overrides) ? lc.overrides : [];
      const newOverrides = Array.isArray(reviewRecord.overrides) ? reviewRecord.overrides : [];
      const updated = {
        ...lc, status: "reviewed",
        review: {
          reviewer: reviewRecord.reviewer, reviewedAt: reviewRecord.reviewedAt,
          checklist: reviewRecord.checklist, findingsReviewed: reviewRecord.findingsReviewed ?? null,
          notes: reviewRecord.notes ?? null, limitationsAccepted: reviewRecord.limitationsAccepted ?? false,
        },
        overrides: [...existingOverrides, ...newOverrides],
        updatedAt: new Date().toISOString(),
      };
      await writeLifecycle(slug, runId, updated, lc.status);
      return updated;
    },

    async writeApproval(slug, runId, approvalRecord) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });
      if (lc.status === "approved") return lc; // idempotent
      if (lc.status !== "reviewed" && lc.status !== "draft") {
        throw Object.assign(new Error(`Cannot approve audit in "${lc.status}" status`), { statusCode: 409 });
      }
      const reviewComplete = lc.review?.checklist?.every((item) => item.reviewed) ?? false;
      if (!reviewComplete) {
        throw Object.assign(new Error("Approval rejected — review checklist is incomplete"), { statusCode: 422 });
      }
      const updated = {
        ...lc, status: "approved",
        approval: {
          approver: approvalRecord.approver, approvedAt: approvalRecord.approvedAt,
          reviewRef: approvalRecord.reviewRef, notes: approvalRecord.notes ?? null,
          overrides: approvalRecord.overrides ?? [],
        },
        artifacts: { ...(lc.artifacts || { draft: [] }), final: ["index.html", "audit.json", "evidence.json", "manifest.json"] },
        updatedAt: new Date().toISOString(),
      };
      await writeLifecycle(slug, runId, updated, lc.status);
      return updated;
    },

    async addLimitation(slug, runId, limitation) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });
      const updated = { ...lc, limitations: [...(lc.limitations || []), String(limitation)], updatedAt: new Date().toISOString() };
      await writeLifecycle(slug, runId, updated, lc.status);
      return updated;
    },

    async writeApprovedPages(slug, runId, approvalRecord, pages) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });

      if (lc.status === "approved") return lc;

      if (lc.status !== "reviewed" && lc.status !== "draft") {
        throw Object.assign(new Error(`Cannot approve audit in "${lc.status}" status`), { statusCode: 409 });
      }

      const reviewComplete = lc.review?.checklist?.every((item) => item.reviewed) ?? false;
      if (!reviewComplete) {
        throw Object.assign(new Error("Approval rejected — review checklist is incomplete"), { statusCode: 422 });
      }

      if (!pages || !(pages instanceof Map) || pages.size === 0) {
        throw Object.assign(new Error("Approval requires at least one approved page"), { statusCode: 422 });
      }

      const baseKey = `${prefix}/${safeSegment(slug)}/${safeSegment(runId)}`;
      const { PutObjectCommand, DeleteObjectCommand } = await aws();
      const writtenKeys = [];

      // Write all pages. On failure, clean up written objects and throw.
      try {
        for (const [filename, content] of pages) {
          if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
            throw new Error(`Invalid page filename: ${filename}`);
          }
          const key = `${baseKey}/${filename}`;
          await client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: content,
            ContentType: "text/html; charset=utf-8",
            CacheControl: filename === "index.html" ? "no-cache" : "private, max-age=3600",
          }));
          writtenKeys.push(key);
        }
      } catch (writeErr) {
        // Best-effort cleanup
        for (const key of writtenKeys) {
          try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); } catch { /* best effort */ }
        }
        throw Object.assign(new Error(`Approved page write failed: ${writeErr.message}`), { statusCode: 500 });
      }

      const pageFilenames = [...pages.keys()];
      const updated = {
        ...lc, status: "approved",
        approval: {
          approver: approvalRecord.approver, approvedAt: approvalRecord.approvedAt,
          reviewRef: approvalRecord.reviewRef, notes: approvalRecord.notes ?? null,
          overrides: approvalRecord.overrides ?? [],
        },
        artifacts: { ...(lc.artifacts || { draft: [] }), final: pageFilenames },
        updatedAt: new Date().toISOString(),
      };
      await writeLifecycle(slug, runId, updated, lc.status);
      return updated;
    },

    async _readLifecycle(slug, runId) {
      return readLifecycle(slug, runId);
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

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

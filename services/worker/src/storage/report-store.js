import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, join, normalize, sep, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { slugify } from "../utils.js";

function createTransactionId() {
  return `txn-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

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

    /**
     * Atomic competitor-review transaction.
     *
     * Stages updated evidence, model, and review record, then commits by
     * atomically writing the lifecycle.  If any stage fails, the lifecycle
     * is not updated and the previous state remains fully active.
     *
     * Post-commit, staged artifacts are copied to canonical paths
     * (best-effort — the transaction directory is canonical if copies fail).
     */
    async commitCompetitorReview({ slug, runId, evidence, model, reviewRecord }) {
      const dir = reportDir(slug, runId);
      if (!(dir === baseDir || dir.startsWith(baseDir + sep))) throw new Error("Report output escaped base directory");

      // Load current lifecycle (must exist)
      const currentLc = await readLifecycle(slug, runId);
      if (!currentLc) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });
      if (currentLc.status !== "draft" && currentLc.status !== "reviewed") {
        throw Object.assign(new Error(`Cannot review audit in "${currentLc.status}" status`), { statusCode: 409 });
      }

      const txId = createTransactionId();
      const txnDir = join(dir, ".txn", txId);
      const evidenceBody = JSON.stringify(evidence, null, 2);
      const modelBody = JSON.stringify(model, null, 2);
      const reviewBody = JSON.stringify(reviewRecord, null, 2);

      // ── Stage all artifacts ──────────────────────────────────────────
      try {
        await mkdir(txnDir, { recursive: true });
        await writeFile(join(txnDir, "evidence.json"), evidenceBody, "utf8");
        await writeFile(join(txnDir, "audit.json"), modelBody, "utf8");
        await writeFile(join(txnDir, "review-record.json"), reviewBody, "utf8");

        const meta = {
          txId,
          createdAt: new Date().toISOString(),
          checksums: {
            evidence: sha256(evidenceBody),
            model: sha256(modelBody),
            review: sha256(reviewBody),
          },
        };
        await writeFile(join(txnDir, "tx-meta.json"), JSON.stringify(meta, null, 2), "utf8");

        // Verify all staged files exist and match checksums
        const verifyEvidence = await readFile(join(txnDir, "evidence.json"), "utf8");
        const verifyModel = await readFile(join(txnDir, "audit.json"), "utf8");
        const verifyReview = await readFile(join(txnDir, "review-record.json"), "utf8");
        if (sha256(verifyEvidence) !== meta.checksums.evidence) throw new Error("Staged evidence checksum mismatch");
        if (sha256(verifyModel) !== meta.checksums.model) throw new Error("Staged model checksum mismatch");
        if (sha256(verifyReview) !== meta.checksums.review) throw new Error("Staged review checksum mismatch");
      } catch (stageErr) {
        // Clean up staging — but don't touch active state
        try { await rm(txnDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        throw stageErr;
      }

      // ── Commit: atomically write lifecycle (this IS the commit barrier) ──
      const existingOverrides = Array.isArray(currentLc.overrides) ? currentLc.overrides : [];
      const newOverrides = Array.isArray(reviewRecord.overrides) ? reviewRecord.overrides : [];

      const updatedLc = {
        ...currentLc,
        status: "reviewed",
        activeReviewTxId: txId,
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

      try {
        await atomicWrite(lifecyclePath(slug, runId), JSON.stringify(updatedLc, null, 2));
      } catch (commitErr) {
        // Lifecycle write failed — clean staging but leave active state intact
        try { await rm(txnDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        throw commitErr;
      }

      // ── Post-commit: copy staged to canonical paths (best-effort) ──
      try {
        await atomicWrite(join(dir, "evidence.json"), evidenceBody);
        await atomicWrite(join(dir, "audit.json"), modelBody);
      } catch { /* canonical copies are best-effort — txn dir is authoritative */ }

      return updatedLc;
    },

    /**
     * Read evidence.json and audit.json for the active committed state.
     * Resolves through the lifecycle's activeReviewTxId, falling back to
     * canonical paths.
     */
    async readCommittedArtifacts(slug, runId) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) return null;

      const dir = reportDir(slug, runId);
      const txId = lc.activeReviewTxId || lc.activeApprovalTxId || null;

      if (txId) {
        // ── Transaction path: all four artifacts are mandatory ──────────
        const txnDir = join(dir, ".txn", txId);
        try {
          // Read tx-meta
          const metaRaw = await readFile(join(txnDir, "tx-meta.json"), "utf8");
          const meta = JSON.parse(metaRaw);
          if (meta.txId !== txId) return null;

          // All three checksums are mandatory for active transactions
          if (!meta.checksums?.evidence || !meta.checksums?.model || !meta.checksums?.review) return null;

          // Read all three artifacts — review-record.json is MANDATORY
          const [evidenceRaw, modelRaw, reviewRaw] = await Promise.all([
            readFile(join(txnDir, "evidence.json"), "utf8"),
            readFile(join(txnDir, "audit.json"), "utf8"),
            readFile(join(txnDir, "review-record.json"), "utf8"),
          ]);

          // Verify all three checksums
          if (sha256(evidenceRaw) !== meta.checksums.evidence) return null;
          if (sha256(modelRaw) !== meta.checksums.model) return null;
          if (sha256(reviewRaw) !== meta.checksums.review) return null;

          // Parse review — must be valid JSON
          let parsedReview;
          try { parsedReview = JSON.parse(reviewRaw); } catch { return null; }

          // Full lifecycle agreement (all fields, null-safe)
          const nil = (v) => (v === undefined || v === null) ? null : v;
          if (lc.review) {
            if (parsedReview.reviewer !== lc.review.reviewer) return null;
            if (parsedReview.reviewedAt !== lc.review.reviewedAt) return null;
            if (nil(parsedReview.notes) !== nil(lc.review.notes)) return null;
            if (!!parsedReview.limitationsAccepted !== !!lc.review.limitationsAccepted) return null;
            if (nil(parsedReview.findingsReviewed) !== nil(lc.review.findingsReviewed)) return null;
            // Checklist: same IDs and reviewed values
            const txChecklist = (parsedReview.checklist || []).map((c) => `${c.id}:${c.reviewed}`).sort().join(",");
            const lcChecklist = (lc.review.checklist || []).map((c) => `${c.id}:${c.reviewed}`).sort().join(",");
            if (txChecklist !== lcChecklist) return null;
            // Lifecycle overrides must include all review overrides (review = subset)
            const reviewOverrides = parsedReview.overrides || [];
            const lcOverrides = lc.overrides || [];
            for (const ro of reviewOverrides) {
              const found = lcOverrides.some((lo) =>
                lo.user === ro.user && lo.field === ro.field &&
                lo.replacementValue === ro.replacementValue && lo.timestamp === ro.timestamp);
              if (!found) return null;
            }
          }

          return {
            evidence: JSON.parse(evidenceRaw),
            model: JSON.parse(modelRaw),
            reviewRecord: parsedReview,
            txId,
          };
        } catch {
          return null;
        }
      }

      // ── Pre-transaction path: read canonical files ────────────────────
      try {
        const [evidenceRaw, modelRaw] = await Promise.all([
          readFile(join(dir, "evidence.json"), "utf8"),
          readFile(join(dir, "audit.json"), "utf8"),
        ]);
        return {
          evidence: JSON.parse(evidenceRaw),
          model: JSON.parse(modelRaw),
          reviewRecord: null,
          txId: null,
        };
      } catch {
        return null;
      }
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

    /**
     * Atomic competitor-review transaction (S3).
     *
     * Stages to versioned prefix, verifies all writes, then commits
     * by writing the lifecycle.  The lifecycle's activeReviewTxId is
     * the sole commit pointer.  Orphaned staged objects are safe.
     */
    async commitCompetitorReview({ slug, runId, evidence, model, reviewRecord }) {
      const s3Client = resolvedS3Client;
      if (!s3Client || !reportsBucket) {
        throw new Error("S3 client or bucket not configured");
      }

      const currentLc = await readLifecycle(slug, runId);
      if (!currentLc) throw Object.assign(new Error("Audit not found"), { statusCode: 404 });
      if (currentLc.status !== "draft" && currentLc.status !== "reviewed") {
        throw Object.assign(new Error(`Cannot review audit in "${currentLc.status}" status`), { statusCode: 409 });
      }

      const { S3Client: _S3, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const txId = createTransactionId();
      const txnPrefix = `${reportsPrefix}/${slug}/${runId}/.txn/${txId}`;
      const evidenceBody = JSON.stringify(evidence, null, 2);
      const modelBody = JSON.stringify(model, null, 2);
      const reviewBody = JSON.stringify(reviewRecord, null, 2);

      const putOpts = { Bucket: reportsBucket, ContentType: "application/json; charset=utf-8", CacheControl: "no-cache" };

      // ── Stage all artifacts ──────────────────────────────────────────
      const stageResults = await Promise.allSettled([
        s3Client.send(new PutObjectCommand({ ...putOpts, Key: `${txnPrefix}/evidence.json`, Body: evidenceBody })),
        s3Client.send(new PutObjectCommand({ ...putOpts, Key: `${txnPrefix}/audit.json`, Body: modelBody })),
        s3Client.send(new PutObjectCommand({ ...putOpts, Key: `${txnPrefix}/review-record.json`, Body: reviewBody })),
        s3Client.send(new PutObjectCommand({ ...putOpts, Key: `${txnPrefix}/tx-meta.json`, Body: JSON.stringify({
          txId, createdAt: new Date().toISOString(),
          checksums: { evidence: sha256(evidenceBody), model: sha256(modelBody), review: sha256(reviewBody) },
        }) })),
      ]);

      const failed = stageResults.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        throw new Error(`S3 staging failed: ${failed.map((f) => f.reason?.message).join("; ")}`);
      }

      // ── Commit: write lifecycle (the commit barrier) ──
      const existingOverrides = Array.isArray(currentLc.overrides) ? currentLc.overrides : [];
      const newOverrides = Array.isArray(reviewRecord.overrides) ? reviewRecord.overrides : [];
      const updatedLc = {
        ...currentLc, status: "reviewed", activeReviewTxId: txId,
        review: {
          reviewer: reviewRecord.reviewer, reviewedAt: reviewRecord.reviewedAt,
          checklist: reviewRecord.checklist, findingsReviewed: reviewRecord.findingsReviewed ?? null,
          notes: reviewRecord.notes ?? null, limitationsAccepted: reviewRecord.limitationsAccepted ?? false,
        },
        overrides: [...existingOverrides, ...newOverrides],
        updatedAt: new Date().toISOString(),
      };

      try {
        await s3Client.send(new PutObjectCommand({
          ...putOpts, Key: lifecycleKey(slug, runId),
          Body: JSON.stringify(updatedLc, null, 2),
        }));
      } catch (commitErr) {
        throw commitErr; // lifecycle unchanged → staged objects are orphaned but harmless
      }

      // Post-commit canonical copies (best-effort)
      try {
        await Promise.allSettled([
          s3Client.send(new PutObjectCommand({ ...putOpts, Key: `${reportsPrefix}/${slug}/${runId}/evidence.json`, Body: evidenceBody })),
          s3Client.send(new PutObjectCommand({ ...putOpts, Key: `${reportsPrefix}/${slug}/${runId}/audit.json`, Body: modelBody })),
        ]);
      } catch { /* canonical copies are best-effort */ }

      return updatedLc;
    },

    /**
     * Read committed artifacts for the active transaction.
     */
    async readCommittedArtifacts(slug, runId) {
      const lc = await readLifecycle(slug, runId);
      if (!lc) return null;
      const txId = lc.activeReviewTxId || lc.activeApprovalTxId || null;
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const s3Client = resolvedS3Client;
      if (!s3Client) return null;

      const getKey = (filename) => {
        if (txId) return `${reportsPrefix}/${slug}/${runId}/.txn/${txId}/${filename}`;
        return `${reportsPrefix}/${slug}/${runId}/${filename}`;
      };

      if (txId) {
        try {
          // All four artifacts mandatory for active transactions
          const [metaResp, evResp, mdResp, revResp] = await Promise.all([
            s3Client.send(new GetObjectCommand({ Bucket: reportsBucket, Key: getKey("tx-meta.json") })),
            s3Client.send(new GetObjectCommand({ Bucket: reportsBucket, Key: getKey("evidence.json") })),
            s3Client.send(new GetObjectCommand({ Bucket: reportsBucket, Key: getKey("audit.json") })),
            s3Client.send(new GetObjectCommand({ Bucket: reportsBucket, Key: getKey("review-record.json") })),
          ]);
          const metaRaw = await metaResp.Body.transformToString("utf8");
          const meta = JSON.parse(metaRaw);
          if (meta.txId !== txId) return null;
          if (!meta.checksums?.evidence || !meta.checksums?.model || !meta.checksums?.review) return null;

          const [evidenceRaw, modelRaw, reviewRaw] = await Promise.all([
            evResp.Body.transformToString("utf8"), mdResp.Body.transformToString("utf8"), revResp.Body.transformToString("utf8"),
          ]);
          if (sha256(evidenceRaw) !== meta.checksums.evidence) return null;
          if (sha256(modelRaw) !== meta.checksums.model) return null;
          if (sha256(reviewRaw) !== meta.checksums.review) return null;

          let parsedReview;
          try { parsedReview = JSON.parse(reviewRaw); } catch { return null; }

          // Full lifecycle agreement (null-safe, shared with local store)
          const nil = (v) => (v === undefined || v === null) ? null : v;
          if (lc.review) {
            if (parsedReview.reviewer !== lc.review.reviewer) return null;
            if (parsedReview.reviewedAt !== lc.review.reviewedAt) return null;
            if (nil(parsedReview.notes) !== nil(lc.review.notes)) return null;
            if (!!parsedReview.limitationsAccepted !== !!lc.review.limitationsAccepted) return null;
            if (nil(parsedReview.findingsReviewed) !== nil(lc.review.findingsReviewed)) return null;
            const txChecklist = (parsedReview.checklist || []).map((c) => `${c.id}:${c.reviewed}`).sort().join(",");
            const lcChecklist = (lc.review.checklist || []).map((c) => `${c.id}:${c.reviewed}`).sort().join(",");
            if (txChecklist !== lcChecklist) return null;
            // Lifecycle overrides must include all review overrides (review = subset of lifecycle)
            const reviewOverrides = parsedReview.overrides || [];
            const lcOverrides = lc.overrides || [];
            for (const ro of reviewOverrides) {
              const found = lcOverrides.some((lo) =>
                lo.user === ro.user && lo.field === ro.field &&
                lo.replacementValue === ro.replacementValue && lo.timestamp === ro.timestamp);
              if (!found) return null;
            }
          }

          return { evidence: JSON.parse(evidenceRaw), model: JSON.parse(modelRaw), reviewRecord: parsedReview, txId };
        } catch { return null; }
      }

      try {
        const [evResp, mdResp] = await Promise.all([
          s3Client.send(new GetObjectCommand({ Bucket: reportsBucket, Key: getKey("evidence.json") })),
          s3Client.send(new GetObjectCommand({ Bucket: reportsBucket, Key: getKey("audit.json") })),
        ]);
        const evidence = JSON.parse(await evResp.Body.transformToString("utf8"));
        const model = JSON.parse(await mdResp.Body.transformToString("utf8"));
        return { evidence, model, txId: null, reviewRecord: null };
      } catch { return null; }
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

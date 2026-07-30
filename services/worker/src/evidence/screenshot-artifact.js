/**
 * Screenshot Artifact Persistence — Portable Storage Abstraction
 *
 * Decodes and persists Lighthouse/PageSpeed final-screenshot data as
 * immutable audit artifacts using canonical portable references.
 *
 * Portable reference format:
 *   reports/{slug}/{runId}/evidence/screenshots/{filename}.jpg
 *
 * This reference is storage-backend-independent:
 *   - Local: resolved against the configured artifact root directory.
 *   - S3: used directly as the object key prefix.
 *   - Railway: resolved against the Railway volume mount point.
 *
 * The canonical evidence JSON stores ONLY the portable reference.
 * Absolute OS paths are never written to client-facing JSON or HTML.
 *
 * Every artifact carries a companion metadata record containing:
 *   runId, slug, diagnosticCode, provider, requested URL, final URL,
 *   device, collection timestamp, MIME type, size, checksum (sha256),
 *   and the portable artifact reference.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { resolve, normalize, sep, basename } from "node:path";
import { createHash } from "node:crypto";
import { stableHash } from "../utils.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical separator used in portable references (always forward slash). */
const PORTABLE_SEP = "/";

/** MIME type for JPEG screenshots. */
const SCREENSHOT_MIME = "image/jpeg";

/** Minimum valid screenshot size in bytes (anything smaller is blank/corrupt). */
const MIN_SCREENSHOT_SIZE = 100;

// ---------------------------------------------------------------------------
// Portable reference construction & validation
// ---------------------------------------------------------------------------

/**
 * Build a canonical portable artifact reference.
 *
 * Format: reports/{slug}/{runId}/evidence/screenshots/{filename}.jpg
 *
 * This reference is storage-backend-independent and safe to store in
 * canonical JSON, databases, and client-facing artifacts.
 *
 * @param {object}  parts
 * @param {string}  parts.slug     - Audit slug (e.g. "example-business").
 * @param {string}  parts.runId    - Audit run identifier.
 * @param {string}  parts.filename - Image filename (e.g. "screenshot-abc123.jpg").
 * @returns {string} Portable reference.
 */
export function buildPortableRef(parts) {
  const slug = _safeSegment(parts.slug, "slug");
  const runId = _safeSegment(parts.runId, "runId");
  const filename = _safeSegment(parts.filename, "filename");

  return ["reports", slug, runId, "evidence", "screenshots", filename].join(PORTABLE_SEP);
}

/**
 * Validate that a reference is a well-formed portable artifact reference.
 *
 * Rejects:
 *  - Absolute filesystem paths (Windows: C:\, Linux: /)
 *  - Path traversal sequences (.., .)
 *  - Backslashes (Windows paths)
 *  - References that don't match the canonical pattern
 *
 * @param {string} ref - The reference to validate.
 * @returns {{ valid: boolean, error?: string }}
 */
export function isValidPortableRef(ref) {
  if (!ref || typeof ref !== "string") {
    return { valid: false, error: "Reference is null or not a string" };
  }

  // Reject absolute filesystem paths
  if (ref.startsWith("/") || ref.startsWith("\\")) {
    return { valid: false, error: "Reference must not be an absolute path" };
  }

  // Reject Windows absolute paths (C:\, D:\, etc.)
  if (/^[A-Za-z]:[/\\]/.test(ref)) {
    return { valid: false, error: "Reference must not be a Windows absolute path" };
  }

  // Reject path traversal
  if (ref.includes("..")) {
    return { valid: false, error: "Reference must not contain path traversal (..)" };
  }

  // Reject backslashes
  if (ref.includes("\\")) {
    return { valid: false, error: "Reference must use forward slashes, not backslashes" };
  }

  // Must match canonical pattern: reports/{slug}/{runId}/evidence/screenshots/{file}
  const pattern = /^reports\/[^/]+\/[^/]+\/evidence\/screenshots\/[^/]+\.(jpg|jpeg|png)$/i;
  if (!pattern.test(ref)) {
    return { valid: false, error: `Reference does not match canonical pattern: reports/{slug}/{runId}/evidence/screenshots/{file}.{jpg|png}` };
  }

  return { valid: true };
}

/**
 * Resolve a portable reference to a local filesystem path.
 *
 * The reference is validated and then joined with the artifact root.
 * The resolved path is checked to ensure it stays within the root directory.
 *
 * Accepts image refs (.jpg, .jpeg, .png) and companion metadata refs (.meta.json).
 *
 * @param {string} portableRef  - Portable artifact reference.
 * @param {string} artifactRoot - Local artifact root directory.
 * @returns {{ resolvedPath: string|null, error?: string }}
 */
export function resolvePortableRef(portableRef, artifactRoot) {
  if (!portableRef || typeof portableRef !== "string") {
    return { resolvedPath: null, error: "Reference is null or not a string" };
  }

  // Reject absolute paths, traversal, and backslashes
  if (portableRef.startsWith("/") || portableRef.startsWith("\\")) {
    return { resolvedPath: null, error: "Reference must not be an absolute path" };
  }
  if (/^[A-Za-z]:[/\\]/.test(portableRef)) {
    return { resolvedPath: null, error: "Reference must not be a Windows absolute path" };
  }
  if (portableRef.includes("..")) {
    return { resolvedPath: null, error: "Reference must not contain path traversal (..)" };
  }
  if (portableRef.includes("\\")) {
    return { resolvedPath: null, error: "Reference must use forward slashes, not backslashes" };
  }

  // Accept either image files or companion metadata
  const isImage = /^reports\/[^/]+\/[^/]+\/evidence\/screenshots\/[^/]+\.(jpg|jpeg|png)$/i.test(portableRef);
  const isMeta = /^reports\/[^/]+\/[^/]+\/evidence\/screenshots\/[^/]+\.meta\.json$/i.test(portableRef);
  if (!isImage && !isMeta) {
    return { resolvedPath: null, error: `Reference does not match canonical pattern: ${portableRef}` };
  }

  const root = resolve(artifactRoot);
  const joined = resolve(root, ...portableRef.split("/"));

  // Verify resolved path is within artifact root
  const normalizedRoot = normalize(root) + sep;
  const normalizedJoined = normalize(joined) + sep;
  if (!normalizedJoined.startsWith(normalizedRoot)) {
    return { resolvedPath: null, error: `Resolved path escapes artifact root: ${portableRef}` };
  }

  return { resolvedPath: joined };
}

/**
 * Read a screenshot as a data URI suitable for HTML embedding.
 *
 * This is the ONLY function that reads screenshot binary data, and it
 * always resolves through the portable reference + artifact root.
 *
 * @param {string} portableRef  - Portable artifact reference.
 * @param {string} artifactRoot - Local artifact root directory.
 * @returns {{ dataUri: string|null, error?: string }}
 */
export function readScreenshotAsDataUri(portableRef, artifactRoot) {
  if (!portableRef) return { dataUri: null, error: "No portable ref provided" };

  const resolved = resolvePortableRef(portableRef, artifactRoot);
  if (!resolved.resolvedPath) {
    return { dataUri: null, error: resolved.error };
  }

  try {
    if (!existsSync(resolved.resolvedPath)) {
      return { dataUri: null, error: `Screenshot file not found: ${portableRef}` };
    }
    const binary = readFileSync(resolved.resolvedPath);
    if (binary.length === 0) {
      return { dataUri: null, error: "Screenshot file is empty" };
    }
    const dataUri = `data:image/jpeg;base64,${binary.toString("base64")}`;
    return { dataUri };
  } catch (err) {
    return { dataUri: null, error: `Failed to read screenshot: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Persist a screenshot as an immutable audit artifact.
 *
 * Writes the binary image and companion metadata JSON through the storage
 * abstraction. Returns the portable artifact reference — never an absolute
 * OS path.
 *
 * @param {string}       base64Data              - Raw base64-encoded JPEG data
 *                                                (with or without data URI prefix).
 * @param {object}       metadata
 * @param {string}       metadata.runId           - REQUIRED. Audit run identifier.
 * @param {string}       metadata.slug            - REQUIRED. Audit slug.
 * @param {string}       metadata.url             - The tested (requested) URL.
 * @param {string}       [metadata.finalUrl]      - The final URL after redirects.
 * @param {string}       metadata.strategy        - "mobile" or "desktop".
 * @param {string}       metadata.provider        - "pagespeed-insights" or "lighthouse-cli-fallback".
 * @param {string}       [metadata.diagnosticCode] - REQUIRED when associated with a rendering diagnostic.
 * @param {string}       [opts.artifactRoot]      - Local artifact root directory.
 * @param {object}       [opts.objectStore]       - Production object-storage interface
 *                                                  (must implement writeBinary + writeJson).
 * @returns {Promise<{ portableRef: string|null, persisted: boolean, sizeBytes: number, checksum: string|null, error?: string }>}
 */
export async function persistScreenshot(base64Data, metadata, opts = {}) {
  // ── Validate inputs ──────────────────────────────────────────────────
  if (!base64Data || typeof base64Data !== "string") {
    return { portableRef: null, persisted: false, sizeBytes: 0, checksum: null, error: "No base64 data provided" };
  }

  if (!metadata.runId) {
    return { portableRef: null, persisted: false, sizeBytes: 0, checksum: null, error: "runId is required for screenshot persistence" };
  }
  if (!metadata.slug) {
    return { portableRef: null, persisted: false, sizeBytes: 0, checksum: null, error: "slug is required for screenshot persistence" };
  }

  const artifactRoot = opts.artifactRoot || resolve("artifacts");

  try {
    // ── Strip data URI prefix ──────────────────────────────────────────
    const cleaned = base64Data.replace(/^data:image\/\w+;base64,/, "").trim();
    if (!cleaned) {
      return { portableRef: null, persisted: false, sizeBytes: 0, checksum: null, error: "Empty base64 data after stripping prefix" };
    }

    // ── Decode and validate ────────────────────────────────────────────
    const binary = Buffer.from(cleaned, "base64");
    if (binary.length < MIN_SCREENSHOT_SIZE) {
      return { portableRef: null, persisted: false, sizeBytes: binary.length, checksum: null, error: `Screenshot too small (${binary.length} bytes), likely blank or corrupted` };
    }

    // ── Compute checksum ───────────────────────────────────────────────
    const checksum = createHash("sha256").update(binary).digest("hex");

    // ── Build filename and portable reference ──────────────────────────
    const hash = stableHash(`${metadata.url || "unknown"}|${metadata.strategy || "unknown"}|${metadata.provider || "unknown"}|${checksum.slice(0, 12)}`);
    const filename = `screenshot-${hash}.jpg`;
    const portableRef = buildPortableRef({
      slug: metadata.slug,
      runId: metadata.runId,
      filename,
    });

    // ── Write through storage backend ──────────────────────────────────
    const now = new Date().toISOString();

    if (opts.objectStore) {
      // Production object storage (S3, Railway volume, etc.)
      await opts.objectStore.writeBinary(portableRef, binary, SCREENSHOT_MIME);
    } else {
      // Local filesystem
      const { resolvedPath } = resolvePortableRef(portableRef, artifactRoot);
      if (!resolvedPath) {
        return { portableRef: null, persisted: false, sizeBytes: binary.length, checksum, error: "Failed to resolve portable reference for local write" };
      }
      await mkdir(resolve(resolvedPath, ".."), { recursive: true });
      await writeFile(resolvedPath, binary);
    }

    // ── Write companion metadata JSON ──────────────────────────────────
    const metaRef = portableRef.replace(/\.jpg$/i, ".meta.json");
    const metaRecord = {
      artifactType: "screenshot",
      artifactVersion: "1.0.0",
      portableArtifactRef: portableRef,
      runId: metadata.runId,
      slug: metadata.slug,
      diagnosticCode: metadata.diagnosticCode || null,
      provider: metadata.provider || "unknown",
      requestedUrl: metadata.url || null,
      finalUrl: metadata.finalUrl || metadata.url || null,
      device: metadata.strategy || null,
      mimeType: SCREENSHOT_MIME,
      format: "jpeg",
      sizeBytes: binary.length,
      checksum,
      collectedAt: metadata.collectedAt || now,
      persistedAt: now,
      imageFile: filename,
    };

    if (opts.objectStore) {
      await opts.objectStore.writeJson(metaRef, metaRecord);
    } else {
      const { resolvedPath: metaPath } = resolvePortableRef(metaRef, artifactRoot);
      if (metaPath) {
        await mkdir(resolve(metaPath, ".."), { recursive: true });
        await writeFile(metaPath, JSON.stringify(metaRecord, null, 2), "utf-8");
      }
    }

    return {
      portableRef,
      persisted: true,
      sizeBytes: binary.length,
      checksum,
    };
  } catch (error) {
    return {
      portableRef: null,
      persisted: false,
      sizeBytes: 0,
      checksum: null,
      error: `Screenshot persistence failed: ${error.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Validate a segment used in portable reference construction.
 * Rejects empty strings, path separators, and traversal sequences.
 */
function _safeSegment(value, label) {
  if (!value || typeof value !== "string") {
    throw new Error(`Invalid ${label}: must be a non-empty string`);
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new Error(`Invalid ${label}: must not contain path separators`);
  }
  if (value === "." || value === "..") {
    throw new Error(`Invalid ${label}: must not be a traversal name`);
  }
  return value;
}

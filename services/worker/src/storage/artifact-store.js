/**
 * Artifact Store — Storage Boundary
 *
 * Abstraction over artifact read/write so the backlink adapter and runner
 * are not coupled to a specific storage backend.
 *
 * Current implementation: local filesystem under a configurable base directory.
 * Future: S3 (AWS), Railway volume, or n8n-compatible storage can be added
 * by implementing the same contract without changing adapter/runner code.
 *
 * All paths are validated to prevent directory traversal.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join, basename, normalize } from "node:path";
import { createS3ArtifactStore } from "./s3-artifact-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default base directory for local artifact storage. */
const DEFAULT_BASE_DIR = resolve("artifacts", "local", "backlink-tests");

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Build the absolute filesystem path for an artifact.
 *
 * Validates that the resolved path stays within the base directory to
 * block path traversal attacks (e.g. "../../secret.json").
 *
 * @param {string} dir  - Base directory for artifact storage.
 * @param {string} name - Artifact filename (no directory separators allowed).
 * @returns {string} Absolute path to the artifact file.
 * @throws {Error} If the name contains path traversal or the resolved path
 *                 escapes the base directory.
 */
export function buildArtifactPath(dir, name) {
  const baseDir = resolve(dir);

  // Reject names that contain path separators or traversal sequences.
  const sanitized = basename(name);
  if (sanitized !== name.replace(/^\.+$/, "")) {
    // basename of ".." is ".." — block that edge case
    if (name.includes("/") || name.includes("\\") || name === ".." || name === ".") {
      throw new Error(
        `Artifact name contains invalid characters or traversal: "${name}"`,
      );
    }
  }

  if (name.includes("/") || name.includes("\\")) {
    throw new Error(
      `Artifact name must not contain path separators: "${name}"`,
    );
  }

  const fullPath = resolve(join(baseDir, sanitized));

  // Verify the resolved path is inside the base directory.
  // Since we already extracted basename (no traversal segments), the
  // resolved path must start with the resolved base directory.
  if (!fullPath.startsWith(baseDir)) {
    throw new Error(
      `Artifact path escapes base directory: "${name}" → "${fullPath}"`,
    );
  }

  return fullPath;
}

/**
 * Build an absolute path, resolving a relative `dir` against the repo root.
 *
 * This is the canonical entry point for path construction — it normalizes
 * the directory and delegates to `buildArtifactPath` for traversal checks.
 *
 * @param {string} dir  - Base directory (absolute or relative to cwd).
 * @param {string} name - Artifact filename.
 * @returns {string} Absolute path to the artifact file.
 */
function resolveArtifactPath(dir, name) {
  return buildArtifactPath(dir, name);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write a JSON artifact to disk.
 *
 * Creates the target directory if it does not exist. Writes with stable
 * formatting (2-space indentation, trailing newline).
 *
 * @param {string} dir  - Base directory for artifact storage.
 * @param {string} name - Artifact filename (e.g. "raw-backlinks.json").
 * @param {object} data - Serializable data to write.
 * @returns {string} The absolute path written to.
 * @throws {Error} On path traversal or filesystem errors.
 */
export function writeJsonArtifact(dir, name, data) {
  const dirPath = resolve(dir);
  mkdirSync(dirPath, { recursive: true });

  const filePath = resolveArtifactPath(dir, name);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

/**
 * Read and parse a JSON artifact from disk.
 *
 * @param {string} dir  - Base directory for artifact storage.
 * @param {string} name - Artifact filename.
 * @returns {object|null} Parsed JSON, or null if the file does not exist.
 * @throws {Error} On path traversal or JSON parse errors.
 */
export function readJsonArtifact(dir, name) {
  const filePath = resolveArtifactPath(dir, name);

  if (!existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Check whether an artifact file exists.
 *
 * @param {string} dir  - Base directory for artifact storage.
 * @param {string} name - Artifact filename.
 * @returns {boolean} True if the artifact file exists.
 */
export function artifactExists(dir, name) {
  const filePath = resolveArtifactPath(dir, name);
  return existsSync(filePath);
}

/**
 * List artifact filenames in a directory.
 *
 * Returns only `.json` files, sorted alphabetically. Hidden files and
 * non-JSON files are excluded.
 *
 * @param {string} dir - Base directory for artifact storage.
 * @returns {string[]} Array of artifact filenames (not full paths).
 */
export function listArtifacts(dir) {
  const dirPath = resolve(dir);

  if (!existsSync(dirPath)) {
    return [];
  }

  return readdirSync(dirPath)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

// ---------------------------------------------------------------------------
// Factory (future-proofing for S3 / Railway / n8n backends)
// ---------------------------------------------------------------------------

/**
 * Create a local artifact store instance.
 *
 * Returns an object with the same function signatures as the module exports,
 * bound to a specific base directory. This makes it easy to swap in an S3
 * or Railway-backed store later by implementing the same shape.
 *
 * @param {object} [opts]
 * @param {string} [opts.baseDir] - Base directory. Defaults to artifacts/local/backlink-tests/.
 * @returns {object} Store instance with { writeJsonArtifact, readJsonArtifact, artifactExists, listArtifacts, buildArtifactPath }.
 */
export function createLocalArtifactStore(opts = {}) {
  const baseDir = opts.baseDir || DEFAULT_BASE_DIR;

  return {
    writeJsonArtifact: (name, data) =>
      writeJsonArtifact(baseDir, name, data),
    readJsonArtifact: (name) =>
      readJsonArtifact(baseDir, name),
    artifactExists: (name) =>
      artifactExists(baseDir, name),
    listArtifacts: () =>
      listArtifacts(baseDir),
    buildArtifactPath: (name) =>
      buildArtifactPath(baseDir, name),
  };
}

// ---------------------------------------------------------------------------
// Multi-backend factory
// ---------------------------------------------------------------------------

/**
 * Create an artifact store instance for the configured backend.
 *
 *   createArtifactStore({ type: "local" })              → local store
 *   createArtifactStore({ type: "s3", s3Client, bucket }) → S3 store
 *
 * Defaults to "local" when no type is given so the existing runner
 * behaviour is preserved without configuration.
 *
 * @param {object} opts
 * @param {"local"|"s3"} [opts.type="local"] - Store backend.
 * @param {string} [opts.baseDir]             - Local store base directory.
 * @param {object} [opts.s3Client]            - S3 client instance.
 * @param {string} [opts.bucket]              - S3 bucket name.
 * @param {string} [opts.prefix]              - S3 key prefix.
 * @returns {object} Store instance.
 */
export function createArtifactStore(opts = {}) {
  const type = opts.type || "local";

  if (type === "s3") {
    return createS3ArtifactStore({
      s3Client: opts.s3Client,
      bucket: opts.bucket,
      prefix: opts.prefix,
    });
  }

  // Default: local store
  return createLocalArtifactStore({ baseDir: opts.baseDir });
}

export default {
  buildArtifactPath,
  writeJsonArtifact,
  readJsonArtifact,
  artifactExists,
  listArtifacts,
  createLocalArtifactStore,
  createArtifactStore,
};

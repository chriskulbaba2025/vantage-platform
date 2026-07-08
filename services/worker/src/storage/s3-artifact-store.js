/**
 * S3 Artifact Store — AWS S3-compatible storage backend
 *
 * Implements the same contract as the local artifact store so the backlink
 * adapter and runner can swap storage backends without code changes.
 *
 * Contract (per function):
 *   writeJsonArtifact(name, data) → key
 *   readJsonArtifact(name)        → object | null
 *   artifactExists(name)          → boolean
 *   listArtifacts()               → string[]
 *   buildArtifactPath(name)       → key (safe S3 object key, never a local path)
 *
 * Design:
 *   - Accepts an S3 client via dependency injection (compatible with
 *     @aws-sdk/client-s3 but no hard import — works with any object
 *     that exposes send() with GetObject / PutObject / HeadObject /
 *     ListObjectsV2 commands).
 *   - No AWS credentials are required for tests — pass a mock client.
 *   - All keys are validated for path traversal before use.
 *   - Secrets are never logged.
 */

import { basename } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default S3 bucket prefix for backlink artifacts. */
const DEFAULT_PREFIX = "vantage/backlinks/";

// ---------------------------------------------------------------------------
// Key validation (S3-specific — no filesystem paths, no traversal)
// ---------------------------------------------------------------------------

/**
 * Build a safe S3 object key for an artifact.
 *
 * Rejects names that contain path traversal sequences or absolute-path
 * indicators. The resulting key is always under the configured prefix.
 *
 * @param {string} prefix - S3 key prefix (e.g. "vantage/backlinks/").
 * @param {string} name   - Artifact filename (no traversal allowed).
 * @returns {string} Safe S3 object key.
 * @throws {Error} If the name contains traversal sequences or separators.
 */
export function buildS3Key(prefix, name) {
  const safePrefix = prefix || DEFAULT_PREFIX;

  // Reject traversal and path separators in the artifact name.
  const sanitized = basename(name);
  if (sanitized !== name.replace(/^\.+$/, "")) {
    if (name.includes("/") || name.includes("\\") || name === ".." || name === ".") {
      throw new Error(
        `S3 artifact name contains invalid characters or traversal: "${name}"`,
      );
    }
  }

  if (name.includes("/") || name.includes("\\")) {
    throw new Error(
      `S3 artifact name must not contain path separators: "${name}"`,
    );
  }

  // Ensure the prefix ends with "/" for clean key construction.
  const normalizedPrefix = safePrefix.endsWith("/")
    ? safePrefix
    : safePrefix + "/";

  return normalizedPrefix + sanitized;
}

// ---------------------------------------------------------------------------
// Mock-safe command builders
//
// These functions build plain objects matching the @aws-sdk/client-s3
// command shapes. They do NOT import from @aws-sdk/client-s3 so the
// module loads without the SDK installed — a real S3 client can be
// injected at runtime.
// ---------------------------------------------------------------------------

function makePutObjectCommand(bucket, key, body, contentType) {
  return {
    _command: "PutObject",
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType || "application/json",
  };
}

function makeGetObjectCommand(bucket, key) {
  return { _command: "GetObject", Bucket: bucket, Key: key };
}

function makeHeadObjectCommand(bucket, key) {
  return { _command: "HeadObject", Bucket: bucket, Key: key };
}

function makeListObjectsV2Command(bucket, prefix) {
  return { _command: "ListObjectsV2", Bucket: bucket, Prefix: prefix };
}

// ---------------------------------------------------------------------------
// Body helpers
// ---------------------------------------------------------------------------

/**
 * Safely read the body from an S3 GetObject response.
 *
 * The AWS SDK v3 returns a response where Body is a readable stream or
 * a transform. Our mock can return a plain string directly.
 *
 * @param {object} response - S3 GetObject response.
 * @returns {Promise<string>} Response body as a UTF-8 string.
 */
async function readResponseBody(response) {
  if (!response || !response.Body) return "";

  const body = response.Body;

  // If Body is a string (mock), return it directly.
  if (typeof body === "string") return body;

  // If Body has a transformToString method (AWS SDK v3), use it.
  if (typeof body.transformToString === "function") {
    return body.transformToString("utf-8");
  }

  // If Body is a readable stream, collect chunks.
  if (typeof body.on === "function") {
    const chunks = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf-8"));
    }
    return chunks.join("");
  }

  return String(body);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an S3-backed artifact store.
 *
 * @param {object} opts
 * @param {object} opts.s3Client         - S3 client instance (must expose
 *                                         a `send(command)` method). Pass a
 *                                         plain object with mocked `send` for
 *                                         tests — no SDK import required.
 * @param {string} opts.bucket           - S3 bucket name.
 * @param {string} [opts.prefix]         - S3 key prefix. Default: "vantage/backlinks/".
 * @param {boolean} [opts._dangerousSuppressKeyValidation] - FOR TESTS ONLY.
 * @returns {object} Store instance matching the local store contract.
 */
export function createS3ArtifactStore(opts = {}) {
  const s3Client = opts.s3Client;
  const bucket = opts.bucket || "";
  const prefix = opts.prefix || DEFAULT_PREFIX;

  if (!s3Client) {
    throw new Error(
      "S3 artifact store requires an s3Client (pass a mock for tests).",
    );
  }

  if (!bucket) {
    throw new Error(
      "S3 artifact store requires a bucket name.",
    );
  }

  /**
   * Build a safe S3 object key for the given artifact name.
   *
   * @param {string} name - Artifact filename.
   * @returns {string} S3 object key.
   */
  function buildArtifactPath(name) {
    return buildS3Key(prefix, name);
  }

  /**
   * Write a JSON artifact to S3.
   *
   * @param {string} name - Artifact filename.
   * @param {object} data - Serializable data.
   * @returns {Promise<string>} The S3 object key written.
   */
  async function writeJsonArtifact(name, data) {
    const key = buildS3Key(prefix, name);
    const body = JSON.stringify(data, null, 2);

    // Never log the body or credentials.
    const cmd = makePutObjectCommand(bucket, key, body, "application/json");
    await s3Client.send(cmd);

    return key;
  }

  /**
   * Read and parse a JSON artifact from S3.
   *
   * @param {string} name - Artifact filename.
   * @returns {Promise<object|null>} Parsed JSON, or null if not found.
   */
  async function readJsonArtifact(name) {
    const key = buildS3Key(prefix, name);

    try {
      const cmd = makeGetObjectCommand(bucket, key);
      const response = await s3Client.send(cmd);
      const raw = await readResponseBody(response);
      return JSON.parse(raw);
    } catch (err) {
      // NoSuchKey → return null
      if (
        err &&
        (err.name === "NoSuchKey" ||
          err.Code === "NoSuchKey" ||
          (err.message && err.message.includes("NoSuchKey")))
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Check whether an artifact exists in S3.
   *
   * @param {string} name - Artifact filename.
   * @returns {Promise<boolean>}
   */
  async function artifactExists(name) {
    const key = buildS3Key(prefix, name);

    try {
      const cmd = makeHeadObjectCommand(bucket, key);
      await s3Client.send(cmd);
      return true;
    } catch (err) {
      if (
        err &&
        (err.name === "NotFound" ||
          err.Code === "NotFound" ||
          err.$metadata?.httpStatusCode === 404 ||
          (err.message && err.message.includes("NotFound")))
      ) {
        return false;
      }
      throw err;
    }
  }

  /**
   * List artifact keys under the configured prefix.
   *
   * Returns only the filename portion (after the prefix), sorted.
   *
   * @returns {Promise<string[]>} Array of artifact filenames.
   */
  async function listArtifacts() {
    try {
      const cmd = makeListObjectsV2Command(bucket, prefix);
      const response = await s3Client.send(cmd);

      const contents = response.Contents || [];
      const prefixLen = (prefix.endsWith("/") ? prefix : prefix + "/").length;

      return contents
        .map((obj) => {
          const relative = obj.Key
            ? obj.Key.slice(obj.Key.startsWith(prefix) ? prefixLen : 0)
            : "";
          return relative;
        })
        .filter((name) => name.length > 0 && name.endsWith(".json"))
        .sort();
    } catch (err) {
      // If the bucket/prefix doesn't exist yet, return empty.
      return [];
    }
  }

  return {
    writeJsonArtifact,
    readJsonArtifact,
    artifactExists,
    listArtifacts,
    buildArtifactPath,
  };
}

export default {
  buildS3Key,
  createS3ArtifactStore,
};

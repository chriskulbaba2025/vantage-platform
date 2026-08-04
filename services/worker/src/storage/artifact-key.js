/**
 * Artifact Store — Immutable Tenant-Scoped Object Key Builder
 *
 * Every object key follows the governed structure:
 *
 *   tenants/{tenantId}/clients/{clientId}/audits/{auditId}/{category}/{artifactName}
 *
 * Rules:
 *   - tenant, client and audit scope are mandatory;
 *   - path traversal ("..", "./", etc.) is rejected;
 *   - absolute paths are rejected;
 *   - empty segments are rejected;
 *   - backslashes are rejected in object keys;
 *   - object names are deterministic from supplied scope and artifact identity;
 *   - no machine-specific path may enter an Artifact Record.
 *
 * @module artifact-key
 */

import { PathTraversalError, InvalidScopeError } from "./artifact-errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Characters forbidden anywhere in an object key segment. */
const FORBIDDEN_CHARS = /[\\\x00-\x1f<>:"|?*]/;

/** Traversal sequences that must never appear in a key. */
const TRAVERSAL_PATTERNS = ["..", "./", "/.", "~"];

// ---------------------------------------------------------------------------
// Segment validation
// ---------------------------------------------------------------------------

/**
 * Validate a single key segment.
 *
 * @param {string} value    - The segment value.
 * @param {string} label    - Human label for error messages (e.g. "tenantId").
 * @throws {InvalidScopeError} If the segment is empty or invalid.
 * @throws {PathTraversalError} If the segment contains traversal.
 */
function validateSegment(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidScopeError(`${label} is required and must be a non-empty string`, {
      segment: label,
      value: value === "" ? "(empty)" : String(value),
    });
  }

  if (FORBIDDEN_CHARS.test(value)) {
    throw new PathTraversalError(
      `${label} contains forbidden characters: "${value}"`,
      { segment: label, value },
    );
  }

  for (const pattern of TRAVERSAL_PATTERNS) {
    if (value.includes(pattern)) {
      throw new PathTraversalError(
        `${label} contains traversal pattern "${pattern}": "${value}"`,
        { segment: label, value, pattern },
      );
    }
  }

  // Reject segments that are only dots
  if (value === "." || value === "..") {
    throw new PathTraversalError(
      `${label} must not be "${value}"`,
      { segment: label, value },
    );
  }
}

// ---------------------------------------------------------------------------
// Category validation
// ---------------------------------------------------------------------------

/** Valid artifact categories per the governed key structure. */
const VALID_CATEGORIES = new Set([
  "raw",
  "normalized",
  "canonical",
  "report",
  "manifests",
]);

/**
 * Validate the category segment.
 *
 * @param {string} category
 * @throws {InvalidScopeError}
 */
function validateCategory(category) {
  if (typeof category !== "string" || category.length === 0) {
    throw new InvalidScopeError("category is required and must be a non-empty string", {
      segment: "category",
      value: category === "" ? "(empty)" : String(category),
    });
  }

  if (FORBIDDEN_CHARS.test(category)) {
    throw new PathTraversalError(
      `category contains forbidden characters: "${category}"`,
      { segment: "category", value: category },
    );
  }

  for (const pattern of TRAVERSAL_PATTERNS) {
    if (category.includes(pattern)) {
      throw new PathTraversalError(
        `category contains traversal pattern "${pattern}": "${category}"`,
        { segment: "category", value: category, pattern },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Key builder
// ---------------------------------------------------------------------------

/**
 * Build a governed immutable object key from tenant/client/audit scope.
 *
 * @param {object} scope
 * @param {string} scope.tenantId     - Owning tenant identifier.
 * @param {string} scope.clientId     - Owning client identifier.
 * @param {string} scope.auditId      - Audit UUID.
 * @param {string} scope.category     - Artifact category (raw, normalized, canonical, report, manifests).
 * @param {string} scope.artifactName - Artifact filename (e.g. "dataforseo-onpage.json").
 * @returns {string} The fully qualified object key.
 * @throws {InvalidScopeError} On missing or invalid scope fields.
 * @throws {PathTraversalError} On traversal or forbidden characters.
 */
export function buildArtifactKey(scope) {
  if (!scope || typeof scope !== "object") {
    throw new InvalidScopeError("scope is required and must be an object");
  }

  const { tenantId, clientId, auditId, category, artifactName } = scope;

  validateSegment(tenantId, "tenantId");
  validateSegment(clientId, "clientId");
  validateSegment(auditId, "auditId");
  validateCategory(category);

  if (typeof artifactName !== "string" || artifactName.length === 0) {
    throw new InvalidScopeError("artifactName is required and must be a non-empty string", {
      segment: "artifactName",
      value: artifactName === "" ? "(empty)" : String(artifactName),
    });
  }

  // Validate artifact name with the same rules
  validateSegment(artifactName, "artifactName");

  return `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/${category}/${artifactName}`;
}

/**
 * Parse a governed object key back into its scope components.
 *
 * @param {string} key - The object key to parse.
 * @returns {{ tenantId: string, clientId: string, auditId: string, category: string, artifactName: string }}
 * @throws {InvalidScopeError} If the key does not match the expected format.
 */
export function parseArtifactKey(key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidScopeError("key is required and must be a non-empty string");
  }

  // Reject traversal before parsing
  if (key.includes("..") || key.includes("\\") || key.startsWith("/")) {
    throw new PathTraversalError(`key contains traversal or is absolute: "${key}"`, { key });
  }

  // Expected format: tenants/{tenantId}/clients/{clientId}/audits/{auditId}/{category}/{artifactName}
  const parts = key.split("/");
  if (parts.length < 7) {
    throw new InvalidScopeError(
      `key does not match expected format tenants/.../clients/.../audits/.../.../...: "${key}"`,
      { key, partsLength: parts.length },
    );
  }

  if (parts[0] !== "tenants" || parts[2] !== "clients" || parts[4] !== "audits") {
    throw new InvalidScopeError(
      `key does not follow tenant/client/audit hierarchy: "${key}"`,
      { key },
    );
  }

  const tenantId = parts[1];
  const clientId = parts[3];
  const auditId = parts[5];
  const category = parts[6];
  const artifactName = parts.slice(7).join("/");

  // Validate each extracted segment
  validateSegment(tenantId, "tenantId");
  validateSegment(clientId, "clientId");
  validateSegment(auditId, "auditId");
  validateCategory(category);
  validateSegment(artifactName, "artifactName");

  return { tenantId, clientId, auditId, category, artifactName };
}

/**
 * Check that a key belongs to the given tenant.
 *
 * @param {string} key      - Full object key.
 * @param {string} tenantId - Tenant to check against.
 * @returns {boolean}
 */
export function keyBelongsToTenant(key, tenantId) {
  try {
    const parsed = parseArtifactKey(key);
    return parsed.tenantId === tenantId;
  } catch {
    return false;
  }
}

export default {
  buildArtifactKey,
  parseArtifactKey,
  keyBelongsToTenant,
};

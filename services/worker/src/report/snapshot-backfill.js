import { buildArtifactKey } from "../storage/governed-artifact-store.js";
import { createHash } from "node:crypto";
import { buildReportContentPackage } from "../report-content/build-package.js";
import { buildSnapshotV1Projection, renderSnapshotV1, SNAPSHOT_V1_RENDERER_VERSION } from "./snapshot-v1.js";
import { resolveSnapshotV1CtaUrl } from "./snapshot-config.js";
import { resolveBusinessDisplayName } from "../identity/business-display-name.js";

const REQUIRED_ARTIFACTS = Object.freeze([
  "audit-request.json",
  "decision-evidence.json",
  "findings.json",
  "scores.json",
]);

function key(scope, category, artifactName) {
  return buildArtifactKey({ ...scope, category, artifactName });
}

const SNAPSHOT_CANDIDATES = Object.freeze([]);

export function snapshotV1ArtifactName(bytes) {
  return `pages/snapshot-v1.${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.html`;
}

export function isCurrentSnapshotV1(bytes) {
  if (!bytes || bytes.length === 0) return false;
  const html = Buffer.from(bytes).toString("utf8");
  return html.includes(`name="prysm-snapshot-renderer" content="${SNAPSHOT_V1_RENDERER_VERSION}"`);
}

async function readOptional(store, artifactKey) {
  try {
    if (typeof store.exists === "function" && !(await store.exists(artifactKey))) return null;
    const bytes = await store.get(artifactKey);
    return bytes && bytes.length > 0 ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

async function readJson(store, artifactKey) {
  if (typeof store.exists === "function" && !(await store.exists(artifactKey))) return null;
  const bytes = await store.get(artifactKey);
  if (!bytes || bytes.length === 0) return null;
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

/**
 * Deterministically select or materialize the active Snapshot V1 artifact from
 * persisted, governed audit inputs. Legacy, stale, missing, and unreadable
 * HTML are never authoritative merely because bytes exist. The immutable
 * `snapshot-v1.html` key is the repaired projection; legacy keys remain intact.
 */
export async function ensurePersistedSnapshotV1({ store, scope }) {
  if (!store || !scope?.tenantId || !scope?.clientId || !scope?.auditId) return null;

  const values = {};
  for (const artifactName of REQUIRED_ARTIFACTS) {
    values[artifactName] = await readJson(store, key(scope, "canonical", artifactName));
    if (!values[artifactName]) return null;
  }

  const auditRequest = values["audit-request.json"];
  if (
    auditRequest.auditId !== scope.auditId ||
    auditRequest.tenantId !== scope.tenantId ||
    auditRequest.clientId !== scope.clientId
  ) {
    throw new Error("Snapshot backfill identity mismatch");
  }

  const persistedReportContent = await readJson(
    store,
    key(scope, "report", "report-content.json"),
  ).catch(() => null);
  const expectedBusinessName = resolveBusinessDisplayName(auditRequest, values["decision-evidence.json"].site || {});
  const reportContentPackage = persistedReportContent?.auditId === scope.auditId &&
    persistedReportContent?.canonicalDecisionModel?.orderedFindingIds &&
    persistedReportContent?.business?.name === expectedBusinessName
    ? persistedReportContent
    : buildReportContentPackage({
        auditRequest,
        canonicalEvidence: values["decision-evidence.json"],
        findings: values["findings.json"],
        scoreSet: values["scores.json"],
      });
  const reviewDate =
    auditRequest.startedAt ||
    auditRequest.createdAt ||
    values["decision-evidence.json"].collectedAt ||
    null;
  const html = renderSnapshotV1(buildSnapshotV1Projection({
    auditRequest,
    canonicalEvidence: values["decision-evidence.json"],
    reportContentPackage,
    reviewDate,
    ctaConfig: {
      ctaUrl: resolveSnapshotV1CtaUrl(auditRequest),
    },
  }));
  const bytes = Buffer.from(html, "utf8");

  const versionedArtifactName = snapshotV1ArtifactName(bytes);
  await store.put({
    bytes,
    contentType: "text/html",
    scope: {
      ...scope,
      category: "report-v2",
      artifactName: versionedArtifactName,
    },
    source: "canonical/audit-request.json+canonical/decision-evidence.json+canonical/findings.json+canonical/scores.json",
  });

  const snapshotKey = key(scope, "report-v2", versionedArtifactName);
  const stored = await store.get(snapshotKey);
  if (!stored || stored.length !== bytes.length || !stored.equals(bytes)) {
    throw new Error("Snapshot backfill read-back byte mismatch");
  }
  return stored;
}

export { REQUIRED_ARTIFACTS, SNAPSHOT_CANDIDATES };

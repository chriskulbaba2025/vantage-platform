import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadRecoveredReportInputs } from "../orchestration/recovered-report-input-loader.js";
import { createLifecycleService } from "../lifecycle/lifecycle-service.js";
import { InvalidInputError } from "../storage/artifact-errors.js";

export const AUTHORITATIVE_AUDIT_ID = "6dca53ed-ae00-484c-bf77-b59c059eef51";
export const LOCAL_REGISTRATION_TENANT = "local-sandbox";

const REGISTRATION_STATES = Object.freeze([
  "validated",
  "collecting",
  "evidence_stored",
  "evidence_locked",
  "scored",
  "narrative_pending",
  "narrative_ready",
  "draft_rendered",
]);

const ALLOWED_CATEGORIES = new Set([
  "canonical", "normalized", "raw", "manifests", "report", "report-v2",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function targetKeyParts(key, { tenantId, clientId, auditId }) {
  const prefix = `tenants/${tenantId}/clients/${clientId}/audits/${auditId}/`;
  if (typeof key !== "string" || !key.startsWith(prefix)) return null;
  const relative = key.slice(prefix.length);
  const slash = relative.indexOf("/");
  if (slash <= 0) return null;
  const category = relative.slice(0, slash);
  const artifactName = relative.slice(slash + 1);
  if (!ALLOWED_CATEGORIES.has(category) || !artifactName || artifactName.includes("..") || artifactName.includes("\\") || artifactName.startsWith("/")) return null;
  return { category, artifactName };
}

export async function readFrozenArtifact(rootDir, parts) {
  const root = resolve(rootDir);
  const full = resolve(root, parts.category, parts.artifactName);
  const fromRoot = relative(root, full);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Authoritative artifact path escaped frozen dataset root");
  }
  return readFile(full);
}

/**
 * Wrap the normal local artifact store with an authoritative, read-through
 * target. The target audit is read only; no target bytes are written to the
 * local artifact store and no mutable fallback is accepted.
 */
export function createAuthoritativeArtifactBridge({ baseStore, datasetRoot, tenantId, clientId, auditId }) {
  if (!baseStore || !datasetRoot || !tenantId || !clientId || !auditId) {
    throw new InvalidInputError("authoritative artifact bridge requires complete scope");
  }
  const scope = { tenantId, clientId, auditId };

  async function get(key) {
    const parts = targetKeyParts(key, scope);
    if (parts) return readFrozenArtifact(datasetRoot, parts);
    return baseStore.get(key);
  }

  async function exists(key) {
    const parts = targetKeyParts(key, scope);
    if (!parts) return baseStore.exists(key);
    try {
      await readFrozenArtifact(datasetRoot, parts);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async function put(input) {
    const inputScope = input?.scope || {};
    if (inputScope.auditId === auditId && inputScope.tenantId === tenantId && inputScope.clientId === clientId) {
      throw new Error("Frozen authoritative audit is read-only; target artifact writes are prohibited");
    }
    return baseStore.put(input);
  }

  return Object.freeze({
    put,
    get,
    exists,
    verify: baseStore.verify.bind(baseStore),
    storageBackend: "local-authoritative-read-through",
  });
}

/**
 * Register only lifecycle identity/state for the frozen report. The recovered
 * dataset remains the source of truth and is never copied into local storage.
 */
export async function registerAuthoritativeAudit({ lifecycleRepo, datasetRoot, tenantId = LOCAL_REGISTRATION_TENANT, auditId = AUTHORITATIVE_AUDIT_ID }) {
  const recovered = await loadRecoveredReportInputs({ rootDir: datasetRoot, auditId });
  const request = recovered.auditRequest;
  const manifest = recovered.projection.reportManifest;
  if (request.auditId !== auditId || manifest.reportVersion !== "4.1.2" || manifest.reportDesignVersion !== "2.0.0") {
    throw new Error("Frozen authoritative audit identity/report manifest mismatch");
  }
  if (request.tenantId !== "omnipressence" || !request.clientId || manifest.lifecycleStatus !== "DRAFT_RENDERED") {
    throw new Error("Frozen authoritative audit registration contract mismatch");
  }

  const lifecycle = createLifecycleService(lifecycleRepo);
  const existingTenant = typeof lifecycleRepo.findAuditTenant === "function"
    ? await lifecycleRepo.findAuditTenant(auditId)
    : null;
  if (existingTenant && existingTenant !== tenantId) {
    throw new Error(`Authoritative audit already belongs to unexpected tenant: ${existingTenant}`);
  }

  let state = await lifecycle.currentState(auditId, tenantId);
  let registered = false;
  if (!state) {
    await lifecycle.create({
      auditId,
      tenantId,
      clientId: request.clientId,
      idempotencyKey: `local-authoritative:${auditId}`,
    });
    if (typeof lifecycleRepo.updateAuditMetadata === "function") {
      await lifecycleRepo.updateAuditMetadata(auditId, tenantId, {
        businessName: request.businessName,
        targetUrl: request.targetUrl,
      });
    }
    for (const nextState of REGISTRATION_STATES) {
      state = await lifecycle.transition({
        auditId,
        tenantId,
        toState: nextState,
        transitionIdempotencyKey: `local-authoritative:${auditId}:${nextState}`,
        actor: "local-authoritative-registration",
        reason: "Read-only registration of frozen authoritative audit; report bytes remain in source dataset",
      });
    }
    registered = true;
  }

  if (!state || state.clientId !== request.clientId || state.state !== "draft_rendered") {
    throw new Error(`Authoritative lifecycle registration did not resolve to draft_rendered: ${JSON.stringify(state)}`);
  }
  return Object.freeze({
    auditId,
    sourceTenantId: request.tenantId,
    registeredTenantId: tenantId,
    clientId: request.clientId,
    businessName: request.businessName,
    targetUrl: request.targetUrl,
    registered,
    state: state.state,
    sourceArtifactCount: recovered.projection.artifactCount,
  });
}

export default { createAuthoritativeArtifactBridge, registerAuthoritativeAudit };

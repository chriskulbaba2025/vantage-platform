/**
 * PRYSM-NEXT-ACTIVATION — production activation boundary regressions.
 *
 * Prove at the ACTUAL production-facing boundaries:
 *   A. report.designVersion survives createAudit (web payload → worker).
 *   C. v2 approval validates the v2 artifact contract, not the locked v1
 *      16-page set; v1 approval behaviour unchanged.
 *
 * Zero live calls; controlled fixtures only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditApplicationService } from "./audit-service.js";
import { createProductionRuntime } from "./production-runtime.js";
import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { createLifecycleService } from "../lifecycle/lifecycle-service.js";
import { LIFECYCLE_STATE as T } from "../lifecycle/state-enum.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createGovernedArtifactStore } from "../storage/governed-artifact-store.js";
import { createLocalReportStore } from "../storage/report-store.js";

const noopValidator = () => ({ valid: true, errors: [] });

// ---------------------------------------------------------------------------
// Defect A — report.designVersion survives the production creation boundary
// ---------------------------------------------------------------------------

test("ACTIVATION-A-01: explicit v2 selection survives createAudit into the audit request", async () => {
  const captured = [];
  const orchestrator = {
    execute: async (auditRequest) => {
      captured.push(auditRequest);
      return { auditId: auditRequest.auditId, finalState: "validated" };
    },
  };
  const lcRepo = createMemoryLifecycleRepository();
  const lifecycleService = createLifecycleService(lcRepo);
  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const service = createAuditApplicationService({
    orchestrator,
    lifecycleRepo: lcRepo,
    lifecycleService,
    artifactStore,
    reportStore: createLocalReportStore({ baseDir: mkdtempSync(join(tmpdir(), "activation-a-")) }),
    config: { artifactDir: "." },
    validateContract: noopValidator,
  });

  await service.createAudit(
    {
      targetUrl: "https://example.com",
      businessName: "Example",
      services: ["Consulting"],
      report: { designVersion: "2.0.0" },
    },
    "tenant-a",
  );
  assert.equal(captured.length, 1, "orchestrator invoked once");
  assert.equal(captured[0].report.designVersion, "2.0.0", "designVersion 2.0.0 propagated");
});

test("ACTIVATION-A-02: absent selection leaves the request without a report override (v1 default)", async () => {
  const captured = [];
  const orchestrator = {
    execute: async (auditRequest) => {
      captured.push(auditRequest);
      return { auditId: auditRequest.auditId, finalState: "validated" };
    },
  };
  const lcRepo = createMemoryLifecycleRepository();
  const service = createAuditApplicationService({
    orchestrator,
    lifecycleRepo: lcRepo,
    lifecycleService: createLifecycleService(lcRepo),
    artifactStore: createGovernedArtifactStore({ store: createMemoryArtifactStore() }),
    reportStore: createLocalReportStore({ baseDir: mkdtempSync(join(tmpdir(), "activation-a2-")) }),
    config: { artifactDir: "." },
    validateContract: noopValidator,
  });
  await service.createAudit({ targetUrl: "https://example.com", businessName: "Example" }, "tenant-a");
  assert.equal(captured[0].report, undefined, "no report override ⇒ orchestrator default (v1)");
});

test("ACTIVATION-A-03: invalid design version is clamped to the v1 default", async () => {
  const captured = [];
  const orchestrator = {
    execute: async (auditRequest) => {
      captured.push(auditRequest);
      return { auditId: auditRequest.auditId, finalState: "validated" };
    },
  };
  const lcRepo = createMemoryLifecycleRepository();
  const service = createAuditApplicationService({
    orchestrator,
    lifecycleRepo: lcRepo,
    lifecycleService: createLifecycleService(lcRepo),
    artifactStore: createGovernedArtifactStore({ store: createMemoryArtifactStore() }),
    reportStore: createLocalReportStore({ baseDir: mkdtempSync(join(tmpdir(), "activation-a3-")) }),
    config: { artifactDir: "." },
    validateContract: noopValidator,
  });
  await service.createAudit(
    { targetUrl: "https://example.com", businessName: "Example", report: { designVersion: "9.9.9" } },
    "tenant-a",
  );
  assert.equal(captured[0].report.designVersion, "1.0.0", "unknown versions clamp to v1");
});

// ---------------------------------------------------------------------------
// Defect C — v2 approval validates the v2 artifact contract, not the v1 set
// ---------------------------------------------------------------------------

async function makeRuntimeInReview({ auditId, tenantId, clientId }) {
  const lcRepo = createMemoryLifecycleRepository();
  const lifecycleService = createLifecycleService(lcRepo);
  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const reportStore = createLocalReportStore({ baseDir: mkdtempSync(join(tmpdir(), "activation-c-")) });
  const runtime = createProductionRuntime({
    config: { artifactDir: "." },
    adapters: null,
    validateContract: noopValidator,
    artifactStore,
    lifecycleRepo: lcRepo,
    reportStore,
  });

  // The production approval path reads the report-store lifecycle, which is
  // created by report generation. Seed that durable boundary explicitly.
  await reportStore.writeReport({
    slug: "slug", runId: auditId,
    model: { evidence: {} }, manifest: {}, html: "<html>draft</html>",
  });

  await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey: "k" });
  for (const [state, key] of [
    [T.VALIDATED, "v"], [T.COLLECTING, "c"], [T.EVIDENCE_STORED, "es"],
    [T.EVIDENCE_LOCKED, "el"], [T.SCORED, "s"], [T.NARRATIVE_PENDING, "np"],
    [T.NARRATIVE_READY, "nr"], [T.DRAFT_RENDERED, "dr"], [T.IN_REVIEW, "ir"],
  ]) {
    await lifecycleService.transition({ auditId, tenantId, toState: state, transitionIdempotencyKey: key });
  }
  return { runtime, lifecycleService, artifactStore, reportStore };
}

test("ACTIVATION-C-01: v2 approval proceeds without the v1 16-page set", async () => {
  const auditId = "11111111-2222-4333-8444-555555555555";
  const tenantId = "tenant-a";
  const clientId = "client-a";
  const { runtime, artifactStore } = await makeRuntimeInReview({ auditId, tenantId, clientId });

  // v2 artifacts present; NO v1 pages exist.
  await artifactStore.put({
    bytes: Buffer.from(JSON.stringify({ contractVersion: "1.0.0", reportDesignVersion: "2.0.0", status: "draft" })),
    contentType: "application/json",
    scope: { tenantId, clientId, auditId, category: "report-v2", artifactName: "manifest.json" },
  });
  await artifactStore.put({
    bytes: Buffer.from("<!doctype html>", "utf-8"),
    contentType: "text/html",
    scope: { tenantId, clientId, auditId, category: "report-v2", artifactName: "pages/index.html" },
  });

  const result = await runtime.auditService.approveAudit(auditId, tenantId, "slug", "approver", undefined);
  assert.equal(result.status, T.APPROVED, "v2 approval succeeds without v1 pages");
  assert.equal(result.designVersion, "2.0.0", "approval ran through the v2 contract branch");
});

test("ACTIVATION-C-02: v1 approval still requires the locked 16-page set", async () => {
  const auditId = "22222222-2222-4333-8444-555555555555";
  const tenantId = "tenant-b";
  const clientId = "client-b";
  const { runtime } = await makeRuntimeInReview({ auditId, tenantId, clientId });

  // No v1 pages, no v2 manifest ⇒ the v1 preload must fail closed with 422.
  await assert.rejects(
    runtime.auditService.approveAudit(auditId, tenantId, "slug", "approver", undefined),
    (err) => err.statusCode === 422 && /Draft report page missing/.test(err.message),
    "v1 approval fails closed when the locked page set is missing",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { createAuditApplicationService } from "../application/audit-service.js";
import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { createLifecycleService } from "../lifecycle/lifecycle-service.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createGovernedArtifactStore } from "../storage/governed-artifact-store.js";

const noopValidator = () => ({ valid: true, errors: [] });

async function captureAuditRequest(input) {
  const captured = [];
  const lifecycleRepo = createMemoryLifecycleRepository();
  const service = createAuditApplicationService({
    orchestrator: {
      execute: async (auditRequest) => {
        captured.push(auditRequest);
        return { auditId: auditRequest.auditId, finalState: "validated" };
      },
    },
    lifecycleRepo,
    lifecycleService: createLifecycleService(lifecycleRepo),
    artifactStore: createGovernedArtifactStore({ store: createMemoryArtifactStore() }),
    reportStore: {},
    config: {},
    validateContract: noopValidator,
  });

  await service.createAudit(
    {
      targetUrl: "https://example.com",
      businessName: "Example",
      ...input,
    },
    "tenant-a",
  );

  assert.equal(captured.length, 1, "controlled orchestrator invoked exactly once");
  return captured[0];
}

test("PATH-DEFAULT-01: normal web audit enables live conversion-path validation", async () => {
  const previous = process.env.PRYSM_DISABLE_LIVE_BROWSER;
  delete process.env.PRYSM_DISABLE_LIVE_BROWSER;
  try {
    const request = await captureAuditRequest({});
    assert.deepEqual(request.crawl, { pathValidationLiveBrowser: true });
  } finally {
    if (previous === undefined) delete process.env.PRYSM_DISABLE_LIVE_BROWSER;
    else process.env.PRYSM_DISABLE_LIVE_BROWSER = previous;
  }
});

test("PATH-DEFAULT-02: supplied crawl configuration survives while live-browser default is added", async () => {
  const previous = process.env.PRYSM_DISABLE_LIVE_BROWSER;
  delete process.env.PRYSM_DISABLE_LIVE_BROWSER;
  try {
    const request = await captureAuditRequest({
      crawl: {
        maxPages: 25,
        pathValidationPageLimit: 4,
        enableContentParsing: false,
      },
    });
    assert.equal(request.crawl.maxPages, 25);
    assert.equal(request.crawl.pathValidationPageLimit, 4);
    assert.equal(request.crawl.enableContentParsing, false);
    assert.equal(request.crawl.pathValidationLiveBrowser, true);
  } finally {
    if (previous === undefined) delete process.env.PRYSM_DISABLE_LIVE_BROWSER;
    else process.env.PRYSM_DISABLE_LIVE_BROWSER = previous;
  }
});

test("PATH-DEFAULT-03: explicit live-browser false remains false", async () => {
  const previous = process.env.PRYSM_DISABLE_LIVE_BROWSER;
  delete process.env.PRYSM_DISABLE_LIVE_BROWSER;
  try {
    const request = await captureAuditRequest({
      crawl: { pathValidationLiveBrowser: false },
    });
    assert.equal(request.crawl.pathValidationLiveBrowser, false);
  } finally {
    if (previous === undefined) delete process.env.PRYSM_DISABLE_LIVE_BROWSER;
    else process.env.PRYSM_DISABLE_LIVE_BROWSER = previous;
  }
});

test("PATH-DEFAULT-04: environment kill-switch forces live-browser validation off", async () => {
  const previous = process.env.PRYSM_DISABLE_LIVE_BROWSER;
  process.env.PRYSM_DISABLE_LIVE_BROWSER = "1";
  try {
    const request = await captureAuditRequest({
      crawl: {
        maxPages: 30,
        pathValidationLiveBrowser: true,
      },
    });
    assert.equal(request.crawl.maxPages, 30, "unrelated crawl override survives kill-switch");
    assert.equal(request.crawl.pathValidationLiveBrowser, false);
  } finally {
    if (previous === undefined) delete process.env.PRYSM_DISABLE_LIVE_BROWSER;
    else process.env.PRYSM_DISABLE_LIVE_BROWSER = previous;
  }
});

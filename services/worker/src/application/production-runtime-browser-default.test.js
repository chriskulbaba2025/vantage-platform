import test from "node:test";
import assert from "node:assert/strict";

import { createProductionRuntime } from "./production-runtime.js";
import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createGovernedArtifactStore } from "../storage/governed-artifact-store.js";
import { loadAuditRequest } from "../orchestration/audit-request-persistence.js";

const noopValidator = () => ({ valid: true, errors: [] });

function controlledFailureAdapter(source) {
  return {
    adapterVersion: "1.0.0",
    execute: async () => {
      const error = new Error(`Controlled ${source} failure`);
      error.category = "internal";
      throw error;
    },
  };
}

function controlledAdapters() {
  return {
    "dataforseo-onpage": controlledFailureAdapter("dataforseo-onpage"),
    pagespeed: controlledFailureAdapter("pagespeed"),
    "dataforseo-serp": controlledFailureAdapter("dataforseo-serp"),
    backlinks: controlledFailureAdapter("backlinks"),
    ga4: controlledFailureAdapter("ga4"),
    gsc: controlledFailureAdapter("gsc"),
  };
}

async function capturePersistedRequest(input, tenantId) {
  const artifactStore = createGovernedArtifactStore({
    store: createMemoryArtifactStore(),
  });

  const runtime = createProductionRuntime({
    config: {
      artifactDir: ".",
      narrativeMode: "mock",
    },
    adapters: controlledAdapters(),
    validateContract: noopValidator,
    artifactStore,
    lifecycleRepo: createMemoryLifecycleRepository(),
    reportStore: {},
    narrativeV2: { enabled: false },
  });

  const created = await runtime.auditService.createAudit(
    {
      targetUrl: "https://example.com",
      businessName: "Example",
      market: "Canada",
      primaryGoal: "Generate enquiries",
      services: ["Consulting"],
      ...input,
    },
    tenantId,
  );

  return loadAuditRequest({
    store: artifactStore,
    scope: {
      tenantId,
      clientId: created.clientId,
      auditId: created.auditId,
    },
    validateContract: noopValidator,
  });
}

test(
  "TBK-REPAIR-01: production intake persists the governed live-browser policy",
  async () => {
    const previous = process.env.PRYSM_DISABLE_LIVE_BROWSER;

    try {
      delete process.env.PRYSM_DISABLE_LIVE_BROWSER;

      const normal = await capturePersistedRequest(
        {},
        "tenant-browser-normal",
      );

      assert.equal(
        normal.crawl.pathValidationLiveBrowser,
        true,
        "normal UI-style production intake enables live browser validation",
      );

      const configured = await capturePersistedRequest(
        {
          crawl: {
            maxPages: 25,
            pathValidationPageLimit: 4,
            enableContentParsing: false,
          },
        },
        "tenant-browser-configured",
      );

      assert.equal(configured.crawl.maxPages, 25);
      assert.equal(configured.crawl.pathValidationPageLimit, 4);
      assert.equal(configured.crawl.enableContentParsing, false);
      assert.equal(
        configured.crawl.pathValidationLiveBrowser,
        true,
        "unrelated crawl configuration survives while browser default is added",
      );

      const explicitFalse = await capturePersistedRequest(
        {
          crawl: {
            pathValidationLiveBrowser: false,
          },
        },
        "tenant-browser-explicit-false",
      );

      assert.equal(
        explicitFalse.crawl.pathValidationLiveBrowser,
        false,
        "explicit false remains false",
      );

      process.env.PRYSM_DISABLE_LIVE_BROWSER = "1";

      const killed = await capturePersistedRequest(
        {
          crawl: {
            maxPages: 30,
            pathValidationLiveBrowser: true,
          },
        },
        "tenant-browser-killed",
      );

      assert.equal(killed.crawl.maxPages, 30);
      assert.equal(
        killed.crawl.pathValidationLiveBrowser,
        false,
        "environment kill-switch forces browser validation off",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.PRYSM_DISABLE_LIVE_BROWSER;
      } else {
        process.env.PRYSM_DISABLE_LIVE_BROWSER = previous;
      }
    }
  },
);


test(
  "GACM-INTAKE-IDEMPOTENCY-01: exact retries reuse one audit and conflicting reuse fails closed",
  async () => {
    const artifactStore = createGovernedArtifactStore({
      store: createMemoryArtifactStore(),
    });
    const lifecycleRepo = createMemoryLifecycleRepository();
    const runtime = createProductionRuntime({
      config: {
        artifactDir: ".",
        narrativeMode: "mock",
      },
      adapters: controlledAdapters(),
      validateContract: noopValidator,
      artifactStore,
      lifecycleRepo,
      reportStore: {},
      narrativeV2: { enabled: false },
    });

    const input = {
      targetUrl: "https://idempotent.example",
      businessName: "Idempotent Example",
      market: "Canada",
      primaryGoal: "Generate enquiries",
      services: ["Consulting"],
      idempotencyKey: "audit-retry-0001",
    };

    const first = await runtime.auditService.createAudit(
      input,
      "tenant-idempotency",
    );
    const replay = await runtime.auditService.createAudit(
      input,
      "tenant-idempotency",
    );

    assert.equal(replay.auditId, first.auditId, "same request reuses the existing audit");
    assert.equal(replay.clientId, first.clientId);
    assert.equal(replay.backgroundStarted, false, "replay never starts provider/background work");
    assert.equal(replay.idempotentReplay, true);

    await assert.rejects(
      runtime.auditService.createAudit(
        {
          ...input,
          primaryGoal: "Sell products online",
        },
        "tenant-idempotency",
      ),
      (error) =>
        error.statusCode === 409 &&
        error.code === "AUDIT_IDEMPOTENCY_CONFLICT",
      "same key with changed intent must fail closed",
    );
  },
);

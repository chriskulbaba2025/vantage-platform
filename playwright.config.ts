import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/wp11",
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: process.env.NEXT_PUBLIC_URL || "http://127.0.0.1:4000",
    headless: true,
    screenshot: "off",
    video: "off",
  },
  webServer: [
    // Worker server (mock mode)
    {
      command: `node -e "
        const { createServer } = require('node:http');
        const { randomUUID } = require('node:crypto');

        // Minimal worker with WP11 API routes — mock mode
        async function main() {
          const { createMemoryArtifactStore } = await import('./services/worker/src/storage/memory-artifact-store.js');
          const { createGovernedArtifactStore } = await import('./services/worker/src/storage/governed-artifact-store.js');
          const { createMemoryLifecycleRepository } = await import('./services/worker/src/lifecycle/memory-repository.js');
          const { createLifecycleService } = await import('./services/worker/src/lifecycle/lifecycle-service.js');
          const { createAuditOrchestrator } = await import('./services/worker/src/orchestration/audit-orchestrator.js');
          const { createAuditApplicationService } = await import('./services/worker/src/application/audit-service.js');
          const { createLocalReportStore } = await import('./services/worker/src/storage/report-store.js');
          const { createRequestHandler } = await import('./services/worker/src/server.js');
          const { mkdirSync, rmSync } = await require('node:fs');
          const { resolve } = await require('node:path');

          const baseDir = resolve('artifacts', 'wp11-playwright-' + Date.now());
          mkdirSync(baseDir, { recursive: true });

          const mem = createMemoryArtifactStore();
          const artifacts = createGovernedArtifactStore({ store: mem });
          const lcRepo = createMemoryLifecycleRepository();
          const lc = createLifecycleService(lcRepo);
          const reportStore = createLocalReportStore({ baseDir });

          const mockAdapters = {};
          ['dataforseo-onpage','pagespeed','dataforseo-serp','backlinks','ga4','gsc'].forEach(n => {
            mockAdapters[n] = { adapterVersion: '1.0.0', execute: async () => ({
              rawBytes: Buffer.from('{}'), contentType: 'application/json',
              sourceResult: { contractVersion:'1.0.0',schemaVersion:'1.0.0',source:n,provider:'mock',adapterVersion:'1.0.0',status:'AVAILABLE',startedAt:new Date().toISOString(),completedAt:new Date().toISOString(),retryCount:0,coverage:{requested:1,completed:1,failed:0},limitations:[],evidence:{} }
            })};
          });

          const orch = createAuditOrchestrator({
            lifecycleService:lc, artifactStore:artifacts, adapters:mockAdapters,
            validateContract: () => ({ valid:true, errors:[] }),
            clock: { now:() => new Date().toISOString(), sleep:async()=>{}, setTimeout:(f,m) => setTimeout(f,Math.min(m,100)) },
            retryPolicyResolver: () => ({ timeoutMs:30000, maxAttempts:1, retryable:()=>false, delayMs:()=>0 }),
          });

          const auditService = createAuditApplicationService({
            orchestrator:orch, lifecycleRepo:lcRepo, lifecycleService:lc,
            artifactStore:artifacts, reportStore,
            config: { artifactDir: baseDir },
            validateContract: () => ({ valid:true, errors:[] }),
          });

          const handler = createRequestHandler({
            config: { artifactDir:baseDir, webhookSecret:'', vantageTenantId:'playwright-tenant' },
            localStore:reportStore, store:reportStore,
            oauthService: { getAuthUrl:()=>'', validateState:()=>'ga4', exchangeCode:async()=>({}), getStatus:async()=>({}), disconnect:async()=>({}) },
            auditService,
          });

          const server = createServer(handler);
          server.listen(${process.env.WORKER_PORT || 19350}, '127.0.0.1', () => {
            console.log('Worker mock server listening on ' + (${process.env.WORKER_PORT || 19350}));
          });
        }
        main().catch(e => { console.error(e); process.exit(1); });
      "`,
      port: parseInt(process.env.WORKER_PORT || "19350"),
      timeout: 30_000,
      reuseExistingServer: false,
    },
    // Next.js dev server
    {
      command: `npx next dev --port ${process.env.NEXT_PORT || 19400}`,
      port: parseInt(process.env.NEXT_PORT || "19400"),
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        VANTAGE_WORKER_API_URL: `http://127.0.0.1:${process.env.WORKER_PORT || 19350}`,
        VANTAGE_WEBHOOK_SECRET: "test-secret",
        VANTAGE_TENANT_ID: "playwright-tenant",
      },
    },
  ],
});

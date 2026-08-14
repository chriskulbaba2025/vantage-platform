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
      command: `node tests/wp11/mock-worker.js`,
      port: parseInt(process.env.WORKER_PORT || "19350"),
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        VANTAGE_DEV_MEMORY_STORE: "true",
      },
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
        PRYSM_IDENTITY_MODE: "mock",
      },
    },
  ],
});

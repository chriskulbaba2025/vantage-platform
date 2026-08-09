/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server-only env vars — never exposed to browser
  serverRuntimeConfig: {
    workerApiBaseUrl: process.env.VANTAGE_WORKER_API_URL || "http://localhost:3000",
    workerApiSecret: process.env.VANTAGE_WEBHOOK_SECRET || "",
    vantageTenantId: process.env.VANTAGE_TENANT_ID || "default",
  },
  // Public env vars — safe for browser
  publicRuntimeConfig: {
    appName: "Prysm",
    appVersion: "0.1.0",
  },
};

module.exports = nextConfig;

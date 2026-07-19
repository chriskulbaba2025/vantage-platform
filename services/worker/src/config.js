import { resolve } from "node:path";

function intEnv(name, fallback, min, max) {
  const raw = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

export function loadConfig(env = process.env) {
  return {
    port: intEnv("PORT", 3000, 1, 65535),
    webhookSecret: env.VANTAGE_WEBHOOK_SECRET || "",
    maxPages: intEnv("VANTAGE_MAX_PAGES", 30, 1, 100),
    browserMode: env.VANTAGE_BROWSER_MODE || "auto",
    artifactDir: resolve(env.VANTAGE_ARTIFACT_DIR || "artifacts/reports"),
    publicReportBaseUrl: (env.VANTAGE_PUBLIC_REPORT_BASE_URL || "").replace(/\/$/, ""),
    pagespeedApiKey: env.GOOGLE_PAGESPEED_API_KEY || "",
    cruxApiKey: env.GOOGLE_CRUX_API_KEY || env.GOOGLE_PAGESPEED_API_KEY || "",
    dataforseoLogin: env.DATAFORSEO_LOGIN || "",
    dataforseoPassword: env.DATAFORSEO_PASSWORD || "",
    ga4PropertyId: env.GA4_PROPERTY_ID || "",
    googleServiceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
    awsRegion: env.AWS_REGION || "ca-central-1",
    reportsBucket: env.VANTAGE_REPORTS_BUCKET || "",
    reportsPrefix: env.VANTAGE_REPORTS_PREFIX || "vantage/reports",
  };
}

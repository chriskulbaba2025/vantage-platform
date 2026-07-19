import { withTimeout } from "../utils.js";

function parseServiceAccount(raw) {
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (error) { throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON: ${error.message}`); }
}

export async function collectGa4(options = {}) {
  const propertyId = options.propertyId || "";
  const credentials = parseServiceAccount(options.serviceAccountJson || "");
  if (!propertyId || !credentials) {
    return {
      status: "not_configured",
      included: false,
      affectsScore: false,
      note: "GA4 was not connected. The website audit completed without analytics data.",
    };
  }

  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/analytics.readonly"] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const body = {
    dateRanges: [{ startDate: options.startDate || "90daysAgo", endDate: options.endDate || "yesterday" }],
    dimensions: [{ name: "landingPagePlusQueryString" }, { name: "sessionDefaultChannelGroup" }, { name: "deviceCategory" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "engagedSessions" }, { name: "keyEvents" }],
    limit: 1000,
  };
  const response = await withTimeout(fetchImpl(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token.token || token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }), 45000, "GA4 runReport");
  if (!response.ok) throw new Error(`GA4 runReport failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const data = await response.json();
  const rows = data.rows || [];
  const totals = rows.reduce((acc, row) => {
    const m = row.metricValues || [];
    acc.sessions += Number(m[0]?.value || 0);
    acc.users += Number(m[1]?.value || 0);
    acc.engagedSessions += Number(m[2]?.value || 0);
    acc.keyEvents += Number(m[3]?.value || 0);
    return acc;
  }, { sessions: 0, users: 0, engagedSessions: 0, keyEvents: 0 });
  return {
    status: "complete",
    included: true,
    affectsScore: false,
    propertyId,
    totals,
    engagementRate: totals.sessions ? totals.engagedSessions / totals.sessions : null,
    rows: rows.slice(0, 100).map((row) => ({
      landingPage: row.dimensionValues?.[0]?.value || "",
      channel: row.dimensionValues?.[1]?.value || "",
      device: row.dimensionValues?.[2]?.value || "",
      sessions: Number(row.metricValues?.[0]?.value || 0),
      users: Number(row.metricValues?.[1]?.value || 0),
      engagedSessions: Number(row.metricValues?.[2]?.value || 0),
      keyEvents: Number(row.metricValues?.[3]?.value || 0),
    })),
    collectedAt: new Date().toISOString(),
  };
}

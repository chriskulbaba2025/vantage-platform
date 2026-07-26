/**
 * Google Search Console data collection.
 *
 * Collects search performance data via the Search Console API (v1).
 * Uses either OAuth tokens or service account credentials for authentication.
 * Remains optional — returns NOT_CONNECTED when not configured.
 *
 * Default windows: most recent complete 28 days + preceding 28 days.
 * Sufficiency gate: at least 100 impressions for score-bearing findings.
 *
 * Required dimensions: query, page, device, country, date
 * Required metrics:    clicks, impressions, CTR, position
 */

import { withTimeout } from "../utils.js";
import {
  SOURCE_STATUS,
  ERROR_CATEGORY,
  buildSourceStatus,
  EVIDENCE_ENVELOPE_VERSION,
} from "../scoring/evidence-contracts.js";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function yesterday() {
  return daysAgo(1);
}

function defaultWindows() {
  // Most recent complete 28 days: days 2–29 ago (yesterday back 28 days)
  // Preceding 28 days: days 30–57 ago
  return {
    recent: { startDate: daysAgo(29), endDate: yesterday() },
    previous: { startDate: daysAgo(57), endDate: daysAgo(30) },
  };
}

// ---------------------------------------------------------------------------
// Service account auth (reused from GA4 config)
// ---------------------------------------------------------------------------

function parseServiceAccount(raw) {
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON: ${error.message}`);
  }
}

async function getServiceAccountClient(credentials) {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  return auth.getClient();
}

// ---------------------------------------------------------------------------
// GSC API call
// ---------------------------------------------------------------------------

const GSC_API = "https://www.googleapis.com/webmasters/v3";

async function fetchGsc(siteUrl, body, token, fetchImpl) {
  const endpoint = `${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await withTimeout(
    fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    45000,
    "GSC searchAnalytics.query",
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(`GSC query failed (${response.status}): ${text.slice(0, 300)}`);
    error.status = response.status;
    if (response.status === 403 || response.status === 401) {
      error.errorCategory = ERROR_CATEGORY.AUTH;
    }
    throw error;
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

function normalizeRows(rows, siteUrl, windowLabel) {
  return (rows || []).map((row) => ({
    query: row.keys?.[0] || "",
    page: row.keys?.[1] || "",
    device: row.keys?.[2] || "",
    country: row.keys?.[3] || "",
    date: row.keys?.[4] || "",
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr || 0,
    position: row.position || 0,
    siteUrl,
    window: windowLabel,
  }));
}

// ---------------------------------------------------------------------------
// Sufficiency gate
// ---------------------------------------------------------------------------

export const GSC_SUFFICIENCY_THRESHOLD = 100; // minimum impressions

/**
 * Determine whether a GSC row or aggregate meets the sufficiency threshold.
 * Returns { sufficient, confidence }.
 */
export function checkGscSufficiency(impressions, threshold = GSC_SUFFICIENCY_THRESHOLD) {
  if (impressions >= threshold) {
    return { sufficient: true, confidence: "sufficient" };
  }
  return { sufficient: false, confidence: "directional" };
}

// ---------------------------------------------------------------------------
// Main collection entry point
// ---------------------------------------------------------------------------

/**
 * Collect GSC search performance data for a site.
 *
 * @param {string} siteUrl           The site URL (e.g. "https://example.com")
 * @param {object} options
 * @param {string} [options.serviceAccountJson]  Service account JSON
 * @param {object} [options.oauthService]        OAuth service for token retrieval
 * @param {object} [options.fetchImpl]           fetch implementation
 * @param {number} [options.rowLimit]            max rows per query (default 1000)
 * @param {number} [options.sufficiencyThreshold] min impressions (default 100)
 * @returns {object} evidence envelope
 */
export async function collectGsc(siteUrl, options = {}) {
  const startedAt = new Date().toISOString();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const rowLimit = options.rowLimit || 1000;
  const sufficiencyThreshold = options.sufficiencyThreshold ?? GSC_SUFFICIENCY_THRESHOLD;

  // Normalize site URL for GSC API (must be exactly as registered in GSC)
  const normalizedSiteUrl = siteUrl.replace(/\/$/, "");

  // ── Auth ──────────────────────────────────────────────────────────────
  let token = null;
  const serviceAccountJson = options.serviceAccountJson || "";

  // Try OAuth first, then service account
  if (options.oauthService) {
    token = await options.oauthService.getAccessToken("google-search-console");
  }

  if (!token && serviceAccountJson) {
    try {
      const credentials = parseServiceAccount(serviceAccountJson);
      if (credentials) {
        const client = await getServiceAccountClient(credentials);
        const accessToken = await client.getAccessToken();
        token = accessToken.token || accessToken;
      }
    } catch (error) {
      // Auth failed — will return NOT_CONNECTED
    }
  }

  if (!token) {
    const completedAt = new Date().toISOString();
    return {
      evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
      source: "google-search-console",
      sourceStatus: SOURCE_STATUS.NOT_CONNECTED,
      status: SOURCE_STATUS.NOT_CONNECTED,
      included: false,
      affectsScore: false,
      note: "GSC was not connected. The website audit completed without search-console data.",
      collectedAt: completedAt,
      coverage: { requested: 0, completed: 0, failed: 0 },
      rawArtifactRef: null,
      _sourceStatus: buildSourceStatus({
        provider: "google-search-console",
        adapterVersion: "1.0.0",
        startedAt,
        completedAt,
        requestId: null,
        retryCount: 0,
        returnedRecordCount: 0,
        expectedRecordCount: null,
        errorCategory: ERROR_CATEGORY.NOT_CONFIGURED,
        limitation: "GSC is not connected — no OAuth token or service account configured.",
        rawArtifactRef: null,
      }),
    };
  }

  // ── Query both date windows ───────────────────────────────────────────
  const windows = defaultWindows();
  const dimensions = [
    { name: "query" },
    { name: "page" },
    { name: "device" },
    { name: "country" },
    { name: "date" },
  ];
  const metrics = [
    { name: "clicks" },
    { name: "impressions" },
    { name: "ctr" },
    { name: "position" },
  ];

  const allRows = [];
  const limitations = [];

  for (const [label, window] of Object.entries(windows)) {
    try {
      const body = {
        startDate: window.startDate,
        endDate: window.endDate,
        dimensions: dimensions.map((d) => d.name),
        rowLimit,
        aggregationType: "auto",
      };

      const data = await fetchGsc(normalizedSiteUrl, body, token, fetchImpl);
      const rows = normalizeRows(data.rows || [], normalizedSiteUrl, label);
      allRows.push(...rows);

      if ((data.rows || []).length >= rowLimit) {
        limitations.push(`GSC ${label} window reached row limit (${rowLimit}) — results may be truncated.`);
      }
    } catch (error) {
      const errMsg = `GSC ${label} window collection failed: ${error.message}`;
      limitations.push(errMsg);
    }
  }

  // ── Aggregate totals ─────────────────────────────────────────────────
  const totals = allRows.reduce(
    (acc, row) => {
      acc.clicks += row.clicks || 0;
      acc.impressions += row.impressions || 0;
      acc.ctr = acc.impressions > 0 ? acc.clicks / acc.impressions : 0;
      acc.avgPosition += (row.position || 0);
      return acc;
    },
    { clicks: 0, impressions: 0, ctr: 0, avgPosition: 0 },
  );

  if (allRows.length > 0) {
    totals.avgPosition = totals.avgPosition / allRows.length;
  }

  // ── Sufficiency assessment ────────────────────────────────────────────
  const sufficiency = checkGscSufficiency(totals.impressions, sufficiencyThreshold);

  // ── Top queries / pages ───────────────────────────────────────────────
  const topQueries = Object.entries(
    allRows.reduce((acc, r) => {
      acc[r.query] = (acc[r.query] || 0) + r.impressions;
      return acc;
    }, {}),
  )
    .sort(([, a], [, b]) => b - a)
    .slice(0, 25)
    .map(([query, impressions]) => ({ query, impressions }));

  const topPages = Object.entries(
    allRows.reduce((acc, r) => {
      acc[r.page] = (acc[r.page] || 0) + r.clicks;
      return acc;
    }, {}),
  )
    .sort(([, a], [, b]) => b - a)
    .slice(0, 25)
    .map(([page, clicks]) => ({ page, clicks }));

  const completedAt = new Date().toISOString();
  const returnedCount = allRows.length;

  const sourceStatus =
    returnedCount > 0 ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.UNAVAILABLE;

  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "google-search-console",
    sourceStatus,
    status: sourceStatus,
    included: returnedCount > 0,
    affectsScore: false,
    siteUrl: normalizedSiteUrl,
    windows: {
      recent: windows.recent,
      previous: windows.previous,
    },
    totals,
    sufficiency: {
      threshold: sufficiencyThreshold,
      sufficient: sufficiency.sufficient,
      confidence: sufficiency.confidence,
    },
    topQueries,
    topPages,
    rows: allRows.slice(0, 250),
    limitations,
    collectedAt: completedAt,
    coverage: {
      requested: Object.keys(windows).length * rowLimit,
      completed: returnedCount,
      failed: 0,
      windowsRequested: Object.keys(windows).length,
    },
    rawArtifactRef: null,
    _sourceStatus: buildSourceStatus({
      provider: "google-search-console",
      adapterVersion: "1.0.0",
      startedAt,
      completedAt,
      requestId: null,
      retryCount: 0,
      returnedRecordCount: returnedCount,
      expectedRecordCount: Object.keys(windows).length * rowLimit,
      errorCategory: returnedCount === 0 ? ERROR_CATEGORY.NO_DATA : null,
      limitation: limitations.length > 0 ? limitations.join("; ") : null,
      rawArtifactRef: null,
    }),
  };
}

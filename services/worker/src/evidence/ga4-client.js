/**
 * Google Analytics 4 data collection.
 *
 * Collects aggregated traffic and conversion data via the GA4 Data API (v1beta).
 * Uses either OAuth tokens or service account credentials for authentication.
 * Remains optional — returns NOT_CONNECTED when not configured.
 *
 * Required aggregated data:
 *   sessions, engaged sessions, engagement rate, landing pages,
 *   source/medium, key events, event counts, conversion rate, device category.
 *
 * No user-level records are stored.  All data is aggregated.
 *
 * Measurement-readiness checks identify gaps in the GA4 setup that would
 * prevent answering the client's primary conversion question.
 */

import { withTimeout } from "../utils.js";
import {
  SOURCE_STATUS,
  ERROR_CATEGORY,
  buildSourceStatus,
  EVIDENCE_ENVELOPE_VERSION,
} from "../scoring/evidence-contracts.js";

// ---------------------------------------------------------------------------
// Service account helpers
// ---------------------------------------------------------------------------

function parseServiceAccount(raw) {
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON: ${error.message}`);
  }
}

async function getServiceAccountToken(credentials) {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token || token;
}

// ---------------------------------------------------------------------------
// GA4 Data API call
// ---------------------------------------------------------------------------

async function runGa4Report(propertyId, body, token, fetchImpl) {
  const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
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
    "GA4 runReport",
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GA4 runReport failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Row aggregation
// ---------------------------------------------------------------------------

function aggregateRows(rows, dimCount, metricNames) {
  const totals = {};
  for (const name of metricNames) totals[name] = 0;

  for (const row of rows || []) {
    const metrics = row.metricValues || [];
    for (let i = 0; i < metricNames.length; i++) {
      totals[metricNames[i]] += Number(metrics[i]?.value || 0);
    }
  }
  return totals;
}

function normalizeRows(rows, dimCount, metricNames) {
  return (rows || []).slice(0, 100).map((row) => {
    const dims = row.dimensionValues || [];
    const metrics = row.metricValues || [];
    const out = {};
    for (let i = 0; i < dimCount; i++) {
      out[`dim${i}`] = dims[i]?.value || "";
    }
    for (let i = 0; i < metricNames.length; i++) {
      out[metricNames[i]] = Number(metrics[i]?.value || 0);
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Measurement-readiness assessment (PRD §11.3)
// ---------------------------------------------------------------------------

/**
 * Analyse GA4 setup for gaps that prevent answering the primary
 * conversion question.
 *
 * Returns a readiness object with identified issues.
 */
function assessMeasurementReadiness(trafficData, eventData) {
  const issues = [];

  // 1. Missing key events
  const keyEventCount = trafficData.totals?.keyEvents || 0;
  if (keyEventCount === 0) {
    issues.push({
      type: "missing_key_events",
      severity: "High",
      detail: "No key events are configured. GA4 cannot measure conversions without key events.",
    });
  }

  // 2. Ambiguous events — check for generic event names
  const eventNames = (eventData?.rows || []).map((r) => r.dim0 || "");
  const genericEvents = eventNames.filter((name) =>
    /^(event|click|page_view|session_start|user_engagement|scroll|view_item|add_to_cart|purchase|sign_up|generate_lead|submit_form|contact|download|video|file|outbound|other|custom)$/i.test(name),
  );
  const namedEvents = eventNames.filter((name) => !genericEvents.includes(name));
  if (genericEvents.length > 0 && namedEvents.length === 0) {
    issues.push({
      type: "ambiguous_events",
      severity: "Medium",
      detail: `Only generic event names detected (${genericEvents.slice(0, 5).join(", ")}). Custom conversion event names are recommended for clear measurement.`,
    });
  }

  // 3. Duplicate events
  const eventCounts = {};
  for (const name of eventNames) {
    eventCounts[name] = (eventCounts[name] || 0) + 1;
  }
  const duplicates = Object.entries(eventCounts).filter(([, c]) => c > 1);
  if (duplicates.length > 0) {
    issues.push({
      type: "duplicate_events",
      severity: "Low",
      detail: `${duplicates.length} event name(s) appear multiple times. Verify event tagging to avoid double-counting.`,
    });
  }

  // 4. Absent source attribution
  const hasSourceAttribution = (trafficData.rows || []).some(
    (r) => r.dim1 && r.dim1 !== "(not set)" && r.dim1 !== "",
  );
  if (!hasSourceAttribution && (trafficData.rows || []).length > 0) {
    issues.push({
      type: "absent_source_attribution",
      severity: "Medium",
      detail: "No traffic source/medium is attributed. UTM tagging or auto-tagging may be missing.",
    });
  }

  // 5. Incomplete funnels — check if there's only one step to conversion
  if (keyEventCount > 0 && namedEvents.length < 2) {
    issues.push({
      type: "incomplete_funnels",
      severity: "Medium",
      detail: "Only one or no custom conversion event is configured. Multi-step funnels may be incomplete.",
    });
  }

  // 6. Third-party conversions
  if (keyEventCount === 0 && (trafficData.rows || []).length > 0) {
    issues.push({
      type: "third_party_conversions",
      severity: "Low",
      detail: "Conversions may be occurring on third-party platforms (e.g., Calendly, Stripe, Shopify). Cross-domain tracking or offline conversion imports may be needed.",
    });
  }

  return {
    issues,
    ready: issues.filter((i) => i.severity === "High").length === 0,
    issueCount: issues.length,
  };
}

// ---------------------------------------------------------------------------
// Main collection entry point
// ---------------------------------------------------------------------------

/**
 * Collect aggregated GA4 evidence with measurement-readiness assessment.
 *
 * @param {object} options
 * @param {string} [options.propertyId]         GA4 property ID
 * @param {string} [options.serviceAccountJson]  Service account JSON (string or object)
 * @param {object} [options.oauthService]        OAuth service for token retrieval
 * @param {object} [options.fetchImpl]           fetch implementation
 * @param {string} [options.startDate]           custom start date
 * @param {string} [options.endDate]             custom end date
 * @returns {object} evidence envelope
 */
export async function collectGa4(options = {}) {
  const startedAt = new Date().toISOString();
  const propertyId = options.propertyId || "";
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  // ── Auth ──────────────────────────────────────────────────────────────
  let token = null;
  const serviceAccountJson = options.serviceAccountJson || "";

  // Try OAuth first, then service account
  if (options.oauthService) {
    token = await options.oauthService.getAccessToken("google-analytics-4");
  }

  if (!token && serviceAccountJson) {
    try {
      const credentials = parseServiceAccount(serviceAccountJson);
      if (credentials) {
        token = await getServiceAccountToken(credentials);
      }
    } catch {
      // Auth failed — will return NOT_CONNECTED
    }
  }

  if (!propertyId || !token) {
    const completedAt = new Date().toISOString();
    return {
      evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
      source: "google-analytics-4",
      sourceStatus: SOURCE_STATUS.NOT_CONNECTED,
      status: SOURCE_STATUS.NOT_CONNECTED,
      included: false,
      affectsScore: false,
      note: "GA4 was not connected. The website audit completed without analytics data.",
      collectedAt: completedAt,
      coverage: { requested: 0, completed: 0, failed: 0 },
      rawArtifactRef: null,
      _sourceStatus: buildSourceStatus({
        provider: "google-analytics-4",
        adapterVersion: "1.0.0",
        startedAt,
        completedAt,
        requestId: null,
        retryCount: 0,
        returnedRecordCount: 0,
        expectedRecordCount: null,
        errorCategory: ERROR_CATEGORY.NOT_CONFIGURED,
        limitation: "GA4 property ID or credentials not configured.",
        rawArtifactRef: null,
      }),
    };
  }

  // ── Collect traffic data ──────────────────────────────────────────────
  const limit = 1000;
  const trafficMetrics = ["sessions", "totalUsers", "engagedSessions", "keyEvents"];
  const trafficBody = {
    dateRanges: [{ startDate: options.startDate || "90daysAgo", endDate: options.endDate || "yesterday" }],
    dimensions: [
      { name: "landingPagePlusQueryString" },
      { name: "sessionDefaultChannelGroup" },
      { name: "deviceCategory" },
    ],
    metrics: trafficMetrics.map((m) => ({ name: m })),
    limit,
  };

  let trafficData;
  try {
    const data = await runGa4Report(propertyId, trafficBody, token, fetchImpl);
    const rows = data.rows || [];
    const totals = aggregateRows(rows, 3, trafficMetrics);

    trafficData = {
      totals,
      engagementRate: totals.sessions > 0 ? totals.engagedSessions / totals.sessions : null,
      conversionRate: totals.sessions > 0 ? totals.keyEvents / totals.sessions : null,
      rows: normalizeRows(rows, 3, trafficMetrics).map((r) => ({
        landingPage: r.dim0,
        channel: r.dim1,
        device: r.dim2,
        sessions: r.sessions,
        users: r.totalUsers,
        engagedSessions: r.engagedSessions,
        keyEvents: r.keyEvents,
      })),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    return {
      evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
      source: "google-analytics-4",
      sourceStatus: SOURCE_STATUS.FAILED,
      status: SOURCE_STATUS.FAILED,
      included: false,
      affectsScore: false,
      error: error.message,
      collectedAt: completedAt,
      coverage: { requested: limit, completed: 0, failed: limit },
      rawArtifactRef: null,
      _sourceStatus: buildSourceStatus({
        provider: "google-analytics-4",
        adapterVersion: "1.0.0",
        startedAt,
        completedAt,
        requestId: null,
        retryCount: 0,
        returnedRecordCount: 0,
        expectedRecordCount: limit,
        errorCategory: ERROR_CATEGORY.INTERNAL,
        limitation: error.message,
        rawArtifactRef: null,
      }),
    };
  }

  // ── Collect event data for measurement readiness ──────────────────────
  const eventMetrics = ["eventCount"];
  const eventBody = {
    dateRanges: [{ startDate: options.startDate || "90daysAgo", endDate: options.endDate || "yesterday" }],
    dimensions: [{ name: "eventName" }],
    metrics: eventMetrics.map((m) => ({ name: m })),
    limit: 50,
  };

  let eventData = { rows: [] };
  try {
    const data = await runGa4Report(propertyId, eventBody, token, fetchImpl);
    eventData = {
      rows: normalizeRows(data.rows || [], 1, eventMetrics).map((r) => ({
        eventName: r.dim0,
        eventCount: r.eventCount,
      })),
    };
  } catch {
    // Event data is supplementary — don't fail the whole collection
  }

  // ── Measurement readiness ─────────────────────────────────────────────
  const measurementReadiness = assessMeasurementReadiness(trafficData, eventData);

  const completedAt = new Date().toISOString();
  const returnedCount = (trafficData.rows || []).length;

  return {
    evidenceVersion: EVIDENCE_ENVELOPE_VERSION,
    source: "google-analytics-4",
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    status: SOURCE_STATUS.AVAILABLE,
    included: true,
    affectsScore: false,
    propertyId,
    totals: trafficData.totals,
    engagementRate: trafficData.engagementRate,
    conversionRate: trafficData.conversionRate,
    rows: trafficData.rows || [],
    events: eventData.rows || [],
    measurementReadiness,
    collectedAt: completedAt,
    coverage: { requested: limit, completed: returnedCount, failed: 0 },
    rawArtifactRef: null,
    _sourceStatus: buildSourceStatus({
      provider: "google-analytics-4",
      adapterVersion: "1.0.0",
      startedAt,
      completedAt,
      requestId: null,
      retryCount: 0,
      returnedRecordCount: returnedCount,
      expectedRecordCount: limit,
      errorCategory: null,
      limitation: null,
      rawArtifactRef: null,
    }),
  };
}

// ---------------------------------------------------------------------------
// Governed execute() contract — WP6 universal adapter interface
// ---------------------------------------------------------------------------

const GA4_ADAPTER_VERSION = "1.0.0";

/**
 * Execute the GA4 adapter behind the universal source contract.
 *
 * Returns NOT_CONNECTED when no GA4 property is configured.
 * Stores aggregate evidence only — no user-level records.
 */
export async function execute({ auditRequest, source, executionId, sourceExecutionKey, signal, attempt }) {
  const startedAt = new Date().toISOString();
  const ga4Config = auditRequest.ga4 || {};

  if (!ga4Config.propertyId) {
    const completedAt = new Date().toISOString();
    return {
      rawBytes: null,
      contentType: null,
      sourceResult: {
        contractVersion: "1.0.0",
        schemaVersion: "1.0.0",
        source,
        provider: "Google",
        adapterVersion: GA4_ADAPTER_VERSION,
        status: "NOT_CONNECTED",
        startedAt,
        completedAt,
        retryCount: 0,
        expectedRecords: 0,
        returnedRecords: 0,
        coverage: { requested: 0, completed: 0, failed: 0 },
        limitations: ["GA4 property ID not configured."],
        errorCategory: "not_configured",
        evidence: {},
      },
    };
  }

  const options = {
    propertyId: ga4Config.propertyId,
    serviceAccountJson: ga4Config.serviceAccountJson || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
    // Testability seams: controlled OAuth boundary + transport below the
    // adapter layer.  Production default behaviour is unchanged (null).
    oauthService: ga4Config.oauthService || null,
    fetchImpl: ga4Config.fetchImpl || null,
  };

  try {
    const envelope = await collectGa4(options);

    // Serialize aggregate-only evidence for artifact storage (no user-level data)
    const rawPayload = {
      adapterVersion: GA4_ADAPTER_VERSION,
      collectedAt: envelope.collectedAt,
      sourceStatus: envelope.sourceStatus,
      totals: envelope.totals || null,
      engagementRate: envelope.engagementRate,
      conversionRate: envelope.conversionRate,
      measurementReadiness: envelope.measurementReadiness || null,
      included: envelope.included,
    };
    const rawBytes = envelope.sourceStatus === "NOT_CONNECTED" ? null
      : Buffer.from(JSON.stringify(rawPayload), "utf-8");

    const sourceStatus = envelope._sourceStatus || {};
    const sourceResult = {
      contractVersion: "1.0.0",
      schemaVersion: "1.0.0",
      source,
      provider: "Google",
      adapterVersion: GA4_ADAPTER_VERSION,
      status: envelope.sourceStatus || envelope.status || "AVAILABLE",
      startedAt: sourceStatus.startedAt || startedAt,
      completedAt: sourceStatus.completedAt || envelope.collectedAt || new Date().toISOString(),
      ...(sourceStatus.requestId ? { requestId: sourceStatus.requestId } : {}),
      retryCount: sourceStatus.retryCount || 0,
      expectedRecords: sourceStatus.expectedRecordCount ?? 0,
      returnedRecords: sourceStatus.returnedRecordCount ?? 0,
      coverage: envelope.coverage || { requested: 0, completed: 0, failed: 0 },
      limitations: envelope.note ? [envelope.note] : [],
      evidence: {
        sourceStatus: envelope.sourceStatus || envelope.status,
        included: envelope.included,
        affectsScore: envelope.affectsScore,
        totals: envelope.totals || null,
        engagementRate: envelope.engagementRate,
        conversionRate: envelope.conversionRate,
        measurementReadiness: envelope.measurementReadiness || null,
        collectedAt: envelope.collectedAt,
        limitations: envelope.note ? [envelope.note] : [],
      },
    };

    if (sourceStatus.errorCategory) {
      sourceResult.errorCategory = sourceStatus.errorCategory;
    }

    return { rawBytes, contentType: rawBytes ? "application/json" : null, sourceResult };
  } catch (error) {
    const completedAt = new Date().toISOString();
    return {
      rawBytes: null,
      contentType: null,
      sourceResult: {
        contractVersion: "1.0.0",
        schemaVersion: "1.0.0",
        source,
        provider: "Google",
        adapterVersion: GA4_ADAPTER_VERSION,
        status: "FAILED",
        startedAt,
        completedAt,
        retryCount: attempt - 1,
        expectedRecords: 0,
        returnedRecords: 0,
        coverage: { requested: 0, completed: 0, failed: 0 },
        limitations: [`GA4 collection failed: ${error.message}`],
        errorCategory: error.category || "internal",
        evidence: {},
      },
    };
  }
}

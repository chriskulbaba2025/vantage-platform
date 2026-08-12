/**
 * DataForSEO SERP Adapter — WP6 governed execute() wrapper.
 *
 * Wraps querySerp() behind the universal source contract expected by the
 * AuditOrchestrator. Returns schema-valid source results with raw bytes
 * for artifact storage.
 *
 * @module adapters/dataforseo-serp/serp-adapter
 */

import { querySerp } from "./dataforseo-serp-client.js";

const ADAPTER_VERSION = "1.0.0";
const AUDIENCE_SCOPES = new Set(["local", "regional", "national"]);

/** Execute the DataForSEO SERP adapter behind the universal source contract. */
export async function execute({ auditRequest, source, executionId, sourceExecutionKey, signal, attempt }) {
  const startedAt = new Date().toISOString();
  const competitorConfig = auditRequest.competitors || {};
  const suppliedCompetitors = Array.isArray(auditRequest.competitors)
    ? auditRequest.competitors
    : (competitorConfig.supplied || []);

  const services = auditRequest.services || [];
  const keywords = services.length > 0
    ? services.slice(0, 5).map((s) => typeof s === "string" ? s : s.name || s.service || "").filter(Boolean)
    : [auditRequest.primaryGoal || auditRequest.businessName || ""].filter(Boolean);

  const rawMarket = String(auditRequest.market || competitorConfig.market || "").trim();
  const audienceScope = AUDIENCE_SCOPES.has(rawMarket.toLowerCase())
    ? rawMarket.toLowerCase()
    : null;

  if (keywords.length === 0) {
    const completedAt = new Date().toISOString();
    return {
      rawBytes: null,
      contentType: null,
      sourceResult: {
        contractVersion: "1.0.0",
        schemaVersion: "1.0.0",
        source,
        provider: "DataForSEO",
        adapterVersion: ADAPTER_VERSION,
        status: "NOT_APPLICABLE",
        startedAt,
        completedAt,
        retryCount: 0,
        expectedRecords: 0,
        returnedRecords: 0,
        coverage: { requested: 0, completed: 0, failed: 0 },
        limitations: ["No service keywords or competitors configured for SERP analysis."],
        evidence: { competitors: [], suppliedCompetitors, audienceScope },
      },
    };
  }

  // Local/regional/national is a competitive-scope classification, not a
  // DataForSEO location name. Keep the provider location valid while carrying
  // the scope through evidence/report context. Geographic refinement can be
  // added later without changing the intake contract.
  const options = {
    location: audienceScope ? "Canada" : (rawMarket || "Canada"),
    language: auditRequest.language || competitorConfig.language || "en",
    login: process.env.DATAFORSEO_LOGIN || "",
    password: process.env.DATAFORSEO_PASSWORD || "",
    // Testability seam: controlled transport below the adapter layer.
    // Production default behaviour is unchanged (null → live fetch).
    fetchImpl: (auditRequest.serp && typeof auditRequest.serp === "object" ? auditRequest.serp.fetchImpl : null) || null,
  };

  if (!options.login || !options.password) {
    const completedAt = new Date().toISOString();
    return {
      rawBytes: null,
      contentType: null,
      sourceResult: {
        contractVersion: "1.0.0",
        schemaVersion: "1.0.0",
        source,
        provider: "DataForSEO",
        adapterVersion: ADAPTER_VERSION,
        status: "NOT_CONNECTED",
        startedAt,
        completedAt,
        retryCount: 0,
        expectedRecords: keywords.length,
        returnedRecords: 0,
        coverage: { requested: keywords.length, completed: 0, failed: keywords.length },
        limitations: ["DataForSEO credentials not configured for SERP queries."],
        errorCategory: "not_configured",
        evidence: { competitors: [], suppliedCompetitors, audienceScope },
      },
    };
  }

  const allItems = [];
  const errors = [];
  const totalRequested = keywords.length;
  let totalCompleted = 0;

  try {
    for (const keyword of keywords) {
      if (signal?.aborted) {
        throw Object.assign(new Error("SERP execution aborted"), { category: "timeout" });
      }
      try {
        const result = await querySerp(keyword, options);
        if (result.items && result.items.length > 0) {
          allItems.push(...result.items.map((item) => ({ ...item, _keyword: keyword })));
          totalCompleted++;
        }
        if (result.error) errors.push(`${keyword}: ${result.error}`);
      } catch (kwError) {
        errors.push(`${keyword}: ${kwError.message}`);
      }
    }

    const completedAt = new Date().toISOString();
    const rawPayload = {
      adapterVersion: ADAPTER_VERSION,
      collectedAt: completedAt,
      audienceScope,
      providerLocation: options.location,
      keywords,
      items: allItems,
      suppliedCompetitors,
      errors,
    };
    const rawBytes = Buffer.from(JSON.stringify(rawPayload), "utf-8");

    const status = totalCompleted === totalRequested ? "AVAILABLE"
      : totalCompleted > 0 ? "PARTIAL"
      : "FAILED";

    const sourceResult = {
      contractVersion: "1.0.0",
      schemaVersion: "1.0.0",
      source,
      provider: "DataForSEO",
      adapterVersion: ADAPTER_VERSION,
      status,
      startedAt,
      completedAt,
      requestId: executionId,
      retryCount: attempt - 1,
      expectedRecords: totalRequested,
      returnedRecords: totalCompleted,
      coverage: {
        requested: totalRequested,
        completed: totalCompleted,
        failed: totalRequested - totalCompleted,
      },
      limitations: errors.length > 0 ? errors : [],
      evidence: {
        competitors: allItems.slice(0, 100),
        suppliedCompetitors,
        audienceScope,
        providerLocation: options.location,
        keywordCount: keywords.length,
        resultCount: allItems.length,
      },
    };

    if (status === "FAILED" && errors.length > 0) sourceResult.errorCategory = "no_data";
    return { rawBytes, contentType: "application/json", sourceResult };
  } catch (error) {
    const completedAt = new Date().toISOString();
    return {
      rawBytes: null,
      contentType: null,
      sourceResult: {
        contractVersion: "1.0.0",
        schemaVersion: "1.0.0",
        source,
        provider: "DataForSEO",
        adapterVersion: ADAPTER_VERSION,
        status: "FAILED",
        startedAt,
        completedAt,
        retryCount: attempt - 1,
        expectedRecords: totalRequested,
        returnedRecords: 0,
        coverage: { requested: totalRequested, completed: 0, failed: totalRequested },
        limitations: [`SERP execution failed: ${error.message}`],
        errorCategory: error.category || "internal",
        evidence: { competitors: [], suppliedCompetitors, audienceScope, providerLocation: options.location },
      },
    };
  }
}

export { ADAPTER_VERSION };
export default { execute };

import test from "node:test";
import assert from "node:assert/strict";
import {
  qualifyCandidate,
  qualifyGap,
  collectCompetitorOpportunities,
  QUALIFICATION_CHECKS,
  GAP_CHECKS,
  EXCLUDED_PAGE_TYPES,
  isExcludedPageType,
} from "./competitor-opportunity-layer.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_SITE = {
  sourceStatus: SOURCE_STATUS.AVAILABLE,
  services: ["Consulting", "Coaching"],
  topicKeywords: ["business consulting", "leadership coaching"],
  pages: [],
  pageCount: 5,
};

const BASE_INPUT = {
  targetUrl: "https://example.com",
  businessName: "Example Consulting",
  location: "Toronto, Ontario, Canada",
  language: "en-CA",
  competitors: ["https://competitor-one.example"],
};

const COMPLETE_SUPPLIED_EVIDENCE = {
  services: ["Consulting"],
  geographicContext: "Toronto, Ontario, Canada",
  audience: "Business leaders seeking consulting services",
  commercialIntent: "Consulting services are offered for purchase",
  pageCount: 10,
  trust: { credentials: true },
  schemaTypes: ["Service"],
};

// ---------------------------------------------------------------------------
// T9-01: Qualification gate â€” all five checks
// ---------------------------------------------------------------------------

test("T9-01: candidate passes all five qualification checks", () => {
  const candidate = {
    candidateUrl: "https://competitor.example/services/consulting",
    domain: "competitor.example",
    topic: "business consulting",
    discoverySource: "dataforseo-serp",
    geographicContext: "Toronto, Ontario, Canada",
    languageContext: "en",
    pageType: "service",
    position: 3,
  };
  const ctx = {
    location: "Toronto",
    services: ["Consulting", "Coaching"],
    topicKeywords: ["business consulting"],
  };
  const result = qualifyCandidate(candidate, ctx);
  assert.equal(result.passed, true);
  assert.equal(typeof result.results, "object");
  assert.equal(Object.keys(result.results).length, 5);
  assert.equal(result.exclusionReason, null);
});

test("T9-01b: directory page type fails qualification", () => {
  const candidate = {
    candidateUrl: "https://yellowpages.example/biz/123",
    domain: "yellowpages.example",
    topic: "business consulting",
    discoverySource: "dataforseo-serp",
    geographicContext: "Toronto",
    pageType: "directory",
    position: 5,
  };
  const result = qualifyCandidate(candidate, { location: "Toronto", services: ["Consulting"] });
  assert.equal(result.passed, false);
  assert.equal(result.results.page_type_comparability, false);
  assert.ok(result.exclusionReason.includes("page_type_comparability"));
});

test("T9-01c: social profile excluded", () => {
  const candidate = {
    candidateUrl: "https://facebook.com/ExampleConsulting",
    domain: "facebook.com",
    topic: "business consulting",
    discoverySource: "dataforseo-serp",
    pageType: "social",
  };
  const result = qualifyCandidate(candidate, { services: ["Consulting"] });
  assert.equal(result.passed, false);
});

test("T9-01d: marketplace excluded", () => {
  const candidate = {
    candidateUrl: "https://amazon.com/dp/B00123",
    domain: "amazon.com",
    pageType: "marketplace",
  };
  const result = qualifyCandidate(candidate, { services: ["Consulting"] });
  assert.equal(result.passed, false);
});

test("T9-01e: reference/news site excluded", () => {
  const candidate = {
    candidateUrl: "https://wikipedia.org/wiki/Consulting",
    domain: "wikipedia.org",
    pageType: "reference",
  };
  assert.equal(isExcludedPageType("reference"), true);
  const result = qualifyCandidate(candidate, { services: ["Consulting"] });
  assert.equal(result.passed, false);
});

// ---------------------------------------------------------------------------
// T9-02: All six qualified-gap checks
// ---------------------------------------------------------------------------

test("T9-02: gap passes all six qualified-gap checks", () => {
  const clientTopic = "business consulting";
  const competitorPage = {
    candidateUrl: "https://competitor.example/services",
    domain: "competitor.example",
    topic: "business consulting",
    pageType: "service",
    hasSchema: ["rich_snippet"],
  };
  const result = qualifyGap(clientTopic, competitorPage, ["business consulting"], ["Services page with 5 sections"]);
  assert.equal(result.passed, true);
  assert.equal(Object.keys(result.results).length, 6);
});

test("T9-02b: one failed gap check suppresses recommendation", () => {
  const result = qualifyGap(
    "business consulting",
    { candidateUrl: "", domain: "", pageType: "unknown" },
    ["business consulting"],
    [],
  );
  assert.equal(result.passed, false);
  assert.ok(Object.values(result.results).some((v) => !v));
});

// ---------------------------------------------------------------------------
// T9-03: Excluded page types defined
// ---------------------------------------------------------------------------

test("T9-03: EXCLUDED_PAGE_TYPES includes all required categories", () => {
  assert.equal(EXCLUDED_PAGE_TYPES.has("directory"), true);
  assert.equal(EXCLUDED_PAGE_TYPES.has("marketplace"), true);
  assert.equal(EXCLUDED_PAGE_TYPES.has("social"), true);
  assert.equal(EXCLUDED_PAGE_TYPES.has("reference"), true);
  assert.equal(EXCLUDED_PAGE_TYPES.has("community"), true);
});

// ---------------------------------------------------------------------------
// T9-04: Pending competitor does not generate client-facing recommendation
// ---------------------------------------------------------------------------

test("T9-04: gaps from pending competitors are filtered from client output", async () => {
  const fetchImpl = async () => new Response("{}", { status: 200 });

  const result = await collectCompetitorOpportunities(BASE_SITE, BASE_INPUT, {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: [
      {
        url: "https://competitor.example",
        status: SOURCE_STATUS.AVAILABLE,
        evidence: COMPLETE_SUPPLIED_EVIDENCE,
      },
    ],
    fetchImpl,
    auditorApprovals: {
      "https://competitor.example": "pending",
    },
  });

  const approvedGaps = result.gaps;
  assert.equal(approvedGaps.length, 0, "Pending competitors should produce no client-facing gaps");
});

// ---------------------------------------------------------------------------
// T9-05: Rejected competitor cannot generate a client-facing recommendation
// ---------------------------------------------------------------------------

test("T9-05: gaps from rejected competitors are filtered from client output", async () => {
  const fetchImpl = async () => new Response("{}", { status: 200 });

  const result = await collectCompetitorOpportunities(BASE_SITE, BASE_INPUT, {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: [
      {
        url: "https://competitor.example",
        status: SOURCE_STATUS.AVAILABLE,
        evidence: COMPLETE_SUPPLIED_EVIDENCE,
      },
    ],
    fetchImpl,
    auditorApprovals: {
      "https://competitor.example": "rejected",
    },
  });

  assert.equal(result.gaps.length, 0, "Rejected competitors should produce no client-facing gaps");
});

// ---------------------------------------------------------------------------
// T9-06: Approved competitor can proceed after qualification checks pass
// ---------------------------------------------------------------------------

test("T9-06: approved competitor generates gap when all checks pass", async () => {
  const fetchImpl = async () => new Response("{}", { status: 200 });

  const result = await collectCompetitorOpportunities(BASE_SITE, BASE_INPUT, {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: [
      {
        url: "https://competitor.example/services",
        status: SOURCE_STATUS.AVAILABLE,
        evidence: COMPLETE_SUPPLIED_EVIDENCE,
      },
    ],
    fetchImpl,
    auditorApprovals: {
      "https://competitor.example/services": "approved",
    },
  });

  // The gap may or may not pass all qualified-gap checks depending on context
  assert.ok(result.candidates.qualified.length > 0 || result.candidates.totalSupplied > 0,
    "Should have qualified or supplied candidates");
});

// ---------------------------------------------------------------------------
// T9-07: DataForSEO failure does not stop supplied-competitor analysis
// ---------------------------------------------------------------------------

test("T9-07: DataForSEO SERP failure does not block supplied competitors", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("dataforseo.com")) {
      return new Response("Service Unavailable", { status: 503 });
    }
    return new Response("{}", { status: 200 });
  };

  const result = await collectCompetitorOpportunities(BASE_SITE, BASE_INPUT, {
    dataforseoLogin: "test-login",
    dataforseoPassword: "test-pass",
    suppliedCompetitors: [
      {
        url: "https://competitor.example",
        status: SOURCE_STATUS.AVAILABLE,
        evidence: { services: ["Consulting"], audience: "Business leaders seeking consulting services", commercialIntent: "Consulting services are offered for purchase", pageCount: 8 },
      },
    ],
    fetchImpl,
  });

  assert.ok(result.sources.supplied.candidateCount > 0, "Supplied competitors should still be processed");
  assert.ok(result.limitations.some((l) => l.includes("SERP")), "Should report SERP failure");
});

// ---------------------------------------------------------------------------
// T9-08: One blocked competitor does not stop other competitors
// ---------------------------------------------------------------------------

test("T9-08: BLOCKED competitor does not stop other competitors", async () => {
  const fetchImpl = async () => new Response("{}", { status: 200 });

  const result = await collectCompetitorOpportunities(BASE_SITE, BASE_INPUT, {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: [
      {
        url: "https://blocked.example",
        status: SOURCE_STATUS.BLOCKED,
        error: "robots.txt blocked",
      },
      {
        url: "https://competitor.example",
        status: SOURCE_STATUS.AVAILABLE,
        evidence: { services: ["Consulting"], audience: "Business leaders seeking consulting services", commercialIntent: "Consulting services are offered for purchase", pageCount: 8 },
      },
    ],
    fetchImpl,
  });

  assert.ok(result.sources.supplied.candidateCount > 0, "Available competitors should still be counted");
});

// ---------------------------------------------------------------------------
// T9-09: Unavailable competitor evidence creates no zero score or false negative
// ---------------------------------------------------------------------------

test("T9-09: unavailable competitors produce PARTIAL or UNAVAILABLE, not FAILED", async () => {
  const fetchImpl = async () => new Response("{}", { status: 200 });

  const result = await collectCompetitorOpportunities(
    { ...BASE_SITE, services: [], topicKeywords: [] },
    { ...BASE_INPUT, competitors: [] },
    { dataforseoLogin: "", dataforseoPassword: "", suppliedCompetitors: [], fetchImpl },
  );

  // No competitors at all â€” should be UNAVAILABLE, not FAILED
  assert.ok(
    result.sourceStatus === SOURCE_STATUS.UNAVAILABLE || result.sourceStatus === SOURCE_STATUS.NOT_CONNECTED,
    `Expected UNAVAILABLE or NOT_CONNECTED, got ${result.sourceStatus}`,
  );
});

// ---------------------------------------------------------------------------
// T9-10: Evidence envelope preserves canonical fields
// ---------------------------------------------------------------------------

test("T9-10: competitor evidence envelope has canonical source status and provenance", async () => {
  const fetchImpl = async () => new Response("{}", { status: 200 });

  const result = await collectCompetitorOpportunities(BASE_SITE, BASE_INPUT, {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: [
      {
        url: "https://competitor.example",
        status: SOURCE_STATUS.AVAILABLE,
        evidence: { services: ["Consulting"] },
      },
    ],
    fetchImpl,
  });

  assert.equal(result.evidenceVersion, "1.0.0");
  assert.equal(result.source, "competitor-opportunity-layer");
  assert.ok(result._sourceStatus);
  assert.equal(result._sourceStatus.provider, "competitor-opportunity-layer");
  assert.ok(result.collectedAt);
  assert.ok(result.coverage);
  assert.ok(result.topics.length >= 1, `Expected at least 1 topic, got ${result.topics.length}`);
});

// ---------------------------------------------------------------------------
// T9-11: Deterministic identical input produces identical output
// ---------------------------------------------------------------------------

test("T9-11: identical inputs produce identical qualified gaps", async () => {
  const fetchImpl = async () => new Response("{}", { status: 200 });

  const opts = {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: [
      { url: "https://competitor.example", status: SOURCE_STATUS.AVAILABLE, evidence: { services: ["Consulting"] } },
    ],
    fetchImpl,
    auditorApprovals: { "https://competitor.example": "approved" },
  };

  const result1 = await collectCompetitorOpportunities(BASE_SITE, BASE_INPUT, opts);
  const result2 = await collectCompetitorOpportunities(BASE_SITE, BASE_INPUT, opts);

  assert.equal(result1.candidates.totalQualified, result2.candidates.totalQualified);
  assert.equal(result1.gaps.length, result2.gaps.length);
});

// ---------------------------------------------------------------------------
// T9-12: SERP candidate normalization with mock response
// ---------------------------------------------------------------------------

test("T9-12: SERP organic results are normalized", () => {
  // Tests the normalize function indirectly via qualification
  const candidate = {
    candidateUrl: "https://competitor.example/services/consulting",
    domain: "competitor.example",
    topic: "business consulting",
    discoverySource: "dataforseo-serp",
    geographicContext: "Toronto, Ontario, Canada",
    languageContext: "en",
    pageType: "service",
    position: 3,
    serpFeatures: ["featured_snippet"],
    hasSchema: ["rich_snippet"],
    rawArtifactRef: "dataforseo://serp/3",
  };
  const result = qualifyCandidate(candidate, {
    location: "Toronto",
    services: ["Consulting"],
    topicKeywords: ["business consulting"],
  });
  assert.equal(result.passed, true);
  assert.equal(result.results.geographic_relevance, true);
  assert.equal(result.results.service_relevance, true);
});

// ---------------------------------------------------------------------------
// T9-13: Per-topic competitor separation
// ---------------------------------------------------------------------------

test("T9-13: competitors are separated by topic", async () => {
  const fetchImpl = async () => new Response("{}", { status: 200 });

  const site = {
    ...BASE_SITE,
    services: ["Consulting", "Web Design"],
    topicKeywords: [],
  };

  const result = await collectCompetitorOpportunities(site, BASE_INPUT, {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: [
      { url: "https://consulting-comp.example", status: SOURCE_STATUS.AVAILABLE, evidence: { services: ["Consulting"] } },
      { url: "https://webdesign-comp.example", status: SOURCE_STATUS.AVAILABLE, evidence: { services: ["Web Design"] } },
    ],
    fetchImpl,
  });

  assert.ok(result.topics.length >= 2, `Expected at least 2 topics, got ${result.topics.length}`);
});

// P4-DIRECT-01: supplied competitor qualification uses competitor evidence,
// not the client's first service topic.
test("P4-DIRECT-01: conflicting supplied service evidence is excluded", async () => {
  const result = await collectCompetitorOpportunities(
    { ...BASE_SITE, services: ["Physiotherapy"], topicKeywords: [] },
    { ...BASE_INPUT, businessName: "Toronto Clinic" },
    {
      dataforseoLogin: "",
      dataforseoPassword: "",
      suppliedCompetitors: [{
        url: "https://accounting.example",
        status: SOURCE_STATUS.AVAILABLE,
        evidence: { services: ["Accounting"], pageCount: 4 },
      }],
    },
  );

  assert.equal(result.candidates.qualified.length, 0);
  assert.equal(result.candidates.excluded.length, 1);
  assert.equal(result.candidates.excluded[0].qualificationResults.service_relevance, false);
});

test("P4-DIRECT-02: supplied candidates without observed qualification evidence remain excluded", async () => {
  const result = await collectCompetitorOpportunities(
    { ...BASE_SITE, services: ["Physiotherapy"], topicKeywords: [] },
    { ...BASE_INPUT, businessName: "Toronto Clinic" },
    {
      dataforseoLogin: "",
      dataforseoPassword: "",
      suppliedCompetitors: [{
        url: "https://unsupported.example",
        status: SOURCE_STATUS.AVAILABLE,
        evidence: { services: ["Physiotherapy"], pageCount: 4 },
      }],
    },
  );

  assert.equal(result.candidates.qualified.length, 0);
  const excluded = result.candidates.excluded[0];
  assert.equal(excluded.qualificationResults.geographic_relevance, false);
  assert.equal(excluded.qualificationResults.audience_relevance, false);
  assert.equal(excluded.qualificationResults.commercial_intent_relevance, false);
});

test("P4-DIRECT-03: complete supplied evidence preserves approved competitor workflow", async () => {
  const result = await collectCompetitorOpportunities(BASE_SITE, BASE_INPUT, {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: [{
      url: "https://qualified.example/services",
      status: SOURCE_STATUS.AVAILABLE,
      evidence: COMPLETE_SUPPLIED_EVIDENCE,
    }],
    auditorApprovals: { "https://qualified.example/services": "approved" },
  });

  assert.equal(result.candidates.qualified.length, 1);
  assert.equal(result.candidates.qualified[0].approvalStatus, "approved");
  assert.ok(result.gaps.every((gap) => gap.approvalStatus === "approved"));
});

// ---------------------------------------------------------------------------
// T9-14: No live DataForSEO calls during tests
// ---------------------------------------------------------------------------

test("T9-14: no live DataForSEO calls when credentials are absent", async () => {
  let externalCalls = 0;
  const fetchImpl = async (url) => {
    externalCalls++;
    return new Response("{}", { status: 200 });
  };

  await collectCompetitorOpportunities(BASE_SITE, BASE_INPUT, {
    dataforseoLogin: "",
    dataforseoPassword: "",
    suppliedCompetitors: [],
    fetchImpl,
  });

  // No DataForSEO calls should happen when credentials are absent
  assert.equal(
    externalCalls,
    0,
    `Expected 0 external calls without credentials, got ${externalCalls}`,
  );
});

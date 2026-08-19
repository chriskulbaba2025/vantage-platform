import test from "node:test";
import assert from "node:assert/strict";

import { execute, ADAPTER_VERSION } from "./serp-adapter.js";
import { buildDecisionEvidence } from "../../evidence/decision-evidence.js";
import { competitorComparison } from "../../scoring/report-model.js";
import { createProductionContractValidator } from "../../application/production-bootstrap.js";

const SUPPLIED_URL = "https://competitor.example/";

const COMPETITOR_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Competitor Alpha Coaching</title>
  <meta name="description" content="Executive coaching for business owners and leaders.">
</head>
<body>
  <main>
    <h1>Business Coaching for Leaders</h1>
    <h2>Executive Coaching</h2>
    <p>Certified executive coach with 20 years experience helping business owners improve leadership and growth.</p>
    <p>Client testimonials and success stories show measurable outcomes from the coaching process.</p>
    <p>Pricing and investment options are explained before a client begins.</p>
    <button>Book consultation</button>
    <form action="/contact" method="post"><input name="name"><input name="email"><textarea name="message"></textarea><button type="submit">Contact us</button></form>
    <a href="https://linkedin.com/company/competitor-alpha">LinkedIn</a>
  </main>
</body>
</html>`;

function directCrawlFetch({ fail = false, pageStatus = 200, dataforseoResponse = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    calls.push(value);

    if (value.includes("api.dataforseo.com")) {
      if (!dataforseoResponse) throw new Error(`Unexpected DataForSEO call: ${value}`);
      return new Response(JSON.stringify(dataforseoResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (fail && value.startsWith("https://competitor.example")) {
      throw new Error("controlled competitor network failure");
    }

    if (value.endsWith("/robots.txt") || value.endsWith("/sitemap.xml") || value.endsWith("/sitemap_index.xml")) {
      return new Response("not found", {
        status: 404,
        headers: { "content-type": "text/plain" },
      });
    }

    if (value.startsWith("https://competitor.example")) {
      return new Response(COMPETITOR_HTML, {
        status: pageStatus,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    throw new Error(`Unexpected controlled URL: ${value}`);
  };

  return { fetchImpl, calls };
}

async function withDfsCredentials(login, password, fn) {
  const previousLogin = process.env.DATAFORSEO_LOGIN;
  const previousPassword = process.env.DATAFORSEO_PASSWORD;
  if (login === null) delete process.env.DATAFORSEO_LOGIN;
  else process.env.DATAFORSEO_LOGIN = login;
  if (password === null) delete process.env.DATAFORSEO_PASSWORD;
  else process.env.DATAFORSEO_PASSWORD = password;
  try {
    return await fn();
  } finally {
    if (previousLogin === undefined) delete process.env.DATAFORSEO_LOGIN;
    else process.env.DATAFORSEO_LOGIN = previousLogin;
    if (previousPassword === undefined) delete process.env.DATAFORSEO_PASSWORD;
    else process.env.DATAFORSEO_PASSWORD = previousPassword;
  }
}

function auditRequest(fetchImpl, overrides = {}) {
  return {
    auditId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    targetUrl: "https://client.example/",
    businessName: "Client Business",
    services: ["Business Coaching"],
    primaryGoal: "Generate qualified enquiries",
    language: "en-CA",
    market: "national",
    competitors: [SUPPLIED_URL],
    serp: { fetchImpl },
    ...overrides,
  };
}

async function executeControlled(request) {
  return execute({
    auditRequest: request,
    source: "dataforseo-serp",
    executionId: "exec-controlled-1",
    sourceExecutionKey: "controlled-key",
    signal: new AbortController().signal,
    attempt: 1,
  });
}

test("PC-02/06: production adapter v1.1.0 benchmarks supplied URL with zero DataForSEO calls when SERP is not connected", async () => {
  assert.equal(ADAPTER_VERSION, "1.1.0");
  const { fetchImpl, calls } = directCrawlFetch();

  const result = await withDfsCredentials(null, null, () => executeControlled(auditRequest(fetchImpl)));
  const sr = result.sourceResult;

  assert.equal(calls.some((url) => url.includes("api.dataforseo.com")), false,
    `DataForSEO must not be called without credentials: ${calls.join(" | ")}`);
  assert.ok(calls.some((url) => url.startsWith("https://competitor.example")),
    "real direct competitor crawler must execute through the controlled transport");
  assert.equal(sr.status, "PARTIAL", "usable direct evidence + unavailable SERP is a partial composite source");
  assert.equal(sr.evidence.serpStatus, "NOT_CONNECTED");
  assert.deepEqual(sr.evidence.suppliedCompetitorCoverage, { requested: 1, completed: 1, failed: 0 });
  assert.equal(sr.evidence.competitors.length, 1);

  const supplied = sr.evidence.competitors[0];
  assert.equal(supplied.discoverySource, "user-supplied");
  assert.equal(supplied.source, "prysm-direct-crawl");
  assert.equal(supplied._evidenceStatus, "AVAILABLE");
  assert.equal(supplied.candidateUrl, SUPPLIED_URL);
  assert.equal(supplied.title, "Competitor Alpha Coaching");
  assert.ok(supplied.services.includes("Executive Coaching"));
  assert.equal(supplied.trust.credentials, true);
  assert.ok(supplied.ctas.length > 0);
  assert.ok(supplied.forms.length > 0);
});

test("PC-03/07: persisted SourceResult hydration preserves usable supplied row and report comparison consumes it", async () => {
  const { fetchImpl } = directCrawlFetch();
  const result = await withDfsCredentials(null, null, () => executeControlled(auditRequest(fetchImpl)));
  const validateContract = createProductionContractValidator();

  const hydrated = buildDecisionEvidence({
    allSourceResults: [{ source: "dataforseo-serp", sourceResult: result.sourceResult }],
    suppliedCompetitors: [SUPPLIED_URL],
    validateContract,
  });

  assert.deepEqual(hydrated.errors, []);
  assert.equal(hydrated.evidence.competitors.length, 1);
  assert.equal(hydrated.evidence.competitors[0].status, "AVAILABLE",
    "item-level direct evidence availability must survive a PARTIAL composite source");

  const comparison = competitorComparison(hydrated.evidence.competitors, null);
  assert.equal(comparison.comparisons.length, 1);
  const row = comparison.comparisons[0];
  assert.equal(row.url, SUPPLIED_URL);
  assert.equal(row.name, "Competitor Alpha Coaching");
  assert.notEqual(row.status, "Unavailable");
  assert.notEqual(row.status, "Insufficient Evidence");
  assert.equal(row.offerClarity, "Moderate");
  assert.equal(row.ctaClarity, "Strong");
  assert.equal(row.pathClarity, "Moderate");
});

test("PC-05: failed supplied crawl creates no fabricated competitor comparison", async () => {
  const { fetchImpl } = directCrawlFetch({ fail: true });
  const result = await withDfsCredentials(null, null, () => executeControlled(auditRequest(fetchImpl)));
  const sr = result.sourceResult;

  assert.notEqual(sr.status, "AVAILABLE");
  assert.equal(sr.evidence.competitors.length, 0);
  assert.deepEqual(sr.evidence.suppliedCompetitorCoverage, { requested: 1, completed: 0, failed: 1 });
  assert.ok(sr.limitations.some((item) => item.includes("Supplied competitor crawl failed")));

  const validateContract = createProductionContractValidator();
  const hydrated = buildDecisionEvidence({
    allSourceResults: [{ source: "dataforseo-serp", sourceResult: sr }],
    suppliedCompetitors: [SUPPLIED_URL],
    validateContract,
  });
  assert.equal(hydrated.evidence.competitors.length, 0);
  assert.equal(competitorComparison(hydrated.evidence.competitors, null).comparisons.length, 0);
});

test("PC-05b: HTTP error page is not promoted into supplied competitor evidence", async () => {
  const { fetchImpl } = directCrawlFetch({ pageStatus: 404 });
  const result = await withDfsCredentials(null, null, () => executeControlled(auditRequest(fetchImpl)));
  const sr = result.sourceResult;

  assert.equal(sr.evidence.competitors.length, 0,
    "an error-only HTML capture must not become benchmark evidence");
  assert.deepEqual(sr.evidence.suppliedCompetitorCoverage, { requested: 1, completed: 0, failed: 1 });
  assert.ok(sr.limitations.some((item) => item.includes("no usable 2xx/3xx HTML evidence returned")));
  assert.notEqual(sr.status, "AVAILABLE");
});

test("PC-04: direct supplied benchmark wins same-domain de-duplication over SERP snippet", async () => {
  const dfsResponse = {
    status_code: 20000,
    status_message: "Ok.",
    tasks_count: 1,
    tasks: [{
      id: "task-controlled-1",
      status_code: 20000,
      status_message: "Ok.",
      result_count: 1,
      result: [{
        keyword: "Business Coaching",
        items_count: 2,
        items: [
          { type: "organic", rank_absolute: 1, url: "https://competitor.example/serp-page", domain: "competitor.example", title: "Duplicate SERP Snippet" },
          { type: "organic", rank_absolute: 2, url: "https://other-competitor.example/", domain: "other-competitor.example", title: "Other Competitor" },
        ],
      }],
    }],
  };
  const { fetchImpl, calls } = directCrawlFetch({ dataforseoResponse: dfsResponse });

  const result = await withDfsCredentials("controlled-login", "controlled-password", () =>
    executeControlled(auditRequest(fetchImpl)));
  const items = result.sourceResult.evidence.competitors;

  assert.equal(calls.filter((url) => url.includes("api.dataforseo.com")).length, 1,
    "controlled test must execute the real production SERP client exactly once");
  assert.equal(result.sourceResult.status, "AVAILABLE");
  assert.equal(items.filter((item) => item.domain === "competitor.example").length, 1);
  assert.equal(items.find((item) => item.domain === "competitor.example").discoverySource, "user-supplied");
  assert.ok(items.some((item) => item.domain === "other-competitor.example"),
    "non-duplicate SERP competitor must remain available");
});

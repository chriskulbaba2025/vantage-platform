import test from "node:test";
import assert from "node:assert/strict";
import { collectDataForSeoEnrichment } from "./dataforseo-enrichment-client.js";

function ok(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("collectDataForSeoEnrichment collects business, maps, and Labs evidence", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const task = { id: "t1", status_code: 20000, status_message: "Ok.", cost: 0.01 };

    if (url.includes("/business_data/google/my_business_info/live")) {
      return ok({ status_code: 20000, tasks: [{ ...task, result: [{ items: [{
        type: "google_business_info",
        title: "Example Co",
        url: "https://example.com/",
        category: "Consultant",
        cid: "123",
        rating: { value: 4.8, votes_count: 42 },
        address: "1 Main St",
      }] }] }] });
    }
    if (url.includes("/serp/google/maps/live/advanced")) {
      return ok({ status_code: 20000, tasks: [{ ...task, result: [{ items: [{
        title: "Example Co",
        rank_absolute: 2,
        rating: { value: 4.7, votes_count: 40 },
      }] }] }] });
    }
    if (url.includes("/domain_rank_overview/live")) {
      return ok({ status_code: 20000, tasks: [{ ...task, result: [{
        target: "example.com",
        location_code: 2124,
        language_code: "en",
        metrics: { organic: { count: 10 } },
      }] }] });
    }
    if (url.includes("/competitors_domain/live")) {
      return ok({ status_code: 20000, tasks: [{ ...task, result: [{ items: [{
        domain: "competitor.example",
        avg_position: 8.2,
        intersections: 12,
        metrics: { organic: { count: 30 } },
      }] }] }] });
    }
    throw new Error("unexpected endpoint " + url);
  };

  const result = await collectDataForSeoEnrichment({
    targetUrl: "https://example.com",
    businessName: "Example Co",
    market: "London, Ontario, Canada",
    language: "en-CA",
    keywords: ["consulting"],
    login: "login",
    password: "password",
    fetchImpl,
  });

  assert.equal(result.businessProfile.title, "Example Co");
  assert.equal(result.businessProfile.rating, 4.8);
  assert.equal(result.businessProfile.reviewsCount, 42);
  assert.equal(result.localMaps[0].rank, 2);
  assert.equal(result.labs.domainRank.target, "example.com");
  assert.equal(result.labs.competitors[0].domain, "competitor.example");
  assert.equal(result.limitations.length, 0);
  assert.equal(calls.length, 4);

  const labsBodies = calls
    .filter((call) => call.url.includes("/dataforseo_labs/"))
    .map((call) => JSON.parse(call.init.body)[0]);
  assert.ok(labsBodies.every((body) => body.location_name === "Canada"));
});

test("collectDataForSeoEnrichment withholds an unmatched business profile", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("my_business_info")) {
      return ok({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [{
        title: "Other Company",
        url: "https://other.example/",
      }] }] }] });
    }
    return ok({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [] }] }] });
  };

  const result = await collectDataForSeoEnrichment({
    targetUrl: "https://example.com/",
    businessName: "Other Company",
    market: "Canada",
    language: "en-CA",
    keywords: ["consulting"],
    login: "login",
    password: "password",
    fetchImpl,
  });

  assert.equal(result.businessProfile, null);
  assert.equal(result.unmatchedBusinessProfile.identityStatus, "UNRESOLVED");
  assert.ok(result.limitations.some((item) => item.includes("withheld")));
});

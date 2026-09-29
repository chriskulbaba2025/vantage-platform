import test from "node:test";
import assert from "node:assert/strict";
import { collectBacklinks } from "./backlinks-provider.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

test("collectBacklinks is optional when DataForSEO credentials are absent", async () => {
  const result = await collectBacklinks("https://example.com", [], {});
  assert.equal(result.sourceStatus, SOURCE_STATUS.NOT_CONNECTED);
  assert.equal(result.affectsCoreAudit, false);
  assert.deepEqual(result.records, []);
});

test("collectBacklinks uses live DataForSEO target payloads and finds competitor opportunities", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const tasks = JSON.parse(init.body);
    calls.push({ url: String(url), tasks });
    const target = tasks[0].target;

    if (String(url).endsWith("/summary/live")) {
      return new Response(JSON.stringify({
        status_code: 20000,
        tasks: [{ status_code: 20000, result: [{ rank: 2000, backlinks: 4, referring_domains: 3, referring_pages: 4, backlinks_spam_score: 8, target_spam_score: 4 }] }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (String(url).endsWith("/history/live")) {
      return new Response(JSON.stringify({
        status_code: 20000,
        tasks: [{ status_code: 20000, result: [{
          date_from: "2025-01-01",
          date_to: "2025-12-31",
          items: Array.from({ length: 12 }, (_, index) => ({
            date: `2025-${String(index + 1).padStart(2, "0")}-28`,
            backlinks: index,
            referring_domains: index,
            referring_pages: index,
          })),
        }] }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    const items = target === "example.com"
      ? [{ page_from: "https://authority.example/article", domain_from: "authority.example", page_to: "https://example.com/", anchor: "stress recovery services", semantic_location: "article", domain_from_rank: 800, backlinks_spam_score: 5, external_links_count: 12 }]
      : [{ page_from: "https://opportunity.example/resources", domain_from: "opportunity.example", page_to: `https://${target}/`, anchor: "stress recovery coaching", semantic_location: "article", domain_from_rank: 900, backlinks_spam_score: 3, external_links_count: 10 }];

    return new Response(JSON.stringify({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ items }] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await collectBacklinks(
    "https://example.com",
    ["https://competitor.example"],
    {
      login: "user",
      password: "pass",
      topicKeywords: ["stress", "recovery", "coaching"],
      fetchImpl,
    },
  );

  assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
  assert.equal(result.requestCount, 5);
  assert.equal(result.history.status, SOURCE_STATUS.AVAILABLE);
  assert.equal(result.history.coverage.requested, 12);
  assert.equal(result.goodCount, 1);
  assert.equal(result.worthPursuingCount, 1);
  assert.ok(result.topWorthPursuingDomains.some((item) => item.referringDomain === "opportunity.example"));
  assert.ok(calls.every((call) => typeof call.tasks[0].target === "string"));
  assert.ok(calls.some((call) => call.tasks[0].target === "example.com"));
  assert.ok(calls.some((call) => call.tasks[0].target === "competitor.example"));
});


test("zero returned backlink records are UNAVAILABLE, never AVAILABLE", async () => {
  const fetchImpl = async (url) => {
    const result = String(url).endsWith("/summary/live")
      ? [{ rank: null, backlinks: 0, referring_domains: 0, referring_pages: 0 }]
      : [{ items: [] }];
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks: [{ status_code: 20000, result }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await collectBacklinks("https://example.com", [], {
    login: "user", password: "pass", fetchImpl,
  });
  assert.equal(result.sourceStatus, SOURCE_STATUS.UNAVAILABLE);
  assert.equal(result.status, SOURCE_STATUS.UNAVAILABLE);
  assert.equal(result._sourceStatus.errorCategory, "no_data");
});

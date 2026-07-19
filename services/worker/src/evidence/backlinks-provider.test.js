import test from "node:test";
import assert from "node:assert/strict";
import { collectBacklinks } from "./backlinks-provider.js";

test("collectBacklinks is optional when DataForSEO credentials are absent", async () => {
  const result = await collectBacklinks("https://example.com", [], {});
  assert.equal(result.status, "not_configured");
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

  assert.equal(result.status, "complete");
  assert.equal(result.requestCount, 3);
  assert.equal(result.goodCount, 1);
  assert.equal(result.worthPursuingCount, 1);
  assert.ok(result.topWorthPursuingDomains.some((item) => item.referringDomain === "opportunity.example"));
  assert.ok(calls.every((call) => typeof call.tasks[0].target === "string"));
  assert.ok(calls.some((call) => call.tasks[0].target === "example.com"));
  assert.ok(calls.some((call) => call.tasks[0].target === "competitor.example"));
});

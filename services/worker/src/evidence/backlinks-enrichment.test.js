import test from "node:test";
import assert from "node:assert/strict";
import { collectBacklinks } from "./backlinks-provider.js";

function responseFor(url) {
  const task = { status_code: 20000, status_message: "Ok." };
  if (url.endsWith("/summary/live")) {
    return { status_code: 20000, tasks: [{ ...task, result: [{ rank: 80, backlinks: 20, referring_domains: 5 }] }] };
  }
  if (url.endsWith("/backlinks/live")) {
    return { status_code: 20000, tasks: [{ ...task, result: [{ items: [] }] }] };
  }
  if (url.endsWith("/referring_domains/live")) {
    return { status_code: 20000, tasks: [{ ...task, result: [{ items: [{
      domain: "referrer.example",
      rank: 70,
      backlinks: 3,
      referring_pages: 2,
      first_seen: "2026-01-01 00:00:00 +00:00",
    }] }] }] };
  }
  if (url.endsWith("/history/live")) {
    return { status_code: 20000, tasks: [{ ...task, result: [{ items: [{
      date: "2026-08-01 00:00:00 +00:00",
      rank: 75,
      backlinks: 18,
      new_backlinks: 4,
      lost_backlinks: 2,
      referring_domains: 5,
      new_referring_domains: 1,
      lost_referring_domains: 0,
    }] }] }] };
  }
  throw new Error("unexpected " + url);
}

test("collectBacklinks includes referring-domain and history enrichment", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(responseFor(url)), { status: 200 });
  };

  const result = await collectBacklinks("https://example.com", [], {
    login: "login",
    password: "password",
    fetchImpl,
  });

  assert.equal(result.topReferringDomains[0].domain, "referrer.example");
  assert.equal(result.backlinkHistory[0].newBacklinks, 4);
  assert.equal(result.enrichmentLimitations.length, 0);
  assert.equal(result.requestCount, 4);
});

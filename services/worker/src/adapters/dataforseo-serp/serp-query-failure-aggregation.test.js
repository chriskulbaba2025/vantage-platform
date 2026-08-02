import test from "node:test";
import assert from "node:assert/strict";

import {
  collectCompetitorOpportunities,
  deriveSerpStatus,
} from "../../evidence/competitor-opportunity-layer.js";
import { SOURCE_STATUS } from "../../scoring/evidence-contracts.js";

const INPUT = Object.freeze({
  businessName: "Example Co",
  location: "Ottawa and Ontario, Canada",
  language: "en-CA",
});

function siteWithServices(...services) {
  return {
    services,
    topicKeywords: [],
    pages: [{ title: "Example Co" }],
    pageCount: 3,
    domain: "example.com",
    ctas: [],
    forms: [],
    trust: {},
  };
}

function successResponse({ id, keyword, items = [] }) {
  return new Response(JSON.stringify({
    status_code: 20000,
    status_message: "Ok.",
    tasks_count: 1,
    tasks: [{
      id,
      status_code: 20000,
      status_message: "Ok.",
      result_count: 1,
      result: [{
        keyword,
        items_count: items.length,
        items,
      }],
    }],
  }), { status: 200 });
}

function organicItem(domain, rank = 1) {
  return {
    type: "organic",
    rank_absolute: rank,
    url: `https://${domain}/services/consulting`,
    domain,
    title: "Consulting Service",
  };
}

async function collect(site, fetchImpl) {
  return collectCompetitorOpportunities(site, INPUT, {
    dataforseoLogin: "test-login",
    dataforseoPassword: "test-password",
    suppliedCompetitors: [],
    fetchImpl,
  });
}

test("mixed successful and HTTP-failed SERP queries produce PARTIAL", async () => {
  let call = 0;
  const result = await collect(siteWithServices("Consulting", "Training"), async () => {
    call += 1;
    if (call === 1) {
      return successResponse({
        id: "task-success-http-1",
        keyword: "Consulting",
        items: [organicItem("competitor.example")],
      });
    }
    return new Response("upstream unavailable", { status: 503 });
  });

  const source = result.sources.dataforseoSerp;
  assert.equal(source.status, SOURCE_STATUS.PARTIAL);
  assert.equal(source.attemptedCount, 2);
  assert.equal(source.successfulCount, 1);
  assert.equal(source.failedCount, 1);
  assert.equal(source.candidateCount, 1);
  assert.equal(source.queryFailures.length, 1);
  assert.equal(source.queryFailures[0].errorType, "HTTP");
  assert.equal(source.queryFailures[0].statusCode, 503);
  assert.equal(source.taskErrors, undefined);
  assert.equal(result.sourceStatus, SOURCE_STATUS.PARTIAL);
});

test("all top-level API failures produce FAILED rather than UNAVAILABLE", async () => {
  const result = await collect(siteWithServices("Consulting", "Training"), async () => (
    new Response(JSON.stringify({
      status_code: 40100,
      status_message: "Authentication failed",
      tasks: [],
    }), { status: 200 })
  ));

  const source = result.sources.dataforseoSerp;
  assert.equal(source.status, SOURCE_STATUS.FAILED);
  assert.equal(source.successfulCount, 0);
  assert.equal(source.failedCount, 2);
  assert.equal(source.candidateCount, 0);
  assert.equal(source.queryFailures.length, 2);
  assert.ok(source.queryFailures.every((failure) => failure.errorType === "API_RESPONSE"));
  assert.ok(source.queryFailures.every((failure) => failure.statusCode === 40100));
  assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
});

test("transport or parse failures participate in FAILED status", async () => {
  const result = await collect(siteWithServices("Consulting"), async () => {
    throw new Error("socket disconnected");
  });

  const source = result.sources.dataforseoSerp;
  assert.equal(source.status, SOURCE_STATUS.FAILED);
  assert.equal(source.failedCount, 1);
  assert.equal(source.queryFailures[0].errorType, "TRANSPORT_OR_PARSE");
  assert.match(source.queryFailures[0].statusMessage, /socket disconnected/);
});

test("task-level errors remain separately surfaced while successful candidates are preserved", async () => {
  let call = 0;
  const result = await collect(siteWithServices("Consulting", "Training"), async () => {
    call += 1;
    if (call === 1) {
      return successResponse({
        id: "task-success-task-1",
        keyword: "Consulting",
        items: [organicItem("task-success.example")],
      });
    }

    return new Response(JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks_count: 1,
      tasks: [{
        id: "task-failed-40101",
        status_code: 40101,
        status_message: "Internal SE Server Error.",
        result_count: 0,
        result: null,
      }],
    }), { status: 200 });
  });

  const source = result.sources.dataforseoSerp;
  assert.equal(source.status, SOURCE_STATUS.PARTIAL);
  assert.equal(source.candidateCount, 1);
  assert.equal(source.queryFailures.length, 1);
  assert.equal(source.queryFailures[0].errorType, "TASK");
  assert.equal(source.taskErrors.length, 1);
  assert.equal(source.taskErrors[0].taskId, "task-failed-40101");
  assert.equal(source.taskErrors[0].statusCode, 40101);
  assert.match(source.taskErrors[0].statusMessage, /Internal SE Server Error/);
});

test("successful SERP queries with zero organic candidates remain UNAVAILABLE", async () => {
  const result = await collect(siteWithServices("Rare Service"), async () => (
    successResponse({ id: "task-empty", keyword: "Rare Service", items: [] })
  ));

  const source = result.sources.dataforseoSerp;
  assert.equal(source.status, SOURCE_STATUS.UNAVAILABLE);
  assert.equal(source.successfulCount, 1);
  assert.equal(source.failedCount, 0);
  assert.equal(source.candidateCount, 0);
  assert.equal(source.queryFailures, undefined);
});

test("status derivation treats successful-empty plus failed query as PARTIAL", () => {
  assert.equal(deriveSerpStatus({
    hasCredentials: true,
    attemptedCount: 2,
    successfulCount: 1,
    failureCount: 1,
    candidateCount: 0,
  }), SOURCE_STATUS.PARTIAL);
});

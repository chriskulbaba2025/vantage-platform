import test from "node:test";
import assert from "node:assert/strict";

import { competitorBenchmark } from "./sections-conversion.js";

function baseModel(dataforseoSerp) {
  return {
    input: { businessName: "Example Co" },
    evidence: {
      site: {
        domain: "example.com",
        services: ["Consulting"],
        ctas: [],
      },
    },
    competitors: { comparisons: [] },
    competitorOpportunities: {
      gaps: [],
      qualifiedCandidates: [],
      excludedCandidates: [],
      limitations: [],
      sources: {
        supplied: { status: "NOT_APPLICABLE", candidateCount: 0 },
        dataforseoSerp,
      },
    },
    bands: { trust: "Light" },
    scores: {
      contentDepth: 40,
      conversionPathways: 20,
    },
  };
}

test("PARTIAL report uses attempted query count and preserves successful candidates", () => {
  const html = competitorBenchmark(baseModel({
    status: "PARTIAL",
    candidateCount: 18,
    attemptedCount: 3,
    successfulCount: 2,
    failedCount: 1,
    taskIds: ["task-1", "task-2", "task-3"],
    normalizedLanguage: "English",
    normalizedLocation: "Ottawa,Ontario,Canada",
    originalLocation: "Ottawa and Ontario, Canada",
    queryFailures: [{
      topic: "Executive coaching Ottawa and Ontario, Canada",
      errorType: "TASK",
      taskId: "task-3",
      statusCode: 40101,
      statusMessage: "Internal SE Server Error.",
    }],
  }));

  assert.match(html, /collected partial localized competitor evidence/i);
  assert.match(html, /18 candidate\(s\) were preserved from 2 successful query or queries out of 3 attempted/i);
  assert.match(html, /Executive coaching Ottawa and Ontario, Canada/);
  assert.match(html, /code 40101/);
  assert.match(html, /language: English/);
  assert.match(html, /location: Ottawa,Ontario,Canada/);
  assert.doesNotMatch(html, /stack trace|at querySerp|at collectCompetitorOpportunities/i);
});

test("FAILED report surfaces non-task failure category without inventing a task code", () => {
  const html = competitorBenchmark(baseModel({
    status: "FAILED",
    candidateCount: 0,
    attemptedCount: 1,
    successfulCount: 0,
    failedCount: 1,
    normalizedLanguage: "English",
    normalizedLocation: "Ottawa,Ontario,Canada",
    originalLocation: "Ottawa and Ontario, Canada",
    queryFailures: [{
      topic: "Leadership training Ottawa and Ontario, Canada",
      errorType: "HTTP",
      taskId: null,
      statusCode: 503,
      statusMessage: "SERP API 503: upstream unavailable",
    }],
  }));

  assert.match(html, /could not collect localized competitor evidence/i);
  assert.match(html, /Leadership training Ottawa and Ontario, Canada/);
  assert.match(html, /code 503/);
  assert.doesNotMatch(html, /code null/);
});

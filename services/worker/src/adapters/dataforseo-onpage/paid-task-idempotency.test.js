/**
 * C12 — Provider abort and paid-task idempotency (DataForSEO On-Page).
 *
 * Required invariant:
 *   task submitted → provider task ID received → task ID durably persisted
 *   → polling uses same task → recovery uses same task.
 *   A polling timeout must NOT create another paid task.
 *
 * Proves:
 *   - PRYSM-CLOSE-12a: polling timeout preserves the provider task ID in
 *     the FAILED source result (durable task reference)
 *   - PRYSM-CLOSE-12b: resume with a persisted task ID polls the SAME task —
 *     task_post submission count remains exactly 1
 *   - PRYSM-CLOSE-12c: without a resume ID a fresh submission occurs
 *     (task_post count increments — the distinction is explicit)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execute } from "./dataforseo-onpage-adapter.js";
import { randomUUID } from "node:crypto";

function execArgs(overrides = {}) {
  return {
    auditRequest: {
      contractVersion: "1.0.0",
      auditId: randomUUID(),
      tenantId: "t1",
      clientId: "c1",
      idempotencyKey: randomUUID(),
      targetUrl: "https://proof.example.com",
      businessName: "Proof",
      market: "Canada",
      language: "en",
      primaryGoal: "conversion",
      services: ["service-a"],
      crawl: {
        maxPages: 10,
        pollTimeoutMs: 150,
        pollIntervalMs: 20,
        fetchImpl: null,
      },
      ...overrides,
    },
    source: "dataforseo-onpage",
    executionId: randomUUID(),
    sourceExecutionKey: randomUUID(),
    signal: new AbortController().signal,
    attempt: 1,
  };
}

/**
 * Mock DataForSEO transport that counts task_post submissions and can
 * simulate an always-processing task (poll timeout) or a finishing task.
 */
function makeFetch({ taskPostCalls, ready }) {
  return async (url, init) => {
    const urlStr = String(url);

    if (urlStr.includes("task_post")) {
      taskPostCalls.count = (taskPostCalls.count || 0) + 1;
      return new Response(JSON.stringify({
        status_code: 20000,
        tasks: [{ id: `task-${taskPostCalls.count}`, status_code: 20100 }],
      }), { status: 200 });
    }

    if (urlStr.includes("on_page/summary")) {
      return new Response(JSON.stringify({
        status_code: 20000,
        tasks: [{
          id: urlStr.split("/").pop(),
          status_code: 20000,
          result: ready ? [{
            crawl_progress: "finished",
            crawl_status: { pages_crawled: 1, max_crawl_pages: 10 },
            domain_info: { checks: {} },
            page_metrics: { links_internal: 2, checks: {} },
          }] : [{ crawl_progress: "in_progress" }],
        }],
      }), { status: 200 });
    }

    // pages — one valid page so the completed crawl has usable data
    if (urlStr.includes("on_page/pages")) {
      return new Response(JSON.stringify({
        status_code: 20000,
        tasks: [{
          status_code: 20000,
          result: [{
            items: [{
              url: "https://proof.example.com",
              status_code: 200,
              meta: {
                title: "Proof Home",
                description: "Proof description",
                h1: ["Proof Home"],
                word_count: 300,
                content_language: "en",
                generator: "ProofCMS",
              },
              checks: {},
            }],
          }],
        }],
      }), { status: 200 });
    }

    // links, duplicate tags, duplicate content, microdata — empty
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ items: [] }] }],
    }), { status: 200 });
  };
}

// --- 12a: polling timeout preserves the task ID ---
test("PRYSM-CLOSE-12a: polling timeout preserves provider task ID in FAILED result", async () => {
  process.env.DATAFORSEO_LOGIN = "test-user";
  process.env.DATAFORSEO_PASSWORD = "test-pass";
  try {
    const taskPostCalls = { count: 0 };
    const args = execArgs();
    args.auditRequest.crawl.fetchImpl = makeFetch({ taskPostCalls, ready: false });

    const result = await execute(args);

    assert.equal(taskPostCalls.count, 1, "task submitted exactly once");
    assert.equal(result.sourceResult.status, "FAILED", "polling timeout → FAILED");
    assert.equal(result.sourceResult.errorCategory, "timeout", "errorCategory is timeout");
    assert.ok(result.sourceResult.requestId, "requestId (provider task ID) preserved");
    assert.equal(result.sourceResult.requestId, "task-1", "exact provider task ID preserved");
  } finally {
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
  }
});

// --- 12b: resume polls the SAME task — no new submission ---
test("PRYSM-CLOSE-12b: resume with persisted task ID — task_post count remains exactly 1", async () => {
  process.env.DATAFORSEO_LOGIN = "test-user";
  process.env.DATAFORSEO_PASSWORD = "test-pass";
  try {
    const taskPostCalls = { count: 0 };

    // First attempt: task submitted, polling never finishes → timeout
    const firstArgs = execArgs();
    firstArgs.auditRequest.crawl.fetchImpl = makeFetch({ taskPostCalls, ready: false });
    const first = await execute(firstArgs);
    assert.equal(first.sourceResult.status, "FAILED");
    const taskId = first.sourceResult.requestId;
    assert.ok(taskId, "first attempt persisted the task ID");

    // Second attempt: resume with the SAME task ID; the task now finishes
    const secondArgs = execArgs();
    secondArgs.auditRequest.crawl.fetchImpl = makeFetch({ taskPostCalls, ready: true });
    secondArgs.auditRequest.crawl.resumeTaskId = taskId;

    const second = await execute(secondArgs);

    assert.equal(taskPostCalls.count, 1, "task_post called exactly ONCE across both attempts");
    assert.equal(second.sourceResult.requestId, taskId, "resumed the same provider task");
    assert.ok(["AVAILABLE", "PARTIAL"].includes(second.sourceResult.status), `resume completes with usable status (got ${second.sourceResult.status})`);
  } finally {
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
  }
});

// --- 12c: fresh execution without resume ID submits a NEW task ---
test("PRYSM-CLOSE-12c: without resume ID a fresh submission occurs (explicit distinction)", async () => {
  process.env.DATAFORSEO_LOGIN = "test-user";
  process.env.DATAFORSEO_PASSWORD = "test-pass";
  try {
    const taskPostCalls = { count: 0 };

    const firstArgs = execArgs();
    firstArgs.auditRequest.crawl.fetchImpl = makeFetch({ taskPostCalls, ready: false });
    await execute(firstArgs);
    assert.equal(taskPostCalls.count, 1);

    const secondArgs = execArgs();
    secondArgs.auditRequest.crawl.fetchImpl = makeFetch({ taskPostCalls, ready: true });
    // NO resumeTaskId — a fresh submission is expected
    await execute(secondArgs);

    assert.equal(taskPostCalls.count, 2, "no resume hint → new paid task submitted (submission failure path)");
  } finally {
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
  }
});

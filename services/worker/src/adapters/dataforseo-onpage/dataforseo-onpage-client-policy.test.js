import test from "node:test";
import assert from "node:assert/strict";

import {
  ONPAGE_CLIENT_POLICY,
  createDataforseoOnpageClient,
} from "./dataforseo-onpage-client.js";

function withCredentials(fn) {
  return async () => {
    process.env.DATAFORSEO_LOGIN = "test-user";
    process.env.DATAFORSEO_PASSWORD = "test-pass";

    try {
      await fn();
    } finally {
      delete process.env.DATAFORSEO_LOGIN;
      delete process.env.DATAFORSEO_PASSWORD;
    }
  };
}

test(
  "representative On-Page task payload carries the governed acquisition policy",
  withCredentials(async () => {
    const calls = [];

    const priorityUrls = [
      "https://example.com/",
      ...Array.from(
        { length: 25 },
        (_, index) =>
          `https://example.com/locations/city-${index + 1}`,
      ),
      "https://example.com/",
    ];

    const fetchImpl = async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(init.body),
      });

      return new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [{
            id: "task-001",
            status_code: 20100,
            status_message: "Task Created.",
            result: null,
          }],
        }),
        { status: 200 },
      );
    };

    const client = createDataforseoOnpageClient({
      mode: "live",
      fetchImpl,
    });

    const result = await client.taskPost("example.com", {
      maxPages: 500,
      priorityUrls,
      respectSitemap: true,
    });

    assert.equal(result.taskId, "task-001");
    assert.equal(calls.length, 1);

    const payload = calls[0].body[0];

    assert.equal(
      payload.max_crawl_pages,
      250,
      "direct client caller cannot submit more than 250 pages",
    );

    assert.equal(payload.respect_sitemap, true);
    assert.equal(payload.return_despite_timeout, true);
    assert.equal(payload.priority_urls.length, 20);
    assert.equal(
      payload.priority_urls[0],
      "https://example.com/",
    );
    assert.equal(
      new Set(payload.priority_urls).size,
      20,
    );
  }),
);

test(
  "direct task_post calls clamp every crawl request to the governed 250-page maximum",
  withCredentials(async () => {
    const cases = [
      {
        requested: 10,
        expected: 10,
      },
      {
        requested: 250,
        expected: 250,
      },
      {
        requested: 500,
        expected: 250,
      },
      {
        requested: 100000,
        expected: 250,
      },
      {
        requested: undefined,
        expected: 250,
      },
    ];

    for (const testCase of cases) {
      let capturedBody = null;

      const client = createDataforseoOnpageClient({
        mode: "live",
        fetchImpl: async (_url, init) => {
          capturedBody = JSON.parse(init.body);

          return new Response(
            JSON.stringify({
              status_code: 20000,
              tasks: [{
                id: "policy-task",
                status_code: 20100,
                status_message: "Task Created.",
                result: null,
              }],
            }),
            { status: 200 },
          );
        },
      });

      const options = {};

      if (testCase.requested !== undefined) {
        options.maxPages = testCase.requested;
      }

      await client.taskPost(
        "example.com",
        options,
      );

      assert.ok(
        capturedBody,
        "task_post body must be captured",
      );

      assert.equal(
        capturedBody[0].max_crawl_pages,
        testCase.expected,
        `requested ${testCase.requested ?? "default"} must resolve to ${testCase.expected}`,
      );
    }
  }),
);

test(
  "getAllPages cannot retrieve more than the governed 250-page maximum",
  async () => {
    const pages = Array.from(
      { length: 300 },
      (_, index) => ({
        url: `https://example.com/page-${index + 1}`,
      }),
    );

    const client = createDataforseoOnpageClient({
      mode: "fixture",
      fixtures: {
        pages: {
          items: pages,
          total_count: pages.length,
        },
      },
    });

    const result = await client.getAllPages(
      "fixture-task",
      {
        maxPages: 100000,
        pageSize: 100,
      },
    );

    assert.equal(
      result.length,
      250,
      "direct retrieval cannot exceed 250 pages",
    );
  },
);

test(
  "task_post transport failure is not automatically reposted",
  withCredentials(async () => {
    let calls = 0;

    const client = createDataforseoOnpageClient({
      mode: "live",
      fetchImpl: async () => {
        calls += 1;
        throw new Error(
          "simulated transport failure",
        );
      },
    });

    await assert.rejects(
      client.taskPost("example.com"),
      /simulated transport failure/,
    );

    assert.equal(calls, 1);
  }),
);

test(
  "main On-Page client policy governs crawl volume, priority URLs, and polling",
  () => {
    assert.equal(
      ONPAGE_CLIENT_POLICY.pollTimeoutMs,
      30 * 60 * 1000,
    );

    assert.equal(
      ONPAGE_CLIENT_POLICY.maxCrawlPages,
      250,
    );

    assert.equal(
      ONPAGE_CLIENT_POLICY.maxPriorityUrls,
      20,
    );

    assert.equal(
      ONPAGE_CLIENT_POLICY.returnDespiteTimeout,
      true,
    );
  },
);

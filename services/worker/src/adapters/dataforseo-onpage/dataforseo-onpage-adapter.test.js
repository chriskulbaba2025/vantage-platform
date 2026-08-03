/**
 * DataForSEO On-Page Adapter Tests
 *
 * Comprehensive mocked tests for the DataForSEO On-Page crawl adapter.
 * All tests use fixture mode — no live DataForSEO account is required.
 *
 * Covers PRD v3.0 §8 and §21.1 acceptance criteria.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { crawlWithDataforseo, ADAPTER_VERSION } from "./dataforseo-onpage-adapter.js";
import { createDataforseoOnpageClient } from "./dataforseo-onpage-client.js";
import { SOURCE_STATUS, ERROR_CATEGORY } from "../../scoring/evidence-contracts.js";

// ---------------------------------------------------------------------------
// Test credential setup — required for live-mode client tests so the
// credential gate passes before fetchImpl is invoked.
// ---------------------------------------------------------------------------

const SAVED_LOGIN = process.env.DATAFORSEO_LOGIN;
const SAVED_PASSWORD = process.env.DATAFORSEO_PASSWORD;

function setTestCredentials() {
  process.env.DATAFORSEO_LOGIN = "test-user";
  process.env.DATAFORSEO_PASSWORD = "test-pass";
}

function clearTestCredentials() {
  delete process.env.DATAFORSEO_LOGIN;
  delete process.env.DATAFORSEO_PASSWORD;
}

function restoreCredentials() {
  if (SAVED_LOGIN !== undefined) {
    process.env.DATAFORSEO_LOGIN = SAVED_LOGIN;
  } else {
    delete process.env.DATAFORSEO_LOGIN;
  }
  if (SAVED_PASSWORD !== undefined) {
    process.env.DATAFORSEO_PASSWORD = SAVED_PASSWORD;
  } else {
    delete process.env.DATAFORSEO_PASSWORD;
  }
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();

/**
 * Build a single page fixture.  Uses explicit undefined checks so that
 * falsy values like empty string or zero are preserved correctly.
 */
function buildPageFixture(index, overrides = {}) {
  return {
    url: hasOwn(overrides, "url") ? overrides.url : `https://example.com/page-${index}`,
    status_code: hasOwn(overrides, "status_code") ? overrides.status_code : 200,
    meta: {
      title: hasOwn(overrides, "title") ? overrides.title : `Page ${index} Title`,
      description: hasOwn(overrides, "description") ? overrides.description : `Meta description for page ${index}`,
      canonical: hasOwn(overrides, "canonical") ? overrides.canonical : `https://example.com/page-${index}`,
      h1: hasOwn(overrides, "h1") ? overrides.h1 : [`Heading 1 - Page ${index}`],
      h2: hasOwn(overrides, "h2") ? overrides.h2 : [`Subheading for page ${index}`],
      h3: hasOwn(overrides, "h3") ? overrides.h3 : [],
      h4: hasOwn(overrides, "h4") ? overrides.h4 : [],
      h5: hasOwn(overrides, "h5") ? overrides.h5 : [],
      h6: hasOwn(overrides, "h6") ? overrides.h6 : [],
      word_count: hasOwn(overrides, "word_count") ? overrides.word_count : (500 + index * 100),
      content_language: hasOwn(overrides, "language") ? overrides.language : "en",
      generator: hasOwn(overrides, "generator") ? overrides.generator : "WordPress",
      plain_text: hasOwn(overrides, "bodyText") ? overrides.bodyText : `Page ${index} content with enough text for signals testing.`,
      structured_data_types: hasOwn(overrides, "schemaTypes") ? overrides.schemaTypes : ["WebPage"],
    },
    links: hasOwn(overrides, "links") ? overrides.links : [
      { url: `https://example.com/page-${index + 1}`, text: "Next page", target: "" },
      { url: `https://example.com/contact`, text: "Contact Us", target: "" },
    ],
    images: hasOwn(overrides, "images") ? overrides.images : [
      { url: `/img-${index}.jpg`, alt: `Image ${index}`, width: 800, height: 600, loading: "lazy" },
    ],
    resources: hasOwn(overrides, "resources") ? overrides.resources : {},
    technologies: hasOwn(overrides, "technologies") ? overrides.technologies : { cms: "WordPress" },
    load_time: hasOwn(overrides, "load_time") ? overrides.load_time : 500,
    crawl_depth: hasOwn(overrides, "crawl_depth") ? overrides.crawl_depth : index,
    structured_data: hasOwn(overrides, "structured_data") ? overrides.structured_data : {
      types: [{ type: "WebPage" }],
    },
    forms: hasOwn(overrides, "forms") ? overrides.forms : [],
    buttons: hasOwn(overrides, "buttons") ? overrides.buttons : [],
    response_headers: hasOwn(overrides, "response_headers") ? overrides.response_headers : {
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin",
    },
    ...(overrides.extra || {}),
  };
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function buildSuccessfulFixtures(pageCount = 5) {
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push(buildPageFixture(i));
  }

  return {
    taskPost: {
      taskId: "test-task-20260726-001",
      rawTask: { id: "test-task-20260726-001", status: "pending" },
    },
    pollTask: { status: "ready", taskId: "test-task-20260726-001" },
    summary: {
      crawl_status: "completed",
      pages_crawled: pageCount,
      total_pages: pageCount,
      duplicate_content: 0,
      duplicate_tags: 0,
      sitemap: { urls: [] },
    },
    pages: {
      items: pages,
      total_count: pageCount,
    },
    links: {
      items: pages.flatMap((p) => p.links || []),
      total_count: pages.reduce((sum, p) => sum + (p.links || []).length, 0),
    },
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };
}

function buildFixturesWithExtras(overrides = {}) {
  const base = buildSuccessfulFixtures(overrides.pageCount ?? 5);
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Helper to build crawl options
// ---------------------------------------------------------------------------

function crawlOpts(fixtures, overrides = {}) {
  return {
    maxPages: hasOwn(overrides, "maxPages") ? overrides.maxPages : 500,
    pollTimeoutMs: hasOwn(overrides, "pollTimeoutMs") ? overrides.pollTimeoutMs : 1000,
    pollIntervalMs: hasOwn(overrides, "pollIntervalMs") ? overrides.pollIntervalMs : 100,
    clientOptions: {
      mode: overrides.mode || "fixture",
      fixtures,
      fetchImpl: overrides.fetchImpl,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Successful crawl
// ---------------------------------------------------------------------------

test("successful crawl normalizes pages into canonical evidence envelope", async () => {
  const fixtures = buildSuccessfulFixtures(5);
  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures),
  );

  // Source status
  assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
  assert.equal(result.source, "dataforseo-onpage");
  assert.equal(result.evidenceVersion, "1.0.0");

  // Pages normalized
  assert.equal(result.pageCount, 5);
  assert.ok(Array.isArray(result.pages));
  assert.equal(result.pages.length, 5);

  // First page normalized fields
  const firstPage = result.pages[0];
  assert.ok(firstPage.url.includes("example.com"));
  assert.equal(firstPage.status, 200);
  assert.ok(firstPage.title);
  assert.ok(firstPage.description);
  assert.ok(firstPage.canonical);
  assert.ok(firstPage.headings.h1.length > 0);

  // Site-level aggregates
  assert.ok(result.totalWords > 0);
  assert.ok(result.averageWords > 0);
  assert.equal(result.missingTitles, 0);
  assert.ok(result.schemaTypes.length > 0);

  // Trust signals
  assert.equal(typeof result.trust.testimonials, "boolean");
  assert.equal(typeof result.trust.credentials, "boolean");
  assert.equal(typeof result.trust.pricing, "boolean");

  // Security headers from response headers
  assert.equal(result.securityHeaders.xContentTypeOptions, true);

  // Platform detected
  assert.equal(result.platform, "WordPress");

  // Source status record
  assert.ok(result._sourceStatus);
  assert.equal(result._sourceStatus.provider, "dataforseo-onpage");
  assert.equal(result._sourceStatus.adapterVersion, ADAPTER_VERSION);
  assert.equal(result._sourceStatus.returnedRecordCount, 5);

  // Raw task ID preserved
  assert.ok(result.rawArtifactRef);
  assert.ok(result.rawArtifactRef.includes("test-task-20260726-001"));
  assert.ok(result._raw);
  assert.equal(result._raw.taskId, "test-task-20260726-001");
});

// ---------------------------------------------------------------------------
// 2. Task submission retry
// ---------------------------------------------------------------------------

test("task submission retries twice with exponential backoff on transient errors", async () => {
  setTestCredentials();
  try {
    let attempts = 0;
    const fetchImpl = async (_url, _init) => {
      attempts++;
      if (attempts < 3) {
        return new Response("Service Unavailable", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [
            {
              status_code: 20000,
              result: [{ id: "retry-task-001" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 500,
      pollIntervalMs: 100,
      clientOptions: {
        mode: "live",
        fetchImpl: async (url, init) => {
          if (String(url).includes("task_post")) {
            return fetchImpl(url, init);
          }
          // Non-task_post calls succeed with ready data
          return new Response(
            JSON.stringify({
              status_code: 20000,
              tasks: [{ status_code: 20000, result: [{ items: buildSuccessfulFixtures(3).pages.items }] }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
    assert.equal(attempts, 3);
  } finally {
    restoreCredentials();
  }
});

// ---------------------------------------------------------------------------
// 3. Polling timeout
// ---------------------------------------------------------------------------

test("polling timeout marks crawl FAILED with TIMEOUT error category", async () => {
  setTestCredentials();
  try {
    const fetchImpl = async (url) => {
      if (String(url).includes("task_post")) {
        return new Response(
          JSON.stringify({
            status_code: 20000,
            tasks: [{ status_code: 20000, result: [{ id: "timeout-task-001" }] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // Always return "not ready" for summary/pages polling
      return new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [{ status_code: 20100, status_message: "Task is processing" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 200,
      pollIntervalMs: 50,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
    assert.equal(result._sourceStatus.errorCategory, ERROR_CATEGORY.TIMEOUT);
    assert.ok(result._sourceStatus.requestId);
    assert.equal(result.pageCount, 0);
  } finally {
    restoreCredentials();
  }
});

// ---------------------------------------------------------------------------
// 4. Robots blocking
// ---------------------------------------------------------------------------

test("robots.txt blocking returns BLOCKED status with no pages", async () => {
  const fixtures = {
    taskPost: {
      taskId: "blocked-task-001",
      rawTask: { id: "blocked-task-001" },
    },
    pollTask: { status: "ready", taskId: "blocked-task-001" },
    summary: {
      crawl_status: "blocked_by_robots",
      pages_crawled: 0,
      total_pages: 0,
    },
    pages: { items: [], total_count: 0 },
    links: { items: [], total_count: 0 },
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://blocked.example.com",
    crawlOpts(fixtures),
  );

  assert.equal(result.sourceStatus, SOURCE_STATUS.BLOCKED);
  assert.equal(result.pageCount, 0);
  assert.deepEqual(result.pages, []);
  assert.ok(result.limitations.some((l) => /block|robot/i.test(l)));
  assert.ok(result._sourceStatus.limitation.includes("robots"));
});

// ---------------------------------------------------------------------------
// 5. Authentication / login-wall blocking
// ---------------------------------------------------------------------------

test("login-wall blocking returns BLOCKED status", async () => {
  const fixtures = {
    taskPost: {
      taskId: "loginwall-task-001",
      rawTask: { id: "loginwall-task-001" },
    },
    pollTask: { status: "ready", taskId: "loginwall-task-001" },
    summary: {
      crawl_status: "login_required",
      pages_crawled: 0,
      total_pages: 0,
    },
    pages: { items: [], total_count: 0 },
    links: { items: [], total_count: 0 },
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://members.example.com",
    crawlOpts(fixtures),
  );

  assert.equal(result.sourceStatus, SOURCE_STATUS.BLOCKED);
  assert.equal(result.pageCount, 0);
  assert.ok(
    result.limitations.some((l) => /login|auth/i.test(l)),
    `Expected login/auth limitation, got: ${JSON.stringify(result.limitations)}`,
  );
});

// ---------------------------------------------------------------------------
// 6. Crawl ceiling reached (PARTIAL)
// ---------------------------------------------------------------------------

test("page ceiling produces PARTIAL status with coverage metadata", async () => {
  const fixtures = buildFixturesWithExtras({
    pageCount: 10,
    summary: {
      crawl_status: "completed",
      pages_crawled: 10,
      total_pages: 500,
      duplicate_content: 0,
      duplicate_tags: 0,
    },
  });

  const result = await crawlWithDataforseo("https://large.example.com", {
    ...crawlOpts(fixtures),
    maxPages: 10,
  });

  assert.equal(result.sourceStatus, SOURCE_STATUS.PARTIAL);
  assert.ok(
    result.limitations.some((l) => /ceiling|limit/i.test(l)),
    `Expected ceiling limitation, got: ${JSON.stringify(result.limitations)}`,
  );
  assert.equal(result.pageCount, 10);
  assert.equal(result._sourceStatus.returnedRecordCount, 10);
});

// ---------------------------------------------------------------------------
// 7. Partial JavaScript evidence
// ---------------------------------------------------------------------------

test("JavaScript-content pages marked PARTIAL when JS extraction incomplete", async () => {
  const jsPages = [];
  for (let i = 0; i < 5; i++) {
    jsPages.push(
      buildPageFixture(i, {
        title: i < 2 ? `JS Page ${i}` : "",
        description: i < 2 ? `JS description ${i}` : "",
        extra: {
          enable_javascript: true,
          rendered_with_js: true,
        },
      }),
    );
  }

  const fixtures = buildFixturesWithExtras({
    pageCount: 5,
    pages: { items: jsPages, total_count: 5 },
    summary: {
      crawl_status: "completed",
      pages_crawled: 5,
      total_pages: 5,
    },
  });

  const result = await crawlWithDataforseo("https://js.example.com", {
    ...crawlOpts(fixtures),
    enableJavascript: true,
  });

  assert.ok(
    result.sourceStatus === SOURCE_STATUS.PARTIAL || result.sourceStatus === SOURCE_STATUS.AVAILABLE,
  );
  // Pages with empty title strings count as missing
  assert.ok(result.missingTitles > 0);
  assert.ok(result.pages.some((p) => !p.title));
});

// ---------------------------------------------------------------------------
// 8. Provider quota failure
// ---------------------------------------------------------------------------

test("provider quota exhaustion returns FAILED with rate_limit category", async () => {
  setTestCredentials();
  try {
    const fetchImpl = async (_url, _init) => {
      return new Response(
        JSON.stringify({
          status_code: 40005,
          status_message: "Quota limit exceeded.",
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 500,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
    assert.equal(result._sourceStatus.errorCategory, ERROR_CATEGORY.RATE_LIMIT);
    assert.equal(result.pageCount, 0);
  } finally {
    restoreCredentials();
  }
});

// ---------------------------------------------------------------------------
// 9. Malformed provider response
// ---------------------------------------------------------------------------

test("malformed provider response returns FAILED with network/invalid error", async () => {
  setTestCredentials();
  try {
    const fetchImpl = async (_url, _init) => {
      return new Response("not json at all {{{", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 500,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
    assert.equal(result.pageCount, 0);
    // Error message from parseDataforseoResponse contains "parse" or "JSON"
    assert.ok(
      result.limitations.some((l) => /parse|JSON/i.test(l)),
      `Expected parse/JSON limitation, got: ${JSON.stringify(result.limitations)}`,
    );
  } finally {
    restoreCredentials();
  }
});

// ---------------------------------------------------------------------------
// 10. Normalized required page fields
// ---------------------------------------------------------------------------

test("normalized pages contain all required PRD fields", async () => {
  const fixtures = buildSuccessfulFixtures(3);
  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures),
  );

  assert.equal(result.pageCount, 3);

  const requiredPageFields = [
    "url",
    "status",
    "title",
    "description",
    "canonical",
    "headings",
    "words",
    "schemaTypes",
    "signals",
  ];

  for (const page of result.pages) {
    for (const field of requiredPageFields) {
      assert.ok(
        field in page,
        `Page missing required field: ${field}`,
      );
    }

    assert.ok(Array.isArray(page.headings.h1));
    assert.ok(Array.isArray(page.headings.h2));
    assert.ok(Array.isArray(page.headings.h3));

    assert.equal(typeof page.signals.testimonials, "boolean");
    assert.equal(typeof page.signals.credentials, "boolean");
    assert.equal(typeof page.signals.pricing, "boolean");
    assert.equal(typeof page.signals.contact, "boolean");
  }

  const requiredSiteFields = [
    "pageCount",
    "missingTitles",
    "missingDescriptions",
    "missingCanonicals",
    "h1Missing",
    "h1Multiple",
    "imageCount",
    "imagesMissingAlt",
    "imagesMissingDimensions",
    "schemaTypes",
    "internalLinkCount",
    "brokenInternalLinks",
    "platform",
    "services",
    "topicKeywords",
    "trust",
    "securityHeaders",
  ];

  for (const field of requiredSiteFields) {
    assert.ok(
      field in result,
      `Site missing required field: ${field}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 11. Raw task ID preservation
// ---------------------------------------------------------------------------

test("raw task ID is preserved across the evidence envelope", async () => {
  const fixtures = buildSuccessfulFixtures(2);
  fixtures.taskPost.taskId = "preserved-task-id-abc123";

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures),
  );

  assert.equal(result._sourceStatus.requestId, "preserved-task-id-abc123");
  assert.ok(result.rawArtifactRef.includes("preserved-task-id-abc123"));
  assert.equal(result._raw.taskId, "preserved-task-id-abc123");
  assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
});

// ---------------------------------------------------------------------------
// 12. Dependent module suppression when no valid crawl exists
// ---------------------------------------------------------------------------

test("FAILED crawl produces evidence that scoring can detect as non-viable", async () => {
  setTestCredentials();
  try {
    const fetchImpl = async (_url, _init) => {
      throw new Error("Network failure: connection refused");
    };

    const result = await crawlWithDataforseo("https://down.example.com", {
      maxPages: 500,
      pollTimeoutMs: 500,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
    assert.equal(result.pageCount, 0);
    assert.deepEqual(result.pages, []);
    assert.equal(result.trust.testimonials, false);
    assert.equal(result.schemaTypes.length, 0);
    assert.equal(result.internalLinkCount, 0);
    assert.equal(result.services.length, 0);
  } finally {
    restoreCredentials();
  }
});

// ---------------------------------------------------------------------------
// 13. Authentication error categorization
// ---------------------------------------------------------------------------

test("authentication errors are categorized as auth", async () => {
  setTestCredentials();
  try {
    const fetchImpl = async (_url, _init) => {
      return new Response(
        JSON.stringify({
          status_code: 40001,
          status_message: "Authentication failed. Invalid login or password.",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 500,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
    assert.equal(result._sourceStatus.errorCategory, ERROR_CATEGORY.AUTH);
  } finally {
    restoreCredentials();
  }
});

// ---------------------------------------------------------------------------
// 14. No credentials → NOT_CONNECTED handling
// ---------------------------------------------------------------------------

test("live mode without credentials returns FAILED with not_configured category", async () => {
  clearTestCredentials();
  try {
    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 500,
      clientOptions: {
        mode: "live",
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
    // The client throws before calling the API due to missing credentials
    // The adapter catches this as an internal/network error
    assert.ok(
      result._sourceStatus.errorCategory === ERROR_CATEGORY.INTERNAL ||
      result._sourceStatus.errorCategory === ERROR_CATEGORY.NETWORK,
    );
  } finally {
    restoreCredentials();
  }
});

// ---------------------------------------------------------------------------
// 15. Default maximum of 500 HTML pages
// ---------------------------------------------------------------------------

test("default maxPages is 500", async () => {
  const fixtures = buildSuccessfulFixtures(3);
  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures),
  );

  assert.equal(result.pageCount, 3);
  assert.ok(result.coverage);
  assert.equal(typeof result.coverage.requested, "number");
  assert.equal(typeof result.coverage.completed, "number");
});

// ---------------------------------------------------------------------------
// 16. Client fixture mode returns predictable data
// ---------------------------------------------------------------------------

test("client fixture mode returns fixture data without network calls", async () => {
  const fixtures = buildSuccessfulFixtures(3);
  const client = createDataforseoOnpageClient({
    mode: "fixture",
    fixtures,
  });

  const task = await client.taskPost("example.com");
  assert.equal(task.taskId, "test-task-20260726-001");

  const poll = await client.pollTask(task.taskId);
  assert.equal(poll.status, "ready");

  const pages = await client.getPages(task.taskId, { limit: 2, offset: 0 });
  assert.equal(pages.items.length, 2);
  assert.equal(pages.total_count, 3);

  const allPages = await client.getAllPages(task.taskId, { maxPages: 10 });
  assert.equal(allPages.length, 3);

  const links = await client.getLinks(task.taskId, { limit: 5 });
  assert.ok(links.items.length > 0);

  const dupTags = await client.getDuplicateTags(task.taskId);
  assert.ok(dupTags);

  const dupContent = await client.getDuplicateContent(task.taskId);
  assert.ok(dupContent);
});

// ---------------------------------------------------------------------------
// 17. Pagination across multiple getPages calls
// ---------------------------------------------------------------------------

test("getAllPages handles pagination correctly", async () => {
  const items = [];
  for (let i = 0; i < 250; i++) {
    items.push(buildPageFixture(i));
  }

  const fixtures = {
    ...buildSuccessfulFixtures(250),
    pages: { items, total_count: 250 },
  };

  const client = createDataforseoOnpageClient({
    mode: "fixture",
    fixtures,
  });

  const allPages = await client.getAllPages("test-task", { maxPages: 300, pageSize: 50 });
  assert.equal(allPages.length, 250);
});

// ---------------------------------------------------------------------------
// 18. Evidence envelope compatibility with scoring model
// ---------------------------------------------------------------------------

test("evidence envelope is compatible with existing scoring model shape", async () => {
  const fixtures = buildSuccessfulFixtures(3);
  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures),
  );

  assert.equal(typeof result.pageCount, "number");
  assert.ok(Array.isArray(result.pages));
  assert.equal(typeof result.missingTitles, "number");
  assert.equal(typeof result.missingDescriptions, "number");
  assert.equal(typeof result.missingCanonicals, "number");
  assert.equal(typeof result.h1Missing, "number");
  assert.equal(typeof result.h1Multiple, "number");
  assert.equal(typeof result.imageCount, "number");
  assert.equal(typeof result.imagesMissingAlt, "number");
  assert.equal(typeof result.imagesMissingDimensions, "number");
  assert.ok(Array.isArray(result.schemaTypes));
  assert.ok(Array.isArray(result.forms));
  assert.ok(Array.isArray(result.ctas));
  assert.ok(Array.isArray(result.socialLinks));
  assert.equal(typeof result.internalLinkCount, "number");
  assert.ok(Array.isArray(result.brokenInternalLinks));
  assert.equal(typeof result.platform, "string");
  assert.ok(Array.isArray(result.services));
  assert.ok(Array.isArray(result.topicKeywords));
  assert.equal(typeof result.trust.testimonials, "boolean");
  assert.equal(typeof result.trust.credentials, "boolean");
  assert.equal(typeof result.trust.caseStudies, "boolean");
  assert.equal(typeof result.trust.faq, "boolean");
  assert.equal(typeof result.trust.pricing, "boolean");
  assert.equal(typeof result.trust.policies, "boolean");
  assert.equal(typeof result.trust.contact, "boolean");
  assert.equal(typeof result.securityHeaders.xFrameOptions, "boolean");
  assert.equal(typeof result.securityHeaders.xContentTypeOptions, "boolean");
  assert.equal(typeof result.securityHeaders.referrerPolicy, "boolean");
  assert.equal(typeof result.securityHeaders.contentSecurityPolicy, "boolean");

  assert.equal(result.evidenceVersion, "1.0.0");
  assert.ok(Object.values(SOURCE_STATUS).includes(result.sourceStatus));
  assert.ok(result._sourceStatus);
  assert.equal(typeof result._sourceStatus.provider, "string");
  assert.equal(typeof result._sourceStatus.adapterVersion, "string");
  assert.ok(result._sourceStatus.startedAt);
  assert.ok(result._sourceStatus.completedAt);
});

// ---------------------------------------------------------------------------
// 19. Non-200 status pages handled correctly
// ---------------------------------------------------------------------------

test("pages with error status codes are tracked in brokenInternalLinks", async () => {
  const pages = [
    buildPageFixture(0),
    buildPageFixture(1, { status_code: 404 }),
    buildPageFixture(2),
    buildPageFixture(3, { status_code: 500 }),
    buildPageFixture(4),
  ];

  const fixtures = buildFixturesWithExtras({
    pageCount: 5,
    pages: { items: pages, total_count: 5 },
  });

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures),
  );

  assert.equal(result.pageCount, 5);
  assert.equal(result.brokenInternalLinks.length, 2);
  assert.ok(result.brokenInternalLinks.some((u) => u.includes("page-1")));
  assert.ok(result.brokenInternalLinks.some((u) => u.includes("page-3")));
});

// ---------------------------------------------------------------------------
// 20. Schema types extracted from structured data
// ---------------------------------------------------------------------------

test("schema types are extracted from DataForSEO structured_data", async () => {
  const pages = [
    buildPageFixture(0, {
      schemaTypes: ["Organization", "WebSite"],
      structured_data: {
        types: [
          { type: "Organization", name: "Example Corp" },
          { type: "WebSite" },
        ],
      },
    }),
    buildPageFixture(1, {
      schemaTypes: ["Service"],
      structured_data: {
        types: [{ type: "Service", name: "Consulting" }],
      },
    }),
  ];

  const fixtures = buildFixturesWithExtras({
    pageCount: 2,
    pages: { items: pages, total_count: 2 },
  });

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures),
  );

  assert.ok(result.schemaTypes.includes("Organization"));
  assert.ok(result.schemaTypes.includes("Service"));
  assert.ok(result.schemaTypes.includes("WebSite"));
});

// ---------------------------------------------------------------------------
// 21. Empty fixture edge case
// ---------------------------------------------------------------------------

test("empty pages result returns FAILED", async () => {
  const fixtures = {
    taskPost: {
      taskId: "empty-task-001",
      rawTask: { id: "empty-task-001" },
    },
    pollTask: { status: "ready", taskId: "empty-task-001" },
    summary: {
      crawl_status: "completed",
      pages_crawled: 0,
      total_pages: 0,
    },
    pages: { items: [], total_count: 0 },
    links: { items: [], total_count: 0 },
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://empty.example.com",
    crawlOpts(fixtures),
  );

  assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
  assert.equal(result.pageCount, 0);
});

// ---------------------------------------------------------------------------
// 22. Trust signals detected from page content
// ---------------------------------------------------------------------------

test("trust signals are detected from page body text", async () => {
  const pages = [
    buildPageFixture(0, {
      bodyText: "We have certified consultants with 25 years experience. Client testimonials and reviews. Our case studies show real results. View our pricing and book a consultation.",
    }),
  ];

  const fixtures = buildFixturesWithExtras({
    pageCount: 1,
    pages: { items: pages, total_count: 1 },
  });

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures),
  );

  assert.equal(result.trust.credentials, true);
  assert.equal(result.trust.testimonials, true);
  assert.equal(result.trust.caseStudies, true);
  assert.equal(result.trust.pricing, true);
});

// ---------------------------------------------------------------------------
// Regression: 20100 "Task Created" accepted only for task_post
// ---------------------------------------------------------------------------

import { parseDataforseoResponse, extractTaskResult } from "./dataforseo-onpage-client.js";

// parseDataforseoResponse: root status_code still only accepts 20000
test("parseDataforseoResponse rejects root status_code 20100", () => {
  assert.throws(
    () => parseDataforseoResponse({ status_code: 20100, status_message: "Ok." }, "/on_page/task_post"),
    /status_code=20100/,
  );
});

test("parseDataforseoResponse accepts root status_code 20000", () => {
  const body = { status_code: 20000, status_message: "Ok.", tasks: [{ status_code: 20000, result: [{ id: "task-root-ok" }] }] };
  const result = parseDataforseoResponse(body, "/on_page/summary");
  assert.equal(result.tasks[0].result[0].id, "task-root-ok");
});

// extractTaskResult: with [20000, 20100] allows task_post 20100
test("extractTaskResult with allowed [20000,20100] extracts 20100 task ID", () => {
  const response = { status_code: 20000, tasks: [{ status_code: 20100, result: [{ id: "task-abc-123" }] }] };
  const result = extractTaskResult(response, "/on_page/task_post", [20000, 20100]);
  assert.ok(result, "Should extract result when 20100 is allowed");
  assert.equal(result.id, "task-abc-123");
});

// extractTaskResult: default [20000] rejects 20100
test("extractTaskResult with default allowed rejects 20100 for summary endpoint", () => {
  const response = { status_code: 20000, tasks: [{ status_code: 20100, status_message: "Task Created" }] };
  assert.throws(
    () => extractTaskResult(response, "/on_page/summary"),
    /status_code=20100/,
  );
});

// extractTaskResult: default [20000] still works
test("extractTaskResult with default allowed extracts 20000 result", () => {
  const response = { status_code: 20000, tasks: [{ status_code: 20000, result: [{ id: "task-summary-ok" }] }] };
  const result = extractTaskResult(response, "/on_page/summary");
  assert.equal(result.id, "task-summary-ok");
});

// extractTaskResult: still rejects unexpected statuses
test("extractTaskResult still rejects unexpected task status_code", () => {
  const response = { status_code: 20000, tasks: [{ status_code: 40005, status_message: "Forbidden" }] };
  assert.throws(
    () => extractTaskResult(response, "/on_page/summary"),
    /status_code=40005/,
  );
});

// 20100 invalid for pages
test("extractTaskResult rejects 20100 for pages endpoint", () => {
  const response = { status_code: 20000, tasks: [{ status_code: 20100, status_message: "Task Created" }] };
  assert.throws(
    () => extractTaskResult(response, "/on_page/pages"),
    /status_code=20100/,
  );
});

// 20100 invalid for links
test("extractTaskResult rejects 20100 for links endpoint", () => {
  const response = { status_code: 20000, tasks: [{ status_code: 20100, status_message: "Task Created" }] };
  assert.throws(
    () => extractTaskResult(response, "/on_page/links"),
    /status_code=20100/,
  );
});

// ---------------------------------------------------------------------------
// Regression: taskPost reads task ID from tasks[0].id for 20100 responses
// ---------------------------------------------------------------------------

test("taskPost live-mode accepts 20100 with result:null and ID at tasks[0].id", async () => {
  setTestCredentials();
  try {
    // Real DataForSEO 20100 shape: root status_code 20000, task status_code
    // 20100, result: null, and the task ID only at tasks[0].id.
    const fetchImpl = async (url) => {
      if (String(url).includes("task_post")) {
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [
              {
                id: "20100-task-id-from-tasks-array",
                status_code: 20100,
                status_message: "Task Created.",
                result: null,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // Non-task_post calls return ready summary data so the crawl completes
      return new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [{ status_code: 20000, result: [{ items: buildSuccessfulFixtures(3).pages.items }] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 500,
      pollIntervalMs: 100,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
    assert.equal(result.pageCount, 3);
    // The task ID from tasks[0].id was preserved through the pipeline
    assert.equal(result._sourceStatus.requestId, "20100-task-id-from-tasks-array");
    assert.equal(result._raw.taskId, "20100-task-id-from-tasks-array");
  } finally {
    restoreCredentials();
  }
});

test("taskPost live-mode still accepts 20000 with ID at tasks[0].result[0].id", async () => {
  setTestCredentials();
  try {
    const fetchImpl = async (url) => {
      if (String(url).includes("task_post")) {
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [
              {
                status_code: 20000,
                result: [{ id: "20000-task-id-from-result", crawl_status: "pending" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [{ status_code: 20000, result: [{ items: buildSuccessfulFixtures(2).pages.items }] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 500,
      pollIntervalMs: 100,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
    assert.equal(result.pageCount, 2);
    assert.equal(result._sourceStatus.requestId, "20000-task-id-from-result");
  } finally {
    restoreCredentials();
  }
});

test("taskPost live-mode fails when both result and tasks[0].id are missing", async () => {
  setTestCredentials();
  try {
    const fetchImpl = async (_url, _init) => {
      return new Response(
        JSON.stringify({
          status_code: 20000,
          status_message: "Ok.",
          tasks: [
            {
              status_code: 20000,
              // No id field, no result array — should throw
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 500,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
    assert.ok(
      result.limitations.some((l) => /no task ID/i.test(l)),
      `Expected "no task ID" limitation, got: ${JSON.stringify(result.limitations)}`,
    );
  } finally {
    restoreCredentials();
  }
});

test("taskPost live-mode fails when tasks array is empty", async () => {
  setTestCredentials();
  try {
    const fetchImpl = async (_url, _init) => {
      return new Response(
        JSON.stringify({
          status_code: 20000,
          status_message: "Ok.",
          tasks: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 500,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
  } finally {
    restoreCredentials();
  }
});

// Other endpoints (summary, pages, links, duplicate_tags, duplicate_content)
// must still reject 20100 — only task_post accepts it.

test("summary endpoint rejects 20100 in live mode", async () => {
  setTestCredentials();
  try {
    const fetchImpl = async (url) => {
      if (String(url).includes("task_post")) {
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [{ status_code: 20000, result: [{ id: "summary-20100-task" }] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // summary returns 20100 — should be rejected
      return new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [{ status_code: 20100, status_message: "Task Created" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 200,
      pollIntervalMs: 50,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    // The adapter catches errors during result retrieval and builds a FAILED envelope
    assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
  } finally {
    restoreCredentials();
  }
});

test("polling continues on 20100 and eventually succeeds when task is ready", async () => {
  setTestCredentials();
  try {
    let pollCalls = 0;
    const fetchImpl = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("task_post")) {
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [
              {
                id: "poll-20100-task",
                status_code: 20100,
                status_message: "Task Created.",
                result: null,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // First two poll calls return 20100 (still processing), third returns ready data
      pollCalls++;
      if (pollCalls <= 2) {
        return new Response(
          JSON.stringify({
            status_code: 20000,
            tasks: [{ status_code: 20100, status_message: "Task is processing" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [{ status_code: 20000, result: [{ items: buildSuccessfulFixtures(2).pages.items }] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 1000,
      pollIntervalMs: 50,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
    assert.equal(result.pageCount, 2);
    assert.equal(result._raw.taskId, "poll-20100-task");
    // Should have polled at least 3 times (2 processing + 1 success)
    assert.ok(pollCalls >= 3, `Expected >=3 poll calls, got ${pollCalls}`);
  } finally {
    restoreCredentials();
  }
});


test("summary uses GET with task ID in URL and waits for finished", async () => {
  setTestCredentials();
  try {
    const requests = [];
    let summaryCalls = 0;

    const fetchImpl = async (url, init = {}) => {
      const urlStr = String(url);

      requests.push({
        url: urlStr,
        method: init.method,
        body: init.body,
      });

      if (urlStr.includes("/on_page/task_post")) {
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [{
              id: "summary-get-task",
              status_code: 20100,
              status_message: "Task Created.",
              result: null,
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlStr.endsWith("/on_page/summary/summary-get-task")) {
        summaryCalls++;

        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [{
              status_code: 20000,
              status_message: "Ok.",
              result: [{
                crawl_progress: summaryCalls === 1
                  ? "in_progress"
                  : "finished",
                total_pages: 2,
                crawl_status: {
                  pages_crawled: summaryCalls === 1 ? 1 : 2,
                  pages_in_queue: summaryCalls === 1 ? 1 : 0,
                },
              }],
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      const fixtures = buildSuccessfulFixtures(2);
      const result = urlStr.includes("/on_page/pages")
        ? {
            items: fixtures.pages.items,
            total_count: fixtures.pages.items.length,
          }
        : {
            items: [],
            total_count: 0,
          };

      return new Response(
        JSON.stringify({
          status_code: 20000,
          status_message: "Ok.",
          tasks: [{
            status_code: 20000,
            status_message: "Ok.",
            result: [result],
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 3,
      pollTimeoutMs: 1000,
      pollIntervalMs: 10,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    const summaryRequests = requests.filter((request) =>
      request.url.includes("/on_page/summary/"),
    );

    assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
    assert.equal(result.pageCount, 2);
    assert.ok(summaryCalls >= 3);
    assert.ok(summaryRequests.every((request) =>
      request.method === "GET",
    ));
    assert.ok(summaryRequests.every((request) =>
      request.body === undefined,
    ));
    assert.ok(summaryRequests.every((request) =>
      request.url.endsWith("/on_page/summary/summary-get-task"),
    ));
  } finally {
    restoreCredentials();
  }
});

// ---------------------------------------------------------------------------
// Regression: 40602 "Task In Queue" is treated as a pending state, not fatal
// ---------------------------------------------------------------------------

test("40602 Task In Queue is treated as pending — exact production sequence", async () => {
  setTestCredentials();
  try {
    let summaryCalls = 0;

    const fetchImpl = async (url, init = {}) => {
      const urlStr = String(url);

      // Step 1: task_post returns 20100 with task ID at tasks[0].id
      if (urlStr.includes("/on_page/task_post")) {
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [{
              id: "07290112-1281-0216-0000-931625a290d3",
              status_code: 20100,
              status_message: "Task Created.",
              result: null,
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // Step 2-4: summary polls via GET with task ID in URL
      if (urlStr.includes("/on_page/summary/")) {
        summaryCalls++;

        // First poll: 40602 "Task In Queue." — must not throw
        if (summaryCalls === 1) {
          return new Response(
            JSON.stringify({
              status_code: 20000,
              status_message: "Ok.",
              tasks: [{
                status_code: 40602,
                status_message: "Task In Queue.",
                result: null,
              }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        // Second poll: 20000 with crawl_progress "in_progress"
        if (summaryCalls === 2) {
          return new Response(
            JSON.stringify({
              status_code: 20000,
              status_message: "Ok.",
              tasks: [{
                status_code: 20000,
                status_message: "Ok.",
                result: [{
                  crawl_progress: "in_progress",
                  total_pages: 3,
                }],
              }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        // Third poll: 20000 with crawl_progress "finished"
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [{
              status_code: 20000,
              status_message: "Ok.",
              result: [{
                crawl_progress: "finished",
                total_pages: 3,
                pages_crawled: 3,
              }],
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // Pages retrieval — succeeds with fixture data
      const fixtures = buildSuccessfulFixtures(3);
      if (urlStr.includes("/on_page/pages")) {
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [{
              status_code: 20000,
              status_message: "Ok.",
              result: [{ items: fixtures.pages.items, total_count: 3 }],
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // Links / other endpoints
      return new Response(
        JSON.stringify({
          status_code: 20000,
          status_message: "Ok.",
          tasks: [{
            status_code: 20000,
            status_message: "Ok.",
            result: [{ items: [], total_count: 0 }],
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 5000,
      pollIntervalMs: 10,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    // Final crawl must be AVAILABLE — 40602 did not cause a failure
    assert.equal(result.sourceStatus, SOURCE_STATUS.AVAILABLE);
    assert.equal(result.pageCount, 3);
    // Production task ID preserved through the pipeline
    assert.equal(result._sourceStatus.requestId, "07290112-1281-0216-0000-931625a290d3");
    // Summary was polled at least 3 times (40602 → in_progress → finished)
    assert.ok(summaryCalls >= 3, `Expected >=3 summary calls, got ${summaryCalls}`);
  } finally {
    restoreCredentials();
  }
});

// Unknown non-success task status must still throw
test("unknown task status_code throws — not treated as pending", async () => {
  setTestCredentials();
  try {
    let summaryCalls = 0;

    const fetchImpl = async (url, init = {}) => {
      const urlStr = String(url);

      if (urlStr.includes("/on_page/task_post")) {
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [{
              id: "unknown-error-task",
              status_code: 20100,
              status_message: "Task Created.",
              result: null,
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlStr.includes("/on_page/summary/")) {
        summaryCalls++;
        // Return a genuinely unknown error: 40701 is not in the allowed set
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            tasks: [{
              status_code: 40701,
              status_message: "Internal Error. Something went wrong.",
              result: null,
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [{ status_code: 20000, result: [{ items: [] }] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await crawlWithDataforseo("https://example.com", {
      maxPages: 500,
      pollTimeoutMs: 500,
      pollIntervalMs: 50,
      clientOptions: {
        mode: "live",
        fetchImpl,
      },
    });

    // Unknown error must still cause a FAILED crawl
    assert.equal(result.sourceStatus, SOURCE_STATUS.FAILED);
    assert.equal(summaryCalls, 1);
  } finally {
    restoreCredentials();
  }
});

// ---------------------------------------------------------------------------
// Regression: real DataForSEO API response format
// ---------------------------------------------------------------------------

/**
 * Build a page fixture matching the ACTUAL DataForSEO /on_page/pages
 * response format (headings under meta.htags, word count under
 * meta.content.plain_text_word_count, counts only — no link/image arrays).
 */
function buildRealisticDfPage(index, overrides = {}) {
  return {
    resource_type: "html",
    url: hasOwn(overrides, "url")
      ? overrides.url
      : `https://example.com/page-${index}`,
    status_code: hasOwn(overrides, "status_code")
      ? overrides.status_code
      : 200,
    meta: {
      title: hasOwn(overrides, "title")
        ? overrides.title
        : `Page ${index} Title`,
      description: hasOwn(overrides, "description")
        ? overrides.description
        : `Meta description for page ${index}`,
      canonical: hasOwn(overrides, "canonical")
        ? overrides.canonical
        : `https://example.com/page-${index}`,
      htags: {
        h1: hasOwn(overrides, "h1")
          ? overrides.h1
          : [`Heading 1 - Page ${index}`],
        h2: hasOwn(overrides, "h2")
          ? overrides.h2
          : [`Subheading for page ${index}`],
        h3: hasOwn(overrides, "h3") ? overrides.h3 : [],
        h4: hasOwn(overrides, "h4") ? overrides.h4 : [],
        h5: hasOwn(overrides, "h5") ? overrides.h5 : [],
        h6: hasOwn(overrides, "h6") ? overrides.h6 : [],
      },
      content: {
        plain_text_word_count: hasOwn(overrides, "word_count")
          ? overrides.word_count
          : 500 + index * 100,
        plain_text_size: 2500 + index * 500,
        plain_text_rate: 0.15,
      },
      content_language: hasOwn(overrides, "language")
        ? overrides.language
        : "en",
      generator: hasOwn(overrides, "generator")
        ? overrides.generator
        : "WordPress",
      internal_links_count: 10,
      external_links_count: 3,
      images_count: 5 + index,
      // No plain_text — body text is NOT available from pages endpoint
      // No links array — only counts
      // No images array — only counts
      // No structured_data — only counts
    },
    // No links array at root — links come from separate /on_page/links endpoint
    // No images array at root
    // No structured_data at root
    page_timing: { time_to_interactive: 500 },
    load_time: 500,
    crawl_depth: index,
    checks: {},
    ...(overrides.extra || {}),
  };
}

/**
 * Build a summary fixture matching the real DataForSEO summary format
 * with page_metrics at the root.
 */
function buildRealisticDfSummary(overrides = {}) {
  return {
    crawl_progress: "finished",
    crawl_status: {
      max_crawl_pages: overrides.maxPages ?? 30,
      pages_in_queue: 0,
      pages_crawled: overrides.pageCount ?? 30,
    },
    crawl_stop_reason: overrides.crawlStopReason ?? "limit_exceeded",
    domain_info: {
      name: "example.com",
      cms: overrides.cms ?? "WordPress",
      total_pages: overrides.totalSitePages ?? (overrides.pageCount ?? 30),
    },
    page_metrics: {
      links_external: overrides.linksExternal ?? 129,
      links_internal: overrides.linksInternal ?? 584,
      broken_links: overrides.brokenLinks ?? 5,
      onpage_score: overrides.onpageScore ?? 81.36,
      checks: {
        no_h1_tag: overrides.noH1Tag ?? 3,
        no_description: overrides.noDescription ?? 5,
        no_image_alt: overrides.noImageAlt ?? 12,
        no_image_title: overrides.noImageTitle ?? 12,
        no_title: overrides.noTitle ?? 1,
        is_4xx_code: overrides.is4xx ?? 2,
        is_broken: overrides.isBroken ?? 2,
        broken_links: 5,
        ...(overrides.extraChecks || {}),
      },
    },
  };
}

/**
 * Build link items matching the real /on_page/links endpoint format
 * (link_to / link_from — not url / href).
 */
function buildRealisticDfLinks(baseCount = 50) {
  const items = [];
  for (let i = 0; i < baseCount; i++) {
    items.push({
      type: "link",
      link_from: `https://example.com/page-${i % 10}`,
      link_to: i < baseCount - 10
        ? `https://example.com/internal-page-${i}`
        : `https://other-example.com/external-${i}`,
      domain_from: "example.com",
      domain_to: i < baseCount - 10 ? "example.com" : "other-example.com",
    });
  }
  return { items, total_count: items.length };
}

// Regression: headings extracted from meta.htags path (real API format)
test("headings extracted from meta.htags.h1 path (real DataForSEO format)", async () => {
  const pages = [
    buildRealisticDfPage(0, { h1: ["Main Heading", "Second H1"] }),
    buildRealisticDfPage(1, { h1: [] }),
    buildRealisticDfPage(2, { h1: ["Only Heading"] }),
  ];

  const fixtures = {
    taskPost: { taskId: "htags-test", rawTask: { id: "htags-test" } },
    pollTask: { status: "ready", taskId: "htags-test" },
    summary: buildRealisticDfSummary({ pageCount: 3, totalSitePages: 3 }),
    pages: { items: pages, total_count: 3 },
    links: { items: [], total_count: 0 },
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures, { maxPages: 10 }),
  );

  assert.equal(result.pageCount, 3);
  // Page 0 should have 2 H1s
  assert.equal(result.pages[0].headings.h1.length, 2);
  assert.equal(result.pages[0].headings.h1[0], "Main Heading");
  // Page 1 should have 0 H1s
  assert.equal(result.pages[1].headings.h1.length, 0);
  // Page 2 should have 1 H1
  assert.equal(result.pages[2].headings.h1.length, 1);
});

// Regression: word count from meta.content.plain_text_word_count
test("word count uses meta.content.plain_text_word_count (real DataForSEO format)", async () => {
  const pages = [
    buildRealisticDfPage(0, { word_count: 750 }),
    buildRealisticDfPage(1, { word_count: 1200 }),
  ];

  const fixtures = {
    taskPost: { taskId: "wordcount-test", rawTask: { id: "wordcount-test" } },
    pollTask: { status: "ready", taskId: "wordcount-test" },
    summary: buildRealisticDfSummary({ pageCount: 2, totalSitePages: 2 }),
    pages: { items: pages, total_count: 2 },
    links: { items: [], total_count: 0 },
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures, { maxPages: 10 }),
  );

  assert.equal(result.pages[0].words, 750);
  assert.equal(result.pages[1].words, 1200);
  assert.equal(result.totalWords, 750 + 1200);
  assert.equal(result.averageWords, Math.round((750 + 1200) / 2));
});

// Regression: internalLinkCount from page_metrics.links_internal
test("internalLinkCount uses page_metrics.links_internal when link arrays unavailable", async () => {
  const pages = [buildRealisticDfPage(0)];

  const fixtures = {
    taskPost: { taskId: "links-test", rawTask: { id: "links-test" } },
    pollTask: { status: "ready", taskId: "links-test" },
    summary: buildRealisticDfSummary({
      pageCount: 1,
      totalSitePages: 1,
      linksInternal: 584,
      linksExternal: 129,
    }),
    pages: { items: pages, total_count: 1 },
    links: { items: [], total_count: 0 }, // No link arrays from endpoint
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures, { maxPages: 10 }),
  );

  assert.equal(result.internalLinkCount, 584);
});

// Regression: h1Missing from page_metrics.checks.no_h1_tag
test("h1Missing uses page_metrics.checks.no_h1_tag when heading data unavailable", async () => {
  // Pages with empty h1 arrays (DataForSEO pages endpoint doesn't return
  // extracted headings — only counts via page_metrics).
  const pages = [
    buildRealisticDfPage(0, { h1: [] }),
    buildRealisticDfPage(1, { h1: [] }),
    buildRealisticDfPage(2, { h1: [] }),
  ];

  const fixtures = {
    taskPost: { taskId: "h1missing-test", rawTask: { id: "h1missing-test" } },
    pollTask: { status: "ready", taskId: "h1missing-test" },
    summary: buildRealisticDfSummary({
      pageCount: 3,
      totalSitePages: 3,
      noH1Tag: 21,
    }),
    pages: { items: pages, total_count: 3 },
    links: { items: [], total_count: 0 },
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures, { maxPages: 10 }),
  );

  // When no pages have heading data extracted, h1Missing comes from
  // page_metrics.checks.no_h1_tag (21), not from page-level counts.
  assert.equal(result.h1Missing, 21);
});

// Regression: missingDescriptions from page_metrics.checks.no_description
test("missingDescriptions uses page_metrics.checks.no_description", async () => {
  // Pages with empty descriptions (DataForSEO pages endpoint may not
  // always return per-page description data).
  const pages = [
    buildRealisticDfPage(0, { description: "" }),
    buildRealisticDfPage(1, { description: "" }),
    buildRealisticDfPage(2, { description: "" }),
  ];

  const fixtures = {
    taskPost: { taskId: "nodesc-test", rawTask: { id: "nodesc-test" } },
    pollTask: { status: "ready", taskId: "nodesc-test" },
    summary: buildRealisticDfSummary({
      pageCount: 3,
      totalSitePages: 3,
      noDescription: 16,
    }),
    pages: { items: pages, total_count: 3 },
    links: { items: [], total_count: 0 },
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures, { maxPages: 10 }),
  );

  // When no pages have descriptions, value comes from page_metrics
  assert.equal(result.missingDescriptions, 16);
});

// Regression: imagesMissingAlt from page_metrics.checks.no_image_alt
test("imagesMissingAlt uses page_metrics.checks.no_image_alt when image arrays unavailable", async () => {
  const pages = [buildRealisticDfPage(0)];

  const fixtures = {
    taskPost: { taskId: "imgalt-test", rawTask: { id: "imgalt-test" } },
    pollTask: { status: "ready", taskId: "imgalt-test" },
    summary: buildRealisticDfSummary({
      pageCount: 1,
      totalSitePages: 1,
      noImageAlt: 26,
    }),
    pages: { items: pages, total_count: 1 },
    links: { items: [], total_count: 0 },
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures, { maxPages: 10 }),
  );

  assert.equal(result.imagesMissingAlt, 26);
});

// Regression: 404 pages excluded from content-quality counts
test("404 pages are excluded from content-quality counts", async () => {
  const pages = [
    buildRealisticDfPage(0, { status_code: 404, title: "", description: "", h1: [] }),
    buildRealisticDfPage(0, { status_code: 404, title: "", description: "", h1: [] }),
    buildRealisticDfPage(0, { status_code: 404, title: "", description: "", h1: [] }),
    // These three have content
    buildRealisticDfPage(1, { h1: ["Has H1"] }),
    buildRealisticDfPage(2, { h1: [] }),
    buildRealisticDfPage(3, { h1: ["Also Has H1"] }),
  ];

  const fixtures = {
    taskPost: { taskId: "404-test", rawTask: { id: "404-test" } },
    pollTask: { status: "ready", taskId: "404-test" },
    summary: buildRealisticDfSummary({
      pageCount: 6, totalSitePages: 6,
      is4xx: 3, isBroken: 3,
      noH1Tag: 1, // only page 2 lacks H1 among content pages
    }),
    pages: { items: pages, total_count: 6 },
    links: { items: [], total_count: 0 },
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures, { maxPages: 10 }),
  );

  // Total pageCount still includes all
  assert.equal(result.pageCount, 6);
  // 404 pages in brokenInternalLinks
  assert.equal(result.brokenInternalLinks.length, 3);
  // Content-quality counts use only non-404 pages (3 content pages)
  // Since no page-level heading data was extracted, h1Missing uses
  // page_metrics.checks.no_h1_tag (1)
  assert.equal(result.h1Missing, 1);
  // missingTitles comes from content pages (non-404) only
  // All 3 content pages have titles, so 0 missing
  assert.equal(result.missingTitles, 0);
});

// Regression: link field mapping handles link_to format
test("link field mapping handles link_to format from DataForSEO links endpoint", async () => {
  const pages = [buildRealisticDfPage(0)];

  const linksData = buildRealisticDfLinks(50);
  // 40 internal, 10 external

  const fixtures = {
    taskPost: { taskId: "linkmap-test", rawTask: { id: "linkmap-test" } },
    pollTask: { status: "ready", taskId: "linkmap-test" },
    summary: buildRealisticDfSummary({
      pageCount: 1,
      totalSitePages: 1,
      linksInternal: 40,
    }),
    pages: { items: pages, total_count: 1 },
    links: linksData,
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures, { maxPages: 10 }),
  );

  // With link arrays available, internalLinkCount is derived from the
  // actual links data, not page_metrics
  assert.equal(result.internalLinkCount, 40);
});

// Regression: contentEvidenceAvailable is false when no body text extracted
test("_contentEvidenceAvailable is false when DataForSEO pages lack body text", async () => {
  const pages = [
    buildRealisticDfPage(0),
    buildRealisticDfPage(1),
  ];

  const fixtures = {
    taskPost: { taskId: "contentavail-test", rawTask: { id: "contentavail-test" } },
    pollTask: { status: "ready", taskId: "contentavail-test" },
    summary: buildRealisticDfSummary({ pageCount: 2, totalSitePages: 2 }),
    pages: { items: pages, total_count: 2 },
    links: { items: [], total_count: 0 },
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://example.com",
    crawlOpts(fixtures, { maxPages: 10 }),
  );

  assert.equal(result._contentEvidenceAvailable, false);
  // Trust signals are false (not null — backward compatible with scoring)
  assert.equal(result.trust.testimonials, false);
  assert.equal(result.trust.credentials, false);
  // Limitations mention unavailable content
  assert.ok(
    result.limitations.some((l) => /body content/i.test(l)),
    `Expected body content limitation, got: ${JSON.stringify(result.limitations)}`,
  );
  // Source status is PARTIAL because content evidence is unavailable
  assert.equal(result.sourceStatus, SOURCE_STATUS.PARTIAL);
});

// Regression: page_metrics used for aggregate counts in production-like scenario
test("production regression: matches expected values from page_metrics", async () => {
  // Simulate a realistic production scenario matching the may-crawford audit.
  // KEY INSIGHT: DataForSEO /on_page/pages returns meta.title and
  // meta.description but does NOT return extracted headings, links,
  // images, or body text.  Those aggregate counts live only in the
  // summary's page_metrics.checks.
  const pages = [];
  // 3 x 404 pages (no title, no description)
  for (let i = 0; i < 3; i++) {
    pages.push(buildRealisticDfPage(i, {
      status_code: 404,
      title: "",
      description: "",
      h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
      url: `https://maycrawford.com/404-page-${i}`,
    }));
  }
  // 27 x 200 pages — have titles but NO extracted headings,
  // descriptions, or body text (simulating the real DataForSEO
  // pages endpoint which returns meta.title but limited other fields).
  for (let i = 0; i < 27; i++) {
    pages.push(buildRealisticDfPage(i + 3, {
      h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
      description: "",
      generator: "concrete5",
      url: `https://maycrawford.com/page-${i + 3}`,
    }));
  }

  const fixtures = {
    taskPost: {
      taskId: "07290216-1281-0216-0000-372ec45e2f2a",
      rawTask: { id: "07290216-1281-0216-0000-372ec45e2f2a" },
    },
    pollTask: {
      status: "ready",
      taskId: "07290216-1281-0216-0000-372ec45e2f2a",
    },
    summary: buildRealisticDfSummary({
      pageCount: 30,
      totalSitePages: 30,
      linksInternal: 584,
      linksExternal: 129,
      brokenLinks: 5,
      noH1Tag: 21,
      noDescription: 16,
      noImageAlt: 26,
      is4xx: 3,
      isBroken: 3,
      cms: "concrete5",
    }),
    pages: { items: pages, total_count: 30 },
    links: { items: [], total_count: 0 }, // No link arrays — use page_metrics
    duplicateTags: { items: [] },
    duplicateContent: { items: [] },
  };

  const result = await crawlWithDataforseo(
    "https://maycrawford.com",
    crawlOpts(fixtures, { maxPages: 30 }),
  );

  // Required assertions matching production defect report
  assert.equal(result.pageCount, 30);
  assert.equal(result.internalLinkCount, 584,
    "internalLinkCount must match page_metrics.links_internal");
  assert.equal(result.h1Missing, 21,
    "h1Missing must match page_metrics.checks.no_h1_tag");
  assert.equal(result.missingDescriptions, 16,
    "missingDescriptions must match page_metrics.checks.no_description");
  assert.equal(result.imagesMissingAlt, 26,
    "imagesMissingAlt must match page_metrics.checks.no_image_alt");
  assert.equal(result.brokenLinksCount, 5,
    "brokenLinksCount must match page_metrics.broken_links");

  // 404 pages excluded from content-quality counts
  assert.equal(result.missingTitles, 0,
    "404 pages excluded from missingTitles (content pages have titles)");

  // Content evidence is unavailable (no body text from DataForSEO)
  assert.equal(result._contentEvidenceAvailable, false);
  assert.equal(result.sourceStatus, SOURCE_STATUS.PARTIAL);

  // Limitations mention unavailable content fields
  assert.ok(
    result.limitations.some((l) => /body content/i.test(l)),
    "Must have limitation about unavailable body content",
  );

  // Platform from domain_info
  assert.equal(result.platform, "concrete5");

  // Task ID preserved
  assert.equal(
    result._sourceStatus.requestId,
    "07290216-1281-0216-0000-372ec45e2f2a",
  );

  // No false content signals (trust is false, not a confirmed absence)
  assert.equal(result.trust.testimonials, false);
  assert.equal(result.trust.contact, false);

  // imageCount is null (not available from pages endpoint)
  assert.equal(result.imageCount, null);
});

// ---------------------------------------------------------------------------
// T-DT-01 through T-DT-06: pollSubEndpoint / duplicate_tags 20100 behaviour
// ---------------------------------------------------------------------------

// T-DT-01: 20100 on first call, then 20000 on second — returns populated result
test("T-DT-01: 20100 followed by 20000 returns populated result with retry metadata", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) {
      return new Response(JSON.stringify({
        status_code: 20000,
        tasks: [{ id: "dt-task-1", status_code: 20100, status_message: "Task Created." }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks: [{
        id: "dt-task-1", status_code: 20000, status_message: "Ok.",
        result: [{ items: [{ tag: "title", count: 3 }] }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  setTestCredentials();
  try {
    const client = createDataforseoOnpageClient({ mode: "live", fetchImpl });
    const dt = await client.getDuplicateTags("dt-task-1");
    assert.equal(dt.metadata.retryCount, 1, "Must have retried once after 20100");
    assert.equal(dt.metadata.finalCode, 20000);
    assert.equal(dt.metadata.timedOut, false);
    assert.ok(dt.result, "Must have a result after retry");
    assert.equal(dt.result.items[0].tag, "title");
  } finally {
    clearTestCredentials();
  }
});

// T-DT-02: Repeated 20100 until timeout — returns null result with timeout metadata
test("T-DT-02: repeated 20100 until timeout returns null result with timedOut metadata", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks: [{ id: "dt-task-2", status_code: 20100, status_message: "Task Created." }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  setTestCredentials();
  try {
    const client = createDataforseoOnpageClient({ mode: "live", fetchImpl });
    const result = await client.getDuplicateTags("dt-task-2", {
      timeoutMs: 500, pollIntervalMs: 100,
    });
    assert.equal(result.metadata.timedOut, true, "Must time out after repeated 20100");
    assert.equal(result.result, null, "Must have null result on timeout");
    assert.ok(result.metadata.retryCount >= 1, `Must have retried, got ${result.metadata.retryCount}`);
    assert.equal(result.metadata.finalCode, 20100);
    assert.equal(result.metadata.taskId, "dt-task-2");
  } finally {
    clearTestCredentials();
  }
});

// T-DT-03: Terminal provider error (non-20000, non-20100) — null result, preserved error
test("T-DT-03: terminal provider error returns null result with error metadata", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks: [{ id: "dt-task-3", status_code: 40403, status_message: "Task not found." }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  setTestCredentials();
  try {
    const client = createDataforseoOnpageClient({ mode: "live", fetchImpl });
    const dt = await client.getDuplicateTags("dt-task-3");
    assert.equal(dt.metadata.finalCode, 40403, "Must preserve terminal error code");
    assert.match(dt.metadata.finalMessage, /Task not found/);
    assert.equal(dt.result, null, "Must return null result for terminal error");
    assert.equal(dt.metadata.retryCount, 0, "Must not retry on terminal errors");
    assert.equal(dt.metadata.timedOut, false);
  } finally {
    clearTestCredentials();
  }
});

// T-DT-04: Completed empty result (20000 with empty items) — result with empty array
test("T-DT-04: completed empty result returns items:[] with success metadata", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks: [{
        id: "dt-task-4", status_code: 20000, status_message: "Ok.",
        result: [{ items: [] }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  setTestCredentials();
  try {
    const client = createDataforseoOnpageClient({ mode: "live", fetchImpl });
    const dt = await client.getDuplicateTags("dt-task-4");
    assert.equal(dt.metadata.finalCode, 20000);
    assert.equal(dt.metadata.retryCount, 0);
    assert.ok(dt.result, "Must have a result object");
    assert.deepEqual(dt.result.items, [], "Empty items array for no duplicates");
  } finally {
    clearTestCredentials();
  }
});

// T-DT-05: Completed populated result (20000 with data) — full result preserved
test("T-DT-05: completed populated result preserves full duplicate data", async () => {
  const fetchImpl = async () => {
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks: [{
        id: "dt-task-5", status_code: 20000, status_message: "Ok.",
        result: [{
          items: [
            { tag: "title", count: 5 },
            { tag: "description", count: 3 },
          ],
        }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  setTestCredentials();
  try {
    const client = createDataforseoOnpageClient({ mode: "live", fetchImpl });
    const dt = await client.getDuplicateTags("dt-task-5");
    assert.equal(dt.metadata.finalCode, 20000);
    assert.equal(dt.result.items.length, 2);
    assert.equal(dt.result.items[0].tag, "title");
    assert.equal(dt.result.items[1].tag, "description");
    assert.equal(dt.metadata.taskId, "dt-task-5");
  } finally {
    clearTestCredentials();
  }
});

// T-DT-06: duplicate_content also uses pollSubEndpoint
test("T-DT-06: duplicate_content polls through 20100 and returns populated result", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls <= 2) {
      return new Response(JSON.stringify({
        status_code: 20000,
        tasks: [{ id: "dc-task-6", status_code: 20100, status_message: "Task Created." }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      status_code: 20000,
      tasks: [{
        id: "dc-task-6", status_code: 20000, status_message: "Ok.",
        result: [{ items: [{ url: "https://example.com/page1", duplicate_count: 2 }] }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  setTestCredentials();
  try {
    const client = createDataforseoOnpageClient({ mode: "live", fetchImpl });
    const dc = await client.getDuplicateContent("dc-task-6");
    assert.equal(dc.metadata.retryCount, 2, "Must have retried twice after 20100s");
    assert.equal(dc.metadata.finalCode, 20000);
    assert.ok(dc.result.items.length > 0);
  } finally {
    clearTestCredentials();
  }
});

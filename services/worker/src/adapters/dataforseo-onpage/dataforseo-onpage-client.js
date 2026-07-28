/**
 * DataForSEO On-Page API Client
 *
 * Isolated client wrapper for DataForSEO On-Page API.
 * Credentials and provider-specific logic MUST NOT leak outside this module.
 *
 * Live mode: Calls DataForSEO REST API using DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.
 * Fixture mode: Reads from supplied fixture data (no credentials required).
 *
 * PRD v3.0 §8: Primary crawl provider for Vantage Phase 1.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";

// Task status values returned by the API
const TASK_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  READY: "ready",
});

// Terminal statuses (task will not change further)
const TERMINAL_STATUSES = new Set(["ready"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read credentials from the environment. Never log or expose these values.
 */
function getCredentials() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  return { login, password };
}

/**
 * Build a Basic auth header value from DataForSEO credentials.
 */
function basicAuth(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Response parsing (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Safely parse a DataForSEO API response body.
 *
 * Handles:
 *   - Normal JSON objects (response.json() already parsed)
 *   - Double-encoded JSON strings
 *   - Root-level status_code validation
 *
 * @param {object|string} body - Raw response body from the API.
 * @param {string} endpoint - API endpoint label for error messages.
 * @returns {object} Parsed and validated response object.
 */
export function parseDataforseoResponse(body, endpoint) {
  let parsed = body;

  // Handle double-encoded JSON
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error(
        `DataForSEO ${endpoint}: unable to parse response body as JSON`,
      );
    }
  }

  // Second parse for double-encoded responses
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error(
        `DataForSEO ${endpoint}: unable to parse response body as JSON (double-encoded)`,
      );
    }
  }

  // Validate root status_code when present
  if (
    parsed.status_code != null &&
    parsed.status_code !== 20000
  ) {
    throw new Error(
      `DataForSEO ${endpoint}: API error ` +
        `(status_code=${parsed.status_code}, ` +
        `message="${parsed.status_message || "unknown"}")`,
    );
  }

  return parsed;
}

/**
 * Extract and validate the first task result from a parsed DataForSEO response.
 *
 * @param {object} response - Parsed DataForSEO response object.
 * @param {string} endpoint - API endpoint label for error messages.
 * @returns {object} The first result object: response.tasks[0].result[0].
 */
export function extractTaskResult(response, endpoint, allowedStatusCodes = [20000]) {
  if (
    !response ||
    !response.tasks ||
    !Array.isArray(response.tasks) ||
    response.tasks.length === 0
  ) {
    throw new Error(
      `DataForSEO ${endpoint}: no tasks in response`,
    );
  }

  const task = response.tasks[0];

  if (
    task.status_code != null &&
    !allowedStatusCodes.includes(task.status_code)
  ) {
    throw new Error(
      `DataForSEO ${endpoint}: task error ` +
        `(status_code=${task.status_code}, ` +
        `message="${task.status_message || "unknown"}")`,
    );
  }

  if (
    !task.result ||
    !Array.isArray(task.result) ||
    task.result.length === 0
  ) {
    // Not an error — task may not be ready yet
    return null;
  }

  return task.result[0];
}

/**
 * Extract all items from paginated results across all tasks.
 *
 * @param {object} response - Parsed DataForSEO response object.
 * @returns {Array<object>} Flattened array of items.
 */
export function extractAllItems(response) {
  if (!response || !response.tasks || !Array.isArray(response.tasks)) {
    return [];
  }

  const items = [];
  for (const task of response.tasks) {
    if (task.status_code != null && task.status_code !== 20000) {
      continue;
    }
    if (task.result && Array.isArray(task.result)) {
      for (const result of task.result) {
        if (result.items && Array.isArray(result.items)) {
          items.push(...result.items);
        }
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Live API helpers
// ---------------------------------------------------------------------------

/**
 * POST to a DataForSEO endpoint. Returns parsed JSON or throws on failure.
 */
async function dataforseoPost(endpoint, body, { login, password, fetchImpl }) {
  const url = `${DATAFORSEO_BASE}${endpoint}`;
  const fetcher = fetchImpl || globalThis.fetch;
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      Authorization: basicAuth(login, password),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");

    // Categorize errors
    if (response.status === 429) {
      const err = new Error(
        `DataForSEO quota exhausted (429) for ${endpoint}`,
      );
      err.category = "rate_limit";
      err.httpStatus = 429;
      throw err;
    }

    if (response.status === 401 || response.status === 403) {
      const err = new Error(
        `DataForSEO authentication error (${response.status}) for ${endpoint}`,
      );
      err.category = "auth";
      err.httpStatus = response.status;
      throw err;
    }

    throw new Error(
      `DataForSEO API error (${response.status}) for ${endpoint}: ${errorText.slice(0, 500)}`,
    );
  }

  const rawText = await response.text();
  return parseDataforseoResponse(rawText, endpoint);
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

/**
 * Retry an async operation with exponential backoff.
 *
 * @param {Function} fn - Async function to retry.
 * @param {number} maxRetries - Maximum number of retries (default 2).
 * @param {number} baseDelayMs - Base delay in ms (default 1000).
 * @returns {Promise<any>} Result of fn().
 */
async function withRetry(fn, maxRetries = 2, baseDelayMs = 1000) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // Do not retry auth errors or 4xx client errors (except 429)
      if (
        error.category === "auth" ||
        (error.httpStatus && error.httpStatus >= 400 &&
         error.httpStatus < 500 && error.httpStatus !== 429)
      ) {
        throw error;
      }
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a DataForSEO On-Page API client.
 *
 * @param {object} opts
 * @param {"live"|"fixture"} opts.mode - Operating mode.
 * @param {object} [opts.fixtures] - Pre-loaded fixture data (used in tests).
 * @param {Function} [opts.fetchImpl] - Optional fetch implementation.
 * @returns {object} Client with taskPost, getTaskStatus, getSummary, getPages,
 *                   getLinks, getDuplicateTags, getDuplicateContent.
 */
export function createDataforseoOnpageClient(opts = {}) {
  const mode = opts.mode || "fixture";

  /**
   * Post a new On-Page task.
   *
   * POST /v3/on_page/task_post
   *
   * @param {string} target - Target domain (e.g. "example.com").
   * @param {object} [options] - Task configuration.
   * @param {number} [options.maxPages=500] - Maximum pages to crawl.
   * @param {number} [options.maxDepth] - Maximum crawl depth.
   * @param {boolean} [options.enableJavascript=false] - Enable JS rendering.
   * @param {boolean} [options.enableBrowserRendering=false] - Enable full browser rendering.
   * @param {boolean} [options.loadResources=false] - Load page resources.
   * @param {boolean} [options.enableSitemap=true] - Prefer sitemap URLs.
   * @param {Array<string>} [options.includePatterns] - URL include patterns.
   * @param {Array<string>} [options.excludePatterns] - URL exclude patterns.
   * @param {number} [options.maxExternalResources] - External resource limit.
   * @returns {Promise<{taskId: string, rawTask: object}>} Task ID and raw task data.
   */
  async function taskPost(target, options = {}) {
    if (mode === "fixture") {
      const fixtures = opts.fixtures || {};
      const taskFixture = fixtures.taskPost || {};
      return {
        taskId: taskFixture.taskId || "fixture-task-001",
        rawTask: taskFixture.rawTask || { id: "fixture-task-001" },
      };
    }

    const { login, password } = getCredentials();
    if (!login || !password) {
      throw new Error(
        "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required for live mode.",
      );
    }

    const body = [
      {
        target,
        max_crawl_pages: options.maxPages ?? 500,
        ...(options.maxDepth != null && { max_crawl_depth: options.maxDepth }),
        load_resources: options.loadResources ?? true,
        enable_javascript: options.enableJavascript ?? false,
        enable_browser_rendering: options.enableBrowserRendering ?? false,
        enable_xhr: options.enableJavascript ?? false,
        ...(options.includePatterns?.length && {
          custom_settings: {
            url_filters: {
              include: options.includePatterns,
              ...(options.excludePatterns?.length && {
                exclude: options.excludePatterns,
              }),
            },
          },
        }),
        ...(options.excludePatterns?.length &&
          !options.includePatterns?.length && {
            custom_settings: {
              url_filters: {
                exclude: options.excludePatterns,
              },
            },
          }),
        ...(options.maxExternalResources != null && {
          max_external_resources: options.maxExternalResources,
        }),
        check_spell: false,
        calculate_keyword_density: false,
        store_raw_html: false,
        validate_headings: true,
        validate_page_changes: false,
      },
    ];

    const submitFn = () =>
      dataforseoPost("/on_page/task_post", body, {
        login,
        password,
        fetchImpl: opts.fetchImpl,
      });

    const response = await withRetry(submitFn, 2, 1000);
    // task_post may return 20100 ("Task Created") in addition to 20000
    const result = extractTaskResult(response, "/on_page/task_post", [20000, 20100]);

    if (!result || !result.id) {
      throw new Error(
        "DataForSEO /on_page/task_post: no task ID in response",
      );
    }

    return {
      taskId: result.id,
      rawTask: result,
    };
  }

  /**
   * Poll task status until complete or timeout.
   *
   * Uses POST /v3/on_page/summary to check if results are available.
   *
   * @param {string} taskId - Task ID from task_post.
   * @param {object} [options]
   * @param {number} [options.timeoutMs=600000] - Max poll time (default 10 min).
   * @param {number} [options.pollIntervalMs=10000] - Interval between polls (default 10s).
   * @returns {Promise<{status: string, taskId: string}>}
   */
  async function pollTask(taskId, options = {}) {
    const timeoutMs = options.timeoutMs ?? 600000;
    const pollIntervalMs = options.pollIntervalMs ?? 10000;

    if (mode === "fixture") {
      const fixtures = opts.fixtures || {};
      const pollFixture = fixtures.pollTask || {};
      return {
        status: pollFixture.status || "ready",
        taskId,
      };
    }

    const { login, password } = getCredentials();
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const response = await dataforseoPost(
          "/on_page/summary",
          [{ id: taskId }],
          { login, password, fetchImpl: opts.fetchImpl },
        );

        const result = extractTaskResult(response, "/on_page/summary");

        if (result) {
          return { status: "ready", taskId };
        }

        // Task not ready — check task status via error info
        const task = response?.tasks?.[0];
        const statusCode = task?.status_code;
        const statusMessage = task?.status_message || "";

        if (statusCode === 20100) {
          // Task is still processing
          // continue polling
        } else if (statusCode && statusCode !== 20000) {
          throw new Error(
            `DataForSEO task ${taskId}: ${statusMessage || `status_code=${statusCode}`}`,
          );
        }
      } catch (error) {
        // If the error indicates the task is still processing, continue polling
        if (
          error.message &&
          (error.message.includes("20100") ||
           error.message.includes("Not all the tasks") ||
           error.message.includes("processing"))
        ) {
          // continue polling
        } else {
          throw error;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `DataForSEO task ${taskId}: polling timed out after ${timeoutMs}ms`,
    );
  }

  /**
   * Fetch summary results for a completed task.
   *
   * POST /v3/on_page/summary
   *
   * @param {string} taskId - Task ID.
   * @returns {Promise<object>} Summary result.
   */
  async function getSummary(taskId) {
    if (mode === "fixture") {
      const fixtures = opts.fixtures || {};
      const summaryFixture = fixtures.summary || fixtures.getSummary || {};
      return summaryFixture;
    }

    const { login, password } = getCredentials();
    const response = await dataforseoPost(
      "/on_page/summary",
      [{ id: taskId }],
      { login, password, fetchImpl: opts.fetchImpl },
    );

    const result = extractTaskResult(response, "/on_page/summary");
    if (!result) {
      throw new Error(
        `DataForSEO /on_page/summary: no result for task ${taskId}`,
      );
    }
    return result;
  }

  /**
   * Fetch paginated pages for a completed task.
   *
   * POST /v3/on_page/pages
   *
   * @param {string} taskId - Task ID.
   * @param {object} [options]
   * @param {number} [options.limit=100] - Page size.
   * @param {number} [options.offset=0] - Starting offset.
   * @returns {Promise<{items: Array<object>, totalCount: number}>}
   */
  async function getPages(taskId, options = {}) {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    if (mode === "fixture") {
      const fixtures = opts.fixtures || {};
      const pagesFixture = fixtures.pages || { items: [], total_count: 0 };
      // Support offset/limit slicing over fixture items
      const allItems = pagesFixture.items || [];
      const sliced = allItems.slice(offset, offset + limit);
      return {
        items: sliced,
        total_count: pagesFixture.total_count ?? allItems.length,
      };
    }

    const { login, password } = getCredentials();
    const body = [
      {
        id: taskId,
        limit,
        offset,
        ...(options.filters?.length && { filters: options.filters }),
        ...(options.orderBy?.length && { order_by: options.orderBy }),
      },
    ];

    const response = await dataforseoPost("/on_page/pages", body, {
      login,
      password,
      fetchImpl: opts.fetchImpl,
    });

    const result = extractTaskResult(response, "/on_page/pages");
    if (!result) {
      return { items: [], total_count: 0 };
    }

    return {
      items: result.items || [],
      total_count: result.total_count ?? (result.items || []).length,
    };
  }

  /**
   * Fetch all pages for a completed task (handles pagination).
   *
   * @param {string} taskId - Task ID.
   * @param {object} [options]
   * @param {number} [options.maxPages=500] - Maximum pages to fetch.
   * @param {number} [options.pageSize=100] - Page size for each request.
   * @returns {Promise<Array<object>>} Array of page items.
   */
  async function getAllPages(taskId, options = {}) {
    const maxPages = options.maxPages ?? 500;
    const pageSize = options.pageSize ?? 100;
    const allPages = [];
    let offset = 0;

    while (allPages.length < maxPages) {
      const result = await getPages(taskId, {
        limit: Math.min(pageSize, maxPages - allPages.length),
        offset,
        filters: options.filters,
        orderBy: options.orderBy,
      });

      if (!result.items || result.items.length === 0) break;

      allPages.push(...result.items);
      offset += result.items.length;

      if (result.items.length < pageSize) break;
    }

    return allPages;
  }

  /**
   * Fetch links for a completed task.
   *
   * POST /v3/on_page/links
   *
   * @param {string} taskId - Task ID.
   * @param {object} [options]
   * @param {number} [options.limit=100] - Page size.
   * @param {number} [options.offset=0] - Starting offset.
   * @returns {Promise<{items: Array<object>, totalCount: number}>}
   */
  async function getLinks(taskId, options = {}) {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    if (mode === "fixture") {
      const fixtures = opts.fixtures || {};
      const linksFixture = fixtures.links || { items: [], total_count: 0 };
      const allItems = linksFixture.items || [];
      return {
        items: allItems.slice(offset, offset + limit),
        total_count: linksFixture.total_count ?? allItems.length,
      };
    }

    const { login, password } = getCredentials();
    const body = [{ id: taskId, limit, offset }];

    const response = await dataforseoPost("/on_page/links", body, {
      login,
      password,
      fetchImpl: opts.fetchImpl,
    });

    const result = extractTaskResult(response, "/on_page/links");
    if (!result) {
      return { items: [], total_count: 0 };
    }

    return {
      items: result.items || [],
      total_count: result.total_count ?? (result.items || []).length,
    };
  }

  /**
   * Fetch all links for a completed task.
   *
   * @param {string} taskId - Task ID.
   * @param {object} [options]
   * @param {number} [options.maxLinks=10000] - Maximum links to fetch.
   * @returns {Promise<Array<object>>} Array of link items.
   */
  async function getAllLinks(taskId, options = {}) {
    const maxLinks = options.maxLinks ?? 10000;
    const pageSize = 100;
    const allLinks = [];
    let offset = 0;

    while (allLinks.length < maxLinks) {
      const result = await getLinks(taskId, {
        limit: Math.min(pageSize, maxLinks - allLinks.length),
        offset,
      });

      if (!result.items || result.items.length === 0) break;

      allLinks.push(...result.items);
      offset += result.items.length;
    }

    return allLinks;
  }

  /**
   * Fetch duplicate tags for a completed task.
   *
   * POST /v3/on_page/duplicate_tags
   *
   * @param {string} taskId - Task ID.
   * @returns {Promise<object>} Duplicate tags result.
   */
  async function getDuplicateTags(taskId) {
    if (mode === "fixture") {
      const fixtures = opts.fixtures || {};
      return fixtures.duplicateTags || {};
    }

    const { login, password } = getCredentials();
    const response = await dataforseoPost(
      "/on_page/duplicate_tags",
      [{ id: taskId }],
      { login, password, fetchImpl: opts.fetchImpl },
    );

    const result = extractTaskResult(response, "/on_page/duplicate_tags");
    if (!result) {
      return { items: [] };
    }
    return result;
  }

  /**
   * Fetch duplicate content for a completed task.
   *
   * POST /v3/on_page/duplicate_content
   *
   * @param {string} taskId - Task ID.
   * @returns {Promise<object>} Duplicate content result.
   */
  async function getDuplicateContent(taskId) {
    if (mode === "fixture") {
      const fixtures = opts.fixtures || {};
      return fixtures.duplicateContent || {};
    }

    const { login, password } = getCredentials();
    const response = await dataforseoPost(
      "/on_page/duplicate_content",
      [{ id: taskId }],
      { login, password, fetchImpl: opts.fetchImpl },
    );

    const result = extractTaskResult(response, "/on_page/duplicate_content");
    if (!result) {
      return { items: [] };
    }
    return result;
  }

  /**
   * Get the raw task metadata for artifact preservation.
   *
   * @param {string} taskId - Task ID.
   * @returns {Promise<object>} Raw task data for artifact storage.
   */
  async function getRawTaskArtifact(taskId) {
    return {
      taskId,
      provider: "dataforseo-onpage",
      collectedAt: new Date().toISOString(),
    };
  }

  return {
    taskPost,
    pollTask,
    getSummary,
    getPages,
    getAllPages,
    getLinks,
    getAllLinks,
    getDuplicateTags,
    getDuplicateContent,
    getRawTaskArtifact,
    TASK_STATUS,
  };
}

export { TASK_STATUS, TERMINAL_STATUSES };

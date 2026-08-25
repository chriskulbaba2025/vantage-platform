/**
 * DataForSEO SERP API Client
 *
 * Queries the DataForSEO SERP API for localized organic search results.
 * Used by the competitor opportunity layer to discover SERP-based competitors
 * for specific topics in the audit's geographic market.
 *
 * Credentials: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD (same as other adapters).
 * Never log or expose credentials.
 *
 * API: POST /v3/serp/google/organic/live/advanced
 */

import { normalizeLanguage } from "./locale-normalizer.js";
import { resolveLocation } from "./location-resolver.js";

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";
const SERP_ENDPOINT = `${DATAFORSEO_BASE}/serp/google/organic/live/advanced`;

const API_SUCCESS_CODE = 20000;
const TASK_SUCCESS_CODES = Object.freeze(new Set([20000]));

const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const MAX_TRANSIENT_RETRIES = 1;

const RETRYABLE_TRANSPORT_CODES = Object.freeze(new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]));

const SERP_ERROR_TYPE = Object.freeze({
  CONFIGURATION: "CONFIGURATION",
  LOCATION: "LOCATION",
  HTTP: "HTTP",
  API_RESPONSE: "API_RESPONSE",
  TASK: "TASK",
  TIMEOUT: "TIMEOUT",
  TRANSPORT_OR_PARSE: "TRANSPORT_OR_PARSE",
});

function basicAuth(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

function buildSerpTask(keyword, normalized) {
  const task = {
    keyword,
    language_name: normalized.languageName || "English",
    device: "desktop",
    os: "windows",
    depth: 20,
  };

  if (normalized.locationCode != null) {
    task.location_code = normalized.locationCode;
  } else if (normalized.locationName) {
    task.location_name = normalized.locationName;
  } else {
    task.location_name = "Canada";
  }

  return task;
}

function normalizeSerpItem(item, topic, location, language) {
  return {
    candidateUrl: item.url || "",
    domain: item.domain || "",
    title: item.title || "",
    position: item.rank_absolute || item.rank_group || null,
    topic,
    discoverySource: "dataforseo-serp",
    geographicContext: location || "Canada",
    languageContext: language || "English",
    pageType: inferPageType(item),
    rawArtifactRef: `dataforseo://serp/${item.rank_absolute || "unknown"}`,
    serpFeatures: item.featured_snippet ? ["featured_snippet"] : [],
    hasSchema: detectSchema(item),
  };
}

function inferPageType(item) {
  const url = (item.url || "").toLowerCase();

  if (/contact|about-us|team|location|hours/i.test(url)) return "company_page";
  if (/blog|article|news|guide|how-to|what-is/i.test(url)) return "content";
  if (/pricing|plans|cost|quote|estimate/i.test(url)) return "pricing";
  if (/product|shop|store|buy/i.test(url)) return "product";
  if (/service|solutions|capabilities/i.test(url)) return "service";
  if (/faq|questions|help/i.test(url)) return "support";
  if (/directory\.|yellowpages|yelp\.|hotfrog|118|tripadvisor|facebook\.com\/pg|linkedin\.com\/company/i.test(url)) return "directory";
  if (/facebook\.com|instagram\.com|twitter\.com|linkedin\.com\/in|youtube\.com\/@/i.test(url)) return "social";
  if (/amazon\.|ebay\.|etsy\.|shopify\.|alibaba\./i.test(url)) return "marketplace";
  if (/wikipedia\.org|britannica\.|news\.|cnn\.|bbc\.|reuters\./i.test(url)) return "reference";
  if (/reddit\.com|quora\.com|medium\.com|forum\./i.test(url)) return "community";

  return "landing";
}

function detectSchema(item) {
  if (!item) return [];

  const signals = [];

  if (item.rich_snippet?.type) signals.push("rich_snippet");
  if (item.featured_snippet) signals.push("featured_snippet");
  if (item.sitelinks?.length) signals.push("sitelinks");
  if (item.reviews?.length) signals.push("reviews");
  if (item.rating) signals.push("rating");

  return signals;
}

function validateApiResponse(data) {
  if (!data || typeof data !== "object") {
    return {
      valid: false,
      error: "SERP API returned non-object response",
      errorType: SERP_ERROR_TYPE.API_RESPONSE,
      statusCode: null,
    };
  }

  if (data.status_code !== API_SUCCESS_CODE) {
    const code = data.status_code;
    const msg = data.status_message || "missing top-level status code";

    return {
      valid: false,
      error: `SERP API top-level status ${code != null ? code : "missing"}: ${msg}`,
      errorType: SERP_ERROR_TYPE.API_RESPONSE,
      statusCode: code ?? null,
    };
  }

  const tasks = data.tasks || [];

  if (tasks.length === 0) {
    return {
      valid: false,
      error: "SERP API returned no tasks",
      errorType: SERP_ERROR_TYPE.API_RESPONSE,
      statusCode: null,
    };
  }

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const taskCode = task.status_code;

    if (taskCode == null) {
      const fallbackMsg = "missing task status code";

      return {
        valid: false,
        error: `SERP task ${i} failed: ${fallbackMsg}`,
        errorType: SERP_ERROR_TYPE.TASK,
        statusCode: null,
        taskError: {
          taskId: task.id || null,
          statusCode: null,
          statusMessage: fallbackMsg,
          endpoint: SERP_ENDPOINT,
        },
      };
    }

    if (!TASK_SUCCESS_CODES.has(taskCode)) {
      const taskMsg = task.status_message || "unknown task error";

      return {
        valid: false,
        error: `SERP task ${i} failed: status_code=${taskCode}, message="${taskMsg}"`,
        errorType: SERP_ERROR_TYPE.TASK,
        statusCode: taskCode,
        taskError: {
          taskId: task.id || null,
          statusCode: taskCode,
          statusMessage: taskMsg,
          endpoint: SERP_ENDPOINT,
        },
      };
    }
  }

  return {
    valid: true,
    error: null,
    errorType: null,
    statusCode: null,
  };
}

function classifyException(error) {
  const message = String(
    error?.message || error || "Unknown SERP request error",
  );

  const isTimeout =
    error?.name === "AbortError" ||
    error?.name === "TimeoutError" ||
    /timed?\s*out|timeout/i.test(message);

  return {
    error: message,
    errorType: isTimeout
      ? SERP_ERROR_TYPE.TIMEOUT
      : SERP_ERROR_TYPE.TRANSPORT_OR_PARSE,
  };
}

function createTimeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  return error;
}

function createAbortError(label) {
  const error = new Error(`${label} aborted`);
  error.name = "AbortError";
  return error;
}

function callerAbortReason(signal, label) {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  return createAbortError(label);
}

function normalizeRequestTimeoutMs(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeRetryLimit(value) {
  if (!Number.isInteger(value)) {
    return MAX_TRANSIENT_RETRIES;
  }

  return Math.max(0, Math.min(MAX_TRANSIENT_RETRIES, value));
}

/**
 * Build a request-scoped AbortSignal.
 *
 * Two cancellation sources are combined:
 *
 * 1. the caller/orchestration signal;
 * 2. the SERP request-local hard timeout.
 *
 * The live fetch receives this signal directly. A retry cannot begin until
 * the previous fetch has settled/rejected, so provider requests remain
 * sequential rather than overlapping.
 */
function createRequestAbortContext(parentSignal, timeoutMs, label) {
  const controller = new AbortController();

  let timedOut = false;
  let callerAborted = false;
  let timeoutHandle = null;

  const abortFromCaller = () => {
    callerAborted = true;

    if (!controller.signal.aborted) {
      controller.abort(callerAbortReason(parentSignal, `${label} by caller`));
    }
  };

  if (parentSignal?.aborted) {
    abortFromCaller();
  } else if (typeof parentSignal?.addEventListener === "function") {
    parentSignal.addEventListener("abort", abortFromCaller, { once: true });
  }

  if (!controller.signal.aborted) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;

      if (!controller.signal.aborted) {
        controller.abort(createTimeoutError(label, timeoutMs));
      }
    }, timeoutMs);
  }

  return {
    signal: controller.signal,

    didTimeout() {
      return timedOut;
    },

    didCallerAbort() {
      return callerAborted;
    },

    cleanup() {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      if (typeof parentSignal?.removeEventListener === "function") {
        parentSignal.removeEventListener("abort", abortFromCaller);
      }
    },
  };
}

function isRetryableHttpStatus(status) {
  return Number.isInteger(status) && status >= 500 && status <= 599;
}

function isRetryableTransportError(error) {
  if (!error) return false;

  const name = String(error.name || "");
  if (name === "AbortError" || name === "TimeoutError") {
    return true;
  }

  const code = String(
    error.code ||
    error.cause?.code ||
    "",
  ).toUpperCase();

  if (RETRYABLE_TRANSPORT_CODES.has(code)) {
    return true;
  }

  if (error instanceof TypeError) {
    return true;
  }

  const message = String(error.message || error);

  return /fetch failed|network|socket|connection reset|connection refused|temporary|econn|eai_again|enet|ehost|timed?\s*out|timeout/i.test(
    message,
  );
}

function buildFailureResult({
  error,
  errorType,
  errorStatusCode = null,
  rawTaskId = null,
  taskError = null,
  normalizedLanguage,
  normalizedLocation,
}) {
  return {
    items: [],
    rawTaskId,
    error,
    errorType,
    errorStatusCode,
    ...(taskError ? { taskError } : {}),
    normalizedLanguage,
    normalizedLocation,
  };
}
export async function querySerp(keyword, options = {}) {
  const login = options.login || "";
  const password = options.password || "";
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const callerSignal = options.signal || null;

  const requestTimeoutMs = normalizeRequestTimeoutMs(
    options.requestTimeoutMs,
  );

  const maxTransientRetries = normalizeRetryLimit(
    options.maxTransientRetries,
  );

  const langResult = normalizeLanguage(options.language || "en");
  const locResult = resolveLocation(options.location || "Canada");

  if (!login || !password) {
    return buildFailureResult({
      error: "DataForSEO credentials not configured",
      errorType: SERP_ERROR_TYPE.CONFIGURATION,
      normalizedLanguage: langResult,
      normalizedLocation: locResult,
    });
  }

  if (locResult.error) {
    return buildFailureResult({
      error: `Location resolution failed: ${locResult.error}`,
      errorType: SERP_ERROR_TYPE.LOCATION,
      normalizedLanguage: langResult,
      normalizedLocation: locResult,
    });
  }

  if (callerSignal?.aborted) {
    const classified = classifyException(
      callerAbortReason(
        callerSignal,
        `DataForSEO SERP request for "${keyword}"`,
      ),
    );

    return buildFailureResult({
      error: classified.error,
      errorType: classified.errorType,
      normalizedLanguage: langResult,
      normalizedLocation: locResult,
    });
  }

  const task = buildSerpTask(keyword, {
    languageName: langResult.languageName,
    locationName: locResult.locationName,
    locationCode: locResult.locationCode,
  });

  for (let attempt = 0; attempt <= maxTransientRetries; attempt++) {
    if (callerSignal?.aborted) {
      const classified = classifyException(
        callerAbortReason(
          callerSignal,
          `DataForSEO SERP request for "${keyword}"`,
        ),
      );

      return buildFailureResult({
        error: classified.error,
        errorType: classified.errorType,
        normalizedLanguage: langResult,
        normalizedLocation: locResult,
      });
    }

    const requestLabel =
      `DataForSEO SERP request for "${keyword}"`;

    const abortContext = createRequestAbortContext(
      callerSignal,
      requestTimeoutMs,
      requestLabel,
    );

    let phase = "fetch";

    try {
      const response = await fetchImpl(SERP_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: basicAuth(login, password),
          "content-type": "application/json",
        },
        body: JSON.stringify([task]),
        signal: abortContext.signal,
      });

      phase = "body";

      if (!response.ok) {
        const text = await response.text().catch(() => "");

        if (callerSignal?.aborted) {
          throw callerAbortReason(callerSignal, requestLabel);
        }

        const failure = buildFailureResult({
          error: `SERP API ${response.status}: ${text.slice(0, 200)}`,
          errorType: SERP_ERROR_TYPE.HTTP,
          errorStatusCode: response.status,
          normalizedLanguage: langResult,
          normalizedLocation: locResult,
        });

        if (
          isRetryableHttpStatus(response.status) &&
          attempt < maxTransientRetries &&
          !callerSignal?.aborted
        ) {
          continue;
        }

        return failure;
      }

      phase = "parse";

      let data;

      try {
        data = await response.json();
      } catch (error) {
        /*
         * Invalid provider JSON is not blindly retried. A SyntaxError means
         * the HTTP request completed but the payload could not be parsed.
         *
         * A TypeError or other transport-style body failure may still be
         * retried by the outer catch below.
         */
        if (error instanceof SyntaxError) {
          const classified = classifyException(error);

          return buildFailureResult({
            error: classified.error,
            errorType: classified.errorType,
            normalizedLanguage: langResult,
            normalizedLocation: locResult,
          });
        }

        throw error;
      }

      if (callerSignal?.aborted) {
        throw callerAbortReason(callerSignal, requestLabel);
      }

      phase = "validate";

      const validation = validateApiResponse(data);

      /*
       * Provider/API/task-level failures are authoritative responses, not
       * transport failures.
       *
       * In particular DataForSEO task status 40101 is intentionally not
       * retried here. Retrying the full paid request would duplicate work
       * after DataForSEO has already attempted the search internally.
       */
      if (!validation.valid) {
        return buildFailureResult({
          rawTaskId: validation.taskError?.taskId || null,
          error: validation.error,
          errorType: validation.errorType,
          errorStatusCode: validation.statusCode,
          taskError: validation.taskError || null,
          normalizedLanguage: langResult,
          normalizedLocation: locResult,
        });
      }

      const serpTask = data.tasks[0];
      const rawTaskId = serpTask.id || null;
      const resultItems = serpTask.result?.[0]?.items || [];

      const items = resultItems
        .filter((item) => item.type === "organic")
        .map((item) => normalizeSerpItem(
          item,
          keyword,
          locResult.originalLocation || locResult.locationName,
          langResult.originalLanguage || langResult.languageName,
        ));

      return {
        items,
        rawTaskId,
        error: null,
        errorType: null,
        errorStatusCode: null,
        normalizedLanguage: langResult,
        normalizedLocation: locResult,
      };
    } catch (error) {
      const callerAborted =
        abortContext.didCallerAbort() ||
        callerSignal?.aborted === true;

      const localTimedOut = abortContext.didTimeout();

      /*
       * If our request-local timer caused the abort, normalize the error so
       * the result deterministically records a timeout even when the fetch
       * implementation returns a generic AbortError.
       */
      const effectiveError =
        localTimedOut && !callerAborted
          ? createTimeoutError(requestLabel, requestTimeoutMs)
          : error;

      const classified = classifyException(effectiveError);

      /*
       * Retry only an individual request that actually settled/rejected.
       *
       * Never retry:
       * - after caller/orchestration cancellation;
       * - after the single permitted transient retry;
       * - provider/API/task validation failures;
       * - deterministic JSON SyntaxError failures.
       *
       * Because this catch runs only after the awaited request has rejected,
       * the next attempt cannot overlap this request.
       */
      const retryable =
        !callerAborted &&
        attempt < maxTransientRetries &&
        (
          localTimedOut ||
          (
            phase !== "validate" &&
            isRetryableTransportError(error)
          )
        );

      if (retryable) {
        continue;
      }

      return buildFailureResult({
        error: classified.error,
        errorType: classified.errorType,
        normalizedLanguage: langResult,
        normalizedLocation: locResult,
      });
    } finally {
      abortContext.cleanup();
    }
  }

  /*
   * Defensive fallback. The bounded loop above always returns, but keeping a
   * deterministic failure protects callers if the retry boundary is changed
   * incorrectly in the future.
   */
  return buildFailureResult({
    error: `DataForSEO SERP request for "${keyword}" exhausted its request attempts`,
    errorType: SERP_ERROR_TYPE.TRANSPORT_OR_PARSE,
    normalizedLanguage: langResult,
    normalizedLocation: locResult,
  });
}

export {
  SERP_ERROR_TYPE,
  validateApiResponse,
  classifyException,
  isRetryableHttpStatus,
  isRetryableTransportError,
};
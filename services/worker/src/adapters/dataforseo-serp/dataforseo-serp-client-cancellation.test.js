import test from "node:test";
import assert from "node:assert/strict";

import {
  querySerp,
  SERP_ERROR_TYPE,
} from "./dataforseo-serp-client.js";

function successPayload() {
  return {
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: "task-success-001",
        status_code: 20000,
        status_message: "Ok.",
        result: [
          {
            items: [
              {
                type: "organic",
                url: "https://example.com/service",
                domain: "example.com",
                title: "Example Service",
                rank_absolute: 1,
              },
            ],
          },
        ],
      },
    ],
  };
}

function task40101Payload() {
  return {
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: "task-40101",
        status_code: 40101,
        status_message: "Internal SE Server Error",
        result: null,
      },
    ],
  };
}

function successfulResponse(payload = successPayload()) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

test("DQV-001: caller AbortSignal reaches the live SERP fetch and stops retry", async () => {
  const caller = new AbortController();

  let fetchCalls = 0;
  let observedSignal = null;

  const fetchImpl = async (_url, init) => {
    fetchCalls += 1;
    observedSignal = init.signal;

    return await new Promise((_resolve, reject) => {
      if (init.signal.aborted) {
        const error = new Error("fetch aborted");
        error.name = "AbortError";
        reject(error);
        return;
      }

      init.signal.addEventListener(
        "abort",
        () => {
          const error = new Error("fetch aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });
  };

  const pending = querySerp("Group Coaching", {
    login: "test-login",
    password: "test-password",
    fetchImpl,
    signal: caller.signal,
    requestTimeoutMs: 1000,
    maxTransientRetries: 1,
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(observedSignal, "fetch received an AbortSignal");
  assert.equal(observedSignal.aborted, false);

  caller.abort();

  const result = await pending;

  assert.equal(fetchCalls, 1, "caller abort prevents a second provider request");
  assert.equal(observedSignal.aborted, true, "fetch signal was actually aborted");
  assert.equal(result.errorType, SERP_ERROR_TYPE.TIMEOUT);
  assert.equal(result.items.length, 0);
});

test("DQV-001: request-local timeout aborts the underlying fetch", async () => {
  let fetchCalls = 0;
  let observedSignal = null;

  const fetchImpl = async (_url, init) => {
    fetchCalls += 1;
    observedSignal = init.signal;

    return await new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => {
          const error = new Error("provider request aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });
  };

  const result = await querySerp("Group Coaching", {
    login: "test-login",
    password: "test-password",
    fetchImpl,
    requestTimeoutMs: 10,
    maxTransientRetries: 0,
  });

  assert.equal(fetchCalls, 1);
  assert.ok(observedSignal, "fetch received a request-scoped signal");
  assert.equal(observedSignal.aborted, true);
  assert.equal(result.errorType, SERP_ERROR_TYPE.TIMEOUT);
  assert.match(result.error, /timed out/i);
});

test("DQV-001: one transient retry is sequential and never overlaps the first request", async () => {
  let fetchCalls = 0;
  let activeRequests = 0;
  let maxConcurrentRequests = 0;

  const fetchImpl = async () => {
    fetchCalls += 1;
    activeRequests += 1;
    maxConcurrentRequests = Math.max(
      maxConcurrentRequests,
      activeRequests,
    );

    if (fetchCalls === 1) {
      return await new Promise((_resolve, reject) => {
        setImmediate(() => {
          activeRequests -= 1;
          reject(new TypeError("fetch failed"));
        });
      });
    }

    return await new Promise((resolve) => {
      setImmediate(() => {
        activeRequests -= 1;
        resolve(successfulResponse());
      });
    });
  };

  const result = await querySerp("Group Coaching", {
    login: "test-login",
    password: "test-password",
    fetchImpl,
    requestTimeoutMs: 1000,
    maxTransientRetries: 1,
  });

  assert.equal(fetchCalls, 2, "one transient retry occurred");
  assert.equal(
    maxConcurrentRequests,
    1,
    "the retry did not overlap the failed request",
  );
  assert.equal(result.error, null);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].candidateUrl, "https://example.com/service");
});

test("DQV-001: DataForSEO task status 40101 is terminal for that keyword and is not retried", async () => {
  let fetchCalls = 0;

  const fetchImpl = async () => {
    fetchCalls += 1;
    return successfulResponse(task40101Payload());
  };

  const result = await querySerp("4-Week Reboot Series", {
    login: "test-login",
    password: "test-password",
    fetchImpl,
    requestTimeoutMs: 1000,
    maxTransientRetries: 1,
  });

  assert.equal(
    fetchCalls,
    1,
    "40101 must not create another paid SERP request",
  );
  assert.equal(result.errorType, SERP_ERROR_TYPE.TASK);
  assert.equal(result.errorStatusCode, 40101);
  assert.equal(result.rawTaskId, "task-40101");
  assert.match(result.error, /40101/);
});

test("DQV-001: HTTP 5xx receives at most one sequential retry", async () => {
  let fetchCalls = 0;
  let activeRequests = 0;
  let maxConcurrentRequests = 0;

  const fetchImpl = async () => {
    fetchCalls += 1;
    activeRequests += 1;
    maxConcurrentRequests = Math.max(
      maxConcurrentRequests,
      activeRequests,
    );

    if (fetchCalls === 1) {
      activeRequests -= 1;

      return {
        ok: false,
        status: 503,
        text: async () => "temporary upstream failure",
      };
    }

    activeRequests -= 1;
    return successfulResponse();
  };

  const result = await querySerp("Group Coaching", {
    login: "test-login",
    password: "test-password",
    fetchImpl,
    requestTimeoutMs: 1000,
    maxTransientRetries: 1,
  });

  assert.equal(fetchCalls, 2);
  assert.equal(maxConcurrentRequests, 1);
  assert.equal(result.error, null);
  assert.equal(result.items.length, 1);
});
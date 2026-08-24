import test from "node:test";
import assert from "node:assert/strict";

import { execute } from "./serp-adapter.js";

function successResponse({
  taskId,
  url,
  title,
}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status_code: 20000,
      status_message: "Ok.",
      tasks: [
        {
          id: taskId,
          status_code: 20000,
          status_message: "Ok.",
          result: [
            {
              items: [
                {
                  type: "organic",
                  url,
                  domain: new URL(url).hostname,
                  title,
                  rank_absolute: 1,
                },
              ],
            },
          ],
        },
      ],
    }),
    text: async () => "",
  };
}

function taskFailureResponse({
  taskId,
  statusCode = 40101,
  statusMessage = "Internal SE Server Error",
}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status_code: 20000,
      status_message: "Ok.",
      tasks: [
        {
          id: taskId,
          status_code: statusCode,
          status_message: statusMessage,
          result: null,
        },
      ],
    }),
    text: async () => "",
  };
}

async function withCredentials(fn) {
  const previousLogin = process.env.DATAFORSEO_LOGIN;
  const previousPassword = process.env.DATAFORSEO_PASSWORD;

  process.env.DATAFORSEO_LOGIN = "test-login";
  process.env.DATAFORSEO_PASSWORD = "test-password";

  try {
    return await fn();
  } finally {
    if (previousLogin === undefined) {
      delete process.env.DATAFORSEO_LOGIN;
    } else {
      process.env.DATAFORSEO_LOGIN = previousLogin;
    }

    if (previousPassword === undefined) {
      delete process.env.DATAFORSEO_PASSWORD;
    } else {
      process.env.DATAFORSEO_PASSWORD = previousPassword;
    }
  }
}

test(
  "DQV-001: adapter cancellation reaches the active SERP request and prevents another keyword request",
  async () => {
    await withCredentials(async () => {
      const controller = new AbortController();

      let fetchCalls = 0;
      let activeSignal = null;

      const fetchImpl = async (_url, init) => {
        fetchCalls += 1;
        activeSignal = init.signal;

        return await new Promise((_resolve, reject) => {
          if (init.signal.aborted) {
            const error = new Error("request aborted");
            error.name = "AbortError";
            reject(error);
            return;
          }

          init.signal.addEventListener(
            "abort",
            () => {
              const error = new Error("request aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      };

      const pending = execute({
        auditRequest: {
          services: [
            "Group Coaching",
            "Executive Coaching",
          ],
          market: "Canada",
          language: "en",
          serp: {
            fetchImpl,
          },
        },
        source: "dataforseo-serp",
        executionId: "dgv-001-adapter-abort",
        sourceExecutionKey: "source-key",
        signal: controller.signal,
        attempt: 1,
      });

      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(fetchCalls, 1);
      assert.ok(activeSignal);
      assert.equal(activeSignal.aborted, false);

      controller.abort();

      const result = await pending;

      assert.equal(
        fetchCalls,
        1,
        "adapter must not start another keyword request after caller abort",
      );

      assert.equal(
        activeSignal.aborted,
        true,
        "active provider request must be aborted",
      );

      assert.equal(result.sourceResult.status, "FAILED");
      assert.equal(
        result.sourceResult.errorCategory,
        "timeout",
      );

      assert.ok(
        result.rawBytes,
        "graceful aborted execution retains a raw artifact",
      );
    });
  },
);

test(
  "DQV-001: completed SERP evidence survives cancellation of a later keyword",
  async () => {
    await withCredentials(async () => {
      const controller = new AbortController();

      let fetchCalls = 0;
      let secondRequestStartedResolve;

      const secondRequestStarted = new Promise((resolve) => {
        secondRequestStartedResolve = resolve;
      });

      const fetchImpl = async (_url, init) => {
        fetchCalls += 1;

        if (fetchCalls === 1) {
          return successResponse({
            taskId: "task-first-success",
            url: "https://example.com/group-coaching",
            title: "Group Coaching",
          });
        }

        secondRequestStartedResolve();

        return await new Promise((_resolve, reject) => {
          if (init.signal.aborted) {
            const error = new Error("request aborted");
            error.name = "AbortError";
            reject(error);
            return;
          }

          init.signal.addEventListener(
            "abort",
            () => {
              const error = new Error("request aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      };

      const pending = execute({
        auditRequest: {
          services: [
            "Group Coaching",
            "Executive Coaching",
            "Leadership Coaching",
          ],
          market: "Canada",
          language: "en",
          serp: {
            fetchImpl,
          },
        },
        source: "dataforseo-serp",
        executionId: "dgv-001-preserve-partial",
        sourceExecutionKey: "source-key",
        signal: controller.signal,
        attempt: 1,
      });

      await secondRequestStarted;
      controller.abort();

      const result = await pending;

      assert.equal(
        fetchCalls,
        2,
        "third keyword must not start after cancellation",
      );

      assert.equal(
        result.sourceResult.status,
        "PARTIAL",
      );

      assert.equal(
        result.sourceResult.evidence.serpStatus,
        "PARTIAL",
      );

      assert.equal(
        result.sourceResult.coverage.requested,
        3,
      );

      assert.equal(
        result.sourceResult.coverage.completed,
        1,
      );

      assert.equal(
        result.sourceResult.coverage.failed,
        2,
      );

      assert.equal(
        result.sourceResult.returnedRecords,
        1,
      );

      assert.equal(
        result.sourceResult.evidence.competitors.length,
        1,
      );

      assert.equal(
        result.sourceResult.evidence.competitors[0].candidateUrl,
        "https://example.com/group-coaching",
      );

      assert.ok(
        result.rawBytes,
        "partial evidence must retain its raw artifact",
      );

      const raw = JSON.parse(
        result.rawBytes.toString("utf-8"),
      );

      assert.equal(raw.serpStatus, "PARTIAL");

      assert.equal(
        raw.items[0].candidateUrl,
        "https://example.com/group-coaching",
      );
    });
  },
);

test(
  "DQV-001: completed keyword evidence survives a later DataForSEO task failure",
  async () => {
    await withCredentials(async () => {
      let fetchCalls = 0;

      const fetchImpl = async () => {
        fetchCalls += 1;

        if (fetchCalls === 1) {
          return successResponse({
            taskId: "task-success",
            url: "https://example.com/group-coaching",
            title: "Group Coaching",
          });
        }

        return taskFailureResponse({
          taskId: "task-40101",
        });
      };

      const result = await execute({
        auditRequest: {
          services: [
            "Group Coaching",
            "4-Week Reboot Series",
          ],
          market: "Canada",
          language: "en",
          serp: {
            fetchImpl,
          },
        },
        source: "dataforseo-serp",
        executionId: "dgv-001-task-failure",
        sourceExecutionKey: "source-key",
        signal: new AbortController().signal,
        attempt: 1,
      });

      assert.equal(
        fetchCalls,
        2,
        "40101 must not cause an additional paid request",
      );

      assert.equal(
        result.sourceResult.status,
        "PARTIAL",
      );

      assert.equal(
        result.sourceResult.evidence.serpStatus,
        "PARTIAL",
      );

      assert.equal(
        result.sourceResult.returnedRecords,
        1,
      );

      assert.equal(
        result.sourceResult.evidence.competitors.length,
        1,
      );

      assert.equal(
        result.sourceResult.evidence.competitors[0].candidateUrl,
        "https://example.com/group-coaching",
      );

      assert.ok(
        result.sourceResult.limitations.some(
          (entry) => /40101/.test(entry),
        ),
      );

      assert.ok(result.rawBytes);
    });
  },
);
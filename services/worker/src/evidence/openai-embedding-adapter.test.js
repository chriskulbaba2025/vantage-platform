import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAIEmbeddingAdapter, EMBEDDING_DIMENSIONS } from "./openai-embedding-adapter.js";

const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0);

test("embedding adapter is absent without a configured provider key", () => {
  assert.equal(createOpenAIEmbeddingAdapter({ env: {}, fetchImpl: async () => { throw new Error("must not call"); } }), null);
});

test("embedding adapter sends governed model and dimensions without exposing its key", async () => {
  const calls = [];
  const adapter = createOpenAIEmbeddingAdapter({
    env: { OPENAI_API_KEY: "test-only-secret", PRYSM_EMBEDDING_MODEL: "test-embedding-v1", PRYSM_EMBEDDING_TIMEOUT_MS: "100" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, async json() { return { data: [{ embedding: vector }] }; } };
    },
  });
  assert.equal(adapter.modelVersion, "test-embedding-v1");
  assert.deepEqual(await adapter.embed("proof customers can trust"), vector);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/embeddings");
  assert.equal(calls[0].init.headers.authorization, "Bearer test-only-secret");
  assert.deepEqual(JSON.parse(calls[0].init.body), { input: "proof customers can trust", model: "test-embedding-v1", dimensions: 1536, encoding_format: "float" });
});

test("retryable provider failure is bounded and classified", async () => {
  let calls = 0;
  const adapter = createOpenAIEmbeddingAdapter({
    env: { OPENAI_API_KEY: "test-only-secret", PRYSM_EMBEDDING_MAX_ATTEMPTS: "2" },
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, async json() { return {}; } };
      return { ok: true, status: 200, async json() { return { data: [{ embedding: vector }] }; } };
    },
  });
  assert.deepEqual(await adapter.embed("bounded retry"), vector);
  assert.equal(calls, 2);
});

test("invalid provider vector fails closed", async () => {
  const adapter = createOpenAIEmbeddingAdapter({
    env: { OPENAI_API_KEY: "test-only-secret" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() { return { data: [{ embedding: [1, 2] }] }; },
    }),
  });
  await assert.rejects(adapter.embed("invalid"), (error) => error.category === "provider_payload");
});

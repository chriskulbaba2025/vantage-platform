import test from "node:test";
import assert from "node:assert/strict";
import { discoverRenderedStructuralUrls } from "./rendered-url-discovery.js";

function browserFixture() {
  const calls = [];
  const browser = {
    async newPage() {
      return {
        async goto(url) { calls.push(url); },
        locator() {
          return { evaluateAll: async () => [
            { url: "https://example.com/services/", status: "AVAILABLE" },
            { url: "https://example.com/pricing#plans", status: "AVAILABLE" },
            { url: "https://other.example/not-client", status: "AVAILABLE" },
          ] };
        },
        async close() {},
      };
    },
    async close() {},
  };
  return { chromium: { launch: async () => browser }, calls };
}

test("bounded rendered discovery preserves same-origin provenance and caps structural visits", async () => {
  const fixture = browserFixture();
  const result = await discoverRenderedStructuralUrls("https://example.com/", {
    browserImpl: fixture.chromium,
    maxPages: 2,
  });
  assert.equal(result.bounded, true);
  assert.equal(result.pagesAttempted, 2);
  assert.equal(fixture.calls.length, 2);
  assert.equal(result.status, "AVAILABLE");
  assert.deepEqual(result.urls.map((item) => item.url), ["https://example.com/pricing", "https://example.com/services"]);
  assert.ok(result.urls.every((item) => item.sourceUrl.startsWith("https://example.com/")));
});

test("browser failure remains explicit and never becomes a negative inventory claim", async () => {
  const result = await discoverRenderedStructuralUrls("https://example.com/", {
    browserImpl: { launch: async () => { throw new Error("fixture browser unavailable"); } },
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.urls.length, 0);
  assert.match(result.limitations.join(" "), /unavailable/i);
  assert.equal(result.bounded, true);
});

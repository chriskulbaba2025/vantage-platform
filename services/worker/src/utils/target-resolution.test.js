import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, providerTargetOf } from "../utils.js";

test("DataForSEO target contract is deterministic for URL forms", () => {
  const cases = [
    ["https://example.com/", "example.com"],
    ["https://www.example.com/", "example.com"],
    ["http://example.com/", "example.com"],
    ["example.com", "example.com"],
    ["www.example.com", "example.com"],
    ["https://sub.example.com/path?q=1#x", "sub.example.com"],
    ["HTTPS://EXAMPLE.COM/", "example.com"],
  ];
  for (const [input, expected] of cases) assert.equal(providerTargetOf(input), expected, input);
  assert.equal(normalizeUrl("https://example.com/path#fragment"), "https://example.com/path");
});

import test from "node:test";
import assert from "node:assert/strict";
import { resolveBusinessDisplayName } from "./business-display-name.js";

test("display name prefers verified site identity over mechanical intake text", () => {
  assert.equal(resolveBusinessDisplayName(
    { targetUrl: "https://example.test/", businessName: "Example Test" },
    { domain: "example.test", identityCandidates: [{ value: "Example Renovation Group", source: "organization-schema" }] },
  ), "Example Renovation Group");
});

test("display name preserves a genuine explicit intake name", () => {
  assert.equal(resolveBusinessDisplayName(
    { targetUrl: "https://example.test/", businessName: "North Shore Builders" },
    { domain: "example.test", identityCandidates: [] },
  ), "North Shore Builders");
});

test("display name falls back deterministically without fabricating identity", () => {
  assert.equal(resolveBusinessDisplayName(
    { targetUrl: "https://north-shore.example/", businessName: "North Shore" },
    { domain: "north-shore.example", identityCandidates: [] },
  ), "North Shore");
});

test("concatenated domain identity cannot override a persisted human-readable name", () => {
  assert.equal(resolveBusinessDisplayName(
    { targetUrl: "https://rebootbusinesscoaching.com/", businessName: "Reboot Business Coaching" },
    { domain: "rebootbusinesscoaching.com", identityCandidates: [{ source: "site-identity", value: "Rebootbusinesscoaching" }] },
  ), "Reboot Business Coaching");
});

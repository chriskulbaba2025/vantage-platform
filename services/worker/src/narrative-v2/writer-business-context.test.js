import test from "node:test";
import assert from "node:assert/strict";

import {
  WRITER_BUSINESS_CONTEXT_FIELDS,
  buildWriterBusinessContext,
} from "./writer-business-context.js";

test("WRITER-CONTEXT-01: exact persisted intake terminology and values are preserved", () => {
  const request = {
    auditId: "00000000-0000-4000-8000-000000000001",
    tenantId: "tenant-1",
    clientId: "client-1",
    businessName: "Reboot Business Coaching",
    targetUrl: "https://rebootbusinesscoaching.com/",
    primaryGoal: "generate qualified business coaching enquiries",
    market: "Canada / national",
    language: "en-CA",
    services: ["business coaching", "executive coaching"],
    competitors: ["https://ginakeeping.ca/", "https://traceyjazmin.com/"],
  };

  const context = buildWriterBusinessContext(request);

  assert.deepEqual(Object.keys(context), WRITER_BUSINESS_CONTEXT_FIELDS);
  assert.equal(context.businessName, request.businessName);
  assert.equal(context.targetUrl, request.targetUrl);
  assert.equal(context.primaryGoal, request.primaryGoal);
  assert.equal(context.market, request.market);
  assert.equal(context.language, request.language);
  assert.deepEqual(context.services, request.services);
  assert.deepEqual(context.competitors, request.competitors);
});

test("WRITER-CONTEXT-02: absent optional context remains absent instead of being defaulted", () => {
  const context = buildWriterBusinessContext({
    targetUrl: "https://example.com/",
  });

  assert.deepEqual(context, { targetUrl: "https://example.com/" });
  assert.equal(Object.hasOwn(context, "businessName"), false);
  assert.equal(Object.hasOwn(context, "primaryGoal"), false);
  assert.equal(Object.hasOwn(context, "market"), false);
  assert.equal(Object.hasOwn(context, "language"), false);
  assert.equal(Object.hasOwn(context, "services"), false);
  assert.equal(Object.hasOwn(context, "competitors"), false);
});

test("WRITER-CONTEXT-03: explicit values are not normalized or rewritten", () => {
  const context = buildWriterBusinessContext({
    targetUrl: "https://example.com/path",
    market: "Toronto / GTA",
    language: "fr-CA",
    primaryGoal: "book a consultation",
    services: [],
    competitors: [],
  });

  assert.equal(context.market, "Toronto / GTA");
  assert.equal(context.language, "fr-CA");
  assert.equal(context.primaryGoal, "book a consultation");
  assert.deepEqual(context.services, []);
  assert.deepEqual(context.competitors, []);
});

test("WRITER-CONTEXT-04: input arrays are copied, not shared", () => {
  const request = {
    targetUrl: "https://example.com/",
    services: ["A"],
    competitors: ["https://competitor.example.com/"],
  };
  const context = buildWriterBusinessContext(request);

  request.services.push("B");
  request.competitors.push("https://second.example.com/");

  assert.deepEqual(context.services, ["A"]);
  assert.deepEqual(context.competitors, ["https://competitor.example.com/"]);
});

test("WRITER-CONTEXT-05: missing targetUrl fails closed", () => {
  assert.throws(() => buildWriterBusinessContext({}), /targetUrl is required/);
  assert.throws(() => buildWriterBusinessContext(null), /auditRequest is required/);
});

/**
 * PRYSM-INCIDENT-01 timezone regression.
 *
 * Proves the display formatter converts UTC/ISO timestamps to
 * America/Toronto with automatic DST handling:
 *   - an August timestamp must display Eastern DAYLIGHT Time (EDT, UTC-4)
 *   - a January timestamp must display Eastern STANDARD Time (EST, UTC-5)
 *
 * Stored timestamps are never mutated — formatting only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAuditTimestamp,
  formatAuditDate,
  formatAuditTime,
} from "./format-time.js";

// 2026-08-17T02:43:00Z = 2026-08-16 10:43 PM EDT (UTC-4)
const AUGUST_UTC = "2026-08-17T02:43:00.000Z";
// 2026-01-15T12:00:00Z = 2026-01-15 7:00 AM EST (UTC-5)
const JANUARY_UTC = "2026-01-15T12:00:00.000Z";

test("August timestamp renders Eastern Daylight Time (UTC-4)", () => {
  const formatted = formatAuditTimestamp(AUGUST_UTC);
  // en-CA full format: "2026-08-16, 10:43 p.m."
  assert.ok(formatted.includes("2026-08-16"), `expected Aug 16, got ${formatted}`);
  assert.ok(formatted.includes("10:43"), `expected 10:43, got ${formatted}`);
  assert.ok(formatted.includes("p.m."), `expected p.m., got ${formatted}`);
  assert.equal(formatAuditTime(AUGUST_UTC), "10:43 p.m.");
});

test("January timestamp renders Eastern Standard Time (UTC-5)", () => {
  const formatted = formatAuditTimestamp(JANUARY_UTC);
  assert.ok(formatted.includes("2026-01-15"), `expected Jan 15, got ${formatted}`);
  assert.ok(formatted.includes("7:00"), `expected 7:00, got ${formatted}`);
  assert.ok(formatted.includes("a.m."), `expected a.m., got ${formatted}`);
});

test("Date-only formatter is timezone-aware (UTC date crossing Eastern date)", () => {
  // 2026-08-17T02:43Z is still Aug 16 in Toronto.
  assert.equal(formatAuditDate(AUGUST_UTC), "2026-08-16");
  assert.equal(formatAuditDate(JANUARY_UTC), "2026-01-15");
});

test("Invalid or missing timestamps render the safe placeholder", () => {
  assert.equal(formatAuditTimestamp(null), "—");
  assert.equal(formatAuditTimestamp("not-a-date"), "—");
  assert.equal(formatAuditTime(undefined), "—");
});

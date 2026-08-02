/**
 * DataForSEO Location Resolver Tests
 *
 * Covers:
 *   - Ottawa and Ontario, Canada
 *   - Ottawa, Ontario, Canada
 *   - Ontario, Canada
 *   - Canada
 *   - Missing location
 *   - Unsupported/ambiguous location
 *   - US locations
 *   - Deterministic output
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveLocation,
  parseLocation,
  COUNTRY_CODES,
} from "./location-resolver.js";

// ---------------------------------------------------------------------------
// LOC-01: Ottawa and Ontario, Canada
// ---------------------------------------------------------------------------

test("LOC-01: Ottawa and Ontario, Canada resolves to city level", () => {
  const result = resolveLocation("Ottawa and Ontario, Canada");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "city");
  assert.equal(result.locationName, "Ottawa,Ontario,Canada");
  assert.equal(result.originalLocation, "Ottawa and Ontario, Canada");
  // location_code is null for city-level (no city-level codes in our mapping)
  assert.equal(result.locationCode, null);
});

// ---------------------------------------------------------------------------
// LOC-02: Ottawa, Ontario, Canada
// ---------------------------------------------------------------------------

test("LOC-02: Ottawa, Ontario, Canada resolves to city level", () => {
  const result = resolveLocation("Ottawa, Ontario, Canada");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "city");
  assert.equal(result.locationName, "Ottawa,Ontario,Canada");
  assert.equal(result.originalLocation, "Ottawa, Ontario, Canada");
});

// ---------------------------------------------------------------------------
// LOC-03: Ontario, Canada
// ---------------------------------------------------------------------------

test("LOC-03: Ontario, Canada resolves to region level", () => {
  const result = resolveLocation("Ontario, Canada");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "region");
  assert.equal(result.locationName, "Ontario,Canada");
  assert.equal(result.locationCode, null);
});

// ---------------------------------------------------------------------------
// LOC-04: Canada (country only)
// ---------------------------------------------------------------------------

test("LOC-04: Canada resolves to country level with location_code", () => {
  const result = resolveLocation("Canada");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "country");
  assert.equal(result.locationName, "Canada");
  assert.equal(result.locationCode, 2124); // DataForSEO country code for Canada
  assert.equal(result.originalLocation, "Canada");
});

// ---------------------------------------------------------------------------
// LOC-05: Missing location
// ---------------------------------------------------------------------------

test("LOC-05: null location produces error", () => {
  const result = resolveLocation(null);
  assert.equal(result.resolutionLevel, "unresolved");
  assert.ok(result.error);
  assert.ok(result.error.includes("No location provided"));
  assert.equal(result.locationName, null);
});

test("LOC-05b: empty string produces error", () => {
  const result = resolveLocation("");
  assert.equal(result.resolutionLevel, "unresolved");
  assert.ok(result.error);
  assert.equal(result.locationName, null);
});

test("LOC-05c: undefined produces error", () => {
  const result = resolveLocation(undefined);
  assert.equal(result.resolutionLevel, "unresolved");
  assert.ok(result.error);
});

test("LOC-05d: whitespace-only produces error", () => {
  const result = resolveLocation("   ");
  assert.equal(result.resolutionLevel, "unresolved");
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// LOC-06: Unsupported or ambiguous location
// ---------------------------------------------------------------------------

test("LOC-06: unknown free text produces unresolved error", () => {
  const result = resolveLocation("somewhere nice");
  assert.equal(result.resolutionLevel, "unresolved");
  assert.ok(result.error);
  assert.ok(result.error.includes("Could not resolve"));
  assert.equal(result.locationName, null);
});

test("LOC-06b: ambiguous single word without country match produces error", () => {
  const result = resolveLocation("Springfield");
  assert.equal(result.resolutionLevel, "unresolved");
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// LOC-07: US locations
// ---------------------------------------------------------------------------

test("LOC-07: United States resolves to country level with code", () => {
  const result = resolveLocation("United States");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "country");
  assert.equal(result.locationName, "United States");
  assert.equal(result.locationCode, 2840);
});

test("LOC-07b: USA resolves to United States", () => {
  const result = resolveLocation("USA");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "country");
  assert.equal(result.locationName, "United States");
  assert.equal(result.locationCode, 2840);
});

test("LOC-07c: New York, United States resolves to region level", () => {
  const result = resolveLocation("New York, United States");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "region");
  assert.equal(result.locationName, "New York,United States");
});

test("LOC-07d: Austin, Texas, United States", () => {
  const result = resolveLocation("Austin, Texas, United States");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "city");
  assert.equal(result.locationName, "Austin,Texas,United States");
});

// ---------------------------------------------------------------------------
// LOC-08: UK locations
// ---------------------------------------------------------------------------

test("LOC-08: UK resolves to United Kingdom with code", () => {
  const result = resolveLocation("UK");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "country");
  assert.equal(result.locationName, "United Kingdom");
  assert.equal(result.locationCode, 2826);
});

test("LOC-08b: London, United Kingdom", () => {
  const result = resolveLocation("London, United Kingdom");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "city");
  assert.equal(result.locationName, "London,United Kingdom");
});

// ---------------------------------------------------------------------------
// LOC-09: Canadian city variations
// ---------------------------------------------------------------------------

test("LOC-09: Toronto, Ontario, Canada", () => {
  const result = resolveLocation("Toronto, Ontario, Canada");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "city");
  assert.equal(result.locationName, "Toronto,Ontario,Canada");
});

test("LOC-09b: Vancouver, British Columbia, Canada", () => {
  const result = resolveLocation("Vancouver, British Columbia, Canada");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "city");
  assert.equal(result.locationName, "Vancouver,British Columbia,Canada");
});

test("LOC-09c: Montreal, Quebec, Canada", () => {
  const result = resolveLocation("Montreal, Quebec, Canada");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "city");
  assert.equal(result.locationName, "Montreal,Quebec,Canada");
});

test("LOC-09d: Calgary, Alberta, Canada", () => {
  const result = resolveLocation("Calgary, Alberta, Canada");
  assert.equal(result.error, null);
  assert.equal(result.resolutionLevel, "city");
  assert.equal(result.locationName, "Calgary,Alberta,Canada");
});

// ---------------------------------------------------------------------------
// LOC-10: Original location always preserved
// ---------------------------------------------------------------------------

test("LOC-10: originalLocation preserved on success", () => {
  const result = resolveLocation("Ottawa and Ontario, Canada");
  assert.equal(result.originalLocation, "Ottawa and Ontario, Canada");
});

test("LOC-10b: originalLocation preserved on failure", () => {
  const result = resolveLocation("xyz-unknown-place");
  assert.equal(result.originalLocation, "xyz-unknown-place");
  assert.equal(result.resolutionLevel, "unresolved");
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// LOC-11: Deterministic output
// ---------------------------------------------------------------------------

test("LOC-11: same input produces same output", () => {
  for (let i = 0; i < 5; i++) {
    const r1 = resolveLocation("Ottawa and Ontario, Canada");
    const r2 = resolveLocation("Ottawa and Ontario, Canada");
    assert.deepStrictEqual(r1, r2);
  }
});

// ---------------------------------------------------------------------------
// LOC-12: Location name never contains raw free text separators
// ---------------------------------------------------------------------------

test("LOC-12: output never contains ' and ' from input", () => {
  const result = resolveLocation("Ottawa and Ontario, Canada");
  assert.equal(result.locationName.includes(" and "), false);
  assert.equal(result.error, null);
});

// ---------------------------------------------------------------------------
// LOC-13: Country codes are all numbers
// ---------------------------------------------------------------------------

test("LOC-13: all COUNTRY_CODES values have numeric codes", () => {
  for (const [key, val] of Object.entries(COUNTRY_CODES)) {
    assert.equal(typeof val.code, "number", `Country ${key} must have numeric code`);
    assert.equal(typeof val.name, "string", `Country ${key} must have string name`);
  }
});

// ---------------------------------------------------------------------------
// LOC-14: parseLocation unit tests
// ---------------------------------------------------------------------------

test("LOC-14: parseLocation extracts city, region, country from three-part input", () => {
  const parsed = parseLocation("Ottawa, Ontario, Canada");
  assert.equal(parsed.city, "Ottawa");
  assert.equal(parsed.region, "Ontario");
  assert.equal(parsed.country, "Canada");
});

test("LOC-14b: parseLocation handles 'and' conjunction", () => {
  const parsed = parseLocation("Ottawa and Ontario, Canada");
  assert.equal(parsed.city, "Ottawa");
  assert.equal(parsed.region, "Ontario");
  assert.equal(parsed.country, "Canada");
});

test("LOC-14c: parseLocation handles two parts", () => {
  const parsed = parseLocation("Ontario, Canada");
  assert.equal(parsed.city, null);
  assert.equal(parsed.region, "Ontario");
  assert.equal(parsed.country, "Canada");
});

test("LOC-14d: parseLocation handles country only", () => {
  const parsed = parseLocation("Canada");
  assert.equal(parsed.city, null);
  assert.equal(parsed.region, null);
  assert.equal(parsed.country, "Canada");
});

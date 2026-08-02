/**
 * DataForSEO Locale Normalizer Tests
 *
 * Covers:
 *   - Valid BCP-47 locales (en-CA, en-US, fr-CA, etc.)
 *   - Plain language names
 *   - Case variations
 *   - Missing input
 *   - Unsupported input
 *   - Edge cases (whitespace, empty strings)
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLanguage,
  parseBcp47Primary,
  BCP47_TO_DATAFORSEO,
  FALLBACK_LANGUAGE,
} from "./locale-normalizer.js";

// ---------------------------------------------------------------------------
// L-01: Valid BCP-47 locales produce correct DataForSEO language names
// ---------------------------------------------------------------------------

test("L-01: en-CA normalizes to English", () => {
  const result = normalizeLanguage("en-CA");
  assert.equal(result.languageName, "English");
  assert.equal(result.originalLanguage, "en-CA");
  assert.equal(result.isFallback, false);
  assert.equal(result.source, "bcp47");
});

test("L-01b: en-US normalizes to English", () => {
  const result = normalizeLanguage("en-US");
  assert.equal(result.languageName, "English");
  assert.equal(result.isFallback, false);
});

test("L-01c: en-GB normalizes to English", () => {
  const result = normalizeLanguage("en-GB");
  assert.equal(result.languageName, "English");
  assert.equal(result.isFallback, false);
});

test("L-01d: fr-CA normalizes to French", () => {
  const result = normalizeLanguage("fr-CA");
  assert.equal(result.languageName, "French");
  assert.equal(result.originalLanguage, "fr-CA");
  assert.equal(result.isFallback, false);
  assert.equal(result.source, "bcp47");
});

test("L-01e: fr-FR normalizes to French", () => {
  const result = normalizeLanguage("fr-FR");
  assert.equal(result.languageName, "French");
  assert.equal(result.isFallback, false);
});

test("L-01f: es-MX normalizes to Spanish", () => {
  const result = normalizeLanguage("es-MX");
  assert.equal(result.languageName, "Spanish");
  assert.equal(result.isFallback, false);
});

test("L-01g: de-DE normalizes to German", () => {
  const result = normalizeLanguage("de-DE");
  assert.equal(result.languageName, "German");
  assert.equal(result.isFallback, false);
});

// ---------------------------------------------------------------------------
// L-02: Plain language names pass through
// ---------------------------------------------------------------------------

test("L-02: plain 'English' is accepted", () => {
  const result = normalizeLanguage("English");
  assert.equal(result.languageName, "English");
  assert.equal(result.originalLanguage, "English");
  assert.equal(result.isFallback, false);
  assert.equal(result.source, "plain-name");
});

test("L-02b: plain 'French' is accepted", () => {
  const result = normalizeLanguage("French");
  assert.equal(result.languageName, "French");
  assert.equal(result.isFallback, false);
});

test("L-02c: plain 'Spanish' is accepted", () => {
  const result = normalizeLanguage("Spanish");
  assert.equal(result.languageName, "Spanish");
  assert.equal(result.isFallback, false);
});

// ---------------------------------------------------------------------------
// L-03: Case variations
// ---------------------------------------------------------------------------

test("L-03: lowercase 'english' normalizes to 'English'", () => {
  const result = normalizeLanguage("english");
  assert.equal(result.languageName, "English");
  assert.equal(result.isFallback, false);
  assert.equal(result.source, "plain-name");
});

test("L-03b: UPPERCASE 'FRENCH' normalizes to 'French'", () => {
  const result = normalizeLanguage("FRENCH");
  assert.equal(result.languageName, "French");
  assert.equal(result.isFallback, false);
});

test("L-03c: mixed-case 'eNgLiSh' normalizes to 'English'", () => {
  const result = normalizeLanguage("eNgLiSh");
  assert.equal(result.languageName, "English");
  assert.equal(result.isFallback, false);
});

test("L-03d: BCP-47 is case-insensitive for region", () => {
  // en-ca (lowercase region) should still parse
  const result = normalizeLanguage("en-ca");
  assert.equal(result.languageName, "English");
  assert.equal(result.isFallback, false);
  assert.equal(result.source, "bcp47");
});

// ---------------------------------------------------------------------------
// L-04: ISO 639-1 codes (bare language codes)
// ---------------------------------------------------------------------------

test("L-04: bare 'en' normalizes to English", () => {
  const result = normalizeLanguage("en");
  assert.equal(result.languageName, "English");
  assert.equal(result.isFallback, false);
  assert.equal(result.source, "bcp47");
});

test("L-04b: bare 'fr' normalizes to French", () => {
  const result = normalizeLanguage("fr");
  assert.equal(result.languageName, "French");
  assert.equal(result.isFallback, false);
});

// ---------------------------------------------------------------------------
// L-05: Missing or empty input
// ---------------------------------------------------------------------------

test("L-05: null returns fallback", () => {
  const result = normalizeLanguage(null);
  assert.equal(result.languageName, FALLBACK_LANGUAGE);
  assert.equal(result.isFallback, true);
  assert.equal(result.source, "fallback");
  assert.equal(result.originalLanguage, null);
});

test("L-05b: undefined returns fallback", () => {
  const result = normalizeLanguage(undefined);
  assert.equal(result.languageName, FALLBACK_LANGUAGE);
  assert.equal(result.isFallback, true);
});

test("L-05c: empty string returns fallback", () => {
  const result = normalizeLanguage("");
  assert.equal(result.languageName, FALLBACK_LANGUAGE);
  assert.equal(result.isFallback, true);
});

test("L-05d: whitespace-only returns fallback", () => {
  const result = normalizeLanguage("   ");
  assert.equal(result.languageName, FALLBACK_LANGUAGE);
  assert.equal(result.isFallback, true);
});

// ---------------------------------------------------------------------------
// L-06: Unsupported input falls back without inventing
// ---------------------------------------------------------------------------

test("L-06: unsupported language 'Klingon' falls back to English", () => {
  const result = normalizeLanguage("Klingon");
  assert.equal(result.languageName, FALLBACK_LANGUAGE);
  assert.equal(result.isFallback, true);
  assert.equal(result.source, "fallback");
  assert.equal(result.originalLanguage, "Klingon");
});

test("L-06b: random string 'xyz-ABC' falls back", () => {
  const result = normalizeLanguage("xyz-ABC");
  assert.equal(result.languageName, FALLBACK_LANGUAGE);
  assert.equal(result.isFallback, true);
});

test("L-06c: language_name is never a BCP-47 string", () => {
  // Even with en-CA input, the output must be "English" not "en-CA"
  const result = normalizeLanguage("en-CA");
  assert.notEqual(result.languageName, "en-CA");
  assert.notEqual(result.languageName, "en");
  assert.equal(result.languageName, "English");
});

// ---------------------------------------------------------------------------
// L-07: BCP-47 parser edge cases
// ---------------------------------------------------------------------------

test("L-07: parseBcp47Primary extracts language from en-CA", () => {
  assert.equal(parseBcp47Primary("en-CA"), "en");
});

test("L-07b: parseBcp47Primary extracts language from zh-Hans-CN", () => {
  assert.equal(parseBcp47Primary("zh-Hans-CN"), "zh");
});

test("L-07c: parseBcp47Primary returns null for plain 'English'", () => {
  assert.equal(parseBcp47Primary("English"), null);
});

test("L-07d: parseBcp47Primary returns null for empty string", () => {
  assert.equal(parseBcp47Primary(""), null);
});

test("L-07e: parseBcp47Primary returns null for null", () => {
  assert.equal(parseBcp47Primary(null), null);
});

// ---------------------------------------------------------------------------
// L-08: Original language is always preserved
// ---------------------------------------------------------------------------

test("L-08: originalLanguage preserved even on fallback", () => {
  const result = normalizeLanguage("xx-YY");
  assert.equal(result.originalLanguage, "xx-YY");
  assert.equal(result.isFallback, true);
  assert.equal(result.languageName, FALLBACK_LANGUAGE);
});

test("L-08b: originalLanguage preserved for valid BCP-47", () => {
  const result = normalizeLanguage("en-CA");
  assert.equal(result.originalLanguage, "en-CA");
});

// ---------------------------------------------------------------------------
// L-09: Extended language coverage
// ---------------------------------------------------------------------------

test("L-09: all BCP47_TO_DATAFORSEO values are valid DataForSEO names", () => {
  for (const name of Object.values(BCP47_TO_DATAFORSEO)) {
    assert.equal(typeof name, "string");
    assert.ok(name.length > 0);
    // First letter should be uppercase (proper noun)
    assert.equal(name[0], name[0].toUpperCase());
  }
});

test("L-09b: mapping is deterministic", () => {
  for (let i = 0; i < 10; i++) {
    const r1 = normalizeLanguage("en-CA");
    const r2 = normalizeLanguage("en-CA");
    assert.deepStrictEqual(r1, r2);
  }
});

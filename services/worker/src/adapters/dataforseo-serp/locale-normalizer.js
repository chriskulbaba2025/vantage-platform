/**
 * DataForSEO Locale Normalizer
 *
 * Converts BCP-47 locale strings and plain language names into
 * DataForSEO-supported language_name values.
 *
 * DataForSEO SERP API accepts only specific language names (e.g. "English",
 * "French"), not BCP-47 tags (e.g. "en-CA"). Sending a BCP-47 tag directly
 * causes the API to reject the task.
 *
 * This module provides deterministic mappings with an explicit
 * supported fallback. It never silently invents unsupported languages.
 */

// ---------------------------------------------------------------------------
// BCP-47 primary language subtag → DataForSEO language_name
// ---------------------------------------------------------------------------

const BCP47_TO_DATAFORSEO = Object.freeze({
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
  nl: "Dutch",
  pl: "Polish",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
  tr: "Turkish",
  uk: "Ukrainian",
  he: "Hebrew",
  id: "Indonesian",
  th: "Thai",
  vi: "Vietnamese",
  hi: "Hindi",
  bn: "Bengali",
  bg: "Bulgarian",
  ca: "Catalan",
  hr: "Croatian",
  cs: "Czech",
  el: "Greek",
  hu: "Hungarian",
  lt: "Lithuanian",
  lv: "Latvian",
  ms: "Malay",
  ro: "Romanian",
  sr: "Serbian",
  sk: "Slovak",
  sl: "Slovenian",
  ta: "Tamil",
  te: "Telugu",
  ur: "Urdu",
});

// ---------------------------------------------------------------------------
// DataForSEO language_name → canonical form (lowercase key)
// ---------------------------------------------------------------------------

const SUPPORTED_DATAFORSEO_NAMES = new Set(
  Object.values(BCP47_TO_DATAFORSEO).map((n) => n.toLowerCase()),
);

// ---------------------------------------------------------------------------
// Explicit fallback
// ---------------------------------------------------------------------------

const FALLBACK_LANGUAGE = "English";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a BCP-47 language tag and return its primary language subtag.
 *
 * Examples:
 *   "en-CA" → "en"
 *   "fr-CA" → "fr"
 *   "en"    → "en"
 *   "English" → null (not a BCP-47 tag)
 *   null     → null
 *
 * @param {string|null|undefined} raw
 * @returns {string|null} primary language subtag or null
 */
function parseBcp47Primary(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // BCP-47: language[-script][-region][-variant]...
  // We only need the primary language subtag (2-3 letters)
  const match = trimmed.match(/^([a-zA-Z]{2,3})(?:[-_].*)?$/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Normalize an audit language input to a DataForSEO-supported language_name.
 *
 * Accepts:
 *   - BCP-47 locale strings: "en-CA", "en-US", "fr-CA"
 *   - Plain language names: "English", "French", "french"
 *   - ISO 639-1 codes: "en", "fr"
 *
 * Returns { languageName, originalLanguage, isFallback, source } where:
 *   - languageName: the DataForSEO-supported language name (e.g. "English")
 *   - originalLanguage: the original input value preserved for reporting
 *   - isFallback: true when the input could not be mapped and the fallback was used
 *   - source: "bcp47", "plain-name", "iso-code", or "fallback"
 *
 * Never returns a BCP-47 string as languageName.
 *
 * @param {string|null|undefined} language  Audit language input
 * @returns {object}
 */
export function normalizeLanguage(language) {
  const original = (language && typeof language === "string")
    ? language.trim()
    : "";

  // ── Empty/missing input → fallback ──────────────────────────────────
  if (!original) {
    return {
      languageName: FALLBACK_LANGUAGE,
      originalLanguage: original || null,
      isFallback: true,
      source: "fallback",
    };
  }

  // ── Try as a BCP-47 locale ─────────────────────────────────────────
  const primary = parseBcp47Primary(original);
  if (primary && BCP47_TO_DATAFORSEO[primary]) {
    return {
      languageName: BCP47_TO_DATAFORSEO[primary],
      originalLanguage: original,
      isFallback: false,
      source: "bcp47",
    };
  }

  // ── Try as a plain DataForSEO language name (case-insensitive) ─────
  const lower = original.toLowerCase();
  if (SUPPORTED_DATAFORSEO_NAMES.has(lower)) {
    // Find the canonical casing
    const canonical = Object.values(BCP47_TO_DATAFORSEO).find(
      (n) => n.toLowerCase() === lower,
    );
    if (canonical) {
      return {
        languageName: canonical,
        originalLanguage: original,
        isFallback: false,
        source: "plain-name",
      };
    }
  }

  // ── Fallback: unsupported input ────────────────────────────────────
  return {
    languageName: FALLBACK_LANGUAGE,
    originalLanguage: original,
    isFallback: true,
    source: "fallback",
  };
}

// Re-export for testing
export { BCP47_TO_DATAFORSEO, SUPPORTED_DATAFORSEO_NAMES, FALLBACK_LANGUAGE, parseBcp47Primary };

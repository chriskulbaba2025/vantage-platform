/**
 * DataForSEO Location Resolver
 *
 * Converts free-text geographic market descriptions into valid
 * DataForSEO location_name or location_code values.
 *
 * DataForSEO requires specific location identifiers. Raw text such as
 * "Ottawa and Ontario, Canada" will be rejected. This module parses
 * free text, extracts geographic components, and builds a valid
 * DataForSEO hierarchical location.
 *
 * Resolution strategy:
 *   1. Parse free text into { city, region, country } components
 *   2. Normalize country names against a known mapping
 *   3. Build DataForSEO location_name in hierarchical format
 *      (e.g. "Ottawa,Ontario,Canada")
 *   4. When a location_code is known for the country, prefer it for
 *      country-level queries
 *   5. A failure to resolve produces a structured error — never a
 *      silent fallback to an unlocalized search
 */

// ---------------------------------------------------------------------------
// Known DataForSEO location codes (country-level)
// ---------------------------------------------------------------------------

const COUNTRY_CODES = Object.freeze({
  canada: { code: 2124, name: "Canada" },
  "united states": { code: 2840, name: "United States" },
  "united states of america": { code: 2840, name: "United States" },
  usa: { code: 2840, name: "United States" },
  us: { code: 2840, name: "United States" },
  "united kingdom": { code: 2826, name: "United Kingdom" },
  uk: { code: 2826, name: "United Kingdom" },
  england: { code: 2826, name: "United Kingdom" },
  australia: { code: 2036, name: "Australia" },
  germany: { code: 2276, name: "Germany" },
  france: { code: 2250, name: "France" },
  india: { code: 2356, name: "India" },
  japan: { code: 2392, name: "Japan" },
  brazil: { code: 2076, name: "Brazil" },
  mexico: { code: 2484, name: "Mexico" },
  italy: { code: 2380, name: "Italy" },
  spain: { code: 2724, name: "Spain" },
  netherlands: { code: 2528, name: "Netherlands" },
  "new zealand": { code: 2554, name: "New Zealand" },
  singapore: { code: 2702, name: "Singapore" },
  ireland: { code: 2372, name: "Ireland" },
});

// ---------------------------------------------------------------------------
// Canadian province/territory normalization
// ---------------------------------------------------------------------------

const CANADIAN_REGIONS = Object.freeze(
  new Set([
    "ontario", "quebec", "british columbia", "alberta", "manitoba",
    "saskatchewan", "nova scotia", "new brunswick",
    "newfoundland and labrador", "newfoundland", "labrador",
    "prince edward island", "pei", "northwest territories",
    "yukon", "nunavut",
  ]),
);

// ---------------------------------------------------------------------------
// US state normalization
// ---------------------------------------------------------------------------

const US_STATES = Object.freeze(
  new Set([
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
    "maine", "maryland", "massachusetts", "michigan", "minnesota",
    "mississippi", "missouri", "montana", "nebraska", "nevada",
    "new hampshire", "new jersey", "new mexico", "new york",
    "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
    "pennsylvania", "rhode island", "south carolina", "south dakota",
    "tennessee", "texas", "utah", "vermont", "virginia", "washington",
    "west virginia", "wisconsin", "wyoming",
    "district of columbia", "dc",
  ]),
);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a free-text location string into geographic components.
 *
 * Handles patterns like:
 *   "Ottawa and Ontario, Canada" → { city: "Ottawa", region: "Ontario", country: "Canada" }
 *   "Ottawa, Ontario, Canada"    → { city: "Ottawa", region: "Ontario", country: "Canada" }
 *   "Ontario, Canada"            → { city: null, region: "Ontario", country: "Canada" }
 *   "Canada"                     → { city: null, region: null, country: "Canada" }
 *   "Toronto, Ontario"           → { city: "Toronto", region: "Ontario", country: null }
 *
 * Strategy:
 *   1. Split by comma first (primary delimiter)
 *   2. For the last segment, try to match a country
 *   3. For the second-to-last, try to match a region
 *   4. The first segment may contain city (possibly joined with "and")
 *
 * @param {string|null|undefined} raw
 * @returns {{ city: string|null, region: string|null, country: string|null, original: string }}
 */
function parseLocation(raw) {
  if (!raw || typeof raw !== "string") {
    return { city: null, region: null, country: null, original: raw || "" };
  }

  const original = raw.trim();
  if (!original) {
    return { city: null, region: null, country: null, original: "" };
  }

  // Split by comma
  const parts = original.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length === 0) {
    return { city: null, region: null, country: null, original };
  }

  let country = null;
  let region = null;
  let city = null;

  // ── Step 1: Identify country (last part) ────────────────────────────
  const lastPart = parts[parts.length - 1].toLowerCase();
  if (COUNTRY_CODES[lastPart]) {
    country = COUNTRY_CODES[lastPart].name;
  }

  // Fuzzy country match
  if (!country) {
    const possibleCountry = parts[parts.length - 1];
    if (possibleCountry.length <= 15 && !possibleCountry.match(/^\d/)) {
      const pcLower = possibleCountry.toLowerCase();
      for (const [key, val] of Object.entries(COUNTRY_CODES)) {
        if (pcLower === key || pcLower.includes(key) || key.includes(pcLower)) {
          country = val.name;
          break;
        }
      }
    }
  }

  // ── Step 2: Parse the first part for "and" conjunctions FIRST ───────
  // This must happen before region detection so "Ottawa and Ontario"
  // is split before we try to detect "Ottawa and Ontario" as a region.
  let resolvedCity = null;
  let resolvedRegion = null;

  if (parts.length >= 1) {
    const firstPart = parts[0];
    const andMatch = firstPart.match(/^(.+?)\s+and\s+(.+)$/i);
    if (andMatch) {
      const left = andMatch[1].trim();
      const right = andMatch[2].trim();
      const rightLower = right.toLowerCase();

      if (CANADIAN_REGIONS.has(rightLower) || US_STATES.has(rightLower)) {
        resolvedCity = left;
        resolvedRegion = right;
      } else {
        resolvedCity = left;
      }
    }
  }

  // ── Step 3: Detect region from middle parts ─────────────────────────
  // Build the list of "middle" parts (excluding last=country, and
  // excluding the first if it was already resolved via "and").
  const middleStart = resolvedCity || resolvedRegion ? 1 : 0;
  const middleEnd = country ? parts.length - 1 : parts.length;

  for (let i = middleStart; i < middleEnd; i++) {
    const partLower = parts[i].toLowerCase();
    if (CANADIAN_REGIONS.has(partLower) || US_STATES.has(partLower)) {
      resolvedRegion = parts[i]; // Use original casing
      break;
    }
    // If country is CA/US and part looks like a region name (not already resolved)
    const isCountryCA = country === "Canada";
    const isCountryUS = country === "United States";
    if ((isCountryCA || isCountryUS) && partLower.length <= 30 && !resolvedRegion) {
      resolvedRegion = parts[i];
    }
  }

  region = resolvedRegion;

  // ── Step 4: Detect city from remaining parts ────────────────────────
  if (resolvedCity) {
    city = resolvedCity;
  } else if (parts.length >= 3 && country && region) {
    // Three parts with country and region: first part is city
    city = parts[0];
  } else if (parts.length === 2 && country && !region) {
    // Two parts: [something, country] — could be city or region
    // If the something looks like a region (known set), it's not a city
    const firstLower = parts[0].toLowerCase();
    if (!CANADIAN_REGIONS.has(firstLower) && !US_STATES.has(firstLower)) {
      city = parts[0];
    }
  } else if (parts.length === 1 && !country) {
    // Single unrecognized part — could be a city
    city = parts[0];
  }

  return { city, region, country, original };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Result of location resolution.
 *
 * @typedef {object} ResolvedLocation
 * @property {string|null}  locationName    DataForSEO hierarchical location_name
 * @property {number|null}  locationCode    DataForSEO location_code (country-level only)
 * @property {string}       originalLocation  Original free-text input
 * @property {string}       resolutionLevel   "city", "region", "country", or "unresolved"
 * @property {string|null}  error           Error message when unresolved
 */

/**
 * Resolve a free-text geographic market to a DataForSEO location.
 *
 * Builds a valid DataForSEO location_name in hierarchical format.
 * When the input resolves to a known country with a location_code,
 * both location_code and location_name are provided.
 *
 * An unresolved location returns a structured error — callers MUST check
 * `error` and surface the failure rather than proceeding with an
 * unlocalized search.
 *
 * @param {string|null|undefined} location  Free-text location input
 * @returns {ResolvedLocation}
 */
export function resolveLocation(location) {
  const original = (location && typeof location === "string")
    ? location.trim()
    : "";

  // ── Missing input ───────────────────────────────────────────────────
  if (!original) {
    return {
      locationName: null,
      locationCode: null,
      originalLocation: original || null,
      resolutionLevel: "unresolved",
      error: "No location provided — cannot localize SERP search.",
    };
  }

  const parsed = parseLocation(original);

  // ── Country-only resolution ────────────────────────────────────────
  if (parsed.country && !parsed.region && !parsed.city) {
    const countryLower = parsed.country.toLowerCase();
    const countryInfo = COUNTRY_CODES[countryLower];
    return {
      locationName: parsed.country,
      locationCode: countryInfo?.code ?? null,
      originalLocation: original,
      resolutionLevel: "country",
      error: null,
    };
  }

  // ── Country + Region resolution ────────────────────────────────────
  if (parsed.country && parsed.region && !parsed.city) {
    return {
      locationName: `${parsed.region},${parsed.country}`,
      locationCode: null,
      originalLocation: original,
      resolutionLevel: "region",
      error: null,
    };
  }

  // ── City + Region + Country resolution ─────────────────────────────
  if (parsed.country && parsed.region && parsed.city) {
    return {
      locationName: `${parsed.city},${parsed.region},${parsed.country}`,
      locationCode: null,
      originalLocation: original,
      resolutionLevel: "city",
      error: null,
    };
  }

  // ── City + Country (no region) ─────────────────────────────────────
  if (parsed.country && parsed.city && !parsed.region) {
    return {
      locationName: `${parsed.city},${parsed.country}`,
      locationCode: null,
      originalLocation: original,
      resolutionLevel: "city",
      error: null,
    };
  }

  // ── Country not identified — try fallback parse ────────────────────
  // If we have at least some structure, try our best
  if (parsed.region && parsed.city) {
    // We have city and region but couldn't identify country
    // This is a partial resolution — may still fail at the API
    return {
      locationName: `${parsed.city},${parsed.region}`,
      locationCode: null,
      originalLocation: original,
      resolutionLevel: "city",
      error: null,
    };
  }

  // ── Unresolved ─────────────────────────────────────────────────────
  return {
    locationName: null,
    locationCode: null,
    originalLocation: original,
    resolutionLevel: "unresolved",
    error: `Could not resolve location "${original}" to a DataForSEO-supported location. ` +
           "Please provide a location in the format \"City, Region, Country\" " +
           "(e.g. \"Ottawa, Ontario, Canada\").",
  };
}

// Re-export for testing
export { parseLocation, COUNTRY_CODES, CANADIAN_REGIONS, US_STATES };

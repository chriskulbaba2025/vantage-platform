const PROGRAMMATIC_SEO_STATUS = Object.freeze({
  NOT_DETECTED: "NOT_DETECTED",
  LIKELY: "LIKELY",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
});

const ASSESSMENT_STATUS = Object.freeze({
  DETECTED: "DETECTED",
  NOT_DETECTED: "NOT_DETECTED",
  SUFFICIENT: "SUFFICIENT",
  THIN: "THIN",
  MIXED: "MIXED",
  AVAILABLE: "AVAILABLE",
  NOT_AVAILABLE: "NOT_AVAILABLE",
  ALIGNED: "ALIGNED",
  CONCERN: "CONCERN",
  UNKNOWN: "UNKNOWN",
});

const DEFAULTS = Object.freeze({
  thinWordThreshold: 250,
  nearDuplicateThreshold: 0.82,
  shingleSize: 5,
});

const US_STATE_ALIASES = Object.freeze({
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
});

const STATE_CODE_SET = new Set(Object.values(US_STATE_ALIASES));

const TRUST_RE = /\b(testimonials?|reviews?|case stud(?:y|ies)|client results?|credentials?|certified|certification|licensed|registered|accredited|years? experience|awards?|member of|professional association|privacy policy|terms|refund|guarantee)\b/i;

const OFFER_RE = /\b(service|services|program|programs|coaching|consulting|package|packages|plan|plans|pricing|price|cost|investment|book|schedule|consultation|contact|get started|request|buy|purchase|enroll|register|sign up)\b/i;

const SUPPORT_CONTEXT_RE = /\b(based in|located in|office in|address|headquartered|headquarters|licensed in|certified in|registered in|serving from|our office|our team|our coach|our expert|our consultant|our practitioner|our professionals?)\b/i;

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeUrlKey(input) {
  if (!input) return "";

  try {
    const url = new URL(input);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/g, "");
    }

    const params = [...url.searchParams.entries()]
      .sort(([aKey, aValue], [bKey, bValue]) => {
        const keyOrder = compareStrings(aKey, bKey);
        return keyOrder || compareStrings(aValue, bValue);
      });

    url.search = "";
    for (const [key, value] of params) {
      url.searchParams.append(key, value);
    }

    return url.toString();
  } catch {
    return String(input);
  }
}

function cleanText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsOf(value) {
  return cleanText(value)
    .split(/\s+/)
    .filter(Boolean);
}

function pageUrl(page) {
  return (
    page?.finalUrl
    || page?.crawledUrl
    || page?.url
    || ""
  );
}

function pageTitle(page) {
  return page?.title || "";
}

function pageH1(page) {
  const h1 = page?.headings?.h1;
  if (Array.isArray(h1)) return h1.join(" ");
  return String(h1 || "");
}

function pageBody(page) {
  return String(page?.bodyText || "");
}

function pageWordCount(page) {
  const explicit = Number(
    page?.wordCount
    ?? page?.words
    ?? page?._contentParsing?.wordCount,
  );

  if (Number.isFinite(explicit) && explicit >= 0) {
    return Math.round(explicit);
  }

  const body = pageBody(page);
  return body ? wordsOf(body).length : null;
}

function schemaTypes(page) {
  const values = Array.isArray(page?.schemaTypes)
    ? page.schemaTypes
    : [];

  return [...new Set(values.map(String).filter(Boolean))].sort();
}

function buildContentParsingMap(contentParsing = []) {
  const map = new Map();

  for (const item of contentParsing || []) {
    const key = normalizeUrlKey(item?.url);
    if (!key) continue;
    map.set(key, item);
  }

  return map;
}

function hydrateParsedContent(page, contentParsingMap) {
  const key = normalizeUrlKey(pageUrl(page));
  const parsed = contentParsingMap.get(key);

  if (!parsed) return page;

  const hydrated = {
    ...page,
    _contentParsing: parsed,
  };

  if (!hydrated.bodyText && parsed.text) {
    hydrated.bodyText = parsed.text;
  }

  if (
    hydrated.wordCount == null
    && hydrated.words == null
    && Number.isFinite(Number(parsed.wordCount))
  ) {
    hydrated.wordCount = Number(parsed.wordCount);
  }

  return hydrated;
}

function buildPageMap(pages = [], contentParsing = []) {
  const parsingMap = buildContentParsingMap(contentParsing);
  const map = new Map();

  for (const sourcePage of pages || []) {
    const page = hydrateParsedContent(sourcePage, parsingMap);

    for (const candidate of [
      page?.url,
      page?.crawledUrl,
      page?.finalUrl,
    ]) {
      const key = normalizeUrlKey(candidate);
      if (key) map.set(key, page);
    }
  }

  return map;
}

function getRepresentativePages(cluster, pageMap) {
  const sampledUrls = Array.isArray(cluster?.representativeUrls)
    ? cluster.representativeUrls
    : [];

  return sampledUrls
    .map((url) => {
      const normalizedUrl = normalizeUrlKey(url);
      return {
        url: normalizedUrl || url,
        page: pageMap.get(normalizedUrl) || null,
      };
    })
    .sort((a, b) => compareStrings(a.url, b.url));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function summarizeContentDepth(samples, thinWordThreshold) {
  const counts = samples
    .map(({ page }) => pageWordCount(page))
    .filter((value) => Number.isFinite(value));

  if (!counts.length) {
    return {
      status: ASSESSMENT_STATUS.NOT_AVAILABLE,
      assessedPageCount: 0,
      minWords: null,
      medianWords: null,
      averageWords: null,
      maxWords: null,
    };
  }

  const thinCount = counts.filter(
    (count) => count < thinWordThreshold,
  ).length;

  let status = ASSESSMENT_STATUS.SUFFICIENT;
  if (thinCount === counts.length) {
    status = ASSESSMENT_STATUS.THIN;
  } else if (thinCount > 0) {
    status = ASSESSMENT_STATUS.MIXED;
  }

  return {
    status,
    assessedPageCount: counts.length,
    minWords: Math.min(...counts),
    medianWords: median(counts),
    averageWords: Math.round(
      counts.reduce((sum, count) => sum + count, 0) / counts.length,
    ),
    maxWords: Math.max(...counts),
  };
}

function makeShingles(text, size) {
  const words = wordsOf(text);
  if (words.length < size) return new Set();

  const shingles = new Set();
  for (let index = 0; index <= words.length - size; index += 1) {
    shingles.add(words.slice(index, index + size).join(" "));
  }

  return shingles;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return null;

  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }

  const union = left.size + right.size - intersection;
  return union ? intersection / union : null;
}

function summarizeSimilarity(
  samples,
  shingleSize,
  nearDuplicateThreshold,
) {
  const comparable = samples
    .filter(({ page }) => pageBody(page).trim().length > 0)
    .map(({ url, page }) => ({
      url,
      shingles: makeShingles(pageBody(page), shingleSize),
    }))
    .filter((item) => item.shingles.size > 0);

  if (comparable.length < 2) {
    return {
      status: ASSESSMENT_STATUS.NOT_AVAILABLE,
      comparedPairCount: 0,
      nearDuplicatePairCount: 0,
      maxPairSimilarity: null,
      threshold: nearDuplicateThreshold,
    };
  }

  let comparedPairCount = 0;
  let nearDuplicatePairCount = 0;
  let maxPairSimilarity = 0;

  for (let left = 0; left < comparable.length; left += 1) {
    for (
      let right = left + 1;
      right < comparable.length;
      right += 1
    ) {
      const similarity = jaccard(
        comparable[left].shingles,
        comparable[right].shingles,
      );

      if (similarity == null) continue;

      comparedPairCount += 1;
      maxPairSimilarity = Math.max(
        maxPairSimilarity,
        similarity,
      );

      if (similarity >= nearDuplicateThreshold) {
        nearDuplicatePairCount += 1;
      }
    }
  }

  return {
    status: nearDuplicatePairCount > 0
      ? ASSESSMENT_STATUS.DETECTED
      : ASSESSMENT_STATUS.NOT_DETECTED,
    comparedPairCount,
    nearDuplicatePairCount,
    maxPairSimilarity: Number(maxPairSimilarity.toFixed(3)),
    threshold: nearDuplicateThreshold,
  };
}

function summarizeThinContent(samples, thinWordThreshold) {
  const assessed = samples
    .map(({ url, page }) => ({
      url,
      wordCount: pageWordCount(page),
    }))
    .filter((item) => Number.isFinite(item.wordCount));

  if (!assessed.length) {
    return {
      status: ASSESSMENT_STATUS.NOT_AVAILABLE,
      thresholdWords: thinWordThreshold,
      assessedPageCount: 0,
      thinPageCount: 0,
      thinUrls: [],
    };
  }

  const thin = assessed
    .filter((item) => item.wordCount < thinWordThreshold)
    .sort((a, b) => compareStrings(a.url, b.url));

  return {
    status: thin.length > 0
      ? ASSESSMENT_STATUS.DETECTED
      : ASSESSMENT_STATUS.NOT_DETECTED,
    thresholdWords: thinWordThreshold,
    assessedPageCount: assessed.length,
    thinPageCount: thin.length,
    thinUrls: thin.map((item) => item.url),
  };
}

function hasTrustProof(page) {
  const signals = page?.signals || {};

  if (
    signals.testimonials
    || signals.credentials
    || signals.caseStudies
    || signals.policies
  ) {
    return true;
  }

  return TRUST_RE.test(pageBody(page));
}

function summarizeTrustProof(samples) {
  const assessed = samples.filter(
    ({ page }) => Boolean(page),
  );

  if (!assessed.length) {
    return {
      status: ASSESSMENT_STATUS.NOT_AVAILABLE,
      assessedPageCount: 0,
      pagesWithTrustProof: 0,
      coverageRatio: null,
    };
  }

  const pagesWithTrustProof = assessed
    .filter(({ page }) => hasTrustProof(page))
    .length;

  return {
    status: ASSESSMENT_STATUS.AVAILABLE,
    assessedPageCount: assessed.length,
    pagesWithTrustProof,
    coverageRatio: Number(
      (pagesWithTrustProof / assessed.length).toFixed(3),
    ),
  };
}

function summarizeSchema(samples) {
  const assessed = samples.filter(({ page }) => Boolean(page));

  if (!assessed.length) {
    return {
      status: ASSESSMENT_STATUS.NOT_AVAILABLE,
      assessedPageCount: 0,
      pagesWithSchema: 0,
      schemaTypes: [],
      coverageRatio: null,
    };
  }

  const allTypes = new Set();
  let pagesWithSchema = 0;

  for (const { page } of assessed) {
    const types = schemaTypes(page);
    if (types.length) pagesWithSchema += 1;
    for (const type of types) allTypes.add(type);
  }

  return {
    status: ASSESSMENT_STATUS.AVAILABLE,
    assessedPageCount: assessed.length,
    pagesWithSchema,
    schemaTypes: [...allTypes].sort(),
    coverageRatio: Number(
      (pagesWithSchema / assessed.length).toFixed(3),
    ),
  };
}

function hasConversionOfferEvidence(page) {
  if (
    Array.isArray(page?.ctas)
    && page.ctas.length > 0
  ) {
    return true;
  }

  if (
    Array.isArray(page?.forms)
    && page.forms.length > 0
  ) {
    return true;
  }

  if (page?.signals?.pricing) return true;

  return OFFER_RE.test(
    [
      pageTitle(page),
      pageH1(page),
      pageBody(page),
    ].join(" "),
  );
}

function summarizeConversionOffer(samples) {
  const assessed = samples.filter(({ page }) => Boolean(page));

  if (!assessed.length) {
    return {
      status: ASSESSMENT_STATUS.NOT_AVAILABLE,
      assessedPageCount: 0,
      pagesWithOfferSignals: 0,
      coverageRatio: null,
    };
  }

  const pagesWithOfferSignals = assessed
    .filter(({ page }) => hasConversionOfferEvidence(page))
    .length;

  return {
    status: ASSESSMENT_STATUS.AVAILABLE,
    assessedPageCount: assessed.length,
    pagesWithOfferSignals,
    coverageRatio: Number(
      (pagesWithOfferSignals / assessed.length).toFixed(3),
    ),
  };
}

function extractStateCodes(value) {
  const text = ` ${cleanText(value)} `;
  const states = new Set();

  for (const [name, code] of Object.entries(US_STATE_ALIASES)) {
    const escaped = name.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
      states.add(code);
    }
  }

  const uppercaseSource = String(value || "");
  const codeMatches = uppercaseSource.match(
    /\b[A-Z]{2}\b/g,
  ) || [];

  for (const code of codeMatches) {
    if (STATE_CODE_SET.has(code)) states.add(code);
  }

  return [...states].sort();
}

function claimGeographies(page, url) {
  return [
    ...new Set([
      ...extractStateCodes(url),
      ...extractStateCodes(pageTitle(page)),
      ...extractStateCodes(pageH1(page)),
    ]),
  ].sort();
}

function supportGeographies(page) {
  const body = pageBody(page);
  if (!body) return [];

  const segments = body
    .split(/[.!?;\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const states = new Set();

  for (const segment of segments) {
    if (!SUPPORT_CONTEXT_RE.test(segment)) continue;

    for (const code of extractStateCodes(segment)) {
      states.add(code);
    }
  }

  return [...states].sort();
}

function summarizeGeographicTrust(samples) {
  const claimStates = new Set();
  const supportStates = new Set();
  let pagesWithClaims = 0;
  let pagesWithSupport = 0;

  for (const { url, page } of samples) {
    if (!page) continue;

    const claims = claimGeographies(page, url);
    const support = supportGeographies(page);

    if (claims.length) pagesWithClaims += 1;
    if (support.length) pagesWithSupport += 1;

    for (const state of claims) claimStates.add(state);
    for (const state of support) supportStates.add(state);
  }

  const claims = [...claimStates].sort();
  const support = [...supportStates].sort();

  if (!claims.length) {
    return {
      status: ASSESSMENT_STATUS.UNKNOWN,
      claimedGeographies: [],
      supportGeographies: support,
      pagesWithClaims,
      pagesWithSupport,
      reasonCode: "NO_GEOGRAPHIC_CLAIM_EVIDENCE",
    };
  }

  if (!support.length) {
    return {
      status: ASSESSMENT_STATUS.UNKNOWN,
      claimedGeographies: claims,
      supportGeographies: [],
      pagesWithClaims,
      pagesWithSupport,
      reasonCode: "NO_GEOGRAPHIC_SUPPORT_EVIDENCE",
    };
  }

  const overlap = claims.filter(
    (state) => supportStates.has(state),
  );

  if (overlap.length) {
    return {
      status: ASSESSMENT_STATUS.ALIGNED,
      claimedGeographies: claims,
      supportGeographies: support,
      pagesWithClaims,
      pagesWithSupport,
      reasonCode: "GEOGRAPHIC_CLAIM_SUPPORTED",
    };
  }

  return {
    status: ASSESSMENT_STATUS.CONCERN,
    claimedGeographies: claims,
    supportGeographies: support,
    pagesWithClaims,
    pagesWithSupport,
    reasonCode: "GEOGRAPHIC_TRUST_ALIGNMENT_MISMATCH",
  };
}

function isMaterialCluster(cluster) {
  return cluster?.requiresRepresentativeAssessment === true;
}

function isLikelyTemplateCluster(cluster) {
  if (!isMaterialCluster(cluster)) return false;

  const reasons = new Set(
    Array.isArray(cluster?.reasonCodes)
      ? cluster.reasonCodes
      : [],
  );

  return (
    reasons.has("VARIABLE_SIBLING_FAMILY")
    || reasons.has("DYNAMIC_IDENTIFIER_FAMILY")
    || reasons.has("LARGE_REPEATED_FAMILY")
  );
}

function assessCluster(
  cluster,
  pageMap,
  options,
) {
  const samples = getRepresentativePages(cluster, pageMap);
  const assessedSamples = samples.filter(
    ({ page }) => Boolean(page),
  );

  const sampleCoverage = {
    requestedSampleCount: samples.length,
    assessedSampleCount: assessedSamples.length,
    ratio: samples.length
      ? Number(
        (assessedSamples.length / samples.length).toFixed(3),
      )
      : null,
  };

  const limitations = [];

  if (!samples.length) {
    limitations.push(
      "No representative URLs were available for this structural cluster.",
    );
  } else if (!assessedSamples.length) {
    limitations.push(
      "Representative URLs were identified, but no matching page evidence was available.",
    );
  } else if (assessedSamples.length < samples.length) {
    limitations.push(
      `${samples.length - assessedSamples.length} representative URL(s) lacked matching page evidence.`,
    );
  }

  const contentDepth = summarizeContentDepth(
    assessedSamples,
    options.thinWordThreshold,
  );

  const similarity = summarizeSimilarity(
    assessedSamples,
    options.shingleSize,
    options.nearDuplicateThreshold,
  );

  const thinContent = summarizeThinContent(
    assessedSamples,
    options.thinWordThreshold,
  );

  if (
    contentDepth.status === ASSESSMENT_STATUS.NOT_AVAILABLE
  ) {
    limitations.push(
      "Representative body-content depth could not be assessed from collected evidence.",
    );
  }

  if (
    similarity.status === ASSESSMENT_STATUS.NOT_AVAILABLE
  ) {
    limitations.push(
      "Near-duplicate content could not be assessed because fewer than two representative pages had comparable body content.",
    );
  }

  return {
    id: cluster.id || null,
    pattern: cluster.pattern || null,
    discoveredUrlCount:
      Number(cluster.discoveredUrlCount) || 0,
    sampledUrls: samples.map(({ url }) => url),
    sampleCoverage,
    reasonCodes: Array.isArray(cluster.reasonCodes)
      ? [...cluster.reasonCodes].sort()
      : [],
    contentDepth,
    similarity,
    thinContent,
    trustProof: summarizeTrustProof(assessedSamples),
    schemaEntity: summarizeSchema(assessedSamples),
    conversionOffer:
      summarizeConversionOffer(assessedSamples),
    geographicTrustAlignment:
      summarizeGeographicTrust(assessedSamples),
    limitations: [...new Set(limitations)],
  };
}

function footprintIsUsable(siteFootprint) {
  if (!siteFootprint) return false;

  return (
    siteFootprint.status === "AVAILABLE"
    || siteFootprint.status === "PARTIAL"
  );
}

export function analyzeProgrammaticSeo(input = {}) {
  const siteFootprint = input.siteFootprint || null;
  const pages = Array.isArray(input.pages)
    ? input.pages
    : [];
  const contentParsing = Array.isArray(input.contentParsing)
    ? input.contentParsing
    : [];

  const options = {
    thinWordThreshold: boundedNumber(
      input.options?.thinWordThreshold,
      DEFAULTS.thinWordThreshold,
      50,
      2000,
    ),
    nearDuplicateThreshold: boundedNumber(
      input.options?.nearDuplicateThreshold,
      DEFAULTS.nearDuplicateThreshold,
      0.5,
      1,
    ),
    shingleSize: Math.round(
      boundedNumber(
        input.options?.shingleSize,
        DEFAULTS.shingleSize,
        2,
        10,
      ),
    ),
  };

  const footprintClusters =
    Array.isArray(siteFootprint?.clusters)
      ? siteFootprint.clusters
      : [];

  const materialClusters = footprintClusters
    .filter(isMaterialCluster)
    .sort(
      (a, b) =>
        Number(b.discoveredUrlCount || 0)
        - Number(a.discoveredUrlCount || 0)
        || compareStrings(
          String(a.pattern || ""),
          String(b.pattern || ""),
        ),
    );

  const likelyClusters = materialClusters.filter(
    isLikelyTemplateCluster,
  );

  const limitations = [];

  if (!footprintIsUsable(siteFootprint)) {
    limitations.push(
      "Usable sitemap-footprint evidence was not available; programmatic SEO absence cannot be inferred.",
    );

    return {
      status:
        PROGRAMMATIC_SEO_STATUS.INSUFFICIENT_EVIDENCE,
      clusterCount: footprintClusters.length,
      assessedClusterCount: 0,
      clusters: [],
      limitations,
    };
  }

  if (
    siteFootprint.status === "PARTIAL"
    || siteFootprint.incomplete === true
  ) {
    limitations.push(
      "Sitemap-footprint coverage is incomplete; conclusions are limited to the retained footprint.",
    );
  }

  if (!materialClusters.length) {
    if (
      siteFootprint.status === "AVAILABLE"
      && siteFootprint.incomplete !== true
    ) {
      return {
        status: PROGRAMMATIC_SEO_STATUS.NOT_DETECTED,
        clusterCount: footprintClusters.length,
        assessedClusterCount: 0,
        clusters: [],
        limitations,
      };
    }

    limitations.push(
      "No material repeated URL family was retained, but footprint coverage is incomplete.",
    );

    return {
      status:
        PROGRAMMATIC_SEO_STATUS.INSUFFICIENT_EVIDENCE,
      clusterCount: footprintClusters.length,
      assessedClusterCount: 0,
      clusters: [],
      limitations,
    };
  }

  const pageMap = buildPageMap(
    pages,
    contentParsing,
  );

  const assessedClusters = materialClusters.map(
    (cluster) =>
      assessCluster(cluster, pageMap, options),
  );

  const status = likelyClusters.length
    ? PROGRAMMATIC_SEO_STATUS.LIKELY
    : PROGRAMMATIC_SEO_STATUS.INSUFFICIENT_EVIDENCE;

  if (!likelyClusters.length) {
    limitations.push(
      "Material structural clusters exist, but available reason codes do not support a likely template-scale classification.",
    );
  }

  return {
    status,
    clusterCount: footprintClusters.length,
    assessedClusterCount: assessedClusters.length,
    clusters: assessedClusters,
    limitations: [...new Set(limitations)],
  };
}

export {
  ASSESSMENT_STATUS,
  PROGRAMMATIC_SEO_STATUS,
};
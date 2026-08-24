import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSESSMENT_STATUS,
  PROGRAMMATIC_SEO_STATUS,
  analyzeProgrammaticSeo,
} from "./programmatic-seo-analysis.js";

function locationCluster(count = 30) {
  const representativeUrls = [
    "https://example.com/locations/pennsylvania",
    "https://example.com/locations/ohio",
    "https://example.com/locations/virginia",
  ];

  return {
    id: "cluster-location",
    pattern: "/locations/{segment}",
    discoveredUrlCount: count,
    representativeUrls,
    requiresRepresentativeAssessment: true,
    reasonCodes: [
      "VARIABLE_SIBLING_FAMILY",
      "LARGE_REPEATED_FAMILY",
    ],
  };
}

function page(url, {
  title = "",
  h1 = [],
  bodyText = "",
  wordCount = null,
  schemaTypes = [],
  signals = {},
  ctas = [],
  forms = [],
} = {}) {
  return {
    url,
    crawledUrl: url,
    finalUrl: url,
    title,
    headings: { h1 },
    bodyText,
    wordCount,
    schemaTypes,
    signals,
    ctas,
    forms,
  };
}

test("ordinary complete footprint with no material family is NOT_DETECTED", () => {
  const result = analyzeProgrammaticSeo({
    siteFootprint: {
      status: "AVAILABLE",
      incomplete: false,
      clusters: [
        {
          id: "home",
          pattern: "/",
          discoveredUrlCount: 1,
          representativeUrls: [
            "https://example.com/",
          ],
          requiresRepresentativeAssessment: false,
          reasonCodes: [],
        },
        {
          id: "about",
          pattern: "/about",
          discoveredUrlCount: 1,
          representativeUrls: [
            "https://example.com/about",
          ],
          requiresRepresentativeAssessment: false,
          reasonCodes: [],
        },
      ],
    },
    pages: [],
  });

  assert.equal(
    result.status,
    PROGRAMMATIC_SEO_STATUS.NOT_DETECTED,
  );
  assert.equal(result.assessedClusterCount, 0);
  assert.deepEqual(result.clusters, []);
});

test("large structural location family is classified LIKELY without claiming poor quality", () => {
  const cluster = locationCluster();

  const result = analyzeProgrammaticSeo({
    siteFootprint: {
      status: "AVAILABLE",
      incomplete: false,
      clusters: [cluster],
    },
    pages: [
      page(
        cluster.representativeUrls[0],
        {
          title: "Executive Coaching Pennsylvania",
          h1: ["Executive Coaching in Pennsylvania"],
          bodyText:
            "Executive coaching for Pennsylvania leaders. Our certified coaching team provides structured leadership programs, client case studies, testimonials, and a consultation process. ".repeat(20),
          wordCount: 420,
          schemaTypes: ["Service"],
          signals: {
            testimonials: true,
            credentials: true,
            caseStudies: true,
          },
          ctas: [
            {
              text: "Book a consultation",
              url: "/contact",
            },
          ],
        },
      ),
      page(
        cluster.representativeUrls[1],
        {
          title: "Executive Coaching Ohio",
          h1: ["Executive Coaching in Ohio"],
          bodyText:
            "Executive coaching for Ohio leaders. Our certified coaching team provides structured leadership programs, client case studies, testimonials, and a consultation process. ".repeat(20),
          wordCount: 430,
          schemaTypes: ["Service"],
          signals: {
            testimonials: true,
            credentials: true,
            caseStudies: true,
          },
          ctas: [
            {
              text: "Book a consultation",
              url: "/contact",
            },
          ],
        },
      ),
      page(
        cluster.representativeUrls[2],
        {
          title: "Executive Coaching Virginia",
          h1: ["Executive Coaching in Virginia"],
          bodyText:
            "Executive coaching for Virginia leaders. Our certified coaching team provides structured leadership programs, client case studies, testimonials, and a consultation process. ".repeat(20),
          wordCount: 410,
          schemaTypes: ["Service"],
          signals: {
            testimonials: true,
            credentials: true,
            caseStudies: true,
          },
          ctas: [
            {
              text: "Book a consultation",
              url: "/contact",
            },
          ],
        },
      ),
    ],
  });

  assert.equal(
    result.status,
    PROGRAMMATIC_SEO_STATUS.LIKELY,
  );
  assert.equal(result.assessedClusterCount, 1);

  const assessed = result.clusters[0];

  assert.equal(
    assessed.pattern,
    "/locations/{segment}",
  );
  assert.equal(
    assessed.discoveredUrlCount,
    30,
  );
  assert.equal(
    assessed.sampleCoverage.assessedSampleCount,
    3,
  );

  assert.ok(
    assessed.reasonCodes.includes(
      "VARIABLE_SIBLING_FAMILY",
    ),
  );

  assert.equal(
    assessed.thinContent.status,
    ASSESSMENT_STATUS.NOT_DETECTED,
  );
});

test("thin and near-duplicate representative content is surfaced from evidence", () => {
  const cluster = locationCluster();

  const base =
    "Leadership coaching program for senior leaders. Book a consultation with our experienced team. ";

  const result = analyzeProgrammaticSeo({
    siteFootprint: {
      status: "AVAILABLE",
      incomplete: false,
      clusters: [cluster],
    },
    pages: [
      page(
        cluster.representativeUrls[0],
        {
          title: "Leadership Coaching Pennsylvania",
          h1: ["Leadership Coaching Pennsylvania"],
          bodyText:
            `${base.repeat(12)} Pennsylvania.`,
          wordCount: 105,
        },
      ),
      page(
        cluster.representativeUrls[1],
        {
          title: "Leadership Coaching Ohio",
          h1: ["Leadership Coaching Ohio"],
          bodyText:
            `${base.repeat(12)} Ohio.`,
          wordCount: 106,
        },
      ),
      page(
        cluster.representativeUrls[2],
        {
          title: "Leadership Coaching Virginia",
          h1: ["Leadership Coaching Virginia"],
          bodyText:
            `${base.repeat(12)} Virginia.`,
          wordCount: 104,
        },
      ),
    ],
  });

  const assessed = result.clusters[0];

  assert.equal(
    result.status,
    PROGRAMMATIC_SEO_STATUS.LIKELY,
  );

  assert.equal(
    assessed.thinContent.status,
    ASSESSMENT_STATUS.DETECTED,
  );

  assert.equal(
    assessed.thinContent.thinPageCount,
    3,
  );

  assert.equal(
    assessed.similarity.status,
    ASSESSMENT_STATUS.DETECTED,
  );

  assert.ok(
    assessed.similarity.nearDuplicatePairCount > 0,
  );

  assert.ok(
    assessed.similarity.maxPairSimilarity >= 0.82,
  );
});

test("Pennsylvania target with Texas-only support evidence produces bounded geographic trust concern", () => {
  const cluster = {
    ...locationCluster(),
    representativeUrls: [
      "https://example.com/locations/pennsylvania",
    ],
  };

  const result = analyzeProgrammaticSeo({
    siteFootprint: {
      status: "AVAILABLE",
      incomplete: false,
      clusters: [cluster],
    },
    pages: [
      page(
        cluster.representativeUrls[0],
        {
          title:
            "Business Coaching in Pennsylvania",
          h1: [
            "Business Coaching for Pennsylvania Owners",
          ],
          bodyText:
            "Our coach is based in Texas and our team is located in Texas. We provide business coaching programs, testimonials, case studies, and consultations for business owners.",
          wordCount: 320,
          signals: {
            testimonials: true,
            caseStudies: true,
          },
          ctas: [
            {
              text: "Book consultation",
              url: "/contact",
            },
          ],
        },
      ),
    ],
  });

  const geographic =
    result.clusters[0]
      .geographicTrustAlignment;

  assert.equal(
    geographic.status,
    ASSESSMENT_STATUS.CONCERN,
  );

  assert.deepEqual(
    geographic.claimedGeographies,
    ["PA"],
  );

  assert.deepEqual(
    geographic.supportGeographies,
    ["TX"],
  );

  assert.equal(
    geographic.reasonCode,
    "GEOGRAPHIC_TRUST_ALIGNMENT_MISMATCH",
  );
});

test("missing geography remains UNKNOWN rather than becoming a negative finding", () => {
  const cluster = {
    ...locationCluster(),
    representativeUrls: [
      "https://example.com/services/executive-coaching",
    ],
  };

  const result = analyzeProgrammaticSeo({
    siteFootprint: {
      status: "AVAILABLE",
      incomplete: false,
      clusters: [cluster],
    },
    pages: [
      page(
        cluster.representativeUrls[0],
        {
          title: "Executive Coaching",
          h1: ["Executive Coaching"],
          bodyText:
            "Our certified team provides executive coaching, testimonials, case studies, and consultation options for senior leaders.",
          wordCount: 360,
          schemaTypes: ["Service"],
        },
      ),
    ],
  });

  const geographic =
    result.clusters[0]
      .geographicTrustAlignment;

  assert.equal(
    geographic.status,
    ASSESSMENT_STATUS.UNKNOWN,
  );

  assert.equal(
    geographic.reasonCode,
    "NO_GEOGRAPHIC_CLAIM_EVIDENCE",
  );
});

test("missing usable footprint returns INSUFFICIENT_EVIDENCE and does not infer absence", () => {
  const result = analyzeProgrammaticSeo({
    siteFootprint: {
      status: "UNAVAILABLE",
      incomplete: true,
      clusters: [],
    },
    pages: [],
  });

  assert.equal(
    result.status,
    PROGRAMMATIC_SEO_STATUS.INSUFFICIENT_EVIDENCE,
  );

  assert.equal(
    result.assessedClusterCount,
    0,
  );

  assert.match(
    result.limitations.join(" "),
    /absence cannot be inferred/i,
  );
});

test("output is deterministic regardless of page and cluster input order", () => {
  const clusterA = locationCluster(30);

  const clusterB = {
    id: "cluster-service",
    pattern: "/services/{segment}",
    discoveredUrlCount: 15,
    representativeUrls: [
      "https://example.com/services/strategy",
      "https://example.com/services/coaching",
    ],
    requiresRepresentativeAssessment: true,
    reasonCodes: [
      "VARIABLE_SIBLING_FAMILY",
      "LARGE_REPEATED_FAMILY",
    ],
  };

  const pages = [
    page(
      "https://example.com/locations/pennsylvania",
      {
        title: "Coaching Pennsylvania",
        h1: ["Coaching Pennsylvania"],
        bodyText:
          "Our team provides coaching, testimonials, case studies and consultation services. ".repeat(20),
        wordCount: 330,
      },
    ),
    page(
      "https://example.com/locations/ohio",
      {
        title: "Coaching Ohio",
        h1: ["Coaching Ohio"],
        bodyText:
          "Our team provides coaching, testimonials, case studies and consultation services. ".repeat(20),
        wordCount: 335,
      },
    ),
    page(
      "https://example.com/locations/virginia",
      {
        title: "Coaching Virginia",
        h1: ["Coaching Virginia"],
        bodyText:
          "Our team provides coaching, testimonials, case studies and consultation services. ".repeat(20),
        wordCount: 340,
      },
    ),
    page(
      "https://example.com/services/strategy",
      {
        title: "Strategy Consulting",
        h1: ["Strategy Consulting"],
        bodyText:
          "Strategy consulting, client results, credentials and consultation services. ".repeat(20),
        wordCount: 350,
      },
    ),
    page(
      "https://example.com/services/coaching",
      {
        title: "Business Coaching",
        h1: ["Business Coaching"],
        bodyText:
          "Business coaching, client results, credentials and consultation services. ".repeat(20),
        wordCount: 355,
      },
    ),
  ];

  const first = analyzeProgrammaticSeo({
    siteFootprint: {
      status: "AVAILABLE",
      incomplete: false,
      clusters: [clusterA, clusterB],
    },
    pages,
  });

  const second = analyzeProgrammaticSeo({
    siteFootprint: {
      status: "AVAILABLE",
      incomplete: false,
      clusters: [clusterB, clusterA],
    },
    pages: [...pages].reverse(),
  });

  assert.deepEqual(first, second);
});
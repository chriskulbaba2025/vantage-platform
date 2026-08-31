import test from "node:test";
import assert from "node:assert/strict";

import {
  isUtilityDecisionPage,
  scopeSiteForDecision,
} from "./decision-scope.js";

import { scoreAudit } from "./vantage-score.js";
import { SOURCE_STATUS } from "./evidence-contracts.js";

const NOW = "2026-08-26T12:00:00.000Z";

const INPUT = {
  targetUrl: "https://example.com/",
  businessName: "Example Business",
  competitors: [],
};

function commercialPage() {
  return {
    crawledUrl: "https://example.com/coaching",
    url: "https://example.com/coaching",
    finalUrl: "https://example.com/coaching",

    title: "Business Coaching",
    description: "Business coaching for growing companies.",
    metaDescription: "Business coaching for growing companies.",

    canonical: "https://example.com/coaching",
    canonicalUrl: "https://example.com/coaching",

    words: 500,
    wordCount: 500,

    headings: {
      h1: ["Business Coaching"],
      h2: ["Grow Your Business"],
      h3: [],
      h4: [],
    },

    forms: [],
    ctas: [
      {
        text: "Book a Consultation",
        url: "https://example.com/contact",
      },
    ],

        images: [
      {
        src:
          "https://example.com/hero.jpg",
        alt:
          "Business coaching",
        width: 1200,
        height: 800,
      },
    ],

    responseHeaders: {},
  };
}

function utilityPage() {
  return {
    crawledUrl:
      "https://example.com/privacy-accessibility",
    url:
      "https://example.com/privacy-accessibility",
    finalUrl:
      "https://example.com/privacy-accessibility",

    title: "Privacy and Accessibility",
    description: "",
    metaDescription: "",

    canonical:
      "https://example.com/privacy-accessibility",
    canonicalUrl:
      "https://example.com/privacy-accessibility",

    words: 0,
    wordCount: 0,

    headings: {
      h1: [],
      h2: [],
      h3: [],
      h4: [],
    },

    forms: [],
    ctas: [],

    responseHeaders: {},
  };
}

function cloudflareUtilityPage() {
  return {
    crawledUrl:
      "https://example.com/cdn-cgi/l/email-protection",
    url:
      "https://example.com/cdn-cgi/l/email-protection",
    finalUrl:
      "https://example.com/cdn-cgi/l/email-protection",

    title: "",
    description: "",
    metaDescription: "",

    canonical: null,
    canonicalUrl: null,

    words: 0,
    wordCount: 0,

    headings: {
      h1: [],
      h2: [],
      h3: [],
      h4: [],
    },

    forms: [],
    ctas: [],

    responseHeaders: {},
  };
}

function baseSite(overrides = {}) {
  return {
    sourceStatus: SOURCE_STATUS.AVAILABLE,

    targetUrl: "https://example.com/",
    domain: "example.com",

    pageCount: 1,
    pages: [commercialPage()],

    services: ["Business Coaching"],
    topicKeywords: [
      "business coaching",
      "leadership coaching",
    ],

    ctas: [
      {
        text: "Book a Consultation",
        url: "https://example.com/contact",
        kind: "link",
      },
    ],

    forms: [],

    schemaTypes: [],
    microdataTypes: [],
    socialLinks: [],

    trust: {
      testimonials: false,
      credentials: true,
      caseStudies: false,
      faq: false,
      pricing: false,
      policies: true,
      contact: true,
    },

    securityHeaders: {
      xFrameOptions: true,
      xContentTypeOptions: true,
      referrerPolicy: true,
      contentSecurityPolicy: true,
    },

    totalWords: 500,
    averageWords: 500,

    missingTitles: 0,
    missingDescriptions: 0,
    missingCanonicals: 0,

    h1Missing: 0,
    h1Multiple: 0,

    imageCount: 1,
    imagesMissingAlt: 0,

    internalLinkCount: 2,
    brokenInternalLinks: [],

    statusCounts: {
      200: 1,
    },

    limitations: [],

    collectedAt: NOW,

    coverage: {
      requested: 1,
      completed: 1,
      failed: 0,
    },

    _contentEvidenceAvailable: true,
    _interactiveEvidenceAvailable: true,
    _responseHeadersAvailable: true,
    _metaCountersAvailable: true,

    ...overrides,
  };
}

function performance() {
  return {
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    provider: "pagespeed-insights",

    mobile: {
      status: SOURCE_STATUS.AVAILABLE,
      scores: {
        performance: 70,
      },
      metrics: {},
    },

    desktop: {
      status: SOURCE_STATUS.AVAILABLE,
      scores: {
        performance: 90,
      },
      metrics: {},
    },

    fieldData: {},

    coverage: {
      requested: 2,
      completed: 2,
      failed: 0,
    },

    limitations: [],
    collectedAt: NOW,
  };
}

function evidence(site) {
  return {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",

    site,
    performance: performance(),

    competitors: null,
    backlinks: null,
    ga4: null,
    gsc: null,
  };
}

test(
  "utility classifier identifies infrastructure/legal utility URLs without classifying commercial URLs",
  () => {
    assert.equal(
      isUtilityDecisionPage(
        commercialPage(),
      ),
      false,
    );

    assert.equal(
      isUtilityDecisionPage(
        utilityPage(),
      ),
      true,
    );

    assert.equal(
      isUtilityDecisionPage(
        cloudflareUtilityPage(),
      ),
      true,
    );

    assert.equal(
      isUtilityDecisionPage({
        url: "https://example.com/privacy-policy",
      }),
      true,
    );

    assert.equal(
      isUtilityDecisionPage({
        url: "https://example.com/terms-of-service",
      }),
      true,
    );

    assert.equal(
      isUtilityDecisionPage({
        url: "https://example.com/services",
      }),
      false,
    );

    assert.equal(
      isUtilityDecisionPage({
        url: "https://example.com/contact",
      }),
      false,
    );
  },
);

test(
  "decision scope removes utility pages and recalculates page-level commercial aggregates without mutating canonical evidence",
  () => {
    const canonicalSite =
      baseSite({
        pageCount: 3,

        pages: [
          cloudflareUtilityPage(),
          commercialPage(),
          utilityPage(),
        ],

        totalWords: 500,
        averageWords: 167,

        missingTitles: 1,
        missingDescriptions: 2,
        missingCanonicals: 1,

        h1Missing: 2,
        h1Multiple: 0,

        coverage: {
          requested: 3,
          completed: 3,
          failed: 0,
        },
      });

    const original =
      JSON.parse(
        JSON.stringify(
          canonicalSite,
        ),
      );

    const scoped =
      scopeSiteForDecision(
        canonicalSite,
      );

    assert.notEqual(
      scoped,
      canonicalSite,
      "decision scope must create a separate interpretation object",
    );

    assert.equal(
      scoped.pages.length,
      1,
    );

    assert.equal(
      scoped.pages[0].crawledUrl,
      "https://example.com/coaching",
    );

    assert.equal(
      scoped.pageCount,
      1,
    );

    assert.equal(
      scoped.totalWords,
      500,
    );

    assert.equal(
      scoped.averageWords,
      500,
    );

    assert.equal(
      scoped.missingTitles,
      0,
    );

    assert.equal(
      scoped.missingDescriptions,
      0,
    );

    assert.equal(
      scoped.missingCanonicals,
      0,
    );

    assert.equal(
      scoped.h1Missing,
      0,
    );

    assert.equal(
      scoped.h1Multiple,
      0,
    );

    assert.deepEqual(
      canonicalSite,
      original,
      "canonical evidence must remain byte-equivalent at the object level",
    );
  },
);

test(
  "scoreAudit gives utility-contaminated evidence the same commercial scoring result as the equivalent utility-free evidence",
  () => {
    const cleanSite =
      baseSite();

    const contaminatedSite =
      baseSite({
        pageCount: 3,

        pages: [
          cloudflareUtilityPage(),
          commercialPage(),
          utilityPage(),
        ],

        totalWords: 500,
        averageWords: 167,

        missingTitles: 1,
        missingDescriptions: 2,
        missingCanonicals: 1,

        h1Missing: 2,
        h1Multiple: 0,

        coverage: {
          requested: 3,
          completed: 3,
          failed: 0,
        },
      });

    const cleanModel =
      scoreAudit(
        INPUT,
        evidence(
          cleanSite,
        ),
      );

    const contaminatedModel =
      scoreAudit(
        INPUT,
        evidence(
          contaminatedSite,
        ),
      );

    assert.equal(
      contaminatedModel
        .moduleScores
        .technical_hygiene
        .score,
      cleanModel
        .moduleScores
        .technical_hygiene
        .score,
      "utility metadata defects must not change commercial technical scoring",
    );

    assert.equal(
      contaminatedModel
        .moduleScores
        .content_depth
        .score,
      cleanModel
        .moduleScores
        .content_depth
        .score,
      "utility pages must not reduce commercial content-depth scoring",
    );

    assert.equal(
      contaminatedModel
        .scores
        .awareness,
      cleanModel
        .scores
        .awareness,
      "utility page count must not inflate or distort funnel scoring",
    );

    assert.deepEqual(
      contaminatedModel.findings.map(
        (finding) =>
          finding.ruleId,
      ),
      cleanModel.findings.map(
        (finding) =>
          finding.ruleId,
      ),
      "utility-only defects must not create site-level commercial findings",
    );

    // Full governed evidence is still attached to the model.
    assert.equal(
      contaminatedModel
        .evidence
        .site
        .pages
        .length,
      3,
    );

    assert.equal(
      contaminatedModel
        .evidence
        .site
        .pageCount,
      3,
    );

    assert.equal(
      contaminatedModel
        .evidence
        .site
        .missingDescriptions,
      2,
    );

    assert.equal(
      contaminatedModel
        .evidence
        .site
        .pages[0]
        .crawledUrl,
      "https://example.com/cdn-cgi/l/email-protection",
      "canonical page order must remain untouched",
    );
  },
);

test(
  "decision scope leaves an already commercial-only site unchanged",
  () => {
    const site =
      baseSite();

    const scoped =
      scopeSiteForDecision(
        site,
      );

    assert.equal(
      scoped,
      site,
      "no unnecessary copy should be created when no utility page exists",
    );
  },
);

test(
  "PF-05: decision scope preserves valid image denominators and neutralizes impossible aggregate claims",
  () => {
    const scoped =
      scopeSiteForDecision(
        baseSite({
          pageCount: 2,

          pages: [
            {
              ...commercialPage(),

              images: [
                {
                  src:
                    "https://example.com/hero.jpg",
                  alt:
                    "Business coaching",
                  width: 1200,
                  height: 800,
                },
              ],
            },

            {
              ...utilityPage(),

              images: [
                {
                  src:
                    "https://example.com/privacy.jpg",
                  alt: "",
                  width: 800,
                  height: 600,
                },
              ],
            },
          ],

          imageCount: 2,
          imagesMissingAlt: 1,
          imagesMissingDimensions: 0,
        }),
      );

    assert.equal(
      scoped.pageCount,
      1,
    );

    assert.equal(
      scoped.imageCount,
      1,
    );

    assert.equal(
      scoped.imagesMissingAlt,
      0,
    );

    assert.equal(
      scoped.imagesMissingDimensions,
      0,
    );

    const impossible =
      scopeSiteForDecision(
        baseSite({
          imageCount: null,
          imagesMissingAlt: 222,
          imagesMissingDimensions:
            null,
        }),
      );

    assert.equal(
      impossible.imageCount,
      null,
    );

    assert.equal(
      impossible.imagesMissingAlt,
      null,
      "a numerator cannot survive when its observed denominator is unavailable",
    );
  },
);

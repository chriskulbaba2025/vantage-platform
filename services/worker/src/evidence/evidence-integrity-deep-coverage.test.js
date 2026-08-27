import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCapabilityEvidence,
} from "./capability-evidence.js";

import {
  analyzeProgrammaticSeo,
} from "./programmatic-seo-analysis.js";

test(
  "EVIDENCE-04: incomplete governed deep coverage remains score-bearing as PARTIAL",
  () => {
    const adapterSource = readFileSync(
      new URL(
        "../adapters/dataforseo-onpage/dataforseo-onpage-adapter.js",
        import.meta.url,
      ),
      "utf8",
    );

    assert.match(
      adapterSource,
      /contentParsingPageLimit:\s*50/,
      "governed deep-content parsing default must be 50 pages",
    );

    const completedUrl =
      "https://example.com/services";

    const unassessedUrl =
      "https://example.com/locations/toronto";

    const decisionEvidence = {
      site: {
        sourceStatus: "AVAILABLE",

        _contentEvidenceAvailable: true,
        _interactiveEvidenceAvailable: false,

        rawArtifactRef: "fixture://onpage",
        adapterVersion: "1.4.0",

        acquisition: {
          contentParsing: {
            selectedUrls: [
              completedUrl,
              unassessedUrl,
            ],
            requestedUrls: [
              completedUrl,
            ],
            completedUrls: [
              completedUrl,
            ],
            failedUrls: [],
            unassessedUrls: [
              unassessedUrl,
            ],
            requested: 1,
            completed: 1,
            failed: 0,
            unassessedReason:
              "CONTENT_PARSING_PAGE_LIMIT",
          },
        },

        contentParsing: [
          {
            url: completedUrl,
            text:
              "Executive coaching services with testimonials and pricing.",
            wordCount: 7,
            hasMainContent: true,
          },
        ],

        pages: [],
        ctas: [],
        forms: [],
        schemaTypes: [],
        securityHeaders: {},
        trust: {
          testimonials: true,
          credentials: true,
          caseStudies: false,
          faq: false,
          pricing: true,
          policies: false,
          contact: false,
        },
      },

      performance: null,
    };

    const result = buildCapabilityEvidence({
      decisionEvidence,
      auditId:
        "11111111-1111-4111-8111-111111111111",
      generatedAt:
        "2026-08-26T00:00:00.000Z",
    });

    assert.equal(
      result.capabilities["content.body"].status,
      "PARTIAL",
    );

    assert.equal(
      result.capabilities["content.body"]
        .requiredFieldsPresent,
      true,
    );

    assert.equal(
      result.capabilities["trust.proof"].status,
      "PARTIAL",
    );

    assert.equal(
      result.capabilities["trust.proof"]
        .requiredFieldsPresent,
      true,
    );

    assert.equal(
      result.capabilities["offer.clarity"].status,
      "PARTIAL",
    );

    assert.equal(
      result.capabilities["offer.clarity"]
        .requiredFieldsPresent,
      true,
    );

    assert.match(
      result.capabilities["content.body"]
        .limitations.join(" "),
      /governed deep-content coverage is incomplete/i,
    );
  },
);

test(
  "EVIDENCE-05: crawled representative pages are not deeply assessed without completed Content Parsing",
  () => {
    const completedUrl =
      "https://example.com/locations/a";

    const unassessedTrustUrl =
      "https://example.com/locations/b";

    const unassessedOfferUrl =
      "https://example.com/locations/c";

    const cluster = {
      id: "locations",
      pattern: "/locations/{segment}",
      discoveredUrlCount: 30,
      requiresRepresentativeAssessment: true,
      reasonCodes: [
        "VARIABLE_SIBLING_FAMILY",
        "LARGE_REPEATED_FAMILY",
      ],
      representativeUrls: [
        completedUrl,
        unassessedTrustUrl,
        unassessedOfferUrl,
      ],
    };

    const pages = [
      {
        url: completedUrl,
        crawledUrl: completedUrl,
        finalUrl: completedUrl,
        title: "Location A",
        headings: {
          h1: ["Location A"],
        },
        bodyText:
          "General location information.",
        wordCount: 300,
        schemaTypes: [],
        signals: {},
        ctas: [],
        forms: [],
      },

      {
        url: unassessedTrustUrl,
        crawledUrl: unassessedTrustUrl,
        finalUrl: unassessedTrustUrl,
        title: "Location B",
        headings: {
          h1: ["Location B"],
        },
        bodyText:
          "Testimonials credentials client results.",
        wordCount: 300,
        schemaTypes: [
          "Service",
        ],
        signals: {
          testimonials: true,
          credentials: true,
        },
        ctas: [],
        forms: [],
      },

      {
        url: unassessedOfferUrl,
        crawledUrl: unassessedOfferUrl,
        finalUrl: unassessedOfferUrl,
        title: "Location C Pricing",
        headings: {
          h1: ["Book Location C"],
        },
        bodyText:
          "Pricing package book consultation.",
        wordCount: 300,
        schemaTypes: [
          "Service",
        ],
        signals: {
          pricing: true,
        },
        ctas: [
          {
            text: "Book",
            url: "/contact",
          },
        ],
        forms: [],
      },
    ];

    const result = analyzeProgrammaticSeo({
      siteFootprint: {
        status: "AVAILABLE",
        incomplete: false,
        clusters: [
          cluster,
        ],
      },

      pages,

      contentParsing: [
        {
          url: completedUrl,
          text:
            "General location information.",
          wordCount: 300,
          hasMainContent: true,
        },
      ],

      contentParsingAcquisition: {
        selectedUrls: [
          completedUrl,
          unassessedTrustUrl,
          unassessedOfferUrl,
        ],
        requestedUrls: [
          completedUrl,
        ],
        completedUrls: [
          completedUrl,
        ],
        failedUrls: [],
        unassessedUrls: [
          unassessedTrustUrl,
          unassessedOfferUrl,
        ],
        requested: 1,
        completed: 1,
        failed: 0,
      },
    });

    const assessed =
      result.clusters[0];

    assert.equal(
      assessed.sampleCoverage.requestedSampleCount,
      3,
    );

    assert.equal(
      assessed.sampleCoverage.assessedSampleCount,
      1,
    );

    assert.equal(
      assessed.trustProof.assessedPageCount,
      1,
    );

    assert.equal(
      assessed.trustProof.pagesWithTrustProof,
      0,
    );

    assert.equal(
      assessed.schemaEntity.assessedPageCount,
      1,
    );

    assert.equal(
      assessed.schemaEntity.pagesWithSchema,
      0,
    );

    assert.equal(
      assessed.conversionOffer.assessedPageCount,
      1,
    );

    assert.equal(
      assessed.conversionOffer.pagesWithOfferSignals,
      0,
    );
  },
);

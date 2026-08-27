import test from "node:test";
import assert from "node:assert/strict";

import {
  validateConversionPaths,
} from "./conversion-path-validator.js";

import {
  buildCapabilityEvidence,
} from "./capability-evidence.js";

import {
  scoreAudit,
} from "../scoring/vantage-score.js";

const FIXED_TS =
  "2026-08-27T12:00:00.000Z";

function mockElement({
  text = "",
  href = null,
} = {}) {
  return {
    async textContent() {
      return text;
    },

    async isVisible() {
      return true;
    },

    async isEnabled() {
      return true;
    },

    async getAttribute(name) {
      return name === "href"
        ? href
        : null;
    },

    async evaluate() {
      return false;
    },
  };
}

function mockMainPage(
  documentHeaders,
) {
  const cta =
    mockElement({
      text: "Contact Us",
      href:
        "https://example.com/contact",
    });

  const navLinks = [
    mockElement({
      text: "Home",
      href:
        "https://example.com/",
    }),

    mockElement({
      text: "Contact",
      href:
        "https://example.com/contact",
    }),
  ];

  return {
    async goto() {
      return {
        ok: true,

        status() {
          return 200;
        },

        async allHeaders() {
          return documentHeaders;
        },
      };
    },

    async $$(selector) {
      if (selector === "a[href]") {
        return [cta];
      }

      if (
        selector.includes(
          "nav a[href]",
        ) ||
        selector.includes(
          "header a[href]",
        )
      ) {
        return navLinks;
      }

      if (selector === "form") {
        return [];
      }

      return [];
    },

    async $(selector) {
      if (
        selector === "nav, header"
      ) {
        return mockElement({
          text: "nav",
        });
      }

      return null;
    },

    async close() {},
  };
}

function mockDestinationPage() {
  return {
    async goto() {
      return {
        ok: true,

        status() {
          return 200;
        },
      };
    },

    async close() {},
  };
}

function mockPlaywright(
  documentHeaders,
) {
  const mainPage =
    mockMainPage(
      documentHeaders,
    );

  const destinationPage =
    mockDestinationPage();

  const browser = {
    async newContext() {
      return {
        async newPage() {
          return mainPage;
        },

        async close() {},
      };
    },

    async newPage() {
      return destinationPage;
    },

    async close() {},
  };

  return {
    chromium: {
      async launch() {
        return browser;
      },
    },
  };
}

function evidence() {
  return {
    site: {
      sourceStatus:
        "AVAILABLE",

      targetUrl:
        "https://example.com/",

      domain:
        "example.com",

      pageCount: 2,

      pages: [
        {
          url:
            "https://example.com/",
          title:
            "Consulting",
          description:
            "Consulting services",
          canonical:
            "https://example.com/",
          headings: {
            h1: ["Consulting"],
            h2: [],
            h3: [],
          },
          wordCount: 400,
        },

        {
          url:
            "https://example.com/contact",
          title:
            "Contact",
          description:
            "Contact us",
          canonical:
            "https://example.com/contact",
          headings: {
            h1: ["Contact"],
            h2: [],
            h3: [],
          },
          wordCount: 400,
        },
      ],

      totalWords: 800,
      averageWords: 400,

      missingTitles: 0,
      missingDescriptions: 0,
      missingCanonicals: 0,
      h1Missing: 0,
      h1Multiple: 0,

      imageCount: 0,
      imagesMissingAlt: 0,
      imagesMissingDimensions: 0,

      schemaTypes: [
        "Organization",
      ],

      forms: [],
      ctas: [],
      externalCtas: [],
      socialLinks: [],

      internalLinkCount: 1,
      brokenInternalLinks: [],

      platform: null,

      services: [
        "Consulting",
      ],

      topicKeywords: [],

      securityHeaders: {},

      trust: {
        testimonials: true,
        credentials: true,
        caseStudies: true,
        faq: true,
        pricing: true,
        policies: true,
        contact: true,
      },

      limitations: [],

      _contentEvidenceAvailable:
        true,

      _interactiveEvidenceAvailable:
        false,

      _responseHeadersAvailable:
        false,

      _metaCountersAvailable:
        true,

      collectedAt:
        FIXED_TS,

      coverage: {
        requested: 2,
        completed: 2,
        failed: 0,
      },

      rawArtifactRef: null,
    },

    performance: {
      sourceStatus:
        "UNAVAILABLE",

      coverage: {
        requested: 0,
        completed: 0,
        failed: 0,
      },

      limitations: [],
    },

    competitors: [],
    backlinks: null,
    ga4: null,
    gsc: null,
  };
}

async function collectHeaders(
  documentHeaders,
) {
  return validateConversionPaths({
    targetUrl:
      "https://example.com",

    keyPages: [
      {
        url:
          "https://example.com/",
        role: "home",
      },
    ],

    playwrightImpl:
      mockPlaywright(
        documentHeaders,
      ),

    options: {
      mobile: false,
      screenshots: false,
    },
  });
}

test(
  "TBK-REPAIR-03: real browser response headers make Risk Reduction assessable while uncollected headers stay unknown",
  async () => {
    const validation =
      await collectHeaders({
        "x-frame-options":
          "SAMEORIGIN",

        "x-content-type-options":
          "nosniff",

        "referrer-policy":
          "strict-origin-when-cross-origin",
      });

    const responseHeaders =
      validation.pages[0]
        .checks.desktop
        .responseHeaders;

    assert.equal(
      responseHeaders.collected,
      true,
    );

    assert.equal(
      responseHeaders.xFrameOptions,
      true,
    );

    assert.equal(
      responseHeaders
        .xContentTypeOptions,
      true,
    );

    assert.equal(
      responseHeaders.referrerPolicy,
      true,
    );

    assert.equal(
      responseHeaders
        .contentSecurityPolicy,
      false,
    );

    assert.equal(
      responseHeaders.values
        .xFrameOptions,
      "SAMEORIGIN",
    );

    const canonicalEvidence =
      evidence();

    const capabilityEvidence =
      buildCapabilityEvidence({
        decisionEvidence:
          canonicalEvidence,

        auditId:
          "tbk-repair-03",

        generatedAt:
          FIXED_TS,

        pathValidationEvidence:
          validation,
      });

    const headers =
      capabilityEvidence
        .capabilities[
          "technical.headers"
        ];

    assert.equal(
      headers.status,
      "AVAILABLE",
    );

    assert.equal(
      headers.validated,
      true,
    );

    assert.equal(
      headers.validatedBy,
      "playwright-conversion-path",
    );

    assert.deepEqual(
      headers.observedHeaders,
      {
        xFrameOptions: true,
        xContentTypeOptions: true,
        referrerPolicy: true,
        contentSecurityPolicy: false,
      },
    );

    const model =
      scoreAudit(
        {
          services: [
            "Consulting",
          ],
        },

        canonicalEvidence,

        {
          scoredAt:
            FIXED_TS,

          capabilityEvidence,
        },
      );

    assert.equal(
      model.moduleEligibility
        .risk_reduction,
      true,
      "Risk Reduction becomes legitimately assessable",
    );

    assert.equal(
      model.moduleScores
        .risk_reduction
        .score,
      94,
      "Risk Reduction consumes the real browser-observed headers",
    );

    const headerSubscore =
      model.moduleScores
        .technical_hygiene
        .subScores
        .find(
          (item) =>
            item.key === "headers",
        );

    assert.equal(
      headerSubscore.score,
      8,
      "three of four governed security headers score from the browser response",
    );

    const finding =
      model.findings.find(
        (item) =>
          item.ruleId ===
          "VAN-TECH-003",
      );

    assert.ok(
      finding,
      "the missing CSP is reported from observed evidence",
    );

    assert.equal(
      finding.evidence[0]
        .provider,
      "playwright-conversion-path",
    );

    assert.equal(
      finding.evidence[0]
        .observedValue,
      "contentSecurityPolicy",
    );

    // No header object returned by the real document response:
    // collection remains unknown rather than fabricating four missing
    // security headers.
    const unknownValidation =
      await collectHeaders(null);

    assert.equal(
      unknownValidation.pages[0]
        .checks.desktop
        .responseHeaders
        .collected,
      false,
    );

    const unknownEvidence =
      evidence();

    const unknownCapabilities =
      buildCapabilityEvidence({
        decisionEvidence:
          unknownEvidence,

        auditId:
          "tbk-repair-03-unknown",

        generatedAt:
          FIXED_TS,

        pathValidationEvidence:
          unknownValidation,
      });

    assert.equal(
      unknownCapabilities
        .capabilities[
          "technical.headers"
        ].status,
      "UNAVAILABLE",
    );

    const unknownModel =
      scoreAudit(
        {
          services: [
            "Consulting",
          ],
        },

        unknownEvidence,

        {
          scoredAt:
            FIXED_TS,

          capabilityEvidence:
            unknownCapabilities,
        },
      );

    assert.equal(
      unknownModel
        .moduleEligibility
        .risk_reduction,
      false,
      "uncollected headers cannot make Risk Reduction eligible",
    );

    assert.equal(
      unknownModel
        .moduleScores
        .risk_reduction
        .score,
      null,
    );

    assert.equal(
      unknownModel.findings.some(
        (item) =>
          item.ruleId ===
          "VAN-TECH-003",
      ),
      false,
      "unknown headers do not create a false missing-header finding",
    );
  },
);

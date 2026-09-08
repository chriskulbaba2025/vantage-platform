import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFindings,
} from "./score-components.js";

import {
  SOURCE_STATUS,
} from "./evidence-contracts.js";

function site() {
  return {
    sourceStatus:
      SOURCE_STATUS.AVAILABLE,

    targetUrl:
      "https://example.test/",

    domain:
      "example.test",

    pageCount: 2,

    pages: [
      {
        url:
          "https://example.test/",
        title:
          "Home",
        description:
          "Example",
        headings: {
          h1: ["Example"],
          h2: [],
          h3: [],
          h4: [],
        },
      },
    ],

    services: [
      "Consulting",
    ],

    contentParsing: [
      {
        url:
          "https://example.test/",
        text:
          "Substantive assessed page content.",
        wordCount: 100,
      },
    ],

    trust: {
      testimonials: true,
      credentials: true,
      caseStudies: true,
      faq: false,
      pricing: true,
      policies: true,
      contact: true,
    },

    schemaTypes: [
      "Organization",
    ],

    missingDescriptions: 0,
    h1Missing: 0,
    h1Multiple: 0,

    imageCount: 1,
    imagesMissingAlt: 0,
    imagesMissingDimensions: 0,

    securityHeaders: {
      xFrameOptions: true,
      xContentTypeOptions: true,
      referrerPolicy: true,
      contentSecurityPolicy: true,
    },
  };
}

function capabilities(status) {
  return {
    "content.body": {
      status,
      requiredFieldsPresent: true,
    },

    "trust.proof": {
      status,
      requiredFieldsPresent: true,
    },
  };
}

function faqFinding(status) {
  const findings =
    buildFindings(
      site(),
      {},
      null,
      {
        capabilities:
          capabilities(status),
        suppressedReasons: [],
      },
    );

  return findings.find(
    (finding) =>
      finding.ruleId ===
      "VAN-CONTENT-002",
  );
}

test(
  "P1-BUYER-QUESTION-01: available FAQ evidence produces an FAQ-only finding",
  () => {
    const finding =
      faqFinding(
        SOURCE_STATUS.AVAILABLE,
      );

    assert.ok(finding);

    assert.equal(
      finding.title,
      "No explicit FAQ content detected",
    );

    assert.equal(
      finding.evidenceText,
      "No explicit FAQ section detected",
    );

    assert.match(
      finding.businessImpact,
      /does not establish that buyer questions are unanswered elsewhere/i,
    );

    const clientText = [
      finding.title,
      finding.evidenceText,
      finding.businessImpact,
      finding.recommendation,
    ].join(" ");

    assert.doesNotMatch(
      clientText,
      /\bno buyer-question content\b|\bmissing buyer-question content\b|\bbuyer questions may remain unsupported\b/i,
    );
  },
);

test(
  "P1-BUYER-QUESTION-02: partial FAQ evidence stays bounded to assessed pages",
  () => {
    const finding =
      faqFinding(
        SOURCE_STATUS.PARTIAL,
      );

    assert.ok(finding);

    assert.equal(
      finding.title,
      "Explicit FAQ content was not detected in the available partial assessment",
    );

    assert.equal(
      finding.evidenceText,
      "No explicit FAQ content was detected in the available partial assessment",
    );

    assert.match(
      finding.businessImpact,
      /does not establish whether buyer questions are answered elsewhere/i,
    );

    assert.match(
      finding.businessImpact,
      /unassessed pages remain unknown/i,
    );

    assert.equal(
      finding.evidence[0].sourceStatus,
      SOURCE_STATUS.PARTIAL,
    );
  },
);
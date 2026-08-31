import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCapabilityEvidence,
} from "./capability-evidence.js";

import {
  scoreAudit,
} from "../scoring/vantage-score.js";

const FIXED_TS =
  "2026-08-27T12:00:00.000Z";

function decisionEvidence() {
  return {
    site: {
      sourceStatus: "AVAILABLE",
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

function readyCta() {
  return {
    found: true,
    visible: true,
    interactable: true,
    target:
      "https://example.com/contact",
    targetResolves: true,
    obstructed: false,
  };
}

function absentForm() {
  return {
    found: false,
    fieldsEditable: null,
    submitEnabled: null,
    limitation: null,
  };
}

function readyForm() {
  return {
    found: true,
    fieldsEditable: true,
    submitEnabled: true,
    limitation: null,
  };
}

function assessedPathEvidence() {
  return {
    provider:
      "playwright-conversion-path",
    status: "PASS",
    pages: [
      {
        url:
          "https://example.com/",
        role: "home",
        status: "PASS",
        checks: {
          desktop: {
            cta: readyCta(),
            form: absentForm(),
          },
          mobile: {
            cta: readyCta(),
            form: absentForm(),
          },
        },
        limitations: [],
      },
      {
        url:
          "https://example.com/contact",
        role: "conversion",
        status: "PASS",
        checks: {
          desktop: {
            cta: readyCta(),
            form: readyForm(),
          },
          mobile: {
            cta: readyCta(),
            form: readyForm(),
          },
        },
        limitations: [],
      },
    ],
    summary: {
      requested: 2,
      pass: 2,
      partial: 0,
      failed: 0,
      notAssessed: 0,
    },
    limitations: [],
  };
}

function notAssessedPathEvidence() {
  return {
    provider:
      "playwright-conversion-path",
    status:
      "NOT_ASSESSED",
    pages: [
      {
        url:
          "https://example.com/",
        role: "home",
        status:
          "NOT_ASSESSED",
        checks: {
          cta: {
            found: null,
            visible: null,
            interactable: null,
            target: null,
            targetResolves: null,
            obstructed: null,
          },
          form: {
            found: null,
            fieldsEditable: null,
            submitEnabled: null,
          },
        },
        limitations: [
          "Browser unavailable",
        ],
      },
    ],
    summary: {
      requested: 1,
      pass: 0,
      partial: 0,
      failed: 0,
      notAssessed: 1,
    },
    limitations: [
      "Browser unavailable",
    ],
  };
}

test(
  "TBK-REPAIR-02: genuine browser evidence makes Conversion Paths assessable while NOT_ASSESSED stays suppressed",
  () => {
    const evidence =
      decisionEvidence();

    const capabilityEvidence =
      buildCapabilityEvidence({
        decisionEvidence:
          evidence,
        auditId:
          "tbk-repair-02-assessed",
        generatedAt:
          FIXED_TS,
        pathValidationEvidence:
          assessedPathEvidence(),
      });

    const cta =
      capabilityEvidence
        .capabilities[
          "conversion.cta"
        ];

    const form =
      capabilityEvidence
        .capabilities[
          "conversion.form"
        ];

    const path =
      capabilityEvidence
        .capabilities[
          "conversion.path"
        ];

    assert.equal(
      cta.status,
      "AVAILABLE",
    );

    assert.equal(
      cta.validated,
      true,
    );

    assert.deepEqual(
      cta.browserSummary,
      {
        requested: 2,
        completed: 2,
        unassessed: 0,
        presentPages: 2,
        readyPages: 2,
      },
    );

    assert.equal(
      form.status,
      "AVAILABLE",
    );

    assert.equal(
      form.validated,
      true,
    );

    assert.deepEqual(
      form.browserSummary,
      {
        requested: 2,
        completed: 2,
        unassessed: 0,
        presentPages: 1,
        readyPages: 1,
      },
    );

    assert.equal(
      path.status,
      "AVAILABLE",
    );

    assert.equal(
      path.validated,
      true,
    );

    const model =
      scoreAudit(
        {
          services: [
            "Consulting",
          ],
          primaryGoal:
            "book a consultation",
        },
        evidence,
        {
          scoredAt:
            FIXED_TS,
          capabilityEvidence,
        },
      );

    assert.equal(
      model.moduleEligibility
        .conversion_paths,
      true,
      "Conversion Paths becomes legitimately assessable",
    );

    assert.equal(
      model.moduleScores
        .conversion_paths
        .score,
      100,
      "conversion score uses browser-observed CTA/form readiness rather than stale empty site arrays",
    );

    assert.notEqual(
      model.conversionPaths[0]
        .status,
      "Not Assessed",
      "report projection reflects the browser-assessed conversion path",
    );

    assert.equal(
      model.readinessMap[0]
        .cta,
      "Form",
      "browser-observed conversion-relevant form reaches the report model",
    );

    const unknownEvidence =
      decisionEvidence();

    const unknownCapabilities =
      buildCapabilityEvidence({
        decisionEvidence:
          unknownEvidence,
        auditId:
          "tbk-repair-02-unknown",
        generatedAt:
          FIXED_TS,
        pathValidationEvidence:
          notAssessedPathEvidence(),
      });

    assert.equal(
      unknownCapabilities
        .capabilities[
          "conversion.cta"
        ].status,
      "UNAVAILABLE",
    );

    assert.equal(
      unknownCapabilities
        .capabilities[
          "conversion.form"
        ].status,
      "UNAVAILABLE",
    );

    assert.equal(
      unknownCapabilities
        .capabilities[
          "conversion.path"
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
        .conversion_paths,
      false,
      "NOT_ASSESSED browser evidence cannot make the module eligible",
    );

    assert.equal(
      unknownModel
        .moduleScores
        .conversion_paths
        .score,
      null,
      "unknown browser evidence remains non-penalizing",
    );

    assert.equal(
      unknownModel
        .conversionPaths[0]
        .status,
      "Not Assessed",
      "report remains explicit when browser evidence is unavailable",
    );
  },
);

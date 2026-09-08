import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_TRUTH_STATE,
  attachClientTruthActions,
  buildCrossReportInterpretation,
  requireClientTruth,
  requireCrossReportInterpretation,
} from "./cross-report-interpretation.js";

const available = (extra = {}) => ({
  status: "AVAILABLE",
  coverage: {
    requested: 1,
    completed: 1,
    failed: 0,
  },
  limitations: [],
  ...extra,
});

function baseCapabilities(overrides = {}) {
  return {
    "offer.clarity": available(),
    "conversion.cta": available(),
    "conversion.path": available(),
    "content.body": available(),
    "trust.proof": available(),
    "performance.lab": available(),
    "performance.field": {
      status: "UNAVAILABLE",
      limitations: [
        "CrUX field data unavailable",
      ],
    },
    "technical.indexability": available(),
    ...overrides,
  };
}

test(
  "P1-CLIENT-TRUTH-00: missing capability evidence fails closed in rich truth while legacy labels remain compatible",
  () => {
    const projection =
      buildCrossReportInterpretation({
        site: {
          services: ["SEO"],
          ctas: [
            {
              text: "Contact",
              url: "/contact",
            },
          ],
          trust: {
            faq: false,
            credentials: true,
          },
          nonIndexablePages: [],
        },
        scores: {
          performance: 82,
        },
        bands: {
          trust: "Strong",
        },
        conversionPaths: [
          {
            status: "Clear",
          },
        ],
      });

    assert.equal(
      projection
        .constructs
        .ctaClarity,
      "Clear",
    );

    assert.equal(
      projection
        .truth
        .ctaClarity
        .state,
      CLIENT_TRUTH_STATE.NOT_ASSESSED,
    );

    assert.equal(
      projection
        .truth
        .conversionPathClarity
        .state,
      CLIENT_TRUTH_STATE.NOT_ASSESSED,
    );

    assert.equal(
      projection
        .truth
        .performanceReadiness
        .state,
      CLIENT_TRUTH_STATE.NOT_ASSESSED,
    );
  },
);

test(
  "P1-CLIENT-TRUTH-01: CTA presence never upgrades a weak conversion path",
  () => {
    const projection =
      buildCrossReportInterpretation({
        site: {
          services: [
            "web design",
          ],
          ctas: [
            {
              text: "Book",
              url: "/book",
            },
          ],
          trust: {
            faq: true,
            credentials: true,
          },
          nonIndexablePages: [],
        },

        performance: {
          mobile: {
            scores: {
              performance: 62,
            },
          },
          desktop: {
            scores: {
              performance: 91,
            },
          },
        },

        scores: {
          performance: 76,
        },

        bands: {
          trust: "Moderate",
        },

        conversionPaths: [
          {
            status: "Weak",
            blockers: [
              "missing reassurance",
            ],
          },
        ],

        capabilities:
          baseCapabilities(),
      });

    assert.equal(
      projection.version,
      "2.0.0",
    );

    assert.equal(
      projection
        .constructs
        .ctaClarity,
      "Clear",
    );

    assert.equal(
      projection
        .constructs
        .conversionPathClarity,
      "Weak",
    );

    assert.equal(
      projection
        .truth
        .conversionPathClarity
        .state,
      CLIENT_TRUTH_STATE.FINDING,
    );

    assert.match(
      projection
        .truth
        .conversionPathClarity
        .clientConclusion,
      /not clear enough to treat as working end to end/i,
    );

    assert.ok(
      projection
        .truth
        .conversionPathClarity
        .prohibitedUpgrades
        .includes(
          "conversion path is adequate",
        ),
    );
  },
);

test(
  "P1-CLIENT-TRUTH-02: unavailable CTA evidence fails closed instead of asserting absence",
  () => {
    const projection =
      buildCrossReportInterpretation({
        site: {
          ctas: [],
          trust: {},
          nonIndexablePages: [],
        },

        capabilities:
          baseCapabilities({
            "conversion.cta": {
              status:
                "UNAVAILABLE",
              limitations: [
                "interactive evidence was not collected",
              ],
            },
          }),
      });

    assert.equal(
      projection
        .constructs
        .ctaClarity,
      "Not Assessed",
    );

    assert.equal(
      projection
        .truth
        .ctaClarity
        .state,
      CLIENT_TRUTH_STATE.NOT_ASSESSED,
    );

    assert.doesNotMatch(
      projection
        .truth
        .ctaClarity
        .clientConclusion,
      /no cta|absent/i,
    );
  },
);

test(
  "P1-CLIENT-TRUTH-03: FAQ absence remains an FAQ-only conclusion",
  () => {
    const projection =
      buildCrossReportInterpretation({
        site: {
          trust: {
            faq: false,
          },
          services: [
            "SEO",
          ],
          ctas: [
            {
              text: "Contact",
              url: "/contact",
            },
          ],
          nonIndexablePages: [],
        },

        capabilities:
          baseCapabilities(),

        conversionPaths: [
          {
            status: "Clear",
          },
        ],
      });

    assert.equal(
      projection
        .truth
        .buyerQuestionCoverage
        .clientConclusion,
      "No explicit FAQ content was detected on the assessed page(s).",
    );

    assert.ok(
      projection
        .truth
        .buyerQuestionCoverage
        .prohibitedUpgrades
        .includes(
          "no buyer-question content exists",
        ),
    );
  },
);

test(
  "P1-CLIENT-TRUTH-04: observed trust proof does not infer placement or underuse",
  () => {
    const projection =
      buildCrossReportInterpretation({
        site: {
          trust: {
            testimonials: true,
            credentials: true,
            faq: true,
          },
          services: [
            "SEO",
          ],
          ctas: [
            {
              text: "Contact",
              url: "/contact",
            },
          ],
          nonIndexablePages: [],
        },

        capabilities:
          baseCapabilities(),

        conversionPaths: [
          {
            status: "Clear",
          },
        ],
      });

    assert.equal(
      projection
        .truth
        .trustProof
        .clientConclusion,
      "Trust proof was observed in the assessed scope.",
    );

    assert.ok(
      projection
        .truth
        .trustProof
        .prohibitedUpgrades
        .includes(
          "trust proof is underused",
        ),
    );

    assert.doesNotMatch(
      projection
        .truth
        .trustProof
        .clientConclusion,
      /underused|poorly placed/i,
    );
  },
);

test(
  "P1-CLIENT-TRUTH-05: lab performance stays partial when real-user field evidence is unavailable",
  () => {
    const projection =
      buildCrossReportInterpretation({
        site: {
          trust: {
            faq: true,
          },
          services: [
            "SEO",
          ],
          ctas: [],
          nonIndexablePages: [],
        },

        performance: {
          mobile: {
            scores: {
              performance: 62,
            },
          },
          desktop: {
            scores: {
              performance: 91,
            },
          },
        },

        scores: {
          performance: 76,
        },

        capabilities:
          baseCapabilities(),

        conversionPaths: [
          {
            status:
              "Not Assessed",
          },
        ],
      });

    assert.equal(
      projection
        .truth
        .performanceReadiness
        .state,
      CLIENT_TRUTH_STATE.PARTIAL,
    );

    assert.match(
      projection
        .truth
        .performanceReadiness
        .clientConclusion,
      /desktop lab score 91/i,
    );

    assert.match(
      projection
        .truth
        .performanceReadiness
        .clientConclusion,
      /mobile lab score 62/i,
    );

    assert.match(
      projection
        .truth
        .performanceReadiness
        .clientConclusion,
      /Real-user field performance was not available/i,
    );

    assert.ok(
      projection
        .truth
        .performanceReadiness
        .prohibitedUpgrades
        .includes(
          "performance PASS",
        ),
    );
  },
);

test(
  "P1-CLIENT-TRUTH-06: partial indexability never becomes site-wide certainty",
  () => {
    const projection =
      buildCrossReportInterpretation({
        site: {
          trust: {
            faq: true,
          },
          services: [
            "SEO",
          ],
          ctas: [],
          nonIndexablePages: [],
        },

        capabilities:
          baseCapabilities({
            "technical.indexability": {
              status:
                "PARTIAL",
              coverage: {
                requested: 5,
                completed: 2,
                failed: 3,
              },
              limitations: [
                "three selected pages were not assessed",
              ],
            },
          }),
      });

    assert.equal(
      projection
        .truth
        .indexability
        .state,
      CLIENT_TRUTH_STATE.PARTIAL,
    );

    assert.equal(
      projection
        .truth
        .indexability
        .scope,
      "2 of 5 requested page(s)",
    );

    assert.match(
      projection
        .truth
        .indexability
        .qualifier,
      /limited to the assessed scope/i,
    );

    assert.ok(
      projection
        .truth
        .indexability
        .prohibitedUpgrades
        .includes(
          "the entire site is indexable",
        ),
    );
  },
);

test(
  "P1-CLIENT-TRUTH-07: legacy v1 projection remains readable while migrated consumers require v2",
  () => {
    const legacy = {
      version: "1.0.0",
      constructs: {
        offerClarity:
          "Observed service scope",
        ctaClarity:
          "Clear",
        conversionPathClarity:
          "Clear",
        trustProof:
          "Moderate",
        mobileUsability:
          "Strong",
        indexability:
          "Strong",
      },
    };

    assert.strictEqual(
      requireCrossReportInterpretation({
        crossReportInterpretation:
          legacy,
      }),
      legacy,
    );

    assert.throws(
      () =>
        requireClientTruth({
          crossReportInterpretation:
            legacy,
        }),
      /requires Client Truth Contract v2\.0\.0/,
    );
  },
);

test(
  "P1-CLIENT-TRUTH-08: client action attachment requires one complete owned impact story",
  () => {
    const projection =
      buildCrossReportInterpretation({
        site: {
          trust: {
            faq: true,
            credentials: true,
          },
          services: [
            "SEO",
          ],
          ctas: [
            {
              text: "Contact",
              url: "/contact",
            },
          ],
          nonIndexablePages: [],
        },

        capabilities:
          baseCapabilities(),

        conversionPaths: [
          {
            status: "Clear",
          },
        ],
      });

    const attached =
      attachClientTruthActions(
        projection,
        [
          {
            findingId:
              "F-1",
            ruleId:
              "VAN-CONV-001",
            rank: 1,
            group:
              "DO NOW",
            impactLabel:
              "Direct conversion impact",
            businessReason:
              "The assessed conversion path prevents a clear next step.",
            recommendation:
              "Repair the primary path.",
          },
        ],
      );

    assert.equal(
      attached.actions.length,
      1,
    );

    assert.equal(
      attached
        .actions[0]
        .impactLabel,
      "Direct conversion impact",
    );

    assert.equal(
      attached
        .actions[0]
        .businessReason,
      "The assessed conversion path prevents a clear next step.",
    );

    assert.throws(
      () =>
        attachClientTruthActions(
          projection,
          [
            {
              findingId:
                "F-1",
              ruleId:
                "VAN-CONV-001",
              rank: 1,
              group:
                "DO NOW",
            },
          ],
        ),
      /requires findingId, ruleId, rank, group, impactLabel, and businessReason/,
    );
  },
);
import test from "node:test";
import assert from "node:assert/strict";

import {
  attachClientTruthActions,
  buildCrossReportInterpretation,
} from "./cross-report-interpretation.js";

import {
  requireClientTruthIntegrity,
  validateClientTruth,
} from "./client-truth-gate.js";

const available = (
  extra = {},
) => ({
  status: "AVAILABLE",
  coverage: {
    requested: 1,
    completed: 1,
    failed: 0,
  },
  limitations: [],
  ...extra,
});

function capabilities(
  overrides = {},
) {
  return {
    "offer.clarity":
      available(),

    "conversion.cta":
      available(),

    "conversion.path":
      available(),

    "content.body":
      available(),

    "trust.proof":
      available(),

    "performance.lab":
      available(),

    "performance.field": {
      status:
        "UNAVAILABLE",
      limitations: [
        "field data unavailable",
      ],
    },

    "technical.indexability":
      available(),

    ...overrides,
  };
}

function validProjection() {
  return attachClientTruthActions(
    buildCrossReportInterpretation({
      site: {
        services: [
          "SEO",
        ],

        ctas: [
          {
            text:
              "Contact",
            url:
              "/contact",
          },
        ],

        trust: {
          faq: true,
          credentials: true,
          testimonials: true,
        },

        nonIndexablePages:
          [],
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
        trust:
          "Strong",
      },

      conversionPaths: [
        {
          status:
            "Clear",
        },
      ],

      capabilities:
        capabilities(),
    }),

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
          "The assessed conversion path requires a clearer next step.",

        recommendation:
          "Clarify the primary conversion action.",

        verificationMethod:
          "Re-check the assessed conversion path.",
      },
    ],
  );
}

test(
  "P1-CLIENT-GATE-01: valid Client Truth passes deterministic integrity validation",
  () => {
    const projection =
      validProjection();

    const result =
      validateClientTruth(
        projection,
      );

    assert.equal(
      result.valid,
      true,
    );

    assert.deepEqual(
      result.errors,
      [],
    );

    assert.strictEqual(
      requireClientTruthIntegrity({
        crossReportInterpretation:
          projection,
      }),
      projection,
    );
  },
);

test(
  "P1-CLIENT-GATE-02: not-assessed evidence cannot become PASS",
  () => {
    const projection =
      JSON.parse(
        JSON.stringify(
          validProjection(),
        ),
      );

    projection
      .truth
      .evidenceScope
      .state =
      "not assessed";

    projection
      .truth
      .evidenceScope
      .clientConclusion =
      "PASS — no action required.";

    const result =
      validateClientTruth(
        projection,
      );

    assert.equal(
      result.valid,
      false,
    );

    assert.ok(
      result.errors.some(
        (error) =>
          /upgraded into a positive, negative, or no-action conclusion/i.test(
            error.message,
          ),
      ),
    );
  },
);

test(
  "P1-CLIENT-GATE-03: partial evidence requires bounded qualification",
  () => {
    const projection =
      JSON.parse(
        JSON.stringify(
          validProjection(),
        ),
      );

    projection
      .truth
      .performanceReadiness
      .state =
      "partial";

    projection
      .truth
      .performanceReadiness
      .qualifier =
      null;

    const result =
      validateClientTruth(
        projection,
      );

    assert.equal(
      result.valid,
      false,
    );

    assert.ok(
      result.errors.some(
        (error) =>
          /requires explicit bounded-scope qualification/i.test(
            error.message,
          ),
      ),
    );
  },
);

test(
  "P1-CLIENT-GATE-04: partial evidence cannot become site-wide certainty",
  () => {
    const projection =
      JSON.parse(
        JSON.stringify(
          validProjection(),
        ),
      );

    projection
      .truth
      .indexability
      .state =
      "partial";

    projection
      .truth
      .indexability
      .qualifier =
      "Two pages were assessed.";

    projection
      .truth
      .indexability
      .clientConclusion =
      "The entire site is indexable.";

    const result =
      validateClientTruth(
        projection,
      );

    assert.equal(
      result.valid,
      false,
    );

    assert.ok(
      result.errors.some(
        (error) =>
          /site-wide certainty/i.test(
            error.message,
          ),
      ),
    );
  },
);

test(
  "P1-CLIENT-GATE-05: prohibited client upgrade is rejected",
  () => {
    const projection =
      JSON.parse(
        JSON.stringify(
          validProjection(),
        ),
      );

    projection
      .truth
      .trustProof
      .clientConclusion =
      "Trust proof is underused.";

    const result =
      validateClientTruth(
        projection,
      );

    assert.equal(
      result.valid,
      false,
    );

    assert.ok(
      result.errors.some(
        (error) =>
          /prohibited upgrade/i.test(
            error.message,
          ),
      ),
    );
  },
);

test(
  "P1-CLIENT-GATE-06: unresolved recommendation placeholders cannot reach consumers",
  () => {
    const projection =
      JSON.parse(
        JSON.stringify(
          validProjection(),
        ),
      );

    projection
      .actions[0]
      .recommendation =
      "Create the undefined service page.";

    const result =
      validateClientTruth(
        projection,
      );

    assert.equal(
      result.valid,
      false,
    );

    assert.ok(
      result.errors.some(
        (error) =>
          error.path ===
            "crossReportInterpretation.actions[0].recommendation" &&
          /unresolved placeholder/i.test(
            error.message,
          ),
      ),
    );
  },
);

test(
  "P1-CLIENT-GATE-07: action hierarchy must have one contiguous owned ranking",
  () => {
    const projection =
      JSON.parse(
        JSON.stringify(
          validProjection(),
        ),
      );

    projection.actions.push({
      ...projection.actions[0],

      findingId:
        "F-2",

      ruleId:
        "VAN-TRUST-001",

      rank: 3,
    });

    const result =
      validateClientTruth(
        projection,
      );

    assert.equal(
      result.valid,
      false,
    );

    assert.ok(
      result.errors.some(
        (error) =>
          /contiguous 1\.\.N hierarchy/i.test(
            error.message,
          ),
      ),
    );
  },
);
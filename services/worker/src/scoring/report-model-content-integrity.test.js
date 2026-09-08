import test from "node:test";
import assert from "node:assert/strict";

import {
  contentIdeas,
} from "./report-model.js";

import {
  compileAllSchemas,
  loadAllSchemas,
} from "../contracts/validator.js";

function site(
  services = [],
) {
  return {
    services,
    topicKeywords: [],
    pages: [],
    _contentEvidenceAvailable:
      true,
  };
}

function allClientText(
  ideas,
) {
  return [
    ...ideas.tofu,
    ...ideas.mofu,
    ...ideas.bofu,
    ...ideas.leading,
  ]
    .map(
      (row) =>
        JSON.stringify(row),
    )
    .join(" ");
}

test(
  "P1-CONTENT-INTEGRITY-01: one real topic never creates Undefined recommendations",
  () => {
    const ideas =
      contentIdeas(
        site([
          "Leadership Coaching",
        ]),
        {},
      );

    const text =
      allClientText(
        ideas,
      );

    assert.doesNotMatch(
      text,
      /\bundefined\b|\bnull\b|\bnan\b/i,
    );

    assert.equal(
      ideas.limitations.length,
      0,
    );

    assert.ok(
      ideas.tofu.length > 0,
    );

    assert.ok(
      ideas.mofu.length > 0,
    );

    assert.ok(
      ideas.bofu.length > 0,
    );
  },
);

test(
  "P1-CONTENT-INTEGRITY-02: invalid semantic recommendation is omitted and limitation is recorded",
  () => {
    const ideas =
      contentIdeas(
        site([
          "undefined",
        ]),
        {},
      );

    const text =
      allClientText(
        ideas,
      );

    assert.doesNotMatch(
      text,
      /\bundefined\b/i,
    );

    assert.ok(
      ideas.limitations.length >
        0,
    );

    assert.ok(
      ideas.limitations.some(
        (value) =>
          /omitted/i.test(
            value,
          ),
      ),
    );
  },
);

test(
  "P1-CONTENT-INTEGRITY-03: additive limitations field validates against current ScoreSet schema",
  () => {
    const ideas =
      contentIdeas(
        site([
          "Leadership Coaching",
        ]),
        {},
      );

    const {
      ajv,
    } =
      compileAllSchemas(
        loadAllSchemas(),
      );

    const validate =
      ajv.getSchema(
        "https://vantage-platform.io/prysm/contracts/v2/score-current.schema.json",
      );

    assert.ok(validate);

    const scoreSet = {
      contractVersion:
        "2.0.0",

      scoringVersion:
        "4.1.1",

      generatedAt:
        "2026-09-06T20:00:00.000Z",

      scores: {},
      bands: {},

      assessedWeight: 0,

      readinessStatus:
        "NOT_ASSESSED",

      showNumericScore:
        false,

      evidenceConfidenceScore:
        0,

      dimensionEligibility:
        {},

      moduleEligibility:
        {},

      suppressedModules:
        [],

      rootCauseRuleId:
        null,

      rootCause:
        "No governed root cause established.",

      findingIds:
        [],

      decisionHierarchy: {
        hierarchyVersion:
          "1.0.0",

        provenance:
          "scoreAudit/action-priority",

        rootCauseRuleId:
          null,

        orderedFindingIds:
          [],

        actions:
          [],
      },

      contentIdeas:
        ideas,
    };

    assert.equal(
      validate(scoreSet),
      true,
      JSON.stringify(
        validate.errors,
      ),
    );
  },
);
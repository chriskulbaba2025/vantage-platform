import test from "node:test";
import assert from "node:assert/strict";

import {
  WRITER_SCORE_FIELDS,
  buildWriterScoreContext,
} from "./writer-scores.js";

test("WRITER-SCORE-01: exact canonical score keys survive unchanged", () => {
  const scores = Object.fromEntries(WRITER_SCORE_FIELDS.map((field, index) => [field, index + 1]));
  const context = buildWriterScoreContext({
    scores,
    bands: {
      conversionReadiness: "Moderate",
      trust: "Limited",
      evidenceConfidence: "High",
    },
    assessedWeight: 82,
    readinessStatus: "Partial assessment",
    readinessStatusDetail: "Some optional evidence was unavailable.",
    showNumericScore: true,
    evidenceConfidenceScore: 91,
    rootCause: "A governed deterministic root cause.",
  });

  assert.deepEqual(context.scores, scores);
  assert.equal(context.scores.trustEeatDimension, scores.trustEeatDimension);
  assert.equal(context.scores.contentFunnelDimension, scores.contentFunnelDimension);
  assert.equal(context.scores.conversionPathwaysDimension, scores.conversionPathwaysDimension);
  assert.equal(context.scores.technicalPerformanceDimension, scores.technicalPerformanceDimension);
  assert.equal(context.scores.entitySchemaAiDimension, scores.entitySchemaAiDimension);
});

test("WRITER-SCORE-02: missing scores remain missing and are never defaulted", () => {
  const context = buildWriterScoreContext({
    scores: {
      conversionReadiness: null,
      trustEeatDimension: null,
    },
  });

  assert.deepEqual(context.scores, {
    conversionReadiness: null,
    trustEeatDimension: null,
  });
  assert.equal(Object.hasOwn(context.scores, "contentFunnelDimension"), false);
  assert.equal(Object.hasOwn(context, "bands"), false);
  assert.equal(Object.hasOwn(context, "evidenceConfidenceScore"), false);
});

test("WRITER-SCORE-03: historical or invented aliases cannot satisfy the canonical score contract", () => {
  const context = buildWriterScoreContext({
    scores: {
      trustEeat: 74,
      eeatScore: 73,
      trustEeatDimension: 72,
      contentFunnelScore: 65,
      contentFunnelDimension: 64,
    },
  });

  assert.deepEqual(context.scores, {
    trustEeatDimension: 72,
    contentFunnelDimension: 64,
  });
  assert.equal(Object.hasOwn(context.scores, "trustEeat"), false);
  assert.equal(Object.hasOwn(context.scores, "eeatScore"), false);
  assert.equal(Object.hasOwn(context.scores, "contentFunnelScore"), false);
});

test("WRITER-SCORE-04: explicit zero and false values are preserved when actually present", () => {
  const context = buildWriterScoreContext({
    scores: {
      trust: 0,
      conversionReadiness: 0,
    },
    assessedWeight: 0,
    showNumericScore: false,
    evidenceConfidenceScore: 0,
  });

  assert.equal(context.scores.trust, 0);
  assert.equal(context.scores.conversionReadiness, 0);
  assert.equal(context.assessedWeight, 0);
  assert.equal(context.showNumericScore, false);
  assert.equal(context.evidenceConfidenceScore, 0);
});

test("WRITER-SCORE-05: malformed ScoreSet fails closed", () => {
  assert.throws(() => buildWriterScoreContext(null), /scoreSet is required/);
  assert.throws(() => buildWriterScoreContext({}), /scoreSet.scores is required/);
  assert.throws(() => buildWriterScoreContext({ scores: [] }), /scoreSet.scores is required/);
});

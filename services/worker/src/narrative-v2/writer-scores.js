/**
 * PRYSM Narrative v2 — exact ScoreSet projection for the Writer/Judge packet.
 *
 * No score aliases are accepted. No missing score is defaulted. The output
 * uses the exact canonical keys from score.schema.json so a deterministic
 * score cannot silently disappear or be renamed in the narrative layer.
 */

export const WRITER_SCORE_FIELDS = Object.freeze([
  "trust",
  "contentDepth",
  "conversionPathways",
  "technical",
  "performance",
  "conversionReadiness",
  "awareness",
  "consideration",
  "decision",
  "aiReadiness",
  "conversionPathwaysDimension",
  "trustEeatDimension",
  "contentFunnelDimension",
  "technicalPerformanceDimension",
  "entitySchemaAiDimension",
]);

export const WRITER_BAND_FIELDS = Object.freeze([
  "conversionReadiness",
  "trust",
  "evidenceConfidence",
]);

function copyOwnFields(source, fields) {
  const out = {};
  for (const field of fields) {
    if (!Object.hasOwn(source, field)) continue;
    if (source[field] === undefined) continue;
    out[field] = source[field];
  }
  return Object.freeze(out);
}

export function buildWriterScoreContext(scoreSet) {
  if (!scoreSet || typeof scoreSet !== "object" || Array.isArray(scoreSet)) {
    throw new Error("scoreSet is required");
  }
  if (!scoreSet.scores || typeof scoreSet.scores !== "object" || Array.isArray(scoreSet.scores)) {
    throw new Error("scoreSet.scores is required");
  }

  const context = {
    scores: copyOwnFields(scoreSet.scores, WRITER_SCORE_FIELDS),
  };

  if (scoreSet.bands && typeof scoreSet.bands === "object" && !Array.isArray(scoreSet.bands)) {
    context.bands = copyOwnFields(scoreSet.bands, WRITER_BAND_FIELDS);
  }

  for (const field of [
    "assessedWeight",
    "readinessStatus",
    "readinessStatusDetail",
    "showNumericScore",
    "evidenceConfidenceScore",
    "rootCause",
  ]) {
    if (!Object.hasOwn(scoreSet, field) || scoreSet[field] === undefined) continue;
    context[field] = scoreSet[field];
  }

  return Object.freeze(context);
}

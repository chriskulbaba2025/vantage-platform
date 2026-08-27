/**
 * PRYSM Interpretation Integrity — bounded business-impact policy.
 *
 * OBSERVED:
 *   The stated condition/outcome is directly represented by governed evidence.
 *
 * INFERRED:
 *   The business consequence is an interpretation of observed evidence.
 *   It must remain bounded and must not claim an unmeasured commercial result.
 */

export const BUSINESS_IMPACT_POLICY_VERSION = "1.0.0";

export const BUSINESS_IMPACT_BASIS = Object.freeze({
  OBSERVED: "OBSERVED",
  INFERRED: "INFERRED",
});

const BOUNDED_MARKER =
  /\b(may|might|can|could|potential|potentially|risk|opportunity)\b/i;

const UNSUPPORTED_CAUSAL_PATTERNS = Object.freeze([
  /\bwill\b/i,
  /\bcannot\b/i,
  /\bcauses\b/i,
  /\bcaused\b/i,
  /\bresults? in\b/i,
  /\bresulted in\b/i,
  /\bleads? to\b/i,
  /\bled to\b/i,
]);

const UNMEASURED_COMMERCIAL_OUTCOMES = Object.freeze([
  /\blost revenue\b/i,
  /\brevenue loss\b/i,
  /\blost sales\b/i,
  /\bsales loss\b/i,
  /\blost leads?\b/i,
  /\blost conversions?\b/i,
  /\breduc(?:e|ed|es|ing)\s+conversion(?:s|\s+rates?)?\b/i,
  /\blower conversion rates?\b/i,
  /\bconversion rate decline\b/i,
  /\bblocks?\s+conversion(?:s|\s+capability)?\b/i,
  /\bimpacts?\s+conversion(?:s|\s+capability|\s+rates?)\b/i,
  /\breduc(?:e|ed|es|ing)\s+engagement\b/i,
  /\blost rankings?\b/i,
  /\branking loss\b/i,
  /\blost traffic\b/i,
  /\btraffic loss\b/i,
  /\bmobile abandonment\b/i,
  /\bbounce rates?\b/i,
]);

export function governBusinessImpact(
  value,
  {
    label = "businessImpact",
    basis = BUSINESS_IMPACT_BASIS.INFERRED,
  } = {},
) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  if (!Object.values(BUSINESS_IMPACT_BASIS).includes(basis)) {
    throw new Error(`${label} has invalid evidence basis: ${basis}`);
  }

  const impact = value.trim();

  for (const pattern of UNSUPPORTED_CAUSAL_PATTERNS) {
    if (pattern.test(impact)) {
      throw new Error(
        `${label} states unsupported causal certainty`,
      );
    }
  }

  if (basis === BUSINESS_IMPACT_BASIS.INFERRED) {
    if (!BOUNDED_MARKER.test(impact)) {
      throw new Error(
        `${label} must be framed as a bounded risk, implication, or opportunity`,
      );
    }

    for (const pattern of UNMEASURED_COMMERCIAL_OUTCOMES) {
      if (pattern.test(impact)) {
        throw new Error(
          `${label} claims an unmeasured commercial outcome`,
        );
      }
    }
  }

  return impact;
}

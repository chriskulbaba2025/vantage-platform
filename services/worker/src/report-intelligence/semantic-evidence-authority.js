/**
 * Canonical semantic evidence authority.
 *
 * This is the post-classification boundary. It consumes already-classified
 * DecisionEvidence flags and page signals; it never rescans raw page text.
 */

export const SEMANTIC_EVIDENCE_AUTHORITY_VERSION = "1.0.0";

export const SEMANTIC_FACT_STATE = Object.freeze({
  OBSERVED: "OBSERVED",
  NOT_ESTABLISHED: "NOT_ESTABLISHED",
  PARTIAL: "PARTIAL",
  UNAVAILABLE: "UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
  NOT_CONNECTED: "NOT_CONNECTED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

const SOURCE_STATES = new Set([
  "AVAILABLE", "PARTIAL", "UNKNOWN", "UNAVAILABLE", "FAILED",
  "NOT_CONNECTED", "NOT_APPLICABLE",
]);

const FACTS = Object.freeze({
  FORMAL_CREDENTIAL: { trustKey: "formalCredential", legacyTrustKey: "credentials", pageSignal: "credentials" },
  OPERATING_EXPERIENCE: { trustKey: "operatingExperience", legacyTrustKey: "experience", pageSignal: "operatingExperience" },
  NAMED_EXPERTISE: { trustKey: "namedExpertise", legacyTrustKey: "expertise", pageSignal: "namedExpertise" },
  TESTIMONIAL_OR_REVIEW: { trustKey: "testimonial", legacyTrustKey: "testimonials", pageSignal: "testimonials" },
  COMPLETED_WORK: { trustKey: "completedWork", pageSignal: "completedWork" },
  CUSTOMER_OUTCOME: { trustKey: "customerOutcome", legacyTrustKey: "outcomes", pageSignal: "customerOutcome" },
  DETAILED_CASE_STUDY: { trustKey: "detailedCaseStudy", legacyTrustKey: "caseStudies", pageSignal: "caseStudies" },
  PROOF_PLACEMENT: { trustKey: "proofPlacement", pageSignal: "proofPlacement" },
});

function sourceStatus(site) {
  const value = String(site?.sourceStatus || (site?._contentEvidenceAvailable === true ? "AVAILABLE" : site?._contentEvidenceAvailable === false ? "UNAVAILABLE" : "UNKNOWN")).toUpperCase();
  return SOURCE_STATES.has(value) ? value : "UNKNOWN";
}

function factValue(site, definition) {
  const trust = site?.trust || {};
  if (trust[definition.trustKey] === true || (definition.legacyTrustKey && trust[definition.legacyTrustKey] === true)) return true;
  return site?.[definition.trustKey] === true;
}

function provenance(site, definition) {
  const pages = Array.isArray(site?.pages) ? site.pages : [];
  const urls = pages
    .filter((page) => page?.signals?.[definition.pageSignal] === true || page?.semanticFacts?.[definition.trustKey] === true)
    .map((page) => page?.crawledUrl || page?.url)
    .filter((value) => typeof value === "string" && value.trim());
  return {
    source: "DecisionEvidence.site",
    field: definition.legacyTrustKey ? `site.trust.${definition.legacyTrustKey}` : `site.trust.${definition.trustKey}`,
    urls: [...new Set(urls)],
  };
}

function stateFor(value, status) {
  if (status === "UNAVAILABLE" || status === "FAILED") return SEMANTIC_FACT_STATE.UNAVAILABLE;
  if (status === "NOT_CONNECTED") return SEMANTIC_FACT_STATE.NOT_CONNECTED;
  if (status === "NOT_APPLICABLE") return SEMANTIC_FACT_STATE.NOT_APPLICABLE;
  if (status === "UNKNOWN") return SEMANTIC_FACT_STATE.UNKNOWN;
  if (value === true) return SEMANTIC_FACT_STATE.OBSERVED;
  if (status === "PARTIAL") return SEMANTIC_FACT_STATE.PARTIAL;
  return SEMANTIC_FACT_STATE.NOT_ESTABLISHED;
}

export function buildSemanticEvidenceAuthority(decisionEvidence = {}) {
  const site = decisionEvidence?.site && typeof decisionEvidence.site === "object" ? decisionEvidence.site : {};
  const status = sourceStatus(site);
  const facts = Object.fromEntries(Object.entries(FACTS).map(([key, definition]) => {
    const state = stateFor(factValue(site, definition), status);
    return [key, {
      state,
      observed: state === SEMANTIC_FACT_STATE.OBSERVED,
      sourceStatus: status,
      provenance: provenance(site, definition),
    }];
  }));
  return {
    version: SEMANTIC_EVIDENCE_AUTHORITY_VERSION,
    authority: "POST_CLASSIFICATION_DECISION_EVIDENCE",
    sourceStatus: status,
    facts,
  };
}

export function semanticFact(authority, key) {
  return authority?.facts?.[key] || {
    state: SEMANTIC_FACT_STATE.UNKNOWN,
    observed: false,
    sourceStatus: "UNKNOWN",
    provenance: { source: "missing-semantic-authority", field: key, urls: [] },
  };
}

export function isObserved(authority, key) {
  return semanticFact(authority, key).state === SEMANTIC_FACT_STATE.OBSERVED;
}

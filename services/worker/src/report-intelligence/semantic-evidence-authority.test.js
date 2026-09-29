import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSemanticEvidenceAuthority,
  SEMANTIC_FACT_STATE,
  semanticFact,
} from "./semantic-evidence-authority.js";
import { buildSemanticLedger } from "./semantic-ledger.js";
import { buildSnapshotV1Projection } from "../report/snapshot-v1.js";

function evidence(site = {}) {
  return {
    site: {
      sourceStatus: "AVAILABLE",
      pages: [{ crawledUrl: "https://example.test/about", signals: { credentials: true, testimonials: true } }],
      trust: {},
      ...site,
    },
  };
}

test("canonical authority keeps narrow proof concepts distinct", () => {
  const authority = buildSemanticEvidenceAuthority(evidence({ trust: { operatingExperience: true, formalCredential: false, completedWork: true, detailedCaseStudy: false } }));
  assert.equal(semanticFact(authority, "OPERATING_EXPERIENCE").state, SEMANTIC_FACT_STATE.OBSERVED);
  assert.equal(semanticFact(authority, "FORMAL_CREDENTIAL").state, SEMANTIC_FACT_STATE.NOT_ESTABLISHED);
  assert.equal(semanticFact(authority, "COMPLETED_WORK").state, SEMANTIC_FACT_STATE.OBSERVED);
  assert.equal(semanticFact(authority, "DETAILED_CASE_STUDY").state, SEMANTIC_FACT_STATE.NOT_ESTABLISHED);
});

test("partial and unavailable evidence cannot become absence", () => {
  const partial = buildSemanticEvidenceAuthority(evidence({ sourceStatus: "PARTIAL", trust: {} }));
  const unavailable = buildSemanticEvidenceAuthority(evidence({ sourceStatus: "UNAVAILABLE", trust: { testimonials: true } }));
  assert.equal(semanticFact(partial, "FORMAL_CREDENTIAL").state, SEMANTIC_FACT_STATE.PARTIAL);
  assert.equal(semanticFact(unavailable, "TESTIMONIAL_OR_REVIEW").state, SEMANTIC_FACT_STATE.UNAVAILABLE);
});

test("raw text alone cannot establish a semantic fact", () => {
  const authority = buildSemanticEvidenceAuthority(evidence({ pages: [{ bodyText: "credentials portfolio completed work" }] }));
  assert.equal(semanticFact(authority, "FORMAL_CREDENTIAL").state, SEMANTIC_FACT_STATE.NOT_ESTABLISHED);
  assert.equal(semanticFact(authority, "COMPLETED_WORK").state, SEMANTIC_FACT_STATE.NOT_ESTABLISHED);
});

test("provenance survives authority construction", () => {
  const authority = buildSemanticEvidenceAuthority(evidence({ trust: { credentials: true } }));
  assert.deepEqual(semanticFact(authority, "FORMAL_CREDENTIAL").provenance.urls, ["https://example.test/about"]);
  assert.equal(semanticFact(authority, "FORMAL_CREDENTIAL").provenance.field, "site.trust.credentials");
});

test("cross-consumer projections preserve one canonical fact package", () => {
  const classified = evidence({
    trust: { operatingExperience: true, formalCredential: false, completedWork: true, detailedCaseStudy: false },
  });
  const authority = buildSemanticEvidenceAuthority(classified);
  const ledger = buildSemanticLedger({ decisionEvidence: classified, semanticEvidence: authority });
  const snapshot = buildSnapshotV1Projection({
    auditRequest: { businessName: "Example" },
    canonicalEvidence: classified,
    reportContentPackage: { semanticEvidence: authority },
  });

  assert.deepEqual(ledger.semanticEvidence, authority);
  assert.deepEqual(snapshot.semanticEvidence, authority);
  assert.equal(semanticFact(ledger.semanticEvidence, "OPERATING_EXPERIENCE").state, SEMANTIC_FACT_STATE.OBSERVED);
  assert.equal(semanticFact(snapshot.semanticEvidence, "FORMAL_CREDENTIAL").state, SEMANTIC_FACT_STATE.NOT_ESTABLISHED);
  assert.equal(semanticFact(snapshot.semanticEvidence, "COMPLETED_WORK").state, SEMANTIC_FACT_STATE.OBSERVED);
  assert.equal(semanticFact(snapshot.semanticEvidence, "DETAILED_CASE_STUDY").state, SEMANTIC_FACT_STATE.NOT_ESTABLISHED);
});

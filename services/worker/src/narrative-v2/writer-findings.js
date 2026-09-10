/**
 * PRYSM Narrative v2 — exact deterministic Finding projection.
 *
 * Finding v1 still exposes renderer-compatibility aliases (`problem`, `impact`,
 * `fix`, `effort`). Narrative v2 deliberately does not consume them. A
 * validated deterministic finding must present the canonical contract fields
 * or the Writer boundary fails closed.
 */

export const WRITER_FINDING_REQUIRED_FIELDS = Object.freeze([
  "findingId",
  "ruleId",
  "ruleVersion",
  "dimension",
  "module",
  "title",
  "affectedUrls",
  "evidence",
  "confidence",
  "businessImpact",
  "recommendation",
  "implementationEffort",
  "verificationMethod",
  "scoreBearing",
  "severity",
  "finalPriority",
]);

const IMPACT_BASES = new Set(["OBSERVED", "INFERRED"]);
const OUTCOME_STATUSES = new Set([
  "AVAILABLE",
  "PARTIAL",
  "UNKNOWN",
  "UNAVAILABLE",
  "NOT ASSESSED",
  "NOT_ASSESSED",
]);

const COMMERCIAL_OUTCOME_PATTERN =
  /\b(?:revenue|sales|leads?|enquiries|inquiries|conversions?|traffic|rankings?|engagement|abandonment|bounce rate|customers?|pipeline)\b/i;

const CERTAIN_OUTCOME_PATTERN =
  /\b(?:will|cause|causes|caused|causing|drive|drives|drove|driven|driving|result(?:s|ed|ing)?\s+in|lead(?:s|ing)?\s+to|led\s+to|increase|increases|increased|increasing|decrease|decreases|decreased|decreasing|reduce|reduces|reduced|reducing|improve|improves|improved|improving|hurt|hurts|hurting|damage|damages|damaged|damaging|lose|loses|lost|losing|cost|costs|costing|confirm|confirms|confirmed|establish|establishes|established|prove|proves|proved|proven|demonstrate|demonstrates|demonstrated|show|shows|showed|shown)\b/i;

const WRITER_IMPACT_DERIVATION = "bounded-business-impact-v1";

function assertImpactAuthority(finding) {
  const basis = finding.businessImpactBasis ?? "INFERRED";
  if (!IMPACT_BASES.has(basis)) {
    throw new Error("businessImpactBasis must be OBSERVED or INFERRED");
  }

  const outcomeStatus =
    finding.businessImpactOutcomeStatus ??
    (basis === "OBSERVED" ? "AVAILABLE" : "UNAVAILABLE");
  if (!OUTCOME_STATUSES.has(outcomeStatus)) {
    throw new Error(`businessImpactOutcomeStatus must be governed: ${outcomeStatus}`);
  }

  const outcomeEvidenceRefs = finding.businessImpactOutcomeEvidenceRefs;
  if (basis === "OBSERVED") {
    if (outcomeStatus !== "AVAILABLE") {
      throw new Error("OBSERVED business impact requires AVAILABLE outcome status");
    }
    if (!Array.isArray(outcomeEvidenceRefs) || outcomeEvidenceRefs.length === 0) {
      throw new Error("OBSERVED business impact requires exact available outcome evidenceRefs");
    }
  }

  return { basis, outcomeStatus, outcomeEvidenceRefs };
}

function projectBusinessImpact(finding) {
  const { basis, outcomeStatus, outcomeEvidenceRefs } = assertImpactAuthority(finding);
  const sourceText = finding.businessImpact;
  const isUnboundedCommercialContext =
    basis === "INFERRED" &&
    COMMERCIAL_OUTCOME_PATTERN.test(sourceText) &&
    CERTAIN_OUTCOME_PATTERN.test(sourceText);
  const writerText = isUnboundedCommercialContext
    ? `${finding.title} may affect visitor experience or evaluation in the assessed scope; the downstream commercial outcome was not measured.`
    : sourceText;

  return {
    writerText,
    basis,
    outcomeStatus,
    evidenceRefs:
      basis === "OBSERVED"
        ? [...outcomeEvidenceRefs]
        : [`finding:${finding.findingId}`],
    sourceFindingId: finding.findingId,
    derivation: WRITER_IMPACT_DERIVATION,
  };
}

const OPTIONAL_FINDING_FIELDS = Object.freeze([
  "rawPriority",
  "findingKey",
]);

const EVIDENCE_FIELDS = Object.freeze([
  "field",
  "observedValue",
  "expectedValue",
  "source",
  "provider",
  "sourceStatus",
  "artifactRef",
]);

function cloneArray(value) {
  return value.map((item) => item);
}

function projectEvidence(record, findingId, index) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Finding ${findingId} evidence[${index}] must be an object`);
  }
  if (!Object.hasOwn(record, "field") || typeof record.field !== "string" || record.field.length === 0) {
    throw new Error(`Finding ${findingId} evidence[${index}].field is required`);
  }
  if (!Object.hasOwn(record, "observedValue")) {
    throw new Error(`Finding ${findingId} evidence[${index}].observedValue is required`);
  }

  const out = {};
  for (const field of EVIDENCE_FIELDS) {
    if (!Object.hasOwn(record, field) || record[field] === undefined) continue;
    out[field] = record[field];
  }
  return Object.freeze(out);
}

function projectFinding(finding, index) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    throw new Error(`Finding at index ${index} must be an object`);
  }

  for (const field of WRITER_FINDING_REQUIRED_FIELDS) {
    if (!Object.hasOwn(finding, field) || finding[field] === undefined) {
      throw new Error(`Finding at index ${index} missing canonical field: ${field}`);
    }
  }

  if (!Array.isArray(finding.affectedUrls)) {
    throw new Error(`Finding ${finding.findingId}.affectedUrls must be an array`);
  }
  if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
    throw new Error(`Finding ${finding.findingId}.evidence must be a non-empty array`);
  }

  const out = {};
  for (const field of WRITER_FINDING_REQUIRED_FIELDS) {
    if (field === "affectedUrls") {
      out.affectedUrls = cloneArray(finding.affectedUrls);
    } else if (field === "evidence") {
      out.evidence = finding.evidence.map((record, evidenceIndex) =>
        projectEvidence(record, finding.findingId, evidenceIndex));
    } else if (field === "businessImpact") {
      out[field] = projectBusinessImpact(finding).writerText;
    } else {
      out[field] = finding[field];
    }
  }

  out.businessImpactContext = Object.freeze(projectBusinessImpact(finding));

  for (const field of OPTIONAL_FINDING_FIELDS) {
    if (Object.hasOwn(finding, field) && finding[field] !== undefined) out[field] = finding[field];
  }

  return Object.freeze(out);
}

export function buildWriterFindings(findings) {
  if (!Array.isArray(findings)) throw new Error("findings must be an array");
  return Object.freeze(findings.map(projectFinding));
}

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
    } else {
      out[field] = finding[field];
    }
  }

  for (const field of OPTIONAL_FINDING_FIELDS) {
    if (Object.hasOwn(finding, field) && finding[field] !== undefined) out[field] = finding[field];
  }

  return Object.freeze(out);
}

export function buildWriterFindings(findings) {
  if (!Array.isArray(findings)) throw new Error("findings must be an array");
  return Object.freeze(findings.map(projectFinding));
}

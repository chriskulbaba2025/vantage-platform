/**
 * PRYSM Narrative v2 — bounded deterministic Writer input packet.
 *
 * This is the only evidence packet the future Writer v2 may consume.
 * It is assembled from persisted AuditRequest + deterministic ScoreSet +
 * deterministic FindingSet + CapabilityEvidence. Raw provider payloads,
 * renderer aliases, reconstructed defaults, HTML and debug data are excluded.
 */

import { buildWriterBusinessContext } from "./writer-business-context.js";
import { buildWriterScoreContext } from "./writer-scores.js";
import { buildWriterFindings } from "./writer-findings.js";

export const WRITER_INPUT_VERSION = "1.0.0";

const CAPABILITY_REQUIRED_FIELDS = Object.freeze([
  "capability",
  "status",
  "coverage",
  "provenance",
  "limitations",
  "requiredFieldsPresent",
]);

const REQUIRED_SCORESET_FIELDS = Object.freeze([
  "scoringVersion",
  "scores",
  "bands",
  "assessedWeight",
  "readinessStatus",
  "showNumericScore",
  "evidenceConfidenceScore",
  "dimensionEligibility",
  "moduleEligibility",
  "suppressedModules",
  "rootCause",
  "findingIds",
]);

const REQUIRED_CORE_SCORE_FIELDS = Object.freeze([
  "trust",
  "contentDepth",
  "conversionPathways",
  "technical",
  "performance",
  "conversionReadiness",
]);

const SCORE_GOVERNANCE_FIELDS = Object.freeze([
  "scoringVersion",
  "dimensionEligibility",
  "moduleEligibility",
  "suppressedModules",
  "evidenceConfidenceFactors",
  "sourceDependencies",
]);

const DETERMINISTIC_ANALYSIS_FIELDS = Object.freeze([
  "conversionPaths",
  "readinessMap",
  "contentIdeas",
  "competitors",
  "renderingDiagnostics",
  "siteFootprint",
]);

function cloneDefined(value) {
  if (Array.isArray(value)) {
    return value.map(cloneDefined);
  }

  if (
    !value ||
    typeof value !== "object"
  ) {
    return value;
  }

  const out = {};

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    if (child === undefined) {
      continue;
    }

    out[key] =
      cloneDefined(child);
  }

  return out;
}

function copyOwn(source, fields) {
  const out = {};

  for (const field of fields) {
    if (
      !Object.hasOwn(
        source,
        field,
      ) ||
      source[field] ===
        undefined
    ) {
      continue;
    }

    out[field] =
      cloneDefined(
        source[field],
      );
  }

  return out;
}

function assertCanonicalScoreSet(
  scoreSet,
) {
  if (
    !scoreSet ||
    typeof scoreSet !==
      "object" ||
    Array.isArray(scoreSet)
  ) {
    throw new Error(
      "scoreSet is required",
    );
  }

  for (
    const field
    of REQUIRED_SCORESET_FIELDS
  ) {
    if (
      !Object.hasOwn(
        scoreSet,
        field,
      ) ||
      scoreSet[field] ===
        undefined
    ) {
      throw new Error(
        `scoreSet missing canonical field: ${field}`,
      );
    }
  }

  if (
    !scoreSet.scores ||
    typeof scoreSet.scores !==
      "object" ||
    Array.isArray(
      scoreSet.scores,
    )
  ) {
    throw new Error(
      "scoreSet.scores is required",
    );
  }

  for (
    const field
    of REQUIRED_CORE_SCORE_FIELDS
  ) {
    if (
      !Object.hasOwn(
        scoreSet.scores,
        field,
      ) ||
      scoreSet.scores[field] ===
        undefined
    ) {
      throw new Error(
        `scoreSet.scores missing canonical field: ${field}`,
      );
    }
  }
}

function projectCapabilities(
  capabilityEvidence,
  auditId,
) {
  if (
    !capabilityEvidence ||
    typeof capabilityEvidence !==
      "object" ||
    Array.isArray(
      capabilityEvidence,
    )
  ) {
    throw new Error(
      "capabilityEvidence is required",
    );
  }

  if (
    !Object.hasOwn(
      capabilityEvidence,
      "auditId",
    ) ||
    typeof capabilityEvidence
      .auditId !== "string" ||
    capabilityEvidence.auditId
      .length === 0
  ) {
    throw new Error(
      "capabilityEvidence.auditId is required",
    );
  }

  if (
    capabilityEvidence.auditId !==
    auditId
  ) {
    throw new Error(
      `capabilityEvidence.auditId mismatch: ${capabilityEvidence.auditId} vs ${auditId}`,
    );
  }

  if (
    !Object.hasOwn(
      capabilityEvidence,
      "capabilityEvidenceVersion",
    ) ||
    typeof capabilityEvidence
      .capabilityEvidenceVersion !==
      "string"
  ) {
    throw new Error(
      "capabilityEvidence.capabilityEvidenceVersion is required",
    );
  }

  if (
    !capabilityEvidence
      .capabilities ||
    typeof capabilityEvidence
      .capabilities !==
      "object" ||
    Array.isArray(
      capabilityEvidence
        .capabilities,
    )
  ) {
    throw new Error(
      "capabilityEvidence.capabilities is required",
    );
  }

  const capabilities = {};

  for (
    const [key, record]
    of Object.entries(
      capabilityEvidence
        .capabilities,
    )
  ) {
    if (
      !record ||
      typeof record !==
        "object" ||
      Array.isArray(record)
    ) {
      throw new Error(
        `Capability ${key} must be an object`,
      );
    }

    for (
      const field
      of CAPABILITY_REQUIRED_FIELDS
    ) {
      if (
        !Object.hasOwn(
          record,
          field,
        ) ||
        record[field] ===
          undefined
      ) {
        throw new Error(
          `Capability ${key} missing canonical field: ${field}`,
        );
      }
    }

    if (
      record.capability !== key
    ) {
      throw new Error(
        `Capability key mismatch: ${key} vs ${record.capability}`,
      );
    }

    const projected =
      copyOwn(
        record,
        [
          ...CAPABILITY_REQUIRED_FIELDS,
          "kind",
          "validated",
          "validatedBy",
          "validationSummary",
        ],
      );

    capabilities[key] =
      Object.freeze(
        projected,
      );
  }

  const result = {
    capabilities:
      Object.freeze(
        capabilities,
      ),
  };

  for (
    const field
    of [
      "capabilityEvidenceVersion",
      "generatedAt",
      "summary",
    ]
  ) {
    if (
      !Object.hasOwn(
        capabilityEvidence,
        field,
      ) ||
      capabilityEvidence[
        field
      ] === undefined
    ) {
      continue;
    }

    result[field] =
      cloneDefined(
        capabilityEvidence[
          field
        ],
      );
  }

  return Object.freeze(
    result,
  );
}

function assertFindingIntegrity(
  scoreSet,
  findings,
) {
  if (
    !Array.isArray(
      scoreSet.findingIds,
    )
  ) {
    throw new Error(
      "scoreSet.findingIds must be an array",
    );
  }

  const scoreIds =
    scoreSet.findingIds;

  const findingIds =
    findings.map(
      (finding) =>
        finding.findingId,
    );

  if (
    new Set(scoreIds).size !==
    scoreIds.length
  ) {
    throw new Error(
      "scoreSet.findingIds contains duplicates",
    );
  }

  if (
    new Set(findingIds).size !==
    findingIds.length
  ) {
    throw new Error(
      "findings contains duplicate findingId values",
    );
  }

  const scoreSetIds =
    new Set(scoreIds);

  const findingSetIds =
    new Set(findingIds);

  const missing =
    scoreIds.filter(
      (id) =>
        !findingSetIds.has(id),
    );

  const unexpected =
    findingIds.filter(
      (id) =>
        !scoreSetIds.has(id),
    );

  if (
    missing.length ||
    unexpected.length
  ) {
    throw new Error(
      `FindingSet does not match ScoreSet findingIds; missing=[${missing.join(",")}], unexpected=[${unexpected.join(",")}]`,
    );
  }
}

function addReference(
  index,
  id,
  kind,
  path,
) {
  if (
    Object.hasOwn(
      index,
      id,
    )
  ) {
    throw new Error(
      `Duplicate Writer reference id: ${id}`,
    );
  }

  index[id] =
    Object.freeze({
      kind,
      path,
    });
}

function buildReferenceIndex({
  business,
  score,
  findings,
  capabilityContext,
  scoreGovernance,
  deterministicAnalysis,
}) {
  const index = {};

  for (
    const field
    of Object.keys(business)
  ) {
    addReference(
      index,
      `business:${field}`,
      "business",
      `business.${field}`,
    );
  }

  for (
    const field
    of Object.keys(
      score.scores || {},
    )
  ) {
    addReference(
      index,
      `score:${field}`,
      "score",
      `score.scores.${field}`,
    );
  }

  for (
    const field
    of Object.keys(
      score.bands || {},
    )
  ) {
    addReference(
      index,
      `band:${field}`,
      "score-band",
      `score.bands.${field}`,
    );
  }

  for (
    const field
    of [
      "assessedWeight",
      "readinessStatus",
      "readinessStatusDetail",
      "showNumericScore",
      "evidenceConfidenceScore",
      "rootCause",
    ]
  ) {
    if (
      Object.hasOwn(
        score,
        field,
      )
    ) {
      addReference(
        index,
        `score:${field}`,
        "score",
        `score.${field}`,
      );
    }
  }

  for (
    const finding
    of findings
  ) {
    addReference(
      index,
      `finding:${finding.findingId}`,
      "finding",
      `findings.${finding.findingId}`,
    );
  }

  for (
    const key
    of Object.keys(
      capabilityContext
        .capabilities || {},
    )
  ) {
    addReference(
      index,
      `capability:${key}`,
      "capability",
      `capabilityContext.capabilities.${key}`,
    );
  }

  for (
    const field
    of [
      "capabilityEvidenceVersion",
      "summary",
    ]
  ) {
    if (
      Object.hasOwn(
        capabilityContext,
        field,
      )
    ) {
      addReference(
        index,
        `capabilityContext:${field}`,
        "capability-context",
        `capabilityContext.${field}`,
      );
    }
  }

  for (
    const field
    of Object.keys(
      scoreGovernance || {},
    )
  ) {
    if (
      field ===
      "sourceDependencies"
    ) {
      continue;
    }

    addReference(
      index,
      `scoreGovernance:${field}`,
      "score-governance",
      `scoreGovernance.${field}`,
    );
  }

  for (
    const key
    of Object.keys(
      scoreGovernance
        ?.sourceDependencies ||
        {},
    )
  ) {
    addReference(
      index,
      `source:${key}`,
      "source-status",
      `scoreGovernance.sourceDependencies.${key}`,
    );
  }

  for (
    const field
    of Object.keys(
      deterministicAnalysis ||
        {},
    )
  ) {
    addReference(
      index,
      `analysis:${field}`,
      "deterministic-analysis",
      `deterministicAnalysis.${field}`,
    );
  }

  return Object.freeze(
    index,
  );
}

/**
 * Build the fail-closed packet for Writer v2.
 *
 * The function intentionally accepts canonical artifacts, not provider data.
 * No optional value is synthesized when absent.
 */
export function buildWriterInput({
  auditId,
  auditRequest,
  scoreSet,
  findings,
  capabilityEvidence,
}) {
  if (
    typeof auditId !==
      "string" ||
    auditId.length === 0
  ) {
    throw new Error(
      "auditId is required",
    );
  }

  assertCanonicalScoreSet(
    scoreSet,
  );

  const business =
    buildWriterBusinessContext(
      auditRequest,
    );

  const score =
    buildWriterScoreContext(
      scoreSet,
    );

  const projectedFindings =
    buildWriterFindings(
      findings,
    );

  assertFindingIntegrity(
    scoreSet,
    projectedFindings,
  );

  const capabilityContext =
    projectCapabilities(
      capabilityEvidence,
      auditId,
    );

  const scoreGovernance =
    copyOwn(
      scoreSet,
      SCORE_GOVERNANCE_FIELDS,
    );

  // Includes governed representative-site coverage when it exists.
  // Absence remains absence; nothing is reconstructed here.
  const deterministicAnalysis =
    copyOwn(
      scoreSet,
      DETERMINISTIC_ANALYSIS_FIELDS,
    );

  const packet = {
    contractVersion:
      "1.0.0",

    writerInputVersion:
      WRITER_INPUT_VERSION,

    auditId,

    business,
    score,

    findings:
      projectedFindings,

    capabilityContext,
  };

  if (
    Object.keys(
      scoreGovernance,
    ).length > 0
  ) {
    packet.scoreGovernance =
      Object.freeze(
        scoreGovernance,
      );
  }

  if (
    Object.keys(
      deterministicAnalysis,
    ).length > 0
  ) {
    packet.deterministicAnalysis =
      Object.freeze(
        deterministicAnalysis,
      );
  }

  packet.referenceIndex =
    buildReferenceIndex({
      business,
      score,
      findings:
        projectedFindings,
      capabilityContext,
      scoreGovernance:
        packet.scoreGovernance,
      deterministicAnalysis:
        packet.deterministicAnalysis,
    });

  return Object.freeze(
    packet,
  );
}

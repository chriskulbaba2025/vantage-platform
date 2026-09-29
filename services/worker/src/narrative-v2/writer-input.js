/**
 * PRYSM Narrative v2 — bounded deterministic Writer input packet.
 *
 * This is the only evidence packet the future Writer v2 may consume.
 * It is assembled from persisted AuditRequest + deterministic ScoreSet +
 * deterministic FindingSet + CapabilityEvidence. Canonical DecisionEvidence
 * is used only to derive the same governed foundation/action hierarchy as
 * deterministic rendering. Raw provider payloads,
 * renderer aliases, reconstructed defaults, HTML and debug data are excluded.
 */

import { buildWriterBusinessContext } from "./writer-business-context.js";
import { buildWriterScoreContext } from "./writer-scores.js";
import { buildWriterFindings } from "./writer-findings.js";
import { buildSemanticLedger } from "../report-intelligence/semantic-ledger.js";

export const WRITER_INPUT_VERSION = "1.2.0";

// The provider ceiling is deployment-configurable. These packet-level caps
// keep ordinary audits well below that ceiling even before prompt instructions
// and revision context are added. Raw evidence remains in canonical artifacts;
// these are only Writer-facing projections.
export const WRITER_CONTEXT_COMPACTION_VERSION = "1.0.0";
export const WRITER_CONTEXT_TARGET_BYTES = 60_000;
const COMPETITOR_SUMMARY_BYTES = 12_000;
const SITE_FOOTPRINT_SUMMARY_BYTES = 12_000;
const CONTENT_IDEA_SUMMARY_BYTES = 8_000;
const SEMANTIC_LEDGER_SUMMARY_BYTES = 6_000;

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function boundedText(value, max = 500) {
  return typeof value === "string" && value.length > max
    ? `${value.slice(0, max - 1)}…`
    : value;
}

function countStatuses(rows) {
  return rows.reduce((out, row) => {
    const status = row?.status || "UNKNOWN";
    out[status] = (out[status] || 0) + 1;
    return out;
  }, {});
}

function compactCompetitors(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (serializedBytes(value) <= COMPETITOR_SUMMARY_BYTES) return cloneDefined(value);

  const comparisons = Array.isArray(value.comparisons) ? value.comparisons : [];
  const assessed = comparisons.filter((row) => row?.status !== "Insufficient Evidence");
  const selected = assessed.slice(0, 12).map((row) => ({
    name: boundedText(row?.name, 160),
    url: boundedText(row?.url, 300),
    status: row?.status,
    topic: boundedText(row?.topic, 500),
    offerClarity: row?.offerClarity,
    trustProof: row?.trustProof,
    ctaClarity: row?.ctaClarity,
    contentDepth: row?.contentDepth,
    eeat: row?.eeat,
    pathClarity: row?.pathClarity,
  }));

  return {
    summaryVersion: WRITER_CONTEXT_COMPACTION_VERSION,
    sourceStatus: value.sourceStatus,
    comparisonCount: comparisons.length,
    assessedComparisonCount: assessed.length,
    statusCounts: countStatuses(comparisons),
    comparisons: selected,
    omittedComparisonCount: Math.max(0, assessed.length - selected.length),
    omittedEvidenceMeaning: "Omitted competitor rows remain stored in canonical evidence; no omitted row is treated as negative evidence.",
    opportunities: Array.isArray(value.opportunities)
      ? value.opportunities.slice(0, 12).map((row) => cloneDefined(row))
      : value.opportunities,
  };
}

function compactSiteFootprint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (serializedBytes(value) <= SITE_FOOTPRINT_SUMMARY_BYTES) return cloneDefined(value);

  const clusters = Array.isArray(value.clusters) ? value.clusters : [];
  const materialFamilies = Array.isArray(value.prioritySelection?.materialFamilies)
    ? value.prioritySelection.materialFamilies
    : [];
  return {
    summaryVersion: WRITER_CONTEXT_COMPACTION_VERSION,
    status: value.status,
    incomplete: value.incomplete,
    discoveredUrlCount: value.discoveredUrlCount,
    assessedUrlCount: value.assessedUrlCount,
    coverage: cloneDefined(value.coverage),
    limitations: Array.isArray(value.limitations)
      ? value.limitations.map((item) => boundedText(item, 300))
      : value.limitations,
    priorityUrls: Array.isArray(value.priorityUrls)
      ? value.priorityUrls.slice(0, 20)
      : value.priorityUrls,
    clusterSummary: {
      clusterCount: clusters.length,
      materialFamilyCount: materialFamilies.length,
      representativeUrls: clusters
        .flatMap((cluster) => cluster?.representativeUrls || [])
        .slice(0, 30),
      patterns: clusters.slice(0, 30).map((cluster) => ({
        id: cluster?.id,
        pattern: boundedText(cluster?.pattern, 180),
        discoveredUrlCount: cluster?.discoveredUrlCount,
        requiresRepresentativeAssessment: cluster?.requiresRepresentativeAssessment,
        reasonCodes: cloneDefined(cluster?.reasonCodes),
      })),
    },
    prioritySelection: value.prioritySelection
      ? {
          strategyVersion: value.prioritySelection.strategyVersion,
          priorityUrlCap: value.prioritySelection.priorityUrlCap,
          mustHaveUrls: value.prioritySelection.mustHaveUrls?.slice(0, 10),
          representativeUrls: value.prioritySelection.representativeUrls?.slice(0, 20),
          supplementalUrls: value.prioritySelection.supplementalUrls?.slice(0, 20),
          materialFamilyCount: value.prioritySelection.materialFamilyCount,
          representedMaterialFamilyCount: value.prioritySelection.representedMaterialFamilyCount,
          unrepresentedMaterialFamilyCount: value.prioritySelection.unrepresentedMaterialFamilyCount,
        }
      : undefined,
    omittedEvidenceMeaning: "Repeated URL-family detail remains stored in canonical evidence; this summary preserves coverage counts and representative references.",
  };
}

function compactContentIdeas(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (serializedBytes(value) <= CONTENT_IDEA_SUMMARY_BYTES) return cloneDefined(value);
  const out = {};
  for (const [stage, rows] of Object.entries(value)) {
    out[stage] = Array.isArray(rows)
      ? rows.slice(0, 12).map((row) => {
          if (typeof row === "string") return boundedText(row, 400);
          return {
            topic: boundedText(row?.topic || row?.idea || row?.query, 400),
            question: boundedText(row?.question || row?.buyerQuestion, 400),
            action: row?.action,
            rationale: boundedText(row?.rationale || row?.reason, 500),
          };
        })
      : rows;
  }
  out.summaryVersion = WRITER_CONTEXT_COMPACTION_VERSION;
  out.omittedEvidenceMeaning = "Additional deterministic topic rows remain stored and are not treated as assessed negative evidence.";
  return out;
}

function compactSemanticLedger(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (serializedBytes(value) <= SEMANTIC_LEDGER_SUMMARY_BYTES) return value;

  const opportunities = Array.isArray(value.contentOpportunities)
    ? value.contentOpportunities
    : [];
  const selected = opportunities.slice(0, 8).map((row) => ({
    stage: boundedText(row?.stage, 60),
    topic: boundedText(row?.topic, 180),
    action: row?.action,
    reason: boundedText(row?.reason, 240),
    coverage: row?.coverage
      ? {
          state: row.coverage.state,
          matchCount: row.coverage.matchCount,
          urls: Array.isArray(row.coverage.urls)
            ? row.coverage.urls.slice(0, 3)
            : row.coverage.urls,
        }
      : row?.coverage,
  }));

  const normalizedUrls = Array.isArray(value.provenance?.normalizedUrls)
    ? value.provenance.normalizedUrls
    : [];
  const findingIds = Array.isArray(value.provenance?.findingIds)
    ? value.provenance.findingIds
    : [];

  return {
    summaryVersion: WRITER_CONTEXT_COMPACTION_VERSION,
    version: value.version,
    evidenceAuthority: value.evidenceAuthority,
    sourceStatus: cloneDefined(value.sourceStatus),
    dimensions: cloneDefined(value.dimensions),
    concepts: cloneDefined(value.concepts),
    contentOpportunities: selected,
    opportunityCount: opportunities.length,
    omittedOpportunityCount: Math.max(0, opportunities.length - selected.length),
    omittedEvidenceMeaning: "Additional semantic opportunity rows and URL coverage remain stored in canonical evidence; omitted rows are not treated as negative evidence.",
    contradictions: cloneDefined(value.contradictions),
    usefulness: cloneDefined(value.usefulness),
    routing: cloneDefined(value.routing),
    provenance: {
      findingIds,
      normalizedUrls: normalizedUrls.slice(0, 40),
      omittedNormalizedUrlCount: Math.max(0, normalizedUrls.length - 40),
    },
  };
}

function compactDeterministicAnalysis(scoreSet) {
  const analysis = copyOwn(scoreSet, DETERMINISTIC_ANALYSIS_FIELDS);
  if (analysis.competitors) analysis.competitors = compactCompetitors(analysis.competitors);
  if (analysis.siteFootprint) analysis.siteFootprint = compactSiteFootprint(analysis.siteFootprint);
  if (analysis.contentIdeas) analysis.contentIdeas = compactContentIdeas(analysis.contentIdeas);
  return analysis;
}

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
  "decisionHierarchy",
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
  "crossReportInterpretation",
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

function buildWriterConversionInfluence(
  scoreSet,
  findings,
) {
  const hierarchy = scoreSet.decisionHierarchy;

  if (!hierarchy || !Array.isArray(hierarchy.actions) || !Array.isArray(hierarchy.orderedFindingIds)) {
    throw new Error("scoreSet.decisionHierarchy is required for Writer action-plan parity");
  }

  const findingIds = new Set(findings.map((finding) => finding.findingId));
  const actionIds = hierarchy.actions.map((action) => action?.findingId);
  if (
    actionIds.length !== hierarchy.orderedFindingIds.length ||
    actionIds.some((findingId, index) => findingId !== hierarchy.orderedFindingIds[index]) ||
    actionIds.some((findingId) => !findingIds.has(findingId))
  ) {
    throw new Error("scoreSet.decisionHierarchy is inconsistent with Writer FindingSet");
  }

  const byFindingId = {};

  for (
    const action
    of hierarchy.actions
  ) {
    const findingId = action.findingId;

    if (!findingId) {
      throw new Error(
        "Derived Writer action is missing findingId",
      );
    }

    const actionRecord = {
        findingId,

        ruleId: action.ruleId,

        rank:
          action.rank,

        actionClass:
          action.actionClass,

        foundationDomain:
          action.foundationDomain,

        conversionInfluence:
          action.conversionInfluence,

        conversionInfluenceRank:
          action.conversionInfluenceRank,

        group:
          action.group,

        effort:
          action.effort,

        finalPriority: action.priority,
      };

    // WriterInput is persisted as JSON and must have one canonical identity
    // before persistence. JSON.stringify omits undefined object properties;
    // omit them at construction time so in-memory Writer execution and a
    // persisted/reloaded WriterInput are strictly equal.
    byFindingId[findingId] = Object.freeze(
      Object.fromEntries(
        Object.entries(actionRecord).filter(([, value]) => value !== undefined),
      ),
    );
  }

  return Object.freeze({
    hierarchyVersion: hierarchy.hierarchyVersion,
    provenance: hierarchy.provenance,
    rootCauseRuleId: hierarchy.rootCauseRuleId,
    orderedFindingIds: Object.freeze([...hierarchy.orderedFindingIds]),

    byFindingId:
      Object.freeze(
        byFindingId,
      ),
  });
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
  decisionEvidence,
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
  const deterministicAnalysis = compactDeterministicAnalysis(scoreSet);

  deterministicAnalysis.semanticLedger = buildSemanticLedger({
    scoreSet,
    findings,
    decisionEvidence,
    contentIdeas: scoreSet.contentIdeas,
  });
  deterministicAnalysis.semanticLedger = compactSemanticLedger(
    deterministicAnalysis.semanticLedger,
  );

  deterministicAnalysis.conversionInfluence =
    buildWriterConversionInfluence(
      scoreSet,
      projectedFindings,
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

/**
 * Deterministic category accounting used by the live preflight. The packet is
 * already compacted when this is called, so the report measures exactly what
 * can cross the Writer boundary rather than raw stored artifacts.
 */
export function measureWriterInputBudget(writerInput) {
  if (!writerInput || typeof writerInput !== "object") {
    throw new Error("writerInput is required for budget measurement");
  }
  const categories = {};
  for (const [key, value] of Object.entries(writerInput)) {
    if (key === "referenceIndex") continue;
    categories[key] = {
      bytes: serializedBytes(value),
      estimatedTokens: Math.ceil(serializedBytes(value) / 1.5),
    };
  }
  const referenceBytes = serializedBytes(writerInput.referenceIndex || {});
  categories.referenceIndex = {
    bytes: referenceBytes,
    estimatedTokens: Math.ceil(referenceBytes / 1.5),
  };
  const bytes = serializedBytes(writerInput);
  return Object.freeze({
    compactionVersion: WRITER_CONTEXT_COMPACTION_VERSION,
    bytes,
    estimatedTokens: Math.ceil(bytes / 1.5),
    categories: Object.freeze(categories),
    targetBytes: WRITER_CONTEXT_TARGET_BYTES,
    targetEstimatedTokens: Math.ceil(WRITER_CONTEXT_TARGET_BYTES / 1.5),
  });
}

import { clamp } from "../utils.js";
import { SOURCE_STATUS } from "./evidence-contracts.js";
import {
  band,
  confidenceBand,
  scoreTrust,
  scoreContent,
  scoreConversion,
  scoreTechnical,
  scorePerformance,
  buildFindings,
} from "./score-components.js";
import {
  buildConversionPaths,
  topicRows,
  contentIdeas,
  competitorComparison,
} from "./report-model.js";

/**
 * Return true when crawl-dependent modules may be scored.
 *
 * PRD v3.0 §8.6: Only AVAILABLE and PARTIAL crawl evidence may contribute
 * to crawl-dependent scores.  FAILED, BLOCKED, UNAVAILABLE and
 * NOT_CONNECTED must suppress all crawl-dependent modules.
 */
function isCrawlViable(site) {
  return (
    site.sourceStatus === SOURCE_STATUS.AVAILABLE ||
    site.sourceStatus === SOURCE_STATUS.PARTIAL
  );
}

/**
 * Build a minimal model when crawl evidence is not viable.
 *
 * Performance, backlinks, GA4 and competitor modules are independent and
 * continue to operate normally.  Crawl-dependent modules (trust, content,
 * conversion, technical, headings, schema, internal links, conversion
 * paths, topical coverage) return null scores and empty findings.
 */
function buildNotAssessedModel(input, evidence) {
  const perfScore = scorePerformance(evidence.performance);

  // Performance is independent of crawl — it may still have a value.
  const hasPerformance =
    evidence.performance?.sourceStatus === SOURCE_STATUS.AVAILABLE ||
    evidence.performance?.sourceStatus === SOURCE_STATUS.PARTIAL;

  const perfEvidenceScore = hasPerformance ? 25 : 0;

  // Evidence confidence with crawl unavailable
  const coreEvidence = [
    0, // crawl unavailable
    perfEvidenceScore,
    evidence.competitors?.length
      ? evidence.competitors.some(
          (x) => x.status === SOURCE_STATUS.AVAILABLE,
        )
        ? 15
        : 5
      : 10,
    evidence.backlinks?.sourceStatus === SOURCE_STATUS.AVAILABLE ? 5 : 3,
  ];
  const evidenceConfidenceScore = clamp(
    coreEvidence.reduce((a, b) => a + b, 0),
  );

  const crawlStatus = evidence.site.sourceStatus;
  const rootCause =
    crawlStatus === SOURCE_STATUS.NOT_CONNECTED
      ? "The primary crawl provider is not connected. Crawl-dependent modules could not be assessed."
      : crawlStatus === SOURCE_STATUS.BLOCKED
        ? "The target website blocked the crawl. Crawl-dependent modules could not be assessed."
        : "Crawl evidence is unavailable. Crawl-dependent modules could not be assessed.";

  return {
    reportVersion: "0.2.0",
    generatedAt: new Date().toISOString(),
    input,
    scores: {
      trust: null,
      contentDepth: null,
      conversionPathways: null,
      technical: null,
      performance: perfScore,
      conversionReadiness: null,
      awareness: null,
      consideration: null,
      decision: null,
      aiReadiness: null,
    },
    bands: {
      conversionReadiness: "Not Assessed",
      trust: "Not Assessed",
      evidenceConfidence: confidenceBand(evidenceConfidenceScore),
    },
    evidenceConfidenceScore,
    rootCause,
    findings: [],
    conversionPaths: [
      {
        name: "Primary conversion path",
        cta: null,
        host: "none",
        steps: ["Crawl evidence unavailable — conversion path could not be mapped."],
        blockers: ["no crawl evidence"],
        status: "Not Assessed",
      },
    ],
    readinessMap: [],
    contentIdeas: {
      tofu: [],
      mofu: [],
      bofu: [],
      leading: [],
    },
    competitors: competitorComparison(evidence.competitors || []),
    evidence,
    _crawlSuppressed: true,
  };
}

export function scoreAudit(input, evidence) {
  const site = evidence.site;
  const performance = evidence.performance;

  // ── Crawl gate (PRD v3.0 §8.6) ────────────────────────────────────
  if (!isCrawlViable(site)) {
    return buildNotAssessedModel(input, evidence);
  }

  // ── Crawl is viable — score normally ──────────────────────────────
  const scores = {
    trust: scoreTrust(site),
    contentDepth: scoreContent(site),
    conversionPathways: scoreConversion(site),
    technical: scoreTechnical(site),
    performance: scorePerformance(performance),
  };

  // Redistribute conversion-readiness weights when performance is unavailable
  const perfAvailable = scores.performance !== null;
  const w = perfAvailable
    ? {
        trust: 0.28,
        conversion: 0.24,
        content: 0.18,
        technical: 0.18,
        performance: 0.12,
      }
    : { trust: 0.32, conversion: 0.27, content: 0.21, technical: 0.20 };

  scores.conversionReadiness = clamp(
    scores.trust * w.trust +
      scores.conversionPathways * w.conversion +
      scores.contentDepth * w.content +
      scores.technical * w.technical +
      (perfAvailable ? scores.performance * w.performance : 0),
  );

  scores.awareness = clamp(
    scores.contentDepth * 0.55 +
      (site.trust.faq ? 20 : 0) +
      Math.min(25, site.pageCount * 3),
  );
  scores.consideration = clamp(
    scores.trust * 0.6 +
      scores.contentDepth * 0.2 +
      (site.trust.faq ? 10 : 0) +
      (site.trust.pricing ? 10 : 0),
  );
  scores.decision = clamp(
    scores.conversionPathways * 0.65 +
      scores.trust * 0.25 +
      (site.trust.pricing ? 10 : 0),
  );
  scores.aiReadiness = clamp(
    (site.schemaTypes.length ? 25 : 0) +
      (site.pages[0]?.headings?.h1?.length ? 15 : 0) +
      (site.trust.faq ? 20 : 0) +
      Math.min(20, site.pageCount * 3) +
      (site.topicKeywords.length >= 5 ? 20 : 5),
  );

  // Performance evidence is binary
  const hasPerformance =
    performance?.sourceStatus === SOURCE_STATUS.AVAILABLE ||
    performance?.sourceStatus === SOURCE_STATUS.PARTIAL;
  const perfEvidenceScore = hasPerformance ? 25 : 0;

  const coreEvidence = [
    site.pageCount > 0 ? 55 : 0,
    perfEvidenceScore,
    evidence.competitors?.length
      ? evidence.competitors.some(
          (x) => x.status === SOURCE_STATUS.AVAILABLE,
        )
        ? 15
        : 5
      : 10,
    evidence.backlinks?.sourceStatus === SOURCE_STATUS.AVAILABLE ? 5 : 3,
  ];
  const evidenceConfidenceScore = clamp(
    coreEvidence.reduce((a, b) => a + b, 0),
  );

  const findings = buildFindings(site, performance);
  const top = findings.slice(0, 3).map((f) => f.problem.toLowerCase());
  const rootCause = top.length
    ? `The site's main conversion constraint is ${top.join(", ")}. These gaps prevent visitors from moving from initial interest to a confident next step.`
    : "The site has a functional conversion foundation. The main opportunity is to strengthen evidence depth and make each offer easier to evaluate.";

  return {
    reportVersion: "0.2.0",
    generatedAt: new Date().toISOString(),
    input,
    scores,
    bands: {
      conversionReadiness: band(scores.conversionReadiness),
      trust: band(scores.trust),
      evidenceConfidence: confidenceBand(evidenceConfidenceScore),
    },
    evidenceConfidenceScore,
    rootCause,
    findings,
    conversionPaths: buildConversionPaths(site),
    readinessMap: topicRows(site),
    contentIdeas: contentIdeas(site),
    competitors: competitorComparison(evidence.competitors || []),
    evidence,
  };
}

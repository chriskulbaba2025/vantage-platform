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
import { buildConversionPaths, topicRows, contentIdeas, competitorComparison } from "./report-model.js";

export function scoreAudit(input, evidence) {
  const site = evidence.site;
  const performance = evidence.performance;
  const scores = {
    trust: scoreTrust(site),
    contentDepth: scoreContent(site),
    conversionPathways: scoreConversion(site),
    technical: scoreTechnical(site),
    performance: scorePerformance(performance),
  };
  // Redistribute conversion-readiness weights when performance is unavailable
  // so the composite score stays on a 0–100 scale.
  const perfAvailable = scores.performance !== null;
  const w = perfAvailable
    ? { trust: 0.28, conversion: 0.24, content: 0.18, technical: 0.18, performance: 0.12 }
    : { trust: 0.32, conversion: 0.27, content: 0.21, technical: 0.20 };
  scores.conversionReadiness = clamp(
    scores.trust * w.trust +
    scores.conversionPathways * w.conversion +
    scores.contentDepth * w.content +
    scores.technical * w.technical +
    (perfAvailable ? scores.performance * w.performance : 0),
  );
  scores.awareness = clamp(scores.contentDepth * 0.55 + (site.trust.faq ? 20 : 0) + Math.min(25, site.pageCount * 3));
  scores.consideration = clamp(scores.trust * 0.6 + scores.contentDepth * 0.2 + (site.trust.faq ? 10 : 0) + (site.trust.pricing ? 10 : 0));
  scores.decision = clamp(scores.conversionPathways * 0.65 + scores.trust * 0.25 + (site.trust.pricing ? 10 : 0));
  scores.aiReadiness = clamp((site.schemaTypes.length ? 25 : 0) + (site.pages[0]?.headings?.h1?.length ? 15 : 0) + (site.trust.faq ? 20 : 0) + Math.min(20, site.pageCount * 3) + (site.topicKeywords.length >= 5 ? 20 : 5));

  // Performance evidence is binary: either we have measured data from at
  // least one strategy or we have nothing.  AVAILABLE and PARTIAL both
  // indicate usable data was collected.
  const hasPerformance = performance?.sourceStatus === SOURCE_STATUS.AVAILABLE
    || performance?.sourceStatus === SOURCE_STATUS.PARTIAL;
  const perfEvidenceScore = hasPerformance ? 25 : 0;
  const coreEvidence = [
    site.pageCount > 0 ? 55 : 0,
    perfEvidenceScore,
    evidence.competitors?.length ? (evidence.competitors.some((x) => x.status === SOURCE_STATUS.AVAILABLE) ? 15 : 5) : 10,
    evidence.backlinks?.sourceStatus === SOURCE_STATUS.AVAILABLE ? 5 : 3,
  ];
  const evidenceConfidenceScore = clamp(coreEvidence.reduce((a, b) => a + b, 0));
  const findings = buildFindings(site, performance);
  const top = findings.slice(0, 3).map((f) => f.problem.toLowerCase());
  const rootCause = top.length
    ? `The site’s main conversion constraint is ${top.join(", ")}. These gaps prevent visitors from moving from initial interest to a confident next step.`
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

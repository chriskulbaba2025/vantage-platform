import { clamp } from "../utils.js";
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
  scores.conversionReadiness = clamp(scores.trust * 0.28 + scores.conversionPathways * 0.24 + scores.contentDepth * 0.18 + scores.technical * 0.18 + scores.performance * 0.12);
  scores.awareness = clamp(scores.contentDepth * 0.55 + (site.trust.faq ? 20 : 0) + Math.min(25, site.pageCount * 3));
  scores.consideration = clamp(scores.trust * 0.6 + scores.contentDepth * 0.2 + (site.trust.faq ? 10 : 0) + (site.trust.pricing ? 10 : 0));
  scores.decision = clamp(scores.conversionPathways * 0.65 + scores.trust * 0.25 + (site.trust.pricing ? 10 : 0));
  scores.aiReadiness = clamp((site.schemaTypes.length ? 25 : 0) + (site.pages[0]?.headings?.h1?.length ? 15 : 0) + (site.trust.faq ? 20 : 0) + Math.min(20, site.pageCount * 3) + (site.topicKeywords.length >= 5 ? 20 : 5));

  const coreEvidence = [site.pageCount > 0 ? 55 : 0, performance?.status === "complete" ? 25 : 10, evidence.competitors?.length ? (evidence.competitors.some((x) => x.status === "complete") ? 15 : 5) : 10, evidence.backlinks?.status === "complete" ? 5 : 3];
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

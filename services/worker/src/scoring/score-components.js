import { average, clamp, stableHash } from "../utils.js";
import { SOURCE_STATUS } from "./evidence-contracts.js";

// ---------------------------------------------------------------------------
// V3 Scoring version (PRD v3.0 §15.1)
// ---------------------------------------------------------------------------

export const SCORING_VERSION = "3.0.0";

// ---------------------------------------------------------------------------
// Severity / band helpers
// ---------------------------------------------------------------------------

const severityRank = { High: 3, Medium: 2, Low: 1 };

export function band(score) {
  if (score >= 80) return "Strong";
  if (score >= 60) return "Moderate";
  if (score >= 40) return "Limited";
  return "Weak";
}

export function confidenceBand(score) {
  if (score >= 85) return "High";
  if (score >= 65) return "Moderate";
  if (score >= 45) return "Limited";
  return "Directional";
}

// ---------------------------------------------------------------------------
// PRD §15.1 — Readiness dimensions and default weights
// ---------------------------------------------------------------------------

export const DIMENSIONS = Object.freeze({
  conversion_pathways: {
    id: "conversion_pathways",
    label: "Conversion Pathways and Offer Clarity",
    weight: 25, // percent of total readiness
  },
  trust_eeat: {
    id: "trust_eeat",
    label: "Trust, E-E-A-T, and Risk Reduction",
    weight: 25,
  },
  content_funnel: {
    id: "content_funnel",
    label: "Content and Funnel Coverage",
    weight: 20,
  },
  technical_performance: {
    id: "technical_performance",
    label: "Technical and Performance Readiness",
    weight: 20,
  },
  entity_schema_ai: {
    id: "entity_schema_ai",
    label: "Entity, Schema, and AI-Search Readiness",
    weight: 10,
  },
});

// ---------------------------------------------------------------------------
// PRD §15.2 — Module definitions with source dependencies
// ---------------------------------------------------------------------------

/**
 * Each module declares:
 *  - id:           stable identifier
 *  - dimension:    parent dimension key
 *  - weight:       contribution to its dimension (out of that dimension's total)
 *  - sources:      required evidence sources for eligibility
 *  - scorer:       (site, performance) => 0-100 or null
 */
export const MODULES = Object.freeze({
  // ── Conversion Pathways and Offer Clarity (25%) ──────────────────────
  conversion_paths: {
    id: "conversion_paths",
    dimension: "conversion_pathways",
    weight: 12.5,
    sources: ["crawl"],
    label: "Conversion Paths",
    scorer: (_site, _perf, modelDeps) => scoreConversion(modelDeps.site),
  },
  offer_clarity: {
    id: "offer_clarity",
    dimension: "conversion_pathways",
    weight: 12.5,
    sources: ["crawl"],
    label: "Offer Clarity",
    scorer: (_site, _perf, modelDeps) => scoreOfferClarity(modelDeps.site),
  },

  // ── Trust, E-E-A-T, and Risk Reduction (25%) ────────────────────────
  trust_signals: {
    id: "trust_signals",
    dimension: "trust_eeat",
    weight: 12.5,
    sources: ["crawl"],
    label: "Trust Signals",
    scorer: (_site, _perf, modelDeps) => scoreTrust(modelDeps.site),
  },
  risk_reduction: {
    id: "risk_reduction",
    dimension: "trust_eeat",
    weight: 12.5,
    sources: ["crawl"],
    label: "Risk Reduction",
    scorer: (_site, _perf, modelDeps) => scoreRiskReduction(modelDeps.site),
  },

  // ── Content and Funnel Coverage (20%) ────────────────────────────────
  content_depth: {
    id: "content_depth",
    dimension: "content_funnel",
    weight: 10,
    sources: ["crawl"],
    label: "Content Depth",
    scorer: (_site, _perf, modelDeps) => scoreContent(modelDeps.site),
  },
  funnel_coverage: {
    id: "funnel_coverage",
    dimension: "content_funnel",
    weight: 10,
    sources: ["crawl"],
    label: "Funnel Coverage",
    scorer: (_site, _perf, modelDeps) => scoreFunnelCoverage(modelDeps.site),
  },

  // ── Technical and Performance Readiness (20%) ────────────────────────
  technical_hygiene: {
    id: "technical_hygiene",
    dimension: "technical_performance",
    weight: 10,
    sources: ["crawl"],
    label: "Technical Hygiene",
    scorer: (_site, _perf, modelDeps) => scoreTechnical(modelDeps.site),
  },
  performance: {
    id: "performance",
    dimension: "technical_performance",
    weight: 10,
    sources: ["performance"],
    label: "Performance",
    scorer: (_site, perf, _modelDeps) => scorePerformance(perf),
  },

  // ── Entity, Schema, and AI-Search Readiness (10%) ────────────────────
  schema_entity: {
    id: "schema_entity",
    dimension: "entity_schema_ai",
    weight: 5,
    sources: ["crawl"],
    label: "Schema & Entity",
    scorer: (_site, _perf, modelDeps) => scoreSchemaEntity(modelDeps.site),
  },
  ai_readiness: {
    id: "ai_readiness",
    dimension: "entity_schema_ai",
    weight: 5,
    sources: ["crawl"],
    label: "AI-Search Readiness",
    scorer: (_site, _perf, modelDeps) => scoreAiReadiness(modelDeps.site),
  },
});

// ---------------------------------------------------------------------------
// Source → module index (built once)
// ---------------------------------------------------------------------------

const _moduleList = Object.values(MODULES);
const _modulesBySource = {};
for (const src of ["crawl", "performance", "ga4", "gsc", "backlinks", "competitors"]) {
  _modulesBySource[src] = _moduleList.filter((m) => m.sources.includes(src));
}

export function modulesForSource(sourceKey) {
  return _modulesBySource[sourceKey] || [];
}

// ---------------------------------------------------------------------------
// PRD §15.4 — Confidence modifiers
// ---------------------------------------------------------------------------

export const CONFIDENCE_MODIFIERS = Object.freeze({
  deterministic:        1.00,
  strongly_supported:   0.90,
  supported:            0.75,
  directional:          0.55,
  insufficient:         0,    // not score-bearing
});

export const CONFIDENCE_LEVELS = Object.freeze({
  DETERMINISTIC:        "deterministic",
  STRONGLY_SUPPORTED:   "strongly_supported",
  SUPPORTED:            "supported",
  DIRECTIONAL:          "directional",
  INSUFFICIENT:         "insufficient",
});

// ---------------------------------------------------------------------------
// Individual module scorers (0–100)
// ---------------------------------------------------------------------------

export function scoreTrust(site) {
  return clamp(
    (site.trust.credentials ? 25 : 0) +
    (site.trust.testimonials ? 25 : 0) +
    (site.trust.caseStudies ? 20 : 0) +
    (site.trust.policies ? 10 : 0) +
    (site.trust.contact ? 10 : 0) +
    (site.socialLinks.length ? 10 : 0),
  );
}

export function scoreContent(site) {
  const pages = Math.min(30, site.pageCount * 5);
  const depth = Math.min(25, site.averageWords / 20);
  const services = Math.min(20, site.services.length * 4);
  const education = (site.trust.faq ? 15 : 0) + (site.pageCount >= 5 ? 10 : 0);
  return clamp(pages + depth + services + education);
}

export function scoreConversion(site) {
  const ctaScore = Math.min(25, site.ctas.length * 5);
  const forms = site.forms.length ? 20 : 0;
  const pricing = site.trust.pricing ? 15 : 0;
  const reassurance = (site.trust.policies ? 10 : 0) + (site.trust.testimonials ? 10 : 0);
  const contact = site.trust.contact ? 10 : 0;
  const hierarchy = site.ctas.length > 0 && site.ctas.length <= 8 ? 10 : 3;
  return clamp(ctaScore + forms + pricing + reassurance + contact + hierarchy);
}

export function scoreTechnical(site) {
  const pageCount = Math.max(1, site.pageCount);
  const title = 15 * (1 - site.missingTitles / pageCount);
  const meta = 15 * (1 - site.missingDescriptions / pageCount);
  const canonical = 10 * (1 - site.missingCanonicals / pageCount);
  const h1 = 15 * (1 - Math.min(pageCount, site.h1Missing + site.h1Multiple) / pageCount);
  const schema = site.schemaTypes.filter((x) => x !== "InvalidJSONLD").length ? 15 : 0;
  const image = site.imageCount ? 10 * (1 - site.imagesMissingAlt / site.imageCount) : 10;
  const security = 20 * (Object.values(site.securityHeaders).filter(Boolean).length / 4);
  return clamp(title + meta + canonical + h1 + schema + image + security);
}

export function scorePerformance(performance) {
  const mobile = performance?.mobile?.scores?.performance;
  const desktop = performance?.desktop?.scores?.performance;
  const avg = average([mobile, desktop]);
  return avg === null ? null : clamp(avg);
}

// ---------------------------------------------------------------------------
// New module scorers (dimension decomposition)
// ---------------------------------------------------------------------------

function scoreOfferClarity(site) {
  const ctaClarity = Math.min(30, site.ctas.length * 6);
  const forms = site.forms.length ? 15 : 0;
  const pricing = site.trust.pricing ? 20 : 0;
  const services = Math.min(20, site.services.length * 4);
  const descCoverage = site.pageCount
    ? 15 * (1 - site.missingDescriptions / site.pageCount)
    : 0;
  return clamp(ctaClarity + forms + pricing + services + descCoverage);
}

function scoreRiskReduction(site) {
  const policies = site.trust.policies ? 25 : 0;
  const contact = site.trust.contact ? 20 : 0;
  const security = 25 * (Object.values(site.securityHeaders).filter(Boolean).length / 4);
  const https = site.targetUrl && site.targetUrl.startsWith("https:") ? 15 : 0;
  const faq = site.trust.faq ? 15 : 0;
  return clamp(policies + contact + security + https + faq);
}

function scoreFunnelCoverage(site) {
  // TOFU: awareness content based on page count and topic breadth
  const tofu = Math.min(30, site.pageCount * 4 + site.topicKeywords.length * 2);
  // MOFU: consideration — FAQ, case studies, comparison content
  const mofu = (site.trust.faq ? 20 : 0) + (site.trust.caseStudies ? 15 : 0) +
    (site.services.length >= 3 ? 10 : 0);
  // BOFU: decision — pricing, contact, forms, CTAs
  const bofu = (site.trust.pricing ? 20 : 0) + (site.trust.contact ? 10 : 0) +
    (site.forms.length ? 10 : 0) + Math.min(10, site.ctas.length * 2);
  return clamp(tofu + mofu + bofu);
}

function scoreSchemaEntity(site) {
  const validSchema = site.schemaTypes.filter((x) => x !== "InvalidJSONLD");
  const schemaCount = Math.min(40, validSchema.length * 10);
  const hasOrg = validSchema.some((t) => /organization|localbusiness/i.test(t)) ? 20 : 0;
  const hasFaq = validSchema.some((t) => /faq/i.test(t)) ? 15 : 0;
  const hasService = validSchema.some((t) => /service|product/i.test(t)) ? 15 : 0;
  const socialProof = site.socialLinks.length ? 10 : 0;
  return clamp(schemaCount + hasOrg + hasFaq + hasService + socialProof);
}

function scoreAiReadiness(site) {
  const schema = site.schemaTypes.length ? 25 : 0;
  const headings = site.pages[0]?.headings?.h1?.length ? 15 : 0;
  const faq = site.trust.faq ? 20 : 0;
  const depth = Math.min(20, site.pageCount * 3);
  const topics = site.topicKeywords.length >= 5 ? 20 : site.topicKeywords.length >= 3 ? 10 : 5;
  return clamp(schema + headings + faq + depth + topics);
}

// ---------------------------------------------------------------------------
// PRD §15.4 — Finding priority calculation
// ---------------------------------------------------------------------------

/**
 * Raw Priority = Conversion Impact × 0.30
 *              + Gap Severity × 0.25
 *              + Business Relevance × 0.20
 *              + Competitive Signal × 0.15
 *              + Implementation Practicality × 0.10
 *
 * Final Priority = Raw Priority × Confidence Modifier
 */
export function calculateFindingPriority(fields) {
  const conversionImpact = fields.conversionImpact ?? 50;
  const gapSeverity = fields.gapSeverity ?? 50;
  const businessRelevance = fields.businessRelevance ?? 50;
  const competitiveSignal = fields.competitiveSignal ?? 25;
  const implementationPracticality = fields.implementationPracticality ?? 50;

  const raw =
    conversionImpact * 0.30 +
    gapSeverity * 0.25 +
    businessRelevance * 0.20 +
    competitiveSignal * 0.15 +
    implementationPracticality * 0.10;

  const clampedRaw = clamp(raw, 0, 100);

  const confidence = fields.confidence || CONFIDENCE_LEVELS.DETERMINISTIC;
  const modifier = CONFIDENCE_MODIFIERS[confidence] ?? 0;

  const final = Math.round(clampedRaw * modifier);

  return { raw: clampedRaw, final, confidence, scoreBearing: final > 0 && confidence !== CONFIDENCE_LEVELS.INSUFFICIENT };
}

// ---------------------------------------------------------------------------
// PRD §16 — Deterministic finding ID
// ---------------------------------------------------------------------------

/**
 * Generate a stable, deterministic UUID-compatible identifier from:
 *  - ruleId
 *  - sorted affected URLs
 *  - normalized evidence array
 *
 * Identical inputs always produce identical IDs across runs.
 */
export function generateFindingId(ruleId, affectedUrls, evidenceRecords) {
  const normalized = {
    ruleId,
    urls: [...(affectedUrls || [])].sort(),
    evidence: (evidenceRecords || []).map((e) => ({
      provider: e.provider,
      sourceStatus: e.sourceStatus,
      field: e.field,
      observedValue: e.observedValue,
    })),
  };
  const hash = stableHash(JSON.stringify(normalized));
  // Format as UUID v4-style: xxxxxxxx-xxxx-4xxx-Vxxx-xxxxxxxxxxxx
  // where V is forced to [89ab] (UUID variant 10xx)
  const variantNibble = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${variantNibble}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// PRD §15.5 — Evidence confidence calculation
// ---------------------------------------------------------------------------

/**
 * Calculate evidence confidence from eight factors.
 *
 *  1. source availability   — are required sources present?
 *  2. data completeness      — did we get expected record counts?
 *  3. source validity        — did evidence pass envelope validation?
 *  4. data freshness         — is evidence recent enough?
 *  5. URL matching           — does evidence match the target?
 *  6. cross-source agreement — do independent sources corroborate?
 *  7. competitor relevance   — are competitor comparisons meaningful?
 *  8. rule certainty         — how certain are the rules applied?
 *
 * Returns 0–100.
 */
export function calculateEvidenceConfidence(evidence, findings) {
  const factors = {};

  // 1. Source availability (0–100)
  const sources = [
    { key: "site", required: true },
    { key: "performance", required: true },
    { key: "ga4", required: false },
    { key: "backlinks", required: false },
  ];
  let sourceScore = 0;
  let sourceCount = 0;
  for (const src of sources) {
    const ev = evidence[src.key];
    const status = ev?.sourceStatus;
    if (src.required) {
      sourceCount++;
      if (status === SOURCE_STATUS.AVAILABLE) sourceScore += 100;
      else if (status === SOURCE_STATUS.PARTIAL) sourceScore += 60;
      else sourceScore += 0;
    } else {
      // Optional sources contribute positively when available, don't penalize
      if (status === SOURCE_STATUS.AVAILABLE) {
        sourceCount++;
        sourceScore += 100;
      } else if (status === SOURCE_STATUS.PARTIAL) {
        sourceCount++;
        sourceScore += 60;
      }
      // NOT_CONNECTED / NOT_APPLICABLE = no contribution, no penalty
    }
  }
  factors.sourceAvailability = sourceCount
    ? Math.round(sourceScore / sourceCount)
    : 0;

  // 2. Data completeness (0–100)
  const completenessScores = [];
  for (const src of sources) {
    const ev = evidence[src.key];
    if (!ev || !ev.coverage) continue;
    const cov = ev.coverage;
    if (cov.requested > 0) {
      completenessScores.push(Math.round((cov.completed / cov.requested) * 100));
    }
  }
  factors.dataCompleteness = completenessScores.length
    ? Math.round(completenessScores.reduce((a, b) => a + b, 0) / completenessScores.length)
    : 50; // neutral when no coverage data

  // 3. Source validity (0–100)
  const validityScores = [];
  for (const src of sources) {
    const ev = evidence[src.key];
    if (!ev) continue;
    const status = ev.sourceStatus;
    if (status === SOURCE_STATUS.AVAILABLE) validityScores.push(100);
    else if (status === SOURCE_STATUS.PARTIAL) validityScores.push(70);
    else if (status === SOURCE_STATUS.NOT_CONNECTED || status === SOURCE_STATUS.NOT_APPLICABLE) {
      // Don't penalize — source wasn't expected to deliver
    } else {
      validityScores.push(0);
    }
  }
  // Only score sources that were expected to deliver
  if (validityScores.length === 0) {
    // All optional sources are not connected — validity is neutral
    const requiredValid = sources
      .filter((s) => s.required)
      .every((s) => {
        const st = evidence[s.key]?.sourceStatus;
        return st === SOURCE_STATUS.AVAILABLE || st === SOURCE_STATUS.PARTIAL;
      });
    factors.sourceValidity = requiredValid ? 100 : 0;
  } else {
    factors.sourceValidity = Math.round(
      validityScores.reduce((a, b) => a + b, 0) / validityScores.length,
    );
  }

  // 4. Data freshness (0–100)
  const now = Date.now();
  const freshnessScores = [];
  for (const src of sources) {
    const ev = evidence[src.key];
    const collectedAt = ev?.collectedAt;
    if (!collectedAt) continue;
    const ageMs = now - new Date(collectedAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    // 100% if < 1h old, 50% if 24h old, 0% if > 72h old
    if (ageHours < 1) freshnessScores.push(100);
    else if (ageHours < 24) freshnessScores.push(Math.round(100 - (ageHours - 1) * (50 / 23)));
    else if (ageHours < 72) freshnessScores.push(Math.round(50 - (ageHours - 24) * (50 / 48)));
    else freshnessScores.push(0);
  }
  factors.dataFreshness = freshnessScores.length
    ? Math.round(freshnessScores.reduce((a, b) => a + b, 0) / freshnessScores.length)
    : 50;

  // 5. URL matching (0–100)
  // Evidence matches when crawl target equals the input URL domain
  const siteTarget = evidence.site?.targetUrl || evidence.site?.domain || "";
  factors.urlMatching = siteTarget ? 100 : 0; // Present = match; simplified for MVP

  // 6. Cross-source agreement (0–100)
  // When crawl and performance both available, agreement is higher
  const crawlOk = evidence.site?.sourceStatus === SOURCE_STATUS.AVAILABLE ||
    evidence.site?.sourceStatus === SOURCE_STATUS.PARTIAL;
  const perfOk = evidence.performance?.sourceStatus === SOURCE_STATUS.AVAILABLE ||
    evidence.performance?.sourceStatus === SOURCE_STATUS.PARTIAL;
  if (crawlOk && perfOk) factors.crossSourceAgreement = 100;
  else if (crawlOk || perfOk) factors.crossSourceAgreement = 60;
  else factors.crossSourceAgreement = 0;

  // 7. Competitor relevance (0–100)
  const competitors = evidence.competitors || [];
  const competitorAvailable = competitors.some(
    (c) => c.status === SOURCE_STATUS.AVAILABLE,
  );
  factors.competitorRelevance = competitorAvailable ? 100
    : competitors.length > 0 ? 40
    : 50; // neutral — user didn't supply any

  // 8. Rule certainty (0–100)
  // Based on finding confidence levels
  if (!findings || findings.length === 0) {
    factors.ruleCertainty = 50; // neutral — no findings to assess
  } else {
    const certaintyMap = {
      [CONFIDENCE_LEVELS.DETERMINISTIC]: 100,
      [CONFIDENCE_LEVELS.STRONGLY_SUPPORTED]: 85,
      [CONFIDENCE_LEVELS.SUPPORTED]: 65,
      [CONFIDENCE_LEVELS.DIRECTIONAL]: 40,
      [CONFIDENCE_LEVELS.INSUFFICIENT]: 0,
    };
    const certainties = findings.map(
      (f) => certaintyMap[f.confidence] ?? 50,
    );
    factors.ruleCertainty = Math.round(
      certainties.reduce((a, b) => a + b, 0) / certainties.length,
    );
  }

  // Weighted average of all factors
  const factorWeights = {
    sourceAvailability: 0.20,
    dataCompleteness: 0.15,
    sourceValidity: 0.15,
    dataFreshness: 0.10,
    urlMatching: 0.10,
    crossSourceAgreement: 0.10,
    competitorRelevance: 0.10,
    ruleCertainty: 0.10,
  };

  let totalWeight = 0;
  let weightedSum = 0;
  for (const [factor, weight] of Object.entries(factorWeights)) {
    weightedSum += (factors[factor] ?? 50) * weight;
    totalWeight += weight;
  }

  const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
  return { score: clamp(score), factors };
}

// ---------------------------------------------------------------------------
// Module eligibility check (PRD §15.2)
// ---------------------------------------------------------------------------

/**
 * Determine if a module is eligible based on its source dependencies.
 * Returns { eligible, reason }.
 */
export function checkModuleEligibility(moduleDef, evidence) {
  const reasons = [];

  for (const sourceKey of moduleDef.sources) {
    let sourceEvidence;
    switch (sourceKey) {
      case "crawl":
        sourceEvidence = evidence.site;
        break;
      case "performance":
        sourceEvidence = evidence.performance;
        break;
      case "ga4":
        sourceEvidence = evidence.ga4;
        break;
      case "backlinks":
        sourceEvidence = evidence.backlinks;
        break;
      case "competitors":
        sourceEvidence = { sourceStatus: evidence.competitors?.some((c) => c.status === SOURCE_STATUS.AVAILABLE) ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.NOT_CONNECTED };
        break;
      default:
        reasons.push(`Unknown source "${sourceKey}"`);
        continue;
    }

    if (!sourceEvidence) {
      reasons.push(`Source "${sourceKey}" is not configured`);
      continue;
    }

    const status = sourceEvidence.sourceStatus;
    if (status === SOURCE_STATUS.AVAILABLE || status === SOURCE_STATUS.PARTIAL) {
      // Gate passes
      continue;
    }

    reasons.push(
      `Source "${sourceKey}" status is ${status} — module suppressed`,
    );
  }

  return {
    eligible: reasons.length === 0,
    reason: reasons.length ? reasons.join("; ") : null,
  };
}

// ---------------------------------------------------------------------------
// PRD §16 — Finding contract builder
// ---------------------------------------------------------------------------

// Rule ID registry
const RULE_PREFIX = "VAN";
const RULE_VERSION = SCORING_VERSION;

/**
 * Build findings compliant with PRD v3.0 §16.
 *
 * Each finding includes:
 *  - findingId (deterministic UUID)
 *  - ruleId, ruleVersion
 *  - dimension, module
 *  - title, affectedUrls
 *  - evidence array (provider, sourceStatus, field, observedValue, artifactRef)
 *  - confidence
 *  - businessImpact, recommendation, implementationEffort, verificationMethod
 *  - scoreBearing
 *  - rawPriority, finalPriority
 */
export function buildFindings(site, performance) {
  const findings = [];

  const add = (opts) => {
    const evidenceRecords = (opts.evidence || []).map((er) => ({
      provider: er.provider || "dataforseo_onpage",
      sourceStatus: er.sourceStatus || SOURCE_STATUS.AVAILABLE,
      field: er.field,
      observedValue: er.observedValue ?? null,
      artifactRef: er.artifactRef || site.rawArtifactRef || null,
    }));

    // Enforce: no finding without evidence (PRD §16)
    if (!evidenceRecords.length) return;

    const affectedUrls = opts.affectedUrls || [site.targetUrl || site.domain];

    const findingId = generateFindingId(
      opts.ruleId,
      affectedUrls,
      evidenceRecords,
    );

    const confidence = opts.confidence || CONFIDENCE_LEVELS.DETERMINISTIC;

    const priority = calculateFindingPriority({
      conversionImpact: opts.conversionImpact ?? _defaultImpact(opts.severity),
      gapSeverity: opts.gapSeverity ?? _defaultGapSeverity(opts.severity),
      businessRelevance: opts.businessRelevance ?? 50,
      competitiveSignal: opts.competitiveSignal ?? 25,
      implementationPracticality: opts.implementationPracticality ?? _defaultPracticality(opts.effort),
      confidence,
    });

    findings.push({
      findingId,
      ruleId: opts.ruleId,
      ruleVersion: RULE_VERSION,
      dimension: opts.dimension,
      module: opts.module,
      title: opts.title,
      affectedUrls,
      evidence: evidenceRecords,
      confidence,
      businessImpact: opts.businessImpact || opts.impact || "",
      recommendation: opts.recommendation || opts.fix || "",
      implementationEffort: opts.effort || "M",
      verificationMethod: opts.verificationMethod || "Re-audit after changes are applied.",
      scoreBearing: priority.scoreBearing,
      rawPriority: priority.raw,
      finalPriority: priority.final,
      severity: opts.severity, // kept for display compatibility
      problem: opts.title,     // kept for display compatibility
      impact: opts.businessImpact || opts.impact || "",
      fix: opts.recommendation || opts.fix || "",
      effort: opts.effort || "M",
      key: opts.key || "",
      evidenceText: opts.evidenceText || "", // kept for display compatibility
    });
  };

  // Helper: detect trust-proof severity
  const trustProofConfidence =
    !site.trust.testimonials && !site.trust.caseStudies && !site.trust.credentials
      ? CONFIDENCE_LEVELS.DETERMINISTIC
      : site.trust.testimonials || site.trust.credentials
        ? CONFIDENCE_LEVELS.STRONGLY_SUPPORTED
        : CONFIDENCE_LEVELS.SUPPORTED;

  // ── Crawl-dependent findings ──────────────────────────────────────

  if (!site.trust.testimonials && !site.trust.caseStudies && !site.trust.credentials) {
    add({
      ruleId: "VAN-TRUST-001",
      dimension: "trust_eeat",
      module: "trust_signals",
      title: "No visible trust proof",
      severity: "High",
      key: "trust",
      confidence: trustProofConfidence,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "trust.testimonials", observedValue: false },
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "trust.credentials", observedValue: false },
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "trust.caseStudies", observedValue: false },
      ],
      evidenceText: "No testimonials, case studies, or credentials detected",
      businessImpact: "Visitors cannot verify credibility before deciding",
      recommendation: "Add credentials, client proof, and outcome-based case studies",
      effort: "M",
      conversionImpact: 85,
      gapSeverity: 80,
      businessRelevance: 90,
      competitiveSignal: 40,
      implementationPracticality: 50,
      verificationMethod: "Re-crawl and confirm trust signals are detected on key pages.",
    });
  }

  if (site.missingDescriptions) {
    add({
      ruleId: "VAN-TECH-001",
      dimension: "technical_performance",
      module: "technical_hygiene",
      title: "Missing meta descriptions",
      severity: "High",
      key: "meta",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      affectedUrls: site.pages?.filter((p) => !p.description).map((p) => p.url).slice(0, 10) || [site.targetUrl],
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "meta_description", observedValue: null },
      ],
      evidenceText: `${site.missingDescriptions} of ${site.pageCount} crawled pages`,
      businessImpact: "Search-result messaging is uncontrolled for these pages.",
      recommendation: "Write a unique 150–160 character description for each important page",
      effort: "L",
      conversionImpact: 75,
      gapSeverity: 70,
      businessRelevance: 80,
      competitiveSignal: 60,
      implementationPracticality: 90,
      verificationMethod: "Re-crawl the URLs and confirm descriptions are present.",
    });
  }

  if (!site.schemaTypes.length) {
    add({
      ruleId: "VAN-SCHEMA-001",
      dimension: "entity_schema_ai",
      module: "schema_entity",
      title: "No structured data detected",
      severity: "High",
      key: "schema",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "schema_types", observedValue: [] },
      ],
      evidenceText: "No JSON-LD schema types found",
      businessImpact: "Search and AI systems receive weak entity context",
      recommendation: "Add Organization or LocalBusiness, Person, Service, and FAQ schema where supported",
      effort: "M",
      conversionImpact: 60,
      gapSeverity: 65,
      businessRelevance: 70,
      competitiveSignal: 55,
      implementationPracticality: 60,
      verificationMethod: "Re-crawl and validate structured data with Google's Rich Results Test.",
    });
  }

  // ── Performance-dependent findings ────────────────────────────────
  const lcp = performance?.mobile?.metrics?.lcpMs;
  if (Number.isFinite(lcp) && lcp > 4000) {
    add({
      ruleId: "VAN-PERF-001",
      dimension: "technical_performance",
      module: "performance",
      title: "Mobile largest contentful paint is slow",
      severity: "High",
      key: "lcp",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        {
          provider: performance?.mobile?.source || "pagespeed-insights",
          sourceStatus: performance?.mobile?.status || SOURCE_STATUS.AVAILABLE,
          field: "lcp_ms",
          observedValue: lcp,
          artifactRef: null,
        },
      ],
      evidenceText: `${(lcp / 1000).toFixed(1)} seconds`,
      businessImpact: "Slow first impressions increase mobile abandonment",
      recommendation: "Optimize the largest above-the-fold asset and remove render-blocking work",
      effort: "M",
      conversionImpact: 80,
      gapSeverity: 75,
      businessRelevance: 85,
      competitiveSignal: 50,
      implementationPracticality: 55,
      verificationMethod: "Re-run PageSpeed Insights and confirm LCP is under 2.5 seconds.",
    });
  }

  // ── Additional crawl-dependent findings ──────────────────────────

  if (site.pageCount <= 1 || site.services.length > site.pageCount * 2) {
    add({
      ruleId: "VAN-CONTENT-001",
      dimension: "content_funnel",
      module: "content_depth",
      title: "Services lack dedicated page depth",
      severity: "Medium",
      key: "pages",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "page_count", observedValue: site.pageCount },
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "services", observedValue: site.services.length },
      ],
      evidenceText: `${site.pageCount} crawlable page(s) for ${site.services.length || "multiple"} service topics`,
      businessImpact: "Individual offers cannot build enough relevance or answer buyer questions",
      recommendation: "Create one focused page for each primary service",
      effort: "H",
      conversionImpact: 70,
      gapSeverity: 60,
      businessRelevance: 75,
      competitiveSignal: 45,
      implementationPracticality: 30,
      verificationMethod: "Re-crawl and confirm each primary service has a dedicated page.",
    });
  }

  if (site.h1Missing || site.h1Multiple) {
    add({
      ruleId: "VAN-TECH-002",
      dimension: "technical_performance",
      module: "technical_hygiene",
      title: "Heading structure is inconsistent",
      severity: "Medium",
      key: "headings",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "h1_missing", observedValue: site.h1Missing },
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "h1_multiple", observedValue: site.h1Multiple },
      ],
      evidenceText: `${site.h1Missing} pages missing H1; ${site.h1Multiple} pages with multiple H1s`,
      businessImpact: "Semantic clarity and accessibility are reduced",
      recommendation: "Use one descriptive H1 per page with sequential H2 and H3 sections",
      effort: "M",
      conversionImpact: 50,
      gapSeverity: 55,
      businessRelevance: 60,
      competitiveSignal: 30,
      implementationPracticality: 70,
      verificationMethod: "Re-crawl and verify heading structure on all pages.",
    });
  }

  const missingSecurity = Object.entries(site.securityHeaders)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  if (missingSecurity.length) {
    add({
      ruleId: "VAN-TECH-003",
      dimension: "technical_performance",
      module: "technical_hygiene",
      title: "Security headers are incomplete",
      severity: "Medium",
      key: "security",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "security_headers", observedValue: missingSecurity.join(", ") },
      ],
      evidenceText: missingSecurity.join(", "),
      businessImpact: "Missing browser protections can weaken technical trust",
      recommendation: "Configure the missing response headers at the hosting layer",
      effort: "L",
      conversionImpact: 35,
      gapSeverity: 45,
      businessRelevance: 50,
      competitiveSignal: 25,
      implementationPracticality: 75,
      verificationMethod: "Re-crawl and confirm security headers are present in response.",
    });
  }

  if (!site.trust.faq) {
    add({
      ruleId: "VAN-CONTENT-002",
      dimension: "content_funnel",
      module: "funnel_coverage",
      title: "No buyer-question content detected",
      severity: "Medium",
      key: "faq",
      confidence: CONFIDENCE_LEVELS.SUPPORTED,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "trust.faq", observedValue: false },
      ],
      evidenceText: "No FAQ or common-question section found",
      businessImpact: "Unanswered objections can stop conversion",
      recommendation: "Add an FAQ based on the questions prospects ask before booking",
      effort: "M",
      conversionImpact: 55,
      gapSeverity: 45,
      businessRelevance: 60,
      competitiveSignal: 35,
      implementationPracticality: 65,
      verificationMethod: "Re-crawl and confirm FAQ content is present with structured data where applicable.",
    });
  }

  if (!site.trust.pricing) {
    add({
      ruleId: "VAN-TRUST-002",
      dimension: "trust_eeat",
      module: "risk_reduction",
      title: "Pricing or investment context is absent",
      severity: "Medium",
      key: "pricing",
      confidence: CONFIDENCE_LEVELS.STRONGLY_SUPPORTED,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "trust.pricing", observedValue: false },
      ],
      evidenceText: "No pricing, cost, fee, or investment language detected",
      businessImpact: "Visitors may leave before contacting because commitment is unclear",
      recommendation: "State pricing, starting price, or the process used to determine cost",
      effort: "L",
      conversionImpact: 65,
      gapSeverity: 55,
      businessRelevance: 70,
      competitiveSignal: 50,
      implementationPracticality: 80,
      verificationMethod: "Re-crawl and confirm pricing information is visible on relevant pages.",
    });
  }

  if (site.imagesMissingAlt) {
    add({
      ruleId: "VAN-TECH-004",
      dimension: "technical_performance",
      module: "technical_hygiene",
      title: "Images are missing alternative text",
      severity: "Low",
      key: "alt",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "images_missing_alt", observedValue: site.imagesMissingAlt },
      ],
      evidenceText: `${site.imagesMissingAlt} of ${site.imageCount} images`,
      businessImpact: "Accessibility and image understanding are reduced",
      recommendation: "Add concise descriptive alt text to meaningful images",
      effort: "L",
      conversionImpact: 20,
      gapSeverity: 30,
      businessRelevance: 25,
      competitiveSignal: 15,
      implementationPracticality: 85,
      verificationMethod: "Re-crawl and verify alt text on all images.",
    });
  }

  if (site.imagesMissingDimensions) {
    add({
      ruleId: "VAN-TECH-005",
      dimension: "technical_performance",
      module: "technical_hygiene",
      title: "Images lack explicit dimensions",
      severity: "Low",
      key: "dimensions",
      confidence: CONFIDENCE_LEVELS.DETERMINISTIC,
      evidence: [
        { provider: "dataforseo_onpage", sourceStatus: SOURCE_STATUS.AVAILABLE, field: "images_missing_dimensions", observedValue: site.imagesMissingDimensions },
      ],
      evidenceText: `${site.imagesMissingDimensions} of ${site.imageCount} images`,
      businessImpact: "Layout shifts can reduce visual stability",
      recommendation: "Set width and height on rendered images",
      effort: "L",
      conversionImpact: 15,
      gapSeverity: 20,
      businessRelevance: 20,
      competitiveSignal: 10,
      implementationPracticality: 90,
      verificationMethod: "Re-crawl and verify image dimensions on all images.",
    });
  }

  // Sort by final priority descending, then by severity rank
  return findings.sort((a, b) => {
    if (b.finalPriority !== a.finalPriority) return b.finalPriority - a.finalPriority;
    return (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0);
  });
}

// ---------------------------------------------------------------------------
// Default priority inputs (fallback when not explicitly provided)
// ---------------------------------------------------------------------------

function _defaultImpact(severity) {
  if (severity === "High") return 75;
  if (severity === "Medium") return 50;
  return 25;
}

function _defaultGapSeverity(severity) {
  if (severity === "High") return 70;
  if (severity === "Medium") return 45;
  return 20;
}

function _defaultPracticality(effort) {
  if (effort === "L") return 85;
  if (effort === "M") return 55;
  return 30; // "H"
}

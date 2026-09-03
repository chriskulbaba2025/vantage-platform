import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { scoreAudit } from "../scoring/vantage-score.js";
import {
  validateWriterOutput,
  WRITER_OUTPUT_VERSION,
  WRITER_PROMPT_VERSION,
} from "../narrative-v2/writer-output.js";
import { renderReportV2 } from "./render-report-v2.js";
import { renderWriterNarrativeLayer } from "./render-narrative-v2.js";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";
const FIXED_TS = "2026-08-20T04:00:00.000Z";
const REF = "finding:F-001";
const SOURCE_REF = "source:backlinks";

const KAREN_NAV_LABELS = Object.freeze([
  "Scorecard",
  "Priority Fixes",
  "Conversion Paths",
  "Readiness Map",
  "Content Ideas",
  "Competitor Benchmarking",
  "E-E-A-T Trust",
  "CMS Constraints",
  "Technical Hygiene",
  "Headings",
  "Schema",
  "Performance",
  "Evidence",
]);

function model() {
  const input = {
    targetUrl: "https://example.com",
    businessName: "Example Business",
    competitors: [],
    services: ["Advisory"],
    primaryGoal: "Generate qualified enquiries",
  };
  const evidence = {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: {
      sourceStatus: "AVAILABLE",
      targetUrl: "https://example.com/",
      domain: "example.com",
      pageCount: 2,
      platform: "WordPress",
      pages: [{
        url: "https://example.com/",
        title: "Home",
        headings: { h1: ["Advisory"], h2: ["Services"], h3: [], h4: [] },
        responseHeaders: {},
      }],
      services: ["Advisory"],
      topicKeywords: ["advisory support"],
      ctas: [{ text: "Contact", url: "https://example.com/contact", kind: "link" }],
      externalCtas: [],
      forms: [{ action: "/submit" }],
      schemaTypes: ["Organization"],
      microdataTypes: [],
      socialLinks: [],
      trust: {
        testimonials: true,
        credentials: true,
        caseStudies: false,
        faq: false,
        pricing: false,
        policies: true,
        contact: true,
      },
      securityHeaders: {
        xFrameOptions: true,
        xContentTypeOptions: true,
        referrerPolicy: true,
        contentSecurityPolicy: true,
      },
      totalWords: 900,
      averageWords: 450,
      missingTitles: 0,
      missingDescriptions: 0,
      missingCanonicals: 0,
      h1Missing: 0,
      h1Multiple: 0,
      imageCount: 2,
      imagesMissingAlt: 0,
      internalLinkCount: 3,
      brokenInternalLinks: [],
      statusCounts: {},
      limitations: [],
      collectedAt: FIXED_TS,
      coverage: { requested: 2, completed: 2, failed: 0 },
      _contentEvidenceAvailable: true,
      _responseHeadersAvailable: true,
      _metaFieldAvailability: {
        titles: true,
        descriptions: true,
        canonicals: true,
        headings: true,
      },
    },
    performance: {
      sourceStatus: "AVAILABLE",
      provider: "pagespeed-insights",
      mobile: {
        status: "AVAILABLE",
        source: "psi",
        scores: { performance: 72, accessibility: 90, bestPractices: 95, seo: 92 },
        metrics: { fcpMs: 1400, lcpMs: 2600, tbtMs: 120, cls: 0.08 },
      },
      desktop: {
        status: "AVAILABLE",
        source: "psi",
        scores: { performance: 91, accessibility: 94, bestPractices: 96, seo: 95 },
        metrics: { fcpMs: 800, lcpMs: 1500, tbtMs: 40, cls: 0.03 },
      },
      fieldData: {},
      limitations: [],
      collectedAt: FIXED_TS,
      coverage: { requested: 2, completed: 2, failed: 0 },
    },
    competitors: null,
    backlinks: null,
    ga4: null,
    gsc: null,
  };
  return scoreAudit(input, evidence);
}

function writerInput() {
  return {
    contractVersion: "1.0.0",
    writerInputVersion: "1.0.0",
    auditId: AUDIT_ID,
    scoreGovernance: {
      sourceDependencies: {
        backlinks: "UNAVAILABLE",
      },
    },
    referenceIndex: {
      [REF]: { kind: "finding", path: "findings.F-001" },
      [SOURCE_REF]: { kind: "source-status", path: "scoreGovernance.sourceDependencies.backlinks" },
    },
  };
}

function atom(text, statementClass = "INTERPRETATION", evidenceRefs = [REF]) {
  return { text, statementClass, evidenceRefs };
}

function opportunity(text) {
  return atom(text, "OPPORTUNITY");
}

function writerOutput() {
  const interpretation = (label) => atom(`${label} is grounded in the verified report evidence.`);
  const statusInterpretation = (label) => atom(
    `${label} is grounded in the governed source status.`,
    "INTERPRETATION",
    [SOURCE_REF],
  );
  return {
    contractVersion: "1.0.0",
    writerOutputVersion: WRITER_OUTPUT_VERSION,
    auditId: AUDIT_ID,
    passNumber: 1,
    modelId: "writer-regression",
    promptVersion: WRITER_PROMPT_VERSION,
    generatedAt: FIXED_TS,
    executiveConclusion: {
      headline: "The site has a useful base with one material constraint",
      narrative: interpretation("The executive conclusion"),
    },
    strengths: [{ itemId: "STR-01", title: "Useful foundation", narrative: interpretation("The strength") }],
    rootCause: {
      headline: "The primary constraint interrupts the conversion path",
      narrative: interpretation("The root cause"),
      businessConsequences: [{ area: "Conversion", narrative: interpretation("The business consequence") }],
    },
    conversion: {
      headline: "Conversion",
      whatWorks: interpretation("What works"),
      constraints: interpretation("The constraint"),
      businessMeaning: interpretation("The business meaning"),
      priority: interpretation("The priority"),
    },
    content: {
      headline: "Content and topical architecture",
      currentStrength: interpretation("The content strength"),
      coverageAssessment: interpretation("The coverage assessment"),
      qualityAssessment: interpretation("The quality assessment"),
      topicalArchitecture: interpretation("The topical architecture"),
      importantGaps: interpretation("The important gap"),
      businessMeaning: interpretation("The content business meaning"),
    },
    funnelOpportunities: {
      awareness: [{
        itemId: "FUN-01",
        concept: opportunity("Create an awareness concept supported by the evidence."),
        userNeed: opportunity("Answer the verified user need."),
        rationale: opportunity("Use the verified constraint as the rationale."),
        businessObjective: opportunity("Support the conversion objective."),
        nextAction: opportunity("Move the reader to the next governed action."),
      }],
      consideration: [],
      decision: [],
    },
    seoSerp: {
      headline: "SEO and SERP",
      whatWorks: interpretation("The search strength"),
      constraints: interpretation("The search constraint"),
      searchImplication: interpretation("The search implication"),
      priority: interpretation("The search priority"),
    },
    aiSearch: {
      headline: "AI search readiness",
      answerability: interpretation("Answerability"),
      entityStrength: interpretation("Entity strength"),
      citationReadiness: interpretation("Citation readiness"),
      constraints: interpretation("AI-search constraints"),
      opportunity: opportunity("Improve AI-search readiness from verified evidence."),
    },
    eeatTrust: {
      headline: "E-E-A-T and trust",
      experience: interpretation("Experience"),
      expertise: interpretation("Expertise"),
      authority: interpretation("Authority"),
      trust: interpretation("Trust"),
      proofGaps: interpretation("Proof gaps"),
      businessMeaning: interpretation("Trust business meaning"),
    },
    technical: {
      headline: "Technical foundations",
      assessment: interpretation("Technical assessment"),
      materialIssues: interpretation("Technical issues"),
      businessMeaning: interpretation("Technical business meaning"),
    },
    performanceUx: {
      headline: "Performance and UX",
      assessment: interpretation("Performance assessment"),
      userImpact: interpretation("User impact"),
      conversionImpact: interpretation("Conversion impact"),
    },
    competitors: {
      headline: "Competitive position",
      advantages: interpretation("Competitive advantages"),
      disadvantages: interpretation("Competitive disadvantages"),
      marketInterpretation: interpretation("Market interpretation"),
      differentiatorToProtect: interpretation("Differentiator to protect"),
    },
    limitations: [{
      itemId: "LIM-01",
      area: "Off-site evidence",
      status: "UNAVAILABLE",
      clientExplanation: statusInterpretation("The limitation"),
      whatThisMeans: statusInterpretation("What the limitation means"),
      whatThisDoesNotMean: statusInterpretation("What the limitation does not mean"),
      impactOnReport: interpretation("The limitation impact"),
    }],
    actionPlan: [{
      actionId: "ACT-01",
      priority: 1,
      title: "Correct the verified priority",
      action: opportunity("Correct the verified priority."),
      whyNow: opportunity("Address it now because the evidence marks it as material."),
      expectedBusinessEffect: opportunity("Create a clearer conversion path; the outcome was not measured."),
      effort: "M",
      verification: opportunity("Re-run the governed audit to verify the change."),
    }],
    executiveDecision: {
      preserve: interpretation("Preserve the verified strength"),
      change: interpretation("Change the verified constraint"),
      doNext: opportunity("Do the governed priority next."),
    },
  };
}

function reportSurfaces() {
  const deterministic = renderReportV2(model(), { date: "2026-08-20" });
  const output = writerOutput();
  const validation = validateWriterOutput(output, {
    writerInput: writerInput(),
    expectedPassNumber: 1,
  });
  assert.deepEqual(validation, { valid: true, errors: [] }, "regression fixture must satisfy the real Writer v2 contract");
  const narrative = renderWriterNarrativeLayer(output, { totalScore: 100, decision: "PASS" });
  return { deterministic, narrative, combined: `${narrative}\n${deterministic}` };
}

test("KAREN-REG-01: the frozen Karen template still defines all 13 benchmark areas", () => {
  const template = readFileSync(new URL("./karen-leslie-template.html", import.meta.url), "utf8");
  for (const label of KAREN_NAV_LABELS) {
    assert.ok(template.includes(`>${label}</a>`), `Karen benchmark label remains present: ${label}`);
  }
});

test("KAREN-REG-02: the governed v2 report semantically covers every Karen benchmark area", () => {
  const { combined } = reportSurfaces();
  const benchmark = [
    ["Scorecard", [/A\. Conversion Readiness/, /B\. Evidence Confidence/, /C\. Evidence Coverage/]],
    ["Priority Fixes", [/E\. What should be fixed first\?/]],
    ["Conversion Paths", [/Conversion path architecture/]],
    ["Readiness Map", [/D\. Where are the problems\?/, /First Things First — Foundational Readiness/]],
    ["Content Ideas", [/Topical Map &amp; Content Opportunities/]],
    ["Competitor Benchmarking", [/Competitive context/]],
    ["E-E-A-T Trust", [/E-E-A-T — Trust Readiness Detail/]],
    ["CMS Constraints", [/CMS &amp; Platform Constraints/]],
    ["Technical Hygiene", [/Technical Detail/]],
    ["Headings", [/Heading Structure — Evaluated Page/]],
    ["Schema", [/Schema &amp; Entity Signals/]],
    ["Performance", [/Performance Detail/]],
    ["Evidence", [/Evidence detail/, /Source statuses/, /Evidence capabilities/]],
  ];

  assert.deepEqual(benchmark.map(([label]) => label), KAREN_NAV_LABELS);
  for (const [label, requirements] of benchmark) {
    for (const requirement of requirements) {
      assert.match(combined, requirement, `${label} semantic coverage must remain present`);
    }
  }
});

test("KAREN-REG-03: diagnostic depth beyond the Karen navigation remains available", () => {
  const { deterministic } = reportSurfaces();
  for (const marker of [
    "Internal-Link Opportunities",
    "Machine Readability",
    "What Is Already Good",
    "Client Action Plan",
    "Deferred &amp; unavailable analysis",
  ]) {
    assert.ok(deterministic.includes(marker), `diagnostic depth preserved: ${marker}`);
  }
});

test("KAREN-REG-04: Narrative v2 adds decision usefulness instead of replacing diagnostic depth", () => {
  const { narrative } = reportSurfaces();
  for (const marker of [
    "Executive conclusion",
    "Verified strengths",
    "Root cause",
    "Business meaning",
    "Funnel opportunities",
    "Evidence boundaries",
    "Action plan",
    "Preserve, change, do next",
  ]) {
    assert.ok(narrative.includes(marker), `decision-usefulness layer present: ${marker}`);
  }
});

test("KAREN-REG-05: every rendered narrative atom retains exact evidence lineage metadata", () => {
  const { narrative } = reportSurfaces();
  const refs = [...narrative.matchAll(/data-evidence-refs="([^"]*)"/g)].map((match) => match[1]);
  const governedRefs = new Set([REF, SOURCE_REF]);
  assert.ok(refs.length >= 40, "substantive narrative atoms expose evidence metadata");
  assert.ok(refs.every((value) => governedRefs.has(value)), "every narrative atom remains tied to an exact governed evidence ID");
  assert.ok(refs.includes(REF), "finding evidence lineage remains present");
  assert.ok(refs.includes(SOURCE_REF), "source-status evidence lineage remains present");
  assert.doesNotMatch(narrative, />finding:F-001</, "internal finding IDs are not rendered as client prose");
  assert.doesNotMatch(narrative, />source:backlinks</, "internal source IDs are not rendered as client prose");
});

test("KAREN-REG-06: regression gate requires both client narrative and deterministic evidence surfaces", () => {
  const { deterministic, narrative } = reportSurfaces();
  assert.match(narrative, /data-judge-decision="PASS"/);
  assert.match(deterministic, /Evidence detail/);
  assert.match(deterministic, /Deferred &amp; unavailable analysis/);
  assert.match(narrative, /Executive decision/);
});

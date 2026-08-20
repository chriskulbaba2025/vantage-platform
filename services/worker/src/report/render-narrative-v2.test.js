import test from "node:test";
import assert from "node:assert/strict";

import { scoreAudit } from "../scoring/vantage-score.js";
import {
  JUDGE_CONTRACT_VERSION,
  JUDGE_DECISION,
  RUBRIC,
} from "../narrative-v2/judge-contract.js";
import {
  runNarrativeV2Orchestration,
  NARRATIVE_V2_STATUS,
} from "../narrative-v2/orchestrator.js";
import {
  WRITER_OUTPUT_VERSION,
  WRITER_PROMPT_VERSION,
} from "../narrative-v2/writer-output.js";
import { renderGovernedNarrativeReportV2 } from "./render-narrative-v2.js";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";
const REF = "finding:F-001";
const FIXED_TS = "2026-08-20T04:00:00.000Z";

function writerInput() {
  return {
    contractVersion: "1.0.0",
    writerInputVersion: "1.0.0",
    auditId: AUDIT_ID,
    referenceIndex: {
      [REF]: { kind: "finding", path: "findings.F-001" },
    },
  };
}

function atom(text, statementClass = "INTERPRETATION") {
  return { text, statementClass, evidenceRefs: [REF] };
}

function opportunity(text) {
  return atom(text, "OPPORTUNITY");
}

function standard(headline, fields) {
  return { headline, ...fields };
}

function validWriterOutput(passNumber = 1) {
  const interpret = (label) => atom(`${label} is a governed interpretation tied to the verified finding.`);
  return {
    contractVersion: "1.0.0",
    writerOutputVersion: WRITER_OUTPUT_VERSION,
    auditId: AUDIT_ID,
    passNumber,
    modelId: "writer-test",
    promptVersion: WRITER_PROMPT_VERSION,
    generatedAt: FIXED_TS,
    executiveConclusion: {
      headline: "The site has a useful base with one priority constraint",
      narrative: interpret("The executive conclusion"),
    },
    strengths: [{ itemId: "STR-01", title: "Useful foundation", narrative: interpret("The strength") }],
    rootCause: {
      headline: "The verified constraint limits the current path",
      narrative: interpret("The root cause"),
      businessConsequences: [{ area: "Conversion", narrative: interpret("The business consequence") }],
    },
    conversion: standard("Conversion", {
      whatWorks: interpret("Conversion strength"),
      constraints: interpret("Conversion constraint"),
      businessMeaning: interpret("Conversion business meaning"),
      priority: interpret("Conversion priority"),
    }),
    content: standard("Content and topical architecture", {
      currentStrength: interpret("Content strength"),
      coverageAssessment: interpret("Content coverage"),
      qualityAssessment: interpret("Content quality"),
      topicalArchitecture: interpret("Topical architecture"),
      importantGaps: interpret("Content gap"),
      businessMeaning: interpret("Content business meaning"),
    }),
    funnelOpportunities: {
      awareness: [{
        itemId: "FUN-A-01",
        concept: opportunity("Create the governed awareness concept."),
        userNeed: opportunity("Answer the governed awareness user need."),
        rationale: opportunity("Use the governed finding as the rationale."),
        businessObjective: opportunity("Support the governed business objective."),
        nextAction: opportunity("Move the reader to the governed next action."),
      }],
      consideration: [],
      decision: [],
    },
    seoSerp: standard("SEO and SERP", {
      whatWorks: interpret("SEO strength"),
      constraints: interpret("SEO constraint"),
      searchImplication: interpret("Search implication"),
      priority: interpret("SEO priority"),
    }),
    aiSearch: standard("AI search readiness", {
      answerability: interpret("AI answerability"),
      entityStrength: interpret("AI entity strength"),
      citationReadiness: interpret("AI citation readiness"),
      constraints: interpret("AI search constraint"),
      opportunity: opportunity("Use the governed finding to improve AI-search readiness."),
    }),
    eeatTrust: standard("E-E-A-T and trust", {
      experience: interpret("Experience signal"),
      expertise: interpret("Expertise signal"),
      authority: interpret("Authority signal"),
      trust: interpret("Trust signal"),
      proofGaps: interpret("Proof gap"),
      businessMeaning: interpret("Trust business meaning"),
    }),
    technical: standard("Technical foundations", {
      assessment: interpret("Technical assessment"),
      materialIssues: interpret("Technical issue"),
      businessMeaning: interpret("Technical business meaning"),
    }),
    performanceUx: standard("Performance and UX", {
      assessment: interpret("Performance assessment"),
      userImpact: interpret("Performance user impact"),
      conversionImpact: interpret("Performance conversion impact"),
    }),
    competitors: standard("Competitive position", {
      advantages: interpret("Competitive advantage"),
      disadvantages: interpret("Competitive disadvantage"),
      marketInterpretation: interpret("Competitive interpretation"),
      differentiatorToProtect: interpret("Differentiator to protect"),
    }),
    limitations: [{
      itemId: "LIM-01",
      area: "Off-site evidence",
      status: "UNAVAILABLE",
      clientExplanation: interpret("The limitation"),
      whatThisMeans: interpret("What the limitation means"),
      whatThisDoesNotMean: interpret("What the limitation does not mean"),
      impactOnReport: interpret("The limitation impact"),
    }],
    actionPlan: [{
      actionId: "ACT-01",
      priority: 1,
      title: "Correct the verified priority",
      action: opportunity("Correct the verified priority using the governed evidence."),
      whyNow: opportunity("Address it now because the governed evidence marks it as material."),
      expectedBusinessEffect: opportunity("Improve the governed conversion path without inventing a result."),
      effort: "M",
      verification: opportunity("Re-run the governed audit and verify the same evidence boundary."),
    }],
    executiveDecision: {
      preserve: interpret("Preserve decision"),
      change: interpret("Change decision"),
      doNext: opportunity("Do the governed priority next."),
    },
  };
}

function passingJudgeResponse(passNumber = 1) {
  const rubric = Object.fromEntries(Object.entries(RUBRIC).map(([key, maxScore]) => [key, {
    score: maxScore,
    maxScore,
    status: "PASS",
    rationale: `${key} passes the governed rubric.`,
    evidenceRefs: key === "nonRepetition" ? [] : [REF],
    defectIds: [],
  }]));
  return {
    contractVersion: JUDGE_CONTRACT_VERSION,
    auditId: AUDIT_ID,
    passNumber,
    judgeModelId: "judge-test",
    judgePromptVersion: "2.0.0",
    evaluatedAt: FIXED_TS,
    hardGate: { status: "PASS", violations: [] },
    rubric,
    totalScore: 100,
    decision: JUDGE_DECISION.PASS,
    defects: [],
    revisionDirective: {
      required: false,
      mode: "NONE",
      fieldsToRewrite: [],
      fieldsLocked: [],
      defectIds: [],
    },
  };
}

function deterministicModel() {
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
      pages: [{ title: "Home", headings: { h1: ["Home"], h2: [], h3: [], h4: [] }, responseHeaders: {} }],
      services: ["Advisory"],
      topicKeywords: ["advisory support"],
      ctas: [{ text: "Contact", url: "https://example.com/contact", kind: "link" }],
      externalCtas: [],
      forms: [{ action: "/submit" }],
      schemaTypes: ["Organization"],
      microdataTypes: [],
      socialLinks: [],
      trust: { testimonials: true, credentials: true, caseStudies: false, faq: false, pricing: false, policies: true, contact: true },
      securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: true },
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
    },
    performance: {
      sourceStatus: "AVAILABLE",
      provider: "pagespeed-insights",
      mobile: { status: "AVAILABLE", source: "psi", scores: { performance: 72 }, metrics: {} },
      desktop: { status: "AVAILABLE", source: "psi", scores: { performance: 91 }, metrics: {} },
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

async function releaseCandidate() {
  return runNarrativeV2Orchestration({
    writerInput: writerInput(),
    writerExecutor: async () => validWriterOutput(1),
    judgeExecutor: async () => passingJudgeResponse(1),
  });
}

test("NARRATIVE-RENDER-01: release candidate renders the complete client-facing Writer layer", async () => {
  const result = await releaseCandidate();
  assert.equal(result.status, NARRATIVE_V2_STATUS.RELEASE_CANDIDATE);

  const html = renderGovernedNarrativeReportV2({
    model: deterministicModel(),
    writerInput: writerInput(),
    orchestrationResult: result,
    date: "2026-08-20",
  });

  for (const required of [
    "Executive conclusion",
    "Verified strengths",
    "Root cause",
    "Conversion",
    "Content and topical architecture",
    "Funnel opportunities",
    "SEO and SERP",
    "AI search readiness",
    "E-E-A-T and trust",
    "Technical foundations",
    "Performance and UX",
    "Competitive position",
    "Limitations",
    "Action plan",
    "Preserve, change, do next",
  ]) {
    assert.ok(html.includes(required), `client narrative includes ${required}`);
  }
});

test("NARRATIVE-RENDER-02: existing deterministic Karen-style evidence/detail layer remains present", async () => {
  const html = renderGovernedNarrativeReportV2({
    model: deterministicModel(),
    writerInput: writerInput(),
    orchestrationResult: await releaseCandidate(),
  });

  for (const required of [
    "A. Conversion Readiness",
    "B. Evidence Confidence",
    "C. Evidence Coverage",
    "D. Where are the problems?",
    "E. What should be fixed first?",
    "Conversion path architecture",
    "Competitive context",
    "Topical Map &amp; Content Opportunities",
    "Internal-Link Opportunities",
    "Evidence detail",
    "Source statuses",
  ]) {
    assert.ok(html.includes(required), `deterministic detail remains present: ${required}`);
  }
});

test("NARRATIVE-RENDER-03: evidence lineage is audit metadata, not visible citation prose", async () => {
  const html = renderGovernedNarrativeReportV2({
    model: deterministicModel(),
    writerInput: writerInput(),
    orchestrationResult: await releaseCandidate(),
  });

  assert.match(html, /data-evidence-refs="finding:F-001"/);
  assert.doesNotMatch(html, />finding:F-001</);
  assert.match(html, /data-judge-score="100"/);
  assert.match(html, /data-writer-pass="1"/);
});

test("NARRATIVE-RENDER-04: non-release orchestration result fails closed", async () => {
  const result = await releaseCandidate();
  const invalid = { ...result, status: NARRATIVE_V2_STATUS.HUMAN_REVIEW_REQUIRED };

  assert.throws(() => renderGovernedNarrativeReportV2({
    model: deterministicModel(),
    writerInput: writerInput(),
    orchestrationResult: invalid,
  }), /must be RELEASE_CANDIDATE/);
});

test("NARRATIVE-RENDER-05: invalid WriterOutput is revalidated before any client HTML is returned", async () => {
  const result = await releaseCandidate();
  const invalidOutput = JSON.parse(JSON.stringify(result.finalWriterOutput));
  invalidOutput.executiveConclusion.narrative.evidenceRefs = ["finding:UNKNOWN"];
  const invalid = {
    ...result,
    finalWriterOutput: invalidOutput,
  };

  assert.throws(() => renderGovernedNarrativeReportV2({
    model: deterministicModel(),
    writerInput: writerInput(),
    orchestrationResult: invalid,
  }), /WriterOutput revalidation failed/);
});

test("NARRATIVE-RENDER-06: browser/PDF composition is deterministic and print-safe", async () => {
  const result = await releaseCandidate();
  const args = {
    model: deterministicModel(),
    writerInput: writerInput(),
    orchestrationResult: result,
    date: "2026-08-20",
  };
  const first = renderGovernedNarrativeReportV2(args);
  const second = renderGovernedNarrativeReportV2(args);
  assert.equal(first, second);
  assert.match(first, /@media print/);
  assert.match(first, /narrative-decision-grid/);
  assert.match(first, /href="#narrative-action-plan"/);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  WRITER_OUTPUT_VERSION,
  WRITER_PROMPT_VERSION,
  validateTargetedWriterRevision,
  validateWriterOutput,
} from "./writer-output.js";
import { buildWriterPrompt } from "./writer-prompt.js";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";

function writerInput() {
  return {
    contractVersion: "1.0.0",
    writerInputVersion: "1.0.0",
    auditId: AUDIT_ID,
    business: {
      businessName: "Example Business",
      targetUrl: "https://example.com/",
      primaryGoal: "generate qualified enquiries",
      market: "Canada",
      language: "en-CA",
    },
    score: {
      scores: {
        trustEeatDimension: 74,
        contentFunnelDimension: 77,
        conversionPathwaysDimension: 68,
        technicalPerformanceDimension: 66,
        entitySchemaAiDimension: 70,
      },
      rootCause: "Strong subject depth is not consistently carried into proof and conversion pathways.",
    },
    findings: [{ findingId: "F-001", title: "Canonical tag missing" }],
    capabilityContext: {
      capabilities: {
        "technical.indexability": {
          capability: "technical.indexability",
          status: "AVAILABLE",
          coverage: { requested: 10, completed: 10, failed: 0 },
          provenance: { source: "dataforseo-onpage" },
          limitations: [],
          requiredFieldsPresent: true,
        },
      },
    },
    scoreGovernance: {
      sourceDependencies: {
        website: "AVAILABLE",
        competitors: "PARTIAL",
        backlinks: "FAILED",
      },
    },
    deterministicAnalysis: {
      contentIdeas: {
        awareness: ["Guide topic"],
        consideration: ["Comparison topic"],
        decision: ["Proof topic"],
      },
    },
    referenceIndex: {
      "business:businessName": { kind: "business", path: "business.businessName" },
      "business:primaryGoal": { kind: "business", path: "business.primaryGoal" },
      "business:market": { kind: "business", path: "business.market" },
      "score:trustEeatDimension": { kind: "score", path: "score.scores.trustEeatDimension" },
      "score:contentFunnelDimension": { kind: "score", path: "score.scores.contentFunnelDimension" },
      "score:conversionPathwaysDimension": { kind: "score", path: "score.scores.conversionPathwaysDimension" },
      "score:technicalPerformanceDimension": { kind: "score", path: "score.scores.technicalPerformanceDimension" },
      "score:entitySchemaAiDimension": { kind: "score", path: "score.scores.entitySchemaAiDimension" },
      "score:rootCause": { kind: "score", path: "score.rootCause" },
      "finding:F-001": { kind: "finding", path: "findings.F-001" },
      "capability:technical.indexability": { kind: "capability", path: "capabilityContext.capabilities.technical.indexability" },
      "source:website": { kind: "source-status", path: "scoreGovernance.sourceDependencies.website" },
      "source:competitors": { kind: "source-status", path: "scoreGovernance.sourceDependencies.competitors" },
      "source:backlinks": { kind: "source-status", path: "scoreGovernance.sourceDependencies.backlinks" },
      "analysis:contentIdeas": { kind: "deterministic-analysis", path: "deterministicAnalysis.contentIdeas" },
    },
  };
}

function atom(text, evidenceRefs = ["finding:F-001"], statementClass = "INTERPRETATION") {
  return { text, statementClass, evidenceRefs };
}

function opportunity(text, evidenceRefs = ["analysis:contentIdeas"]) {
  return atom(text, evidenceRefs, "OPPORTUNITY");
}

function standardSection(headline, fields) {
  return { headline, ...fields };
}

function validOutput(passNumber = 1) {
  return {
    contractVersion: "1.0.0",
    writerOutputVersion: WRITER_OUTPUT_VERSION,
    auditId: AUDIT_ID,
    passNumber,
    modelId: "model-test",
    promptVersion: WRITER_PROMPT_VERSION,
    generatedAt: "2026-08-20T03:45:00.000Z",
    executiveConclusion: {
      headline: "Strong foundation, constrained conversion proof",
      narrative: atom("The site has useful subject depth, but the verified findings indicate that proof and conversion pathways are not carrying that strength consistently into the enquiry goal.", ["score:rootCause", "business:primaryGoal"]),
    },
    strengths: [{
      itemId: "STR-01",
      title: "Useful content foundation",
      narrative: atom("The content dimension provides a credible base to preserve while the weaker decision-stage pathway is corrected.", ["score:contentFunnelDimension", "score:conversionPathwaysDimension"]),
    }],
    rootCause: {
      headline: "Proof and conversion do not fully capitalize on existing depth",
      narrative: atom("The deterministic root-cause assessment points to a disconnect between subject depth and the proof and conversion pathways associated with the stated qualified-enquiry goal.", ["score:rootCause", "business:primaryGoal"]),
      businessConsequences: [{
        area: "Conversion",
        narrative: atom("Potential buyers may receive useful information without an equally strong path toward the stated enquiry goal.", ["score:conversionPathwaysDimension", "business:primaryGoal"]),
      }],
    },
    conversion: standardSection("Conversion", {
      whatWorks: atom("The site has enough assessed structure to support a conversion path rather than requiring a wholesale rebuild.", ["source:website", "score:conversionPathwaysDimension"]),
      constraints: atom("The conversion dimension remains weaker than the content dimension, so the report should focus on closing that gap.", ["score:conversionPathwaysDimension", "score:contentFunnelDimension"]),
      businessMeaning: atom("Improving the decision path should help more of the existing content support the enquiry objective.", ["business:primaryGoal", "score:conversionPathwaysDimension"]),
      priority: atom("Conversion work should preserve the useful content base and focus on the highest-confidence pathway findings.", ["finding:F-001", "score:contentFunnelDimension"]),
    }),
    content: standardSection("Content and topical architecture", {
      currentStrength: atom("Content is one of the stronger assessed dimensions and should be treated as an asset to preserve.", ["score:contentFunnelDimension"]),
      coverageAssessment: atom("The available deterministic content analysis supports further funnel interpretation without requiring generic topic invention.", ["analysis:contentIdeas"]),
      qualityAssessment: atom("The content score indicates a stronger base than the conversion pathway score, making alignment the main issue rather than wholesale replacement.", ["score:contentFunnelDimension", "score:conversionPathwaysDimension"]),
      topicalArchitecture: atom("The report should connect existing subject depth to distinct awareness, consideration and decision-stage needs.", ["analysis:contentIdeas"]),
      importantGaps: atom("Decision-stage proof is the most important content-related gap suggested by the deterministic analysis.", ["analysis:contentIdeas", "score:rootCause"]),
      businessMeaning: atom("Better funnel alignment can make existing content more useful to prospective buyers and the enquiry objective.", ["analysis:contentIdeas", "business:primaryGoal"]),
    }),
    funnelOpportunities: {
      awareness: [{
        itemId: "FUN-A-01",
        concept: opportunity("Create a practical guide around the verified awareness-stage topic opportunity."),
        userNeed: opportunity("Answer an early-stage problem before the buyer is comparing providers."),
        rationale: opportunity("The deterministic content-idea set identifies a distinct awareness opportunity that can extend the existing content base."),
        businessObjective: opportunity("Attract relevant prospective buyers earlier in their research."),
        nextAction: opportunity("Move interested readers toward a relevant consideration-stage resource."),
      }],
      consideration: [{
        itemId: "FUN-C-01",
        concept: opportunity("Create a comparison-oriented resource from the governed consideration-stage idea."),
        userNeed: opportunity("Help a buyer evaluate approaches before choosing a provider."),
        rationale: opportunity("The deterministic content analysis identifies a comparison-stage opportunity."),
        businessObjective: opportunity("Improve buyer confidence during active evaluation."),
        nextAction: opportunity("Move qualified readers toward proof and decision content."),
      }],
      decision: [{
        itemId: "FUN-D-01",
        concept: opportunity("Create proof-focused decision content from the governed decision-stage idea."),
        userNeed: opportunity("Give a buyer evidence that reduces uncertainty before making contact."),
        rationale: opportunity("The deterministic analysis identifies a proof-stage opportunity that aligns with the root-cause assessment."),
        businessObjective: opportunity("Support more qualified enquiries from buyers already close to a decision."),
        nextAction: opportunity("Direct qualified buyers into the primary enquiry path."),
      }],
    },
    seoSerp: standardSection("SEO and SERP", {
      whatWorks: atom("Website evidence is available, so the technical search findings can be interpreted from verified site evidence.", ["source:website"]),
      constraints: atom("The canonical finding is material enough to address without treating it as evidence of a broader unverified search failure.", ["finding:F-001"]),
      searchImplication: atom("The issue weakens a specific canonical signal; the report should not extrapolate beyond that verified finding.", ["finding:F-001"]),
      priority: atom("Correct the verified canonical issue and re-check it rather than adding unrelated technical work.", ["finding:F-001"]),
    }),
    aiSearch: standardSection("AI search readiness", {
      answerability: atom("The available content dimension provides a base for answer-oriented content, but the report should stay within measured evidence.", ["score:contentFunnelDimension"]),
      entityStrength: atom("Entity and schema readiness is assessed separately and should be interpreted from that exact dimension rather than inferred from content quality.", ["score:entitySchemaAiDimension"]),
      citationReadiness: atom("Citation readiness should be treated as directional unless specific supporting evidence is present in the governed packet.", ["score:entitySchemaAiDimension"]),
      constraints: atom("No broader AI-search visibility claim is warranted from the available packet alone.", ["score:entitySchemaAiDimension"]),
      opportunity: opportunity("Structure high-value content so important questions, entities and proof are easier to identify, while preserving the existing evidence boundary.", ["score:entitySchemaAiDimension", "score:contentFunnelDimension"]),
    }),
    eeatTrust: standardSection("E-E-A-T and trust", {
      experience: atom("The trust dimension can be interpreted only from the governed trust evidence and score, not from assumed credentials.", ["score:trustEeatDimension"]),
      expertise: atom("The report should distinguish useful subject depth from independently verified expertise signals.", ["score:trustEeatDimension", "score:contentFunnelDimension"]),
      authority: atom("Off-site authority cannot be inferred because the backlink source failed in this audit.", ["source:backlinks"]),
      trust: atom("The trust dimension is assessed, but off-site authority remains outside the verified evidence for this run.", ["score:trustEeatDimension", "source:backlinks"]),
      proofGaps: atom("The root-cause assessment indicates that proof should be strengthened where it supports the decision path.", ["score:rootCause"]),
      businessMeaning: atom("Clearer proof can reduce uncertainty for buyers without requiring the report to invent authority metrics.", ["score:rootCause", "business:primaryGoal"]),
    }),
    technical: standardSection("Technical foundations", {
      assessment: atom("The technical dimension is assessed and contains a verified canonical issue that can be corrected directly.", ["score:technicalPerformanceDimension", "finding:F-001"]),
      materialIssues: atom("The verified canonical finding is the material technical issue represented in this test packet.", ["finding:F-001"]),
      businessMeaning: atom("Fixing verified technical issues protects discoverability without distracting from the larger conversion constraint.", ["finding:F-001", "score:rootCause"]),
    }),
    performanceUx: standardSection("Performance and UX", {
      assessment: atom("Performance and UX conclusions should remain bounded to the deterministic score and available evidence.", ["score:technicalPerformanceDimension"]),
      userImpact: atom("The report should describe only user-impact conclusions supported by the assessed performance evidence.", ["score:technicalPerformanceDimension"]),
      conversionImpact: atom("Performance should be linked to conversion only where the evidence establishes that relationship for this audit.", ["score:technicalPerformanceDimension", "score:conversionPathwaysDimension"]),
    }),
    competitors: standardSection("Competitive position", {
      advantages: atom("Competitor evidence is partial, so only directly supported advantages should be presented.", ["source:competitors"]),
      disadvantages: atom("Partial competitor evidence does not establish a complete market disadvantage.", ["source:competitors"]),
      marketInterpretation: atom("The benchmark is useful directionally, but it is not a complete market ranking.", ["source:competitors", "business:market"]),
      differentiatorToProtect: atom("Any differentiator described in the report must remain tied to the governed site and competitor evidence.", ["source:competitors", "score:contentFunnelDimension"]),
    }),
    limitations: [{
      itemId: "LIM-01",
      area: "Backlinks",
      status: "FAILED",
      clientExplanation: atom("Off-site authority could not be assessed from the backlink source in this audit.", ["source:backlinks"]),
      whatThisMeans: atom("The report does not make a verified judgement about the site's backlink authority.", ["source:backlinks"]),
      whatThisDoesNotMean: atom("The failed source does not establish that the backlink profile itself is weak.", ["source:backlinks"]),
      impactOnReport: atom("The remaining conclusions continue to rely on the other governed evidence sources.", ["source:website", "source:backlinks"]),
    }],
    actionPlan: [{
      actionId: "ACT-01",
      priority: 1,
      title: "Strengthen the decision path around verified proof gaps",
      action: opportunity("Use the governed root cause and decision-stage content opportunity to strengthen the path toward a qualified enquiry.", ["score:rootCause", "analysis:contentIdeas"]),
      whyNow: opportunity("This directly addresses the gap between stronger content and weaker conversion pathways.", ["score:contentFunnelDimension", "score:conversionPathwaysDimension"]),
      expectedBusinessEffect: opportunity("A clearer proof and decision path should make existing content more effective at supporting the stated enquiry goal.", ["business:primaryGoal", "score:rootCause"]),
      effort: "M",
      verification: opportunity("Re-run the governed audit and verify the relevant deterministic conversion and content findings after the change.", ["score:conversionPathwaysDimension", "analysis:contentIdeas"]),
    }],
    executiveDecision: {
      preserve: atom("Preserve the useful content foundation rather than redesigning it without evidence.", ["score:contentFunnelDimension"]),
      change: atom("Correct the verified proof, conversion and canonical weaknesses that limit the existing foundation.", ["score:rootCause", "finding:F-001"]),
      doNext: opportunity("Strengthen the decision-stage path first, then verify the result against the same governed evidence contract.", ["score:rootCause", "business:primaryGoal"]),
    },
  };
}

test("WRITER-OUT-01: complete governed Writer output validates", () => {
  const result = validateWriterOutput(validOutput(), { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("WRITER-OUT-02: unknown evidence references and source-status mutations fail closed", () => {
  const unknownReference = validOutput();
  unknownReference.executiveConclusion.narrative.evidenceRefs = ["finding:DOES-NOT-EXIST"];
  const unknownResult = validateWriterOutput(unknownReference, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.equal(unknownResult.valid, false);
  assert.match(unknownResult.errors.join("\n"), /unknown Writer reference/);

  const mutatedStatus = validOutput();
  mutatedStatus.limitations[0].status = "AVAILABLE";
  const statusResult = validateWriterOutput(mutatedStatus, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.equal(statusResult.valid, false);
  assert.match(statusResult.errors.join("\n"), /status must equal governed status FAILED/);
});

test("WRITER-OUT-03: Writer cannot emit OBSERVED statements", () => {
  const output = validOutput();
  output.content.currentStrength.statementClass = "OBSERVED";
  const result = validateWriterOutput(output, { writerInput: writerInput() });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /INTERPRETATION or OPPORTUNITY/);
});

test("WRITER-OUT-04: generated URLs and markup fail closed", () => {
  const output = validOutput();
  output.technical.assessment.text = "See https://invented.example and <div>fix it</div>";
  const result = validateWriterOutput(output, { writerInput: writerInput() });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /contains HTML/);
  assert.match(result.errors.join("\n"), /contains a URL/);
});

test("PDV1-WRITER-OUT-01: explicit negated AI-search establishment is bounded without weakening fail-closed validation", () => {
  const bounded = validOutput();
  bounded.aiSearch.answerability = atom(
    "No material AI-search limitation was established from the assessed evidence.",
    ["score:contentFunnelDimension"],
  );
  const boundedResult = validateWriterOutput(bounded, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.deepEqual(boundedResult, { valid: true, errors: [] });

  const established = validOutput();
  established.aiSearch.answerability = atom(
    "AI-search answerability is limited by the available content.",
    ["score:contentFunnelDimension"],
  );
  const establishedResult = validateWriterOutput(established, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.equal(establishedResult.valid, false);
  assert.match(establishedResult.errors.join("\n"), /non-AI evidence into an established AI-search limitation/);
});

test("PDV5-WRITER-OUT-01: truthful PARTIAL negations preserve their scope", () => {
  const input = writerInput();
  input.capabilityContext.capabilities["technical.indexability"].status = "PARTIAL";
  input.referenceIndex["capability:technical.indexability"].path = "capabilityContext.capabilities.technical.indexability";

  const output = validOutput();
  output.aiSearch.citationReadiness = atom(
    "No direct citation-readiness condition was established from the supplied evidence.",
    ["capability:technical.indexability"],
  );
  output.limitations = [{
    itemId: "LIM-01",
    area: "content",
    status: "PARTIAL",
    clientExplanation: atom("The available assessment is partial.", ["capability:technical.indexability"]),
    whatThisMeans: atom("The evidence is limited to the assessed coverage.", ["capability:technical.indexability"]),
    whatThisDoesNotMean: atom("It does not mean buyer-question content is absent across the site.", ["capability:technical.indexability"]),
    impactOnReport: atom("Interpret this area within the available evidence.", ["capability:technical.indexability"]),
  }];
  const result = validateWriterOutput(output, { writerInput: input, expectedPassNumber: 1 });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("WRITER-OUT-05: funnel is bounded to at most three ideas per stage", () => {
  const output = validOutput();
  output.funnelOpportunities.awareness = [1, 2, 3, 4].map((n) => ({
    ...output.funnelOpportunities.awareness[0],
    itemId: `FUN-A-0${n}`,
  }));
  const result = validateWriterOutput(output, { writerInput: writerInput() });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /0 to 3 items/);
});

test("WRITER-OUT-06: targeted Pass 2 may change only defect-authorized section", () => {
  const previous = validOutput(1);
  const revised = structuredClone(previous);
  revised.passNumber = 2;
  revised.generatedAt = "2026-08-20T03:46:00.000Z";
  revised.content.importantGaps.text = "Decision-stage proof remains the primary content gap and should be strengthened before adding unrelated topics.";
  const directive = {
    required: true,
    mode: "TARGETED",
    fieldsToRewrite: ["content"],
    fieldsLocked: ["executiveConclusion", "strengths", "rootCause", "conversion"],
    defectIds: ["D-001"],
  };
  const result = validateWriterOutput(revised, {
    writerInput: writerInput(),
    expectedPassNumber: 2,
    previousOutput: previous,
    revisionDirective: directive,
  });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("WRITER-OUT-07: targeted revision rejects collateral report rewrites", () => {
  const previous = validOutput(1);
  const revised = structuredClone(previous);
  revised.passNumber = 2;
  revised.generatedAt = "2026-08-20T03:46:00.000Z";
  revised.content.importantGaps.text = "Decision-stage proof remains the main gap.";
  revised.executiveConclusion.headline = "A completely rewritten headline";
  const result = validateTargetedWriterRevision({
    previousOutput: previous,
    revisedOutput: revised,
    revisionDirective: {
      required: true,
      mode: "TARGETED",
      fieldsToRewrite: ["content"],
      fieldsLocked: ["executiveConclusion"],
      defectIds: ["D-001"],
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /Unauthorized Writer change.*executiveConclusion/);
});

test("WRITER-PROMPT-01: Pass 1 prompt freezes exact terminology and evidence authority", () => {
  const prompt = buildWriterPrompt({ writerInput: writerInput(), passNumber: 1 });
  assert.match(prompt, /exact canonical terminology/);
  assert.match(prompt, /WriterInput\.referenceIndex/);
  assert.match(prompt, /may not create new OBSERVED facts/);
  assert.match(prompt, /trustEeatDimension/);
  assert.match(prompt, /source:backlinks/);
  assert.doesNotMatch(prompt, /eeatScore/);
});

test("WRITER-PROMPT-02: revision prompt is surgical and contains exact Judge defects", () => {
  const previous = validOutput(1);
  const judgeResponse = {
    decision: "REVISE",
    defects: [{
      defectId: "D-001",
      criterion: "contentFunnelDepth",
      section: "content",
      severity: "MAJOR",
      problem: "Content gap explanation is too broad.",
      whyItMatters: "The client needs a specific decision-stage implication.",
      evidenceRefs: ["analysis:contentIdeas"],
      requiredCorrection: "Narrow importantGaps to the governed decision-stage idea.",
      allowedFields: ["content"],
      mustPreserve: ["executiveConclusion"],
    }],
    revisionDirective: {
      required: true,
      mode: "TARGETED",
      fieldsToRewrite: ["content"],
      fieldsLocked: ["executiveConclusion"],
      defectIds: ["D-001"],
    },
  };
  const prompt = buildWriterPrompt({ writerInput: writerInput(), passNumber: 2, previousOutput: previous, judgeResponse });
  assert.match(prompt, /surgical revision, not a fresh rewrite/);
  assert.match(prompt, /D-001/);
  assert.match(prompt, /Narrow importantGaps/);
  assert.match(prompt, /"content"/);
  assert.match(prompt, /PREVIOUS VALIDATED WRITER OUTPUT/);
});

test("WRITER-PROMPT-03: Pass 2 cannot run without governed Judge revision", () => {
  assert.throws(
    () => buildWriterPrompt({ writerInput: writerInput(), passNumber: 2, previousOutput: validOutput(1), judgeResponse: { decision: "PASS" } }),
    /requires a REVISE Judge decision/,
  );
});

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
    writerInputVersion: "1.2.0",
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

test("PDV5-WRITER-OUT-05: partial competitor evidence cannot become a confirmed differentiator", () => {
  const output = validOutput();
  output.competitors.differentiatorToProtect = atom(
    "The assessed comparison confirms a differentiator to protect.",
    ["source:competitors"],
  );
  const result = validateWriterOutput(output, { writerInput: writerInput() });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /established differentiator/);
});

test("PDV5-WRITER-OUT-06: confirmed conversion outcomes are rejected without direct measurement", () => {
  const output = validOutput();
  output.executiveDecision.doNext = opportunity(
    "The assessed route confirms conversions and enquiries.",
    ["score:conversionPathwaysDimension"],
  );
  const result = validateWriterOutput(output, { writerInput: writerInput() });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /unmeasured business outcome/);
});

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

test("PDV5-WRITER-OUT-03: AI-search support cannot be inferred from finding metadata", () => {
  const input = writerInput();
  input.findings[0].title = "AI-search visibility limitation";
  input.findings[0].description = "AI search citation evidence is weak";
  const output = validOutput();
  output.aiSearch.answerability = atom(
    "AI-search answerability is limited by the available content.",
    ["finding:F-001"],
  );
  const result = validateWriterOutput(output, { writerInput: input, expectedPassNumber: 1 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /non-AI evidence into an established AI-search limitation/);
});

test("PDV5-WRITER-OUT-04: bounded non-assessment language is accepted without AI evidence", () => {
  const output = validOutput();
  output.aiSearch.answerability = atom(
    "Direct-answer content readiness cannot be evaluated because page body content was not collected.",
    ["score:contentFunnelDimension"],
  );
  const result = validateWriterOutput(output, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.deepEqual(result, { valid: true, errors: [] });

  output.aiSearch.citationReadiness = atom(
    "The supplied evidence does not directly assess citation readiness sufficiently to establish a limitation.",
    ["score:contentFunnelDimension"],
  );
  const scopedResult = validateWriterOutput(output, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.deepEqual(scopedResult, { valid: true, errors: [] });

  output.aiSearch.answerability = atom(
    "Answerability was not directly assessed sufficiently to establish a limitation.",
    ["score:contentFunnelDimension"],
  );
  const directPassiveResult = validateWriterOutput(output, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.deepEqual(directPassiveResult, { valid: true, errors: [] });
});

test("PDV5-WRITER-PROMPT-01: citation readiness has an explicit direct-evidence boundary", () => {
  const prompt = buildWriterPrompt({ writerInput: writerInput(), passNumber: 1 });
  assert.match(prompt, /applies separately to every aiSearch field/);
  assert.match(prompt, /content score, content finding.*not direct support for citation readiness/);
  assert.match(prompt, /Citation readiness was not directly assessed sufficiently to establish a limitation/);
});

test("PDV5-WRITER-PROMPT-02: causal certainty has an atom-wide pre-emission rewrite guard", () => {
  const prompt = buildWriterPrompt({ writerInput: writerInput(), passNumber: 1 });
  assert.match(prompt, /scan EVERY atom/);
  assert.match(prompt, /business-outcome noun paired with causal\/certainty language/);
  assert.match(prompt, /conversion impact was not measured/);
  assert.match(prompt, /EVERY sentence in EVERY atom/);
  assert.match(prompt, /whole output is invalid/);
});

test("PDV5-WRITER-OUT-02: unmeasured commercial causality is rejected while bounded significance is accepted", () => {
  const unsupported = validOutput();
  unsupported.executiveConclusion.narrative = atom(
    "The missing proof will reduce conversions and cost sales.",
    ["finding:F-001"],
  );
  const unsupportedResult = validateWriterOutput(unsupported, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.equal(unsupportedResult.valid, false);
  assert.match(unsupportedResult.errors.join("\n"), /unmeasured business outcome with causal certainty/);

  const bounded = validOutput();
  bounded.executiveConclusion.narrative = atom(
    "The observed proof condition may create a conversion opportunity.",
    ["finding:F-001"],
  );
  const boundedResult = validateWriterOutput(bounded, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.deepEqual(boundedResult, { valid: true, errors: [] });
});

test("PDV5-WRITER-OUT-10: explicit non-establishment language is accepted without weakening causal rejection", () => {
  const accepted = [
    "Conversion, offer, trust, and completed enquiry-path evidence were not collected, so no overall conversion conclusion is established.",
    "No conversion outcome was established.",
    "The evidence does not establish a conversion outcome.",
    "Completed enquiry outcomes were not measured.",
    "No sales conclusion can be established from the available evidence.",
  ];
  const rejected = [
    "The missing proof will reduce conversions.",
    "This issue causes lost sales.",
    "The weak CTA decreases enquiries.",
    "This proves conversion performance is poor.",
    "The change increases conversions.",
    "The change increased conversions.",
    "The change will increase conversions.",
    "This increased sales.",
    "The update increased enquiries.",
    "Conversions were not measured, but the missing proof will reduce sales.",
    "No conversion outcome was measured, therefore the site is losing customers.",
  ];

  for (const text of accepted) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.deepEqual(result, { valid: true, errors: [] }, text);
  }

  for (const text of rejected) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.ok(result.errors.some((error) => /unmeasured business outcome with causal certainty/.test(error)), text);
  }
});

test("PRYSM-CAUSAL-01: ordinary causal morphology and outcome-certainty forms reject", () => {
  const unsupportedClaims = [
    "Changes cause conversions.",
    "The change causes conversions.",
    "The change caused conversions.",
    "The change has caused conversions.",
    "The change is causing conversions.",
    "Changes drive conversions.",
    "The change drives conversions.",
    "The change drove conversions.",
    "The change has driven conversions.",
    "The change is driving conversions.",
    "Changes result in conversions.",
    "The change results in conversions.",
    "The change resulted in conversions.",
    "The change has resulted in conversions.",
    "The change is resulting in conversions.",
    "Changes lead to conversions.",
    "The change leads to conversions.",
    "The change led to conversions.",
    "The change has led to conversions.",
    "The change is leading to conversions.",
    "Changes increase conversions.",
    "The change increases conversions.",
    "The change increased conversions.",
    "The change has increased conversions.",
    "The change is increasing conversions.",
    "Changes decrease conversions.",
    "The change decreases conversions.",
    "The change decreased conversions.",
    "The change has decreased conversions.",
    "The change is decreasing conversions.",
    "Changes reduce sales.",
    "The change reduces sales.",
    "The change reduced sales.",
    "The change has reduced sales.",
    "The change is reducing sales.",
    "Changes improve conversions.",
    "The change improves conversions.",
    "The change improved conversions.",
    "The change has improved conversions.",
    "The change is improving conversions.",
    "Changes hurt enquiries.",
    "The change hurts enquiries.",
    "The change hurt enquiries.",
    "The change has hurt enquiries.",
    "The change is hurting enquiries.",
    "Changes damage sales.",
    "The change damages sales.",
    "The change damaged sales.",
    "The change has damaged sales.",
    "The change is damaging sales.",
    "Changes lose customers.",
    "The change loses customers.",
    "The change lost customers.",
    "The change has lost customers.",
    "The change is losing customers.",
    "Changes cost customers.",
    "The change costs customers.",
    "The change cost customers.",
    "The change has cost customers.",
    "The change is costing customers.",
    "The findings establish a sales outcome.",
    "The finding establishes a sales outcome.",
    "The finding established a sales outcome.",
    "The finding has established a sales outcome.",
    "The finding is establishing a sales outcome.",
    "The findings prove conversion performance is poor.",
    "The finding proves conversion performance is poor.",
    "The finding proved conversion performance is poor.",
    "The finding has proven conversion performance is poor.",
    "The finding is proving conversion performance is poor.",
    "The findings show conversions are poor.",
    "The finding shows conversions are poor.",
    "The finding showed conversions are poor.",
    "The finding has shown conversions are poor.",
    "The finding is showing conversions are poor.",
    "The findings demonstrate poor sales performance.",
    "The finding demonstrates poor sales performance.",
    "The finding demonstrated poor sales performance.",
    "The finding has demonstrated poor sales performance.",
    "The finding is demonstrating poor sales performance.",
  ];

  for (const text of unsupportedClaims) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.equal(result.valid, false, text);
    assert.match(result.errors.join("\n"), /unmeasured business outcome with causal certainty/, text);
  }
});

test("PRYSM-CAUSAL-02: clauses, punctuation, bounded language, and denial language cannot launder certainty", () => {
  const accepted = [
    "Conversion, offer, trust, and completed enquiry-path evidence were not collected, so no overall conversion conclusion is established.",
    "No conversion outcome was established.",
    "The evidence does not establish a conversion outcome.",
    "Completed enquiry outcomes were not measured.",
    "No sales conclusion can be established from the available evidence.",
  ];
  const unsupportedMixedClaims = [
    "Conversion evidence was not collected, but the change improved conversions.",
    "Conversion evidence was not collected; the change drove more leads.",
    "No overall conversion conclusion is established. The change is causing conversions.",
    "Conversion evidence was not collected: the change resulted in more sales.",
    "No conversion conclusion is established — the change reduced enquiries.",
    "Conversion evidence was not collected (the change is losing customers).",
    "Conversion evidence was not collected\nthe change damaged sales.",
    "No conversion conclusion is established, yet the change is increasing conversions.",
    "Conversion evidence was not collected while the change is reducing sales.",
    "Conversion evidence was not collected although the change is improving conversions.",
    "The change will increase conversions, and the evidence may be incomplete.",
    "The change will increase conversions; the evidence may be incomplete.",
    "The change will increase conversions although the evidence may be incomplete.",
    "The change will increase conversions (the evidence may be incomplete).",
    "The change will increase conversions, while the evidence may be incomplete.",
    "Conversion evidence was not collected, and the change will increase conversions.",
    "Conversion evidence was not collected, the change established a sales outcome.",
    "The change will increase conversions, the evidence may be incomplete.",
    "Conversion evidence was not collected, and the change confirms conversions.",
    "No conversion outcome was established, and the change established a sales outcome.",
    "Conversion, offer, trust, and completed enquiry-path evidence were not collected, and the change established a sales outcome.",
    "Conversion, offer, trust, and completed enquiry-path evidence were not collected, and the change is causing conversions.",
  ];

  for (const text of accepted) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.deepEqual(result, { valid: true, errors: [] }, text);
  }

  for (const text of unsupportedMixedClaims) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.equal(result.valid, false, text);
    assert.match(result.errors.join("\n"), /unmeasured business outcome with causal certainty/, text);
  }
});

test("PRYSM-CAUSAL-03: bounded comma clauses cannot launder ordinary causal morphology", () => {
  const causalFamilies = [
    ["cause", ["conversions cause sales", "redesign causes sales", "redesign caused sales", "redesign has caused sales", "redesign is causing sales"]],
    ["drive", ["conversions drive sales", "redesign drives sales", "redesign drove sales", "redesign has driven sales", "redesign is driving sales"]],
    ["result in", ["conversions result in sales", "redesign results in sales", "redesign resulted in sales", "redesign has resulted in sales", "redesign is resulting in sales"]],
    ["lead to", ["conversions lead to sales", "redesign leads to sales", "redesign led to sales", "redesign has led to sales", "redesign is leading to sales"]],
    ["increase", ["conversions increase sales", "redesign increases sales", "redesign increased sales", "redesign has increased sales", "redesign is increasing sales"]],
    ["decrease", ["conversions decrease sales", "redesign decreases sales", "redesign decreased sales", "redesign has decreased sales", "redesign is decreasing sales"]],
    ["reduce", ["conversions reduce sales", "redesign reduces sales", "redesign reduced sales", "redesign has reduced sales", "redesign is reducing sales"]],
    ["improve", ["conversions improve sales", "redesign improves sales", "redesign improved sales", "redesign has improved sales", "redesign is improving sales"]],
    ["hurt", ["conversions hurt customers", "redesign hurts customers", "redesign hurt customers", "redesign has hurt customers", "redesign is hurting customers"]],
    ["damage", ["conversions damage revenue", "redesign damages revenue", "redesign damaged revenue", "redesign has damaged revenue", "redesign is damaging revenue"]],
    ["lose", ["conversions lose customers", "redesign loses customers", "redesign lost customers", "redesign has lost customers", "redesign is losing customers"]],
    ["cost", ["conversions cost customers", "redesign costs customers", "redesign cost customers", "redesign has cost customers", "redesign is costing customers"]],
  ];
  const establishedFamilies = [
    ["establish", ["findings establish a sales outcome", "finding establishes a sales outcome", "finding established a sales outcome", "finding has established a sales outcome", "finding is establishing a sales outcome"]],
    ["prove", ["findings prove conversion performance is poor", "finding proves conversion performance is poor", "finding proved conversion performance is poor", "finding has proven conversion performance is poor", "finding is proving conversion performance is poor"]],
    ["show", ["findings show conversions are poor", "finding shows conversions are poor", "finding showed conversions are poor", "finding has shown conversions are poor", "finding is showing conversions are poor"]],
    ["demonstrate", ["findings demonstrate poor sales performance", "finding demonstrates poor sales performance", "finding demonstrated poor sales performance", "finding has demonstrated poor sales performance", "finding is demonstrating poor sales performance"]],
  ];
  const claims = [];
  for (const [, forms] of [...causalFamilies, ...establishedFamilies]) {
    for (const form of forms) {
      claims.push(`The evidence may be incomplete, ${form}.`);
      claims.push(`The evidence may be incomplete, and ${form}.`);
    }
  }

  assert.equal(claims.length, 160);
  for (const text of claims) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.equal(result.valid, false, text);
    assert.match(result.errors.join("\n"), /unmeasured business outcome with causal certainty/, text);
  }
});

test("PRYSM-CAUSAL-04: varied clause subjects and bounded prefixes cannot launder certainty", () => {
  const subjects = [
    "conversions", "sales", "leads", "enquiries", "revenue", "customers", "traffic", "engagement",
    "page", "website", "redesign", "CTA", "form", "navigation", "content", "template",
    "change", "finding", "findings", "evidence", "pattern", "issue", "result", "structure",
  ];
  const prefixes = [
    "The evidence may be incomplete",
    "The evidence might be incomplete",
    "The evidence could be incomplete",
    "A possible limitation remains",
    "The outcome is likely unmeasured",
    "The issue carries a risk",
    "The evidence suggests a limitation",
    "The evidence indicates a limitation",
    "The outcome was not measured",
    "The available evidence did not measure the outcome",
  ];
  const separators = [", ", ", and ", ", but ", ", yet ", ", while ", "; ", ". ", ": ", " — ", " (", "\n"];
  const claims = [];
  for (let index = 0; index < subjects.length; index += 1) {
    const subject = subjects[index];
    const prefix = prefixes[index % prefixes.length];
    const separator = separators[index % separators.length];
    const suffix = separator === " (" ? ")" : "";
    claims.push(`${prefix}${separator}${subject} increased sales${suffix}.`);
  }

  assert.equal(claims.length, 24);
  for (const text of claims) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.equal(result.valid, false, text);
    assert.match(result.errors.join("\n"), /unmeasured business outcome with causal certainty/, text);
  }
});

test("PRYSM-CAUSAL-05: predicate groups preserve shared qualifier scope without laundering independent claims", () => {
  const accepted = [
    "The change may increase conversions and reduce sales.",
    "The change might improve conversions and drive leads.",
    "The change could increase sales and decrease enquiries.",
    "The redesign may cause hesitation and reduce conversions.",
    "The evidence may suggest improved engagement and increased traffic.",
    "A possible risk may damage revenue and hurt customers.",
    "The change may improve conversions, reduce abandonment, and increase engagement.",
    "The redesign might reduce sales and has the potential to improve leads.",
    "The page could increase traffic and might improve engagement.",
    "The website is likely to improve conversions and may reduce abandonment.",
    "The form may lead to enquiries and result in more qualified leads.",
    "The navigation could reduce bounce rate and improve engagement.",
    "The content may show stronger relevance and demonstrate clearer structure.",
    "The template might establish a clearer path and prove useful to visitors.",
    "The change may increase conversions and can reduce abandonment.",
    "The redesign could drive leads, reduce friction, and improve enquiries.",
    "A potential opportunity may increase sales and improve pipeline quality.",
    "The issue likely indicates a risk and suggests a need for further assessment.",
    "The page may hurt abandonment and damage conversion confidence.",
    "The change could lose fewer customers and cost less revenue.",
  ];
  const rejected = [
    "The evidence may be incomplete, and the redesign increased sales.",
    "The redesign might improve conversions, but navigation reduced enquiries.",
    "No conversion conclusion is established, and the redesign increased sales.",
    "The redesign increased conversions (although evidence may be incomplete).",
    "The evidence may be incomplete. The redesign increased sales.",
    "The change increases conversions and may reduce abandonment.",
    "The change may increase conversions, and the redesign reduced sales.",
    "The change increases conversions and may reduce abandonment.",
    "The change may increase conversions; navigation reduced enquiries.",
    "The change may increase conversions: the page reduced abandonment.",
    "The change may increase conversions — the form caused abandonment.",
    "The change may increase conversions\nthe website reduced sales.",
    "The change may increase conversions and the evidence confirms sales.",
    "Conversion, offer, trust, and completed enquiry-path evidence were not collected, so no overall conversion conclusion is established, and the redesign increased sales.",
  ];

  for (const text of accepted) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.deepEqual(result, { valid: true, errors: [] }, text);
  }

  for (const text of rejected) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.equal(result.valid, false, text);
    assert.match(result.errors.join("\n"), /unmeasured business outcome with causal certainty/, text);
  }
});

test("PRYSM-CAUSAL-06: parenthetical predicate continuations preserve qualifier scope locally", () => {
  const accepted = [
    "The redesign may increase conversions (and reduce abandonment).",
    "The redesign might improve conversions (and drive leads).",
    "The change could increase sales (and decrease enquiries).",
    "The redesign may cause hesitation (and reduce conversions).",
    "The evidence may suggest improved engagement (and increased traffic).",
    "A possible risk may damage revenue (and hurt customers).",
    "The redesign may increase conversions (and navigation may reduce enquiries).",
    "The redesign could reduce sales (and the navigation might improve engagement).",
    "The page can increase traffic (and may improve conversions).",
    "The website is likely to improve conversions (and can reduce abandonment).",
    "The findings may establish a sales outcome (and demonstrate conversions).",
    "The evidence could show stronger engagement (and prove clearer relevance).",
    "The CTA may drive leads (and result in more enquiries).",
    "The form might reduce hesitation (and improve conversions).",
    "The content may increase engagement (and decrease bounce rate).",
    "The redesign may increase conversions (although evidence may be incomplete).",
    "Conversion, offer, trust, and completed enquiry-path evidence were not collected, so no overall conversion conclusion is established.",
  ];
  const rejected = [
    "The redesign may increase conversions (and navigation reduced enquiries).",
    "The redesign increased conversions (although evidence may be incomplete).",
    "The evidence may be incomplete (the redesign increased sales).",
    "Conversion, offer, trust, and completed enquiry-path evidence were not collected (and the redesign increased sales).",
    "No conversion conclusion is established (but the redesign improved conversions).",
    "The evidence does not establish impact (the page reduced enquiries).",
    "The redesign may increase conversions (and the findings established a sales outcome).",
    "The change may improve engagement (and navigation demonstrated poor sales performance).",
    "The evidence may be incomplete (the CTA is causing conversions).",
    "The redesign may increase conversions (and the form lost customers).",
    "The change may increase conversions (and the evidence confirms sales).",
    "The redesign may increase conversions (and the page has reduced enquiries).",
    "The redesign may increase conversions (and the website is showing conversions are poor).",
  ];

  for (const text of accepted) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.deepEqual(result, { valid: true, errors: [] }, text);
  }

  for (const text of rejected) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.equal(result.valid, false, text);
    assert.match(result.errors.join("\n"), /unmeasured business outcome with causal certainty/, text);
  }
});

test("PRYSM-CAUSAL-07: parenthetical scope remains bidirectional across fresh claim groups", () => {
  const accepted = [
    "The change may increase conversions (and reduce sales).",
    "The redesign might drive leads (and improve enquiries).",
    "The page could increase traffic (and reduce abandonment).",
    "The CTA can improve conversions (and decrease bounce rate).",
    "The form may cause hesitation (and hurt conversions).",
    "The navigation is likely to improve engagement (and may reduce abandonment).",
    "The content may lead to enquiries (and result in qualified leads).",
    "The findings may establish a sales outcome (and show conversions).",
    "The evidence could demonstrate engagement (and confirm traffic).",
    "A possible risk may damage revenue (and reduce sales).",
    "The redesign may increase conversions (and the navigation may reduce enquiries).",
    "The page might improve engagement (and the form could increase leads).",
    "The change can reduce abandonment (and the CTA may improve conversions).",
    "The website may show stronger relevance (and the content might demonstrate clearer structure).",
    "The findings could prove a clearer path (and establish a sales outcome).",
  ];
  const explicitSubjects = [
    "The evidence may be incomplete (the redesign increased sales).",
    "The change might improve conversions (navigation reduced enquiries).",
    "The page could increase traffic (the form caused sales).",
    "The CTA may drive leads (the website lost customers).",
    "The content can improve engagement (the template damaged revenue).",
    "The findings may establish a sales outcome (the redesign demonstrated conversions).",
    "The evidence might show relevance (the page proved sales performance).",
    "The redesign may reduce abandonment (the checkout increased conversions).",
    "The form could improve enquiries (the navigation led to lost sales).",
    "The change is likely to increase conversions (the offer decreased leads).",
    "The evidence may be incomplete, and the redesign increased sales (the page reduced enquiries).",
    "The content could improve engagement (the CTA is causing conversions).",
    "The findings may demonstrate a sales outcome (the form has lost customers).",
    "The page might increase traffic (the website is reducing conversions).",
    "The redesign may improve conversions (the navigation has established a sales outcome).",
  ];
  const locallyBounded = [
    "The evidence may be incomplete (the redesign may increase sales).",
    "The change might improve conversions (navigation could reduce enquiries).",
    "The page could increase traffic (the form may cause hesitation).",
    "The CTA may drive leads (the website might improve conversions).",
    "The content can improve engagement (the template is likely to reduce abandonment).",
    "The findings may establish a sales outcome (the redesign could demonstrate conversions).",
    "The evidence might show relevance (the page may prove clearer structure).",
    "The redesign may reduce abandonment (the checkout can increase conversions).",
    "The form could improve enquiries (the navigation may lead to qualified leads).",
    "The change is likely to increase conversions (the offer might decrease leads).",
  ];
  const laterQualifier = [
    "The redesign increased conversions (although evidence may be incomplete).",
    "The page reduced enquiries (although the evidence might be partial).",
    "The CTA caused conversions (although the outcome could be unmeasured).",
    "The form drove leads (although the evidence may be incomplete).",
    "The navigation improved conversions (although results might be uncertain).",
    "The content established a sales outcome (although evidence may be incomplete).",
    "The findings demonstrated poor sales performance (although the evidence could be partial).",
    "The website lost customers (although the outcome may be unmeasured).",
    "The redesign decreased engagement (although the evidence might be incomplete).",
    "The change resulted in lost sales (although evidence may be incomplete).",
  ];
  const localScope = [
    "Conversion, offer, trust, and completed enquiry-path evidence were not collected, so no overall conversion conclusion is established.",
    "Conversion, offer, trust, and completed enquiry-path evidence were not collected (and the redesign increased sales).",
    "No conversion conclusion is established (but the redesign improved conversions).",
    "The evidence does not establish impact (the page reduced enquiries).",
    "Completed enquiry outcomes were not measured (the CTA increased conversions).",
    "No sales conclusion can be established from the available evidence (the form drove leads).",
    "The evidence may be incomplete (the redesign may increase conversions).",
    "No conversion outcome was established (although the page might improve enquiries).",
    "The evidence was not collected (and navigation reduced sales).",
    "The evidence does not establish a conversion outcome (the redesign demonstrated conversions).",
  ];

  for (const text of accepted.concat(locallyBounded, localScope.slice(6, 8))) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.deepEqual(result, { valid: true, errors: [] }, text);
  }

  for (const text of explicitSubjects.concat(laterQualifier, localScope.slice(1, 6), localScope.slice(8))) {
    const result = validateWriterOutput(
      { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(text) } },
      { writerInput: writerInput(), expectedPassNumber: 1 },
    );
    assert.equal(result.valid, false, text);
    assert.match(result.errors.join("\n"), /unmeasured business outcome with causal certainty/, text);
  }

  const reboot = validateWriterOutput(
    { ...validOutput(), executiveConclusion: { ...validOutput().executiveConclusion, narrative: atom(localScope[0]) } },
    { writerInput: writerInput(), expectedPassNumber: 1 },
  );
  assert.deepEqual(reboot, { valid: true, errors: [] });
});

test("PDV5-WRITER-OUT-03: bounded language in another sentence cannot launder causal certainty", () => {
  const unsupported = validOutput();
  unsupported.executiveConclusion.narrative = atom(
    "The missing proof will reduce conversions. This may create hesitation.",
    ["finding:F-001"],
    "INTERPRETATION",
  );
  const result = validateWriterOutput(unsupported, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.ok(result.errors.some((error) => /unmeasured business outcome with causal certainty/.test(error)));
});

test("PDV5-WRITER-OUT-04: causal certainty is rejected in opportunity atoms too", () => {
  const unsupported = validOutput();
  unsupported.funnelOpportunities.awareness[0] = atom(
    "This change will increase leads.",
    ["finding:F-001"],
    "OPPORTUNITY",
  );
  const result = validateWriterOutput(unsupported, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.ok(result.errors.some((error) => /unmeasured business outcome with causal certainty/.test(error)));
});

test("PDV5-WRITER-OUT-07: observed conversion actions are not misclassified as commercial outcomes", () => {
  const output = validOutput();
  output.conversion.whatWorks = atom(
    "The conversion assessment confirmed a visible, interactable and unobstructed action on the assessed pages.",
    ["finding:F-001"],
  );
  const result = validateWriterOutput(output, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("PDV5-WRITER-OUT-08: established assessed conversion paths are not commercial outcome claims", () => {
  const output = validOutput();
  output.conversion.constraints = atom(
    "The available conversion-path assessment established a clear route; it did not measure completed enquiries or downstream outcomes.",
    ["finding:F-001"],
  );
  const result = validateWriterOutput(output, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("PDV5-WRITER-OUT-08A: conversion assessment observations are not commercial outcome claims", () => {
  const output = validOutput();
  output.conversion.whatWorks = atom(
    "The conversion assessment confirmed a visible, interactable and unobstructed action on the assessed pages.",
    ["finding:F-001"],
  );
  const result = validateWriterOutput(output, { writerInput: writerInput(), expectedPassNumber: 1 });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("PDV5-WRITER-OUT-09: conversion-action terms cannot support asserted commercial outcomes", () => {
  const unsupportedClaims = [
    "The conversion form confirmed revenue.",
    "The conversion action established increased traffic.",
    "The CTA shows sales.",
    "The assessed route confirms conversions.",
  ];

  for (const text of unsupportedClaims) {
    const output = validOutput();
    output.conversion.whatWorks = atom(text, ["finding:F-001"]);
    const result = validateWriterOutput(output, { writerInput: writerInput(), expectedPassNumber: 1 });
    assert.equal(result.valid, false, text);
    assert.match(result.errors.join("\n"), /unmeasured business outcome with causal certainty/, text);
  }
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
  assert.match(prompt, /will, should, cause/);
  assert.doesNotMatch(prompt, /eeatScore/);
});

test("WRITER-PROMPT-04: business impact basis and outcome status govern Writer authority", () => {
  const prompt = buildWriterPrompt({ writerInput: writerInput(), passNumber: 1 });
  assert.match(prompt, /businessImpactContext/);
  assert.match(prompt, /basis/);
  assert.match(prompt, /commercialOutcomeAuthority/);
  assert.match(prompt, /conditionBasis/);
  assert.match(prompt, /INFERRED/);
  assert.match(prompt, /OBSERVED/);
  assert.match(prompt, /raw source businessImpact/i);
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

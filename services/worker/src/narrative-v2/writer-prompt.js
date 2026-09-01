// PRYSM Narrative v2 — fixed, versioned Writer prompt builder.
//
// The model receives only WriterInput plus, on revision passes, the prior
// validated WriterOutput and the governed Judge defect/revision directive.
// It never receives raw provider payloads and is never asked to decide scores,
// evidence status, or observed facts.

import { WRITER_PROMPT_VERSION, WRITER_OUTPUT_VERSION } from "./writer-output.js";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

function assertPassInputs({ writerInput, passNumber, previousOutput, judgeResponse }) {
  if (!isObject(writerInput)) throw new Error("writerInput is required");
  if (!Number.isInteger(passNumber) || passNumber < 1 || passNumber > 3) {
    throw new Error("passNumber must be 1, 2, or 3");
  }
  if (passNumber === 1) {
    if (previousOutput !== undefined || judgeResponse !== undefined) {
      throw new Error("Pass 1 must not receive previousOutput or judgeResponse");
    }
    return;
  }
  if (!isObject(previousOutput)) throw new Error(`Pass ${passNumber} requires previousOutput`);
  if (!isObject(judgeResponse)) throw new Error(`Pass ${passNumber} requires judgeResponse`);
  if (judgeResponse.decision !== "REVISE") throw new Error(`Pass ${passNumber} requires a REVISE Judge decision`);
  if (judgeResponse.revisionDirective?.required !== true || judgeResponse.revisionDirective?.mode !== "TARGETED") {
    throw new Error(`Pass ${passNumber} requires a TARGETED revision directive`);
  }
}

const OUTPUT_SHAPE = `{
  "contractVersion": "1.0.0",
  "writerOutputVersion": "${WRITER_OUTPUT_VERSION}",
  "auditId": "<same as WriterInput.auditId>",
  "passNumber": <1|2|3>,
  "modelId": "<actual model id>",
  "promptVersion": "${WRITER_PROMPT_VERSION}",
  "generatedAt": "<ISO-8601>",
  "executiveConclusion": { "headline": "...", "narrative": <atom> },
  "strengths": [{ "itemId": "STR-01", "title": "...", "narrative": <atom> }],
  "rootCause": { "headline": "...", "narrative": <atom>, "businessConsequences": [{ "area": "...", "narrative": <atom> }] },
  "conversion": { "headline": "...", "whatWorks": <atom>, "constraints": <atom>, "businessMeaning": <atom>, "priority": <atom> },
  "content": { "headline": "...", "currentStrength": <atom>, "coverageAssessment": <atom>, "qualityAssessment": <atom>, "topicalArchitecture": <atom>, "importantGaps": <atom>, "businessMeaning": <atom> },
  "funnelOpportunities": {
    "awareness": [<opportunity item, max 3>],
    "consideration": [<opportunity item, max 3>],
    "decision": [<opportunity item, max 3>]
  },
  "seoSerp": { "headline": "...", "whatWorks": <atom>, "constraints": <atom>, "searchImplication": <atom>, "priority": <atom> },
  "aiSearch": { "headline": "...", "answerability": <atom>, "entityStrength": <atom>, "citationReadiness": <atom>, "constraints": <atom>, "opportunity": <opportunity atom> },
  "eeatTrust": { "headline": "...", "experience": <atom>, "expertise": <atom>, "authority": <atom>, "trust": <atom>, "proofGaps": <atom>, "businessMeaning": <atom> },
  "technical": { "headline": "...", "assessment": <atom>, "materialIssues": <atom>, "businessMeaning": <atom> },
  "performanceUx": { "headline": "...", "assessment": <atom>, "userImpact": <atom>, "conversionImpact": <atom> },
  "competitors": { "headline": "...", "advantages": <atom>, "disadvantages": <atom>, "marketInterpretation": <atom>, "differentiatorToProtect": <atom> },
  "limitations": [{ "itemId": "LIM-01", "area": "...", "status": "<exact source/capability status>", "clientExplanation": <atom>, "whatThisMeans": <atom>, "whatThisDoesNotMean": <atom>, "impactOnReport": <atom> }],
  "actionPlan": [{ "actionId": "ACT-01", "priority": 1, "title": "...", "action": <opportunity atom>, "whyNow": <opportunity atom>, "expectedBusinessEffect": <opportunity atom>, "effort": "L|M|H", "verification": <opportunity atom> }],
  "executiveDecision": { "preserve": <atom>, "change": <atom>, "doNext": <opportunity atom> }
}

<atom> = { "text": "...", "statementClass": "INTERPRETATION", "evidenceRefs": ["<exact WriterInput.referenceIndex id>"] }
<opportunity atom> = { "text": "...", "statementClass": "OPPORTUNITY", "evidenceRefs": ["<exact WriterInput.referenceIndex id>"] }
<opportunity item> = {
  "itemId": "FUN-A-01",
  "concept": <opportunity atom>,
  "userNeed": <opportunity atom>,
  "rationale": <opportunity atom>,
  "businessObjective": <opportunity atom>,
  "nextAction": <opportunity atom>
}`;

function commonRules() {
  return [
    "AUTHORITATIVE RULES:",
    "1. WriterInput is the complete and only evidence/context authority for this generation.",
    "2. Use exact canonical terminology and exact reference IDs from WriterInput.referenceIndex. Never guess aliases or substitute similar field names.",
    "3. You may create INTERPRETATION and OPPORTUNITY prose only. You may not create new OBSERVED facts.",
    "4. Do not invent, alter, round, restate from memory, or infer any score, metric, URL, source status, capability status, competitor result, finding, or business-context value.",
    "5. AVAILABLE/PARTIAL/FAILED/UNAVAILABLE/NOT_CONNECTED/NOT_APPLICABLE are materially different. UNKNOWN, UNAVAILABLE, PARTIAL, or not-deeply-parsed evidence must never become ABSENT, MISSING, GAP, LACK, LIMITATION, FALSE, ZERO, or fully assessed. For PARTIAL content evidence, do not describe the condition as a gap, lack, missing item, absence, or established current limitation. State only that it was not detected in the available partial assessment, preserve the partial-coverage qualification, and frame any improvement as an opportunity.",
    "6. Do not convert a content-detection gap into an AI-search limitation unless WriterInput directly assesses and supports that AI-search condition. When direct AI-search evidence is absent or partial, frame direct-answer content as an opportunity rather than an established current limitation. This applies separately to every aiSearch field: answerability, entityStrength, citationReadiness, and constraints. A content score, content finding, or generic technical/indexability reference is not direct support for citation readiness; for citationReadiness use score:entitySchemaAiDimension or an explicitly AI/schema/entity/citation capability or deterministic-analysis reference when present, otherwise use neutral assessment language (for example, 'Citation readiness was not directly assessed sufficiently to establish a limitation.') with the supplied evidence reference. When the cited reference is not a direct AI-search reference, do not use 'limited', 'weak', 'poor', 'missing', 'absent', 'insufficient', 'not ready', or 'cannot' to describe any aiSearch field; use 'was not directly assessed sufficiently to establish a limitation' or an opportunity statement instead.",
    "7. Every substantive narrative atom must cite one or more exact IDs that exist in WriterInput.referenceIndex.",
    "8. If the evidence is insufficient for a strong conclusion, narrow the conclusion and explain the limitation. Do not fill the gap. Required fields do not require a negative finding. For content.importantGaps, conversion.constraints, seoSerp.constraints, aiSearch.constraints, eeatTrust.proofGaps, and competitors.disadvantages, when the governed evidence does not establish a material negative condition, keep the required field present but use a neutral evidence-bounded INTERPRETATION such as 'No material gap was established from the assessed evidence' or 'This condition was not assessed sufficiently to establish a limitation.' Never invent a gap, constraint, proof weakness, or competitive disadvantage merely because the output field is required.",
    "8b. Strengths must be evidence-backed. Do not praise the site generically.",
    "8c. Never state an unmeasured commercial or business outcome as an established fact. Before returning JSON, scan EVERY atom and inspect EVERY sentence in EVERY atom (including executiveConclusion, rootCause.businessConsequences, conversion.businessMeaning, actionPlan, and executiveDecision) independently. If one sentence contains a business-outcome noun paired with causal/certainty language, the whole output is invalid even when another sentence in the same atom is bounded and even when the cited evidence is real. Do not say that an evidence condition will, should, cause, drive, result in, increase, decrease, reduce, improve, hurt, damage, cost, or lose revenue, sales, leads, enquiries, conversions, traffic, rankings, engagement, abandonment, bounce rate, customers, or pipeline. Rewrite that sentence before returning JSON so it names only the observed condition and bounded significance: use may, might, could, risk, potential, opportunity, or suggests, or explicitly state that the outcome was not measured. For example, replace 'the missing proof will reduce conversions' with 'the available evidence shows a proof condition that may create hesitation; conversion impact was not measured.' Do not rely on a citation to make an unmeasured outcome causal. This rule applies to pass 1 and every revision pass.",
    "9. Funnel opportunities must be specific to the supplied business goal, content evidence, findings, and competitor evidence. Do not use generic 'write more blogs' advice.",
    "10. Produce at most three awareness, three consideration, and three decision opportunities. Produce fewer when the evidence cannot support three distinct ideas.",
    "11. Action plan, root cause, executive conclusion, and executive decision must follow Conversion-First v4.2. Use WriterInput.deterministicAnalysis.conversionInfluence as the governed action authority. For actionPlan, select no more than the first five applicable findings from conversionInfluence.orderedFindingIds and preserve their relative order exactly; do not promote, demote, or reorder them. For every selected finding, actionPlan.priority MUST equal conversionInfluence.byFindingId[findingId].rank and actionPlan.effort MUST exactly equal conversionInfluence.byFindingId[findingId].effort. Do not infer or independently choose effort. Proven foundation blockers override everything else. Otherwise rank business influence in this exact order: (1) direct conversion-path blocker, (2) major trust/proof weakness affecting action, (3) major offer/audience clarity weakness, (4) material UX/performance friction, (5) buyer-question/content decision gap, (6) material acquisition/search constraint, (7) supporting technical hygiene, (8) low-value or specialist technical optimization. Numeric finalPriority orders findings only within a comparable business-impact class; it must never promote technical hygiene above a stronger conversion-leading class by itself. Technical issues may lead only when the supplied governed evidence establishes a foundation blocker, security/business risk, or direct conversion/discoverability constraint. Action plan must contain no more than five actions and must not become a technical checklist dump.",
    "12. Write for a non-technical business reader. Explain meaning and consequence, not provider mechanics.",
    "13. Avoid repetition. A fact may support multiple sections, but do not restate the same conclusion in substantially the same language.",
    "14. Do not include HTML, Markdown, or URLs in narrative text.",
    "15. Return JSON only and match the governed output shape exactly.",
    "16. For every limitations[] item, status MUST exactly equal one governed source or capability status. In each of clientExplanation, whatThisMeans, and whatThisDoesNotMean, include at least one evidenceRefs ID whose WriterInput.referenceIndex record has kind source-status or capability and resolves to that same status. Finding-only references do not ground limitation status.",
  ].join("\n");
}

function passOnePrompt(writerInput) {
  return [
    "You are the governed PRYSM Executive Report Writer.",
    "Your task is to turn deterministic evidence into clear executive interpretation without changing what the evidence says.",
    "",
    commonRules(),
    "",
    "REPORT STANDARD:",
    "- Answer first in the executive conclusion.",
    "- Identify what should be preserved, not only what is wrong.",
    "- Organize the report around one coherent root cause where the deterministic evidence supports one.",
    "- Give substantial attention to conversion, content/topical architecture, E-E-A-T/trust, SEO/SERP, AI search readiness, technical health, performance/UX, and competitors.",
    "- Explain limitations in plain language, including what should NOT be inferred from unavailable evidence.",
    "- End with a concise Preserve / Change / Do Next decision.",
    "",
    "GOVERNED OUTPUT SHAPE:",
    OUTPUT_SHAPE,
    "",
    "WRITER INPUT:",
    stringify(writerInput),
  ].join("\n");
}

function revisionPrompt({ writerInput, passNumber, previousOutput, judgeResponse }) {
  const directive = judgeResponse.revisionDirective;
  const defectIds = new Set(directive.defectIds || []);
  const defects = (judgeResponse.defects || []).filter((defect) => defectIds.has(defect.defectId));
  return [
    `You are the governed PRYSM Executive Report Writer performing correction Pass ${passNumber}.`,
    "This is a surgical revision, not a fresh rewrite.",
    "",
    commonRules(),
    "",
    "REVISION GOVERNANCE:",
    `- You MAY change only these fields: ${JSON.stringify(directive.fieldsToRewrite || [])}.`,
    `- You MUST preserve all other report fields byte-for-value in meaning and structure: ${JSON.stringify(directive.fieldsLocked || [])}.`,
    "- Correct only the defects listed below.",
    "- Do not improve or stylistically rewrite sections that passed.",
    "- Do not change metadata except passNumber, modelId, generatedAt and promptVersion as required by the contract.",
    "- Return the complete WriterOutput object, including unchanged sections.",
    "",
    "GOVERNED OUTPUT SHAPE:",
    OUTPUT_SHAPE,
    "",
    "JUDGE DEFECTS TO CORRECT:",
    stringify(defects),
    "",
    "REVISION DIRECTIVE:",
    stringify(directive),
    "",
    "PREVIOUS VALIDATED WRITER OUTPUT:",
    stringify(previousOutput),
    "",
    "AUTHORITATIVE WRITER INPUT:",
    stringify(writerInput),
  ].join("\n");
}

export function buildWriterPrompt({ writerInput, passNumber = 1, previousOutput, judgeResponse }) {
  assertPassInputs({ writerInput, passNumber, previousOutput, judgeResponse });
  return passNumber === 1
    ? passOnePrompt(writerInput)
    : revisionPrompt({ writerInput, passNumber, previousOutput, judgeResponse });
}

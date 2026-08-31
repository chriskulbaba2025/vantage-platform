import assert from "node:assert/strict";

import { JUDGE_CONTRACT_VERSION, JUDGE_DECISION, RUBRIC } from "../src/narrative-v2/judge-contract.js";
import { WRITER_OUTPUT_VERSION, WRITER_PROMPT_VERSION } from "../src/narrative-v2/writer-output.js";

const FIXED_TS = "2026-08-31T12:00:00.000Z";

function atom(text, ref, statementClass = "INTERPRETATION") {
  return { text, statementClass, evidenceRefs: [ref] };
}

function valueAtPath(object, path) {
  return String(path || "").split(".").reduce((value, key) => value?.[key], object);
}

function governedStatusReference(writerInput) {
  for (const [ref, record] of Object.entries(writerInput.referenceIndex || {})) {
    if (record?.kind === "source-status") {
      const status = valueAtPath(writerInput, record.path);
      if (typeof status === "string" && status.length > 0) return { ref, status };
    }
    if (record?.kind === "capability") {
      const capability = valueAtPath(writerInput, record.path);
      if (typeof capability?.status === "string" && capability.status.length > 0) return { ref, status: capability.status };
    }
  }
  for (const [ref, record] of Object.entries(writerInput.referenceIndex || {})) {
    if (record?.kind !== "capability") continue;
    const capability = writerInput.capabilityContext?.capabilities?.[ref.slice("capability:".length)];
    if (typeof capability?.status === "string" && capability.status.length > 0) return { ref, status: capability.status };
  }
  return null;
}

export function buildControlledWriterOutput({ writerInput, passNumber }) {
  const ref = Object.keys(writerInput.referenceIndex)[0];
  assert.ok(ref, "WriterInput must expose at least one governed reference");
  const governedStatus = governedStatusReference(writerInput);
  assert.ok(governedStatus, "WriterInput must expose a governed source status");
  const interpret = (label) => atom(`${label} is tied to the governed audit evidence.`, ref);
  const opportunity = (label, evidenceRef = ref) => atom(`${label} is a governed opportunity.`, evidenceRef, "OPPORTUNITY");
  const statusInterpret = (label) => atom(`${label} is tied to the governed source status.`, governedStatus.ref);
  const competitorRef = Object.entries(writerInput.referenceIndex || {}).find(([, record]) => record?.kind === "competitor")?.[0];
  const competitorValue = competitorRef ? valueAtPath(writerInput, writerInput.referenceIndex[competitorRef].path) : null;
  const competitorText = typeof competitorValue === "string" ? competitorValue.replace(/^https?:\/\//, "") : "competitor-proof.example.net";
  const standard = (headline, fields) => ({ headline, ...fields });
  const influence = writerInput.deterministicAnalysis?.conversionInfluence;
  const findingIds = influence?.orderedFindingIds || [];
  assert.ok(findingIds.length > 0, "WriterInput must expose at least one governed action");
  const actionPlan = findingIds.map((findingId, index) => {
    const action = influence.byFindingId?.[findingId];
    const actionRef = `finding:${findingId}`;
    assert.ok(action && writerInput.referenceIndex[actionRef], `Missing governed action reference ${findingId}`);
    return {
      actionId: `ACT-${String(index + 1).padStart(2, "0")}`,
      priority: action.rank,
      title: `Governed priority ${index + 1}`,
      action: opportunity(`Governed action ${index + 1}`, actionRef),
      whyNow: opportunity(`Governed why now ${index + 1}`, actionRef),
      expectedBusinessEffect: opportunity(`Governed business effect ${index + 1}`, actionRef),
      effort: action.effort,
      verification: opportunity(`Governed verification ${index + 1}`, actionRef),
    };
  });
  return {
    contractVersion: "1.0.0", writerOutputVersion: WRITER_OUTPUT_VERSION,
    auditId: writerInput.auditId, passNumber, modelId: "writer-controlled-current-replay",
    promptVersion: WRITER_PROMPT_VERSION, generatedAt: FIXED_TS,
    executiveConclusion: { headline: "Governed conclusion", narrative: interpret("Executive conclusion") },
    strengths: [{ itemId: "STR-01", title: "Verified strength", narrative: interpret("Verified strength") }],
    rootCause: { headline: "Governed root cause", narrative: interpret("Root cause"), businessConsequences: [{ area: "Conversion", narrative: interpret("Business consequence") }] },
    conversion: standard("Conversion", { whatWorks: interpret("Conversion strength"), constraints: interpret("Conversion constraint"), businessMeaning: interpret("Conversion meaning"), priority: interpret("Conversion priority") }),
    content: standard("Content and topical architecture", { currentStrength: interpret("Content strength"), coverageAssessment: interpret("Content coverage"), qualityAssessment: interpret("Content quality"), topicalArchitecture: interpret("Topical architecture"), importantGaps: interpret("Content gap"), businessMeaning: interpret("Content meaning") }),
    funnelOpportunities: { awareness: [{ itemId: "FUN-A-01", concept: opportunity("Awareness concept"), userNeed: opportunity("Awareness user need"), rationale: opportunity("Awareness rationale"), businessObjective: opportunity("Awareness business objective"), nextAction: opportunity("Awareness next action") }], consideration: [], decision: [] },
    seoSerp: standard("SEO and SERP", { whatWorks: interpret("SEO strength"), constraints: interpret("SEO constraint"), searchImplication: interpret("Search implication"), priority: interpret("SEO priority") }),
    aiSearch: standard("AI search readiness", { answerability: interpret("AI answerability"), entityStrength: interpret("AI entity strength"), citationReadiness: interpret("AI citation readiness"), constraints: interpret("AI search constraint"), opportunity: opportunity("AI search opportunity") }),
    eeatTrust: standard("E-E-A-T and trust", { experience: interpret("Experience"), expertise: interpret("Expertise"), authority: interpret("Authority"), trust: interpret("Trust"), proofGaps: interpret("Proof gap"), businessMeaning: interpret("Trust meaning") }),
    technical: standard("Technical foundations", { assessment: interpret("Technical assessment"), materialIssues: interpret("Technical issue"), businessMeaning: interpret("Technical meaning") }),
    performanceUx: standard("Performance and UX", { assessment: interpret("Performance assessment"), userImpact: interpret("User impact"), conversionImpact: interpret("Conversion impact") }),
    competitors: standard("Competitive position", { advantages: interpret(`${competitorText} is part of the governed competitive evidence.`), disadvantages: interpret("Competitive disadvantage"), marketInterpretation: interpret("Competitive interpretation"), differentiatorToProtect: interpret("Differentiator") }),
    limitations: [{ itemId: "LIM-01", area: "Evidence boundary", status: governedStatus.status, clientExplanation: statusInterpret("Limitation explanation"), whatThisMeans: statusInterpret("Limitation meaning"), whatThisDoesNotMean: statusInterpret("Limitation non-meaning"), impactOnReport: statusInterpret("Limitation impact") }],
    actionPlan,
    executiveDecision: { preserve: interpret("Preserve"), change: interpret("Change"), doNext: opportunity("Do next") },
  };
}

export function buildControlledJudgeResponse({ writerInput, passNumber }) {
  const ref = Object.keys(writerInput.referenceIndex)[0];
  const rubric = Object.fromEntries(Object.entries(RUBRIC).map(([key, maxScore]) => [key, {
    score: maxScore, maxScore, status: "PASS", rationale: `${key} passes the governed rubric.`,
    evidenceRefs: key === "nonRepetition" ? [] : key === "conversionInterpretation" ? ["analysis:conversionInfluence"] : [ref], defectIds: [],
  }]));
  return {
    contractVersion: JUDGE_CONTRACT_VERSION, auditId: writerInput.auditId, passNumber,
    judgeModelId: "judge-controlled-current-replay", judgePromptVersion: "2.1.0", evaluatedAt: FIXED_TS,
    hardGate: { status: "PASS", violations: [] }, rubric, totalScore: 100,
    decision: JUDGE_DECISION.PASS, defects: [],
    revisionDirective: { required: false, mode: "NONE", fieldsToRewrite: [], fieldsLocked: [], defectIds: [] },
  };
}

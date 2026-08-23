/**
 * PRYSM-NARRATIVE-V2-PROD-01 — additive production lifecycle bridge.
 *
 * This wrapper leaves the proven base audit orchestrator untouched. When, and
 * only when, an AuditRequest explicitly selects report.narrativeVersion 2.0.0
 * and the runtime capability is enabled, it owns the SCORED → narrative-v2 →
 * NARRATIVE_READY → governed v2 render sequence. All other audits delegate to
 * the existing orchestrator unchanged.
 */

import { createHash, randomUUID } from "node:crypto";

import { LIFECYCLE_STATE } from "../lifecycle/state-enum.js";
import { buildArtifactKey } from "../storage/artifact-key.js";
import { buildReportContentPackage, serializePackage, packageSha256 } from "../report-content/build-package.js";
import { loadAndValidateDecisionEvidence } from "../evidence/decision-evidence.js";
import { loadAndValidateCapabilityEvidence } from "../evidence/capability-evidence.js";
import { runFinalizationGate } from "../scoring/report-finalization-gate.js";
import { REPORT_DESIGN_V2, isReportDesignV2 } from "../report/report-design.js";
import { buildWriterInput } from "./writer-input.js";
import {
  runNarrativeV2Orchestration,
  NARRATIVE_V2_STATUS,
} from "./orchestrator.js";
import { validateWriterOutput } from "./writer-output.js";
import { validateJudgeResponse } from "./judge-contract.js";
import { renderGovernedNarrativeReportV2 } from "../report/render-narrative-v2.js";
import { REPORT_V2_VIEWER_VERSION } from "../report/render-report-v2.js";

const T = LIFECYCLE_STATE;
const NARRATIVE_V2_VERSION = "2.0.0";
const UAT_RERENDER_AUDIT_ID = "d3b4cc62-9217-4c0b-b169-e24beb46a79c";

function defaultClock() {
  return { now: () => new Date().toISOString() };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function scopeFor(auditRequest) {
  return {
    tenantId: auditRequest.tenantId,
    clientId: auditRequest.clientId,
    auditId: auditRequest.auditId,
  };
}

function isNarrativeV2Request(auditRequest) {
  return auditRequest?.report?.narrativeVersion === NARRATIVE_V2_VERSION;
}

function resultSummary({ auditRequest, executionId, startedAt, completedAt, finalState, extra = {} }) {
  return Object.freeze({
    contractVersion: "1.0.0",
    auditId: auditRequest.auditId,
    executionId,
    finalState,
    resumed: false,
    startedAt,
    completedAt,
    findingsArtifact: null,
    scoresArtifact: null,
    sourceCounts: Object.freeze({ total: 0, available: 0, partial: 0, failed: 0, blocked: 0, unavailable: 0, notConnected: 0, notApplicable: 0 }),
    sources: Object.freeze([]),
    canonicalEvidence: null,
    ...extra,
  });
}

async function transition({ lifecycleService, auditRequest, executionId, toState, reason, artifactKey = null }) {
  await lifecycleService.transition({
    auditId: auditRequest.auditId,
    tenantId: auditRequest.tenantId,
    toState,
    reason,
    transitionIdempotencyKey: `${auditRequest.auditId}:${executionId}:${reason}`,
    ...(artifactKey ? { artifactKey } : {}),
  });
}

async function persistJsonArtifact({ artifactStore, auditRequest, artifactName, value }) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2), "utf-8");
  const record = await artifactStore.put({
    bytes,
    contentType: "application/json",
    scope: {
      ...scopeFor(auditRequest),
      category: "report-v2",
      artifactName,
    },
  });
  const stored = await artifactStore.get(record.key);
  if (!stored || stored.length !== bytes.length) {
    throw new Error(`Narrative v2 artifact read-back byte mismatch: ${artifactName}`);
  }
  if (sha256(stored) !== record.sha256 || record.sha256 !== sha256(bytes)) {
    throw new Error(`Narrative v2 artifact read-back SHA mismatch: ${artifactName}`);
  }
  if (typeof artifactStore.verify === "function" && !(await artifactStore.verify(record))) {
    throw new Error(`Narrative v2 artifact verification failed: ${artifactName}`);
  }
  return record;
}

async function loadJsonArtifact({ artifactStore, auditRequest, artifactName }) {
  const key = buildArtifactKey({
    ...scopeFor(auditRequest),
    category: "report-v2",
    artifactName,
  });
  let bytes;
  try {
    bytes = await artifactStore.get(key);
  } catch {
    return null;
  }
  if (!bytes) return null;
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

async function loadScoredInputs({ artifactStore, auditRequest, validateContract }) {
  const scope = scopeFor(auditRequest);
  const decisionEvidence = await loadAndValidateDecisionEvidence({
    store: artifactStore,
    scope,
    validateContract,
  });
  const capabilityEvidence = await loadAndValidateCapabilityEvidence({
    store: artifactStore,
    scope,
    validateContract,
  });

  const findingsKey = buildArtifactKey({ ...scope, category: "canonical", artifactName: "findings.json" });
  const scoresKey = buildArtifactKey({ ...scope, category: "canonical", artifactName: "scores.json" });
  const [findingsBytes, scoresBytes] = await Promise.all([
    artifactStore.get(findingsKey),
    artifactStore.get(scoresKey),
  ]);
  if (!findingsBytes) throw new Error("Narrative v2 findings.json artifact missing");
  if (!scoresBytes) throw new Error("Narrative v2 scores.json artifact missing");

  const findingsRaw = JSON.parse(Buffer.from(findingsBytes).toString("utf8"));
  const findings = Array.isArray(findingsRaw) ? findingsRaw : (findingsRaw?.findings || []);
  const scoreSet = JSON.parse(Buffer.from(scoresBytes).toString("utf8"));

  return { decisionEvidence, capabilityEvidence, findings, scoreSet };
}

async function ensureReportContentPackage({ artifactStore, auditRequest, validateContract, inputs }) {
  const scope = scopeFor(auditRequest);
  const key = buildArtifactKey({ ...scope, category: "report", artifactName: "report-content.json" });
  if (typeof artifactStore.exists === "function" && await artifactStore.exists(key)) return key;

  const pkg = buildReportContentPackage({
    auditRequest,
    canonicalEvidence: inputs.decisionEvidence,
    findings: inputs.findings,
    scoreSet: inputs.scoreSet,
  });
  const validation = validateContract(
    "https://vantage-platform.io/prysm/contracts/v1/report-content.schema.json",
    pkg,
  );
  if (!validation?.valid) {
    throw new Error(`Narrative v2 ReportContentPackage validation failed: ${JSON.stringify((validation?.errors || []).slice(0, 3))}`);
  }

  const serialized = serializePackage(pkg);
  const expectedSha = packageSha256(pkg);
  const record = await artifactStore.put({
    bytes: Buffer.from(serialized, "utf8"),
    contentType: "application/json",
    scope: { ...scope, category: "report", artifactName: "report-content.json" },
  });
  const stored = await artifactStore.get(record.key);
  if (!stored || Buffer.from(stored).toString("utf8") !== serialized) {
    throw new Error("Narrative v2 ReportContentPackage read-back mismatch");
  }
  if (sha256(stored) !== expectedSha) {
    throw new Error("Narrative v2 ReportContentPackage SHA mismatch");
  }
  return record.key;
}

function validatePersistedReleaseCandidate(writerInput, orchestrationResult) {
  const errors = [];
  if (!writerInput || typeof writerInput !== "object") errors.push("writerInput missing");
  if (!orchestrationResult || typeof orchestrationResult !== "object") errors.push("orchestration result missing");
  if (orchestrationResult?.status !== NARRATIVE_V2_STATUS.RELEASE_CANDIDATE) {
    errors.push(`orchestration status must be ${NARRATIVE_V2_STATUS.RELEASE_CANDIDATE}`);
  }
  if (orchestrationResult?.auditId !== writerInput?.auditId) errors.push("orchestration auditId mismatch");
  if (!Number.isInteger(orchestrationResult?.passCount) || orchestrationResult.passCount < 1 || orchestrationResult.passCount > 3) {
    errors.push("orchestration passCount must be an integer from 1 to 3");
  }
  if (orchestrationResult?.finalJudgeResponse?.decision !== "PASS") {
    errors.push("final Judge decision must be PASS for a persisted release candidate");
  }
  if (errors.length) return { valid: false, errors };

  const passNumber = orchestrationResult.passCount;
  const writerValidation = validateWriterOutput(orchestrationResult.finalWriterOutput, {
    writerInput,
    expectedPassNumber: passNumber,
  });
  if (!writerValidation.valid) errors.push(...writerValidation.errors.map((e) => `WriterOutput: ${e}`));

  const judgeValidation = validateJudgeResponse(orchestrationResult.finalJudgeResponse, {
    writerInput,
    expectedPassNumber: passNumber,
  });
  if (!judgeValidation.valid) errors.push(...judgeValidation.errors.map((e) => `JudgeResponse: ${e}`));

  return { valid: errors.length === 0, errors };
}

function buildV2Model({ auditRequest, scoreSet, findings, capabilityEvidence, decisionEvidence }) {
  // Use the canonical persisted ScoreSet directly. This intentionally fixes
  // the prior production projection loss of readinessStatusDetail and
  // renderingDiagnostics while preserving the exact deterministic renderer
  // model fields already used by report-design v2.
  return {
    scoringVersion: scoreSet.scoringVersion || "4.1.0",
    generatedAt: scoreSet.generatedAt,
    scores: scoreSet.scores || {},
    bands: scoreSet.bands || {},
    assessedWeight: scoreSet.assessedWeight ?? 0,
    readinessStatus: scoreSet.readinessStatus || "",
    readinessStatusDetail: scoreSet.readinessStatusDetail || scoreSet.readinessStatus || "",
    showNumericScore: scoreSet.showNumericScore ?? false,
    evidenceConfidenceScore: scoreSet.evidenceConfidenceScore ?? 0,
    evidenceConfidenceFactorAvailability: scoreSet.evidenceConfidenceFactorAvailability || [],
    rootCause: scoreSet.rootCause || "",
    findings,
    renderingDiagnostics: Array.isArray(scoreSet.renderingDiagnostics) ? scoreSet.renderingDiagnostics : undefined,
    suppressedFindingReasons: scoreSet.suppressedFindingReasons || [],
    moduleEligibility: scoreSet.moduleEligibility || {},
    moduleScores: scoreSet.moduleScores || {},
    suppressedModules: scoreSet.suppressedModules || [],
    capabilityEvidence,
    evidence: decisionEvidence,
    input: {
      businessName: auditRequest.businessName || "",
      targetUrl: decisionEvidence.site?.targetUrl || auditRequest.targetUrl,
    },
    conversionPaths: scoreSet.conversionPaths || [],
    readinessMap: scoreSet.readinessMap || [],
    contentIdeas: scoreSet.contentIdeas || { tofu: [], mofu: [], bofu: [], leading: [] },
    competitors: scoreSet.competitors || { comparisons: [], opportunities: { topics: [], qualifiedCandidates: [], excludedCandidates: [], gaps: [], allGaps: [], sources: {}, limitations: [] } },
  };
}

/**
 * PRYSM-V2-UAT-RERENDER-01 — read-only Viewer v2.2.0 UAT renderer.
 *
 * Reads only already-persisted governed inputs and renders the current
 * report HTML in memory.
 *
 * It does not call providers, Writer/Judge/model executors, write
 * artifacts, transition lifecycle state, approve, or publish.
 */
export async function renderNarrativeV2UatFromPersistedArtifacts({
  auditRequest,
  artifactStore,
  validateContract,
}) {
  if (
    !auditRequest ||
    auditRequest.auditId !== UAT_RERENDER_AUDIT_ID
  ) {
    throw new Error(
      "PRYSM-V2-UAT-RERENDER-01 is authorized only for the governed UAT audit",
    );
  }

  if (!isNarrativeV2Request(auditRequest)) {
    throw new Error(
      "PRYSM-V2-UAT-RERENDER-01 requires Narrative v2 persisted inputs",
    );
  }

  if (!isReportDesignV2(auditRequest.report?.designVersion)) {
    throw new Error(
      "PRYSM-V2-UAT-RERENDER-01 requires report design 2.0.0",
    );
  }

  if (
    !artifactStore ||
    typeof artifactStore.get !== "function"
  ) {
    throw new Error(
      "PRYSM-V2-UAT-RERENDER-01 requires a readable governed artifact store",
    );
  }

  if (typeof validateContract !== "function") {
    throw new Error(
      "PRYSM-V2-UAT-RERENDER-01 requires contract validation",
    );
  }

  const [writerInput, orchestrationResult, inputs] =
    await Promise.all([
      loadJsonArtifact({
        artifactStore,
        auditRequest,
        artifactName: "narrative-v2/writer-input.json",
      }),
      loadJsonArtifact({
        artifactStore,
        auditRequest,
        artifactName: "narrative-v2/orchestration.json",
      }),
      loadScoredInputs({
        artifactStore,
        auditRequest,
        validateContract,
      }),
    ]);

  const persistedValidation =
    validatePersistedReleaseCandidate(
      writerInput,
      orchestrationResult,
    );

  if (!persistedValidation.valid) {
    throw new Error(
      `PRYSM-V2-UAT-RERENDER-01 persisted release candidate invalid: ${persistedValidation.errors.join(
        "; ",
      )}`,
    );
  }

  const model = buildV2Model({
    auditRequest,
    scoreSet: inputs.scoreSet,
    findings: inputs.findings,
    capabilityEvidence: inputs.capabilityEvidence,
    decisionEvidence: inputs.decisionEvidence,
  });

  const gate = runFinalizationGate(
    {
      ...model,
      findings: inputs.findings,
    },
    inputs.decisionEvidence,
  );

  if (!gate.passed) {
    const message = (gate.errors || [])
      .map((error) => error.message)
      .join("; ");

    throw new Error(
      `PRYSM-V2-UAT-RERENDER-01 finalization gate failed: ${message}`,
    );
  }

  const html = renderGovernedNarrativeReportV2({
    model,
    writerInput,
    orchestrationResult,
  });

  if (
    !/^<!doctype html>/i.test(html) ||
    !html.includes('id="narrative-layer"') ||
    !html.includes(
      `data-viewer-version="${REPORT_V2_VIEWER_VERSION}"`,
    )
  ) {
    throw new Error(
      `PRYSM-V2-UAT-RERENDER-01 did not produce governed Viewer v${REPORT_V2_VIEWER_VERSION} HTML`,
    );
  }

  return Object.freeze({
    auditId: auditRequest.auditId,
    viewerVersion: REPORT_V2_VIEWER_VERSION,
    contentType: "text/html; charset=utf-8",
    bytes: Buffer.from(html, "utf8"),
  });
}

async function runNarrativeV2FromScored({
  auditRequest,
  executionId,
  startedAt,
  lifecycleService,
  artifactStore,
  validateContract,
  writerExecutor,
  judgeExecutor,
  clock,
}) {
  let inputs;
  try {
    inputs = await loadScoredInputs({ artifactStore, auditRequest, validateContract });
    await ensureReportContentPackage({ artifactStore, auditRequest, validateContract, inputs });
  } catch (err) {
    // Package/input preparation occurs before NARRATIVE_PENDING. Remain at
    // SCORED so deterministic preparation can be retried without model calls.
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.SCORED,
      extra: { wp8Error: err.message },
    });
  }

  await transition({
    lifecycleService,
    auditRequest,
    executionId,
    toState: T.NARRATIVE_PENDING,
    reason: "narrative-v2-execution-start",
  });

  let writerInput;
  let orchestrationResult;
  try {
    writerInput = buildWriterInput({
      auditId: auditRequest.auditId,
      auditRequest,
      scoreSet: inputs.scoreSet,
      findings: inputs.findings,
      capabilityEvidence: inputs.capabilityEvidence,
    });

    await persistJsonArtifact({
      artifactStore,
      auditRequest,
      artifactName: "narrative-v2/writer-input.json",
      value: writerInput,
    });

    orchestrationResult = await runNarrativeV2Orchestration({
      writerInput,
      writerExecutor,
      judgeExecutor,
    });

    const orchestrationRecord = await persistJsonArtifact({
      artifactStore,
      auditRequest,
      artifactName: "narrative-v2/orchestration.json",
      value: orchestrationResult,
    });

    if (orchestrationResult.status !== NARRATIVE_V2_STATUS.RELEASE_CANDIDATE) {
      await transition({
        lifecycleService,
        auditRequest,
        executionId,
        toState: T.NARRATIVE_FAILED,
        reason: `narrative-v2-${String(orchestrationResult.status || "not-release-candidate").toLowerCase()}`,
        artifactKey: orchestrationRecord.key,
      });
      return resultSummary({
        auditRequest,
        executionId,
        startedAt,
        completedAt: clock.now(),
        finalState: T.NARRATIVE_FAILED,
        extra: { narrativeV2Status: orchestrationResult.status, narrativeV2PassCount: orchestrationResult.passCount },
      });
    }

    const validation = validatePersistedReleaseCandidate(writerInput, orchestrationResult);
    if (!validation.valid) throw new Error(`Narrative v2 release-candidate validation failed: ${validation.errors.join("; ")}`);

    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.NARRATIVE_READY,
      reason: "narrative-v2-release-candidate",
      artifactKey: orchestrationRecord.key,
    });

    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.NARRATIVE_READY,
      extra: {
        narrativeV2Status: orchestrationResult.status,
        narrativeV2PassCount: orchestrationResult.passCount,
      },
    });
  } catch (err) {
    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.NARRATIVE_FAILED,
      reason: `narrative-v2-execution-failed:${String(err.message || "").slice(0, 120)}`,
    });
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.NARRATIVE_FAILED,
      extra: { narrativeV2Error: err.message },
    });
  }
}

async function recoverNarrativeV2Pending({ auditRequest, executionId, startedAt, lifecycleService, artifactStore, clock }) {
  let writerInput;
  let orchestrationResult;
  try {
    writerInput = await loadJsonArtifact({
      artifactStore,
      auditRequest,
      artifactName: "narrative-v2/writer-input.json",
    });
    orchestrationResult = await loadJsonArtifact({
      artifactStore,
      auditRequest,
      artifactName: "narrative-v2/orchestration.json",
    });
  } catch (err) {
    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.NARRATIVE_FAILED,
      reason: `narrative-v2-recovery-artifact-invalid:${String(err.message || "").slice(0, 120)}`,
    });
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.NARRATIVE_FAILED,
      extra: { narrativeV2Error: `Persisted Narrative v2 recovery artifact is unreadable: ${err.message}` },
    });
  }

  // Re-execution is allowed only when no terminal orchestration artifact exists.
  // A present terminal artifact that cannot be verified is a governed failure,
  // not permission to spend another Writer/Judge execution set.
  if (!orchestrationResult) return null;
  if (!writerInput) {
    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.NARRATIVE_FAILED,
      reason: "narrative-v2-recovery-writer-input-missing",
    });
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.NARRATIVE_FAILED,
      extra: { narrativeV2Error: "Persisted terminal orchestration exists but WriterInput is missing" },
    });
  }

  const validation = validatePersistedReleaseCandidate(writerInput, orchestrationResult);
  if (!validation.valid) {
    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.NARRATIVE_FAILED,
      reason: `narrative-v2-recovery-invalid:${validation.errors.join("; ").slice(0, 120)}`,
    });
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.NARRATIVE_FAILED,
      extra: {
        narrativeV2Status: orchestrationResult.status || "INVALID",
        narrativeV2Error: `Persisted terminal orchestration failed validation: ${validation.errors.join("; ")}`,
      },
    });
  }

  const orchestrationKey = buildArtifactKey({
    ...scopeFor(auditRequest),
    category: "report-v2",
    artifactName: "narrative-v2/orchestration.json",
  });
  await transition({
    lifecycleService,
    auditRequest,
    executionId,
    toState: T.NARRATIVE_READY,
    reason: "narrative-v2-recovered-from-artifact",
    artifactKey: orchestrationKey,
  });
  return resultSummary({
    auditRequest,
    executionId,
    startedAt,
    completedAt: clock.now(),
    finalState: T.NARRATIVE_READY,
    extra: { narrativeV2Status: orchestrationResult.status, narrativeV2PassCount: orchestrationResult.passCount },
  });
}

async function renderNarrativeV2Draft({
  auditRequest,
  executionId,
  startedAt,
  lifecycleService,
  artifactStore,
  validateContract,
  clock,
}) {
  if (!isReportDesignV2(auditRequest.report?.designVersion)) {
    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.RENDER_FAILED,
      reason: "narrative-v2-requires-report-design-v2",
    });
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.RENDER_FAILED,
      extra: { narrativeV2Error: "Narrative v2 requires report design 2.0.0" },
    });
  }

  let writerInput;
  let orchestrationResult;
  let inputs;
  try {
    [writerInput, orchestrationResult, inputs] = await Promise.all([
      loadJsonArtifact({ artifactStore, auditRequest, artifactName: "narrative-v2/writer-input.json" }),
      loadJsonArtifact({ artifactStore, auditRequest, artifactName: "narrative-v2/orchestration.json" }),
      loadScoredInputs({ artifactStore, auditRequest, validateContract }),
    ]);
    const validation = validatePersistedReleaseCandidate(writerInput, orchestrationResult);
    if (!validation.valid) {
      throw new Error(`Narrative v2 persisted release candidate invalid: ${validation.errors.join("; ")}`);
    }
  } catch (err) {
    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.RENDER_FAILED,
      reason: `narrative-v2-render-input-invalid:${String(err.message || "").slice(0, 120)}`,
    });
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.RENDER_FAILED,
      extra: { narrativeV2Error: err.message },
    });
  }

  const model = buildV2Model({
    auditRequest,
    scoreSet: inputs.scoreSet,
    findings: inputs.findings,
    capabilityEvidence: inputs.capabilityEvidence,
    decisionEvidence: inputs.decisionEvidence,
  });

  const gate = runFinalizationGate({ ...model, findings: inputs.findings }, inputs.decisionEvidence);
  if (!gate.passed) {
    const message = (gate.errors || []).map((e) => e.message).join("; ");
    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.RENDER_FAILED,
      reason: `narrative-v2-finalization-gate-failed:${message.slice(0, 120)}`,
    });
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.RENDER_FAILED,
      extra: { narrativeV2Error: `Finalization gate failed: ${message}` },
    });
  }

  let html;
  try {
    html = renderGovernedNarrativeReportV2({
      model,
      writerInput,
      orchestrationResult,
    });
  } catch (err) {
    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.RENDER_FAILED,
      reason: `narrative-v2-render-failed:${String(err.message || "").slice(0, 120)}`,
    });
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.RENDER_FAILED,
      extra: { narrativeV2Error: err.message, rendererCallCount: 1 },
    });
  }

  if (!/^<!doctype html>/i.test(html) || !html.includes("D. Where are the problems?") || !html.includes('id="narrative-layer"')) {
    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.RENDER_FAILED,
      reason: "narrative-v2-render-finalization-failed",
    });
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.RENDER_FAILED,
      extra: { narrativeV2Error: "Narrative v2 required report structure missing", rendererCallCount: 1 },
    });
  }

  const bytes = Buffer.from(html, "utf-8");
  let pageRecord;
  try {
    pageRecord = await artifactStore.put({
      bytes,
      contentType: "text/html",
      scope: { ...scopeFor(auditRequest), category: "report-v2", artifactName: "pages/index.html" },
    });
    const stored = await artifactStore.get(pageRecord.key);
    if (!stored || stored.length !== bytes.length || sha256(stored) !== pageRecord.sha256) {
      throw new Error("Narrative v2 report page read-back verification failed");
    }
  } catch (err) {
    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.RENDER_FAILED,
      reason: `narrative-v2-persist-failed:${String(err.message || "").slice(0, 120)}`,
    });
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.RENDER_FAILED,
      extra: { narrativeV2Error: err.message, rendererCallCount: 1 },
    });
  }

  const manifest = {
    contractVersion: "1.0.0",
    artifactVersion: "1.0.0",
    reportVersion: inputs.scoreSet.scoringVersion || "4.1.1",
    reportDesignVersion: REPORT_DESIGN_V2,
    runId: executionId,
    slug: String(auditRequest.businessName || auditRequest.targetUrl || "audit").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    targetUrl: auditRequest.targetUrl || "https://unknown.example.com",
    targetDomain: (() => { try { return new URL(auditRequest.targetUrl || "https://unknown.example.com").hostname; } catch { return "unknown.example.com"; } })(),
    startedAt,
    completedAt: clock.now(),
    status: "draft",
    scores: {
      trust: inputs.scoreSet.scores?.trust ?? null,
      contentDepth: inputs.scoreSet.scores?.contentDepth ?? null,
      conversionPathways: inputs.scoreSet.scores?.conversionPathways ?? null,
      technical: inputs.scoreSet.scores?.technical ?? null,
      performance: inputs.scoreSet.scores?.performance ?? null,
      conversionReadiness: inputs.scoreSet.scores?.conversionReadiness ?? null,
    },
    sources: {
      website: inputs.decisionEvidence.site?.sourceStatus || "NOT_APPLICABLE",
      performance: inputs.decisionEvidence.performance?.sourceStatus || "NOT_APPLICABLE",
      competitors: inputs.decisionEvidence.competitors?.length ? (inputs.decisionEvidence.competitors[0]?.status || "NOT_APPLICABLE") : "NOT_APPLICABLE",
      backlinks: inputs.decisionEvidence.backlinks?.sourceStatus || "NOT_APPLICABLE",
      ga4: inputs.decisionEvidence.ga4?.sourceStatus || "NOT_APPLICABLE",
      gsc: inputs.decisionEvidence.gsc?.sourceStatus || "NOT_APPLICABLE",
    },
    files: ["index.html"],
    auditId: auditRequest.auditId,
    lifecycleStatus: "DRAFT_RENDERED",
  };

  const manifestValidation = validateContract(
    "https://vantage-platform.io/prysm/contracts/v1/report-manifest-v2.schema.json",
    manifest,
  );
  if (!manifestValidation?.valid) {
    const detail = JSON.stringify((manifestValidation?.errors || []).slice(0, 5));
    await transition({
      lifecycleService,
      auditRequest,
      executionId,
      toState: T.RENDER_FAILED,
      reason: `narrative-v2-manifest-invalid:${detail.slice(0, 120)}`,
    });
    return resultSummary({
      auditRequest,
      executionId,
      startedAt,
      completedAt: clock.now(),
      finalState: T.RENDER_FAILED,
      extra: { narrativeV2Error: `Manifest validation failed: ${detail}`, rendererCallCount: 1 },
    });
  }

  const manifestRecord = await persistJsonArtifact({
    artifactStore,
    auditRequest,
    artifactName: "manifest.json",
    value: manifest,
  });

  await transition({
    lifecycleService,
    auditRequest,
    executionId,
    toState: T.DRAFT_RENDERED,
    reason: "governed-narrative-v2-rendering-complete",
    artifactKey: manifestRecord.key,
  });

  return resultSummary({
    auditRequest,
    executionId,
    startedAt,
    completedAt: clock.now(),
    finalState: T.DRAFT_RENDERED,
    extra: {
      pageCount: 1,
      manifestKey: manifestRecord.key,
      manifestRecord,
      pageArtifacts: Object.freeze([{ filename: "index.html", key: pageRecord.key, sha256: pageRecord.sha256, bytes: pageRecord.bytes }]),
      renderedPages: new Map([["index.html", html]]),
      rendererCallCount: 1,
      reportDesignVersion: REPORT_DESIGN_V2,
      narrativeV2Status: orchestrationResult.status,
      narrativeV2PassCount: orchestrationResult.passCount,
      n8nCallCount: 0,
      narrativeCacheHit: null,
      narrativeCallsMade: null,
      narrativeCost: null,
    },
  });
}

/**
 * Wrap the existing audit orchestrator with an explicit Narrative v2 path.
 * The base orchestrator remains authoritative for every non-v2 request and
 * for collection/scoring states before SCORED.
 */
export function createNarrativeV2ProductionPath({
  baseOrchestrator,
  lifecycleService,
  artifactStore,
  validateContract,
  enabled = false,
  writerExecutor,
  judgeExecutor,
  clock,
}) {
  if (!baseOrchestrator || typeof baseOrchestrator.execute !== "function") {
    throw new Error("Narrative v2 production path requires baseOrchestrator.execute");
  }
  const c = clock || defaultClock();

  if (enabled && (typeof writerExecutor !== "function" || typeof judgeExecutor !== "function")) {
    throw new Error("Narrative v2 production path requires writerExecutor and judgeExecutor when enabled");
  }

  async function execute(auditRequest, opts = {}) {
    if (!isNarrativeV2Request(auditRequest)) {
      return baseOrchestrator.execute(auditRequest, opts);
    }
    if (!enabled) {
      throw new Error("Narrative v2 was requested but the runtime capability is disabled");
    }
    if (!isReportDesignV2(auditRequest.report?.designVersion)) {
      throw new Error("Narrative v2 requires report.designVersion 2.0.0");
    }

    const executionId = opts.executionId || randomUUID();
    const startedAt = c.now();
    const current = await lifecycleService.currentState(auditRequest.auditId, auditRequest.tenantId);

    if (current?.state === T.SCORED) {
      return runNarrativeV2FromScored({
        auditRequest,
        executionId,
        startedAt,
        lifecycleService,
        artifactStore,
        validateContract,
        writerExecutor,
        judgeExecutor,
        clock: c,
      });
    }

    if (current?.state === T.NARRATIVE_PENDING) {
      const recovered = await recoverNarrativeV2Pending({
        auditRequest,
        executionId,
        startedAt,
        lifecycleService,
        artifactStore,
        clock: c,
      });
      if (recovered) return recovered;
      return runNarrativeV2FromPending({
        auditRequest,
        executionId,
        startedAt,
        lifecycleService,
        artifactStore,
        validateContract,
        writerExecutor,
        judgeExecutor,
        clock: c,
      });
    }

    if (current?.state === T.NARRATIVE_FAILED) {
      // Do not automatically spend another Writer/Judge pass set. The exact
      // orchestration artifact remains available for governed human review.
      const orchestrationResult = await loadJsonArtifact({
        artifactStore,
        auditRequest,
        artifactName: "narrative-v2/orchestration.json",
      });
      return resultSummary({
        auditRequest,
        executionId,
        startedAt,
        completedAt: c.now(),
        finalState: T.NARRATIVE_FAILED,
        extra: { narrativeV2Status: orchestrationResult?.status || "FAILED" },
      });
    }

    if (current?.state === T.NARRATIVE_READY) {
      return renderNarrativeV2Draft({
        auditRequest,
        executionId,
        startedAt,
        lifecycleService,
        artifactStore,
        validateContract,
        clock: c,
      });
    }

    if (current?.state === T.RENDER_FAILED) {
      await transition({
        lifecycleService,
        auditRequest,
        executionId,
        toState: T.NARRATIVE_READY,
        reason: "narrative-v2-render-failed-recovery",
      });
      return resultSummary({
        auditRequest,
        executionId,
        startedAt,
        completedAt: c.now(),
        finalState: T.NARRATIVE_READY,
      });
    }

    // Collection, evidence locking, scoring, review and publication remain
    // entirely owned by the existing proven orchestrator.
    return baseOrchestrator.execute(auditRequest, opts);
  }

  // Crash recovery from NARRATIVE_PENDING may need to re-run when no terminal
  // orchestration artifact exists. Keep that path separate so it does not try
  // SCORED → NARRATIVE_PENDING a second time.
  async function runNarrativeV2FromPending(args) {
    let inputs;
    let writerInput;
    let orchestrationResult;
    try {
      inputs = await loadScoredInputs({
        artifactStore: args.artifactStore,
        auditRequest: args.auditRequest,
        validateContract: args.validateContract,
      });
      await ensureReportContentPackage({
        artifactStore: args.artifactStore,
        auditRequest: args.auditRequest,
        validateContract: args.validateContract,
        inputs,
      });
      writerInput = buildWriterInput({
        auditId: args.auditRequest.auditId,
        auditRequest: args.auditRequest,
        scoreSet: inputs.scoreSet,
        findings: inputs.findings,
        capabilityEvidence: inputs.capabilityEvidence,
      });
      await persistJsonArtifact({
        artifactStore: args.artifactStore,
        auditRequest: args.auditRequest,
        artifactName: "narrative-v2/writer-input.json",
        value: writerInput,
      });
      orchestrationResult = await runNarrativeV2Orchestration({
        writerInput,
        writerExecutor: args.writerExecutor,
        judgeExecutor: args.judgeExecutor,
      });
      const orchestrationRecord = await persistJsonArtifact({
        artifactStore: args.artifactStore,
        auditRequest: args.auditRequest,
        artifactName: "narrative-v2/orchestration.json",
        value: orchestrationResult,
      });
      if (orchestrationResult.status !== NARRATIVE_V2_STATUS.RELEASE_CANDIDATE) {
        await transition({
          lifecycleService: args.lifecycleService,
          auditRequest: args.auditRequest,
          executionId: args.executionId,
          toState: T.NARRATIVE_FAILED,
          reason: `narrative-v2-${String(orchestrationResult.status || "not-release-candidate").toLowerCase()}`,
          artifactKey: orchestrationRecord.key,
        });
        return resultSummary({
          auditRequest: args.auditRequest,
          executionId: args.executionId,
          startedAt: args.startedAt,
          completedAt: args.clock.now(),
          finalState: T.NARRATIVE_FAILED,
          extra: { narrativeV2Status: orchestrationResult.status, narrativeV2PassCount: orchestrationResult.passCount },
        });
      }
      const validation = validatePersistedReleaseCandidate(writerInput, orchestrationResult);
      if (!validation.valid) throw new Error(`Narrative v2 release-candidate validation failed: ${validation.errors.join("; ")}`);
      await transition({
        lifecycleService: args.lifecycleService,
        auditRequest: args.auditRequest,
        executionId: args.executionId,
        toState: T.NARRATIVE_READY,
        reason: "narrative-v2-release-candidate",
        artifactKey: orchestrationRecord.key,
      });
      return resultSummary({
        auditRequest: args.auditRequest,
        executionId: args.executionId,
        startedAt: args.startedAt,
        completedAt: args.clock.now(),
        finalState: T.NARRATIVE_READY,
        extra: { narrativeV2Status: orchestrationResult.status, narrativeV2PassCount: orchestrationResult.passCount },
      });
    } catch (err) {
      await transition({
        lifecycleService: args.lifecycleService,
        auditRequest: args.auditRequest,
        executionId: args.executionId,
        toState: T.NARRATIVE_FAILED,
        reason: `narrative-v2-execution-failed:${String(err.message || "").slice(0, 120)}`,
      });
      return resultSummary({
        auditRequest: args.auditRequest,
        executionId: args.executionId,
        startedAt: args.startedAt,
        completedAt: args.clock.now(),
        finalState: T.NARRATIVE_FAILED,
        extra: { narrativeV2Error: err.message },
      });
    }
  }

  return Object.freeze({ execute });
}

export { NARRATIVE_V2_VERSION, isNarrativeV2Request, buildV2Model, validatePersistedReleaseCandidate };
export default { createNarrativeV2ProductionPath };

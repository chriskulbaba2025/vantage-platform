import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const JSON_ARTIFACTS = Object.freeze([
  "canonical/audit-request.json",
  "canonical/capability-evidence.json",
  "canonical/conversion-path-validation.json",
  "canonical/decision-evidence.json",
  "canonical/evidence.json",
  "canonical/findings.json",
  "canonical/scores.json",
  "normalized/backlinks.json",
  "normalized/dataforseo-onpage.json",
  "normalized/dataforseo-serp.json",
  "normalized/pagespeed.json",
  "report/report-content.json",
  "report-v2/manifest.json",
  "report-v2/narrative-v2/writer-input.json",
  "report-v2/narrative-v2/orchestration.json",
]);

const SOURCE_LABELS = Object.freeze({
  "normalized/backlinks.json": "backlinks",
  "normalized/dataforseo-onpage.json": "dataforseo-onpage",
  "normalized/dataforseo-serp.json": "dataforseo-serp",
  "normalized/pagespeed.json": "pagespeed",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeRelativePath(root, artifactPath) {
  const normalized = artifactPath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error(`Recovered artifact path is not safe: ${artifactPath}`);
  }
  const full = resolve(root, normalized);
  if (!full.startsWith(`${resolve(root)}\\`)) {
    throw new Error(`Recovered artifact path escapes dataset root: ${artifactPath}`);
  }
  return full;
}

async function readArtifact(root, artifactPath) {
  const full = safeRelativePath(root, artifactPath);
  const bytes = await readFile(full);
  return Object.freeze({
    path: artifactPath,
    bytes: bytes.length,
    sha256: sha256(bytes),
    value: artifactPath.endsWith(".json")
      ? JSON.parse(bytes.toString("utf8"))
      : bytes,
  });
}

async function walkFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await walkFiles(full)));
    else if (entry.isFile()) result.push(full);
  }
  return result.sort();
}

function assertAuditIdentity(artifact, auditId) {
  if (artifact.value?.auditId && artifact.value.auditId !== auditId) {
    throw new Error(`Recovered artifact auditId mismatch: ${artifact.path}`);
  }
}

function scoreMap(value) {
  return value && typeof value === "object" ? { ...value } : {};
}

function assertScoreSubset(label, expected, actual) {
  for (const [key, value] of Object.entries(scoreMap(expected))) {
    if (actual?.[key] !== value) {
      throw new Error(`Recovered ${label} score differs from canonical scores: ${key}`);
    }
  }
}

function buildProjection({ auditId, artifacts, inventory }) {
  const get = (path) => artifacts[path];
  const conversion = get("canonical/conversion-path-validation.json").value;
  const evidence = get("canonical/evidence.json").value;
  const packageValue = get("report/report-content.json").value;
  const reportManifest = get("report-v2/manifest.json").value;
  const writerInput = get("report-v2/narrative-v2/writer-input.json").value;
  const orchestration = get("report-v2/narrative-v2/orchestration.json").value;
  const scoreSet = get("canonical/scores.json").value;

  assertScoreSubset("report-content", packageValue.scores, scoreSet.scores);
  assertScoreSubset("report-v2 manifest", reportManifest.scores, scoreSet.scores);

  const screenshotRefs = inventory
    .filter((item) => /^evidence\/path-validation-\d+\.png$/.test(item.path))
    .map((item) => ({ path: item.path, bytes: item.bytes, sha256: item.sha256 }));
  const normalized = Object.entries(SOURCE_LABELS).map(([path, source]) => {
    const value = get(path).value;
    return {
      source,
      path,
      status: value.status || "UNKNOWN",
      provider: value.provider || null,
      coverage: value.coverage || null,
      limitations: Array.isArray(value.limitations) ? value.limitations : [],
    };
  });
  const liveUsage = inventory.filter((item) => item.path.startsWith("report-v2/narrative-v2/live-usage/"));

  return Object.freeze({
    contractVersion: "1.0.0",
    auditId,
    artifactCount: inventory.length,
    directCanonicalInputs: Object.freeze([
      "canonical/audit-request.json",
      "canonical/capability-evidence.json",
      "canonical/decision-evidence.json",
      "canonical/findings.json",
      "canonical/scores.json",
    ]),
    conversionValidation: Object.freeze({
      path: "canonical/conversion-path-validation.json",
      status: conversion.status || "UNKNOWN",
      provider: conversion.provider || null,
      summary: conversion.summary || null,
      pageCount: Array.isArray(conversion.pages) ? conversion.pages.length : 0,
      limitations: Array.isArray(conversion.limitations) ? conversion.limitations : [],
      screenshots: Object.freeze(screenshotRefs),
    }),
    evidenceEnvelope: Object.freeze({
      path: "canonical/evidence.json",
      evidenceVersion: evidence.evidenceVersion || null,
      sourceCount: Object.keys(evidence.sources || {}).length,
      limitationCount: Array.isArray(evidence.limitations) ? evidence.limitations.length : 0,
      artifactReferenceCount: Array.isArray(evidence.artifactReferences) ? evidence.artifactReferences.length : 0,
    }),
    normalizedSources: Object.freeze(normalized),
    persistedReportPackage: Object.freeze({
      path: "report/report-content.json",
      packageVersion: packageValue.packageVersion || null,
      findingCount: Array.isArray(packageValue.findings) ? packageValue.findings.length : 0,
      scoringVersion: packageValue.scores?.scoringVersion || scoreSet.scoringVersion || null,
      disposition: "SUPPORTING_CHECKPOINT",
      reason: "Validated persisted package is retained as provenance; canonical ScoreSet and FindingSet remain the report facts authority.",
    }),
    reportManifest: Object.freeze({
      path: "report-v2/manifest.json",
      reportVersion: reportManifest.reportVersion || null,
      reportDesignVersion: reportManifest.reportDesignVersion || null,
      lifecycleStatus: reportManifest.lifecycleStatus || null,
      disposition: "SUPPORTING_CHECKPOINT",
      reason: "Manifest proves the rendered artifact identity and status; it is not a second scoring authority.",
    }),
    narrativeGate: Object.freeze({
      writerInputPath: "report-v2/narrative-v2/writer-input.json",
      writerInputVersion: writerInput.writerInputVersion || null,
      orchestrationPath: "report-v2/narrative-v2/orchestration.json",
      orchestrationVersion: orchestration.orchestrationVersion || null,
      status: orchestration.status || "UNKNOWN",
      passCount: orchestration.passCount || 0,
      finalJudgeDecision: orchestration.finalJudgeResponse?.decision || "UNKNOWN",
      liveUsageArtifactCount: liveUsage.length,
      disposition: "SUPPORTING_GATE",
      reason: "Accepted Writer/Judge prose remains validation-gated; the report renders deterministic canonical facts and records the accepted gate result.",
    }),
  });
}

export async function loadRecoveredReportInputs({ rootDir, auditId }) {
  if (!rootDir || !auditId) throw new Error("rootDir and auditId are required");
  const root = resolve(rootDir);
  const artifacts = Object.create(null);
  for (const path of JSON_ARTIFACTS) {
    artifacts[path] = await readArtifact(root, path);
    assertAuditIdentity(artifacts[path], auditId);
  }
  const inventory = [];
  for (const full of await walkFiles(root)) {
    const bytes = await readFile(full);
    inventory.push({
      path: relative(root, full).replaceAll("\\", "/"),
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return Object.freeze({
    auditRequest: artifacts["canonical/audit-request.json"].value,
    capabilityEvidence: artifacts["canonical/capability-evidence.json"].value,
    decisionEvidence: artifacts["canonical/decision-evidence.json"].value,
    findings: artifacts["canonical/findings.json"].value,
    scoreSet: artifacts["canonical/scores.json"].value,
    projection: buildProjection({ auditId, artifacts, inventory }),
    inventory: Object.freeze(inventory),
  });
}

export default { loadRecoveredReportInputs };

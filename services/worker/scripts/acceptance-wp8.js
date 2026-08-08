#!/usr/bin/env node
/**
 * WP8 Acceptance — Compact Report Content Package
 * Proves: schema validation, determinism, artifact persistence, fail-closed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function sha256(s) { return createHash("sha256").update(s).digest("hex"); }
function pass(l) { console.log("  [x] PASS — " + l); }
function fail(l, d) { console.error("  [ ] FAIL — " + l); if (d) console.error("        " + d); process.exitCode = 1; }
function header(t) { console.log("\n" + t + "\n" + "─".repeat(t.length)); }

// Import build-package
let buildReportContentPackage, serializePackage, packageSha256;
try {
  const mod = await import(pathToFileURL(join(ROOT, "src", "report-content", "build-package.js")).href);
  buildReportContentPackage = mod.buildReportContentPackage;
  serializePackage = mod.serializePackage;
  packageSha256 = mod.packageSha256;
  pass("Module imported");
} catch (err) { fail("Import", err.message); process.exit(1); }

// Schema
let validate;
try {
  const Ajv = (await import("ajv/dist/2020.js")).default;
  const addFormats = (await import("ajv-formats")).default;
  const schema = JSON.parse(readFileSync(join(ROOT, "src", "contracts", "report-content.schema.json"), "utf-8"));
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  validate = ajv.compile(schema);
  pass("Schema compiled");
} catch (err) { fail("Schema", err.message); process.exit(1); }

// Fixtures
const auditRequest = { auditId: "550e8400-e29b-41d4-a716-446655440099", businessName: "WP8 Test Co", targetUrl: "https://wp8test.com/" };
const evidence = JSON.parse(readFileSync(join(ROOT, "test-fixtures", "scoring", "deterministic-evidence-fixture.json"), "utf-8"));
const findingsFromFile = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, "test-fixtures", "wp8", "findings-fixture.json"), "utf-8")); }
  catch { /* build from evidence */ return []; }
})();
const scoreSetFromFile = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, "test-fixtures", "wp8", "scores-fixture.json"), "utf-8")); }
  catch { /* build minimal */ return {}; }
})();

// Build minimal findings/scoreSet if fixtures missing
let findings, scoreSet;
try {
  const scoring = await import(pathToFileURL(join(ROOT, "src", "scoring", "vantage-score.js")).href);
  const model = scoring.scoreAudit({ targetUrl: "https://wp8test.com/", businessName: "WP8 Test Co", competitors: [] }, evidence);
  findings = model.findings;
  scoreSet = {
    contractVersion: "1.0.0", scoringVersion: "3.0.0", generatedAt: model.generatedAt,
    scores: model.scores, bands: model.bands, readinessStatus: model.readinessStatus,
    readinessStatusDetail: model.readinessStatusDetail, showNumericScore: model.showNumericScore,
    assessedWeight: model.assessedWeight, evidenceConfidenceScore: model.evidenceConfidenceScore,
    rootCause: model.rootCause, renderingDiagnostics: model.renderingDiagnostics || [],
  };
  pass("Built findings/scoreSet from deterministic fixture");
} catch (err) { fail("Score build", err.message); process.exit(1); }

// ===========================================================================
header("1. Schema validation");
const pkg = buildReportContentPackage({ auditRequest, canonicalEvidence: evidence, findings, scoreSet });
const v = validate(pkg);
if (v) pass("SCHEMA-01: Package validates against report-content.schema.json");
else fail("SCHEMA-01", JSON.stringify(validate.errors));

const pkgWithExtra = { ...pkg, _bogus: true };
if (!validate(pkgWithExtra)) pass("SCHEMA-01: additionalProperties:false catches extra keys");
else fail("SCHEMA-01", "Extra property not rejected");

// ===========================================================================
header("2. Three-run byte-identical determinism");
const pkgs = [];
const hashes = [];
for (let i = 0; i < 3; i++) {
  const p = buildReportContentPackage({ auditRequest, canonicalEvidence: evidence, findings, scoreSet });
  pkgs.push(p);
  hashes.push(packageSha256(p));
}
if (hashes[0] === hashes[1] && hashes[1] === hashes[2]) pass("REPLAY-01: Three-run SHA-256 match: " + hashes[0].slice(0, 16) + "...");
else fail("REPLAY-01", "SHA mismatch: " + hashes.join(", "));
const s0 = serializePackage(pkgs[0]);
const s1 = serializePackage(pkgs[1]);
const s2 = serializePackage(pkgs[2]);
if (s0.length === s1.length && s1.length === s2.length) pass("REPLAY-01: Byte-identical: " + s0.length + " bytes each");
else fail("REPLAY-01", "Length mismatch");
if (s0 === s1 && s1 === s2) pass("REPLAY-01: String-exact match across 3 runs");
else fail("REPLAY-01", "String mismatch");

// ===========================================================================
header("3. Input/output verification");
if (pkg.auditId === auditRequest.auditId) pass("IDENT-01: auditId matches");
else fail("IDENT-01", pkg.auditId);
if (pkg.business.name === auditRequest.businessName) pass("IDENT-01: businessName matches");
else fail("IDENT-01", pkg.business.name);
if (pkg.packageVersion === "1.0.0") pass("Version: packageVersion 1.0.0");
else fail("Version", pkg.packageVersion);

// ===========================================================================
header("4. Score copy verification");
const scoresOk = pkg.scores.trust === scoreSet.scores.trust &&
  pkg.scores.performance === scoreSet.scores.performance &&
  pkg.scores.conversionReadiness === scoreSet.scores.conversionReadiness;
if (scoresOk) pass("SCORE-01: Score values copied exactly from ScoreSet");
else fail("SCORE-01", "Score mismatch");

if (pkg.assessedWeight === scoreSet.assessedWeight) pass("SCORE-01: assessedWeight copied exactly");
else fail("SCORE-01", "assessedWeight mismatch: " + pkg.assessedWeight + " vs " + scoreSet.assessedWeight);

// ===========================================================================
header("5. Finding ID verification");
const inputIds = new Set(findings.map(function(f) { return f.findingId; }));
const allIdsExist = pkg.findings.every(function(f) { return inputIds.has(f.findingId); });
if (allIdsExist) pass("FIND-01: All " + pkg.findings.length + " finding IDs exist in input set");
else fail("FIND-01", "Unknown finding ID found");

// ===========================================================================
header("6. Source status verification");
const ss = pkg.sourceStatus;
if (ss.website && ss.performance && ss.competitors && ss.backlinks && ss.ga4 && ss.gsc) {
  pass("STATUS-01: All 6 source statuses present");
} else fail("STATUS-01", "Missing source status");
if (ss.website === evidence.site.sourceStatus) pass("STATUS-01: website status = " + ss.website);
else fail("STATUS-01", "website: " + ss.website + " vs " + evidence.site.sourceStatus);

// ===========================================================================
header("7. RAW-01: No raw provider data, secrets, HTML, CSS");
const pkgStr = JSON.stringify(pkg);
const forbidden = ["_sourceStatus", "rawArtifactRef", "_crawlSuppressed", "evidenceVersion"];
let rawOk = true;
forbidden.forEach(function(k) { if (pkgStr.includes(k)) { fail("RAW-01", "Contains: " + k); rawOk = false; } });
if (rawOk) pass("RAW-01: No raw provider/internal keys in package");
const htmlPatterns = [/<div/i, /<html/i, /<style/i, /<script/i, /<body/i, /font-size/, /margin/, /padding/, /color:/, /display:/];
let htmlOk = true;
htmlPatterns.forEach(function(p) { if (p.test(pkgStr)) { fail("RAW-01", "Contains HTML/CSS: " + p); htmlOk = false; } });
if (htmlOk) pass("RAW-01: No HTML/CSS/layout in package");

// ===========================================================================
header("8. Artifact persistence (ART-01)");
let store, persistOk = true;
try {
  const storeMod = await import(pathToFileURL(join(ROOT, "src", "storage", "memory-artifact-store.js")).href);
  store = storeMod.createMemoryArtifactStore();
  pass("Memory artifact store created");
} catch (err) { fail("Store", err.message); persistOk = false; }

if (store) {
  try {
    const keyMod = await import(pathToFileURL(join(ROOT, "src", "storage", "artifact-key.js")).href);
    const scope = { tenantId: "wp8", clientId: "test", auditId: auditRequest.auditId };
    const bytes = Buffer.from(serializePackage(pkg), "utf-8");
    const record = await store.put({ bytes, contentType: "application/json", scope: { ...scope, category: "report", artifactName: "report-content.json" } });
    if (record.key.includes("report/report-content.json")) pass("ART-01: Key includes report/report-content.json");
    else fail("ART-01", "Key: " + record.key);
    const rb = await store.get(record.key);
    if (rb && rb.length === bytes.length) pass("ART-01: Read-back byte count matches");
    else fail("ART-01", "Read-back mismatch");
    if (sha256(rb.toString()) === record.sha256) pass("ART-01: Read-back SHA matches stored SHA");
    else fail("ART-01", "SHA mismatch");
    const verified = await store.verify(record);
    if (verified) pass("ART-01: store.verify() returns true");
    else fail("ART-01", "verify() failed");
  } catch (err) { fail("ART-01", err.message); persistOk = false; }
}

// ===========================================================================
header("9. Fail-closed (FAIL-01)");
try { buildReportContentPackage({ auditRequest: {}, canonicalEvidence: evidence, findings, scoreSet }); fail("FAIL-01", "Should have thrown"); }
catch (e) { if (e.message.includes("auditId")) pass("FAIL-01: Missing auditId throws"); else fail("FAIL-01", e.message); }

// ===========================================================================
header("10. Static analysis: no n8n/LLM/network");
try {
  const src = readFileSync(join(ROOT, "src", "report-content", "build-package.js"), "utf-8");
  const codeLines = src.split("\n").filter(function(l) { var t = l.trim(); return !t.startsWith("//") && !t.startsWith("*"); }).join("\n").toLowerCase();
  const forbiddenRefs = ["openai", "anthropic", "n8n", "fetch(", "render-report"];
  let staticOk = true;
  forbiddenRefs.forEach(function(r) { if (codeLines.includes(r)) { fail("N8N-01", "Contains: " + r); staticOk = false; } });
  if (staticOk) pass("N8N-01: Zero n8n/LLM/network references in build-package.js");
} catch (err) { fail("N8N-01", err.message); }

// ===========================================================================
console.log("\n" + "=".repeat(60));
console.log("WP8 ACCEPTANCE REPORT");
console.log("=".repeat(60));
console.log("\nPackage SHA-256: " + hashes[0]);
console.log("Package bytes:   " + s0.length);
console.log("Findings:        " + pkg.findings.length);
console.log("Schema valid:    " + v);

if (process.exitCode === undefined || process.exitCode === 0) {
  console.log("\nWP8 ACCEPTANCE: PASS");
  console.log("Deterministic ReportContentPackage verified.");
  console.log("Schema-valid. Artifact persisted. Zero raw data leakage.");
  console.log("Zero n8n/LLM calls. Three-run byte repeatability confirmed.");
} else {
  console.log("\nWP8 ACCEPTANCE: FAIL");
}
process.exit(process.exitCode || 0);

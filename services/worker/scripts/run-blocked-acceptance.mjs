#!/usr/bin/env node
/**
 * DataForSEO On-Page — Internal BLOCKED Acceptance Script
 *
 * Uses DataForSEO custom_robots_txt to create a controlled block.
 * Internal acceptance only — must never be exposed through normal UI.
 *
 * Usage:
 *   node scripts/run-blocked-acceptance.mjs
 *
 * Requires: VANTAGE_WEBHOOK_SECRET or Railway CLI access.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const SECRET = process.env.VANTAGE_WEBHOOK_SECRET
  || execSync('railway run -s vantage-platform "printenv VANTAGE_WEBHOOK_SECRET"', { encoding: "utf8" }).trim();

const BLOCKED_TARGET = "https://example.com";
const CUSTOM_ROBOTS = "User-agent: *\nDisallow: /";

console.log("=== DataForSEO On-Page BLOCKED Acceptance Test ===");
console.log(`  Target: ${BLOCKED_TARGET}`);
console.log(`  Custom robots: ${CUSTOM_ROBOTS.replace(/\n/g, " | ")}`);
console.log("");

// ── Step 1: Create audit with custom_robots_txt override ──────────────
console.log("Creating BLOCKED audit...");
const body = JSON.stringify({
  targetUrl: BLOCKED_TARGET,
  businessName: "blocked-acceptance-test",
  location: "Global",
  language: "en",
  customRobotsTxt: CUSTOM_ROBOTS,
});
const createResp = await fetch("https://vantage-platform-production.up.railway.app/audits", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-vantage-secret": SECRET },
  body,
});
const createData = await createResp.json();
if (createData.error) { console.error("Audit creation failed:", createData.error); process.exit(1); }
const { runId, slug } = createData;
console.log(`  Run ID: ${runId}  Slug: ${slug}`);
console.log(`  Initial website: ${createData.evidence?.website}`);
console.log(`  Scores: tech=${createData.scores?.technical} contentDepth=${createData.scores?.contentDepth}`);

// ── Step 2: Poll for completion ─────────────────────────────────────
console.log("\nWaiting for audit to finish...");
for (let attempt = 0; attempt < 30; attempt++) {
  await new Promise(r => setTimeout(r, 10000));
  const r = await fetch(`https://vantage-platform-production.up.railway.app/audits/${runId}?slug=${slug}`, { headers: { "x-vantage-secret": SECRET } });
  const d = await r.json();
  if (d.status !== "draft" || d.lifecycleStatus === "approved") { console.log(`  Done: ${d.status}`); break; }
  if (attempt % 5 === 0) console.log(`  Poll ${attempt + 1}...`);
}

// ── Step 3: Read audit.json ──────────────────────────────────────────
console.log("\nReading audit.json...");
let auditData = null;
let rawBytes = 0;
try {
  const result = execSync(
    `railway ssh -s vantage-platform "node -e 'const fs=require(\\\"fs\\\");const dirs=fs.readdirSync(\\\"/app/artifacts/reports/${slug}\\\");const latest=dirs.sort().reverse()[0];const d=JSON.parse(fs.readFileSync(\\\"/app/artifacts/reports/${slug}/\\\"+latest+\\\"/audit.json\\\",\\\"utf8\\\"));const s=d.evidence?.site||{};console.log(JSON.stringify({runId:latest,sourceStatus:s.sourceStatus,pageCount:s.pageCount,domain:s.domain,_sourceStatus:s._sourceStatus,rawSha256:s._rawSha256,rawBytes:s._rawBytes,rawArtifactRef:s.rawArtifactRef}))'"`,
    { encoding: "utf8", timeout: 15000 }
  );
  const lines = result.split("\n").filter(l => l.startsWith("{") && l.includes('"runId"'));
  if (lines.length > 0) auditData = JSON.parse(lines[0]);
  rawBytes = auditData?.rawBytes || 0;
} catch (e) { console.error("SSH error:", e.message?.slice(0, 100)); }

// ── Step 4: Verify raw artifact via SSH ─────────────────────────────
let storedHash = null;
if (auditData?.rawArtifactRef) {
  try {
    const rawPath = auditData.rawArtifactRef.split("?")[0];
    const catCmd = `railway ssh -s vantage-platform "cat /app/artifacts/reports/${rawPath}"`;
    const rawContent = execSync(catCmd, { encoding: "utf8", timeout: 10000 });
    storedHash = createHash("sha256").update(rawContent).digest("hex");
  } catch { /* file may not exist */ }
}

// ── Step 5: Strict verification ──────────────────────────────────────
console.log("\n=== Verification ===");
let pass = 0;
let fail = 0;
function chk(label, ok, detail) {
  if (ok) { pass++; console.log(`  PASS: ${label}`); }
  else { fail++; console.log(`  FAIL: ${label} — ${detail || "unexpected"}`); }
}

if (auditData) {
  chk("sourceStatus === BLOCKED",
    auditData.sourceStatus === "BLOCKED",
    `got "${auditData.sourceStatus}"`);

  chk("pageCount is 0",
    auditData.pageCount === 0,
    `got ${auditData.pageCount}`);

  chk("provider evidence exists",
    !!auditData._sourceStatus?.provider,
    "no _sourceStatus");

  chk("raw artifact SHA-256 present",
    typeof auditData.rawSha256 === "string" && auditData.rawSha256.length >= 64,
    `got "${auditData.rawSha256?.slice(0, 20) || 'none'}..."`);

  chk("raw artifact bytes > 0",
    rawBytes > 0,
    `got ${rawBytes}`);

  chk("rawArtifactRef is a real path",
    (auditData.rawArtifactRef || "").startsWith("blocked-acceptance-test/"),
    `got "${auditData.rawArtifactRef}"`);

  chk("stored file SHA-256 matches _rawSha256",
    storedHash === auditData.rawSha256,
    storedHash
      ? `stored=${storedHash.slice(0,16)} vs _rawSha256=${auditData.rawSha256?.slice(0,16)}`
      : "could not read stored file");

  chk("crawl-dependent score is null (Not Assessed)",
    createData.scores?.contentDepth === null || createData.scores?.contentDepth === undefined,
    `contentDepth=${createData.scores?.contentDepth}`);

  chk("crawl-dependent score NOT zero",
    createData.scores?.contentDepth !== 0,
    `contentDepth=${createData.scores?.contentDepth} (must not be zero)`);

  chk("FAILED is not accepted as BLOCKED",
    auditData.sourceStatus !== "FAILED",
    "sourceStatus is FAILED — must be BLOCKED");
} else {
  chk("audit data available", false, "SSH failed, no audit data");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(`Run ID: ${runId}`);
process.exit(fail > 0 ? 1 : 0);

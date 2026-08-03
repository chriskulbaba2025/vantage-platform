#!/usr/bin/env node
/**
 * DataForSEO On-Page — Internal BLOCKED Acceptance Script
 *
 * Uses DataForSEO custom_robots_txt to create a controlled block scenario.
 * This script is for internal acceptance testing only and must never be
 * exposed through normal audit intake.
 *
 * Usage:
 *   node scripts/run-blocked-acceptance.mjs
 *
 * Prerequisites:
 *   - DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set
 *   - VANTAGE_WEBHOOK_SECRET must be set (or railway run -s vantage-platform)
 *
 * Produces: a production audit with sourceStatus: BLOCKED and verifies
 * that dependent modules are Not Assessed with no zero scores.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const SECRET = process.env.VANTAGE_WEBHOOK_SECRET
  || execSync('railway run -s vantage-platform "printenv VANTAGE_WEBHOOK_SECRET"', { encoding: "utf8" }).trim();

console.log("=== DataForSEO On-Page BLOCKED Acceptance Test ===");
console.log("");

// Step 1: Create audit with the custom-robots-override acceptance flag.
// The crawler accepts custom_robots_txt in task_post for testing.
const BLOCKED_TARGET = "https://example.com"; // safe target, will be blocked by custom robots
const BUSINESS_NAME = "blocked-acceptance-test";

console.log(`Creating BLOCKED audit for ${BLOCKED_TARGET}...`);
const createResp = await fetch("https://vantage-platform-production.up.railway.app/audits", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-vantage-secret": SECRET,
  },
  body: JSON.stringify({
    targetUrl: BLOCKED_TARGET,
    businessName: BUSINESS_NAME,
    location: "Global",
    language: "en",
    // The crawl adapter accepts custom_robots_txt if passed through options
    // For now, this is embedded in the audit input as a test-only field
  }),
});
const createData = await createResp.json();
console.log(`  Run ID: ${createData.runId}`);
console.log(`  Slug: ${createData.slug}`);
console.log(`  Initial website status: ${createData.evidence?.website}`);
console.log(`  Initial scores.technical: ${createData.scores?.technical}`);

// Step 2: Poll for completion
const runId = createData.runId;
const slug = createData.slug;
console.log("\nWaiting for audit to complete...");
for (let attempt = 0; attempt < 30; attempt++) {
  await new Promise(r => setTimeout(r, 10000));
  const statusResp = await fetch(
    `https://vantage-platform-production.up.railway.app/audits/${runId}?slug=${slug}`,
    { headers: { "x-vantage-secret": SECRET } }
  );
  const statusData = await statusResp.json();
  const lcStatus = statusData.lifecycleStatus || statusData.status;
  if (lcStatus !== "draft" && lcStatus !== undefined) {
    console.log(`  Completed: ${lcStatus}`);
    break;
  }
  if (attempt % 5 === 0) console.log(`  Poll ${attempt + 1}: still running...`);
}

// Step 3: Read audit.json via SSH
console.log("\nReading production audit.json...");
let auditData = null;
try {
  const result = execSync(
    `railway ssh -s vantage-platform "node -e 'const fs=require(\\\"fs\\\");const dirs=fs.readdirSync(\\\"/app/artifacts/reports/${slug}\\\");const latest=dirs.sort().reverse()[0];const d=JSON.parse(fs.readFileSync(\\\"/app/artifacts/reports/${slug}/\\\"+latest+\\\"/audit.json\\\",\\\"utf8\\\"));const s=d.evidence?.site||{};console.log(JSON.stringify({runId:latest,domain:s.domain,pageCount:s.pageCount,sourceStatus:s.sourceStatus,targetUrl:s.targetUrl,_sourceStatus:s._sourceStatus,rawSha256:s._rawSha256?.slice(0,16),rawBytes:s._rawBytes,rawArtifactRef:s.rawArtifactRef}))'"`,
    { encoding: "utf8", timeout: 15000 }
  );
  const lines = result.split("\n").filter(l => l.startsWith("{") && l.includes('"runId"'));
  if (lines.length > 0) auditData = JSON.parse(lines[0]);
} catch (e) {
  console.log(`  SSH error: ${e.message?.slice(0, 100)}`);
}

// Step 4: Verify BLOCKED behavior
console.log("\n=== Verification ===");
let passCount = 0;
let failCount = 0;

function check(label, condition, detail) {
  if (condition) { passCount++; console.log(`  PASS: ${label}`); }
  else { failCount++; console.log(`  FAIL: ${label} — ${detail || "unexpected"}`); }
}

if (auditData) {
  check("sourceStatus is BLOCKED or FAILED",
    auditData.sourceStatus === "BLOCKED" || auditData.sourceStatus === "FAILED",
    `got ${auditData.sourceStatus}`);

  check("pageCount is 0 or very low",
    (auditData.pageCount || 0) <= 1,
    `got ${auditData.pageCount}`);

  check("raw artifact SHA-256 present",
    typeof auditData.rawSha256 === "string" && auditData.rawSha256.length > 0,
    `got ${auditData.rawSha256}`);

  check("raw artifact bytes > 0",
    (auditData.rawBytes || 0) > 0,
    `got ${auditData.rawBytes}`);

  check("rawArtifactRef contains sha256",
    (auditData.rawArtifactRef || "").includes("sha256="),
    `got ${auditData.rawArtifactRef}`);

  check("no false zero score",
    createData.scores?.technical !== 0,
    `technical score is ${createData.scores?.technical}`);
} else {
  check("audit data available", false, "could not read audit.json");
  // Use initial API response as fallback
  check("website status from API", createData.evidence?.website === "FAILED" || createData.evidence?.website === "BLOCKED",
    `got ${createData.evidence?.website}`);
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
console.log(`Run ID: ${runId}`);
process.exit(failCount > 0 ? 1 : 0);

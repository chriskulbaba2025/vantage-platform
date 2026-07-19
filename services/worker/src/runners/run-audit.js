#!/usr/bin/env node
import { runAudit } from "../audit/run-audit.js";

function parseArgs(argv) {
  const out = { competitors: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--url" || flag === "--target") out.targetUrl = argv[++i];
    else if (flag === "--business") out.businessName = argv[++i];
    else if (flag === "--location") out.location = argv[++i];
    else if (flag === "--language") out.language = argv[++i];
    else if (flag === "--goal") out.primaryGoal = argv[++i];
    else if (flag === "--competitors") out.competitors = (argv[++i] || "").split(",").map((x) => x.trim()).filter(Boolean);
  }
  return out;
}

const input = parseArgs(process.argv.slice(2));
if (!input.targetUrl) {
  console.error("Usage: npm run audit -- --url https://example.com [--business Name] [--competitors a.com,b.com,c.com]");
  process.exit(1);
}
const result = await runAudit(input);
console.log(JSON.stringify({
  status: result.status,
  runId: result.runId,
  slug: result.slug,
  conversionReadiness: result.model.scores.conversionReadiness,
  storage: result.storage,
}, null, 2));

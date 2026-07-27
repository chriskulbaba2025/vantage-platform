#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit, submitReview, approveAudit } from "../src/audit/run-audit.js";
import { createLocalReportStore } from "../src/storage/report-store.js";
import { qualifyCandidate, qualifyGap } from "../src/evidence/competitor-opportunity-layer.js";
import { validateCompetitorDecisions, buildCompetitorOverrides } from "../src/audit/review-gate.js";
import { SOURCE_STATUS } from "../src/scoring/evidence-contracts.js";

const NOW = new Date().toISOString();
let pass = true; const scenarios = [];
console.log("\n=== Task 9 Acceptance Harness ===\nStarted: " + NOW + "\n");

// Scenarios 1-3: standalone unit checks
try { const r = qualifyCandidate({ candidateUrl: "https://c.example/s", domain: "c.example", topic: "consulting", pageType: "service", geographicContext: "Toronto", discoverySource: "serp" }, { location: "Toronto", services: ["Consulting"] }); scenarios.push({ name: "Qualification gate", ok: r.passed }); if (!r.passed) pass = false; } catch (e) { console.log("FAIL: qual gate — " + e.message); pass = false; }
try { const r = qualifyCandidate({ pageType: "directory", topic: "c" }, { services: ["C"] }); scenarios.push({ name: "Directory exclusion", ok: !r.passed }); if (r.passed) pass = false; } catch (e) { console.log("FAIL: directory — " + e.message); pass = false; }
try { const r = qualifyGap("c", { candidateUrl: "https://c.example", domain: "c.example", topic: "c", pageType: "service", hasSchema: ["rs"] }, ["c"], ["Services"]); scenarios.push({ name: "Gap rule", ok: r.passed }); if (!r.passed) pass = false; } catch (e) { console.log("FAIL: gap — " + e.message); pass = false; }
try { const { valid } = validateCompetitorDecisions([{ candidateUrl: "https://c.example", decision: "approved", reason: "x" }], new Set(["https://c.example"])); scenarios.push({ name: "Decision validation", ok: valid }); if (!valid) pass = false; } catch (e) { console.log("FAIL: decision — " + e.message); pass = false; }
try { const { valid, errors } = validateCompetitorDecisions([{ candidateUrl: "https://u.example", decision: "approved", reason: "x" }], new Set(["https://c.example"])); scenarios.push({ name: "Unknown candidate rejection", ok: !valid && errors.some(e => e.includes("Unknown")) }); if (valid) pass = false; } catch (e) { console.log("FAIL: unknown — " + e.message); pass = false; }

// Scenarios 6-12: full production + re-review workflow
try {
  const dir = await mkdtemp(join(tmpdir(), "vantage-accept-"));
  const store = createLocalReportStore({ baseDir: dir });
  const S = { evidenceVersion:"1.0.0", source:"dfs", sourceStatus:SOURCE_STATUS.AVAILABLE, targetUrl:"https://x.com/", domain:"x.com", pageCount:12, totalWords:2000, averageWords:500, missingTitles:0, missingDescriptions:0, missingCanonicals:0, h1Missing:0, h1Multiple:0, imageCount:5, imagesMissingAlt:0, imagesMissingDimensions:0, schemaTypes:["Organization","Service"], forms:[], ctas:[{text:"B",url:"https://x.com/b",kind:"link"}], externalCtas:[], socialLinks:[], internalLinkCount:5, brokenInternalLinks:[], platform:"WP", services:["Consulting","Coaching"], topicKeywords:["business consulting"], securityHeaders:{xFrameOptions:true,xContentTypeOptions:true,referrerPolicy:true,contentSecurityPolicy:false}, trust:{testimonials:true,credentials:true,caseStudies:false,faq:true,pricing:true,policies:true,contact:true}, limitations:[], pages:[{title:"H",language:"en",headings:{h1:["Home"],h2:[],h3:[],h4:[]},responseHeaders:{}}], collectedAt:NOW, coverage:{requested:12,completed:12,failed:0}, _sourceStatus:{provider:"dfs",adapterVersion:"1.0.0",startedAt:NOW,completedAt:NOW,returnedRecordCount:12,expectedRecordCount:12} };
  const P = { evidenceVersion:"1.0.0", source:"psi", sourceStatus:SOURCE_STATUS.AVAILABLE, mobile:{status:SOURCE_STATUS.AVAILABLE,source:"psi",scores:{performance:75},metrics:{}}, desktop:{status:SOURCE_STATUS.AVAILABLE,source:"psi",scores:{performance:92},metrics:{}}, fieldData:{}, limitations:[], collectedAt:NOW, coverage:{requested:2,completed:2,failed:0}, _sourceStatus:{provider:"psi",adapterVersion:"1.0.0",returnedRecordCount:2,expectedRecordCount:2} };
  const N = { evidenceVersion:"1.0.0", source:"none", sourceStatus:SOURCE_STATUS.NOT_CONNECTED, status:SOURCE_STATUS.NOT_CONNECTED, collectedAt:NOW, coverage:{requested:0,completed:0,failed:0}, _sourceStatus:{provider:"none",adapterVersion:"1.0.0",returnedRecordCount:0,expectedRecordCount:null} };
  const C = [{ url:"https://c.example/s", status:SOURCE_STATUS.AVAILABLE, evidence:{ services:["Consulting"], pageCount:10, trust:{testimonials:true,credentials:true,caseStudies:false,faq:true,pricing:true,policies:true,contact:true}, schemaTypes:["Service"], ctas:[{text:"B",url:"https://c.example/b",kind:"link"}], forms:[], domain:"c.example", socialLinks:[], topicKeywords:[], pages:[{title:"C",headings:{h1:["Consulting"],h2:[],h3:[],h4:[]},responseHeaders:{}}], platform:"WP" } }];
  const CK = [{id:"source_failures",reviewed:true},{id:"top_ten_findings",reviewed:true},{id:"high_severity",reviewed:true},{id:"competitor_selections",reviewed:true},{id:"root_cause",reviewed:true},{id:"score_eligibility",reviewed:true},{id:"limitations",reviewed:true},{id:"causal_language",reviewed:true},{id:"implementation_feasibility",reviewed:true}];

  function cfg() { return { maxPages:5,browserMode:"never",pagespeedApiKey:"",cruxApiKey:"",dataforseoLogin:"",dataforseoPassword:"",ga4PropertyId:"",googleServiceAccountJson:"",reportsBucket:"",artifactDir:dir,publicReportBaseUrl:"",awsRegion:"ca-central-1",reportsPrefix:"vantage/reports",onpageMaxPages:500,onpageJsRendering:false,onpageBrowserRendering:false,onpagePollTimeoutMs:600000,onpagePollIntervalMs:10000,onpageIncludePatterns:[],onpageExcludePatterns:[],googleClientId:"",googleClientSecret:"",googleRedirectUri:"",vantageEncryptionKey:"" }; }

  // Step 1: Create audit
  const audit = await runAudit({targetUrl:"https://x.com",businessName:"X",competitors:["https://c.example/s"]},{config:cfg(),crawlSite:async()=>S,crawlCompetitors:async()=>C,collectPerformance:async()=>P,collectBacklinks:async()=>N,collectGa4:async()=>N,collectGsc:async()=>N,store,runId:"accept-t9"});
  const opp = audit.model.evidence?.competitorOpportunities;
  const candidates = opp?.candidates?.qualified||[];
  const ok1 = candidates.length>0 && candidates.every(c=>(c.approvalStatus||"pending")==="pending");
  scenarios.push({name:"Step 1 — pending candidates",ok:ok1}); if(!ok1){console.log("FAIL: step1"); pass=false;}

  // Step 2: First review — approve
  const urls = candidates.map(c=>c.candidateUrl);
  await submitReview(store,audit.slug,audit.runId,{reviewer:"auditor",checklist:CK,competitorDecisions:urls.map(u=>({candidateUrl:u,decision:"approved",reason:"OK"})),limitationsAccepted:true});
  const firstLc = await store._readLifecycle(audit.slug,audit.runId);
  const ok2 = firstLc.overrides.some(o=>o.previousValue==="pending"&&o.replacementValue==="approved");
  scenarios.push({name:"Step 2 — previousValue pending→approved",ok:ok2}); if(!ok2){console.log("FAIL: step2"); pass=false;}

  const evAfterFirst = await store.readCommittedArtifacts(audit.slug,audit.runId);
  const ok3 = (evAfterFirst?.evidence?.competitorOpportunities?.gaps||[]).length>0;
  scenarios.push({name:"Step 3 — client-facing gaps exist",ok:ok3}); if(!ok3){console.log("FAIL: step3"); pass=false;}

  // Step 3: Re-review — reject (BEFORE approval)
  await submitReview(store,audit.slug,audit.runId,{reviewer:"auditor",checklist:CK,competitorDecisions:urls.map(u=>({candidateUrl:u,decision:"rejected",reason:"Changed"})),limitationsAccepted:true});
  const rrLc = await store._readLifecycle(audit.slug,audit.runId);
  const hasApproved = rrLc.overrides.some(o=>o.replacementValue==="approved");
  const hasRejected = rrLc.overrides.some(o=>o.replacementValue==="rejected"&&o.previousValue==="approved");
  scenarios.push({name:"Step 4 — prior overrides preserved + new overrides",ok:hasApproved&&hasRejected}); if(!(hasApproved&&hasRejected)){console.log("FAIL: step4"); pass=false;}

  const rrComm = await store.readCommittedArtifacts(audit.slug,audit.runId);
  const ok5 = rrComm && (rrComm.evidence?.competitorOpportunities?.gaps||[]).length===0;
  scenarios.push({name:"Step 5 — rejected gaps removed from client output",ok:ok5}); if(!ok5){console.log("FAIL: step5"); pass=false;}

  const ok6 = rrComm && rrComm.txId;
  scenarios.push({name:"Step 6 — re-review transaction readable",ok:ok6}); if(!ok6){console.log("FAIL: step6"); pass=false;}

  // Step 4: Approve final state
  try {
    await approveAudit(store,audit.slug,audit.runId,"approver");
    scenarios.push({name:"Step 7 — approval succeeds with final committed state",ok:true});
  } catch(e) {
    console.log("FAIL: step7 — "+e.message); pass=false; scenarios.push({name:"Step 7 — approval",ok:false});
  }
  await rm(dir,{recursive:true,force:true});
} catch(e) { console.log("FAIL: workflow — "+e.message); pass=false; }

console.log("");
for(const s of scenarios) console.log("  "+(s.ok?"✓":"✗")+" "+s.name);
console.log("\n=== Acceptance: "+(pass?"PASS":"FAIL")+" ===");
console.log(scenarios.filter(s=>s.ok).length+"/"+scenarios.length+" scenarios passed\n");
process.exit(pass?0:1);

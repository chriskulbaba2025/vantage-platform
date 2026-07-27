#!/usr/bin/env node
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit, submitReview, approveAudit } from "../src/audit/run-audit.js";
import { createLocalReportStore } from "../src/storage/report-store.js";
import { SOURCE_STATUS } from "../src/scoring/evidence-contracts.js";

const NOW = new Date().toISOString();
let pass = true; const sc = [];
console.log("\n=== Task 10 Acceptance Harness ===\n");

const SITE = {
  evidenceVersion:"1.0.0", source:"dfs", sourceStatus:SOURCE_STATUS.AVAILABLE,
  targetUrl:"https://x.com/", domain:"x.com", pageCount:6, totalWords:2500, averageWords:500,
  missingTitles:0, missingDescriptions:0, missingCanonicals:0,
  h1Missing:0, h1Multiple:0, imageCount:3, imagesMissingAlt:0, imagesMissingDimensions:0,
  schemaTypes:["Organization"], forms:[], ctas:[{text:"Contact",url:"https://x.com/contact",kind:"link"}],
  externalCtas:[], socialLinks:[], internalLinkCount:5, brokenInternalLinks:[],
  platform:"WordPress", services:["Consulting","Coaching"],
  topicKeywords:["business consulting"],
  securityHeaders:{xFrameOptions:true,xContentTypeOptions:true,referrerPolicy:true,contentSecurityPolicy:false},
  trust:{testimonials:true,credentials:true,caseStudies:false,faq:true,pricing:true,policies:true,contact:true},
  limitations:[], collectedAt:NOW, coverage:{completed:6,requested:6},
  statusCounts:{200:6}, rawArtifactRef:null,
  pages:[
    {url:"https://x.com/", title:"Home", status:200, rendered:false, language:"en", description:"Home page", canonical:"https://x.com/", headings:{h1:["Example Consulting"],h2:["Our Services","Business Consulting"],h3:[]}, links:[{url:"https://x.com/services/consulting",text:"Consulting"}], images:[], responseHeaders:{}, words:500},
    {url:"https://x.com/services/consulting", title:"Consulting", status:200, rendered:false, language:"en", description:"Consulting services", canonical:"https://x.com/services/consulting", headings:{h1:["Business Consulting"],h2:["Strategy"],h3:[]}, links:[{url:"https://x.com/contact",text:"Book"}], images:[], responseHeaders:{}, words:800},
    {url:"https://x.com/services/coaching", title:"Coaching", status:200, rendered:false, language:"en", description:"Coaching", canonical:"https://x.com/services/coaching", headings:{h1:["Leadership Coaching"],h2:["Executive Coaching"],h3:[]}, links:[], images:[], responseHeaders:{}, words:700},
    {url:"https://x.com/contact", title:"Contact", status:200, rendered:false, language:"en", description:"Contact us", canonical:"https://x.com/contact", headings:{h1:["Get in Touch"],h2:[],h3:[]}, links:[], images:[], responseHeaders:{}, words:200},
    {url:"https://x.com/blog/trends", title:"Trends", status:200, rendered:false, language:"en", description:"Blog", canonical:"https://x.com/blog/trends", headings:{h1:["Consulting Trends"],h2:["AI in Consulting"],h3:[]}, links:[{url:"https://x.com/services/consulting",text:"Services"}], images:[], responseHeaders:{}, words:1200},
    {url:"https://x.com/privacy", title:"Privacy", status:200, rendered:false, language:"en", description:"Privacy policy", canonical:"https://x.com/privacy", headings:{h1:["Privacy Policy"],h2:[],h3:[]}, links:[], images:[], responseHeaders:{}, words:100},
  ],
  _sourceStatus:{provider:"dfs",adapterVersion:"1.0.0",startedAt:NOW,completedAt:NOW,returnedRecordCount:6,expectedRecordCount:6},
};
const PERF = { evidenceVersion:"1.0.0", source:"psi", sourceStatus:SOURCE_STATUS.AVAILABLE, mobile:{status:SOURCE_STATUS.AVAILABLE,source:"psi",scores:{performance:75}}, desktop:{status:SOURCE_STATUS.AVAILABLE,source:"psi",scores:{performance:90}}, fieldData:{}, limitations:[], collectedAt:NOW, coverage:{requested:2,completed:2,failed:0}, _sourceStatus:{provider:"psi",adapterVersion:"1.0.0",returnedRecordCount:2,expectedRecordCount:2} };
const NC = { evidenceVersion:"1.0.0", source:"none", sourceStatus:SOURCE_STATUS.NOT_CONNECTED, status:SOURCE_STATUS.NOT_CONNECTED, collectedAt:NOW,coverage:{requested:0,completed:0,failed:0}, _sourceStatus:{provider:"none",adapterVersion:"1.0.0",returnedRecordCount:0,expectedRecordCount:null} };
const CK = [{id:"source_failures",reviewed:true},{id:"top_ten_findings",reviewed:true},{id:"high_severity",reviewed:true},{id:"competitor_selections",reviewed:true},{id:"internal_link_recommendations",reviewed:true},{id:"root_cause",reviewed:true},{id:"score_eligibility",reviewed:true},{id:"limitations",reviewed:true},{id:"causal_language",reviewed:true},{id:"implementation_feasibility",reviewed:true}];

function cfg(d) { return {maxPages:5,browserMode:"never",pagespeedApiKey:"",cruxApiKey:"",dataforseoLogin:"",dataforseoPassword:"",ga4PropertyId:"",googleServiceAccountJson:"",reportsBucket:"",artifactDir:d,publicReportBaseUrl:"",awsRegion:"ca-central-1",reportsPrefix:"vantage/reports",onpageMaxPages:500,onpageJsRendering:false,onpageBrowserRendering:false,onpagePollTimeoutMs:600000,onpagePollIntervalMs:10000,onpageIncludePatterns:[],onpageExcludePatterns:[],googleClientId:"",googleClientSecret:"",googleRedirectUri:"",vantageEncryptionKey:""}; }

try {
  const dir = await mkdtemp(join(tmpdir(),"vantage-il-"));
  const store = createLocalReportStore({baseDir:dir});

  // 1. Create audit
  const result = await runAudit(
    {targetUrl:"https://x.com",businessName:"X"},
    {config:cfg(dir),crawlSite:async()=>SITE,crawlCompetitors:async()=>[],collectPerformance:async()=>PERF,collectBacklinks:async()=>NC,collectGa4:async()=>NC,collectGsc:async()=>NC,store,runId:"il-acc-001"},
  );

  const il = result.model.evidence?.internalLinkOpportunities;
  const ok1 = il && il.opportunities.length > 0 && il.sourceStatus === SOURCE_STATUS.AVAILABLE;
  sc.push({name:"Audit generates internal-link evidence",ok:ok1});
  if(!ok1){console.log("FAIL: no evidence — opps="+(il?.opportunities?.length||0));pass=false;}

  // Store a specific recommendation for later verification
  const firstRec = il?.opportunities?.[0];
  sc.push({name:"First recommendation has source and target URLs",ok:!!(firstRec?.sourceUrl && firstRec?.targetUrl)});

  // Verify low-confidence excluded
  const lowInClient = il && (il.opportunities||[]).some(o=>o.confidence==="low");
  sc.push({name:"Low-confidence excluded from client-facing",ok:!lowInClient});
  if(lowInClient){console.log("FAIL: low-conf in client output");pass=false;}

  // Verify excludedPages has reasons
  sc.push({name:"excludedPages preserves page-level exclusion reasons",ok:(il?.excludedPages||[]).length>0});

  // 2. Submit review
  await submitReview(store,result.slug,result.runId,{reviewer:"auditor",checklist:CK,limitationsAccepted:true});
  const lc = await store._readLifecycle(result.slug,result.runId);
  const ilItem = lc.review?.checklist?.find(c=>c.id==="internal_link_recommendations");
  sc.push({name:"Review has internal_link_recommendations checklist item reviewed",ok:!!(ilItem&&ilItem.reviewed)});

  // 3. Approve — uses committed transaction
  try {
    const approved = await approveAudit(store,result.slug,result.runId,"approver");
    sc.push({name:"Approval succeeds with committed evidence",ok:approved.lifecycle.status==="approved"});
  }catch(e){
    sc.push({name:"Approval succeeds",ok:false}); console.log("FAIL: approve — "+e.message); pass=false;
  }

  // 4. Read approved internal-link report page
  const pagePath = join(dir,result.slug,result.runId,"internal-links.html");
  const html = await readFile(pagePath,"utf8");
  sc.push({name:"Approved report renders Implementation-Ready recommendations",ok:/Implementation-Ready/.test(html)});
  sc.push({name:"Low-Confidence section absent from report",ok:!/Low-Confidence/.test(html)});

  // 5. Verify specific anchor from crawl evidence appears in approved HTML
  if(firstRec){
    const srcPage = SITE.pages.find(p=>p.url===firstRec.sourceUrl);
    sc.push({name:"Recommended anchor exists in source crawl evidence",ok:!!(srcPage && (srcPage.headings?.h1||[]).concat(srcPage.headings?.h2||[]).concat(srcPage.headings?.h3||[]).includes(firstRec.proposedAnchor))});
  }

  await rm(dir,{recursive:true,force:true});
}catch(e){console.log("FAIL: "+e.message);pass=false;sc.push({name:"Workflow",ok:false});}

console.log("");
for(const s of sc) console.log("  "+(s.ok?"✓":"✗")+" "+s.name);
console.log("\n=== Acceptance: "+(pass?"PASS":"FAIL")+" ===");
console.log(sc.filter(s=>s.ok).length+"/"+sc.length+" scenarios passed\n");
process.exit(pass?0:1);

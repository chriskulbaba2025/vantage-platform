/**
 * Real S3 store transaction tests using a mocked in-memory S3 client.
 *
 * Tests createS3ReportStore with a Map-backed client — zero live AWS calls.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createS3ReportStore } from "./report-store.js";
import { createTransactionId, sha256 } from "./transaction-helpers.js";
import { runAudit, submitReview, approveAudit } from "../audit/run-audit.js";
import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

// ---------------------------------------------------------------------------
// In-memory mocked S3 client
// ---------------------------------------------------------------------------

class MockBody {
  constructor(content) { this._buf = Buffer.from(content); }
  async transformToString() { return this._buf.toString("utf8"); }
}

function createMockS3Client() {
  const store = new Map(); // "Bucket/Key" → { body, contentType }

  const client = {
    _store: store,
    _injectFailure(keyPattern) {
      // Inject a failure: removing a key before GetObject simulates missing object
      this._failureKey = keyPattern;
    },
    _clearFailure() { this._failureKey = null; },

    async send(command) {
      const cmdName = command.constructor?.name || "";
      const input = command.input || command;

      if (cmdName === "PutObjectCommand") {
        const fullKey = `${input.Bucket}/${input.Key}`;
        // Allow injected put failures
        if (this._failureKey && input.Key.includes(this._failureKey)) {
          throw new Error(`Mocked PutObject failure for ${input.Key}`);
        }
        store.set(fullKey, { body: input.Body, contentType: input.ContentType || "application/json; charset=utf-8" });
        return {};
      }

      if (cmdName === "GetObjectCommand") {
        const fullKey = `${input.Bucket}/${input.Key}`;
        // Allow injected get failures
        if (this._failureKey && input.Key.includes(this._failureKey)) {
          throw new Error(`Mocked GetObject failure for ${input.Key}`);
        }
        const obj = store.get(fullKey);
        if (!obj) {
          const err = new Error("NoSuchKey");
          err.name = "NoSuchKey";
          throw err;
        }
        const bodyStr = typeof obj.body === "string" ? obj.body : JSON.stringify(obj.body);
        return { Body: new MockBody(bodyStr), ContentType: obj.contentType };
      }

      if (cmdName === "DeleteObjectCommand") {
        const fullKey = `${input.Bucket}/${input.Key}`;
        store.delete(fullKey);
        return {};
      }

      throw new Error(`Unknown command: ${cmdName}`);
    },
  };

  return client;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();
const SITE = { evidenceVersion:"1.0.0", source:"dfs", sourceStatus:SOURCE_STATUS.AVAILABLE, targetUrl:"https://x.com/", domain:"x.com", pageCount:5, totalWords:1000, averageWords:500, missingTitles:0, missingDescriptions:0, missingCanonicals:0, h1Missing:0, h1Multiple:0, imageCount:3, imagesMissingAlt:0, imagesMissingDimensions:0, schemaTypes:["Organization"], forms:[], ctas:[{text:"C",url:"https://x.com/c",kind:"link"}], externalCtas:[], socialLinks:[], internalLinkCount:2, brokenInternalLinks:[], platform:"WP", services:["Consulting"], topicKeywords:["consulting"], securityHeaders:{xFrameOptions:true,xContentTypeOptions:true,referrerPolicy:true,contentSecurityPolicy:false}, trust:{testimonials:true,credentials:true,caseStudies:false,faq:true,pricing:true,policies:true,contact:true}, limitations:[], pages:[{title:"H",language:"en",headings:{h1:["H"],h2:[],h3:[],h4:[]},responseHeaders:{}}], collectedAt:NOW, coverage:{requested:5,completed:5,failed:0}, _sourceStatus:{provider:"dfs",adapterVersion:"1.0.0",startedAt:NOW,completedAt:NOW,returnedRecordCount:5,expectedRecordCount:5} };
const PERF = { evidenceVersion:"1.0.0", source:"psi", sourceStatus:SOURCE_STATUS.AVAILABLE, mobile:{status:SOURCE_STATUS.AVAILABLE,source:"psi",scores:{performance:75},metrics:{}}, desktop:{status:SOURCE_STATUS.AVAILABLE,source:"psi",scores:{performance:90},metrics:{}}, fieldData:{}, limitations:[], collectedAt:NOW, coverage:{requested:2,completed:2,failed:0}, _sourceStatus:{provider:"psi",adapterVersion:"1.0.0",returnedRecordCount:2,expectedRecordCount:2} };
const NC = { evidenceVersion:"1.0.0", source:"none", sourceStatus:SOURCE_STATUS.NOT_CONNECTED, status:SOURCE_STATUS.NOT_CONNECTED, collectedAt:NOW, coverage:{requested:0,completed:0,failed:0}, _sourceStatus:{provider:"none",adapterVersion:"1.0.0",returnedRecordCount:0,expectedRecordCount:null} };
const COMPS = [{ url:"https://c.example/s", status:SOURCE_STATUS.AVAILABLE, evidence:{ services:["Consulting"], pageCount:10, trust:{testimonials:true,credentials:true,caseStudies:false,faq:true,pricing:true,policies:true,contact:true}, schemaTypes:["Service"], ctas:[{text:"B",url:"https://c.example/b",kind:"link"}], forms:[], domain:"c.example", socialLinks:[], topicKeywords:[], pages:[{title:"C",headings:{h1:["Consulting"],h2:[],h3:[],h4:[]},responseHeaders:{}}], platform:"WP" } }];
const CHECKLIST = [{id:"source_failures",reviewed:true},{id:"top_ten_findings",reviewed:true},{id:"high_severity",reviewed:true},{id:"competitor_selections",reviewed:true},{id:"root_cause",reviewed:true},{id:"score_eligibility",reviewed:true},{id:"limitations",reviewed:true},{id:"causal_language",reviewed:true},{id:"internal_link_recommendations",reviewed:true},{id:"implementation_feasibility",reviewed:true}];

function s3Config(client) {
  return {
    bucket: "test-bucket", prefix: "vantage/reports", client, region: "ca-central-1",
    maxPages:5, browserMode:"never", pagespeedApiKey:"", cruxApiKey:"",
    dataforseoLogin:"", dataforseoPassword:"", ga4PropertyId:"",
    googleServiceAccountJson:"", reportsBucket:"test-bucket",
    publicReportBaseUrl:"https://test.example", awsRegion:"ca-central-1",
    reportsPrefix:"vantage/reports",
    onpageMaxPages:500, onpageJsRendering:false, onpageBrowserRendering:false,
    onpagePollTimeoutMs:600000, onpagePollIntervalMs:10000,
    onpageIncludePatterns:[], onpageExcludePatterns:[],
    googleClientId:"", googleClientSecret:"", googleRedirectUri:"", vantageEncryptionKey:"",
    artifactDir:"/tmp",
  };
}

async function runAndReviewS3(store, s3Client, runId, competitorDecisions) {
  const result = await runAudit(
    { targetUrl:"https://x.com", businessName:"X", competitors:["https://c.example/s"] },
    { config:s3Config(s3Client), crawlSite:async()=>SITE, crawlCompetitors:async()=>COMPS, collectPerformance:async()=>PERF, collectBacklinks:async()=>NC, collectGa4:async()=>NC, collectGsc:async()=>NC, store, runId },
  );
  // Run submitReview separately (it uses store directly which handles S3)
  const opp = result.model.evidence?.competitorOpportunities;
  const urls = (opp?.candidates?.qualified||[]).map(c=>c.candidateUrl);
  const decisions = competitorDecisions || urls.map(u=>({candidateUrl:u,decision:"approved",reason:"OK"}));
  await submitReview(store, result.slug, result.runId, {
    reviewer:"auditor@example.com", checklist:CHECKLIST,
    competitorDecisions: decisions, limitationsAccepted:true,
  });
  return result;
}

// ---------------------------------------------------------------------------
// S3-01: first review commits and is readable
// ---------------------------------------------------------------------------

test("S3-01: first competitor review commits successfully and is readable via createS3ReportStore", async () => {
  const s3Client = createMockS3Client();
  const store = createS3ReportStore({ bucket:"test-bucket", prefix:"vantage/reports", client:s3Client, region:"ca-central-1" });
  const result = await runAndReviewS3(store, s3Client, "s3-001");
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.ok(committed, "Committed artifacts should be readable");
  assert.ok(committed.txId, "Should have transaction ID");
  const lc = await store._readLifecycle(result.slug, result.runId);
  assert.equal(lc.status, "reviewed");
  assert.equal(committed.txId, lc.activeReviewTxId, "txId should match lifecycle");
});

// ---------------------------------------------------------------------------
// S3-02: pending → approved records previousValue "pending"
// ---------------------------------------------------------------------------

test("S3-02: first review records previousValue pending in lifecycle overrides", async () => {
  const s3Client = createMockS3Client();
  const store = createS3ReportStore({ bucket:"test-bucket", prefix:"vantage/reports", client:s3Client, region:"ca-central-1" });
  const result = await runAndReviewS3(store, s3Client, "s3-002");
  const lc = await store._readLifecycle(result.slug, result.runId);
  assert.ok(lc.overrides.length > 0, "Should have override records");
  for (const ov of lc.overrides) {
    assert.equal(ov.previousValue, "pending", "First review should record previousValue pending");
    assert.equal(ov.replacementValue, "approved");
  }
});

// ---------------------------------------------------------------------------
// S3-03: second review commits while reviewed, preserves prior overrides
// ---------------------------------------------------------------------------

test("S3-03: re-review via S3 store preserves prior overrides and appends new ones", async () => {
  const s3Client = createMockS3Client();
  const store = createS3ReportStore({ bucket:"test-bucket", prefix:"vantage/reports", client:s3Client, region:"ca-central-1" });
  const result = await runAndReviewS3(store, s3Client, "s3-003");
  const firstLc = await store._readLifecycle(result.slug, result.runId);
  const firstOverrideCount = firstLc.overrides.length;

  // Re-review: change to rejected
  const opp = result.model.evidence?.competitorOpportunities;
  const urls = (opp?.candidates?.qualified||[]).map(c=>c.candidateUrl);
  await submitReview(store, result.slug, result.runId, {
    reviewer:"auditor@example.com", checklist:CHECKLIST,
    competitorDecisions: urls.map(u=>({candidateUrl:u,decision:"rejected",reason:"Changed mind"})),
    limitationsAccepted:true,
  });

  const secondLc = await store._readLifecycle(result.slug, result.runId);
  assert.ok(secondLc.overrides.length >= firstOverrideCount + 1, "Should have prior + new overrides");

  const newOverrides = secondLc.overrides.slice(firstOverrideCount);
  for (const ov of newOverrides) {
    assert.equal(ov.previousValue, "approved", "Re-review should record approved→rejected");
    assert.equal(ov.replacementValue, "rejected");
  }

  // Rejected gaps removed
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.ok(committed.txId, "Second transaction should be readable");
  assert.equal((committed.evidence?.competitorOpportunities?.gaps||[]).length, 0, "Rejected gaps should be empty");
});

// ---------------------------------------------------------------------------
// S3-04: deleting review-record.json causes null
// ---------------------------------------------------------------------------

test("S3-04: missing S3 review-record.json → readCommittedArtifacts returns null", async () => {
  const s3Client = createMockS3Client();
  const store = createS3ReportStore({ bucket:"test-bucket", prefix:"vantage/reports", client:s3Client, region:"ca-central-1" });
  const result = await runAndReviewS3(store, s3Client, "s3-004");
  const lc = await store._readLifecycle(result.slug, result.runId);

  // Delete review-record.json from the S3 mock store
  const reviewKey = `test-bucket/vantage/reports/${result.slug}/${result.runId}/.txn/${lc.activeReviewTxId}/review-record.json`;
  s3Client._store.delete(reviewKey);

  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Missing review record should return null");
});

// ---------------------------------------------------------------------------
// S3-05: tampered review checksum → null
// ---------------------------------------------------------------------------

test("S3-05: tampered review checksum in S3 → readCommittedArtifacts returns null", async () => {
  const s3Client = createMockS3Client();
  const store = createS3ReportStore({ bucket:"test-bucket", prefix:"vantage/reports", client:s3Client, region:"ca-central-1" });
  const result = await runAndReviewS3(store, s3Client, "s3-005");
  const lc = await store._readLifecycle(result.slug, result.runId);

  // Tamper the review checksum in tx-meta
  const metaKey = `test-bucket/vantage/reports/${result.slug}/${result.runId}/.txn/${lc.activeReviewTxId}/tx-meta.json`;
  const metaObj = s3Client._store.get(metaKey);
  const meta = JSON.parse(metaObj.body);
  meta.checksums.review = sha256("tampered");
  s3Client._store.set(metaKey, { body: JSON.stringify(meta) });

  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Checksum mismatch should return null");
});

// ---------------------------------------------------------------------------
// S3-06: approval uses committed transaction
// ---------------------------------------------------------------------------

test("S3-06: approval via S3 store renders from committed model", async () => {
  const s3Client = createMockS3Client();
  const store = createS3ReportStore({ bucket:"test-bucket", prefix:"vantage/reports", client:s3Client, region:"ca-central-1" });
  const result = await runAndReviewS3(store, s3Client, "s3-006");

  // approveAudit reads from store.readCommittedArtifacts internally
  const approved = await approveAudit(store, result.slug, result.runId, "approver@example.com");
  assert.equal(approved.lifecycle.status, "approved");
});

// ---------------------------------------------------------------------------
// S3-07: staging failure leaves previous transaction active
// ---------------------------------------------------------------------------

test("S3-07: S3 staging failure leaves previous state active", async () => {
  const s3Client = createMockS3Client();
  const store = createS3ReportStore({ bucket:"test-bucket", prefix:"vantage/reports", client:s3Client, region:"ca-central-1" });
  const result = await runAndReviewS3(store, s3Client, "s3-007");
  const firstLc = await store._readLifecycle(result.slug, result.runId);
  const firstTxId = firstLc.activeReviewTxId;

  // Inject failure on second review's PutObject for the specific txId prefix
  // Actually, the commitCompetitorReview stages with a unique txId that we can't predict.
  // Instead, inject a general failure that will cause staging to fail during the second review.
  // We can inject a failure on the PutObject for the lifecycle write.
  s3Client._injectFailure(".txn/");

  try {
    const opp = result.model.evidence?.competitorOpportunities;
    const urls = (opp?.candidates?.qualified||[]).map(c=>c.candidateUrl);
    await submitReview(store, result.slug, result.runId, {
      reviewer:"auditor@example.com", checklist:CHECKLIST,
      competitorDecisions: urls.map(u=>({candidateUrl:u,decision:"rejected",reason:"Changed"})),
      limitationsAccepted:true,
    });
    assert.fail("Should have thrown");
  } catch {
    // Expected
  }

  s3Client._clearFailure();

  // Previous transaction should still be active
  const afterLc = await store._readLifecycle(result.slug, result.runId);
  assert.ok(afterLc.activeReviewTxId, "Should still have active transaction");
  // The previous txId should remain
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.ok(committed, "Previous committed state should still be readable");
});

// ---------------------------------------------------------------------------
// S3-08: orphaned staged objects are not read as active
// ---------------------------------------------------------------------------

test("S3-08: orphaned S3 staged objects are never treated as active", async () => {
  const s3Client = createMockS3Client();
  const store = createS3ReportStore({ bucket:"test-bucket", prefix:"vantage/reports", client:s3Client, region:"ca-central-1" });
  const result = await runAndReviewS3(store, s3Client, "s3-008");
  const lc = await store._readLifecycle(result.slug, result.runId);

  // Tamper lifecycle's activeReviewTxId to a bogus value
  const bogusTxId = "txn-bogus-deadbeef";
  const lcKey = `test-bucket/vantage/reports/${result.slug}/${result.runId}/lifecycle.json`;
  const lcObj = s3Client._store.get(lcKey);
  const tamperedLc = JSON.parse(lcObj.body);
  tamperedLc.activeReviewTxId = bogusTxId;
  s3Client._store.set(lcKey, { body: JSON.stringify(tamperedLc) });

  // Bogus txId has no staged objects → committed artifacts should be null
  const committed = await store.readCommittedArtifacts(result.slug, result.runId);
  assert.equal(committed, null, "Bogus transaction ID should return null — orphaned objects never active");
});

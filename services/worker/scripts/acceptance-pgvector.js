import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresEvidenceGraphRepository } from "../src/evidence/postgres-evidence-graph-repository.js";
import { queryAskPrysm } from "../src/evidence/ask-prysm-query.js";

const url = process.env.PRYSM_PGVECTOR_TEST_DATABASE_URL;
if (!url) throw new Error("PRYSM_PGVECTOR_TEST_DATABASE_URL is required; refusing to use an unspecified database");
const pool = new pg.Pool({ connectionString: url });
const repository = createPostgresEvidenceGraphRepository({ pool });
const vector = [1, ...Array(1535).fill(0)];
const base = { auditId: "00000000-0000-0000-0000-000000000101", nodeType: "EvidenceRecord", source: "fixture", contentHash: "fixture-hash", embedding: vector, embeddingModel: "controlled-semantic-fixture-v1", status: "AVAILABLE", conflictState: "NONE", provenance: "fixture" };
await repository.upsertRetrievalDocuments([
  { ...base, documentId: "tenant-a-site-a", tenantId: "tenant-a", websiteId: "site-a", evidenceId: "ev-a", content: "rapid page loading reduces abandonment" },
  { ...base, documentId: "tenant-a-site-b", tenantId: "tenant-a", websiteId: "site-b", evidenceId: "ev-b", content: "rapid page loading for another site" },
  { ...base, documentId: "tenant-b-site-a", tenantId: "tenant-b", websiteId: "site-a", evidenceId: "ev-c", content: "rapid page loading for another tenant" },
]);
await repository.upsertEvidenceRecords([{ evidenceId: "ev-a", tenantId: "tenant-a", auditId: base.auditId, websiteId: "site-a", source: "fixture", evidenceType: "performance", observedValue: "rapid page loading reduces abandonment", status: "AVAILABLE", conflictState: "NONE" }]);
const vectorHits = await repository.searchSemantic({ tenantId: "tenant-a", auditId: base.auditId, websiteId: "site-a", queryVector: vector, limit: 10 });
assert.deepEqual(vectorHits.map((item) => item.documentId), ["tenant-a-site-a"]);
assert.equal(vectorHits[0].retrievalMethod, "VECTOR");
const lexicalHits = await repository.searchLexical({ tenantId: "tenant-a", auditId: base.auditId, websiteId: "site-a", query: "rapid loading", limit: 10 });
assert.deepEqual(lexicalHits.map((item) => item.documentId), ["tenant-a-site-a"]);
const crossTenant = await repository.searchSemantic({ tenantId: "tenant-b", auditId: base.auditId, websiteId: "site-a", queryVector: vector, limit: 10 });
assert.deepEqual(crossTenant.map((item) => item.documentId), ["tenant-b-site-a"]);
const adapter = { modelVersion: "controlled-semantic-fixture-v1", embed: () => vector };
const ask = await queryAskPrysm({ repository, tenantId: "tenant-a", auditId: base.auditId, websiteId: "site-a", question: "What evidence supports the website feels quick?", embeddingAdapter: adapter });
assert.equal(ask.citations[0].evidenceId, "ev-a");
assert.ok(ask.trace.candidateMethods.some((item) => item.method === "VECTOR"));
console.log(JSON.stringify({ status: "PASS", vectorHits: vectorHits.length, lexicalHits: lexicalHits.length, crossTenantHits: crossTenant.length, askCitations: ask.citations.length, database: new URL(url).pathname.slice(1) }));
await pool.end();

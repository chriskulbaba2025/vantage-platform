import test from "node:test";
import assert from "node:assert/strict";
import { buildRetrievalDocument, contentHash, deterministicTestEmbedding, rankLexical, rankSemantic } from "./hybrid-retrieval.js";
import { buildContextPack, expandGovernedGraph } from "./retrieval-trace.js";
import { createMemoryEvidenceGraphRepository } from "./memory-evidence-graph-repository.js";
import { buildEvidenceGraph } from "./evidence-graph.js";

const scope = { tenantId: "tenant-a", clientId: "client-a", auditId: "00000000-0000-0000-0000-000000000001", websiteId: "site-a" };

test("retrieval documents are deterministic and secrets are excluded", () => {
  const first = buildRetrievalDocument({ ...scope, evidenceId: "ev-1", evidenceType: "conversion", observedValue: "contact form", source: "crawl" });
  const second = buildRetrievalDocument({ ...scope, evidenceId: "ev-1", evidenceType: "conversion", observedValue: "contact form", source: "crawl" });
  assert.equal(first.contentHash, second.contentHash);
  assert.deepEqual(first.embedding, second.embedding);
  assert.equal(buildRetrievalDocument({ ...scope, evidenceId: "secret", evidenceType: "config", apiKey: "do-not-index" }), null);
  assert.equal(contentHash("x"), contentHash("x"));
});

test("embedding generation is idempotent for unchanged content and invalidates on change", () => {
  let calls = 0;
  const adapter = { modelVersion: "controlled-semantic-fixture-v1", embed: () => { calls += 1; return [1, ...Array(1535).fill(0)]; } };
  const record = { ...scope, evidenceId: "ev-idempotent", evidenceType: "performance", observedValue: "rapid page loading" };
  const first = buildRetrievalDocument(record, { embeddingAdapter: adapter });
  const unchanged = buildRetrievalDocument({ ...record, contentHash: first.contentHash, embedding: first.embedding, embeddingModel: first.embeddingModel }, { embeddingAdapter: adapter });
  assert.deepEqual(unchanged.embedding, first.embedding);
  assert.equal(calls, 1);
  buildRetrievalDocument({ ...record, observedValue: "slow page loading", contentHash: first.contentHash, embedding: first.embedding, embeddingModel: first.embeddingModel }, { embeddingAdapter: adapter });
  assert.equal(calls, 2);
});

test("lexical and semantic retrieval are relevance only", () => {
  const docs = [
    buildRetrievalDocument({ ...scope, evidenceId: "ev-exact", evidenceType: "page", observedValue: "contact form conversion action" }),
    buildRetrievalDocument({ ...scope, evidenceId: "ev-other", evidenceType: "page", observedValue: "unrelated pricing content" }),
  ];
  assert.equal(rankLexical(docs, "contact form", 5)[0].evidenceId, "ev-exact");
  assert.ok(rankSemantic(docs, "conversion action", { limit: 5 }).every((item) => typeof item.score === "number"));
  assert.deepEqual(deterministicTestEmbedding("same"), deterministicTestEmbedding("same"));
});

test("semantic acceptance requires meaning-level paraphrase beyond lexical overlap", () => {
  const vectors = {
    "rapid page loading reduces abandonment": [1, ...Array(1535).fill(0)],
    "website feels quick": [1, ...Array(1535).fill(0)],
    "holiday recipes and cooking": [0, 1, ...Array(1534).fill(0)],
  };
  const adapter = { modelVersion: "controlled-semantic-fixture-v1", embed: (text) => {
    const value = String(text);
    if (value.includes("rapid page loading") || value.includes("website feels quick")) return vectors["website feels quick"];
    if (value.includes("holiday recipes")) return vectors["holiday recipes and cooking"];
    return [0, 0, ...Array(1534).fill(0)];
  } };
  const relevant = buildRetrievalDocument({ ...scope, evidenceId: "ev-speed", evidenceType: "performance", observedValue: "rapid page loading reduces abandonment" }, { embeddingAdapter: adapter });
  const unrelated = buildRetrievalDocument({ ...scope, evidenceId: "ev-recipe", evidenceType: "content", observedValue: "holiday recipes and cooking" }, { embeddingAdapter: adapter });
  assert.equal(rankLexical([relevant], "website feels quick", 5).length, 0, "lexical path must not explain paraphrase retrieval");
  const ranked = rankSemantic([relevant, unrelated], "website feels quick", { embeddingAdapter: adapter, limit: 5 });
  assert.equal(ranked[0].evidenceId, "ev-speed");
  assert.equal(ranked.some((item) => item.evidenceId === "ev-recipe"), false);
  assert.equal(relevant.embeddingModel, "controlled-semantic-fixture-v1");
});

test("vector candidates without canonical evidence cannot manufacture citations", async () => {
  const { queryAskPrysm } = await import("./ask-prysm-query.js");
  const adapter = { modelVersion: "controlled-semantic-fixture-v1", embed: () => [1, ...Array(1535).fill(0)] };
  const repository = { async listEvidence() { return []; }, async searchSemantic() { return [{ documentId: "orphan", evidenceId: "missing-canonical", status: "AVAILABLE", conflictState: "NONE", score: 1, retrievalMethod: "VECTOR" }]; }, async searchLexical() { return []; } };
  const result = await queryAskPrysm({ repository, tenantId: "tenant-a", auditId: scope.auditId, question: "What evidence supports this recommendation?", embeddingAdapter: adapter });
  assert.equal(result.citations.length, 0);
  assert.match(result.answer, /not contain enough evidence/i);
});

test("provider outage fails closed to governed retrieval and records the limitation", async () => {
  const { queryAskPrysm } = await import("./ask-prysm-query.js");
  const repository = createMemoryEvidenceGraphRepository();
  await repository.upsertEvidenceRecords([{ ...scope, evidenceId: "ev-lexical", evidenceType: "trust", observedValue: "customer proof", status: "AVAILABLE", conflictState: "NONE" }]);
  const result = await queryAskPrysm({ repository, ...scope, question: "What evidence supports this recommendation?", embeddingAdapter: { modelVersion: "test-embedding-v1", embed: async () => { const error = new Error("offline"); error.category = "network"; throw error; } } });
  assert.equal(result.trace.embeddingStatus.status, "FAILED");
  assert.match(result.limitations[0], /embedding retrieval was unavailable/i);
  assert.equal(result.citations.length, 1, "deterministic fallback may still cite canonical evidence");
});

test("Ask PRYSM combines PostgreSQL-shaped vector candidates with canonical evidence", async () => {
  const { queryAskPrysm } = await import("./ask-prysm-query.js");
  const repository = createMemoryEvidenceGraphRepository();
  const vector = [1, ...Array(1535).fill(0)];
  const adapter = { modelVersion: "controlled-semantic-fixture-v1", embed: () => vector };
  await repository.upsertEvidenceRecords([{ ...scope, evidenceId: "ev-speed", evidenceType: "performance", observedValue: "rapid page loading reduces abandonment", status: "AVAILABLE", conflictState: "NONE" }]);
  await repository.upsertRetrievalDocuments([{ ...scope, documentId: "doc-speed", evidenceId: "ev-speed", content: "rapid page loading reduces abandonment", contentHash: "speed", embedding: vector, embeddingModel: adapter.modelVersion, status: "AVAILABLE", conflictState: "NONE" }]);
  const result = await queryAskPrysm({ repository, ...scope, question: "What evidence supports the website feels quick?", embeddingAdapter: adapter });
  assert.equal(result.citations[0].evidenceId, "ev-speed");
  assert.ok(result.trace.candidateMethods.some((item) => item.method === "VECTOR" && item.candidateId === "doc-speed"));
});

test("graph expansion is scope-first, permitted-edge, bounded, and deterministic", async () => {
  const repository = createMemoryEvidenceGraphRepository();
  const graph = buildEvidenceGraph({ ...scope, websiteUrl: "https://site.test", pages: [{ url: "https://site.test/pricing" }], evidenceRecords: [{ evidenceId: "ev-1", evidenceType: "pricing", pageUrl: "https://site.test/pricing", status: "AVAILABLE" }] });
  await repository.upsertGraph(graph);
  const page = graph.nodes.find((node) => node.nodeType === "Page");
  const result = await expandGovernedGraph({ repository, ...scope, seedNodeIds: [page.nodeId], permittedEdgeTypes: ["CONTAINS", "SUPPORTED_BY"], maxDepth: 1, maxNodes: 2 });
  assert.ok(result.nodes.length <= 2);
  assert.ok(result.edges.every((edge) => ["CONTAINS", "SUPPORTED_BY"].includes(edge.edge_type || edge.edgeType)));
  const pack = buildContextPack({ queryId: "q", scope, query: "pricing", graph: result });
  assert.equal(pack.bounded, true);
});

test("memory retrieval storage is tenant and audit isolated", async () => {
  const repository = createMemoryEvidenceGraphRepository();
  await repository.upsertRetrievalDocuments([{ ...scope, documentId: "a", content: "tenant a", embedding: [1], contentHash: "h" }, { ...scope, tenantId: "tenant-b", documentId: "b", content: "tenant b", embedding: [1], contentHash: "h" }]);
  assert.deepEqual((await repository.listRetrievalDocuments({ tenantId: "tenant-a", auditId: scope.auditId })).map((item) => item.documentId), ["a"]);
});

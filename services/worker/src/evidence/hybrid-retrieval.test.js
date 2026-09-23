import test from "node:test";
import assert from "node:assert/strict";
import { buildRetrievalDocument, contentHash, deterministicEmbedding, rankLexical, rankSemantic } from "./hybrid-retrieval.js";
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

test("lexical and semantic retrieval are relevance only", () => {
  const docs = [
    buildRetrievalDocument({ ...scope, evidenceId: "ev-exact", evidenceType: "page", observedValue: "contact form conversion action" }),
    buildRetrievalDocument({ ...scope, evidenceId: "ev-other", evidenceType: "page", observedValue: "unrelated pricing content" }),
  ];
  assert.equal(rankLexical(docs, "contact form", 5)[0].evidenceId, "ev-exact");
  assert.ok(rankSemantic(docs, "conversion action", { limit: 5 }).every((item) => typeof item.score === "number"));
  assert.deepEqual(deterministicEmbedding("same"), deterministicEmbedding("same"));
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

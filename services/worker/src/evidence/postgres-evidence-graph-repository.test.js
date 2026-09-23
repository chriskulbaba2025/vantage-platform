import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createPostgresEvidenceGraphRepository } from "./postgres-evidence-graph-repository.js";
import { buildEvidenceGraph } from "./evidence-graph.js";

function setup() {
  const db = newDb();
  const Pool = db.adapters.createPg().Pool;
  return createPostgresEvidenceGraphRepository({ pool: new Pool() });
}

test("graph persistence is additive and reloadable", async () => {
  const repo = setup();
  const graph = buildEvidenceGraph({ tenantId: "tenant-a", clientId: "client-a", auditId: "00000000-0000-0000-0000-000000000001", websiteId: "site-a", websiteUrl: "https://example.com", pages: [{ url: "https://example.com/a" }] });
  await repo.upsertGraph(graph);
  await repo.upsertGraph(graph);
  const loaded = await repo.listGraph({ tenantId: "tenant-a", auditId: graph.auditId });
  assert.equal(loaded.nodes.length, graph.nodes.length);
  assert.equal(loaded.edges.length, graph.edges.length);
});

test("tenant-scoped graph queries cannot retrieve another tenant", async () => {
  const repo = setup();
  const graph = buildEvidenceGraph({ tenantId: "tenant-a", clientId: "client-a", auditId: "00000000-0000-0000-0000-000000000002", websiteId: "site-a", websiteUrl: "https://example.com", pages: [{ url: "https://example.com/a" }] });
  await repo.upsertGraph(graph);
  const leaked = await repo.listGraph({ tenantId: "tenant-b", auditId: graph.auditId });
  assert.deepEqual(leaked, { nodes: [], edges: [] });
});

test("evidence records preserve conflict state and tenant scope", async () => {
  const repo = setup();
  await repo.upsertEvidenceRecords([{ evidenceId: "ev-1", tenantId: "tenant-a", auditId: "00000000-0000-0000-0000-000000000003", source: "browser", evidenceType: "schema", status: "CONFLICT", conflictState: "CONFLICT", observedValue: true, normalizedValue: true }]);
  const own = await repo.listEvidence({ tenantId: "tenant-a", auditId: "00000000-0000-0000-0000-000000000003" });
  const other = await repo.listEvidence({ tenantId: "tenant-b", auditId: "00000000-0000-0000-0000-000000000003" });
  assert.equal(own[0].conflict_state, "CONFLICT");
  assert.equal(other.length, 0);
});

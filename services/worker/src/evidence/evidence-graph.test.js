import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceGraph } from "./evidence-graph.js";

const scope = { tenantId: "tenant-a", clientId: "client-a", auditId: "audit-a", websiteId: "site-a", websiteUrl: "https://example.com" };

test("graph nodes and edges are stable and deduplicated", () => {
  const input = { ...scope, pages: [{ url: "https://example.com/pricing" }], evidenceRecords: [{ evidenceId: "ev-1", evidenceType: "pricing", pageUrl: "https://example.com/pricing", status: "AVAILABLE" }], findings: [{ findingId: "finding-1", title: "Pricing clarity", evidenceIds: ["ev-1"], mapsToCanonicalProblemId: "L01" }] };
  const first = buildEvidenceGraph(input);
  const second = buildEvidenceGraph(input);
  assert.deepEqual(first, second);
  assert.equal(first.nodes.filter((n) => n.nodeType === "Page").length, 1);
  assert.equal(first.edges.filter((e) => e.edgeType === "SUPPORTED_BY").length, 2);
});

test("unknown evidence cannot create a false negative graph edge", () => {
  const graph = buildEvidenceGraph({ ...scope, pages: [{ url: "https://example.com/pricing" }], evidenceRecords: [{ evidenceId: "ev-unknown", evidenceType: "pricing", pageUrl: "https://example.com/pricing", status: "UNKNOWN" }], findings: [] });
  assert.equal(graph.edges.some((edge) => edge.edgeType === "NEGATES" || edge.edgeType === "ABSENT"), false);
});

test("inferred edges require evidence and causal claims fail closed", () => {
  const graph = buildEvidenceGraph({ ...scope, findings: [{ findingId: "finding-1", title: "Issue", assertionMode: "INFERRED", evidenceIds: [], mapsToCanonicalProblemId: "L01" }, { findingId: "finding-2", title: "Cause", assertionMode: "INFERRED", evidenceIds: [], causalContractSatisfied: false }] });
  assert.equal(graph.edges.length, 0);
});

test("tenant identity is included in stable node identity", () => {
  const a = buildEvidenceGraph({ ...scope, pages: [{ url: "https://example.com/a" }] });
  const b = buildEvidenceGraph({ ...scope, tenantId: "tenant-b", pages: [{ url: "https://example.com/a" }] });
  assert.notEqual(a.nodes.find((n) => n.nodeType === "Page").nodeId, b.nodes.find((n) => n.nodeType === "Page").nodeId);
});

const DEFAULT_EDGE_TYPES = Object.freeze(["SUPPORTED_BY", "MAPS_TO", "AFFECTS", "ADDRESSES", "PARTICIPATES_IN", "DIFFERS_ON", "RELATED_TO", "CONTAINS"]);

function rowJson(value) { if (typeof value !== "string") return value || {}; try { return JSON.parse(value); } catch { return {}; } }

export async function expandGovernedGraph({ repository, tenantId, auditId, seedNodeIds = [], permittedEdgeTypes = DEFAULT_EDGE_TYPES, maxDepth = 2, maxNodes = 50 } = {}) {
  if (!repository || typeof repository.listGraph !== "function") return { nodes: [], edges: [], traversed: [] };
  if (!tenantId || !auditId || maxDepth < 0 || maxNodes < 1) return { nodes: [], edges: [], traversed: [] };
  const graph = await repository.listGraph({ tenantId, auditId });
  const allowed = new Set(permittedEdgeTypes);
  const nodes = new Map(graph.nodes.filter((node) => node.tenant_id === undefined || (node.tenant_id === tenantId && node.audit_id === auditId)).map((node) => [node.node_id || node.nodeId, node]));
  const edges = graph.edges.filter((edge) => allowed.has(edge.edge_type || edge.edgeType) && (edge.tenant_id === undefined || (edge.tenant_id === tenantId && edge.audit_id === auditId)));
  const selected = new Map();
  const frontier = [...new Set(seedNodeIds)].map((id) => ({ id, depth: 0 }));
  while (frontier.length && selected.size < maxNodes) {
    const current = frontier.shift();
    if (selected.has(current.id) || current.depth > maxDepth) continue;
    const node = nodes.get(current.id);
    if (!node) continue;
    selected.set(current.id, { ...node, attributes: rowJson(node.attributes_json || node.attributes) });
    if (current.depth === maxDepth) continue;
    for (const edge of edges.filter((item) => (item.from_node_id || item.fromNodeId) === current.id || (item.to_node_id || item.toNodeId) === current.id).sort((a, b) => String(a.edge_id || a.edgeId).localeCompare(String(b.edge_id || b.edgeId)))) {
      const next = (edge.from_node_id || edge.fromNodeId) === current.id ? (edge.to_node_id || edge.toNodeId) : (edge.from_node_id || edge.fromNodeId);
      frontier.push({ id: next, depth: current.depth + 1 });
    }
  }
  const selectedEdges = edges.filter((edge) => selected.has(edge.from_node_id || edge.fromNodeId) && selected.has(edge.to_node_id || edge.toNodeId)).sort((a, b) => String(a.edge_id || a.edgeId).localeCompare(String(b.edge_id || b.edgeId))).slice(0, maxNodes * 2);
  return { nodes: [...selected.values()], edges: selectedEdges, traversed: selectedEdges.map((edge) => ({ edgeId: edge.edge_id || edge.edgeId, edgeType: edge.edge_type || edge.edgeType })) };
}

export function buildContextPack({ queryId, scope, query, lexical = [], semantic = [], deterministic = [], graph = {}, evidence = [], excluded = [] } = {}) {
  const material = new Map();
  for (const item of [...deterministic, ...lexical, ...semantic, ...(graph.nodes || [])]) {
    const id = item.evidence_id || item.evidenceId || item.node_id || item.nodeId || item.documentId;
    if (id && !material.has(id)) material.set(id, item);
  }
  return {
    contractVersion: "2.0.0", queryId, query, scope, bounded: true,
    seeds: { deterministic, lexical, semantic }, graph: { nodes: graph.nodes || [], edges: graph.edges || [] },
    canonicalEvidence: evidence.filter((item) => material.has(item.evidence_id || item.evidenceId)),
    material: [...material.values()], excluded,
    limitations: ["Similarity is retrieval relevance only; canonical evidence and conflict state remain authoritative."],
  };
}

export function buildRetrievalTrace({ queryId, scope, query, deterministic = [], lexical = [], semantic = [], graph = {}, evidence = [], excluded = [] } = {}) {
  return { contractVersion: "2.0.0", queryId, query, authorizationScope: scope, retrievalMethods: ["DETERMINISTIC", "LEXICAL", "VECTOR", "GRAPH"], candidateMethods: [
    ...deterministic.map((item) => ({ candidateId: item.evidence_id || item.evidenceId || item.documentId, method: "DETERMINISTIC" })),
    ...lexical.map((item) => ({ candidateId: item.documentId || item.document_id, method: "LEXICAL" })),
    ...semantic.map((item) => ({ candidateId: item.documentId || item.document_id, method: "VECTOR" })),
  ].filter((item) => item.candidateId).sort((a, b) => `${a.method}:${a.candidateId}`.localeCompare(`${b.method}:${b.candidateId}`)), seedNodeIds: [...new Set([...deterministic, ...lexical, ...semantic].map((item) => item.graphNodeId || item.nodeId || item.node_id).filter(Boolean))].sort(), lexicalMatches: lexical.map((item) => ({ documentId: item.documentId || item.document_id, score: item.score, terms: item.matchedTerms })), semanticMatches: semantic.map((item) => ({ documentId: item.documentId || item.document_id, score: item.score, retrievalMethod: "VECTOR" })), traversedEdgeTypes: [...new Set((graph.traversed || []).map((item) => item.edgeType))].sort(), traversalDepth: graph.nodes?.length ? Math.max(0, ...(graph.nodes.map((item) => item.depth || 0))) : 0, evidenceIds: evidence.map((item) => item.evidence_id || item.evidenceId).filter(Boolean).sort(), excluded, bounded: true };
}

export { DEFAULT_EDGE_TYPES };

function scopeKey(tenantId, auditId) { return `${tenantId}\u0000${auditId}`; }

export function createMemoryEvidenceGraphRepository() {
  const evidence = new Map();
  const graphs = new Map();
  async function upsertEvidenceRecords(records = []) {
    for (const record of records) evidence.set(`${record.tenantId}\u0000${record.auditId}\u0000${record.evidenceId}`, { ...record });
  }
  async function upsertGraph({ tenantId, auditId, nodes = [], edges = [] } = {}) {
    const key = scopeKey(tenantId, auditId);
    const current = graphs.get(key) || { nodes: new Map(), edges: new Map() };
    for (const node of nodes) current.nodes.set(node.nodeId, { ...node });
    for (const edge of edges) current.edges.set(edge.edgeId, { ...edge });
    graphs.set(key, current);
  }
  async function listGraph({ tenantId, auditId, nodeType = null, edgeType = null } = {}) {
    const current = graphs.get(scopeKey(tenantId, auditId));
    if (!current) return { nodes: [], edges: [] };
    return {
      nodes: [...current.nodes.values()].filter((node) => !nodeType || node.nodeType === nodeType),
      edges: [...current.edges.values()].filter((edge) => !edgeType || edge.edgeType === edgeType),
    };
  }
  async function listEvidence({ tenantId, auditId, evidenceId = null } = {}) {
    return [...evidence.values()].filter((record) => record.tenantId === tenantId && record.auditId === auditId && (!evidenceId || record.evidenceId === evidenceId));
  }
  return Object.freeze({ upsertEvidenceRecords, upsertGraph, listGraph, listEvidence });
}

export default { createMemoryEvidenceGraphRepository };

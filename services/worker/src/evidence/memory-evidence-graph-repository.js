function scopeKey(tenantId, auditId) { return `${tenantId}\u0000${auditId}`; }

// Match the PostgreSQL repository's row contract on reads. The write-side
// accepts governed application records; consumers must not observe a
// different field vocabulary merely because local composition uses memory.
function asEvidenceRow(record) {
  return {
    evidence_id: record.evidenceId,
    tenant_id: record.tenantId,
    client_id: record.clientId || null,
    audit_id: record.auditId,
    website_id: record.websiteId || null,
    page_url: record.pageUrl || null,
    source: record.source || "unknown",
    provider_artifact_ref: record.providerArtifactRef || null,
    evidence_type: record.evidenceType,
    observed_value: record.observedValue ?? null,
    normalized_value: record.normalizedValue ?? null,
    observed_at: record.observedAt || null,
    device: record.device || null,
    scope: record.scope || null,
    lineage: record.lineage || null,
    independence: record.independence || null,
    provenance: record.provenance || null,
    sufficiency: record.sufficiency || null,
    status: record.status || "UNKNOWN",
    conflict_state: record.conflictState || "NONE",
    confidence: record.confidence || null,
    raw_evidence_ref: record.rawEvidenceRef || null,
  };
}

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
    return [...evidence.values()]
      .filter((record) => record.tenantId === tenantId && record.auditId === auditId && (!evidenceId || record.evidenceId === evidenceId))
      .map(asEvidenceRow);
  }
  return Object.freeze({ upsertEvidenceRecords, upsertGraph, listGraph, listEvidence });
}

export default { createMemoryEvidenceGraphRepository };

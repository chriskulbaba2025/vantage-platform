import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(__dirname, "..", "..", "migrations", "004_evidence_graph.sql");
const RETRIEVAL_MIGRATION = resolve(__dirname, "..", "..", "migrations", "005_retrieval_documents.sql");

function json(value, fallback) { return JSON.stringify(value === undefined ? fallback : value); }

export function createPostgresEvidenceGraphRepository({ pool }) {
  if (!pool) throw new Error("postgres-evidence-graph-repository requires a pool");
  let initialized;
  let retrievalInitialized;
  async function ensureInitialized() {
    if (!initialized) {
      initialized = readFile(MIGRATION, "utf8").then((sql) => Promise.all(
        sql.split(";").map((statement) => statement.trim()).filter(Boolean).map((statement) => pool.query(statement)),
      )).catch((error) => { initialized = null; throw error; });
    }
    return initialized;
  }
  async function upsertEvidenceRecords(records = []) {
    await ensureInitialized();
    for (const record of records) {
      await pool.query(`INSERT INTO prysm.evidence_records (evidence_id, tenant_id, client_id, audit_id, website_id, page_url, source, provider_artifact_ref, evidence_type, observed_value, normalized_value, observed_at, device, scope, lineage, independence, provenance, sufficiency, status, conflict_state, confidence, raw_evidence_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) ON CONFLICT (evidence_id) DO NOTHING`, [
        record.evidenceId, record.tenantId, record.clientId || null, record.auditId, record.websiteId || null, record.pageUrl || null,
        record.source || "unknown", record.providerArtifactRef || null, record.evidenceType, json(record.observedValue, null), json(record.normalizedValue, null), record.observedAt || null,
        record.device || null, record.scope || null, record.lineage || null, record.independence || null, record.provenance || null, record.sufficiency || null,
        record.status || "UNKNOWN", record.conflictState || "NONE", record.confidence || null, record.rawEvidenceRef || null,
      ]);
    }
  }
  async function upsertGraph({ tenantId, clientId = null, auditId, nodes = [], edges = [] } = {}) {
    if (!tenantId || !auditId) throw new Error("tenantId and auditId are required");
    await ensureInitialized();
    for (const node of nodes) {
      if (node.tenantId && node.tenantId !== tenantId) throw new Error("Graph node tenant mismatch");
      await pool.query(`INSERT INTO prysm.graph_nodes (node_id, tenant_id, client_id, audit_id, node_type, stable_key, label, attributes_json, assertion_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (node_id) DO NOTHING`, [node.nodeId, tenantId, clientId, auditId, node.nodeType, node.stableKey, node.label || null, json(node.attributes, {}), node.assertionMode || "OBSERVED"]);
    }
    for (const edge of edges) {
      if (edge.tenantId && edge.tenantId !== tenantId) throw new Error("Graph edge tenant mismatch");
      await pool.query(`INSERT INTO prysm.graph_edges (edge_id, tenant_id, client_id, audit_id, from_node_id, to_node_id, edge_type, assertion_mode, evidence_ids_json, attributes_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (edge_id) DO NOTHING`, [edge.edgeId, tenantId, clientId, auditId, edge.fromNodeId, edge.toNodeId, edge.edgeType, edge.assertionMode || "OBSERVED", json(edge.evidenceIds, []), json(edge.attributes, {})]);
      for (const evidenceId of edge.evidenceIds || []) {
        await pool.query(`INSERT INTO prysm.graph_edge_evidence (edge_id, evidence_id, tenant_id, audit_id) VALUES ($1,$2,$3,$4) ON CONFLICT (edge_id, evidence_id) DO NOTHING`, [edge.edgeId, evidenceId, tenantId, auditId]);
      }
    }
  }
  async function listGraph({ tenantId, auditId, nodeType = null, edgeType = null } = {}) {
    await ensureInitialized();
    const nodes = await pool.query(`SELECT * FROM prysm.graph_nodes WHERE tenant_id = $1 AND audit_id = $2${nodeType ? " AND node_type = $3" : ""} ORDER BY node_id`, nodeType ? [tenantId, auditId, nodeType] : [tenantId, auditId]);
    const edges = await pool.query(`SELECT * FROM prysm.graph_edges WHERE tenant_id = $1 AND audit_id = $2${edgeType ? " AND edge_type = $3" : ""} ORDER BY edge_id`, edgeType ? [tenantId, auditId, edgeType] : [tenantId, auditId]);
    return { nodes: nodes.rows, edges: edges.rows };
  }
  async function listEvidence({ tenantId, auditId, evidenceId = null } = {}) {
    await ensureInitialized();
    const result = await pool.query(`SELECT * FROM prysm.evidence_records WHERE tenant_id = $1 AND audit_id = $2${evidenceId ? " AND evidence_id = $3" : ""} ORDER BY evidence_id`, evidenceId ? [tenantId, auditId, evidenceId] : [tenantId, auditId]);
    return result.rows;
  }
  async function ensureRetrievalInitialized() {
    if (!retrievalInitialized) {
      retrievalInitialized = readFile(RETRIEVAL_MIGRATION, "utf8").then((sql) => Promise.all(sql.split(";").map((statement) => statement.trim()).filter(Boolean).map((statement) => pool.query(statement)))).catch((error) => { retrievalInitialized = null; throw error; });
    }
    return retrievalInitialized;
  }
  async function upsertRetrievalDocuments(documents = []) {
    await ensureRetrievalInitialized();
    for (const document of documents) {
      await pool.query(`INSERT INTO prysm.retrieval_documents (document_id, tenant_id, client_id, website_id, audit_id, graph_node_id, evidence_id, node_type, source, content, content_hash, embedding_json, embedding_model, currentness, status, conflict_state, provenance, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now()) ON CONFLICT (document_id) DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash, embedding_json = EXCLUDED.embedding_json, embedding_model = EXCLUDED.embedding_model, updated_at = now() WHERE prysm.retrieval_documents.tenant_id = EXCLUDED.tenant_id AND prysm.retrieval_documents.audit_id = EXCLUDED.audit_id`, [document.documentId, document.tenantId, document.clientId || null, document.websiteId || null, document.auditId, document.graphNodeId || null, document.evidenceId || null, document.nodeType || "EvidenceRecord", document.source || "unknown", document.content, document.contentHash, document.embedding ? JSON.stringify(document.embedding) : null, document.embeddingModel || null, document.currentness || "CURRENT", document.status || "UNKNOWN", document.conflictState || "NONE", document.provenance || null]);
    }
  }
  async function listRetrievalDocuments({ tenantId, auditId, websiteId = null } = {}) {
    await ensureRetrievalInitialized();
    const result = await pool.query(`SELECT * FROM prysm.retrieval_documents WHERE tenant_id = $1 AND audit_id = $2${websiteId ? " AND website_id = $3" : ""} ORDER BY document_id`, websiteId ? [tenantId, auditId, websiteId] : [tenantId, auditId]);
    return result.rows.map((row) => ({ ...row, embedding: row.embedding_json }));
  }
  return Object.freeze({ upsertEvidenceRecords, upsertGraph, listGraph, listEvidence, upsertRetrievalDocuments, listRetrievalDocuments });
}

export default { createPostgresEvidenceGraphRepository };

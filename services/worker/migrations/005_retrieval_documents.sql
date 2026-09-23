-- Additive retrieval index. Embeddings are relevance metadata, never evidence.
CREATE SCHEMA IF NOT EXISTS prysm;
CREATE TABLE IF NOT EXISTS prysm.retrieval_documents (
  document_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  client_id TEXT,
  website_id TEXT,
  audit_id UUID NOT NULL,
  graph_node_id TEXT,
  evidence_id TEXT,
  node_type TEXT NOT NULL,
  source TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_json JSONB,
  embedding_model TEXT,
  currentness TEXT NOT NULL DEFAULT 'CURRENT',
  status TEXT NOT NULL DEFAULT 'UNKNOWN',
  conflict_state TEXT NOT NULL DEFAULT 'NONE',
  provenance TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, audit_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_retrieval_documents_scope ON prysm.retrieval_documents (tenant_id, audit_id, website_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_documents_hash ON prysm.retrieval_documents (tenant_id, audit_id, content_hash);

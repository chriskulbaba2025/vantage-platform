-- PRYSM Evidence Intelligence — Migration 004
-- Additive PostgreSQL-first evidence graph. Existing lifecycle/artifacts are untouched.
CREATE SCHEMA IF NOT EXISTS prysm;

CREATE TABLE IF NOT EXISTS prysm.evidence_records (
  evidence_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  client_id TEXT,
  audit_id UUID NOT NULL,
  website_id TEXT,
  page_url TEXT,
  source TEXT NOT NULL,
  provider_artifact_ref TEXT,
  evidence_type TEXT NOT NULL,
  observed_value TEXT,
  normalized_value TEXT,
  observed_at TIMESTAMPTZ,
  device TEXT,
  scope TEXT,
  lineage TEXT,
  independence TEXT,
  provenance TEXT,
  sufficiency TEXT,
  status TEXT NOT NULL,
  conflict_state TEXT NOT NULL DEFAULT 'NONE',
  confidence TEXT,
  raw_evidence_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evidence_records_tenant_audit ON prysm.evidence_records (tenant_id, audit_id);
CREATE INDEX IF NOT EXISTS idx_evidence_records_page_type ON prysm.evidence_records (tenant_id, audit_id, page_url, evidence_type);

CREATE TABLE IF NOT EXISTS prysm.graph_nodes (
  node_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  client_id TEXT,
  audit_id UUID NOT NULL,
  node_type TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  label TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  assertion_mode TEXT NOT NULL DEFAULT 'OBSERVED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, audit_id, stable_key)
);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_tenant_audit ON prysm.graph_nodes (tenant_id, audit_id);

CREATE TABLE IF NOT EXISTS prysm.graph_edges (
  edge_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  client_id TEXT,
  audit_id UUID NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  assertion_mode TEXT NOT NULL DEFAULT 'OBSERVED',
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  attributes_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, audit_id, from_node_id, to_node_id, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_tenant_audit ON prysm.graph_edges (tenant_id, audit_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON prysm.graph_edges (tenant_id, audit_id, from_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON prysm.graph_edges (tenant_id, audit_id, to_node_id);

CREATE TABLE IF NOT EXISTS prysm.graph_edge_evidence (
  edge_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  audit_id UUID NOT NULL,
  PRIMARY KEY (edge_id, evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_graph_edge_evidence_scope ON prysm.graph_edge_evidence (tenant_id, audit_id);

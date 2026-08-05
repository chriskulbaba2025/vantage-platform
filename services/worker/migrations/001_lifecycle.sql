-- ============================================================================
-- Prysm Lifecycle — Migration 001
--
-- Creates the prysm schema and lifecycle_events table.
-- Idempotent — safe to run multiple times (uses IF NOT EXISTS).
--
-- Compatible with PostgreSQL 12+.  CI tests use pg-mem.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS prysm;

CREATE TABLE IF NOT EXISTS prysm.lifecycle_events (
    event_id        UUID PRIMARY KEY,
    audit_id        UUID NOT NULL,
    tenant_id       TEXT NOT NULL,
    client_id       TEXT NOT NULL,
    sequence        INTEGER NOT NULL,
    prior_state     TEXT NOT NULL,
    next_state      TEXT NOT NULL,
    timestamp       TIMESTAMP NOT NULL,
    actor           TEXT NOT NULL,
    reason          TEXT NOT NULL,
    execution_id    TEXT,
    code_version    TEXT NOT NULL,
    artifact_key    TEXT,
    UNIQUE (audit_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_audit_id ON prysm.lifecycle_events (audit_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_audit_sequence ON prysm.lifecycle_events (audit_id, sequence);
CREATE INDEX IF NOT EXISTS idx_lifecycle_tenant_id ON prysm.lifecycle_events (tenant_id);

CREATE TABLE IF NOT EXISTS prysm.lifecycle_idempotency (
    audit_id        UUID PRIMARY KEY,
    idempotency_key TEXT NOT NULL,
    tenant_id       TEXT NOT NULL,
    client_id       TEXT NOT NULL,
    created_at      TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_key ON prysm.lifecycle_idempotency (idempotency_key);

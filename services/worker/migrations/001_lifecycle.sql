-- ============================================================================
-- Prysm Lifecycle — Migration 001
--
-- Creates the prysm schema, lifecycle_events table, idempotency tables,
-- and transition-idempotency tracking.
-- Idempotent — safe to run multiple times (uses IF NOT EXISTS).
--
-- Compatible with PostgreSQL 12+.  CI tests use pg-mem.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS prysm;

-- Append-only lifecycle event log
CREATE TABLE IF NOT EXISTS prysm.lifecycle_events (
    event_id                    UUID PRIMARY KEY,
    audit_id                    UUID NOT NULL,
    tenant_id                   TEXT NOT NULL,
    client_id                   TEXT NOT NULL,
    sequence                    INTEGER NOT NULL,
    prior_state                 TEXT NOT NULL,
    next_state                  TEXT NOT NULL,
    timestamp                   TIMESTAMPTZ NOT NULL,
    actor                       TEXT NOT NULL,
    reason                      TEXT NOT NULL,
    execution_id                TEXT,
    code_version                TEXT NOT NULL,
    artifact_key                TEXT,
    transition_idempotency_key  TEXT,
    UNIQUE (audit_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_audit_id ON prysm.lifecycle_events (audit_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_audit_sequence ON prysm.lifecycle_events (audit_id, sequence);
CREATE INDEX IF NOT EXISTS idx_lifecycle_tenant_id ON prysm.lifecycle_events (tenant_id);

-- Tenant-scoped idempotency key — prevents duplicate audit creation
CREATE TABLE IF NOT EXISTS prysm.lifecycle_idempotency (
    tenant_id       TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    audit_id        UUID NOT NULL,
    client_id       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_audit_id ON prysm.lifecycle_idempotency (audit_id);

-- Transition idempotency — prevents duplicate transition application
CREATE TABLE IF NOT EXISTS prysm.lifecycle_transition_keys (
    audit_id                    UUID NOT NULL,
    transition_idempotency_key  TEXT NOT NULL,
    event_id                    UUID NOT NULL,
    request_fingerprint         TEXT,
    PRIMARY KEY (audit_id, transition_idempotency_key)
);

-- Audit metadata
CREATE TABLE IF NOT EXISTS prysm.lifecycle_audits (
    audit_id    UUID PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    client_id   TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL
);

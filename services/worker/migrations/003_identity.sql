-- ============================================================================
-- Prysm Identity — Migration 003
--
-- Canonical multi-tenant identity model:
--   tenants            — tenant records (id matches the existing TEXT
--                         tenant_id used across lifecycle/artifacts)
--   users              — application users keyed by stable Cognito sub
--   tenant_memberships — role-bearing, status-bearing membership rows
--
-- Legacy mapping (explicit + deterministic): every DISTINCT tenant_id that
-- already exists in lifecycle_audits becomes a tenant row with the SAME id.
-- No unknown production data is silently assigned to an arbitrary tenant.
--
-- Idempotent — safe to run multiple times (IF NOT EXISTS + ON CONFLICT).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS prysm;

CREATE TABLE IF NOT EXISTS prysm.tenants (
    id          TEXT NOT NULL,
    PRIMARY KEY (id),
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL,
    UNIQUE (slug),
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS prysm.users (
    id           UUID NOT NULL,
    PRIMARY KEY (id),
    cognito_sub  TEXT NOT NULL,
    UNIQUE (cognito_sub),
    email        TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS prysm.tenant_memberships (
    id         UUID NOT NULL,
    PRIMARY KEY (id),
    tenant_id  TEXT NOT NULL REFERENCES prysm.tenants(id),
    user_id    UUID NOT NULL REFERENCES prysm.users(id),
    role       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON prysm.tenant_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_tenant_id ON prysm.tenant_memberships (tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_cognito_sub ON prysm.users (cognito_sub);

-- Deterministic legacy mapping: one tenant row per distinct existing tenant
-- id.  The tenant id equals the legacy tenant_id exactly — no reassignment.
-- slug = lower(tenant_id) keeps the mapping deterministic and idempotent
-- (legacy tenant ids are already lowercase slugs).  ON CONFLICT (id) DO
-- NOTHING makes repeat runs no-ops.
INSERT INTO prysm.tenants (id, name, slug, status, created_at, updated_at)
SELECT tenant_id, tenant_id, lower(tenant_id), 'active', created_at, created_at
FROM prysm.lifecycle_audits
ON CONFLICT (id) DO NOTHING;

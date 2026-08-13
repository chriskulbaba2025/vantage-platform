# MT-IDENTITY-01 — Multi-Tenant Identity & Report Isolation Checklist

**Change ID:** MT-IDENTITY-01
**Skill:** governed-coding-upgrade v2.1.0
**Release intent:** PRODUCTION_READY
**Branch:** feat/prysm-multitenant-identity-isolation
**Starting SHA:** 9629cff9d29464b4229a455b228cc77c6200514a

## Permitted files

```text
app/** (web routes, identity UI, guards)
lib/** (identity boundary, worker-client, session)
components/**
services/worker/src/identity/**
services/worker/src/server.js
services/worker/src/application/** (tenant-aware service wiring)
services/worker/src/lifecycle/** (postgres user/membership repository)
services/worker/migrations/**
services/worker/scripts/acceptance-tenant.js (new)
services/worker/test-fixtures/** (identity fixtures)
tests/** (web E2E tenant tests)
playwright.config.ts
.governance/**
docs/prysm-governance/work-packages/MT_IDENTITY_01_CHECKLIST.md (copy)
```

## Prohibited files

```text
services/worker/src/report/** (renderer/sections/templates)
services/worker/src/contracts/*.schema.json EXCEPT audit-request (if identity fields needed — requires section-level proof)
services/worker/src/scoring/** (weights/eligibility)
services/worker/src/lifecycle/state-enum.js (lifecycle definitions)
docs/Vantage_Production_PRD_v3.md
**/golden-master/**
```

## Checklist

### MT-01 — Canonical identity schema migration
- [ ] Behaviour: migration 003 creates prysm.tenants, prysm.users, prysm.tenant_memberships with the frozen columns; idempotent; existing tenant_id values map deterministically to tenant rows (no arbitrary reassignment).
- [ ] Boundary: services/worker/migrations/003_identity.sql + postgres repository runMigration
- [ ] Proof: migration unit test (pg-mem) — tables exist, columns match, re-run idempotent, legacy tenant rows created 1:1
- [ ] Failure: unknown legacy tenant data fails closed (explicit mapping only)

### MT-02 — Identity boundary (Cognito adapter + JWT verification)
- [ ] Behaviour: identity interface { verifyToken, issueSession } with Cognito adapter (JWKS verification, iss/aud/sub claims); mock adapter for controlled acceptance BELOW the verification boundary; env contract (COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_REGION); config validation fails closed when LIVE mode lacks required env.
- [ ] Boundary: lib/identity/ (web) + services/worker/src/identity/ (worker verification of signed principal)
- [ ] Proof: unit tests — valid token → principal; expired/bad-signature/wrong-iss → 401; mock adapter never bypasses HMAC boundary

### MT-03 — Session and authenticated principal
- [ ] Behaviour: httpOnly session cookie carries HMAC-signed principal {sub, email, exp} (webhook secret); logout clears; disabled user → 401 at lookup.
- [ ] Boundary: app/api/auth/*, lib/session.ts
- [ ] Proof: session round-trip, tamper → 401, logout → access removed (TENANT-AUTH-08)

### MT-04 — Server-side membership resolution
- [ ] Behaviour: worker resolves user by cognito_sub → active memberships → authorized tenant set; selected tenant honored ONLY when in the set; platform_admin role grants explicit cross-tenant override.
- [ ] Boundary: services/worker/src/identity/authorization.js + postgres users/memberships repository
- [ ] Proof: membership unit tests + TENANT-AUTH-06/07/09/17

### MT-05 — Remove global tenant assumption (worker)
- [ ] Behaviour: protected /api/v1 routes resolve tenant from the signed principal, never from config.vantageTenantId or browser input; secret-authenticated internal callers (x-vantage-secret) retain a governed internal boundary documented as platform-admin-equivalent.
- [ ] Boundary: services/worker/src/server.js route guards
- [ ] Proof: TENANT-AUTH-10/11/18

### MT-06 — Tenant-scoped audit + report access
- [ ] Behaviour: create persists resolved tenant; list/detail tenant-scoped; report authorization (viewer→approved/published; reviewer→+drafts; tenant_admin→tenant; platform_admin→explicit cross-tenant) BEFORE artifact retrieval; cross-tenant → non-disclosing 404; zero report bytes before authorization.
- [ ] Boundary: web route guards + worker audit/report handlers
- [ ] Proof: TENANT-AUTH-02..05/12..15

### MT-07 — Web route protection and login UI
- [ ] Behaviour: protected pages redirect unauthenticated → /login; login posts Cognito credentials server-side; no secret to client bundle; UI never the authorization layer.
- [ ] Boundary: middleware.ts / guards, app/login
- [ ] Proof: TENANT-AUTH-01 + E2E

### MT-08 — Acceptance suite TENANT-AUTH-01..18
- [ ] Behaviour: all frozen acceptance IDs pass with controlled identity fixtures below the real verification boundary; real persistence and real route guards execute; zero live provider/model calls.
- [ ] Boundary: services/worker/scripts/acceptance-tenant.js
- [ ] Proof: suite output, exact call counters

### MT-09 — Durability / security
- [ ] Behaviour: membership + ownership survive restart (PostgreSQL); authorization recomputed per request; disabled membership denies immediately; no cross-tenant cache; no artifact key guessing bypass; no credential exposure in bundles/logs; malformed identity fails closed.
- [ ] Boundary: postgres repository + guards
- [ ] Proof: restart simulation test + secret scan + TENANT-AUTH-09

### MT-10 — Regression unchanged contracts
- [ ] Behaviour: existing evidence/scoring/report/lifecycle contracts unchanged; worker regression + Prysm acceptance + WP12 green.
- [ ] Proof: full regression outputs (TENANT-AUTH-15)

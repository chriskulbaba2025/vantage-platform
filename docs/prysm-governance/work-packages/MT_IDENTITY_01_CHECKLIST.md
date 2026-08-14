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
- [x] Behaviour: migration 003 creates prysm.tenants, prysm.users, prysm.tenant_memberships with the frozen columns; idempotent; existing tenant_id values map deterministically to tenant rows (no arbitrary reassignment). — PRODUCTION: applied via real runMigration(); tables + 3 indexes verified through a fresh connection; 1 legacy tenant ("default") mapped 1:1 from 5 lifecycle_audits; rerun proven idempotent.
- [x] Boundary: services/worker/migrations/003_identity.sql + postgres repository runMigration
- [x] Proof: migration unit test (pg-mem) — tables exist, columns match, re-run idempotent, legacy tenant rows created 1:1 (identity-migration.test.js)
- [x] Failure: unknown legacy tenant data fails closed (explicit mapping only) (identity-migration.test.js "unknown tenant ids never get arbitrary tenants")

### MT-02 — Identity boundary (Cognito adapter + JWT verification)
- [x] Behaviour: identity interface { verifyToken, issueSession } with Cognito adapter (JWKS verification, iss/aud/sub claims); mock adapter for controlled acceptance BELOW the verification boundary; env contract (COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_REGION); config validation fails closed when LIVE mode lacks required env. — cognito-identity.ts verifies RS256 + iss/aud/token_use=id/exp/sub against live JWKS (LIVE-AUTH: real token verification PASS); resolveCognitoConfig throws on missing env; worker startup fails closed without VANTAGE_WEBHOOK_SECRET when DATABASE_URL is set; authorized() fails closed (server-auth-fail-closed.test.js).
- [x] Boundary: lib/identity/ (web) + services/worker/src/identity/ (worker verification of signed principal)
- [x] Proof: unit tests — valid token → principal; expired/bad-signature/wrong-iss → 401; mock adapter never bypasses HMAC boundary (cognito-identity-boundary.test.js — real boundary code with controlled JWKS; 10 cases incl. access-token rejection)

### MT-03 — Session and authenticated principal
- [x] Behaviour: httpOnly session cookie carries HMAC-signed principal {sub, email, exp} (webhook secret); logout clears; disabled user → 401 at lookup.
- [x] Boundary: app/api/auth/*, lib/session.ts
- [x] Proof: session round-trip, tamper → 401, logout → access removed (TENANT-AUTH-08 worker-side expiry/tamper deny + Playwright DRAFT-REVIEW-03 anonymous redirect 307 + wrong-secret session issuance 401)

### MT-04 — Server-side membership resolution
- [x] Behaviour: worker resolves user by cognito_sub → active memberships → authorized tenant set; selected tenant honored ONLY when in the set; platform_admin role grants explicit cross-tenant override.
- [x] Boundary: services/worker/src/identity/authorization.js + postgres users/memberships repository
- [x] Proof: membership unit tests + TENANT-AUTH-06/07/09/17 (33/33) + LIVE-AUTH-01..08 (real Cognito subs against production PostgreSQL)

### MT-05 — Remove global tenant assumption (worker)
- [x] Behaviour: protected /api/v1 routes resolve tenant from the signed principal, never from config.vantageTenantId or browser input; secret-authenticated internal callers (x-vantage-secret) retain a governed internal boundary documented as platform-admin-equivalent.
- [x] Boundary: services/worker/src/server.js route guards
- [x] Proof: TENANT-AUTH-10/11/18 + LIVE-AUTH-07 (forged x-prysm-tenant → 401 both directions, real route)

### MT-06 — Tenant-scoped audit + report access
- [x] Behaviour: create persists resolved tenant; list/detail tenant-scoped; report authorization (viewer→approved/published; reviewer→+drafts; tenant_admin→tenant; platform_admin→explicit cross-tenant) BEFORE artifact retrieval; cross-tenant → non-disclosing 404; zero report bytes before authorization.
- [x] Boundary: web route guards + worker audit/report handlers
- [x] Proof: TENANT-AUTH-02..05/12..15 + LIVE-AUTH-10 (production report denial 404 before artifact retrieval, zero artifact reads/bytes, anonymous 401) + web report proxy binds the signed principal (worker-client.getReportPage), anonymous fails closed

### MT-07 — Web route protection and login UI
- [x] Behaviour: protected pages redirect unauthenticated → /login; login posts Cognito credentials server-side; no secret to client bundle; UI never the authorization layer.
- [x] Boundary: middleware.ts / guards, app/login
- [x] Proof: TENANT-AUTH-01 + E2E (Playwright 8/8: anonymous report → login 307, anonymous audit API → 307, wrong-secret session → 401)

### MT-08 — Acceptance suite TENANT-AUTH-01..18
- [x] Behaviour: all frozen acceptance IDs pass with controlled identity fixtures below the real verification boundary; real persistence and real route guards execute; zero live provider/model calls.
- [x] Boundary: services/worker/scripts/acceptance-tenant.js
- [x] Proof: suite output 33 PASS / 0 FAIL; exact call counters (TENANT-AUTH-16: zero live fetch escapes; ≥6 controlled adapter executions); TENANT-AUTH-17 assertions repaired to assert list CONTENT (contains own-tenant audit, zero other-tenant bleed)

### MT-09 — Durability / security
- [x] Behaviour: membership + ownership survive restart (PostgreSQL); authorization recomputed per request; disabled membership denies immediately; no cross-tenant cache; no artifact key guessing bypass; no credential exposure in bundles/logs; malformed identity fails closed.
- [x] Boundary: postgres repository + guards
- [x] Proof: production PostgreSQL membership durability (seeded memberships re-read through fresh connections; LIVE-AUTH reads after reconnect) + TENANT-AUTH-09 + secret scan (zero matches across diff and temp scripts) + LIVE-AUTH-09 leak scan

### MT-10 — Regression unchanged contracts
- [x] Behaviour: existing evidence/scoring/report/lifecycle contracts unchanged; worker regression + Prysm acceptance + WP12 green.
- [x] Proof: worker 694/0; identity 33/0; acceptance-tenant 33/33; acceptance-prysm 82/0; acceptance-wp12 78/0; tsc exit 0; next build PASS; Playwright 8/8

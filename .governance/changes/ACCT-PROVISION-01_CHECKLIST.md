# ACCT-PROVISION-01 — Customer Account Provisioning Checklist

**Change ID:** ACCT-PROVISION-01
**Skill:** governed-coding-upgrade v2.1.0
**Release intent:** PRODUCTION_READY
**Branch:** feat/prysm-account-provisioning
**Starting SHA:** b2e713bdd9fff83cb6bc034272b3d4e10f9adbd8 (main, post PR #48)

## Objective

Platform admin can: create a company (tenant), create/invite a user, select
reviewer/viewer/tenant_admin role, assign the user to that company, disable
the membership; the user establishes their own credentials, logs in, and
sees ONLY their company's audits/reports.

## Permitted files

```text
services/worker/src/identity/** (model + repositories + new admin module)
services/worker/src/server.js (admin route guards — platform-admin boundary)
services/worker/scripts/acceptance-provisioning.js (new)
services/worker/src/identity/*.test.js (repository/route tests)
app/admin/** (new admin UI)
app/api/admin/** (new admin API routes)
app/api/auth/login/route.ts (NEW_PASSWORD_REQUIRED challenge flow)
app/login/** (challenge-aware login form)
lib/** (worker-client admin methods, session helpers)
tests/** (E2E provisioning flow)
middleware.ts (admin prefixes)
playwright.config.ts (testDir to include the provisioning spec)
.github/workflows/worker-ci.yml (add acceptance-provisioning step)
.governance/**
```

## Prohibited files

```text
services/worker/src/report/**
services/worker/src/contracts/*.schema.json
services/worker/src/scoring/**
services/worker/src/lifecycle/state-enum.js
docs/Vantage_Production_PRD_v3.md
**/golden-master/**
```

## Checklist

### AP-01 — Membership lifecycle repository operations
- [x] Behaviour: postgres + memory identity repositories gain
  updateMembershipStatus (active/disabled transition, persisted) and
  listMembershipsForTenant (join user email/display_name); idempotent;
  no cross-tenant leakage.
- [x] Boundary: services/worker/src/identity/postgres-identity-repository.js + memory-identity-repository.js
- [x] Proof: repository unit tests (pg-mem + memory) — transition
  persisted, disabled membership denies immediately at resolveAuthorization
- [x] Failure: unknown membership/target → no-op or explicit error, never
  cross-tenant mutation

### AP-02 — Worker platform-admin boundary
- [x] Behaviour: new /api/v1/admin routes (create tenant, create user,
  assign membership, disable membership) authorized ONLY for
  platform_admin principals or the secret-authenticated internal boundary;
  browser principals without platform_admin → 403; malformed input → 400;
  tenant slug/id validated.
- [x] Boundary: services/worker/src/server.js + identity repositories
- [x] Proof: route-level acceptance (real handler + real repositories,
  controlled fixtures below the provider boundary)

### AP-03 — Invite + self-credentialing (Cognito)
- [x] Behaviour: admin invite creates the Cognito user (AdminCreateUser,
  temporary password, no message delivery in tests; production: invitation
  email with temporary password) and the Prysm user + membership rows; the
  invited user's FIRST login with the temporary password completes the
  Cognito NEW_PASSWORD_REQUIRED challenge with a password chosen by the
  user; no password is stored in Prysm; temporary passwords never logged.
- [x] Boundary: app/api/admin/users (Cognito SDK) + app/api/auth/login
  challenge flow + lib/identity/identity-provider
- [x] Proof: controlled unit tests (mock challenge below the real boundary)
  + E2E challenge flow through the real web routes

### AP-04 — Web admin UI
- [x] Behaviour: /admin renders only for platform_admin sessions (others →
  redirect/notFound); forms: create company, invite user (email + role),
  membership list with disable action; all mutations server-side through
  /api/admin routes; UI never the authorization layer.
- [x] Boundary: app/admin/page.tsx + app/api/admin/*
- [x] Proof: E2E — platform admin creates company + user, assigns role,
  disables membership through the UI; non-admin denied

### AP-05 — Tenant-only visibility for provisioned users
- [x] Behaviour: newly provisioned user logs in and sees ONLY their
  company's audits/reports — listing, detail, report retrieval all
  tenant-scoped; cross-tenant → non-disclosing 404; zero report bytes
  before authorization.
- [x] Boundary: existing spine (worker guards) + acceptance
- [x] Proof: acceptance-provisioning end-to-end cycle with two companies
  and cross-company negative proof

### AP-06 — Acceptance harness
- [x] Behaviour: scripts/acceptance-provisioning.js runs the complete
  provisioning cycle through the REAL routes + REAL repositories with
  controlled fixtures; zero live provider/LLM calls.
- [x] Boundary: real createRequestHandler + pg-mem + real migrations
- [x] Proof: suite output, exact call counters, zero-live-fetch guard

### AP-07 — Regression unchanged
- [x] Behaviour: existing contracts unchanged; worker regression + tenant
  acceptance + Prysm acceptance + WP12 + tsc + next build + Playwright
  green at the final head.
- [x] Proof: full regression outputs

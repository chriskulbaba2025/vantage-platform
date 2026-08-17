# PRYSM-ACTIVATE-01 — Production Product Boundary Closure

**Version:** 1.0.3 (refrozen before implementation)
**Skill:** governed-coding-upgrade v2.1.0
**Starting production SHA:** `4d9cf307096dd9073a980628ff90350261946e4d`
**Branch:** `fix/prysm-production-activation`
**Release intent:** PRODUCTION_READY — merge/deployment remains separately authorized.

## Objective

Close the single production-facing boundary gap left after PRYSM-NEXT-01 so the already-built governed capabilities are usable from the product:

1. a new audit can explicitly select governed report design v2.0.0 and that selection survives the complete web → worker → persisted request → orchestration → approval path;
2. an authenticated tenant reviewer can open a draft report using their own Prysm/Cognito login, without requiring the legacy shared reviewer-session cookie;
3. an authenticated user can reach the existing platform administration console, where platform-admin authorization remains enforced server-side and the existing Cognito invitation/new-password flow provides separate user credentials.

No report renderer, scoring semantics, evidence acquisition, tenant authorization, Cognito credential ownership, or lifecycle state semantics may be redesigned.

## Permitted files

- [ ] `.governance/changes/PRYSM-ACTIVATE-01_CHECKLIST.md`
- [ ] `.governance/changes/prysm-activate-01-patch.py` — temporary exact-string patch helper; must be absent from final diff
- [ ] `.github/workflows/prysm-activate-01-autofix.yml` — temporary branch-only patch runner; must be absent from final diff
- [ ] `app/audits/new/page.tsx`
- [ ] `lib/audit-request.ts`
- [ ] `app/audits/[auditId]/page.tsx`
- [ ] `app/layout.tsx`
- [ ] `tests/wp11/full-flow.spec.ts`
- [ ] `tests/provisioning/admin-flow.spec.ts` only if an activation assertion is required
- [ ] `services/worker/src/application/audit-service.js`
- [ ] `services/worker/src/application/production-runtime.js`
- [ ] `services/worker/src/audit/production-activation.test.js` (new; included by the existing `npm test` glob)
- [ ] `services/worker/scripts/acceptance-wpi.js` only if needed to correct an escaped proof

## Prohibited files

- [ ] `services/worker/src/report/**`
- [ ] `services/worker/src/scoring/**`
- [ ] `services/worker/src/evidence/**`
- [ ] `services/worker/src/contracts/**`
- [ ] `services/worker/migrations/**`
- [ ] `services/worker/src/identity/report-authorization.js`
- [ ] Cognito password ownership/authentication semantics
- [ ] provider adapters, provider credentials, paid-call configuration
- [ ] production environment mutation

## Acceptance checklist

### ACT-01 — Report design selection exists at the production intake boundary

- [ ] New Audit exposes an accessible governed report-design selector.
- [ ] `2.0.0` is explicitly selectable for a new audit.
- [ ] Only `1.0.0` or `2.0.0` may cross the web payload boundary.
- [ ] Existing contract fallback remains v1.0.0 when no design is supplied.
- [ ] No report renderer is modified.

### ACT-02 — Report design survives the canonical application/runtime boundary

- [ ] `lib/audit-request.ts` carries a validated `report.designVersion`.
- [ ] base `createAudit()` preserves the field in its canonical AuditRequest.
- [ ] production runtime `createAudit()` preserves and persists the field.
- [ ] execution identity/orchestrator receives the persisted v2 selection.
- [ ] regression proves v1 default remains unchanged.

### ACT-03 — Production v2 approval is compatible with the v2 artifact namespace

- [ ] production runtime detects persisted report design before loading v1 pages.
- [ ] v2 approval delegates to the existing governed v2 approval branch and never requires the v1 16-page set.
- [ ] v1 approval continues to load/approve the locked v1 page set exactly as before.
- [ ] no approved-report authorization boundary is weakened.

### ACT-04 — Separate authenticated reviewer login can see a draft report

- [ ] audit detail no longer requires the legacy `prysm_reviewer` cookie merely to expose the report link.
- [ ] authenticated reviewer opens draft through the existing principal-signed report proxy.
- [ ] worker remains authoritative for tenant, role, state, and report-byte authorization.
- [ ] anonymous access remains blocked.
- [ ] viewer draft access remains blocked by the worker.
- [ ] cross-tenant access remains non-disclosing.
- [ ] E2E proves a reviewer login alone can open the draft report without issuing a reviewer-session cookie.

### ACT-05 — User creation/separate-login workflow is product-accessible

- [ ] authenticated product navigation exposes the existing Admin console.
- [ ] server-side platform-admin authorization remains the gate; UI is not an authorization layer.
- [ ] existing company creation, invitation, membership assignment, disable flow remains intact.
- [ ] existing invitee `NEW_PASSWORD_REQUIRED` handover remains intact so the invited user establishes their own password.
- [ ] controlled E2E continues to prove separate login/password handover with mock identity below the provider boundary.
- [ ] no live Cognito user is created during verification.

### ACT-06 — Controlled proof and regression

- [ ] focused production-activation regression proves ACT-02/03 with zero live provider/model/Cognito calls.
- [ ] `npm test` PASS, including the production-activation regression.
- [ ] `npm run check:template` PASS (v1 lock).
- [ ] `npm run acceptance:provisioning` PASS.
- [ ] `npm run acceptance:wp12` PASS.
- [ ] tenant acceptance PASS.
- [ ] WP-I plumbing proof PASS and proves persisted v2 design selection.
- [ ] root TypeScript check/build PASS.
- [ ] Playwright activation/provisioning E2E PASS in controlled identity mode.
- [ ] exact-head GitHub CI PASS.
- [ ] zero paid provider calls.
- [ ] zero live Cognito creations.
- [ ] zero production deployment performed by this change.

### ACT-07 — Scope/release hold

- [ ] changed files are a subset of the permitted list.
- [ ] no prohibited subsystem changed.
- [ ] temporary patch workflow/helper absent from the final branch diff.
- [ ] branch remains unmerged until explicit authorization.
- [ ] production remains on `4d9cf307096dd9073a980628ff90350261946e4d` until explicit deployment authorization.
- [ ] first paid production audit remains separately authorized.
- [ ] first real user invitation remains separately authorized.

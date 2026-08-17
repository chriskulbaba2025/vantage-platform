# Prysm PRYSM-NEXT-01 / WP-F Checklist — User Provisioning

**Version:** 1.0.0 (frozen before implementation)
**Skill:** governed-coding-upgrade v2.1.0
**Branch:** feat/prysm-next-product-upgrade
**Required starting SHA:** WP-E closure SHA (recorded at execution)
**Objective:** One measurable outcome — the governed user-provisioning workflow (platform-admin tenant/company creation, email-validated invite, explicit role assignment, governed membership status, idempotent duplicates, auditable actions, cross-tenant denial, self-credentialing through the existing Cognito identity provider, admin UI) is integrated into this branch from the already-closed ACCT-PROVISION-01 change and passes its frozen checklist plus full programme regressions — with zero live Cognito user creations.
**Governing checklist:** `.governance/changes/ACCT-PROVISION-01_CHECKLIST.md` (AP-01..AP-07, all [x] at source branch d3e9403; re-verified here at the integrated head).
**Integration decision:** D-02 (WORKSPACE) — cherry-pick commits 58f16cc + d3e9403, preserving authorship. Original branch/PR #49 untouched.

## Permitted files

- [x] All files introduced/modified by the cherry-picked commits (58f16cc + d3e9403): `.github/workflows/worker-ci.yml`, `.governance/changes/ACCT-PROVISION-01_CHECKLIST.md`, `app/admin/**`, `app/api/admin/**`, `app/api/auth/login/route.ts`, `app/login/**`, `lib/identity/identity-provider.ts`, `lib/worker-client.ts`, `middleware.ts`, `playwright.config.ts`, `services/worker/package.json`, `services/worker/scripts/acceptance-provisioning.js`, `services/worker/src/identity/{memory,postgres}-identity-repository.js`, `services/worker/src/server.js`, `tests/provisioning/admin-flow.spec.ts`, `tests/wp11/mock-worker.js`
- [x] `.governance/changes/**` (workspace updates)
- [x] `docs/prysm-governance/work-packages/PRYSM-NEXT-01-WPF_CHECKLIST.md`
- [x] Proof-only corrections where the integrated head requires them (test/harness files only, annotated)

## Prohibited files

- [x] `services/worker/src/scoring/**`, `src/report/**`, `src/evidence/**`, `src/contracts/*.schema.json` (post-WP-E state untouched)
- [x] `**/golden-master/**`, `docs/Vantage_Production_PRD_v3.md`

## Requirements

### WP-F-01 — Clean integration
- [x] Behaviour: commits 58f16cc + d3e9403 cherry-picked onto the WP-E head with original authorship; no conflicts resolved by silently dropping either side (if a conflict arises, stop and classify); `git log` shows both commits after the WP-E head.
- [x] Proof: `git log --format='%h %s'` output + `git show --stat` file lists match the recorded commit contents.

### WP-F-02 — Worker provisioning verification
- [x] Behaviour: `npm test` (full worker regression incl. identity repositories) EXIT=0; `node scripts/acceptance-provisioning.js` all gates PASS (expected 26+); `node scripts/acceptance-tenant.js` EXIT=0 (tenant isolation incl. cross-tenant denial before provider/database side effects).
- [x] Proof: command outputs with counts.

### WP-F-03 — Web verification
- [x] Behaviour: `npx tsc --noEmit` EXIT=0; `npx next build` EXIT=0; `npx playwright test` (tests/wp11 + tests/provisioning) all pass.
- [x] Proof: command outputs with counts.

### WP-F-04 — Safety counters
- [x] Behaviour: zero live Cognito user creations, zero real invitations, zero live provider calls during verification — the provisioning acceptance runs against mock Cognito/controlled transports (asserted by the suite itself).
- [x] Proof: acceptance-provisioning output includes its zero-live-call guard; env credentials absent during runs (no DATAFORSEO/AWS keys required — record).

### WP-F-05 — AP-01..AP-07 re-verification at integrated head
- [x] Behaviour: each item of the frozen ACCT-PROVISION-01 checklist still holds at the integrated head (repository operations, worker platform-admin boundary, invite + self-credentialing, web admin UI, tenant-only visibility, acceptance harness, regressions).
- [x] Proof: mapping table (AP item → green test/acceptance) recorded in the closure evidence.

### WP-F-06 — Regressions + scope + single commit
- [x] Behaviour: full acceptance battery (prysm/wp2/wp3/wp5/wp6/wp7/wp8/wp9/task7/task9/task10/wp10/wp11/wp12) EXIT=0 at integrated head; changed files ⊆ permitted; single governed commit + push.

## Verification commands

- [x] `npm test` — exit 0
- [x] `node scripts/acceptance-provisioning.js` — all PASS
- [x] `node scripts/acceptance-tenant.js` — exit 0
- [x] `node scripts/acceptance-prysm.js` + wp2/3/5/6/7/8/9/task7/task9/task10/wp10/11/12 — exit 0
- [x] `npx tsc --noEmit` + `npx next build` — exit 0
- [x] `npx playwright test` — all pass
- [x] `git diff --name-only` ⊆ permitted list

## Completion

- [x] All WP-F IDs PASS.
- [x] Regression PASS.
- [x] Scope check PASS.
- [x] Single governed checkpoint commit + push.
- [x] PR remains unmerged until authorized.

## Completion evidence (recorded 2026-08-16)

- WP-F-01: cherry-picks clean — 014d2b8 (feat: customer account provisioning) + 4d1f1e7 (fix: authorize platform admin BEFORE the Cognito invite side effect), original authorship preserved, zero conflicts.
- WP-F-02: npm test 757/757 EXIT=0; acceptance-provisioning 26/26 PASS incl. "admin disables the membership → 200 changed=1", "disabled membership denies IMMEDIATELY", "idempotent disable rerun", cross-tenant 401 + zero other-company rows, "zero live fetch escapes (guard armed, zero violations)"; acceptance-tenant EXIT=0.
- WP-F-03: tsc EXIT=0; next build EXIT=0; Playwright 12/12 passed (4 provisioning E2E + 8 wp11) — full suite green with clean test ports.
- WP-F-04: zero live Cognito creations — PRYSM_IDENTITY_MODE=mock below the provider boundary; zero-live guard armed in acceptance-provisioning.
- WP-F-05: AP-01..AP-07 re-verified at integrated head (mapping: AP-01 → repo tests + provisioning AP-01 gates; AP-02 → provisioning AP-02 gates; AP-03 → AP-03 gates + E2E PROV-03; AP-04 → E2E PROV-02/04; AP-05 → AP-05 gates + acceptance-tenant; AP-06 → 26/26 harness + zero-live guard; AP-07 → full regression battery).
- WP-F-06: full acceptance battery 14/14 EXIT=0 (evidence: .governance/evidence/wpf-verify2.log); changed files = the two cherry-pick commits only (working tree clean); committed + pushed.
- ENVIRONMENT NOTE (recorded for WP-L reproducibility): Playwright E2E on this machine requires clean ports 19350/19400 — interrupted runs leave straggler listeners whose dying workers cause intermittent PROV-04 "list reflects it" failures (requests hand over mid-run). Verification command: clear listeners on 19350/19400 before `npx playwright test`. Product behavior proven independent of the flake by the 26-gate acceptance harness.

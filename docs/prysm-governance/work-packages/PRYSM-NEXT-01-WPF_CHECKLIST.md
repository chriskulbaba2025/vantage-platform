# Prysm PRYSM-NEXT-01 / WP-F Checklist — User Provisioning

**Version:** 1.0.0 (frozen before implementation)
**Skill:** governed-coding-upgrade v2.1.0
**Branch:** feat/prysm-next-product-upgrade
**Required starting SHA:** WP-E closure SHA (recorded at execution)
**Objective:** One measurable outcome — the governed user-provisioning workflow (platform-admin tenant/company creation, email-validated invite, explicit role assignment, governed membership status, idempotent duplicates, auditable actions, cross-tenant denial, self-credentialing through the existing Cognito identity provider, admin UI) is integrated into this branch from the already-closed ACCT-PROVISION-01 change and passes its frozen checklist plus full programme regressions — with zero live Cognito user creations.
**Governing checklist:** `.governance/changes/ACCT-PROVISION-01_CHECKLIST.md` (AP-01..AP-07, all [x] at source branch d3e9403; re-verified here at the integrated head).
**Integration decision:** D-02 (WORKSPACE) — cherry-pick commits 58f16cc + d3e9403, preserving authorship. Original branch/PR #49 untouched.

## Permitted files

- [ ] All files introduced/modified by the cherry-picked commits (58f16cc + d3e9403): `.github/workflows/worker-ci.yml`, `.governance/changes/ACCT-PROVISION-01_CHECKLIST.md`, `app/admin/**`, `app/api/admin/**`, `app/api/auth/login/route.ts`, `app/login/**`, `lib/identity/identity-provider.ts`, `lib/worker-client.ts`, `middleware.ts`, `playwright.config.ts`, `services/worker/package.json`, `services/worker/scripts/acceptance-provisioning.js`, `services/worker/src/identity/{memory,postgres}-identity-repository.js`, `services/worker/src/server.js`, `tests/provisioning/admin-flow.spec.ts`, `tests/wp11/mock-worker.js`
- [ ] `.governance/changes/**` (workspace updates)
- [ ] `docs/prysm-governance/work-packages/PRYSM-NEXT-01-WPF_CHECKLIST.md`
- [ ] Proof-only corrections where the integrated head requires them (test/harness files only, annotated)

## Prohibited files

- [ ] `services/worker/src/scoring/**`, `src/report/**`, `src/evidence/**`, `src/contracts/*.schema.json` (post-WP-E state untouched)
- [ ] `**/golden-master/**`, `docs/Vantage_Production_PRD_v3.md`

## Requirements

### WP-F-01 — Clean integration
- [ ] Behaviour: commits 58f16cc + d3e9403 cherry-picked onto the WP-E head with original authorship; no conflicts resolved by silently dropping either side (if a conflict arises, stop and classify); `git log` shows both commits after the WP-E head.
- [ ] Proof: `git log --format='%h %s'` output + `git show --stat` file lists match the recorded commit contents.

### WP-F-02 — Worker provisioning verification
- [ ] Behaviour: `npm test` (full worker regression incl. identity repositories) EXIT=0; `node scripts/acceptance-provisioning.js` all gates PASS (expected 26+); `node scripts/acceptance-tenant.js` EXIT=0 (tenant isolation incl. cross-tenant denial before provider/database side effects).
- [ ] Proof: command outputs with counts.

### WP-F-03 — Web verification
- [ ] Behaviour: `npx tsc --noEmit` EXIT=0; `npx next build` EXIT=0; `npx playwright test` (tests/wp11 + tests/provisioning) all pass.
- [ ] Proof: command outputs with counts.

### WP-F-04 — Safety counters
- [ ] Behaviour: zero live Cognito user creations, zero real invitations, zero live provider calls during verification — the provisioning acceptance runs against mock Cognito/controlled transports (asserted by the suite itself).
- [ ] Proof: acceptance-provisioning output includes its zero-live-call guard; env credentials absent during runs (no DATAFORSEO/AWS keys required — record).

### WP-F-05 — AP-01..AP-07 re-verification at integrated head
- [ ] Behaviour: each item of the frozen ACCT-PROVISION-01 checklist still holds at the integrated head (repository operations, worker platform-admin boundary, invite + self-credentialing, web admin UI, tenant-only visibility, acceptance harness, regressions).
- [ ] Proof: mapping table (AP item → green test/acceptance) recorded in the closure evidence.

### WP-F-06 — Regressions + scope + single commit
- [ ] Behaviour: full acceptance battery (prysm/wp2/wp3/wp5/wp6/wp7/wp8/wp9/task7/task9/task10/wp10/wp11/wp12) EXIT=0 at integrated head; changed files ⊆ permitted; single governed commit + push.

## Verification commands

- [ ] `npm test` — exit 0
- [ ] `node scripts/acceptance-provisioning.js` — all PASS
- [ ] `node scripts/acceptance-tenant.js` — exit 0
- [ ] `node scripts/acceptance-prysm.js` + wp2/3/5/6/7/8/9/task7/task9/task10/wp10/11/12 — exit 0
- [ ] `npx tsc --noEmit` + `npx next build` — exit 0
- [ ] `npx playwright test` — all pass
- [ ] `git diff --name-only` ⊆ permitted list

## Completion

- [ ] All WP-F IDs PASS.
- [ ] Regression PASS.
- [ ] Scope check PASS.
- [ ] Single governed checkpoint commit + push.
- [ ] PR remains unmerged until authorized.

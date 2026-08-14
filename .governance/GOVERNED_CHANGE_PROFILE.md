# Governed Change Profile — Prysm Repository

**Version:** 1.0.0
**Skill:** governed-coding-upgrade v2.1.0

## Repository / build / runtime / test systems

```text
Repository root:      C:\Users\kulba\Desktop\vantage-platform
Web app:              Next.js (App Router, TypeScript) — repo root (app/, components/, lib/)
Worker:               Node.js ESM service — services/worker
Web tests:            npx playwright test tests/wp11 (worker mock: tests/wp11/mock-worker.js)
Web build:            npx next build; npx tsc --noEmit
Worker tests:         npm test (services/worker); node --test <files>
Worker acceptance:    node scripts/acceptance-prysm.js; node scripts/acceptance-wp*.js
Migrations:           services/worker/migrations/*.sql (idempotent, applied via lifecycle repo runMigration)
Runtime:              Railway worker + Vercel web (deployment requires explicit authorization)
```

## Governed locations

```text
Governance pack:      docs/prysm-governance/ (charter 01, contracts 02-05, acceptance playbook 05)
Acceleration std:     docs/prysm-governance/PRYSM_REBUILD_ACCELERATION_STANDARD_v1.1.md (v1.0 superseded)
PRD:                  docs/Vantage_Production_PRD_v3.md
Change profile:       .governance/GOVERNED_CHANGE_PROFILE.md
Changes dir:          .governance/changes/
```

## External-call policy

```text
Zero live paid provider/model calls in tests and CI.
Controlled fixtures below real production boundaries only.
Live Cognito/AWS resource creation requires explicit authorization.
```

## Release-intent policy

```text
PRODUCTION_READY requires: production spine + contract map, terminal-path gate,
full-system readiness, machine gate, exact-head CI, independent audit.
Merge/deploy/activation of identity resources requires explicit authorization.
```

## Protected invariants

```text
- Evidence/scoring/report contracts unchanged (DE-01..DE-16 closure holds)
- Lifecycle state machine unchanged
- Approved report immutability unchanged
- Tenant isolation: authorization BEFORE artifact retrieval; no browser-trusted tenant identity
- No secrets in client bundles or logs
```

## Machine gate / exact-head CI

```text
CI: GitHub Actions worker-ci (verify job) — billing-dependent (record honestly)
Machine gate: no repository gate binary yet — record as NOT PRESENT unless added
```

## Known unresolved

```text
- "Vantage Production PRD v3 updated" resolves to docs/Vantage_Production_PRD_v3.md
- Governed Coding Upgrade v2.1.0 = governed-coding-upgrade skill (loaded from ~/.claude/skills)
- Cognito User Pool (AWS-side resource) — repository-owned portions only; AWS-side action listed at close
```

# PRYSM-NEXT-01 — Master Programme Checklist

**Version:** 1.0.0 (frozen at WP-A)
**Skill:** governed-coding-upgrade v2.1.0
**Branch:** feat/prysm-next-product-upgrade
**Required starting SHA:** b2e713bdd9fff83cb6bc034272b3d4e10f9adbd8
**Baseline active cycle time:** recorded at WP-L closure from per-WP records (programme-level; per-WP baselines recorded in each WP checklist).
**Objective:** Upgrade Prysm into a defensible conversion-readiness product (CRIT 73.5 → ≥99 in every repository-provable area) while preserving and proving the frozen production spine, artifact plumbing, tenant isolation, review/approval path, and report delivery.

Each WP has its own frozen checklist (created at WP start) with detailed IDs. This master file tracks the programme gates; every item is binary `[x] PASS — evidence` or `[ ] FAIL — evidence`.

## Programme gates

- [x] PRYSM-NEXT-01-WPA-01 — Verified remote/current main SHA equals b2e713b before any change. Evidence: `git fetch origin --prune` + `git rev-parse origin/main` = b2e713bdd9fff83cb6bc034272b3d4e10f9adbd8 (matches last audited main).
- [x] PRYSM-NEXT-01-WPA-02 — Working tree classified before touching: only untracked generated test artifacts (services/worker/artifacts/, tenant-accept-* runs); pre-existing provisioning branch work preserved untouched.
- [x] PRYSM-NEXT-01-WPA-03 — GCU loaded and version recorded. Evidence: governed-coding-upgrade v2.1.0 (VERSION file); source SHA N/A (not a git repo); persistent learning NOT SUPPORTED by v2.1.0 — recorded in WORKSPACE.
- [x] PRYSM-NEXT-01-WPA-04 — Feature branch feat/prysm-next-product-upgrade created from verified main b2e713b; main untouched.
- [x] PRYSM-NEXT-01-WPA-05 — Production spine + producer→contract→consumer map frozen in PRYSM-NEXT-01_PRODUCTION_SPINE.md.
- [ ] PRYSM-NEXT-01-WPA-06 — Baseline worker suite executed and recorded (npm test + acceptance-prysm, -tenant, wp2..wp12, task7/9/10) — see baseline evidence log.
- [ ] PRYSM-NEXT-01-WPA-07 — Baseline web suite executed and recorded (tsc --noEmit, next build, playwright tests/wp11).
- [ ] PRYSM-NEXT-01-WPA-08 — Baseline governance checkpoint committed + branch pushed.

## Work packages (each with its own frozen checklist before implementation)

- [ ] PRYSM-NEXT-01-WPB — WP-B Evidence Acquisition Sufficiency — checklist frozen, implemented, verified, checkpoint committed.
- [ ] PRYSM-NEXT-01-WPC — WP-C Capability Evidence V2 — checklist frozen, implemented, verified, checkpoint committed.
- [ ] PRYSM-NEXT-01-WPD — WP-D Scoring V4 / Eligibility Closure — math independently proven; CRIT weighting defect reproduced-or-disproven; checklist frozen, implemented, verified, checkpoint committed.
- [ ] PRYSM-NEXT-01-WPE — WP-E Functional Conversion Path — checklist frozen, implemented, verified, checkpoint committed.
- [ ] PRYSM-NEXT-01-WPF — WP-F User Provisioning — ACCT-PROVISION-01 integrated via cherry-pick; checklist frozen, verified, checkpoint committed.
- [ ] PRYSM-NEXT-01-WPG — WP-G Report Design V2 — v1 compatibility proven; v2.0.0 version boundary; checklist frozen, implemented, verified, checkpoint committed.
- [ ] PRYSM-NEXT-01-WPH — WP-H Application Product UX — checklist frozen, implemented, verified, checkpoint committed.
- [ ] PRYSM-NEXT-01-WPI — WP-I Full Plumbing Proof — controlled end-to-end through real composition boundaries incl. failure paths; no hardcoded counters; global escape guards; full regression.
- [ ] PRYSM-NEXT-01-WPJ — WP-J CRIT Adversarial Review — independent scoring in ≥11 areas; every <99 corrected or honestly held.
- [ ] PRYSM-NEXT-01-WPK — WP-K Calibration Harness — ≥10 deterministic fixture sites with proven ranking/assessment behaviour + convergence measurement.
- [ ] PRYSM-NEXT-01-WPL — WP-L Final Governed Closure — full verification sequence, app-security-hardening gate, exact-head CI green, three independent audits, PR created/updated, NO MERGE.

## Programme-wide counters (verified by executable guards at WP-I/WP-L, not prose)

- [ ] Live paid DataForSEO calls: 0
- [ ] Live model/provider calls: 0
- [ ] Live Cognito user creations: 0
- [ ] Real form submissions: 0
- [ ] Production deployments: 0
- [ ] Merges: 0

## Frozen decisions (see WORKSPACE D-01..D-11)

D-02 ACCT-PROVISION-01 cherry-pick integration at WP-F; D-03 report-design v2.0.0 successor token; D-04 scoring v4 versioned; D-05 capability-evidence v2 additive layer; D-06 deterministic important-page selector + no second crawler; D-07 Playwright narrow validation only, never submits; D-08 versioned business-context intake; D-09 unknown ≠ absent; D-10 machine gate recorded honestly.

## Final report obligations (WP-L)

Consolidated GCU-format report including: GCU version/SHA, learning invocation result, starting/final SHA, exact files changed, contracts+versions, report-design versions, scoring version, evidence version, provisioning architecture, DFS capabilities, Playwright additions, old-plumbing regression result, v1 report compatibility result, v2 report result, all test counts, exact-head CI result, provider/model calls, external side effects, cost, CRIT before/final scores by area, remaining live calibration requirements, remaining production activation steps, blockers, merge recommendation, deployment recommendation.

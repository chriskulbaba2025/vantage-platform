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
- [x] PRYSM-NEXT-01-WPA-06 — Baseline worker suite executed and recorded. Evidence (`.governance/evidence/baseline-worker.log` + reruns): npm test EXIT=0; acceptance-prysm/tenant/wp2/wp3/wp5/wp6/task7/wp7/wp8/wp9/task10/wp10/wp11/wp12 EXIT=0; acceptance-wp4 57/57 PASS with controlled migrated postgres (PRYSM_TEST_DATABASE_URL → docker prysm-baseline-pg:5433); acceptance-task9 12/12 PASS after proof-only harness fix (DEF-11).
- [x] PRYSM-NEXT-01-WPA-07 — Baseline web suite executed and recorded. Evidence: tsc --noEmit EXIT=0 (after stale `.next` cleanup — TS2307 artifacts from provisioning checkout); next build EXIT=0 (10/10 pages); playwright tests/wp11 8/8 passed.
- [x] PRYSM-NEXT-01-WPA-08 — Baseline governance checkpoint committed + branch pushed. Commits: cc6bbe1 (workspace/spine/checklist) + WP-A closure commit (defect registry, baseline evidence, task9 proof-only fix).

## Work packages (each with its own frozen checklist before implementation)

- [x] PRYSM-NEXT-01-WPB — WP-B Evidence Acquisition Sufficiency — checklist 15/15 [x]; evidence matrix committed; checkpoint 03d9f6e.
- [x] PRYSM-NEXT-01-WPC — WP-C Capability Evidence V2 — checklist 8/8 [x]; capability matrix committed; checkpoint 0ca90c6.
- [x] PRYSM-NEXT-01-WPD — WP-D Scoring V4 / Eligibility Closure — math independently proven (WP-D-01 hand-derived test); CRIT weighting defect corrected; checklist 13/13 [x]; checkpoint 81eff44.
- [x] PRYSM-NEXT-01-WPE — WP-E Functional Conversion Path — checklist 7/7 [x]; checkpoint 1feee1d.
- [x] PRYSM-NEXT-01-WPF — WP-F User Provisioning — ACCT-PROVISION-01 integrated via cherry-pick 014d2b8+4d1f1e7; checklist 6/6 [x]; checkpoint 1c9ab3d.
- [x] PRYSM-NEXT-01-WPG — WP-G Report Design V2 — v1 compatibility proven (template lock + zero v1 file changes); v2.0.0 boundary; checklist 6/6 [x]; checkpoint ce47e91.
- [x] PRYSM-NEXT-01-WPH — WP-H Application Product UX — checklist 5/5 [x]; checkpoint 62d2db4.
- [x] PRYSM-NEXT-01-WPI — WP-I Full Plumbing Proof — checklist PRYSM-NEXT-01_WPI_CHECKLIST.md; 52-gate controlled end-to-end with REAL schemas + REAL validator; escape guards measured; checkpoint 4d4b7f8 (reworked in WP-J).
- [x] PRYSM-NEXT-01-WPJ — WP-J CRIT Adversarial Review — independent reviews 93 → 95 → final rescore (recorded in DEFECT_REGISTRY); every repository-controlled defect corrected; checkpoints c7ced68 + 948c87f.
- [x] PRYSM-NEXT-01-WPK — WP-K Calibration Harness — checklist PRYSM-NEXT-01_WPK_CHECKLIST.md; 10 fixture sites, 19 behavioural gates, convergence record; checkpoint d866006.
- [x] PRYSM-NEXT-01-WPL — WP-L Final Governed Closure — full verification at 948c87f (npm 775/775, CI-equivalent set, WP-I 52/52, calibration 19/19, 17 acceptance suites, template lock, tsc/build, Playwright 15/15 clean); exact-head CI green (run 31970585666); three independent audits; PR #50; NO MERGE.

## Programme-wide counters (verified by executable guards at WP-I/WP-L, not prose)

- [x] Live paid DataForSEO calls: 0 — guarded fetch never invoked (WP-I Phase 7, zero violations); fixture-mode-only transports.
- [x] Live model/provider calls: 0 — WP7-REPLAY-02 static+behavioural; WP-I narrativeCallsMade null, cost null.
- [x] Live Cognito user creations: 0 — PRYSM_IDENTITY_MODE=mock below the provider boundary; AP-06 zero-live guard armed.
- [x] Real form submissions: 0 — validator has zero click/fill/submit paths (grep + behavioural tests).
- [x] Production deployments: 0 — single workflow, no deploy steps.
- [x] Merges: 0 — `git log --merges b2e713b..HEAD` empty; PR #50 unmerged.

## Frozen decisions (see WORKSPACE D-01..D-11)

D-02 ACCT-PROVISION-01 cherry-pick integration at WP-F; D-03 report-design v2.0.0 successor token; D-04 scoring v4 versioned; D-05 capability-evidence v2 additive layer; D-06 deterministic important-page selector + no second crawler; D-07 Playwright narrow validation only, never submits; D-08 versioned business-context intake; D-09 unknown ≠ absent; D-10 machine gate recorded honestly.

## Final report obligations (WP-L)

Consolidated GCU-format report including: GCU version/SHA, learning invocation result, starting/final SHA, exact files changed, contracts+versions, report-design versions, scoring version, evidence version, provisioning architecture, DFS capabilities, Playwright additions, old-plumbing regression result, v1 report compatibility result, v2 report result, all test counts, exact-head CI result, provider/model calls, external side effects, cost, CRIT before/final scores by area, remaining live calibration requirements, remaining production activation steps, blockers, merge recommendation, deployment recommendation.

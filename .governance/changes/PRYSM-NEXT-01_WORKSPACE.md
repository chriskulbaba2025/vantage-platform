# PRYSM-NEXT-01 — Governed Product-Upgrade Programme Workspace

**Change ID:** PRYSM-NEXT-01
**Change class:** Multi-work-package governed product upgrade (upgrade, not rebuild)
**Repository:** chriskulbaba2025/vantage-platform
**Branch:** feat/prysm-next-product-upgrade
**PR:** TBD (created at WP-L closure)
**Required starting SHA:** b2e713bdd9fff83cb6bc034272b3d4e10f9adbd8
**Verified actual main SHA at programme start:** b2e713bdd9fff83cb6bc034272b3d4e10f9adbd8 (matches last independently audited Prysm main — verified via `git fetch origin --prune` on 2026-08-16)
**Branch base:** origin/main @ b2e713b — branch created from verified current main only; main untouched.

## Active GCU process

- **Skill:** governed-coding-upgrade
- **Version:** 2.1.0 (file evidence: `~/.claude/skills/governed-coding-upgrade/VERSION`)
- **Source SHA:** N/A — installed skill directory is not a git repository (verified: `git -C <skill-dir> log` exits 128). Skill package files: SKILL.md (20,381 bytes) + VERSION.
- **Governed persistent learning:** NOT SUPPORTED by GCU v2.1.0 — the skill package contains no learning-invocation module or contract (SKILL.md §28 final-report template has no learning field). Recorded honestly; no learning invocation performed.
- **Local-vs-public check:** skill is a local installation; no newer public process was discovered. v2.1.0 used as authoritative for this run.

## Governing sources (read at programme start)

- docs/Vantage_Production_PRD_v3.md — PRD (read in full)
- docs/prysm-governance/PRYSM_REBUILD_ACCELERATION_STANDARD_v1.1.md (read in full; supersedes v1.0)
- docs/prysm-governance/02_PRYSM_REPORT_IMMUTABILITY_CONTRACT.md (read; highest authority)
- .governance/GOVERNED_CHANGE_PROFILE.md (read)
- Global Governed Build Standard (user-level, in force)

## Pre-existing work classification (before any change)

| Item | Classification | Action |
|---|---|---|
| Local branch feat/prysm-account-provisioning @ d3e9403 (2 commits ahead of main) | Pre-existing user work: ACCT-PROVISION-01, PR #49, implementation + CI complete, awaiting merge authorization | Preserved untouched on its branch. Integration decision recorded below. |
| Untracked services/worker/artifacts/ | Generated test output from prior acceptance runs (tenant-accept-* fixture evidence) | Classified as generated artifact, not source. `.gitignore` entry added; files not deleted. |
| Everything else | Clean working tree at b2e713b | — |

## Programme objective

Create the next production version of Prysm as a defensible conversion-readiness product (upgrade, not rebuild) while preserving and proving the existing production audit lifecycle, governed artifact plumbing, tenant isolation, review/approval path, and report delivery. CRIT baseline 73.5/100; target ≥99 in every repository-provable area.

## Release intent per work package

Each work package WP-A…WP-L is declared `CHANGE_ONLY` within its own frozen checklist (repo has no staging environment; final `PRODUCTION_READY` assessment is made only at WP-L closure via the full-system readiness gate — merge/deploy remain prohibited without explicit authorization).

## External-call policy (programme-wide)

Live paid DataForSEO calls: 0. Live model/provider calls: 0. Live Cognito user creations: 0. Real form submissions: 0. Production deployments: 0. Merges: 0. Fixtures and controlled transports only. These counters are verified at WP-I and WP-L with executable guards, not prose.

## Key decisions (frozen at programme start, per GCU authority order)

1. **D-01 Branch:** feature branch `feat/prysm-next-product-upgrade` created from verified current main b2e713b. Main is never modified.
2. **D-02 ACCT-PROVISION-01 integration:** the unmerged provisioning work (commits 58f16cc, d3e9403 on feat/prysm-account-provisioning) satisfies the programme's user-provisioning requirement. It will be integrated into this branch at WP-F via cherry-pick (preserving authorship), followed by the full WP-F verification pass. The original branch and PR #49 remain untouched.
3. **D-03 Report versioning:** report design v1 (`prysm-report-design-v1.0.0`) remains immutable (contract 02, highest authority). WP-G creates a distinct governed report-design version `prysm-report-design-v2.0.0` unless repository inspection proves another canonical scheme (the immutability contract records `prysm-report-design-v1.0.0` as the version token — a v2.0.0 successor of that token is the canonical pattern). Existing v1 output must remain renderable/retrievable; new audits select v2 only through the versioned product contract.
4. **D-04 Scoring versioning:** scoring semantics changes land under a new scoring version (target: v4.0.0) — current scoring is versioned in contracts; historical reproducibility preserved. No silent mutation of v-current results.
5. **D-05 Capability evidence:** new versioned capability-evidence contract (target: capability-evidence v2) as an additive layer; old decision-evidence contract stays readable for historical reports.
6. **D-06 Crawl strategy:** broad crawl (≤500 pages default) for technical/site structure; deterministic important-page selector for deep content + browser analysis. No second full crawler; existing first-party DOM/HTML extraction (evidence/page-extractor.js, evidence/site-crawler.js) and Playwright capability are integrated selectively.
7. **D-07 Browser validation:** Playwright used ONLY for narrow conversion-path validation on selected decision-bearing pages; NEVER submits external forms; failure ⇒ Not Assessed, never a lower score.
8. **D-08 Business context:** intake contract gains versioned business-context fields (language/locale, services/offers, primary conversion goal, audiences, primary conversion action) and scoring must consume them. Existing intake contract is not silently mutated — versioned successor.
9. **D-09 Unknown ≠ absent:** unknown/unavailable observations must never hydrate to 0/false/[]/{} on score-bearing paths. Fail-closed hydration + capability status gates.
10. **D-10 Machine gate:** profile records "no repository gate binary yet". We do NOT claim a machine gate exists; record honestly per change.
11. **D-11 GCU repository:** the GCU skill/repo is not modified as part of this change.

## Workspace files

- PRYSM-NEXT-01_WORKSPACE.md (this file)
- PRYSM-NEXT-01_PRODUCTION_SPINE.md — frozen production spine + producer→contract→consumer map
- PRYSM-NEXT-01_CHECKLIST.md — master programme checklist (per-WP gate IDs; per-WP frozen checklists are added under docs/prysm-governance/work-packages/ or .governance/changes/ as each WP starts)
- ../evidence/ — untracked baseline/log evidence (gitignored)

## Baseline evidence

- Worker: `.governance/evidence/baseline-worker.log` (npm test + 16 acceptance suites)
- Web: `.governance/evidence/baseline-web.log` (tsc, next build, playwright tests/wp11)
- Recorded counts transcribed into PRYSM-NEXT-01_CHECKLIST.md once complete.

## Programme order

WP-A baseline/spine freeze → WP-B evidence acquisition → WP-C capability evidence v2 → WP-D scoring v4/eligibility → WP-E functional conversion path → WP-F user provisioning → WP-G report v2 → WP-H app UX → WP-I full plumbing proof → WP-J CRIT adversarial review → WP-K calibration harness → WP-L final closure. Continue automatically through safe repository-controlled work; stop only at explicit prohibition boundaries.

# PRYSM CA14 stuck-SCORED integrated closure

## Scope

- Target: `https://ca14.biz/`
- Audit: `490fe40e-5c7d-428f-a45b-c27b0613f6a4`
- Original production SHA: `aea98ed497827c89ce030a7670ce834611681d0b`
- Integrated source commit: `626e122`
- Final candidate SHA: recorded by the exact-head proof for the commit containing this handoff

## Proven incident

The persisted CA14 audit was at `SCORED` after collection and scoring. Exact offline replay of its persisted artifacts against the original production source failed during deterministic Narrative v2 preparation because `findings.json` was an empty array. The first divergent boundary was `runNarrativeV2FromScored -> prepareCanonicalSolutions`. No Writer/Judge call was made during replay.

## Integrated repair

The current production lineage retains the generalized www/apex sitemap same-site normalization repair. The sibling stuck-SCORED repair is integrated unchanged: deterministic preparation failure transitions `SCORED -> NARRATIVE_FAILED` with reason `narrative-v2-preparation-failed`, marks the path recoverable, preserves canonical evidence fallback authority, and prevents a false-active polling loop. No CA14-specific logic was added.

## Verification

- Exact combined replay: `NARRATIVE_FAILED`, recoverable, zero model calls.
- Targeted suite: 106 passed, 0 failed.
- Full worker suite: 1,053 passed, 0 failed, 0 skipped.
- Additional narrative-v2/lifecycle/artifact/schema/orchestration suites: 381 passed, 0 failed.
- New DataForSEO calls: 0.
- New paid model calls: 0.
- Production data mutation before the authorized code promotion: none.

## Recovery boundary

The exact persisted CA14 artifact set contains no Narrative v2 or report-v2 artifact. Resuming the exact audit after deployment therefore requires the governed Writer/Judge continuation. The resume is intentionally stopped before that paid operation pending explicit authorization.

## Exact next action

Authorize the persisted CA14 audit's governed Narrative v2 Writer/Judge continuation, then resume audit `490fe40e-5c7d-428f-a45b-c27b0613f6a4` without recollection or replacement-audit creation.

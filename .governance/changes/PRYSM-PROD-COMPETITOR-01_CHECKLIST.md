# PRYSM-PROD-COMPETITOR-01 — Supplied Competitor Production Closure

**Skill:** governed-coding-upgrade v2.1.0  
**Release intent:** CHANGE_ONLY  
**Starting SHA:** 7a22697fef5216e252ce0b2872d9e4840ae9fa0e  
**Validated competitor code head:** 36804ec6b07da2d5f405e9f0b9d94fa199ae1f96  
**PR:** #59 (draft)

## Objective

Reconnect the existing governed supplied-competitor crawl capability to the real production competitor source so user-supplied URLs produce bounded, evidence-backed competitor comparisons instead of being preserved as unused metadata.

## Production spine

New Audit input `competitors[]` → AuditApplicationService/AuditRequest → production `dataforseo-serp` adapter → bounded existing `crawlCompetitors()` direct crawl + existing SERP discovery → SourceResult validation/persistence → `buildDecisionEvidence()` competitor hydration → `competitorComparison()` → v2 report competitor section.

## Producer → Contract → Consumer

| Producer | Object | Contract / validation | Consumer | Required behavior |
|---|---|---|---|---|
| New Audit / AuditRequest | `competitors[]` | audit-request contract | dataforseo-serp adapter | preserve supplied URLs |
| dataforseo-serp adapter v1.1.0 | SourceResult `evidence.competitors[]` | source-result schema before persistence | decision-evidence hydration | direct supplied rows carry usable evidence + item availability |
| decision-evidence hydration | `evidence.competitors[]` | decision-evidence schema before persistence | scoring/report model | preserve per-item availability and direct-crawl evidence |
| `competitorComparison()` | comparison rows | report-model / report-view-model path | v2 renderer | render evidence-backed benchmark; never fabricate unavailable evidence |

## Acceptance freeze

- Real production adapter executes.
- Direct crawl uses the existing `crawlCompetitors()` production module.
- Test transport is injected below those production modules; zero live HTTP/provider/browser calls.
- Supplied direct crawl is bounded to max 8 pages per URL and `browserMode: "never"` for this closure.
- Only usable 2xx/3xx HTML captures are admitted as direct benchmark evidence.
- Supplied direct evidence is preferred over duplicate same-domain SERP rows.
- SERP-discovered competitors are not direct-crawled unless explicitly supplied by the user.
- Source-level PARTIAL/NOT_CONNECTED does not erase an individually AVAILABLE direct competitor row.
- Mixed supplied success/failure remains PARTIAL while preserving usable rows.
- Failed supplied crawl stays unavailable and cannot create a fabricated comparison.
- Adapter version changes from 1.0.0 to 1.1.0 so source execution identity cannot reuse old checkpoints.

## Competitor change-specific permitted files

The competitor change-specific diff from starting SHA `7a22697fef5216e252ce0b2872d9e4840ae9fa0e` is restricted to:

- `services/worker/src/adapters/dataforseo-serp/serp-adapter.js`
- `services/worker/src/evidence/decision-evidence.js`
- `services/worker/src/adapters/dataforseo-serp/supplied-competitor-production-path.test.js`
- `.governance/changes/PRYSM-PROD-COMPETITOR-01_CHECKLIST.md`

PR #59 is cumulative and additionally contains the previously validated Defect 1 production-default change in:

- `services/worker/src/application/audit-service.js`
- `services/worker/src/audit/path-validation-default.test.js`

The temporary `.github/workflows/prysm-competitor-aux-verify.yml` workflow was verification-only and is removed before the final checkpoint; it is not part of the governed product change.

## Prohibited

- No report renderer changes.
- No scoring-weight changes.
- No schema-version changes.
- No lifecycle/auth/database changes.
- No seventh production source/adapter.
- No live DataForSEO, website, browser, model, n8n, GA4, GSC, backlink, or production-audit calls.
- No merge, deploy, approval, or publication.

## Verification evidence

- Earlier mandatory run `32305108796` on competitor head `1068a5bb4982ee74d32ea2bbbf59ab4379a347f5` failed before checkout because the self-hosted runner could not bind PostgreSQL port 5432 (`address already in use`); no product code executed in that failed run.
- Auxiliary run `32305108943` on `1068a5bb4982ee74d32ea2bbbf59ab4379a347f5`: SUCCESS.
- After adding explicit mixed-success/failure and SERP-no-direct-crawl regressions, mandatory Vantage Worker CI run `32308597988` on `36804ec6b07da2d5f405e9f0b9d94fa199ae1f96`: SUCCESS. Container initialization, full worker regression, lifecycle/PostgreSQL tests, schemas, artifacts, orchestrator, WP2–WP12 acceptance, and provisioning acceptance all completed successfully.
- Auxiliary run `32308598028` on `36804ec6b07da2d5f405e9f0b9d94fa199ae1f96`: SUCCESS. Focused supplied-competitor production-path test, full worker test suite, schema checks, orchestrator, WP6, WP12, and Prysm acceptance all completed successfully.
- All supplied-competitor tests use controlled transports. No live DataForSEO, competitor-site, browser, LLM, production audit, or other provider call is made by the verification path.

## Checklist

- [x] PC-01 — Production adapter directly collects bounded evidence for supplied competitor URLs through existing `crawlCompetitors()`.
- [x] PC-02 — Adapter version is 1.1.0 and existing production bootstrap consumes that exported version.
- [x] PC-03 — Successful supplied evidence remains individually AVAILABLE when the composite source is PARTIAL, including mixed supplied success/failure.
- [x] PC-04 — Same-domain SERP rows are de-duplicated in favor of supplied direct evidence; unrelated SERP rows remain and are not direct-crawled.
- [x] PC-05 — Failed or HTTP-error-only supplied URL creates limitation/failed coverage only; no fabricated comparison row.
- [x] PC-06 — No SERP credentials + successful supplied crawl yields usable competitor evidence without any DataForSEO request.
- [x] PC-07 — Real `buildDecisionEvidence()` + `competitorComparison()` produces an evidence-backed row rather than `Unavailable` or `Insufficient Evidence`.
- [x] PC-08 — Focused deterministic tests pass with controlled transports and zero live calls/browser launches.
- [x] PC-09 — Full worker regression and governed CI-equivalent checks are green on the validated competitor code head.
- [x] PC-10 — Competitor change-specific diff is restricted to the permitted files; cumulative PR scope is explicitly recorded; PR remains draft/unmerged/unreleased.
- [x] PC-11 — Mandatory GitHub Actions Vantage Worker CI succeeds on the validated competitor code head (`32308597988`).

## Machine gate

Repository machine gate: NOT PRESENT per Governed Change Profile. Mandatory GitHub Actions and focused auxiliary verification are green on the validated competitor code head. Final verification-only cleanup does not alter production or test code.
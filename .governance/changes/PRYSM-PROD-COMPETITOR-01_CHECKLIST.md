# PRYSM-PROD-COMPETITOR-01 — Supplied Competitor Production Closure

**Skill:** governed-coding-upgrade v2.1.0  
**Release intent:** CHANGE_ONLY  
**Starting SHA:** 7a22697fef5216e252ce0b2872d9e4840ae9fa0e  
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
- Supplied direct evidence is preferred over duplicate same-domain SERP rows.
- Source-level PARTIAL/NOT_CONNECTED does not erase an individually AVAILABLE direct competitor row.
- Failed supplied crawl stays unavailable and cannot create a fabricated comparison.
- Adapter version changes from 1.0.0 to 1.1.0 so source execution identity cannot reuse old checkpoints.

## Permitted files

- `services/worker/src/adapters/dataforseo-serp/serp-adapter.js`
- `services/worker/src/evidence/decision-evidence.js`
- `services/worker/src/adapters/dataforseo-serp/supplied-competitor-production-path.test.js`
- `.governance/changes/PRYSM-PROD-COMPETITOR-01_CHECKLIST.md`

## Prohibited

- No report renderer changes.
- No scoring-weight changes.
- No schema-version changes.
- No lifecycle/auth/database changes.
- No seventh production source/adapter.
- No live DataForSEO, website, browser, model, n8n, GA4, GSC, backlink, or production-audit calls.
- No merge, deploy, approval, or publication.

## Checklist

- [ ] PC-01 — Production adapter directly collects bounded evidence for supplied competitor URLs through existing `crawlCompetitors()`.
- [ ] PC-02 — Adapter version is 1.1.0 and existing production bootstrap consumes that exported version.
- [ ] PC-03 — Successful supplied evidence remains individually AVAILABLE when the composite source is PARTIAL.
- [ ] PC-04 — Same-domain SERP rows are de-duplicated in favor of supplied direct evidence.
- [ ] PC-05 — Failed supplied URL creates limitation/failed coverage only; no fabricated comparison row.
- [ ] PC-06 — No SERP credentials + successful supplied crawl yields usable competitor evidence without any DataForSEO request.
- [ ] PC-07 — Real `buildDecisionEvidence()` + `competitorComparison()` produces an evidence-backed row rather than `Unavailable` or `Insufficient Evidence`.
- [ ] PC-08 — Focused deterministic tests pass with measured zero live calls/browser launches.
- [ ] PC-09 — Full worker regression and governed CI-equivalent checks remain green.
- [ ] PC-10 — Final diff contains only permitted files and PR remains draft/unmerged/unreleased.
- [ ] PC-11 — Exact-head GitHub Actions CI succeeds.

## Machine gate

Repository machine gate: NOT PRESENT per Governed Change Profile. Exact-head GitHub Actions is mandatory for this CHANGE_ONLY result.

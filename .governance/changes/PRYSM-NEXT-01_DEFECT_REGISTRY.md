# PRYSM-NEXT-01 — Confirmed Defect Registry

**Status:** live registry; each defect is proven by source inspection at b2e713b before any implementation, and closed by its owning WP with direct proof.

## Confirmed by code inspection (pre-implementation evidence)

| ID | Defect | Evidence (file:line at b2e713b) | Owning WP | Status |
|---|---|---|---|---|
| DEF-01 | Partial-dimension weighting: overall readiness numerator multiplies dimension score by FULL intended weight while denominator sums only assessed weight — partial dimensions are silently over-weighted | scoring/vantage-score.js:257-266 (`totalWeightedScore += dimData.score * dimData.totalWeight` vs `totalScoredWeight += dimData.assessedWeight`) | WP-D | OPEN |
| DEF-02 | Source-level eligibility: `checkModuleEligibility` gates on source status only; PARTIAL crawl makes ALL crawl modules eligible even when the module's required fields were not collected | scoring/score-components.js:567-613 | WP-C/WP-D | OPEN |
| DEF-03 | Unknown→false scoring leakage: module scorers (scoreTrust, scoreContent, scoreConversion, scoreOfferClarity, scoreRiskReduction, scoreFunnelCoverage, scoreSchemaEntity, scoreAiReadiness) consume `false`/empty values directly; when `_contentEvidenceAvailable === false` (DFS pages endpoint has no body text) trust/schema/cta/forms are all false/empty and lower scores | scoring/score-components.js:204-305; adapter sets `_contentEvidenceAvailable:false` at dataforseo-onpage-adapter.js | WP-C/WP-D | OPEN |
| DEF-04 | Arbitrary funnel classification: `stage: index % 3 === 0 ? "TOFU" : index % 3 === 1 ? "MOFU" : "BOFU"` | scoring/report-model.js:42 | WP-D | OPEN |
| DEF-05 | AI-readiness overclaim: `scoreAiReadiness` awards schema/faq points from unknown-absent data and a floor of 5 topics points; funnel `aiReadiness` same pattern; claims structural readiness as more | scoring/score-components.js:298-305, vantage-score.js:224-233 | WP-D | OPEN |
| DEF-06 | DFS OnPage evidence under-utilization: no `enable_content_parsing` on task_post, no /on_page/content_parsing endpoint method | adapters/dataforseo-onpage/dataforseo-onpage-client.js (task_post body, no content_parsing) | WP-B | CLOSED — content parsing integrated, key-page scoped; adapter 1.1.0; tests WP-B-02/08/09/10 green |
| DEF-07 | Microdata called without `validate_micromarkup` prerequisite on task_post — endpoint will return empty in production | dataforseo-onpage-client.js (task_post body lacks validate_micromarkup; getMicrodata exists) | WP-B | CLOSED — validate_micromarkup default true; microdataTypes normalized + merged into schemaTypes |
| DEF-08 | Redirect-chains / non-indexable / resources evidence not implemented | dataforseo-onpage-client.js (no such methods) | WP-B | CLOSED — getRedirectChains/getNonIndexable/getResources implemented + normalized (redirectChains, nonIndexablePages, pageResources) with acquisition ledger |
| DEF-09 | Business context unused by scoring: scorers receive only (site, performance); intake business context (services, goal, audiences, locale) not passed | score-components.js scorers; vantage-score.js:456 | WP-D | OPEN |
| DEF-10 | Evidence-confidence silent imputation: unknown factors default to 50 (`factors[factor] ?? 50`) with no provenance of the default | score-components.js:550-555 | WP-C/WP-D | OPEN |
| DEF-11 | Stale acceptance harness: acceptance-task9.js review checklist lacked `internal_link_recommendations` (added to review-gate by task10) — proof-only defect | scripts/acceptance-task9.js:30 vs review-gate.js:48 | WP-A | CLOSED (proof-only fix cc6bbe1-run; task9 12/12) |
| DEF-12 | `contentEvidenceAvailable` default-true: `site._contentEvidenceAvailable !== false` treats missing marker as available | score-components.js:646 (consumption); decision-evidence.js hydrateSite (hydration) | WP-C/WP-D | WP-C done: hydration now unknown-preserving (undefined stays undefined). WP-D: strict consumption via capability statuses |

## CRIT audit items verified as ALREADY SATISFIED at b2e713b

- PageSpeed primary + Lighthouse fallback with provenance (pagespeed-client.js; acceptance T7 suites green) — CRIT #26 hold: do not add DFS Lighthouse.
- Deterministic finding IDs + scoring timestamps (generateFindingId, deriveScoredAt).
- Report immutability v1.0.0 contract + template lock (verify-template.js; wp5/wp8/wp10 green).
- Human review gate, approved multi-page report, partial-render blocking (wp10/wp11/wp12 green).
- Tenant isolation with authorization-before-retrieval (acceptance-tenant green).
- No secrets in client bundles (Playwright SEC-01 green).
- Retry/backoff/durable-task resume on DFS adapter (PRYSM-CLOSE-12; wp6 green).

## Baseline environment notes

- acceptance-wp4 PG rollback proof requires a migrated PostgreSQL: controlled `prysm-baseline-pg` docker postgres:16 on 127.0.0.1:5433 with migrations 001-003 applied; run via `PRYSM_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres`. Recorded for WP-L reproducibility.
- Stale `.next` from the provisioning-branch checkout caused tsc TS2307 on app/admin types; `rm -rf .next` + rerun → tsc EXIT=0.

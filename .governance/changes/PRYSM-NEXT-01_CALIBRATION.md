# PRYSM-NEXT-01 — Calibration Record (WP-K)

**Harness:** services/worker/scripts/calibration-harness.js (19 behavioural gates, zero live calls)
**Fixtures:** ten deterministic decision-evidence fixtures exercised through the REAL scoring v4.1 path.

## Fixture behaviour (measured at the WP-K head)

| Fixture | Readiness | Status | Assessed | Confidence | Findings | Capabilities A/P |
|---|---|---|---|---|---|---|
| strong-conversion-ready | 82 | Complete | 100% | 94 | 0 | 12/0 |
| weak-thin-content | 17 | Complete | 100% | 94 | 6 | 9/0 |
| strong-content-broken-path | 69 | Complete | 100% | 94 | 0 | 9/0 |
| technically-strong-weak-offer | 49 | Complete | 100% | 94 | 2 | 9/0 |
| js-heavy (content UNAVAILABLE) | null | Insufficient Evidence | 20% | 94 | 0 | 1/1 |
| partial-provider-failure | 75 | Complete | 90% | 71 | 0 | 8/0 |
| schema-rich | 65 | Complete | 100% | 95 | 1 | 9/0 |
| no-schema | 59 | Complete | 100% | 95 | 2 | 9/0 |
| multi-service | 81 | Complete | 100% | 94 | 0 | 9/0 |
| very-small | 17 | Complete | 100% | 94 | 6 | 9/0 |

## Proven behaviours (19/19 gates)

- Ranking: strong > weak-thin; strong > broken-path; strong ≥ technically-strong; technically-strong > weak-thin; schema-rich entity ≥ no-schema; multi-service content > weak-thin.
- State honesty: js-heavy suppresses the numeric score (Insufficient Evidence, 20% assessed) and the trust module — unknown never becomes false-absent; no trust/schema false-positive findings.
- Failure isolation: performance FAILED → module suppressed, assessed weight exactly 90%, Complete label.
- Convergence: strong fixture assesses 12/13 capabilities from 6 pages; js-heavy only 1/1 — crawl/page evidence convergence is measurable.
- Determinism: repeated scoring of the strong fixture is byte-identical.

## Interpretation notes

- confidence=94 on js-heavy reflects source-level signals (crawl PARTIAL + perf AVAILABLE), not content depth — the capability layer carries the honest granularity for report v2. A future scoring version may weight confidence by capability coverage (recorded as a live-pilot candidate, NOT changed here).
- strong-content-broken-path has 0 findings: the conversion dimension scores low (no CTAs/forms) but no finding rule fires for "no CTA" when content is available. Candidate for a future rule version (recorded, not changed — rule changes are scoring-versioned).

## What still requires the future controlled LIVE pilot (not repository-provable)

1. Real DataForSEO task lifecycle against live quotas (cost, timing, 20100 behaviour at scale).
2. Real PageSpeed + CrUX provenance and fallback frequency in production.
3. Real Playwright browser runs on production sites (pathValidationLiveBrowser) — visibility/interactability of real DOMs.
4. Calibration of scoring thresholds against human auditor judgments (false-positive/false-negative rates across ≥10 real audits).
5. Cost-per-audit measurement and per-audit crawl-page calibration (marginal evidence gain).
6. Real Cognito invite emails and self-credentialing in production (repository-side proven with controlled mocks).

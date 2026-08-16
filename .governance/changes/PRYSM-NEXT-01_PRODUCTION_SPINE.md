# PRYSM-NEXT-01 — Production Spine + Producer→Contract→Consumer Map

**Status:** Frozen at programme start (WP-A). Any WP that changes a hop below must update this map with its checklist evidence.
**Basis:** docs/Vantage_Production_PRD_v3.md §6.2 audit flow; source inspection at b2e713b.

## Frozen spine (behaviours that must keep working across the upgrade)

```text
1  intake (web API + validation)                        app/api/audits/route.ts → worker audit-service.js / audit-request-persistence.js
2  source plan (per-audit, independent sources)         lifecycle/source-plan.js
3  provider adapters (each independent; failure isolation)
   - crawl:      adapters/dataforseo-onpage/{dataforseo-onpage-adapter,dataforseo-onpage-client}.js
   - fallback:   evidence/site-crawler.js (existing first-party crawler; NOT to be duplicated)
   - performance:evidence/pagespeed-client.js (PageSpeed → Lighthouse CLI fallback)
   - backlinks:  evidence/backlinks-provider.js + adapters/dataforseo-backlinks/
   - serp:       adapters/dataforseo-serp/dataforseo-serp-client.js
   - optional:   evidence/ga4-client.js, evidence/gsc-client.js
4  raw artifacts (governed, byte-preserving)            storage/governed-artifact-store.js (+memory/fs/object impls), artifact-record-validator.js, artifact-key.js
5  normalized SourceResults (provider-independent)      adapter normalizers → contracts/validator.js + source-result.schema.json; scoring/evidence-contracts.js (buildSourceStatus, validateEvidenceEnvelope, SOURCE_STATUS)
6  canonical/decision evidence                          evidence/decision-evidence.js + decision-evidence.schema.json, canonical-evidence.schema.json
7  deterministic scoring (module gates, eligibility)    scoring/vantage-score.js (scoreAudit) + scoring-service.js + score-components.js + evidence-contracts.js
8  findings (rule IDs, evidence, confidence)            scoring/diagnostic-contracts.js + finding.schema.json, score.schema.json
9  report content/view model                             report-content/build-package.js + scoring/report-model.js + report-view-model.schema.json (+narrative/narrative-service.js, schema-locked text)
10 renderer (draft + approved pages, template lock)     report/render-report.js, report/render-approved-report.js, sections-*.js, html-helpers.js, verify-template.js
11 human review gate                                     audit/review-gate.js (submitReview, isReviewComplete, validateTransition)
12 approval (all pages written before approved)         audit/run-audit.js (approveAudit) + scoring/report-finalization-gate.js
13 report access (auth BEFORE retrieval; no bytes before authorization)  app/audits/[auditId]/report routes + storage/report-store.js + identity/report-authorization.js
14 tenant authorization (server-side only; no browser-trusted tenant identity)  identity/authorization.js, identity-model.js, worker server.js guards, migrations 001-003
```

## Producer → Contract → Consumer map (material runtime handoffs)

| # | Producer | Produced object/state | Contract/schema | Validation point | Consumer | Consumer requirement | Failure result | Proof (baseline suite) |
|---|---|---|---|---|---|---|---|---|
| 1 | Web intake (app/api/audits) | audit request (targetUrl, businessName, location, language, competitors, primaryGoal, ga4.propertyId, gsc.siteUrl) | audit-request.schema.json | validateInput in run-audit.js | audit-service.js | all mandatory fields validated; strict allowlists (GA4/GSC) | 400-class reject; nothing persisted | acceptance-prysm, wp12 |
| 2 | source-plan.js | per-audit source plan | source-result.schema.json | validator.js | orchestrator | independent per-source execution | source marked FAILED, others continue | wp4, acceptance-prysm |
| 3 | DFS onpage adapter | raw crawl response bytes + task id | artifact-record.schema.json | artifact-record-validator.js | governed-artifact-store | raw bytes + SHA-256 record | retry w/ backoff; FAILED w/ preserved task id | wp3, wp6, acceptance-prysm |
| 4 | normalizers | SourceResult envelopes | source-result.schema.json + EVIDENCE_ENVELOPE_VERSION | validateEvidenceEnvelope | decision-evidence.js | provider-independent fields | malformed → rejected; no fabricated success | wp6, wp7, acceptance-prysm |
| 5 | decision-evidence.js | canonical evidence | decision-evidence.schema.json / canonical-evidence.schema.json | validator.js | vantage-score.js | unknown ≠ absent; provenance attached | fail-closed; module suppressed | wp7, wp8, wp12 |
| 6 | vantage-score.js | score + assessed weight + findings | score.schema.json, finding.schema.json | validator.js | report-model.js | eligibility from actual evidence; no silent reweighting; deterministic | provisional/insufficient labels per PRD §15.3 | wp7, wp8, wp10, wp12 |
| 7 | build-package.js + narrative-service.js | report content package (schema-locked text fields only) | report-content.schema.json, narrative-response.schema.json | build-package + validate-narrative.js | render-report.js | every ID exists in package; no HTML from n8n/LLM | package rejected; render blocked | wp8, wp9, wp10 |
| 8 | render-report.js / render-approved-report.js | draft + approved HTML pages | report-view-model.schema.json + template lock (verify-template.js) | renderer (owns pages/CSS/nav/print) | report-store.js | locked design v1.0.0; page count/order/nav; print controls | build fails on template drift | wp5, wp8, wp10, wp11 |
| 9 | review-gate.js (submitReview) | review record + transition | lifecycle-state.schema.json, lifecycle-event.schema.json | validateTransition | approveAudit | draft→reviewed only via gate; principal auditor decisions | invalid transition rejected; state unchanged | wp4, wp11, acceptance-prysm |
| 10 | approveAudit + report-finalization-gate.js | approved multi-page report + manifest | report-manifest.schema.json | finalization gate | report access routes | every required page written before approval; partial generation blocks approval | approval fails closed; no partial exposure | wp10, wp11, wp12 |
| 11 | report-access routes + report-authorization.js | report bytes to authorized tenant principal | identity authorization (authorization.js) | resolveAuthorization BEFORE store read | client viewer | tenant-scoped; cross-tenant → 404, zero bytes | non-disclosing rejection | acceptance-tenant, MT-IDENTITY-01, wp11 |

## Frozen invariants (must hold across every WP of this programme)

1. Report immutability contract v1.0.0 (design `prysm-report-design-v1.0.0`) — locked assets, renderer boundary, template/golden-master regression.
2. Lifecycle state machine transitions unchanged (lifecycle/state-enum.js).
3. Approved report immutability; re-review does not mutate approved artifacts.
4. Tenant isolation: authorization BEFORE artifact retrieval; no browser-trusted tenant identity.
5. Deterministic scoring: identical evidence ⇒ identical score/findings.
6. Missing evidence never becomes a business score of zero; suppressed modules reduce assessed weight and are reported.
7. Zero live provider/LLM calls in tests and CI.
8. No secrets in client bundles or logs.
9. Finding IDs and historical-version reproducibility: version breaking scoring semantics rather than silently mutating old results.

## Upgrade target spine additions (mapped to work packages)

- WP-B: DFS evidence expansion (content parsing, microdata, redirect chains, non-indexable, resources) through the SAME hop-3/hop-4 boundaries.
- WP-C: capability-evidence v2 as additive layer between hops 5 and 6.
- WP-D: scoring v4 at hop 6 (eligibility closure, weighting fix, business context).
- WP-E: Playwright conversion-path validation as a NEW controlled evidence source feeding hop 3→5 (inferred vs validated distinction).
- WP-F: user provisioning (cherry-picked ACCT-PROVISION-01) at hop 1 (admin intake) + hop 14 (identity).
- WP-G: report-design v2.0.0 as a NEW renderer version alongside locked v1.0.0 (hop 10).
- WP-H: web UX around hops 1, 11, 12, 13, 14.

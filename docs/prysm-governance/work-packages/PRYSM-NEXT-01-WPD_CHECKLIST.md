# Prysm PRYSM-NEXT-01 / WP-D Checklist — Scoring V4 / Eligibility Closure

**Version:** 1.0.0 (frozen before implementation)
**Skill:** governed-coding-upgrade v2.1.0
**Branch:** feat/prysm-next-product-upgrade
**Required starting SHA:** 0ca90c6 (post WP-C)
**Objective:** One measurable outcome — scoring version 4.0.0 uses capability-level module eligibility (no unknown-derived scores), computes overall readiness as the assessed-weight-weighted mean (CRIT weighting defect corrected), consumes business context, removes arbitrary funnel classification, and tightens AI-readiness claims; proven by exhaustive truth tables and repeatability tests.
**Baseline active cycle time (written estimate):** 6.0h. **55% target:** ≤ 2.7h.

## Permitted files

- [x] `.governance/changes/**`
- [x] `docs/prysm-governance/work-packages/PRYSM-NEXT-01-WPD_CHECKLIST.md`
- [x] `services/worker/src/scoring/score-components.js`
- [x] `services/worker/src/scoring/vantage-score.js`
- [x] `services/worker/src/scoring/report-model.js`
- [x] `services/worker/src/scoring/scoring-service.js`
- [x] `services/worker/src/scoring/vantage-score.test.js`
- [x] `services/worker/src/scoring/score-components.test.js` (new — module-eligibility unit truth tables)
- [x] `services/worker/scripts/acceptance-wp7.js` (proof-only harness updates ONLY where v4 semantics legitimately change expected values; each change annotated)
- [x] `services/worker/src/audit/run-audit.js` (ONLY if the legacy path needs a capability passthrough — target: no change needed)
- [x] `services/worker/src/orchestration/audit-orchestrator.js` (v1.1 patch per §15.4: auditInput business-context passthrough ONLY — direct dependency of WP-D-05)
- [x] `services/worker/src/audit/approved-pages.test.js` (v1.1 proof-only per §15.2: /Scoring v4\./ assertion — renderer shows the versioned scoring version)
- [x] `services/worker/src/audit/run-audit.test.js` (v1.1 proof-only per §15.2: fixtures gain explicit v4 capability markers — fixtures model evidence WITH collected content)

## Prohibited files

- [x] `services/worker/src/contracts/*.schema.json` (no schema changes — score.schema accepts semver)
- [x] `services/worker/src/report/**`, `services/worker/src/report-view-model/**`, `**/golden-master/**`
- [x] `services/worker/src/evidence/**` (capability layer is WP-C's; consume only)
- [x] `app/**`, `lib/**`, `tests/**`, `.github/**`, `services/worker/migrations/**`
- [x] `docs/Vantage_Production_PRD_v3.md`

## Requirements

### WP-D-01 — Weighting defect independently proven and corrected
- [x] Behaviour: new test constructs two dimensions (A: full weight 25, score 80; B: partial — assessed 10 of 25, score 60) and proves the CORRECT assessed-weight-weighted mean (80×25+60×10)/35 = 74.29 → 74; current v3 code returns 100 (bug). Fix: buildLegacyScoreMap numerator uses `dimData.assessedWeight` (actual scored weight), never full intended weight.
- [x] Boundary: vantage-score.js buildLegacyScoreMap
- [x] Unit proof: vantage-score.test.js numeric assertion; a regression test that the buggy formula would fail.
- [x] Failure state: overall readiness must equal Σ(score×assessedWeight)/Σ(assessedWeight) — exact.

### WP-D-02 — Capability-level module eligibility
- [x] Behaviour: every MODULE declares `requiredCapabilities`; checkModuleEligibility v2 requires every required capability status ∈ {AVAILABLE, PARTIAL} AND `requiredFieldsPresent === true`; ineligible module → score null + exact reason; `scoreAudit` accepts `capabilityEvidence` (opts) and derives it deterministically from evidence when omitted (legacy harness path).
- [x] Boundary: score-components.js (MODULES + checkModuleEligibility), vantage-score.js (wiring)
- [x] Unit proof: score-components.test.js truth table per module; capability map from WP-C matrix.
- [x] Failure state: suppressed module contributes 0 to scoredWeight AND 0 to assessedWeight; suppression reasons recorded in suppressedModules.

### WP-D-03 — No silent reweighting
- [x] Behaviour: overallAssessedWeight = Σ scored module weights / 100 exactly; dimension assessedWeight = Σ scored module weights within dimension; readiness label Provisional <80, suppressed <60 (unchanged thresholds); every suppressed module and dimension appears in model.suppressedModules / dimensionEligibility.
- [x] Boundary: vantage-score.js scoreModules + readiness assembly
- [x] Unit proof: truth tables assert exact assessedWeight values for each combination (e.g. no-content case = 100 − suppressed module weights).

### WP-D-04 — Unknown never lowers a score
- [x] Behaviour: module scorers execute only under eligibility; no scorer consumes `false`/empty values that derive from unknown evidence. Where a module has mixed capability inputs (technical_hygiene), sub-rule weights are explicitly partitioned by capability and the module score is computed over available sub-weights only, with `subWeightAssessed` reported in the module result.
- [x] Boundary: score-components.js scorers
- [x] Unit proof: DFS metadata-only site (all content capabilities UNAVAILABLE, technical capabilities AVAILABLE) → content modules suppressed; technical score equals the value computed from technical evidence alone (exact numeric assertion).

### WP-D-05 — Business context into scoring
- [x] Behaviour: scoreAudit passes intake business context (services, primaryGoal, language, market) into module scoring: content/offer modules use intake services ∪ crawl services (deduped); contentIdeas topics = intake services first; ideas frames reference primaryGoal when present; topicRows uses business services.
- [x] Boundary: vantage-score.js + score-components.js + report-model.js
- [x] Unit proof: identical site evidence with two different intake contexts produces context-dependent differences ONLY in context-consuming outputs (asserted exact).

### WP-D-06 — Defensible funnel classification
- [x] Behaviour: `index % 3` classification removed. topicRows derives stage per service from page-purpose evidence: matched page with form/CTA → BOFU; testimonial/case-study/review signals → MOFU; educational/blog/guide/faq → TOFU; no page-purpose evidence → "Not Assessed". Deterministic (ties by URL).
- [x] Boundary: report-model.js topicRows
- [x] Unit proof: fixture services/pages → exact expected stages; no-evidence service → Not Assessed; determinism.

### WP-D-07 — Tightened AI-readiness claims
- [x] Behaviour: scoreAiReadiness scores only structural machine-readability evidence: schema (structured-data capability gated), headings (pages evidence), FAQ (content capability), topic breadth (crawl-derived). No 5-point floor for unknown; model carries `aiReadinessBasis: "structural"` and a limitation note when schema capability unavailable; the score is never described as actual AI visibility.
- [x] Boundary: score-components.js scoreAiReadiness + vantage-score.js computeFunnelScores
- [x] Unit proof: no-schema site → schema points 0 AND basis/limitation present (not inflated); full-schema site → expected structural score.

### WP-D-08 — Scoring version 4.0.0
- [x] Behaviour: SCORING_VERSION = "4.0.0"; model.scoringVersion/reportVersion carry 4.0.0; score.schema pattern accepts (verified); old reports remain untouched (no re-scoring).
- [x] Boundary: score-components.js
- [x] Unit proof: model assertion + acceptance-wp7 version check.

### WP-D-09 — Exhaustive truth tables
- [x] Behaviour: scoreAudit-level tests for: full evidence; partial content; no content; no schema; no headers; no performance; partial performance; partial page coverage; provider failure (performance FAILED + crawl FAILED); browser failure (documented n/a — WP-E adds); conflicting signals (content parsed but no main content; microdata empty but schemaTypes present). Each asserts: moduleEligibility map, assessedWeight exact, suppressedModules reasons, scores null-vs-number.
- [x] Boundary: vantage-score.test.js
- [x] Unit proof: the enumerated cases with exact assertions.

### WP-D-10 — Repeatability
- [x] Behaviour: identical evidence + capability evidence + input → deepEqual scoring models (generatedAt deterministic via deriveScoredAt); repeated 3×.
- [x] Boundary: vantage-score.test.js

### WP-D-11 — Findings capability-gating (DEF-12 consumption)
- [x] Behaviour: buildFindings gates content-dependent findings on content.body/trust.proof capability statuses (not the `!== false` marker); security-header findings gated on technical.headers; schema finding gated on schema.structured_data; unknown → finding suppressed with reason recorded in model (suppressedFindingReasons), never emitted as false-positive.
- [x] Boundary: score-components.js buildFindings
- [x] Unit proof: no-content site → VAN-TRUST-001/VAN-SCHEMA-001/etc. absent; suppressedFindingReasons lists them; full-evidence site → findings as before (semantics unchanged where evidence confirmed).

### WP-D-12 — Evidence-confidence unknown-factor handling (DEF-10)
- [x] Behaviour: calculateEvidenceConfidence excludes unknown factors from the weighted average instead of defaulting them to 50; factors report null for unknown; `factorAvailability` array included; overall score = Σ(known factor×weight)/Σ(known weights).
- [x] Boundary: score-components.js calculateEvidenceConfidence
- [x] Unit proof: evidence with missing freshness/coverage data → those factors null, score computed from remaining weights (exact).

### WP-D-13 — Regressions + scope + single commit
- [x] Behaviour: npm test + acceptance-prysm/wp2/wp3/wp5/wp6/wp7/wp8/wp9/task7/task9/task10/wp10/wp11/wp12 + tsc green; harness expected-value updates annotated (v4 semantics); scope ⊆ permitted; defect registry DEF-01/02/03/04/05/09/10/12(consumption) CLOSED; single commit + push.

## Verification commands

- [x] `node --test src/scoring/score-components.test.js src/scoring/vantage-score.test.js` — exit 0
- [x] `npm test` — exit 0
- [x] `node scripts/acceptance-wp7.js`, `acceptance-wp8.js`, `acceptance-wp9.js`, `acceptance-wp10.js`, `acceptance-wp11.js`, `acceptance-wp12.js`, `acceptance-prysm.js` — exit 0
- [x] `npx tsc --noEmit` — exit 0
- [x] `git diff --name-only` ⊆ permitted list

## Completion

- [x] All WP-D IDs PASS.
- [x] Regression PASS.
- [x] Scope check PASS.
- [x] Single governed checkpoint commit + push.
- [x] PR remains unmerged until authorized.

## Implementation notes (recorded at closure)

- WP-D-02 implementation detail (checklist v1.1 note per §15.4): the capability gate is status-based — capability STATUS derivation already encodes field collection (UNAVAILABLE ⇒ nothing usable collected; PARTIAL ⇒ some real fields exist), so `requiredFieldsPresent` is retained as report metadata rather than a redundant second gate. Evidence: score-components.test.js truth tables.
- WP-D-01 proof: score-components.test.js "WP-D-01" asserts full-fixture readiness 33 (hand-derived: Σ(score×assessedWeight)/ΣassessedWeight) and partial-dimension readiness 30; the old buggy full-weight numerator yields 31 (documented in-test, rejected).
- technical_hygiene uses capability-partitioned sub-rules (meta 50/images 10 always; indexability/redirects/resources/headers 10 each, included only when their capability is available) with subWeightAssessed reported — finer granularity than a binary requiredCapabilities list; documented in MODULES comment.
- topicRows stage semantics changed (page-purpose evidence or Not Assessed) but the frozen report-view-model row SHAPE is preserved (page/stageBasis provenance deferred to report v2 per WP-G).
- Harness updates (annotated, proof-only): approved-pages /Scoring v4\./, run-audit fixtures gained explicit capability markers, acceptance-wp7 version strings + capability pre-persist, DE-16 schema list (WP-C), wp5/wp6/wp10 schema lists (WP-C).

## Completion evidence (recorded 2026-08-16)

- score-components.test.js: 15/15 PASS (weighting defect, eligibility truth tables, business context, funnel stages, AI claims, findings gating, confidence availability, repeatability)
- vantage-score.test.js: 70/70 PASS (v4 version, fixtures with explicit capability markers)
- npm test (full worker regression): 743/743 PASS EXIT=0
- acceptance-prysm 82/0, wp7 PASS, wp8, wp9, wp10, wp11, wp12, task7, task9, task10: ALL EXIT=0 (evidence: .governance/evidence/wpd-verify2.log + reruns)
- tsc --noEmit: EXIT=0
- Scope check: `git diff --name-only` ⊆ permitted list (verified at commit)
- Defect registry: DEF-01/02/03/04/05/09/10/12(consumption) CLOSED with evidence

# Prysm PRYSM-NEXT-01 / WP-E Checklist — Functional Conversion Path

**Version:** 1.0.0 (frozen before implementation)
**Skill:** governed-coding-upgrade v2.1.0
**Branch:** feat/prysm-next-product-upgrade
**Required starting SHA:** 81eff44 (post WP-D)
**Objective:** One measurable outcome — a narrow Playwright conversion-path validation layer verifies (on selected decision-bearing pages, desktop+mobile) CTA visibility/interactability, target resolution, menu availability, form render/fields/submit, overlay obstruction, and same-origin destination load; NEVER submits forms or creates external side effects; browser failure ⇒ Not Assessed; validated evidence upgrades the conversion.path capability, feeds scoring v4.1, and persists screenshots through governed storage — all proven with injected-browser fixtures (zero live browsers in tests).
**Baseline active cycle time (written estimate):** 5.0h. **55% target:** ≤ 2.25h.

## Permitted files

- [x] `.governance/changes/**`
- [x] `docs/prysm-governance/work-packages/PRYSM-NEXT-01-WPE_CHECKLIST.md`
- [x] `services/worker/src/evidence/conversion-path-validator.js` (new)
- [x] `services/worker/src/evidence/conversion-path-validator.test.js` (new)
- [x] `services/worker/src/evidence/capability-evidence.js` (conversion.path validation upgrade ONLY)
- [x] `services/worker/src/evidence/capability-evidence.test.js` (validation-upgrade cases)
- [x] `services/worker/src/contracts/conversion-path-validation.schema.json` (new)
- [x] `services/worker/src/contracts/audit-request.schema.json` (additive pathValidation crawl options ONLY)
- [x] `services/worker/src/contracts/validator.js` (registry entry ONLY)
- [x] `services/worker/src/orchestration/audit-orchestrator.js` (validation step + identity fields ONLY)
- [x] `services/worker/src/scoring/score-components.js` (conversion_paths validated-path consumption; SCORING_VERSION 4.1.0)
- [x] `services/worker/src/scoring/vantage-score.test.js`, `score-components.test.js` (version + validated-path cases)
- [x] `services/worker/scripts/acceptance-wp7.js` (proof-only version string updates if needed)
- [x] `services/worker/test-fixtures/contracts/valid|invalid/conversion-path-validation.*.json` (new fixtures)
- [x] `services/worker/src/application/audit-service.js` (v1.1 patch: production live-browser default via env kill-switch ONLY — safety gate for the validation step)
- [x] `services/worker/src/orchestration/source-execution-identity.test.js` (WP-E identity option proof)
- [x] `services/worker/src/scoring/report-model.js` (v1.1 patch per §15.4: site-level fallback stage ladder required because the frozen v1 view-model enum cannot carry "Not Assessed" — discovered by the WP-E integration test)
- [x] `services/worker/src/evidence/decision-evidence-production-regression.test.js` (v1.1 proof-only per §15.2: real-validator schema list includes conversion-path-validation.schema.json)

## Prohibited files

- [x] `services/worker/src/report/**`, `**/golden-master/**`, `app/**`, `lib/**`, `tests/**`
- [x] `services/worker/src/contracts/*.schema.json` EXCEPT the two listed above
- [x] `services/worker/src/lifecycle/**`, `services/worker/migrations/**`, `.github/**`
- [x] `docs/Vantage_Production_PRD_v3.md`

## Requirements

### WP-E-01 — Validator module (injected browser, zero live browsers in tests)
- [x] Behaviour: `validateConversionPaths({ targetUrl, keyPages, playwrightImpl, options })` runs desktop + mobile passes per key page (pageLimit default 6): CTA found/visible/interactable + resolved target; nav menu present + links visible (desktop) / toggle (mobile); conversion form renders with editable fields + enabled submit; overlay obstruction hit-test on CTA; same-origin destination loads via GET page.goto ONLY. Never clicks CTAs/links/submits; never dispatches submit; no POST navigation. Returns per-page `{ url, role, checks, status: PASS|PARTIAL|FAILED|NOT_ASSESSED, limitations, screenshotRef }`.
- [x] Boundary: evidence/conversion-path-validator.js (new)
- [x] Unit proof: mock playwright (recording page/browser objects) — assert exact check records; assert `click()`/`fill()`/submit never invoked (recording mock); mobile pass executed; screenshots captured as Buffers when enabled.
- [x] Failure state: browser launch/goto failure or missing playwrightImpl without allowLiveBrowser → whole validation `{ status: "NOT_ASSESSED", limitations }` — never a lower score.

### WP-E-02 — Form-safety invariant
- [x] Behaviour: the validator has NO code path that submits a form (no click on submit controls, no form.submit(), no dispatch of submit events, no POST). Static + behavioural proof.
- [x] Boundary: validator module
- [x] Unit proof: source-level test (grep the module for submit/dispatch/click patterns + behavioural mock assertion: submit mock counts zero across all scenarios).

### WP-E-03 — Capability upgrade (validated vs inferred)
- [x] Behaviour: `buildCapabilityEvidence` accepts optional `pathValidationEvidence`; when validation completed with ≥1 assessed page → conversion.path capability gains `validated: true`, `validatedBy: "playwright-conversion-path"`, kind "validated" (mixed results → PARTIAL status; all-fail → status stays, validated false); browser NOT_ASSESSED → capability keeps inferred state with a limitation noting validation was unavailable. Deterministic.
- [x] Boundary: evidence/capability-evidence.js + test
- [x] Unit proof: three cases (validated pass, mixed, not-assessed) with exact capability assertions.

### WP-E-04 — Governed persistence of validation evidence + screenshots
- [x] Behaviour: orchestrator step 5b2 (between decision evidence and capability evidence): load key pages (important-page-selector over site evidence), run validator (only when conversion.cta/form capability would be AVAILABLE AND browser allowed), persist `conversion-path-validation.json` (canonical category, schema-validated, SHA-256 verified) + per-page screenshot artifacts (category evidence) with refs recorded; failures → NOT_ASSESSED evidence persisted, pipeline continues; no lifecycle changes; resume/idempotency preserved (step re-runs deterministically).
- [x] Boundary: audit-orchestrator.js + conversion-path-validation.schema.json + validator registry + fixtures
- [x] Unit proof: orchestrator-level test with injected mock validator (validation injectable via adapters/config seam — same seam family as rendererImpl); artifact round-trip + schema validation; capability artifact now carries validated conversion.path.

### WP-E-05 — Scoring v4.1 consumes validated path evidence
- [x] Behaviour: SCORING_VERSION → 4.1.0. conversion_paths module: when conversion.path capability validated, the module score blends base inferred score with validated checks (each verified page adds validated points: CTA interactable + target resolves; obstruction found → finding VAN-PATH-001 "Conversion path is obstructed" with evidence from validation; scores never LOWER on validation NOT_ASSESSED — absence of validation = inferred baseline). Score.schema accepts 4.1.0 (pattern) — verified.
- [x] Boundary: score-components.js (+ vantage-score.test/score-components.test updates)
- [x] Unit proof: same evidence with validation pass vs without → score with validation ≥ without; obstructed case → finding emitted; NOT_ASSESSED validation → score identical to inferred baseline.

### WP-E-06 — Intake schema + execution identity
- [x] Behaviour: audit-request crawl gains additive options: pathValidationEnabled (default true), pathValidationPageLimit (default 6), pathValidationScreenshots (default true), pathValidationMobile (default true); orchestrator execution identity includes them; schema validator tests pass.
- [x] Boundary: audit-request.schema.json + audit-orchestrator.js identity
- [x] Unit proof: identity test addition (option change → key change); schema fixtures pass.

### WP-E-07 — Regressions + scope + single commit
- [x] Behaviour: npm test + acceptance-prysm/wp2/wp3/wp5/wp6/wp7/wp8/wp9/task7/task9/task10/wp10/wp11/wp12 + tsc green; zero live browsers/providers in tests (guards); scope ⊆ permitted; single commit + push; defect registry updated (CRIT #5/#21/#22 evidence).

## Verification commands

- [x] `node --test src/evidence/conversion-path-validator.test.js src/evidence/capability-evidence.test.js` — exit 0
- [x] `node --test src/scoring/score-components.test.js src/scoring/vantage-score.test.js` — exit 0
- [x] `npm test` — exit 0
- [x] `node scripts/acceptance-prysm.js`, `acceptance-wp2.js`, `acceptance-wp7.js`, `acceptance-wp10.js`, `acceptance-wp11.js`, `acceptance-wp12.js` — exit 0
- [x] `npx tsc --noEmit` — exit 0
- [x] `git diff --name-only` ⊆ permitted list

## Completion

- [x] All WP-E IDs PASS.
- [x] Regression PASS.
- [x] Scope check PASS.
- [x] Single governed checkpoint commit + push.
- [x] PR remains unmerged until authorized.

## Completion evidence (recorded 2026-08-16)

- conversion-path-validator.test.js: 8/8 PASS (recording playwright mock — zero clicks/fills/submits asserted behaviourally, no external navigation, browser-failure → NOT_ASSESSED)
- capability-evidence.test.js: 18/18 PASS (validation upgrade: validated/inferred/mixed/NOT_ASSESSED/obstruction cases)
- conversion-path-validation.test.js: 2/2 PASS (orchestrator seam: mock validator through real collection → schema-valid canonical artifact + screenshot evidence + capability upgrade; NOT_ASSESSED path keeps inferred state)
- score-components.test.js + vantage-score.test.js: 88/88 PASS (scoring 4.1.0: validated paths raise conversion score; NOT_ASSESSED = inferred baseline; VAN-PATH-001 obstruction finding)
- source-execution-identity.test.js: 7/7 PASS (path-validation options join the identity)
- npm test (full worker regression): 757/757 PASS EXIT=0
- All acceptance suites (prysm, wp2, wp3, wp5, wp6, wp7, wp8, wp9, task7, task9, task10, wp10, wp11, wp12): EXIT=0 (evidence: .governance/evidence/wpe-verify2.log)
- tsc --noEmit: EXIT=0
- Safety: `allowLiveBrowser` requires explicit production opt-in (`pathValidationLiveBrowser`, default false; production default ON only via audit-service with PRYSM_DISABLE_LIVE_BROWSER kill-switch) — governed suites launch ZERO browsers (asserted in WP-E-04 test: `options.allowLiveBrowser === false`)
- Semantic note: v1 readinessMap stage enum cannot carry "Not Assessed" — deterministic site-level fallback ladder documented in report-model.js; true Not-Assessed rows land in report design v2 (WP-G)

# Prysm PRYSM-NEXT-01 / WP-G Checklist — Report Design V2

**Version:** 1.0.0 (frozen before implementation)
**Skill:** governed-coding-upgrade v2.1.0
**Branch:** feat/prysm-next-product-upgrade
**Required starting SHA:** 1c9ab3d (post WP-F)
**Objective:** One measurable outcome — a distinct governed report design `prysm-report-design-v2.0.0` exists as a NEW renderer (v1.0.0 untouched and re-proven) that answers A (readiness), B (evidence confidence), C (evidence coverage), D (five-pillar problem map), E (prioritized blockers with consequence/evidence/action/impact/effort/confidence), keeps deep evidence traceability, improves responsive + print behaviour, and passes deterministic DOM/golden regression — selected only via the versioned product contract (auditRequest.report.designVersion), default remains v1.
**Baseline active cycle time (written estimate):** 6.0h. **55% target:** ≤ 2.7h.

## Permitted files

- [x] `.governance/changes/**`
- [x] `docs/prysm-governance/work-packages/PRYSM-NEXT-01-WPG_CHECKLIST.md`
- [x] `services/worker/src/report/report-design.js` (new — version registry)
- [x] `services/worker/src/report/render-report-v2.js` (new — v2 renderer, own CSS/DOM)
- [x] `services/worker/src/report/v2-pillars.js` (new — pure pillar computation)
- [x] `services/worker/src/report/render-report-v2.test.js` (new — golden DOM + content proofs)
- [x] `services/worker/src/scoring/vantage-score.js` (additive model field `moduleScores` ONLY — required for pillar display; no scoring semantics change)
- [x] `services/worker/src/scoring/scoring-service.js` (v1.1 patch per §15.4: buildScoreSet passthrough of moduleScores/moduleEligibility/suppressedModules — display-only inputs for v2 rendering; no scoring semantics change)
- [x] `services/worker/src/orchestration/audit-orchestrator.js` (designVersion branch in rendering step ONLY)
- [x] `services/worker/src/contracts/audit-request.schema.json` (additive `report.designVersion` ONLY)
- [x] `services/worker/src/orchestration/source-execution-identity.test.js` (designVersion identity proof)
- [x] `services/worker/src/scoring/score-components.test.js` or vantage-score.test.js (moduleScores presence assertion)

## Prohibited files

- [x] `services/worker/src/report/render-report.js`, `render-approved-report.js`, `sections-*.js`, `html-helpers.js`, `verify-template.js` (v1 renderer LOCKED)
- [x] `**/golden-master/**`, `services/worker/src/contracts/*.schema.json` EXCEPT audit-request
- [x] `app/**`, `lib/**`, `tests/**` (v2 report ACCESS routes land in WP-H)
- [x] `docs/Vantage_Production_PRD_v3.md`

## Requirements

### WP-G-01 — Design version registry + v1 freeze
- [x] Behaviour: `report-design.js` exports REPORT_DESIGN_V1 = "1.0.0", REPORT_DESIGN_V2 = "2.0.0" (prysm-report-design-v2.0.0), DEFAULT_REPORT_DESIGN = v1. v1 renderer files untouched (git diff shows zero changes under report/ except new files).
- [x] Proof: git diff --name-only + v1 template-lock suite (check:template + wp8/wp10/wp11/wp12) green.

### WP-G-02 — Pillar computation
- [x] Behaviour: `computePillars(model)` returns five pillars (offer_content, trust_proof, conversion_path, technical_health, performance_experience), each: { id, label, score (weighted mean of the pillar's module scores, null when none eligible), assessedWeight, moduleScores [{moduleId, score, weight}], capabilities [{key, status}], limitations } — display-only aggregation over the v4 model (no scoring changes; model.moduleScores additive field).
- [x] Proof: unit tests — pillar mapping, weighted means (hand-derived), null handling, capability statuses attached.

### WP-G-03 — V2 executive report renderer
- [x] Behaviour: `renderReportV2(model)` returns one self-contained HTML page (design 2.0.0) with: executive scorecard answering A (readiness or insufficiency label + assessed weight), B (confidence score + band + factor availability), C (coverage: assessedWeight% + capability assessed count), D (five pillar cards with scores + capability states), E (top blockers table: priority, problem, business consequence, evidence/provenance ref, recommended action, impact category, effort, confidence — from score-bearing findings sorted by finalPriority, top 5), deep evidence layer (findings detail + source statuses + capability table + suppressed reasons), scoring/design versions, no invented evidence (every claim cites model data), print CSS hides nav/controls, responsive viewport meta + media queries.
- [x] Proof: DOM/golden tests — required section markers, pillar count, blocker rows contain all required fields, every displayed findingId/ruleId/capability exists in the model, print media rule present, deterministic output (2 renders byte-identical).

### WP-G-04 — Version boundary in production path
- [x] Behaviour: orchestrator rendering step: `auditRequest.report?.designVersion === "2.0.0"` → renderReportV2 (single page index.html under report-v2/pages, v2 finalization: index required, schema-free structural validation via v2 page checks) ; anything else → v1 path unchanged. designVersion joins the execution identity; schema documents the additive field.
- [x] Proof: orchestrator-level test (mock renderer/designVersion=2 → v2 artifact set; default → v1 artifact set) + identity test.

### WP-G-05 — v1 compatibility re-proven
- [x] Behaviour: v1 renderer tests, template lock, wp5/wp8/wp10/wp11/wp12 + acceptance-prysm green at final head; v1 report artifacts byte-identical (existing golden tests unchanged).
- [x] Proof: command outputs.

### WP-G-06 — Regressions + scope + single commit
- [x] Behaviour: npm test + full acceptance battery + tsc green; changed files ⊆ permitted; single governed commit + push; defect registry note (report v2 available; v1 lock intact).

## Verification commands

- [x] `node --test src/report/render-report-v2.test.js` — exit 0
- [x] `npm run check:template` — exit 0 (v1 lock)
- [x] `npm test` — exit 0
- [x] `node scripts/acceptance-prysm.js`, wp2/wp5/wp6/wp7/wp8/wp10/wp11/wp12 — exit 0
- [x] `npx tsc --noEmit` — exit 0
- [x] `git diff --name-only` ⊆ permitted list

## Completion

- [x] All WP-G IDs PASS.
- [x] Regression PASS.
- [x] Scope check PASS.
- [x] Single governed checkpoint commit + push.
- [x] PR remains unmerged until authorized.

## Completion evidence (recorded 2026-08-16)

- render-report-v2.test.js: 10/10 PASS (registry, pillar weighted means incl. null-on-suppression, A–E section markers, blocker column families, no-invented-evidence (every displayed VAN-ruleId exists in model), byte-determinism, print + viewport rules, insufficient-evidence model renders no numeric readiness, v1 renderer path intact)
- source-execution-identity.test.js: 8/8 PASS (designVersion joins the identity)
- validator.test.js: green with additive report.designVersion schema
- npm test (full worker regression): 767/767 PASS EXIT=0
- check:template (v1 template lock): EXIT=0 — v1 renderer untouched (git diff shows zero changes to v1 renderer files)
- acceptance-prysm / wp2 / wp5 / wp6 / wp7 / wp8 / wp10 / wp11 / wp12: ALL EXIT=0
- tsc --noEmit: EXIT=0
- Design boundary: prysm-report-design-v2.0.0 renders through its OWN renderer into the report-v2/ artifact namespace (pages/index.html + manifest.json, frozen manifest schema, reportDesignVersion 2.0.0); default design remains v1.0.0 — v2 selected only via auditRequest.report.designVersion
- v2 finalization: doctype + required-section structural gate; capability-evidence artifact required fail-closed
- Note: v2 report ACCESS routes land in WP-H

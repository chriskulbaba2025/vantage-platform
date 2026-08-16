# Prysm PRYSM-NEXT-01 / WP-H Checklist — Application Product UX

**Version:** 1.0.0 (frozen before implementation)
**Skill:** governed-coding-upgrade v2.1.0
**Branch:** feat/prysm-next-product-upgrade
**Required starting SHA:** ce47e91 (post WP-G)
**Objective:** One measurable outcome — the web app collects business context at intake (services, primary conversion goal, market, editable business name) with validation, displays that context on the audit detail page, serves report-design v2 pages through the SAME authorized report boundary, passes accessibility basics on the intake, and proves it all with new E2E coverage (15/15 Playwright) plus tsc/build/regressions — tenant isolation and role authorization unchanged.
**Baseline active cycle time (written estimate):** 4.0h. **55% target:** ≤ 1.8h.

## Permitted files

- [x] `app/audits/new/page.tsx` (business-context intake)
- [x] `app/audits/[auditId]/page.tsx` (business-context display)
- [x] `lib/audit-request.ts` (services/goal/market validation)
- [x] `services/worker/src/server.js` (report-design v2 page serving AFTER authorization ONLY; governedArtifacts optional dep)
- [x] `tests/wp11/mock-worker.js` (governedArtifacts wiring + getAuditStatus business-context enrichment — mock-only)
- [x] `tests/wp11/business-context-intake.spec.ts` (new E2E)
- [x] `tests/wp11/full-flow.spec.ts` (selector-drift guard updated for the new intake fields)
- [x] `.governance/changes/**`, `docs/prysm-governance/work-packages/PRYSM-NEXT-01-WPH_CHECKLIST.md`

## Prohibited files

- [x] `services/worker/src/scoring/**`, `src/report/**`, `src/evidence/**`, `src/contracts/*.schema.json`
- [x] `**/golden-master/**`, `docs/Vantage_Production_PRD_v3.md`
- [x] `services/worker/src/application/**` (audit-service untouched)

## Requirements

### WP-H-01 — Business-context intake
- [x] Behaviour: the intake form collects businessName (editable, auto-derived), services (comma-separated, ≤20, each ≤128), primaryGoal (select + custom, ≤256), market/location (≤128) + existing audience scope/competitors; validation rejects invalid input without creating an audit; payload passes services/primaryGoal/market/language through buildAuditPayload.
- [x] Proof: tests/wp11/business-context-intake.spec.ts INTAKE-01/02.

### WP-H-02 — Audit detail shows business context
- [x] Behaviour: the detail page displays services, primary goal, and market when the worker status carries them (mock enrichment mirrors the production request persistence); tenant/role authorization unchanged (same worker status boundary).
- [x] Proof: INTAKE-01 asserts the context values on the detail page.

### WP-H-03 — v2 report serving through the authorized boundary
- [x] Behaviour: the worker report route serves report-v2/pages/index.html from the governed artifact store ONLY after the existing authorization sequence (tenant membership + role gate + state gate) completes; missing v2 artifact falls through to v1; path-traversal rules unchanged; optional `governedArtifacts` dep (absent ⇒ v1 only).
- [x] Proof: worker regression + acceptance-prysm/wp12 + a v2-serving assertion in the WP-I plumbing proof (WP-H lays the route; end-to-end v2 retrieval is proven in WP-I).

### WP-H-04 — Accessibility + selector-drift guard
- [x] Behaviour: every intake control has a label or aria-label (asserted); the WEB-01 selector-drift guard reflects the new form fields.
- [x] Proof: INTAKE-03 + full-flow WEB-01 (15/15 Playwright).

### WP-H-05 — Verification
- [x] Behaviour: tsc EXIT=0; next build EXIT=0; Playwright 15/15; worker npm test green; acceptance-prysm/tenant/provisioning/wp6/wp12 green.
- [x] Proof: .governance/evidence/wph-verify.log + /tmp playwright logs.

## Completion

- [x] All WP-H IDs PASS.
- [x] Single governed checkpoint commit + push.
- [x] PR remains unmerged until authorized.

## Completion evidence (recorded 2026-08-16)

- Playwright: 15/15 PASS (12 existing + 3 new business-context specs: INTAKE-01 creation with services/goal/market displayed from the persisted governed request; INTAKE-02 invalid input rejected with no audit; INTAKE-03 every intake control labelled) — run with clean 19350/19400 ports
- tsc --noEmit EXIT=0; next build EXIT=0
- npm test (worker regression): 767/767 PASS EXIT=0
- acceptance-prysm / tenant / provisioning / wp6 / wp12: EXIT=0 (worker v2 report-serving branch preserves authorization + v1 paths)
- Tenant isolation + role authorization unchanged (server.js change occurs AFTER the existing authorizeAuditAccess + authorizeReportAccess sequence; acceptance-tenant green)
- Note: end-to-end v2 report retrieval through the app routes is proven in WP-I plumbing

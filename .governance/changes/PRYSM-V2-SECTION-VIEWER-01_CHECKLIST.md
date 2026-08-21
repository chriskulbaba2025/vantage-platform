# PRYSM-V2-SECTION-VIEWER-01 — Frozen Checklist

**Release intent:** CHANGE_ONLY / governed preview candidate
**Starting SHA:** `cd826cd8f47f014423452e1513f59b4ba9e43b3c`
**Branch:** `design/prysm-v2-section-viewer`
**Governing sources:** Production PRD v3 §17.5; Report Immutability Contract §5, §8, §9; Governed Change Profile; governed-coding-upgrade v2.1.0.

## Objective

Replace the Report Design v2 giant single-scroll viewer with a section-page viewer while preserving the existing governed report artifact, data model, section generators, section order, and production plumbing.

The current v2 `index.html` remains the single governed artifact. The viewer presents the existing report as 15 navigable conceptual pages, with sticky left navigation and browser-native print/save-to-PDF for the currently selected page only.

## Permitted files

- `.governance/changes/PRYSM-V2-SECTION-VIEWER-01_CHECKLIST.md`
- `services/worker/src/report/render-report-v2.js`
- `services/worker/src/report/render-report-v2.test.js`
- project-context checkpoint files produced outside the runtime repository for user re-upload

## Prohibited files / scope

Do not change:

- evidence collection or normalization
- scoring or finding rules
- Narrative v2 Writer/Judge contracts, prompts, models, call policy, or cost policy
- n8n
- lifecycle states or approval logic
- worker report routes
- artifact keys, storage, persistence, or report manifests
- audit request schema or report-design selector
- v1 approved multi-page renderer
- provider configuration or paid-call behaviour

No live provider/model calls are authorized by this change.

## Frozen acceptance checklist

- [ ] UI-01 — Existing v2 governed artifact remains `report-v2/pages/index.html`; no server/routing/storage changes.
- [ ] UI-02 — Exactly 15 left-nav entries match the governed PRD section order.
- [ ] UI-03 — Desktop navigation is sticky and independently scrollable.
- [ ] UI-04 — Normal view displays only the selected conceptual report page; existing generated sections are not deleted or rewritten.
- [ ] UI-05 — URL hash selects the conceptual page; invalid/missing hash safely falls back to Executive Scorecard.
- [ ] UI-06 — Active navigation state is exposed with `aria-current="page"` and updated deterministically.
- [ ] UI-07 — Each conceptual page exposes a visible `Print or save this page as PDF` browser-print control.
- [ ] UI-08 — Print CSS hides navigation, controls, and every non-active conceptual page; only the selected page is printable.
- [ ] UI-09 — Mobile layout remains navigable without a fixed-width left rail.
- [ ] UI-10 — Existing report section generators remain in their current order and consume the same governed model.
- [ ] UI-11 — v1 renderer remains unchanged.
- [ ] UI-12 — Report presentation identifies viewer/design presentation version `2.1.0` while preserving the existing v2.0.0 audit selector/data contract.
- [ ] UI-13 — Deterministic render regression remains byte-identical for identical inputs.
- [ ] UI-14 — Tests prove all 15 page keys, active-page logic hooks, print isolation rules, and responsive navigation markup.
- [ ] UI-15 — Full exact-head CI passes with zero paid/provider/model calls.
- [ ] UI-16 — Diff audit confirms only permitted repository files changed.
- [ ] UI-17 — Before/after visual review and accessibility review are completed before merge.
- [ ] UI-18 — Principal Auditor/owner approval is explicitly recorded before golden-master replacement and merge.

## Governed stop condition

If code and CI pass before visual/owner approval, status is **CODE VERIFIED / GOVERNANCE HOLD**. Do not merge until UI-17 and UI-18 are satisfied.

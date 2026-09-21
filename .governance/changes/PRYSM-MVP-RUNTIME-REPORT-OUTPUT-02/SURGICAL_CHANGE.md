# Surgical Change Contract

- **Required outcome:** Contiguously number only the accepted priority cards displayed on Priority Fixes; suppress a Trust verdict paragraph only when its client-facing meaning duplicates the narrative-state message.
- **Diagnosis:** `VERIFIED_ROOT_CAUSE` with exact Preview browser screenshots and executing source paths in `DIAGNOSTIC.md`.
- **Hypothesis:** Display order must determine the visible card number after filtering; equality of normalized client-facing verdict/message means one copy conveys the same information. The hypothesis is `PROVEN` by the exact live fixture.
- **Causal boundary:** `blockersSection` in `render-report-v2.js`; Trust summary rendering in `report-detail-sections.js`; their targeted unit/render tests.
- **Expected surface:** Two report presentation helpers; focused renderer tests; the CR-43 full-render golden hashes affected by the changed output; governed change package; acceptance harness assertion correction.
- **Protected surface:** Encyclopedia acceptance/challenge rules, priority-unit membership and source rank/order, evidence, canonical source, scoring, trust state/score, narrative contracts, APIs, persistence/schema/auth/tenant/provider paths, other staging audits, production state.
- **Structural budget:** Two presentation functions, two focused test modules, temporary browser harness assertion; no public schema/route/dependency/data-provider change.
- **Direct proof:** Sparse source ranks render as 1..N in accepted order; duplicated verdict appears once; the no-state fallback remains; next-step/limitations remain; the 27-case CR-43 matrix changes only at priority-rank labels and identical Trust verdict removal; exact authenticated browser and page-selected PDFs pass.
- **Scope expansion:** Any need to change acceptance/ranking semantics, audit data, worker auth/identity, persistence, or trust score reopens diagnosis and this contract.

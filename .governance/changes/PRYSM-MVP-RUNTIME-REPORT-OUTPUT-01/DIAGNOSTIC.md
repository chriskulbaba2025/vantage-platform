# Diagnostic Evidence

## Classification

`VERIFIED_ROOT_CAUSE`.

## Direct evidence

1. Exact local Chromium session authenticated the staging reviewer through `/api/auth/login`, loaded the dashboard, opened exact audit `6dca53ed-ae00-484c-bf77-b59c059eef51`, opened the report, navigated all seven pages, refreshed the report, and returned to the dashboard. The rendered Trust page visibly contained `STRONG` and `Bounded action`.
2. Exact staging S3 report-v2 `manifest.json` records source report generated `2026-09-14`, report version `4.1.2`, and restoration application SHA `1cd12498c1642c8b2bbb1159971ced580360689d`. Its served `index.html` SHA-256 is `0196b33392ecd428133905e35731f1d75f1a9bba62662542daa846623aff551e`.
3. Read-only reconstruction from the canonical 51-artifact dataset using the exact candidate's `renderReportV2` reproduces `WEAK` and performance wording `Performance evidence AVAILABLE; Performance evidence UNAVAILABLE`. This is deterministic; no provider, audit, Writer, or Judge ran.
4. Root boundary: `report-detail-sections.js:narrativeStateBlock` visibly emits an internal state chip and “Bounded action” in the v2 Trust page. `render-report-v2.js` groups both `performance.lab` and `performance.field` as “Performance evidence” and writes raw enum statuses. Evidence statuses differ by capability, so the duplicate label misrepresents them as contradictory.
5. False-pass cause: `MVP-CLIENT-02` strips tags only from the HTML prefix ending before `id="pillars"`; that excludes Trust and Supporting Detail, where the shared section helper is rendered. No all-seven-page visible-copy assertion covered that helper's output.
6. Frozen viewer checklist establishes that print is intentionally isolated to the currently selected conceptual page. The initial four-sheet PDF was Executive Scorecard content only; it is not treated as a print defect. Closure will print each of the seven selected pages and inspect their combined artifact.

## Identity and path evidence

The real authenticated browser path traversed the exact Preview, exact GENSEN staging worker, staging tenant, PostgreSQL audit status, and S3 report artifact. The audit identity matched at dashboard, detail, report route, and S3 key. Browser refresh preserved the session. No cross-tenant/default fallback was observed.

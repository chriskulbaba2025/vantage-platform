# Test Area Map

| Area | State | Proof mechanism |
|---|---|---|
| STRUCTURE | ACTIVE | Diff audit; only renderer, renderer regression tests, and this change package |
| UNIT | ACTIVE | `node --test src/report/render-report-v2.test.js` |
| CONTRACT | ACTIVE | v2 page/version contract, output capability/status language, and print-viewer tests |
| INTEGRATION | ACTIVE | Report model → seven-page renderer with exact canonical 51-artifact audit data |
| END_TO_END / ACCEPTANCE | ACTIVE | Real local Chromium through login, dashboard, exact audit, seven pages, refresh and return |
| DATA / MIGRATION | ACTIVE | Read-only canonical input replay; update only that audit's staging rendered page artifact |
| SECURITY / PRIVACY | ACTIVE | Reviewer-only staging identity; branch Preview settings only; no secret in logs/proof |
| RELIABILITY / RECOVERY | ACTIVE | Exact artifact hash/read-back and refresh/session continuity |
| EXTERNAL CALL / COST | ACTIVE | Assert no paid provider, Writer, Judge, or new audit invocation |
| PERFORMANCE / RESOURCE | N/A — direct render only | No algorithmic/data-shape/resource boundary changes |
| COMPATIBILITY | ACTIVE | Existing v1 renderer and all seven selected-page viewer routes remain unchanged |
| RELEASE / DEPLOYMENT | ACTIVE | Exact candidate Preview and authoritative Railway staging deployment |
| MODEL / SEMANTIC ROBUSTNESS | ACTIVE — deterministic output | Real audit model replay and four status/narrative-state combinations; no model execution |

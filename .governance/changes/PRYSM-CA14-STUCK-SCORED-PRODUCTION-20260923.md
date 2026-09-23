# PRYSM CA14 production recovery handoff

- Audit: `490fe40e-5c7d-428f-a45b-c27b0613f6a4`
- Target: `https://ca14.biz/`
- Original production SHA: `aea98ed497827c89ce030a7670ce834611681d0b`
- Promoted combined candidate SHA: `481a9a93eae5d77e794ce452b8000b5cbac4ad06`
- Railway deployment: `3598b6be-d466-4a2b-b1fd-403025537657`, SUCCESS, exact promoted SHA
- Vercel production deployment: `prysm-6s0kau2tx-chriskulbabas-projects.vercel.app`, READY, exact promoted SHA

## Exact root cause

Persisted CA14 scoring artifacts contain `findings.json=[]`. On the original
production SHA, deterministic Narrative v2 preparation therefore threw in
`prepareCanonicalSolutions` and the wrapper returned `SCORED`, leaving a false
active lifecycle state. The first divergent boundary was
`runNarrativeV2FromScored -> prepareCanonicalSolutions`.

## Repair and verification

The current production crawler repair remains preserved. The integrated
stuck-SCORED repair transitions deterministic preparation failures to
`NARRATIVE_FAILED` with reason `narrative-v2-preparation-failed`, recoverable,
and preserves canonical evidence fallback authority. Exact replay passed with
zero model calls. Targeted tests, full worker regression, and the additional
narrative-v2/lifecycle/artifact/schema/orchestration suites passed with zero
failures.

## Exact audit disposition

Production startup reached the persisted CA14 audit and logged the deterministic
preparation error without invoking Writer/Judge. Because no reusable Narrative
v2/report-v2 artifacts exist, the next continuation is a new paid Writer/Judge
operation. No DataForSEO or paid model calls were performed.

Final status: `PAID_NARRATIVE_CALL_AUTHORIZATION_REQUIRED`.

Exact next action: authorize and run the existing governed Narrative v2 resume
for this same audit only; do not recollect or create a replacement audit.

# Test Area Map

| Boundary | Proof | Required |
|---|---|---|
| P-B17 source-status/actionability branch | `node --test src/report/p6-unavailable-roadmap.test.js src/audit/approved-pages.test.js` | 24/24 pass, zero skipped |
| Whole-App gate integration | `node scripts/prysm-whole-app-gate.js` within `npm run verify:prysm-closure` | output includes P-B01–P-B17 only after branch scenarios pass |
| Entire worker and assembled release closure | `npm run verify:prysm-closure` | pass; record counts/durations and all Whole-App IDs |
| Exact final candidate | hosted CI + Vercel Preview + Railway staging + Chromium/PDF + independent challenge | exact final SHA, production untouched |

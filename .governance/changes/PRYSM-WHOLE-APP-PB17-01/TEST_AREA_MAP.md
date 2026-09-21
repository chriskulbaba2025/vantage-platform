# Test Area Map

| Boundary | Proof | Required |
|---|---|---|
| P-B17 source-status/actionability branch | `node --test src/report/p6-unavailable-roadmap.test.js src/audit/approved-pages.test.js` | 25/25 pass, zero skipped; includes approval, committed-artifact reload, and persisted report output |
| Whole-App gate integration | `node scripts/prysm-whole-app-gate.js` within `npm run verify:prysm-closure` | output includes P-B01–P-B17 only after branch scenarios pass |
| Entire worker and assembled release closure | `npm run verify:prysm-closure` | 1,030/1,030 worker regression; Whole-App and closure machine gates PASS with P-B01–P-B17 |
| Exact final candidate | hosted CI + Vercel Preview + Railway staging + Chromium/PDF + independent challenge | `6990c3f5c328835e8a6d7fb843dfbd2788e60940`; all PASS, production untouched |

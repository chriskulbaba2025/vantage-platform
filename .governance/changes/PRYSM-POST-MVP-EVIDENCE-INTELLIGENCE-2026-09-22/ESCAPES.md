# Verification Escape Ledger

## Integration escape — memory/PostgreSQL evidence-row vocabulary

- Candidate where discovered: working continuation after `b3e1afca893b96e5ee3001d9e1f9d7c415de1145`
- Classification: `INTEGRATION_ESCAPE` / `FALSE_PASS_ESCAPE`
- Boundary: evidence repository write contract → memory read projection → Ask PRYSM query consumer
- Observed defect: memory reads returned application camelCase fields while Ask PRYSM consumes the PostgreSQL snake_case row contract, producing citations with missing evidence identity/status on local composition.
- Root cause: memory repository was treated as an in-process store rather than a contract-equivalent repository.
- Smallest repair: normalize memory `listEvidence` reads to the PostgreSQL row vocabulary; preserve application-shaped write input.
- Permanent proof: `memory-evidence-graph-repository.test.js` plus authenticated API-level Ask PRYSM tenant isolation test in `server-auth-fail-closed.test.js`.
- Negative proof: cross-tenant authenticated request returns non-disclosing 404 and cannot expose tenant B evidence.
- Status: CLOSED for the exact candidate after focused proof; full exact-candidate regression still required before checkpoint acceptance.

## Hosted currentness escape — stale Railway identity values in deployment harness

- Candidate where discovered: exact-candidate redeploy attempt after `2bc8d06eebcf5b705886ef002ee3d0bb8ccb68fd`
- Classification: `HARNESS_DEFECT`
- Boundary: Railway authoritative staging variables → Vercel Preview runtime identity → Railway worker authorization
- Preserved run: Vercel deployment `dpl_88518R7u7avbBotH53raT1WzyQRA`, Preview `prysm-lnadjyl23-chriskulbabas-projects.vercel.app`; browser login returned 200, but dashboard/detail showed worker unavailable and the worker path returned unauthorized.
- Root cause: the shell-held `VANTAGE_TENANT_ID` and `VANTAGE_WEBHOOK_SECRET` did not equal the current Railway staging variables. The application candidate was not changed.
- Smallest repair: source tenant/secret directly from `railway variable list --json` for the deployment, pass them as both Vercel build-time and runtime values, and rerun the exact browser path.
- Permanent proof: exact currentness redeploy plus browser proof `26-HOSTED-GENERALIZED-CANDIDATE.pdf`; future hosted acceptance must compare deployment inputs against the authoritative Railway variable source before browser execution.
- Status: CLOSED; authoritative redeploy `dpl_96m31r4f3vonDQwLMkHeP9EpaZVJ` passed login, persisted audit reload, report, and PDF with zero console errors.

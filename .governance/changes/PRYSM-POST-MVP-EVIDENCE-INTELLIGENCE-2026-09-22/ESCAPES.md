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


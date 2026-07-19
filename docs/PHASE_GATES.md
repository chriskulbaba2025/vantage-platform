# Vantage Build Phase Gates

| Phase | Scope | Required gate |
|---|---|---|
| 1 | Locked template and contracts | CSS/JS checksum unchanged; 13 sections preserved |
| 2 | Evidence collection | Website, performance, competitor, backlink, and optional GA4 contracts validated |
| 3 | Scoring and rendering | Deterministic score model; no unresolved tokens; evidence-linked findings |
| 4 | Runtime and storage | CLI and API complete; local and S3 artifact stores available |
| 5 | Orchestration and deployment | n8n workflow, Dockerfile, Railway config, and CI included |
| 6 | Acceptance | Automated tests pass and Karen Leslie sample report is generated |

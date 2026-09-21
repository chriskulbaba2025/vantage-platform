# Project Adapter — PRYSM MVP Closure

**Protocol:** Governed Coding Upgrade v2.4.0.
**Repository:** `chriskulbaba2025/vantage-platform`.
**Authoritative checkout:** `C:\Users\kulba\Desktop\vantage-platform-mvp-closure`.
**Branch:** `repair/prysm-mvp-client-readiness-2026-09-21`.

## Components and proof

- Web: Next.js App Router / TypeScript at repository root; install with npm; production build `NODE_ENV=production npm run build`.
- Worker: Node ESM under `services/worker`; full governed proof `npm run verify:prysm-closure` there; includes worker regression, app production-path, and Whole-App branch matrix P-B01–P-B17.
- Hosted web: Vercel project `prysm`, team `chriskulbabas-projects`, Preview scope only for this repair branch.
- Hosted worker: Railway `GENSEN process` project staging service `vantage-platform-staging`.
- Auth: staging Cognito reviewer; principal is carried by signed session and forwarded to worker; tenant membership is enforced server-side before artifact retrieval.
- Persistence/output: staging PostgreSQL holds audit identity/state; staging S3 stores report artifact; browser and print/PDF retrieve through the authenticated report proxy.
- Secrets: server-side only; no values in source, proof, or logs. No production resource mutation in this closure.

## Terminal proof requirements

The accepted flow is login → dashboard → persisted audit → report proxy → persisted artifact → seven-page browser output → browser PDF. Existing report fixtures are read-only; no new audit, paid provider, Writer, or Judge operation is permitted. Final hosted/browser evidence must identify the exact candidate. Railway does not expose a separate running-container digest; report only the deployment lifecycle and exposed build manifest/config identities.

**Last verified candidate before this change:** `45cb20d40b4d3d382503aef1ca179b3cd4b24e64`.

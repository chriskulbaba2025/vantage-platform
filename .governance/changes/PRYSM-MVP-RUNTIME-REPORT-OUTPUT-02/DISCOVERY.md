# Discovery

## Exact runtime path

`Chromium → Vercel Preview prysm → Cognito login/session cookie → Next.js currentPrincipal → signed x-prysm-principal + x-vantage-secret → Railway GENSEN staging worker → PostgreSQL identity/membership + audit listing → authorized report read → staging S3 report-v2 object → Chromium report pages/PDF`.

Production Path Equivalence is `PROVEN_EQUIVALENT` for the claimed staging client workflow: the test uses the same browser login and same-origin report flow, actual reviewer identity and worker authorization, authoritative staging PostgreSQL/S3, and terminal report route. The Vercel share link only admits the protected Preview host; it does not bypass the application login or the worker’s principal/membership checks.

## Authoritative runtime components

- Vercel project `prysm`, ID `prj_o4dQkuESOoTphZkOwVKG49BaLQT9`, Preview team `chriskulbabas-projects`.
- Railway project `GENSEN process`, staging environment ID `9d541fe0-5103-4134-98dc-332dae65de7b`, service `vantage-platform-staging`, ID `d8504781-cb85-4b09-8999-19852f39be2b`.
- Worker deployment before this change: `1a0ecd04-b304-45d6-997e-8684cf2ff968`, source SHA `7b2514c88ebbc50a55b8426d6ad9cd3055fc530b`.
- Audit and report artifact identity are the authoritative audit ID above; the existing S3 object is keyed by that audit ID and tenant-scoped staging path.
- No production resource/configuration is in scope.

## Material branches

| ID | Branch | Required proof |
|---|---|---|
| RPT-OUT-01 | Accepted groups all retained | Rendered order numbers are contiguous after accepted-unit filtering |
| RPT-OUT-02 | Shared narrative state equals section verdict | One visible Trust verdict; next step/limitations retained |
| RPT-OUT-03 | Semantically different verdict | Trust section still renders its distinct client verdict |
| RPT-OUT-04 | Authenticated persisted report consumer | Same reviewer retrieves exact audit/report after reload |
| RPT-OUT-05 | Selected-page print | Fresh PDFs remain page-scoped, readable, complete, and non-clipped |


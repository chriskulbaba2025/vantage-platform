# Frozen Acceptance Checklist

| ID | Requirement | Required proof |
|---|---|---|
| RENDER-01 | Trust narrative has no visible internal state enum or “Bounded action” label | Full visible-text assertion on `#eeat` and all page sections |
| RENDER-02 | Capability names distinguish page-speed lab checks from real-user field data | Fixture with lab AVAILABLE and field UNAVAILABLE; labels and mapped meanings asserted |
| RENDER-03 | Client-facing visible output has no raw source status enum leakage | Test strips tags, style/script/comments across all seven viewer sections |
| RENDER-04 | Source/evidence statuses remain distinguishable and accurate | Positive/negative capability status matrix incl. UNKNOWN, PARTIAL, UNAVAILABLE |
| RENDER-05 | Viewer version identifies corrected renderer | Version contract test expects 2.3.1 |
| RUNTIME-01 | Exact audit uses the corrected candidate output | Current renderer version and output hash match staging artifact and report route |
| BROWSER-01 | Authenticated login, dashboard, exact audit/detail/report, seven sections, refresh/session, dashboard return | Real Chromium evidence on exact Preview and Railway staging |
| PDF-01 | One PDF for each selected conceptual page; combined report has no blank/clipped/overflow/orphaned content | Render every selected page, inspect every page visually and textually |
| IDENTITY-01 | Auth principal, staging tenant, audit, client and report artifact stay continuous | Production-shaped browser path plus worker/S3 exact identity evidence |
| PROD-01 | Production systems remain untouched | Git, Vercel, AWS, Railway, DB and S3 production-side evidence |

No provider/model calls, new audit, or audit mutation are allowed.
